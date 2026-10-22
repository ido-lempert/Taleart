import {
  isLinkElement,
  readingOrder,
  SWIPE_UP_BOX,
  type DeliveryTaleDocument,
  type DeliveryTaleElement,
} from '@taleart/contract';
import { renderButton, renderImageButton, renderSwipeUp } from './links';
import { mediaFit, mediaUrl, renderImage, renderSticker, renderVideo, stillImage, type RenderContext } from './media';
import { renderEmoji, renderShape } from './shapes';
import { renderText } from './text';

/** Renders one element of its type as DOM, or null to render nothing. */
export type ElementRenderer = (element: DeliveryTaleElement, context: RenderContext) => HTMLElement | null;

/**
 * One renderer per element type, keyed by the element-type registry's keys (AD-16). A type that
 * is not here renders nothing, so an older SDK still shows the rest of a tale (AD-15). A Map, so
 * a type such as `constructor` or `__proto__` is unknown rather than an inherited property.
 */
export const ELEMENT_RENDERERS: ReadonlyMap<string, ElementRenderer> = new Map<string, ElementRenderer>([
  ['text', renderText],
  ['image', renderImage],
  ['video', renderVideo],
  ['shape', renderShape],
  ['emoji', renderEmoji],
  ['sticker', renderSticker],
  ['button', renderButton],
  ['image-button', renderImageButton],
  ['swipe-up', renderSwipeUp],
]);

/**
 * The document stage's look. The area fills its parent inside the device's safe-area insets (the
 * tale's media stays full-bleed below it, as for a tale without a document); the canvas is the
 * largest 9:16 box that fits in it, and a size container, so elements size by its height (`cqh`).
 * Only the glyphs of a text take pointer events and text selection, so taps anywhere else, the
 * empty part of a text's box included, reach the viewer below.
 */
export const DOCUMENT_STYLES = `
.ta-area {
  position: absolute;
  top: env(safe-area-inset-top, 0px);
  right: env(safe-area-inset-right, 0px);
  bottom: env(safe-area-inset-bottom, 0px);
  left: env(safe-area-inset-left, 0px);
  display: grid;
  place-items: center;
  container-type: size;
  pointer-events: none;
}
.ta-canvas {
  position: relative;
  width: min(100cqw, 56.25cqh);
  height: min(100cqh, 177.778cqw);
  overflow: hidden;
  container-type: size;
}
.ta-el { position: absolute; box-sizing: border-box; margin: 0; }
.ta-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.ta-line { display: block; }
.ta-media { display: block; pointer-events: none; -webkit-user-drag: none; }
.ta-shape { pointer-events: none; }
.ta-stroke { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); }
.ta-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  white-space: nowrap;
  overflow: visible;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
.ta-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: auto;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
  white-space: nowrap;
  font-weight: 700;
  line-height: 1.2;
  -webkit-tap-highlight-color: transparent;
}
.ta-cta:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #000; }
.ta-button { padding: 0 0.8em; text-overflow: ellipsis; }
.ta-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.ta-fill { position: absolute; inset: 0; width: 100%; height: 100%; }
.ta-swipe { flex-direction: column; gap: 0.2em; overflow: visible; }
.ta-swipe-arrow {
  width: 0.7em;
  height: 0.7em;
  border-top: 0.16em solid currentColor;
  border-left: 0.16em solid currentColor;
  transform: translateY(0.2em) rotate(45deg);
}
.ta-swipe-label { padding: 0.35em 1em; border-radius: 999px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
@media (forced-colors: active) { .ta-cta { border: 1px solid LinkText; } }
.ta-bg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
.ta-hl {
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
.ta-glyphs {
  pointer-events: auto;
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}
`;

const warned = new Set<string>();

// True when the element has a type and a box of finite numbers; the server checked it, the SDK checks again.
function isPlaceable(element: unknown): element is DeliveryTaleElement {
  const e = element as Partial<DeliveryTaleElement> | null;
  const box = e?.box as Record<string, unknown> | undefined;
  return (
    typeof e?.type === 'string' &&
    typeof e.props === 'object' &&
    e.props !== null &&
    !!box &&
    ['x', 'y', 'w', 'h', 'rotation'].every((k) => typeof box[k] === 'number' && Number.isFinite(box[k]))
  );
}

/** The document's canvas colour when it is a valid `#RRGGBB` or `#RRGGBBAA`, else null. */
export function canvasColor(doc: DeliveryTaleDocument): string | null {
  const color = doc.canvas?.background?.color;
  return typeof color === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : null;
}

/** How a document is rendered over its tale. */
export interface DocumentRenderOptions {
  /**
   * The tale's accessible name, such as its title, for a tale that has no media to carry it: the
   * canvas becomes a group with that name, so even an empty document names the tale.
   */
  label?: string;
  /** Paints the canvas's background colour; off when the tale's media lies below the canvas. */
  background?: boolean;
  /** The visitor prefers reduced motion: media does not move by itself (R12). */
  reducedMotion?: boolean;
}

// The canvas's media background (R2): the image filling the canvas with its fit, over its band
// colour; decorative, so hidden from assistive technology. Null for a colour background.
function backgroundMedia(doc: DeliveryTaleDocument, reducedMotion: boolean): HTMLElement | null {
  const background = doc.canvas?.background as { type?: unknown; url?: unknown; fit?: unknown } | undefined;
  const url = background?.type === 'media' ? mediaUrl(background.url) : null;
  if (!url) return null;
  let node: HTMLElement;
  if (reducedMotion && /\.(gif|webp|png)$/i.test(new URL(url).pathname)) node = stillImage(url);
  else {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.src = url;
    node = img;
  }
  node.className = 'ta-bg';
  node.setAttribute('aria-hidden', 'true');
  node.style.objectFit = mediaFit(background?.fit);
  return node;
}

/**
 * Renders a delivered tale document (AD-16) as an area holding its 9:16 canvas: each element of a
 * known type absolutely placed from its box, stacked in the document's z-order, and in DOM order
 * by reading order (top to bottom, then left to right), which is what screen readers follow.
 * Content is set as text nodes and styles through CSSOM only. An unknown element type is skipped
 * with one console warning per type.
 */
export function renderTaleDocument(doc: DeliveryTaleDocument, options: DocumentRenderOptions = {}): HTMLElement {
  const area = document.createElement('div');
  area.className = 'ta-area';
  const canvas = document.createElement('div');
  canvas.className = 'ta-canvas';
  const color = canvasColor(doc);
  const context: RenderContext = { reducedMotion: options.reducedMotion === true };
  const media = backgroundMedia(doc, context.reducedMotion);
  // A media background paints its band colour with it, over the tale's media too.
  if ((options.background || media) && color) canvas.style.backgroundColor = color;
  if (media) canvas.appendChild(media);
  if (options.label) {
    canvas.setAttribute('role', 'group');
    canvas.setAttribute('aria-label', options.label);
  }
  // Delivered documents hold no hidden element; one that does (such as an editor's unsaved copy) skips it.
  const elements = Array.isArray(doc.elements)
    ? doc.elements.filter((e) => isPlaceable(e) && (e as { hidden?: unknown }).hidden !== true)
    : [];
  const layer = new Map(elements.map((element, i) => [element, i + 1]));
  // One swipe-up link per tale (R7): the server refuses a second; one that comes anyway is skipped.
  let swipeUp = false;
  for (const element of readingOrder(elements)) {
    if (element.type === 'swipe-up') {
      if (swipeUp) continue;
      swipeUp = true;
    }
    const render = ELEMENT_RENDERERS.get(element.type);
    if (!render) {
      if (!warned.has(element.type)) {
        warned.add(element.type);
        console.warn(`TaleArt: element type "${element.type}" is not supported by this SDK; it is skipped`);
      }
      continue;
    }
    const node = render(element, context);
    if (!node) continue;
    // The swipe-up link is pinned to the bottom safe area, whatever its box says.
    const { x, y, w, h, rotation } = element.type === 'swipe-up' ? SWIPE_UP_BOX : element.box;
    const style = node.style;
    style.left = `${x * 100}%`;
    style.top = `${y * 100}%`;
    style.width = `${w * 100}%`;
    style.height = `${h * 100}%`;
    if (rotation) style.transform = `rotate(${rotation}deg)`;
    style.zIndex = String(layer.get(element));
    // A link is never hidden from assistive technology: it is focusable, and named by its label or alt text.
    if (element.a11y?.decorative === true && !isLinkElement(element)) node.setAttribute('aria-hidden', 'true');
    canvas.appendChild(node);
  }
  area.appendChild(canvas);
  return area;
}
