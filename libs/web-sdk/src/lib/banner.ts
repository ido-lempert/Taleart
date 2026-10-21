import type { BannerSettings, DeliveryTaleGroup } from '@taleart/contract';
import { coverMedia } from './bar';
import { coverSettled } from './first-content';
import { setIcon, SWIPE_MIN_PX } from './viewer';

/** The frame type this renderer draws (AD-5). */
export const BANNER_FRAME_TYPE = 'banner';

/** The banner's defaults, as `libs/contract/frame-types/banner.schema.json` defines them (R3). */
export const BANNER_DEFAULTS: Readonly<BannerSettings> = {
  aspectRatio: '16:9',
  autoplay: true,
  intervalSeconds: 5,
  showDots: true,
  loop: true,
};

/** The aspect ratios the schema lists; each has a fixed CSS rule in {@link BANNER_STYLES}. */
export const BANNER_RATIOS = ['16:9', '3:1', '1:1'] as const;

/** The autoplay interval's range in seconds, as the schema sets it. */
export const BANNER_INTERVAL_RANGE = { min: 3, max: 15 } as const;

const PREFERS_REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** How long after a swipe's pointerup a pointer click still belongs to the swipe. */
export const SWIPE_CLICK_WINDOW_MS = 300;

/**
 * The banner settings to render: each field the Delivery API sent when it is
 * valid, else its default. Settings are untrusted: only listed values reach
 * the DOM, and nothing is logged.
 */
export function readBannerSettings(raw: unknown): BannerSettings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: 'autoplay' | 'showDots' | 'loop'): boolean =>
    typeof s[key] === 'boolean' ? (s[key] as boolean) : BANNER_DEFAULTS[key];
  const interval = s['intervalSeconds'];
  return {
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
 * `--ta-*` custom properties, falling back to the look before themes when
 * the theme leaves one unset; the previous, next and rotation buttons keep
 * their own light fill so they read on any slide. Controls are 44 px, dots
 * 24 px targets.
 */
export const BANNER_STYLES = `
.banner { position: relative; margin: 8px 0; background: var(--ta-bg, transparent); font-family: var(--ta-font, inherit); }
.b-viewport {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: var(--ta-radius, 12px);
  background: #e5e7eb;
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
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.b-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  -webkit-user-drag: none;
}
span.b-media { background: #e5e7eb; }
.b-open:focus-visible { outline: 3px solid #111827; outline-offset: -5px; box-shadow: inset 0 0 0 5px #fff; }
.b-btn {
  position: absolute;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid #6b7280;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  color: #111827;
  cursor: pointer;
}
.b-btn[hidden] { display: none; }
.b-btn svg { width: 24px; height: 24px; fill: currentColor; }
.b-btn:focus-visible { outline: 3px solid #111827; outline-offset: 1px; box-shadow: 0 0 0 5px #fff; }
.b-btn[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.b-prev, .b-next { top: 50%; margin-top: -22px; }
.b-prev { left: 8px; }
.b-next { right: 8px; }
.b-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 4px; }
.b-row .b-rotate { position: static; flex: none; }
.b-dots { display: flex; justify-content: center; flex-wrap: wrap; }
.b-dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.b-dot::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
/* With a theme title colour, dots are rings of it, filled for the slide shown. */
.taleart[data-title] .b-dot::before {
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 2px solid var(--ta-title);
  background: none;
}
.b-dot[aria-current="true"]::before,
.taleart[data-title] .b-dot[aria-current="true"]::before { width: 12px; height: 12px; background: var(--ta-title, #111827); }
.b-dot:focus-visible { outline: 2px solid #111827; outline-offset: -2px; box-shadow: inset 0 0 0 4px #fff; border-radius: 50%; }
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
  /** Stops the banner's timer and listeners; call before dropping it. */
  destroy(): void;
}

/**
 * A banner frame (R3): a carousel with one slide per tale group that has a
 * tale, showing the group's first tale's media, with previous and next
 * buttons, swipe, dots and autoplay. Activating a slide calls `onOpen` with
 * its group. Autoplay runs only with the `autoplay` setting, two or more
 * slides and no preference for reduced motion; any interaction stops it
 * (the rotation button can restart it), and a hovering mouse pauses it.
 * Returns null when no group has a tale.
 */
export function renderBanner(
  groups: readonly DeliveryTaleGroup[],
  settings: unknown,
  onOpen: (groupId: string) => void,
): BannerView | null {
  const slides = groups.filter((group) => group.tales.length > 0);
  if (slides.length === 0) return null;
  const { aspectRatio, autoplay, intervalSeconds, showDots, loop } = readBannerSettings(settings);
  const count = slides.length;
  const motion = typeof matchMedia === 'function' ? matchMedia(PREFERS_REDUCED_MOTION) : null;

  const root = document.createElement('section');
  root.className = 'banner';
  root.dataset['ratio'] = aspectRatio;
  root.setAttribute('aria-roledescription', 'carousel');
  root.setAttribute('aria-label', 'Banner');

  const viewport = document.createElement('div');
  viewport.className = 'b-viewport';
  // Below the slide area, in a row with the dots, so no control can overlap another at any width.
  const rotate = button('b-btn b-rotate', '');
  const prev = button('b-btn b-prev', 'Previous slide');
  setIcon(prev, ICONS.prev);
  const next = button('b-btn b-next', 'Next slide');
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
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${i + 1} of ${count}`);
    const open = button('b-open', group.name);
    open.dataset['taleGroupId'] = group.id;
    const media = coverMedia(group);
    media.className = 'b-media';
    if (media instanceof HTMLImageElement) media.draggable = false;
    mediaEls.push(media);
    open.appendChild(media);
    open.addEventListener('click', (e) => {
      // Only the pointer click that ends a swipe is dropped; keyboard and assistive
      // technology activations (detail 0) always open.
      if (e.detail !== 0 && Date.now() < swipedUntil) return;
      interact();
      onOpen(group.id);
    });
    slide.appendChild(open);
    track.appendChild(slide);
    slideEls.push(slide);
    openButtons.push(open);
    const dot = button('b-dot', `Show ${group.name}`);
    dot.addEventListener('click', () => {
      interact();
      goTo(i);
    });
    dots.appendChild(dot);
    dotButtons.push(dot);
  });

  const canRotate = autoplay && count > 1;
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

  function goTo(i: number): void {
    index = Math.max(0, Math.min(count - 1, i));
    warm(index);
    const neighbours = [stepTo(1), stepTo(-1)];
    void coverSettled(mediaEls[index]).then(() => neighbours.forEach(warm));
    track.style.transform = `translateX(${-100 * index}%)`;
    slideEls.forEach((slide, n) => {
      const hidden = n !== index;
      slide.toggleAttribute('inert', hidden);
      if (hidden) slide.setAttribute('aria-hidden', 'true');
      else slide.removeAttribute('aria-hidden');
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
    rotate.setAttribute('aria-label', rotating ? 'Stop automatic slide show' : 'Start automatic slide show');
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
  viewport.addEventListener('pointerdown', (e) => {
    press = { x: e.clientX, y: e.clientY };
    interact();
  });
  viewport.addEventListener('pointerup', (e) => {
    if (!press) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    press = null;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      // The click that may follow this pointerup comes at once; a later one is a new tap.
      swipedUntil = Date.now() + SWIPE_CLICK_WINDOW_MS;
      step(dx < 0 ? 1 : -1);
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
    destroy() {
      stopped = true;
      rotating = false;
      clearTimeout(timer);
      motion?.removeEventListener?.('change', schedule);
    },
  };
}
