import { randomBytes } from 'node:crypto';
import type { ImportDifference } from '@taleart/contract';
import type { TransactionalDb } from '@taleart/server-access';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { claimNextJob, createImportJob, progressOf } from './jobs';
import { migrateImporter } from './migration';
import { previewApp, signSelectionKey, verifySelectionKey, type PreviewSource } from './preview';
import { StorylyClient, type CheckedList } from './storyly-client';
import { importContent, type ContentSource } from './worker';

const TOKEN = 'secret-token-value';
const projectId = '00000000-0000-4000-8000-000000000002';

const listOf = <T>(...records: (T | null)[]): CheckedList<T> => ({
  entries: records.map((record) => ({ record, differences: [], omitted: 0 })),
});

// A source with `instances` instances, each with `groups` groups of `stories` stories; it records each read.
function fakeSource(instances: number, groups = 2, stories = 3) {
  const reads: string[] = [];
  const source: PreviewSource = {
    listApps: async () => listOf({ id: '1001', name: 'Demo shop' }),
    listInstances: async () =>
      listOf(...Array.from({ length: instances }, (_, i) => ({ id: `i${i + 1}`, name: `Zone ${i + 1}` }))),
    listStoryGroups: async (instanceId) => {
      reads.push(`groups:${instanceId}`);
      return listOf(
        ...Array.from({ length: groups }, (_, g) => ({ id: `${instanceId}-g${g + 1}`, name: 'G', sortOrder: g })),
      );
    },
    listStories: async (groupId) => {
      reads.push(`stories:${groupId}`);
      return listOf(
        ...Array.from({ length: stories }, (_, s) => ({ id: `${groupId}-s${s}`, name: 'S', sortOrder: s })),
      );
    },
  };
  return { source, reads };
}

describe('previewApp', () => {
  it("lists the app's zones with their group and story counts", async () => {
    const { source } = fakeSource(2);
    expect(await previewApp(source, '1001', TOKEN)).toEqual({
      appId: '1001',
      appName: 'Demo shop',
      zones: [
        { id: 'i1', name: 'Zone 1', taleGroups: 2, tales: 6 },
        { id: 'i2', name: 'Zone 2', taleGroups: 2, tales: 6 },
      ],
      zonesBeyond: 0,
      countsComplete: true,
    });
  });

  it('answers null for an app the token cannot read', async () => {
    expect(await previewApp(fakeSource(1).source, '9999', TOKEN)).toBeNull();
  });

  it('lists at most maxZones zones and counts the rest', async () => {
    const { source, reads } = fakeSource(5, 0);
    const preview = await previewApp(source, '1001', TOKEN, { maxZones: 3 });
    expect(preview?.zones.map((z) => z.id)).toEqual(['i1', 'i2', 'i3']);
    expect(preview?.zonesBeyond).toBe(2);
    expect(reads).toEqual(['groups:i1', 'groups:i2', 'groups:i3']);
  });

  it('reads at most maxCountRequests lists; zones not counted get null counts', async () => {
    const { source, reads } = fakeSource(3, 2, 1);
    // i1: 1 group list + 2 story lists; i2: its group list, then one story list.
    const preview = await previewApp(source, '1001', TOKEN, { maxCountRequests: 5 });
    expect(reads).toHaveLength(5);
    expect(preview?.zones).toEqual([
      { id: 'i1', name: 'Zone 1', taleGroups: 2, tales: 2 },
      { id: 'i2', name: 'Zone 2', taleGroups: 2, tales: null },
      { id: 'i3', name: 'Zone 3', taleGroups: null, tales: null },
    ]);
    expect(preview?.countsComplete).toBe(false);
  });

  it('stops counting at the deadline', async () => {
    const { source, reads } = fakeSource(3, 1, 1);
    let clock = 0;
    const slow: PreviewSource = {
      ...source,
      listStoryGroups: async (id) => {
        clock += 600;
        return source.listStoryGroups(id);
      },
    };
    const preview = await previewApp(slow, '1001', TOKEN, { countDeadlineMs: 1000, now: () => clock });
    // i1 counted (600 ms), i2's groups read at 600 (now 1200), its stories past the deadline; i3 not read.
    expect(preview?.zones.map((z) => [z.taleGroups, z.tales])).toEqual([
      [1, 1],
      [1, null],
      [null, null],
    ]);
    expect(reads).toEqual(['groups:i1', 'stories:i1-g1', 'groups:i2']);
    expect(preview?.countsComplete).toBe(false);
  });

  it('leaves the counts of a zone whose list fails unknown, and fails on a refused token', async () => {
    const { source } = fakeSource(2, 1, 1);
    const failing: PreviewSource = {
      ...source,
      listStoryGroups: async (id) => {
        if (id === 'i1') throw new StorylyUnavailableError('Storyly answered 500 when listing story groups');
        return source.listStoryGroups(id);
      },
    };
    const preview = await previewApp(failing, '1001', TOKEN);
    expect(preview?.zones.map((z) => [z.taleGroups, z.tales])).toEqual([
      [null, null],
      [1, 1],
    ]);
    expect(preview?.countsComplete).toBe(false);

    const refused: PreviewSource = {
      ...source,
      listStoryGroups: async () => {
        throw new StorylyTokenInvalidError();
      },
    };
    await expect(previewApp(refused, '1001', TOKEN)).rejects.toBeInstanceOf(StorylyTokenInvalidError);
  });

  it('lists each instance once, skips unreadable ones, and removes the token from names', async () => {
    const source: PreviewSource = {
      ...fakeSource(0).source,
      listApps: async () => listOf({ id: '1001', name: `App ${TOKEN}` }),
      listInstances: async () =>
        listOf({ id: 'i1', name: `Zone ${TOKEN}` }, null, { id: 'i1', name: 'Again' }, { id: 'i2', name: ' ' }),
      listStoryGroups: async () => listOf(),
    };
    const preview = await previewApp(source, '1001', TOKEN);
    expect(preview?.appName).toBe('App [token]');
    expect(preview?.zones).toEqual([
      { id: 'i1', name: 'Zone [token]', taleGroups: 0, tales: 0 },
      { id: 'i2', name: 'Instance i2', taleGroups: 0, tales: 0 },
    ]);
    expect(JSON.stringify(preview)).not.toContain(TOKEN);
  });
});

describe('selection key', () => {
  const key = randomBytes(32);
  const scope = { projectId, appId: '1001', userId: 'u1' };
  const later = Date.now() + 60_000;

  it('names the zones it was signed for, and holds no token key', () => {
    const signed = signSelectionKey(key, scope, ['i1', 'i2'], later);
    expect(verifySelectionKey(key, signed, scope)).toEqual(new Set(['i1', 'i2']));
    expect(signed).not.toContain(key.toString('base64url'));
  });

  it('refuses another key, a changed payload, another scope and an expired key', () => {
    const signed = signSelectionKey(key, scope, ['i1'], later);
    expect(verifySelectionKey(randomBytes(32), signed, scope)).toBeNull();
    const [version, , mac] = signed.split('.');
    const forged = Buffer.from(
      JSON.stringify({ p: projectId, a: '1001', u: 'u1', z: ['i1', 'i9'], e: later }),
    ).toString('base64url');
    expect(verifySelectionKey(key, `${version}.${forged}.${mac}`, scope)).toBeNull();
    expect(verifySelectionKey(key, signed, { ...scope, projectId: 'other' })).toBeNull();
    expect(verifySelectionKey(key, signed, { ...scope, appId: '1002' })).toBeNull();
    expect(verifySelectionKey(key, signed, { ...scope, userId: 'u2' })).toBeNull();
    expect(verifySelectionKey(key, signed, scope, later + 1)).toBeNull();
    expect(verifySelectionKey(key, 'not-a-key', scope)).toBeNull();
    expect(verifySelectionKey(key, `${signed}x`, scope)).toBeNull();
  });
});

// A fake pool for zone imports: links are found for nothing, every zone is created.
function zonesDb() {
  let next = 0;
  const created: string[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (/INSERT INTO zones/.test(sql)) {
      created.push(params[0] as string);
      return {
        rows: [{ id: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`, name: params[0], projectId }],
      };
    }
    if (/FROM projects/.test(sql)) return { rows: [{}], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as TransactionalDb;
  return { db, created };
}

describe('importContent: selection', () => {
  const instances = [
    { id: '2001', name: 'Home page' },
    { id: '2002', name: 'Product page' },
    { id: '2003', name: 'Checkout' },
  ];
  const reading = () => {
    const reads: string[] = [];
    const source: ContentSource = {
      listStoryGroups: async (id) => {
        reads.push(id);
        return [];
      },
      listStories: async () => [],
    };
    return { source, reads };
  };

  it('imports only the picked zones and lists the others as not selected, skipped', async () => {
    const { db, created } = zonesDb();
    const { source, reads } = reading();
    const report = await importContent(db, projectId, instances, source, undefined, {
      selection: { zones: ['2001', '2002'], taleGroups: true, media: true, tags: false },
    });
    expect(created).toEqual(['Home page', 'Product page']);
    expect(reads).toEqual(['2001', '2002']);
    expect(report.zones).toEqual({ source: 3, imported: 2, skipped: 1, notSelected: 1 });
    expect(report.notSelected).toEqual({ zones: [{ sourceId: '2003', name: 'Checkout' }], entities: ['tags'] });
    expect(report.notes).not.toContain('Zone "Checkout": frame type unknown');
  });

  it('reads no story group with tale groups not picked, and the report has no tale counts', async () => {
    const { db, created } = zonesDb();
    const { source, reads } = reading();
    const report = await importContent(db, projectId, instances, source, undefined, {
      selection: { zones: ['2001', '2002', '2003'], taleGroups: false, media: false, tags: false },
    });
    expect(created).toHaveLength(3);
    expect(reads).toEqual([]);
    expect(report.taleGroups).toBeUndefined();
    expect(report.tales).toBeUndefined();
    expect(report.zones).toEqual({ source: 3, imported: 3, skipped: 0 });
    expect(report.notSelected).toEqual({ zones: [], entities: ['taleGroups', 'media', 'tags'] });
  });

  it('has no notSelected when everything was picked, and notes a picked zone gone from the app', async () => {
    const { db } = zonesDb();
    const report = await importContent(db, projectId, instances, reading().source, undefined, {
      selection: { zones: ['2001', '2002', '2003', '2009'], taleGroups: true, media: true, tags: true },
    });
    expect(report.notSelected).toBeUndefined();
    expect(report.notes).toContain('Zones: 1 picked zone(s) are no longer in the app, so they were not imported');
  });

  it('does not list the differences of a zone not picked, and gives back their budget', async () => {
    const { db } = zonesDb();
    const difference = (sourceId: string): ImportDifference => ({
      entity: 'zone',
      record: { sourceId, name: null, within: null, withinSourceId: null, position: 1 },
      kind: 'notHeld',
      field: 'token',
      sourceField: null,
    });
    const budget = { remaining: 10 };
    const checked: CheckedList<{ id: string; name: string }> = {
      entries: [
        { record: instances[0], differences: [difference('2001')], omitted: 0 },
        { record: instances[2], differences: [difference('2003')], omitted: 0 },
      ],
    };
    const report = await importContent(db, projectId, checked, reading().source, undefined, {
      budget,
      selection: { zones: ['2001'], taleGroups: true, media: false, tags: false },
    });
    expect(report.differences).toEqual([difference('2001')]);
    expect(budget.remaining).toBe(11);
  });

  it('imports everything without a selection, as before', async () => {
    const { db, created } = zonesDb();
    const report = await importContent(db, projectId, instances, reading().source);
    expect(created).toHaveLength(3);
    expect(report.notSelected).toBeUndefined();
    expect(report.zones).toEqual({ source: 3, imported: 3, skipped: 0 });
  });
});

describe('job selection', () => {
  it('stores the selection with the job and reads it back on claim', async () => {
    const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>(
      async () => ({ rows: [{ id: 'j1', status: 'queued', selection: { zones: ['2001'] } }], rowCount: 1 }),
    );
    const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as TransactionalDb;
    const selection = { zones: ['2001'], taleGroups: true, media: false, tags: false };
    await createImportJob(db, { projectId, createdBy: 'u1', sourceAppId: '1001', tokenCiphertext: 'x', selection });
    const insert = query.mock.calls.find((c) => /INSERT INTO import_jobs/.test(c[0]));
    expect(insert?.[1]?.[4]).toBe(JSON.stringify(selection));
    await createImportJob(db, { projectId, createdBy: 'u1', sourceAppId: '1001', tokenCiphertext: 'x' });
    expect(query.mock.calls.filter((c) => /INSERT INTO import_jobs/.test(c[0]))[1]?.[1]?.[4]).toBeNull();
    expect((await claimNextJob(db, 'w1'))?.selection).toEqual({ zones: ['2001'] });
    expect(query.mock.calls.find((c) => /SET status = 'running'/.test(c[0]))?.[0]).toMatch(/selection/);
    await migrateImporter(db);
    expect(query.mock.calls.some((c) => /ADD COLUMN IF NOT EXISTS selection jsonb/.test(c[0]))).toBe(true);
  });
});

// A read that never answers until its signal aborts it, then fails as the client does.
const hang = (signal?: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(new StorylyUnavailableError('Storyly could not be reached')));
  });

describe('previewApp: deadlines and the caller (review fixes)', () => {
  it('aborts an app or instance list in flight at the whole deadline and fails the preview', async () => {
    const { source } = fakeSource(1);
    const signals: (AbortSignal | undefined)[] = [];
    const hangingApps: PreviewSource = {
      ...source,
      listApps: (signal) => {
        signals.push(signal);
        return hang(signal);
      },
    };
    const started = Date.now();
    await expect(previewApp(hangingApps, '1001', TOKEN, { deadlineMs: 100 })).rejects.toThrow(
      'Storyly took too long to answer the apps list',
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signals[0]?.aborted).toBe(true);

    const hangingInstances: PreviewSource = { ...source, listInstances: (_id, signal) => hang(signal) };
    await expect(previewApp(hangingInstances, '1001', TOKEN, { deadlineMs: 100 })).rejects.toThrow(
      'Storyly took too long to answer the instance list',
    );
  });

  it('aborts a count read in flight at the counting deadline and leaves its counts unknown', async () => {
    const { source } = fakeSource(2, 1, 1);
    const signals: (AbortSignal | undefined)[] = [];
    const hanging: PreviewSource = {
      ...source,
      listStoryGroups: (id, signal) => {
        signals.push(signal);
        return id === 'i1' ? hang(signal) : source.listStoryGroups(id);
      },
    };
    const started = Date.now();
    const preview = await previewApp(hanging, '1001', TOKEN, { countDeadlineMs: 100 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signals[0]?.aborted).toBe(true);
    // The counting deadline passed during i1's read, so i2 is not read either.
    expect(preview?.zones.map((z) => [z.taleGroups, z.tales])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(preview?.countsComplete).toBe(false);
  });

  it('keeps counting within the whole deadline when it is shorter than the counting one', async () => {
    const { source } = fakeSource(1, 1, 1);
    const hanging: PreviewSource = { ...source, listStories: (_id, signal) => hang(signal) };
    const preview = await previewApp(hanging, '1001', TOKEN, { deadlineMs: 100, countDeadlineMs: 60_000 });
    expect(preview?.zones).toEqual([{ id: 'i1', name: 'Zone 1', taleGroups: 1, tales: null }]);
  });

  it("aborts the reads in flight when the caller's signal fires", async () => {
    const { source } = fakeSource(1);
    const caller = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const hanging: PreviewSource = {
      ...source,
      listInstances: (_id, signal) => {
        signals.push(signal);
        setTimeout(() => caller.abort(), 10);
        return hang(signal);
      },
    };
    await expect(previewApp(hanging, '1001', TOKEN, {}, caller.signal)).rejects.toBeInstanceOf(StorylyUnavailableError);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("passes the signal to the client's fetch, which stops at it", async () => {
    const fetch = vi.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const client = new StorylyClient({
      baseUrl: 'http://fake',
      token: TOKEN,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const controller = new AbortController();
    const read = client.listStoryGroups('i1', controller.signal);
    controller.abort();
    await expect(read).rejects.toBeInstanceOf(StorylyUnavailableError);
  });
});

describe('selection key: canonical encoding (review fix)', () => {
  const key = randomBytes(32);
  const scope = { projectId, appId: '1001', userId: 'u1' };

  it('refuses a key whose parts are not in canonical base64url', () => {
    const signed = signSelectionKey(key, scope, ['i1'], Date.now() + 60_000);
    const [version, payload, mac] = signed.split('.');
    expect(verifySelectionKey(key, signed, scope)).not.toBeNull();
    // Padding, other alphabets and stray characters decode to the same bytes, but are not the key.
    for (const changed of [
      `${mac}=`,
      `${mac} `,
      mac.replace(/-/g, '+').replace(/_/g, '/') + (/[-_]/.test(mac) ? '' : '+'),
    ]) {
      expect(verifySelectionKey(key, `${version}.${payload}.${changed}`, scope)).toBeNull();
    }
    // A last character whose unused bits differ decodes to the same bytes.
    const last = mac[mac.length - 1];
    const sibling = 'AEIMQUYcgkosw048'.includes(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : null;
    if (sibling)
      expect(verifySelectionKey(key, `${version}.${payload}.${mac.slice(0, -1)}${sibling}`, scope)).toBeNull();
    expect(verifySelectionKey(key, `${version}.${payload}=.${mac}`, scope)).toBeNull();
  });
});

describe('progress of a selection (review fix)', () => {
  it('names the entity types left out, from the selection or the report', () => {
    const report = { zones: { source: 3, imported: 2, skipped: 0 }, notes: [] };
    expect(progressOf(report, ['taleGroups', 'media', 'tags'])).toEqual({
      zones: { read: 3, written: 2 },
      taleGroups: { read: 0, written: 0 },
      tales: { read: 0, written: 0 },
      notSelected: ['taleGroups', 'media', 'tags'],
    });
    expect(progressOf({ ...report, notSelected: { zones: [], entities: ['tags'] } }).notSelected).toEqual(['tags']);
    expect(progressOf(report)).not.toHaveProperty('notSelected');
  });
});
