/** Failed password attempts a username may make before it waits (spec: 5). */
export const PASSWORD_FAILURES_BEFORE_WAIT = 5;

/** The wait after the first refused attempt: 30 s, doubling per further failure. */
export const PASSWORD_WAIT_BASE_MS = 30_000;

/** The longest wait for one username (spec: 15 minutes). */
export const PASSWORD_WAIT_MAX_MS = 15 * 60_000;

/** Failures older than this no longer count, so a username that was guessed at last week starts fresh. */
export const PASSWORD_FAILURES_FORGET_MS = 60 * 60_000;

/** The most usernames whose failures this process remembers; beyond it the least recently failed is forgotten. */
export const PASSWORD_THROTTLE_MAX_KEYS = 10_000;

/**
 * How long a username waits after `failures` failed attempts in a row: nothing under
 * {@link PASSWORD_FAILURES_BEFORE_WAIT}, then 30 s, 60 s, 120 s and so on, up to 15 minutes.
 */
export function passwordWaitMs(failures: number): number {
  if (failures < PASSWORD_FAILURES_BEFORE_WAIT) return 0;
  return Math.min(PASSWORD_WAIT_MAX_MS, PASSWORD_WAIT_BASE_MS * 2 ** (failures - PASSWORD_FAILURES_BEFORE_WAIT));
}

interface Failures {
  count: number;
  at: number;
}

/**
 * Per-username failure throttling of password sign-in (spec: exponential delay up to 15 minutes).
 * Every username counts, known or not, so the answer does not show whether a username exists.
 *
 * The counts live in this process's memory: with several API processes each keeps its own, so a
 * guesser gets that many times the allowance. A single instance is the supported setup for this
 * limit; a shared store is the fix when the API runs on several instances.
 */
export class PasswordThrottle {
  private readonly map = new Map<string, Failures>();

  constructor(private readonly now: () => number = Date.now) {}

  private current(key: string): Failures | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= PASSWORD_FAILURES_FORGET_MS) {
      this.map.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Milliseconds the username must still wait before its next attempt; 0 when it may try now. */
  waitMs(key: string): number {
    const entry = this.current(key);
    if (!entry) return 0;
    return Math.max(0, entry.at + passwordWaitMs(entry.count) - this.now());
  }

  /** Counts a failed attempt. */
  failed(key: string): void {
    const count = (this.current(key)?.count ?? 0) + 1;
    this.map.delete(key);
    this.map.set(key, { count, at: this.now() });
    if (this.map.size > PASSWORD_THROTTLE_MAX_KEYS) this.map.delete(this.map.keys().next().value as string);
  }

  /** Clears the username's failures after a successful sign-in. */
  succeeded(key: string): void {
    this.map.delete(key);
  }
}
