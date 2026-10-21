// Types only: the SDK keeps its own copy of the theme rules, so nothing from
// the contract ends up in the bundle (AD-3); a test keeps the copy in step
// with the contract's `DEFAULT_THEME` and `themeSettingsError`.
import type { Theme } from '@taleart/contract';

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
const FONT = new RegExp(
  `^(?!.*(?:^|[\\s,"'])(?:${KEYWORDS.map(anyCase).join('|')})(?=$|[\\s,"']))\\s*${NAME}\\s*(?:,\\s*${NAME}\\s*)*$`,
);

const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value);
const intIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * The theme to render: each field the Delivery API sent when it passes the
 * theme's rules (strict `#rrggbb` colours, `transparent` for the background,
 * bounded integers, a safe font-family list, `null` where the host page's or
 * the frame's own value applies), else TaleArt's default. The API validates on
 * write and fills defaults; the SDK checks again because the values reach CSS.
 * It never logs (story 9 warns about the SDK configuration's own values).
 */
export function readTheme(raw: unknown): Theme {
  const t = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = THEME_DEFAULTS;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(t, key);
  const color = (key: 'seenRingColor' | 'accentColor') => (isColor(t[key]) ? (t[key] as string) : d[key]);
  const ring = t['ringColors'];
  const font = t['fontFamily'];
  const radius = t['cornerRadius'];
  const title = t['titleColor'];
  const bg = t['backgroundColor'];
  return {
    ringStyle: ['gradient', 'solid', 'none'].includes(t['ringStyle'] as string)
      ? (t['ringStyle'] as Theme['ringStyle'])
      : d.ringStyle,
    ringColors:
      Array.isArray(ring) && ring.length >= 1 && ring.length <= 3 && ring.every(isColor) ? [...ring] : [...d.ringColors],
    seenRingColor: color('seenRingColor'),
    ringWidth: intIn(t['ringWidth'], 1, 4) ? t['ringWidth'] : d.ringWidth,
    cornerRadius: intIn(radius, 0, 32) || (has('cornerRadius') && radius === null) ? radius : d.cornerRadius,
    fontFamily:
      (typeof font === 'string' && font.length <= 200 && FONT.test(font)) || (has('fontFamily') && font === null)
        ? font
        : d.fontFamily,
    titleColor: isColor(title) || (has('titleColor') && title === null) ? title : d.titleColor,
    backgroundColor: isColor(bg) || bg === 'transparent' ? bg : d.backgroundColor,
    accentColor: color('accentColor'),
  };
}

/**
 * The CSS custom properties of a theme, each built only from checked values:
 * `--ta-ring` (the unseen ring's background: a gradient through the ring
 * colours, the first colour for `solid`, transparent for `none`),
 * `--ta-seen`, `--ta-ring-width`, `--ta-bg`, `--ta-accent`, and, only when
 * the theme sets them, `--ta-radius`, `--ta-font`, `--ta-title` and
 * `--ta-gap` (the cover's edge in the background colour). A property left out
 * lets the CSS fall back to the host page's value or the frame's own. With
 * ring style `none` no ring shows, seen or not.
 */
export function themeProperties(raw: unknown): Record<string, string> {
  const theme = readTheme(raw);
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
  if (theme.fontFamily !== null) props['--ta-font'] = theme.fontFamily;
  if (theme.titleColor !== null) props['--ta-title'] = theme.titleColor;
  return props;
}

/**
 * Applies a theme to `target` (a wrapper inside the Shadow DOM that holds the
 * frames and the viewer) as CSS custom properties, through
 * `style.setProperty` only: no theme value is ever written into style text.
 */
export function applyTheme(target: HTMLElement, raw: unknown): void {
  const props = themeProperties(raw);
  for (const [name, value] of Object.entries(props)) target.style.setProperty(name, value);
  // Marks a theme title colour, which turns the banner dots into rings of it.
  target.toggleAttribute('data-title', '--ta-title' in props);
}
