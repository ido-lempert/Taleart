import type { ImportDifference, ImportDifferenceEntity, ImportDifferenceKind } from '@taleart/contract';

/**
 * The shape the import expects of one kind of source record (FR-029, AD-8):
 * the fields it needs, the fields TaleArt does not hold, and the fields it
 * knows and leaves aside (source bookkeeping, or fields a later importer story
 * maps). Field names come from the import mapping and the research digests;
 * the real run (importer story 3) confirms or corrects them.
 */
interface RecordShape {
  /** Needed fields: absent is `missing`, null or of the wrong type is `wrongType`. */
  required: readonly string[];
  /** Fields TaleArt does not hold: a value in one is `notHeld`. */
  notHeld: readonly string[];
  /** Fields known and not carried by this import, with no difference. */
  known: readonly string[];
  /** Other names an expected field may come under, besides spellings that differ only in case, `_` or `-`. */
  aliases?: Readonly<Record<string, readonly string[]>>;
}

const SHAPES: Readonly<Record<ImportDifferenceEntity, RecordShape>> = {
  app: {
    required: ['id', 'title'],
    notHeld: ['settings'],
    known: ['token', 'category', 'store_type', 'store_id', 'account_id', 'is_inbox_story', 'detailed_info'],
    aliases: { title: ['name'] },
  },
  zone: {
    required: ['id', 'title'],
    // The instance's per-platform token: zones have their own keys.
    notHeld: ['token'],
    known: ['app_id', 'platform'],
    aliases: { title: ['name'] },
  },
  taleGroup: {
    required: ['id', 'title', 'sort_order', 'status'],
    // `media` is the group's cover.
    notHeld: ['media', 'pinned', 'settings', 'clicked_target_cap'],
    known: ['segments', 'ts_start', 'ts_end', 'app_id', 'instance_id', 'account_id', 'ts_created', 'ts_updated'],
    // A documented error spells it `click_target_cap` (digest entities-content-r1-1).
    aliases: { title: ['name'], clicked_target_cap: ['click_target_cap'] },
  },
  tale: {
    required: ['id', 'title', 'sort_order', 'status', 'media'],
    // `name` is the story's internal name: a difference only when it is not its title.
    notHeld: ['deep_link', 'outlink', 'button_text', 'settings', 'target_cap', 'studio_image', 'thumbnail', 'name'],
    known: ['type', 'mime_type', 'media_raw', 'ts_start', 'ts_end', 'story_group_id', 'account_id', 'ts_created', 'ts_updated'],
  },
};


/** The longest field name, record title or id a report stores. */
export const REPORT_TEXT_LIMIT = 200;

/** The most differences built for one record; the rest are only counted. */
export const MAX_DIFFERENCES_PER_RECORD = 50;

/**
 * Text as a report or job row stores it: the token removed from the whole
 * text first, then cut to `limit` characters, so a cut never leaves part of
 * the token behind. Every source string a report holds goes through it.
 */
export function storedText(text: string, token: string | null = null, limit = REPORT_TEXT_LIMIT): string {
  const clean = token ? text.split(token).join('[token]') : text;
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/** How a report's source strings are made safe to store; {@link storedText} without a token by default. */
export type ReportText = (text: string) => string;

const cutOnly: ReportText = (text) => storedText(text);

/**
 * How many more differences the report can take, shared by the checks of one
 * import: once it reaches 0, records are still checked and their differences
 * counted, but no more difference objects are built.
 */
export interface DifferenceBudget {
  remaining: number;
}

/** The fields one record maps from, once checked. */
export interface CheckedRecord {
  id: string;
  /** The record's title, or '' when it has none usable. */
  name: string;
  /** Its source position, or null when it has none usable. */
  sortOrder: number | null;
}

/**
 * The result of checking one record: the record, or null when it cannot be
 * imported; the differences built, in field order; and how many more were
 * found but not built (the record's cap or the report's budget).
 */
export interface RecordCheck {
  record: CheckedRecord | null;
  differences: ImportDifference[];
  omitted: number;
}

/** How to check: the report text helper and the budget it draws on. */
export interface CheckOptions {
  text?: ReportText;
  budget?: DifferenceBudget;
}

const hasField = (record: object, field: string): boolean => Object.prototype.hasOwnProperty.call(record, field);

const normalized = (name: string): string => name.toLowerCase().replace(/[_-]/g, '');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A value worth reporting in a field TaleArt does not hold.
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    for (const key in value) if (hasField(value, key)) return true;
    return false;
  }
  return true;
}

const idOf = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return null;
};

// A `sort_order` as a number; the API types numbers as strings in places.
const sortOrderOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
};

/**
 * Checks one source record against the shape the import expects of its entity
 * and returns the fields to map with every difference. A field found under
 * another name is used under that name. A record that is not an object or has
 * no usable id cannot be imported: it comes back null with one
 * `invalidRecord` difference. Differences carry field names only, never
 * values, each through `options.text`. At most
 * {@link MAX_DIFFERENCES_PER_RECORD} are built, and none once the budget is
 * spent; the rest are counted in `omitted`. The work is linear in the
 * record's number of fields. `position` is the record's place in its list,
 * from 1.
 */
export function checkRecord(
  entity: ImportDifferenceEntity,
  raw: unknown,
  position: number,
  options: CheckOptions = {},
): RecordCheck {
  const shape = SHAPES[entity];
  const text = options.text ?? cutOnly;
  const budget = options.budget;
  const differences: ImportDifference[] = [];
  let omitted = 0;
  let recordRef: ImportDifference['record'] = { sourceId: null, name: null, within: null, withinSourceId: null, position };
  const add = (kind: ImportDifferenceKind, field: string | null, sourceField: string | null = null) => {
    if (differences.length >= MAX_DIFFERENCES_PER_RECORD || (budget !== undefined && budget.remaining <= 0)) {
      omitted++;
      return;
    }
    if (budget !== undefined) budget.remaining--;
    differences.push({
      entity,
      record: recordRef,
      kind,
      field: field === null ? null : text(field),
      sourceField: sourceField === null ? null : text(sourceField),
    });
  };
  if (!isPlainObject(raw)) {
    add('invalidRecord', null);
    return { record: null, differences, omitted };
  }

  const keys = Object.keys(raw);
  const expected = [...shape.required, ...shape.notHeld, ...shape.known];
  const expectedSet = new Set(expected);
  // The other fields by their name ignoring case, `_` and `-`, built once: the first spelling wins.
  const others = new Map<string, string>();
  for (const key of keys) {
    if (expectedSet.has(key)) continue;
    const norm = normalized(key);
    if (!others.has(norm)) others.set(norm, key);
  }

  // Each expected field's value, found under its name, an alias or another spelling.
  const values = new Map<string, unknown>();
  const renames: { field: string; sourceField: string }[] = [];
  const consumed = new Set<string>();
  for (const field of expected) {
    if (hasField(raw, field)) {
      values.set(field, raw[field]);
      consumed.add(field);
    }
  }
  for (const field of expected) {
    if (values.has(field)) continue;
    const candidates = [...(shape.aliases?.[field] ?? []).filter((alias) => hasField(raw, alias)), others.get(normalized(field))];
    const sourceField = candidates.find(
      (key): key is string => key !== undefined && !consumed.has(key) && !expectedSet.has(key),
    );
    if (sourceField === undefined) continue;
    consumed.add(sourceField);
    values.set(field, raw[sourceField]);
    renames.push({ field, sourceField });
  }

  const id = idOf(values.get('id'));
  const title = values.get('title');
  const name = typeof title === 'string' ? title : '';
  recordRef = {
    sourceId: id === null ? null : text(id),
    name: typeof title === 'string' && title.trim() !== '' ? text(title.trim()) : null,
    within: null,
    withinSourceId: null,
    position,
  };
  if (id === null) {
    add('invalidRecord', null);
    return { record: null, differences, omitted };
  }

  for (const { field, sourceField } of renames) add('renamed', field, sourceField);
  for (const field of shape.required) {
    if (field === 'id') continue;
    if (!values.has(field)) {
      add('missing', field);
      continue;
    }
    const value = values.get(field);
    const wrong =
      value === null ||
      (field === 'title' && typeof value !== 'string') ||
      (field === 'sort_order' && sortOrderOf(value) === null);
    if (wrong) add('wrongType', field);
  }
  for (const field of shape.notHeld) {
    const value = values.get(field);
    if (!hasValue(value)) continue;
    // A story's internal name that repeats its title loses nothing.
    if (entity === 'tale' && field === 'name' && typeof value === 'string' && value.trim() === name.trim()) continue;
    add('notHeld', field);
  }
  for (const key of keys) {
    if (!consumed.has(key)) add('unexpected', key);
  }

  const sortOrder = shape.required.includes('sort_order') ? sortOrderOf(values.get('sort_order')) : null;
  return { record: { id, name, sortOrder }, differences, omitted };
}
