import type { BarSettings, DeliveryTaleGroup } from '@taleart/contract';
import { cover } from './bar-cover';
import {
  BAR_DEFAULTS,
  BAR_SIZE_PX,
  CHIP_COVER_PX,
  STACK_COVER_PX,
  STACK_MAX_COVERS,
  type BarLayout,
} from './bar-settings';
import { defaultTranslate, type Translate } from './i18n';

// The bar's core layouts (epic end-user redesign P4): the ring, the default look, and the helpers every layout
// shares (the items, their seen state, the stack's count). The chip, poster and stack are drawn by
// bar-extra-layouts.ts, which loads on first use; the loading skeleton of every layout is here, so it shows
// before that chunk arrives. A layout reads only the settings it uses (BAR_IGNORED).

/**
 * Marks a bar item seen or unseen: the seen look, and the name says so for screen readers, since the look
 * alone does not.
 */
export function setItemSeen(button: HTMLElement, name: string, seen: boolean, t: Translate = defaultTranslate): void {
  button.toggleAttribute('data-seen', seen);
  button.setAttribute('aria-label', seen ? t('bar.seen', { name }) : name);
}

/** The state of a collapsed stack: its groups, the seen ones and the parts that change as groups are seen. */
export interface StackState {
  readonly groups: readonly DeliveryTaleGroup[];
  readonly seen: Set<string>;
  readonly t: Translate;
  readonly button: HTMLButtonElement;
  readonly caption: HTMLElement;
}
export const stacks = new WeakMap<HTMLElement, StackState>();

// The list of a layout: its class, its layout, and nothing else yet.
export function listOf(layout: BarLayout): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'bar';
  list.dataset['layout'] = layout;
  return list;
}

// A list item, staggered on entry (the look's `--i`, see the layout styles).
export function itemOf(index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.style.setProperty('--i', String(index));
  return li;
}

// A group's button: named by the group, with the seen state and the ids its impressions count.
export function buttonOf(group: DeliveryTaleGroup, seen: ReadonlySet<string>, t: Translate, classes: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `item ${classes}`;
  button.dataset['taleGroupId'] = group.id;
  button.dataset['taleGroupIds'] = group.id;
  setItemSeen(button, group.name, seen.has(group.id), t);
  return button;
}

// A title, for the sighted: its own direction (a name in another script keeps it), hidden from screen readers.
export function titleOf(name: string, className: string): HTMLSpanElement {
  const title = document.createElement('span');
  title.className = className;
  title.textContent = name;
  title.setAttribute('aria-hidden', 'true');
  title.dir = 'auto';
  return title;
}

// The settings a ring, chip or poster applies from the bar: the alignment, the titles and the gap.
export function applyRowSettings(list: HTMLElement, s: BarSettings): void {
  list.dataset['align'] = s.alignment;
  list.dataset['titles'] = s.showTitles ? 'shown' : 'hidden';
  list.style.gap = `${s.gap}px`;
}

/** The ring: a round cover in a ring, or a rounded square with `shape`. The default look. */
export function renderRing(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string>,
  s: BarSettings,
  reduced: boolean,
  t: Translate,
): HTMLUListElement {
  const list = listOf('ring');
  list.dataset['shape'] = s.shape;
  list.style.setProperty('--ta-size', `${BAR_SIZE_PX[s.size]}px`);
  applyRowSettings(list, s);
  groups.forEach((group, index) => {
    const li = itemOf(index);
    const button = buttonOf(group, seen, t, 'ring-item');
    const ring = document.createElement('span');
    ring.className = 'ring';
    ring.appendChild(cover(group, reduced));
    button.append(ring, titleOf(group.name, 'title'));
    li.appendChild(button);
    list.appendChild(li);
  });
  return list;
}

// The caption of a collapsed stack: how many groups are unseen.
function stackCaption(unseen: number, t: Translate): string {
  if (unseen === 0) return t('bar.noNewStories');
  return t(unseen === 1 ? 'bar.newStory' : 'bar.newStories', { count: unseen });
}

// The group the stack opens: the first unseen one, else the first.
function stackTarget(groups: readonly DeliveryTaleGroup[], seen: ReadonlySet<string>): DeliveryTaleGroup {
  return groups.find((group) => !seen.has(group.id)) ?? groups[0];
}

// Points the stack at its first unseen group and writes its count.
export function refreshStack(state: StackState): void {
  const unseen = state.groups.filter((group) => !state.seen.has(group.id)).length;
  const target = stackTarget(state.groups, state.seen);
  state.button.dataset['taleGroupId'] = target.id;
  const text = stackCaption(unseen, state.t);
  state.caption.textContent = text;
  state.button.setAttribute('aria-label', text);
  state.button.toggleAttribute('data-none', unseen === 0);
}

/**
 * Marks a group seen in a rendered bar: its item's seen look (ring, chip, poster), or, for a collapsed stack,
 * the count and the group the stack opens next.
 */
export function markBarSeen(list: HTMLElement, groupId: string, name: string, t: Translate = defaultTranslate): void {
  const state = stacks.get(list);
  if (state) {
    state.seen.add(groupId);
    refreshStack(state);
    return;
  }
  const button = [...list.querySelectorAll<HTMLElement>('button.item')].find((b) => b.dataset['taleGroupId'] === groupId);
  if (button) setItemSeen(button, name, true, t);
}

/**
 * Takes the items, the look and the stack state of `built` (a list a layout drew) into `list`, the element the
 * caller already holds: a loading skeleton becomes the layout, with its listeners and its place in the page.
 */
export function adopt(list: HTMLUListElement, built: HTMLUListElement): void {
  list.replaceChildren(...built.childNodes);
  list.className = built.className;
  list.removeAttribute('aria-busy');
  list.setAttribute('style', built.getAttribute('style') ?? '');
  for (const name of [...list.getAttributeNames()]) if (name.startsWith('data-')) list.removeAttribute(name);
  for (const name of built.getAttributeNames()) if (name.startsWith('data-')) list.setAttribute(name, built.getAttribute(name) ?? '');
  const state = stacks.get(built);
  if (state) stacks.set(list, state);
}

/** The number of items a loading skeleton draws for each layout. */
const SKELETON_ITEMS: Readonly<Record<BarLayout, number>> = { ring: 5, chip: 4, poster: 4, stack: 1 };

/**
 * The loading skeleton of a layout: the same footprint as the bar would take with the default settings, drawn
 * in the theme's ink, shimmering unless the visitor asks for reduced motion. It is not content: it has no
 * accessible name, and its list is busy until the zone is on the page.
 */
export function renderSkeleton(layout: BarLayout): HTMLUListElement {
  const list = listOf(layout);
  list.classList.add('skeleton');
  list.setAttribute('aria-busy', 'true');
  list.style.setProperty('--ta-size', `${layout === 'stack' ? STACK_COVER_PX.medium : layout === 'chip' ? CHIP_COVER_PX.medium : BAR_SIZE_PX.medium}px`);
  list.style.gap = `${BAR_DEFAULTS.gap}px`;
  for (let i = 0; i < SKELETON_ITEMS[layout]; i++) {
    const li = itemOf(i);
    li.setAttribute('aria-hidden', 'true');
    if (layout === 'ring') {
      li.append(block('sk sk-circle'), block('sk sk-line'));
    } else if (layout === 'chip') {
      const pill = block('sk-pill');
      pill.append(block('sk sk-circle'), block('sk sk-line sk-line-wide'));
      li.appendChild(pill);
    } else if (layout === 'poster') {
      li.appendChild(block('sk sk-card'));
    } else {
      const pill = block('sk-pill sk-stack');
      for (let k = 0; k < STACK_MAX_COVERS; k++) pill.appendChild(block('sk sk-stack-av'));
      pill.appendChild(block('sk sk-line sk-line-wide'));
      li.appendChild(pill);
    }
    list.appendChild(li);
  }
  return list;
}

function block(classes: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = classes;
  return el;
}

/** The look of the ring and the loading skeleton of every layout (after the base bar look; the other layouts' look is in bar-extra-layouts.ts). */
export const BAR_LAYOUT_STYLES = `
/* Ring: the cover in a gradient ring that turns only while unseen, behind a padding the cover never reaches. */
.bar[data-layout="ring"] .item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: calc(var(--ta-size) + 12px);
}
.ring {
  display: block;
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  width: var(--ta-size);
  height: var(--ta-size);
  border-radius: 50%;
  /* The gradient turns in a box twice the ring's, so it covers the ring at every angle; the ring clips it to its shape. */
  overflow: hidden;
  padding: var(--ta-ring-width, 2px);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ring::before {
  content: "";
  position: absolute;
  inset: -50%;
  z-index: -1;
  border-radius: inherit;
  background: var(--ta-ring, var(--ta-muted));
}
.item[data-seen] .ring::before { background: var(--ta-seen, var(--ta-muted)); }
.item:not([data-seen]) .ring::before { animation: ta-bar-spin 4s linear infinite; }
.item:hover .ring { transform: scale(1.07); }
.item:active .ring { transform: scale(0.94); }
.ring > .cover {
  border: 2px solid var(--ta-gap, var(--ta-paper));
  border-radius: 50%;
}
.bar[data-shape="rounded-square"] .ring { border-radius: var(--ta-radius, calc(var(--ta-size) / 4)); }
.bar[data-shape="rounded-square"] .ring > .cover {
  border-radius: max(0px, calc(var(--ta-radius, calc(var(--ta-size) / 4)) - var(--ta-ring-width, 2px)));
}
.bar[data-layout="ring"] .title {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  /* A name in another script keeps its own direction: a first line in Latin does not turn the others around. */
  unicode-bidi: plaintext;
}

/* Loading skeleton: the footprint of the bar, shimmering in the theme's ink. */
@keyframes ta-bar-spin { to { transform: rotate(360deg); } }
@keyframes ta-bar-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes ta-bar-enter {
  from { opacity: 0; transform: translateY(14px) scale(0.9); }
  to { opacity: 1; transform: none; }
}
.bar > li { animation: ta-bar-enter 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; animation-delay: calc(var(--i, 0) * 60ms); }
.bar.skeleton > li { animation: none; }
.bar .sk {
  display: block;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ta-ink) 8%, transparent) 25%,
    color-mix(in srgb, var(--ta-ink) 16%, transparent) 50%,
    color-mix(in srgb, var(--ta-ink) 8%, transparent) 75%
  );
  background-size: 200% 100%;
  animation: ta-bar-shimmer 1.4s linear infinite;
}
.bar .sk-circle { flex: none; width: var(--ta-size); height: var(--ta-size); border-radius: 50%; }
.bar .sk-line {
  flex: none;
  box-sizing: border-box;
  width: 44px;
  height: 16px;
  padding-block: 4px;
  border-radius: 0;
  background-clip: content-box;
}
.bar .sk-line-wide { width: 72px; }
.bar .sk-card { flex: none; width: 112px; height: 188px; border-radius: 16px; }
.bar .sk-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding-block: 4px;
  padding-inline: 4px 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ta-ink) 6%, transparent);
}
.bar .sk-pill.sk-stack { min-height: 60px; padding-block: 10px; padding-inline: 24px 14px; border-radius: 16px; gap: 12px; }
.bar .sk-stack-av {
  flex: none;
  box-sizing: border-box;
  width: var(--ta-size);
  height: var(--ta-size);
  margin-inline-start: -14px;
  border-radius: 50%;
  border: 3px solid var(--ta-paper);
}
.bar .sk-stack-av:first-child { margin-inline-start: 0; }
.bar.skeleton[data-layout="ring"] > li { display: flex; flex-direction: column; align-items: center; gap: 6px; width: calc(var(--ta-size) + 12px); }
`;
