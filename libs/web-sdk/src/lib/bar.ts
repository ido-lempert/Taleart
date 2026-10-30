import type { DeliveryTaleGroup } from '@taleart/contract';
import { defaultTranslate, type Translate } from './i18n';
import { adopt, BAR_LAYOUT_STYLES, renderRing, renderSkeleton } from './bar-layouts';
import { prefersReducedMotion } from './bar-cover';
import { readBarSettings, type BarLayout } from './bar-settings';
import { holdMedia } from './first-content';

// The bar is this module's public face: its settings, its covers, its layouts and its look. The parts live
// in bar-settings.ts (what a bar is set to), bar-cover.ts (the covers), bar-layouts.ts (the ring, the skeleton
// and what the layouts share) and bar-extra-layouts.ts (the chip, poster and stack), which loads on the first
// bar that asks for one, as the viewer does (viewer-loader.ts).
export {
  BAR_CHOICES,
  BAR_DEFAULTS,
  BAR_FRAME_TYPE,
  BAR_GAP_RANGE,
  BAR_IGNORED,
  BAR_LAYOUTS,
  BAR_SIZE_PX,
  barLayoutOf,
  CHIP_COVER_PX,
  readBarSettings,
  STACK_COVER_PX,
  type BarLayout,
} from './bar-settings';
export {
  applyCoverMotion,
  COVER_MOTION_MS,
  coverMedia,
  defaultCover,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  stillCover,
} from './bar-cover';
export { markBarSeen, renderSkeleton as renderBarSkeleton, setItemSeen } from './bar-layouts';

/**
 * The bar's look (R9, P4). The base row, its items and the focus ring come first; then each layout's
 * look (BAR_LAYOUT_STYLES). The theme's `--ta-*` tokens colour everything: the ring, the seen ring, the
 * surfaces, the title, the accent. Every motion stops under reduced motion (the visitor's setting).
 */
const BASE_STYLES = `
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
.bar:not([data-layout="chip"])[data-align="center"] > li:first-child { margin-inline-start: auto; }
.bar:not([data-layout="chip"])[data-align="center"] > li:last-child { margin-inline-end: auto; }
.bar .cover {
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--ta-surface, transparent);
}
.bar .item {
  display: block;
  box-sizing: border-box;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ta-title, inherit);
  font: inherit;
  cursor: pointer;
}
/* Two tokens, so the focus ring shows on any background: the paper inside, the ink outside. */
.bar .item:focus-visible { outline: 2px solid var(--ta-ink); outline-offset: 2px; box-shadow: 0 0 0 2px var(--ta-paper); border-radius: 8px; }
`;

// The chunk of the chip, poster and stack, once loaded (null before). A failed load is not kept: the next bar tries again.
let extra: typeof import('./bar-extra-layouts') | null = null;
let extraLoading: Promise<typeof import('./bar-extra-layouts')> | null = null;
function loadExtraLayouts(): Promise<typeof import('./bar-extra-layouts')> {
  return (extraLoading ??= import('./bar-extra-layouts').then(
    (module) => (extra = module),
    (err: unknown) => {
      extraLoading = null;
      throw err;
    },
  ));
}

/**
 * The look of the chip, the poster and the stack, once their chunk has loaded (empty before): the element adds it to
 * its stylesheet when it draws such a bar straight away, and a bar that waits for the chunk adds it beside its list.
 */
export function barLayoutStyles(): string {
  return extra?.EXTRA_LAYOUT_STYLES ?? '';
}

/**
 * The rules that come last, so a layout's own display and colours do not undo them: hidden titles, forced
 * colours (the ring drops its gradient for system colours), and no motion for a visitor who asks for reduced
 * motion (the ring turns, the items enter, the skeleton shimmers, the poster lifts).
 */
const LAST_STYLES = `
.bar[data-titles="hidden"] .title,
.bar[data-titles="hidden"] .ptitle { display: none; }
@media (forced-colors: active) {
  .ring::before { forced-color-adjust: none; background: CanvasText; }
  .item[data-seen] .ring::before { background: GrayText; }
}
@media (prefers-reduced-motion: reduce) {
  .bar > li,
  .bar .ring,
  .bar .ring::before,
  .bar .poster,
  .bar .sk { animation: none !important; transition: none !important; }
}
`;

/** The bar's full look, in the Shadow DOM of the element (see taleart-element.ts). */
export const BAR_STYLES = BASE_STYLES + BAR_LAYOUT_STYLES + LAST_STYLES;

// Whether the reading direction of a list is right to left: the nearest `dir` (ltr or rtl) in its tree, else the computed one.
function isRtl(list: HTMLElement): boolean {
  const dir = list.closest('[dir]')?.getAttribute('dir');
  if (dir === 'rtl' || dir === 'ltr') return dir === 'rtl';
  return getComputedStyle(list).direction === 'rtl';
}

// Arrow keys move focus through the items in visual order (RTL aware): the inline arrows follow the reading
// direction, the vertical ones take the previous or next item of the row or wrapped line, and Home and End
// go to the first and the last.
function moveFocus(list: HTMLElement, event: KeyboardEvent): void {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('button.item')];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at < 0) return;
  const rtl = isRtl(list);
  let to: number;
  switch (event.key) {
    case 'ArrowRight':
      to = at + (rtl ? -1 : 1);
      break;
    case 'ArrowLeft':
      to = at + (rtl ? 1 : -1);
      break;
    case 'ArrowDown':
      to = at + 1;
      break;
    case 'ArrowUp':
      to = at - 1;
      break;
    case 'Home':
      to = 0;
      break;
    case 'End':
      to = buttons.length - 1;
      break;
    default:
      return;
  }
  if (to < 0 || to >= buttons.length) return;
  event.preventDefault();
  buttons[to].focus();
}

/**
 * One bar per zone's tale groups, in order, in the layout the settings choose (ring by default), as buttons
 * named by the group. `seen` are the groups that show as seen. `settings` (the frame's, as delivered) set the
 * layout and its settings; each layout reads only the settings it uses (BAR_IGNORED). Animated covers stay
 * still when `reducedMotion` is true.
 *
 * The ring is drawn here. The chip, poster and stack are drawn from their chunk: at once when it is loaded,
 * else the list returns as the layout's loading skeleton and `onReady` is called with the list once the
 * layout is in it (a chunk that fails to load leaves the ring).
 *
 * Every item's `data-tale-group-ids` lists the groups it stands for (one, or all of a stack), so the element
 * counts an impression for each of them. Arrow keys move focus between the items in visual order.
 */
export function renderBar(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string> = new Set(),
  settings: unknown = {},
  reducedMotion = prefersReducedMotion(),
  t: Translate = defaultTranslate,
  onReady?: (list: HTMLElement) => void,
): HTMLElement {
  const s = readBarSettings(settings);
  const layout: BarLayout = s.layout ?? 'ring';
  if (layout === 'ring') return keyed(renderRing(groups, seen, s, reducedMotion, t));
  if (extra) return keyed(extra.renderExtraLayout(layout, groups, seen, s, reducedMotion, t));
  const list = keyed(renderSkeleton(layout));
  void loadExtraLayouts().then(
    (module) => {
      const built = holdMedia(() => module.renderExtraLayout(layout, groups, seen, s, reducedMotion, t));
      adopt(list, built);
      const style = document.createElement('style');
      style.textContent = module.EXTRA_LAYOUT_STYLES;
      list.before(style);
      onReady?.(list);
    },
    () => {
      adopt(list, renderRing(groups, seen, s, reducedMotion, t));
      onReady?.(list);
    },
  );
  return list;
}

/**
 * Loads the chip, poster and stack now, so the next bar of any of them is drawn in its list at once (the page
 * does not wait). Resolves once they are loaded; a failed load resolves too, and the next bar tries again.
 */
export function preloadBarLayouts(): Promise<void> {
  return loadExtraLayouts().then(
    () => undefined,
    () => undefined,
  );
}

// The arrow keys and Home and End move focus between the items of a list, as the list is drawn.
function keyed(list: HTMLUListElement): HTMLUListElement {
  list.addEventListener('keydown', (event) => moveFocus(list, event));
  return list;
}
