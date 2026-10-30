import {
  audienceRulePasses,
  MAX_AUDIENCE_CONDITIONS,
  validateAudienceRule,
  viewerPropertiesFrom,
  type AudienceCondition,
  type AudienceMatch,
  type AudienceOperator,
  type AudienceRule,
} from '@taleart/contract/core';

/**
 * The audience rule editor's draft (epic viewer properties): rows of property, operator and value,
 * turned into a rule the API checks with `validateAudienceRule`, and back. Pure, so the editor and
 * its tests share one reading of a row.
 */

/** How a row's value is typed: text, a number, true or false, or a comma-separated list. */
export type ValueKind = 'text' | 'number' | 'boolean';

/** One condition row as the editor holds it. `touched` is set once the person edits it, so its reason shows. */
export interface DraftRow {
  readonly key: number;
  readonly property: string;
  readonly operator: AudienceOperator;
  /** For `eq` and `neq` only: what the value is (text, number or boolean). */
  readonly kind: ValueKind;
  /** The value as typed: text, a number, `true` or `false`, or a comma-separated list for `in` and `notIn`. */
  readonly value: string;
  readonly touched: boolean;
}

/** The operators, in plain words, in the order the select offers them. */
export const OPERATOR_OPTIONS: readonly { value: AudienceOperator; label: string }[] = [
  { value: 'eq', label: 'is' },
  { value: 'neq', label: 'is not' },
  { value: 'in', label: 'is one of' },
  { value: 'notIn', label: 'is not one of' },
  { value: 'gt', label: 'is more than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'exists', label: 'is set' },
  { value: 'notExists', label: 'is not set' },
];

/** The value shape an operator takes: none, a list, a number, or (for `eq` and `neq`) the row's own kind. */
export function valueShape(row: Pick<DraftRow, 'operator' | 'kind'>): 'none' | 'list' | ValueKind {
  switch (row.operator) {
    case 'exists':
    case 'notExists':
      return 'none';
    case 'in':
    case 'notIn':
      return 'list';
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return 'number';
    case 'contains':
      return 'text';
    default:
      return row.kind;
  }
}

/** A new row: the property is blank, so the editor asks for it. */
export function emptyRow(key: number): DraftRow {
  return { key, property: '', operator: 'eq', kind: 'text', value: '', touched: false };
}

/** The value a row sends, typed for its shape; undefined for a blank value (the API then says it needs one). */
function conditionOf(row: DraftRow): Record<string, unknown> {
  const property = row.property.trim();
  const operator = row.operator;
  const shape = valueShape(row);
  const text = row.value.trim();
  if (shape === 'none') return { property, operator };
  if (text === '') return { property, operator };
  switch (shape) {
    case 'list':
      return { property, operator, value: text.split(',').map((item) => item.trim()).filter((item) => item !== '') };
    case 'number': {
      const n = Number(text);
      // A text that is not a number stays text, and the API says the operator needs a number.
      return { property, operator, value: Number.isFinite(n) ? n : text };
    }
    case 'boolean':
      return text === 'true' || text === 'false' ? { property, operator, value: text === 'true' } : { property, operator };
    default:
      return { property, operator, value: text };
  }
}

/** The rule the rows make, as the API checks it (not yet checked). */
export function rowsToRule(match: AudienceMatch, rows: readonly DraftRow[]): { match: AudienceMatch; conditions: unknown[] } {
  return { match, conditions: rows.map((row) => conditionOf(row)) };
}

/** The checked rule the rows make, or the reason the first problem is (with the row it is in). */
export function checkRows(
  match: AudienceMatch,
  rows: readonly DraftRow[],
):
  | { ok: true; rule: AudienceRule }
  | { ok: false; reason: string; index: number | null } {
  if (rows.length === 0) {
    return { ok: false, reason: 'Add a condition, or use Clear audience rule to remove the rule.', index: null };
  }
  if (rows.length > MAX_AUDIENCE_CONDITIONS) {
    return { ok: false, reason: `An audience rule has at most ${MAX_AUDIENCE_CONDITIONS} conditions.`, index: null };
  }
  const reasons = rows.map((_, index) => rowReason(match, rows, index));
  const first = reasons.findIndex((reason) => reason !== null);
  if (first !== -1) return { ok: false, reason: reasons[first] ?? '', index: first };
  const checked = validateAudienceRule(rowsToRule(match, rows));
  return checked.ok ? { ok: true, rule: checked.rule } : { ok: false, reason: checked.reason, index: null };
}

/**
 * Why one row is not valid, in words, or null when it is. The API's reason for the condition alone
 * (its "Condition 1: " prefix dropped), so a row's message reads for that row.
 */
export function rowReason(match: AudienceMatch, rows: readonly DraftRow[], index: number): string | null {
  const row = rows[index];
  if (!row) return null;
  const checked = validateAudienceRule({ match, conditions: [conditionOf(row)] });
  return checked.ok ? null : checked.reason.replace(/^Condition 1: /, '');
}

/** The draft a saved rule opens with: one row per condition, values as text. */
export function rowsFromRule(rule: AudienceRule | null | undefined): { match: AudienceMatch; rows: DraftRow[] } {
  const conditions: AudienceCondition[] = Array.isArray(rule?.conditions) ? rule.conditions : [];
  const rows = conditions.map((condition, i) => {
    const value = condition.value;
    const kind: ValueKind =
      typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
    const text = Array.isArray(value) ? value.join(', ') : value === undefined ? '' : String(value);
    return { key: i + 1, property: condition.property, operator: condition.operator, kind, value: text, touched: false };
  });
  return { match: rule?.match === 'any' ? 'any' : 'all', rows };
}

/**
 * What the Try it box says about the draft rule for sample viewer properties, typed as JSON.
 * An empty box is a viewer with no properties, which the API's rules leave to show the group.
 */
export type TryResult =
  | { kind: 'invalid-json'; message: string }
  | { kind: 'shown'; noProperties: boolean; noRule: boolean }
  | { kind: 'hidden' };

export function tryAudience(rule: AudienceRule | null, json: string): TryResult {
  let parsed: unknown = null;
  if (json.trim() !== '') {
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      return { kind: 'invalid-json', message: err instanceof Error ? err.message : 'the text is not JSON' };
    }
  }
  const noRule = !rule || rule.conditions.length === 0;
  const noProperties = viewerPropertiesFrom(parsed) === null;
  if (audienceRulePasses(rule, parsed)) return { kind: 'shown', noProperties, noRule };
  return { kind: 'hidden' };
}
