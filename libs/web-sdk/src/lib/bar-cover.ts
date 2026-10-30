import type { DeliveryTaleGroup } from '@taleart/contract';
import { mediaUrl } from './document/media';
import { canvasColor } from './document/canvas-color';
import { replaceCover, setCanvasSource, setSource } from './first-content';

/**
 * How long animated covers move after a render before they stop on their first frame: moving
 * content that starts by itself may run at most 5 s without a pause control (WCAG 2.2.2).
 */
export const COVER_MOTION_MS = 5000;

/** The media query of a visitor who asks for reduced motion (R11). */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the visitor asks for reduced motion (R11): animated covers then stay still. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * One cover element. A still image is an `<img>`; a still video shows its
 * first frame (metadata only, never played). An animated video (R12) is a
 * muted, looping, inline video that autoplays; an animated image is an
 * `<img>`. Under reduced motion an animated video stays on its first frame and
 * an animated image is drawn once to a canvas (its first frame). Animated
 * covers carry `data-animated`, `data-kind` and `data-src`, so
 * {@link applyCoverMotion} can redraw them when the setting changes.
 */
function coverElement(kind: 'image' | 'video', url: string, animated: boolean, reduced: boolean): HTMLElement {
  let el: HTMLElement;
  if (kind === 'video') {
    const video = document.createElement('video');
    const moving = animated && !reduced;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.autoplay = moving;
    video.loop = moving;
    video.preload = moving ? 'auto' : 'metadata';
    // The fragment makes Safari and iOS paint the first frame with metadata-only preload.
    setSource(video, moving ? url : `${url}#t=0.001`);
    el = video;
  } else if (animated && reduced) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const img = new Image();
    // `data-ready` and a `load` event tell the first-content mark the canvas has its picture (or never will).
    const ready = () => {
      canvas.setAttribute('data-ready', '');
      canvas.dispatchEvent(new Event('load'));
    };
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      ready();
    };
    img.onerror = ready;
    // Held and lazy like the other covers (see first-content.ts).
    setCanvasSource(canvas, img, url);
    el = canvas;
  } else {
    const img = document.createElement('img');
    // Lazy before the URL is set: covers out of view wait, and the element makes the first frame's
    // covers in view eager and high priority once it has laid them out (NFR-006, see prioritize).
    img.setAttribute('loading', 'lazy');
    img.decoding = 'async';
    setSource(img, url);
    img.alt = '';
    el = img;
  }
  if (animated) {
    el.dataset['animated'] = '';
    el.dataset['kind'] = kind;
    el.dataset['src'] = url;
  }
  el.className = 'cover';
  return el;
}

// A tale's lowest media element (Tale Studio R16): its document's media background, else its first
// image, video or image sticker; a tale sent without a document (servers before R16) has its media.
function lowestMedia(tale: DeliveryTaleGroup['tales'][number]): { kind: 'image' | 'video'; url: string } | null {
  const doc = tale.document;
  if (!doc) {
    const url = tale.media ? mediaUrl(tale.media.url) : null;
    return tale.media && url ? { kind: tale.media.kind, url } : null;
  }
  const background = doc.canvas?.background as { type?: unknown; url?: unknown } | undefined;
  const backgroundUrl = background?.type === 'media' ? mediaUrl(background.url) : null;
  if (backgroundUrl) return { kind: 'image', url: backgroundUrl };
  for (const element of Array.isArray(doc.elements) ? doc.elements : []) {
    if (element.type !== 'image' && element.type !== 'video' && element.type !== 'sticker') continue;
    const url = mediaUrl(element.props?.['url']);
    if (url) return { kind: element.type === 'video' ? 'video' : 'image', url };
  }
  return null;
}

/**
 * A group's default cover (web zones R12, Tale Studio R16): the lowest media element of its first
 * tale that has media, as before documents the first tale with media gave its picture; when no tale
 * has media, the first tale's canvas colour (null when there is none to show).
 */
export function defaultCover(
  group: DeliveryTaleGroup,
): { kind: 'image' | 'video'; url: string } | { color: string | null } {
  for (const tale of group.tales) {
    const found = lowestMedia(tale);
    if (found) return found;
  }
  const doc = group.tales[0]?.document;
  return { color: doc ? canvasColor(doc) : null };
}

// The default cover as an element: the media's image, or that video's first frame (never played);
// a tale without media shows its canvas colour, else a neutral placeholder.
function defaultCoverElement(group: DeliveryTaleGroup, reduced: boolean): HTMLElement {
  const found = defaultCover(group);
  if ('url' in found) return coverElement(found.kind, found.url, false, reduced);
  const el = document.createElement('span');
  el.setAttribute('data-placeholder', '');
  el.className = 'cover';
  if (found.color) el.style.backgroundColor = found.color;
  return el;
}

/**
 * The group's cover (R12) when it has one; else its default cover. Every layout draws its covers with this
 * (the cover is the media itself: nothing is laid over it).
 */
export function cover(group: DeliveryTaleGroup, reduced: boolean): HTMLElement {
  if (group.cover) return coverElement(group.cover.kind, group.cover.url, group.cover.animated === true, reduced);
  return defaultCoverElement(group, reduced);
}

/** The group's cover as the bar draws it, but still: the viewer's group chips on wide screens show it. */
export function stillCover(group: DeliveryTaleGroup): HTMLElement {
  return cover(group, true);
}

/** A banner slide's picture (R3): the group's default cover, still ({@link defaultCover}). */
export function coverMedia(group: DeliveryTaleGroup): HTMLElement {
  return defaultCoverElement(group, true);
}

/**
 * Redraws every animated cover under `root` for the visitor's current motion
 * setting. A replacement keeps the cover's loading state (held, or first
 * content), and the first content waits on it instead.
 */
export function applyCoverMotion(root: ParentNode, reduced: boolean): void {
  for (const el of root.querySelectorAll<HTMLElement>('.cover[data-animated]')) {
    const kind = el.dataset['kind'] === 'video' ? 'video' : 'image';
    replaceCover(el, () => coverElement(kind, el.dataset['src'] ?? '', true, reduced));
  }
}
