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

  // Lets frames reference (zone, project) together, so a frame's project_id
  // can only ever be its zone's project (AD-4).
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS zones_id_project_id_key ON zones (id, project_id)');

  // A frame stores its type as a registry key and its settings as JSONB
  // (AD-5): a new frame type needs no new table or column.
  await db.query(`
    CREATE TABLE IF NOT EXISTS frames (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      type text NOT NULL,
      settings jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS frames_zone_id_idx ON frames (zone_id, created_at)');

  // One theme per project (epic web zones R9, AD-4): only the fields the
  // project sets, as JSONB; readers fill the rest from TaleArt's default theme.
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_themes (
      project_id uuid NOT NULL PRIMARY KEY REFERENCES projects(id),
      theme jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
