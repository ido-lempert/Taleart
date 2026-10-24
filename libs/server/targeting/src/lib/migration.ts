import { MAX_TAG_NAME_LENGTH, MAX_USER_LIST_NAME_LENGTH } from '@taleart/contract';
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

  // How a tale group's tags combine (epic targeting R1): one row per group whose mode was set.
  // A group with no row reads `any`, the default, so existing groups keep showing as before.
  // Removing the group removes its row.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_group_tag_matches (
      tale_group_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES projects(id),
      tag_match text NOT NULL DEFAULT 'any' CHECK (tag_match IN ('any', 'all')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (tale_group_id, project_id) REFERENCES tale_groups (id, project_id) ON DELETE CASCADE
    );
  `);

  await migrateUserLists(db);
}

/**
 * User lists (epic targeting R3, R5). External user IDs are stored only as HMAC-SHA-256 under a
 * random secret per project; every table goes with its project (ON DELETE CASCADE), and a list's
 * hashes go with the list, so deletes are hard deletes.
 */
async function migrateUserLists(db: Db): Promise<void> {
  // The project's hashing secret: 32 random bytes, created with its first list, never returned.
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_list_secrets (
      project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      secret bytea NOT NULL CHECK (octet_length(secret) = 32),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND ${MAX_USER_LIST_NAME_LENGTH} AND name = btrim(name)),
      id_count integer NOT NULL DEFAULT 0 CHECK (id_count >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Names are unique per project, ignoring case.
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS user_lists_project_id_lower_name_key ON user_lists (project_id, lower(name))',
  );
  // Lets the hashes reference (list, project) together.
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS user_lists_id_project_id_key ON user_lists (id, project_id)');
  // A list's IDs, each once, as a 32-byte keyed hash; never in clear.
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_list_ids (
      user_list_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id_hash bytea NOT NULL CHECK (octet_length(id_hash) = 32),
      PRIMARY KEY (user_list_id, id_hash),
      FOREIGN KEY (user_list_id, project_id) REFERENCES user_lists (id, project_id) ON DELETE CASCADE
    );
  `);
  // The user lists a tale group is targeted to (epic targeting R4). Both keys carry the same
  // project_id, so a group can only use lists of its own project (AD-4). Deleting the list or the
  // group removes the link. The tales module's audience-empty clause (delivery-rule.ts) reads this
  // table and user_lists by these names.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_group_user_lists (
      tale_group_id uuid NOT NULL,
      user_list_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tale_group_id, user_list_id),
      FOREIGN KEY (tale_group_id, project_id) REFERENCES tale_groups (id, project_id) ON DELETE CASCADE,
      FOREIGN KEY (user_list_id, project_id) REFERENCES user_lists (id, project_id) ON DELETE CASCADE
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tale_group_user_lists_user_list_id_idx ON tale_group_user_lists (user_list_id)');
}
