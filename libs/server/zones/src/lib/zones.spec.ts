import type { Db } from '@taleart/server-access';
import { createZone, ProjectNotFoundError } from './zones';

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
