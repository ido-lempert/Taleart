import type { DeliveryTaleElement } from '@taleart/contract';

/** What a renderer knows about where it renders. */
export interface RenderContext {
  /** The visitor prefers reduced motion: nothing moves by itself (R12). */
  reducedMotion: boolean;
}

// Images that may move: a GIF, an animated WebP or an APNG. Under reduced motion they are drawn once.
const MAY_ANIMATE = /\.(gif|webp|png)$/i;

/** The URL when it is an absolute http(s) URL, as the Delivery API builds them; else null (AD-16). */
export function mediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
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
  if (context.reducedMotion && MAY_ANIMATE.test(new URL(url).pathname)) {
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
