import { hasControlCharacter, normalizeTagName, type ImportTagFailure } from '@taleart/contract';

// Storyly labels (its story group `segments` field and its segments list) as TaleArt tags (epic decision).
// The shapes are guesses until the real run (importer story 3): they are read defensively, and what cannot
// become a tag is a difference, never a failed job.

/** The most entries of the labels list one import reads; the rest are counted as skipped, with a note. */
export const MAX_LABEL_LIST_ENTRIES = 10_000;
/** The most values of one story group's `segments` read; the rest are counted as skipped, with a note. */
export const MAX_GROUP_LABELS = 500;
/** The most distinct tags one import finds or creates; later labels are counted as skipped, with a note. */
export const MAX_IMPORT_TAGS = 1_000;
/** The most tags one import adds to one tale group; the rest are counted as skipped, with a note. */
export const MAX_GROUP_TAGS = 100;
/** The longest `segments` JSON string parsed, in bytes; a longer one is of the wrong type. */
export const MAX_SEGMENTS_JSON_BYTES = 256 * 1024;

/** One value of a story group's `segments`, with its place in the list from 1. */
export interface LabelValue {
  position: number;
  value: unknown;
}

/**
 * A group's `segments` read as a list of label values: at most
 * {@link MAX_GROUP_LABELS}, with `beyond` counting the rest; `wrongType` when
 * it is neither a list nor empty.
 */
export interface GroupLabels {
  values: LabelValue[];
  beyond: number;
  wrongType: boolean;
}

// Fields an object item may name its label under.
const LABEL_FIELDS = ['name', 'title', 'value', 'label'] as const;

const NO_LABELS: GroupLabels = { values: [], beyond: 0, wrongType: false };
const WRONG_TYPE: GroupLabels = { values: [], beyond: 0, wrongType: true };

/**
 * A story group's labels from its `segments` value: a list, or a JSON string
 * holding one (the create call takes it as a JSON string) of at most
 * {@link MAX_SEGMENTS_JSON_BYTES}. Absent, null, `''`, `'[]'` and `[]` hold
 * none. Anything else is of the wrong type and holds none.
 */
export function groupLabels(segments: unknown): GroupLabels {
  let list = segments;
  if (typeof list === 'string') {
    if (list.trim() === '') return NO_LABELS;
    if (Buffer.byteLength(list, 'utf8') > MAX_SEGMENTS_JSON_BYTES) return WRONG_TYPE;
    try {
      list = JSON.parse(list);
    } catch {
      return WRONG_TYPE;
    }
  }
  if (list === undefined || list === null) return NO_LABELS;
  if (!Array.isArray(list)) return WRONG_TYPE;
  return {
    values: list.slice(0, MAX_GROUP_LABELS).map((value, index) => ({ position: index + 1, value })),
    beyond: Math.max(0, list.length - MAX_GROUP_LABELS),
    wrongType: false,
  };
}

/** A label value as text: a string, or the first string an object names it under; null when it has none. */
export function labelText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of LABEL_FIELDS) {
      if (typeof record[field] === 'string') return record[field] as string;
    }
  }
  return null;
}

/** What a label becomes: a tag name (trimmed), or why it cannot become one. */
export type LabelOutcome = { name: string } | { reason: ImportTagFailure };

/** Whether a label's text can name a tag, by the tag rule: 1 to 40 characters once trimmed, no control character. */
export function labelOutcome(text: string | null): LabelOutcome {
  if (text === null) return { reason: 'notText' };
  const name = normalizeTagName(text);
  if (name !== null) return { name };
  const trimmed = text.trim();
  if (trimmed === '') return { reason: 'blank' };
  return { reason: hasControlCharacter(trimmed) ? 'invalidCharacters' : 'tooLong' };
}

/** The text with each control character (U+0000 to U+001F, U+007F) replaced by U+FFFD, so it can be stored. */
export function printable(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code <= 0x1f || code === 0x7f ? '\ufffd' : text[i];
  }
  return out;
}
