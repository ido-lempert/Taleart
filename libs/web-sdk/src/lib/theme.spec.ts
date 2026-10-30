import { DEFAULT_THEME, isFontFamily, resolveTheme } from '@taleart/contract';
import { applyTheme, onAccent, readableOn, readTheme, readThemeOverride, THEME_DEFAULTS, THEME_SCHEME_STYLES, themeProperties } from './theme';
import { BANNER_STYLES } from './banner';
import { BAR_STYLES } from './bar';
import { VIEWER_STYLES } from './viewer';


function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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
    { fontFamily: 'Georgia, "taleart-font-0f0e0d0c-0000-4000-8000-00000000000a"' },
    { fontFamily: '"default"' },
    { fontFamily: 'revert-layer' },
    { fontFamily: '-apple-system' },
    { fontFamily: '1font' },
    { fontFamily: 'x'.repeat(201) },
    { colorScheme: 'sepia' },
    { colorScheme: 'Dark' },
    { liveColor: '#fff' },
    { liveColor: 'transparent' },
    { successColor: 'green' },
    { errorColor: null },
    { errorColor: '#b91c1c;' },
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
      colorScheme: 'dark',
      liveColor: '#00ff00',
      successColor: '#00aa00',
      errorColor: '#aa0000',
    };
    expect(readTheme(raw)).toEqual(raw);
    expect(readTheme(raw)).toEqual(resolveTheme(raw));
    const host = { titleColor: null, fontFamily: null, cornerRadius: null, backgroundColor: 'transparent' };
    expect(readTheme(host)).toEqual(resolveTheme(host));
  });

  it('builds the custom properties, leaving out what the host page or the frame gives', () => {
    expect(themeProperties({})).toMatchObject({
      '--ta-ring': 'linear-gradient(45deg, #ea580c, #db2777, #7c3aed)',
      '--ta-seen': '#6b7280',
      '--ta-ring-width': '2px',
      '--ta-bg': 'transparent',
      '--ta-accent': '#ffffff',
      '--ta-on-accent': '#111827',
      '--ta-live': '#7c3aed',
      '--ta-success': '#047857',
      '--ta-error': '#b91c1c',
      '--ta-muted': 'color-mix(in srgb, var(--ta-title, currentColor) 65%, transparent)',
      '--ta-surface': 'color-mix(in srgb, var(--ta-title, currentColor) 6%, transparent)',
    });
    expect(Object.keys(themeProperties({})).sort()).toEqual(expect.arrayContaining(['--ta-success-on-dark', '--ta-error-on-dark']));
    expect(themeProperties({ titleColor: '#000000', fontFamily: 'Georgia', cornerRadius: 0, backgroundColor: '#fafafa' })).toMatchObject({
      '--ta-title': '#000000',
      '--ta-font': '"Georgia"',
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
    expect(el.style.getPropertyValue('--ta-font')).toBe('"Georgia", serif');
    expect(el.style.getPropertyValue('--ta-title')).toBe('');
    // A name CSS refuses bare (a word starting with a digit) applies once quoted.
    applyTheme(el, { fontFamily: 'Source Sans 3, sans-serif' });
    expect(el.style.getPropertyValue('--ta-font')).toBe('"Source Sans 3", sans-serif');
    expect(el.hasAttribute('data-title')).toBe(false);
    applyTheme(el, { titleColor: '#000000' });
    expect(el.getAttribute('data-title')).toBe('');
  });

  describe('SDK configuration overrides', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it('keeps the valid fields, copied, and reads null or undefined as no override', () => {
      const ringColors = ['#0000ff'];
      const fields = readThemeOverride({ ringColors, titleColor: null, cornerRadius: undefined }, 'x');
      expect(fields).toEqual({ ringColors: ['#0000ff'], titleColor: null });
      ringColors.push('#ff0000');
      expect(fields.ringColors).toEqual(['#0000ff']);
      expect(readThemeOverride(null, 'x')).toEqual({});
      expect(readThemeOverride(undefined, 'x')).toEqual({});
      expect(warn).not.toHaveBeenCalled();
    });

    it('ignores each invalid or unknown field with one warning naming it and the source', () => {
      const fields = readThemeOverride(
        { ringWidth: 9, fontFamily: 'a;}b{', backgroundColor: 'url(x)', size: 1, accentColor: '#ffcc00' },
        "the element's theme",
      );
      expect(fields).toEqual({ accentColor: '#ffcc00' });
      expect(warn).toHaveBeenCalledTimes(4);
      for (const field of ['ringWidth', 'fontFamily', 'backgroundColor', 'size']) {
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`the element's theme .*"${field}"`)));
      }
    });

    it('checks overrides with the same rules as the delivered theme', () => {
      const raw = { ringWidth: 9, titleColor: '#fff', fontFamily: 'inherit', ringColors: [], cornerRadius: 0 };
      expect(readThemeOverride(raw, 'x')).toEqual({ cornerRadius: 0 });
      expect({ ...readTheme(raw) }).toEqual({ ...DEFAULT_THEME, cornerRadius: 0 });
    });

    it('copies ring colours by index before checking: a Proxy, a custom iterator, a sparse array', () => {
      let reads = 0;
      const proxy = new Proxy(['#0000ff'], {
        get(target, key, receiver) {
          if (key === '0') return ++reads === 1 ? '#0000ff' : 'red;}x{';
          return Reflect.get(target, key, receiver);
        },
      });
      const fromProxy = readThemeOverride({ ringColors: proxy }, 'x');
      expect(fromProxy).toEqual({ ringColors: ['#0000ff'] });
      expect(Object.isFrozen(fromProxy) && Object.isFrozen(fromProxy.ringColors)).toBe(true);
      expect(themeProperties({}, fromProxy)['--ta-ring']).toBe('#0000ff');
      const iterated = Object.assign(['#0000ff'], {
        *[Symbol.iterator]() {
          yield 'url(x)';
        },
      });
      expect(readThemeOverride({ ringColors: iterated }, 'x')).toEqual({ ringColors: ['#0000ff'] });
      expect(readTheme({ ringColors: iterated }).ringColors).toEqual(['#0000ff']);
      expect(warn).not.toHaveBeenCalled();
      for (const sparse of [new Array(1), Object.assign(new Array(2), { 0: '#0000ff' }), [undefined]]) {
        expect(readThemeOverride({ ringColors: sparse }, 'x')).toEqual({});
        expect(readTheme({ ringColors: sparse })).toEqual(resolveTheme({ ringColors: sparse }));
      }
      expect(warn).toHaveBeenCalledTimes(3);
      // A huge array is never copied in full, and still fails.
      expect(readThemeOverride({ ringColors: new Array(1e9) }, 'x')).toEqual({});
    });

    it('checks overrides again when building properties, so an unchecked value never reaches CSS', () => {
      expect(themeProperties({}, { ringColors: ['red;}x{'], ringWidth: 9 } as never)).toMatchObject({
        '--ta-ring': 'linear-gradient(45deg, #ea580c, #db2777, #7c3aed)',
        '--ta-ring-width': '2px',
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(['blue', 3, ['#0000ff'], true])('ignores %j, not an object, with one warning', (raw) => {
      expect(readThemeOverride(raw, 'x')).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('resolves each field from the element, then the zone, then the project, then the default', () => {
      const project = { ringStyle: 'solid', ringColors: ['#ff0000'], ringWidth: 3, accentColor: '#00ff00' };
      const zone = { ringColors: ['#0000ff'], ringWidth: 1 };
      const element = { ringWidth: 4 };
      expect(themeProperties(project, zone, element)).toMatchObject({
        '--ta-ring': '#0000ff',
        '--ta-ring-width': '4px',
        '--ta-accent': '#00ff00',
        '--ta-seen': '#6b7280',
      });
    });

    it('lets an override clear what the project set, and applying again removes stale properties', () => {
      const el = document.createElement('div');
      const project = { titleColor: '#000000', fontFamily: 'Georgia', cornerRadius: 4, backgroundColor: '#fafafa' };
      applyTheme(el, project);
      expect(el.style.getPropertyValue('--ta-title')).toBe('#000000');
      applyTheme(el, project, {
        titleColor: null,
        fontFamily: null,
        cornerRadius: null,
        backgroundColor: 'transparent',
      });
      for (const name of ['--ta-title', '--ta-font', '--ta-radius', '--ta-gap']) {
        expect(el.style.getPropertyValue(name)).toBe('');
      }
      expect(el.style.getPropertyValue('--ta-bg')).toBe('transparent');
      expect(el.hasAttribute('data-title')).toBe(false);
    });
  });

  describe('derived tokens and colour schemes', () => {
    it('derives the muted, surface, live, success and error colours from the theme', () => {
      const props = themeProperties({ titleColor: '#000000', backgroundColor: '#fafafa', liveColor: '#ff0000' });
      expect(props['--ta-title']).toBe('#000000');
      expect(props['--ta-muted']).toBe('color-mix(in srgb, var(--ta-title, currentColor) 65%, transparent)');
      expect(props['--ta-surface']).toBe('#fafafa');
      expect(props['--ta-live']).toBe('#ff0000');
      expect(props['--ta-success']).toBe('#047857');
      expect(props['--ta-error']).toBe('#b91c1c');
      // Without a live colour, the last ring colour; a transparent background derives the surface from the title.
      const ringed = themeProperties({ ringColors: ['#0055ff', '#00aa33'] });
      expect(ringed['--ta-live']).toBe('#00aa33');
      expect(ringed['--ta-surface']).toBe('color-mix(in srgb, var(--ta-title, currentColor) 6%, transparent)');
    });

    it('picks the on-accent colour by contrast: near-black on a light accent, white on a dark one', () => {
      expect(onAccent('#ffffff')).toBe('#111827');
      expect(onAccent('#ffff00')).toBe('#111827');
      expect(onAccent('#111827')).toBe('#ffffff');
      expect(onAccent('#000080')).toBe('#ffffff');
      expect(themeProperties({ accentColor: '#000080' })['--ta-on-accent']).toBe('#ffffff');
    });

    it.each(['#ffffff', '#ffff00', '#111827', '#000080', '#ea580c', '#7c3aed', '#777777'])(
      'gives %s the one of white and near-black with the higher contrast',
      (accent) => {
        const picked = onAccent(accent);
        const other = picked === '#ffffff' ? '#111827' : '#ffffff';
        expect(contrast(picked, accent)).toBeGreaterThanOrEqual(contrast(other, accent));
      },
    );

    it('keeps the default success and error colours at 4.5:1 or more on white', () => {
      expect(contrast(THEME_DEFAULTS.successColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(THEME_DEFAULTS.errorColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });

    it('sets the colour scheme as data-scheme, auto by default, and lets an override force it', () => {
      const el = document.createElement('div');
      applyTheme(el, {});
      expect(el.getAttribute('data-scheme')).toBe('auto');
      applyTheme(el, { colorScheme: 'dark' });
      expect(el.getAttribute('data-scheme')).toBe('dark');
      applyTheme(el, { colorScheme: 'dark' }, { colorScheme: 'light' });
      expect(el.getAttribute('data-scheme')).toBe('light');
    });

    it('draws the two neutral anchors: a forced scheme by data-scheme, auto by prefers-color-scheme', () => {
      expect(THEME_SCHEME_STYLES).toContain('@media (prefers-color-scheme: dark)');
      expect(THEME_SCHEME_STYLES).toContain('.taleart:not([data-scheme="light"]) { --ta-paper: var(--ta-dark);');
      expect(THEME_SCHEME_STYLES).toContain('.taleart[data-scheme="dark"] { --ta-paper: var(--ta-dark);');
      expect(THEME_SCHEME_STYLES).not.toMatch(/#[0-9a-fA-F]{3,6}\b[^;]*\bdata-scheme/);
    });

    it('keeps the quiz marks at 4.5:1 in both schemes: the default colours on white, lightened ones on the dark card', () => {
      const props = themeProperties({});
      expect(contrast(THEME_DEFAULTS.successColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(THEME_DEFAULTS.errorColor, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(props['--ta-success-on-dark'], '#111827')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(props['--ta-error-on-dark'], '#111827')).toBeGreaterThanOrEqual(4.5);
      // A colour that already reads on the dark card is kept as it is.
      expect(readableOn('#ffcc00', '#111827')).toBe('#ffcc00');
      expect(themeProperties({ successColor: '#047857' })['--ta-success-on-dark']).toBe(props['--ta-success-on-dark']);
      expect(THEME_SCHEME_STYLES).toContain('--ta-success-ink: var(--ta-success-on-dark);');
      expect(THEME_SCHEME_STYLES).toContain('--ta-error-ink: var(--ta-error-on-dark);');
    });

    it('takes the colour scheme and the new colours from the SDK configuration, checked', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(readThemeOverride({ colorScheme: 'dark', liveColor: null, successColor: '#00aa00' }, 'x')).toEqual({
        colorScheme: 'dark',
        liveColor: null,
        successColor: '#00aa00',
      });
      expect(readThemeOverride({ colorScheme: 'sepia', errorColor: 'red' }, 'x')).toEqual({});
      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });
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
