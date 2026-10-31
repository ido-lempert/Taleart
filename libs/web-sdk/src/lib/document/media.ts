import type { DeliveryTaleElement } from '@taleart/contract';
import type { Translate } from '../i18n';
import type { ComponentAction } from '../hooks';
import type { ResponseClient } from '../responses';

/** What a renderer knows about where it renders. */
/** A link of a tale that the visitor activated: its element id and type, its destination and whether it opens a new tab. */
export interface LinkAction {
  id: string;
  type: 'button' | 'image-button' | 'swipe-up';
  url: string;
  newTab: boolean;
}

export interface RenderContext {
  /** The visitor prefers reduced motion: nothing moves by itself (R12). */
  reducedMotion: boolean;
  /** Links render without a destination (the Tale Studio preview of a draft): they look the same and go nowhere. */
  inertLinks?: boolean;
  /**
   * Where an interactive component sends the visitor's response (epic interactive components R9):
   * the zone's client and the tale being shown. None in the Tale Studio preview and on side cards,
   * which record nothing.
   */
  responses?: { client: ResponseClient; taleId: string };
  /** The strings the element shows or announces, in the page's locale (see `i18n.ts`); English when left out. */
  t?: Translate;
  /**
   * Told when the visitor activates a link of the tale (a button, an image button or the swipe-up link), before
   * it navigates. Returning false stops the navigation. Left out, links navigate as always.
   */
  onAction?: (action: LinkAction) => boolean;
  /**
   * Told when a component of the tale does something (components, 2026-10-29): a countdown ends, a promo code
   * is copied, a visitor's answer is selected. The viewer adds the group and tale. Left out, nothing is reported.
   */
  onComponentEvent?: (event: ComponentFire) => void;
}

/** What a component reports to {@link RenderContext.onComponentEvent}: its type, what it did and with what. */
export interface ComponentFire {
  component: string;
  action: ComponentAction;
  value?: string;
}

/** Images that may move: a GIF, an animated WebP, an APNG or an animated AVIF. Under reduced motion they are drawn once. */
export const MAY_ANIMATE = /\.(gif|webp|png|avif)$/i;

/** True for a picture that may move: its path ends like one, or it is a `data:` image of such a type. */
export function mayAnimate(url: string): boolean {
  if (url.startsWith('data:')) return /^data:image\/(gif|webp|png|avif)[;,]/i.test(url);
  return MAY_ANIMATE.test(new URL(url).pathname);
}

// The media URLs a page gave itself in zone data (no backend): page-relative or `data:` URLs, trusted exactly as written.
// A zone read from the Delivery API never adds to it, so its URLs must still be absolute http(s) (AD-16).
const pageMedia = new Set<string>();
const MAX_PAGE_MEDIA = 5000;

/** Trusts the media URLs of zone data the page brought itself, so relative and `data:` URLs render. */
export function trustPageMedia(urls: Iterable<string>): void {
  for (const url of urls) {
    if (pageMedia.size >= MAX_PAGE_MEDIA) pageMedia.clear();
    pageMedia.add(url);
  }
}

// A page's own URL as the browser will load it: a `data:` image or video as is, a relative URL resolved against the page.
function pageUrl(value: string): string | null {
  if (/^data:(image|video)\//i.test(value)) return value;
  try {
    const url = new URL(value, document.baseURI);
    return /^(https?|file):$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The URL when it is an absolute http(s) URL, as the Delivery API builds them; else, only for a URL the page gave in its
 * own zone data ({@link trustPageMedia}), that URL resolved for the page; else null (AD-16).
 */
export function mediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {
    // Not absolute: a page's own relative URL, below.
  }
  return pageMedia.has(value) ? pageUrl(value) : null;
}

// A number in range, else the default: the server checked it, the SDK checks again.
function inRange(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

/** `cover` or `contain`; anything else is `cover`. */
export function mediaFit(value: unknown): 'cover' | 'contain' {
  return value === 'contain' ? 'contain' : 'cover';
}

/**
 * An image drawn once, its first frame, to a canvas: how a picture that may move shows under
 * reduced motion. The canvas keeps the picture's size, so `object-fit` places it as it would the
 * image.
 */
export function stillImage(url: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
  };
  img.src = url;
  return canvas;
}

// The look every media element shares, through CSSOM only: fit, corner radius (a fraction of the
// canvas height) and opacity.
function styleMedia(node: HTMLElement, props: { fit?: unknown; radius?: unknown; opacity?: unknown }): void {
  const style = node.style;
  style.objectFit = mediaFit(props.fit);
  const radius = inRange(props.radius, 0, 0.5, 0);
  if (radius > 0) style.borderRadius = `${radius * 100}cqh`;
  const opacity = inRange(props.opacity, 0, 1, 1);
  if (opacity < 1) style.opacity = String(opacity);
}

// The element's alt text, or '' when it is decorative (the renderer then hides it) or has none.
function altText(element: DeliveryTaleElement): string {
  if (element.a11y?.decorative === true) return '';
  const label = element.a11y?.label;
  return typeof label === 'string' ? label.trim() : '';
}

/**
 * An image element (epic Tale Studio R5): an `<img>` with its alt text (AD-16), filling its box with
 * its fit, rounded and faded as set. Under reduced motion a picture that may move (GIF, WebP, PNG)
 * is drawn once to a canvas named by the alt text instead, so it stays still (R12). Null without a
 * usable URL.
 */
export function renderImage(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const props = element.props as { url?: unknown; fit?: unknown; radius?: unknown; opacity?: unknown };
  const url = mediaUrl(props.url);
  if (!url) return null;
  const alt = altText(element);
  let node: HTMLElement;
  if (context.reducedMotion && mayAnimate(url)) {
    node = stillImage(url);
    if (alt) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', alt);
    }
  } else {
    const img = document.createElement('img');
    img.alt = alt;
    img.decoding = 'async';
    img.draggable = false;
    img.src = url;
    node = img;
  }
  node.className = 'ta-el ta-media';
  styleMedia(node, props);
  return node;
}

/**
 * An image sticker (epic Tale Studio R6): an image element that always shows the whole picture
 * (`contain`) and has no corner radius, with its alt text, hidden when decorative, and still under
 * reduced motion. Null without a usable URL.
 */
export function renderSticker(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const { opacity, url } = element.props as { url?: unknown; opacity?: unknown };
  const props = { url, opacity, fit: 'contain' } as unknown as DeliveryTaleElement['props'];
  return renderImage({ ...element, props }, context);
}

/**
 * A video element (epic Tale Studio R5): a muted, inline `<video>` (AD-16) named by its alt text,
 * filling its box with its fit. It does not play by itself: the viewer plays it with the tale (the
 * tale then lasts as long as the video) and pauses it with the viewer. Under reduced motion it
 * loads only its first frame (`#t` paints it in Safari) and plays from the Play button. Null without
 * a usable URL.
 */
export function renderVideo(element: DeliveryTaleElement, context: RenderContext): HTMLElement | null {
  const props = element.props as { url?: unknown; fit?: unknown; radius?: unknown; opacity?: unknown };
  const url = mediaUrl(props.url);
  if (!url) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.preload = context.reducedMotion ? 'metadata' : 'auto';
  video.src = context.reducedMotion ? `${url}#t=0.001` : url;
  const alt = altText(element);
  if (alt) video.setAttribute('aria-label', alt);
  video.className = 'ta-el ta-media';
  styleMedia(video, props);
  return video;
}
