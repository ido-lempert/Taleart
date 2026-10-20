import {
  createTale,
  createTaleGroup,
  getTaleMedia,
  listTaleGroups,
  OrderMismatchError,
  orderTaleGroups,
  orderTales,
  setTaleMedia,
  taleExists,
  TaleGroupFullError,
  TaleGroupNotFoundError,
  TaleNotFoundError,
  type TransactionalDb,
} from './tales';
import { ZoneNotFoundError } from '@taleart/server-zones';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';

// A fake pool whose connection answers queries in order from `answers`.
function fakeDb(answers: unknown[]) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    return answers.shift() ?? { rows: [] };
  });
  const db = {
    query,
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, release, statements };
}

describe('tale groups', () => {
  it('does not query for a zone id that is not a UUID', async () => {
    const { db, query } = fakeDb([]);
    await expect(listTaleGroups(db, 'nope')).rejects.toBeInstanceOf(ZoneNotFoundError);
    await expect(createTaleGroup(db, { zoneId: 'nope', name: 'A' })).rejects.toBeInstanceOf(
      ZoneNotFoundError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown zone without inserting', async () => {
    const { db, statements } = fakeDb([{ rows: [] }]);
    await expect(createTaleGroup(db, { zoneId, name: 'A' })).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });

  it("copies the zone's project, serializes on the zone and appends after the last position", async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: groupId, zoneId, projectId, name: 'A', position: 0 }] },
    ]);
    const group = await createTaleGroup(db, { zoneId, name: 'A' });
    expect(group.tales).toEqual([]);
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([zoneId]);
    expect(statements().some((s) => /FROM zones/.test(s) && /FOR UPDATE/.test(s))).toBe(false);
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[0]).toMatch(/COALESCE\(MAX\(position\), -1\) \+ 1/);
    expect(insert?.[1]).toEqual([zoneId, projectId, 'A']);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('tales', () => {
  it('does not query for a tale group id that is not a UUID', async () => {
    const { db, query } = fakeDb([]);
    await expect(createTale(db, { taleGroupId: 'nope', title: 'T' })).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown tale group and rolls back', async () => {
    const { db, statements, release } = fakeDb([{ rows: [] }]);
    await expect(createTale(db, { taleGroupId: groupId, title: 'T' })).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    expect(statements()).toContain('ROLLBACK');
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses a group that already holds 100 tales', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ count: 100, next: 100 }] },
    ]);
    await expect(createTale(db, { taleGroupId: groupId, title: 'T' })).rejects.toBeInstanceOf(
      TaleGroupFullError,
    );
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });

  it("copies the group's project and takes the next position", async () => {
    const { db, query } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ count: 2, next: 2 }] },
      { rows: [{ id: 't1', mediaContentType: null }] },
    ]);
    const tale = await createTale(db, { taleGroupId: groupId, title: 'T' });
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[1]).toEqual([groupId, projectId, 'T', 2]);
    expect(tale).toEqual({ id: 't1', media: null });
  });
});

describe('tale media', () => {
  const taleId = '00000000-0000-4000-8000-000000000004';
  const row = { id: taleId, taleGroupId: groupId, projectId, title: 'T', position: 0 };

  it('lists tales with media derived from the content type, never exposing the key', async () => {
    const { db } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ id: groupId, zoneId, projectId, name: 'A', position: 0 }] },
      {
        rows: [
          { ...row, mediaContentType: 'video/mp4' },
          { ...row, id: 't2', mediaContentType: null },
        ],
      },
    ]);
    const [group] = await listTaleGroups(db, zoneId);
    expect(group.tales).toEqual([
      { ...row, media: { kind: 'video', contentType: 'video/mp4', url: `/api/v1/tales/${taleId}/media` } },
      { ...row, id: 't2', media: null },
    ]);
    expect(JSON.stringify(group)).not.toMatch(/key/i);
  });

  it('treats ids that are not UUIDs as unknown tales without querying', async () => {
    const { db, query } = fakeDb([]);
    expect(await taleExists(db, 'nope')).toBe(false);
    await expect(getTaleMedia(db, 'nope')).rejects.toBeInstanceOf(TaleNotFoundError);
    await expect(setTaleMedia(db, 'nope', { key: 'k', contentType: 'image/png' })).rejects.toBeInstanceOf(
      TaleNotFoundError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('reads the stored key and type, null when the tale has none, and refuses an unknown tale', async () => {
    const { db } = fakeDb([
      { rows: [{ key: 'tales/a.png', contentType: 'image/png' }] },
      { rows: [{ key: null, contentType: null }] },
      { rows: [] },
    ]);
    expect(await getTaleMedia(db, taleId)).toEqual({ key: 'tales/a.png', contentType: 'image/png' });
    expect(await getTaleMedia(db, taleId)).toBeNull();
    await expect(getTaleMedia(db, taleId)).rejects.toBeInstanceOf(TaleNotFoundError);
  });

  it('stores only the key and type and returns the previous key', async () => {
    const { db, query } = fakeDb([{ rows: [{ ...row, mediaContentType: 'image/gif', previousKey: 'tales/old.png' }] }]);
    const result = await setTaleMedia(db, taleId, { key: 'tales/new.gif', contentType: 'image/gif' });
    expect(query.mock.calls[0][1]).toEqual([taleId, 'tales/new.gif', 'image/gif']);
    expect(result).toEqual({
      previousKey: 'tales/old.png',
      tale: { ...row, media: { kind: 'image', contentType: 'image/gif', url: `/api/v1/tales/${taleId}/media` } },
    });
  });

  it('refuses to set media on an unknown tale', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    await expect(setTaleMedia(db, taleId, { key: 'k', contentType: 'image/png' })).rejects.toBeInstanceOf(
      TaleNotFoundError,
    );
  });
});

describe('order', () => {
  const a = '00000000-0000-4000-8000-00000000000a';
  const b = '00000000-0000-4000-8000-00000000000b';
  const c = '00000000-0000-4000-8000-00000000000c';

  it('does not query for a parent id that is not a UUID', async () => {
    const { db, query } = fakeDb([]);
    await expect(orderTaleGroups(db, 'nope', [])).rejects.toBeInstanceOf(ZoneNotFoundError);
    await expect(orderTales(db, 'nope', [])).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });

  it('reorders groups under the zone lock and returns the new list', async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: a }, { id: b }] },
      { rows: [] },
      { rows: [{ project_id: projectId }] },
      {
        rows: [
          { id: b, zoneId, projectId, name: 'B', position: 0 },
          { id: a, zoneId, projectId, name: 'A', position: 1 },
        ],
      },
      { rows: [] },
    ]);
    const groups = await orderTaleGroups(db, zoneId, [b, a]);
    expect(groups.map((g) => [g.id, g.position])).toEqual([
      [b, 0],
      [a, 1],
    ]);
    const lock = query.mock.calls.find((call) => /pg_advisory_xact_lock/.test(call[0] as string));
    expect(lock?.[0]).toMatch(/'tale_groups:' \|\| \$1/);
    expect(lock?.[1]).toEqual([zoneId]);
    const update = query.mock.calls.find((call) => /UPDATE tale_groups/.test(call[0] as string));
    expect(update?.[1]).toEqual([zoneId, [b, a]]);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['omits a group', [a]],
    ['repeats a group', [a, a]],
    ['names another parent\'s group', [a, c]],
    ['adds a group', [a, b, c]],
  ])('refuses a group list that %s and rolls back', async (_, ids) => {
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: a }, { id: b }] },
    ]);
    await expect(orderTaleGroups(db, zoneId, ids)).rejects.toBeInstanceOf(OrderMismatchError);
    expect(statements()).toContain('ROLLBACK');
    expect(statements().some((s) => /UPDATE/.test(s))).toBe(false);
  });

  it('reorders tales with the group row locked', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{}] },
      { rows: [{ id: a }, { id: b }] },
      { rows: [] },
      { rows: [{ id: b, mediaContentType: null }, { id: a, mediaContentType: null }] },
    ]);
    const tales = await orderTales(db, groupId, [b, a]);
    expect(statements().some((s) => /FROM tale_groups/.test(s) && /FOR UPDATE/.test(s))).toBe(true);
    const update = query.mock.calls.find((call) => /UPDATE tales/.test(call[0] as string));
    expect(update?.[1]).toEqual([groupId, [b, a]]);
    expect(tales.map((t) => t.id)).toEqual([b, a]);
  });

  it('refuses an unknown tale group and a mismatched tale list', async () => {
    const unknown = fakeDb([{ rows: [] }]);
    await expect(orderTales(unknown.db, groupId, [])).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    const mismatch = fakeDb([{ rows: [{}] }, { rows: [{ id: a }, { id: b }] }]);
    await expect(orderTales(mismatch.db, groupId, [b])).rejects.toBeInstanceOf(OrderMismatchError);
    expect(mismatch.statements()).toContain('ROLLBACK');
  });
});
