import {
  DEFAULT_TAG_MATCH,
  ErrorCodes,
  isZoneSlug,
  mediaKind,
  publicMediaUrl,
  resolveDocumentMedia,
  type DeliveryTaleDocument,
  type DeliveryZone,
} from '@taleart/contract';
import { projectForSiteKey } from '@taleart/server-access';
import { listDeliveryTaleGroups } from '@taleart/server-tales';
import { tagRulesForTaleGroups } from '@taleart/server-targeting';
import { findZone, getProjectTheme, zoneIdBySlug, type FrameTypeRegistry } from '@taleart/server-zones';
import { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { errorBody } from './errors';
import { DEFAULT_DELIVERY_RATE_LIMIT, rateLimit, VISITOR_HEADER, type RateLimitOptions } from './rate-limit';

// One message for every refusal (epic UX rework R3): a missing, unknown or revoked site key and a
// missing or unknown slug answer alike, so a caller cannot tell a slug from a key.
const INVALID_SITE_KEY_MESSAGE = 'A valid site key and zone are required';

/** The zone the request reads, set by the key middleware. */
function requestZoneId(res: Response): string {
  return res.locals['requestZoneId'] as string;
}

// The key from `Authorization: Bearer <key>`; undefined for any other header.
function bearerKey(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1];
}

// The `zone` query parameter: the slug. A missing, repeated or non-text value, or text no slug can
// be (a NUL byte, which PostgreSQL refuses with an error, or a megabyte of text), reads as the
// empty slug, which no zone has: still looked up, so it is refused like any other.
function slugParam(value: unknown): string {
  return isZoneSlug(value) ? value : '';
}

/** Answers the 401 of a refused request; every refusal has the same body. */
function refuse(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Bearer');
  // A refusal is never kept by a browser or a shared cache.
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json(errorBody(ErrorCodes.invalidSiteKey, INVALID_SITE_KEY_MESSAGE));
}

/**
 * Accepts only the project's site key with `?zone=<slug>`, never a session cookie (AD-2, epic UX
 * rework R3). The key and the slug are looked up every time, whichever fails, so a refusal (a
 * missing, unknown or revoked key, a missing or unknown slug) costs the same two queries and answers
 * the same 401 `invalid_site_key`: no slug can be told from a refused key.
 */
function requireDeliveryKey(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    try {
      const key = bearerKey(req.headers.authorization);
      const slug = slugParam(req.query['zone']);
      const projectId = await projectForSiteKey(pool, key);
      const zoneId = await zoneIdBySlug(pool, projectId, slug);
      if (projectId === null || zoneId === null) {
        refuse(res);
        return;
      }
      res.locals['requestZoneId'] = zoneId;
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
  /**
   * The per-visitor limit of the Delivery API, also the per-address limit of requests without a
   * visitor id, with a per-address backstop above it ({@link rateLimit});
   * {@link DEFAULT_DELIVERY_RATE_LIMIT} when left out, and null turns it off.
   */
  rateLimit?: RateLimitOptions | null;
}

/**
 * The Delivery API (AD-2), mounted at `/delivery/v1`: serves SDKs on any
 * origin, without credentials, and reads only the zone the caller names: a zone of the site key's
 * project by its slug.
 */
export function deliveryRouter(pool: Pool, options: DeliveryOptions): Router {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // The SDKs send the device's visitor id (epic UX rework 8.23), so a preflight must allow it.
    res.setHeader('Access-Control-Allow-Headers', `Authorization, Content-Type, ${VISITOR_HEADER}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    // A client script may read when to try again after a 429.
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    res.removeHeader('Access-Control-Allow-Credentials');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  const limit = options.rateLimit === undefined ? DEFAULT_DELIVERY_RATE_LIMIT : options.rateLimit;
  // Before the key lookups, so a flood of guesses costs no queries.
  if (limit) router.use(rateLimit(limit));
  router.use(requireDeliveryKey(pool));

  router.get('/zone', async (_req, res, next) => {
    try {
      const zoneId = requestZoneId(res);
      const zone = await findZone(pool, zoneId);
      if (!zone) {
        // The slug named an existing zone; treat one that vanished since like a bad key.
        refuse(res);
        return;
      }
      // A zone without a display delivers no tale group (epic UX rework R7): its setup is part of
      // the Delivery filter (`deliveredPlacement`), the rule the Management API's indicator reads.
      const [taleGroups, theme] = await Promise.all([
        listDeliveryTaleGroups(pool, zoneId),
        getProjectTheme(pool, zone.projectId),
      ]);
      // Each group's tag rule, the same for every viewer: the SDK matches the viewer's tags (AD-13).
      const tagRules = await tagRulesForTaleGroups(
        pool,
        taleGroups.map((group) => group.id),
      );
      // No project id, user data or storage key leaves here except inside a public media URL (AD-11, AD-13).
      const body: DeliveryZone = {
        id: zone.id,
        name: zone.name,
        slug: zone.slug,
        // The project's theme (R9), complete: TaleArt's default fills every field it leaves out.
        theme: theme.resolved,
        // The zone's one display (AD-17), every setting filled with its default.
        frame: zone.frame && {
          id: zone.frame.id,
          type: zone.frame.type,
          settings: options.frameTypes.withDefaults(zone.frame.type, zone.frame.settings),
        },
        taleGroups: taleGroups.map((group) => ({
          id: group.id,
          name: group.name,
          tags: tagRules.get(group.id)?.tags ?? [],
          tagMatch: tagRules.get(group.id)?.tagMatch ?? DEFAULT_TAG_MATCH,
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
            // Without hidden elements and editor-only fields (AD-15); every tale has one, its media
            // composed in while it is out of step (R16). Its media keys become public URLs; a key the
            // public route would not serve is left out (AD-11). `media` above stays for older SDKs.
            document:
              tale.document &&
              (resolveDocumentMedia(tale.document, (key) =>
                tale.mediaKeys.has(key) ? publicMediaUrl(options.publicApiUrl, key) : null,
              ) as DeliveryTaleDocument),
            // The project fonts its text uses (R18), as public URLs the SDK fetches when the tale opens.
            ...(tale.fonts.length > 0 && {
              fonts: tale.fonts.map((font) => ({
                id: font.id,
                // Native SDKs draw the text in a host font of this family name (story 9.8).
                family: font.family,
                url: publicMediaUrl(options.publicApiUrl, font.key),
                weight: font.weight,
                style: font.style,
              })),
            }),
          })),
        })),
      };
      // Browsers keep the zone and revalidate it on every load (NFR-006): Express's ETag answers 304
      // while nothing changed, so a pause or unpublish still shows at once. `private` keeps keyed
      // responses out of shared caches, and they vary by key (and by slug, which is in the URL).
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('Vary', 'Authorization');
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
