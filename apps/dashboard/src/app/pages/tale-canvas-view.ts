// How Tale Studio's canvas draws each element, as the Web SDK renders it (AD-16): pure views of an
// element's props, each value from the contract's resolvers, and the name people read for its type.
import {
  BUTTON_OUTLINE_WIDTH,
  buttonFontSize,
  linkLabel,
  resolveButtonStyle,
  resolveShapeStyle,
  resolveSwipeUpStyle,
  SWIPE_UP_FONT_SIZE,
  TALE_ELEMENT_TYPE_REGISTRY,
  type ShapeKind,
  type TaleElement,
  type TaleElementBox,
  type TextElementProps,
} from '@taleart/contract/tale-document';
import {
  DEFAULT_TEXT_STYLE,
  linkLabelStyle,
  resolveTextStyle,
  TEXT_BOX_PADDING_EM,
  TEXT_HIGHLIGHT_PADDING_EM,
  textCssWeight,
  textFontFamily,
  type TextStyle,
} from '@taleart/contract/text-style';
import { elementTypeLabel } from './tale-element-types';
import { SHAPE_NAMES } from './tale-shapes';

// The name people read for each registered type: its registry label ("Text", "Swipe-up link"), R8.
const KIND_NAMES: ReadonlyMap<string, string> = new Map(TALE_ELEMENT_TYPE_REGISTRY.map((t) => [t.key, t.label]));
/** How people read an element's type: "Text", "Image", "Video", "Emoji", "Sticker", or a shape's ("Ellipse"). */
export const kindName = (element: { type: TaleElement['type']; props?: unknown }): string => {
  const shape = element.type === 'shape' ? (element.props as { shape?: ShapeKind } | undefined)?.shape : undefined;
  return (shape && SHAPE_NAMES[shape]) || KIND_NAMES.get(element.type) || elementTypeLabel(element.type) || 'Layer';
};

/** How the canvas draws a shape, as the Web SDK renders it: each value from the contract's `resolveShapeStyle`. */
export interface ShapeView {
  fill: string | null;
  border: string | null;
  radius: string | null;
  opacity: number;
  /** A line's bar: its thickness and colour; null for a rectangle or an ellipse. */
  line: { height: string; color: string | null } | null;
}

/** The canvas look of a shape's props. */
export function shapeView(props: unknown): ShapeView {
  const look = resolveShapeStyle(props);
  if (!look) return { fill: null, border: null, radius: null, opacity: 1, line: null };
  const stroked = look.stroke !== null && look.strokeWidth > 0;
  if (look.shape === 'line') {
    return {
      fill: null,
      border: null,
      radius: null,
      opacity: look.opacity,
      line: { height: `${look.strokeWidth * 100}cqh`, color: stroked ? look.stroke : null },
    };
  }
  return {
    fill: look.fill,
    border: stroked ? `${look.strokeWidth * 100}cqh solid ${look.stroke}` : null,
    radius: look.shape === 'ellipse' ? '50%' : look.radius > 0 ? `${look.radius * 100}cqh` : null,
    opacity: look.opacity,
    line: null,
  };
}

/** How the canvas draws a button or the swipe-up link, as the Web SDK renders it (R7). */
export interface LinkView {
  label: string;
  color: string;
  background: string | null;
  border: string | null;
  radius: string | null;
  fontSize: string;
}

/** The canvas look of a button or swipe-up link: each value from the contract's resolvers. */
export function linkView(element: { type: string; box: TaleElementBox; props: unknown }): LinkView {
  const label = linkLabel((element.props as { label?: unknown }).label);
  const size = (n: number) => `${Math.round(n * 100000) / 1000}cqh`;
  if (element.type === 'swipe-up') {
    const look = resolveSwipeUpStyle(element.props);
    return { label, color: look.color, background: look.background, border: null, radius: null, fontSize: size(SWIPE_UP_FONT_SIZE) };
  }
  const look = resolveButtonStyle(element.props);
  return {
    label,
    color: look.color,
    background: look.variant === 'filled' ? look.fill : null,
    border: look.variant === 'outline' ? `${size(BUTTON_OUTLINE_WIDTH)} solid ${look.fill}` : null,
    radius: look.radius > 0 ? size(look.radius) : null,
    fontSize: size(buttonFontSize(element.box)),
  };
}

/** The style whose contrast a layer's label is checked for (R12): a text's, or a button's or swipe-up link's label. */
export function labelStyleOf(element: { type: string; box: TaleElementBox; props: unknown }): TextStyle | null {
  return element.type === 'text' ? resolveTextStyle(element.props) : linkLabelStyle(element);
}

/** How the canvas draws a text, as the Web SDK renders it: each value from the contract's `resolveTextStyle`. */
export interface TextView {
  dir: string;
  family: string;
  size: string;
  weight: number;
  fontStyle: string;
  color: string;
  lineHeight: number;
  align: string;
  /** A solid box's colour and inline padding, or null. */
  boxColor: string | null;
  boxPadding: string | null;
  /** A per-line highlight's colour and inline padding, or null. */
  lineColor: string | null;
  linePadding: string | null;
}

/** The canvas look of a text's props; `themeFont` is the project theme's font-family list, or null. */
export function textView(props: unknown, themeFont: string | null): TextView {
  const look = resolveTextStyle(props);
  const box = look.background === 'box';
  const line = look.background === 'highlight';
  return {
    dir: look.direction,
    family: textFontFamily(look, themeFont),
    size: `${look.size * 100}cqh`,
    weight: textCssWeight(look.weight),
    fontStyle: look.italic ? 'italic' : 'normal',
    color: look.color,
    lineHeight: look.lineHeight,
    align: look.align,
    boxColor: box ? look.backgroundColor : null,
    boxPadding: box ? `${TEXT_BOX_PADDING_EM}em` : null,
    lineColor: line ? look.backgroundColor : null,
    linePadding: line ? `${TEXT_HIGHLIGHT_PADDING_EM}em` : null,
  };
}

/**
 * The props of a new text: its text and every style setting stored explicitly (story 7.4), the
 * direction `auto` included, so what it looks like does not depend on defaults.
 */
export function newTextProps(text: string): TextElementProps {
  const { font, ...style } = DEFAULT_TEXT_STYLE;
  return { text, font: { ...font }, ...style };
}
