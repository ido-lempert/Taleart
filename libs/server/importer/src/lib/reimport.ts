import type { ImportChangeCount } from '@taleart/contract';
import type { Db } from '@taleart/server-access';

/**
 * Re-import rules (AD-7: a re-run updates the linked records). The importer
 * keeps, per record it holds, what it last wrote there (the baseline), in
 * TaleArt terms and keyed by the TaleArt record, never by a source id. A
 * re-run compares three values per field: the source's, the baseline's and
 * the current one in TaleArt. A field nobody changed in TaleArt takes the
 * source's value; a field a person changed is kept.
 */

/** The kinds of records an import holds a baseline for. */
export type RecordType = 'zone' | 'taleGroup' | 'tale';

/** What an import last wrote to a record. Absent fields were never recorded. */
export interface RecordFields {
  /** A zone's or tale group's name, a tale's title. */
  name?: string;
  /** The imported records inside it (a zone's tale groups, a group's tales), as TaleArt ids in their order. */
  order?: string[];
  /** A tale group's tags the import gave it, by name in lower case. */
  tags?: string[];
}

/** What a merge decided for one field. */
export interface FieldMerge<T> {
  /** The value to write, or null to leave the field as it is. */
  write: T | null;
  /** True when the source changed the field but a person's value was kept. */
  keptLocalEdit: boolean;
  /** What to record as last written. */
  baseline: T;
}

/**
 * Merges one value. Current = source: nothing to write. Current = baseline:
 * nobody changed it in TaleArt, so the source's value is written. Otherwise a
 * person changed it: it is kept, and counts as a kept local edit when the
 * source changed it too. Without a baseline (a record imported before
 * re-imports), a current value that differs from the source is kept as a
 * person's edit, since nothing tells the two apart, and the source's value
 * becomes the baseline.
 */
export function mergeValue(baseline: string | undefined, current: string, source: string): FieldMerge<string> {
  if (current === source) return { write: null, keptLocalEdit: false, baseline: source };
  if (baseline === undefined) return { write: null, keptLocalEdit: true, baseline: source };
  if (current === baseline) return { write: source, keptLocalEdit: false, baseline: source };
  return { write: null, keptLocalEdit: source !== baseline, baseline };
}

// The ids of `list` that are in `members`, in the order of `list`.
const within = (list: readonly string[], members: ReadonlySet<string>): string[] =>
  list.filter((id) => members.has(id));

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Merges the order of the records an import holds inside one container (a
 * zone's tale groups, a group's tales). `current` is the container's whole
 * order now; `imported` the records this run imported into it, in source
 * order. Only their relative order is merged: other records (added in TaleArt,
 * or no longer at the source) keep their places, and the imported records are
 * laid out in the places they hold. A person's re-order of the imported
 * records is kept, as {@link mergeValue} keeps a value. `write` is the
 * container's whole new order.
 */
export function mergeOrder(
  baseline: readonly string[] | undefined,
  current: readonly string[],
  imported: readonly string[],
): FieldMerge<string[]> {
  const present = new Set(current);
  const desired = imported.filter((id) => present.has(id));
  const members = new Set(desired);
  const now = within(current, members);
  if (sameList(now, desired)) return { write: null, keptLocalEdit: false, baseline: desired };
  if (baseline === undefined) return { write: null, keptLocalEdit: true, baseline: desired };
  // The records both orders hold: did a person move them, did the source?
  const recorded = new Set(baseline);
  const common = new Set(now.filter((id) => recorded.has(id)));
  const movedHere = !sameList(within(now, common), within(baseline, common));
  if (movedHere) {
    const movedThere = !sameList(within(desired, common), within(baseline, common));
    return { write: null, keptLocalEdit: movedThere, baseline: [...baseline] };
  }
  // Lay the imported records out in the places they hold now, in source order.
  const queue = [...desired];
  const write = current.map((id) => (members.has(id) ? (queue.shift() as string) : id));
  return { write, keptLocalEdit: false, baseline: desired };
}

/** What a merge decided for a tale group's tags. */
export interface TagMerge {
  /** Source names to add to the group. */
  add: string[];
  /** Names the import gave the group earlier that the source no longer has and the group still carries: they stay. */
  removedAtSource: string[];
  /** What to record as given: the source's names, each once ignoring case. */
  baseline: string[];
}

/**
 * Merges a tale group's tags. Tags are only added: a source name new since
 * the baseline is added (every source name when there is no baseline), a tag
 * a person removed is not added again, and a name the source dropped stays on
 * the group and is reported. Names compare ignoring case, as tags do.
 */
export function mergeTags(
  baseline: readonly string[] | undefined,
  current: readonly string[],
  source: readonly string[],
): TagMerge {
  const key = (name: string) => name.toLowerCase();
  const carried = new Set(current.map(key));
  const given = baseline === undefined ? null : new Set(baseline.map(key));
  const wanted = new Map<string, string>();
  for (const name of source) if (!wanted.has(key(name))) wanted.set(key(name), name);
  const add = [...wanted].filter(([k]) => !carried.has(k) && (given === null || !given.has(k))).map(([, name]) => name);
  const removedAtSource = (baseline ?? []).filter((name) => !wanted.has(key(name)) && carried.has(key(name)));
  return { add, removedAtSource, baseline: [...wanted.values()] };
}

/** How one record came out of an import. */
export type RecordOutcome = 'created' | 'updated' | 'unchanged';

/** A count of record outcomes, all zero. */
export const emptyChanges = (): ImportChangeCount => ({
  created: 0,
  updated: 0,
  unchanged: 0,
  keptLocalEdit: 0,
  removedAtSource: 0,
});

/** Counts one record's outcome, and its kept local edit when it has one. */
export function countChange(count: ImportChangeCount, outcome: RecordOutcome, keptLocalEdit: boolean): void {
  count[outcome]++;
  if (keptLocalEdit) count.keptLocalEdit++;
}

/**
 * Locks a record's baseline row until the transaction ends and reads it; null
 * when the import recorded nothing for it yet. Every update of one record
 * takes this lock first, then the owning module's locks, so concurrent
 * re-imports update a record one after the other.
 */
export async function lockRecord(
  tx: Db,
  type: RecordType,
  targetId: string,
  projectId: string,
): Promise<RecordFields | null> {
  // A row to lock, also for records imported before baselines: it starts empty.
  const inserted = await tx.query<{ fields: RecordFields }>(
    `INSERT INTO import_records (target_type, target_id, project_id) VALUES ($1, $2, $3)
     ON CONFLICT (target_type, target_id) DO NOTHING RETURNING fields`,
    [type, targetId, projectId],
  );
  if (inserted.rows.length > 0) return null;
  const { rows } = await tx.query<{ fields: RecordFields }>(
    'SELECT fields FROM import_records WHERE target_type = $1 AND target_id = $2 FOR UPDATE',
    [type, targetId],
  );
  const fields = rows[0]?.fields;
  return fields && Object.keys(fields).length > 0 ? fields : null;
}

/** Records what the import last wrote to a record, merged into what it recorded before. */
export async function saveRecord(
  tx: Db,
  type: RecordType,
  targetId: string,
  projectId: string,
  fields: RecordFields,
): Promise<void> {
  await tx.query(
    `INSERT INTO import_records (target_type, target_id, project_id, fields) VALUES ($1, $2, $3, $4)
     ON CONFLICT (target_type, target_id) DO UPDATE
       SET fields = import_records.fields || EXCLUDED.fields, updated_at = now()`,
    [type, targetId, projectId, JSON.stringify(fields)],
  );
}

/** What the import recorded for these records, keyed by TaleArt id; records without a baseline are absent. */
export async function recordNames(
  db: Db,
  type: RecordType,
  targetIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (targetIds.length === 0) return names;
  const { rows } = await db.query<{ id: string; name: string | null }>(
    `SELECT target_id AS id, fields->>'name' AS name FROM import_records
     WHERE target_type = $1 AND target_id = ANY($2::uuid[])`,
    [type, targetIds],
  );
  for (const { id, name } of rows) if (name !== null) names.set(id, name);
  return names;
}
