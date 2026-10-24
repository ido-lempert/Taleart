import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inTransaction, withClient, type TransactionalDb } from './db';

// A checked-out client as pg hands it out: an EventEmitter that runs queries and is released.
function fakeClient(query: (sql: string) => Promise<unknown> = async () => ({ rows: [] })) {
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(query),
    release: vi.fn(),
  });
  const db = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as TransactionalDb;
  return { client, db };
}

const terminated = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });

describe('withClient (a lost database connection never crashes the API)', () => {
  it("follows pg's order: the query in flight rejects first, then the client emits error", async () => {
    const closed = new Error('Connection terminated unexpectedly');
    const { client, db } = fakeClient(
      () =>
        new Promise((_, reject) => {
          // pg rejects the active query with the FATAL ErrorResponse, then the socket ends and
          // the client emits `error` (here a tick later), with no listener of its own.
          reject(terminated);
          setImmediate(() => client.emit('error', closed));
        }),
    );
    let lostAfterQuery: Error | null = null;
    let followUp: unknown;
    await expect(
      withClient(db, async (c) => {
        try {
          await c.query('SELECT pg_sleep(10)');
        } finally {
          // Already lost, with the first error, before the socket's error arrives.
          lostAfterQuery = c.lost();
          expect(c.signal.aborted).toBe(true);
          await new Promise((resolve) => setImmediate(resolve));
          followUp = await c.query('SELECT 1').catch((err: unknown) => err);
        }
      }),
    ).rejects.toBe(terminated);
    expect(lostAfterQuery).toBe(terminated);
    expect(followUp).toBe(terminated);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('error')).toBe(0);
    expect(client.release).toHaveBeenCalledWith(terminated);
  });

  it('drops a client pg marks unusable, or that failed with a session-ended SQLSTATE', async () => {
    const unusable = fakeClient();
    await withClient(unusable.db, async () => {
      Object.assign(unusable.client, { _queryable: false });
    });
    expect(unusable.client.release).toHaveBeenCalledWith(expect.any(Error));
    for (const code of ['57P01', '57P02', '08006', '25P03']) {
      const failed = fakeClient();
      const err = Object.assign(new Error('session ended'), { code });
      await expect(withClient(failed.db, async () => Promise.reject(err))).rejects.toBe(err);
      expect(failed.client.release).toHaveBeenCalledWith(err);
    }
    // A cancelled statement leaves the session usable: the client goes back to the pool.
    const cancelled = fakeClient();
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    await expect(withClient(cancelled.db, async () => Promise.reject(timeout))).rejects.toBe(timeout);
    expect(cancelled.client.release).toHaveBeenCalledWith();
  });

  it('listens for errors only while the client is checked out, and releases it as is', async () => {
    const { client, db } = fakeClient();
    const result = await withClient(db, async (c) => {
      expect(client.listenerCount('error')).toBe(1);
      await c.query('SELECT 1');
      return 'done';
    });
    expect(result).toBe('done');
    expect(client.listenerCount('error')).toBe(0);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('keeps an error the session emits, fails later queries with it and drops the client', async () => {
    const { client, db } = fakeClient();
    let seen: Error | null = null;
    await expect(
      withClient(db, async (c) => {
        // Without a listener, emitting `error` would throw here (and crash Node from a socket event).
        client.emit('error', terminated);
        seen = c.lost();
        expect(() => c.assertUsable()).toThrow(terminated);
        await c.query('SELECT 1');
      }),
    ).rejects.toBe(terminated);
    expect(seen).toBe(terminated);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.listenerCount('error')).toBe(0);
    expect(client.release).toHaveBeenCalledWith(terminated);
  });

  it('drops a client whose session was lost even when the work itself succeeds', async () => {
    const { client, db } = fakeClient();
    await withClient(db, async () => {
      client.emit('error', terminated);
    });
    expect(client.release).toHaveBeenCalledWith(terminated);
  });

  it('returns a client to the pool after a plain error, unless asked to drop it', async () => {
    const plain = new Error('not found');
    const kept = fakeClient();
    await expect(withClient(kept.db, async () => Promise.reject(plain))).rejects.toBe(plain);
    expect(kept.client.release).toHaveBeenCalledWith();
    const dropped = fakeClient();
    await expect(withClient(dropped.db, async () => Promise.reject(plain), { discardOnError: true })).rejects.toBe(plain);
    expect(dropped.client.release).toHaveBeenCalledWith(plain);
  });

  it('works with a client that cannot emit errors, as the tests fakes are', async () => {
    const query = vi.fn(async () => ({ rows: [{ one: 1 }] }));
    const release = vi.fn();
    const db = { query: vi.fn(), connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb;
    expect(await withClient(db, async (c) => (await c.query('SELECT 1')).rows[0])).toEqual({ one: 1 });
    expect(release).toHaveBeenCalledWith();
  });
});

describe('inTransaction on withClient', () => {
  it('commits and returns the client', async () => {
    const { client, db } = fakeClient();
    expect(await inTransaction(db, async () => 7)).toBe(7);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('rolls back on an error and returns the client', async () => {
    const { client, db } = fakeClient();
    const plain = new Error('conflict');
    await expect(inTransaction(db, async () => Promise.reject(plain))).rejects.toBe(plain);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('drops a client that cannot roll back', async () => {
    const rollbackFailed = new Error('rollback failed');
    const { client, db } = fakeClient(async (sql) => {
      if (sql === 'ROLLBACK') throw rollbackFailed;
      return { rows: [] };
    });
    const plain = new Error('conflict');
    await expect(inTransaction(db, async () => Promise.reject(plain))).rejects.toBe(plain);
    expect(client.release).toHaveBeenCalledWith(rollbackFailed);
  });

  it('skips the rollback on a lost session, fails with its error and drops the client', async () => {
    const { client, db } = fakeClient();
    await expect(
      inTransaction(db, async (tx) => {
        client.emit('error', terminated);
        await tx.query('UPDATE projects SET name = name');
      }),
    ).rejects.toBe(terminated);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual(['BEGIN']);
    expect(client.listenerCount('error')).toBe(0);
    expect(client.release).toHaveBeenCalledWith(terminated);
  });
});

describe('every checked-out client goes through withClient', () => {
  // The server code: the server libraries, the API and the CLI. Tests check clients out themselves.
  const root = join(__dirname, '../../../../..');
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
      return /\.(ts|mjs)$/.test(entry.name) && !/\.(spec|test|scale)\.(ts|mjs)$/.test(entry.name) ? [path] : [];
    });
  }

  it('finds no connect( call outside the helper, with or without a callback', () => {
    const files = ['libs/server', 'apps/api/src', 'apps/api/scripts', 'apps/cli/src'].flatMap((dir) =>
      sources(join(root, dir)),
    );
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith('.mjs'))).toBe(true);
    const helper = join(root, 'libs/server/access/src/lib/db.ts');
    // A plain Node script cannot use the TypeScript helper: it must listen for errors itself.
    const script = join(root, 'apps/api/scripts/tale-media-rollback.mjs');
    const offenders = files.filter((f) => f !== helper && f !== script && /\.connect\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
    const text = readFileSync(script, 'utf8');
    expect(text).toMatch(/pool\.on\('error'/);
    expect(text).toMatch(/client\.on\('error'/);
    expect(text).toMatch(/client\.off\('error'/);
  });
});
