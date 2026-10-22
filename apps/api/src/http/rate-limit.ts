import { ErrorCodes } from '@taleart/contract';
import type { RequestHandler } from 'express';
import { errorBody } from './errors';

/** A token bucket per client address: `burst` requests at once, refilled at `perSecond`. */
export interface RateLimitOptions {
  /** Requests a client may send at once (the bucket's size). */
  burst: number;
  /** Requests a client may send per second, sustained (the refill rate). */
  perSecond: number;
}

/**
 * The Delivery API's default (epic UX rework story 8.6 review): generous, since many visitors can
 * share one address behind a NAT and every page view asks once per zone. Set with
 * DELIVERY_RATE_LIMIT_BURST and DELIVERY_RATE_LIMIT_PER_SECOND; 0 turns it off.
 */
export const DEFAULT_DELIVERY_RATE_LIMIT: RateLimitOptions = { burst: 600, perSecond: 20 };

/** The most client buckets kept; beyond it, full (idle) buckets are dropped. */
export const RATE_LIMIT_MAX_CLIENTS = 10_000;

interface Bucket {
  tokens: number;
  at: number;
}

/**
 * Limits requests per client address (`req.ip`, which follows Express's `trust proxy`) with a
 * token bucket kept in this process. A client over its limit gets 429 `rate_limited` with
 * `Retry-After` (whole seconds until a token is back) and `Cache-Control: no-store`. Preflight
 * requests are not counted.
 */
export function rateLimit(options: RateLimitOptions, now: () => number = Date.now): RequestHandler {
  const { burst, perSecond } = options;
  const buckets = new Map<string, Bucket>();

  // Tokens a bucket holds at `t`.
  const level = (bucket: Bucket, t: number) => Math.min(burst, bucket.tokens + ((t - bucket.at) / 1000) * perSecond);

  // Drops the buckets that are full again: those clients are back to where a new one starts.
  const prune = (t: number) => {
    for (const [client, bucket] of buckets) if (level(bucket, t) >= burst) buckets.delete(client);
  };

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const t = now();
    const client = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(client);
    if (!bucket) {
      if (buckets.size >= RATE_LIMIT_MAX_CLIENTS) prune(t);
      bucket = { tokens: burst, at: t };
      buckets.set(client, bucket);
    }
    bucket.tokens = level(bucket, t);
    bucket.at = t;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      next();
      return;
    }
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((1 - bucket.tokens) / perSecond))));
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json(errorBody(ErrorCodes.rateLimited, 'Too many requests. Try again later.'));
  };
}

/** The Delivery API's limit from the environment: the defaults, a value of each, or null when either is 0. */
export function deliveryRateLimitFromEnv(env: Record<string, string | undefined>): RateLimitOptions | null {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of at least 0`);
    return value;
  };
  const burst = read('DELIVERY_RATE_LIMIT_BURST', DEFAULT_DELIVERY_RATE_LIMIT.burst);
  const perSecond = read('DELIVERY_RATE_LIMIT_PER_SECOND', DEFAULT_DELIVERY_RATE_LIMIT.perSecond);
  return burst === 0 || perSecond === 0 ? null : { burst, perSecond };
}
