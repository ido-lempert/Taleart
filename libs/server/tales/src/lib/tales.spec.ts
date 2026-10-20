import {
  createTale,
  createTaleGroup,
  listTaleGroups,
  TaleGroupFullError,
  TaleGroupNotFoundError,
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
      { rows: [{ id: 't1' }] },
    ]);
    await createTale(db, { taleGroupId: groupId, title: 'T' });
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[1]).toEqual([groupId, projectId, 'T', 2]);
  });
});
