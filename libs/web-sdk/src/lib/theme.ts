// Types only: the SDK keeps its own copy of the theme rules, so nothing from
// the contract ends up in the bundle (AD-3); a test keeps the copy in step
// with the contract's `DEFAULT_THEME` and `themeSettingsError`.
import type { Theme } from '@taleart/contract';

/** TaleArt's default theme, as the contract's `DEFAULT_THEME` (R9): it passes WCAG 2.2 AA. */
export const THEME_DEFAULTS: Readonly<Theme> = {
  ringStyle: 'gradient',
  ringColors: ['#ea580c', '#db2777', '#7c3aed'],
  seenRingColor: '#6b7280',
  ringWidth: 2,
  cornerRadius: 12,
  fontFamily: 'system-ui, sans-serif',
  titleColor: '#111827',
  backgroundColor: '#ffffff',
  accentColor: '#ffffff',
};

const COLOR = /^#[0-9a-fA-F]{6}$/;
const NAME = `(?:[A-Za-z0-9-][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')`;
const FONT = new RegExp(`^\\s*${NAME}\\s*(?:,\\s*${NAME}\\s*)*$`);

const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value);
const intIn = (value: unknown, min: number, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * The theme to render: each field the Delivery API sent when it passes the
 * theme's rules (strict `#rrggbb` colours, bounded integers, a safe
 * font-family list), else TaleArt's default. The API validates on write and
 * fills defaults; the SDK checks again because the values reach CSS. It
 * never logs (story 9 warns about the SDK configuration's own values).
 */
export function readTheme(raw: unknown): Theme {
  const t = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = THEME_DEFAULTS;
  const color = (key: 'seenRingColor' | 'titleColor' | 'backgroundColor' | 'accentColor') =>
    isColor(t[key]) ? (t[key] as string) : d[key];
  const ring = t['ringColors'];
  const font = t['fontFamily'];
  return {
    ringStyle: ['gradient', 'solid', 'none'].includes(t['ringStyle'] as string)
      ? (t['ringStyle'] as Theme['ringStyle'])
      : d.ringStyle,
    ringColors:
      Array.isArray(ring) && ring.length >= 1 && ring.length <= 3 && ring.every(isColor) ? [...ring] : [...d.ringColors],
    seenRingColor: color('seenRingColor'),
    ringWidth: intIn(t['ringWidth'], 1, 4) ? t['ringWidth'] : d.ringWidth,
    cornerRadius: intIn(t['cornerRadius'], 0, 32) ? t['cornerRadius'] : d.cornerRadius,
    fontFamily: typeof font === 'string' && font.length <= 200 && FONT.test(font) ? font : d.fontFamily,
    titleColor: color('titleColor'),
    backgroundColor: color('backgroundColor'),
    accentColor: color('accentColor'),
  };
}

/**
 * The CSS custom properties of a theme, each built only from checked values:
 * `--ta-ring` (the unseen ring's background: a gradient through the ring
 * colours, the first colour for `solid`, transparent for `none`),
 * `--ta-seen`, `--ta-ring-width`, `--ta-radius`, `--ta-font`, `--ta-title`,
 * `--ta-bg` and `--ta-accent`. With ring style `none` no ring shows, seen
 * or not.
 */
export function themeProperties(raw: unknown): Record<string, string> {
  const theme = readTheme(raw);
  const none = theme.ringStyle === 'none';
  const [first] = theme.ringColors;
  const ring =
    none ? 'transparent'
    : theme.ringStyle === 'solid' || theme.ringColors.length === 1 ? first
    : `linear-gradient(45deg, ${theme.ringColors.join(', ')})`;
  return {
    '--ta-ring': ring,
    '--ta-seen': none ? 'transparent' : theme.seenRingColor,
    '--ta-ring-width': `${none ? 0 : theme.ringWidth}px`,
    '--ta-radius': `${theme.cornerRadius}px`,
    '--ta-font': theme.fontFamily,
    '--ta-title': theme.titleColor,
    '--ta-bg': theme.backgroundColor,
    '--ta-accent': theme.accentColor,
  };
}

/**
 * Applies a theme to `target` (a wrapper inside the Shadow DOM that holds the
 * frames and the viewer) as CSS custom properties, through
 * `style.setProperty` only: no theme value is ever written into style text.
 */
export function applyTheme(target: HTMLElement, raw: unknown): void {
  for (const [name, value] of Object.entries(themeProperties(raw))) target.style.setProperty(name, value);
}
