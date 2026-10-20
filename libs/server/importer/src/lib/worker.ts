import { randomUUID } from 'node:crypto';
import { MAX_TALES_PER_GROUP, type ImportCount, type ImportReport } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import {
  createTale,
  createTaleGroup,
  taleExists,
  taleGroupExists,
  TaleGroupFullError,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import { createZone, zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
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
import { findLinkTarget, lockLinkSource, saveLink, type LinkSource } from './links';
import {
  StorylyClient,
  type SourceInstance,
  type SourceOrderedRecord,
  type SourceStory,
  type SourceStoryGroup,
} from './storyly-client';

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

/** Reads an instance's story groups and a group's stories; the Storyly client in the worker. */
export interface ContentSource {
  listStoryGroups(instanceId: string): Promise<SourceStoryGroup[]>;
  listStories(storyGroupId: string): Promise<SourceStory[]>;
}

/** A link appeared while this import was creating the record: roll the creation back. */
class AlreadyLinkedError extends Error {}

const emptyCount = () => ({ source: 0, imported: 0, skipped: 0 });

/**
 * The records in source order: ascending `sort_order`, ties in response
 * order, then the records without a usable `sort_order` in response order.
 */
function inSourceOrder<T extends SourceOrderedRecord>(records: readonly T[]): T[] {
  const ordered = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.sortOrder !== null)
    .sort((a, b) => (a.record.sortOrder as number) - (b.record.sortOrder as number) || a.index - b.index)
    .map(({ record }) => record);
  return [...ordered, ...records.filter((record) => record.sortOrder === null)];
}

const NO_POSITION = 'no source position, placed after the others';

// A blank source title gets a neutral name; the source id never becomes one (AD-7).
const groupName = (group: SourceStoryGroup): string => group.name.trim() || 'Untitled tale group';
// A story without a title shows its group's title at the source.
const taleTitle = (story: SourceStory, group: string): string => story.name.trim() || group;

/**
 * Imports one instance as a zone of the project, without a frame (epic
 * decision), through the zones module (AD-8), and links it (AD-7). The
 * instance is locked by its source key first, so concurrent imports of the
 * same app cannot both create it. An instance already linked is not created
 * again. Returns the zone's id, or null when its earlier zone is gone (a link
 * is never re-pointed).
 */
async function importZone(
  db: TransactionalDb,
  projectId: string,
  instance: SourceInstance,
  name: string,
): Promise<string | null> {
  const source = { projectId, sourceType: 'instance', sourceId: instance.id };
  return inTransaction(db, async (tx) => {
    await lockLinkSource(tx, source);
    const linked = await findLinkTarget(tx, source);
    if (linked !== null) return (await zoneExists(tx, linked)) ? linked : null;
    const zone = await createZone(tx, { name, projectId });
    await saveLink(tx, { ...source, targetType: 'zone', targetId: zone.id });
    return zone.id;
  });
}

/**
 * Creates a record through another module and links it (AD-7), unless it is
 * linked already. `create` runs the module's create call with `link` as its
 * in-transaction callback: the link is saved in the creation's transaction,
 * after locking the source key and checking again, so a record and its link
 * commit together and concurrent imports create it once. Returns the linked
 * record's id and whether this call created it, or null when the linked record
 * no longer exists.
 */
async function importLinked(
  db: TransactionalDb,
  source: LinkSource,
  targetType: string,
  exists: (id: string) => Promise<boolean>,
  create: (link: (tx: Db, targetId: string) => Promise<void>) => Promise<unknown>,
): Promise<{ id: string; created: boolean } | null> {
  for (;;) {
    const linked = await findLinkTarget(db, source);
    if (linked !== null) return (await exists(linked)) ? { id: linked, created: false } : null;
    let createdId = '';
    try {
      await create(async (tx, targetId) => {
        await lockLinkSource(tx, source);
        if ((await findLinkTarget(tx, source)) !== null) throw new AlreadyLinkedError();
        await saveLink(tx, { ...source, targetType, targetId });
        createdId = targetId;
      });
    } catch (err) {
      // Another import linked it meanwhile: its record stands, so read the link again.
      if (err instanceof AlreadyLinkedError) continue;
      throw err;
    }
    // create resolved, so its callback ran and set the id.
    return { id: createdId, created: true };
  }
}

/**
 * Imports the app's content into the project: each instance as a zone, its
 * story groups as tale groups placed in that zone, and their stories as tales
 * (title only; media is a later story), in source order, through the zones and
 * tales modules (AD-8, AD-14). Every record is linked (AD-7), so a re-run
 * creates nothing twice: a linked record counts as imported while it exists,
 * else as skipped. A repeated source id is skipped, and so are the stories of
 * a group that is skipped; each unique story counts once, so source = imported
 * + skipped. A record without a source position is noted when it is created.
 * `beforeEach` runs before each record is written; the worker refreshes its
 * heartbeat there.
 */
export async function importContent(
  db: TransactionalDb,
  projectId: string,
  instances: readonly SourceInstance[],
  source: ContentSource,
  beforeEach: () => Promise<void> = async () => undefined,
): Promise<ImportReport> {
  const report: Required<ImportReport> = {
    zones: { ...emptyCount(), source: instances.length },
    taleGroups: emptyCount(),
    tales: emptyCount(),
    notes: [],
  };
  const seenInstances = new Set<string>();
  const seenGroups = new Set<string>();
  const seenStories = new Set<string>();
  for (const instance of instances) {
    if (seenInstances.has(instance.id)) {
      report.zones.skipped++;
      continue;
    }
    seenInstances.add(instance.id);
    await beforeEach();
    const zoneName = instance.name.trim() || `Instance ${instance.id}`;
    const zoneId = await importZone(db, projectId, instance, zoneName);
    if (zoneId === null) {
      report.zones.skipped++;
      report.notes.push(`Zone "${zoneName}": its earlier import was deleted, so it was not imported again`);
    } else {
      report.zones.imported++;
      // The source names no widget type, so the zone has no frame yet (epic decision).
      report.notes.push(`Zone "${zoneName}": frame type unknown`);
    }

    const groups = inSourceOrder(await source.listStoryGroups(instance.id));
    report.taleGroups.source += groups.length;
    let groupsWithoutZone = 0;
    for (const group of groups) {
      if (seenGroups.has(group.id)) {
        report.taleGroups.skipped++;
        continue;
      }
      seenGroups.add(group.id);
      const name = groupName(group);
      const stories = await source.listStories(group.id);
      report.tales.source += stories.length;
      // The group is skipped: so is each of its stories, once.
      const skipGroup = (note?: string) => {
        report.taleGroups.skipped++;
        report.tales.skipped += stories.length;
        for (const story of stories) seenStories.add(story.id);
        if (note) report.notes.push(note);
      };
      if (zoneId === null) {
        groupsWithoutZone++;
        skipGroup();
        continue;
      }
      await beforeEach();
      let taleGroup: { id: string; created: boolean } | null;
      try {
        taleGroup = await importLinked(
          db,
          { projectId, sourceType: 'story_group', sourceId: group.id },
          'tale_group',
          (id) => taleGroupExists(db, id),
          (link) => createTaleGroup(db, { zoneId, name }, (tx, created) => link(tx, created.taleGroupId)),
        );
      } catch (err) {
        if (!(err instanceof ZoneNotFoundError)) throw err;
        skipGroup(`Tale group "${name}": its zone was deleted during the import`);
        continue;
      }
      if (taleGroup === null) {
        skipGroup(`Tale group "${name}": its earlier import was deleted, so it was not imported again`);
        continue;
      }
      report.taleGroups.imported++;
      if (taleGroup.created && group.sortOrder === null) report.notes.push(`Tale group "${name}": ${NO_POSITION}`);
      const taleGroupId = taleGroup.id;

      for (const story of inSourceOrder(stories)) {
        if (seenStories.has(story.id)) {
          report.tales.skipped++;
          continue;
        }
        seenStories.add(story.id);
        const title = taleTitle(story, name);
        await beforeEach();
        let tale: { id: string; created: boolean } | null;
        try {
          tale = await importLinked(
            db,
            { projectId, sourceType: 'story', sourceId: story.id },
            'tale',
            (id) => taleExists(db, id),
            (link) => createTale(db, { taleGroupId, title }, (tx, created) => link(tx, created.taleId)),
          );
        } catch (err) {
          if (err instanceof TaleGroupFullError) {
            report.tales.skipped++;
            report.notes.push(`Tale "${title}" in "${name}": the tale group already holds ${MAX_TALES_PER_GROUP} tales`);
            continue;
          }
          if (err instanceof TaleGroupNotFoundError) {
            report.tales.skipped++;
            report.notes.push(`Tale "${title}" in "${name}": its tale group was deleted during the import`);
            continue;
          }
          throw err;
        }
        if (tale === null) {
          report.tales.skipped++;
          report.notes.push(`Tale "${title}" in "${name}": its earlier import was deleted, so it was not imported again`);
          continue;
        }
        report.tales.imported++;
        if (tale.created && story.sortOrder === null) report.notes.push(`Tale "${title}" in "${name}": ${NO_POSITION}`);
      }
    }
    if (groupsWithoutZone > 0) {
      report.notes.push(
        `Zone "${zoneName}": its ${groupsWithoutZone} tale group(s) were not imported, since the zone was not`,
      );
    }
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
    const report = await importContent(db, job.projectId, instances, client, beat);
    if (!(await finishImportJob(db, job, report))) throw new ClaimLostError();
    const count = (name: string, c: ImportCount | undefined) => `${c?.imported ?? 0} of ${c?.source ?? 0} ${name}`;
    log(
      'info',
      `Import ${job.id} done: ${count('zones', report.zones)}, ${count('tale groups', report.taleGroups)}, ` +
        count('tales', report.tales),
    );
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
