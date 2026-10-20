import { MAX_TAG_NAME_LENGTH } from '@taleart/contract';
import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the tables the targeting module owns. Runs after
 * the tales migration, because a tale group's tags reference the group.
 */
export async function migrateTargeting(db: Db): Promise<void> {
  // A tag belongs to one project (AD-4). Its name is stored trimmed.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND ${MAX_TAG_NAME_LENGTH} AND name = btrim(name)),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Names are unique per project, ignoring case.
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS tags_project_id_lower_name_key ON tags (project_id, lower(name))');
  // Lets links reference (tag, project) together.
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS tags_id_project_id_key ON tags (id, project_id)');

  // A tale group's tags. Both composite keys carry the same project_id, so a
  // group can only ever carry tags of its own project (AD-4). The key into
  // tale_groups uses the tales module's unique index tale_groups_id_project_id_key.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_group_tags (
      tale_group_id uuid NOT NULL,
      tag_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tale_group_id, tag_id),
      FOREIGN KEY (tale_group_id, project_id) REFERENCES tale_groups (id, project_id),
      FOREIGN KEY (tag_id, project_id) REFERENCES tags (id, project_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tale_group_tags_tag_id_idx ON tale_group_tags (tag_id)');
}
