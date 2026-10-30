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

  it('reads a theme stored before the colour fields existed with their defaults', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ theme: { ringStyle: 'solid' } }] });
    const theme = await getProjectTheme({ query } as unknown as Db, projectId);
    expect(theme.resolved).toMatchObject({
      colorScheme: 'auto',
      liveColor: null,
      successColor: '#047857',
      errorColor: '#b91c1c',
    });
  });

  it('keeps a stored colour scheme and live colour, and drops invalid ones', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ theme: { colorScheme: 'dark', liveColor: 'red', errorColor: '#00ff00' } }] });
    const theme = await getProjectTheme({ query } as unknown as Db, projectId);
    expect(theme.theme).toEqual({ colorScheme: 'dark', errorColor: '#00ff00' });
    expect(theme.resolved).toMatchObject({ colorScheme: 'dark', liveColor: null, errorColor: '#00ff00' });
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
      new InvalidThemeError("theme.titleColor must be a colour as #rrggbb, or null for the host page's"),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
