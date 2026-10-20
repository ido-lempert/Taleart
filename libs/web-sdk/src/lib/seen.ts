/** The local storage key of the viewed tale group ids, in the host page's origin. */
export const SEEN_STORAGE_KEY = 'taleart.seen';

/** The most group ids remembered; the oldest go first. */
export const SEEN_LIMIT = 500;

// Local storage can be missing, blocked (it throws) or hold anything: all read as nothing seen.
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readIds(): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(SEEN_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The tale groups this browser has viewed. Kept only in the host's local
 * storage and never sent to TaleArt (AD-13).
 */
export function seenGroupIds(): Set<string> {
  return new Set(readIds());
}

/** Remembers that a tale group was viewed; newest last, capped at {@link SEEN_LIMIT}. */
export function markGroupSeen(id: string): void {
  const ids = readIds().filter((other) => other !== id);
  ids.push(id);
  try {
    storage()?.setItem(SEEN_STORAGE_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch {
    // Full or blocked storage: the group just shows unseen next time.
  }
}
