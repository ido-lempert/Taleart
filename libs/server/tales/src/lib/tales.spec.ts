import {
  copyTaleGroup,
  createTale,
  createTaleGroup,
  InvalidScheduleError,
  InvalidStatusTransitionError,
  isMediaKeyInUse,
  findPublishedMedia,
  listDeliveryTaleGroups,
  getTaleGroup,
  getTaleMedia,
  listProjectTaleGroups,
  listTaleGroups,
  OrderMismatchError,
  placeTaleGroup,
  removeTaleGroup,
  renameTaleGroup,
  orderTaleGroups,
  orderTales,
  setTaleGroupSchedule,
  setTaleGroupStatus,
  setTaleMedia,
  setTaleSchedule,
  setTaleStatus,
  taleExists,
  taleGroupProjectId,
  taleProjectId,
  TaleGroupFullError,
  TaleGroupNotFoundError,
  TaleGroupNotInProjectError,
  TaleNotFoundError,
  type TransactionalDb,
} from './tales';
import { migrateTales } from './migration';
import { ZoneNotFoundError } from '@taleart/server-zones';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';
// No start and no end time, as rows without a window read (AD-6).
const NO_WINDOW = { startsAt: null, endsAt: null };

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

  it("creates the group in the zone's project, serializes on the zone and places it after the last position", async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: groupId, projectId, name: 'A' }] },
      { rows: [{ position: 2 }] },
    ]);
    const group = await createTaleGroup(db, { zoneId, name: 'A' });
    expect(group).toEqual({ id: groupId, projectId, name: 'A', ...NO_WINDOW, position: 2, zoneIds: [zoneId], tales: [] });
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([zoneId]);
    expect(statements().some((s) => /FROM zones/.test(s) && /FOR UPDATE/.test(s))).toBe(false);
    const insertGroup = query.mock.calls.find((c) => /INSERT INTO tale_groups/.test(c[0] as string));
    expect(insertGroup?.[1]).toEqual([projectId, 'A']);
    const place = query.mock.calls.find((c) => /INSERT INTO zone_tale_groups/.test(c[0] as string));
    expect(place?.[0]).toMatch(/COALESCE\(MAX\(position\), -1\) \+ 1 FROM zone_tale_groups WHERE zone_id = \$1/);
    expect(place?.[1]).toEqual([zoneId, groupId, projectId]);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('runs the callback in the same transaction once the group is placed, and rolls back when it throws', async () => {
    const answers = () => [
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: groupId, projectId, name: 'A' }] },
      { rows: [{ position: 0 }] },
    ];
    const ok = fakeDb(answers());
    const withGroup = vi.fn(async (tx: unknown, ids: unknown) => {
      await (tx as TransactionalDb).query('SELECT link', []);
      expect(ids).toEqual({ taleGroupId: groupId, projectId });
    });
    await createTaleGroup(ok.db, { zoneId, name: 'A' }, withGroup);
    expect(withGroup).toHaveBeenCalledTimes(1);
    const order = ok.statements();
    expect(order.findIndex((s) => /INSERT INTO zone_tale_groups/.test(s))).toBeLessThan(order.indexOf('SELECT link'));
    expect(order.indexOf('SELECT link')).toBeLessThan(order.indexOf('COMMIT'));

    const failing = fakeDb(answers());
    await expect(
      createTaleGroup(failing.db, { zoneId, name: 'A' }, async () => {
        throw new Error('link failed');
      }),
    ).rejects.toThrow('link failed');
    expect(failing.statements()).toContain('ROLLBACK');
    expect(failing.statements()).not.toContain('COMMIT');
  });
});

describe('placements', () => {
  const otherProject = '00000000-0000-4000-8000-000000000009';
  const placedRow = { id: groupId, projectId, name: 'A', position: 1 };

  it('places a group of the zone\'s project at the end of the zone, under the zone lock', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [], rowCount: 1 },
      { rows: [placedRow] },
      { rows: [] },
      { rows: [{ taleGroupId: groupId, zoneId: '00000000-0000-4000-8000-0000000000aa' }, { taleGroupId: groupId, zoneId }] },
    ]);
    const result = await placeTaleGroup(db, zoneId, groupId);
    expect(result).toEqual({
      placed: true,
      group: { ...placedRow, ...NO_WINDOW, tales: [], zoneIds: ['00000000-0000-4000-8000-0000000000aa', zoneId] },
    });
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([zoneId]);
    const insert = query.mock.calls.find((c) => /INSERT INTO zone_tale_groups/.test(c[0] as string));
    expect(insert?.[0]).toMatch(/ON CONFLICT \(zone_id, tale_group_id\) DO NOTHING/);
    expect(insert?.[1]).toEqual([zoneId, groupId, projectId]);
    expect(statements()).toContain('COMMIT');
  });

  it('reports a group already placed in the zone as not placed again', async () => {
    const { db } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [], rowCount: 0 },
      { rows: [placedRow] },
    ]);
    expect((await placeTaleGroup(db, zoneId, groupId)).placed).toBe(false);
  });

  it('refuses an unknown zone, and a group of another project or none, without placing', async () => {
    const zone = fakeDb([{ rows: [] }]);
    await expect(placeTaleGroup(zone.db, zoneId, groupId)).rejects.toBeInstanceOf(ZoneNotFoundError);
    for (const answer of [{ rows: [{ project_id: otherProject }] }, { rows: [] }]) {
      const { db, statements } = fakeDb([{ rows: [{ project_id: projectId }] }, answer]);
      await expect(placeTaleGroup(db, zoneId, groupId)).rejects.toBeInstanceOf(TaleGroupNotInProjectError);
      expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    }
    const { db, query } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    await expect(placeTaleGroup(db, zoneId, 'nope')).rejects.toBeInstanceOf(TaleGroupNotInProjectError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('removes only the placement and keeps the zone positions dense', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ]);
    await removeTaleGroup(db, zoneId, groupId);
    const remove = query.mock.calls.find((c) => /DELETE/.test(c[0] as string));
    expect(remove?.[0]).toMatch(/DELETE FROM zone_tale_groups WHERE zone_id = \$1 AND tale_group_id = \$2/);
    expect(remove?.[1]).toEqual([zoneId, groupId]);
    expect(statements().some((s) => /DELETE FROM tale_groups|DELETE FROM tales/.test(s))).toBe(false);
    const renumber = query.mock.calls.find((c) => /row_number\(\)/.test(c[0] as string));
    expect(renumber?.[1]).toEqual([zoneId]);
    expect(statements()).toContain('COMMIT');
  });

  it('refuses to remove a group not placed in the zone, and an unknown zone', async () => {
    const notPlaced = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [{}] }, { rows: [], rowCount: 0 }]);
    await expect(removeTaleGroup(notPlaced.db, zoneId, groupId)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(notPlaced.statements()).toContain('ROLLBACK');
    const unknown = fakeDb([{ rows: [] }]);
    await expect(removeTaleGroup(unknown.db, zoneId, groupId)).rejects.toBeInstanceOf(ZoneNotFoundError);
    const bad = fakeDb([{ rows: [{ project_id: projectId }] }]);
    await expect(removeTaleGroup(bad.db, zoneId, 'nope')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(bad.query).toHaveBeenCalledTimes(1);
  });

  it("lists the project's groups by name with tale counts and zones, including unplaced ones", async () => {
    const g2 = '00000000-0000-4000-8000-000000000013';
    const { db, query } = fakeDb([
      {
        rows: [
          { id: groupId, projectId, name: 'Autumn', taleCount: 2 },
          { id: g2, projectId, name: 'beach', taleCount: 0 },
        ],
      },
      { rows: [{ taleGroupId: groupId, zoneId }] },
    ]);
    expect(await listProjectTaleGroups(db, projectId)).toEqual([
      { id: groupId, projectId, name: 'Autumn', ...NO_WINDOW, taleCount: 2, zoneIds: [zoneId] },
      { id: g2, projectId, name: 'beach', ...NO_WINDOW, taleCount: 0, zoneIds: [] },
    ]);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY lower\(name\), name, id/);
    expect(query.mock.calls[0][1]).toEqual([projectId]);
    const none = fakeDb([]);
    expect(await listProjectTaleGroups(none.db, 'nope')).toEqual([]);
    expect(none.query).not.toHaveBeenCalled();
  });
});

describe('rename', () => {
  it('renames the group itself and returns it with its tales and zones', async () => {
    const { db, query } = fakeDb([{ rows: [{ id: groupId, projectId, name: 'B' }] }, { rows: [] }, { rows: [{ taleGroupId: groupId, zoneId }] }]);
    expect(await renameTaleGroup(db, groupId, 'B')).toEqual({ id: groupId, projectId, name: 'B', ...NO_WINDOW, tales: [], zoneIds: [zoneId] });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE tale_groups SET name = \$2 WHERE id = \$1/);
    expect(query.mock.calls[0][1]).toEqual([groupId, 'B']);
  });

  it('refuses an unknown group, and does not query for an id that is not a UUID', async () => {
    await expect(renameTaleGroup(fakeDb([{ rows: [] }]).db, groupId, 'B')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    const bad = fakeDb([]);
    await expect(renameTaleGroup(bad.db, 'nope', 'B')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
  });
});

describe('migration', () => {
  it('creates placements keyed to the zone and group projects, and moves old zone columns into them', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await migrateTales({ query } as unknown as TransactionalDb);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zone_tale_groups/);
    expect(sql).toMatch(/PRIMARY KEY \(zone_id, tale_group_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(zone_id, project_id\) REFERENCES zones \(id, project_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(tale_group_id, project_id\) REFERENCES tale_groups \(id, project_id\)/);
    expect(sql).toMatch(/SELECT zone_id, id, project_id, position, created_at FROM tale_groups/);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS zone_id, DROP COLUMN IF EXISTS position/);
    // Statuses (AD-6): existing rows are filled with live, then new rows default to draft, once.
    expect(sql).toMatch(/table_name = 'tale_groups' AND column_name = 'status'/);
    expect(sql).toMatch(/table_name = 'tales' AND column_name = 'status'/);
    expect(sql).toMatch(/ALTER TABLE tales ADD COLUMN status text NOT NULL DEFAULT 'live'/);
    expect(sql).toMatch(/ALTER TABLE tale_groups ALTER COLUMN status SET DEFAULT 'draft'/);
    expect(sql).toMatch(/CHECK \(status IN \('draft', 'live', 'paused', 'archived', 'processing', 'invalid-media', 'quota-reached'\)\)/);
    // The unique index the placement key references comes before the placements table.
    expect(sql.indexOf('tale_groups_id_project_id_key')).toBeLessThan(sql.indexOf('CREATE TABLE IF NOT EXISTS zone_tale_groups'));
  });
});

describe('one tale group', () => {
  it('refuses an id that is not a UUID without querying, and an unknown group', async () => {
    const { db, query } = fakeDb([]);
    await expect(getTaleGroup(db, 'nope')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(query).not.toHaveBeenCalled();
    await expect(getTaleGroup(fakeDb([{ rows: [] }]).db, groupId)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
  });

  it('reads the group with its tales and every zone it is placed in', async () => {
    const group = { id: groupId, projectId, name: 'A' };
    const { db } = fakeDb([
      { rows: [group] },
      { rows: [{ id: 't1', taleGroupId: groupId, mediaContentType: null }] },
      { rows: [{ taleGroupId: groupId, zoneId }] },
    ]);
    expect(await getTaleGroup(db, groupId)).toEqual({
      ...group,
      ...NO_WINDOW,
      zoneIds: [zoneId],
      tales: [{ id: 't1', taleGroupId: groupId, ...NO_WINDOW, media: null }],
    });
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
    expect(tale).toEqual({ id: 't1', ...NO_WINDOW, media: null });
  });

  it('runs the callback in the same transaction once the tale exists, and rolls back when it throws', async () => {
    const answers = () => [
      { rows: [{ project_id: projectId }] },
      { rows: [{ count: 0, next: 0 }] },
      { rows: [{ id: 't1', mediaContentType: null }] },
    ];
    const ok = fakeDb(answers());
    const withTale = vi.fn(async (tx: unknown, ids: unknown) => {
      await (tx as TransactionalDb).query('SELECT link', []);
      expect(ids).toEqual({ taleId: 't1', projectId });
    });
    await createTale(ok.db, { taleGroupId: groupId, title: 'T' }, withTale);
    expect(withTale).toHaveBeenCalledTimes(1);
    expect(ok.statements().indexOf('SELECT link')).toBeLessThan(ok.statements().indexOf('COMMIT'));

    const failing = fakeDb(answers());
    await expect(
      createTale(failing.db, { taleGroupId: groupId, title: 'T' }, async () => {
        throw new Error('link failed');
      }),
    ).rejects.toThrow('link failed');
    expect(failing.statements()).toContain('ROLLBACK');
    expect(failing.statements()).not.toContain('COMMIT');
  });
});

describe('tale media', () => {
  const taleId = '00000000-0000-4000-8000-000000000004';
  const row = { id: taleId, taleGroupId: groupId, projectId, title: 'T', position: 0 };

  it('lists tales with media derived from the content type, never exposing the key', async () => {
    const { db } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ id: groupId, projectId, name: 'A', position: 0 }] },
      {
        rows: [
          { ...row, mediaContentType: 'video/mp4' },
          { ...row, id: 't2', mediaContentType: null },
        ],
      },
    ]);
    const [group] = await listTaleGroups(db, zoneId);
    expect(group.tales).toEqual([
      { ...row, ...NO_WINDOW, media: { kind: 'video', contentType: 'video/mp4', url: `/api/v1/tales/${taleId}/media` } },
      { ...row, ...NO_WINDOW, id: 't2', media: null },
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
      tale: { ...row, ...NO_WINDOW, media: { kind: 'image', contentType: 'image/gif', url: `/api/v1/tales/${taleId}/media` } },
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

  it("reorders the zone's placements under the zone lock and returns the new list", async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: a }, { id: b }] },
      { rows: [] },
      {
        rows: [
          { id: b, projectId, name: 'B', position: 0 },
          { id: a, projectId, name: 'A', position: 1 },
        ],
      },
      { rows: [] },
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
    const current = query.mock.calls.find((call) => /SELECT tale_group_id AS id FROM zone_tale_groups/.test(call[0] as string));
    expect(current?.[1]).toEqual([zoneId]);
    const update = query.mock.calls.find((call) => /UPDATE zone_tale_groups/.test(call[0] as string));
    expect(update?.[0]).toMatch(/zone_tale_groups\.zone_id = \$1/);
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
    expect(statements().some((s) => /^UPDATE/.test(s))).toBe(false);
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

describe('project lookups', () => {
  it('finds the project of a tale group and of a tale, and nothing for ids that are not UUIDs', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ project_id: projectId }] });
    const db = { query } as unknown as TransactionalDb;
    expect(await taleGroupProjectId(db, groupId)).toBe(projectId);
    expect(await taleProjectId(db, groupId)).toBe(projectId);
    expect(await taleGroupProjectId(db, 'nope')).toBeNull();
    expect(await taleProjectId(db, 'nope')).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    query.mockResolvedValue({ rows: [] });
    expect(await taleProjectId(db, groupId)).toBeNull();
  });
});

describe('delivery', () => {
  const t1 = '00000000-0000-4000-8000-000000000011';
  const t2 = '00000000-0000-4000-8000-000000000012';
  const g2 = '00000000-0000-4000-8000-000000000013';

  it("lists the zone's placed groups in its order with their tales and stored media keys", async () => {
    const { db, statements } = fakeDb([
      { rows: [{ id: groupId, name: 'A' }, { id: g2, name: 'B' }] },
      {
        rows: [
          { id: t1, taleGroupId: groupId, title: 'One', key: 'tales/x.png', contentType: 'image/png' },
          { id: t2, taleGroupId: groupId, title: 'Two', key: null, contentType: null },
        ],
      },
    ]);
    expect(await listDeliveryTaleGroups(db, zoneId)).toEqual([
      {
        id: groupId,
        name: 'A',
        tales: [
          { id: t1, title: 'One', media: { key: 'tales/x.png', contentType: 'image/png' } },
          { id: t2, title: 'Two', media: null },
        ],
      },
      // B has no live tale, so it is left out.
    ]);
    expect(statements()[0]).toMatch(/FROM zone_tale_groups[\s\S]*ORDER BY zone_tale_groups\.position, tale_groups\.id/);
    // Only live groups and their live tales are delivered (AD-6).
    expect(statements()[0]).toMatch(/tale_groups\.status = 'live'/);
    expect(statements()[1]).toMatch(/tales\.status = 'live'[\s\S]*ORDER BY position, id/);
    // ...inside their start and end time, and their group's (AD-6).
    expect(statements()[0]).toMatch(
      /tale_groups\.starts_at IS NULL OR tale_groups\.starts_at <= \$2\) AND \(tale_groups\.ends_at IS NULL OR tale_groups\.ends_at > \$2\)/,
    );
    expect(statements()[1]).toMatch(/tales\.starts_at IS NULL OR tales\.starts_at <= \$2\) AND \(tales\.ends_at IS NULL OR tales\.ends_at > \$2\)/);
  });

  it('answers an empty list for a zone without groups, and does not query for a non-UUID zone', async () => {
    const empty = fakeDb([{ rows: [] }]);
    expect(await listDeliveryTaleGroups(empty.db, zoneId)).toEqual([]);
    expect(empty.query).toHaveBeenCalledTimes(1);
    const bad = fakeDb([]);
    expect(await listDeliveryTaleGroups(bad.db, 'nope')).toEqual([]);
    expect(bad.query).not.toHaveBeenCalled();
  });

  it('finds the media a tale references by key, and null for any other key', async () => {
    const found = fakeDb([{ rows: [{ contentType: 'video/mp4' }] }]);
    expect(await findPublishedMedia(found.db, 'tales/x.mp4')).toEqual({ key: 'tales/x.mp4', contentType: 'video/mp4' });
    expect(found.query.mock.calls[0][1]).toEqual(['tales/x.mp4', expect.any(Date)]);
    // Published: a live tale of a live group, each inside its window (AD-6, AD-11).
    expect(found.query.mock.calls[0][0]).toMatch(/tales\.status = 'live' AND \(tales\.starts_at IS NULL/);
    expect(found.query.mock.calls[0][0]).toMatch(/tale_groups\.status = 'live' AND \(tale_groups\.starts_at IS NULL/);
    expect(found.query.mock.calls[0][0]).toMatch(/tale_groups\.ends_at > \$2/);
    const missing = fakeDb([{ rows: [] }]);
    expect(await findPublishedMedia(missing.db, 'tales/old.png')).toBeNull();
  });
});

describe('copy to zone', () => {
  const copyId = '00000000-0000-4000-8000-000000000005';
  const otherProject = '00000000-0000-4000-8000-000000000006';

  it('does not query for a group id that is not a UUID, and refuses an unknown zone', async () => {
    const bad = fakeDb([]);
    await expect(copyTaleGroup(bad.db, { taleGroupId: 'nope', zoneId })).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
    const noZone = fakeDb([{ rows: [] }]);
    await expect(copyTaleGroup(noZone.db, { taleGroupId: groupId, zoneId })).rejects.toBeInstanceOf(ZoneNotFoundError);
    expect(noZone.db.connect).not.toHaveBeenCalled();
  });

  it('refuses an unknown source group and rolls back without inserting', async () => {
    const { db, statements, release } = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [{}] }, { rows: [] }]);
    await expect(copyTaleGroup(db, { taleGroupId: groupId, zoneId })).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("copies the group, its tales and media keys into the zone's project under the zone lock", async () => {
    const tale = { id: 't9', taleGroupId: copyId, projectId: otherProject, title: 'T', position: 0, mediaContentType: null };
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: otherProject }] },
      { rows: [{}] },
      { rows: [{ name: 'Summer', startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: null }] },
      {
        rows: [
          { id: copyId, projectId: otherProject, name: 'Summer', startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: null },
        ],
      },
      { rows: [] },
      { rows: [] },
      { rows: [{ position: 3 }] },
      { rows: [] },
      { rows: [tale] },
      { rows: [{ taleGroupId: copyId, zoneId }] },
    ]);
    const withCopy = vi.fn(async (tx: unknown, ids: unknown) => {
      await (tx as TransactionalDb).query('SELECT tags', []);
      expect(ids).toEqual({ sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: otherProject });
    });
    const copy = await copyTaleGroup(db, { taleGroupId: groupId.toUpperCase(), zoneId }, withCopy);
    expect(withCopy).toHaveBeenCalledTimes(1);
    expect(copy).toEqual({
      id: copyId,
      projectId: otherProject,
      name: 'Summer',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: null,
      position: 3,
      zoneIds: [zoneId],
      tales: [{ id: 't9', taleGroupId: copyId, projectId: otherProject, title: 'T', position: 0, ...NO_WINDOW, media: null }],
    });
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([zoneId]);
    const insertGroup = query.mock.calls.find((c) => /INSERT INTO tale_groups/.test(c[0] as string));
    // The copy keeps the group's and its tales' start and end times.
    expect(insertGroup?.[1]).toEqual([otherProject, 'Summer', new Date('2026-11-01T00:00:00Z'), null]);
    const insertTales = query.mock.calls.find((c) => /INSERT INTO tales/.test(c[0] as string));
    expect(insertTales?.[0]).toMatch(/media_key, media_content_type, status, starts_at, ends_at FROM tales/);
    expect(insertTales?.[1]).toEqual([groupId.toUpperCase(), copyId, otherProject]);
    expect(statements().some((s) => /FROM tales WHERE tale_group_id = \$1 FOR SHARE/.test(s))).toBe(true);
    const order = statements();
    expect(order.findIndex((s) => /FOR SHARE/.test(s))).toBeLessThan(order.findIndex((s) => /INSERT INTO tales/.test(s)));
    expect(order.indexOf('SELECT tags')).toBeLessThan(order.indexOf('COMMIT'));
  });

  it('rolls the copy back when the callback fails', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ name: 'A' }] },
      { rows: [{ id: copyId, projectId, name: 'A' }] },
    ]);
    await expect(
      copyTaleGroup(db, { taleGroupId: groupId, zoneId }, async () => {
        throw new Error('tags failed');
      }),
    ).rejects.toThrow('tags failed');
    expect(statements()).toContain('ROLLBACK');
    expect(statements()).not.toContain('COMMIT');
  });

  it('tells whether any tale still references a media key', async () => {
    const used = fakeDb([{ rows: [{}] }]);
    expect(await isMediaKeyInUse(used.db, 'tales/a.png')).toBe(true);
    expect(used.query.mock.calls[0][1]).toEqual(['tales/a.png']);
    const unused = fakeDb([{ rows: [] }]);
    expect(await isMediaKeyInUse(unused.db, 'tales/a.png')).toBe(false);
  });
});

describe('status', () => {
  const taleId = '00000000-0000-4000-8000-000000000007';
  const row = { id: groupId, projectId, name: 'A', storedStatus: 'live' };

  it('publishes a draft group under a row lock and returns it with its tales and zones', async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ status: 'draft' }] },
      { rows: [row] },
      { rows: [] },
      { rows: [] },
    ]);
    expect(await setTaleGroupStatus(db, groupId, 'live')).toEqual({ ...row, status: 'live', ...NO_WINDOW, zoneIds: [], tales: [] });
    expect(statements()).toContain('SELECT status FROM tale_groups WHERE id = $1 FOR UPDATE');
    const update = query.mock.calls.find((c) => /UPDATE tale_groups SET status/.test(c[0] as string));
    expect(update?.[1]).toEqual([groupId, 'live']);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the group already has the status', async () => {
    const { db, statements } = fakeDb([{ rows: [{ status: 'paused' }] }, { rows: [{ ...row, storedStatus: 'paused' }] }]);
    expect((await setTaleGroupStatus(db, groupId, 'paused')).status).toBe('paused');
    expect(statements().some((s) => /^UPDATE/.test(s))).toBe(false);
  });

  it('refuses a change the transitions do not allow, and rolls back', async () => {
    for (const [from, to] of [
      ['draft', 'paused'],
      ['archived', 'live'],
      ['processing', 'paused'],
    ] as const) {
      const { db, statements } = fakeDb([{ rows: [{ status: from }] }]);
      const err = await setTaleGroupStatus(db, groupId, to).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidStatusTransitionError);
      expect(err).toMatchObject({ code: 'invalid_status_transition', from, to });
      expect(statements().some((s) => /^UPDATE/.test(s))).toBe(false);
      expect(statements()).toContain('ROLLBACK');
    }
  });

  it('refuses an unknown group, and does not query for an id that is not a UUID', async () => {
    const missing = fakeDb([{ rows: [] }]);
    await expect(setTaleGroupStatus(missing.db, groupId, 'live')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    const bad = fakeDb([]);
    await expect(setTaleGroupStatus(bad.db, 'nope', 'live')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
  });

  it("pauses a tale and reads a live tale of a paused group as blocked-by-group", async () => {
    const taleRow = {
      id: taleId,
      taleGroupId: groupId,
      projectId,
      title: 'T',
      position: 0,
      mediaContentType: null,
      storedStatus: 'paused',
      groupStatus: 'live',
    };
    const paused = fakeDb([{ rows: [{ status: 'live' }] }, { rows: [taleRow] }]);
    expect(await setTaleStatus(paused.db, taleId, 'paused')).toEqual({
      id: taleId,
      taleGroupId: groupId,
      projectId,
      title: 'T',
      position: 0,
      storedStatus: 'paused',
      status: 'paused',
      ...NO_WINDOW,
      media: null,
    });
    const update = paused.query.mock.calls.find((c) => /UPDATE tales SET status/.test(c[0] as string));
    expect(update?.[1]).toEqual([taleId, 'paused']);

    const blocked = fakeDb([
      { rows: [{ status: 'paused' }] },
      { rows: [{ ...taleRow, storedStatus: 'live', groupStatus: 'paused' }] },
    ]);
    expect(await setTaleStatus(blocked.db, taleId, 'live')).toMatchObject({ storedStatus: 'live', status: 'blocked-by-group' });
  });

  it('refuses an unknown tale and a transition the rules do not allow', async () => {
    const missing = fakeDb([{ rows: [] }]);
    await expect(setTaleStatus(missing.db, taleId, 'live')).rejects.toBeInstanceOf(TaleNotFoundError);
    const bad = fakeDb([]);
    await expect(setTaleStatus(bad.db, 'nope', 'live')).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
    const refused = fakeDb([{ rows: [{ status: 'draft' }] }]);
    await expect(setTaleStatus(refused.db, taleId, 'paused')).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });
});

describe('schedule', () => {
  const taleId = '00000000-0000-4000-8000-000000000008';
  const hour = 60 * 60 * 1000;
  const window = (startOffset: number | null, endOffset: number | null) => ({
    startsAt: startOffset === null ? null : new Date(Date.now() + startOffset),
    endsAt: endOffset === null ? null : new Date(Date.now() + endOffset),
  });

  it('stores a group window in UTC and reads a live group as scheduled before its start', async () => {
    const stored = window(hour, 2 * hour);
    const { db, query } = fakeDb([
      { rows: [{ id: groupId, projectId, name: 'A', storedStatus: 'live', ...stored }] },
      { rows: [] },
      { rows: [] },
    ]);
    const startsAt = stored.startsAt?.toISOString() ?? null;
    const endsAt = stored.endsAt?.toISOString() ?? null;
    const group = await setTaleGroupSchedule(db, groupId, { startsAt, endsAt });
    expect(group).toMatchObject({ storedStatus: 'live', status: 'scheduled', startsAt, endsAt });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE tale_groups SET starts_at = \$2, ends_at = \$3 WHERE id = \$1/);
    expect(query.mock.calls[0][1]).toEqual([groupId, startsAt, endsAt]);
  });

  it('reads a live tale as expired after its end, and a paused one as paused whatever its window', async () => {
    const taleRow = { id: taleId, taleGroupId: groupId, projectId, title: 'T', position: 0, mediaContentType: null };
    const expired = fakeDb([
      { rows: [{ ...taleRow, storedStatus: 'live', groupStatus: 'live', ...window(-2 * hour, -hour) }] },
    ]);
    expect(await setTaleSchedule(expired.db, taleId, { startsAt: null, endsAt: '2020-01-01T00:00:00Z' })).toMatchObject({
      status: 'expired',
      storedStatus: 'live',
    });
    expect(expired.query.mock.calls[0][0]).toMatch(/UPDATE tales SET starts_at = \$2, ends_at = \$3 WHERE id = \$1/);
    const paused = fakeDb([{ rows: [{ ...taleRow, storedStatus: 'paused', groupStatus: 'live', ...window(hour, null) }] }]);
    expect((await setTaleSchedule(paused.db, taleId, { startsAt: '2999-01-01T00:00:00Z', endsAt: null })).status).toBe(
      'paused',
    );
    const open = fakeDb([{ rows: [{ ...taleRow, storedStatus: 'live', groupStatus: 'live', ...window(null, null) }] }]);
    expect(await setTaleSchedule(open.db, taleId, NO_WINDOW)).toMatchObject({ status: 'live', ...NO_WINDOW });
  });

  it('refuses an end not later than the start without querying', async () => {
    const { db, query } = fakeDb([]);
    const start = '2026-10-21T10:00:00.000Z';
    await expect(setTaleGroupSchedule(db, groupId, { startsAt: start, endsAt: start })).rejects.toBeInstanceOf(
      InvalidScheduleError,
    );
    await expect(
      setTaleSchedule(db, taleId, { startsAt: start, endsAt: '2026-10-21T09:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses unknown or non-UUID ids', async () => {
    await expect(setTaleGroupSchedule(fakeDb([{ rows: [] }]).db, groupId, NO_WINDOW)).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    await expect(setTaleSchedule(fakeDb([{ rows: [] }]).db, taleId, NO_WINDOW)).rejects.toBeInstanceOf(TaleNotFoundError);
    const bad = fakeDb([]);
    await expect(setTaleGroupSchedule(bad.db, 'nope', NO_WINDOW)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    await expect(setTaleSchedule(bad.db, 'nope', NO_WINDOW)).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
  });

  it('passes the time it delivers at to the window filters', async () => {
    const now = new Date('2026-10-21T10:00:00Z');
    const { db, query } = fakeDb([{ rows: [{ id: groupId, name: 'A' }] }, { rows: [] }]);
    await listDeliveryTaleGroups(db, zoneId, now);
    expect(query.mock.calls[0][1]).toEqual([zoneId, now]);
    expect(query.mock.calls[1][1]).toEqual([[groupId], now]);
  });

  it('adds nullable window columns with a CHECK, once', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await migrateTales({ query } as unknown as TransactionalDb);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    for (const table of ['tale_groups', 'tales']) {
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS starts_at timestamptz`);
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ends_at timestamptz`);
      expect(sql).toContain(`conname = '${table}_window_check'`);
    }
    expect(sql).toMatch(/CHECK \(starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at\)/);
  });
});
