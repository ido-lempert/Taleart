// The tag rule (epic targeting R2, AD-13): which delivered tale groups a viewer sees, from the tags
// the host page passed. One function for every SDK and the dashboard preview; its test table is
// `targeting/tag-rule.cases.json`, which the native SDK runs too. No `import` of the generated
// values here, so the Web SDK bundles only these few lines.
import type { components } from '../generated/api';

/** How a tale group's targeting tags combine: `any` (the default) or `all` (epic targeting R1). */
export type TagMatch = components['schemas']['TagMatch'];

/** The match mode of a tale group that has none stored. */
export const DEFAULT_TAG_MATCH: TagMatch = 'any';

/** The match modes, the default first. */
export const TAG_MATCHES: readonly TagMatch[] = ['any', 'all'];

/** True for `any` or `all`. */
export function isTagMatch(value: unknown): value is TagMatch {
  return value === 'any' || value === 'all';
}

/** A tag as the rule compares it: trimmed and in lower case. */
export function normalizeTargetingTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * The viewer's tags as the rule compares them: non-text and blank values left out, each once,
 * trimmed and in lower case. Null (no `setTags` call) stays null.
 */
export function viewerTagSet(tags: readonly unknown[] | null | undefined): ReadonlySet<string> | null {
  if (!tags) return null;
  const set = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const normalized = normalizeTargetingTag(tag);
    if (normalized) set.add(normalized);
  }
  return set;
}

/**
 * True when a delivered tale group shows to a viewer by its tags (epic targeting R2): a group with
 * no tags passes; a viewer with no tags (null, or none left once blank values are dropped) passes;
 * with `any`, one of the group's tags must be among the viewer's; with `all`, every one. Case and
 * surrounding spaces are ignored. A match mode other than `all` reads as `any`.
 */
export function tagRulePasses(
  group: { readonly tags?: readonly string[] | null; readonly tagMatch?: string | null },
  viewerTags: ReadonlySet<string> | readonly unknown[] | null | undefined,
): boolean {
  const groupTags = (Array.isArray(group.tags) ? group.tags : [])
    .filter((tag): tag is string => typeof tag === 'string')
    .map(normalizeTargetingTag)
    .filter(Boolean);
  if (groupTags.length === 0) return true;
  const viewer = viewerTags instanceof Set ? viewerTags : viewerTagSet(viewerTags as readonly unknown[] | null);
  if (!viewer || viewer.size === 0) return true;
  return group.tagMatch === 'all'
    ? groupTags.every((tag) => viewer.has(tag))
    : groupTags.some((tag) => viewer.has(tag));
}
