import { MAX_TAG_NAME_LENGTH } from '@taleart/contract';
import type {
  ImportChangeCount,
  ImportCount,
  ImportDifference,
  ImportDifferenceEntity,
  ImportDifferenceRecord,
  ImportEntityChoice,
  ImportMediaFailure,
  ImportProgressCount,
  ImportStatus,
  ImportTagFailure,
} from '@taleart/contract';

// What the Import from Storyly pages share: state labels and pills, counts and times.

const STATUS_LABELS: Record<ImportStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

/** A job state as people read it. */
export function importStatusLabel(status: ImportStatus): string {
  return STATUS_LABELS[status];
}

/** The pill classes of a job state: done, failed, or still active. */
export function importStatusClass(status: ImportStatus): string {
  return `pill ${status === 'done' ? 'pill--done' : status === 'failed' ? 'pill--failed' : 'pill--active'}`;
}

/**
 * One report row's counts: "3 source / 3 imported", with the skipped ones when
 * there are any, and how many of those were not selected.
 */
export function importCountText(count: ImportCount): string {
  const text = `${count.source} source / ${count.imported} imported`;
  if (count.skipped === 0) return text;
  const notSelected = count.notSelected ? ` (${count.notSelected} not selected)` : '';
  return `${text} / ${count.skipped} skipped${notSelected}`;
}

const ENTITY_CHOICE_LABELS: Record<ImportEntityChoice, string> = {
  taleGroups: 'Tale groups and tales',
  media: 'Media',
  tags: 'Tags',
};

/** A report row for content left out because it was not selected, such as "Tags: not selected, skipped". */
export function importNotSelectedText(entity: ImportEntityChoice): string {
  return `${ENTITY_CHOICE_LABELS[entity]}: not selected, skipped`;
}

/**
 * What an import changed for one report row, after its counts: " · 1 updated, 14 unchanged". Empty for a
 * report made before re-imports updated records, or when nothing was counted.
 */
export function importChangeText(change: ImportChangeCount | undefined): string {
  if (!change) return '';
  const parts = [
    change.created > 0 ? `${change.created} created` : '',
    change.updated > 0 ? `${change.updated} updated` : '',
    change.unchanged > 0 ? `${change.unchanged} unchanged` : '',
    change.keptLocalEdit > 0 ? `${change.keptLocalEdit} kept as changed in TaleArt` : '',
    change.removedAtSource > 0 ? `${change.removedAtSource} no longer at the source` : '',
  ].filter((part) => part !== '');
  return parts.length > 0 ? ` · ${parts.join(', ')}` : '';
}

/** One progress row's counts: "6 read / 4 written". */
/** How long an import took, for its report: "42 s", "4 min 12 s", "1 h 3 min". */
export function importDurationText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return total % 60 === 0 ? `${minutes} min` : `${minutes} min ${total % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

export function importProgressText(count: ImportProgressCount): string {
  return `${count.read} read / ${count.written} written`;
}

/** A job time in the viewer's locale, such as "21 Oct 2026, 10:05". */
export function importTimeText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The differences of one source record, as the report lists them. */
export interface ImportDifferenceRecordView {
  key: string;
  /** The record: its title, or its place in the list; its source id; what it belongs to. */
  label: string;
  /** One line per difference, such as "deep_link: not held in TaleArt". */
  lines: string[];
}

/** The differences of one entity type, record by record. */
export interface ImportDifferenceGroupView {
  entity: ImportDifferenceEntity;
  label: string;
  count: number;
  records: ImportDifferenceRecordView[];
}

const ENTITY_LABELS: Record<ImportDifferenceEntity, string> = {
  app: 'App',
  zone: 'Zones',
  taleGroup: 'Tale groups',
  tale: 'Tales',
  tag: 'Tags',
};

const ENTITY_ORDER: readonly ImportDifferenceEntity[] = ['app', 'zone', 'taleGroup', 'tale', 'tag'];

/** Groups with up to this many differences start open. */
export const IMPORT_DIFFERENCES_OPEN_LIMIT = 20;

/** How many records an open group shows at a time; "Show more" adds as many again. */
export const IMPORT_DIFFERENCES_PAGE = 100;

const MEDIA_FAILURE_LABELS: Record<ImportMediaFailure, string> = {
  invalidUrl: 'not an http or https link',
  blockedAddress: 'its link leads to a private address',
  unreachable: 'its host could not be reached',
  timeout: 'the download took too long',
  tooManyRedirects: 'too many redirects',
  httpError: 'its host answered with an error',
  tooLarge: 'larger than a tale accepts',
  unsupportedType: 'not an accepted image or video',
  jobBudgetExceeded: 'the import reached its media limit',
};

const TAG_FAILURE_LABELS: Record<ImportTagFailure, string> = {
  blank: 'blank',
  tooLong: `longer than ${MAX_TAG_NAME_LENGTH} characters`,
  notText: 'not text',
  invalidCharacters: 'holds control characters',
};

/** One difference as a line under its record. */
export function importDifferenceText(difference: ImportDifference): string {
  const field = difference.field ?? '';
  switch (difference.kind) {
    case 'missing':
      return `${field}: missing`;
    case 'renamed':
      return `${field}: came as "${difference.sourceField ?? ''}"`;
    case 'unexpected':
      return `${field}: unexpected field`;
    case 'wrongType':
      return `${field}: empty or of the wrong type`;
    case 'notHeld':
      return `${field}: not held in TaleArt`;
    case 'invalidRecord':
      return 'could not be read, so it was skipped';
    case 'mediaNotImported': {
      const label = difference.reason && MEDIA_FAILURE_LABELS[difference.reason as ImportMediaFailure];
      return `${field}: not imported${label ? ` (${label})` : ''}, so the tale has no media`;
    }
    case 'tagNotImported': {
      const label = difference.reason && TAG_FAILURE_LABELS[difference.reason as ImportTagFailure];
      return `${field}: label not imported${label ? ` (${label})` : ''}`;
    }
    case 'keptLocalEdit':
      return `${field}: changed at the source, kept as changed in TaleArt`;
    case 'removedAtSource':
      return difference.entity === 'tag'
        ? `${field}: label no longer at the source; the tag stays`
        : 'no longer at the source; kept in TaleArt';
    case 'movedAtSource':
      return `${field}: moved to "${difference.record.within ?? ''}" at the source; it stays where it is in TaleArt`;
  }
}

/** A source record as people find it: "Summer sale" (id 3001) in "Home page". */
export function importDifferenceRecordLabel(record: ImportDifferenceRecord): string {
  const parts = [
    record.name !== null ? `"${record.name}"` : record.position !== null ? `Record ${record.position}` : 'A record',
  ];
  if (record.sourceId !== null) parts.push(`(id ${record.sourceId})`);
  if (record.within !== null) parts.push(`in "${record.within}"`);
  return parts.join(' ');
}

/**
 * A report's differences grouped by entity type, then by record in the order
 * they were read, so a long list stays readable.
 */
export function importDifferenceGroups(differences: readonly ImportDifference[]): ImportDifferenceGroupView[] {
  const groups = new Map<ImportDifferenceEntity, ImportDifferenceGroupView>();
  const records = new Map<string, ImportDifferenceRecordView>();
  for (const difference of differences) {
    let group = groups.get(difference.entity);
    if (!group) {
      group = { entity: difference.entity, label: ENTITY_LABELS[difference.entity], count: 0, records: [] };
      groups.set(difference.entity, group);
    }
    group.count++;
    const { record } = difference;
    // One record: its entity, its parent's source id, and its own source id, or its place in its list when it has
    // none. Encoded as a JSON array, so no id can pass for a place or for another field.
    const key = JSON.stringify([
      difference.entity,
      record.withinSourceId,
      record.sourceId,
      record.sourceId === null ? record.position : null,
    ]);
    let view = records.get(key);
    if (!view) {
      view = { key, label: importDifferenceRecordLabel(record), lines: [] };
      records.set(key, view);
      group.records.push(view);
    }
    view.lines.push(importDifferenceText(difference));
  }
  return ENTITY_ORDER.flatMap((entity) => groups.get(entity) ?? []);
}

/** Pill colours of job states (story 14 tokens), for both import pages. */
export const IMPORT_PILL_STYLES = `
  .pill--done {
    background: #ecfdf3;
    color: #067647;
  }
  .pill--failed {
    background: var(--danger-tint);
    color: var(--danger-text);
  }
  .pill--active {
    background: var(--ember-tint);
    color: var(--ember-strong-hover);
  }
`;
