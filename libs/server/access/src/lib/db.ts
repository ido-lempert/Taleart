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
}

export interface WithClientOptions {
  /** Drops the client from the pool when `work` throws, even if its session is fine. */
  discardOnError?: boolean;
}

/**
 * Checks out one client for `work` and gives it back: the only way a client is checked out. While
 * a client is out, the pool's own `error` listener is off, so a session the database ends (a
 * restart, a failover, `pg_terminate_backend`) would make pg emit an unhandled `error` and Node
 * exit. Here a listener keeps that error instead: every later query on the client fails with it,
 * and the broken client is released with it, so the pool drops it rather than handing it out again.
 * The listener is removed just before release. `work` must not keep the client past its promise.
 */
export async function withClient<T>(
  db: TransactionalDb,
  work: (client: CheckedOutClient) => Promise<T>,
  options: WithClientOptions = {},
): Promise<T> {
  const raw = await db.connect();
  let lost: Error | null = null;
  let discarded: Error | undefined;
  const onError = (err: Error) => {
    lost ??= err;
  };
  raw.on?.('error', onError);
  const assertUsable = () => {
    if (lost) throw lost;
  };
  const client: CheckedOutClient = {
    query: (async (...args: unknown[]) => {
      assertUsable();
      return (raw.query as (...a: unknown[]) => unknown).apply(raw, args);
    }) as unknown as CheckedOutClient['query'],
    lost: () => lost,
    assertUsable,
    discard: (reason) => {
      discarded ??= reason;
    },
  };
  try {
    return await work(client);
  } catch (err) {
    if (options.discardOnError) client.discard(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    raw.off?.('error', onError);
    const reason = lost ?? discarded;
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
