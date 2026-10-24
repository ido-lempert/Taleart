import { rollback, withClient, type Db, type TransactionalDb } from '@taleart/server-access';

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
 * Runs `work` in one transaction on one connection (`withClient`, so a session the database ends
 * fails the work instead of the process); rolls back on any error in `work`. A failed COMMIT throws
 * {@link CommitUncertainError}, and that connection is dropped from the pool.
 */
export async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  return withClient(db, async (tx) => {
    let result: T;
    try {
      await tx.query('BEGIN');
      result = await work(tx);
    } catch (err) {
      await rollback(tx);
      throw err;
    }
    // A session already lost never reached COMMIT: its work is rolled back, so the outcome is known.
    tx.assertUsable();
    try {
      await tx.query('COMMIT');
    } catch (err) {
      tx.discard(err as Error);
      throw new CommitUncertainError(err);
    }
    return result;
  });
}
