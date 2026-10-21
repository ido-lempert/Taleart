import type { Db } from '@taleart/server-access';
import { recordTaleFonts } from './project-fonts';
import { checkTaleDocument } from './tale-document';

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

  // The draft document (user decision 2026-10-22): Tale Studio edits and autosaves the draft, and
  // `document` above is the published one, which the Delivery API serves, so saving never changes
  // what visitors see. Each has its own revision. A tale whose draft was never written (every tale
  // before the draft existed) gets its published document as its draft, at the same revision.
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS draft_document jsonb');
  await db.query('ALTER TABLE tales ADD COLUMN IF NOT EXISTS draft_revision integer NOT NULL DEFAULT 0');
  await db.query(
    `UPDATE tales SET draft_document = document, draft_revision = document_revision
     WHERE draft_document IS NULL AND document IS NOT NULL`,
  );

  // Project fonts (epic Tale Studio R18, AD-15): a WOFF2 face uploaded to one project (AD-4), its
  // file through the storage port by key (AD-11), and the uploader's confirmation that they may use
  // and distribute it, kept with their id and name and the time. The uploader is not a foreign key,
  // so the confirmation stays when the user is removed. A project has one face per family (in any
  // letter case), weight and style.
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_fonts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      family text NOT NULL CHECK (char_length(family) BETWEEN 1 AND 100),
      weight integer NOT NULL CHECK (weight BETWEEN 100 AND 900 AND weight % 100 = 0),
      style text NOT NULL CHECK (style IN ('normal', 'italic')),
      fallback text NOT NULL CHECK (fallback IN ('sans', 'serif', 'rounded', 'monospace')),
      storage_key text NOT NULL UNIQUE,
      size_bytes integer NOT NULL CHECK (size_bytes > 0),
      uploaded_by uuid,
      uploaded_by_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS project_fonts_face_key ON project_fonts (project_id, lower(family), weight, style)',
  );

  // Which tale's draft or published document references which project font, written in the same
  // transaction as the document, so "in use", deletion and the public lookup read this, not the
  // documents. A published row is `delivered` when a visible element uses the font and the
  // document passed the document check. The font key is restrictive: a referenced font cannot go.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_fonts (
      tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE,
      font_id uuid NOT NULL REFERENCES project_fonts(id),
      document text NOT NULL CHECK (document IN ('draft', 'published')),
      project_id uuid NOT NULL REFERENCES projects(id),
      delivered boolean NOT NULL DEFAULT false,
      PRIMARY KEY (tale_id, document, font_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tale_fonts_font_id_idx ON tale_fonts (font_id, document)');
  await db.query('CREATE INDEX IF NOT EXISTS tales_project_id_idx ON tales (project_id)');

  // Documents written before `tale_fonts` existed get their rows once: tales whose draft or
  // published document names a project font and that have none recorded.
  const { rows } = await db.query<{ id: string; document: unknown; draft: unknown }>(
    `SELECT id, document, draft_document AS draft FROM tales t
     WHERE (document @> $1::jsonb OR draft_document @> $1::jsonb)
       AND NOT EXISTS (SELECT 1 FROM tale_fonts tf WHERE tf.tale_id = t.id)`,
    [JSON.stringify({ elements: [{ props: { font: { source: 'project' } } }] })],
  );
  for (const row of rows) {
    await recordTaleFonts(db, row.id, 'draft', row.draft, false);
    await recordTaleFonts(db, row.id, 'published', row.document, isValidDocument(row.document));
  }

  // A project's media uploaded in Tale Studio (epic Tale Studio R5, AD-11): its file through the
  // storage port by key (`media/<uuid>.<ext>`), the type its bytes were checked as, and who uploaded
  // it (not a foreign key, so the row stays when the user is removed). Tale documents reference it
  // by key; it is never deleted while anything could reference it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      storage_key text NOT NULL UNIQUE,
      content_type text NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes > 0),
      uploaded_by uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS project_media_project_id_idx ON project_media (project_id, created_at)');

  // Which tale's draft or published document references which media key, for the tale's project,
  // written in the same transaction as the document (as tale_fonts), so a key's project, "in use"
  // and the public lookup read this, not the documents. A published row is `delivered` when a
  // visible element or the background uses the key and the document passed the document and
  // publish checks. No document held media before this table, so nothing is backfilled.
  await db.query(`
    CREATE TABLE IF NOT EXISTS tale_media (
      tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE,
      storage_key text NOT NULL,
      document text NOT NULL CHECK (document IN ('draft', 'published')),
      project_id uuid NOT NULL REFERENCES projects(id),
      content_type text NOT NULL,
      delivered boolean NOT NULL DEFAULT false,
      PRIMARY KEY (tale_id, document, storage_key)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS tale_media_storage_key_idx ON tale_media (storage_key, document)');
  await db.query('CREATE INDEX IF NOT EXISTS tale_media_project_id_idx ON tale_media (project_id, storage_key)');
}

// True when a stored document passes the document check, as the Delivery API requires.
function isValidDocument(doc: unknown): boolean {
  try {
    checkTaleDocument(doc);
    return true;
  } catch {
    return false;
  }
}
