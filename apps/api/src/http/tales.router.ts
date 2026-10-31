import { randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  maxMediaBytes,
  MAX_VIDEO_BYTES,
  type DuplicateTaleRequest,
  type SetScheduleRequest,
  type SetStatusRequest,
} from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import {
  copyTaleWithDocument,
  deleteTale,
  discardTaleDraft,
  duplicateTale,
  getTale,
  getTaleDocument,
  getTaleMedia,
  publishTaleDocument,
  saveTaleDocument,
  setTaleMedia,
  setTaleSchedule,
  setTaleStatus,
  taleExists,
  TaleNotFoundError,
  withMediaKeyDeletionGuard,
} from '@taleart/server-tales';
import express, { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';
import { declaredMediaType, matchesMagicNumber, mediaExtension, sendMediaBytes } from './media';
import { requiredSchedule, requiredSettableStatus } from './validation';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

/** The largest document revision: the stored column is a PostgreSQL integer. */
const MAX_REVISION = 2147483647;

// A revision a request is based on: an integer from 0 to the stored column's largest.
function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_REVISION;
}

/** A tale's media and status: mounted at `/tales`. */
// Whether the editor loaded the tale's own media as an element (R16): a boolean, or absent (false).
function sawTaleMedia(body: Record<string, unknown>): boolean {
  const value = body['sawTaleMedia'];
  if (value !== undefined && typeof value !== 'boolean') {
    throw new HttpError(400, ErrorCodes.validationFailed, 'sawTaleMedia must be true or false');
  }
  return value === true;
}

export function talesRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();

  // The body is read into memory up to the largest accepted size (videos); the
  // per-kind limit is checked after. Too large a body answers 413 media_too_large.
  const rawBody = express.raw({ type: () => true, limit: MAX_VIDEO_BYTES });
  const taleAccess = authorizeParam(pool, 'tale', 'taleId');
  // Making a tale live, scheduling it or publishing its draft is the publisher's.
  const talePublish = authorizeParam(pool, 'tale', 'taleId', 'content.publish');

  // One tale with its visibility in any zone (R7), as Tale Studio's status line reads it (story 8.4).
  router.get('/:taleId', taleAccess, async (req, res, next) => {
    try {
      res.json(await getTale(pool, req.params.taleId));
    } catch (err) {
      next(err);
    }
  });

  // Deletes the tale (story 8.20): the tale with its documents and its media and font references, in
  // one transaction; then each file it referenced, only when nothing references it any more (AD-11,
  // AD-14): a copy, another tale, a cover or the project's media keeps it.
  router.delete('/:taleId', taleAccess, async (req, res, next) => {
    try {
      const deleted = await deleteTale(pool, req.params.taleId);
      for (const key of deleted.mediaKeys) {
        // Decided and deleted under the key's lock, so no document write can start using it meanwhile.
        await withMediaKeyDeletionGuard(pool, key, async (inUse) => {
          if (!inUse) await storage.delete(key);
        }).catch((err) => logError('could not delete the media of a deleted tale', err));
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

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
          // Decided and deleted under the key's lock, so no document write can start using it meanwhile.
          await withMediaKeyDeletionGuard(pool, previousKey, async (inUse) => {
            if (!inUse) await storage.delete(previousKey);
          }).catch((cleanupErr) => logError('could not delete replaced media', cleanupErr));
        }
        res.json(result.tale);
      } catch (err) {
        next(err);
      }
    },
  );

  router.put('/:taleId/status', talePublish, async (req, res, next) => {
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

  router.put('/:taleId/schedule', talePublish, async (req, res, next) => {
    try {
      // Tale first (404), then the body (400).
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const input: SetScheduleRequest = requiredSchedule(req.body);
      res.json(await setTaleSchedule(pool, taleId, input));
    } catch (err) {
      next(err);
    }
  });

  // The tale's document (AD-15). Its body is parsed in app.ts with a larger limit than other
  // routes'; the document's own size is checked when it is saved.
  router.get('/:taleId/document', taleAccess, async (req, res, next) => {
    try {
      res.json(await getTaleDocument(pool, req.params['taleId']));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:taleId/document', taleAccess, async (req, res, next) => {
    try {
      // Tale first (404), then the body (400), then the revision (409).
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const body = req.body as Record<string, unknown> | undefined;
      const revision = body?.['revision'];
      // The stored revision is a PostgreSQL integer.
      if (!isRevision(revision)) {
        throw new HttpError(
          400,
          ErrorCodes.validationFailed,
          'revision must be the revision the document was based on',
        );
      }
      if (typeof body !== 'object' || body === null || !('document' in body)) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'document is required');
      }
      res.json(await saveTaleDocument(pool, taleId, body['document'], revision, { sawTaleMedia: sawTaleMedia(body) }));
    } catch (err) {
      next(err);
    }
  });

  // Publishes the draft (what the studio saves) as the document visitors see, or discards the draft
  // back to the published one: each compare-and-set on both revisions (user decision 2026-10-22).
  for (const [action, apply] of [
    ['publish', publishTaleDocument],
    ['discard', discardTaleDraft],
  ] as const) {
    router.post(`/:taleId/document/${action}`, action === 'publish' ? talePublish : taleAccess, async (req, res, next) => {
      try {
        // Tale first (404), then the body (400), then the revisions (409).
        const { taleId } = req.params;
        if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
        const body = req.body as Record<string, unknown> | undefined;
        if (!isRevision(body?.['revision']) || !isRevision(body?.['publishedRevision'])) {
          throw new HttpError(
            400,
            ErrorCodes.validationFailed,
            'revision and publishedRevision must be the draft and published revisions the request is based on',
          );
        }
        res.json(await apply(pool, taleId, body['revision'], body['publishedRevision']));
      } catch (err) {
        next(err);
      }
    });
  }

  // Keeps the editor's version of the document as a new draft tale in the tale's group, after a
  // stale save (epic Tale Studio R9). Its body is parsed in app.ts, as the document route's is.
  router.post('/:taleId/document/copy', taleAccess, async (req, res, next) => {
    try {
      // Tale first (404), then the body (400), then the group's room (409).
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const body = req.body as Record<string, unknown> | undefined;
      if (typeof body !== 'object' || body === null || !('document' in body)) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'document is required');
      }
      res
        .status(201)
        .json(await copyTaleWithDocument(pool, taleId, body['document'], { sawTaleMedia: sawTaleMedia(body) }));
    } catch (err) {
      next(err);
    }
  });

  // Duplicates the tale with its documents into a group of its project, Hidden (epic Tale Studio
  // R11). The target group must be of the tale's project, which the caller was authorized for.
  router.post('/:taleId/duplicate', taleAccess, async (req, res, next) => {
    try {
      // Tale first (404), then the body (400), then the group (400) and its room (409).
      const { taleId } = req.params;
      if (!(await taleExists(pool, taleId))) throw new TaleNotFoundError(taleId);
      const body = req.body as Record<string, unknown> | undefined;
      const taleGroupId: unknown = body?.['taleGroupId'];
      let input: DuplicateTaleRequest = {};
      if (typeof taleGroupId === 'string') input = { taleGroupId };
      else if (taleGroupId !== undefined) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'taleGroupId must be a tale group id');
      }
      res.status(201).json(await duplicateTale(pool, taleId, input));
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
