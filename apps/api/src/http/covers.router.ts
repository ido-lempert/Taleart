import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  MAX_ANIMATED_COVER_BYTES,
  MAX_IMAGE_BYTES,
  maxCoverBytes,
  mediaKind,
  type TaleGroup,
} from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import {
  getTaleGroupCover,
  isMediaKeyInUse,
  setTaleGroupCover,
  taleGroupExists,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import express, { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';
import {
  declaredMediaType,
  etagMatches,
  isAnimatedMedia,
  matchesMagicNumber,
  mediaExtension,
  sendMediaBytes,
} from './media';
import { withTags } from './tale-groups.router';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

// Deletes a replaced or removed cover's file unless a tale or another cover,
// such as a copy's, still references it (AD-11, AD-14). Failures are logged.
async function deleteIfUnused(pool: Pool, storage: MediaStorage, key: string | null, keep?: string): Promise<void> {
  if (key === null || key === keep) return;
  await isMediaKeyInUse(pool, key)
    .then((inUse) => (inUse ? undefined : storage.delete(key)))
    .catch((err) => logError('could not delete replaced cover', err));
}

const ANIMATED_TOO_LARGE = `An animated cover is at most ${MAX_ANIMATED_COVER_BYTES / 1024} KB`;
const IMAGE_TOO_LARGE = `The file is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`;

/**
 * A tale group's cover, still or animated (epic web zones R12): mounted at
 * `/tale-groups`. The dashboard makes the file in the browser; the server
 * checks its type, decides from its bytes whether it moves, and stores it
 * through the storage port without transcoding it (AD-11).
 */
export function coversRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();
  const groupAccess = authorizeParam(pool, 'taleGroup', 'taleGroupId');
  // Every video cover is animated, so its body is capped at the animated limit
  // while it is read; an image at the image limit, and an animated image is
  // checked against the animated limit once its bytes are known.
  const rawVideo = express.raw({ type: () => true, limit: MAX_ANIMATED_COVER_BYTES });
  const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });
  const readBody: RequestHandler = (req, res, next) => {
    const declared = declaredMediaType(req.headers['content-type']);
    const isVideo = declared !== null && mediaKind(declared) === 'video';
    (isVideo ? rawVideo : rawImage)(req, res, (err?: unknown) => {
      if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
        next(new HttpError(413, ErrorCodes.mediaTooLarge, isVideo ? ANIMATED_TOO_LARGE : IMAGE_TOO_LARGE));
      } else {
        next(err);
      }
    });
  };

  router.get('/:taleGroupId/cover', groupAccess, async (req, res, next) => {
    try {
      const cover = await getTaleGroupCover(pool, req.params.taleGroupId);
      if (!cover) throw new HttpError(404, ErrorCodes.mediaNotFound, 'This tale group has no cover');
      // A current copy needs no read of the file.
      if (etagMatches(req.headers['if-none-match'], `"${cover.key}"`)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('ETag', `"${cover.key}"`);
        res.status(304).end();
        return;
      }
      const data = await storage.get(cover.key);
      if (!data) throw new HttpError(404, ErrorCodes.mediaNotFound, 'This tale group has no cover');
      res.setHeader('Content-Type', cover.contentType);
      // Replacing the cover keeps the URL, so clients revalidate; the ETag is the key.
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('ETag', `"${cover.key}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      sendMediaBytes(req, res, data);
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/:taleGroupId/cover',
    groupAccess,
    async (req, _res, next) => {
      try {
        // Tale group first (404), then the declared type (415) before reading the body.
        if (!(await taleGroupExists(pool, req.params['taleGroupId']))) {
          throw new TaleGroupNotFoundError(req.params['taleGroupId']);
        }
        const declared = declaredMediaType(req.headers['content-type']);
        if (declared === null) {
          throw new HttpError(
            415,
            ErrorCodes.unsupportedMediaType,
            'Upload a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video',
          );
        }
        // A declared length over the limit is refused before any byte is buffered.
        const length = Number(req.headers['content-length']);
        const isVideo = mediaKind(declared) === 'video';
        if (Number.isFinite(length) && length > (isVideo ? MAX_ANIMATED_COVER_BYTES : MAX_IMAGE_BYTES)) {
          req.resume();
          throw new HttpError(413, ErrorCodes.mediaTooLarge, isVideo ? ANIMATED_TOO_LARGE : IMAGE_TOO_LARGE);
        }
        next();
      } catch (err) {
        next(err);
      }
    },
    readBody,
    async (req, res, next) => {
      try {
        const { taleGroupId } = req.params;
        const contentType = declaredMediaType(req.headers['content-type']);
        const data: unknown = req.body;
        if (contentType === null) throw new HttpError(415, ErrorCodes.unsupportedMediaType, 'Unsupported media type');
        if (!Buffer.isBuffer(data) || data.length === 0) {
          throw new HttpError(400, ErrorCodes.validationFailed, 'The file is empty');
        }
        if (!matchesMagicNumber(contentType, data)) {
          throw new HttpError(415, ErrorCodes.unsupportedMediaType, `The file is not a valid ${contentType} file`);
        }
        const animated = isAnimatedMedia(contentType, data);
        if (data.length > maxCoverBytes(contentType, animated)) {
          throw new HttpError(413, ErrorCodes.mediaTooLarge, animated ? ANIMATED_TOO_LARGE : IMAGE_TOO_LARGE);
        }

        // Store the new file, point the group at it, then delete the old file
        // unless something else still references it.
        const key = `covers/${randomUUID()}.${mediaExtension(contentType)}`;
        await storage.put(key, data);
        let result: Awaited<ReturnType<typeof setTaleGroupCover>>;
        try {
          result = await setTaleGroupCover(pool, taleGroupId, { key, contentType, animated });
        } catch (err) {
          await storage.delete(key).catch((cleanupErr) => logError('could not delete unused cover', cleanupErr));
          throw err;
        }
        await deleteIfUnused(pool, storage, result.previousKey, key);
        const [body] = await withTags(pool, [result.group]);
        res.json(body satisfies TaleGroup);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:taleGroupId/cover', groupAccess, async (req, res, next) => {
    try {
      const { group, previousKey } = await setTaleGroupCover(pool, req.params.taleGroupId, null);
      await deleteIfUnused(pool, storage, previousKey);
      const [body] = await withTags(pool, [group]);
      res.json(body satisfies TaleGroup);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
