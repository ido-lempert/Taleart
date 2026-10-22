import type { Request, Response } from 'express';
import { DEFAULT_DELIVERY_RATE_LIMIT, deliveryRateLimitFromEnv, rateLimit, RATE_LIMIT_MAX_CLIENTS } from './rate-limit';

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

  it('keeps at most its number of clients, dropping the idle ones first', () => {
    let t = 0;
    const limiter = rateLimit({ burst: 1, perSecond: 1 }, () => t);
    for (let i = 0; i < RATE_LIMIT_MAX_CLIENTS; i++) hit(limiter, `ip${i}`);
    // All are empty now; once refilled, a new client prunes them and a returning one starts full.
    t += 2000;
    expect(hit(limiter, 'new').passed).toBe(true);
    expect(hit(limiter, 'ip0').passed).toBe(true);
    expect(hit(limiter, 'ip0').passed).toBe(false);
  });

  it('reads its limits from the environment, with 0 turning it off', () => {
    expect(deliveryRateLimitFromEnv({})).toEqual(DEFAULT_DELIVERY_RATE_LIMIT);
    expect(deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: '50', DELIVERY_RATE_LIMIT_PER_SECOND: '5' })).toEqual({
      burst: 50,
      perSecond: 5,
    });
    expect(deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: '0' })).toBeNull();
    expect(deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_PER_SECOND: '0' })).toBeNull();
    expect(() => deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_BURST: 'lots' })).toThrow(/DELIVERY_RATE_LIMIT_BURST/);
    expect(() => deliveryRateLimitFromEnv({ DELIVERY_RATE_LIMIT_PER_SECOND: '-1' })).toThrow();
  });
});
