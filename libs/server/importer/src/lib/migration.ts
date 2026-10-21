import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the tables the importer module owns. Runs last,
 * after every module whose records an import creates.
 */
export async function migrateImporter(db: Db): Promise<void> {
  // One import of one source app into one project (AD-8). The source token is
  // kept encrypted only while the job is queued or running; ending the job clears it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      source_app_id text NOT NULL,
      source_app_name text,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
      token_ciphertext text,
      report jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      finished_at timestamptz,
      CHECK (status IN ('queued', 'running') OR token_ciphertext IS NULL)
    );
  `);
  // A running job's owner and liveness: the worker that claimed it, the last
  // sign of life of its runner, and how many times it was claimed. Only a job
  // whose heartbeat stopped is recovered; only its owner may write it.
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS locked_by text');
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz');
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0');
  // How far a job got per entity type, written by its runner while it runs (R5).
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS progress jsonb');
  // What the admin picked to import: zones by source id and entity types; NULL takes everything.
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS selection jsonb');
  // When a worker first claimed the job; kept when a recovered job runs again, so the report's elapsed time
  // covers every run of it (story 10).
  await db.query('ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS first_started_at timestamptz');
  // Jobs started before the column: their last start is the best known first one.
  await db.query(
    'UPDATE import_jobs SET first_started_at = started_at WHERE first_started_at IS NULL AND started_at IS NOT NULL',
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS import_jobs_queued_idx ON import_jobs (created_at) WHERE status = 'queued'",
  );
  await db.query('CREATE INDEX IF NOT EXISTS import_jobs_project_id_idx ON import_jobs (project_id, created_at)');

  // Source ids live only here (AD-7): which TaleArt record a source record became.
  // A re-import finds the record through its link instead of creating it again.
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_links (
      project_id uuid NOT NULL REFERENCES projects(id),
      source_system text NOT NULL CHECK (source_system IN ('storyly')),
      source_type text NOT NULL,
      source_id text NOT NULL,
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (project_id, source_system, source_type, source_id)
    );
  `);

  // Which stored media file an import put on which tale (AD-11), keyed by the
  // tale: the story it came from is known only through import_links (AD-7). A
  // re-import finds the tale still holding that key and copies nothing again;
  // the bytes' SHA-256 is kept for a later update check. An unreleased first
  // shape of this table, keyed by source id, is dropped.
  await db.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_media' AND column_name = 'source_id') THEN
        DROP TABLE import_media;
      END IF;
    END $$;
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_media (
      tale_id uuid PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES projects(id),
      media_key text NOT NULL,
      content_type text NOT NULL,
      content_sha256 text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS import_media_media_key_idx ON import_media (media_key)');
  // A fingerprint of the source media (SHA-256 of its URL and type), so a re-import downloads only media
  // that changed at the source; the URL itself is never stored. NULL for media copied before re-imports.
  await db.query('ALTER TABLE import_media ADD COLUMN IF NOT EXISTS source_digest text');

  // The source app a link came from, so a re-import of that app can tell which of its records the source
  // no longer lists. NULL for links saved before re-imports; filled when the record is seen again.
  await db.query('ALTER TABLE import_links ADD COLUMN IF NOT EXISTS source_app_id text');
  await db.query(
    'CREATE INDEX IF NOT EXISTS import_links_app_idx ON import_links (project_id, source_system, source_app_id)',
  );

  // What an import last wrote to each record it holds, in TaleArt terms (names, orders as TaleArt ids, tag
  // names), keyed by the TaleArt record: never a source id (AD-7). A re-import compares the current record
  // with it to tell a person's edit (kept) from a value nobody changed (updated from the source).
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_records (
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects(id),
      fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (target_type, target_id)
    );
  `);
}
