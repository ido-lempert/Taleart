import type { BannerSettings, DeliveryTaleGroup } from '@taleart/contract';
import { coverMedia } from './bar';
import {
  type BannerView,
  type BannerVariant,
  mountCarousel,
  offsetOf,
  type Shown,
  type SlideLayout,
} from './banner';
import { isRtl } from './direction';
import type { Translate } from './i18n';
import { setIcon } from './icon';

// The banner variants other than the carousel (epic end-user redesign P5), in their own chunk: they load on the
// first banner that asks for one (banner.ts renderBanner). Coverflow, peek, deck and sticky are the carousel's
// controller with a layout each; the strip is a marquee of its own. No layer moves over a picture: only the
// slides (and the strip's track) animate, and every motion stops under reduced motion.

/** The coverflow's front slide starts this far from the inline start, as a share of the banner's width. */
const FRONT_START = 22;
/** How far each step away from the front slide moves a neighbour, as a share of the banner's width. */
const COVERFLOW_STEP = 26;
/** The deck's fan: each step away from the front card moves it this many px and turns it this many degrees. */
const DECK_STEP_PX = 44;
const DECK_STEP_DEG = 6;

// The offset of a slide from the shown one, mirrored by hand in right-to-left: `sign` is -1 there, so the next
// slide is placed on the inline-end side (the left) and turns the way a mirror image does.
const flowOf = (rtl: boolean) => (rtl ? -1 : 1);

/**
 * Coverflow: the front slide, its neighbours turned away at the sides and smaller, the rest hidden. The slides
 * are placed by their inline start (so the page's direction moves them) and turned by rotateY.
 */
const COVERFLOW: SlideLayout = {
  neighbours: true,
  place({ index, count, rtl, loop, slides }: Shown) {
    // The inline start mirrors by itself in right-to-left, so the next slide moves the same logical way; only the
    // turn (rotateY, which has no logical form) takes the page's direction.
    const sign = flowOf(rtl);
    slides.forEach((slide, n) => {
      const off = offsetOf(n, index, count, loop);
      const a = Math.abs(off);
      slide.style.insetInlineStart = `calc(${FRONT_START}% + ${off * COVERFLOW_STEP}%)`;
      slide.style.transform = `rotateY(${-sign * off * 32}deg) scale(${a === 0 ? 1 : a === 1 ? 0.8 : 0.6})`;
      slide.style.zIndex = String(10 - a);
      slide.style.opacity = a === 0 ? '1' : a === 1 ? '0.75' : '0';
      slide.style.visibility = a > 1 ? 'hidden' : '';
    });
  },
};

/**
 * Peek: the neighbours show at the inline edges, and the track scrolls with scroll-snap, so a swipe or a
 * step lands on a slide. The browser scrolls it (pointer swipes stay off); a step scrolls the slide to the
 * middle, which is the same in both directions, since the geometry is read from the boxes.
 */
const PEEK: SlideLayout = {
  neighbours: true,
  swipe: false,
  place({ index, slides, track, smooth }: Shown) {
    const target = slides[index];
    if (!target) return;
    const a = target.getBoundingClientRect();
    const b = track.getBoundingClientRect();
    track.scrollBy?.({ left: a.left + a.width / 2 - (b.left + b.width / 2), behavior: smooth ? 'smooth' : 'auto' });
  },
  attach({ slides, track }: Shown, select: (index: number) => void) {
    track.addEventListener(
      'scroll',
      () => {
        // The slide nearest the middle of the track is the one shown.
        const b = track.getBoundingClientRect();
        const middle = b.left + b.width / 2;
        let best = 0;
        let nearest = Infinity;
        slides.forEach((slide, n) => {
          const r = slide.getBoundingClientRect();
          const d = Math.abs(r.left + r.width / 2 - middle);
          if (d < nearest) {
            nearest = d;
            best = n;
          }
        });
        select(best);
      },
      { passive: true },
    );
  },
};

/**
 * Deck: the groups as a hand of cards, the front one shown in full, the others fanned out behind it. The fan
 * opens toward the inline end: mirrored for right to left, like the coverflow.
 */
const DECK: SlideLayout = {
  neighbours: true,
  place({ index, count, rtl, loop, slides }: Shown) {
    const sign = flowOf(rtl);
    slides.forEach((slide, n) => {
      const off = offsetOf(n, index, count, loop);
      const a = Math.abs(off);
      slide.style.translate = `${sign * off * DECK_STEP_PX}px 0`;
      slide.style.transform = `rotate(${sign * off * DECK_STEP_DEG}deg)`;
      slide.style.zIndex = String(10 - a);
      slide.style.opacity = a > 2 ? '0' : '1';
      slide.style.visibility = a > 2 ? 'hidden' : '';
    });
  },
};

/** The banner's variants' look, after the carousel's (BANNER_STYLES): the slides' layout and motion, and the sticky and strip. */
export const BANNER_VARIANT_STYLES = `
.banner[data-variant="coverflow"] .b-track,
.banner[data-variant="deck"] .b-track { display: block; position: absolute; inset: 0; transition: none; }
.banner[data-variant="coverflow"] .b-slide,
.banner[data-variant="deck"] .b-slide {
  position: absolute;
  top: 8%;
  height: 84%;
  width: 56%;
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.6s, translate 0.6s;
}
.banner[data-variant="deck"] .b-slide { inset-inline-start: 26%; width: 48%; transform-origin: 50% 120%; }
.banner[data-variant="coverflow"] .b-viewport { perspective: 1200px; }
.banner[data-variant="coverflow"] .b-open,
.banner[data-variant="deck"] .b-open,
.banner[data-variant="peek"] .b-open {
  height: 100%;
  border-radius: var(--ta-radius, 16px);
  overflow: hidden;
  box-shadow: 0 24px 40px -18px color-mix(in srgb, var(--ta-ink) 40%, transparent);
}
.banner[data-variant="peek"] .b-track {
  display: flex;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  padding-inline: 13%;
  transition: none;
}
.banner[data-variant="peek"] .b-track::-webkit-scrollbar { display: none; }
.banner[data-variant="peek"] .b-slide {
  flex: 0 0 74%;
  width: 74%;
  scroll-snap-align: center;
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s;
}
.banner[data-variant="peek"] .b-slide[aria-hidden="true"] { transform: scale(0.92); opacity: 0.6; }
.banner[data-variant] .b-slide[aria-hidden="true"] .b-caption { display: none; }
/* A dismissed banner stays hidden: the variants set a display of their own, which would undo the attribute. */
.banner[hidden] { display: none; }
.banner[data-variant="sticky"] {
  position: sticky;
  inset-block-end: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
  margin: 0;
  background: var(--ta-paper);
  box-shadow: 0 -4px 16px color-mix(in srgb, var(--ta-ink) 12%, transparent);
}
.banner[data-variant="sticky"] .b-viewport { flex: 1 1 auto; min-width: 0; height: 64px; aspect-ratio: auto; }
.banner[data-variant="sticky"] .b-open {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 60px;
  color: var(--ta-title, inherit);
  font: inherit;
}
.banner[data-variant="sticky"] .b-media { width: 44px; height: 44px; flex: none; border-radius: 50%; }
.banner[data-variant="sticky"] .b-caption { position: static; flex: 0 1 auto; min-width: 0; padding: 0; background: none; color: inherit; gap: 0; pointer-events: auto; }
.banner[data-variant="sticky"] .b-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 600; color: var(--ta-title, inherit); }
.banner[data-variant="sticky"] .b-cta { display: none; }
.banner[data-variant="sticky"] .b-row { flex: none; margin-top: 0; }
.banner[data-variant="sticky"] .b-dismiss { position: static; flex: none; }
.b-name { unicode-bidi: plaintext; }
.banner[data-variant="strip"] .b-strip {
  overflow: hidden;
  padding-block: 4px;
  border-radius: var(--ta-radius, 12px);
  background: var(--ta-surface, transparent);
}
.banner[data-variant="strip"] .b-strip-track { display: flex; width: max-content; animation: b-marquee 18s linear infinite; }
.banner[data-variant="strip"] .b-strip:hover .b-strip-track,
.banner[data-variant="strip"] .b-strip:focus-within .b-strip-track { animation-play-state: paused; }
.banner[data-variant="strip"] .b-strip-list { display: flex; gap: 24px; margin: 0; padding: 0 12px; list-style: none; }
.banner[data-variant="strip"] .b-strip-list li { flex: none; }
.banner[data-variant="strip"] .b-open {
  display: flex;
  align-items: center;
  gap: 10px;
  width: auto;
  height: auto;
  min-height: 44px;
  padding: 4px 12px 4px 4px;
  border-radius: 999px;
  color: var(--ta-title, inherit);
  font: inherit;
  white-space: nowrap;
}
.banner[data-variant="strip"] .b-media { width: 36px; height: 36px; flex: none; border-radius: 50%; }
.banner[data-variant="strip"] .b-open:focus-visible { outline: 2px solid var(--ta-ink); outline-offset: 2px; }
@keyframes b-marquee { to { translate: calc(var(--b-flow, 1) * -50%) 0; } }
@media (prefers-reduced-motion: reduce) {
  .banner[data-variant] .b-slide,
  .banner[data-variant] .b-track { transition: none; }
  .banner[data-variant="strip"] .b-strip { overflow-x: auto; }
  .banner[data-variant="strip"] .b-strip-track { animation: none; }
  .banner[data-variant="strip"] .b-strip-list[data-copy] { display: none; }
}
`;

const ICON_CLOSE = 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z';

// Whether a sticky banner was dismissed in this session: kept in sessionStorage, which a blocked store answers
// with nothing (the banner then shows again on the next page view).
const dismissKey = (groups: readonly DeliveryTaleGroup[]) => `taleart-banner-dismissed:${groups.map((g) => g.id).join(',')}`;
function dismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function remember(key: string): void {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // Storage is blocked: the banner stays dismissed for this page view only.
  }
}

/**
 * The sticky banner: a compact bar of the carousel docked to the bottom of its section, with the current
 * slide's cover and name, the arrows and the rotation button, and a dismiss button. It ignores the aspect
 * ratio, the dots and the loop (BANNER_IGNORED), so it always loops and shows no dots.
 */
function mountSticky(
  root: HTMLElement,
  groups: readonly DeliveryTaleGroup[],
  s: BannerSettings,
  onOpen: (groupId: string) => void,
  t: Translate,
): BannerView {
  const view = mountCarousel(root, groups, { ...s, loop: true, showDots: false }, onOpen, t);
  const key = dismissKey(groups);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'b-btn b-dismiss';
  close.setAttribute('aria-label', t('banner.dismiss'));
  setIcon(close, ICON_CLOSE);
  close.addEventListener('click', () => {
    remember(key);
    root.hidden = true;
    view.destroy();
  });
  root.appendChild(close);
  if (dismissed(key)) {
    root.hidden = true;
    view.destroy();
  }
  return view;
}

/**
 * The strip: a marquee of the groups that moves at a fixed speed (18 s for one loop of the groups), in the
 * direction the page reads. The groups are drawn twice, so the loop has no gap: the second copy is hidden from
 * assistive technology and from the keyboard. It pauses while the pointer is over it or a control has focus,
 * and under reduced motion it stops and scrolls sideways by hand. It never autoplays, loops or shows dots.
 */
function mountStrip(root: HTMLElement, groups: readonly DeliveryTaleGroup[], onOpen: (groupId: string) => void): BannerView {
  // The loop moves the track by the width of one copy, toward the inline end's opposite: left in an LTR page.
  root.style.setProperty('--b-flow', isRtl(root) ? '-1' : '1');
  const strip = document.createElement('div');
  strip.className = 'b-strip';
  const track = document.createElement('div');
  track.className = 'b-strip-track';
  const opens: HTMLButtonElement[] = [];
  for (const copy of [false, true]) {
    const list = document.createElement('ul');
    list.className = 'b-strip-list';
    if (copy) {
      list.dataset['copy'] = '';
      list.setAttribute('aria-hidden', 'true');
      list.inert = true;
    }
    for (const group of groups) {
      const li = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'b-open';
      open.setAttribute('aria-label', group.name);
      const media = coverMedia(group);
      media.className = 'b-media';
      if (media instanceof HTMLImageElement) media.draggable = false;
      const name = document.createElement('span');
      name.className = 'b-name';
      name.dir = 'auto';
      name.setAttribute('aria-hidden', 'true');
      name.textContent = group.name;
      open.append(media, name);
      if (!copy) {
        open.dataset['taleGroupId'] = group.id;
        open.addEventListener('click', () => onOpen(group.id));
        opens.push(open);
      }
      li.appendChild(open);
      list.appendChild(li);
    }
    track.appendChild(list);
  }
  strip.appendChild(track);
  root.appendChild(strip);
  return {
    element: root,
    index: 0,
    rotating: false,
    focus(groupId) {
      const open = groupId === null ? opens[0] : opens.find((o) => o.dataset['taleGroupId'] === groupId);
      if (!open) return false;
      open.focus();
      return true;
    },
    refresh() {
      root.style.setProperty('--b-flow', isRtl(root) ? '-1' : '1');
    },
    destroy() {
      // Nothing to stop: the strip has no timer, and its listeners go with its element.
    },
  };
}

/**
 * The variant's banner, drawn into `root` (the section the caller made, with its attributes): the variants'
 * stylesheet first, then the variant's markup and controller. The variant names come from BANNER_VARIANTS; the
 * carousel is not drawn here.
 */
export function mountBannerVariant(
  variant: BannerVariant,
  root: HTMLElement,
  groups: readonly DeliveryTaleGroup[],
  s: BannerSettings,
  onOpen: (groupId: string) => void,
  t: Translate,
): BannerView {
  const style = document.createElement('style');
  style.textContent = BANNER_VARIANT_STYLES;
  root.appendChild(style);
  switch (variant) {
    case 'coverflow':
      return mountCarousel(root, groups, s, onOpen, t, COVERFLOW);
    case 'peek':
      return mountCarousel(root, groups, s, onOpen, t, PEEK);
    case 'deck':
      return mountCarousel(root, groups, s, onOpen, t, DECK);
    case 'sticky':
      return mountSticky(root, groups, s, onOpen, t);
    case 'strip':
      return mountStrip(root, groups, onOpen);
    default:
      return mountCarousel(root, groups, s, onOpen, t);
  }
}
