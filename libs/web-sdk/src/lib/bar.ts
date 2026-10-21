import type { BarSettings, DeliveryTaleGroup } from '@taleart/contract';

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
 * of the themed wrapper (see `theme.ts`).
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
  background: var(--ta-bg);
  font-family: var(--ta-font);
}
.bar::-webkit-scrollbar { display: none; }
.bar > li { flex: none; }
.bar[data-align="center"] > li:first-child { margin-inline-start: auto; }
.bar[data-align="center"] > li:last-child { margin-inline-end: auto; }
.bar[data-titles="hidden"] .title { display: none; }
.bar[data-shape="rounded-square"] .ring { border-radius: var(--ta-radius); }
.bar[data-shape="rounded-square"] .cover { border-radius: max(0px, calc(var(--ta-radius) - var(--ta-ring-width))); }
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: calc(var(--ta-size) + 12px);
  padding: 0;
  border: 0;
  background: none;
  color: var(--ta-title);
  font: inherit;
  cursor: pointer;
}
.item:focus-visible { outline: 2px solid #1a56db; outline-offset: 2px; border-radius: 8px; }
.ring {
  box-sizing: border-box;
  width: var(--ta-size);
  height: var(--ta-size);
  border-radius: 50%;
  padding: var(--ta-ring-width);
  background: var(--ta-ring);
}
.item[data-seen] .ring { background: var(--ta-seen); }
.cover {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--ta-bg);
  object-fit: cover;
  background: #e5e7eb;
}
.title {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
}
`;

/** True when the visitor asks for reduced motion (R11): animated covers then stay still. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    video.src = moving ? url : `${url}#t=0.001`;
    el = video;
  } else if (animated && reduced) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
    };
    img.src = url;
    el = canvas;
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.decoding = 'async';
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

// The group's cover (R12) when it has one; else the first tale with media: its image, or that
// video's first frame; a neutral placeholder with no media.
function cover(group: DeliveryTaleGroup, reduced: boolean): HTMLElement {
  if (group.cover) return coverElement(group.cover.kind, group.cover.url, group.cover.animated === true, reduced);
  const media = group.tales.find((tale) => tale.media)?.media;
  if (media) return coverElement(media.kind, media.url, false, reduced);
  const el = document.createElement('span');
  el.setAttribute('data-placeholder', '');
  el.className = 'cover';
  return el;
}

/**
 * A banner slide's picture (R3): the group's first tale with media, its image
 * or that video's first frame (never played); a neutral placeholder with none.
 */
export function coverMedia(group: DeliveryTaleGroup): HTMLElement {
  const media = group.tales.find((tale) => tale.media)?.media;
  if (media) return coverElement(media.kind, media.url, false, true);
  const el = document.createElement('span');
  el.setAttribute('data-placeholder', '');
  el.className = 'cover';
  return el;
}

/** Redraws every animated cover under `root` for the visitor's current motion setting. */
export function applyCoverMotion(root: ParentNode, reduced: boolean): void {
  for (const el of root.querySelectorAll<HTMLElement>('.cover[data-animated]')) {
    const kind = el.dataset['kind'] === 'video' ? 'video' : 'image';
    el.replaceWith(coverElement(kind, el.dataset['src'] ?? '', true, reduced));
  }
}

/**
 * Marks a bar item seen or unseen: the seen ring, and the name says so for
 * screen readers, since the ring's colour alone does not.
 */
export function setItemSeen(button: HTMLElement, name: string, seen: boolean): void {
  button.toggleAttribute('data-seen', seen);
  button.setAttribute('aria-label', seen ? `${name}, seen` : name);
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
    setItemSeen(button, group.name, seen.has(group.id));
    const ring = document.createElement('span');
    ring.className = 'ring';
    ring.appendChild(cover(group, reducedMotion));
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = group.name;
    title.setAttribute('aria-hidden', 'true');
    button.append(ring, title);
    item.appendChild(button);
    list.appendChild(item);
  }
  return list;
}
