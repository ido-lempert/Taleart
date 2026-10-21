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

  // Which stored media file came from which source story (AD-7, AD-11): a
  // re-import finds the tale still holding it and copies nothing again. The
  // tale itself holds the key (the tales module); this row only says the
  // import put it there, and the bytes' SHA-256 for a later update check.
  await db.query(`
    CREATE TABLE IF NOT EXISTS import_media (
      project_id uuid NOT NULL REFERENCES projects(id),
      source_system text NOT NULL CHECK (source_system IN ('storyly')),
      source_id text NOT NULL,
      tale_id uuid NOT NULL,
      media_key text NOT NULL,
      content_type text NOT NULL,
      content_sha256 text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, source_system, source_id)
    );
  `);
}
