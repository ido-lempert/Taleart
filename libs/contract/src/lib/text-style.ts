// How a text element looks (epic Tale Studio R4, R12; AD-15, AD-16): the font registry, the
// style props' presets and ranges, their defaults, and the helpers Tale Studio and the Web SDK
// share, so both draw a text the same way. `tale-document/element-types/text.schema.json` states
// the same rules for validators; a contract test keeps the two in step.
import type { components } from '../generated/api';
import { isFontId, projectFontAlias } from './project-fonts';
import {
  buttonFontSize,
  elementBounds,
  resolveButtonStyle,
  resolveShapeStyle,
  resolveSwipeUpStyle,
  SWIPE_UP_FONT_SIZE,
  TALE_CANVAS_ASPECT,
  type CanvasRect,
  type TaleElementBox,
} from './tale-document';
import { contrastRatio, isFontFamily, TEXT_CONTRAST_MIN } from './theme';

type Props = components['schemas']['TextElementProps'];

/** A key of the font registry's system stacks. */
export type SystemFontStack = NonNullable<Props['fallback']>;

/**
 * Where a text's font comes from (R4): a system stack, the project theme's font, a font-family list
 * the host page loads, or a font uploaded to the tale's project (R18, story 7.17), by its id.
 */
export type TextFont =
  | { source: 'system'; stack: SystemFontStack }
  | { source: 'theme' }
  | { source: 'name'; family: string }
  | { source: 'project'; fontId: string };

/** A text's weight. */
export type TextWeight = NonNullable<Props['weight']>;
/** Where a text's lines sit: `start` and `end` follow its direction. */
export type TextAlign = NonNullable<Props['align']>;
/** A text's direction: `auto` takes it from its first strong character. */
export type TextDirection = NonNullable<Props['direction']>;
/** What is drawn behind a text. */
export type TextBackground = NonNullable<Props['background']>;

/**
 * The font registry's system stacks (R4): fonts every platform has, so no font file is loaded.
 * `sans` is the stack text had before styling. Each is a fixed, safe `font-family` value.
 */
export const SYSTEM_FONT_STACKS: Readonly<Record<SystemFontStack, string>> = /* @__PURE__ */ Object.freeze({
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", Nunito, Quicksand, system-ui, sans-serif',
  monospace: 'ui-monospace, Menlo, Consolas, "Cascadia Mono", "Liberation Mono", monospace',
});

/** The names people read for each system stack. */
export const SYSTEM_FONT_STACK_NAMES: Readonly<Record<SystemFontStack, string>> = /* @__PURE__ */ Object.freeze({
  sans: 'Sans',
  serif: 'Serif',
  rounded: 'Rounded',
  monospace: 'Monospace',
});

/** The system stack keys, in the order editors list them. */
export const SYSTEM_FONT_STACK_KEYS: readonly SystemFontStack[] = ['sans', 'serif', 'rounded', 'monospace'];

/** The CSS weight of each text weight. */
export const TEXT_WEIGHTS: Readonly<Record<TextWeight, number>> = /* @__PURE__ */ Object.freeze({
  regular: 400,
  medium: 500,
  bold: 700,
});

/** The size presets, as fractions of the canvas height (R4). */
export const TEXT_SIZE_PRESETS = /* @__PURE__ */ Object.freeze({ small: 0.03, medium: 0.04, large: 0.06 } as const);
/** A size preset's name. */
export type TextSizePreset = keyof typeof TEXT_SIZE_PRESETS;

/** The font size's range, as a fraction of the canvas height. */
export const TEXT_SIZE_RANGE = /* @__PURE__ */ Object.freeze({ min: 0.01, max: 0.2 } as const);
/** The line height's range, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT_RANGE = /* @__PURE__ */ Object.freeze({ min: 0.8, max: 3 } as const);

/** A text's colour or background colour: `#RRGGBB` or `#RRGGBBAA`. */
export const TEXT_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Every style prop of a text element, filled. */
export interface TextStyle {
  font: TextFont;
  fallback: SystemFontStack;
  size: number;
  /** Null for a text stored before styling, which keeps its weight of {@link LEGACY_TEXT_WEIGHT}. */
  weight: TextWeight | null;
  italic: boolean;
  color: string;
  align: TextAlign;
  direction: TextDirection;
  lineHeight: number;
  background: TextBackground;
  backgroundColor: string;
}

/**
 * The style a new text stores, every setting explicit, and the value each field takes when props
 * leave it out: how text looked before styling (system sans at 4 % of the canvas height, 1.25 line
 * height, white, centred, its direction from its text). A text whose props leave the weight out
 * keeps the weight it had, {@link LEGACY_TEXT_WEIGHT}; a new text stores `bold`.
 */
export const DEFAULT_TEXT_STYLE: Readonly<TextStyle & { weight: TextWeight }> = /* @__PURE__ */ Object.freeze({
  font: /* @__PURE__ */ Object.freeze({ source: 'system', stack: 'sans' }) as TextFont,
  fallback: 'sans',
  size: TEXT_SIZE_PRESETS.medium,
  weight: 'bold',
  italic: false,
  color: '#ffffff',
  align: 'center',
  direction: 'auto',
  lineHeight: 1.25,
  background: 'none',
  backgroundColor: '#000000',
});

const STACKS = SYSTEM_FONT_STACK_KEYS as readonly unknown[];
const oneOf = <T>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value);
const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max;
const isColor = (value: unknown): value is string => typeof value === 'string' && TEXT_COLOR_PATTERN.test(value);

/** The CSS weight of a text stored before styling, whose props leave the weight out. */
export const LEGACY_TEXT_WEIGHT = 600;

/** The CSS `font-weight` of a text weight; a weight left out keeps {@link LEGACY_TEXT_WEIGHT}. */
export function textCssWeight(weight: TextWeight | null): number {
  return weight === null ? LEGACY_TEXT_WEIGHT : TEXT_WEIGHTS[weight];
}

/**
 * The font of `value` when it is a valid font source, else null. Readers are forward compatible:
 * keys they do not know are ignored, and a source they do not know (such as one a later version
 * adds) is drawn in `fallback`, the text's fallback stack, when that is valid.
 */
export function readTextFont(value: unknown, fallback?: unknown): TextFont | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const font = value as Record<string, unknown>;
  switch (font['source']) {
    case 'system':
      return oneOf(STACKS, font['stack']) ? { source: 'system', stack: font['stack'] as SystemFontStack } : null;
    case 'theme':
      return { source: 'theme' };
    case 'name':
      return isFontFamily(font['family']) ? { source: 'name', family: font['family'] } : null;
    case 'project':
      if (isFontId(font['fontId'])) return { source: 'project', fontId: font['fontId'].toLowerCase() };
      // A project font without a usable id draws in the fallback stack, as an unknown source does.
      return oneOf(STACKS, fallback) ? { source: 'system', stack: fallback as SystemFontStack } : null;
    default:
      return oneOf(STACKS, fallback) ? { source: 'system', stack: fallback as SystemFontStack } : null;
  }
}

/**
 * The complete style of a text element's props: each field that passes its rule as it is, every
 * missing or invalid one from {@link DEFAULT_TEXT_STYLE}. The server refuses invalid props on
 * write; renderers read through this, so a value that reaches CSS is always a checked one.
 */
export function resolveTextStyle(props: unknown): TextStyle {
  const p = typeof props === 'object' && props !== null ? (props as Record<string, unknown>) : {};
  const d = DEFAULT_TEXT_STYLE;
  return {
    font: readTextFont(p['font'], p['fallback']) ?? d.font,
    fallback: oneOf(SYSTEM_FONT_STACK_KEYS, p['fallback']) ? p['fallback'] : d.fallback,
    size: inRange(p['size'], TEXT_SIZE_RANGE) ? p['size'] : d.size,
    weight: oneOf<TextWeight>(['regular', 'medium', 'bold'], p['weight']) ? p['weight'] : null,
    italic: typeof p['italic'] === 'boolean' ? p['italic'] : d.italic,
    color: isColor(p['color']) ? p['color'] : d.color,
    align: oneOf<TextAlign>(['start', 'center', 'end'], p['align']) ? p['align'] : d.align,
    direction: oneOf<TextDirection>(['auto', 'rtl', 'ltr'], p['direction']) ? p['direction'] : d.direction,
    lineHeight: inRange(p['lineHeight'], TEXT_LINE_HEIGHT_RANGE) ? p['lineHeight'] : d.lineHeight,
    background: oneOf<TextBackground>(['none', 'box', 'highlight'], p['background']) ? p['background'] : d.background,
    backgroundColor: isColor(p['backgroundColor']) ? p['backgroundColor'] : d.backgroundColor,
  };
}

/** The inline padding of a solid box, in em of the text: the text does not touch the box's sides. */
export const TEXT_BOX_PADDING_EM = 0.5;
/** The inline padding of a per-line highlight, in em of the text. */
export const TEXT_HIGHLIGHT_PADDING_EM = 0.25;

/** CSS generic family keywords: written bare, since a quoted one names a font called so. */
export const GENERIC_FONT_FAMILIES = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
] as const;

/**
 * A font-family list that passed the font-list rules (`isFontFamily`), with each name in double
 * quotes, except a bare generic family. CSS refuses some bare names (`Source Sans 3`, `Noto Sans
 * 3D`, `A - B`), and a quoted one is always a name. The rules allow no quote or backslash inside a
 * name, so quoting needs no escaping.
 */
export function cssFontFamilyList(list: string): string {
  return list
    .split(',')
    .map((part) => {
      const name = part.trim();
      const quoted = name.startsWith('"') || name.startsWith("'");
      const bare = quoted ? name.slice(1, -1) : name.replace(/\s+/g, ' ');
      return !quoted && (GENERIC_FONT_FAMILIES as readonly string[]).includes(bare.toLowerCase()) ? bare : `"${bare}"`;
    })
    .join(', ');
}

/** The CSS custom property the Web SDK sets to the project theme's font (web zones R9). */
export const THEME_FONT_PROPERTY = '--ta-font';

/**
 * The `font-family` value of a text style, ending in its fallback stack. For the theme font,
 * `themeFont` is the project theme's font-family list, or null when the theme sets none (the
 * fallback stack alone); left out, the value reads the theme's custom property, as the Web SDK
 * renders it. A named font comes first, before the fallback, which shows until the host page
 * has loaded it. A project font comes first under its internal alias (`taleart-font-<id>`, never
 * its family name), which names no font until the face is added, so the fallback shows until then.
 * Every part is a registry stack, a list that passed the font-list rules, or an alias made of an id.
 */
export function textFontFamily(style: Pick<TextStyle, 'font' | 'fallback'>, themeFont?: string | null): string {
  const fallback = SYSTEM_FONT_STACKS[style.fallback];
  switch (style.font.source) {
    case 'system':
      return SYSTEM_FONT_STACKS[style.font.stack];
    case 'name':
      return `${cssFontFamilyList(style.font.family)}, ${fallback}`;
    case 'project': {
      const alias = projectFontAlias(style.font.fontId);
      return alias === null ? fallback : `"${alias}", ${fallback}`;
    }
    default:
      if (themeFont === undefined) return `var(${THEME_FONT_PROPERTY}, ${fallback}), ${fallback}`;
      return themeFont !== null && isFontFamily(themeFont) ? `${cssFontFamilyList(themeFont)}, ${fallback}` : fallback;
  }
}

/** The size preset a size matches, or `custom`. */
export function textSizePreset(size: number): TextSizePreset | 'custom' {
  const match = (Object.keys(TEXT_SIZE_PRESETS) as TextSizePreset[]).find(
    (preset) => Math.abs(TEXT_SIZE_PRESETS[preset] - size) < 1e-9,
  );
  return match ?? 'custom';
}

/**
 * The canvas height the contrast check takes, in CSS pixels, to tell large text. Text sizes are
 * fractions of the canvas height, so the same text is smaller on a smaller canvas. 540 px is about
 * the smallest canvas the viewer draws on a supported phone: a 320 × 568 screen (569 px for a
 * 9:16 canvas 320 px wide), less its safe-area insets. Conservative on purpose: a text called large
 * here is large on every phone, so the 3:1 minimum is never applied to text a phone shows smaller.
 */
export const CONTRAST_CANVAS_HEIGHT_PX = 540;
/** WCAG 2.2 large text: 18 pt (24 px), or 14 pt (about 18.67 px) when bold. */
export const LARGE_TEXT_PX = 24;
export const LARGE_BOLD_TEXT_PX = 18.67;
/** The minimum contrast of large text (WCAG 2.2 1.4.3). */
export const LARGE_TEXT_CONTRAST_MIN = 3;

/** True when a text style counts as large text for WCAG 1.4.3 on {@link CONTRAST_CANVAS_HEIGHT_PX}. */
export function isLargeText(style: Pick<TextStyle, 'size' | 'weight'>): boolean {
  const px = style.size * CONTRAST_CANVAS_HEIGHT_PX;
  return px >= LARGE_TEXT_PX || (textCssWeight(style.weight) >= 700 && px >= LARGE_BOLD_TEXT_PX);
}

// A #RRGGBB or #RRGGBBAA colour as channels from 0 to 255 and an alpha from 0 to 1.
function rgba(color: string): [number, number, number, number] {
  const n = (i: number) => parseInt(color.slice(i, i + 2), 16);
  return [n(1), n(3), n(5), color.length === 9 ? n(7) / 255 : 1];
}

const hex = (channels: number[]) =>
  `#${channels
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** True when a `#RRGGBB` or `#RRGGBBAA` colour is fully opaque. */
export function isOpaqueColor(color: string): boolean {
  return rgba(color)[3] === 1;
}

/** `top` (which may be translucent) drawn over the opaque `bottom`, as an opaque `#rrggbb`. */
export function compositeColor(top: string, bottom: string): string {
  const [r, g, b, a] = rgba(top);
  const [R, G, B] = rgba(bottom);
  return hex([r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)]);
}

/** What lies behind a text, for its contrast check. */
export interface TextBackdrop {
  /** The canvas colour (`#RRGGBB` or `#RRGGBBAA`). */
  canvasColor: string;
  /** True when the tale's media lies under the text, so its backdrop cannot be known. */
  overMedia: boolean;
}

/** The viewer's stage behind a translucent canvas colour. */
export const STAGE_COLOR = '#000000';

/** A text's contrast check (R12): a warning only, never a reason to refuse a save or a publish. */
export type TextContrast =
  | { kind: 'ok' | 'low'; ratio: number; minimum: number; against: 'box' | 'highlight' | 'canvas' }
  | { kind: 'unknown'; reason: 'media' };

/**
 * Checks a text's colour against what lies behind it (R12, WCAG 2.2 1.4.3): 4.5:1, or 3:1 for
 * large text. The backdrop is the text's own box or highlight when its colour is opaque; else
 * the canvas colour (a translucent box or highlight drawn over it), drawn over the viewer's
 * black stage when translucent. When the tale's media is behind the text and no opaque box or
 * highlight covers it, the contrast cannot be checked here.
 */
export function textContrast(style: TextStyle, backdrop: TextBackdrop): TextContrast {
  const own = style.background !== 'none' ? style.backgroundColor : null;
  let behind: string;
  let against: 'box' | 'highlight' | 'canvas';
  if (own !== null && isOpaqueColor(own)) {
    behind = own;
    against = style.background as 'box' | 'highlight';
  } else {
    if (backdrop.overMedia) return { kind: 'unknown', reason: 'media' };
    const canvas = compositeColor(backdrop.canvasColor, STAGE_COLOR);
    behind = own !== null ? compositeColor(own, canvas) : canvas;
    against = own !== null ? (style.background as 'box' | 'highlight') : 'canvas';
  }
  const ratio = contrastRatio(compositeColor(style.color, behind), behind);
  const minimum = isLargeText(style) ? LARGE_TEXT_CONTRAST_MIN : TEXT_CONTRAST_MIN;
  return { kind: ratio < minimum ? 'low' : 'ok', ratio, minimum, against };
}

// True when the rectangles share some area.
const overlaps = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * What lies behind the text at `index` of a document's elements, for its contrast check (R6,
 * R12): the visible elements below it in the z-order whose area meets the text's, from the top
 * down. An unrotated rectangle shape whose fill covers the whole text (inside its rounded corners
 * and stroke) is the backdrop: opaque, it is the colour behind the text; translucent, it is drawn
 * over the canvas. Any other element below the text (media, an emoji, an ellipse, a line, a
 * rectangle that covers it only in part, or anything under a translucent rectangle) makes the
 * backdrop unknowable, as the tale's media does. Texts below are not looked at.
 */
export function textBackdropAt(
  elements: readonly { type: string; hidden?: boolean; box: TaleElementBox; props: unknown }[],
  index: number,
  base: TextBackdrop,
): TextBackdrop {
  const text = elements[index];
  if (!text) return base;
  const at = elementBounds(text.box);
  const toWidth = TALE_CANVAS_ASPECT.height / TALE_CANVAS_ASPECT.width;
  // A translucent rectangle met on the way down, drawn over the canvas.
  let tint: string | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const e = elements[i];
    if (e.hidden === true || e.type === 'text' || !overlaps(at, elementBounds(e.box))) continue;
    const look = e.type === 'shape' ? resolveShapeStyle(e.props) : null;
    if (look && look.fill === null && look.strokeWidth === 0) continue;
    const inset = look ? Math.max(look.radius, look.strokeWidth) : 0;
    const box = e.box;
    const covers =
      tint === null &&
      look?.shape === 'rectangle' &&
      box.rotation === 0 &&
      at.x >= box.x + inset * toWidth &&
      at.x + at.w <= box.x + box.w - inset * toWidth &&
      at.y >= box.y + inset &&
      at.y + at.h <= box.y + box.h - inset;
    if (!covers || !look?.fill) return { ...base, overMedia: true };
    const [r, g, b, a] = rgba(look.fill);
    const alpha = Math.round(a * look.opacity * 255);
    const fill = `${hex([r, g, b])}${alpha.toString(16).padStart(2, '0')}`;
    if (alpha === 255) return { canvasColor: fill.slice(0, 7), overMedia: false };
    tint = fill;
  }
  if (tint === null || base.overMedia) return base;
  return { canvasColor: compositeColor(tint, compositeColor(base.canvasColor, STAGE_COLOR)), overMedia: false };
}

/**
 * The label of a button or of the swipe-up link as a text style, for its contrast check (R7, R12):
 * bold, at the size it is drawn, its colour on its fill (a filled button) or pill (the swipe-up
 * link), or on what lies behind it (an outline button). Null for other elements.
 */
export function linkLabelStyle(element: { type: string; box: { h: number }; props: unknown }): TextStyle | null {
  if (element.type === 'button') {
    const look = resolveButtonStyle(element.props);
    return {
      ...DEFAULT_TEXT_STYLE,
      size: buttonFontSize(element.box),
      color: look.color,
      background: look.variant === 'filled' ? 'box' : 'none',
      backgroundColor: look.fill,
    };
  }
  if (element.type === 'swipe-up') {
    const look = resolveSwipeUpStyle(element.props);
    return {
      ...DEFAULT_TEXT_STYLE,
      size: SWIPE_UP_FONT_SIZE,
      color: look.color,
      background: 'box',
      backgroundColor: look.background,
    };
  }
  return null;
}
