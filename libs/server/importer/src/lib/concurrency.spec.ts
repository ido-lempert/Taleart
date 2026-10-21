import { InOrder } from './in-order';
import {
  DEFAULT_RETRY_POLICY,
  HostLimiter,
  hostOf,
  isRetryableStatus,
  Limiter,
  retryAfterMs,
  retryDelayMs,
  retryPolicy,
  sleep,
} from './retry';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A promise settled by hand.
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('retry policy', () => {
  it('tries 429 and 5xx again, nothing else', () => {
    expect([429, 500, 502, 503, 504, 599].every(isRetryableStatus)).toBe(true);
    expect([200, 301, 400, 401, 403, 404, 408, 600].some(isRetryableStatus)).toBe(false);
  });

  it('reads Retry-After as seconds or an HTTP date, and nothing else', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    expect(retryAfterMs('3', now)).toBe(3000);
    expect(retryAfterMs(' 0 ', now)).toBe(0);
    expect(retryAfterMs('Wed, 21 Oct 2026 10:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('Wed, 21 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs('-1', now)).toBeNull();
    expect(retryAfterMs(undefined, now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });

  it('waits Retry-After up to its cap, else doubles a jittered backoff up to its cap', () => {
    const policy = DEFAULT_RETRY_POLICY;
    expect(retryDelayMs(0, 2000, policy)).toBe(2000);
    expect(retryDelayMs(0, 10 * 60_000, policy)).toBe(policy.maxRetryAfterMs);
    expect(retryDelayMs(0, null, policy, () => 0)).toBe(250);
    expect(retryDelayMs(0, null, policy, () => 0.999)).toBeLessThan(500);
    expect(retryDelayMs(3, null, policy, () => 0)).toBe(2000);
    expect(retryDelayMs(20, null, policy, () => 1)).toBe(policy.maxDelayMs);
    expect(retryPolicy({ attempts: 2 })).toEqual({ ...DEFAULT_RETRY_POLICY, attempts: 2 });
  });

  it('sleeps, and stops sleeping when the signal aborts', async () => {
    const started = Date.now();
    await sleep(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    const stop = new AbortController();
    const long = sleep(60_000, stop.signal);
    stop.abort(new Error('stopped'));
    await expect(long).rejects.toThrow('stopped');
    await expect(sleep(10, stop.signal)).rejects.toThrow('stopped');
  });
});

describe('Limiter and HostLimiter', () => {
  it('runs at most `max` tasks at once, the waiting ones in arrival order', async () => {
    const limiter = new Limiter(2);
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(limiter.active).toBe(0);
    expect(() => new Limiter(0)).toThrow(RangeError);
  });

  it('frees the slot of a task that fails', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(await limiter.run(async () => 'next')).toBe('next');
  });

  it('limits each host on its own', async () => {
    const hosts = new HostLimiter(1);
    const gate = deferred<void>();
    const started: string[] = [];
    const task = (name: string) => async () => {
      started.push(name);
      await gate.promise;
    };
    const runs = [
      hosts.run('a.example', task('a1')),
      hosts.run('a.example', task('a2')),
      hosts.run('b.example', task('b1')),
    ];
    await tick();
    expect(started).toEqual(['a1', 'b1']);
    gate.resolve();
    await Promise.all(runs);
    expect(started).toEqual(['a1', 'b1', 'a2']);
  });

  it('takes and releases slots by hand; a waiter whose signal aborts leaves the queue', async () => {
    const limiter = new Limiter(1);
    const release = await limiter.acquire();
    const stop = new AbortController();
    const gone = limiter.acquire(stop.signal);
    const next = limiter.acquire();
    stop.abort(new Error('stopped'));
    await expect(gone).rejects.toThrow('stopped');
    release();
    release();
    const second = await next;
    expect(limiter.active).toBe(1);
    second();
    expect(limiter.active).toBe(0);
    await expect(limiter.acquire(stop.signal)).rejects.toThrow('stopped');
  });

  it('hands out host slots by hand, per host', async () => {
    const hosts = new HostLimiter(1);
    const a = await hosts.acquire('a.example');
    let gotSecond = false;
    const second = hosts.acquire('a.example').then((release) => {
      gotSecond = true;
      return release;
    });
    (await hosts.acquire('b.example'))();
    await tick();
    expect(gotSecond).toBe(false);
    a();
    (await second)();
    expect(gotSecond).toBe(true);
  });

  it('names a URL by its host and port', () => {
    expect(hostOf('https://CDN.example:8443/a.png')).toBe('cdn.example:8443');
    expect(hostOf('http://cdn.example/a.png')).toBe('cdn.example');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('InOrder', () => {
  it('runs an effect at once when nothing waits ahead of it', () => {
    const order = new InOrder();
    const seen: string[] = [];
    order.run(() => seen.push('a'));
    expect(seen).toEqual(['a']);
  });

  it('applies effects in the order they were added, whenever their work finishes', async () => {
    const order = new InOrder();
    const seen: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    order.after(first.promise, (v) => seen.push(v));
    order.run(() => seen.push('after first'));
    order.after(second.promise, (v) => {
      seen.push(v);
      // Added from inside an effect: it takes that effect's place.
      order.run(() => seen.push('inside second'));
    });
    order.run(() => seen.push('last'));
    second.resolve('second');
    await tick();
    expect(seen).toEqual([]);
    expect(order.pending).toBe(4);
    first.resolve('first');
    await order.drain();
    expect(seen).toEqual(['first', 'after first', 'second', 'inside second', 'last']);
    expect(order.pending).toBe(0);
    order.run(() => seen.push('now'));
    expect(seen.at(-1)).toBe('now');
  });

  it('stops applying once any work fails, calls onFailure once, and throws the failure', async () => {
    const onFailure = vi.fn();
    const order = new InOrder(onFailure);
    const seen: string[] = [];
    const slow = deferred<string>();
    const broken = deferred<string>();
    order.after(slow.promise, (v) => seen.push(v));
    order.after(broken.promise, (v) => seen.push(v));
    broken.reject(new Error('disk full'));
    await tick();
    // Known at once, before the earlier work finished.
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(() => order.check()).toThrow('disk full');
    await expect(order.room(10)).rejects.toThrow('disk full');
    slow.resolve('slow');
    await expect(order.drain()).rejects.toThrow('disk full');
    expect(seen).toEqual([]);
    order.run(() => seen.push('late'));
    await tick();
    expect(seen).toEqual([]);
  });

  it('holds back with room() until few enough effects wait', async () => {
    const order = new InOrder();
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    for (const gate of gates) order.after(gate.promise, () => undefined);
    let roomy = false;
    const waiting = order.room(1).then(() => {
      roomy = true;
    });
    gates[0].resolve(0);
    await tick();
    expect(roomy).toBe(false);
    gates[1].resolve(1);
    await waiting;
    expect(roomy).toBe(true);
    gates[2].resolve(2);
    await order.drain();
  });

  it('settles: waits for every work still running and applies nothing more', async () => {
    const order = new InOrder();
    const seen: string[] = [];
    const work = deferred<string>();
    let done = false;
    order.after(
      work.promise.then((v) => {
        done = true;
        return v;
      }),
      (v) => seen.push(v),
    );
    const settled = order.settle();
    setTimeout(() => work.resolve('late'), 10);
    await settled;
    expect(done).toBe(true);
    expect(seen).toEqual([]);
  });
});
