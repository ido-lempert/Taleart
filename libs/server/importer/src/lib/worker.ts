import { randomUUID } from 'node:crypto';
import {
  IMPORT_NOT_IMPORTED_BY_DESIGN,
  MAX_IMPORT_REPORT_DIFFERENCES,
  MAX_IMPORT_SELECTED_ZONES,
  MAX_TALES_PER_GROUP,
  type ImportCount,
  type ImportDifference,
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
  taleExists,
  taleGroupExists,
  TaleGroupFullError,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import { createZone, zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { decryptToken } from './crypto';
import { isLabelError, LabelImport } from './label-import';
import { groupLabels, labelText, MAX_GROUP_LABELS, MAX_GROUP_TAGS, MAX_LABEL_LIST_ENTRIES } from './labels';
import { inTransaction } from './transaction';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import {
  claimNextJob,
  failImportJob,
  finishImportJob,
  heartbeatImportJob,
  progressOf,
  recoverStaleJobs,
  setSourceAppName,
  type ClaimedJob,
} from './jobs';
import { findLinkTarget, lockLinkSource, saveLink, type LinkSource } from './links';
import {
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
  listStoryGroups(instanceId: string): Promise<SourceList<SourceStoryGroup>>;
  listStories(storyGroupId: string): Promise<SourceList<SourceStory>>;
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
  labels?: () => Promise<SourceList<SourceLabel>>;
  /**
   * What the admin picked: only the picked instances become zones, and with
   * `taleGroups` false no story group or story is read. The caller leaves out
   * `media` and `labels` when they were not picked. Absent takes everything.
   */
  selection?: ImportJobSelection;
}

/**
 * The report's differences (FR-029), in reading order: at most
 * {@link MAX_IMPORT_REPORT_DIFFERENCES} stored, the rest counted in
 * `differencesOmitted`. Each list is listed when it is read, entry by entry
 * in response order (unreadable records in place), each record once.
 */
function differenceList(report: ImportReport, budget: DifferenceBudget | undefined) {
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
          if (budget) budget.remaining += entry.differences.length;
          continue;
        }
        listed.add(entry.record.id);
      }
      addEntry(entry, parent);
    }
  };
  return { addEntry, addList, addOne, omit };
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
 * with their media when `options.media` is given, in source order, through the
 * zones and tales modules and the storage port (AD-8, AD-11, AD-14). Every
 * record is linked (AD-7), so a re-run
 * creates nothing twice: a linked record counts as imported while it exists,
 * else as skipped. A repeated source id is skipped, and so are the stories of
 * a group that is skipped; each unique story counts once, so source = imported
 * + skipped. A record without a source position is noted when it is created.
 * `beforeEach` runs before each record is written, with the report so far;
 * the worker refreshes its heartbeat and stores the progress there.
 */
export async function importContent(
  db: TransactionalDb,
  projectId: string,
  instanceList: SourceList<SourceInstance>,
  source: ContentSource,
  beforeEach: (sofar: Readonly<ImportReport>) => Promise<void> = async () => undefined,
  options: ImportContentOptions = {},
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
  const differences = differenceList(report, options.budget);
  if (options.app) differences.addEntry(options.app, null);
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
    try {
      await save();
    } catch (err) {
      if (!isLabelError(err)) throw err;
      report.notes.push(`${where}: labels could not be saved as tags, so they were not imported`);
    }
  };
  if (labels && options.labels) {
    // The app's labels list. Its path and shape are guesses until the real run, so a list that cannot be read
    // leaves the tags to the story groups' labels instead of failing the import.
    try {
      const labelList = await options.labels();
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
        report.notes.push(
          `Tags: ${beyond} label(s) past the first ${MAX_LABEL_LIST_ENTRIES} of the labels list were not read`,
        );
      }
      if (repeated > 0) report.notes.push(`Tags: ${repeated} repeated label record(s) of the labels list were skipped`);
      await saveLabels(() => labels.ensure([...new Set(names)]), 'Tags');
    } catch (err) {
      if (!(err instanceof StorylyUnavailableError || err instanceof StorylyTokenInvalidError)) throw err;
      report.notes.push(
        `Tags: the labels list could not be read (${text(err.message)}), so tags come from story groups only`,
      );
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
    const zoneName = instance.name.trim() || `Instance ${instance.id}`;
    if (picked !== null && notSelected !== null && !picked.has(instance.id)) {
      report.zones.skipped++;
      report.zones.notSelected = (report.zones.notSelected ?? 0) + 1;
      if (notSelected.zones.length < MAX_IMPORT_SELECTED_ZONES) {
        notSelected.zones.push({ sourceId: text(instance.id), name: text(zoneName) });
      }
      continue;
    }
    await beforeEach(report);
    const zoneId = await importZone(db, projectId, instance, zoneName);
    if (zoneId === null) {
      report.zones.skipped++;
      report.notes.push(`Zone "${text(zoneName)}": its earlier import was deleted, so it was not imported again`);
    } else {
      report.zones.imported++;
      // The source names no widget type, so the zone has no frame yet (epic decision).
      report.notes.push(`Zone "${text(zoneName)}": frame type unknown`);
    }
    // Zones only: no story group or story is read.
    if (!withGroups) continue;

    const groupList = checkedOf(await source.listStoryGroups(instance.id));
    const groups = inSourceOrder(recordsOf(groupList));
    report.taleGroups.source += groupList.entries.length;
    report.taleGroups.skipped += groupList.entries.length - groups.length;
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
          report.notes.push(
            `Tale group "${text(name)}": ${beyond} label(s) past the first ${MAX_GROUP_LABELS} were not read`,
          );
        }
        if (dropped > 0) {
          report.notes.push(
            `Tale group "${text(name)}": ${dropped} label(s) past its first ${MAX_GROUP_TAGS} tags were not imported`,
          );
        }
        groupTagNames.set(group.id, [...kept]);
        names.push(...kept);
      });
      await saveLabels(() => labels.ensure([...new Set(names)]), `Story groups of zone "${text(zoneName)}"`);
    }
    let groupsWithoutZone = 0;
    for (const group of groups) {
      if (seenGroups.has(group.id)) {
        report.taleGroups.skipped++;
        continue;
      }
      seenGroups.add(group.id);
      const name = groupName(group);
      const storyList = checkedOf(await source.listStories(group.id));
      const stories = recordsOf(storyList);
      // Each story's place in its list, from 1, as its differences name it.
      const positions = new Map<string, number>();
      storyList.entries.forEach((entry, index) => {
        if (entry.record !== null && !positions.has(entry.record.id)) positions.set(entry.record.id, index + 1);
      });
      report.tales.source += storyList.entries.length;
      report.tales.skipped += storyList.entries.length - stories.length;
      differences.addList(storyList, listedStories, parentOf(name, group.id));
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
      await beforeEach(report);
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
        skipGroup(`Tale group "${text(name)}": its zone was deleted during the import`);
        continue;
      }
      if (taleGroup === null) {
        skipGroup(`Tale group "${text(name)}": its earlier import was deleted, so it was not imported again`);
        continue;
      }
      report.taleGroups.imported++;
      if (taleGroup.created && group.sortOrder === null) report.notes.push(`Tale group "${text(name)}": ${NO_POSITION}`);
      const taleGroupId = taleGroup.id;
      if (labels) {
        // Adds the group's tags, keeping every tag it carries, also ones added in TaleArt.
        try {
          await labels.addToGroup(taleGroupId, groupTagNames.get(group.id) ?? []);
        } catch (err) {
          if (err instanceof TaleGroupNotFoundError) {
            report.notes.push(
              `Tale group "${text(name)}": it was deleted during the import, so its tags were not added`,
            );
          } else if (isLabelError(err)) {
            report.notes.push(`Tale group "${text(name)}": its labels could not be saved as tags, so none were added`);
          } else throw err;
        }
      }

      for (const story of inSourceOrder(stories)) {
        if (seenStories.has(story.id)) {
          report.tales.skipped++;
          continue;
        }
        seenStories.add(story.id);
        const title = taleTitle(story, name);
        await beforeEach(report);
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
            report.notes.push(`Tale "${text(title)}" in "${text(name)}": the tale group already holds ${MAX_TALES_PER_GROUP} tales`);
            continue;
          }
          if (err instanceof TaleGroupNotFoundError) {
            report.tales.skipped++;
            report.notes.push(`Tale "${text(title)}" in "${text(name)}": its tale group was deleted during the import`);
            continue;
          }
          throw err;
        }
        if (tale === null) {
          report.tales.skipped++;
          report.notes.push(`Tale "${text(title)}" in "${text(name)}": its earlier import was deleted, so it was not imported again`);
          continue;
        }
        report.tales.imported++;
        if (tale.created && story.sortOrder === null) report.notes.push(`Tale "${text(title)}" in "${text(name)}": ${NO_POSITION}`);
        if (options.media && report.media) {
          const outcome = await importTaleMedia(db, options.media, projectId, tale.id, story);
          if (outcome.kind === 'none') continue;
          report.media.source++;
          if (outcome.kind === 'imported') {
            report.media.imported++;
          } else {
            report.media.skipped++;
            if (outcome.kind === 'failed') {
              differences.addOne(
                mediaDifference(story, positions.get(story.id) ?? 1, parentOf(name, group.id), outcome.reason, text),
              );
            } else if (outcome.kind === 'keptOwn') {
              report.notes.push(
                `Tale "${text(title)}" in "${text(name)}": its media was set in TaleArt, so it was not replaced`,
              );
            } else {
              report.notes.push(
                `Tale "${text(title)}" in "${text(name)}": it was deleted during the import, so its media was not copied`,
              );
            }
          }
        }
      }
    }
    if (groupsWithoutZone > 0) {
      report.notes.push(
        `Zone "${text(zoneName)}": its ${groupsWithoutZone} tale group(s) were not imported, since the zone was not`,
      );
    }
  }
  if (labels) {
    report.tags = labels.count();
    report.notes.push(...labels.notes(text));
    // The mapping table: how labels combine is not carried.
    if (labels.anyRead) report.notes.push('Tags: whether labels combine with AND or OR is not imported');
  }
  if (picked !== null) {
    const gone = [...picked].filter((id) => !seenInstances.has(id)).length;
    if (gone > 0) {
      report.notes.push(`Zones: ${gone} picked zone(s) are no longer in the app, so they were not imported`);
    }
  }
  if (notSelected !== null && (notSelected.zones.length > 0 || notSelected.entities.length > 0)) {
    report.notSelected = notSelected;
  }
  if (withGroups) return report;
  // Tale groups and tales were not picked: the report has no counts for them.
  const zonesOnly: ImportReport = { ...report };
  delete zonesOnly.taleGroups;
  delete zonesOnly.tales;
  return zonesOnly;
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
  let token: string | null = null;
  // The running report: importContent keeps adding to it, so at a failure it tells how far the job got.
  let latest: Readonly<ImportReport> | undefined;
  const beat = async (sofar?: Readonly<ImportReport>) => {
    if (sofar) latest = sofar;
    if (!(await heartbeatImportJob(db, job, sofar && progressOf(sofar)))) throw new ClaimLostError();
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
    const secret = token;
    const text: ReportText = (value) => storedText(value, secret);
    // The report's budget, shared by every check of this import: once spent, differences are only counted.
    const budget: DifferenceBudget = { remaining: MAX_IMPORT_REPORT_DIFFERENCES };
    const client = new StorylyClient({ baseUrl: options.storylyApiUrl, token, fetch: options.fetch, budget });
    const appEntry = (await client.listApps()).entries.find((entry) => entry.record?.id === job.sourceAppId);
    const app = appEntry?.record;
    if (!appEntry || !app) throw new ImportFailure('This Storyly token cannot read the chosen app.');
    // Only the chosen app's differences are listed: the others' go back to the budget.
    budget.remaining = MAX_IMPORT_REPORT_DIFFERENCES - appEntry.differences.length;
    if (!(await setSourceAppName(db, job, text(app.name)))) throw new ClaimLostError();
    const instances = await client.listInstances(app.id);
    // What this import may spend on media in all: once spent, the rest is listed as not imported.
    const mediaBudget = mediaJobBudget(options.mediaPolicy);
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
        labels: picks('tags') ? () => client.listLabels(app.id) : undefined,
        media: !picks('media')
          ? undefined
          : {
              storage: options.storage,
              copy: (url, mimeType) => copyMedia(options.storage, url, mimeType, options.mediaPolicy, mediaBudget),
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
      await failImportJob(db, job, failureMessage(err, token), latest && progressOf(latest));
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
    if (!isSweepable(options.storage)) return;
    try {
      const swept = await sweepImportedMedia(db, options.storage);
      if (swept.temporary + swept.imported > 0) {
        log('info', `Removed ${swept.temporary} stale temporary and ${swept.imported} unused imported media file(s)`);
      }
    } catch (err) {
      log('error', 'Import worker could not sweep unused media files', err);
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
