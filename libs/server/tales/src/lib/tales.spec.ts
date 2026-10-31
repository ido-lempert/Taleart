import {
  copyTaleGroup,
  copyTaleWithDocument,
  createTale,
  createTaleGroup,
  deleteTale,
  InvalidScheduleError,
  InvalidStatusTransitionError,
  isMediaKeyInUse,
  withMediaKeyDeletionGuard,
  findPublishedMedia,
  listDeliveryTaleGroups,
  getTaleGroup,
  getTaleGroupCover,
  getTaleMedia,
  listProjectTaleGroups,
  createProjectTaleGroup,
  listTaleGroups,
  OrderMismatchError,
  placeTaleGroup,
  removeTaleGroup,
  renameTaleGroup,
  orderTaleGroups,
  orderTales,
  setTaleGroupCover,
  setTaleGroupSchedule,
  setTaleGroupStatus,
  setTaleMedia,
  setTaleSchedule,
  setTaleStatus,
  taleExists,
  taleGroupProjectId,
  taleProjectId,
  TaleGroupFullError,
  TaleGroupLimitError,
  TaleGroupArchivedError,
  TaleGroupNotFoundError,
  TaleGroupNotInProjectError,
  TaleNotFoundError,
  type TransactionalDb,
} from './tales';
import type { DbConnection } from '@taleart/server-access';
import { MAX_TALE_GROUPS_PER_PROJECT } from '@taleart/contract';
import { migrateShownStatus, migrateTales } from './migration';
import { InvalidTaleDocumentError } from './tale-document';
import { ZoneNotFoundError } from '@taleart/server-zones';

const zoneId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';
// No start and no end time, as rows without a window read (AD-6).
const NO_WINDOW = { startsAt: null, endsAt: null };
// Every group and tale read carries its visibility (epic UX rework R7); the API tests check its reasons.
const VIS = { visibility: expect.objectContaining({ visible: expect.any(Boolean) }) };

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
      { rows: [{}] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: groupId, projectId, name: 'A' }] },
      { rows: [{ position: 2 }] },
    ]);
    const group = await createTaleGroup(db, { zoneId, name: 'A' });
    expect(group).toEqual({ id: groupId, projectId, name: 'A', ...NO_WINDOW, cover: null, position: 2, zoneIds: [zoneId], tales: [] });
    // The project's group lock first, then the zone's; the cap is counted under both (R14).
    const locks = query.mock.calls.filter((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(locks.map((c) => [c[0], c[1]])).toEqual([
      [expect.stringContaining("'project_tale_groups:'"), [projectId]],
      [expect.stringContaining("'tale_groups:'"), [zoneId]],
    ]);
    const order = statements();
    const count = order.findIndex((s) => /SELECT count\(\*\)::int AS count FROM tale_groups WHERE project_id = \$1/.test(s));
    expect(count).toBeGreaterThan(order.findIndex((s) => /'tale_groups:'/.test(s)));
    expect(count).toBeLessThan(order.findIndex((s) => /INSERT INTO tale_groups/.test(s)));
    expect(statements().some((s) => /FROM zones/.test(s) && /FOR UPDATE/.test(s))).toBe(false);
    const insertGroup = query.mock.calls.find((c) => /INSERT INTO tale_groups/.test(c[0] as string));
    expect(insertGroup?.[1]).toEqual([projectId, 'A']);
    const place = query.mock.calls.find((c) => /INSERT INTO zone_tale_groups/.test(c[0] as string));
    expect(place?.[0]).toMatch(/COALESCE\(MAX\(position\), -1\) \+ 1 FROM zone_tale_groups WHERE zone_id = \$1/);
    expect(place?.[1]).toEqual([zoneId, groupId, projectId]);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('tale group cap (R14)', () => {
  it('refuses a group in a zone of a project at the cap of groups not archived, inserting nothing', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ count: MAX_TALE_GROUPS_PER_PROJECT }] },
    ]);
    await expect(createTaleGroup(db, { zoneId, name: 'A' })).rejects.toBeInstanceOf(TaleGroupLimitError);
    // Archived groups do not count.
    const count = query.mock.calls.find((c) => /count\(\*\)/.test(c[0] as string));
    expect(count?.[0]).toMatch(/WHERE project_id = \$1 AND status <> 'archived'/);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
  });

  it('refuses a group in no zone of a project at the cap, and takes one under it', async () => {
    const full = fakeDb([{ rows: [{}] }, { rows: [{ count: MAX_TALE_GROUPS_PER_PROJECT + 3 }] }]);
    await expect(createProjectTaleGroup(full.db, { projectId, name: 'A' })).rejects.toThrow(
      `This project already has ${MAX_TALE_GROUPS_PER_PROJECT} tale groups that are not archived, the most it can hold. Archive a tale group to make room.`,
    );
    expect(full.statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(full.statements()).toContain('ROLLBACK');
    const last = fakeDb([
      { rows: [{}] },
      { rows: [{ count: MAX_TALE_GROUPS_PER_PROJECT - 1 }] },
      { rows: [{ id: groupId, projectId, name: 'A', storedStatus: 'draft', coverContentType: null, coverAnimated: false }] },
    ]);
    await expect(createProjectTaleGroup(last.db, { projectId, name: 'A' })).resolves.toMatchObject({ id: groupId });
  });

  it('starts at 500', () => {
    expect(MAX_TALE_GROUPS_PER_PROJECT).toBe(500);
  });
});

describe('placements', () => {
  const otherProject = '00000000-0000-4000-8000-000000000009';
  const placedRow = { id: groupId, projectId, name: 'A', position: 1 };

  it("places a group of the zone's project at the end of the zone, under the zone lock", async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [] },
      { rows: [], rowCount: 1 },
      { rows: [placedRow] },
      { rows: [] },
      { rows: [{ taleGroupId: groupId, zoneId: '00000000-0000-4000-8000-0000000000aa' }, { taleGroupId: groupId, zoneId }] },
    ]);
    const result = await placeTaleGroup(db, zoneId, groupId);
    expect(result).toEqual({
      placed: true,
      group: { ...placedRow, ...NO_WINDOW, cover: null, tales: [], zoneIds: ['00000000-0000-4000-8000-0000000000aa', zoneId], ...VIS },
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
      { rows: [] },
      { rows: [], rowCount: 0 },
      { rows: [placedRow] },
    ]);
    expect((await placeTaleGroup(db, zoneId, groupId)).placed).toBe(false);
  });

  it('refuses an archived group not placed in the zone yet, without placing (epic UX rework R10)', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ '?column?': 1 }] },
    ]);
    await expect(placeTaleGroup(db, zoneId, groupId)).rejects.toBeInstanceOf(TaleGroupArchivedError);
    const check = query.mock.calls.find((c) => /status = 'archived'/.test(c[0] as string));
    expect(check?.[1]).toEqual([zoneId, groupId]);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
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

  it("lists the project's groups by name with tale counts, Shown counts and zones, without tales, including unplaced ones", async () => {
    const g2 = '00000000-0000-4000-8000-000000000013';
    const { db, query } = fakeDb([
      {
        rows: [
          { id: groupId, projectId, name: 'Autumn', storedStatus: 'live', coverContentType: null, coverAnimated: false, taleCount: 3, shownTaleCount: 2 },
          { id: g2, projectId, name: 'beach', storedStatus: 'draft', coverContentType: null, coverAnimated: false, taleCount: 0, shownTaleCount: 0 },
        ],
      },
      { rows: [{ taleGroupId: groupId, zoneId }] },
    ]);
    const listed = await listProjectTaleGroups(db, projectId);
    expect(listed).toEqual([
      { id: groupId, projectId, name: 'Autumn', status: 'live', storedStatus: 'live', ...NO_WINDOW, cover: null, taleCount: 3, shownTaleCount: 2, zoneIds: [zoneId], ...VIS },
      { id: g2, projectId, name: 'beach', status: 'draft', storedStatus: 'draft', ...NO_WINDOW, cover: null, taleCount: 0, shownTaleCount: 0, zoneIds: [], ...VIS },
    ]);
    expect(listed[0]).not.toHaveProperty('tales');
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY lower\(name\), name, id/);
    expect(sql).toMatch(/tales\.status = 'live'\)::int AS "shownTaleCount"/);
    expect(query.mock.calls[0][1]).toEqual([projectId]);
    // No read of the tales themselves.
    expect(query.mock.calls.some((c) => /FROM tales WHERE tale_group_id = ANY/.test(c[0] as string))).toBe(false);
    const none = fakeDb([]);
    expect(await listProjectTaleGroups(none.db, 'nope')).toEqual([]);
    expect(none.query).not.toHaveBeenCalled();
  });

  it('creates a group in the project, in no zone, with no tales', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{}] },
      { rows: [{ count: 499 }] },
      { rows: [{ id: groupId, projectId, name: 'Loose', storedStatus: 'draft', coverContentType: null, coverAnimated: false }] },
    ]);
    expect(await createProjectTaleGroup(db, { projectId, name: 'Loose' })).toEqual(
      expect.objectContaining({ id: groupId, name: 'Loose', status: 'draft', taleCount: 0, shownTaleCount: 0, zoneIds: [], ...VIS }),
    );
    // Under the project's group lock, counted first (R14).
    const calls = query.mock.calls.filter((c) => c[0] !== 'BEGIN');
    expect(calls[0]).toEqual([expect.stringContaining("'project_tale_groups:'"), [projectId]]);
    expect(calls[1]).toEqual([expect.stringMatching(/count\(\*\)::int AS count FROM tale_groups WHERE project_id = \$1/), [projectId]]);
    expect(calls[2][0]).toMatch(/INSERT INTO tale_groups \(project_id, name\) VALUES \(\$1, \$2\)/);
    expect(calls[2][1]).toEqual([projectId, 'Loose']);
    expect(statements()).toContain('COMMIT');
    expect(query.mock.calls.some((c) => /zone_tale_groups \(/.test(c[0] as string))).toBe(false);
  });
});

describe('rename', () => {
  it('renames the group itself and returns it with its tales and zones', async () => {
    const { db, query } = fakeDb([{ rows: [{ id: groupId, projectId, name: 'B' }] }, { rows: [] }, { rows: [{ taleGroupId: groupId, zoneId }] }]);
    expect(await renameTaleGroup(db, groupId, 'B')).toEqual({ id: groupId, projectId, name: 'B', ...NO_WINDOW, cover: null, tales: [], zoneIds: [zoneId], ...VIS });
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

describe('migrateShownStatus: a failing publish', () => {
  const taleId = '00000000-0000-4000-8000-0000000000a1';
  const draft = { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] };
  // A connection on which the step runs and publishing the one made-live tale's draft throws `publishError`.
  function connection(publishError: Error, rollbackError?: Error) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO tales_migrations')) return { rows: [{ step: 'shown-status' }] };
      if (sql.includes('FROM tale_groups WHERE status')) return { rows: [{ id: groupId }] };
      if (sql.includes("UPDATE tales SET status = 'live'")) return { rows: [{ id: taleId, draft, unpublished: true }] };
      if (sql.includes('SET document = draft_document')) throw publishError;
      if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      return { rows: [] };
    });
    return { query, db: { query, release: vi.fn() } as unknown as DbConnection };
  }
  const statements = (query: ReturnType<typeof vi.fn>) => query.mock.calls.map((c) => String(c[0]).trim());

  it("keeps the tale's status change and logs a database error on that tale", async () => {
    const { query, db } = connection(Object.assign(new Error('check violated'), { code: '23514' }));
    const log = vi.fn();
    expect(await migrateShownStatus(db, { log })).toEqual({ applied: true, madeLive: 1, published: 0 });
    expect(statements(query)).toContain('ROLLBACK TO SAVEPOINT shown_status_publish');
    expect(statements(query)).toContain('COMMIT');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining(`Tale ${taleId}: made live`));
  });

  it('fails the step on any other error, such as a lost connection, reporting it even when the rollback fails', async () => {
    const lost = new Error('Connection terminated unexpectedly');
    const { query, db } = connection(lost, new Error('Client was closed'));
    await expect(migrateShownStatus(db, { log: vi.fn() })).rejects.toBe(lost);
    expect(statements(query)).not.toContain('ROLLBACK TO SAVEPOINT shown_status_publish');
    expect(statements(query)).not.toContain('COMMIT');
    expect(statements(query)).toContain('ROLLBACK');

    const shutdown = connection(Object.assign(new Error('terminating connection'), { code: '57P01' }));
    await expect(migrateShownStatus(shutdown.db, { log: vi.fn() })).rejects.toThrow('terminating connection');
  });
});

describe('migration', () => {
  it('creates placements keyed to the zone and group projects, and moves old zone columns into them', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await migrateTales({ query } as unknown as DbConnection);
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
      cover: null,
      zoneIds: [zoneId],
      ...VIS,
      tales: [{ id: 't1', taleGroupId: groupId, ...NO_WINDOW, media: null, ...VIS }],
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
    // New tales are stored live (Shown, AD-6 amended).
    expect(insert?.[1]).toEqual([groupId, projectId, 'T', 2, 'live']);
    expect(tale).toEqual({ id: 't1', ...NO_WINDOW, media: null, ...VIS });
  });
});

describe('keep a document as a new tale', () => {
  const taleId = '00000000-0000-4000-8000-000000000009';
  const document = {
    version: 1,
    canvas: { background: { type: 'color', color: '#112233' } },
    elements: [
      {
        id: '00000000-0000-4000-8000-0000000000aa',
        type: 'text',
        box: { x: 0.1, y: 0.1, w: 0.5, h: 0.1, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: 'Mine' },
      },
    ],
  };

  it('does not query for a tale id that is not a UUID, nor for a document that does not pass', async () => {
    const { db, query } = fakeDb([]);
    await expect(copyTaleWithDocument(db, 'nope', document)).rejects.toBeInstanceOf(TaleNotFoundError);
    await expect(copyTaleWithDocument(db, taleId, { ...document, extra: 1 })).rejects.toBeInstanceOf(
      InvalidTaleDocumentError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses an unknown tale and rolls back', async () => {
    const { db, statements } = fakeDb([{ rows: [] }]);
    await expect(copyTaleWithDocument(db, taleId, document)).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(statements()).toContain('ROLLBACK');
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });

  it('refuses when the group already holds 100 tales, after locking it', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ groupId }] },
      { rows: [] },
      { rows: [{}] },
      { rows: [{ count: 100, next: 100 }] },
    ]);
    await expect(copyTaleWithDocument(db, taleId, document)).rejects.toBeInstanceOf(TaleGroupFullError);
    expect(statements().some((s) => /FROM tale_groups WHERE id = \$1 FOR UPDATE/.test(s))).toBe(true);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
  });

  it('inserts a draft at the end of the group with the checked document at revision 1, in one transaction', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ groupId }] },
      { rows: [] },
      { rows: [{}] },
      { rows: [{ count: 3, next: 3 }] },
      { rows: [{ id: 't2', mediaContentType: 'image/png', storedStatus: 'draft', groupStatus: 'live' }] },
    ]);
    const tale = await copyTaleWithDocument(db, taleId, document);
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[0]).toMatch(/title \|\| ' \(copy\)'/);
    // In step only when the kept document holds the tale's media as its own (R16).
    expect(insert?.[0]).toMatch(/media_key, media_content_type,\s+CASE WHEN \$4 THEN media_key END, \$3::jsonb, 1/);
    expect(insert?.[0]).toMatch(/draft_document, draft_revision\)/);
    expect((insert?.[0] as string).split('RETURNING')[0]).not.toMatch(/status|starts_at/);
    expect(insert?.[1]).toEqual([taleId, 3, JSON.stringify(document), false]);
    expect(statements().indexOf('BEGIN')).toBe(0);
    expect(statements()).toContain('COMMIT');
    // The group is locked first, then the source tale is share-locked, as copyTaleGroup does.
    const groupLock = statements().findIndex((s) => /FROM tale_groups WHERE id = \$1 FOR UPDATE/.test(s));
    const taleLock = statements().findIndex((s) => /FROM tales WHERE id = \$1 FOR SHARE/.test(s));
    expect(groupLock).toBeGreaterThan(-1);
    expect(taleLock).toBeGreaterThan(groupLock);
    expect(taleLock).toBeLessThan(statements().findIndex((s) => /INSERT/.test(s)));
    expect(tale.id).toBe('t2');
    expect(tale.media?.url).toBe('/api/v1/tales/t2/media');
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
      { ...row, ...NO_WINDOW, media: { kind: 'video', contentType: 'video/mp4', url: `/api/v1/tales/${taleId}/media` }, ...VIS },
      { ...row, ...NO_WINDOW, id: 't2', media: null, ...VIS },
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
    // In one transaction with bringing the documents in step (R16).
    expect(query.mock.calls[0][0]).toBe('BEGIN');
    expect(query.mock.calls[1][1]).toEqual([taleId, 'tales/new.gif', 'image/gif']);
    expect(query.mock.calls[2][0]).toMatch(/document_media_key AS "inStep"[\s\S]*FOR UPDATE/);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(result).toEqual({
      previousKey: 'tales/old.png',
      tale: { ...row, ...NO_WINDOW, media: { kind: 'image', contentType: 'image/gif', url: `/api/v1/tales/${taleId}/media` }, ...VIS },
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
    ["names another parent's group", [a, c]],
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
          {
            id: t1,
            taleGroupId: groupId,
            title: 'One',
            key: 'tales/x.png',
            contentType: 'image/png',
            document: { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] },
            // In step (R16): a person removed the media element, and it stays removed.
            inStep: 'tales/x.png',
          },
          { id: t2, taleGroupId: groupId, title: 'Two', key: null, contentType: null, document: null, inStep: null },
        ],
      },
    ]);
    expect(await listDeliveryTaleGroups(db, zoneId)).toEqual([
      {
        id: groupId,
        name: 'A',
        cover: null,
        tales: [
          {
            id: t1,
            title: 'One',
            media: { key: 'tales/x.png', contentType: 'image/png' },
            // The delivered document (AD-15).
            document: { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] },
            fonts: [],
            mediaKeys: new Set(),
          },
          // Every tale is delivered with a document (R16): with neither media nor one, the legacy placeholder.
          {
            id: t2,
            title: 'Two',
            media: null,
            document: {
              version: 1,
              canvas: { background: { type: 'color', color: '#1f2937' } },
              durationMs: 5000,
              placeholder: true,
              elements: [],
            },
            fonts: [],
            mediaKeys: new Set(),
          },
        ],
      },
      // B has no live tale, so it is left out.
    ]);
    expect(statements()[0]).toMatch(/FROM zone_tale_groups[\s\S]*ORDER BY zone_tale_groups\.position, tale_groups\.id/);
    // Only live groups and their live tales are delivered (AD-6).
    expect(statements()[0]).toMatch(/\(tale_groups\.status IN \('draft', 'paused'\)\) IS NOT TRUE/);
    expect(statements()[1]).toMatch(/\(tales\.status IN \('draft', 'paused'\)\) IS NOT TRUE[\s\S]*ORDER BY position, id/);
    // ...inside their start and end time, and their group's (AD-6).
    expect(statements()[0]).toMatch(
      /\(tale_groups\.starts_at > \$2\) IS NOT TRUE AND \(tale_groups\.ends_at <= \$2\) IS NOT TRUE/,
    );
    expect(statements()[1]).toMatch(/\(tales\.starts_at > \$2\) IS NOT TRUE AND \(tales\.ends_at <= \$2\) IS NOT TRUE/);
  });

  it("composes the tale's media into the document of a tale out of step (R16), and lets its key be resolved", async () => {
    const text = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'text',
      box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: 'Hi' },
    };
    const overlay = { version: 1, canvas: { background: { type: 'color', color: '#112233' } }, elements: [text] };
    const { db } = fakeDb([
      { rows: [{ id: groupId, name: 'A' }] },
      {
        rows: [
          // Before the migration: a document over the media, never in step.
          {
            id: t1,
            taleGroupId: groupId,
            title: 'One',
            key: 'tales/x.mp4',
            contentType: 'video/mp4',
            document: overlay,
            inStep: null,
            revision: 99,
          },
          // Media and no document: a document of only its media.
          {
            id: t2,
            taleGroupId: groupId,
            title: 'Two',
            key: 'tales/y.png',
            contentType: 'image/png',
            document: null,
            inStep: null,
          },
        ],
      },
    ]);
    const [group] = await listDeliveryTaleGroups(db, zoneId);
    const own = (id: string, type: string, mediaKey: string) => ({
      id,
      type,
      box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      a11y: { decorative: true },
      props: { mediaKey, fit: 'contain', taleMedia: true },
    });
    // Delivered without the editor-only fields (AD-15).
    const deliveredText = Object.fromEntries(Object.entries(text).filter(([k]) => k !== 'hidden' && k !== 'locked'));
    expect(group.tales[0].document).toEqual({
      ...overlay,
      durationMs: 5000,
      elements: [own(t1, 'video', 'tales/x.mp4'), deliveredText],
    });
    expect(group.tales[0].mediaKeys).toEqual(new Set(['tales/x.mp4']));
    expect(group.tales[1].document).toEqual({
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      durationMs: 5000,
      elements: [own(t2, 'image', 'tales/y.png')],
    });
    expect(group.tales[1].mediaKeys).toEqual(new Set(['tales/y.png']));
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
    expect(found.query.mock.calls[0][0]).toMatch(/\(tales\.status IN \('draft', 'paused'\)\) IS NOT TRUE[\s\S]*\(tales\.starts_at > \$2\) IS NOT TRUE/);
    expect(found.query.mock.calls[0][0]).toMatch(/\(tale_groups\.status IN \('draft', 'paused'\)\) IS NOT TRUE[\s\S]*\(tale_groups\.starts_at > \$2\) IS NOT TRUE/);
    expect(found.query.mock.calls[0][0]).toMatch(/\(tale_groups\.ends_at <= \$2\) IS NOT TRUE/);
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
      { rows: [{}] },
      { rows: [{ name: 'Summer', projectId, startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: null }] },
      { rows: [{ count: 0 }] },
      {
        rows: [
          { id: copyId, projectId: otherProject, name: 'Summer', startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: null },
        ],
      },
      { rows: [] },
      { rows: [] },
      // The copy's documents, read to drop project fonts in the other project (R18): none use one.
      { rows: [{ id: 't9', document: null, draft: null }] },
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
      cover: null,
      position: 3,
      zoneIds: [zoneId],
      ...VIS,
      tales: [{ id: 't9', taleGroupId: copyId, projectId: otherProject, title: 'T', position: 0, ...NO_WINDOW, media: null, ...VIS }],
    });
    // The target project's group lock, then the zone's; the cap counts the target project (R14).
    const locks = query.mock.calls.filter((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(locks.map((c) => c[1])).toEqual([[otherProject], [zoneId]]);
    const count = query.mock.calls.find((c) => /SELECT count\(\*\)::int AS count FROM tale_groups/.test(c[0] as string));
    expect(count?.[1]).toEqual([otherProject]);
    const insertGroup = query.mock.calls.find((c) => /INSERT INTO tale_groups/.test(c[0] as string));
    // The copy keeps the group's and its tales' start and end times.
    // The copy keeps the group's and its tales' start and end times, and shares the source's cover (read by id).
    expect(insertGroup?.[1]).toEqual([otherProject, 'Summer', new Date('2026-11-01T00:00:00Z'), null, groupId.toUpperCase()]);
    const insertTales = query.mock.calls.find((c) => /INSERT INTO tales/.test(c[0] as string));
    // ...and each tale's document (AD-15).
    expect(insertTales?.[0]).toMatch(
      /media_key, media_content_type, status, starts_at, ends_at, document,\s+draft_document, document_media_key, created_at FROM tales/,
    );
    expect(insertTales?.[1]).toEqual([groupId.toUpperCase(), copyId, otherProject]);
    expect(statements().some((s) => /FROM tales WHERE tale_group_id = \$1 FOR SHARE/.test(s))).toBe(true);
    const order = statements();
    expect(order.findIndex((s) => /FOR SHARE/.test(s))).toBeLessThan(order.findIndex((s) => /INSERT INTO tales/.test(s)));
    expect(order.indexOf('SELECT tags')).toBeLessThan(order.indexOf('COMMIT'));
    expect(
      order.some((s) => /SELECT id, document, draft_document AS draft FROM tales WHERE tale_group_id = \$1/.test(s)),
    ).toBe(true);
  });

  it("in the same project, share locks the source's fonts before the copies exist, then records the copies' fonts", async () => {
    const fontId = '0f0e0d0c-0000-4000-8000-00000000000a';
    const branded = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'text',
          box: { x: 0, y: 0.2, w: 1, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { text: 'x', font: { source: 'project', fontId } },
        },
      ],
    };
    const { db, statements, query } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ name: 'A', projectId, startsAt: null, endsAt: null }] },
      { rows: [{ count: 0 }] },
      { rows: [{ id: copyId, projectId, name: 'A', startsAt: null, endsAt: null }] },
      { rows: [] },
      { rows: [{ id: fontId }] },
      { rows: [] },
      { rows: [{ id: 't9', document: branded, draft: branded }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ position: 0 }] },
    ]);
    await copyTaleGroup(db, { taleGroupId: groupId, zoneId });
    const order = statements();
    const lock = order.findIndex((s) => /FROM project_fonts f[\s\S]*FROM tale_fonts tf[\s\S]*FOR SHARE/.test(s));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(order.findIndex((s) => /INSERT INTO tales/.test(s)));
    // The project's group lock comes first of all: before the zone lock, the source row and tales
    // share locks and the font locks (R14), so no copy holds those while waiting on it.
    const projectLock = order.findIndex((s) => /'project_tale_groups:'/.test(s));
    expect(projectLock).toBe(order.indexOf('BEGIN') + 1);
    const later = order.slice(projectLock + 1);
    expect(later.some((s) => /'project_tale_groups:'/.test(s))).toBe(false);
    for (const other of [/'tale_groups:'/, /FROM tale_groups WHERE id = \$1 FOR SHARE/, /FROM tales WHERE tale_group_id = \$1 FOR SHARE/, /FROM project_fonts f/]) {
      expect(order.findIndex((s) => other.test(s))).toBeGreaterThan(projectLock);
    }
    const recorded = query.mock.calls.filter((c) => /^INSERT INTO tale_fonts/.test(c[0] as string)).map((c) => c[1]);
    expect(recorded).toEqual([
      ['t9', 'draft', [fontId], [false]],
      ['t9', 'published', [fontId], [true]],
    ]);
    expect(order.findIndex((s) => /^INSERT INTO tale_fonts/.test(s))).toBeLessThan(order.indexOf('COMMIT'));
  });

  it('rolls the copy back when the callback fails', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ name: 'A' }] },
      { rows: [{ count: 0 }] },
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

  it('refuses a copy into a project at the cap, inserting nothing (R14)', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ name: 'A', projectId, startsAt: null, endsAt: null }] },
      { rows: [{ count: MAX_TALE_GROUPS_PER_PROJECT }] },
    ]);
    const refused = copyTaleGroup(db, { taleGroupId: groupId, zoneId });
    await expect(refused).rejects.toBeInstanceOf(TaleGroupLimitError);
    await expect(refused).rejects.toMatchObject({ code: 'tale_group_limit_reached', projectId });
    await expect(refused).rejects.toThrow('The project of that zone already has 500 tale groups that are not archived');
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
  });

  it('tells whether any tale, cover, document or upload still references a media key', async () => {
    const used = fakeDb([{ rows: [{}] }]);
    expect(await isMediaKeyInUse(used.db, 'tales/a.png')).toBe(true);
    expect(used.query.mock.calls[0][1]).toEqual(['tales/a.png']);
    expect(used.query.mock.calls[0][0]).toMatch(
      /FROM tale_media WHERE storage_key = \$1[\s\S]*FROM project_media WHERE storage_key = \$1/,
    );
    const unused = fakeDb([{ rows: [] }]);
    expect(await isMediaKeyInUse(unused.db, 'tales/a.png')).toBe(false);
  });

  it('decides and deletes under the key lock, in one transaction on one connection', async () => {
    const { db, statements, query } = fakeDb([{ rows: [] }, { rows: [] }]);
    const order: string[] = [];
    const decided = await withMediaKeyDeletionGuard(db, 'tales/a.png', async (inUse) => {
      order.push(`decide ${inUse}`, ...statements());
      return 'deleted';
    });
    expect(decided).toBe('deleted');
    // The lock is taken first, the read follows on the same connection, and the decision runs before COMMIT.
    expect(order).toEqual([
      'decide false',
      'BEGIN',
      expect.stringMatching(/^SELECT pg_advisory_xact_lock\(hashtextextended\('media:' \|\| \$1, 0\)\)/),
      expect.stringMatching(/FROM tales WHERE media_key = \$1/),
    ]);
    expect(statements().at(-1)).toBe('COMMIT');
    expect(query.mock.calls[1][1]).toEqual(['tales/a.png']);
    expect((db.connect as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    const used = fakeDb([{ rows: [] }, { rows: [{}] }]);
    expect(await withMediaKeyDeletionGuard(used.db, 'tales/a.png', async (inUse) => inUse)).toBe(true);
    // A failed delete rolls back, which lets the lock go.
    const failed = fakeDb([]);
    await expect(
      withMediaKeyDeletionGuard(failed.db, 'tales/a.png', async () => Promise.reject(new Error('disk'))),
    ).rejects.toThrow('disk');
    expect(failed.statements()).toContain('ROLLBACK');
  });
});

describe('status', () => {
  const taleId = '00000000-0000-4000-8000-000000000007';
  const row = { id: groupId, projectId, name: 'A', storedStatus: 'live' };

  it('publishes a draft group under a row lock and returns it with its tales and zones', async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [{}] },
      { rows: [{ status: 'draft', projectId }] },
      { rows: [row] },
      { rows: [] },
      { rows: [] },
    ]);
    expect(await setTaleGroupStatus(db, groupId, 'live')).toEqual({ ...row, status: 'live', ...NO_WINDOW, cover: null, zoneIds: [], tales: [], ...VIS });
    expect(statements()).toContain('SELECT status, project_id AS "projectId" FROM tale_groups WHERE id = $1 FOR UPDATE');
    // Not a restore: the cap is not counted.
    expect(statements().some((s) => /count\(\*\)/.test(s))).toBe(false);
    const update = query.mock.calls.find((c) => /UPDATE tale_groups SET status/.test(c[0] as string));
    expect(update?.[1]).toEqual([groupId, 'live']);
    expect(statements()).toContain('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the group already has the status', async () => {
    const { db, statements } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [{}] },
      { rows: [{ status: 'paused', projectId }] },
      { rows: [{ ...row, storedStatus: 'paused' }] },
    ]);
    expect((await setTaleGroupStatus(db, groupId, 'paused')).status).toBe('paused');
    expect(statements().some((s) => /^UPDATE/.test(s))).toBe(false);
  });

  it('refuses a change the transitions do not allow, and rolls back', async () => {
    for (const [from, to] of [
      ['draft', 'paused'],
      ['archived', 'live'],
      ['processing', 'paused'],
    ] as const) {
      const { db, statements } = fakeDb([{ rows: [{ projectId }] }, { rows: [{}] }, { rows: [{ status: from, projectId }] }]);
      const err = await setTaleGroupStatus(db, groupId, to).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidStatusTransitionError);
      expect(err).toMatchObject({ code: 'invalid_status_transition', from, to });
      expect(statements().some((s) => /^UPDATE/.test(s))).toBe(false);
      expect(statements()).toContain('ROLLBACK');
    }
  });

  it('restores an archived group only with a free place, under the project lock taken before the row lock (R14)', async () => {
    const restore = (count: number) =>
      fakeDb([
        { rows: [{ projectId }] },
        { rows: [{}] },
        { rows: [{ status: 'archived', projectId }] },
        { rows: [{ count }] },
        { rows: [{ ...row, storedStatus: 'paused' }] },
      ]);
    const full = restore(MAX_TALE_GROUPS_PER_PROJECT);
    const refused = setTaleGroupStatus(full.db, groupId, 'paused');
    await expect(refused).rejects.toBeInstanceOf(TaleGroupLimitError);
    await expect(refused).rejects.toThrow('Restoring a tale group needs a free place: archive another tale group first.');
    expect(full.statements().some((s) => /^UPDATE/.test(s))).toBe(false);
    expect(full.statements()).toContain('ROLLBACK');
    const order = full.statements();
    const lock = order.findIndex((s) => /'project_tale_groups:'/.test(s));
    expect(full.query.mock.calls.find((c) => /'project_tale_groups:'/.test(c[0] as string))?.[1]).toEqual([projectId]);
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(order.findIndex((s) => /FOR UPDATE/.test(s)));
    expect(order.find((s) => /count\(\*\)/.test(s))).toMatch(/status <> 'archived'/);

    const room = restore(MAX_TALE_GROUPS_PER_PROJECT - 1);
    expect((await setTaleGroupStatus(room.db, groupId, 'paused')).status).toBe('paused');
    expect(room.statements()).toContain('COMMIT');
  });

  it('archives without the project lock or a count: archiving frees a place (R14)', async () => {
    const { db, statements } = fakeDb([{ rows: [{ status: 'live', projectId }] }, { rows: [{ ...row, storedStatus: 'archived' }] }]);
    expect((await setTaleGroupStatus(db, groupId, 'archived')).status).toBe('archived');
    expect(statements().some((s) => /project_tale_groups|count\(\*\)/.test(s))).toBe(false);
  });

  it('refuses an unknown group, and does not query for an id that is not a UUID', async () => {
    const missing = fakeDb([{ rows: [] }]);
    await expect(setTaleGroupStatus(missing.db, groupId, 'live')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    const bad = fakeDb([]);
    await expect(setTaleGroupStatus(bad.db, 'nope', 'live')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
  });

  it('pauses a tale and reads a live tale of a paused group as blocked-by-group', async () => {
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
      ...VIS,
    });
    const update = paused.query.mock.calls.find((c) => /UPDATE tales SET status/.test(c[0] as string));
    expect(update?.[1]).toEqual([taleId, 'paused']);

    const blocked = fakeDb([
      { rows: [{ status: 'paused' }] },
      { rows: [{ ...taleRow, storedStatus: 'live', groupStatus: 'paused' }] },
    ]);
    expect(await setTaleStatus(blocked.db, taleId, 'live')).toMatchObject({ storedStatus: 'live', status: 'blocked-by-group' });
  });

  it('publishes the checked draft when a tale with nothing published goes live, from any status', async () => {
    const row = { id: taleId, mediaContentType: null, storedStatus: 'live', groupStatus: 'live' };
    const draft = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [],
    };
    const publishes = (statements: string[]) => statements.some((s) => /SET document = draft_document/.test(s));
    for (const from of ['draft', 'paused']) {
      const first = fakeDb([
        { rows: [{ status: from, draft, unpublished: true }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [row] },
      ]);
      const tale = await setTaleStatus(first.db, taleId, 'live');
      expect(publishes(first.statements())).toBe(true);
      // The published document's font references are rewritten in the same transaction.
      const fonts = first.query.mock.calls.findIndex((c) => /^DELETE FROM tale_fonts/.test(c[0] as string));
      expect(first.query.mock.calls[fonts]?.[1]).toEqual([taleId, 'published']);
      expect(fonts).toBeLessThan(first.statements().indexOf('COMMIT'));
      expect(first.statements().findIndex((s) => /SET document = draft_document/.test(s))).toBeLessThan(
        first.statements().indexOf('COMMIT'),
      );
      expect(tale).not.toHaveProperty('draftNotPublished');
    }
    // A resume of a tale that already has a published document keeps it.
    const resume = fakeDb([{ rows: [{ status: 'paused', draft, unpublished: false }] }, { rows: [row] }]);
    await setTaleStatus(resume.db, taleId, 'live');
    expect(publishes(resume.statements())).toBe(false);
  });

  it('goes live but keeps a draft that no longer passes unpublished, and says so', async () => {
    const row = { id: taleId, mediaContentType: null, storedStatus: 'live', groupStatus: 'live' };
    const bad = { version: 1, canvas: { background: { type: 'color', color: 'red' } }, elements: [] };
    const { db, statements } = fakeDb([
      { rows: [{ status: 'draft', draft: bad, unpublished: true }] },
      { rows: [row] },
    ]);
    expect(await setTaleStatus(db, taleId, 'live')).toMatchObject({ storedStatus: 'live', draftNotPublished: true });
    expect(statements().some((s) => /SET document = draft_document/.test(s))).toBe(false);
    expect(statements().some((s) => /SET status = \$2/.test(s))).toBe(true);
    expect(statements()).toContain('COMMIT');
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
    await migrateTales({ query } as unknown as DbConnection);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    for (const table of ['tale_groups', 'tales']) {
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS starts_at timestamptz`);
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ends_at timestamptz`);
      expect(sql).toContain(`conname = '${table}_window_check'`);
    }
    expect(sql).toMatch(/CHECK \(starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at\)/);
  });
});

describe('covers', () => {
  const coverRow = { id: groupId, projectId, name: 'A', storedStatus: 'live', startsAt: null, endsAt: null };

  it('reads a group with its cover, the URL derived from the group id and never the key', async () => {
    const { db } = fakeDb([
      { rows: [{ ...coverRow, coverContentType: 'video/webm', coverAnimated: true }] },
      { rows: [] },
      { rows: [] },
    ]);
    const group = await getTaleGroup(db, groupId);
    expect(group.cover).toEqual({
      kind: 'video',
      contentType: 'video/webm',
      animated: true,
      url: `/api/v1/tale-groups/${groupId}/cover`,
    });
    expect(JSON.stringify(group)).not.toMatch(/coverKey|covers\//);
    expect(group).not.toHaveProperty('coverContentType');
    expect(group).not.toHaveProperty('coverAnimated');
  });

  it('reads a group without a cover as cover null, and carries the cover on the project list (R14)', async () => {
    const { db } = fakeDb([
      { rows: [{ ...coverRow, coverContentType: null, coverAnimated: false }] },
      { rows: [] },
      { rows: [] },
    ]);
    expect((await getTaleGroup(db, groupId)).cover).toBeNull();
    const list = fakeDb([
      { rows: [{ ...coverRow, coverContentType: 'image/jpeg', coverAnimated: false, taleCount: 0, shownTaleCount: 0 }] },
      { rows: [] },
    ]);
    const [listed] = await listProjectTaleGroups(list.db, projectId);
    expect(listed.cover).toEqual({ kind: 'image', contentType: 'image/jpeg', animated: false, url: `/api/v1/tale-groups/${groupId}/cover` });
    expect(JSON.stringify(listed)).not.toMatch(/coverKey|covers\//);
    expect(listed.taleCount).toBe(0);
  });

  it('reads the stored cover key, type and motion, null without one, and refuses an unknown group', async () => {
    const { db } = fakeDb([
      { rows: [{ key: 'covers/a.gif', contentType: 'image/gif', animated: true }] },
      { rows: [{ key: null, contentType: null, animated: false }] },
      { rows: [] },
    ]);
    expect(await getTaleGroupCover(db, groupId)).toEqual({ key: 'covers/a.gif', contentType: 'image/gif', animated: true });
    expect(await getTaleGroupCover(db, groupId)).toBeNull();
    await expect(getTaleGroupCover(db, groupId)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
  });

  it('does not query for a group id that is not a UUID', async () => {
    const { db, query } = fakeDb([]);
    await expect(getTaleGroupCover(db, 'nope')).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    await expect(setTaleGroupCover(db, 'nope', null)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(query).not.toHaveBeenCalled();
  });

  it('stores only the key, type and motion under a row lock and returns the previous key', async () => {
    const { db, query } = fakeDb([
      { rows: [{ ...coverRow, coverContentType: 'image/jpeg', coverAnimated: false, previousKey: 'covers/old.webm' }] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await setTaleGroupCover(db, groupId, { key: 'covers/new.jpg', contentType: 'image/jpeg', animated: false });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE tale_groups SET cover_key = \$2[\s\S]*FOR UPDATE/);
    expect(query.mock.calls[0][1]).toEqual([groupId, 'covers/new.jpg', 'image/jpeg', false]);
    expect(result.previousKey).toBe('covers/old.webm');
    expect(result.group.cover).toEqual({
      kind: 'image',
      contentType: 'image/jpeg',
      animated: false,
      url: `/api/v1/tale-groups/${groupId}/cover`,
    });
    expect(result.group).not.toHaveProperty('previousKey');
  });

  it('removes the cover by storing none, and refuses an unknown group', async () => {
    const { db, query } = fakeDb([
      { rows: [{ ...coverRow, coverContentType: null, coverAnimated: false, previousKey: 'covers/a.jpg' }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await setTaleGroupCover(db, groupId, null);
    expect(query.mock.calls[0][1]).toEqual([groupId, null, null, false]);
    expect(result.previousKey).toBe('covers/a.jpg');
    expect(result.group.cover).toBeNull();
    await expect(setTaleGroupCover(db, groupId, null)).rejects.toBeInstanceOf(TaleGroupNotFoundError);
  });

  it('delivers each group with its stored cover key for the public URL', async () => {
    const { db } = fakeDb([
      {
        rows: [{ id: groupId, name: 'A', coverKey: 'covers/a.webm', coverContentType: 'video/webm', coverAnimated: true }],
      },
      { rows: [{ id: 't1', taleGroupId: groupId, title: 'One', key: null, contentType: null }] },
    ]);
    const [group] = await listDeliveryTaleGroups(db, zoneId);
    expect(group.cover).toEqual({ key: 'covers/a.webm', contentType: 'video/webm', animated: true });
  });

  it('finds a cover by key only for a live group in its window with a published tale', async () => {
    const { db, query } = fakeDb([{ rows: [{ contentType: 'image/jpeg' }] }]);
    expect(await findPublishedMedia(db, 'covers/a.jpg')).toEqual({ key: 'covers/a.jpg', contentType: 'image/jpeg' });
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/g\.cover_key = \$1 AND \(\(g\.status = 'archived'\) IS NOT TRUE AND \(g\.status IN \('draft', 'paused'\)\) IS NOT TRUE/);
    expect(sql).toMatch(/\(g\.starts_at > \$2\) IS NOT TRUE/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM tales dt WHERE dt\.tale_group_id = g\.id AND \(\(dt\.status = 'archived'\) IS NOT TRUE/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM zone_tale_groups dz WHERE dz\.tale_group_id = g\.id\)/);
  });

  it('counts a cover as a reference when deciding whether a file is still in use', async () => {
    const { db, query } = fakeDb([{ rows: [{}] }]);
    expect(await isMediaKeyInUse(db, 'covers/a.jpg')).toBe(true);
    expect(query.mock.calls[0][0]).toMatch(/FROM tales WHERE media_key = \$1[\s\S]*FROM tale_groups WHERE cover_key = \$1/);
  });

  it("copies the source's cover columns into the copy, sharing the key", async () => {
    const copyId = '00000000-0000-4000-8000-0000000000cc';
    const { db, query } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{}] },
      { rows: [{ name: 'A', projectId, startsAt: null, endsAt: null }] },
      { rows: [{ count: 0 }] },
      {
        rows: [
          {
            id: copyId,
            projectId,
            name: 'A',
            storedStatus: 'draft',
            startsAt: null,
            endsAt: null,
            coverContentType: 'image/gif',
            coverAnimated: true,
          },
        ],
      },
      { rows: [] },
      // The source's project fonts, share locked (same project).
      { rows: [] },
      { rows: [] },
      // The copies' documents, for their font references: none.
      { rows: [] },
      { rows: [{ position: 0 }] },
    ]);
    const copy = await copyTaleGroup(db, { taleGroupId: groupId, zoneId });
    const insert = query.mock.calls.find((c) => /INSERT INTO tale_groups/.test(c[0] as string));
    expect(insert?.[0]).toMatch(/cover_key, cover_content_type, cover_animated FROM tale_groups WHERE id = \$5/);
    expect(insert?.[1]).toEqual([projectId, 'A', null, null, groupId]);
    expect(copy.cover).toEqual({
      kind: 'image',
      contentType: 'image/gif',
      animated: true,
      url: `/api/v1/tale-groups/${copyId}/cover`,
    });
  });

  it('adds the nullable cover columns and their index, once', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await migrateTales({ query } as unknown as DbConnection);
    const sql = query.mock.calls.map((c) => c[0] as string).join('\n');
    expect(sql).toContain('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_key text');
    expect(sql).toContain('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_content_type text');
    expect(sql).toContain('ALTER TABLE tale_groups ADD COLUMN IF NOT EXISTS cover_animated boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS tale_groups_cover_key_idx ON tale_groups (cover_key)');
  });
});

describe('deleteTale (story 8.20)', () => {
  const taleId = '00000000-0000-4000-8000-000000000004';

  it('locks the group, then the tale, deletes it, renumbers the group and answers the keys it referenced', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ groupId }] },
      { rows: [{}] },
      { rows: [{ projectId, mediaKey: 'tales/a.png' }] },
      { rows: [{ key: 'media/b.png' }, { key: 'tales/a.png' }] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ]);
    expect(await deleteTale(db, taleId)).toEqual({
      taleId,
      taleGroupId: groupId,
      projectId,
      mediaKeys: ['media/b.png', 'tales/a.png'],
    });
    const sql = statements();
    const groupLock = sql.findIndex((s) => /FROM tale_groups WHERE id = \$1 FOR UPDATE/.test(s));
    const taleLock = sql.findIndex((s) => /FROM tales WHERE id = \$1 FOR UPDATE/.test(s));
    const removed = sql.findIndex((s) => /DELETE FROM tales WHERE id = \$1/.test(s));
    const renumber = sql.findIndex((s) => /row_number\(\)/.test(s));
    expect(groupLock).toBeGreaterThan(0);
    expect([groupLock < taleLock, taleLock < removed, removed < renumber]).toEqual([true, true, true]);
    expect(query.mock.calls[renumber][1]).toEqual([groupId]);
    expect(sql).toContain('COMMIT');
  });

  it('refuses an unknown tale, and a tale deleted while it waited for the lock, without deleting', async () => {
    const unknown = fakeDb([{ rows: [] }]);
    await expect(deleteTale(unknown.db, taleId)).rejects.toBeInstanceOf(TaleNotFoundError);
    const raced = fakeDb([{ rows: [{ groupId }] }, { rows: [{}] }, { rows: [] }]);
    await expect(deleteTale(raced.db, taleId)).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(raced.statements().some((s) => /DELETE/.test(s))).toBe(false);
    const notUuid = fakeDb([]);
    await expect(deleteTale(notUuid.db, 'nope')).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(notUuid.query).not.toHaveBeenCalled();
  });
});
