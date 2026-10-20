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
}
