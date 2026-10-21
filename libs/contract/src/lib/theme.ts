// The project theme (epic web zones R9): its fields, TaleArt's default theme,
// the one validator the API and the dashboard share, and the WCAG contrast
// checks the dashboard warns with. The OpenAPI `ThemeSettings` schema states
// the same rules; a contract test keeps the two in step.
import type { components } from '../generated/api';

type Schemas = components['schemas'];

/** A complete theme: every field filled. */
export type Theme = Schemas['Theme'];
/** The theme fields a project sets; a field left out takes {@link DEFAULT_THEME}'s value. */
export type ThemeSettings = Partial<Theme>;
/** How the unseen ring is drawn. */
export type RingStyle = Schemas['RingStyle'];
/** The theme fields, in the order the dashboard shows them. */
export type ThemeField = keyof Theme;

/** Every ring style. */
export const RING_STYLES: readonly RingStyle[] = ['gradient', 'solid', 'none'];

/** Every theme field, in display order. */
export const THEME_FIELDS: readonly ThemeField[] = [
  'ringStyle',
  'ringColors',
  'seenRingColor',
  'ringWidth',
  'cornerRadius',
  'fontFamily',
  'titleColor',
  'backgroundColor',
  'accentColor',
];

/** A colour: `#rrggbb` and nothing else. */
export const THEME_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** How many ring colours a theme holds. */
export const RING_COLORS_RANGE = { min: 1, max: 3 } as const;
/** The ring's width in px. */
export const RING_WIDTH_RANGE = { min: 1, max: 4 } as const;
/** The corner radius in px. */
export const CORNER_RADIUS_RANGE = { min: 0, max: 32 } as const;
/** The longest font-family list. */
export const MAX_FONT_FAMILY_LENGTH = 200;

/** CSS-wide keywords and `default`: never a font name, bare or quoted. */
export const FONT_FAMILY_KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'] as const;

// A word in any letter case, as a character class per letter: JSON Schema patterns take no flags.
const anyCase = (word: string) => word.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
// Built by a function marked pure, so bundlers drop it where nothing reads the pattern.
const noKeyword = () => `(?!.*(?:^|[\\s,"'])(?:${FONT_FAMILY_KEYWORDS.map(anyCase).join('|')})(?=$|[\\s,"']))`;
const FONT_NAME = `(?:[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')`;
/**
 * A CSS font-family list: comma-separated names of letters, digits, spaces and
 * hyphens, each bare (starting with a letter) or in single or double quotes,
 * and no CSS-wide keyword or `default` as a word anywhere. No other character
 * (`;`, `{`, `(`, a backslash, `/`, `:` …) is accepted, so the value cannot leave a
 * `font-family` declaration.
 */
export const FONT_FAMILY_PATTERN = /* @__PURE__ */ new RegExp(
  `^${/* @__PURE__ */ noKeyword()}\\s*${FONT_NAME}\\s*(?:,\\s*${FONT_NAME}\\s*)*$`,
);

/** The background value that lets the host page show through. */
export const TRANSPARENT = 'transparent';

/**
 * TaleArt's default theme: the look host pages had before themes. The
 * background is transparent and the title colour, font and corner radius
 * come from the host page or the frame (`null`); the ring keeps its old
 * gradient except the first stop, darkened from `#f59e0b` (2.2:1 on white) to
 * `#ea580c` (3.6:1). On white, every ring colour and the seen ring pass 3:1;
 * the accent passes 3:1 on black and on the viewer's track and buttons.
 */
export const DEFAULT_THEME: Readonly<Theme> = /* @__PURE__ */ Object.freeze({
  ringStyle: 'gradient',
  ringColors: /* @__PURE__ */ Object.freeze(['#ea580c', '#db2777', '#7c3aed']) as unknown as string[],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: null,
  fontFamily: null,
  titleColor: null,
  backgroundColor: TRANSPARENT,
  accentColor: '#ffffff',
});

/** The fields whose `null` takes the host page's or the frame's own value. */
export const NULLABLE_THEME_FIELDS = ['cornerRadius', 'fontFamily', 'titleColor'] as const;

/** The viewer's background, which the accent is drawn on. */
export const VIEWER_BACKGROUND = '#000000';
/**
 * The viewer's progress track (white at 40 % on black) and, at worst, its
 * buttons (black at 60 % over white media): both about `#666666`.
 */
export const VIEWER_TRACK = '#666666';
export const VIEWER_BUTTON_ON_LIGHT_MEDIA = '#666666';

/** True when `value` is a `#rrggbb` colour. */
export function isThemeColor(value: unknown): value is string {
  return typeof value === 'string' && THEME_COLOR_PATTERN.test(value);
}

/** True when `value` is a font-family list the theme accepts. */
export function isFontFamily(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_FONT_FAMILY_LENGTH && FONT_FAMILY_PATTERN.test(value);
}

// Why one field's value is refused, or null when it is valid.
function fieldError(field: ThemeField, value: unknown): string | null {
  const at = `theme.${field}`;
  switch (field) {
    case 'ringStyle':
      return (RING_STYLES as readonly unknown[]).includes(value) ? null : `${at} must be one of: ${RING_STYLES.join(', ')}`;
    case 'ringColors':
      if (!Array.isArray(value) || value.length < RING_COLORS_RANGE.min || value.length > RING_COLORS_RANGE.max) {
        return `${at} must hold ${RING_COLORS_RANGE.min} to ${RING_COLORS_RANGE.max} colours`;
      }
      // By index, not `every`, so a hole in a sparse array is checked (and refused) too.
      for (let i = 0; i < value.length; i++) {
        if (!isThemeColor(value[i])) return `${at} must hold colours as #rrggbb`;
      }
      return null;
    case 'cornerRadius':
    case 'ringWidth': {
      if (field === 'cornerRadius' && value === null) return null;
      const range = field === 'ringWidth' ? RING_WIDTH_RANGE : CORNER_RADIUS_RANGE;
      if (!Number.isInteger(value)) return `${at} must be a whole number`;
      if ((value as number) < range.min) return `${at} must be at least ${range.min}`;
      if ((value as number) > range.max) return `${at} must be at most ${range.max}`;
      return null;
    }
    case 'fontFamily':
      if (value === null) return null;
      if (typeof value !== 'string') return `${at} must be a font-family list`;
      if (value.length > MAX_FONT_FAMILY_LENGTH) return `${at} must be at most ${MAX_FONT_FAMILY_LENGTH} characters`;
      return FONT_FAMILY_PATTERN.test(value)
        ? null
        : `${at} must be a list of font names separated by commas (letters, digits, spaces, hyphens and quotes; a bare name starts with a letter; no CSS-wide keyword or "default")`;
    case 'titleColor':
      return value === null || isThemeColor(value) ? null : `${at} must be a colour as #rrggbb, or null for the host page's`;
    case 'backgroundColor':
      return value === TRANSPARENT || isThemeColor(value) ? null : `${at} must be a colour as #rrggbb, or transparent`;
    default:
      return isThemeColor(value) ? null : `${at} must be a colour as #rrggbb`;
  }
}

/** True when `value` is a valid value of `field`. */
export function isValidThemeValue(field: ThemeField, value: unknown): boolean {
  return fieldError(field, value) === null;
}

/**
 * Why `value` is not a valid {@link ThemeSettings}, naming the field
 * (`theme.ringWidth must be at most 4`), or null when it is valid.
 */
export function themeSettingsError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'theme must be an object';
  for (const key of Object.keys(value)) {
    if (!(THEME_FIELDS as readonly string[]).includes(key)) return `theme has unknown field "${key}"`;
  }
  for (const field of THEME_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const error = fieldError(field, (value as Record<string, unknown>)[field]);
    if (error) return error;
  }
  return null;
}

/**
 * A complete theme from stored or delivered fields: each valid field as it
 * is, every missing or invalid one from {@link DEFAULT_THEME}. Anything that
 * is not an object reads as `{}`.
 */
export function resolveTheme(settings: unknown): Theme {
  const stored =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const theme = { ...DEFAULT_THEME, ringColors: [...DEFAULT_THEME.ringColors] } as Record<string, unknown>;
  for (const field of THEME_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(stored, field)) continue;
    const value = copyValue(stored[field]);
    if (isValidThemeValue(field, value)) theme[field] = value;
  }
  return theme as Theme;
}

/** Only the valid theme fields of a stored value; invalid and unknown ones are dropped. */
export function cleanThemeSettings(settings: unknown): ThemeSettings {
  const stored =
    typeof settings === 'object' && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const clean: Record<string, unknown> = {};
  for (const field of THEME_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(stored, field)) continue;
    const value = copyValue(stored[field]);
    if (isValidThemeValue(field, value)) clean[field] = value;
  }
  return clean as ThemeSettings;
}

// A plain copy of an array, read by index (at most one more than the colours allowed, so an
// over-long one still fails), checked after copying so the checked value is the one kept.
function copyValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const length = Math.min(value.length, RING_COLORS_RANGE.max + 1);
  return Array.from({ length }, (_, i) => value[i]);
}

// The relative luminance of a #rrggbb colour (WCAG 2.2).
function luminance(color: string): number {
  const channel = (i: number) => {
    const v = parseInt(color.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 AA minimums: text (1.4.3) and graphics and controls (1.4.11). */
export const TEXT_CONTRAST_MIN = 4.5;
export const GRAPHICS_CONTRAST_MIN = 3;

/** A colour pair of a theme that fails its WCAG 2.2 AA minimum. */
export interface ContrastIssue {
  /** The field whose colour is drawn on the other. */
  field: ThemeField;
  /** What is drawn on what, such as "Title on background". */
  pair: string;
  ratio: number;
  minimum: number;
}

/** The contrast checks of a theme: the pairs that fail, and the pairs not checked because a colour comes from the host page. */
export interface ThemeContrast {
  issues: ContrastIssue[];
  /** Why a pair was not checked, such as "Title on background: both come from the host page". */
  skipped: string[];
}

/**
 * Checks the colour pairs of `theme` against WCAG 2.2 AA: titles on the
 * background (4.5:1); each ring colour drawn (none for ring style `none`, the
 * first for `solid`) and the seen ring on the background (3:1); the accent on
 * the viewer's black, on its progress track and on its buttons over light
 * media (3:1). A pair whose colour comes from the host page (a title colour
 * of `null`, a `transparent` background) cannot be checked here and is listed
 * in `skipped`. Focus rings need no check: the SDK draws them in two colours
 * (dark outline, white inner ring), so one of them always contrasts.
 */
export function checkThemeContrast(theme: Theme): ThemeContrast {
  const issues: ContrastIssue[] = [];
  const skipped: string[] = [];
  const check = (field: ThemeField, pair: string, fg: string, bg: string, minimum: number) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < minimum) issues.push({ field, pair, ratio, minimum });
  };
  const bg = theme.backgroundColor === TRANSPARENT ? null : theme.backgroundColor;
  if (theme.titleColor === null || bg === null) {
    const from =
      theme.titleColor === null && bg === null
        ? 'both come'
        : theme.titleColor === null
          ? 'the title colour comes'
          : 'the background comes';
    skipped.push(`Title on background: ${from} from the host page`);
  } else {
    check('titleColor', 'Title on background', theme.titleColor, bg, TEXT_CONTRAST_MIN);
  }
  if (theme.ringStyle !== 'none') {
    if (bg === null) {
      skipped.push('Rings on background: the background is transparent, so it comes from the host page');
    } else {
      const colors = theme.ringStyle === 'solid' ? theme.ringColors.slice(0, 1) : theme.ringColors;
      colors.forEach((color, i) =>
        check('ringColors', `Ring colour ${i + 1} on background`, color, bg, GRAPHICS_CONTRAST_MIN),
      );
      check('seenRingColor', 'Seen ring on background', theme.seenRingColor, bg, GRAPHICS_CONTRAST_MIN);
    }
  }
  check('accentColor', "Accent on the viewer's black", theme.accentColor, VIEWER_BACKGROUND, GRAPHICS_CONTRAST_MIN);
  check('accentColor', "Accent on the viewer's progress track", theme.accentColor, VIEWER_TRACK, GRAPHICS_CONTRAST_MIN);
  check(
    'accentColor',
    "Accent on the viewer's buttons over light media",
    theme.accentColor,
    VIEWER_BUTTON_ON_LIGHT_MEDIA,
    GRAPHICS_CONTRAST_MIN,
  );
  return { issues, skipped };
}

/** The colour pairs of `theme` that fail WCAG 2.2 AA; see {@link checkThemeContrast}. */
export function themeContrastIssues(theme: Theme): ContrastIssue[] {
  return checkThemeContrast(theme).issues;
}
