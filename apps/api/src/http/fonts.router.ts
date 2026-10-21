import { createHash, randomUUID } from 'node:crypto';
import {
  ErrorCodes,
  FONT_CONTENT_TYPE,
  FONT_FILE_EXTENSION,
  FONT_LICENCE_CONFIRMED,
  isFontWeight,
  isProjectFontStyle,
  isWoff2,
  MAX_FONT_BYTES,
  normalizeFontFamily,
  projectFontFamilyError,
  SYSTEM_FONT_STACK_KEYS,
  USER_ROLES,
  type ProjectFont,
  type SystemFontStack,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import {
  createProjectFont,
  deleteProjectFont,
  getProjectFontFile,
  listProjectFonts,
  type NewProjectFont,
} from '@taleart/server-tales';
import express, { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller } from './authorize';
import { HttpError } from './errors';
import { etagMatches } from './media';

function logError(msg: string, err: unknown): void {
  console.log(
    JSON.stringify({
      level: 'error',
      msg,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
}

const TOO_LARGE = `A font file is at most ${MAX_FONT_BYTES / 1024} KB`;
const NOT_WOFF2 = 'Upload a WOFF2 font file. Other formats, such as TTF, OTF or WOFF, are not accepted.';

/**
 * The upload's declared types: `font/woff2`, or `application/octet-stream` for a client that does
 * not know it. Neither is a type a form can send without CORS preflight, so another site cannot
 * post a font with the dashboard's cookie. The bytes are judged anyway.
 */
const UPLOAD_TYPES = [FONT_CONTENT_TYPE, 'application/octet-stream'];

// The roles that upload fonts (R18): admins and content managers.
const UPLOAD_ROLES: readonly string[] = USER_ROLES.filter((role) => role === 'admin' || role === 'content_manager');

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

// One query parameter as a string; repeated or nested parameters are not one.
function queryText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * The face an upload's query describes, checked by the contract's rules, the family with its
 * spaces normalised; 400 naming the first bad field.
 */
function faceOf(query: Record<string, unknown>): Pick<NewProjectFont, 'family' | 'weight' | 'style' | 'fallback'> {
  const raw = queryText(query['family']);
  const family = raw === undefined ? undefined : normalizeFontFamily(raw);
  const familyError = projectFontFamilyError(family);
  if (familyError !== null) throw new HttpError(400, ErrorCodes.validationFailed, familyError);
  const weightText = queryText(query['weight']) ?? '';
  const weight = /^\d{3}$/.test(weightText) ? Number(weightText) : NaN;
  if (!isFontWeight(weight)) {
    throw new HttpError(
      400,
      ErrorCodes.validationFailed,
      'weight must be 100, 200, 300, 400, 500, 600, 700, 800 or 900',
    );
  }
  const style = queryText(query['style']);
  if (!isProjectFontStyle(style))
    throw new HttpError(400, ErrorCodes.validationFailed, 'style must be normal or italic');
  const fallback = queryText(query['fallback']);
  if (!(SYSTEM_FONT_STACK_KEYS as readonly unknown[]).includes(fallback)) {
    throw new HttpError(400, ErrorCodes.validationFailed, 'fallback must be sans, serif, rounded or monospace');
  }
  return { family: family as string, weight, style, fallback: fallback as SystemFontStack };
}

// A refusal sent before the body is read: the connection closes after it, so the server does not
// read (or wait for) a large body nobody wants.
function closing(res: Response, error: HttpError): HttpError {
  res.setHeader('Connection', 'close');
  return error;
}

/** An opaque ETag for a font file: it names the file without telling its storage key. */
function fontEtag(key: string): string {
  return `"${createHash('sha256').update(key).digest('base64url').slice(0, 22)}"`;
}

/**
 * A project's fonts (epic Tale Studio R18), mounted at `/projects`: list, upload, delete, and the
 * file with a session (for Tale Studio). Uploads are WOFF2 only, judged from the bytes, at most
 * 500 KB, with the uploader's licence confirmation. The file goes through the storage port (AD-11).
 */
export function projectFontsRouter(pool: Pool, storage: MediaStorage): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');
  // No inflating: a compressed body could be far larger than what was sent.
  const raw = express.raw({ type: () => true, limit: MAX_FONT_BYTES, inflate: false });
  const readBody: RequestHandler = (req, res, next) =>
    raw(req, res, (err?: unknown) => {
      switch ((err as { type?: string } | undefined)?.type) {
        case undefined:
          next(err);
          return;
        case 'entity.too.large':
          next(closing(res, new HttpError(413, ErrorCodes.mediaTooLarge, TOO_LARGE)));
          return;
        case 'encoding.unsupported':
          next(closing(res, new HttpError(415, ErrorCodes.unsupportedMediaType, 'Send the font file uncompressed')));
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

  router.get('/:projectId/fonts', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json((await listProjectFonts(pool, req.params.projectId)) satisfies ProjectFont[]);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:projectId/fonts',
    projectAccess,
    async (req, res, next) => {
      try {
        // Role (403), project (404), declared type (415), the face (400) and the licence (400)
        // before any byte is read; then a declared length over the limit (413) without reading it.
        if (!UPLOAD_ROLES.includes(caller(res).role)) {
          throw closing(res, new HttpError(403, ErrorCodes.forbidden, 'Only admins and content managers upload fonts'));
        }
        await requireProject(pool, req.params['projectId']);
        const declared = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (!UPLOAD_TYPES.includes(declared)) {
          throw closing(
            res,
            new HttpError(
              415,
              ErrorCodes.unsupportedMediaType,
              'Send the font file as font/woff2 or application/octet-stream',
            ),
          );
        }
        try {
          faceOf(req.query);
        } catch (err) {
          throw closing(res, err as HttpError);
        }
        if (req.query['licence'] !== FONT_LICENCE_CONFIRMED) {
          throw closing(
            res,
            new HttpError(
              400,
              ErrorCodes.validationFailed,
              'Confirm that you may use and distribute this font (licence=confirmed)',
            ),
          );
        }
        const length = Number(req.headers['content-length']);
        if (Number.isFinite(length) && length > MAX_FONT_BYTES) {
          throw closing(res, new HttpError(413, ErrorCodes.mediaTooLarge, TOO_LARGE));
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
        const face = faceOf(req.query);
        const data: unknown = req.body;
        if (!Buffer.isBuffer(data) || data.length === 0) {
          throw new HttpError(400, ErrorCodes.validationFailed, 'The file is empty');
        }
        // The file's name is never sent, and the declared type does not count: only the bytes do.
        if (!isWoff2(data)) throw new HttpError(415, ErrorCodes.unsupportedMediaType, NOT_WOFF2);

        // The row and the file go together: the row is inserted, the file stored, then the row
        // committed; a failure leaves neither (see createProjectFont).
        const key = `fonts/${randomUUID()}.${FONT_FILE_EXTENSION}`;
        const user = caller(res);
        const font = await createProjectFont(
          pool,
          {
            projectId,
            ...face,
            storageKey: key,
            sizeBytes: data.length,
            uploader: { id: user.id, name: user.name },
          },
          {
            put: () => storage.put(key, data),
            remove: () => storage.delete(key).catch((err) => logError('could not delete unused font', err)),
          },
        );
        res.status(201).json(font satisfies ProjectFont);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:projectId/fonts/:fontId', projectAccess, async (req, res, next) => {
    try {
      const key = await deleteProjectFont(pool, req.params.projectId, req.params.fontId);
      // Font files are never shared, so the file goes with its row.
      await storage.delete(key).catch((err) => logError('could not delete a removed font file', err));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:projectId/fonts/:fontId/file', projectAccess, async (req, res, next) => {
    try {
      const font = await getProjectFontFile(pool, req.params.projectId, req.params.fontId);
      if (!font) throw new HttpError(404, ErrorCodes.fontNotFound, 'No font of this project has this id');
      const etag = fontEtag(font.key);
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('ETag', etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.status(304).end();
        return;
      }
      const data = await storage.get(font.key);
      if (!data) {
        res.removeHeader('ETag');
        res.removeHeader('Cache-Control');
        throw new HttpError(404, ErrorCodes.fontNotFound, 'No font of this project has this id');
      }
      res.setHeader('Content-Type', FONT_CONTENT_TYPE);
      res.send(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
