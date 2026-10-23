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
 * The Delivery API's default (epic UX rework stories 8.6 and 8.23): the allowance of one visitor (a
 * device, named by its `X-TaleArt-Visitor` id), and of one address for requests that carry no
 * valid id. Generous, since every page view asks once per zone. Set with DELIVERY_RATE_LIMIT_BURST
 * and DELIVERY_RATE_LIMIT_PER_SECOND; a burst of 0 turns the whole limit off. The limit is per API
 * process: with several processes, a client gets that many times the limit.
 */
export const DEFAULT_DELIVERY_RATE_LIMIT: RateLimitOptions = { burst: 600, perSecond: 20 };

/**
 * How many visitors' allowance one address (an IPv4 address or an IPv6 /48) gets in all, whatever
 * ids its requests carry: the backstop against a client that invents a new id for every request.
 * With the default limit that is 6,000 at once and 200 per second. Ten keeps a home, an office or a
 * school behind one NAT clear of it in practice (they rarely all load pages in the same second),
 * while a client rotating ids gets no more than ten devices would.
 */
export const ADDRESS_BACKSTOP_FACTOR = 10;

/** The header a visitor's id comes in: a UUID v4 the SDK generates once per device. */
export const VISITOR_HEADER = 'X-TaleArt-Visitor';

/** The most address buckets kept (each kind); beyond it, the least recently seen address is forgotten. */
export const RATE_LIMIT_MAX_CLIENTS = 10_000;

/** The most visitor buckets kept; beyond it, the least recently seen visitor is forgotten. */
export const RATE_LIMIT_MAX_VISITORS = 50_000;

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
 * The address a request is counted as: an IPv4 address as it is (an IPv4-mapped IPv6 address,
 * `::ffff:a.b.c.d`, as that IPv4 address), and an IPv6 address by its /48, the block one site
 * (a home or an office) is usually given, so a client cannot dodge the limit by moving within it.
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
    .slice(0, 3)
    .map((g) => g.toString(16))
    .join(':')}::/48`;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The visitor id of an `X-TaleArt-Visitor` header in lowercase, or null when it is missing,
 * repeated or not a UUID v4 written all in lowercase or all in uppercase.
 */
export function visitorId(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const lower = header.toLowerCase();
  if (header !== lower && header !== header.toUpperCase()) return null;
  return UUID_V4.test(lower) ? lower : null;
}

/**
 * Token buckets by key, least recently seen first, at most `max` of them: a new key beyond it
 * forgets the oldest. Buckets that are full again are dropped at most once per
 * {@link RATE_LIMIT_PRUNE_INTERVAL_MS}, so no request scans them all.
 */
class Buckets {
  private readonly map = new Map<string, Bucket>();
  private prunedAt: number;

  constructor(
    private readonly options: RateLimitOptions,
    private readonly max: number,
    t: number,
  ) {
    this.prunedAt = t;
  }

  // Tokens a bucket holds at `t`; a clock that went back refills nothing.
  private level(bucket: Bucket, t: number): number {
    return Math.min(this.options.burst, bucket.tokens + (Math.max(0, t - bucket.at) / 1000) * this.options.perSecond);
  }

  /** The key's bucket brought up to `t`, now the most recently seen. */
  get(key: string, t: number): Bucket {
    if (t - this.prunedAt >= RATE_LIMIT_PRUNE_INTERVAL_MS || t < this.prunedAt) {
      this.prunedAt = t;
      for (const [k, b] of this.map) if (this.level(b, t) >= this.options.burst) this.map.delete(k);
    }
    const bucket = this.map.get(key) ?? { tokens: this.options.burst, at: t };
    // Re-inserted on every request, so the Map's first key is the least recently seen.
    this.map.delete(key);
    this.map.set(key, bucket);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
    bucket.tokens = this.level(bucket, t);
    bucket.at = Math.max(bucket.at, t);
    return bucket;
  }

  /** Whole seconds until the bucket holds a token again. */
  wait(bucket: Bucket): number {
    return Math.max(1, Math.ceil((1 - bucket.tokens) / this.options.perSecond));
  }
}

/**
 * Limits requests with token buckets kept in this process (epic UX rework 8.23). A request with a
 * valid visitor id ({@link visitorId} of `X-TaleArt-Visitor`) counts against that visitor's bucket;
 * one without counts against its address's bucket of the same size, as before visitor ids. Every
 * request also counts against its address's backstop, {@link ADDRESS_BACKSTOP_FACTOR} times larger,
 * so inventing ids gains little. The address is {@link rateLimitClient} of `req.ip`, which follows
 * Express's `trust proxy`. A request goes on only when both of its buckets hold a token, and then
 * takes one from each; otherwise it gets 429 `rate_limited` with `Retry-After` (whole seconds until
 * both have one) and `Cache-Control: no-store`. Preflight requests are not counted.
 *
 * Memory is bounded: at most {@link RATE_LIMIT_MAX_VISITORS} visitor buckets and
 * {@link RATE_LIMIT_MAX_CLIENTS} buckets of each address kind, the least recently seen forgotten
 * first. A client rotating ids churns only the visitor buckets, never the backstop.
 */
export function rateLimit(options: RateLimitOptions, now: () => number = Date.now): RequestHandler {
  const { burst, perSecond } = checkRateLimit(options);
  const t0 = now();
  const visitors = new Buckets({ burst, perSecond }, RATE_LIMIT_MAX_VISITORS, t0);
  const anonymous = new Buckets({ burst, perSecond }, RATE_LIMIT_MAX_CLIENTS, t0);
  const backstop = new Buckets(
    { burst: burst * ADDRESS_BACKSTOP_FACTOR, perSecond: perSecond * ADDRESS_BACKSTOP_FACTOR },
    RATE_LIMIT_MAX_CLIENTS,
    t0,
  );

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }
    const t = now();
    const address = rateLimitClient(req.ip ?? req.socket.remoteAddress);
    const visitor = visitorId(req.headers[VISITOR_HEADER.toLowerCase()]);
    const own = visitor === null ? anonymous : visitors;
    const ownBucket = own.get(visitor ?? address, t);
    const addressBucket = backstop.get(address, t);
    if (ownBucket.tokens >= 1 && addressBucket.tokens >= 1) {
      ownBucket.tokens -= 1;
      addressBucket.tokens -= 1;
      next();
      return;
    }
    const wait = Math.max(
      ownBucket.tokens >= 1 ? 0 : own.wait(ownBucket),
      addressBucket.tokens >= 1 ? 0 : backstop.wait(addressBucket),
    );
    res.setHeader('Retry-After', String(wait));
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
