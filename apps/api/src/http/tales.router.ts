import { randomUUID } from 'node:crypto';
import { ErrorCodes, maxMediaBytes, MAX_VIDEO_BYTES } from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import { getTaleMedia, setTaleMedia, taleExists, TaleNotFoundError } from '@taleart/server-tales';
import express, { Router } from 'express';
import type { Pool } from 'pg';
import { HttpError } from './errors';
import { declaredMediaType, matchesMagicNumber, mediaExtension } from './media';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

/** A tale's media: mounted at `/tales`. */
export function talesRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();

  // The body is read into memory up to the largest accepted size (videos); the
  // per-kind limit is checked after. Too large a body answers 413 media_too_large.
  const rawBody = express.raw({ type: () => true, limit: MAX_VIDEO_BYTES });

  router.put(
    '/:taleId/media',
    async (req, _res, next) => {
      try {
        // Tale first (404), then the declared type (415) before reading the body.
        if (!(await taleExists(pool, req.params['taleId']))) throw new TaleNotFoundError(req.params['taleId']);
        if (declaredMediaType(req.headers['content-type']) === null) {
          throw new HttpError(
            415,
            ErrorCodes.unsupportedMediaType,
            'Upload a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video',
          );
        }
        next();
      } catch (err) {
        next(err);
      }
    },
    rawBody,
    async (req, res, next) => {
      try {
        const { taleId } = req.params;
        const contentType = declaredMediaType(req.headers['content-type']);
        const data: unknown = req.body;
        if (contentType === null) throw new HttpError(415, ErrorCodes.unsupportedMediaType, 'Unsupported media type');
        if (!Buffer.isBuffer(data) || data.length === 0) {
          throw new HttpError(400, ErrorCodes.validationFailed, 'The file is empty');
        }
        const limit = maxMediaBytes(contentType);
        if (data.length > limit) {
          throw new HttpError(413, ErrorCodes.mediaTooLarge, `The file is larger than ${limit / (1024 * 1024)} MB`);
        }
        if (!matchesMagicNumber(contentType, data)) {
          throw new HttpError(415, ErrorCodes.unsupportedMediaType, `The file is not a valid ${contentType} file`);
        }

        // Store the new file, point the tale at it, then delete the old file (AD-11).
        const key = `tales/${randomUUID()}.${mediaExtension(contentType)}`;
        await storage.put(key, data);
        let result: Awaited<ReturnType<typeof setTaleMedia>>;
        try {
          result = await setTaleMedia(pool, taleId, { key, contentType });
        } catch (err) {
          await storage.delete(key).catch((cleanupErr) => logError('could not delete unused media', cleanupErr));
          throw err;
        }
        if (result.previousKey !== null && result.previousKey !== key) {
          await storage
            .delete(result.previousKey)
            .catch((cleanupErr) => logError('could not delete replaced media', cleanupErr));
        }
        res.json(result.tale);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:taleId/media', async (req, res, next) => {
    try {
      const media = await getTaleMedia(pool, req.params.taleId);
      const data = media && (await storage.get(media.key));
      if (!media || !data) throw new HttpError(404, ErrorCodes.mediaNotFound, 'This tale has no media');
      res.setHeader('Content-Type', media.contentType);
      // Replacing media keeps the URL, so clients revalidate; the ETag is the key.
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', `"${media.key}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.headers['if-none-match'] === `"${media.key}"`) {
        res.status(304).end();
        return;
      }
      // Byte ranges let browsers (Safari and iOS in particular) play and seek videos.
      res.setHeader('Accept-Ranges', 'bytes');
      const ranges = req.headers.range ? req.range(data.length) : undefined;
      if (ranges === -1) {
        res.setHeader('Content-Range', `bytes */${data.length}`);
        res.status(416).end();
        return;
      }
      // One satisfiable bytes range answers 206; none, a malformed one or several answer 200 with the whole file.
      if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
        const { start, end } = ranges[0];
        res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
        res.status(206).send(data.subarray(start, end + 1));
        return;
      }
      res.send(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
