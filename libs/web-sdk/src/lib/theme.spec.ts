import { DEFAULT_THEME, isFontFamily, resolveTheme } from '@taleart/contract';
import { applyTheme, readTheme, THEME_DEFAULTS, themeProperties } from './theme';
import { BANNER_STYLES } from './banner';
import { BAR_STYLES } from './bar';
import { VIEWER_STYLES } from './viewer';

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
    { titleColor: 'transparent' },
    { backgroundColor: '#ffffff; background: url(x)' },
    { backgroundColor: null },
    { accentColor: 12 },
    { accentColor: 'transparent' },
    { seenRingColor: 'transparent' },
    { ringColors: [] },
    { ringColors: ['#000000', 'blue'] },
    { ringColors: ['#000000', '#000000', '#000000', '#000000'] },
    { ringWidth: 9 },
    { ringWidth: 0 },
    { ringWidth: 2.5 },
    { ringWidth: null },
    { cornerRadius: 33 },
    { cornerRadius: '0' },
    { ringStyle: 'dots' },
    { fontFamily: 'a;}b{' },
    { fontFamily: 'url(x)' },
    { fontFamily: 'Arial</style>' },
    { fontFamily: 'inherit' },
    { fontFamily: 'Georgia, Unset' },
    { fontFamily: '"default"' },
    { fontFamily: 'revert-layer' },
    { fontFamily: '-apple-system' },
    { fontFamily: '1font' },
    { fontFamily: 'x'.repeat(201) },
  ])('falls back to the default for %j, as the contract does', (raw) => {
    expect(readTheme(raw)).toEqual(DEFAULT_THEME);
    expect(readTheme(raw)).toEqual(resolveTheme(raw));
  });

  it.each(['Georgia, serif', `"Playfair Display", 'Times New Roman', serif`, 'Defaulted Sans', 'inherit', '-x', '"initial"'])(
    'accepts the font-family %j exactly when the contract does',
    (font) => {
      expect(readTheme({ fontFamily: font }).fontFamily === font).toBe(isFontFamily(font));
    },
  );

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
    const host = { titleColor: null, fontFamily: null, cornerRadius: null, backgroundColor: 'transparent' };
    expect(readTheme(host)).toEqual(resolveTheme(host));
  });

  it('builds the custom properties, leaving out what the host page or the frame gives', () => {
    expect(themeProperties({})).toEqual({
      '--ta-ring': 'linear-gradient(45deg, #ea580c, #db2777, #7c3aed)',
      '--ta-seen': '#6b7280',
      '--ta-ring-width': '2px',
      '--ta-bg': 'transparent',
      '--ta-accent': '#ffffff',
    });
    expect(themeProperties({ titleColor: '#000000', fontFamily: 'Georgia', cornerRadius: 0, backgroundColor: '#fafafa' })).toMatchObject({
      '--ta-title': '#000000',
      '--ta-font': 'Georgia',
      '--ta-radius': '0px',
      '--ta-bg': '#fafafa',
      '--ta-gap': '#fafafa',
    });
    expect(themeProperties({ ringStyle: 'solid', ringColors: ['#0055ff', '#000000'] })['--ta-ring']).toBe('#0055ff');
    expect(themeProperties({ ringStyle: 'gradient', ringColors: ['#0055ff'] })['--ta-ring']).toBe('#0055ff');
    const none = themeProperties({ ringStyle: 'none', ringWidth: 3 });
    expect([none['--ta-ring'], none['--ta-seen'], none['--ta-ring-width']]).toEqual(['transparent', 'transparent', '0px']);
  });

  it('sets the properties on the element with setProperty, and marks a theme title colour', () => {
    const el = document.createElement('div');
    applyTheme(el, { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' });
    expect(el.style.getPropertyValue('--ta-ring')).toBe('#0055ff');
    expect(el.style.getPropertyValue('--ta-radius')).toBe('0px');
    expect(el.style.getPropertyValue('--ta-font')).toBe('Georgia, serif');
    expect(el.style.getPropertyValue('--ta-title')).toBe('');
    expect(el.hasAttribute('data-title')).toBe(false);
    applyTheme(el, { titleColor: '#000000' });
    expect(el.getAttribute('data-title')).toBe('');
  });

  it('falls back in CSS to the look before themes when a property is unset', () => {
    expect(BAR_STYLES).toContain('font-family: var(--ta-font, inherit)');
    expect(BAR_STYLES).toContain('color: var(--ta-title, inherit)');
    expect(BAR_STYLES).toContain('background: var(--ta-bg, transparent)');
    expect(BAR_STYLES).toContain('border-radius: var(--ta-radius, calc(var(--ta-size) / 4))');
    expect(BANNER_STYLES).toContain('border-radius: var(--ta-radius, 12px)');
    expect(BANNER_STYLES).toContain('font-family: var(--ta-font, inherit)');
    // The viewer never puts the theme font in the `font` shorthand.
    expect(VIEWER_STYLES).toContain('font-family: var(--ta-font, system-ui, sans-serif)');
    expect(VIEWER_STYLES).not.toMatch(/font:[^;]*var\(--ta-font/);
  });
});
