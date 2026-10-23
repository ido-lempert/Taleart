import type { Request, Response } from 'express';
import {
  ADDRESS_BACKSTOP_FACTOR,
  DEFAULT_DELIVERY_RATE_LIMIT,
  deliveryRateLimitFromEnv,
  rateLimit,
  rateLimitClient,
  RATE_LIMIT_MAX_CLIENTS,
  RATE_LIMIT_MAX_VISITORS,
  RATE_LIMIT_PRUNE_INTERVAL_MS,
  trustProxyFromEnv,
  visitorId,
} from './rate-limit';

// Runs the limiter once for `ip`; true when the request went on, else the 429 response's parts.
function hit(limiter: ReturnType<typeof rateLimit>, ip: string, method = 'GET', visitor?: string) {
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
  const requestHeaders = visitor === undefined ? {} : { 'x-taleart-visitor': visitor };
  limiter({ method, ip, headers: requestHeaders, socket: {} } as unknown as Request, res, () => (passed = true));
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

  it('counts an IPv6 client by its /48 and an IPv4-mapped address as IPv4', () => {
    expect(rateLimitClient('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitClient('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitClient('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(rateLimitClient('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1::/48');
    expect(rateLimitClient('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1::/48');
    expect(rateLimitClient('fe80::1%en0')).toBe('fe80:0:0::/48');
    expect(rateLimitClient('::1')).toBe('0:0:0::/48');
    expect(rateLimitClient(undefined)).toBe('unknown');
    const limiter = rateLimit({ burst: 2, perSecond: 0.001 }, () => 0);
    expect(hit(limiter, '2001:db8:1:2::1').passed).toBe(true);
    expect(hit(limiter, '2001:db8:1:ffff::ffff').passed).toBe(true);
    // The same /48, even another /64 of it: one bucket.
    expect(hit(limiter, '2001:db8:1:dead:beef::1').passed).toBe(false);
    expect(hit(limiter, '2001:db8:2::1').passed).toBe(true);
    // The mapped and plain forms of one IPv4 address share a bucket.
    expect(hit(limiter, '198.51.100.1').passed).toBe(true);
    expect(hit(limiter, '::ffff:198.51.100.1').passed).toBe(true);
    expect(hit(limiter, '198.51.100.1').passed).toBe(false);
  });

  describe('visitor ids (story 8.23)', () => {
    const A = '3f2b8c1e-5d4a-4e6b-9c7d-0a1b2c3d4e5f';
    const B = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';
    // A fresh UUID v4 per call, for rotating ids.
    const fresh = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;

    it('accepts only a UUID v4 in lowercase or uppercase', () => {
      expect(visitorId(A)).toBe(A);
      expect(visitorId(A.toUpperCase())).toBe(A);
      for (const bad of [
        undefined,
        '',
        [A, B],
        `${A}, ${B}`,
        ` ${A}`,
        '3f2b8c1e-5d4a-4e6B-9c7d-0a1b2c3d4e5f', // mixed case
        '3f2b8c1e-5d4a-1e6b-9c7d-0a1b2c3d4e5f', // version 1
        '3f2b8c1e-5d4a-4e6b-7c7d-0a1b2c3d4e5f', // not the RFC variant
        '3f2b8c1e5d4a4e6b9c7d0a1b2c3d4e5f',
        '{3f2b8c1e-5d4a-4e6b-9c7d-0a1b2c3d4e5f}',
        'not-a-uuid',
      ]) {
        expect(visitorId(bad as string | string[] | undefined), String(bad)).toBeNull();
      }
    });

    it('gives two visitors behind one address each their own allowance', () => {
      const limiter = rateLimit({ burst: 2, perSecond: 0.001 }, () => 0);
      expect([hit(limiter, '203.0.113.7', 'GET', A), hit(limiter, '203.0.113.7', 'GET', A)].map((r) => r.passed)).toEqual([
        true,
        true,
      ]);
      const refused = hit(limiter, '203.0.113.7', 'GET', A);
      expect(refused.status).toBe(429);
      expect(refused.headers['retry-after']).toBe('1000');
      // The other device behind the same address is not affected.
      expect(hit(limiter, '203.0.113.7', 'GET', B).passed).toBe(true);
      // The uppercase form of the first id is the same visitor: its bucket is already empty.
      expect(hit(limiter, '203.0.113.7', 'GET', A.toUpperCase()).passed).toBe(false);
      // A request without an id has the address's own bucket.
      expect(hit(limiter, '203.0.113.7').passed).toBe(true);
      // One visitor on another address keeps its own count: an id is not tied to its address.
      expect(hit(limiter, '198.51.100.1', 'GET', A).passed).toBe(false);
    });

    it('stops a client rotating ids at the address backstop', () => {
      const limiter = rateLimit({ burst: 2, perSecond: 0.001 }, () => 0);
      const backstop = 2 * ADDRESS_BACKSTOP_FACTOR;
      for (let i = 0; i < backstop; i++) expect(hit(limiter, '2001:db8:1:2::1', 'GET', fresh(i)).passed, `${i}`).toBe(true);
      const refused = hit(limiter, '2001:db8:1:99::1', 'GET', fresh(backstop));
      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } });
      // The backstop holds whatever the request carries, an old id or none.
      expect(hit(limiter, '2001:db8:1::5', 'GET', fresh(0)).passed).toBe(false);
      expect(hit(limiter, '2001:db8:1::5').passed).toBe(false);
      // Another /48 is untouched.
      expect(hit(limiter, '2001:db8:2::1', 'GET', fresh(0)).passed).toBe(true);
    });

    it('counts a request with a missing or malformed id by its address, as before visitor ids', () => {
      const limiter = rateLimit({ burst: 2, perSecond: 0.001 }, () => 0);
      expect(hit(limiter, '203.0.113.7').passed).toBe(true);
      expect(hit(limiter, '203.0.113.7', 'GET', 'not-a-uuid').passed).toBe(true);
      expect(hit(limiter, '203.0.113.7', 'GET', A.replace('4e6b', '4E6b')).passed).toBe(false);
      // A visitor on that address still has its own allowance.
      expect([hit(limiter, '203.0.113.7', 'GET', A), hit(limiter, '203.0.113.7', 'GET', A)].map((r) => r.passed)).toEqual([
        true,
        true,
      ]);
    });

    it('keeps at most its number of visitors, forgetting the least recently seen one first', () => {
      const limiter = rateLimit({ burst: 1, perSecond: 0.001 }, () => 0);
      expect(hit(limiter, '10.0.0.1', 'GET', A).passed).toBe(true);
      expect(hit(limiter, '10.0.0.1', 'GET', A).passed).toBe(false);
      // Many visitors on other addresses push A out; A comes back with a full bucket.
      for (let i = 0; i < RATE_LIMIT_MAX_VISITORS; i++) hit(limiter, `10.${1 + (i >> 16)}.${(i >> 8) & 0xff}.${i & 0xff}`, 'GET', fresh(i));
      expect(hit(limiter, '10.0.0.1', 'GET', A).passed).toBe(true);
    });
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
