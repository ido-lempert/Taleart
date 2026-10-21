import type { Db } from '@taleart/server-access';
import { createZone, listZones, ProjectNotFoundError, renameZoneWhen } from './zones';

describe('createZone', () => {
  it('refuses a project that does not exist without inserting', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const db = { query } as unknown as Db;
    const projectId = '00000000-0000-4000-8000-000000000000';

    await expect(createZone(db, { name: 'Home', projectId })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toMatch(/INSERT/);
  });
});

describe('listZones', () => {
  it('lists only the zones of the projects in scope', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listZones({ query } as unknown as Db, ['p1']);
    expect(query.mock.calls[0][0]).toMatch(/project_id = ANY/);
    expect(query.mock.calls[0][1]).toEqual([['p1']]);
  });
});

describe('renameZoneWhen', () => {
  const zoneId = '00000000-0000-4000-8000-00000000000a';

  it('locks the row, hands the current name to decide, and writes only a new name', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ name: 'Home' }] });
    const db = { query } as unknown as Db;
    expect(await renameZoneWhen(db, zoneId, (current) => `${current} page`)).toEqual({
      before: 'Home',
      after: 'Home page',
    });
    expect(query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(query.mock.calls[1]).toEqual(['UPDATE zones SET name = $2 WHERE id = $1', [zoneId, 'Home page']]);

    query.mockClear();
    expect(await renameZoneWhen(db, zoneId, () => null)).toEqual({ before: 'Home', after: 'Home' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('answers null for a zone that does not exist, or an id that is not a UUID', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const decide = vi.fn(() => 'x');
    expect(await renameZoneWhen({ query } as unknown as Db, zoneId, decide)).toBeNull();
    expect(await renameZoneWhen({ query } as unknown as Db, 'nope', decide)).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
