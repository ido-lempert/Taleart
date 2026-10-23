/** The local storage key of this browser's visitor id, in the host page's origin. */
export const VISITOR_STORAGE_KEY = 'taleart.visitor';

/** The header every Delivery API request sends the visitor id in (epic UX rework 8.23). */
export const VISITOR_HEADER = 'X-TaleArt-Visitor';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// This page load's id once read or made, so storage is read once and a blocked storage keeps one id.
let current: string | null = null;

/** A random UUID v4: `crypto.randomUUID` where there is one (secure contexts), else `getRandomValues`. */
export function randomVisitorId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * This browser's visitor id: a random UUID v4 made once and kept in the host's local storage, with
 * no personal data in it; it goes only to the Delivery API, which limits requests per visitor.
 * Clearing the site's data makes a new one. When local storage is missing or blocked, the id lasts
 * this page load.
 */
export function visitorId(): string {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(VISITOR_STORAGE_KEY);
  } catch {
    // Missing or blocked storage: a new id for this page load.
  }
  if (stored && UUID_V4.test(stored)) {
    current = stored;
    return stored;
  }
  const made = randomVisitorId();
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, made);
  } catch {
    // Full or blocked storage: the id lasts this page load.
  }
  current = made;
  return made;
}

/** Forgets this page load's id, so the next call reads storage again. For tests. */
export function resetVisitorIdForTests(): void {
  current = null;
}
