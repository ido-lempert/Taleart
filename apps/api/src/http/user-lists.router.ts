import type { IncomingMessage } from 'node:http';
import {
  ErrorCodes,
  MAX_USER_LIST_CSV_BYTES,
  USER_ROLES,
  type UserList,
  type UserListUploadReport,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import { clearPublicFontCache, clearPublicMediaCache, taleGroupNames } from '@taleart/server-tales';
import {
  addUserListRows,
  createUserList,
  deleteUserList,
  getUserList,
  listUserLists,
  readUserListCsv,
  renameUserList,
  type StoredUserList,
  taleGroupIdsForUserLists,
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

/**
 * How long an upload may go without a byte before it is ended: the request is destroyed and its
 * transaction rolled back. Counted only while the server waits for bytes, not while it writes.
 */
export const USER_LIST_UPLOAD_IDLE_MS = 30_000;

/**
 * How long a whole upload may take, from its first check to its last row: 280 s, under Node's
 * 300 s `server.requestTimeout` (set in main.ts). A 50 MB file needs at least about 190 KB/s
 * (1.5 Mbit/s); a slower link can send the file in parts, each added to the same list. It also
 * bounds how long an upload holds its list's lock and its project's shared lock (epic targeting R5).
 */
export const USER_LIST_UPLOAD_DEADLINE_MS = 280_000;

/** How the user list routes are bounded. */
export interface UserListOptions {
  /** The most uploads this process streams at once; more answer 429 `upload_busy`. */
  maxConcurrentUploads?: number;
  /** The largest CSV, in bytes (tests lower it). */
  maxBytes?: number;
  /** The most rows of one CSV (tests lower it). */
  maxRows?: number;
  /** {@link USER_LIST_UPLOAD_IDLE_MS} by default (tests lower it). */
  idleMs?: number;
  /** {@link USER_LIST_UPLOAD_DEADLINE_MS} by default (tests lower it). */
  deadlineMs?: number;
  /** The database's idle-in-transaction backstop, such as `120s` (tests lower it). */
  databaseIdleTimeout?: string;
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

/** Refuses a caller who may not change user lists or what a tale group is targeted to (403). */
export const requireListEditor = requireEditor;

/**
 * Called once a change to user lists is done (or failed): a list's IDs or a group's lists decide
 * whether the group is audience-empty, which the public media and font routes serve by, so this
 * process forgets their public answers at once (as the tales module does for its own changes).
 */
export function userListsChanged(): void {
  clearPublicMediaCache();
  clearPublicFontCache();
}

/** User lists with the tale groups each targets, by name ignoring case (epic targeting R4). */
async function withTaleGroups(pool: Pool, projectId: string, lists: StoredUserList[]): Promise<UserList[]> {
  const byList = await taleGroupIdsForUserLists(pool, projectId);
  const names = await taleGroupNames(pool, projectId, [...new Set([...byList.values()].flat())]);
  return lists.map((list) => ({
    ...list,
    taleGroups: (byList.get(list.id) ?? [])
      .flatMap((id) => {
        const name = names.get(id);
        return name === undefined ? [] : [{ id, name }];
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  }));
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

/** Ends a request that sent no byte for too long, or took too long in all. */
export class UploadTimedOut extends Error {
  constructor(readonly why: 'idle' | 'deadline') {
    super(why === 'idle' ? 'The upload stalled' : 'The upload took too long');
    this.name = 'UploadTimedOut';
  }
}

/**
 * The request body as chunks: a body longer or shorter than its declared length stops the stream
 * (400). Stopping does not destroy the request, so the caller can drain the rest and still answer.
 * While it waits for the next chunk, `idleMs` without a byte destroys the request with
 * {@link UploadTimedOut}, which ends the read with that error; so does the caller's deadline.
 */
async function* wholeBody(req: IncomingMessage, length: number, idleMs: number): AsyncGenerator<Uint8Array> {
  const notWhole = () =>
    new UploadRefused(new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
  let received = 0;
  const chunks = req.iterator({ destroyOnReturn: false })[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  for (;;) {
    const idle = setTimeout(() => req.destroy(new UploadTimedOut('idle')), idleMs);
    let next: IteratorResult<Buffer>;
    try {
      next = await chunks.next();
    } finally {
      clearTimeout(idle);
    }
    if (next.done) break;
    received += next.value.length;
    if (received > length) throw notWhole();
    yield next.value;
  }
  if (received !== length) throw notWhole();
}

/** A project's user lists, mounted at `/projects`. */
export function userListsRouter(pool: Pool, options: UserListOptions = {}): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');
  const maxUploads = options.maxConcurrentUploads ?? MAX_CONCURRENT_USER_LIST_UPLOADS;
  const maxBytes = options.maxBytes ?? MAX_USER_LIST_CSV_BYTES;
  const idleMs = options.idleMs ?? USER_LIST_UPLOAD_IDLE_MS;
  const deadlineMs = options.deadlineMs ?? USER_LIST_UPLOAD_DEADLINE_MS;
  let uploads = 0;

  router.get('/:projectId/user-lists', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      const { projectId } = req.params;
      res.json((await withTaleGroups(pool, projectId, await listUserLists(pool, projectId))) satisfies UserList[]);
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
      res.status(201).json({ ...(await createUserList(pool, { projectId, name })), taleGroups: [] } satisfies UserList);
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
      const [renamed] = await withTaleGroups(pool, projectId, [await renameUserList(pool, { projectId, userListId, name })]);
      res.json(renamed satisfies UserList);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/user-lists/:userListId', projectAccess, async (req, res, next) => {
    try {
      requireEditor(res);
      const { projectId, userListId } = req.params;
      await requireProject(pool, projectId);
      try {
        await deleteUserList(pool, { projectId, userListId });
      } finally {
        userListsChanged();
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/user-lists/:userListId/ids', projectAccess, async (req, res, next) => {
    let counted = false;
    // The whole upload's deadline: it destroys the request, which ends the read and rolls back.
    const deadline = setTimeout(() => req.destroy(new UploadTimedOut('deadline')), deadlineMs);
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
        // The list's first IDs can make its groups visible (audience-empty no longer holds).
        report = await addUserListRows(
          pool,
          { projectId, userListId },
          readUserListCsv(wholeBody(req, length, idleMs), { header, maxRows: options.maxRows }),
          { databaseIdleTimeout: options.databaseIdleTimeout },
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
        // Stalled or too slow: the request is destroyed and nothing was added. The answer is tried,
        // though the connection is usually gone.
        if (err instanceof UploadTimedOut) {
          throw early(new HttpError(408, ErrorCodes.validationFailed, `${err.message}. Nothing was added; try again.`));
        }
        // The client went away mid-file: nothing was added, and there is nobody to answer.
        // (A request read to its end is destroyed too, so `complete` tells a cut body from a whole one.)
        if (!req.complete && (req.destroyed || (err as { message?: string }).message === 'aborted')) {
          throw early(new HttpError(400, ErrorCodes.validationFailed, 'The file did not arrive whole'));
        }
        // Anything else (the database, a bug) answers 500: the rest of the body is drained, unread.
        req.resume();
        throw err;
      } finally {
        userListsChanged();
      }
      res.json(report satisfies UserListUploadReport);
    } catch (err) {
      next(err);
    } finally {
      clearTimeout(deadline);
      if (counted) uploads--;
    }
  });

  return router;
}
