import type { Db } from '@taleart/server-access';

/** The status keys that are stored (AD-6); the others are computed when content is read. */
const STORED_STATUSES = ['draft', 'live', 'paused', 'archived', 'processing', 'invalid-media', 'quota-reached'] as const;

/**
 * Forward-only migration for the tables the tales module owns. Runs after the
 * zones migration, because every zone placement references a zone (AD-4).
 */
export async function migrateTales(db: Db): Promise<void> {
  // A tale group belongs to its project, not to a zone (AD-14). Installs made
  // before AD-14 still have zone_id and position here until the step below.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Lets tales and placements reference (tale group, project) together, so
  // their project_id can only ever be the group's project (AD-4).
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS tale_groups_id_project_id_key ON tale_groups (id, project_id)',
  );

  // Zones place tale groups, each zone in its own order (AD-14). Both
  // composite keys carry the placement's project, so a zone can only place a
  // group of its own project (AD-4).
  await db.query(`
    CREATE TABLE IF NOT EXISTS zone_tale_groups (
      zone_id uuid NOT NULL,
      tale_group_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      position integer NOT NULL CHECK (position >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (zone_id, tale_group_id),
      FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id),
      FOREIGN KEY (tale_group_id, project_id) REFERENCES tale_groups (id, project_id)
    );
  `);
  await db.query(
    'CREATE INDEX IF NOT EXISTS zone_tale_groups_zone_id_idx ON zone_tale_groups (zone_id, position)',
  );
  await db.query(
    'CREATE INDEX IF NOT EXISTS zone_tale_groups_tale_group_id_idx ON zone_tale_groups (tale_group_id)',
  );

  // Before AD-14 a group sat in one zone (tale_groups.zone_id, position).
  // Each such group gets one placement in that zone at its old position, then
  // the old columns go. One statement, so a failure leaves both as they were;
  // once the columns are gone it does nothing.
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'tale_groups' AND column_name = 'zone_id'
      ) THEN
        INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position, created_at)
        SELECT zone_id, id, project_id, position, created_at FROM tale_groups
        ON CONFLICT (zone_id, tale_group_id) DO NOTHING;
        DROP INDEX IF EXISTS tale_groups_zone_id_idx;
        ALTER TABLE tale_groups DROP COLUMN IF EXISTS zone_id, DROP COLUMN IF EXISTS position;
      END IF;
    END
    $$;
  `);

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

  // A tale's media: the storage key and the uploaded content type, never a
  // path or URL (AD-11). Both are null when the tale has no media.
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS media_key text');
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS media_content_type text');

  // Public media URLs are looked up by key (AD-11).
  await db.query('CREATE INDEX IF NOT EXISTS tales_media_key_idx ON tales (media_key)');

  // The status key a person or process sets (AD-6). Rows that existed before
  // statuses were live, so the column is added with default 'live', which
  // fills them, and the default then becomes 'draft' for new rows. One
  // statement per table, guarded by the column's absence, so a second run
  // changes nothing. Computed keys (scheduled, expired, blocked-by-group) are
  // never stored.
  for (const table of ['tale_groups', 'tales']) {
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = 'status'
        ) THEN
          ALTER TABLE ${table} ADD COLUMN status text NOT NULL DEFAULT 'live'
            CONSTRAINT ${table}_status_check
            CHECK (status IN (${STORED_STATUSES.map((s) => `'${s}'`).join(', ')}));
          ALTER TABLE ${table} ALTER COLUMN status SET DEFAULT 'draft';
        END IF;
      END
      $$;
    `);
  }

  // An optional start and end time (AD-6), in UTC. Live content is delivered
  // only inside its window; `scheduled` and `expired` are computed from it
  // when content is read, never stored. Existing rows get no window. The
  // CHECK is added once, guarded by its name, so a second run changes nothing.
  for (const table of ['tale_groups', 'tales']) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS starts_at timestamptz`);
    await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ends_at timestamptz`);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = '${table}_window_check' AND conrelid = '${table}'::regclass
        ) THEN
          ALTER TABLE ${table} ADD CONSTRAINT ${table}_window_check
            CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
        END IF;
      END
      $$;
    `);
  }

  // A tale group's optional cover, still or animated (epic web zones R12): the
  // storage key and uploaded content type, never a path or URL (AD-11), and
  // whether it moves, decided from the bytes when it was uploaded. A cover
  // key may be shared by copies (AD-14), so it is looked up by key.
  await db.query('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_key text');
  await db.query('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_content_type text');
  await db.query('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_animated boolean NOT NULL DEFAULT false');
  await db.query('CREATE INDEX IF NOT EXISTS tale_groups_cover_key_idx ON tale_groups (cover_key)');

  // A tale's document (AD-15): versioned JSON, checked on every write, null for a tale that shows
  // its media only. Every save raises the revision by one, and a save based on an older revision
  // is refused, so two editors never overwrite each other silently.
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS document jsonb');
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS document_revision integer NOT NULL DEFAULT 0');
}
