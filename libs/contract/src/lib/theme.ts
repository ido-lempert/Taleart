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

/** The theme fields that hold one colour. */
export const THEME_COLOR_FIELDS = ['seenRingColor', 'titleColor', 'backgroundColor', 'accentColor'] as const;

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

const FONT_NAME = `(?:[A-Za-z0-9-][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')`;
/**
 * A CSS font-family list: comma-separated names of letters, digits, spaces and
 * hyphens, each bare or in single or double quotes. No other character
 * (`;`, `{`, `(`, `\`, `/`, `:` …) is accepted, so the value cannot leave a
 * `font-family` declaration.
 */
export const FONT_FAMILY_PATTERN = new RegExp(`^\\s*${FONT_NAME}\\s*(?:,\\s*${FONT_NAME}\\s*)*$`);

/**
 * TaleArt's default theme. It passes WCAG 2.2 AA: titles on the background
 * 17.7:1, ring colours and the seen ring on the background at least 3.5:1,
 * the accent on the viewer's black 21:1.
 */
export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  ringStyle: 'gradient',
  ringColors: Object.freeze(['#ea580c', '#db2777', '#7c3aed']) as unknown as string[],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: 12,
  fontFamily: 'system-ui, sans-serif',
  titleColor: '#111827',
  backgroundColor: '#ffffff',
  accentColor: '#ffffff',
});

/** The viewer's background, which the accent is drawn on. */
export const VIEWER_BACKGROUND = '#000000';

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
      return value.every(isThemeColor) ? null : `${at} must hold colours as #rrggbb`;
    case 'ringWidth':
    case 'cornerRadius': {
      const range = field === 'ringWidth' ? RING_WIDTH_RANGE : CORNER_RADIUS_RANGE;
      if (!Number.isInteger(value)) return `${at} must be a whole number`;
      if ((value as number) < range.min) return `${at} must be at least ${range.min}`;
      if ((value as number) > range.max) return `${at} must be at most ${range.max}`;
      return null;
    }
    case 'fontFamily':
      if (typeof value !== 'string') return `${at} must be a font-family list`;
      if (value.length > MAX_FONT_FAMILY_LENGTH) return `${at} must be at most ${MAX_FONT_FAMILY_LENGTH} characters`;
      return FONT_FAMILY_PATTERN.test(value)
        ? null
        : `${at} must be a list of font names separated by commas (letters, digits, spaces, hyphens and quotes only)`;
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
    const value = stored[field];
    if (Object.prototype.hasOwnProperty.call(stored, field) && isValidThemeValue(field, value)) {
      theme[field] = Array.isArray(value) ? [...value] : value;
    }
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
    if (Object.prototype.hasOwnProperty.call(stored, field) && isValidThemeValue(field, stored[field])) {
      clean[field] = stored[field];
    }
  }
  return clean as ThemeSettings;
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

/**
 * The colour pairs of `theme` that fail WCAG 2.2 AA: titles on the background
 * (4.5:1); each ring colour (unless the ring style is `none`) and the seen
 * ring on the background (3:1); the accent on the viewer's black (3:1).
 */
export function themeContrastIssues(theme: Theme): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const check = (field: ThemeField, pair: string, fg: string, bg: string, minimum: number) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < minimum) issues.push({ field, pair, ratio, minimum });
  };
  const bg = theme.backgroundColor;
  check('titleColor', 'Title on background', theme.titleColor, bg, TEXT_CONTRAST_MIN);
  if (theme.ringStyle !== 'none') {
    const colors = theme.ringStyle === 'solid' ? theme.ringColors.slice(0, 1) : theme.ringColors;
    colors.forEach((color, i) =>
      check('ringColors', `Ring colour ${i + 1} on background`, color, bg, GRAPHICS_CONTRAST_MIN),
    );
    check('seenRingColor', 'Seen ring on background', theme.seenRingColor, bg, GRAPHICS_CONTRAST_MIN);
  }
  check('accentColor', "Accent on the viewer's black", theme.accentColor, VIEWER_BACKGROUND, GRAPHICS_CONTRAST_MIN);
  return issues;
}
