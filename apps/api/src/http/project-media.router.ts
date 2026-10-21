import { createHash, randomUUID } from 'node:crypto';
import { ErrorCodes, MAX_VIDEO_BYTES, maxMediaBytes, USER_ROLES, type ProjectMedia } from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import { createProjectMedia, listProjectMedia, projectMediaFile } from '@taleart/server-tales';
import express, { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller } from './authorize';
import { HttpError } from './errors';
import { declaredMediaType, etagMatches, matchesMagicNumber, mediaExtension, sendMediaBytes } from './media';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

// The roles that upload media (R5): admins and content managers.
const UPLOAD_ROLES: readonly string[] = USER_ROLES.filter((role) => role === 'admin' || role === 'content_manager');

const UNSUPPORTED = 'Upload a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video';

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

// A refusal sent before the body is read: the connection closes after it, so the server does not
// read (or wait for) a large body nobody wants.
function closing(res: Response, error: HttpError): HttpError {
  res.setHeader('Connection', 'close');
  return error;
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, ErrorCodes.mediaTooLarge, `The file is larger than ${limit / (1024 * 1024)} MB`);
}

/** An opaque ETag for a media file: it names the file without telling its storage key. */
function mediaEtag(key: string): string {
  return `"${createHash('sha256').update(key).digest('base64url').slice(0, 22)}"`;
}

/**
 * A project's media (epic Tale Studio R5), mounted at `/projects`: the list Tale Studio picks
 * images and videos from, uploads to it, and a file with a session. Uploads are the tale media
 * types, judged by their bytes against the declared type, images at most 10 MB and videos 100 MB,
 * stored through the storage port without transcoding (AD-11).
 */
export function projectMediaRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');
  // No inflating: a compressed body could be far larger than what was sent. Capped at the largest
  // accepted size, a video; an image's own limit is checked once the body is read.
  const raw = express.raw({ type: () => true, limit: MAX_VIDEO_BYTES, inflate: false });
  const readBody: RequestHandler = (req, res, next) =>
    raw(req, res, (err?: unknown) => {
      switch ((err as { type?: string } | undefined)?.type) {
        case undefined:
          next(err);
          return;
        case 'entity.too.large':
          next(closing(res, tooLarge(MAX_VIDEO_BYTES)));
          return;
        case 'encoding.unsupported':
          next(closing(res, new HttpError(415, ErrorCodes.unsupportedMediaType, 'Send the file uncompressed')));
          return;
        case 'request.aborted':
        case 'request.size.invalid':
        case 'stream.encoding.set':
          next(closing(res, new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole')));
          return;
        default:
          next(err);
      }
    });

  router.get('/:projectId/media', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json((await listProjectMedia(pool, req.params.projectId)) satisfies ProjectMedia[]);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:projectId/media',
    projectAccess,
    async (req, res, next) => {
      try {
        // Role (403), project (404), declared type (415) and a declared length over the type's
        // limit (413), before any byte is read.
        if (!UPLOAD_ROLES.includes(caller(res).role)) {
          throw closing(res, new HttpError(403, ErrorCodes.forbidden, 'Only admins and content managers upload media'));
        }
        await requireProject(pool, req.params['projectId']);
        const declared = declaredMediaType(req.headers['content-type']);
        if (declared === null) throw closing(res, new HttpError(415, ErrorCodes.unsupportedMediaType, UNSUPPORTED));
        const length = Number(req.headers['content-length']);
        if (Number.isFinite(length) && length > maxMediaBytes(declared)) {
          throw closing(res, tooLarge(maxMediaBytes(declared)));
        }
        next();
      } catch (err) {
        if (err instanceof HttpError && res.getHeader('Connection') === 'close') req.resume();
        next(err);
      }
    },
    readBody,
    async (req, res, next) => {
      try {
        const { projectId } = req.params;
        const contentType = declaredMediaType(req.headers['content-type']);
        if (contentType === null) throw new HttpError(415, ErrorCodes.unsupportedMediaType, UNSUPPORTED);
        const data: unknown = req.body;
        if (!Buffer.isBuffer(data) || data.length === 0) {
          throw new HttpError(400, ErrorCodes.validationFailed, 'The file is empty');
        }
        if (data.length > maxMediaBytes(contentType)) throw tooLarge(maxMediaBytes(contentType));
        if (!matchesMagicNumber(contentType, data)) {
          throw new HttpError(415, ErrorCodes.unsupportedMediaType, `The file is not a valid ${contentType} file`);
        }
        // The key's extension is the checked type's: documents read the type from it.
        const key = `media/${randomUUID()}.${mediaExtension(contentType)}`;
        const media = await createProjectMedia(
          pool,
          { projectId, storageKey: key, contentType, sizeBytes: data.length, uploaderId: caller(res).id },
          {
            put: () => storage.put(key, data),
            remove: () => storage.delete(key).catch((err) => logError('could not delete unused media', err)),
          },
        );
        res.status(201).json(media satisfies ProjectMedia);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/:projectId/media/file', projectAccess, async (req, res, next) => {
    try {
      const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
      const media = await projectMediaFile(pool, req.params.projectId, key);
      if (!media) throw new HttpError(404, ErrorCodes.mediaNotFound, 'No media of this project has this key');
      const etag = mediaEtag(media.key);
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('ETag', etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.status(304).end();
        return;
      }
      const data = await storage.get(media.key);
      if (!data) {
        res.removeHeader('ETag');
        res.removeHeader('Cache-Control');
        throw new HttpError(404, ErrorCodes.mediaNotFound, 'No media of this project has this key');
      }
      res.setHeader('Content-Type', media.contentType);
      // One byte range is answered, so a video plays and seeks (Safari and iOS need it).
      sendMediaBytes(req, res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
