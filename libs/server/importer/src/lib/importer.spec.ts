import { randomBytes } from 'node:crypto';
import { MAX_IMPORT_REPORT_DIFFERENCES, type ImportDifference, type ImportReport } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import { decryptToken, encryptToken, parseTokenKey } from './crypto';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { claimNextJob, IMPORT_LIST_LIMIT, listImportJobs, progressOf } from './jobs';
import { migrateImporter } from './migration';
import { REPORT_TEXT_LIMIT, storedText } from './record-shape';
import { recordsOf, StorylyClient } from './storyly-client';
import { importContent, redactDeep, runImportJob, type ContentSource } from './worker';
import { MAX_MERGE_NOTES } from './label-import';
import { MAX_GROUP_LABELS, MAX_GROUP_TAGS, MAX_IMPORT_TAGS, MAX_LABEL_LIST_ENTRIES } from './labels';
import { MAX_DIFFERENCES_PER_RECORD } from './record-shape';
import { MAX_STORYLY_RESPONSE_BYTES, type SourceLabel } from './storyly-client';

const noContent: ContentSource = { listStoryGroups: async () => [], listStories: async () => [] };

// A storage port that must not be used: these jobs never reach a tale's media.
const noStorage: MediaStorage = {
  put: vi.fn(async () => undefined),
  putStream: vi.fn(async () => undefined),
  get: vi.fn(async () => null),
  delete: vi.fn(async () => undefined),
};

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
    expect(sql.match(/project_id uuid NOT NULL REFERENCES projects\(id\)/g)).toHaveLength(3);
    expect(sql).toMatch(/tale_id uuid PRIMARY KEY/);
    // Source ids live only in import_links (AD-7).
    expect(sql.match(/source_id text/g)).toHaveLength(1);
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
    expect(await client.listApps()).toEqual({ entries: [{ record: { id: '1001', name: 'Demo shop' }, differences: [], omitted: 0 }] });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://fake/external/app');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('falls back to the token parameter when the bearer token is refused, and keeps using it', async () => {
    const fetch = vi.fn(async (url: URL) => (url.searchParams.get('token') === TOKEN ? json(200, []) : json(401, {})));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client.listApps()).toEqual({ entries: [] });
    expect(await client.listInstances('1001')).toEqual({ entries: [] });
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
      { tokenKey: key, storylyApiUrl: 'http://fake', storage: noStorage, fetch },
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
      { tokenKey: key, storylyApiUrl: 'http://fake', storage: noStorage, fetch: vi.fn() },
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
    await runImportJob(db, claimed(), { tokenKey: key, storylyApiUrl: 'http://fake', storage: noStorage, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(statements().filter((s) => /status = 'failed'|status = 'done'/.test(s))).toEqual([]);
  });

  it('logs an unknown error with the token removed, and keeps the generic message for the user', async () => {
    const log = vi.fn();
    const { db, query } = fakeDb((sql) =>
      /SET source_app_name/.test(sql) ? new Error(`database refused ${TOKEN}`) : undefined,
    );
    await runImportJob(db, claimed(), {
      tokenKey: key,
      storylyApiUrl: 'http://fake',
      storage: noStorage,
      fetch: vi.fn(apps),
      log,
    });
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
      runImportJob(db, claimed(), {
        tokenKey: key,
        storylyApiUrl: 'http://fake',
        storage: noStorage,
        fetch: vi.fn(async () => json(500, {})),
        log,
      }),
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
  // The project's tags by name ignoring case, and each tale group's tag ids, as the targeting module keeps them.
  const tagNames = new Map<string, string>();
  const groupTags = new Map<string, Set<string>>();
  // When set, the targeting module finds no tale group: as if it was deleted during the import.
  const state = { groupsGoneForTags: false };
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
    if (/INSERT INTO tags /.test(sql)) {
      for (const name of params[1] as string[]) {
        if (!tagNames.has(name.toLowerCase())) tagNames.set(name.toLowerCase(), name);
      }
      return { rows: [], rowCount: 1 };
    }
    if (/AS requested\(name\)/.test(sql)) {
      const rows = (params[1] as string[]).flatMap((requested) => {
        const name = tagNames.get(requested.toLowerCase());
        return name === undefined ? [] : [{ requested, id: `tag-${name.toLowerCase()}`, projectId, name }];
      });
      return { rows };
    }
    if (/INSERT INTO tale_group_tags/.test(sql)) {
      const set = groupTags.get(p[0]) ?? new Set<string>();
      for (const tagId of params[2] as string[]) set.add(tagId);
      groupTags.set(p[0], set);
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT project_id FROM tale_groups WHERE id = \$1$/.test(sql) && state.groupsGoneForTags) return { rows: [] };
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
    tagNames,
    groupTags,
    state,
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
    expect(recordsOf(await client.listStoryGroups('2001'))).toEqual([
      { id: '3001', name: 'A', sortOrder: 2 },
      { id: '3002', name: 'B', sortOrder: 1 },
    ]);
    expect(recordsOf(await client.listStories('3001'))).toEqual([
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
      { tokenKey: key, storylyApiUrl: 'http://fake', storage: noStorage, fetch },
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
      { tokenKey: key, storylyApiUrl: 'http://fake', storage: noStorage, fetch: vi.fn(async () => json(500, {})) },
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
    record: { sourceId, name: null, within: null, withinSourceId: null, position },
    kind,
    field,
    sourceField: null,
  });
  const entry = <T>(record: T | null, differences: ImportDifference[] = [], omitted = 0) => ({
    record,
    differences,
    omitted,
  });

  it('lists differences in reading order, unreadable records in place, with the record each belongs to', async () => {
    const fake = contentDb();
    const instances = {
      entries: [
        entry({ id: '2001', name: 'Home page' }, [diff('zone', '2001', 'notHeld', 'token')]),
        entry(null, [diff('zone', null, 'invalidRecord', null, 2)]),
      ],
    };
    const content: ContentSource = {
      listStoryGroups: async () => ({
        entries: [
          // Read first, created second: listed in the order read.
          entry({ id: 'g2', name: 'Later', sortOrder: 5 }, [diff('taleGroup', 'g2', 'unexpected', 'theme')]),
          entry(null, [diff('taleGroup', null, 'invalidRecord', null, 2)]),
          entry({ id: 'g1', name: 'Summer', sortOrder: 0 }, [diff('taleGroup', 'g1', 'notHeld', 'pinned', 3)]),
        ],
      }),
      listStories: async (groupId) =>
        groupId === 'g1'
          ? {
              entries: [
                entry({ id: 's1', name: 'A', sortOrder: 1 }, [diff('tale', 's1', 'notHeld', 'deep_link')]),
                entry(null, [diff('tale', null, 'invalidRecord', null, 2)]),
                // Listed twice at the source: skipped the second time, its differences listed once.
                entry({ id: 's1', name: 'A', sortOrder: 0 }, [diff('tale', 's1', 'notHeld', 'deep_link', 3)]),
              ],
            }
          : [],
    };
    const report = await importContent(fake.db, projectId, instances, content, undefined, {
      app: entry(null, [diff('app', '1001', 'notHeld', 'settings')]),
    });
    expect(report.zones).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(report.taleGroups).toEqual({ source: 3, imported: 2, skipped: 1 });
    expect(report.tales).toEqual({ source: 3, imported: 1, skipped: 2 });
    expect(report.differences?.map((d) => [d.entity, d.kind, d.field, d.record.within, d.record.withinSourceId])).toEqual([
      ['app', 'notHeld', 'settings', null, null],
      ['zone', 'notHeld', 'token', null, null],
      ['zone', 'invalidRecord', null, null, null],
      ['taleGroup', 'unexpected', 'theme', 'Home page', '2001'],
      ['taleGroup', 'invalidRecord', null, 'Home page', '2001'],
      ['taleGroup', 'notHeld', 'pinned', 'Home page', '2001'],
      ['tale', 'notHeld', 'deep_link', 'Summer', 'g1'],
      ['tale', 'invalidRecord', null, 'Summer', 'g1'],
    ]);
    expect(report.notImportedByDesign).toEqual(['Conversion records', 'Stats']);
    expect(report.differencesOmitted).toBeUndefined();
  });

  it('lists the differences of the stories of a skipped group', async () => {
    const fake = contentDb();
    const content: ContentSource = {
      listStoryGroups: async () => [{ id: 'g1', name: 'Summer', sortOrder: 0 }],
      listStories: async () => ({
        entries: [entry({ id: 's1', name: 'A', sortOrder: 0 }, [diff('tale', 's1', 'notHeld', 'outlink')])],
      }),
    };
    await importContent(fake.db, projectId, [{ id: '2001', name: 'Home page' }], content);
    // The zone is gone now: the group and its story are skipped, their differences still listed.
    fake.zones.clear();
    const report = await importContent(fake.db, projectId, [{ id: '2001', name: 'Home page' }], content);
    expect(report.tales).toEqual({ source: 1, imported: 0, skipped: 1 });
    expect(report.differences?.map((d) => d.field)).toEqual(['outlink']);
  });

  it(`stores at most ${MAX_IMPORT_REPORT_DIFFERENCES} differences and counts the rest, the per-record omitted ones too`, async () => {
    const fake = contentDb();
    const many = Array.from({ length: MAX_IMPORT_REPORT_DIFFERENCES + 7 }, (_, i) =>
      diff('zone', '2001', 'unexpected', `f${i}`),
    );
    const report = await importContent(
      fake.db,
      projectId,
      { entries: [entry({ id: '2001', name: 'Home page' }, many, 40)] },
      noContent,
    );
    expect(report.differences).toHaveLength(MAX_IMPORT_REPORT_DIFFERENCES);
    expect(report.differencesOmitted).toBe(47);
  });

  it('bounds and redacts the parent names it copies into differences and notes', async () => {
    const fake = contentDb();
    const huge = `${'H'.repeat(1_000_000)}${TOKEN}`;
    const content: ContentSource = {
      listStoryGroups: async () => ({
        entries: [entry({ id: 'g1', name: 'Summer', sortOrder: null }, [diff('taleGroup', 'g1', 'unexpected', 'theme')])],
      }),
      listStories: async () => [],
    };
    const report = await importContent(fake.db, projectId, [{ id: `2001${TOKEN}`, name: huge }], content, undefined, {
      text: (value) => storedText(value, TOKEN),
    });
    const [difference] = report.differences ?? [];
    expect(difference.record.within?.length).toBeLessThanOrEqual(REPORT_TEXT_LIMIT);
    expect(difference.record.withinSourceId).toBe('2001[token]');
    for (const note of report.notes) expect(note.length).toBeLessThan(REPORT_TEXT_LIMIT + 100);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it('gives back the budget a repeated record drew, so the report fills with listed differences', async () => {
    const fake = contentDb();
    const budget = { remaining: 10 };
    const twice = [diff('zone', '2001', 'notHeld', 'token')];
    await importContent(
      fake.db,
      projectId,
      { entries: [entry({ id: '2001', name: 'Home' }, twice), entry({ id: '2001', name: 'Home' }, twice)] },
      noContent,
      undefined,
      { budget },
    );
    expect(budget.remaining).toBe(11);
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

describe('runImportJob: stored text', () => {
  const key = randomBytes(32);

  it("stores the app's name with the token removed, then cut, and no token in the report", async () => {
    const { db, query } = fakeDb();
    const appName = `${'n'.repeat(REPORT_TEXT_LIMIT - 5)}${TOKEN}`;
    const fetch = vi.fn(async (url: URL) =>
      url.pathname.endsWith('/app')
        ? json(200, { data: [{ id: 1001, title: appName, [`x${TOKEN}`]: 1 }] })
        : json(200, { data: [] }),
    );
    await runImportJob(
      db,
      { id: jobId, projectId, sourceAppId: '1001', tokenCiphertext: encryptToken(TOKEN, key), lockedBy: 'w1' },
      {
        tokenKey: key,
        storylyApiUrl: 'http://fake',
        storage: noStorage,
        fetch: fetch as unknown as typeof globalThis.fetch,
      },
    );
    const named = query.mock.calls.find((c) => /SET source_app_name/.test(c[0] as string));
    const stored = (named?.[1] as string[])[2];
    expect(stored).toBe(storedText(appName, TOKEN));
    expect(stored).not.toContain(TOKEN.slice(0, 6));
    const done = query.mock.calls.find((c) => /SET status = 'done'/.test(c[0] as string));
    const report = JSON.stringify(done?.[1]);
    expect(report).toContain('[token]');
    expect(report).not.toContain(TOKEN);
  });
});

describe('importContent: labels as tags', () => {
  const home = [{ id: '2001', name: 'Home page' }];
  type Group = Rec & { segments?: unknown };
  const labelSource = (groups: Group[], stories: Record<string, Rec[]> = {}): ContentSource => ({
    listStoryGroups: async () => groups,
    listStories: async (groupId) => stories[groupId] ?? [],
  });
  const list = (...labels: unknown[]) => async () => ({
    entries: labels.map((label, index) => ({
      record:
        typeof label === 'string'
          ? { id: null, text: label, reported: false }
          : { id: String(index), text: null, reported: true },
      differences: [],
      omitted: 0,
    })),
  });
  // The tag names each tale group carries, by group name.
  const tagsOf = (fake: ReturnType<typeof contentDb>) =>
    Object.fromEntries(
      [...fake.groups].map(([id, g]) => [
        g.name,
        [...(fake.groupTags.get(id) ?? [])].map((tagId) => fake.tagNames.get(tagId.slice('tag-'.length))),
      ]),
    );

  it('makes each label a tag of the project and adds the group labels to their tale groups', async () => {
    const fake = contentDb();
    const groups: Group[] = [
      { id: 'g1', name: 'Summer', sortOrder: 0, segments: ['summer', 'vip'] },
      { id: 'g2', name: 'New', sortOrder: 1, segments: '["new"]' },
      { id: 'g3', name: 'Plain', sortOrder: 2, segments: null },
    ];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: list('summer', 'returning'),
    });
    // Per occurrence: two in the list, three on the groups.
    expect(report.tags).toEqual({ source: 5, imported: 5, skipped: 0 });
    expect([...fake.tagNames.values()]).toEqual(['summer', 'returning', 'vip', 'new']);
    expect(tagsOf(fake)).toEqual({ Summer: ['summer', 'vip'], New: ['new'], Plain: [] });
    expect(report.differences).toEqual([]);
    expect(report.notes).toContain('Tags: whether labels combine with AND or OR is not imported');
  });

  it('has no tag count, and reads no labels, without the labels option', async () => {
    const fake = contentDb();
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: ['summer'] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups));
    expect(report.tags).toBeUndefined();
    expect(fake.tagNames.size).toBe(0);
  });

  it('counts labels differing only in case once each, imports them as one tag, and notes it', async () => {
    const fake = contentDb();
    const many = ['Sale', 'sale', 'SALE', 'sAle', 'saLe', 'salE', 'SAle'];
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: [...many, ' sale '] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, { labels: list() });
    expect(report.tags).toEqual({ source: 8, imported: 8, skipped: 0 });
    expect([...fake.tagNames.values()]).toEqual(['Sale']);
    expect(report.notes).toContain(
      'Tag "Sale": labels "Sale", "sale", "SALE", "sAle", "saLe", 2 more became one tag, since tag names ignore case',
    );
  });

  it('skips a blank, too long or non-text label with a difference, and segments of the wrong type', async () => {
    const fake = contentDb();
    const long = 'x'.repeat(41);
    const groups: Group[] = [
      { id: 'g1', name: 'Odd', sortOrder: 0, segments: ['', long, 7, { title: 'From title' }, { other: 1 }] },
      { id: 'g2', name: 'Bad', sortOrder: 1, segments: { include: ['a'] } },
      { id: 'g3', name: 'Broken JSON', sortOrder: 2, segments: '[not json' },
    ];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: list('  '),
    });
    // Each skipped label is one difference.
    expect(report.tags).toEqual({ source: 6, imported: 1, skipped: 5 });
    expect(tagsOf(fake)).toEqual({ Odd: ['From title'], Bad: [], 'Broken JSON': [] });
    const parent = { within: 'Odd', withinSourceId: 'g1' };
    const tag = (position: number, name: string | null, reason: string, field = 'segments', at = parent) => ({
      entity: 'tag',
      record: { sourceId: null, name, ...at, position },
      kind: 'tagNotImported',
      field,
      sourceField: null,
      reason,
    });
    const group = (sourceId: string, name: string, position: number) => ({
      entity: 'taleGroup',
      record: { sourceId, name, within: 'Home page', withinSourceId: '2001', position },
      kind: 'wrongType',
      field: 'segments',
      sourceField: null,
    });
    expect(report.differences).toEqual([
      tag(1, null, 'blank', 'name', { within: null, withinSourceId: null } as never),
      tag(1, null, 'blank'),
      tag(2, long, 'tooLong'),
      tag(3, null, 'notText'),
      tag(5, null, 'notText'),
      group('g2', 'Bad', 2),
      group('g3', 'Broken JSON', 3),
    ]);
  });

  it('notes a labels list that cannot be read and goes on with the groups, but fails on other errors', async () => {
    const fake = contentDb();
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: ['summer'] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: async () => {
        throw new StorylyUnavailableError('Storyly answered 404 when listing labels');
      },
    });
    expect(report.tags).toEqual({ source: 1, imported: 1, skipped: 0 });
    expect(report.notes).toContain(
      'Tags: the labels list could not be read (Storyly answered 404 when listing labels), ' +
        'so tags come from story groups only',
    );
    const refused = await importContent(contentDb().db, projectId, home, labelSource(groups), undefined, {
      labels: async () => {
        throw new StorylyTokenInvalidError();
      },
    });
    expect(refused.notes.some((note) => note.startsWith('Tags: the labels list could not be read'))).toBe(true);
    await expect(
      importContent(contentDb().db, projectId, home, labelSource(groups), undefined, {
        labels: async () => {
          throw new Error('database down');
        },
      }),
    ).rejects.toThrow('database down');
  });

  it('notes a tale group deleted before its tags are added, and still counts its labels', async () => {
    const fake = contentDb();
    fake.state.groupsGoneForTags = true;
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: ['summer'] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, { labels: list() });
    expect(report.tags).toEqual({ source: 1, imported: 1, skipped: 0 });
    expect(report.notes).toContain('Tale group "Summer": it was deleted during the import, so its tags were not added');
    expect(fake.groupTags.size).toBe(0);
  });

  it("reads a repeated group's labels once", async () => {
    const fake = contentDb();
    const groups: Group[] = [
      { id: 'g1', name: 'Summer', sortOrder: 0, segments: ['', 'summer'] },
      { id: 'g1', name: 'Summer', sortOrder: 1, segments: ['', 'summer'] },
    ];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: list(),
    });
    expect(report.tags).toEqual({ source: 2, imported: 1, skipped: 1 });
    expect(report.differences?.filter((d) => d.kind === 'tagNotImported')).toHaveLength(1);
    expect([...fake.tagNames.values()]).toEqual(['summer']);
  });

  it('removes the token from the labels it quotes', async () => {
    const fake = contentDb();
    const label = `${TOKEN} ${'x'.repeat(40)}`;
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: [label, 'a', 'A'] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: list(),
      text: (value) => storedText(value, TOKEN),
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain(`[token] ${'x'.repeat(40)}`);
  });
});

describe('StorylyClient: labels', () => {
  it('reads the labels list of an app: records checked as tags, bare strings as they are', async () => {
    const fetch = vi.fn(async () =>
      json(200, {
        data: ['Loyal', { id: 5, name: 'vip', app_id: 1 }, { id: 6, title: 'Renamed' }, { name: 'No id' }, 7],
      }),
    );
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch });
    const labels = await client.listLabels('1001');
    expect(String((fetch.mock.calls[0] as unknown as [URL])[0])).toBe('http://fake/segment?app_id=1001');
    expect(labels.beyond).toBe(0);
    expect(labels.entries.map((e) => e.record)).toEqual([
      { id: null, text: 'Loyal', reported: false },
      { id: '5', text: 'vip', reported: false },
      { id: '6', text: 'Renamed', reported: false },
      // No usable id: listed as invalid, but its label still counts.
      { id: null, text: 'No id', reported: true },
      null,
    ]);
    expect(labels.entries[2].differences.map((d) => [d.entity, d.kind, d.field, d.sourceField])).toEqual([
      ['tag', 'renamed', 'name', 'title'],
    ]);
    expect(labels.entries[3].differences.map((d) => d.kind)).toEqual(['invalidRecord']);
    expect(labels.entries[4].differences.map((d) => d.kind)).toEqual(['invalidRecord']);
  });

  it('reports a label record whose name is not text', async () => {
    const fetch = vi.fn(async () => json(200, [{ id: 1, name: 42 }]));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch });
    const [entry] = (await client.listLabels('1')).entries;
    expect(entry.record).toEqual({ id: '1', text: null, reported: true });
    expect(entry.differences.map((d) => [d.kind, d.field])).toEqual([['wrongType', 'name']]);
  });

  it(`checks at most ${MAX_LABEL_LIST_ENTRIES} labels and counts the rest`, async () => {
    const all = Array.from({ length: MAX_LABEL_LIST_ENTRIES + 3 }, (_, i) => `label ${i}`);
    const fetch = vi.fn(async () => json(200, all));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch });
    const labels = await client.listLabels('1');
    expect(labels.entries).toHaveLength(MAX_LABEL_LIST_ENTRIES);
    expect(labels.beyond).toBe(3);
  });

  it("carries a story group's segments value unchecked", async () => {
    const fetch = vi.fn(async () => json(200, [{ id: 1, title: 'G', sort_order: 0, status: 1, segments: ['a'] }]));
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch });
    expect((await client.listStoryGroups('2')).entries[0].record).toMatchObject({ segments: ['a'] });
  });
});

describe('StorylyClient: response size', () => {
  const limitMb = MAX_STORYLY_RESPONSE_BYTES / (1024 * 1024);

  it('refuses a response that declares more than the limit, before reading it', async () => {
    const res = new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_STORYLY_RESPONSE_BYTES + 1) },
    });
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: vi.fn(async () => res) });
    await expect(client.listApps()).rejects.toThrow(`Storyly's apps response is larger than ${limitMb} MB`);
  });

  it('stops reading a response that grows past the limit', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const res = new Response(body, { status: 200 });
    const client = new StorylyClient({ baseUrl: 'http://fake', token: TOKEN, fetch: vi.fn(async () => res) });
    const err = await client.listInstances('1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorylyUnavailableError);
    expect((err as Error).message).toBe(`Storyly's instances response is larger than ${limitMb} MB`);
    expect(pulled).toBeLessThanOrEqual(limitMb + 3);
  });
});

describe('importContent: label limits and errors (review fixes)', () => {
  const home = [{ id: '2001', name: 'Home page' }];
  type Group = Rec & { segments?: unknown };
  const labelSource = (groups: Group[]): ContentSource => ({
    listStoryGroups: async () => groups,
    listStories: async () => [],
  });
  const labelList = (records: (SourceLabel | null)[], beyond = 0) => async () => ({
    entries: records.map((record) => ({ record, differences: [], omitted: 0 })),
    beyond,
  });
  const noList = labelList([]);
  const tagDifferences = (report: ImportReport) => (report.differences ?? []).filter((d) => d.entity === 'tag');

  it(`lists at most ${MAX_DIFFERENCES_PER_RECORD} label differences per group and counts the rest`, async () => {
    const fake = contentDb();
    const bad = Array.from({ length: 3000 }, () => '');
    const groups: Group[] = [
      { id: 'g1', name: 'Many', sortOrder: 0, segments: [...bad.slice(0, MAX_GROUP_LABELS), 'ok'] },
      { id: 'g2', name: 'Few', sortOrder: 1, segments: ['', 'fine'] },
    ];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, { labels: noList });
    const many = tagDifferences(report).filter((d) => d.record.withinSourceId === 'g1');
    expect(many).toHaveLength(MAX_DIFFERENCES_PER_RECORD);
    expect(tagDifferences(report).filter((d) => d.record.withinSourceId === 'g2')).toHaveLength(1);
    expect(report.differencesOmitted).toBe(MAX_GROUP_LABELS - MAX_DIFFERENCES_PER_RECORD);
    // 'ok' is past the first 500 values: counted, not read.
    expect(report.tags).toEqual({ source: MAX_GROUP_LABELS + 3, imported: 1, skipped: MAX_GROUP_LABELS + 2 });
    expect(report.notes).toContain(`Tale group "Many": 1 label(s) past the first ${MAX_GROUP_LABELS} were not read`);
    expect(fake.tagNames.has('ok')).toBe(false);
  });

  it('skips a label holding a control character, NUL included, without failing the job', async () => {
    const fake = contentDb();
    const groups: Group[] = [{ id: 'g1', name: 'Odd', sortOrder: 0, segments: ['a\u0000b', 'tab\there', 'fine'] }];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: labelList([{ id: '9', text: 'nul\u0000', reported: false }]),
    });
    expect(report.tags).toEqual({ source: 4, imported: 1, skipped: 3 });
    expect(tagDifferences(report).map((d) => d.reason)).toEqual([
      'invalidCharacters',
      'invalidCharacters',
      'invalidCharacters',
    ]);
    expect([...fake.tagNames.values()]).toEqual(['fine']);
  });

  it("notes labels the database refuses for their text, and fails only on other database errors", async () => {
    const refusing = (code: string) => {
      const fake = contentDb();
      const query = fake.db.query as unknown as ReturnType<typeof vi.fn>;
      const answer = query.getMockImplementation() as (sql: string, params?: unknown[]) => Promise<unknown>;
      query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (/INSERT INTO tags /.test(sql)) throw Object.assign(new Error('refused'), { code });
        return answer(sql, params);
      });
      return fake;
    };
    const groups: Group[] = [{ id: 'g1', name: 'Summer', sortOrder: 0, segments: ['summer'] }];
    const fake = refusing('22021');
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, {
      labels: labelList([{ id: '1', text: 'listed', reported: false }]),
    });
    expect(report.tags).toEqual({ source: 2, imported: 0, skipped: 2 });
    expect(report.notes).toEqual(
      expect.arrayContaining([
        'Tags: labels could not be saved as tags, so they were not imported',
        'Story groups of zone "Home page": labels could not be saved as tags, so they were not imported',
        'Tale group "Summer": its labels could not be saved as tags, so none were added',
      ]),
    );
    await expect(
      importContent(refusing('57P01').db, projectId, home, labelSource(groups), undefined, { labels: noList }),
    ).rejects.toMatchObject({ code: '57P01' });
  });

  it('counts per occurrence: an id-less record with a usable name is imported, a repeated record skipped', async () => {
    const fake = contentDb();
    const report = await importContent(fake.db, projectId, home, labelSource([]), undefined, {
      labels: async () => ({
        entries: [
          { record: { id: '1', text: 'vip', reported: false }, differences: [], omitted: 0 },
          { record: { id: null, text: 'No id', reported: true }, differences: [], omitted: 0 },
          { record: { id: '1', text: 'vip', reported: false }, differences: [], omitted: 0 },
          { record: { id: null, text: null, reported: true }, differences: [], omitted: 0 },
        ],
        beyond: 2,
      }),
    });
    expect(report.tags).toEqual({ source: 6, imported: 2, skipped: 4 });
    expect([...fake.tagNames.values()]).toEqual(['vip', 'No id']);
    expect(report.notes).toEqual(
      expect.arrayContaining([
        'Tags: 1 repeated label record(s) of the labels list were skipped',
        `Tags: 2 label(s) past the first ${MAX_LABEL_LIST_ENTRIES} of the labels list were not read`,
      ]),
    );
    // A label record's own difference is listed once, by id, like every other list.
    const listed: ImportDifference = {
      entity: 'tag',
      record: { sourceId: '1', name: 'vip', within: null, withinSourceId: null, position: 1 },
      kind: 'unexpected',
      field: 'extra',
      sourceField: null,
    };
    const twice = await importContent(contentDb().db, projectId, home, labelSource([]), undefined, {
      labels: async () => ({
        entries: [1, 2].map(() => ({
          record: { id: '1', text: 'vip', reported: false },
          differences: [listed],
          omitted: 0,
        })),
        beyond: 0,
      }),
    });
    expect(twice.differences).toEqual([listed]);
  });

  it(`adds at most ${MAX_GROUP_TAGS} tags to a group and makes at most ${MAX_IMPORT_TAGS} per import`, async () => {
    const fake = contentDb();
    const names = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);
    const groups: Group[] = [
      { id: 'g0', name: 'Wide', sortOrder: 0, segments: names('w', MAX_GROUP_TAGS + 2) },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `g${i + 1}`,
        name: `G${i + 1}`,
        sortOrder: i + 1,
        segments: names(`g${i}-`, 100),
      })),
    ];
    const report = await importContent(fake.db, projectId, home, labelSource(groups), undefined, { labels: noList });
    expect(report.notes).toContain(
      `Tale group "Wide": 2 label(s) past its first ${MAX_GROUP_TAGS} tags were not imported`,
    );
    expect(fake.tagNames.size).toBe(MAX_IMPORT_TAGS);
    // 100 from Wide, then 900 of the 1,000 others; the last 100 are refused.
    expect(report.tags).toEqual({ source: 1102, imported: 1000, skipped: 102 });
    expect(report.notes).toContain(
      'Tags: 100 label(s) with 100 more name(s) were not imported, ' +
        `since one import makes at most ${MAX_IMPORT_TAGS} tags`,
    );
  });

  it(`writes at most ${MAX_MERGE_NOTES} merge notes and counts the rest in one`, async () => {
    const fake = contentDb();
    const pairs = Array.from({ length: MAX_MERGE_NOTES + 2 }, (_, i) => [`m${i}`, `M${i}`]).flat();
    const groups: Group[] = [{ id: 'g1', name: 'Pairs', sortOrder: 0, segments: pairs.slice(0, MAX_GROUP_TAGS) }];
    const more: Group = { id: 'g2', name: 'More', sortOrder: 1, segments: pairs.slice(MAX_GROUP_TAGS) };
    const report = await importContent(fake.db, projectId, home, labelSource([...groups, more]), undefined, {
      labels: noList,
    });
    expect(report.notes.filter((n) => n.includes('became one tag'))).toHaveLength(MAX_MERGE_NOTES);
    expect(report.notes).toContain('Tags: 2 more tag(s) each carry labels that differ only in case');
  });
});
