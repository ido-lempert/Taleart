import { normalizeTagName, type ImportTagFailure } from '@taleart/contract';

// Storyly labels (its story group `segments` field and its segments list) as TaleArt tags (epic decision).
// The shapes are guesses until the real run (importer story 3): they are read defensively, and what cannot
// become a tag is a difference, never a failed job.

/** One value of a story group's `segments`, with its place in the list from 1. */
export interface LabelValue {
  position: number;
  value: unknown;
}

/** A group's `segments` read as a list of label values; `wrongType` when it is neither a list nor empty. */
export interface GroupLabels {
  values: LabelValue[];
  wrongType: boolean;
}

// Fields an object item may name its label under.
const LABEL_FIELDS = ['name', 'title', 'value', 'label'] as const;

/**
 * A story group's labels from its `segments` value: a list, or a JSON string
 * holding one (the create call takes it as a JSON string). Absent, null, `''`,
 * `'[]'` and `[]` hold none. Anything else is of the wrong type and holds none.
 */
export function groupLabels(segments: unknown): GroupLabels {
  let list = segments;
  if (typeof list === 'string') {
    if (list.trim() === '') return { values: [], wrongType: false };
    try {
      list = JSON.parse(list);
    } catch {
      return { values: [], wrongType: true };
    }
  }
  if (list === undefined || list === null) return { values: [], wrongType: false };
  if (!Array.isArray(list)) return { values: [], wrongType: true };
  return { values: list.map((value, index) => ({ position: index + 1, value })), wrongType: false };
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

/** Whether a label's text can name a tag: 1 to 40 characters once trimmed (the tag rule). */
export function labelOutcome(text: string | null): LabelOutcome {
  if (text === null) return { reason: 'notText' };
  const name = normalizeTagName(text);
  if (name !== null) return { name };
  return { reason: text.trim() === '' ? 'blank' : 'tooLong' };
}
