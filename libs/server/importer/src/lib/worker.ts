import { randomUUID } from 'node:crypto';
import {
  IMPORT_NOT_IMPORTED_BY_DESIGN,
  MAX_IMPORT_REPORT_DIFFERENCES,
  MAX_IMPORT_SELECTED_ZONES,
  MAX_TALES_PER_GROUP,
  type ImportChangeCount,
  type ImportChanges,
  type ImportCount,
  type ImportDifference,
  type ImportDifferenceEntity,
  type ImportEntityChoice,
  type ImportMediaFailure,
  type ImportReport,
  type ImportTagFailure,
} from '@taleart/contract';
import type { MediaStorage } from '@taleart/server-storage';
import type { Db, TransactionalDb } from '@taleart/server-access';
import {
  createTale,
  createTaleGroup,
  orderTaleGroupsWhen,
  orderTalesWhen,
  renameTaleGroupWhen,
  renameTaleWhen,
  sweepUnusedFontFiles,
  taleExists,
  taleGroupExists,
  taleGroupName,
  taleTitle as storedTaleTitle,
  TaleGroupFullError,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import { createZone, findZone, renameZoneWhen, zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { decryptToken } from './crypto';
import { isLabelError, LabelImport } from './label-import';
import { groupLabels, labelText, MAX_GROUP_LABELS, MAX_GROUP_TAGS, MAX_LABEL_LIST_ENTRIES } from './labels';
import { InOrder } from './in-order';
import { HostLimiter, Limiter, type RetryPolicy } from './retry';
import { inTransaction } from './transaction';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import {
  claimNextJob,
  failImportJob,
  finishImportJob,
  heartbeatImportJob,
  holdsImportJob,
  progressOf,
  recoverStaleJobs,
  setSourceAppName,
  type ClaimedJob,
} from './jobs';
import { findLinkTarget, lockLinkSource, saveLink, unlistedLinks, type LinkSource } from './links';
import {
  countChange,
  emptyChanges,
  givenTags,
  deleteRecord,
  lockRecord,
  mergeOrder,
  mergeTags,
  mergeValue,
  recordNames,
  saveRecord,
  sweepImportRecords,
  type FieldMerge,
  type RecordFields,
  type RecordOutcome,
  type RecordType,
} from './reimport';
import {
  BudgetTurns,
  copyMedia,
  importTaleMedia,
  isSweepable,
  mediaJobBudget,
  sweepImportedMedia,
  type TaleMediaImport,
} from './media-copy';
import type { MediaFetchPolicy } from './media-fetch';
import type { ImportJobSelection } from './preview';
import { MAX_DIFFERENCES_PER_RECORD, storedText, type DifferenceBudget, type ReportText } from './record-shape';
import {
  recordsOf,
  StorylyClient,
  type CheckedEntry,
  type CheckedLabelList,
  type CheckedList,
  type SourceInstance,
  type SourceLabel,
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

/**
 * How much of an import runs at once (story 10). Media copies run in a pool,
 * at most `media` at once and `mediaPerHost` against one media host; story
 * lists of up to `listReadAhead` groups are read ahead. At most
 * `pendingEffects` tales wait for their report effects, which bounds memory.
 * 1 everywhere imports one record at a time.
 */
export interface ImportConcurrency {
  media?: number;
  mediaPerHost?: number;
  listReadAhead?: number;
  pendingEffects?: number;
}

export const DEFAULT_IMPORT_CONCURRENCY: Required<ImportConcurrency> = {
  media: 8,
  mediaPerHost: 6,
  listReadAhead: 4,
  pendingEffects: 32,
};

const concurrencyOf = (given: ImportConcurrency = {}): Required<ImportConcurrency> => {
  const value = (key: keyof ImportConcurrency, min: number) => {
    const n = given[key];
    return n !== undefined && Number.isInteger(n) && n >= min ? n : DEFAULT_IMPORT_CONCURRENCY[key];
  };
  return {
    media: value('media', 1),
    mediaPerHost: value('mediaPerHost', 1),
    listReadAhead: value('listReadAhead', 0),
    pendingEffects: value('pendingEffects', 1),
  };
};

/** Writes one structured log line; the API passes its JSON logger. */
export type ImportLog = (level: 'info' | 'warn' | 'error', msg: string, err?: unknown) => void;

/** What the worker needs to run a job. */
export interface ImportRunOptions {
  /** Decrypts the stored source token (IMPORT_TOKEN_KEY). */
  tokenKey: Buffer;
  /** Base URL of the Storyly External API (STORYLY_API_URL). */
  storylyApiUrl: string;
  /** Tests may pass their own fetch. */
  fetch?: typeof fetch;
  /** The media storage port (AD-11): each tale's media is copied into it. */
  storage: MediaStorage;
  /** How source media URLs may be fetched; production defaults (public addresses only) when absent. */
  mediaPolicy?: MediaFetchPolicy;
  log?: ImportLog;
  /** How often the runner refreshes the heartbeat; {@link IMPORT_HEARTBEAT_MS} by default. */
  heartbeatMs?: number;
  /** How much runs at once; {@link DEFAULT_IMPORT_CONCURRENCY} by default. */
  concurrency?: ImportConcurrency;
  /** How replies 429 and 5xx from Storyly are tried again; the default policy when absent. */
  retry?: Partial<RetryPolicy>;
  /**
   * How many media copies may use the database at once; the media concurrency
   * by default. The API passes its pool's size less what its requests need.
   */
  dbConcurrency?: number;
}

/** A failure whose message is written for the person who started the import. */
class ImportFailure extends Error {}

/** This worker no longer holds the job (another worker recovered it): stop without writing. */
class ClaimLostError extends Error {}

const noLog: ImportLog = () => undefined;

/** A list of source records: checked, or plain records with no rejected ones. */
export type SourceList<T> = readonly T[] | CheckedList<T>;

/** Reads an instance's story groups and a group's stories; the Storyly client in the worker. */
export interface ContentSource {
  /** `signal` stops the read and its retry waits when the import stops. */
  listStoryGroups(instanceId: string, signal?: AbortSignal): Promise<SourceList<SourceStoryGroup>>;
  listStories(storyGroupId: string, signal?: AbortSignal): Promise<SourceList<SourceStory>>;
  /** Starts reading a group's stories before `listStories` asks for them; optional. */
  readAhead?(storyGroupId: string, signal?: AbortSignal): void;
}

const checkedOf = <T>(list: SourceList<T>): CheckedList<T> =>
  Array.isArray(list)
    ? { entries: list.map((record: T) => ({ record, differences: [], omitted: 0 })) }
    : (list as CheckedList<T>);

/** The source record a list belongs to, as its differences name it: already made safe to store. */
interface DifferenceParent {
  within: string;
  withinSourceId: string;
}

/** What importContent takes besides its source. */
export interface ImportContentOptions {
  /** The chosen app's checked entry: its differences come first in the report. */
  app?: Pick<CheckedEntry<unknown>, 'differences' | 'omitted'>;
  /** Makes source text safe to store (the token removed, then cut); cut only by default. */
  text?: ReportText;
  /** The difference budget the source's checks draw on; refunded for records not listed. */
  budget?: DifferenceBudget;
  /** Copies each imported tale's media (AD-11); without it, tales are imported without media. */
  media?: TaleMediaImport;
  /**
   * Reads the app's labels list. With it, labels (that list and each story
   * group's `segments`) become tags of the project on its tale groups, and the
   * report counts them; without it, labels are not imported.
   */
  labels?: (signal?: AbortSignal) => Promise<SourceList<SourceLabel>>;
  /**
   * Throws when this run no longer holds its job (the claim check); run before
   * tags are written, which happens outside the per-record heartbeat.
   */
  claimCheck?: () => Promise<void>;
  /**
   * The source app's id. Links remember it, so a re-import of the app lists
   * the records an earlier import brought across that the source no longer
   * lists (`removedAtSource`); without it, no removal is looked for.
   */
  appId?: string;
  /**
   * What the admin picked: only the picked instances become zones, and with
   * `taleGroups` false no story group or story is read. The caller leaves out
   * `media` and `labels` when they were not picked. Absent takes everything.
   */
  selection?: ImportJobSelection;
  /** How much runs at once; {@link DEFAULT_IMPORT_CONCURRENCY} by default. */
  concurrency?: ImportConcurrency;
  /**
   * Stops the import when it aborts, such as when the job's claim is lost:
   * no record is written after it, the copies stop, and `importContent`
   * rejects with its reason.
   */
  signal?: AbortSignal;
}

/**
 * The report's differences (FR-029), in reading order: at most
 * {@link MAX_IMPORT_REPORT_DIFFERENCES} stored, the rest counted in
 * `differencesOmitted`. Each list is listed when it is read, entry by entry
 * in response order (unreadable records in place), each record once.
 */
function differenceList(report: ImportReport, budget: DifferenceBudget | undefined, order: InOrder) {
  const list: ImportDifference[] = [];
  report.differences = list;
  const omit = (count: number) => {
    if (count > 0) report.differencesOmitted = (report.differencesOmitted ?? 0) + count;
  };
  const addEntry = (entry: Pick<CheckedEntry<unknown>, 'differences' | 'omitted'>, parent: DifferenceParent | null) => {
    omit(entry.omitted);
    for (const difference of entry.differences) {
      if (list.length >= MAX_IMPORT_REPORT_DIFFERENCES) {
        omit(1);
        continue;
      }
      list.push(parent === null ? difference : { ...difference, record: { ...difference.record, ...parent } });
    }
  };
  // One difference the import itself finds (not a shape check): it draws on the budget like the checks.
  const addOne = (difference: ImportDifference) => {
    if (budget !== undefined) {
      if (budget.remaining <= 0) {
        omit(1);
        return;
      }
      budget.remaining--;
    }
    addEntry({ differences: [difference], omitted: 0 }, null);
  };
  // An uncharged list's entry draws on the budget now, in reading order: what the budget cannot take is omitted.
  const charge = <T>(entry: CheckedEntry<T>): CheckedEntry<T> => {
    if (budget === undefined) return entry;
    const kept = Math.max(0, Math.min(entry.differences.length, budget.remaining));
    budget.remaining -= kept;
    if (kept === entry.differences.length) return entry;
    return {
      record: entry.record,
      differences: entry.differences.slice(0, kept),
      omitted: entry.omitted + entry.differences.length - kept,
    };
  };
  // Records without an id (a bare label) are never taken for repeats.
  const addList = <T extends { id: string | null }>(
    checked: CheckedList<T>,
    listed: Set<string>,
    parent: DifferenceParent | null,
  ) => {
    for (const entry of checked.entries) {
      if (entry.record !== null && entry.record.id !== null) {
        if (listed.has(entry.record.id)) {
          // A repeated record is listed once: what its check drew from the budget goes back.
          if (budget && !checked.uncharged) budget.remaining += entry.differences.length;
          continue;
        }
        listed.add(entry.record.id);
      }
      addEntry(checked.uncharged ? charge(entry) : entry, parent);
    }
  };
  // Each write takes its place in reading order: after the effects still waiting, such as a tale's media outcome.
  return {
    addEntry: (entry: Pick<CheckedEntry<unknown>, 'differences' | 'omitted'>, parent: DifferenceParent | null) =>
      order.run(() => addEntry(entry, parent)),
    addList: <T extends { id: string | null }>(
      checked: CheckedList<T>,
      listed: Set<string>,
      parent: DifferenceParent | null,
    ) => order.run(() => addList(checked, listed, parent)),
    addOne: (difference: ImportDifference) => order.run(() => addOne(difference)),
    omit: (count: number) => order.run(() => omit(count)),
  };
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
/** The name of a zone whose instance has no title: neutral, since a source id never becomes a name (AD-7). */
export const UNTITLED_ZONE = 'Untitled zone';
// A story without a title shows its group's title at the source.
const taleTitle = (story: SourceStory, group: string): string => story.name.trim() || group;

/**
 * Imports one instance as a zone of the project, without a frame (epic
 * decision), through the zones module (AD-8), and links it (AD-7). The
 * instance is locked by its source key first, so concurrent imports of the
 * same app cannot both create it. An instance already linked is not created
 * again. A created zone's link and baseline (what the import wrote, for
 * re-imports) commit with it. Returns the zone's id and whether this call
 * created it, or null when its earlier zone is gone (a link is never re-pointed).
 */
async function importZone(
  db: TransactionalDb,
  projectId: string,
  instance: SourceInstance,
  name: string,
  appId: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const source = { projectId, sourceType: 'instance', sourceId: instance.id };
  return retryDeadlockOnce(() =>
    inTransaction(db, async (tx) => {
      await lockLinkSource(tx, source);
      const linked = await findLinkTarget(tx, source);
      if (linked !== null) return (await zoneExists(tx, linked)) ? { id: linked, created: false } : null;
      const zone = await createZone(tx, { name, projectId });
      await saveLink(tx, { ...source, targetType: 'zone', targetId: zone.id, appId });
      await saveRecord(tx, 'zone', zone.id, projectId, { name });
      return { id: zone.id, created: true };
    }),
  );
}

/** Runs `work` again once when PostgreSQL broke a deadlock by failing it (40P01). */
async function retryDeadlockOnce<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== '40P01') throw err;
    return work();
  }
}

/** What a re-import's update of one record did. */
interface RecordUpdate {
  /** Some field was written from the source. */
  written: boolean;
  /** The source fields whose change was not written, since a person had changed them in TaleArt. */
  kept: string[];
}

/**
 * Updates one record an import holds, in one transaction (AD-7): locks its
 * baseline, then lets `apply` merge each field through the owning module's
 * conditional calls, and records the new baseline. Returns null when the
 * record no longer exists. A deadlock runs it once more.
 */
async function updateRecord(
  db: TransactionalDb,
  type: RecordType,
  targetId: string,
  projectId: string,
  apply: (tx: Db, baseline: RecordFields | null) => Promise<{ fields: RecordFields; update: RecordUpdate } | null>,
): Promise<RecordUpdate | null> {
  return retryDeadlockOnce(() =>
    inTransaction(db, async (tx) => {
      const baseline = await lockRecord(tx, type, targetId);
      const result = await apply(tx, baseline);
      if (result === null) {
        // The record is gone: so is what the import recorded about it.
        await deleteRecord(tx, type, targetId);
        return null;
      }
      await saveRecord(tx, type, targetId, projectId, result.fields);
      return result.update;
    }),
  );
}

/** Merges a value under the module's lock: `decide` hands the module the value to write, or null. */
function valueMerger(baseline: string | undefined, source: string) {
  let merge: FieldMerge<string> = { write: null, keptLocalEdit: false, baseline: source };
  const decide = (current: string) => {
    merge = mergeValue(baseline, current, source);
    return merge.write;
  };
  return { decide, result: () => merge };
}

/** Merges an order under the module's lock, as {@link valueMerger} does a value. */
function orderMerger(baseline: readonly string[] | undefined, imported: readonly string[]) {
  let merge: FieldMerge<string[]> = { write: null, keptLocalEdit: false, baseline: [...imported] };
  const decide = (current: readonly string[]) => {
    merge = mergeOrder(baseline, current, imported);
    return merge.write;
  };
  return { decide, result: () => merge };
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
  source: LinkSource & { appId: string | null },
  targetType: string,
  record: { type: RecordType; fields: RecordFields },
  exists: (id: string) => Promise<boolean>,
  create: (link: (tx: Db, targetId: string) => Promise<void>) => Promise<unknown>,
): Promise<{ id: string; created: boolean } | null> {
  for (;;) {
    const linked = await findLinkTarget(db, source);
    if (linked !== null) return (await exists(linked)) ? { id: linked, created: false } : null;
    let createdId = '';
    try {
      await retryDeadlockOnce(() =>
        create(async (tx, targetId) => {
          await lockLinkSource(tx, source);
          if ((await findLinkTarget(tx, source)) !== null) throw new AlreadyLinkedError();
          await saveLink(tx, { ...source, targetType, targetId });
          // What the import wrote, for re-imports to tell a person's later edit from the source's.
          await saveRecord(tx, record.type, targetId, source.projectId, record.fields);
          createdId = targetId;
        }),
      );
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
 * with their media when `options.media` is given, in source order, through the
 * zones and tales modules and the storage port (AD-8, AD-11, AD-14). Every
 * record is linked (AD-7), so a re-run
 * creates nothing twice: a linked record counts as imported while it exists,
 * else as skipped. A repeated source id is skipped, and so are the stories of
 * a group that is skipped; each unique story counts once, so source = imported
 * + skipped. A record without a source position is noted when it is created.
 * `beforeEach` runs before each record is written, with the report so far;
 * the worker refreshes its heartbeat and stores the progress there. Media
 * copies and story list reads run concurrently ({@link ImportConcurrency}),
 * while every report write keeps its reading order: the report is the one a
 * run of one record at a time writes. When the import fails, the copies still
 * running are stopped and awaited before the failure is passed on.
 */
export async function importContent(
  db: TransactionalDb,
  projectId: string,
  instanceList: SourceList<SourceInstance>,
  source: ContentSource,
  beforeEach: (sofar: Readonly<ImportReport>) => Promise<void> = async () => undefined,
  options: ImportContentOptions = {},
): Promise<ImportReport> {
  const concurrency = concurrencyOf(options.concurrency);
  const stop = new AbortController();
  // The caller's stop (a lost claim) stops this import with its reason.
  const external = options.signal;
  const onExternal = () => stop.abort(external?.reason);
  if (external?.aborted) onExternal();
  else external?.addEventListener('abort', onExternal, { once: true });
  const run: ContentRun = {
    // A copy that fails (storage, database) stops the others at once, with its failure as the reason; a stop
    // ends the waits in room() and drain() at once.
    order: new InOrder((err) => stop.abort(err), stop.signal),
    concurrency,
    mediaPool: new Limiter(concurrency.media),
    stop,
  };
  try {
    return await importContentWith(run, db, projectId, instanceList, source, beforeEach, options);
  } catch (err) {
    // The first failure is passed on, not the stop it caused elsewhere.
    const first = stop.signal.aborted && stop.signal.reason !== undefined ? stop.signal.reason : err;
    // Nothing is written once the import has failed: the copies stop, and the effects still waiting are dropped.
    stop.abort(first);
    await run.order.settle();
    throw first;
  } finally {
    external?.removeEventListener('abort', onExternal);
  }
}

/** What one {@link importContent} shares between its work and its cleanup. */
interface ContentRun {
  /** Report writes in reading order, while media copies run concurrently. */
  order: InOrder;
  concurrency: Required<ImportConcurrency>;
  mediaPool: Limiter;
  /** Stops read-ahead and media copies when the import fails or its claim is lost. */
  stop: AbortController;
}

async function importContentWith(
  { order, concurrency, mediaPool, stop }: ContentRun,
  db: TransactionalDb,
  projectId: string,
  instanceList: SourceList<SourceInstance>,
  source: ContentSource,
  beforeEach: (sofar: Readonly<ImportReport>) => Promise<void>,
  options: ImportContentOptions,
): Promise<ImportReport> {
  const text = options.text ?? ((value: string) => storedText(value));
  const checkedInstances = checkedOf(instanceList);
  const instances = recordsOf(checkedInstances);
  const rejectedInstances = checkedInstances.entries.length - instances.length;
  const report: ImportReport & Required<Pick<ImportReport, 'taleGroups' | 'tales'>> = {
    zones: { source: checkedInstances.entries.length, imported: 0, skipped: rejectedInstances },
    taleGroups: emptyCount(),
    tales: emptyCount(),
    ...(options.media ? { media: emptyCount() } : {}),
    ...(options.labels ? { tags: emptyCount() } : {}),
    notes: [],
    notImportedByDesign: [...IMPORT_NOT_IMPORTED_BY_DESIGN],
  };
  // What this run created, updated or left unchanged per entity type (AD-7, re-imports).
  const changes: Required<Omit<ImportChanges, 'media'>> & Pick<ImportChanges, 'media'> = {
    zones: emptyChanges(),
    taleGroups: emptyChanges(),
    tales: emptyChanges(),
    ...(options.media ? { media: emptyChanges() } : {}),
  };
  const appId = options.appId ?? null;
  const differences = differenceList(report, options.budget, order);
  const note = (text: string) => order.run(() => void report.notes.push(text));
  if (options.app) differences.addEntry(options.app, null);
  // Each record's place in its source list, from 1, as its differences name it.
  const placeOf = <T extends { id: string }>(list: CheckedList<T>): Map<string, number> => {
    const places = new Map<string, number>();
    list.entries.forEach((entry, index) => {
      if (entry.record !== null && !places.has(entry.record.id)) places.set(entry.record.id, index + 1);
    });
    return places;
  };
  const instancePlaces = placeOf(checkedInstances);
  // A source field whose change was not written, since a person changed it in TaleArt: field names only, no values.
  const keptDifference = (
    entity: ImportDifferenceEntity,
    record: { id: string; name: string },
    position: number,
    parent: DifferenceParent | null,
    field: string,
  ): ImportDifference => ({
    entity,
    record: {
      sourceId: text(record.id),
      name: record.name.trim() === '' ? null : text(record.name.trim()),
      within: parent?.within ?? null,
      withinSourceId: parent?.withinSourceId ?? null,
      position,
    },
    kind: 'keptLocalEdit',
    field,
    sourceField: null,
  });
  // What was not picked is skipped, never missing: an instance not picked is listed once, without its differences.
  const picked = options.selection ? new Set(options.selection.zones) : null;
  const withGroups = options.selection?.taleGroups ?? true;
  const notSelected = options.selection
    ? {
        zones: [] as { sourceId: string; name: string }[],
        entities: (['taleGroups', 'media', 'tags'] as const).filter(
          (entity): entity is ImportEntityChoice => !(options.selection as ImportJobSelection)[entity],
        ),
      }
    : null;
  differences.addList(
    picked === null
      ? checkedInstances
      : {
          entries: checkedInstances.entries.filter((entry) => {
            if (entry.record === null || picked.has(entry.record.id)) return true;
            if (options.budget) options.budget.remaining += entry.differences.length;
            return false;
          }),
        },
    new Set(),
    null,
  );
  // Every source id this run listed, per link source type: a linked record the source no longer lists is reported.
  // An instance not picked is still listed at the source, so its zone is never taken for removed.
  const listedInstances = new Set(instances.map((instance) => instance.id));
  // Story groups and stories are read only for the picked zones: removals among them are looked for only when
  // every zone and the tale groups were picked, since a record of a zone not read is not known to be gone.
  const readEverything = picked === null ? withGroups : withGroups && instances.every((i) => picked.has(i.id));
  // The source types with records the source listed but that could not be read (no usable id): such a record may
  // be one an earlier import linked, so no removal is looked for among them.
  const unreadable = new Set<string>(instances.length < checkedInstances.entries.length ? ['instance'] : []);
  const labels = options.labels ? new LabelImport(db, projectId) : null;
  // A label that cannot become a tag, as a report difference: its text only when it has some.
  const labelDifference = (
    label: string | null,
    reason: ImportTagFailure,
    field: string,
    record: Pick<ImportDifference['record'], 'sourceId' | 'within' | 'withinSourceId' | 'position'>,
  ): ImportDifference => ({
    entity: 'tag',
    record: { ...record, name: label === null || label.trim() === '' ? null : text(label.trim()) },
    kind: 'tagNotImported',
    field,
    sourceField: null,
    reason,
  });
  // Saves labels as tags; an error the labels' own text causes is a note, never a failed job.
  const saveLabels = async (save: () => Promise<void>, where: string) => {
    // Tags are written only while the import runs and still holds its job.
    stop.signal.throwIfAborted();
    await options.claimCheck?.();
    stop.signal.throwIfAborted();
    try {
      await save();
    } catch (err) {
      if (!isLabelError(err)) throw err;
      note(`${where}: labels could not be saved as tags, so they were not imported`);
    }
  };
  if (labels && options.labels) {
    // The app's labels list. Its path and shape are guesses until the real run, so a list that cannot be read
    // leaves the tags to the story groups' labels instead of failing the import.
    try {
      const labelList = await options.labels(stop.signal);
      const checked = checkedOf(labelList);
      const beyond = Array.isArray(labelList) ? 0 : ((labelList as Partial<CheckedLabelList>).beyond ?? 0);
      // Each record listed once by id, like every other list.
      differences.addList(checked, new Set(), null);
      const seen = new Set<string>();
      let repeated = 0;
      const names: string[] = [];
      checked.entries.forEach((entry, index) => {
        const record = entry.record;
        if (record !== null && record.id !== null) {
          if (seen.has(record.id)) {
            repeated++;
            labels.uncounted(1);
            return;
          }
          seen.add(record.id);
        }
        // An unreadable record is already listed as one.
        const outcome = labels.read(record === null ? null : record.text);
        if ('name' in outcome) {
          labels.use(outcome.name);
          names.push(outcome.name);
          return;
        }
        // A record whose own difference covers its label gets no second one.
        if (record === null || record.reported) return;
        if (entry.differences.length + entry.omitted >= MAX_DIFFERENCES_PER_RECORD) {
          differences.omit(1);
          return;
        }
        const at = { sourceId: record.id === null ? null : text(record.id), within: null, withinSourceId: null };
        differences.addOne(labelDifference(record.text, outcome.reason, 'name', { ...at, position: index + 1 }));
      });
      if (beyond > 0) {
        labels.uncounted(beyond);
        note(`Tags: ${beyond} label(s) past the first ${MAX_LABEL_LIST_ENTRIES} of the labels list were not read`);
      }
      if (repeated > 0) note(`Tags: ${repeated} repeated label record(s) of the labels list were skipped`);
      await saveLabels(() => labels.ensure([...new Set(names)]), 'Tags');
    } catch (err) {
      // A read the stop cut off ends the import, not only the labels list.
      stop.signal.throwIfAborted();
      if (!(err instanceof StorylyUnavailableError || err instanceof StorylyTokenInvalidError)) throw err;
      note(`Tags: the labels list could not be read (${text(err.message)}), so tags come from story groups only`);
    }
  }
  // Each story group's labels, read once per group id: the tag names it carries.
  const labelGroups = new Set<string>();
  const groupTagNames = new Map<string, string[]>();
  const listedGroups = new Set<string>();
  const listedStories = new Set<string>();
  const parentOf = (name: string, sourceId: string): DifferenceParent => ({
    within: text(name),
    withinSourceId: text(sourceId),
  });
  const seenInstances = new Set<string>();
  const seenGroups = new Set<string>();
  const seenStories = new Set<string>();
  for (const instance of instances) {
    if (seenInstances.has(instance.id)) {
      report.zones.skipped++;
      continue;
    }
    seenInstances.add(instance.id);
    const zoneName = instance.name.trim() || UNTITLED_ZONE;
    if (picked !== null && notSelected !== null && !picked.has(instance.id)) {
      // Not picked: neither created nor updated, and not taken for removed at the source.
      report.zones.skipped++;
      report.zones.notSelected = (report.zones.notSelected ?? 0) + 1;
      if (notSelected.zones.length < MAX_IMPORT_SELECTED_ZONES) {
        notSelected.zones.push({ sourceId: text(instance.id), name: text(zoneName) });
      }
      continue;
    }
    await beforeEach(report);
    stop.signal.throwIfAborted();
    const zone = await importZone(db, projectId, instance, zoneName, appId);
    const zoneId = zone?.id ?? null;
    if (zone !== null && instance.name.trim() === '') {
      note(
        `Zone ${instancePlaces.get(instance.id) ?? 1} of the source has no title, so it is named "${UNTITLED_ZONE}"`,
      );
    }
    if (zone === null) {
      report.zones.skipped++;
      note(`Zone "${text(zoneName)}": its earlier import was deleted, so it was not imported again`);
    } else {
      report.zones.imported++;
      // The source names no widget type, so the zone has no frame yet (epic decision).
      note(`Zone "${text(zoneName)}": frame type unknown`);
    }
    // The tale groups this run imported into the zone, in source order: their order there is merged at the end.
    const zoneGroups: string[] = [];
    // The zone itself: its name and, when its tale groups were read, their order, in one transaction.
    const updateZone = async (withOrder: boolean) => {
      if (zone === null) return;
      stop.signal.throwIfAborted();
      const zoneUpdate = await updateRecord(db, 'zone', zone.id, projectId, async (tx, baseline) => {
        // The zone's placement lock first, then its row (no key update), as the tales module's
        // placement writes take them: an update cannot deadlock with a create, place or copy into the zone.
        let orderWritten = false;
        let orderKept = false;
        let order: string[] | undefined;
        if (withOrder) {
          const orderMerge = orderMerger(baseline?.order, zoneGroups);
          if ((await orderTaleGroupsWhen(tx, zone.id, orderMerge.decide)) === null) return null;
          order = orderMerge.result().baseline;
          orderWritten = orderMerge.result().write !== null;
          orderKept = orderMerge.result().keptLocalEdit;
        }
        const nameMerge = valueMerger(baseline?.name, zoneName);
        if ((await renameZoneWhen(tx, zone.id, nameMerge.decide)) === null) return null;
        const fields: RecordFields = { name: nameMerge.result().baseline, ...(order ? { order } : {}) };
        const kept = [...(nameMerge.result().keptLocalEdit ? ['title'] : []), ...(orderKept ? ['sort_order'] : [])];
        return { fields, update: { written: nameMerge.result().write !== null || orderWritten, kept } };
      });
      const outcome: RecordOutcome = zone.created ? 'created' : zoneUpdate?.written ? 'updated' : 'unchanged';
      countChange(changes.zones, outcome, (zoneUpdate?.kept.length ?? 0) > 0);
      for (const field of zoneUpdate?.kept ?? []) {
        differences.addOne(keptDifference('zone', instance, instancePlaces.get(instance.id) ?? 1, null, field));
      }
    };
    // Zones only: no story group or story is read, and the order of the zone's tale groups is left as it is.
    if (!withGroups) {
      await updateZone(false);
      continue;
    }

    const groupList = checkedOf(await source.listStoryGroups(instance.id, stop.signal));
    const groups = inSourceOrder(recordsOf(groupList));
    const groupPlaces = placeOf(groupList);
    report.taleGroups.source += groupList.entries.length;
    report.taleGroups.skipped += groupList.entries.length - groups.length;
    if (groupList.entries.length > groups.length) unreadable.add('story_group');
    differences.addList(groupList, listedGroups, parentOf(zoneName, instance.id));
    if (labels) {
      // Listed with the group list, as part of its records; each label's tag exists from now on.
      const names: string[] = [];
      groupList.entries.forEach((entry, index) => {
        const group = entry.record;
        if (group === null || labelGroups.has(group.id)) return;
        labelGroups.add(group.id);
        const name = groupName(group);
        // The group record's differences stay within the per-record cap; the rest are only counted.
        let room = MAX_DIFFERENCES_PER_RECORD - entry.differences.length - entry.omitted;
        const add = (difference: ImportDifference) => {
          if (room <= 0) differences.omit(1);
          else {
            room--;
            differences.addOne(difference);
          }
        };
        const { values, beyond, wrongType } = groupLabels(group.segments);
        if (wrongType) {
          const title = group.name.trim();
          add({
            entity: 'taleGroup',
            record: {
              sourceId: text(group.id),
              name: title === '' ? null : text(title),
              ...parentOf(zoneName, instance.id),
              position: index + 1,
            },
            kind: 'wrongType',
            field: 'segments',
            sourceField: null,
          });
        }
        const parent = parentOf(name, group.id);
        const kept = new Set<string>();
        let dropped = 0;
        for (const { position, value } of values) {
          const label = labelText(value);
          const outcome = labels.read(label);
          if ('reason' in outcome) {
            add(labelDifference(label, outcome.reason, 'segments', { sourceId: null, ...parent, position }));
          } else if (kept.has(outcome.name) || kept.size < MAX_GROUP_TAGS) {
            kept.add(outcome.name);
            labels.use(outcome.name);
          } else dropped++;
        }
        if (beyond > 0) {
          labels.uncounted(beyond);
          note(`Tale group "${text(name)}": ${beyond} label(s) past the first ${MAX_GROUP_LABELS} were not read`);
        }
        if (dropped > 0) {
          note(
            `Tale group "${text(name)}": ${dropped} label(s) past its first ${MAX_GROUP_TAGS} tags were not imported`,
          );
        }
        groupTagNames.set(group.id, [...kept]);
        names.push(...kept);
      });
      await saveLabels(() => labels.ensure([...new Set(names)]), `Story groups of zone "${text(zoneName)}"`);
    }
    let groupsWithoutZone = 0;
    for (const [index, group] of groups.entries()) {
      // The stories of this group and the next ones are read while earlier tales are imported.
      for (const next of groups.slice(index, index + 1 + concurrency.listReadAhead)) {
        if (concurrency.listReadAhead > 0 && !seenGroups.has(next.id)) source.readAhead?.(next.id, stop.signal);
      }
      if (seenGroups.has(group.id)) {
        report.taleGroups.skipped++;
        continue;
      }
      seenGroups.add(group.id);
      const name = groupName(group);
      const storyList = checkedOf(await source.listStories(group.id, stop.signal));
      const stories = recordsOf(storyList);
      // Each story's place in its list, from 1, as its differences name it.
      const positions = placeOf(storyList);
      report.tales.source += storyList.entries.length;
      report.tales.skipped += storyList.entries.length - stories.length;
      if (storyList.entries.length > stories.length) unreadable.add('story');
      differences.addList(storyList, listedStories, parentOf(name, group.id));
      // The group is skipped: so is each of its stories, once.
      const skipGroup = (why?: string) => {
        report.taleGroups.skipped++;
        report.tales.skipped += stories.length;
        for (const story of stories) seenStories.add(story.id);
        if (why) note(why);
      };
      if (zoneId === null) {
        groupsWithoutZone++;
        skipGroup();
        continue;
      }
      await beforeEach(report);
      // A read may have ended after the import stopped: nothing is written then.
      stop.signal.throwIfAborted();
      let taleGroup: { id: string; created: boolean } | null;
      try {
        taleGroup = await importLinked(
          db,
          { projectId, sourceType: 'story_group', sourceId: group.id, appId },
          'tale_group',
          { type: 'taleGroup', fields: { name } },
          (id) => taleGroupExists(db, id),
          (link) => createTaleGroup(db, { zoneId, name }, (tx, created) => link(tx, created.taleGroupId)),
        );
      } catch (err) {
        if (!(err instanceof ZoneNotFoundError)) throw err;
        skipGroup(`Tale group "${text(name)}": its zone was deleted during the import`);
        continue;
      }
      if (taleGroup === null) {
        skipGroup(`Tale group "${text(name)}": its earlier import was deleted, so it was not imported again`);
        continue;
      }
      report.taleGroups.imported++;
      if (taleGroup.created && group.sortOrder === null) note(`Tale group "${text(name)}": ${NO_POSITION}`);
      const taleGroupId = taleGroup.id;
      zoneGroups.push(taleGroupId);
      // The tales this run imported into the group, in source order: their order there is merged below.
      const groupTales: string[] = [];

      for (const story of inSourceOrder(stories)) {
        if (seenStories.has(story.id)) {
          report.tales.skipped++;
          continue;
        }
        seenStories.add(story.id);
        const title = taleTitle(story, name);
        await beforeEach(report);
        stop.signal.throwIfAborted();
        let tale: { id: string; created: boolean } | null;
        try {
          tale = await importLinked(
            db,
            { projectId, sourceType: 'story', sourceId: story.id, appId },
            'tale',
            { type: 'tale', fields: { name: title, group: taleGroupId } },
            (id) => taleExists(db, id),
            (link) => createTale(db, { taleGroupId, title }, (tx, created) => link(tx, created.taleId)),
          );
        } catch (err) {
          if (err instanceof TaleGroupFullError) {
            report.tales.skipped++;
            note(`Tale "${text(title)}" in "${text(name)}": the tale group already holds ${MAX_TALES_PER_GROUP} tales`);
            continue;
          }
          if (err instanceof TaleGroupNotFoundError) {
            report.tales.skipped++;
            note(`Tale "${text(title)}" in "${text(name)}": its tale group was deleted during the import`);
            continue;
          }
          throw err;
        }
        if (tale === null) {
          report.tales.skipped++;
          note(
            `Tale "${text(title)}" in "${text(name)}": its earlier import was deleted, so it was not imported again`,
          );
          continue;
        }
        report.tales.imported++;
        if (tale.created && story.sortOrder === null) note(`Tale "${text(title)}" in "${text(name)}": ${NO_POSITION}`);
        const taleId = tale.id;
        if (tale.created) {
          countChange(changes.tales, 'created', false);
          groupTales.push(taleId);
        } else {
          // A linked tale: its title follows the source unless a person changed it in TaleArt.
          // Where the tale is when it is not in the group the source now lists it under: moved at the source
          // (the tale is where the import put it), or by a person (the import put it elsewhere).
          let move: 'none' | 'source' | 'person' = 'none';
          stop.signal.throwIfAborted();
          const update = await updateRecord(db, 'tale', taleId, projectId, async (tx, baseline) => {
            const merge = valueMerger(baseline?.name, title);
            const renamed = await renameTaleWhen(tx, taleId, merge.decide);
            if (renamed === null) return null;
            const kept: string[] = merge.result().keptLocalEdit ? ['title'] : [];
            if (renamed.taleGroupId !== taleGroupId) {
              // Without a recorded group (imported before baselines), only the source can have moved it.
              if (baseline?.group === undefined || baseline.group === renamed.taleGroupId) move = 'source';
              else {
                move = 'person';
                // A kept local edit only when the source moved it too (it lists it outside the recorded group).
                if (baseline.group !== taleGroupId) kept.push('story_group_id');
              }
            }
            const fields: RecordFields = { name: merge.result().baseline, group: renamed.taleGroupId };
            return { fields, update: { written: merge.result().write !== null, kept } };
          });
          if (update === null) {
            // Deleted since it was found: it counts as imported, as when it was read, with nothing changed.
            countChange(changes.tales, 'unchanged', false);
          } else {
            countChange(changes.tales, update.written ? 'updated' : 'unchanged', update.kept.length > 0);
            for (const field of update.kept) {
              differences.addOne(
                keptDifference('tale', story, positions.get(story.id) ?? 1, parentOf(name, group.id), field),
              );
            }
            if (move === 'none') groupTales.push(taleId);
            else if (move === 'source') {
              // An import moves nothing: the tale stays in its tale group, and the move is listed.
              differences.addOne({
                ...keptDifference('tale', story, positions.get(story.id) ?? 1, parentOf(name, group.id), ''),
                kind: 'movedAtSource',
                field: 'story_group_id',
              });
            } else {
              note(
                `Tale "${text(title)}" in "${text(name)}": a person moved it to another tale group in TaleArt, so it stays there`,
              );
            }
          }
        }
        if (options.media && report.media && changes.media) {
          // Copied in the media pool while the import goes on; its outcome is applied in reading order.
          const media = options.media;
          const counts = report.media;
          const mediaChanges = changes.media;
          const position = positions.get(story.id) ?? 1;
          const parent = parentOf(name, group.id);
          // Its place in reading order for the byte budget, taken now, in reading order.
          const ticket = media.turns?.ticket();
          const copy = mediaPool
            .run(async () => {
              stop.signal.throwIfAborted();
              return importTaleMedia(db, media, projectId, taleId, story, stop.signal, ticket);
            }, stop.signal)
            .finally(() => ticket?.finish());
          order.after(copy, (outcome) => {
            if (outcome.kind === 'none') return;
            counts.source++;
            if (outcome.kind === 'imported') {
              counts.imported++;
              countChange(mediaChanges, outcome.change, false);
            } else {
              counts.skipped++;
              if (outcome.kind === 'failed') {
                differences.addOne(mediaDifference(story, position, parent, outcome.reason, text));
                if (outcome.keptEarlier) {
                  note(
                    `Tale "${text(title)}" in "${text(name)}": its new media could not be copied, so it keeps its earlier media`,
                  );
                }
              } else if (outcome.kind === 'keptOwn') {
                if (outcome.sourceChanged) {
                  mediaChanges.keptLocalEdit++;
                  differences.addOne(keptDifference('tale', story, position, parent, 'media'));
                } else {
                  note(
                    `Tale "${text(title)}" in "${text(name)}": its media was set in TaleArt, so it was not replaced`,
                  );
                }
              } else {
                note(
                  `Tale "${text(title)}" in "${text(name)}": it was deleted during the import, so its media was not copied`,
                );
              }
            }
          });
          // Holds back while too many tales wait for their media: memory stays bounded.
          await order.room(concurrency.pendingEffects);
        }
      }

      // The group itself: its name, its tags and the order of its tales, in one transaction.
      const groupPosition = groupPlaces.get(group.id) ?? 1;
      const updateGroup = (withTags: boolean) => {
        stop.signal.throwIfAborted();
        return updateRecord(db, 'taleGroup', taleGroupId, projectId, async (tx, baseline) => {
          const nameMerge = valueMerger(baseline?.name, name);
          if ((await renameTaleGroupWhen(tx, taleGroupId, nameMerge.decide)) === null) return null;
          const fields: RecordFields = { name: nameMerge.result().baseline };
          let tagsAdded = false;
          if (labels && withTags) {
            const source = groupTagNames.get(group.id) ?? [];
            let tagMerge = mergeTags(baseline, [], source);
            // Compare and set: the merge runs on the tags read under the group's tag lock.
            const { current, carried } = await labels.addToGroupIn(tx, taleGroupId, (now) => {
              tagMerge = mergeTags(baseline, now, source);
              return tagMerge.add;
            });
            tagsAdded = carried.length > current.length;
            // Only names the group carries now, or was given before, count as given: one refused by a limit
            // can still be added by a later run.
            fields.tags = givenTags(baseline, carried, source);
            fields.removedTags = tagMerge.removed;
            removedLabels = tagMerge.removedAtSource;
          }
          const orderMerge = orderMerger(baseline?.order, groupTales);
          await orderTalesWhen(tx, taleGroupId, orderMerge.decide);
          fields.order = orderMerge.result().baseline;
          const kept = [
            ...(nameMerge.result().keptLocalEdit ? ['title'] : []),
            ...(orderMerge.result().keptLocalEdit ? ['sort_order'] : []),
          ];
          const written = nameMerge.result().write !== null || tagsAdded || orderMerge.result().write !== null;
          return { fields, update: { written, kept } };
        });
      };
      let removedLabels: string[] = [];
      let groupUpdate: RecordUpdate | null = null;
      try {
        groupUpdate = await updateGroup(true);
      } catch (err) {
        removedLabels = [];
        // Deleted between its update's first read and its tags (the targeting module found no group).
        if (err instanceof TaleGroupNotFoundError) groupUpdate = null;
        else if (isLabelError(err)) {
          note(`Tale group "${text(name)}": its labels could not be saved as tags, so none were added`);
          groupUpdate = await updateGroup(false);
        } else throw err;
      }
      if (groupUpdate === null) {
        countChange(changes.taleGroups, taleGroup.created ? 'created' : 'unchanged', false);
        if (labels) {
          note(`Tale group "${text(name)}": it was deleted during the import, so its tags were not added`);
        }
      } else {
        const outcome: RecordOutcome = taleGroup.created ? 'created' : groupUpdate.written ? 'updated' : 'unchanged';
        countChange(changes.taleGroups, outcome, groupUpdate.kept.length > 0);
        for (const field of groupUpdate.kept) {
          differences.addOne(keptDifference('taleGroup', group, groupPosition, parentOf(zoneName, instance.id), field));
        }
        for (const label of removedLabels) {
          differences.addOne({
            entity: 'tag',
            record: { sourceId: null, name: text(label), ...parentOf(name, group.id), position: null },
            kind: 'removedAtSource',
            field: 'segments',
            sourceField: null,
          });
        }
      }
    }
    if (groupsWithoutZone > 0) {
      note(
        `Zone "${text(zoneName)}": its ${groupsWithoutZone} tale group(s) were not imported, since the zone was not`,
      );
    }
    await updateZone(true);
  }
  // Every media outcome is in the report before removals are looked for.
  await order.drain();
  if (appId !== null) await listRemovedAtSource();
  if (labels) {
    report.tags = labels.count();
    report.notes.push(...labels.notes(text));
    // The mapping table: how labels combine is not carried.
    if (labels.anyRead) note('Tags: whether labels combine with AND or OR is not imported');
  }
  if (picked !== null) {
    const gone = [...picked].filter((id) => !seenInstances.has(id)).length;
    if (gone > 0) {
      note(`Zones: ${gone} picked zone(s) are no longer in the app, so they were not imported`);
    }
  }
  if (notSelected !== null && (notSelected.zones.length > 0 || notSelected.entities.length > 0)) {
    report.notSelected = notSelected;
  }
  report.changes = changes;
  if (withGroups) return report;
  // Tale groups and tales were not picked: the report has no counts for them.
  const zonesOnly: ImportReport = { ...report };
  delete zonesOnly.taleGroups;
  delete zonesOnly.tales;
  return zonesOnly;

  /**
   * Lists the app's records an earlier import brought across that this run's
   * source lists no longer hold and that still exist in TaleArt: they stay as
   * they are (an import deletes nothing), counted and listed by their name in TaleArt.
   */
  async function listRemovedAtSource(): Promise<void> {
    if (appId === null) return;
    interface RemovalKind {
      sourceType: string;
      type: RecordType;
      entity: ImportDifferenceEntity;
      label: string;
      count: ImportChangeCount;
      /** The record's current name in TaleArt, through its owning module; null when it no longer exists. */
      currentName: (id: string) => Promise<string | null>;
    }
    const kinds: RemovalKind[] = [
      {
        sourceType: 'instance',
        type: 'zone',
        entity: 'zone',
        label: 'Zones',
        count: changes.zones,
        currentName: async (id) => (await findZone(db, id))?.name ?? null,
      },
      {
        sourceType: 'story_group',
        type: 'taleGroup',
        entity: 'taleGroup',
        label: 'Tale groups',
        count: changes.taleGroups,
        currentName: (id) => taleGroupName(db, id),
      },
      {
        sourceType: 'story',
        type: 'tale',
        entity: 'tale',
        label: 'Tales',
        count: changes.tales,
        currentName: (id) => storedTaleTitle(db, id),
      },
    ];
    // Story groups and stories count as removed only when this run read them all (see `readEverything`), and
    // a type counts none while a list it depends on held records that could not be read.
    const dependsOn: Record<string, string[]> = {
      instance: ['instance'],
      story_group: ['instance', 'story_group'],
      story: ['instance', 'story_group', 'story'],
    };
    const checked = kinds.filter((kind) => {
      if (kind.sourceType !== 'instance' && !readEverything) return false;
      if (dependsOn[kind.sourceType].some((type) => unreadable.has(type))) {
        note(
          `${kind.label}: the source listed records that could not be read, so none was looked for as removed at the source`,
        );
        return false;
      }
      return true;
    });
    const sets: Record<string, ReadonlySet<string>> = {
      instance: listedInstances,
      story_group: listedGroups,
      story: listedStories,
    };
    const listed = new Map(checked.map((kind) => [kind.sourceType, sets[kind.sourceType]]));
    if (listed.size === 0) return;
    const unlisted = await unlistedLinks(db, projectId, appId, listed);
    for (const kind of checked) {
      const links = unlisted.filter((link) => link.sourceType === kind.sourceType);
      // The name it had when the import last wrote it, for a record whose current name is blank.
      const recorded = await recordNames(
        db,
        kind.type,
        links.map((link) => link.targetId),
      );
      for (const link of links) {
        const current = await kind.currentName(link.targetId);
        if (current === null) continue;
        kind.count.removedAtSource++;
        const name = current.trim() !== '' ? current : recorded.get(link.targetId);
        differences.addOne({
          entity: kind.entity,
          record: {
            sourceId: text(link.sourceId),
            name: name === undefined || name.trim() === '' ? null : text(name),
            within: null,
            withinSourceId: null,
            position: null,
          },
          kind: 'removedAtSource',
          field: null,
          sourceField: null,
        });
      }
    }
  }
}

/** A story whose media was not copied, as a report difference: the reason only, never the URL. */
function mediaDifference(
  story: SourceStory,
  position: number,
  parent: DifferenceParent,
  reason: ImportMediaFailure,
  text: ReportText,
): ImportDifference {
  const title = story.name.trim();
  return {
    entity: 'tale',
    record: {
      sourceId: text(story.id),
      name: title === '' ? null : text(title),
      ...parent,
      position,
    },
    kind: 'mediaNotImported',
    field: 'media',
    sourceField: null,
    reason,
  };
}

const isKnownFailure = (err: unknown): err is Error =>
  err instanceof ImportFailure || err instanceof StorylyTokenInvalidError || err instanceof StorylyUnavailableError;

const redact = (text: string, token: string | null): string => (token ? text.split(token).join('[token]') : text);

/** A copy of `value` with the token removed from every string in it: a report never holds the token. */
export function redactDeep<T>(value: T, token: string | null): T {
  if (!token) return value;
  if (typeof value === 'string') return redact(value, token) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, token)) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, token)])) as T;
  }
  return value;
}

// The message stored on a failed job: ours for known failures, a generic one
// otherwise. The token never appears in it.
function failureMessage(err: unknown, token: string | null): string {
  const message = isKnownFailure(err) ? err.message : 'The import stopped on an internal error. Try again.';
  return storedText(message, token, FAILURE_MESSAGE_LIMIT);
}

/** The longest failure reason a job stores. */
const FAILURE_MESSAGE_LIMIT = 1000;

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
  // The entity types the selection leaves out: progress shows them as not selected while the job runs.
  const notPicked = job.selection
    ? (['taleGroups', 'media', 'tags'] as const).filter((entity) => !job.selection?.[entity])
    : undefined;
  let token: string | null = null;
  // The running report: importContent keeps adding to it, so at a failure it tells how far the job got.
  let latest: Readonly<ImportReport> | undefined;
  const beat = async (sofar?: Readonly<ImportReport>) => {
    if (sofar) latest = sofar;
    if (!(await heartbeatImportJob(db, job, sofar && progressOf(sofar, notPicked)))) throw new ClaimLostError();
  };
  // Stops the import as soon as the claim is lost, also between records (the heartbeat timer finds it).
  const stop = new AbortController();
  const timer = setInterval(() => {
    beat().catch((err: unknown) => {
      if (err instanceof ClaimLostError) stop.abort(err);
    });
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
    const secret = token;
    const text: ReportText = (value) => storedText(value, secret);
    // The report's budget, shared by every check of this import: once spent, differences are only counted.
    const budget: DifferenceBudget = { remaining: MAX_IMPORT_REPORT_DIFFERENCES };
    const concurrency = concurrencyOf(options.concurrency);
    // Story lists are read ahead and checked as they arrive: they draw on the budget when listed, in reading order.
    const client = new StorylyClient({
      baseUrl: options.storylyApiUrl,
      token,
      fetch: options.fetch,
      budget,
      chargeOnListing: true,
      readAhead: concurrency.listReadAhead,
      retry: options.retry,
    });
    const appEntry = (await client.listApps()).entries.find((entry) => entry.record?.id === job.sourceAppId);
    const app = appEntry?.record;
    if (!appEntry || !app) throw new ImportFailure('This Storyly token cannot read the chosen app.');
    // Only the chosen app's differences are listed: the others' go back to the budget.
    budget.remaining = MAX_IMPORT_REPORT_DIFFERENCES - appEntry.differences.length;
    if (!(await setSourceAppName(db, job, text(app.name)))) throw new ClaimLostError();
    const instances = await client.listInstances(app.id);
    // What this import may spend on media in all: once spent, the rest is listed as not imported.
    const mediaBudget = mediaJobBudget(options.mediaPolicy);
    // At most so many connections to one media host at once, counted per hop (a redirect's target counts).
    const mediaPolicy: MediaFetchPolicy = {
      ...options.mediaPolicy,
      hostSlots: new HostLimiter(concurrency.mediaPerHost),
    };
    // The media copies' database work, below the pool's size so the API's own requests keep connections.
    const dbSlots = new Limiter(Math.max(1, Math.min(concurrency.media, options.dbConcurrency ?? concurrency.media)));
    // What the admin picked; without a selection, everything. Media and tags need tale groups.
    const selection = job.selection ?? undefined;
    const picks = (entity: 'media' | 'tags') => !selection || (selection.taleGroups && selection[entity]);
    // Every source string is already made safe as it is stored; redactDeep is a last guard.
    const report = redactDeep(
      await importContent(db, job.projectId, instances, client, beat, {
        app: appEntry,
        text,
        budget,
        selection,
        concurrency,
        signal: stop.signal,
        appId: app.id,
        labels: picks('tags') ? (signal) => client.listLabels(app.id, signal) : undefined,
        claimCheck: () => beat(),
        media: !picks('media')
          ? undefined
          : {
              storage: options.storage,
              copy: (url, mimeType, signal, ticket) =>
                copyMedia(options.storage, url, mimeType, mediaPolicy, mediaBudget, signal, ticket),
              turns: new BudgetTurns(),
              withDb: (work) => dbSlots.run(work),
              // The claim guard: a run that lost its job writes no media.
              beforeWrite: async (tx) => {
                if (!(await holdsImportJob(tx, job))) throw new ClaimLostError();
              },
              onCleanupError: (err) =>
                log('error', `Import ${job.id} could not delete an unused media file`, redactedError(err, secret)),
            },
      }),
      token,
    );
    if (!(await finishImportJob(db, job, report))) throw new ClaimLostError();
    const count = (name: string, c: ImportCount | undefined) => `${c?.imported ?? 0} of ${c?.source ?? 0} ${name}`;
    log(
      'info',
      `Import ${job.id} done: ${count('zones', report.zones)}, ${count('tale groups', report.taleGroups)}, ` +
        `${count('tales', report.tales)}, ${count('media files', report.media)}, ${count('tags', report.tags)}`,
    );
  } catch (err) {
    if (err instanceof ClaimLostError) {
      log('info', `Import ${job.id} was taken over by another worker; this run stopped`);
      return;
    }
    if (!isKnownFailure(err)) log('error', `Import ${job.id} failed`, redactedError(err, token));
    try {
      await failImportJob(db, job, failureMessage(err, token), latest && progressOf(latest, notPicked));
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
  /** Sweeps unused imported media files when it starts (the default); tests may turn it off. */
  sweepOnStart?: boolean;
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

  // Clears what interrupted imports left in storage, once, before the first poll.
  const sweep = async (): Promise<void> => {
    // Baselines of records deleted in TaleArt, checked through their owning modules (no foreign keys, AD-1).
    try {
      const forgotten = await sweepImportRecords(db, {
        zone: (id) => zoneExists(db, id),
        taleGroup: (id) => taleGroupExists(db, id),
        tale: (id) => taleExists(db, id),
      });
      if (forgotten > 0) log('info', `Removed ${forgotten} import baseline(s) of records that no longer exist`);
    } catch (err) {
      log('error', 'Import worker could not sweep import baselines', err);
    }
    if (!isSweepable(options.storage)) return;
    try {
      const swept = await sweepImportedMedia(db, options.storage);
      if (swept.temporary + swept.imported > 0) {
        log('info', `Removed ${swept.temporary} stale temporary and ${swept.imported} unused imported media file(s)`);
      }
    } catch (err) {
      log('error', 'Import worker could not sweep unused media files', err);
    }
    // Font files an upload stored but whose row never committed (Tale Studio R18).
    try {
      const fonts = await sweepUnusedFontFiles(db, options.storage);
      if (fonts > 0) log('info', `Removed ${fonts} font file(s) no font names`);
    } catch (err) {
      log('error', 'Import worker could not sweep unused font files', err);
    }
  };

  let current: Promise<void> = (options.sweepOnStart === false ? Promise.resolve() : sweep()).then(drain);

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
