import { randomBytes } from 'node:crypto';
import type { TransactionalDb } from '@taleart/server-access';
import { decryptToken, encryptToken, parseTokenKey } from './crypto';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { claimNextJob } from './jobs';
import { migrateImporter } from './migration';
import { StorylyClient } from './storyly-client';
import { importZones, runImportJob } from './worker';

const projectId = '00000000-0000-4000-8000-000000000002';
const zoneId = '00000000-0000-4000-8000-00000000000a';
const jobId = '00000000-0000-4000-8000-00000000000b';
const TOKEN = 'secret-token-value';

// A fake pool: each query is answered by `answer(sql, params)`; transactions are no-ops.
function fakeDb(answer: (sql: string, params: unknown[]) => unknown = () => ({ rows: [], rowCount: 1 })) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const result = answer(sql, params);
    if (result instanceof Error) throw result;
    return result ?? { rows: [], rowCount: 1 };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, statements };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('token encryption', () => {
  const key = randomBytes(32);

  it('round-trips a token and never stores it in clear', () => {
    const stored = encryptToken(TOKEN, key);
    expect(stored).not.toContain(TOKEN);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(decryptToken(stored, key)).toBe(TOKEN);
    expect(encryptToken(TOKEN, key)).not.toBe(stored);
  });

  it('refuses another key or a changed value', () => {
    const stored = encryptToken(TOKEN, key);
    expect(() => decryptToken(stored, randomBytes(32))).toThrow();
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptToken(parts.join('.'), key)).toThrow();
  });

  it('accepts only 32 bytes of base64 as the key', () => {
    expect(parseTokenKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseTokenKey(undefined)).toBeNull();
    expect(parseTokenKey('')).toBeNull();
    expect(parseTokenKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseTokenKey('not base64!')).toBeNull();
  });
});

describe('migration', () => {
  it('keys every table to a project and makes a source record link once', async () => {
    const { db, statements } = fakeDb();
    await migrateImporter(db);
    const sql = statements().join('\n');
    expect(sql.match(/project_id uuid NOT NULL REFERENCES projects\(id\)/g)).toHaveLength(2);
    expect(sql).toMatch(/UNIQUE \(project_id, source_system, source_type, source_id\)/);
    expect(sql).toMatch(/status IN \('queued', 'running'\) OR token_ciphertext IS NULL/);
  });
});

describe('claimNextJob', () => {
  it('claims with FOR UPDATE SKIP LOCKED and marks the job running', async () => {
    const { db, statements } = fakeDb(() => ({ rows: [{ id: jobId }] }));
    expect(await claimNextJob(db, 'w1')).toEqual({ id: jobId });
    const sql = statements().join('\n');
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/SET status = 'running'/);
  });
});

describe('StorylyClient', () => {
  it('sends a bearer token and reads apps from a data list', async () => {
    const fetch = vi.fn(async () => json(200, { data: [{ id: 1001, title: 'Demo shop', token: 'x' }] }));
    const client = new StorylyClient({ baseUrl: 'http://fake/external/', token: TOKEN, fetch });
    expect(await client.listApps()).toEqual([{ id: '1001', name: 'Demo shop' }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://fake/external/app');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('falls back to the token parameter when the bearer token is refused, and keeps using it', async () => {
    const fetch = vi.fn(async (url: URL) => (url.searchParams.get('token') === TOKEN ? json(200, []) : json(401, {})));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client.listApps()).toEqual([]);
    expect(await client.listInstances('1001')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2][0])).toBe(`http://fake/instance?app_id=1001&token=${TOKEN}`);
  });

  it('reports a token refused both ways', async () => {
    const fetch = vi.fn(async () => json(403, {}));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch });
    await expect(client.listApps()).rejects.toBeInstanceOf(StorylyTokenInvalidError);
  });

  it('turns an error status, an unexpected shape or no connection into a message without the token', async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => json(500, {}),
      async () => json(200, { instances: 'unexpected' }),
      async () => json(200, { data: [{ title: 'No id' }] }),
      async () => json(200, { data: [{ id: 5 }] }),
      async () => {
        throw new Error(`connect ECONNREFUSED http://fake/instance?token=${TOKEN}`);
      },
    ];
    for (const answer of answers) {
      const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: vi.fn(answer) });
      const err = await client.listInstances('1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorylyUnavailableError);
      expect((err as Error).message).not.toContain(TOKEN);
    }
  });
});

describe('importZones', () => {
  it('creates a zone and a link per new instance, and notes the unknown frame type', async () => {
    const { db, statements } = fakeDb((sql, params) => {
      if (/FROM import_links/.test(sql)) return { rows: [] };
      if (/FROM projects/.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/INSERT INTO zones/.test(sql)) return { rows: [{ id: zoneId, name: params[0], projectId }] };
      return { rows: [] };
    });
    const report = await importZones(db, projectId, [{ id: '2001', name: 'Home page' }]);
    expect(report).toEqual({
      zones: { source: 1, imported: 1, skipped: 0 },
      notes: ['Zone "Home page": frame type unknown'],
    });
    expect(statements().some((s) => /INSERT INTO import_links/.test(s))).toBe(true);
  });

  it('does not create a zone again for a linked instance, and skips a repeated id', async () => {
    const { db, statements } = fakeDb((sql) => {
      if (/FROM import_links/.test(sql)) return { rows: [{ target_id: zoneId }] };
      if (/FROM zones/.test(sql)) return { rows: [{ project_id: projectId }] };
      return { rows: [] };
    });
    const report = await importZones(db, projectId, [
      { id: '2001', name: 'Home page' },
      { id: '2001', name: 'Home page' },
    ]);
    expect(report.zones).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(statements().some((s) => /INSERT INTO zones/.test(s))).toBe(false);
  });
});

describe('runImportJob', () => {
  const key = randomBytes(32);

  it('fails the job with a message and no token when the source fails', async () => {
    const { db, query } = fakeDb();
    const fetch = vi.fn(async () => json(500, {}));
    await runImportJob(
      db,
      { id: jobId, projectId, sourceAppId: '1001', tokenCiphertext: encryptToken(TOKEN, key), lockedBy: 'w1' },
      { tokenKey: key, storylyApiUrl: 'http://fake', fetch },
    );
    const fail = query.mock.calls.find((c) => /SET status = 'failed'/.test(c[0] as string));
    expect(fail?.[0]).toMatch(/token_ciphertext = NULL/);
    expect(fail?.[0]).toMatch(/locked_by = \$2/);
    expect(fail?.[1]).toEqual([jobId, 'w1', 'Storyly answered 500 when listing apps']);
  });

  it('fails a job whose token cannot be decrypted', async () => {
    const { db, query } = fakeDb();
    await runImportJob(
      db,
      { id: jobId, projectId, sourceAppId: '1001', tokenCiphertext: encryptToken(TOKEN, randomBytes(32)), lockedBy: 'w1' },
      { tokenKey: key, storylyApiUrl: 'http://fake', fetch: vi.fn() },
    );
    const fail = query.mock.calls.find((c) => /SET status = 'failed'/.test(c[0] as string));
    expect((fail?.[1] as string[])[2]).toMatch(/could not be read/);
  });

  const claimed = () => ({
    id: jobId,
    projectId,
    sourceAppId: '1001',
    tokenCiphertext: encryptToken(TOKEN, key),
    lockedBy: 'w1',
  });
  const apps = () => json(200, { data: [{ id: 1001, title: 'Demo shop' }] });

  it('stops without writing when another worker took the job over', async () => {
    const { db, statements } = fakeDb((sql) => (/SET heartbeat_at/.test(sql) ? { rows: [], rowCount: 0 } : undefined));
    const fetch = vi.fn(apps);
    await runImportJob(db, claimed(), { tokenKey: key, storylyApiUrl: 'http://fake', fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(statements().filter((s) => /status = 'failed'|status = 'done'/.test(s))).toEqual([]);
  });

  it('logs an unknown error with the token removed, and keeps the generic message for the user', async () => {
    const log = vi.fn();
    const { db, query } = fakeDb((sql) =>
      /SET source_app_name/.test(sql) ? new Error(`database refused ${TOKEN}`) : undefined,
    );
    await runImportJob(db, claimed(), { tokenKey: key, storylyApiUrl: 'http://fake', fetch: vi.fn(apps), log });
    const logged = log.mock.calls.find((c) => c[0] === 'error')?.[2] as Error;
    expect(logged.message).toBe('database refused [token]');
    expect(logged.stack).not.toContain(TOKEN);
    const fail = query.mock.calls.find((c) => /SET status = 'failed'/.test(c[0] as string));
    expect((fail?.[1] as string[])[2]).toBe('The import stopped on an internal error. Try again.');
  });

  it('does not throw when the failure cannot be recorded', async () => {
    const log = vi.fn();
    const { db } = fakeDb((sql) => (/SET status = 'failed'/.test(sql) ? new Error('connection lost') : undefined));
    await expect(
      runImportJob(db, claimed(), { tokenKey: key, storylyApiUrl: 'http://fake', fetch: vi.fn(async () => json(500, {})), log }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('error', expect.stringMatching(/could not be recorded/), expect.any(Error));
  });
});

describe('importZones locking', () => {
  it('locks the source record before reading its link, and never re-points a link', async () => {
    const { db, statements } = fakeDb((sql, params) => {
      if (/FROM import_links/.test(sql)) return { rows: [] };
      if (/INSERT INTO zones/.test(sql)) return { rows: [{ id: zoneId, name: params[0], projectId }] };
      return undefined;
    });
    await importZones(db, projectId, [{ id: '2001', name: 'Home page' }]);
    const sql = statements();
    const lock = sql.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.findIndex((s) => /FROM import_links/.test(s)));
    expect(sql.find((s) => /INSERT INTO import_links/.test(s))).toMatch(/DO NOTHING/);
  });
});
