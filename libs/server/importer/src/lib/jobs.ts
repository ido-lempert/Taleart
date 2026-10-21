import type { ImportJob, ImportJobSummary, ImportProgress, ImportReport, ImportStarted } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUMMARY_COLUMNS = `id, status, source_app_name AS "sourceAppName", error,
  created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"`;
const JOB_COLUMNS = `${SUMMARY_COLUMNS}, report, progress`;

/** How many of a project's imports its list holds, newest first. */
export const IMPORT_LIST_LIMIT = 50;

/** A job the worker has claimed: what it needs to run it. */
export interface ClaimedJob {
  id: string;
  projectId: string;
  sourceAppId: string;
  tokenCiphertext: string | null;
  /** The worker that claimed it; every later write on the job checks it. */
  lockedBy: string;
}

// Only the worker holding the claim may write a running job.
const OWNED = "id = $1 AND status = 'running' AND locked_by = $2";

type Timed<T> = Omit<T, 'createdAt' | 'startedAt' | 'finishedAt'> & {
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

// Times as ISO 8601 UTC strings (spine convention).
function withTimes<T extends ImportJobSummary>(row: Timed<T>): T {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  } as T;
}

/** Progress as the report counts it: read is the source count so far, written the imported count. */
export function progressOf(report: ImportReport): ImportProgress {
  const count = (c: ImportReport['zones'] | undefined) => ({ read: c?.source ?? 0, written: c?.imported ?? 0 });
  return { zones: count(report.zones), taleGroups: count(report.taleGroups), tales: count(report.tales) };
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
  return rows[0] ? withTimes<ImportJob>(rows[0]) : null;
}

/**
 * The project's import jobs, newest first, at most {@link IMPORT_LIST_LIMIT},
 * without reports or tokens. The caller checks the project.
 */
export async function listImportJobs(db: Db, projectId: string): Promise<ImportJobSummary[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLUMNS} FROM import_jobs WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [projectId, IMPORT_LIST_LIMIT],
  );
  return rows.map((row) => withTimes<ImportJobSummary>(row));
}

/**
 * Claims the oldest queued job for `workerId` and marks it running with a
 * fresh heartbeat (AD-8). Several workers can poll at once: a job another
 * worker holds is skipped, never run twice.
 */
export async function claimNextJob(db: TransactionalDb, workerId: string): Promise<ClaimedJob | null> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const { rows } = await tx.query<ClaimedJob>(
      `UPDATE import_jobs
       SET status = 'running', started_at = now(), locked_by = $1, heartbeat_at = now(), attempts = attempts + 1,
         progress = NULL
       WHERE id = (
         SELECT id FROM import_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, project_id AS "projectId", source_app_id AS "sourceAppId",
         token_ciphertext AS "tokenCiphertext", locked_by AS "lockedBy"`,
      [workerId],
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

/**
 * Recovers running jobs whose runner stopped: no heartbeat for `staleAfterMs`.
 * A job claimed `maxAttempts` times already fails, with its token deleted; the
 * others go back to the queue. A job whose runner is alive is left alone.
 * Returns how many were re-queued and failed.
 */
export async function recoverStaleJobs(
  db: Db,
  staleAfterMs: number,
  maxAttempts: number,
): Promise<{ requeued: number; failed: number }> {
  const stale = "status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - $1 * interval '1 millisecond')";
  const failed = await db.query(
    `UPDATE import_jobs
     SET status = 'failed', error = 'The import stopped unexpectedly too many times. Start it again.',
       token_ciphertext = NULL, locked_by = NULL, finished_at = now()
     WHERE ${stale} AND attempts >= $2`,
    [staleAfterMs, maxAttempts],
  );
  const requeued = await db.query(
    `UPDATE import_jobs SET status = 'queued', locked_by = NULL, heartbeat_at = NULL, started_at = NULL, progress = NULL
     WHERE ${stale}`,
    [staleAfterMs],
  );
  return { requeued: requeued.rowCount ?? 0, failed: failed.rowCount ?? 0 };
}

/**
 * Refreshes the job's heartbeat and, when given, its progress. False when this
 * worker no longer holds the job.
 */
export async function heartbeatImportJob(db: Db, job: ClaimedJob, progress?: ImportProgress): Promise<boolean> {
  const { rowCount } =
    progress === undefined
      ? await db.query(`UPDATE import_jobs SET heartbeat_at = now() WHERE ${OWNED}`, [job.id, job.lockedBy])
      : await db.query(`UPDATE import_jobs SET heartbeat_at = now(), progress = $3 WHERE ${OWNED}`, [
          job.id,
          job.lockedBy,
          JSON.stringify(progress),
        ]);
  return (rowCount ?? 0) > 0;
}

/** Records the source app's name, once the worker has read it. False when the claim is lost. */
export async function setSourceAppName(db: Db, job: ClaimedJob, name: string): Promise<boolean> {
  const { rowCount } = await db.query(`UPDATE import_jobs SET source_app_name = $3 WHERE ${OWNED}`, [
    job.id,
    job.lockedBy,
    name,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Ends a job as done with its report and final progress, and deletes its token. False when the claim is lost. */
export async function finishImportJob(db: Db, job: ClaimedJob, report: ImportReport): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE import_jobs SET status = 'done', report = $3, progress = $4, error = NULL, token_ciphertext = NULL,
       locked_by = NULL, finished_at = now()
     WHERE ${OWNED}`,
    [job.id, job.lockedBy, JSON.stringify(report), JSON.stringify(progressOf(report))],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Ends a job as failed with a message, and deletes its token. It keeps how far
 * the job got: `progress` when given, else the last stored one. False when the
 * claim is lost.
 */
export async function failImportJob(
  db: Db,
  job: ClaimedJob,
  message: string,
  progress?: ImportProgress,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE import_jobs SET status = 'failed', error = $3, progress = COALESCE($4::jsonb, progress),
       token_ciphertext = NULL, locked_by = NULL, finished_at = now()
     WHERE ${OWNED}`,
    [job.id, job.lockedBy, message, progress === undefined ? null : JSON.stringify(progress)],
  );
  return (rowCount ?? 0) > 0;
}
