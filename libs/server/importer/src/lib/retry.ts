/**
 * How a read answered 429 or 5xx is tried again (importer story 10): Storyly
 * publishes no rate limits, so the importer backs off instead.
 */
export interface RetryPolicy {
  /** Tries in all, the first included. */
  attempts: number;
  /** The first backoff; each later one doubles, up to `maxDelayMs`. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** The longest `Retry-After` honoured; a longer one is cut to this. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  maxRetryAfterMs: 60_000,
};

/**
 * For reads made while a person waits on a request (finding apps, previewing
 * an app): one quick retry, and a short `Retry-After` at most.
 */
export const INTERACTIVE_RETRY_POLICY: Partial<RetryPolicy> = { attempts: 2, maxRetryAfterMs: 2_000 };

/** The policy with `overrides` applied. */
export const retryPolicy = (overrides: Partial<RetryPolicy> = {}): RetryPolicy => ({
  ...DEFAULT_RETRY_POLICY,
  ...overrides,
});

/** True for the replies tried again: 429 (too many requests) and 5xx. */
export const isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status <= 599);

/**
 * A `Retry-After` header in milliseconds (delay seconds or an HTTP date), or
 * null when it is absent or unreadable.
 */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (header === null || header === undefined || header.trim() === '') return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // An HTTP date names its day and month; any other number is not one.
  if (!/[a-z]/i.test(value)) return null;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * How long to wait before retry number `retry` (0 for the first retry): the
 * server's `Retry-After` (capped), else exponential backoff with jitter, half
 * fixed and half random, so concurrent readers spread out.
 */
export function retryDelayMs(
  retry: number,
  retryAfter: number | null,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  if (retryAfter !== null) return Math.min(retryAfter, policy.maxRetryAfterMs);
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retry);
  return ceiling / 2 + random() * (ceiling / 2);
}

/** Waits `ms`; rejects with the signal's reason as soon as it aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Runs at most `max` tasks at once; the others wait their turn, first come first served. */
export class Limiter {
  private running = 0;
  private readonly waiting: { grant: () => void }[] = [];

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError('A limiter runs at least one task');
  }

  /** How many slots are held now. */
  get active(): number {
    return this.running;
  }

  /**
   * Takes a slot, waiting for one when all are held; resolves to its release
   * (calling it again does nothing). A waiter whose signal aborts leaves the
   * queue and rejects with the signal's reason.
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.running < this.max) {
      this.running++;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      const waiter = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(this.releaser());
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // The slot passes straight to the next waiter, so running never goes over max.
      const next = this.waiting.shift();
      if (next) next.grant();
      else this.running--;
    };
  }
}

/** One {@link Limiter} per host: at most `max` slots at once against any one host. */
export class HostLimiter {
  private readonly hosts = new Map<string, Limiter>();

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError('A limiter runs at least one task');
  }

  /** Takes a slot of `host`; resolves to its release. See {@link Limiter.acquire}. */
  async acquire(host: string, signal?: AbortSignal): Promise<() => void> {
    let limiter = this.hosts.get(host);
    if (!limiter) {
      limiter = new Limiter(this.max);
      this.hosts.set(host, limiter);
    }
    const held = limiter;
    const forget = () => {
      if (held.active === 0 && this.hosts.get(host) === held) this.hosts.delete(host);
    };
    let release: () => void;
    try {
      release = await held.acquire(signal);
    } catch (err) {
      forget();
      throw err;
    }
    return () => {
      release();
      forget();
    };
  }

  async run<T>(host: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(host, signal);
    try {
      return await task();
    } finally {
      release();
    }
  }
}

/** A URL's host as the per-host limit counts it (lower-case host and port); '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}
