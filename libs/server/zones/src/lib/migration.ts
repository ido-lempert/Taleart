import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the tables the zones module owns. Runs after the
 * access migration, because every zone references a project (AD-4). The
 * `stages` table of a database from before the UX rework stays until
 * `foldStagesIntoZones` (fold.ts) turns its stages into zones and drops it.
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
  // A zone's frame is found through the unique index `frames_zone_id_key` (one display per zone),
  // which `foldStagesIntoZones` creates; the older frames_zone_id_idx is dropped there.

  // The key of the template the zone was created from (epic UX rework R5), from the
  // template registry in libs/contract: only a "created from template" note. The column
  // keeps its name from when templates were playbooks (epic web zones R8).
  await db.query('ALTER TABLE zones ADD COLUMN IF NOT EXISTS playbook_key text');
  // The playbook "home-stories-bar" is the template "stories-bar" (forward-only; runs again harmlessly).
  await db.query("UPDATE zones SET playbook_key = 'stories-bar' WHERE playbook_key = 'home-stories-bar'");

  // Rows created in one transaction keep their creation order: now() is the
  // transaction's start time, clock_timestamp() is not.
  await db.query('ALTER TABLE frames ALTER COLUMN created_at SET DEFAULT clock_timestamp()');

  // A zone's slug (epic UX rework R1, AD-17): what a host page names in
  // `zone="…"`, unique in its project. Null only until `foldStagesIntoZones`
  // fills it on a database from before the rework and makes it NOT NULL;
  // NULLs never clash in the unique index.
  await db.query('ALTER TABLE zones ADD COLUMN IF NOT EXISTS slug text');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS zones_project_id_slug_key ON zones (project_id, slug)');

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
