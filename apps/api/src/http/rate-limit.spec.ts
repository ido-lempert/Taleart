import type { Request, Response } from 'express';
import {
  DEFAULT_DELIVERY_RATE_LIMIT,
  deliveryRateLimitFromEnv,
  rateLimit,
  rateLimitClient,
  RATE_LIMIT_MAX_CLIENTS,
  RATE_LIMIT_PRUNE_INTERVAL_MS,
  trustProxyFromEnv,
} from './rate-limit';

// Runs the limiter once for `ip`; true when the request went on, else the 429 response's parts.
function hit(limiter: ReturnType<typeof rateLimit>, ip: string, method = 'GET') {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: unknown = null;
  let passed = false;
  const res = {
    setHeader: (name: string, value: string) => (headers[name.toLowerCase()] = value),
    status: (code: number) => {
      status = code;
      return res;
    },
    json: (value: unknown) => (body = value),
  } as unknown as Response;
  limiter({ method, ip, socket: {} } as unknown as Request, res, () => (passed = true));
  return { passed, status, headers, body };
}

describe('Delivery API rate limit (story 8.6 review)', () => {
  it('lets a burst through, then answers 429 with Retry-After until tokens refill', () => {
    let t = 1_000_000;
    const limiter = rateLimit({ burst: 2, perSecond: 1 }, () => t);
    expect(hit(limiter, 'a').passed).toBe(true);
    expect(hit(limiter, 'a').passed).toBe(true);
    const refused = hit(limiter, 'a');
    expect(refused.passed).toBe(false);
    expect(refused.status).toBe(429);
    expect(refused.headers).toMatchObject({ 'retry-after': '1', 'cache-control': 'no-store' });
    expect(refused.body).toEqual({ error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } });
    // Another address has its own bucket.
    expect(hit(limiter, 'b').passed).toBe(true);
    // A second later one token is back.
    t += 1000;
    expect(hit(limiter, 'a').passed).toBe(true);
    expect(hit(limiter, 'a').passed).toBe(false);
    // Never more than the burst, however long it waited.
    t += 60_000;
    expect([hit(limiter, 'a'), hit(limiter, 'a'), hit(limiter, 'a')].map((r) => r.passed)).toEqual([true, true, false]);
  });

  it('counts no preflight', () => {
    const limiter = rateLimit({ burst: 1, perSecond: 1 }, () => 0);
    for (let i = 0; i < 5; i++) expect(hit(limiter, 'a', 'OPTIONS').passed).toBe(true);
    expect(hit(limiter, 'a').passed).toBe(true);
  });

  it('keeps at most its number of clients, forgetting the least recently seen one first', () => {
    const limiter = rateLimit({ burst: 1, perSecond: 0.001 }, () => 0);
    // `a` spends its token, then stays recently seen while others come and go.
    expect(hit(limiter, '10.0.0.1').passed).toBe(true);
    expect(hit(limiter, '10.0.0.2').passed).toBe(true);
    for (let i = 0; i < RATE_LIMIT_MAX_CLIENTS - 2; i++) hit(limiter, `10.1.${i >> 8}.${i & 0xff}`);
    // Seen again: still empty, and now the most recent.
    expect(hit(limiter, '10.0.0.1').passed).toBe(false);
    // One client over the cap forgets the oldest, 10.0.0.2, which comes back with a full bucket.
    hit(limiter, '10.2.0.0');
    expect(hit(limiter, '10.0.0.1').passed).toBe(false);
    expect(hit(limiter, '10.0.0.2').passed).toBe(true);
  });

  it('drops idle clients at most once per interval, and never refills when the clock goes back', () => {
    let t = 1_000_000;
    const limiter = rateLimit({ burst: 2, perSecond: 1 }, () => t);
    hit(limiter, '10.0.0.1');
    hit(limiter, '10.0.0.1');
    expect(hit(limiter, '10.0.0.1').passed).toBe(false);
    // The clock goes back an hour: no tokens appear from it.
    t -= 3_600_000;
    expect(hit(limiter, '10.0.0.1').passed).toBe(false);
    // Back to the present and past the interval: the client refilled, is pruned, and starts full.
    t += 3_600_000 + RATE_LIMIT_PRUNE_INTERVAL_MS;
    expect([hit(limiter, '10.0.0.1'), hit(limiter, '10.0.0.1'), hit(limiter, '10.0.0.1')].map((r) => r.passed)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('counts an IPv6 client by its /64 and an IPv4-mapped address as IPv4', () => {
    expect(rateLimitClient('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitClient('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitClient('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(rateLimitClient('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitClient('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(rateLimitClient('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitClient('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitClient(undefined)).toBe('unknown');
    const limiter = rateLimit({ burst: 2, perSecond: 0.001 }, () => 0);
    expect(hit(limiter, '2001:db8:1:2::1').passed).toBe(true);
    expect(hit(limiter, '2001:db8:1:2::ffff').passed).toBe(true);
    // The same /64: one bucket.
    expect(hit(limiter, '2001:db8:1:2:dead:beef::1').passed).toBe(false);
    expect(hit(limiter, '2001:db8:1:3::1').passed).toBe(true);
    // The mapped and plain forms of one IPv4 address share a bucket.
    expect(hit(limiter, '198.51.100.1').passed).toBe(true);
    expect(hit(limiter, '::ffff:198.51.100.1').passed).toBe(true);
    expect(hit(limiter, '198.51.100.1').passed).toBe(false);
  });

  it('reads its limits from the environment: a whole burst of at least 1 (0 off) and a rate above 0', () => {
    expect(deliveryRateLimitFromEnv({})).toEqual(DEFAULT_DELIVERY_RATE_LIMIT);
    expect(deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: '50', DELIVERY_RATE_LIMIT_PER_SECOND: '0.5' })).toEqual({
      burst: 50,
      perSecond: 0.5,
    });
    expect(deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: '0' })).toBeNull();
    expect(() => deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: 'lots' })).toThrow(/DELIVERY_RATE_LIMIT_BURST/);
    for (const env of [
      { DELIVERY_RATE_LIMIT_BURST: '0.5' },
      { DELIVERY_RATE_LIMIT_BURST: '-1' },
      { DELIVERY_RATE_LIMIT_PER_SECOND: '0' },
      { DELIVERY_RATE_LIMIT_PER_SECOND: '-1' },
      { DELIVERY_RATE_LIMIT_PER_SECOND: 'Infinity' },
    ]) {
      expect(() => deliveryRateLimitFromEnv(env)).toThrow(/DELIVERY_RATE_LIMIT/);
    }
    expect(() => rateLimit({ burst: 0, perSecond: 1 })).toThrow();
    expect(() => rateLimit({ burst: 1, perSecond: 0 })).toThrow();
  });

  it('trusts only a hop count or a list of addresses, ranges and named ranges as TRUST_PROXY', () => {
    expect(trustProxyFromEnv(undefined)).toBeUndefined();
    expect(trustProxyFromEnv(' ')).toBeUndefined();
    expect(trustProxyFromEnv('1')).toBe(1);
    expect(trustProxyFromEnv('loopback, 10.0.0.0/8,fd00::/8, 203.0.113.9')).toEqual([
      'loopback',
      '10.0.0.0/8',
      'fd00::/8',
      '203.0.113.9',
    ]);
    expect(trustProxyFromEnv('linklocal,uniquelocal')).toEqual(['linklocal', 'uniquelocal']);
    for (const bad of ['true', '0', '11', '*', 'loopback,evil', '10.0.0.0/33', '::1/129', '1.2.3', 'loopback,', '10.0.0.1/8/8']) {
      expect(() => trustProxyFromEnv(bad), bad).toThrow(/TRUST_PROXY/);
    }
  });
});
