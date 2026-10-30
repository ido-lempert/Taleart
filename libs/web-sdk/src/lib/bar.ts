import type { BarSettings, DeliveryTaleGroup } from '@taleart/contract';
import { mediaUrl } from './document/media';
import { canvasColor } from './document/canvas-color';
import { defaultTranslate, type Translate } from './i18n';
import { replaceCover, setCanvasSource, setSource } from './first-content';

/** The frame type this renderer draws (AD-5). */
export const BAR_FRAME_TYPE = 'bar';

/** The bar's defaults, as `libs/contract/frame-types/bar.schema.json` defines them (R2). */
export const BAR_DEFAULTS: Readonly<BarSettings> = {
  shape: 'circle',
  size: 'medium',
  showTitles: true,
  alignment: 'start',
  gap: 12,
};

/** The values each enum setting accepts, as the schema lists them. */
export const BAR_CHOICES = {
  shape: ['circle', 'rounded-square'],
  size: ['small', 'medium', 'large'],
  alignment: ['start', 'center'],
} as const;

/** The gap's range in px, as the schema sets it. */
export const BAR_GAP_RANGE = { min: 4, max: 24 } as const;

/** Each size's cover edge in px. */
export const BAR_SIZE_PX: Readonly<Record<BarSettings['size'], number>> = { small: 48, medium: 64, large: 80 };

function oneOf<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/**
 * The bar settings to render: each field the Delivery API sent when it is
 * valid, else its default. The API validates on write and fills defaults, so
 * this only guards against an older or broken response; it never logs.
 */
export function readBarSettings(raw: unknown): BarSettings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const gap = s['gap'];
  return {
    shape: oneOf(BAR_CHOICES.shape, s['shape'], BAR_DEFAULTS.shape),
    size: oneOf(BAR_CHOICES.size, s['size'], BAR_DEFAULTS.size),
    showTitles: typeof s['showTitles'] === 'boolean' ? s['showTitles'] : BAR_DEFAULTS.showTitles,
    alignment: oneOf(BAR_CHOICES.alignment, s['alignment'], BAR_DEFAULTS.alignment),
    gap:
      Number.isInteger(gap) && (gap as number) >= BAR_GAP_RANGE.min && (gap as number) <= BAR_GAP_RANGE.max
        ? (gap as number)
        : BAR_DEFAULTS.gap,
  };
}

/**
 * The bar's look. Its settings (R2) set `--ta-size` and the gap inline and
 * `data-shape`, `data-align` and `data-titles` on the list; the project's
 * theme (R9) sets the ring, seen ring, ring width, rounded-square radius,
 * title colour, font and background through the `--ta-*` custom properties
 * of the themed wrapper (see `theme.ts`). A property the theme leaves unset
 * falls back to the look before themes: the host page's title colour and
 * font, a transparent background, a radius of a quarter of the item size.
 */
export const BAR_STYLES = `
:host { display: block; }
.bar {
  --ta-size: 64px;
  display: flex;
  gap: 12px;
  justify-content: flex-start;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  padding: 4px;
  margin: 0;
  list-style: none;
  background: var(--ta-bg, transparent);
  font-family: var(--ta-font, inherit);
}
.bar::-webkit-scrollbar { display: none; }
.bar > li { flex: none; }
.bar[data-align="center"] > li:first-child { margin-inline-start: auto; }
.bar[data-align="center"] > li:last-child { margin-inline-end: auto; }
.bar[data-titles="hidden"] .title { display: none; }
.bar[data-shape="rounded-square"] .ring { border-radius: var(--ta-radius, calc(var(--ta-size) / 4)); }
.bar[data-shape="rounded-square"] .cover {
  border-radius: max(0px, calc(var(--ta-radius, calc(var(--ta-size) / 4)) - var(--ta-ring-width, 2px)));
}
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: calc(var(--ta-size) + 12px);
  padding: 0;
  border: 0;
  background: none;
  color: var(--ta-title, inherit);
  font: inherit;
  cursor: pointer;
}
/* Two tokens, so the focus ring shows on any background: the paper inside, the ink outside. */
.item:focus-visible { outline: 2px solid var(--ta-ink); outline-offset: 2px; box-shadow: 0 0 0 2px var(--ta-paper); border-radius: 8px; }
.ring {
  box-sizing: border-box;
  width: var(--ta-size);
  height: var(--ta-size);
  border-radius: 50%;
  padding: var(--ta-ring-width, 2px);
  background: var(--ta-ring, var(--ta-muted));
}
.item[data-seen] .ring { background: var(--ta-seen, var(--ta-muted)); }
.cover {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--ta-gap, var(--ta-paper));
  object-fit: cover;
  background: var(--ta-surface, transparent);
}
/* Up to two lines, so a name that fits on one still shows in full with wider text spacing (WCAG 1.4.12). */
.title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  max-width: 100%;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  /* A name in another script keeps its own direction: a first line in Latin does not turn the others around. */
  unicode-bidi: plaintext;
}
/* Forced colours drop the ring's gradient: draw it, and the seen ring, in system colours. */
@media (forced-colors: active) {
  .ring { forced-color-adjust: none; background: CanvasText; }
  .item[data-seen] .ring { background: GrayText; }
}
`;

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

// The group's cover (R12) when it has one; else its default cover.
function cover(group: DeliveryTaleGroup, reduced: boolean): HTMLElement {
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

/**
 * Marks a bar item seen or unseen: the seen ring, and the name says so for
 * screen readers, since the ring's colour alone does not.
 */
export function setItemSeen(button: HTMLElement, name: string, seen: boolean, t: Translate = defaultTranslate): void {
  button.toggleAttribute('data-seen', seen);
  button.setAttribute('aria-label', seen ? t('bar.seen', { name }) : name);
}

/**
 * One bar item per tale group, in order, as buttons named by the group; the
 * groups in `seen` show the seen ring. `settings` (the frame's, as delivered)
 * set the shape, size, titles, alignment and gap; a hidden title leaves the
 * item's accessible name as it is. Animated covers stay still when
 * `reducedMotion` is true.
 */
export function renderBar(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string> = new Set(),
  settings: unknown = {},
  reducedMotion = prefersReducedMotion(),
  t: Translate = defaultTranslate,
): HTMLElement {
  const { shape, size, showTitles, alignment, gap } = readBarSettings(settings);
  const list = document.createElement('ul');
  list.className = 'bar';
  list.dataset['shape'] = shape;
  list.dataset['align'] = alignment;
  list.dataset['titles'] = showTitles ? 'shown' : 'hidden';
  list.style.setProperty('--ta-size', `${BAR_SIZE_PX[size]}px`);
  list.style.gap = `${gap}px`;
  for (const group of groups) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';
    button.dataset['taleGroupId'] = group.id;
    setItemSeen(button, group.name, seen.has(group.id), t);
    const ring = document.createElement('span');
    ring.className = 'ring';
    ring.appendChild(cover(group, reducedMotion));
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = group.name;
    title.setAttribute('aria-hidden', 'true');
    // A name in another script (such as Hebrew on an English page) takes its own direction.
    title.dir = 'auto';
    button.append(ring, title);
    item.appendChild(button);
    list.appendChild(item);
  }
  return list;
}
