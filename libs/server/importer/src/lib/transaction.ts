import type { Db, TransactionalDb } from '@taleart/server-access';

/** Runs `work` in one transaction on one connection; rolls back on any error. */
export async function inTransaction<T>(
  db: TransactionalDb,
  work: (tx: Db) => Promise<T>,
): Promise<T> {
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
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
}
