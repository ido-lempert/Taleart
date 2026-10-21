import { DEFAULT_THEME } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { getProjectTheme, InvalidThemeError, setProjectTheme } from './theme';

const projectId = '00000000-0000-4000-8000-000000000002';

describe('project theme', () => {
  it('reads a project with no theme as the default theme', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await getProjectTheme({ query } as unknown as Db, projectId)).toEqual({
      projectId,
      theme: {},
      resolved: DEFAULT_THEME,
    });
  });

  it('drops stored fields that fail the schema', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ theme: { ringStyle: 'solid', ringWidth: 9, stray: 1 } }] });
    const theme = await getProjectTheme({ query } as unknown as Db, projectId);
    expect(theme.theme).toEqual({ ringStyle: 'solid' });
    expect(theme.resolved).toEqual({ ...DEFAULT_THEME, ringStyle: 'solid' });
  });

  it('stores a valid theme and answers it resolved', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const settings = { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0 };
    const theme = await setProjectTheme({ query } as unknown as Db, projectId, settings);
    expect(query.mock.calls[0][0]).toMatch(/ON CONFLICT \(project_id\) DO UPDATE/);
    expect(query.mock.calls[0][1]).toEqual([projectId, JSON.stringify(settings)]);
    expect(theme.resolved).toEqual({ ...DEFAULT_THEME, ...settings });
  });

  it('refuses an invalid theme without writing', async () => {
    const query = vi.fn();
    await expect(setProjectTheme({ query } as unknown as Db, projectId, { titleColor: 'red' })).rejects.toThrow(
      new InvalidThemeError('theme.titleColor must be a colour as #rrggbb'),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
