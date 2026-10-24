import type { IncomingMessage } from 'node:http';
import {
  ErrorCodes,
  MAX_USER_LIST_CSV_BYTES,
  USER_ROLES,
  type UserList,
  type UserListUploadReport,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import {
  addUserListRows,
  createUserList,
  deleteUserList,
  getUserList,
  listUserLists,
  readUserListCsv,
  renameUserList,
  UserListFileNotUtf8Error,
  UserListFileTooLargeError,
} from '@taleart/server-targeting';
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

// User lists (epic targeting R3, R5). An uploaded external user ID is never logged, kept or put in
// a response or an error: the CSV streams from the request into the targeting module, which hashes
// each ID as it reads it. Refusals name line numbers, never values.

// The roles that change user lists: admins and content managers.
const EDIT_ROLES: readonly string[] = USER_ROLES.filter((role) => role === 'admin' || role === 'content_manager');

// The types a CSV upload may declare.
const CSV_TYPES = new Set(['text/csv', 'text/plain', 'application/csv']);

/** The CSV uploads one process streams at once by default (each holds a database connection). */
export const MAX_CONCURRENT_USER_LIST_UPLOADS = 2;

/** How the user list routes are bounded. */
export interface UserListOptions {
  /** The most uploads this process streams at once; more answer 429 `upload_busy`. */
  maxConcurrentUploads?: number;
  /** The largest CSV, in bytes (tests lower it). */
  maxBytes?: number;
  /** The most rows of one CSV (tests lower it). */
  maxRows?: number;
}

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

function requireEditor(res: Response): void {
  if (!EDIT_ROLES.includes(caller(res).role)) {
    throw new HttpError(403, ErrorCodes.forbidden, 'Only admins and content managers change user lists');
  }
}

function tooLarge(limit: number): HttpError {
  return new HttpError(413, ErrorCodes.userListFileTooLarge, `A CSV is at most ${limit / (1024 * 1024)} MB`);
}

// Thrown while the body streams: the stream stops, nothing is added, and the request is answered.
class UploadRefused extends Error {
  constructor(readonly error: HttpError) {
    super(error.message);
  }
}

/**
 * The request body as chunks: a body longer or shorter than its declared length stops the stream
 * (400). Stopping does not destroy the request, so the caller can drain the rest and still answer.
 */
async function* wholeBody(req: IncomingMessage, length: number): AsyncGenerator<Uint8Array> {
  const notWhole = () =>
    new UploadRefused(new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
  let received = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    received += chunk.length;
    if (received > length) throw notWhole();
    yield chunk;
  }
  if (received !== length) throw notWhole();
}

/** A project's user lists, mounted at `/projects`. */
export function userListsRouter(pool: Pool, options: UserListOptions = {}): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');
  const maxUploads = options.maxConcurrentUploads ?? MAX_CONCURRENT_USER_LIST_UPLOADS;
  const maxBytes = options.maxBytes ?? MAX_USER_LIST_CSV_BYTES;
  let uploads = 0;

  router.get('/:projectId/user-lists', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json((await listUserLists(pool, req.params.projectId)) satisfies UserList[]);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/user-lists', projectAccess, async (req, res, next) => {
    try {
      requireEditor(res);
      const { projectId } = req.params;
      await requireProject(pool, projectId);
      const name = requiredString(req.body, 'name');
      res.status(201).json((await createUserList(pool, { projectId, name })) satisfies UserList);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:projectId/user-lists/:userListId', projectAccess, async (req, res, next) => {
    try {
      requireEditor(res);
      const { projectId, userListId } = req.params;
      await requireProject(pool, projectId);
      const name = requiredString(req.body, 'name');
      res.json((await renameUserList(pool, { projectId, userListId, name })) satisfies UserList);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/user-lists/:userListId', projectAccess, async (req, res, next) => {
    try {
      requireEditor(res);
      const { projectId, userListId } = req.params;
      await requireProject(pool, projectId);
      await deleteUserList(pool, { projectId, userListId });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/user-lists/:userListId/ids', projectAccess, async (req, res, next) => {
    let counted = false;
    try {
      // Everything that needs no byte of the body is checked first, and refused with
      // `Connection: close` so the body is never read: the role (403), uploads in flight (429), the
      // project and the list (404), the declared type and compression (415) and length (411, 400, 413).
      const early = (error: unknown) => {
        req.resume();
        res.setHeader('Connection', 'close');
        return error;
      };
      if (!EDIT_ROLES.includes(caller(res).role)) {
        throw early(new HttpError(403, ErrorCodes.forbidden, 'Only admins and content managers change user lists'));
      }
      if (uploads >= maxUploads) {
        res.setHeader('Retry-After', '5');
        throw early(new HttpError(429, ErrorCodes.uploadBusy, 'Too many uploads are in progress. Try again shortly.'));
      }
      uploads++;
      counted = true;
      const { projectId, userListId } = req.params;
      try {
        await requireProject(pool, projectId);
        if (!(await getUserList(pool, projectId, userListId))) {
          throw new HttpError(404, ErrorCodes.userListNotFound, 'No user list of this project has this id');
        }
      } catch (err) {
        throw early(err);
      }
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!CSV_TYPES.has(type)) {
        throw early(new HttpError(415, ErrorCodes.unsupportedMediaType, 'Upload a CSV file (text/csv)'));
      }
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
      if (length > maxBytes) throw early(tooLarge(maxBytes));

      const header = req.query['header'] === 'true';
      let report: UserListUploadReport;
      try {
        report = await addUserListRows(
          pool,
          { projectId, userListId },
          readUserListCsv(wholeBody(req, length), { header, maxRows: options.maxRows }),
        );
      } catch (err) {
        // Nothing was added (one transaction). The rest of a refused body is drained, unread, so
        // the browser that is still sending it gets the answer rather than a reset connection.
        const drained = (error: HttpError) => {
          req.resume();
          return error;
        };
        if (err instanceof UploadRefused) throw drained(err.error);
        if (err instanceof UserListFileTooLargeError) {
          throw drained(new HttpError(413, ErrorCodes.userListFileTooLarge, err.message));
        }
        if (err instanceof UserListFileNotUtf8Error) {
          throw drained(new HttpError(400, ErrorCodes.validationFailed, err.message));
        }
        // The client went away mid-file: nothing was added, and there is nobody to answer.
        if (req.destroyed || (err as { message?: string }).message === 'aborted') {
          throw early(new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
        }
        throw err;
      }
      res.json(report satisfies UserListUploadReport);
    } catch (err) {
      next(err);
    } finally {
      if (counted) uploads--;
    }
  });

  return router;
}
