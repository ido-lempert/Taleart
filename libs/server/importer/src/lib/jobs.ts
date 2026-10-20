import type { ImportJob, ImportReport, ImportStarted } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const JOB_COLUMNS = `id, status, source_app_name AS "sourceAppName", report, error,
  created_at AS "createdAt", finished_at AS "finishedAt"`;

/** A job the worker has claimed: what it needs to run it. */
export interface ClaimedJob {
  id: string;
  projectId: string;
  sourceAppId: string;
  tokenCiphertext: string | null;
}

// Times as ISO 8601 UTC strings (spine convention).
function toJob(row: Omit<ImportJob, 'createdAt' | 'finishedAt'> & { createdAt: Date; finishedAt: Date | null }): ImportJob {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

/** Stores a queued import job with its encrypted source token. The caller checks the project. */
export async function createImportJob(
  db: Db,
  input: { projectId: string; createdBy: string; sourceAppId: string; tokenCiphertext: string },
): Promise<ImportStarted> {
  const { rows } = await db.query<ImportStarted>(
    `INSERT INTO import_jobs (project_id, created_by, source_app_id, token_ciphertext)
     VALUES ($1, $2, $3, $4) RETURNING id, status`,
    [input.projectId, input.createdBy, input.sourceAppId, input.tokenCiphertext],
  );
  return rows[0];
}

/** The project's import job with this id, or null. The token is never read here. */
export async function getImportJob(db: Db, projectId: string, importId: string): Promise<ImportJob | null> {
  if (!UUID.test(importId) || !UUID.test(projectId)) return null;
  const { rows } = await db.query(`SELECT ${JOB_COLUMNS} FROM import_jobs WHERE id = $1 AND project_id = $2`, [
    importId,
    projectId,
  ]);
  return rows[0] ? toJob(rows[0]) : null;
}

/**
 * Claims the oldest queued job and marks it running (AD-8). Several workers
 * can poll at once: a job another worker holds is skipped, never run twice.
 */
export async function claimNextJob(db: TransactionalDb): Promise<ClaimedJob | null> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query<ClaimedJob>(
      `UPDATE import_jobs SET status = 'running', started_at = now()
       WHERE id = (
         SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, project_id AS "projectId", source_app_id AS "sourceAppId", token_ciphertext AS "tokenCiphertext"`,
    );
    await tx.query('COMMIT');
    tx.release();
    return rows[0] ?? null;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
}

/** Puts jobs a stopped process left running back in the queue. Returns how many. */
export async function requeueRunningJobs(db: Db): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE import_jobs SET status = 'queued', started_at = NULL WHERE status = 'running'",
  );
  return rowCount ?? 0;
}

/** Records the source app's name, once the worker has read it. */
export async function setSourceAppName(db: Db, jobId: string, name: string): Promise<void> {
  await db.query('UPDATE import_jobs SET source_app_name = $2 WHERE id = $1', [jobId, name]);
}

/** Ends a job as done with its report, and deletes its token. */
export async function finishImportJob(db: Db, jobId: string, report: ImportReport): Promise<void> {
  await db.query(
    `UPDATE import_jobs SET status = 'done', report = $2, error = NULL, token_ciphertext = NULL, finished_at = now()
     WHERE id = $1`,
    [jobId, JSON.stringify(report)],
  );
}

/** Ends a job as failed with a message, and deletes its token. */
export async function failImportJob(db: Db, jobId: string, message: string): Promise<void> {
  await db.query(
    `UPDATE import_jobs SET status = 'failed', error = $2, token_ciphertext = NULL, finished_at = now()
     WHERE id = $1`,
    [jobId, message],
  );
}
