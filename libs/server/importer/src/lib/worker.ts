import { randomUUID } from 'node:crypto';
import type { ImportReport } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import { createZone, zoneExists } from '@taleart/server-zones';
import { decryptToken } from './crypto';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import {
  claimNextJob,
  failImportJob,
  finishImportJob,
  heartbeatImportJob,
  recoverStaleJobs,
  setSourceAppName,
  type ClaimedJob,
} from './jobs';
import { findLinkTarget, lockLinkSource, saveLink } from './links';
import { StorylyClient, type SourceInstance } from './storyly-client';

/** How often an idle worker looks for queued jobs (AD-8). */
export const IMPORT_POLL_INTERVAL_MS = 2000;
/** How often a runner refreshes its job's heartbeat. */
export const IMPORT_HEARTBEAT_MS = 15_000;
/** A running job without a heartbeat for this long has lost its runner and is recovered. */
export const IMPORT_STALE_AFTER_MS = 2 * 60_000;
/** A job whose runner stopped this many times fails instead of running again. */
export const IMPORT_MAX_ATTEMPTS = 3;

/** Writes one structured log line; the API passes its JSON logger. */
export type ImportLog = (level: 'info' | 'error', msg: string, err?: unknown) => void;

/** What the worker needs to run a job. */
export interface ImportRunOptions {
  /** Decrypts the stored source token (IMPORT_TOKEN_KEY). */
  tokenKey: Buffer;
  /** Base URL of the Storyly External API (STORYLY_API_URL). */
  storylyApiUrl: string;
  /** Tests may pass their own fetch. */
  fetch?: typeof fetch;
  log?: ImportLog;
  /** How often the runner refreshes the heartbeat; {@link IMPORT_HEARTBEAT_MS} by default. */
  heartbeatMs?: number;
}

/** A failure whose message is written for the person who started the import. */
class ImportFailure extends Error {}

/** This worker no longer holds the job (another worker recovered it): stop without writing. */
class ClaimLostError extends Error {}

const noLog: ImportLog = () => undefined;

// Runs `work` in one transaction on one connection; rolls back on any error.
async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    tx.release();
    return result;
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
 * Imports each instance as a zone of the project, without a frame (epic
 * decision), through the zones module (AD-8), and links it (AD-7). Each
 * instance is locked by its source key first, so concurrent imports of the
 * same app cannot both create it. An instance already linked is not created
 * again: it counts as imported while its zone exists, else as skipped (a link
 * is never re-pointed). A repeated id is skipped. `beforeEach` runs before
 * each instance; the worker refreshes its heartbeat there.
 */
export async function importZones(
  db: TransactionalDb,
  projectId: string,
  instances: readonly SourceInstance[],
  beforeEach: () => Promise<void> = async () => undefined,
): Promise<ImportReport> {
  const report: ImportReport = { zones: { source: instances.length, imported: 0, skipped: 0 }, notes: [] };
  const seen = new Set<string>();
  for (const instance of instances) {
    if (seen.has(instance.id)) {
      report.zones.skipped++;
      continue;
    }
    seen.add(instance.id);
    await beforeEach();
    const name = instance.name.trim() || `Instance ${instance.id}`;
    const source = { projectId, sourceType: 'instance', sourceId: instance.id };
    const outcome = await inTransaction(db, async (tx) => {
      await lockLinkSource(tx, source);
      const linked = await findLinkTarget(tx, source);
      if (linked !== null) return (await zoneExists(tx, linked)) ? 'imported' : 'gone';
      const zone = await createZone(tx, { name, projectId });
      await saveLink(tx, { ...source, targetType: 'zone', targetId: zone.id });
      return 'imported';
    });
    if (outcome === 'gone') {
      report.zones.skipped++;
      report.notes.push(`Zone "${name}": its earlier import was deleted, so it was not imported again`);
      continue;
    }
    report.zones.imported++;
    // The source names no widget type, so the zone has no frame yet (epic decision).
    report.notes.push(`Zone "${name}": frame type unknown`);
  }
  return report;
}

const isKnownFailure = (err: unknown): err is Error =>
  err instanceof ImportFailure || err instanceof StorylyTokenInvalidError || err instanceof StorylyUnavailableError;

const redact = (text: string, token: string | null): string => (token ? text.split(token).join('[token]') : text);

// The message stored on a failed job: ours for known failures, a generic one
// otherwise. The token never appears in it.
function failureMessage(err: unknown, token: string | null): string {
  return redact(isKnownFailure(err) ? err.message : 'The import stopped on an internal error. Try again.', token);
}

// The original error for the log, with the token removed from its message and stack.
function redactedError(err: unknown, token: string | null): Error {
  if (!(err instanceof Error)) return new Error(redact(String(err), token));
  const copy = new Error(redact(err.message, token));
  copy.name = err.name;
  copy.stack = err.stack === undefined ? undefined : redact(err.stack, token);
  return copy;
}

/**
 * Runs one claimed job to done or failed. It never throws for a job's own
 * failure. Every write checks that this worker still holds the job, and the
 * heartbeat is refreshed while it runs; when the claim is lost, it stops
 * without writing anything more.
 */
export async function runImportJob(db: TransactionalDb, job: ClaimedJob, options: ImportRunOptions): Promise<void> {
  const log = options.log ?? noLog;
  let token: string | null = null;
  const beat = async () => {
    if (!(await heartbeatImportJob(db, job))) throw new ClaimLostError();
  };
  const timer = setInterval(() => {
    beat().catch(() => undefined);
  }, options.heartbeatMs ?? IMPORT_HEARTBEAT_MS);
  timer.unref?.();
  try {
    await beat();
    if (!job.tokenCiphertext) throw new ImportFailure('The Storyly token is no longer stored. Start the import again.');
    try {
      token = decryptToken(job.tokenCiphertext, options.tokenKey);
    } catch {
      throw new ImportFailure('The stored Storyly token could not be read. Start the import again.');
    }
    const client = new StorylyClient({ baseUrl: options.storylyApiUrl, token, fetch: options.fetch });
    const app = (await client.listApps()).find((a) => a.id === job.sourceAppId);
    if (!app) throw new ImportFailure('This Storyly token cannot read the chosen app.');
    if (!(await setSourceAppName(db, job, app.name))) throw new ClaimLostError();
    const instances = await client.listInstances(app.id);
    const report = await importZones(db, job.projectId, instances, beat);
    if (!(await finishImportJob(db, job, report))) throw new ClaimLostError();
    log('info', `Import ${job.id} done: ${report.zones.imported} of ${report.zones.source} zones`);
  } catch (err) {
    if (err instanceof ClaimLostError) {
      log('info', `Import ${job.id} was taken over by another worker; this run stopped`);
      return;
    }
    if (!isKnownFailure(err)) log('error', `Import ${job.id} failed`, redactedError(err, token));
    try {
      await failImportJob(db, job, failureMessage(err, token));
    } catch (writeErr) {
      // The job stays running with its token; its heartbeat stops, so a worker recovers it.
      log('error', `Import ${job.id} failed and its failure could not be recorded`, redactedError(writeErr, token));
    }
  } finally {
    clearInterval(timer);
  }
}

/** A running import worker. */
export interface ImportWorker {
  /** Looks for queued jobs now instead of at the next poll. */
  wake(): void;
  /** Stops polling and waits for the job in progress, if any. */
  stop(): Promise<void>;
}

/** Worker timing; tests shorten it. */
export interface ImportWorkerOptions extends ImportRunOptions {
  pollIntervalMs?: number;
  staleAfterMs?: number;
  maxAttempts?: number;
  /** Identifies this worker's claims; a new random id by default. */
  workerId?: string;
}

/**
 * Starts the import worker inside the API process (AD-8). On every poll it
 * recovers running jobs whose heartbeat stopped (re-queued, or failed after
 * {@link IMPORT_MAX_ATTEMPTS} claims), then claims queued jobs one at a time,
 * polling every {@link IMPORT_POLL_INTERVAL_MS} when idle.
 */
export function startImportWorker(db: TransactionalDb, options: ImportWorkerOptions): ImportWorker {
  const log = options.log ?? noLog;
  const interval = options.pollIntervalMs ?? IMPORT_POLL_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? IMPORT_STALE_AFTER_MS;
  const maxAttempts = options.maxAttempts ?? IMPORT_MAX_ATTEMPTS;
  const workerId = options.workerId ?? randomUUID();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = async (): Promise<void> => {
    timer = undefined;
    try {
      const recovered = await recoverStaleJobs(db, staleAfterMs, maxAttempts);
      if (recovered.requeued > 0) log('info', `Re-queued ${recovered.requeued} import job(s) whose runner stopped`);
      if (recovered.failed > 0) log('info', `Failed ${recovered.failed} import job(s) that stopped too many times`);
      while (!stopped) {
        const job = await claimNextJob(db, workerId);
        if (!job) break;
        await runImportJob(db, job, options);
      }
    } catch (err) {
      log('error', 'Import worker could not poll for jobs', err);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        current = drain();
      }, interval);
      timer.unref?.();
    }
  };

  let current: Promise<void> = drain();

  return {
    wake() {
      if (stopped || timer === undefined) return;
      clearTimeout(timer);
      current = drain();
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await current;
    },
  };
}
