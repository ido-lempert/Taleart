// The SDK keeps its own copy of the theme rules, so the contract's theme code
// stays out of the bundle (AD-3); a test keeps the copy in step with the
// contract's `DEFAULT_THEME` and `themeSettingsError`. Only the font-list
// quoting comes from the contract, which the text renderer already uses.
import { cssFontFamilyList } from '@taleart/contract';
import type { Theme } from './public-types';

/**
 * TaleArt's default theme, as the contract's `DEFAULT_THEME` (R9): the look
 * host pages had before themes. `null` takes the host page's title colour and
 * font, and the frame's own corner radius.
 */
export const THEME_DEFAULTS: Readonly<Theme> = {
  ringStyle: 'gradient',
  ringColors: ['#ea580c', '#db2777', '#7c3aed'],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: null,
  fontFamily: null,
  titleColor: null,
  backgroundColor: 'transparent',
  accentColor: '#ffffff',
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default'];
const anyCase = (word: string) => word.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const NAME = `(?:[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')`;
// Project fonts' internal names (`taleart-font-<id>`, Tale Studio R18) are reserved: a theme never names one.
const RESERVED = `(?!.*(?:^|[\\s,"'])${anyCase('taleart-font-')})`;
const FONT = new RegExp(
  `^(?!.*(?:^|[\\s,"'])(?:${KEYWORDS.map(anyCase).join('|')})(?=$|[\\s,"']))${RESERVED}\\s*${NAME}\\s*(?:,\\s*${NAME}\\s*)*$`,
);

const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value);
const intIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** Each theme field's rule (R9), as the contract's `themeSettingsError`. */
const CHECKS: { readonly [K in keyof Theme]: (value: unknown) => boolean } = {
  ringStyle: (v) => v === 'gradient' || v === 'solid' || v === 'none',
  ringColors: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every(isColor),
  seenRingColor: isColor,
  ringWidth: (v) => intIn(v, 1, 4),
  cornerRadius: (v) => v === null || intIn(v, 0, 32),
  fontFamily: (v) => v === null || (typeof v === 'string' && v.length <= 200 && FONT.test(v)),
  titleColor: (v) => v === null || isColor(v),
  backgroundColor: (v) => v === 'transparent' || isColor(v),
  accentColor: isColor,
};

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

// A plain, frozen copy of an array, read by index (at most one more than the three colours
// allowed, so an over-long one still fails; a hole reads as undefined and fails), so the value
// checked is the value kept, whatever a Proxy or a custom iterator would answer later.
const copyValue = (value: unknown): unknown =>
  Array.isArray(value) ? Object.freeze(Array.from({ length: Math.min(value.length, 4) }, (_, i) => value[i])) : value;

/**
 * The fields of `raw` that pass the theme's rules (arrays copied first, then
 * checked, then frozen), and the names of the fields that do not: unknown keys
 * and values that fail. A field that is absent or `undefined` is neither.
 */
function themeFields(raw: unknown): { fields: Partial<Theme>; invalid: string[] } {
  const fields: Record<string, unknown> = {};
  const invalid: string[] = [];
  if (!isRecord(raw)) return { fields, invalid };
  for (const key of Object.keys(raw)) {
    const value = copyValue(raw[key]);
    if (value === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(CHECKS, key) && CHECKS[key as keyof Theme](value)) fields[key] = value;
    else invalid.push(key);
  }
  return { fields: fields as Partial<Theme>, invalid };
}

/**
 * The theme to render: each field the Delivery API sent when it passes the
 * theme's rules (strict `#rrggbb` colours, `transparent` for the background,
 * bounded integers, a safe font-family list, `null` where the host page's or
 * the frame's own value applies), else TaleArt's default. The API validates on
 * write and fills defaults; the SDK checks again because the values reach CSS.
 * It never logs: only the SDK configuration's own values warn
 * ({@link readThemeOverride}).
 */
export function readTheme(raw: unknown): Theme {
  return { ...THEME_DEFAULTS, ringColors: [...THEME_DEFAULTS.ringColors], ...themeFields(raw).fields };
}

/**
 * A theme override from the host page's SDK configuration (R9), named by
 * `source` in warnings (such as `the theme of zone "home-top"`): the fields that
 * pass the theme's rules, copied before they are checked and frozen, so later
 * changes to `raw` (or a Proxy's or iterator's other answers) never leak in.
 * Each invalid or unknown field is ignored with one console warning naming it;
 * an override that is not an object is ignored with one warning. `null` and
 * `undefined` mean no override.
 */
export function readThemeOverride(raw: unknown, source: string): Readonly<Partial<Theme>> {
  if (raw === null || raw === undefined) return Object.freeze({});
  if (!isRecord(raw)) {
    console.warn(`TaleArt: ${source} must be an object of theme fields; it is ignored`);
    return Object.freeze({});
  }
  const { fields, invalid } = themeFields(raw);
  for (const key of invalid) console.warn(`TaleArt: ${source} has an invalid or unknown field "${key}"; it is ignored`);
  return Object.freeze(fields);
}

/**
 * The CSS custom properties of a theme, each built only from checked values:
 * `--ta-ring` (the unseen ring's background: a gradient through the ring
 * colours, the first colour for `solid`, transparent for `none`),
 * `--ta-seen`, `--ta-ring-width`, `--ta-bg`, `--ta-accent`, and, only when
 * the theme sets them, `--ta-radius`, `--ta-font`, `--ta-title` and
 * `--ta-gap` (the cover's edge in the background colour). A property left out
 * lets the CSS fall back to the host page's value or the frame's own. With
 * ring style `none` no ring shows, seen or not. `overrides` are checked fields
 * from the SDK configuration ({@link readThemeOverride}), lowest precedence
 * first; each field one sets replaces the delivered theme's. They are checked
 * again here, silently, so no unchecked value can reach CSS.
 */
export function themeProperties(raw: unknown, ...overrides: Partial<Theme>[]): Record<string, string> {
  const theme: Theme = Object.assign(readTheme(raw), ...overrides.map((o) => themeFields(o).fields));
  const none = theme.ringStyle === 'none';
  const [first] = theme.ringColors;
  const ring =
    none ? 'transparent'
    : theme.ringStyle === 'solid' || theme.ringColors.length === 1 ? first
    : `linear-gradient(45deg, ${theme.ringColors.join(', ')})`;
  const props: Record<string, string> = {
    '--ta-ring': ring,
    '--ta-seen': none ? 'transparent' : theme.seenRingColor,
    '--ta-ring-width': `${none ? 0 : theme.ringWidth}px`,
    '--ta-bg': theme.backgroundColor,
    '--ta-accent': theme.accentColor,
  };
  if (theme.backgroundColor !== 'transparent') props['--ta-gap'] = theme.backgroundColor;
  if (theme.cornerRadius !== null) props['--ta-radius'] = `${theme.cornerRadius}px`;
  // Each name quoted, so a name CSS refuses bare (`Source Sans 3`) still applies.
  if (theme.fontFamily !== null) props['--ta-font'] = cssFontFamilyList(theme.fontFamily);
  if (theme.titleColor !== null) props['--ta-title'] = theme.titleColor;
  return props;
}

// The properties a theme may leave out, cleared when a new theme does.
const OPTIONAL = ['--ta-gap', '--ta-radius', '--ta-font', '--ta-title'];

/**
 * Applies a theme, with the SDK configuration's checked overrides (lowest
 * precedence first), to `target` (a wrapper inside the Shadow DOM that holds
 * the frames and the viewer) as CSS custom properties, through
 * `style.setProperty` only: no theme value is ever written into style text.
 * Applying again replaces the previous theme.
 */
export function applyTheme(target: HTMLElement, raw: unknown, ...overrides: Partial<Theme>[]): void {
  const props = themeProperties(raw, ...overrides);
  for (const name of OPTIONAL) if (!(name in props)) target.style.removeProperty(name);
  for (const [name, value] of Object.entries(props)) target.style.setProperty(name, value);
  // Marks a theme title colour, which turns the banner dots into rings of it.
  target.toggleAttribute('data-title', '--ta-title' in props);
}
