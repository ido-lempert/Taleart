// Visitors' responses to interactive components (epic interactive components R9, R11): the
// Delivery API's `POST /responses`, which the Web SDK posts a vote to with the site key, and the
// Management API's `GET /tales/{taleId}/responses`, which Tale Studio's inspector reads.
import {
  ErrorCodes,
  type InteractiveResponse,
  type InteractiveResponseRequest,
  type TaleResponses,
} from '@taleart/contract';
import {
  InvalidResponseValueError,
  recordResponse,
  ResponseTargetNotFoundError,
  taleResponseCounts,
  VisitorIdRequiredError,
} from '@taleart/server-interactive';
import { taleExists, TaleNotFoundError } from '@taleart/server-tales';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';
import { rateLimit, VISITOR_HEADER, visitorId, type RateLimitOptions } from './rate-limit';

/**
 * The stricter limit of `POST /delivery/v1/responses`, per visitor (and per address without one),
 * beside the Delivery API's own: a visitor answers each component once, so a burst of 30 and one a
 * second leave every honest page room and cap a script that votes in a loop.
 */
export const DEFAULT_RESPONSE_RATE_LIMIT: RateLimitOptions = { burst: 30, perSecond: 1 };

/**
 * The largest body a Delivery API request may send: a response is a few ids and a value, well under
 * 1 KB. Read before the key lookups, so an oversized body costs no queries (413).
 */
export const DELIVERY_BODY_LIMIT_BYTES = 4 * 1024;

const REQUEST_FIELDS = new Set(['taleId', 'elementId', 'value', 'clientAt']);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function badRequest(message: string): HttpError {
  return new HttpError(400, ErrorCodes.validationFailed, message);
}

// The request body as the contract states it (InteractiveResponseRequest), or a 400.
function readRequest(body: unknown): { taleId: string; elementId: string; value: unknown; clientAt: Date | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('Send a JSON object');
  const request = body as Partial<InteractiveResponseRequest> & Record<string, unknown>;
  const unknown = Object.keys(request).find((key) => !REQUEST_FIELDS.has(key));
  if (unknown !== undefined) throw badRequest(`${unknown} is not a known field`);
  if (typeof request.taleId !== 'string' || typeof request.elementId !== 'string') {
    throw badRequest('taleId and elementId are required');
  }
  if (request.value === undefined) throw badRequest('value is required');
  let clientAt: Date | null = null;
  if (request.clientAt !== undefined) {
    const at = typeof request.clientAt === 'string' && ISO_DATE_TIME.test(request.clientAt) ? new Date(request.clientAt) : null;
    if (!at || Number.isNaN(at.getTime())) throw badRequest('clientAt must be an ISO 8601 date and time');
    clientAt = at;
  }
  return { taleId: request.taleId, elementId: request.elementId, value: request.value, clientAt };
}

/** The write limit {@link DEFAULT_RESPONSE_RATE_LIMIT}, or a pass-through when it is off (null). */
export function responseRateLimit(options: RateLimitOptions | null): RequestHandler {
  if (!options) return (_req, _res, next) => next();
  const limit = rateLimit(options);
  return (req, res, next) => (req.method === 'POST' ? limit(req, res, next) : next());
}

/**
 * `POST /responses` of the Delivery API, mounted after its key middleware (the zone is in
 * `res.locals.requestZoneId`). Needs a valid `X-TaleArt-Visitor` (400 `visitor_id_required`);
 * answers 201 for a new response and 200 for a repeat, with the stored value and the current result.
 */
export function deliveryResponsesRouter(pool: Pool): Router {
  const router = Router();
  router.post('/responses', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const visitor = visitorId(req.headers[VISITOR_HEADER.toLowerCase()]);
      if (visitor === null) throw new VisitorIdRequiredError();
      const request = readRequest(req.body);
      const recorded = await recordResponse(pool, {
        zoneId: res.locals['requestZoneId'] as string,
        taleId: request.taleId,
        elementId: request.elementId,
        value: request.value,
        visitorId: visitor,
        clientAt: request.clientAt,
      });
      const body: InteractiveResponse = recorded;
      res.status(recorded.recorded ? 201 : 200).json(body);
    } catch (err) {
      if (err instanceof VisitorIdRequiredError) next(new HttpError(400, err.code, err.message));
      else if (err instanceof ResponseTargetNotFoundError) next(new HttpError(404, err.code, err.message));
      else if (err instanceof InvalidResponseValueError) next(new HttpError(422, err.code, err.message));
      else next(err);
    }
  });
  return router;
}

/** `GET /tales/{taleId}/responses` of the Management API: mounted at `/tales`. */
export function taleResponsesRouter(pool: Pool): Router {
  const router = Router();
  router.get('/:taleId/responses', authorizeParam(pool, 'tale', 'taleId'), async (req, res, next) => {
    try {
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const body: TaleResponses = await taleResponseCounts(pool, taleId);
      // Counts change with every vote: never kept.
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
