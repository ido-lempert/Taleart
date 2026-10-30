// The audience rule and viewer properties (epic viewer properties): which tale groups a viewer sees,
// from the properties the host page passed (segments, plan, age, ...). One function for every SDK
// and the dashboard preview; its test table is `targeting/audience-rule.cases.json`, which the native
// SDK runs too. Every decision is made on the client: the properties never leave the page. No
// `import` of the generated runtime values here, so the Web SDK bundles only these few lines.
import type { components } from '../generated/api';
import { normalizeTargetingTag } from './targeting';

/** A tale group's audience rule (OpenAPI `AudienceRule`): `match` over 1 to 10 conditions. */
export type AudienceRule = components['schemas']['AudienceRule'];
/** One test on one viewer property (OpenAPI `AudienceCondition`). */
export type AudienceCondition = components['schemas']['AudienceCondition'];
/** How a condition compares (OpenAPI `AudienceOperator`). */
export type AudienceOperator = components['schemas']['AudienceOperator'];
/** `all` or `any` (OpenAPI `AudienceRule.match`). */
export type AudienceMatch = AudienceRule['match'];
/** A viewer property's value: a string, a number, a boolean or a list of strings. */
export type ViewerPropertyValue = string | number | boolean | readonly string[];
/** The viewer's properties, normalised by {@link viewerPropertiesFrom}: valid entries only. */
export type ViewerProperties = Readonly<Record<string, ViewerPropertyValue>>;

/** The operators, in the order the OpenAPI enum lists them. */
export const AUDIENCE_OPERATORS: readonly AudienceOperator[] = [
  'eq',
  'neq',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'exists',
  'notExists',
];

/** The match modes: `all` needs every condition, `any` one of them. */
export const AUDIENCE_MATCHES: readonly AudienceMatch[] = ['all', 'any'];

/** Most conditions a rule holds. */
export const MAX_AUDIENCE_CONDITIONS = 10;
/** Longest property name (characters). */
export const MAX_PROPERTY_NAME_LENGTH = 64;
/** A property name: a letter, then letters, digits, `_`, `.` or `-`. Compared case-sensitively. */
export const PROPERTY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** Longest string value, in a property or in a rule (characters, UTF-16 units). */
export const MAX_PROPERTY_STRING_LENGTH = 256;
/** Most items in a list value, in a property or in a rule's `in`, `notIn` or list. */
export const MAX_PROPERTY_LIST_ITEMS = 50;
/** Most properties a viewer passes; the first valid ones in the order given are kept. */
export const MAX_VIEWER_PROPERTIES = 50;

const hasOwn = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isOperator = (value: unknown): value is AudienceOperator =>
  typeof value === 'string' && (AUDIENCE_OPERATORS as readonly string[]).includes(value);

// A string short enough to store and compare, as the limits say.
const shortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_PROPERTY_STRING_LENGTH;

// A list of strings within the limits: at least `min` items and at most MAX_PROPERTY_LIST_ITEMS.
const stringList = (value: unknown, min: number): value is string[] =>
  Array.isArray(value) &&
  value.length >= min &&
  value.length <= MAX_PROPERTY_LIST_ITEMS &&
  value.every(shortString);

// One viewer property as the SDK keeps it, or undefined when the entry is invalid (it is dropped).
function viewerValue(raw: unknown): ViewerPropertyValue | undefined {
  if (typeof raw === 'string') return shortString(raw) ? raw : undefined;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) return stringList(raw, 0) ? [...raw] : undefined;
  return undefined;
}

/**
 * The viewer's properties as the rule reads them. `null` or `undefined` (the page never passed
 * any) gives null: every rule passes. Anything else gives the valid entries: a name that matches
 * {@link PROPERTY_NAME_PATTERN}, a value that is a finite number, a boolean, a string of at most
 * {@link MAX_PROPERTY_STRING_LENGTH} characters, or a list of such strings of at most
 * {@link MAX_PROPERTY_LIST_ITEMS} items. Other entries are dropped (the SDK warns once), and only
 * the first {@link MAX_VIEWER_PROPERTIES} valid ones in the order given are kept. A value that is
 * not an object (an array, a string) gives no properties, `{}`.
 */
export function viewerPropertiesFrom(input: unknown): ViewerProperties | null {
  if (input === null || input === undefined) return null;
  const out: Record<string, ViewerPropertyValue> = {};
  if (!isPlainObject(input)) return out;
  let kept = 0;
  for (const name of Object.keys(input)) {
    if (kept >= MAX_VIEWER_PROPERTIES) break;
    if (!PROPERTY_NAME_PATTERN.test(name)) continue;
    const value = viewerValue(input[name]);
    if (value === undefined) continue;
    out[name] = value;
    kept += 1;
  }
  return out;
}

// The keys a condition may hold, and the ones a rule may hold; anything else is refused.
const CONDITION_KEYS = ['property', 'operator', 'value'];
const RULE_KEYS = ['match', 'conditions'];

// Why a condition is not valid, or null when it is. `value` is set only when the operator takes one.
function conditionProblem(input: unknown): string | null {
  if (!isPlainObject(input)) return 'a condition is an object with property, operator and value';
  const unknown = Object.keys(input).find((key) => !CONDITION_KEYS.includes(key));
  if (unknown !== undefined) return `unknown field "${unknown}"`;
  const { property, operator, value } = input;
  if (typeof property !== 'string' || !PROPERTY_NAME_PATTERN.test(property)) {
    return `property must be 1 to ${MAX_PROPERTY_NAME_LENGTH} characters: a letter, then letters, digits, "_", "." or "-"`;
  }
  if (!isOperator(operator)) return `operator must be one of ${AUDIENCE_OPERATORS.join(', ')}`;
  if (operator === 'exists' || operator === 'notExists') {
    return value === undefined ? null : `${operator} takes no value`;
  }
  if (value === undefined) return `${operator} needs a value`;
  switch (operator) {
    case 'eq':
    case 'neq':
      if (typeof value === 'string') return shortString(value) ? null : `a string is at most ${MAX_PROPERTY_STRING_LENGTH} characters`;
      if (typeof value === 'number') return Number.isFinite(value) ? null : `${operator} needs a number, a string or a boolean`;
      return typeof value === 'boolean' ? null : `${operator} needs a string, a number or a boolean`;
    case 'in':
    case 'notIn':
      return stringList(value, 1) ? null : `${operator} needs a list of 1 to ${MAX_PROPERTY_LIST_ITEMS} strings`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${operator} needs a number`;
    case 'contains':
      if (!shortString(value) || value.trim() === '') {
        return `contains needs a non-empty string of at most ${MAX_PROPERTY_STRING_LENGTH} characters`;
      }
      return null;
  }
}

/**
 * Checks an audience rule as the API stores it: an object with `match` (`all` or `any`) and 1 to
 * {@link MAX_AUDIENCE_CONDITIONS} conditions, each with a property name, a known operator and a
 * value of the kind the operator takes (none for `exists` and `notExists`). Unknown fields are
 * refused, so a rule never carries anything the SDKs do not read. Returns the rule as a clean copy
 * when it is valid, else the reason, in words a person can read, for the 400 message.
 */
export function validateAudienceRule(input: unknown): { ok: true; rule: AudienceRule } | { ok: false; reason: string } {
  if (!isPlainObject(input)) return { ok: false, reason: 'The audience rule is an object with match and conditions' };
  const unknown = Object.keys(input).find((key) => !RULE_KEYS.includes(key));
  if (unknown !== undefined) return { ok: false, reason: `The audience rule has an unknown field "${unknown}"` };
  const { match, conditions } = input;
  if (typeof match !== 'string' || !(AUDIENCE_MATCHES as readonly string[]).includes(match)) {
    return { ok: false, reason: 'match must be "all" or "any"' };
  }
  if (!Array.isArray(conditions) || conditions.length < 1 || conditions.length > MAX_AUDIENCE_CONDITIONS) {
    return { ok: false, reason: `An audience rule has 1 to ${MAX_AUDIENCE_CONDITIONS} conditions` };
  }
  const clean: AudienceCondition[] = [];
  for (let i = 0; i < conditions.length; i += 1) {
    const problem = conditionProblem(conditions[i]);
    if (problem !== null) return { ok: false, reason: `Condition ${i + 1}: ${problem}` };
    const condition = conditions[i] as Record<string, unknown>;
    const copy: AudienceCondition = { property: condition['property'] as string, operator: condition['operator'] as AudienceOperator };
    if (condition['value'] !== undefined) {
      const value = condition['value'];
      copy.value = (Array.isArray(value) ? [...value] : value) as AudienceCondition['value'];
    }
    clean.push(copy);
  }
  return { ok: true, rule: { match: match as AudienceMatch, conditions: clean } };
}

// Viewer and rule values are compared as the tag rule compares tags: NFC, trimmed, lower case.
function sameText(a: string, b: string): boolean {
  return normalizeTargetingTag(a) === normalizeTargetingTag(b);
}

// Whether a viewer value and a rule value are the same kind and equal (strings ignoring case).
function equal(viewer: ViewerPropertyValue, value: unknown): boolean {
  if (typeof viewer === 'string') return typeof value === 'string' && sameText(viewer, value);
  if (typeof viewer === 'number') return typeof value === 'number' && viewer === value;
  if (typeof viewer === 'boolean') return typeof value === 'boolean' && viewer === value;
  return false;
}

// One condition against the viewer's properties (present ones only: the caller has checked that they are set).
function conditionPasses(condition: { property: string; operator: string; value?: unknown }, viewer: ViewerProperties): boolean {
  const present = hasOwn(viewer, condition.property);
  if (condition.operator === 'exists') return present;
  if (condition.operator === 'notExists') return !present;
  // A missing property fails every test except the negated ones.
  if (!present) return condition.operator === 'neq' || condition.operator === 'notIn';
  const v = viewer[condition.property] as ViewerPropertyValue;
  const { value } = condition;
  switch (condition.operator) {
    case 'eq':
      return equal(v, value);
    case 'neq':
      // A value of another kind than the property's is a mismatch, which is false for every operator.
      return typeof v === typeof value && !Array.isArray(v) && !equal(v, value);
    case 'in':
      return typeof v === 'string' && Array.isArray(value) && value.some((item) => equal(v, item));
    case 'notIn':
      return typeof v === 'string' && Array.isArray(value) && !value.some((item) => equal(v, item));
    case 'gt':
      return typeof v === 'number' && typeof value === 'number' && v > value;
    case 'gte':
      return typeof v === 'number' && typeof value === 'number' && v >= value;
    case 'lt':
      return typeof v === 'number' && typeof value === 'number' && v < value;
    case 'lte':
      return typeof v === 'number' && typeof value === 'number' && v <= value;
    case 'contains': {
      if (typeof value !== 'string') return false;
      const needle = normalizeTargetingTag(value);
      if (typeof v === 'string') return normalizeTargetingTag(v).includes(needle);
      if (Array.isArray(v)) return v.some((item) => sameText(item, value));
      return false;
    }
    default:
      // An operator this version does not know fails closed.
      return false;
  }
}

/**
 * True when a tale group's audience rule shows it to a viewer with these properties (epic viewer
 * properties). A group with no rule, or a rule with no conditions, passes. Properties that were
 * never passed (null or undefined) make every rule pass, as a page without the feature shows
 * everything. Otherwise the properties are normalised with {@link viewerPropertiesFrom} and each
 * condition is tested: a missing property fails, except for `neq`, `notIn` and `notExists`; a value
 * of another kind than the property's fails; `all` needs every condition, `any` one of them.
 */
export function audienceRulePasses(rule: AudienceRule | null | undefined, properties: unknown): boolean {
  const conditions = rule?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  const viewer = viewerPropertiesFrom(properties);
  if (viewer === null) return true;
  const passes = (condition: AudienceCondition) => conditionPasses(condition, viewer);
  return rule?.match === 'all' ? conditions.every(passes) : conditions.some(passes);
}
