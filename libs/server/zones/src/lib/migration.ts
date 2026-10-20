import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the tables the zones module owns. Runs after the
 * access migration, because every zone references a project (AD-4).
 */
export async function migrateZones(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS zones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
