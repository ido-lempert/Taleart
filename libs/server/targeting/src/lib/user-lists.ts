import { createHmac, randomBytes } from 'node:crypto';
import {
  externalUserIdRefusal,
  looksLikeEmail,
  looksLikePhone,
  MAX_REPORTED_REFUSED_ROWS,
  MAX_USER_LISTS_PER_PROJECT,
  normalizeUserListName,
  type UserList,
  type UserListRefusedRow,
  type UserListUploadReport,
} from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import {
  InvalidUserListNameError,
  UserListExistsError,
  UserListLimitError,
  UserListNotFoundError,
  UserListProjectNotFoundError,
} from './errors';
import type { NumberedUserListRow } from './user-list-csv';

// User lists (epic targeting R3, R5). An external user ID is never stored, logged or returned: it is
// hashed with HMAC-SHA-256 under the project's secret as soon as it is read, and only the 32-byte
// hash is written. The secret is 32 random bytes in `user_list_secrets`, created with the project's
// first list and deleted with its last, and never leaves this module.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_COLUMNS = `id, project_id AS "projectId", name, id_count AS "idCount",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

/** How many hashes go to the database in one statement while a file streams. */
export const USER_LIST_INSERT_BATCH = 5000;

/**
 * The database's backstop for an upload's transaction: how long it may sit idle between two
 * statements before PostgreSQL ends the session. The API's own timers end a stalled or too slow
 * upload long before (30 s without bytes, 280 s in all, apps/api user-lists.router.ts); this only
 * catches a caller that has none. It must stay longer than the caller's idle timer.
 */
export const USER_LIST_UPLOAD_DATABASE_IDLE_TIMEOUT = '120s';

/** A user list as this module stores it; the API adds the tale groups it targets. */
export type StoredUserList = Omit<UserList, 'taleGroups'>;

interface UserListRow {
  id: string;
  projectId: string;
  name: string;
  idCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function toUserList(row: UserListRow): StoredUserList {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** The keyed hash of an external user ID (already trimmed): HMAC-SHA-256 under the project's secret. */
export function hashExternalUserId(secret: Uint8Array, id: string): Buffer {
  return createHmac('sha256', secret).update(id, 'utf8').digest();
}

// Creates, deletes and uploads of one project's lists are serialised against each other by this
// lock: creates and deletes take it alone (the list cap, the secret's life), uploads share it. An
// upload holds it for as long as its file streams, which its caller bounds (the API: at most 280 s,
// and 30 s without bytes; the database backstop above otherwise), so a create or a delete waits at
// most that long behind a running upload.
async function lockProject(tx: Db, projectId: string, shared = false): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock${shared ? '_shared' : ''}(hashtext('user_lists:' || $1))`, [projectId]);
}

function translate(err: unknown): never {
  const pgError = err as { code?: string; constraint?: string };
  if (pgError.code === '23505' && pgError.constraint === 'user_lists_project_id_lower_name_key') {
    throw new UserListExistsError();
  }
  if (pgError.code === '23503') throw new UserListProjectNotFoundError();
  throw err;
}

/** The project's user lists by name, ignoring case. Ids that are not UUIDs have none. */
export async function listUserLists(db: Db, projectId: string): Promise<StoredUserList[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<UserListRow>(
    `SELECT ${LIST_COLUMNS} FROM user_lists WHERE project_id = $1 ORDER BY lower(name), name, id`,
    [projectId],
  );
  return rows.map(toUserList);
}

/** One user list of the project; null when there is none (or the id names another project's). */
export async function getUserList(db: Db, projectId: string, userListId: string): Promise<StoredUserList | null> {
  if (!UUID.test(projectId) || !UUID.test(userListId)) return null;
  const { rows } = await db.query<UserListRow>(
    `SELECT ${LIST_COLUMNS} FROM user_lists WHERE id = $1 AND project_id = $2`,
    [userListId, projectId],
  );
  return rows[0] ? toUserList(rows[0]) : null;
}

/**
 * Creates an empty user list (epic targeting R3). The name is trimmed and checked
 * ({@link InvalidUserListNameError}), unique in the project ignoring case ({@link UserListExistsError});
 * a project holds at most {@link MAX_USER_LISTS_PER_PROJECT} lists ({@link UserListLimitError}). The
 * project's secret is created with its first list. Part of the public interface (importer story 2.12).
 */
export async function createUserList(
  db: TransactionalDb,
  input: { projectId: string; name: string },
): Promise<StoredUserList> {
  const name = normalizeUserListName(input.name);
  if (name === null) throw new InvalidUserListNameError();
  if (!UUID.test(input.projectId)) throw new UserListProjectNotFoundError();
  return inTransaction(db, async (tx) => {
    await lockProject(tx, input.projectId);
    const { rows: counted } = await tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_lists WHERE project_id = $1',
      [input.projectId],
    );
    if (counted[0].n >= MAX_USER_LISTS_PER_PROJECT) throw new UserListLimitError();
    try {
      await tx.query(
        'INSERT INTO user_list_secrets (project_id, secret) VALUES ($1, $2) ON CONFLICT (project_id) DO NOTHING',
        [input.projectId, randomBytes(32)],
      );
      const { rows } = await tx.query<UserListRow>(
        `INSERT INTO user_lists (project_id, name) VALUES ($1, $2) RETURNING ${LIST_COLUMNS}`,
        [input.projectId, name],
      );
      return toUserList(rows[0]);
    } catch (err) {
      translate(err);
    }
  });
}

/** Renames a user list; the same name rules as {@link createUserList}. */
export async function renameUserList(
  db: Db,
  input: { projectId: string; userListId: string; name: string },
): Promise<StoredUserList> {
  const name = normalizeUserListName(input.name);
  if (name === null) throw new InvalidUserListNameError();
  if (!UUID.test(input.projectId) || !UUID.test(input.userListId)) throw new UserListNotFoundError();
  try {
    const { rows } = await db.query<UserListRow>(
      `UPDATE user_lists SET name = $3, updated_at = CASE WHEN name = $3 THEN updated_at ELSE now() END
       WHERE id = $1 AND project_id = $2 RETURNING ${LIST_COLUMNS}`,
      [input.userListId, input.projectId, name],
    );
    if (!rows[0]) throw new UserListNotFoundError();
    return toUserList(rows[0]);
  } catch (err) {
    translate(err);
  }
}

/**
 * Deletes a user list and every hash it holds, for good, in one transaction (epic targeting R5).
 * It leaves every group's Audience; a group it was the only list of is held hidden
 * (`audience-removed`) until a person saves its Audience. With the project's last list, its secret
 * goes too, so the next list starts with a new one.
 */
export async function deleteUserList(
  db: TransactionalDb,
  input: { projectId: string; userListId: string },
): Promise<void> {
  if (!UUID.test(input.projectId) || !UUID.test(input.userListId)) throw new UserListNotFoundError();
  await inTransaction(db, async (tx) => {
    await lockProject(tx, input.projectId);
    // The list's row first, FOR UPDATE: it waits for every transaction that holds it FOR KEY SHARE
    // (one setting a group's lists to or from it, a copy linking it) to commit, so the statement
    // below reads the groups' links as they are now, not as they were before such a change. Without
    // it a concurrent set or copy could leave a group with no list and no hold: public.
    const { rows: locked } = await tx.query('SELECT id FROM user_lists WHERE id = $1 AND project_id = $2 FOR UPDATE', [
      input.userListId,
      input.projectId,
    ]);
    if (locked.length === 0) throw new UserListNotFoundError();
    // A group targeted to this list and no other is held hidden (`audience-removed`) rather than
    // shown to everyone once the list is gone (owner decision, story 5.4 review).
    await tx.query(
      `INSERT INTO tale_group_audience_holds (tale_group_id, project_id)
       SELECT l.tale_group_id, l.project_id FROM tale_group_user_lists l
       WHERE l.user_list_id = $1 AND l.project_id = $2
         AND NOT EXISTS (SELECT 1 FROM tale_group_user_lists o
                         WHERE o.tale_group_id = l.tale_group_id AND o.user_list_id <> $1)
       ON CONFLICT (tale_group_id) DO NOTHING`,
      [input.userListId, input.projectId],
    );
    const { rowCount } = await tx.query('DELETE FROM user_lists WHERE id = $1 AND project_id = $2', [
      input.userListId,
      input.projectId,
    ]);
    if (!rowCount) throw new UserListNotFoundError();
    await tx.query(
      `DELETE FROM user_list_secrets WHERE project_id = $1
       AND NOT EXISTS (SELECT 1 FROM user_lists WHERE project_id = $1)`,
      [input.projectId],
    );
  });
}

/** How an upload's transaction is bounded. */
export interface UserListUploadOptions {
  /** The database's idle-in-transaction backstop, such as `120s`; {@link USER_LIST_UPLOAD_DATABASE_IDLE_TIMEOUT} by default. */
  databaseIdleTimeout?: string;
}

/** A checked-out client that may emit `error`, as a pg PoolClient does. */
type ListenedClient = Db & {
  release(err?: Error | boolean): void;
  on?(event: 'error', listener: (err: Error) => void): unknown;
  off?(event: 'error', listener: (err: Error) => void): unknown;
};

/**
 * Runs an upload in one transaction on one connection, with an `error` listener on the client for
 * as long as it is checked out: when PostgreSQL ends the session (the idle-in-transaction backstop
 * fires FATAL 25P03 while the client waits for bytes), pg emits `error` on the client, and without a
 * listener Node would exit. The error is kept and thrown instead, the work rolls back, and the
 * broken client is discarded rather than returned to the pool.
 */
async function uploadTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const client = (await db.connect()) as ListenedClient;
  let broken: Error | null = null;
  const onError = (err: Error) => {
    broken = err;
  };
  client.on?.('error', onError);
  const check = () => {
    if (broken) throw broken;
  };
  try {
    await client.query('BEGIN');
    const result = await work({
      query: (async (...args: unknown[]) => {
        check();
        return (client.query as (...a: unknown[]) => unknown)(...args);
      }) as unknown as Db['query'],
    });
    check();
    await client.query('COMMIT');
    client.off?.('error', onError);
    client.release();
    return result;
  } catch (err) {
    try {
      if (broken) throw broken;
      await client.query('ROLLBACK');
      client.off?.('error', onError);
      client.release();
    } catch (rollbackErr) {
      // A connection that cannot roll back, or that the database ended, is not returned to the pool.
      client.off?.('error', onError);
      client.release(rollbackErr as Error);
    }
    throw err;
  }
}

/** Where IDs go: a list of a project. */
export interface UserListTarget {
  projectId: string;
  userListId: string;
}

/**
 * Adds the rows of a file to a user list, all or nothing, in one transaction (epic targeting R3,
 * R5): each ID is hashed as it comes and inserted in batches of {@link USER_LIST_INSERT_BATCH}, once
 * per list. Rows the list already held, or an earlier row held, count as already present; refused
 * rows are counted and the first {@link MAX_REPORTED_REFUSED_ROWS} named by line. Any error from
 * `rows` (a cap, a cut stream) rolls everything back and is passed on. Throws
 * {@link UserListNotFoundError} for a list of another project, or none.
 */
export async function addUserListRows(
  db: TransactionalDb,
  target: UserListTarget,
  rows: AsyncIterable<NumberedUserListRow> | Iterable<NumberedUserListRow>,
  options: UserListUploadOptions = {},
): Promise<UserListUploadReport> {
  if (!UUID.test(target.projectId) || !UUID.test(target.userListId)) throw new UserListNotFoundError();
  const idleTimeout = options.databaseIdleTimeout ?? USER_LIST_UPLOAD_DATABASE_IDLE_TIMEOUT;
  if (!/^\d+(ms|s|min)$/.test(idleTimeout)) throw new Error('databaseIdleTimeout must be like 120s');
  return uploadTransaction(db, async (tx) => {
    await tx.query(`SET LOCAL idle_in_transaction_session_timeout = '${idleTimeout}'`);
    await lockProject(tx, target.projectId, true);
    const { rows: found } = await tx.query<{ secret: Buffer }>(
      `SELECT s.secret FROM user_lists l JOIN user_list_secrets s ON s.project_id = l.project_id
       WHERE l.id = $1 AND l.project_id = $2 FOR UPDATE OF l`,
      [target.userListId, target.projectId],
    );
    if (!found[0]) throw new UserListNotFoundError();
    const secret = found[0].secret;

    let added = 0;
    let accepted = 0;
    let refused = 0;
    let emptyRows = 0;
    let emailLike = 0;
    let phoneLike = 0;
    const refusedRows: UserListRefusedRow[] = [];
    let batch: string[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const hashes = batch;
      batch = [];
      const { rowCount } = await tx.query(
        `INSERT INTO user_list_ids (user_list_id, project_id, id_hash)
         SELECT $1, $2, decode(h, 'hex') FROM unnest($3::text[]) AS h
         ON CONFLICT DO NOTHING`,
        [target.userListId, target.projectId, hashes],
      );
      added += rowCount ?? 0;
    };

    for await (const row of rows) {
      if (row.kind === 'empty') {
        emptyRows++;
        continue;
      }
      if (row.kind === 'refused') {
        refused++;
        if (refusedRows.length < MAX_REPORTED_REFUSED_ROWS) refusedRows.push({ line: row.line, reason: row.reason });
        continue;
      }
      accepted++;
      if (looksLikeEmail(row.id)) emailLike++;
      else if (looksLikePhone(row.id)) phoneLike++;
      batch.push(hashExternalUserId(secret, row.id).toString('hex'));
      if (batch.length >= USER_LIST_INSERT_BATCH) await flush();
    }
    await flush();

    const { rows: updated } = await tx.query<{ idCount: number }>(
      `UPDATE user_lists SET id_count = id_count + $2, updated_at = CASE WHEN $2 > 0 THEN now() ELSE updated_at END
       WHERE id = $1 RETURNING id_count AS "idCount"`,
      [target.userListId, added],
    );
    return {
      added,
      alreadyPresent: accepted - added,
      refused,
      refusedRows,
      emptyRows,
      emailLike,
      phoneLike,
      idCount: updated[0].idCount,
    };
  });
}

/**
 * Adds external user IDs to a user list, as {@link addUserListRows} does for a file: each value is
 * trimmed, a blank one skipped and one over 256 characters or with a control character refused,
 * numbered from 1 in the order given. For another module, such as the importer (story 2.12), that
 * holds IDs rather than a CSV. Part of the public interface.
 */
export async function addUserListIds(
  db: TransactionalDb,
  target: UserListTarget,
  ids: AsyncIterable<string> | Iterable<string>,
  options: UserListUploadOptions = {},
): Promise<UserListUploadReport> {
  async function* rows(): AsyncGenerator<NumberedUserListRow> {
    let line = 0;
    for await (const raw of ids) {
      line++;
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id) {
        yield { kind: 'empty', line };
        continue;
      }
      const reason = externalUserIdRefusal(id);
      yield reason === null ? { kind: 'id', id, line } : { kind: 'refused', reason, line };
    }
  }
  return addUserListRows(db, target, rows(), options);
}
