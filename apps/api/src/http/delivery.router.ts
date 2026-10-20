import { ErrorCodes, type DeliveryZone } from '@taleart/contract';
import { zoneForKey, type KeyZone } from '@taleart/server-access';
import { findZone, listFrames } from '@taleart/server-zones';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { errorBody } from './errors';

// One message for a missing, unknown or revoked key, so a caller cannot tell them apart.
const INVALID_KEY_MESSAGE = 'A valid zone key is required';

/** The zone the request's key reads, set by the key middleware. */
function keyZone(res: Parameters<RequestHandler>[1]): KeyZone {
  return res.locals['keyZone'] as KeyZone;
}

// The key from `Authorization: Bearer <key>`; undefined for any other header.
function bearerKey(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1];
}

/**
 * Accepts only a zone key, never a session cookie (AD-2). A missing, unknown
 * or revoked key answers 401 `invalid_zone_key`.
 */
function requireZoneKey(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    try {
      const zone = await zoneForKey(pool, bearerKey(req.headers.authorization));
      if (!zone) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.status(401).json(errorBody(ErrorCodes.invalidZoneKey, INVALID_KEY_MESSAGE));
        return;
      }
      res.locals['keyZone'] = zone;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * The Delivery API (AD-2), mounted at `/delivery/v1`: serves SDKs on any
 * origin, without credentials, and reads only the zone of the caller's key.
 */
export function deliveryRouter(pool: Pool): Router {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.removeHeader('Access-Control-Allow-Credentials');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  router.use(requireZoneKey(pool));

  router.get('/zone', async (_req, res, next) => {
    try {
      const { zoneId } = keyZone(res);
      const zone = await findZone(pool, zoneId);
      if (!zone) {
        // A key always references an existing zone; treat a vanished one like a bad key.
        res.status(401).json(errorBody(ErrorCodes.invalidZoneKey, INVALID_KEY_MESSAGE));
        return;
      }
      const frames = await listFrames(pool, zoneId);
      const body: DeliveryZone = {
        id: zone.id,
        name: zone.name,
        frames: frames.map(({ id, type, settings }) => ({ id, type, settings })),
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
