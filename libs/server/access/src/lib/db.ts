import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: a pool or a checked-out client. */
export type Db = Pick<Pool | PoolClient, 'query'>;

/**
 * One checked-out connection, for work that must stay on one session: a transaction spanning
 * several calls, or the migrations, which run under the migration lock. Check one out with
 * {@link withClient}, which also gives it back.
 */
export type DbConnection = Pick<PoolClient, 'query'>;

/**
 * A client as a pool hands it out: it runs queries, goes back with `release` (with an error, the
 * pool drops it), and, as a pg PoolClient does, may emit `error` when its session ends.
 */
export type CheckoutClient = Db & {
  release(err?: Error | boolean): void;
  on?(event: 'error', listener: (err: Error) => void): unknown;
  off?(event: 'error', listener: (err: Error) => void): unknown;
};

/** A database that can hand out one connection, such as a pg Pool. Check one out only with {@link withClient}. */
export interface TransactionalDb extends Db {
  connect(): Promise<CheckoutClient>;
}

/** A client checked out by {@link withClient}, for as long as its work runs. */
export interface CheckedOutClient extends DbConnection {
  /** The error that ended this client's session (a database restart, a terminated backend), or null. */
  lost(): Error | null;
  /** Throws the error that ended this client's session, if one did. */
  assertUsable(): void;
  /** Drops the client from the pool when it is given back: its session's state is not known. */
  discard(reason: Error): void;
  /** Aborts once this client's session is lost. */
  readonly signal: AbortSignal;
}

export interface WithClientOptions {
  /** Drops the client from the pool when `work` throws, even if its session is fine. */
  discardOnError?: boolean;
}

/**
 * True for an error that means the session is gone: SQLSTATE class 57P (the server ended it, such
 * as 57P01 from `pg_terminate_backend`), class 08 (a connection exception) or 25P03 (the
 * idle-in-transaction timeout). 57014 (a cancelled statement) leaves the session usable.
 */
export function isSessionEndedError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('57P') || code.startsWith('08') || code === '25P03');
}

// pg marks a client it can no longer use `_queryable = false` (its socket closed, with or without a FATAL).
function unqueryable(client: object): boolean {
  return (client as { _queryable?: unknown })._queryable === false;
}

/**
 * Checks out one client for `work` and gives it back: the only way a client is checked out. While
 * a client is out, the pool's own `error` listener is off, so a session the database ends (a
 * restart, a failover, `pg_terminate_backend`) would make pg emit an unhandled `error` and Node
 * exit. Here a listener keeps that error instead. pg rejects the query in flight first and emits
 * `error` after, so a query failing with a session-ended SQLSTATE ({@link isSessionEndedError})
 * marks the client lost at once, keeping that first error. Every later query on a lost client
 * fails with it, and the client is released with it, so the pool drops it rather than handing it
 * out again; a client pg marks unusable is dropped too. The listener is removed just before
 * release. `work` must not keep the client past its promise.
 */
export async function withClient<T>(
  db: TransactionalDb,
  work: (client: CheckedOutClient) => Promise<T>,
  options: WithClientOptions = {},
): Promise<T> {
  const raw = await db.connect();
  let lost: Error | null = null;
  let discarded: Error | undefined;
  const lostSignal = new AbortController();
  const markLost = (err: Error) => {
    if (lost) return;
    lost = err;
    lostSignal.abort(err);
  };
  raw.on?.('error', markLost);
  const assertUsable = () => {
    if (lost) throw lost;
  };
  const client: CheckedOutClient = {
    query: (async (...args: unknown[]) => {
      assertUsable();
      try {
        return await (raw.query as (...a: unknown[]) => Promise<unknown>).apply(raw, args);
      } catch (err) {
        if (isSessionEndedError(err)) markLost(err as Error);
        throw err;
      }
    }) as unknown as CheckedOutClient['query'],
    lost: () => lost,
    assertUsable,
    discard: (reason) => {
      discarded ??= reason;
    },
    signal: lostSignal.signal,
  };
  try {
    return await work(client);
  } catch (err) {
    if (isSessionEndedError(err)) markLost(err as Error);
    if (options.discardOnError) client.discard(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    raw.off?.('error', markLost);
    const reason = lost ?? (unqueryable(raw) ? new Error('The database connection is no longer usable') : discarded);
    if (reason) raw.release(reason);
    else raw.release();
  }
}

/**
 * Runs `work` in one transaction on one connection ({@link withClient}); rolls back on any error.
 * A connection that cannot roll back, or whose session the database ended, is dropped from the pool.
 */
export async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  return withClient(db, async (tx) => {
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (err) {
      await rollback(tx);
      throw err;
    }
  });
}

/** Rolls back the client's transaction; a client that is lost or cannot roll back is discarded. */
export async function rollback(tx: CheckedOutClient): Promise<void> {
  if (tx.lost()) return;
  try {
    await tx.query('ROLLBACK');
  } catch (rollbackErr) {
    tx.discard(rollbackErr as Error);
  }
}
