import { isIP, isIPv4 } from 'node:net';
import { ErrorCodes } from '@taleart/contract';
import type { RequestHandler } from 'express';
import { errorBody } from './errors';

/** A token bucket per client: `burst` requests at once, refilled at `perSecond`. */
export interface RateLimitOptions {
  /** Requests a client may send at once (the bucket's size): a whole number of at least 1. */
  burst: number;
  /** Requests a client may send per second, sustained (the refill rate): more than 0. */
  perSecond: number;
}

/**
 * The Delivery API's default (epic UX rework story 8.6 review): generous, since many visitors can
 * share one address behind a NAT and every page view asks once per zone. Set with
 * DELIVERY_RATE_LIMIT_BURST and DELIVERY_RATE_LIMIT_PER_SECOND; a burst of 0 turns it off. The limit
 * is per API process: with several processes, a client gets that many times the limit.
 */
export const DEFAULT_DELIVERY_RATE_LIMIT: RateLimitOptions = { burst: 600, perSecond: 20 };

/** The most client buckets kept; beyond it, the least recently seen client is forgotten. */
export const RATE_LIMIT_MAX_CLIENTS = 10_000;

/** How often, at most, the buckets that are full again (idle clients) are dropped, in ms. */
export const RATE_LIMIT_PRUNE_INTERVAL_MS = 60_000;

interface Bucket {
  tokens: number;
  at: number;
}

/** Throws when the options are not a whole burst of at least 1 and a rate above 0. */
export function checkRateLimit(options: RateLimitOptions): RateLimitOptions {
  if (!Number.isInteger(options.burst) || options.burst < 1) {
    throw new Error('The Delivery API rate limit burst must be a whole number of at least 1 (0 turns the limit off)');
  }
  if (!Number.isFinite(options.perSecond) || options.perSecond <= 0) {
    throw new Error('The Delivery API rate limit per second must be a number above 0');
  }
  return options;
}

// The eight 16-bit groups of an IPv6 address (no zone), or null when it is not one.
function ipv6Groups(address: string): number[] | null {
  let text = address.split('%')[0];
  // An IPv4 tail (`::ffff:1.2.3.4`) becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    if (!isIPv4(tail[1])) return null;
    const [a, b, c, d] = tail[1].split('.').map(Number);
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const read = (part: string) => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<number>(Math.max(0, missing)).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The client a request is counted as: an IPv4 address as it is (an IPv4-mapped IPv6 address,
 * `::ffff:a.b.c.d`, as that IPv4 address), and an IPv6 address by its /64, which one host or home
 * network usually holds whole.
 */
export function rateLimitClient(address: string | undefined): string {
  if (!address) return 'unknown';
  if (isIP(address) === 4) return address;
  const groups = ipv6Groups(address);
  if (!groups) return address;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/**
 * Limits requests per client ({@link rateLimitClient} of `req.ip`, which follows Express's
 * `trust proxy`) with a token bucket kept in this process. A client over its limit gets 429
 * `rate_limited` with `Retry-After` (whole seconds until a token is back) and
 * `Cache-Control: no-store`. Preflight requests are not counted.
 *
 * Memory is bounded: the buckets are kept least recently seen first, and a new client beyond
 * {@link RATE_LIMIT_MAX_CLIENTS} forgets the oldest. Buckets that are full again are dropped at most
 * once per {@link RATE_LIMIT_PRUNE_INTERVAL_MS}, so no request scans them all.
 */
export function rateLimit(options: RateLimitOptions, now: () => number = Date.now): RequestHandler {
  const { burst, perSecond } = checkRateLimit(options);
  const buckets = new Map<string, Bucket>();
  let prunedAt = now();

  // Tokens a bucket holds at `t`; a clock that went back refills nothing.
  const level = (bucket: Bucket, t: number) =>
    Math.min(burst, bucket.tokens + (Math.max(0, t - bucket.at) / 1000) * perSecond);

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const t = now();
    if (t - prunedAt >= RATE_LIMIT_PRUNE_INTERVAL_MS || t < prunedAt) {
      prunedAt = t;
      for (const [client, bucket] of buckets) if (level(bucket, t) >= burst) buckets.delete(client);
    }
    const client = rateLimitClient(req.ip ?? req.socket.remoteAddress);
    const bucket = buckets.get(client) ?? { tokens: burst, at: t };
    // Re-inserted on every request, so the Map's first key is the least recently seen client.
    buckets.delete(client);
    buckets.set(client, bucket);
    if (buckets.size > RATE_LIMIT_MAX_CLIENTS) buckets.delete(buckets.keys().next().value as string);
    bucket.tokens = level(bucket, t);
    bucket.at = Math.max(bucket.at, t);
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

/**
 * The Delivery API's limit from the environment: the defaults, a value of each, or null when the
 * burst is 0. Anything else that is not a whole burst of at least 1 and a rate above 0 throws.
 */
export function deliveryRateLimitFromEnv(env: Record<string, string | undefined>): RateLimitOptions | null {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
    return value;
  };
  const burst = read('DELIVERY_RATE_LIMIT_BURST', DEFAULT_DELIVERY_RATE_LIMIT.burst);
  if (burst === 0) return null;
  const perSecond = read('DELIVERY_RATE_LIMIT_PER_SECOND', DEFAULT_DELIVERY_RATE_LIMIT.perSecond);
  try {
    return checkRateLimit({ burst, perSecond });
  } catch {
    throw new Error(
      'DELIVERY_RATE_LIMIT_BURST must be a whole number of at least 1 (0 turns the limit off), ' +
        'and DELIVERY_RATE_LIMIT_PER_SECOND a number above 0',
    );
  }
}

const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

// True for an IP address or a CIDR range (`10.0.0.0/8`, `fd00::/8`).
function isAddressOrRange(text: string): boolean {
  const [address, prefix, extra] = text.split('/');
  if (extra !== undefined) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

/**
 * Express's `trust proxy` from TRUST_PROXY, or undefined when it is not set. Set it to exactly the
 * proxies in front of the API: a hop count (`1` for one proxy, at most 10), or a comma-separated
 * list of their addresses, CIDR ranges and the named ranges `loopback`, `linklocal` and
 * `uniquelocal`. Anything else throws, so the API does not start trusting a header it should not.
 */
export function trustProxyFromEnv(value: string | undefined): number | string[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= 10) return hops;
    throw new Error('TRUST_PROXY as a hop count must be from 1 to 10: the number of proxies in front of the API');
  }
  const list = text.split(',').map((item) => item.trim());
  const bad = list.filter((item) => !NAMED_RANGES.has(item) && !isAddressOrRange(item));
  if (list.length === 0 || bad.length > 0) {
    throw new Error(
      `TRUST_PROXY must be a hop count or a comma-separated list of IP addresses, CIDR ranges, ` +
        `loopback, linklocal or uniquelocal; not ${bad.map((item) => JSON.stringify(item)).join(', ')}`,
    );
  }
  return list;
}
