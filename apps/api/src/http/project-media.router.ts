import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ErrorCodes, MEDIA_MAGIC_BYTES, maxMediaBytes, USER_ROLES, type ProjectMedia } from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import {
  checkProjectMediaRoom,
  createProjectMedia,
  DEFAULT_PROJECT_MEDIA_LIMITS,
  listProjectMedia,
  projectMediaFile,
  type ProjectMediaLimits,
} from '@taleart/server-tales';
import { Router, type Response } from 'express';
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

/** How a project's media uploads are bounded. */
export interface ProjectMediaOptions {
  /** The caps of one project's media (PROJECT_MEDIA_MAX_FILES, PROJECT_MEDIA_MAX_BYTES). */
  limits?: ProjectMediaLimits;
  /** The most uploads this process streams at once; more answer 429 `upload_busy`. */
  maxConcurrentUploads?: number;
}

/** The uploads one process streams at once by default. */
export const MAX_CONCURRENT_MEDIA_UPLOADS = 4;

// Thrown while the body streams: the stream stops, nothing is stored, and the request is answered.
class UploadRefused extends Error {
  constructor(readonly error: HttpError) {
    super(error.message);
  }
}

/**
 * The request body as chunks for the storage port: the first bytes are checked against the
 * declared type before anything is passed on (415), and a body longer or shorter than its declared
 * length stops the stream (400). Nothing is buffered beyond the first bytes.
 */
async function* checkedBody(
  req: IncomingMessage,
  contentType: Parameters<typeof matchesMagicNumber>[0],
  length: number,
): AsyncGenerator<Uint8Array> {
  let head: Buffer | null = Buffer.alloc(0);
  let received = 0;
  const notWhole = () =>
    new UploadRefused(new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
  const sniff = (bytes: Buffer) => {
    if (!matchesMagicNumber(contentType, bytes)) {
      throw new UploadRefused(
        new HttpError(415, ErrorCodes.unsupportedMediaType, `The file is not a valid ${contentType} file`),
      );
    }
  };
  for await (const chunk of req as AsyncIterable<Buffer>) {
    received += chunk.length;
    if (received > length) throw notWhole();
    if (head === null) {
      yield chunk;
      continue;
    }
    head = Buffer.concat([head, chunk]);
    if (head.length < MEDIA_MAGIC_BYTES) continue;
    sniff(head);
    const first = head;
    head = null;
    yield first;
  }
  if (received !== length) throw notWhole();
  if (head !== null) {
    sniff(head);
    yield head;
  }
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
export function projectMediaRouter(pool: Pool, storage: MediaStorage, options: ProjectMediaOptions = {}): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');
  const limits = options.limits ?? DEFAULT_PROJECT_MEDIA_LIMITS;
  const maxUploads = options.maxConcurrentUploads ?? MAX_CONCURRENT_MEDIA_UPLOADS;
  let uploads = 0;

  router.get('/:projectId/media', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json((await listProjectMedia(pool, req.params.projectId)) satisfies ProjectMedia[]);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/media', projectAccess, async (req, res, next) => {
    let counted = false;
    let key: string | null = null;
    try {
      // Everything that needs no byte of the body is checked first, and refused with
      // `Connection: close` so the body is never read: the role (403), uploads in flight (429), the
      // project (404), the declared type (415), compression (415), the declared length (411, 400,
      // 413) and the project's room (409, 413).
      const early = (error: HttpError) => {
        req.resume();
        return closing(res, error);
      };
      if (!UPLOAD_ROLES.includes(caller(res).role)) {
        throw early(new HttpError(403, ErrorCodes.forbidden, 'Only admins and content managers upload media'));
      }
      if (uploads >= maxUploads) {
        res.setHeader('Retry-After', '5');
        throw early(new HttpError(429, ErrorCodes.uploadBusy, 'Too many uploads are in progress. Try again shortly.'));
      }
      uploads++;
      counted = true;
      const { projectId } = req.params;
      await requireProject(pool, projectId).catch((err: HttpError) => {
        throw early(err);
      });
      const contentType = declaredMediaType(req.headers['content-type']);
      if (contentType === null) throw early(new HttpError(415, ErrorCodes.unsupportedMediaType, UNSUPPORTED));
      const encoding = (req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
      if (encoding !== 'identity') {
        throw early(new HttpError(415, ErrorCodes.unsupportedMediaType, 'Send the file uncompressed'));
      }
      const declared = req.headers['content-length'];
      const length = declared !== undefined && /^\d+$/.test(declared) ? Number(declared) : NaN;
      if (!Number.isSafeInteger(length) || req.headers['transfer-encoding']) {
        throw early(new HttpError(411, ErrorCodes.lengthRequired, 'Send the file with its Content-Length'));
      }
      if (length === 0) throw early(new HttpError(400, ErrorCodes.validationFailed, 'The file is empty'));
      if (length > maxMediaBytes(contentType)) throw early(tooLarge(maxMediaBytes(contentType)));
      try {
        await checkProjectMediaRoom(pool, projectId, length, limits);
      } catch (err) {
        req.resume();
        res.setHeader('Connection', 'close');
        throw err;
      }

      // The file streams to storage, checked as it comes, before any transaction opens; the row is
      // then inserted (the caps checked again under the project's lock), and a failure deletes the
      // file. The key's extension is the checked type's: documents read the type from it.
      key = `media/${randomUUID()}.${mediaExtension(contentType)}`;
      try {
        await storage.putStream(key, checkedBody(req, contentType, length));
      } catch (err) {
        key = null;
        if (err instanceof UploadRefused) {
          req.resume();
          throw closing(res, err.error);
        }
        // The client went away mid-file: nothing was stored, and there is nobody to answer.
        if (req.destroyed || (err as { message?: string }).message === 'aborted') {
          throw closing(res, new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
        }
        throw err;
      }
      const media = await createProjectMedia(
        pool,
        { projectId, storageKey: key, contentType, sizeBytes: length, uploaderId: caller(res).id },
        limits,
      );
      key = null;
      res.status(201).json(media satisfies ProjectMedia);
    } catch (err) {
      if (key !== null) {
        const stored = key;
        await storage.delete(stored).catch((cleanupErr) => logError('could not delete unused media', cleanupErr));
      }
      next(err);
    } finally {
      if (counted) uploads--;
    }
  });

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
