import { ErrorCodes } from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import { findPublishedFont, findPublishedMedia } from '@taleart/server-tales';
import { Router } from 'express';
import type { Pool } from 'pg';
import { HttpError } from './errors';
import { sendMediaBytes } from './media';

// Server-made keys are short (`tales/<uuid>.<ext>`); anything far longer is not one.
const MAX_KEY_LENGTH = 200;
// Where project font files are stored (`fonts/<uuid>.woff2`).
const FONT_KEY_PREFIX = 'fonts/';

/**
 * Public media (AD-11), mounted at `/media`: `GET /media/<key>` serves the file
 * a published tale (a live tale of a live group, AD-6) currently references,
 * the cover of a delivered tale group (epic web zones R12), an image or video a
 * delivered tale's published document shows (epic Tale Studio R5), or a project font
 * a delivered tale's published document uses (epic Tale Studio R18), with no session
 * and no site key, so an `<img>` or `<video>` on any origin loads it. Any other key, including the key of replaced media or of draft,
 * paused or archived content, answers 404 `media_not_found`.
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
      const valid = key.length > 0 && key.length <= MAX_KEY_LENGTH;
      // A project font (R18) is public only while a delivered tale's published document uses it.
      const isFont = key.startsWith(FONT_KEY_PREFIX);
      const media = !valid ? null : isFont ? await findPublishedFont(pool, key) : await findPublishedMedia(pool, key);
      if (!media) throw new HttpError(404, ErrorCodes.mediaNotFound, 'No published media at this URL');
      // A font loads with CORS from any page that shows the tale (FontFace from fetched bytes).
      if (isFont) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // A URL's bytes never change (replaced media gets a new key), but it stops
      // being public when its content is unpublished, so clients revalidate on
      // every use: 304 while published, 404 at once after (AD-11).
      res.setHeader('Cache-Control', 'public, no-cache');
      // The key never changes its bytes, so it is the ETag; Express then does not hash the body.
      res.setHeader('ETag', `"${media.key}"`);
      // A current copy needs no read of the file.
      if (req.headers['if-none-match'] === `"${media.key}"`) {
        res.status(304).end();
        return;
      }
      const data = await storage.get(media.key);
      if (!data) {
        res.removeHeader('ETag');
        res.removeHeader('Cache-Control');
        throw new HttpError(404, ErrorCodes.mediaNotFound, 'No published media at this URL');
      }
      res.setHeader('Content-Type', media.contentType);
      sendMediaBytes(req, res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
