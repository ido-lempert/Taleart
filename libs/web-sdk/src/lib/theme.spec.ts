import { DEFAULT_THEME, resolveTheme } from '@taleart/contract';
import { applyTheme, readTheme, THEME_DEFAULTS, themeProperties } from './theme';

describe('theme', () => {
  it("keeps TaleArt's default theme in step with the contract", () => {
    expect(THEME_DEFAULTS).toEqual(DEFAULT_THEME);
  });

  it('reads a missing or broken theme as the default, without logging', () => {
    const spies = (['error', 'warn', 'log'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    for (const raw of [undefined, null, 'x', [], {}]) expect(readTheme(raw)).toEqual(DEFAULT_THEME);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it.each([
    { titleColor: 'red;x' },
    { titleColor: '#fff' },
    { backgroundColor: '#ffffff; background: url(x)' },
    { accentColor: 12 },
    { seenRingColor: 'transparent' },
    { ringColors: [] },
    { ringColors: ['#000000', 'blue'] },
    { ringColors: ['#000000', '#000000', '#000000', '#000000'] },
    { ringWidth: 9 },
    { ringWidth: 0 },
    { ringWidth: 2.5 },
    { cornerRadius: 33 },
    { cornerRadius: '0' },
    { ringStyle: 'dots' },
    { fontFamily: 'a;}b{' },
    { fontFamily: 'url(x)' },
    { fontFamily: 'Arial</style>' },
    { fontFamily: 'x'.repeat(201) },
  ])('falls back to the default for %j, as the contract does', (raw) => {
    expect(readTheme(raw)).toEqual(DEFAULT_THEME);
    expect(readTheme(raw)).toEqual(resolveTheme(raw));
  });

  it('keeps every valid field, as the contract does', () => {
    const raw = {
      ringStyle: 'solid',
      ringColors: ['#0055FF'],
      seenRingColor: '#333333',
      ringWidth: 4,
      cornerRadius: 0,
      fontFamily: `Georgia, "Times New Roman", serif`,
      titleColor: '#000000',
      backgroundColor: '#fafafa',
      accentColor: '#ffcc00',
    };
    expect(readTheme(raw)).toEqual(raw);
    expect(readTheme(raw)).toEqual(resolveTheme(raw));
  });

  it('builds the custom properties of a gradient, solid and no ring', () => {
    expect(themeProperties({})).toEqual({
      '--ta-ring': 'linear-gradient(45deg, #ea580c, #db2777, #7c3aed)',
      '--ta-seen': '#6b7280',
      '--ta-ring-width': '2px',
      '--ta-radius': '12px',
      '--ta-font': 'system-ui, sans-serif',
      '--ta-title': '#111827',
      '--ta-bg': '#ffffff',
      '--ta-accent': '#ffffff',
    });
    expect(themeProperties({ ringStyle: 'solid', ringColors: ['#0055ff', '#000000'] })['--ta-ring']).toBe('#0055ff');
    expect(themeProperties({ ringStyle: 'gradient', ringColors: ['#0055ff'] })['--ta-ring']).toBe('#0055ff');
    const none = themeProperties({ ringStyle: 'none', ringWidth: 3 });
    expect([none['--ta-ring'], none['--ta-seen'], none['--ta-ring-width']]).toEqual(['transparent', 'transparent', '0px']);
  });

  it('sets the properties on the element with setProperty', () => {
    const el = document.createElement('div');
    applyTheme(el, { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' });
    expect(el.style.getPropertyValue('--ta-ring')).toBe('#0055ff');
    expect(el.style.getPropertyValue('--ta-radius')).toBe('0px');
    expect(el.style.getPropertyValue('--ta-font')).toBe('Georgia, serif');
    expect(el.style.getPropertyValue('--ta-title')).toBe('#111827');
  });
});
