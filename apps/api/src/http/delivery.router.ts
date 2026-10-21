import { ErrorCodes, mediaKind, publicMediaUrl, type DeliveryZone } from '@taleart/contract';
import { zoneForKey, type KeyZone } from '@taleart/server-access';
import { listDeliveryTaleGroups } from '@taleart/server-tales';
import { findZone, getProjectTheme, listDeliveryStages, listFrames, type FrameTypeRegistry } from '@taleart/server-zones';
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

/** How the Delivery API builds its responses. */
export interface DeliveryOptions {
  /** The API's public origin (PUBLIC_API_URL), which media URLs start with. */
  publicApiUrl: string;
  /** The frame types, whose schema defaults fill each frame's missing settings (AD-5). */
  frameTypes: FrameTypeRegistry;
}

/**
 * The Delivery API (AD-2), mounted at `/delivery/v1`: serves SDKs on any
 * origin, without credentials, and reads only the zone of the caller's key.
 */
export function deliveryRouter(pool: Pool, options: DeliveryOptions): Router {
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
      const [frames, stages, taleGroups, theme] = await Promise.all([
        listFrames(pool, zoneId),
        listDeliveryStages(pool, zoneId),
        listDeliveryTaleGroups(pool, zoneId),
        getProjectTheme(pool, zone.projectId),
      ]);
      // No project id, user data or storage key leaves here except inside a public media URL (AD-11, AD-13).
      const body: DeliveryZone = {
        id: zone.id,
        name: zone.name,
        // The project's theme (R9), complete: TaleArt's default fills every field it leaves out.
        theme: theme.resolved,
        frames: frames.map(({ id, type, settings }) => ({
          id,
          type,
          settings: options.frameTypes.withDefaults(type, settings),
        })),
        // Key and frame only: a stage's name and id stay in the dashboard (R7).
        stages: stages.map(({ key, frameId }) => ({ key, frameId })),
        taleGroups: taleGroups.map((group) => ({
          id: group.id,
          name: group.name,
          cover: group.cover && {
            kind: mediaKind(group.cover.contentType),
            contentType: group.cover.contentType,
            animated: group.cover.animated,
            url: publicMediaUrl(options.publicApiUrl, group.cover.key),
          },
          tales: group.tales.map((tale) => ({
            id: tale.id,
            title: tale.title,
            media: tale.media && {
              kind: mediaKind(tale.media.contentType),
              contentType: tale.media.contentType,
              url: publicMediaUrl(options.publicApiUrl, tale.media.key),
            },
            // Without hidden elements and editor-only fields (AD-15); null shows the media only.
            document: tale.document,
          })),
        })),
      };
      // Browsers keep the zone and revalidate it on every load (NFR-006): Express's ETag answers 304
      // while nothing changed, so a pause or unpublish still shows at once. `private` keeps keyed
      // responses out of shared caches, and they vary by key.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Vary', 'Authorization');
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
