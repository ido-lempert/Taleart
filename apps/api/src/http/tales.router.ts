import { randomUUID } from 'node:crypto';
import { ErrorCodes, maxMediaBytes, MAX_VIDEO_BYTES, type SetStatusRequest } from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import {
  getTaleMedia,
  isMediaKeyInUse,
  setTaleMedia,
  setTaleStatus,
  taleExists,
  TaleNotFoundError,
} from '@taleart/server-tales';
import express, { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';
import { declaredMediaType, matchesMagicNumber, mediaExtension, sendMediaBytes } from './media';
import { requiredSettableStatus } from './validation';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

/** A tale's media and status: mounted at `/tales`. */
export function talesRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();

  // The body is read into memory up to the largest accepted size (videos); the
  // per-kind limit is checked after. Too large a body answers 413 media_too_large.
  const rawBody = express.raw({ type: () => true, limit: MAX_VIDEO_BYTES });
  const taleAccess = authorizeParam(pool, 'tale', 'taleId');

  router.put(
    '/:taleId/media',
    taleAccess,
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

        // Store the new file, point the tale at it, then delete the old file
        // unless another tale, such as a copy, still references it (AD-11, AD-14).
        const key = `tales/${randomUUID()}.${mediaExtension(contentType)}`;
        await storage.put(key, data);
        let result: Awaited<ReturnType<typeof setTaleMedia>>;
        try {
          result = await setTaleMedia(pool, taleId, { key, contentType });
        } catch (err) {
          await storage.delete(key).catch((cleanupErr) => logError('could not delete unused media', cleanupErr));
          throw err;
        }
        const { previousKey } = result;
        if (previousKey !== null && previousKey !== key) {
          await isMediaKeyInUse(pool, previousKey)
            .then((inUse) => (inUse ? undefined : storage.delete(previousKey)))
            .catch((cleanupErr) => logError('could not delete replaced media', cleanupErr));
        }
        res.json(result.tale);
      } catch (err) {
        next(err);
      }
    },
  );

  router.put('/:taleId/status', taleAccess, async (req, res, next) => {
    try {
      // Tale first (404), then the body (400), then the transition (409).
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const input: SetStatusRequest = { status: requiredSettableStatus(req.body) };
      res.json(await setTaleStatus(pool, taleId, input.status));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:taleId/media', taleAccess, async (req, res, next) => {
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
      sendMediaBytes(req, res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
