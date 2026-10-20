import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: a pool or a checked-out client. */
export type Db = Pick<Pool | PoolClient, 'query'>;

/** A database that can hand out one connection for a transaction, such as a pg Pool. */
export interface TransactionalDb extends Db {
  connect(): Promise<Db & { release(err?: Error | boolean): void }>;
}

// Runs `work` in one transaction on one connection; rolls back on any error.
export async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    tx.release();
    return result;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      // A connection that cannot roll back is not returned to the pool.
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
}
