import type {
  ImportCount,
  ImportDifference,
  ImportDifferenceEntity,
  ImportDifferenceRecord,
  ImportProgressCount,
  ImportStatus,
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

/** One report row's counts: "3 source / 3 imported", with the skipped ones when there are any. */
export function importCountText(count: ImportCount): string {
  const text = `${count.source} source / ${count.imported} imported`;
  return count.skipped > 0 ? `${text} / ${count.skipped} skipped` : text;
}

/** One progress row's counts: "6 read / 4 written". */
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
};

const ENTITY_ORDER: readonly ImportDifferenceEntity[] = ['app', 'zone', 'taleGroup', 'tale'];

/** Groups with up to this many differences start open. */
export const IMPORT_DIFFERENCES_OPEN_LIMIT = 20;

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
  }
}

/** A source record as people find it: "Summer sale" (id 3001) in "Home page". */
export function importDifferenceRecordLabel(record: ImportDifferenceRecord): string {
  const parts = [record.name !== null ? `"${record.name}"` : `Record ${record.position}`];
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
    const key = [difference.entity, record.within ?? '', record.sourceId ?? `#${record.position}`].join('\u0000');
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
