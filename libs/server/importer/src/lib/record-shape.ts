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

/** The longest field name or record title a report stores. */
export const REPORT_TEXT_LIMIT = 200;

/** Cuts report text to {@link REPORT_TEXT_LIMIT} characters. */
export const reportText = (text: string): string =>
  text.length > REPORT_TEXT_LIMIT ? `${text.slice(0, REPORT_TEXT_LIMIT - 1)}…` : text;

/** The fields one record maps from, once checked. */
export interface CheckedRecord {
  id: string;
  /** The record's title, or '' when it has none usable. */
  name: string;
  /** Its source position, or null when it has none usable. */
  sortOrder: number | null;
  /** How the record differs from its expected shape, in field order. */
  differences: ImportDifference[];
}

/** The result of checking one record: the record, or null when it cannot be imported. */
export interface RecordCheck {
  record: CheckedRecord | null;
  differences: ImportDifference[];
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
  if (typeof value === 'object') return Object.keys(value).length > 0;
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
 * values. `position` is the record's place in its list, from 1.
 */
export function checkRecord(
  entity: ImportDifferenceEntity,
  raw: unknown,
  position: number,
  within: string | null = null,
): RecordCheck {
  const shape = SHAPES[entity];
  const differences: ImportDifference[] = [];
  if (!isPlainObject(raw)) {
    const record = { sourceId: null, name: null, within, position };
    return { record: null, differences: [difference(entity, record, 'invalidRecord', null)] };
  }

  // Each expected field's value and the source name it came under.
  const values = new Map<string, unknown>();
  const renames: { field: string; sourceField: string }[] = [];
  const consumed = new Set<string>();
  const expected = [...shape.required, ...shape.notHeld, ...shape.known];
  const expectedSet = new Set(expected);
  for (const field of expected) if (hasField(raw, field)) consumed.add(field);
  for (const field of expected) {
    if (hasField(raw, field)) {
      values.set(field, raw[field]);
      continue;
    }
    const aliases = shape.aliases?.[field] ?? [];
    const sourceField = Object.keys(raw).find(
      (key) =>
        !consumed.has(key) &&
        !expectedSet.has(key) &&
        (aliases.includes(key) || normalized(key) === normalized(field)),
    );
    if (sourceField === undefined) continue;
    consumed.add(sourceField);
    values.set(field, raw[sourceField]);
    renames.push({ field, sourceField });
  }

  const id = idOf(values.get('id'));
  const title = values.get('title');
  const name = typeof title === 'string' ? title : '';
  const record = {
    sourceId: id === null ? null : reportText(id),
    name: typeof title === 'string' && title.trim() !== '' ? reportText(title.trim()) : null,
    within,
    position,
  };
  if (id === null) {
    return { record: null, differences: [difference(entity, record, 'invalidRecord', null)] };
  }

  for (const { field, sourceField } of renames) differences.push(difference(entity, record, 'renamed', field, sourceField));
  for (const field of shape.required) {
    if (field === 'id') continue;
    if (!values.has(field)) {
      differences.push(difference(entity, record, 'missing', field));
      continue;
    }
    const value = values.get(field);
    const wrong =
      value === null ||
      (field === 'title' && typeof value !== 'string') ||
      (field === 'sort_order' && sortOrderOf(value) === null);
    if (wrong) differences.push(difference(entity, record, 'wrongType', field));
  }
  for (const field of shape.notHeld) {
    const value = values.get(field);
    if (!hasValue(value)) continue;
    // A story's internal name that repeats its title loses nothing.
    if (entity === 'tale' && field === 'name' && typeof value === 'string' && value.trim() === name.trim()) continue;
    differences.push(difference(entity, record, 'notHeld', field));
  }
  for (const key of Object.keys(raw)) {
    if (!consumed.has(key)) differences.push(difference(entity, record, 'unexpected', key));
  }

  const sortOrder = shape.required.includes('sort_order') ? sortOrderOf(values.get('sort_order')) : null;
  return { record: { id, name, sortOrder, differences }, differences };
}

function difference(
  entity: ImportDifferenceEntity,
  record: ImportDifference['record'],
  kind: ImportDifferenceKind,
  field: string | null,
  sourceField: string | null = null,
): ImportDifference {
  return {
    entity,
    record,
    kind,
    field: field === null ? null : reportText(field),
    sourceField: sourceField === null ? null : reportText(sourceField),
  };
}
