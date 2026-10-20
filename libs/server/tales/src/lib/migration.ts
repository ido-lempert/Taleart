import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the tables the tales module owns. Runs after the
 * zones migration, because every tale group references a zone (AD-4).
 */
export async function migrateTales(db: Db): Promise<void> {
  // A tale group belongs to one zone and carries that zone's project. The
  // composite key into zones_id_project_id_key makes a mismatched project
  // impossible (AD-4).
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      name text NOT NULL,
      position integer NOT NULL CHECK (position >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tale_groups_zone_id_idx ON tale_groups (zone_id, position)');

  // Lets tales reference (tale group, project) together, so a tale's
  // project_id can only ever be its group's project (AD-4).
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS tale_groups_id_project_id_key ON tale_groups (id, project_id)',
  );

  await db.query(`
    CREATE TABLE IF NOT EXISTS tales (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tale_group_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      title text NOT NULL,
      position integer NOT NULL CHECK (position >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (tale_group_id, project_id) REFERENCES tale_groups (id, project_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tales_tale_group_id_idx ON tales (tale_group_id, position)');
}
