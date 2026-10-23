// Who a targeted tale group is for, in plain words (epic targeting R7): the summary the dashboard's
// "Visible on site" indicator adds for a delivered group ("Visible on site · for viewers tagged summer
// or vip"). It reads only the targeting fields the Management API returns with every group, never a
// visibility reason: targeting narrows who sees a group, it does not make it "Not visible" (AD-6),
// so `delivery-rule.ts` and the indicator still agree. Stories 4 and 7 add user lists and segments
// here. Its own file, so the Web SDK, which imports the tag rule, does not bundle it.

/** A tale group's targeting, as the Management API returns it: tags as `{ name }` (or names) and the match mode. */
export interface GroupAudience {
  readonly tags?: readonly ({ readonly name: string } | string)[] | null;
  readonly tagMatch?: string | null;
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

/** True when the group shows only to some viewers: it has targeting tags (story 7 adds lists and segments). */
export function isTargeted(group: GroupAudience): boolean {
  return tagNames(group).length > 0;
}

// "a", "a or b", "a, b or c"; with `all`, "and".
function joinNames(names: readonly string[], word: 'or' | 'and'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

/**
 * Who the group is for, after "for": "viewers tagged summer or vip" (Any, the default),
 * "viewers tagged summer and vip" (All); past `maxTags` names, the rest as "N more"
 * ("viewers tagged a, b, c or 2 more"). Null for a group with no audience, which every viewer sees.
 */
export function audienceSummary(group: GroupAudience, maxTags = AUDIENCE_SUMMARY_MAX_TAGS): string | null {
  const names = tagNames(group);
  if (names.length === 0) return null;
  const word = group.tagMatch === 'all' ? 'and' : 'or';
  const limit = Math.max(1, Math.floor(maxTags));
  const shown = names.length > limit ? [...names.slice(0, limit), `${names.length - limit} more`] : names;
  return `viewers tagged ${joinNames(shown, word)}`;
}

/** The indicator's line with the audience: "Visible on site · for viewers tagged summer or vip"; the line alone when none. */
export function withAudience(line: string, summary: string | null): string {
  return summary ? `${line}${AUDIENCE_SEPARATOR}${summary}` : line;
}

/**
 * The full audience, for the indicator's tooltip: every tag named, and what a page that passes no
 * tags does (epic targeting R2: it shows every delivered group). Empty for a group with no audience.
 */
export function audienceDetail(group: GroupAudience): string[] {
  const names = tagNames(group);
  if (names.length === 0) return [];
  const all = group.tagMatch === 'all';
  return [
    names.length === 1
      ? `Shown to viewers tagged ${names[0]}.`
      : all
        ? `Shown to viewers tagged with all of ${joinNames(names, 'and')}.`
        : `Shown to viewers tagged with any of ${joinNames(names, 'or')}.`,
    'A page that passes no tags shows it to every viewer.',
  ];
}
