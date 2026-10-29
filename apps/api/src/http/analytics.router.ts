// Analytics (epic analytics): the Delivery API's `POST /events`, which the Web SDK sends viewers'
// impressions, opens, tale views and clicks to with a zone key, and the Management API's
// `GET /zones/{zoneId}/analytics`, which the dashboard's Analytics tab reads.
import {
  DEFAULT_ANALYTICS_PERIOD,
  ErrorCodes,
  isAnalyticsPeriod,
  MAX_ANALYTICS_EVENTS_PER_REQUEST,
  ZONE_KEY_PREFIX,
  type AnalyticsAccepted,
} from '@taleart/contract';
import { canAccessProject, zoneForKey } from '@taleart/server-access';
import { recordAnalyticsEvents, zoneAnalytics } from '@taleart/server-analytics';
import { zoneProjectId, ZoneNotFoundError } from '@taleart/server-zones';
import express, { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { caller } from './authorize';
import { HttpError, refuseInvalidSiteKey } from './errors';
import { rateLimit, VISITOR_HEADER, visitorId, type RateLimitOptions } from './rate-limit';

/**
 * The per-visitor limit of `POST /delivery/v1/events` (analytics spec: rate limited per visitor,
 * stricter than reads): a visitor's page sends at most a batch every 5 seconds, so a burst of 30 and
 * half a request a second leave every honest page room and cap a script that floods events.
 */
export const DEFAULT_EVENT_RATE_LIMIT: RateLimitOptions = { burst: 30, perSecond: 0.5 };

/**
 * The largest body of `POST /delivery/v1/events`: 50 events of a few hundred bytes each at most,
 * so 32 KB holds any valid request with room to spare, and a beacon's key and visitor fields.
 */
export const ANALYTICS_BODY_LIMIT_BYTES = 32 * 1024;

// The request's fields. `key` and `visitor` are for a beacon, which cannot send headers.
const EVENTS_FIELDS = new Set(['events', 'key', 'visitor']);

function badRequest(message: string): HttpError {
  return new HttpError(400, ErrorCodes.validationFailed, message);
}

// The zone key of the request: its Authorization bearer, or for a beacon (which cannot set headers)
// the `key` of its body. A site key or any other value is a refused key, as on every Delivery route.
function requestKey(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (header !== undefined) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match?.[1];
  }
  const key = (req.body as { key?: unknown } | undefined)?.key;
  return typeof key === 'string' ? key : undefined;
}

// The visitor id: the X-TaleArt-Visitor header, else the beacon's `visitor` field. Missing or invalid
// answers 400 `visitor_id_required`, as responses do.
function requestVisitor(req: express.Request): string | null {
  const fromHeader = visitorId(req.headers[VISITOR_HEADER.toLowerCase()]);
  if (fromHeader !== null) return fromHeader;
  const field = (req.body as { visitor?: unknown } | undefined)?.visitor;
  return typeof field === 'string' ? visitorId(field) : null;
}

/** The limit of `POST /events`, or a pass-through when it is off (null). */
export function eventRateLimit(options: RateLimitOptions | null): RequestHandler {
  if (!options) return (_req, _res, next) => next();
  const limit = rateLimit(options);
  return (req, res, next) => (req.method === 'POST' ? limit(req, res, next) : next());
}

/**
 * `POST /events` of the Delivery API, mounted before the Delivery key middleware, which it replaces
 * for this route: it takes only a zone key (`tak_...`), never a site key, and reads the body with
 * its own limit, which accepts `text/plain` too, the type a beacon with a string body is sent as.
 * Answers 202 with the kept and dropped counts; the events themselves are checked by the analytics
 * module.
 */
export function deliveryEventsRouter(pool: Pool): Router {
  const router = Router();
  router.post(
    '/events',
    express.json({ limit: ANALYTICS_BODY_LIMIT_BYTES, type: ['application/json', 'text/plain'] }),
    async (req, res: Response, next) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const key = requestKey(req);
        const zone = key?.startsWith(ZONE_KEY_PREFIX) ? await zoneForKey(pool, key) : null;
        if (zone === null) {
          refuseInvalidSiteKey(res);
          return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('Send a JSON object');
        const unknown = Object.keys(body).find((field) => !EVENTS_FIELDS.has(field));
        if (unknown !== undefined) throw badRequest(`${unknown} is not a known field`);
        if (!Array.isArray(body['events'])) throw badRequest('events must be a list of events');
        if (body['events'].length > MAX_ANALYTICS_EVENTS_PER_REQUEST) {
          throw badRequest(`At most ${MAX_ANALYTICS_EVENTS_PER_REQUEST} events per request`);
        }
        const visitor = requestVisitor(req);
        if (visitor === null) {
          throw new HttpError(400, ErrorCodes.visitorIdRequired, 'A valid X-TaleArt-Visitor id is required');
        }
        const counted = await recordAnalyticsEvents(pool, {
          projectId: zone.projectId,
          zoneId: zone.zoneId,
          visitorId: visitor,
          events: body['events'],
        });
        const answer: AnalyticsAccepted = counted;
        res.status(202).json(answer);
      } catch (err) {
        next(err);
      }
    },
  );
  return router;
}

/**
 * `GET /zones/{zoneId}/analytics` of the Management API, mounted at `/zones`. Needs a zone the
 * caller's access reaches: any other zone, and an unknown one, answers 404 `zone_not_found`, so a
 * zone of another project cannot be told from a missing one. `period` is 7d, 30d or 90d (30d when
 * left out); anything else answers 400.
 */
export function zoneAnalyticsRouter(pool: Pool): Router {
  const router = Router();
  router.get('/:zoneId/analytics', async (req, res, next) => {
    try {
      const zoneId = req.params['zoneId'] ?? '';
      const projectId = await zoneProjectId(pool, zoneId);
      if (projectId === null || !(await canAccessProject(pool, caller(res), projectId))) {
        throw new ZoneNotFoundError(zoneId);
      }
      const period = req.query['period'] ?? DEFAULT_ANALYTICS_PERIOD;
      if (!isAnalyticsPeriod(period)) throw badRequest('period must be 7d, 30d or 90d');
      const body = await zoneAnalytics(pool, { projectId, zoneId, period });
      // Counts change with every event: never kept.
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
