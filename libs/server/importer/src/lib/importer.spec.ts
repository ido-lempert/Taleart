import { randomBytes } from 'node:crypto';
import { MAX_IMPORT_REPORT_DIFFERENCES, type ImportDifference } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { decryptToken, encryptToken, parseTokenKey } from './crypto';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { claimNextJob, IMPORT_LIST_LIMIT, listImportJobs, progressOf } from './jobs';
import { migrateImporter } from './migration';
import { StorylyClient } from './storyly-client';
import { importContent, redactDeep, runImportJob, type ContentSource } from './worker';

const noContent: ContentSource = { listStoryGroups: async () => [], listStories: async () => [] };

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
    expect(await client.listApps()).toEqual({ records: [{ id: '1001', name: 'Demo shop', differences: [] }], rejected: [] });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://fake/external/app');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('falls back to the token parameter when the bearer token is refused, and keeps using it', async () => {
    const fetch = vi.fn(async (url: URL) => (url.searchParams.get('token') === TOKEN ? json(200, []) : json(401, {})));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client.listApps()).toEqual({ records: [], rejected: [] });
    expect(await client.listInstances('1001')).toEqual({ records: [], rejected: [] });
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

describe('importContent: zones', () => {
  it('creates a zone and a link per new instance, and notes the unknown frame type', async () => {
    const { db, statements } = fakeDb((sql, params) => {
      if (/FROM import_links/.test(sql)) return { rows: [] };
      if (/FROM projects/.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/INSERT INTO zones/.test(sql)) return { rows: [{ id: zoneId, name: params[0], projectId }] };
      return { rows: [] };
    });
    const report = await importContent(db, projectId, [{ id: '2001', name: 'Home page' }], noContent);
    expect(report).toEqual({
      zones: { source: 1, imported: 1, skipped: 0 },
      taleGroups: { source: 0, imported: 0, skipped: 0 },
      tales: { source: 0, imported: 0, skipped: 0 },
      notes: ['Zone "Home page": frame type unknown'],
      differences: [],
      notImportedByDesign: ['Conversion records', 'Stats'],
    });
    expect(statements().some((s) => /INSERT INTO import_links/.test(s))).toBe(true);
  });

  it('does not create a zone again for a linked instance, and skips a repeated id', async () => {
    const { db, statements } = fakeDb((sql) => {
      if (/FROM import_links/.test(sql)) return { rows: [{ target_id: zoneId }] };
      if (/FROM zones/.test(sql)) return { rows: [{ project_id: projectId }] };
      return { rows: [] };
    });
    const report = await importContent(
      db,
      projectId,
      [
        { id: '2001', name: 'Home page' },
        { id: '2001', name: 'Home page' },
      ],
      noContent,
    );
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
    expect(fail?.[1]).toEqual([jobId, 'w1', 'Storyly answered 500 when listing apps', null]);
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

describe('importContent: zone locking', () => {
  it('locks the source record before reading its link, and never re-points a link', async () => {
    const { db, statements } = fakeDb((sql, params) => {
      if (/FROM import_links/.test(sql)) return { rows: [] };
      if (/INSERT INTO zones/.test(sql)) return { rows: [{ id: zoneId, name: params[0], projectId }] };
      return undefined;
    });
    await importContent(db, projectId, [{ id: '2001', name: 'Home page' }], noContent);
    const sql = statements();
    const lock = sql.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.findIndex((s) => /FROM import_links/.test(s)));
    expect(sql.find((s) => /INSERT INTO import_links/.test(s))).toMatch(/DO NOTHING/);
  });
});

// A stateful stand-in for the tables an import writes, answering the SQL the
// zones, tales and importer modules send. Enough to follow an import's logic.
function contentDb() {
  let next = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;
  const links = new Map<string, string>();
  const zones = new Map<string, string>();
  const groups = new Map<string, { name: string; zoneId: string; position: number }>();
  const tales = new Map<string, { groupId: string; title: string; position: number }>();
  // Called when a link is read; a test can create a competing link there.
  let onLinkRead: (key: string) => void = () => undefined;
  const { db, statements } = fakeDb((sql, params) => {
    const p = params as string[];
    if (/FROM import_links/.test(sql)) {
      const key = `${p[2]}:${p[3]}`;
      onLinkRead(key);
      const target = links.get(key);
      return { rows: target ? [{ target_id: target }] : [] };
    }
    if (/INSERT INTO import_links/.test(sql)) {
      links.set(`${p[2]}:${p[3]}`, p[5]);
      return { rows: [], rowCount: 1 };
    }
    if (/FROM projects/.test(sql)) return { rows: [{}], rowCount: 1 };
    if (/INSERT INTO zones/.test(sql)) {
      const id = uuid();
      zones.set(id, p[0]);
      return { rows: [{ id, name: p[0], projectId }] };
    }
    if (/FROM zones WHERE id/.test(sql)) return { rows: zones.has(p[0]) ? [{ project_id: projectId }] : [] };
    if (/INSERT INTO tale_groups/.test(sql)) {
      const id = uuid();
      groups.set(id, { name: p[1], zoneId: '', position: -1 });
      return { rows: [{ id, projectId, name: p[1] }] };
    }
    if (/INSERT INTO zone_tale_groups/.test(sql)) {
      const position = [...groups.values()].filter((g) => g.zoneId === p[0]).length;
      groups.set(p[1], { ...(groups.get(p[1]) as { name: string }), zoneId: p[0], position });
      return { rows: [{ position }] };
    }
    if (/SELECT 1 FROM tale_groups/.test(sql)) return { rows: groups.has(p[0]) ? [{}] : [] };
    if (/SELECT project_id FROM tale_groups/.test(sql)) {
      return { rows: groups.has(p[0]) ? [{ project_id: projectId }] : [] };
    }
    if (/count\(\*\)::int/.test(sql)) {
      const count = [...tales.values()].filter((t) => t.groupId === p[0]).length;
      return { rows: [{ count, next: count }] };
    }
    if (/INSERT INTO tales/.test(sql)) {
      const id = uuid();
      tales.set(id, { groupId: p[0], title: p[2], position: Number(p[3]) });
      return { rows: [{ id, taleGroupId: p[0], projectId, title: p[2], position: p[3], mediaContentType: null }] };
    }
    if (/SELECT 1 FROM tales/.test(sql)) return { rows: tales.has(p[0]) ? [{}] : [] };
    return { rows: [], rowCount: 1 };
  });
  // The zone's groups by position, each with its tale titles by position.
  const zoneContent = (zoneName: string) => {
    const zone = [...zones].find(([, name]) => name === zoneName)?.[0];
    return [...groups]
      .filter(([, g]) => g.zoneId === zone)
      .sort(([, a], [, b]) => a.position - b.position)
      .map(([id, g]) => ({
        name: g.name,
        tales: [...tales.values()]
          .filter((t) => t.groupId === id)
          .sort((a, b) => a.position - b.position)
          .map((t) => t.title),
      }));
  };
  return {
    db,
    statements,
    links,
    zones,
    groups,
    tales,
    zoneContent,
    setOnLinkRead: (f: (key: string) => void) => {
      onLinkRead = f;
    },
  };
}

type Rec = { id: string; name: string; sortOrder: number | null };
function source(groups: Record<string, Rec[]>, stories: Record<string, Rec[]>): ContentSource {
  return {
    listStoryGroups: async (instanceId) => groups[instanceId] ?? [],
    listStories: async (groupId) => stories[groupId] ?? [],
  };
}

describe('importContent: tale groups and tales', () => {
  const home = [{ id: '2001', name: 'Home page' }];
  const groups = {
    '2001': [
      { id: 'g1', name: 'Summer', sortOrder: 2 },
      { id: 'g2', name: 'New', sortOrder: 0 },
      { id: 'g3', name: 'Gifts', sortOrder: 1 },
    ],
  };
  const stories = {
    g1: [
      { id: 's1', name: 'B', sortOrder: 1 },
      { id: 's2', name: 'A', sortOrder: 0 },
    ],
    g2: [{ id: 's3', name: 'C', sortOrder: 0 }],
    g3: [],
  };

  it('creates the groups in the zone and their tales in source order, each linked once', async () => {
    const fake = contentDb();
    const report = await importContent(fake.db, projectId, home, source(groups, stories));
    expect(report.taleGroups).toEqual({ source: 3, imported: 3, skipped: 0 });
    expect(report.tales).toEqual({ source: 3, imported: 3, skipped: 0 });
    expect(report.notes).toEqual(['Zone "Home page": frame type unknown']);
    expect(fake.zoneContent('Home page')).toEqual([
      { name: 'New', tales: ['C'] },
      { name: 'Gifts', tales: [] },
      { name: 'Summer', tales: ['A', 'B'] },
    ]);
    expect([...fake.links.keys()].sort()).toEqual([
      'instance:2001',
      'story:s1',
      'story:s2',
      'story:s3',
      'story_group:g1',
      'story_group:g2',
      'story_group:g3',
    ]);
    // Each link is saved in its record's transaction, after the source key is locked.
    const sql = fake.statements();
    const insertTale = sql.findIndex((s) => /INSERT INTO tales/.test(s));
    const lock = sql.findIndex((s, i) => i > insertTale && /pg_advisory_xact_lock/.test(s));
    const link = sql.findIndex((s, i) => i > insertTale && /INSERT INTO import_links/.test(s));
    expect(insertTale).toBeLessThan(lock);
    expect(lock).toBeLessThan(link);
    expect(sql.indexOf('COMMIT', link)).toBeGreaterThan(link);
  });

  it('creates nothing again on a re-run, and adds a new source story after the others', async () => {
    const fake = contentDb();
    await importContent(fake.db, projectId, home, source(groups, stories));
    const counts = [fake.groups.size, fake.tales.size, fake.links.size];
    const again = await importContent(fake.db, projectId, home, source(groups, stories));
    expect([fake.groups.size, fake.tales.size, fake.links.size]).toEqual(counts);
    expect(again.taleGroups).toEqual({ source: 3, imported: 3, skipped: 0 });
    expect(again.tales).toEqual({ source: 3, imported: 3, skipped: 0 });

    const more = { ...stories, g1: [...stories.g1, { id: 's9', name: 'First at source', sortOrder: -1 }] };
    const third = await importContent(fake.db, projectId, home, source(groups, more));
    expect(third.tales).toEqual({ source: 4, imported: 4, skipped: 0 });
    expect(fake.zoneContent('Home page')[2]).toEqual({ name: 'Summer', tales: ['A', 'B', 'First at source'] });
  });

  it('places records without a source position last and notes them, and names blank titles', async () => {
    const fake = contentDb();
    const report = await importContent(
      fake.db,
      projectId,
      home,
      source(
        {
          '2001': [
            { id: 'g1', name: '  ', sortOrder: null },
            { id: 'g2', name: 'Second', sortOrder: 5 },
          ],
        },
        {
          g1: [
            { id: 's1', name: '', sortOrder: null },
            { id: 's2', name: 'Kept', sortOrder: 3 },
          ],
        },
      ),
    );
    expect(fake.zoneContent('Home page')).toEqual([
      { name: 'Second', tales: [] },
      { name: 'Untitled tale group', tales: ['Kept', 'Untitled tale group'] },
    ]);
    expect(report.notes).toEqual([
      'Zone "Home page": frame type unknown',
      'Tale group "Untitled tale group": no source position, placed after the others',
      'Tale "Untitled tale group" in "Untitled tale group": no source position, placed after the others',
    ]);
  });

  it('skips a repeated group or story id', async () => {
    const fake = contentDb();
    const report = await importContent(
      fake.db,
      projectId,
      [...home, { id: '2002', name: 'Product page' }],
      source(
        { '2001': [{ id: 'g1', name: 'A', sortOrder: 0 }], '2002': [{ id: 'g1', name: 'A', sortOrder: 0 }] },
        {
          g1: [
            { id: 's1', name: 'T', sortOrder: 0 },
            { id: 's1', name: 'T', sortOrder: 1 },
          ],
        },
      ),
    );
    expect(report.taleGroups).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(report.tales).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(fake.groups.size).toBe(1);
    expect(fake.tales.size).toBe(1);
  });

  it('skips with a note a group or tale whose earlier import is gone, without re-pointing its link', async () => {
    const fake = contentDb();
    await importContent(fake.db, projectId, home, source(groups, stories));
    const groupId = fake.links.get('story_group:g2') as string;
    const taleId = fake.links.get('story:s1') as string;
    fake.groups.delete(groupId);
    fake.tales.delete(taleId);
    const report = await importContent(fake.db, projectId, home, source(groups, stories));
    expect(report.taleGroups).toEqual({ source: 3, imported: 2, skipped: 1 });
    expect(report.tales).toEqual({ source: 3, imported: 1, skipped: 2 });
    expect(report.notes).toEqual([
      'Zone "Home page": frame type unknown',
      'Tale group "New": its earlier import was deleted, so it was not imported again',
      'Tale "B" in "Summer": its earlier import was deleted, so it was not imported again',
    ]);
    expect(fake.links.get('story_group:g2')).toBe(groupId);
  });

  it("counts a zone's groups and tales as skipped when the zone is not imported", async () => {
    const fake = contentDb();
    fake.links.set('instance:2001', '00000000-0000-4000-8000-0000000000ff');
    const report = await importContent(fake.db, projectId, home, source(groups, stories));
    expect(report.zones).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(report.taleGroups).toEqual({ source: 3, imported: 0, skipped: 3 });
    expect(report.tales).toEqual({ source: 3, imported: 0, skipped: 3 });
    expect(report.notes).toContain('Zone "Home page": its 3 tale group(s) were not imported, since the zone was not');
    expect(fake.groups.size).toBe(0);
  });

  it('skips with a note the stories a full tale group cannot take', async () => {
    const fake = contentDb();
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, name: `T${i}`, sortOrder: i }));
    const report = await importContent(
      fake.db,
      projectId,
      home,
      source({ '2001': [{ id: 'g1', name: 'Big', sortOrder: 0 }] }, { g1: many }),
    );
    expect(report.tales).toEqual({ source: 101, imported: 100, skipped: 1 });
    expect(report.notes).toContain('Tale "T100" in "Big": the tale group already holds 100 tales');
  });

  it('rolls its creation back and uses the other link when another import linked the record meanwhile', async () => {
    const fake = contentDb();
    const otherId = '00000000-0000-4000-8000-0000000000ee';
    let reads = 0;
    fake.setOnLinkRead((key) => {
      // The second read of g2's link is the in-transaction check: another import got there first.
      if (key === 'story_group:g2' && ++reads === 2) {
        fake.links.set(key, otherId);
        fake.groups.set(otherId, { name: 'New', zoneId: 'elsewhere', position: 0 });
      }
    });
    const report = await importContent(
      fake.db,
      projectId,
      home,
      source({ '2001': [{ id: 'g2', name: 'New', sortOrder: 0 }] }, { g2: [{ id: 's3', name: 'C', sortOrder: 0 }] }),
    );
    expect(report.taleGroups).toEqual({ source: 1, imported: 1, skipped: 0 });
    expect(fake.statements()).toContain('ROLLBACK');
    expect(fake.links.get('story_group:g2')).toBe(otherId);
    expect([...fake.tales.values()]).toEqual([{ groupId: otherId, title: 'C', position: 0 }]);
  });
});

describe('StorylyClient: story groups and stories', () => {
  it('reads story groups by instance and stories by group, with their sort order', async () => {
    const fetch = vi.fn(async (url: URL) =>
      url.pathname.endsWith('/story-group')
        ? json(200, {
            data: [
              { id: 3001, title: 'A', sort_order: 2 },
              { id: '3002', title: 'B', sort_order: '1' },
            ],
          })
        : json(200, [
            { id: 4001, title: 'T' },
            { id: 4002, title: 'U', sort_order: 'x' },
          ]),
    );
    const client = new StorylyClient({
      baseUrl: 'http://fake',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect((await client.listStoryGroups('2001')).records).toMatchObject([
      { id: '3001', name: 'A', sortOrder: 2 },
      { id: '3002', name: 'B', sortOrder: 1 },
    ]);
    expect((await client.listStories('3001')).records).toMatchObject([
      { id: '4001', name: 'T', sortOrder: null },
      { id: '4002', name: 'U', sortOrder: null },
    ]);
    expect(String(fetch.mock.calls[0][0])).toBe('http://fake/story-group?instance_id=2001');
    expect(String(fetch.mock.calls[1][0])).toBe('http://fake/story?story_group_id=3001');
  });

  it('refuses a story list of an unexpected shape', async () => {
    const client = new StorylyClient({
      baseUrl: 'http://fake',
      token: TOKEN,
      fetch: vi.fn(async () => json(200, { stories: [{ id: 1 }] })),
    });
    await expect(client.listStories('1')).rejects.toThrow(/stories response has an unexpected shape/);
  });
});

describe('importContent: review fixes', () => {
  const home = [{ id: '2001', name: 'Home page' }];

  it('notes a record without a source position only when this run creates it', async () => {
    const fake = contentDb();
    const content = source(
      {
        '2001': [
          { id: 'g1', name: 'Late', sortOrder: null },
          { id: 'g1', name: 'Late', sortOrder: null },
        ],
      },
      { g1: [{ id: 's1', name: 'T', sortOrder: null }] },
    );
    const first = await importContent(fake.db, projectId, home, content);
    expect(first.notes).toEqual([
      'Zone "Home page": frame type unknown',
      'Tale group "Late": no source position, placed after the others',
      'Tale "T" in "Late": no source position, placed after the others',
    ]);
    const again = await importContent(fake.db, projectId, home, content);
    expect(again.notes).toEqual(['Zone "Home page": frame type unknown']);
  });

  it('counts each story of a skipped group once, so source is imported plus skipped', async () => {
    const fake = contentDb();
    fake.links.set('instance:2001', '00000000-0000-4000-8000-0000000000ff');
    const report = await importContent(
      fake.db,
      projectId,
      [...home, { id: '2002', name: 'Product page' }],
      source(
        { '2001': [{ id: 'g1', name: 'A', sortOrder: 0 }], '2002': [{ id: 'g2', name: 'B', sortOrder: 0 }] },
        { g1: [{ id: 's1', name: 'T', sortOrder: 0 }], g2: [{ id: 's1', name: 'T', sortOrder: 0 }, { id: 's2', name: 'U', sortOrder: 1 }] },
      ),
    );
    expect(report.tales).toEqual({ source: 3, imported: 1, skipped: 2 });
    expect([...fake.tales.values()].map((t) => t.title)).toEqual(['U']);
  });

  it('skips with a note a group whose zone or a tale whose group is deleted during the import', async () => {
    const zoneGone = contentDb();
    let calls = 0;
    const report = await importContent(
      zoneGone.db,
      projectId,
      home,
      source({ '2001': [{ id: 'g1', name: 'A', sortOrder: 0 }] }, { g1: [{ id: 's1', name: 'T', sortOrder: 0 }] }),
      async () => {
        // Before the group: its zone goes.
        if (++calls === 2) zoneGone.zones.clear();
      },
    );
    expect(report.taleGroups).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(report.tales).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(report.notes).toContain('Tale group "A": its zone was deleted during the import');

    const groupGone = contentDb();
    calls = 0;
    const second = await importContent(
      groupGone.db,
      projectId,
      home,
      source({ '2001': [{ id: 'g1', name: 'A', sortOrder: 0 }] }, { g1: [{ id: 's1', name: 'T', sortOrder: 0 }] }),
      async () => {
        // Before the tale: its group goes.
        if (++calls === 3) groupGone.groups.clear();
      },
    );
    expect(second.taleGroups).toEqual({ source: 1, imported: 1, skipped: 0 });
    expect(second.tales).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(second.notes).toContain('Tale "T" in "A": its tale group was deleted during the import');
  });
});

describe('progress', () => {
  const key = randomBytes(32);
  const home = [{ id: '2001', name: 'Home page' }];
  const groups = { '2001': [{ id: 'g1', name: 'Summer', sortOrder: 0 }] };
  const stories = {
    g1: [
      { id: 's1', name: 'A', sortOrder: 0 },
      { id: 's2', name: 'B', sortOrder: 1 },
    ],
  };

  it('counts read and written records from a report, an older report included', () => {
    expect(
      progressOf({
        zones: { source: 3, imported: 2, skipped: 1 },
        taleGroups: { source: 6, imported: 6, skipped: 0 },
        tales: { source: 15, imported: 14, skipped: 1 },
        notes: [],
      }),
    ).toEqual({ zones: { read: 3, written: 2 }, taleGroups: { read: 6, written: 6 }, tales: { read: 15, written: 14 } });
    expect(progressOf({ zones: { source: 1, imported: 1, skipped: 0 }, notes: [] })).toEqual({
      zones: { read: 1, written: 1 },
      taleGroups: { read: 0, written: 0 },
      tales: { read: 0, written: 0 },
    });
  });

  it('hands the report so far to beforeEach before each record, so progress rises as records are read and written', async () => {
    const fake = contentDb();
    const seen: unknown[] = [];
    await importContent(fake.db, projectId, home, source(groups, stories), async (sofar) => {
      seen.push(progressOf(sofar));
    });
    const p = (z: number[], g: number[], t: number[]) => ({
      zones: { read: z[0], written: z[1] },
      taleGroups: { read: g[0], written: g[1] },
      tales: { read: t[0], written: t[1] },
    });
    expect(seen).toEqual([
      p([1, 0], [0, 0], [0, 0]), // before the zone
      p([1, 1], [1, 0], [2, 0]), // before the group: its stories are read
      p([1, 1], [1, 1], [2, 0]), // before each tale
      p([1, 1], [1, 1], [2, 1]),
    ]);
  });

  it('stores progress with each heartbeat and the final progress with the report', async () => {
    const { db, query } = fakeDb((sql, params) => {
      if (/FROM import_links/.test(sql)) return { rows: [] };
      if (/FROM projects/.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/INSERT INTO zones/.test(sql)) return { rows: [{ id: zoneId, name: params[0], projectId }] };
      return undefined;
    });
    const fetch = vi.fn(async (url: string | URL) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/app')) return json(200, { data: [{ id: 1001, title: 'Demo shop' }] });
      if (path.endsWith('/instance')) return json(200, { data: [{ id: 2001, title: 'Home page' }] });
      return json(200, { data: [] });
    }) as unknown as typeof globalThis.fetch;
    await runImportJob(
      db,
      { id: jobId, projectId, sourceAppId: '1001', tokenCiphertext: encryptToken(TOKEN, key), lockedBy: 'w1' },
      { tokenKey: key, storylyApiUrl: 'http://fake', fetch },
    );
    const beats = query.mock.calls.filter((c) => /SET heartbeat_at = now\(\), progress = \$3/.test(c[0] as string));
    expect(beats.length).toBeGreaterThan(0);
    expect(beats[0][0]).toMatch(/locked_by = \$2/);
    expect(JSON.parse((beats[0][1] as string[])[2])).toEqual({
      zones: { read: 1, written: 0 },
      taleGroups: { read: 0, written: 0 },
      tales: { read: 0, written: 0 },
    });
    const done = query.mock.calls.find((c) => /SET status = 'done'/.test(c[0] as string));
    expect(done?.[0]).toMatch(/progress = \$4/);
    expect(JSON.parse((done?.[1] as string[])[3])).toEqual({
      zones: { read: 1, written: 1 },
      taleGroups: { read: 0, written: 0 },
      tales: { read: 0, written: 0 },
    });
    // No progress or job write ever carries the token.
    for (const call of query.mock.calls) expect(JSON.stringify(call[1] ?? [])).not.toContain(TOKEN);
  });

  it('keeps the stored progress when a job fails before it reads any content', async () => {
    const { db, query } = fakeDb();
    await runImportJob(
      db,
      { id: jobId, projectId, sourceAppId: '1001', tokenCiphertext: encryptToken(TOKEN, key), lockedBy: 'w1' },
      { tokenKey: key, storylyApiUrl: 'http://fake', fetch: vi.fn(async () => json(500, {})) },
    );
    const fail = query.mock.calls.find((c) => /SET status = 'failed'/.test(c[0] as string));
    expect(fail?.[0]).toMatch(/progress = COALESCE\(\$4::jsonb, progress\)/);
    expect((fail?.[1] as unknown[])[3]).toBeNull();
  });

  it('clears progress when a job is claimed, so a recovered job starts counting again', async () => {
    const { db, statements } = fakeDb(() => ({ rows: [{ id: jobId }] }));
    await claimNextJob(db, 'w1');
    expect(statements().join('\n')).toMatch(/progress = NULL/);
  });

  it('adds the progress column', async () => {
    const { db, statements } = fakeDb();
    await migrateImporter(db);
    expect(statements().join('\n')).toMatch(/ADD COLUMN IF NOT EXISTS progress jsonb/);
  });
});

describe('listImportJobs', () => {
  it("reads the project's jobs newest first, at most the limit, without reports or tokens", async () => {
    const created = new Date('2026-10-21T10:00:00Z');
    const { db, query } = fakeDb(() => ({
      rows: [
        {
          id: jobId,
          status: 'failed',
          sourceAppName: 'Demo shop',
          error: 'Storyly answered 500 when listing instances',
          createdAt: created,
          startedAt: created,
          finishedAt: null,
        },
      ],
    }));
    expect(await listImportJobs(db, projectId)).toEqual([
      {
        id: jobId,
        status: 'failed',
        sourceAppName: 'Demo shop',
        error: 'Storyly answered 500 when listing instances',
        createdAt: '2026-10-21T10:00:00.000Z',
        startedAt: '2026-10-21T10:00:00.000Z',
        finishedAt: null,
      },
    ]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/WHERE project_id = \$1 ORDER BY created_at DESC/);
    expect(sql).not.toMatch(/token_ciphertext|report/);
    expect(params).toEqual([projectId, IMPORT_LIST_LIMIT]);
  });

  it('answers no jobs for an id that is not a UUID, without asking the database', async () => {
    const { db, query } = fakeDb();
    expect(await listImportJobs(db, 'nope')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('importContent: differences', () => {
  const diff = (
    entity: ImportDifference['entity'],
    sourceId: string | null,
    kind: ImportDifference['kind'],
    field: string | null,
    position = 1,
  ): ImportDifference => ({
    entity,
    record: { sourceId, name: null, within: null, position },
    kind,
    field,
    sourceField: null,
  });

  it('lists differences per record with the record they belong to, and counts rejected records as skipped', async () => {
    const fake = contentDb();
    const instances = {
      records: [{ id: '2001', name: 'Home page', differences: [diff('zone', '2001', 'notHeld', 'token')] }],
      rejected: [diff('zone', null, 'invalidRecord', null, 2)],
    };
    const content: ContentSource = {
      listStoryGroups: async () => ({
        records: [{ id: 'g1', name: 'Summer', sortOrder: 0, differences: [diff('taleGroup', 'g1', 'unexpected', 'theme')] }],
        rejected: [diff('taleGroup', null, 'invalidRecord', null, 2)],
      }),
      listStories: async () => ({
        records: [
          { id: 's1', name: 'A', sortOrder: 0, differences: [diff('tale', 's1', 'notHeld', 'deep_link')] },
          // Listed twice at the source: skipped the second time, its differences listed once.
          { id: 's1', name: 'A', sortOrder: 1, differences: [diff('tale', 's1', 'notHeld', 'deep_link')] },
        ],
        rejected: [diff('tale', null, 'invalidRecord', null, 3)],
      }),
    };
    const report = await importContent(fake.db, projectId, instances, content, undefined, [
      diff('app', '1001', 'notHeld', 'settings'),
    ]);
    expect(report.zones).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(report.taleGroups).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(report.tales).toEqual({ source: 3, imported: 1, skipped: 2 });
    expect(report.differences?.map((d) => [d.entity, d.kind, d.field, d.record.within])).toEqual([
      ['app', 'notHeld', 'settings', null],
      ['zone', 'invalidRecord', null, null],
      ['zone', 'notHeld', 'token', null],
      ['taleGroup', 'invalidRecord', null, 'Home page'],
      ['taleGroup', 'unexpected', 'theme', 'Home page'],
      ['tale', 'invalidRecord', null, 'Summer'],
      ['tale', 'notHeld', 'deep_link', 'Summer'],
    ]);
    expect(report.notImportedByDesign).toEqual(['Conversion records', 'Stats']);
    expect(report.differencesOmitted).toBeUndefined();
  });

  it('lists the differences of the stories of a skipped group', async () => {
    const fake = contentDb();
    const content: ContentSource = {
      listStoryGroups: async () => [{ id: 'g1', name: 'Summer', sortOrder: 0 }],
      listStories: async () => [
        { id: 's1', name: 'A', sortOrder: 0, differences: [diff('tale', 's1', 'notHeld', 'outlink')] },
      ],
    };
    await importContent(fake.db, projectId, [{ id: '2001', name: 'Home page' }], content);
    // The zone is gone now: the group and its story are skipped, their differences still listed.
    fake.zones.clear();
    const report = await importContent(fake.db, projectId, [{ id: '2001', name: 'Home page' }], content);
    expect(report.tales).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(report.differences?.map((d) => d.field)).toEqual(['outlink']);
  });

  it(`stores at most ${MAX_IMPORT_REPORT_DIFFERENCES} differences and counts the rest`, async () => {
    const fake = contentDb();
    const many = Array.from({ length: MAX_IMPORT_REPORT_DIFFERENCES + 7 }, (_, i) =>
      diff('zone', '2001', 'unexpected', `f${i}`),
    );
    const report = await importContent(
      fake.db,
      projectId,
      [{ id: '2001', name: 'Home page', differences: many }],
      noContent,
    );
    expect(report.differences).toHaveLength(MAX_IMPORT_REPORT_DIFFERENCES);
    expect(report.differencesOmitted).toBe(7);
  });

  it('removes the token from every string of a report', () => {
    const report = { notes: [`a ${TOKEN} b`], differences: [{ record: { name: TOKEN } }], zones: { source: 1 } };
    expect(redactDeep(report, TOKEN)).toEqual({
      notes: ['a [token] b'],
      differences: [{ record: { name: '[token]' } }],
      zones: { source: 1 },
    });
    expect(redactDeep(report, null)).toBe(report);
  });
});
