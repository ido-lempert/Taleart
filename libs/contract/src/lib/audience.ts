// Who a targeted tale group is for, in plain words (epic targeting R7): the summary the dashboard's
// "Visible on site" indicator adds for a delivered group ("Visible on site · for viewers tagged summer
// or vip"). It reads only the targeting fields the Management API returns with every group, never a
// visibility reason: targeting narrows who sees a group, it does not make it "Not visible" (AD-6),
// so `delivery-rule.ts` and the indicator still agree. Story 4 adds user lists; story 7 adds segments
// here. Its own file, so the Web SDK, which imports the tag rule, does not bundle it.
//
// Epic viewer properties: the group's audience rule (its conditions on the viewer's properties) is
// named after the tags and lists: "for viewers tagged summer where plan is pro and age ≥ 30".

import type { AudienceCondition, AudienceRule } from './audience-rule';

/**
 * A tale group's targeting, as the Management API returns it: tags as `{ name }` (or names), the
 * match mode, and the user lists with how many IDs each holds.
 */
export interface GroupAudience {
  readonly tags?: readonly ({ readonly name: string } | string)[] | null;
  readonly tagMatch?: string | null;
  readonly userLists?: readonly { readonly id?: string; readonly name: string; readonly idCount: number }[] | null;
  /** The audience rule on the viewer's properties (epic viewer properties); absent or no conditions: none. */
  readonly audience?: AudienceRule | null;
}

/** How many tag names the summary line names before "N more"; the full list is in `audienceDetail`. */
export const AUDIENCE_SUMMARY_MAX_TAGS = 3;

/** What joins the indicator's line and the summary: "Visible on site · for …". */
export const AUDIENCE_SEPARATOR = ' · for ';

// The group's tag names, as stored (the API orders them by name), blank ones left out.
function tagNames(group: GroupAudience): string[] {
  return (Array.isArray(group.tags) ? group.tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim());
}

// The group's user lists as the summary names them, blank names left out.
function userLists(group: GroupAudience): { name: string; idCount: number }[] {
  return (Array.isArray(group.userLists) ? group.userLists : [])
    .filter((list) => typeof list?.name === 'string' && list.name.trim() !== '')
    .map((list) => ({ name: list.name.trim(), idCount: Number.isFinite(list.idCount) ? Math.max(0, list.idCount) : 0 }));
}

/** A count with thousands separators, the same in every locale: 1204 as "1,204". */
export function formatCount(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// The group's audience conditions, or none (a rule with no conditions passes every viewer).
function conditions(group: GroupAudience): AudienceCondition[] {
  return Array.isArray(group.audience?.conditions) ? group.audience.conditions : [];
}

/** True when the group shows only to some viewers: it has targeting tags, user lists or an audience rule. */
export function isTargeted(group: GroupAudience): boolean {
  return tagNames(group).length > 0 || userLists(group).length > 0 || conditions(group).length > 0;
}

// A condition in plain words, as the summary and the detail say it: "plan is pro", "age ≥ 30".
function conditionPhrase(condition: AudienceCondition): string {
  const { property: name, operator, value } = condition;
  const list = Array.isArray(value) ? value : [];
  const text = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  switch (operator) {
    case 'eq':
      return `${name} is ${text}`;
    case 'neq':
      return `${name} is not ${text}`;
    case 'in':
      return `${name} is one of ${joinNames(list, 'or')}`;
    case 'notIn':
      return `${name} is not one of ${joinNames(list, 'or')}`;
    case 'gt':
      return `${name} > ${text}`;
    case 'gte':
      return `${name} ≥ ${text}`;
    case 'lt':
      return `${name} < ${text}`;
    case 'lte':
      return `${name} ≤ ${text}`;
    case 'contains':
      return `${name} contains "${text}"`;
    case 'exists':
      return `${name} is set`;
    case 'notExists':
      return `${name} is not set`;
    default:
      return name;
  }
}

// The rule's conditions joined with "and" (All) or "or" (Any); past `max`, the rest as "N more".
function rulePhrase(group: GroupAudience, max: number): string | null {
  const phrases = conditions(group).map(conditionPhrase);
  if (phrases.length === 0) return null;
  const word = group.audience?.match === 'any' ? 'or' : 'and';
  return joinNames(shortened(phrases, max), word);
}

// "a", "a or b", "a, b or c"; with `all`, "and".
function joinNames(names: readonly string[], word: 'or' | 'and'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

// The first `max` items, then the rest as "N more".
function shortened(items: readonly string[], max: number): string[] {
  const limit = Math.max(1, Math.floor(max));
  return items.length > limit ? [...items.slice(0, limit), `${items.length - limit} more`] : [...items];
}

/**
 * Who the group is for, after "for": "viewers tagged summer or vip" (Any, the default),
 * "viewers tagged summer and vip" (All), "user list Loyal (1,204)", "user lists Loyal (1,204) or
 * VIP (30)", and both: "viewers tagged summer in user list Loyal (1,204)". Past `maxTags` names
 * (tags, and lists apart), the rest as "N more" ("viewers tagged a, b, c or 2 more"). Null for a
 * group with no audience, which every viewer sees.
 */
export function audienceSummary(group: GroupAudience, maxTags = AUDIENCE_SUMMARY_MAX_TAGS): string | null {
  const names = tagNames(group);
  const lists = userLists(group);
  const tagged =
    names.length > 0 ? `viewers tagged ${joinNames(shortened(names, maxTags), group.tagMatch === 'all' ? 'and' : 'or')}` : null;
  const listed =
    lists.length > 0
      ? `user list${lists.length > 1 ? 's' : ''} ${joinNames(
          shortened(
            lists.map((list) => `${list.name} (${formatCount(list.idCount)})`),
            maxTags,
          ),
          'or',
        )}`
      : null;
  const who = tagged && listed ? `${tagged} in ${listed}` : (tagged ?? listed);
  const rule = rulePhrase(group, maxTags);
  if (rule === null) return who;
  // With a rule: "for viewers where plan is pro and age ≥ 30", or "… tagged summer where plan is pro".
  return who ? `${who} where ${rule}` : `viewers where ${rule}`;
}

/** The indicator's line with the audience: "Visible on site · for viewers tagged summer or vip"; the line alone when none. */
export function withAudience(line: string, summary: string | null): string {
  return summary ? `${line}${AUDIENCE_SEPARATOR}${summary}` : line;
}

// "1 ID", "1,204 IDs".
function ids(n: number): string {
  return `${formatCount(n)} ID${n === 1 ? '' : 's'}`;
}

/**
 * The full audience, for the indicator's tooltip: every tag and list named, what a page that passes
 * no tags does (epic targeting R2: it shows every delivered group, or with lists every one the viewer
 * is listed for), and that a page without an external user ID does not show a group with lists
 * (R4). Empty for a group with no audience.
 */
export function audienceDetail(group: GroupAudience): string[] {
  const names = tagNames(group);
  const lists = userLists(group);
  const rule = rulePhrase(group, Number.MAX_SAFE_INTEGER);
  if (names.length === 0 && lists.length === 0 && rule === null) return [];
  const sentences: string[] = [];
  if (lists.length > 0) {
    const named = lists.map((list) => `${list.name} (${ids(list.idCount)})`);
    sentences.push(
      lists.length === 1
        ? `Shown to viewers whose external user ID is in the user list ${named[0]}.`
        : `Shown to viewers whose external user ID is in any of the user lists ${joinNames(named, 'or')}.`,
    );
  }
  if (names.length > 0) {
    const all = group.tagMatch === 'all';
    const who = lists.length > 0 ? 'Of those, to viewers' : 'Shown to viewers';
    sentences.push(
      names.length === 1
        ? `${who} tagged ${names[0]}.`
        : all
          ? `${who} tagged with all of ${joinNames(names, 'and')}.`
          : `${who} tagged with any of ${joinNames(names, 'or')}.`,
      lists.length > 0
        ? 'A page that passes no tags shows it to every viewer in its lists.'
        : 'A page that passes no tags shows it to every viewer.',
    );
  }
  if (lists.length > 0) sentences.push('A page that sets no external user ID does not show it.');
  if (rule !== null) {
    const shown = names.length > 0 || lists.length > 0 ? 'Of those, to viewers' : 'Shown to viewers';
    sentences.push(`${shown} where ${rule}.`, 'A page that passes no properties shows it to every viewer.');
  }
  return sentences;
}
