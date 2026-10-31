import type { Db } from '@taleart/server-access';
import { createZone, InvalidZoneError, listZones, ProjectNotFoundError, SlugTakenError, updateZone } from './zones';

describe('createZone', () => {
  it('refuses a project that does not exist without inserting', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const db = { query } as unknown as Db;
    const projectId = '00000000-0000-4000-8000-000000000000';

    await expect(createZone(db, { name: 'Home', projectId })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).not.toMatch(/INSERT/);
  });

  // A pool where the `taken` slugs exist in the project, and INSERT … ON CONFLICT DO NOTHING writes no row for them.
  function slugDb(taken: string[]): Db {
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM projects/.test(sql)) return { rowCount: 1, rows: [{}] };
      if (/^SELECT slug FROM zones/.test(sql)) return { rows: taken.map((slug) => ({ slug })) };
      if (/^INSERT INTO zones/.test(sql)) {
        return { rows: taken.includes(params[2] as string) ? [] : [{ id: 'z', name: params[0], slug: params[2] }] };
      }
      return { rows: [] };
    });
    return { query } as unknown as Db;
  }

  it('makes the slug from the name, with a numeric suffix when it is taken', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    expect((await createZone(slugDb([]), { name: 'Home page!', projectId })).slug).toBe('home-page');
    expect((await createZone(slugDb(['home-page', 'home-page-2']), { name: 'Home page', projectId })).slug).toBe(
      'home-page-3',
    );
    expect((await createZone(slugDb([]), { name: '***', projectId })).slug).toBe('zone');
  });

  it('refuses a given slug that is not a slug, or is taken, without inserting it', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    for (const slug of ['Home', 'home top', '', 3]) {
      await expect(createZone(slugDb([]), { name: 'Home', projectId, slug })).rejects.toBeInstanceOf(InvalidZoneError);
    }
    await expect(createZone(slugDb(['home']), { name: 'Home', projectId, slug: 'home' })).rejects.toBeInstanceOf(
      SlugTakenError,
    );
  });
});

describe('updateZone', () => {
  const zoneId = '00000000-0000-4000-8000-00000000000a';

  it('refuses an empty change, a blank name and a bad slug before querying', async () => {
    const query = vi.fn();
    const db = { query } as unknown as Db;
    for (const input of [{}, { name: '  ' }, { name: 3 }, { slug: 'Home Top' }]) {
      await expect(updateZone(db, zoneId, input)).rejects.toBeInstanceOf(InvalidZoneError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('turns a clash on the slug index into SlugTakenError', async () => {
    const query = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505', constraint: 'zones_project_id_slug_key' }));
    await expect(updateZone({ query } as unknown as Db, zoneId, { slug: 'home' })).rejects.toBeInstanceOf(SlugTakenError);
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
