import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  checkThemeContrast,
  CORNER_RADIUS_RANGE,
  cleanThemeSettings,
  contrastRatio,
  DEFAULT_THEME,
  FONT_FAMILY_PATTERN,
  isFontFamily,
  MAX_FONT_FAMILY_LENGTH,
  resolveTheme,
  RING_COLORS_RANGE,
  RING_STYLES,
  RING_WIDTH_RANGE,
  THEME_COLOR_PATTERN,
  THEME_FIELDS,
  themeContrastIssues,
  themeSettingsError,
} from './theme';

describe('theme', () => {
  it('keeps the look host pages had before themes: transparent, host title colour and font, frame radius', () => {
    expect(DEFAULT_THEME).toMatchObject({
      backgroundColor: 'transparent',
      titleColor: null,
      fontFamily: null,
      cornerRadius: null,
      seenRingColor: '#6b7280',
      ringWidth: 2,
      accentColor: '#ffffff',
    });
    // The old gradient, its first stop darkened: #f59e0b was 2.2:1 on white.
    expect(contrastRatio('#f59e0b', '#ffffff')).toBeLessThan(3);
    expect(DEFAULT_THEME.ringColors).toEqual(['#ea580c', '#db2777', '#7c3aed']);
  });

  it('passes WCAG 2.2 AA with the default theme, on white where the background is the host page', () => {
    expect(themeSettingsError(DEFAULT_THEME)).toBeNull();
    expect(themeContrastIssues(DEFAULT_THEME)).toEqual([]);
    expect(themeContrastIssues({ ...DEFAULT_THEME, backgroundColor: '#ffffff', titleColor: '#111827' })).toEqual([]);
  });

  it('accepts a partial theme, an empty one, and null or transparent for host-page values', () => {
    expect(themeSettingsError({})).toBeNull();
    expect(
      themeSettingsError({ ringStyle: 'solid', ringColors: ['#0055FF'], cornerRadius: 0, fontFamily: 'Georgia, serif' }),
    ).toBeNull();
    expect(themeSettingsError({ fontFamily: `"Playfair Display", 'Times New Roman', serif` })).toBeNull();
    expect(themeSettingsError({ titleColor: null, fontFamily: null, cornerRadius: null })).toBeNull();
    expect(themeSettingsError({ backgroundColor: 'transparent' })).toBeNull();
    expect(themeSettingsError({ fontFamily: 'Defaulted Sans, Uninherited' })).toBeNull();
    expect(themeSettingsError({ fontFamily: 'default-font, revert-ish' })).toBeNull();
  });

  it.each([
    [{ titleColor: 'red' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
    [{ titleColor: 'transparent' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
    [{ titleColor: '#12345' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
    [{ titleColor: '#123456;x' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
    [{ backgroundColor: '#fff' }, 'theme.backgroundColor must be a colour as #rrggbb, or transparent'],
    [{ backgroundColor: null }, 'theme.backgroundColor must be a colour as #rrggbb, or transparent'],
    [{ backgroundColor: 'Transparent ' }, 'theme.backgroundColor must be a colour as #rrggbb, or transparent'],
    [{ accentColor: 'url(x)' }, 'theme.accentColor must be a colour as #rrggbb'],
    [{ accentColor: 'transparent' }, 'theme.accentColor must be a colour as #rrggbb'],
    [{ seenRingColor: null }, 'theme.seenRingColor must be a colour as #rrggbb'],
    [{ ringColors: [] }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: ['#000000', '#000000', '#000000', '#000000'] }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: '#000000' }, 'theme.ringColors must hold 1 to 3 colours'],
    [{ ringColors: ['#000000', 'blue'] }, 'theme.ringColors must hold colours as #rrggbb'],
    [{ ringWidth: 5 }, 'theme.ringWidth must be at most 4'],
    [{ ringWidth: 0 }, 'theme.ringWidth must be at least 1'],
    [{ ringWidth: null }, 'theme.ringWidth must be a whole number'],
    [{ ringWidth: 2.5 }, 'theme.ringWidth must be a whole number'],
    [{ ringWidth: '2' }, 'theme.ringWidth must be a whole number'],
    [{ cornerRadius: -1 }, 'theme.cornerRadius must be at least 0'],
    [{ cornerRadius: 33 }, 'theme.cornerRadius must be at most 32'],
    [{ ringStyle: 'dots' }, 'theme.ringStyle must be one of: gradient, solid, none'],
    [{ size: 1 }, 'theme has unknown field "size"'],
    [[], 'theme must be an object'],
    [null, 'theme must be an object'],
  ])('refuses %j', (value, message) => {
    expect(themeSettingsError(value)).toBe(message);
  });

  it.each([
    'a;}b{',
    'url(x)',
    'Arial; color: red',
    'Arial, ',
    '"Arial',
    'a\\62 c',
    'Arial</style>',
    'var(--x)',
    'Arial /* x */',
    '',
    ' ',
    'x'.repeat(MAX_FONT_FAMILY_LENGTH + 1),
    // CSS-wide keywords and `default`, anywhere, in any case, bare or quoted.
    'inherit',
    'INITIAL',
    'Georgia, unset',
    'Georgia, revert, serif',
    'revert-layer',
    'default',
    'My default, serif',
    '"inherit"',
    "Georgia, 'Initial'",
    // A bare name starts with a letter.
    '-apple-system, sans-serif',
    '1font',
    'Georgia, 9serif',
  ])('refuses the font-family %j', (value) => {
    expect(isFontFamily(value)).toBe(false);
    expect(themeSettingsError({ fontFamily: value })).toMatch(/^theme\.fontFamily /);
  });

  it('checks a long font-family quickly', () => {
    for (const value of [`${'a '.repeat(99)}!`, `${'a, '.repeat(66)}!`]) {
      const start = performance.now();
      expect(isFontFamily(value)).toBe(false);
      expect(performance.now() - start).toBeLessThan(50);
    }
  });

  it('resolves stored fields over defaults and drops invalid or unknown ones', () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme([1])).toEqual(DEFAULT_THEME);
    const resolved = resolveTheme({ ringStyle: 'solid', ringWidth: 9, titleColor: 'red;x', cornerRadius: 0, extra: 1 });
    expect(resolved).toEqual({ ...DEFAULT_THEME, ringStyle: 'solid', cornerRadius: 0 });
    expect(resolveTheme({ titleColor: null, backgroundColor: '#000000' })).toEqual({ ...DEFAULT_THEME, backgroundColor: '#000000' });
    expect(cleanThemeSettings({ ringStyle: 'solid', ringWidth: 9, extra: 1 })).toEqual({ ringStyle: 'solid' });
  });

  it('never shares the default ring colours with a resolved theme', () => {
    const resolved = resolveTheme({});
    resolved.ringColors.push('#000000');
    expect(DEFAULT_THEME.ringColors).toHaveLength(3);
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('names each failing colour pair', () => {
    const theme = resolveTheme({
      titleColor: '#cccccc',
      backgroundColor: '#ffffff',
      ringStyle: 'gradient',
      ringColors: ['#000000', '#eeeeee'],
      seenRingColor: '#f0f0f0',
      accentColor: '#111111',
    });
    expect(themeContrastIssues(theme).map((issue) => issue.pair)).toEqual([
      'Title on background',
      'Ring colour 2 on background',
      'Seen ring on background',
      "Accent on the viewer's black",
    ]);
    // Only the first colour draws a solid ring; no ring draws nothing.
    expect(themeContrastIssues({ ...theme, ringStyle: 'solid' }).map((i) => i.pair)).not.toContain('Ring colour 2 on background');
    expect(themeContrastIssues({ ...theme, ringStyle: 'none' }).map((i) => i.field)).toEqual(['titleColor', 'accentColor']);
  });

  it('checks the accent on the progress track and the buttons, not only on black', () => {
    const pairs = themeContrastIssues({ ...DEFAULT_THEME, accentColor: '#808080' }).map((i) => i.pair);
    expect(pairs).toEqual(["Accent on the viewer's progress track", "Accent on the viewer's buttons over light media"]);
  });

  it('skips the pairs whose colour comes from the host page, and says so', () => {
    expect(checkThemeContrast(DEFAULT_THEME).skipped).toEqual([
      'Title on background: both come from the host page',
      'Rings on background: the background is transparent, so it comes from the host page',
    ]);
    expect(checkThemeContrast({ ...DEFAULT_THEME, backgroundColor: '#ffffff' }).skipped).toEqual([
      'Title on background: the title colour comes from the host page',
    ]);
    const onBlack = checkThemeContrast({ ...DEFAULT_THEME, titleColor: '#000000' });
    expect(onBlack.skipped[0]).toBe('Title on background: the background comes from the host page');
    expect(onBlack.issues).toEqual([]);
  });
});

describe('theme schema in the OpenAPI document', () => {
  const doc = parse(readFileSync(join(__dirname, '../../openapi/openapi.yaml'), 'utf8')) as {
    components: { schemas: Record<string, Record<string, unknown>> };
  };
  const schemas = doc.components.schemas;
  const settings = schemas['ThemeSettings'] as { properties: Record<string, Record<string, unknown>>; additionalProperties: boolean };

  it('lists the same fields, defaults and rules as the validator', () => {
    expect(Object.keys(settings.properties)).toEqual(THEME_FIELDS);
    expect(settings.additionalProperties).toBe(false);
    expect((schemas['Theme'] as { required: string[] }).required).toEqual(THEME_FIELDS);
    const defaults = Object.fromEntries(Object.entries(settings.properties).map(([k, v]) => [k, v['default']]));
    expect(defaults).toEqual(DEFAULT_THEME);
    expect(schemas['RingStyle']['enum']).toEqual(RING_STYLES);
    expect(schemas['ThemeColor']['pattern']).toBe(THEME_COLOR_PATTERN.source);
    const p = settings.properties;
    expect(p['titleColor']['pattern']).toBe(THEME_COLOR_PATTERN.source);
    expect(p['titleColor']['type']).toEqual(['string', 'null']);
    expect(p['backgroundColor']['pattern']).toBe('^(?:#[0-9a-fA-F]{6}|transparent)$');
    expect([p['ringColors']['minItems'], p['ringColors']['maxItems']]).toEqual([RING_COLORS_RANGE.min, RING_COLORS_RANGE.max]);
    expect([p['ringWidth']['minimum'], p['ringWidth']['maximum']]).toEqual([RING_WIDTH_RANGE.min, RING_WIDTH_RANGE.max]);
    expect([p['cornerRadius']['minimum'], p['cornerRadius']['maximum']]).toEqual([
      CORNER_RADIUS_RANGE.min,
      CORNER_RADIUS_RANGE.max,
    ]);
    expect(p['cornerRadius']['type']).toEqual(['integer', 'null']);
    expect(p['fontFamily']['pattern']).toBe(FONT_FAMILY_PATTERN.source);
    expect(p['fontFamily']['maxLength']).toBe(MAX_FONT_FAMILY_LENGTH);
    expect(p['fontFamily']['type']).toEqual(['string', 'null']);
  });

  it('agrees with the validator on sample values through the OpenAPI patterns', () => {
    const font = new RegExp(p('fontFamily'));
    const background = new RegExp(p('backgroundColor'));
    for (const value of ['Georgia, serif', 'inherit', '-apple-system', '"Default"', 'a;b']) {
      expect(font.test(value)).toBe(isFontFamily(value));
    }
    for (const value of ['transparent', '#ffffff', '#fff', 'none']) {
      expect(background.test(value)).toBe(themeSettingsError({ backgroundColor: value }) === null);
    }
    function p(field: string): string {
      return settings.properties[field]['pattern'] as string;
    }
  });
});
