import type { Db } from './db';

/**
 * Forward-only migration for the tables the access module owns.
 * Safe to run on every start.
 */
export async function migrateAccess(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
