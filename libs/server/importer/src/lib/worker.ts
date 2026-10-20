import type { ImportReport } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import { createZone, zoneExists } from '@taleart/server-zones';
import { decryptToken } from './crypto';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { claimNextJob, failImportJob, finishImportJob, requeueRunningJobs, setSourceAppName, type ClaimedJob } from './jobs';
import { findLinkTarget, saveLink } from './links';
import { StorylyClient, type SourceInstance } from './storyly-client';

/** How often an idle worker looks for queued jobs (AD-8). */
export const IMPORT_POLL_INTERVAL_MS = 2000;

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
}

/** A failure whose message is written for the person who started the import. */
class ImportFailure extends Error {}

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
 * decision), through the zones module (AD-8), and links it (AD-7). An instance
 * already linked to a zone that still exists is not created again; it counts
 * as imported, so a re-run makes no duplicates. A repeated id is skipped.
 */
export async function importZones(
  db: TransactionalDb,
  projectId: string,
  instances: readonly SourceInstance[],
): Promise<ImportReport> {
  const report: ImportReport = { zones: { source: instances.length, imported: 0, skipped: 0 }, notes: [] };
  const seen = new Set<string>();
  for (const instance of instances) {
    if (seen.has(instance.id)) {
      report.zones.skipped++;
      continue;
    }
    seen.add(instance.id);
    const name = instance.name.trim() || `Instance ${instance.id}`;
    const source = { projectId, sourceType: 'instance', sourceId: instance.id };
    await inTransaction(db, async (tx) => {
      const linked = await findLinkTarget(tx, source);
      if (linked !== null && (await zoneExists(tx, linked))) return;
      const zone = await createZone(tx, { name, projectId });
      await saveLink(tx, { ...source, targetType: 'zone', targetId: zone.id });
    });
    report.zones.imported++;
    // The source names no widget type, so the zone has no frame yet (epic decision).
    report.notes.push(`Zone "${name}": frame type unknown`);
  }
  return report;
}

// The message stored on a failed job: ours for known failures, a generic one
// otherwise. The token never appears in it.
function failureMessage(err: unknown, token: string | null): string {
  const known =
    err instanceof ImportFailure || err instanceof StorylyTokenInvalidError || err instanceof StorylyUnavailableError;
  const message = known ? err.message : 'The import stopped on an internal error. Try again.';
  return token ? message.split(token).join('[token]') : message;
}

/** Runs one claimed job to done or failed. It never throws for a job's own failure. */
export async function runImportJob(db: TransactionalDb, job: ClaimedJob, options: ImportRunOptions): Promise<void> {
  const log = options.log ?? noLog;
  let token: string | null = null;
  try {
    if (!job.tokenCiphertext) throw new ImportFailure('The Storyly token is no longer stored. Start the import again.');
    try {
      token = decryptToken(job.tokenCiphertext, options.tokenKey);
    } catch {
      throw new ImportFailure('The stored Storyly token could not be read. Start the import again.');
    }
    const client = new StorylyClient({ baseUrl: options.storylyApiUrl, token, fetch: options.fetch });
    const app = (await client.listApps()).find((a) => a.id === job.sourceAppId);
    if (!app) throw new ImportFailure('This Storyly token cannot read the chosen app.');
    await setSourceAppName(db, job.id, app.name);
    const instances = await client.listInstances(app.id);
    const report = await importZones(db, job.projectId, instances);
    await finishImportJob(db, job.id, report);
    log('info', `Import ${job.id} done: ${report.zones.imported} of ${report.zones.source} zones`);
  } catch (err) {
    const message = failureMessage(err, token);
    if (!(err instanceof ImportFailure || err instanceof StorylyTokenInvalidError || err instanceof StorylyUnavailableError)) {
      log('error', `Import ${job.id} failed`, err instanceof Error ? new Error(failureMessage(err, token)) : undefined);
    }
    await failImportJob(db, job.id, message);
  }
}

/** A running import worker. */
export interface ImportWorker {
  /** Looks for queued jobs now instead of at the next poll. */
  wake(): void;
  /** Stops polling and waits for the job in progress, if any. */
  stop(): Promise<void>;
}

/**
 * Starts the import worker inside the API process (AD-8). It first puts jobs a
 * stopped process left running back in the queue, then claims queued jobs one
 * at a time, polling every {@link IMPORT_POLL_INTERVAL_MS} when idle.
 */
export function startImportWorker(
  db: TransactionalDb,
  options: ImportRunOptions & { pollIntervalMs?: number },
): ImportWorker {
  const log = options.log ?? noLog;
  const interval = options.pollIntervalMs ?? IMPORT_POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drain = async (): Promise<void> => {
    timer = undefined;
    try {
      while (!stopped) {
        const job = await claimNextJob(db);
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

  let current: Promise<void> = (async () => {
    try {
      const requeued = await requeueRunningJobs(db);
      if (requeued > 0) log('info', `Re-queued ${requeued} import job(s) left running`);
    } catch (err) {
      log('error', 'Import worker could not re-queue running jobs', err);
    }
    await drain();
  })();

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
