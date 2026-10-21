import { DEFAULT_THEME, isFontFamily, resolveTheme } from '@taleart/contract';
import { applyTheme, readTheme, readThemeOverride, THEME_DEFAULTS, themeProperties } from './theme';
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
    { fontFamily: 'Georgia, "taleart-font-0f0e0d0c-0000-4000-8000-00000000000a"' },
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
