import type { Db } from './db';
import { projectExists } from './projects';

describe('projectExists', () => {
  it('does not query for ids that are not UUIDs', async () => {
    const query = vi.fn();
    expect(await projectExists({ query } as unknown as Db, 'not-a-uuid')).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('reports whether the row exists', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const found = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) } as unknown as Db;
    const missing = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) } as unknown as Db;
    expect(await projectExists(found, id)).toBe(true);
    expect(await projectExists(missing, id)).toBe(false);
  });
});
