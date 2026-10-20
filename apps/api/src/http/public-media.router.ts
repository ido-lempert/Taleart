import { ErrorCodes } from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import { findPublishedMedia } from '@taleart/server-tales';
import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpError } from './errors';
import { sendMediaBytes } from './media';

// Server-made keys are short (`tales/<uuid>.<ext>`); anything far longer is not one.
const MAX_KEY_LENGTH = 200;

/**
 * Public media (AD-11), mounted at `/media`: `GET /media/<key>` serves the file
 * a published tale currently references, with no session and no zone key, so
 * an `<img>` or `<video>` on any origin loads it. Any other key, including the
 * key of replaced media, answers 404 `media_not_found`.
 */
export function publicMediaRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();

  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // A pattern without parameters, so Express does not decode the path itself: a
  // malformed escape would throw there and answer 500. It is decoded here instead.
  router.get(/^\/.*$/, async (req, res, next) => {
    try {
      let key = '';
      try {
        key = decodeURIComponent(req.path.slice(1));
      } catch {
        // An undecodable key names no media.
      }
      const media = key.length > 0 && key.length <= MAX_KEY_LENGTH ? await findPublishedMedia(pool, key) : null;
      const data = media && (await storage.get(media.key));
      if (!media || !data) throw new HttpError(404, ErrorCodes.mediaNotFound, 'No published media at this URL');
      res.setHeader('Content-Type', media.contentType);
      // Replaced media gets a new key, so a URL's bytes never change.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // The key never changes its bytes, so it is the ETag; Express then does not hash the body.
      res.setHeader('ETag', `"${media.key}"`);
      sendMediaBytes(req, res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
