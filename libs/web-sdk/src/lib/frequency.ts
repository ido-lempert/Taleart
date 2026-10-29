// The frequency cap (QW3): how often a viewer may see a tale group, counted in this browser only.

/** A frequency cap: `once`, `daily`, `weekly`, or N views over the lifetime of the group. */
export type FrequencyRule = 'once' | 'daily' | 'weekly' | number;

/** The local storage key of the views per tale group, in the host page's origin. */
export const VIEWS_STORAGE_KEY = 'taleart.views';

/** The most views remembered per group, newest kept. */
export const VIEWS_PER_GROUP = 50;

/** The most groups remembered; the oldest go first. */
export const VIEWED_GROUPS_LIMIT = 500;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The views of each group: timestamps (ms), newest last. */
type Views = Record<string, number[]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Parses a frequency option: `once`, `daily`, `weekly` or a count N from 1 to {@link VIEWS_PER_GROUP}
 * (a number or its text, as an attribute gives it). `null` for none (absent or empty); `undefined` for
 * a value that is not one of these. Pure: it never logs.
 */
export function parseFrequency(value: unknown): FrequencyRule | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (value === 'once' || value === 'daily' || value === 'weekly') return value;
  const count = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
  if (typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= VIEWS_PER_GROUP) return count;
  return undefined;
}

/** Local storage can be missing or blocked (it throws): both read as nothing viewed. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

// Anything stored that is not a map of number lists reads as nothing; bad entries are dropped.
function readViews(): Views {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(VIEWS_STORAGE_KEY) ?? '{}');
    if (!isRecord(value)) return {};
    const views: Views = {};
    for (const [id, list] of Object.entries(value)) {
      if (Array.isArray(list)) views[id] = list.filter((time): time is number => typeof time === 'number' && Number.isFinite(time));
    }
    return views;
  } catch {
    return {};
  }
}

/**
 * Counts a view of a tale group (a viewer open of it), at `now`. Kept only in the host's local
 * storage and never sent to TaleArt. Each group keeps its newest {@link VIEWS_PER_GROUP} views and
 * the storage its newest {@link VIEWED_GROUPS_LIMIT} groups.
 */
export function recordView(groupId: string, now: number = Date.now()): void {
  const views = readViews();
  const list = [...(views[groupId] ?? []), now].slice(-VIEWS_PER_GROUP);
  // Re-inserted, so the group is the newest key; the oldest keys go first.
  delete views[groupId];
  views[groupId] = list;
  const ids = Object.keys(views);
  for (const id of ids.slice(0, Math.max(0, ids.length - VIEWED_GROUPS_LIMIT))) delete views[id];
  try {
    storage()?.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Full or blocked storage: the view is not counted.
  }
}

/**
 * The ids, of those given, whose views have reached the rule at `now`: `once` after one view,
 * `daily` within 24 h of the last view, `weekly` within 7 days of it, and a number N after N views.
 */
export function cappedGroupIds(groupIds: readonly string[], rule: FrequencyRule, now: number = Date.now()): Set<string> {
  const views = readViews();
  const capped = new Set<string>();
  for (const id of groupIds) {
    const list = views[id] ?? [];
    if (list.length === 0) continue;
    const last = Math.max(...list);
    const reached =
      rule === 'once' ||
      (rule === 'daily' && now - last < DAY_MS) ||
      (rule === 'weekly' && now - last < WEEK_MS) ||
      (typeof rule === 'number' && list.length >= rule);
    if (reached) capped.add(id);
  }
  return capped;
}
