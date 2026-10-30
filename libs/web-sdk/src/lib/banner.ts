import type { BannerSettings, DeliveryTaleGroup } from '@taleart/contract';
import { coverMedia, REDUCED_MOTION_QUERY } from './bar';
import { coverSettled, holdMedia } from './first-content';
import { defaultTranslate, type Translate } from './i18n';
import { isRtl } from './direction';
import { setIcon } from './icon';
import { SWIPE_MIN_PX } from './swipe';

// The banner is this module (the default carousel, its settings and the controller every variant shares) and
// banner-variants.ts (coverflow, peek, deck, sticky and strip), which loads on first use of its variant, as the
// viewer does (viewer-loader.ts). A variant shows a skeleton of the banner's footprint until its chunk arrives.

/** The frame type this renderer draws (AD-5). */
export const BANNER_FRAME_TYPE = 'banner';

/** How the slides are shown (epic end-user redesign P5), in the contract's schema order. */
export const BANNER_VARIANTS = ['carousel', 'coverflow', 'peek', 'deck', 'sticky', 'strip'] as const;

/** One of {@link BANNER_VARIANTS}. */
export type BannerVariant = (typeof BANNER_VARIANTS)[number];

/** The banner's defaults, as `libs/contract/frame-types/banner.schema.json` defines them (R3, P5). */
export const BANNER_DEFAULTS: Readonly<BannerSettings> = {
  variant: 'carousel',
  aspectRatio: '16:9',
  autoplay: true,
  intervalSeconds: 5,
  showDots: true,
  loop: true,
};

/**
 * The settings each variant does not use (the dashboard's display options say the same): a sticky banner
 * ignores the aspect ratio, the dots and the loop; a strip ignores those and autoplay with its interval, since
 * it scrolls at a fixed speed. The others use them all.
 */
export const BANNER_IGNORED: Readonly<Record<BannerVariant, readonly (keyof BannerSettings)[]>> = {
  carousel: [],
  coverflow: [],
  peek: [],
  deck: [],
  sticky: ['aspectRatio', 'showDots', 'loop'],
  strip: ['aspectRatio', 'showDots', 'loop', 'autoplay', 'intervalSeconds'],
};

/** The aspect ratios the schema lists; each has a fixed CSS rule in {@link BANNER_STYLES}. */
export const BANNER_RATIOS = ['16:9', '3:1', '1:1'] as const;

/** The autoplay interval's range in seconds, as the schema sets it. */
export const BANNER_INTERVAL_RANGE = { min: 3, max: 15 } as const;

/** How long after a swipe's pointerup a pointer click still belongs to the swipe. */
export const SWIPE_CLICK_WINDOW_MS = 300;

/**
 * The banner settings to render: each field the Delivery API sent when it is
 * valid, else its default. Settings are untrusted: only listed values reach
 * the DOM, and nothing is logged.
 */
export function readBannerSettings(raw: unknown): BannerSettings & { variant: BannerVariant } {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: 'autoplay' | 'showDots' | 'loop'): boolean =>
    typeof s[key] === 'boolean' ? (s[key] as boolean) : BANNER_DEFAULTS[key];
  const interval = s['intervalSeconds'];
  return {
    variant: BANNER_VARIANTS.includes(s['variant'] as BannerVariant) ? (s['variant'] as BannerVariant) : 'carousel',
    aspectRatio: BANNER_RATIOS.includes(s['aspectRatio'] as BannerSettings['aspectRatio'])
      ? (s['aspectRatio'] as BannerSettings['aspectRatio'])
      : BANNER_DEFAULTS.aspectRatio,
    autoplay: bool('autoplay'),
    intervalSeconds:
      Number.isInteger(interval) &&
      (interval as number) >= BANNER_INTERVAL_RANGE.min &&
      (interval as number) <= BANNER_INTERVAL_RANGE.max
        ? (interval as number)
        : BANNER_DEFAULTS.intervalSeconds,
    showDots: bool('showDots'),
    loop: bool('loop'),
  };
}

/**
 * The banner's look (WAI-ARIA carousel pattern). The project's theme (R9)
 * sets the background, font, slide corner radius and dot colour through the
 * `--ta-*` custom properties; the previous, next and rotation buttons keep
 * their own surface so they read on any slide. Controls are 44 px, dots 24 px targets.
 */
export const BANNER_STYLES = `
.banner { position: relative; margin: 8px 0; background: var(--ta-bg, transparent); font-family: var(--ta-font, inherit); }
.b-viewport {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: var(--ta-radius, 12px);
  background: var(--ta-surface, transparent);
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.banner[data-ratio="3:1"] .b-viewport { aspect-ratio: 3 / 1; }
.banner[data-ratio="1:1"] .b-viewport { aspect-ratio: 1 / 1; }
.b-track { display: flex; height: 100%; transition: transform 0.35s ease; }
@media (prefers-reduced-motion: reduce) {
  .b-track { transition: none; }
}
.b-slide { flex: none; width: 100%; height: 100%; }
.b-open {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ta-light);
  cursor: pointer;
}
.b-caption {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding-block: 48px 16px;
  /* Clear of the previous and next buttons, which sit at the two inline edges. */
  padding-inline: 64px;
  background: linear-gradient(to top, color-mix(in srgb, var(--ta-dark) 85%, transparent), transparent);
  text-align: start;
  pointer-events: none;
}
.b-title { font-size: clamp(18px, 4.5cqi, 30px); font-weight: 800; line-height: 1.1; unicode-bidi: plaintext; }
.b-cta {
  display: inline-flex;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--ta-light);
  color: var(--ta-dark);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
}
.b-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
}
span.b-media { background: var(--ta-surface, transparent); }
.b-open:focus-visible { outline: 3px solid var(--ta-ink); outline-offset: -5px; box-shadow: inset 0 0 0 5px var(--ta-paper); }
.b-btn {
  position: absolute;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--ta-muted);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ta-paper) 92%, transparent);
  color: var(--ta-ink);
  cursor: pointer;
}
.b-btn[hidden] { display: none; }
.b-btn svg { width: 24px; height: 24px; fill: currentColor; }
.b-btn:focus-visible { outline: 3px solid var(--ta-ink); outline-offset: 1px; box-shadow: 0 0 0 5px var(--ta-paper); }
.b-btn[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.b-prev, .b-next { top: 50%; margin-top: -22px; }
.b-prev { inset-inline-start: 8px; }
.b-next { inset-inline-end: 8px; }
/* Right to left, previous sits on the right and the chevrons point the other way. */
.b-prev:dir(rtl) svg, .b-next:dir(rtl) svg { transform: scaleX(-1); }
.b-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 4px; }
.b-row .b-rotate { position: static; flex: none; }
.b-dots { display: flex; justify-content: center; flex-wrap: wrap; }
.b-dot {
  display: grid;
  justify-items: start;
  align-items: center;
  padding-inline-start: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.b-dot::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ta-muted); transition: width 0.4s ease; }
/* With a theme title colour, dots are rings of it, filled for the slide shown. */
.taleart[data-title] .b-dot::before {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 2px solid var(--ta-title);
  background: none;
}
/* The shown slide's dot takes the theme title colour, else the host page's text colour, so it shows on a dark page too. */
.b-dot[aria-current="true"]::before,
.taleart[data-title] .b-dot[aria-current="true"]::before { width: 16px; height: 8px; border-radius: 4px; background: var(--ta-title, currentColor); }
.b-dot:focus-visible { outline: 2px solid var(--ta-ink); outline-offset: -2px; box-shadow: inset 0 0 0 4px var(--ta-paper); border-radius: 50%; }
.b-skeleton { background: color-mix(in srgb, var(--ta-ink) 8%, transparent); animation: b-pulse 1.4s ease-in-out infinite; }
@keyframes b-pulse { 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .b-skeleton { animation: none; }
}
@media (forced-colors: active) {
  .b-dot::before, .taleart[data-title] .b-dot::before { forced-color-adjust: none; background: GrayText; border: 0; }
  .b-dot[aria-current="true"]::before, .taleart[data-title] .b-dot[aria-current="true"]::before { background: CanvasText; }
}
`;

const ICONS = {
  prev: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z',
  next: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  play: 'M7 4.5v15L19.5 12z',
};

function button(className: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.setAttribute('aria-label', label);
  return node;
}

/** A rendered banner frame. */
export interface BannerView {
  readonly element: HTMLElement;
  /** The index of the slide shown. */
  readonly index: number;
  /** True while the banner advances by itself. */
  readonly rotating: boolean;
  /**
   * Shows the slide of `groupId` (the first slide for null) and focuses its
   * button; false when the banner has no slide for that group.
   */
  focus(groupId: string | null): boolean;
  /**
   * Places the slides again for the page's direction: a banner drawn before it is on the page (the element draws
   * it, then adds it) reads the direction once it is in place.
   */
  refresh(): void;
  /** Stops the banner's timer and listeners; call before dropping it. */
  destroy(): void;
}

/** What a layout needs to place the slides: the state of the carousel, once the shown slide changed. */
export interface Shown {
  readonly index: number;
  readonly count: number;
  readonly rtl: boolean;
  readonly loop: boolean;
  /** False under reduced motion: placements jump rather than glide. */
  readonly smooth: boolean;
  readonly slides: readonly HTMLElement[];
  readonly viewport: HTMLElement;
  readonly track: HTMLElement;
}

/**
 * How a variant places its slides (the default carousel moves the track). The controller still owns the
 * timers, the buttons, the dots, the live region and the impressions, so every variant behaves alike.
 */
export interface SlideLayout {
  /** The neighbours stay in view, and a click on one shows it instead of opening it (coverflow, peek, deck). */
  readonly neighbours?: boolean;
  /** False when the browser scrolls the slides itself, so pointer swipes do not step (peek). */
  readonly swipe?: boolean;
  /** Places the slides for the shown index. */
  readonly place?: (shown: Shown) => void;
  /** Once mounted, lets the layout move the index when the visitor scrolls (`select` shows that slide). */
  readonly attach?: (shown: Shown, select: (index: number) => void) => void;
}

/**
 * The offset of slide `n` from the shown one: negative before it, positive after, and with loop the shorter
 * way round (a slide half a loop away counts as the one after).
 */
export function offsetOf(n: number, index: number, count: number, loop: boolean): number {
  let d = n - index;
  if (loop && count > 0) {
    if (d > count / 2) d -= count;
    else if (d < -count / 2) d += count;
  }
  return d;
}

/**
 * A banner frame (R3): a carousel with one slide per tale group that has a
 * tale, showing the group's first tale's media, with previous and next
 * buttons, swipe, dots and autoplay. Activating a slide calls `onOpen` with
 * its group. Autoplay runs only with the `autoplay` setting, two or more
 * slides and no preference for reduced motion; any interaction stops it
 * (the rotation button can restart it), and a hovering mouse pauses it.
 * Returns null when no group has a tale. `t` gives the strings (English by default).
 *
 * The `variant` setting picks how the slides are shown. The carousel is drawn here; the other variants load
 * from their own chunk on first use, and `onReady` is called with the banner's element once they are in place
 * (so the element can watch its impressions and release its first pictures). A chunk that fails to load leaves
 * the default carousel in place.
 */
export function renderBanner(
  groups: readonly DeliveryTaleGroup[],
  settings: unknown,
  onOpen: (groupId: string) => void,
  t: Translate = defaultTranslate,
  onReady?: (element: HTMLElement) => void,
): BannerView | null {
  const slides = groups.filter((group) => group.tales.length > 0);
  if (slides.length === 0) return null;
  const s = readBannerSettings(settings);

  const root = document.createElement('section');
  root.className = 'banner';
  root.dataset['ratio'] = s.aspectRatio;
  root.dataset['variant'] = s.variant;
  root.setAttribute('aria-roledescription', t('banner.carousel'));
  root.setAttribute('aria-label', t('banner.label'));
  if (s.variant === 'carousel') return mountCarousel(root, slides, s, onOpen, t);
  // Once the variants' chunk has loaded, a banner is drawn at once.
  if (variants) return variants.mountBannerVariant(s.variant, root, slides, s, onOpen, t);

  // The variant's chunk is on its way: the footprint of the banner stands in for it.
  const placeholder = document.createElement('div');
  placeholder.className = 'b-viewport b-skeleton';
  placeholder.setAttribute('aria-hidden', 'true');
  root.appendChild(placeholder);

  let inner: BannerView | null = null;
  let pending: string | null | undefined;
  let gone = false;
  const show = (mount: () => BannerView) => {
    // The placeholder goes; the variant (or the fallback carousel) draws the banner in its place.
    root.replaceChildren();
    inner = holdMedia(mount);
    if (pending !== undefined) inner.focus(pending);
    onReady?.(root);
  };
  void loadBannerVariants().then(
    ({ mountBannerVariant }) => {
      if (!gone) show(() => mountBannerVariant(s.variant, root, slides, s, onOpen, t));
    },
    () => {
      if (!gone) show(() => mountCarousel(root, slides, s, onOpen, t));
    },
  );

  return {
    element: root,
    get index() {
      return inner?.index ?? 0;
    },
    get rotating() {
      return inner?.rotating ?? false;
    },
    focus(groupId) {
      if (groupId !== null && !slides.some((group) => group.id === groupId)) return false;
      if (inner) return inner.focus(groupId);
      pending = groupId;
      return true;
    },
    refresh() {
      inner?.refresh();
    },
    destroy() {
      gone = true;
      inner?.destroy();
    },
  };
}

// The variants' module, once loaded (null before), and the load in progress. A failed load is not kept: the next
// banner tries again.
let variants: typeof import('./banner-variants') | null = null;
let variantsLoading: Promise<typeof import('./banner-variants')> | null = null;
const loadBannerVariants = (): Promise<typeof import('./banner-variants')> =>
  (variantsLoading ??= import('./banner-variants').then(
    (module) => (variants = module),
    (err: unknown) => {
      variantsLoading = null;
      throw err;
    },
  ));

/**
 * Loads the banner's variants now, so the next banner of any variant is drawn at once (the page does not wait).
 * Resolves once they are loaded; a failed load resolves too, and the next banner tries again.
 */
export function preloadBannerVariants(): Promise<void> {
  return loadBannerVariants().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Draws the slides of a banner into `root` (a section the caller made) with the controls, the timers and the
 * live region every variant shares. `layout` places the slides; the default moves the track, which is the
 * carousel. Returns the banner's view.
 */
export function mountCarousel(
  root: HTMLElement,
  slides: readonly DeliveryTaleGroup[],
  s: Pick<BannerSettings, 'autoplay' | 'intervalSeconds' | 'showDots' | 'loop'>,
  onOpen: (groupId: string) => void,
  t: Translate = defaultTranslate,
  layout: SlideLayout = {},
): BannerView {
  const count = slides.length;
  const { autoplay, intervalSeconds, showDots, loop } = s;
  const motion = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION_QUERY) : null;
  const canRotate = autoplay && count > 1;
  const swipe = layout.swipe !== false;

  const viewport = document.createElement('div');
  viewport.className = 'b-viewport';
  // Below the slide area, in a row with the dots, so no control can overlap another at any width.
  const rotate = button('b-btn b-rotate', '');
  const prev = button('b-btn b-prev', t('banner.previousSlide'));
  setIcon(prev, ICONS.prev);
  const next = button('b-btn b-next', t('banner.nextSlide'));
  setIcon(next, ICONS.next);
  const track = document.createElement('div');
  track.className = 'b-track';
  const dots = document.createElement('div');
  dots.className = 'b-dots';

  const slideEls: HTMLElement[] = [];
  const openButtons: HTMLButtonElement[] = [];
  const dotButtons: HTMLButtonElement[] = [];
  const mediaEls: HTMLElement[] = [];
  slides.forEach((group, i) => {
    const slide = document.createElement('div');
    slide.className = 'b-slide';
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-roledescription', t('banner.slide'));
    slide.setAttribute('aria-label', t('banner.slideOf', { index: i + 1, count }));
    const open = button('b-open', group.name);
    open.dataset['taleGroupId'] = group.id;
    const media = coverMedia(group);
    media.className = 'b-media';
    if (media instanceof HTMLImageElement) media.draggable = false;
    mediaEls.push(media);
    // The title and the call to action sit on a scrim at the bottom (the title is read with the slide's name).
    const caption = document.createElement('span');
    caption.className = 'b-caption';
    const title = document.createElement('span');
    title.className = 'b-title';
    title.dir = 'auto';
    title.textContent = group.name;
    const cta = document.createElement('span');
    cta.className = 'b-cta';
    cta.setAttribute('aria-hidden', 'true');
    cta.textContent = t('banner.watch');
    caption.append(title, cta);
    open.append(media, caption);
    open.addEventListener('click', (e) => {
      // Only the pointer click that ends a swipe is dropped; keyboard and assistive
      // technology activations (detail 0) always open.
      if (e.detail !== 0 && Date.now() < swipedUntil) return;
      interact();
      // A neighbour shown beside the current slide comes to the front; the current slide opens.
      if (layout.neighbours && i !== index) goTo(i);
      else onOpen(group.id);
    });
    slide.appendChild(open);
    track.appendChild(slide);
    slideEls.push(slide);
    openButtons.push(open);
    const dot = button('b-dot', t('banner.showGroup', { name: group.name }));
    dot.addEventListener('click', () => {
      interact();
      goTo(i);
    });
    dots.appendChild(dot);
    dotButtons.push(dot);
  });

  prev.hidden = next.hidden = count < 2;
  viewport.append(prev, next, track);
  root.appendChild(viewport);
  const row = document.createElement('div');
  row.className = 'b-row';
  if (canRotate) row.appendChild(rotate);
  if (showDots && count > 1) row.appendChild(dots);
  if (row.firstChild) root.appendChild(row);

  let index = 0;
  // Set by the visitor's interaction or by reaching the last slide without loop; only the rotation button clears it.
  let stopped = false;
  let rotating = false;
  let hovering = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let press: { x: number; y: number } | null = null;
  // A pointer click before this time ends a swipe and does not open the slide.
  let swipedUntil = 0;
  // True while the SDK moves focus itself, which is not the visitor's interaction.
  let programmaticFocus = false;
  const atEnd = () => !loop && index === count - 1;

  // Slide pictures start lazy (NFR-006): the slide shown loads, then, once it has its picture, the
  // slides next to it, so the next slide is ready before it shows and the rest wait.
  function warm(n: number | null): void {
    if (n !== null) mediaEls[n].removeAttribute('loading');
  }
  // One settled promise per slide, made on first need, so stepping adds no listeners.
  const slideSettled: Promise<void>[] = [];
  const settledSlide = (n: number) => (slideSettled[n] ??= coverSettled(mediaEls[n]));

  function shown(): Shown {
    return {
      index,
      count,
      rtl: isRtl(root),
      loop,
      smooth: !motion?.matches,
      slides: slideEls,
      viewport,
      track,
    };
  }

  // Places the slides for the shown index: the layout's, else the track moves (right to left, the slides run leftwards).
  function place(): void {
    if (layout.place) layout.place(shown());
    else track.style.transform = `translateX(${(isRtl(root) ? 100 : -100) * index}%)`;
  }

  function goTo(i: number, moveSlides = true): void {
    index = Math.max(0, Math.min(count - 1, i));
    warm(index);
    const neighbours = [stepTo(1), stepTo(-1)];
    void settledSlide(index).then(() => neighbours.forEach(warm));
    if (moveSlides) place();
    slideEls.forEach((slide, n) => {
      const hidden = n !== index;
      // A neighbour stays in view for the layouts that show it; its button leaves the tab order.
      slide.toggleAttribute('inert', hidden && !layout.neighbours);
      if (hidden) slide.setAttribute('aria-hidden', 'true');
      else slide.removeAttribute('aria-hidden');
      openButtons[n].tabIndex = hidden && layout.neighbours ? -1 : 0;
    });
    dotButtons.forEach((dot, n) => {
      if (n === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    prev.setAttribute('aria-disabled', String(!loop && index === 0));
    next.setAttribute('aria-disabled', String(atEnd()));
    sync();
  }

  // Derives the rotation state and shows it on the rotation button and the live region.
  function sync(): void {
    const reduced = !!motion?.matches;
    rotating = canRotate && !stopped && !reduced && !atEnd();
    rotate.hidden = !canRotate || reduced;
    rotate.setAttribute('aria-label', t(rotating ? 'banner.stopRotation' : 'banner.startRotation'));
    // Nothing to start on the last slide without loop.
    rotate.setAttribute('aria-disabled', String(!rotating && atEnd()));
    setIcon(rotate, rotating ? ICONS.pause : ICONS.play);
    // Screen readers hear slide changes only when the visitor makes them.
    track.setAttribute('aria-live', rotating ? 'off' : 'polite');
  }

  // The step from the slide shown, or null at an end without loop.
  function stepTo(delta: 1 | -1): number | null {
    const target = index + delta;
    if (target >= 0 && target < count) return target;
    return loop ? (target + count) % count : null;
  }

  function step(delta: 1 | -1): void {
    const target = stepTo(delta);
    if (target !== null) goTo(target);
  }

  // Re-reads the rotation state and (re)starts the timer for the next slide while rotating.
  function schedule(): void {
    clearTimeout(timer);
    sync();
    if (rotating && !hovering) {
      timer = setTimeout(() => {
        step(1);
        // Reaching the last slide without loop stops autoplay; goTo already showed it.
        if (atEnd()) stopped = true;
        schedule();
      }, intervalSeconds * 1000);
    }
  }

  // Any interaction stops autoplay for good; only the rotation button restarts it.
  function interact(): void {
    stopped = true;
    schedule();
  }

  rotate.addEventListener('click', () => {
    if (rotating) stopped = true;
    else if (!atEnd()) stopped = false;
    schedule();
  });
  prev.addEventListener('click', () => {
    interact();
    step(-1);
  });
  next.addEventListener('click', () => {
    interact();
    step(1);
  });
  root.addEventListener('focusin', (e) => {
    if (!programmaticFocus && e.target !== rotate) interact();
  });
  // The arrow keys step the slides as the visual direction says: right to left, the next slide is to the left.
  // Home and End show the first and the last slide.
  root.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      interact();
      goTo(e.key === 'Home' ? 0 : count - 1);
      return;
    }
    const rtl = isRtl(root);
    const forward = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    if (!forward && e.key !== (rtl ? 'ArrowRight' : 'ArrowLeft')) return;
    e.preventDefault();
    interact();
    step(forward ? 1 : -1);
  });
  viewport.addEventListener('pointerdown', (e) => {
    press = { x: e.clientX, y: e.clientY };
    interact();
  });
  viewport.addEventListener('pointerup', (e) => {
    if (!press || !swipe) {
      press = null;
      return;
    }
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    press = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      // The click that may follow this pointerup comes at once; a later one is a new tap.
      swipedUntil = Date.now() + SWIPE_CLICK_WINDOW_MS;
      // A swipe toward the start of the line (left, or right in right-to-left) shows the next slide.
      step((dx < 0) !== isRtl(root) ? 1 : -1);
    }
  });
  viewport.addEventListener('pointercancel', () => (press = null));
  root.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovering = true;
    schedule();
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovering = false;
    schedule();
  });
  motion?.addEventListener?.('change', schedule);

  goTo(0);
  layout.attach?.(shown(), (n) => goTo(n, false));
  schedule();

  return {
    element: root,
    get index() {
      return index;
    },
    get rotating() {
      return rotating;
    },
    focus(groupId) {
      const i = groupId === null ? index : slides.findIndex((group) => group.id === groupId);
      if (i < 0) return false;
      goTo(i);
      // The SDK moving focus back is not the visitor interacting.
      programmaticFocus = true;
      try {
        openButtons[i].focus();
      } finally {
        programmaticFocus = false;
      }
      schedule();
      return true;
    },
    refresh() {
      if (count > 0) goTo(index);
    },
    destroy() {
      stopped = true;
      rotating = false;
      clearTimeout(timer);
      motion?.removeEventListener?.('change', schedule);
    },
  };
}
