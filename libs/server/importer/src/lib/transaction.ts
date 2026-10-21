import type { Db, TransactionalDb } from '@taleart/server-access';

/**
 * COMMIT itself failed, so whether the transaction's writes are stored is not
 * known: callers must not undo side effects (such as deleting a stored file)
 * that a committed write may point at.
 */
export class CommitUncertainError extends Error {
  constructor(readonly cause: unknown) {
    super('The transaction commit failed with an unknown outcome');
    this.name = 'CommitUncertainError';
  }
}

/**
 * Runs `work` in one transaction on one connection; rolls back on any error
 * in `work`. A failed COMMIT throws {@link CommitUncertainError}.
 */
export async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  let result: T;
  try {
    await tx.query('BEGIN');
    result = await work(tx);
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
  try {
    await tx.query('COMMIT');
  } catch (err) {
    tx.release(err as Error);
    throw new CommitUncertainError(err);
  }
  tx.release();
  return result;
}
