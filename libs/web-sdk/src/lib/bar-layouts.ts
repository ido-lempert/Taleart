import type { BarSettings, DeliveryTaleGroup } from '@taleart/contract';
import { cover } from './bar-cover';
import {
  BAR_DEFAULTS,
  BAR_SIZE_PX,
  CHIP_COVER_PX,
  POSTER_MAX_SEGMENTS,
  STACK_COVER_PX,
  STACK_MAX_COVERS,
  type BarLayout,
} from './bar-settings';
import { defaultTranslate, type Translate } from './i18n';

// The bar's layouts (epic end-user redesign P4): each draws its items as buttons named by their group. The
// ring is the default look; chip, poster and stack are the other three. A layout reads only the settings it
// uses (BAR_IGNORED), so an ignored setting never changes the page.

/**
 * Marks a bar item seen or unseen: the seen look, and the name says so for screen readers, since the look
 * alone does not.
 */
export function setItemSeen(button: HTMLElement, name: string, seen: boolean, t: Translate = defaultTranslate): void {
  button.toggleAttribute('data-seen', seen);
  button.setAttribute('aria-label', seen ? t('bar.seen', { name }) : name);
}

/** The state of a collapsed stack: its groups, the seen ones and the parts that change as groups are seen. */
interface StackState {
  readonly groups: readonly DeliveryTaleGroup[];
  readonly seen: Set<string>;
  readonly t: Translate;
  readonly button: HTMLButtonElement;
  readonly caption: HTMLElement;
}
const stacks = new WeakMap<HTMLElement, StackState>();

// The list of a layout: its class, its layout, and nothing else yet.
function listOf(layout: BarLayout): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'bar';
  list.dataset['layout'] = layout;
  return list;
}

// A list item, staggered on entry (the look's `--i`, see the layout styles).
function itemOf(index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.style.setProperty('--i', String(index));
  return li;
}

// A group's button: named by the group, with the seen state and the ids its impressions count.
function buttonOf(group: DeliveryTaleGroup, seen: ReadonlySet<string>, t: Translate, classes: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `item ${classes}`;
  button.dataset['taleGroupId'] = group.id;
  button.dataset['taleGroupIds'] = group.id;
  setItemSeen(button, group.name, seen.has(group.id), t);
  return button;
}

// A title, for the sighted: its own direction (a name in another script keeps it), hidden from screen readers.
function titleOf(name: string, className: string): HTMLSpanElement {
  const title = document.createElement('span');
  title.className = className;
  title.textContent = name;
  title.setAttribute('aria-hidden', 'true');
  title.dir = 'auto';
  return title;
}

// The settings a ring, chip or poster applies from the bar: the alignment, the titles and the gap.
function applyRowSettings(list: HTMLElement, s: BarSettings): void {
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

/** The chip: a round cover of the size beside its title, in a pill that wraps. Unseen groups show a dot. */
export function renderChip(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string>,
  s: BarSettings,
  reduced: boolean,
  t: Translate,
): HTMLUListElement {
  const list = listOf('chip');
  list.style.setProperty('--ta-size', `${CHIP_COVER_PX[s.size]}px`);
  applyRowSettings(list, s);
  groups.forEach((group, index) => {
    const li = itemOf(index);
    const button = buttonOf(group, seen, t, 'chip');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.appendChild(cover(group, reduced));
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    button.append(avatar, titleOf(group.name, 'title'), dot);
    li.appendChild(button);
    list.appendChild(li);
  });
  return list;
}

/** The poster: a tall card with the cover full bleed, its tales as segments, and the name and count over a scrim. */
export function renderPoster(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string>,
  s: BarSettings,
  reduced: boolean,
  t: Translate,
): HTMLUListElement {
  const list = listOf('poster');
  applyRowSettings(list, s);
  groups.forEach((group, index) => {
    const li = itemOf(index);
    const button = buttonOf(group, seen, t, 'poster');
    const segments = document.createElement('span');
    segments.className = 'segs';
    segments.setAttribute('aria-hidden', 'true');
    const count = Math.min(group.tales.length, POSTER_MAX_SEGMENTS);
    for (let i = 0; i < count; i++) segments.appendChild(document.createElement('i'));
    const scrim = document.createElement('span');
    scrim.className = 'scrim';
    const text = document.createElement('span');
    text.className = 'ptext';
    const caption = document.createElement('span');
    caption.className = 'pcaption';
    caption.setAttribute('aria-hidden', 'true');
    caption.textContent = t(group.tales.length === 1 ? 'bar.story' : 'bar.stories', { count: group.tales.length });
    const title = titleOf(group.name, 'ptitle');
    text.append(title, caption);
    button.append(cover(group, reduced), segments, scrim, text);
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

/**
 * The collapsed stack: up to four overlapping covers and a "+N" bubble for the rest, with the count of new
 * groups. One button opens the first unseen group. Its ids (`data-tale-group-ids`) are all the groups, so
 * each one's impression counts while the stack is on screen.
 */
export function renderStack(
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string>,
  s: BarSettings,
  reduced: boolean,
  t: Translate,
): HTMLUListElement {
  const list = listOf('stack');
  list.style.setProperty('--ta-size', `${STACK_COVER_PX[s.size]}px`);
  if (groups.length === 0) return list;
  const li = itemOf(0);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item stack';
  button.dataset['taleGroupIds'] = groups.map((group) => group.id).join(' ');
  const avatars = document.createElement('span');
  avatars.className = 'stack-avs';
  avatars.setAttribute('aria-hidden', 'true');
  for (const group of groups.slice(0, STACK_MAX_COVERS)) {
    const avatar = document.createElement('span');
    avatar.className = 'stack-av';
    avatar.appendChild(cover(group, reduced));
    avatars.appendChild(avatar);
  }
  if (groups.length > STACK_MAX_COVERS) {
    const more = document.createElement('span');
    more.className = 'stack-more';
    more.appendChild(Object.assign(document.createElement('bdi'), { textContent: `+${groups.length - STACK_MAX_COVERS}` }));
    avatars.appendChild(more);
  }
  const caption = document.createElement('span');
  caption.className = 'stack-caption';
  button.append(avatars, caption);
  li.appendChild(button);
  list.appendChild(li);
  const state: StackState = { groups, seen: new Set(seen), t, button, caption };
  stacks.set(list, state);
  refreshStack(state);
  return list;
}

// Points the stack at its first unseen group and writes its count.
function refreshStack(state: StackState): void {
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

/** The look of the ring, the chip, the poster, the stack and the loading skeleton (after the base bar look). */
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

/* Chip: a pill with a round cover and the title; an unseen dot in the accent; muted once seen. */
.bar[data-layout="chip"] { flex-wrap: wrap; overflow: visible; }
.bar[data-layout="chip"][data-align="center"] { justify-content: center; }
.bar[data-layout="chip"] .chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  max-width: 100%;
  padding-block: 4px;
  padding-inline: 4px 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: var(--ta-surface);
}
.bar[data-layout="chip"] .chip:hover { background: color-mix(in srgb, currentColor 10%, var(--ta-paper)); }
.bar .avatar {
  flex: none;
  display: block;
  width: var(--ta-size);
  height: var(--ta-size);
  border-radius: 50%;
  overflow: hidden;
}
.bar .avatar > .cover { width: 100%; height: 100%; border: 0; border-radius: 0; }
.bar[data-layout="chip"] .title {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: start;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  unicode-bidi: plaintext;
}
.bar .dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ta-accent);
  box-shadow: 0 0 0 1px var(--ta-ink);
}
.bar .chip[data-seen] { color: var(--ta-muted); }
.bar .chip[data-seen] .dot { display: none; }
.bar .chip[data-seen] .avatar > .cover { opacity: 0.6; }

/* Poster: a tall card, the cover full bleed, a scrim under the name, one segment per tale; hover lifts it. */
/* The card's shadow reaches about 30 px below it: the row keeps that room, or the scroll clips it. */
.bar[data-layout="poster"] { padding-block: 32px; }
.bar .poster {
  display: block;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  flex: none;
  width: 112px;
  height: 188px;
  border-radius: 16px;
  box-shadow: 0 18px 30px -18px color-mix(in srgb, var(--ta-dark) 80%, transparent);
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s;
}
.bar .poster:not([data-seen]) {
  box-shadow: inset 0 0 0 2px var(--ta-accent), 0 18px 30px -18px color-mix(in srgb, var(--ta-dark) 80%, transparent);
}
.bar .poster:hover {
  transform: translateY(-8px) rotate(-1.5deg);
  box-shadow: 0 30px 40px -18px color-mix(in srgb, var(--ta-accent) 60%, transparent);
}
.bar .poster:dir(rtl):hover { transform: translateY(-8px) rotate(1.5deg); }
.bar .poster > .cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  object-fit: cover;
}
.bar .segs {
  position: absolute;
  inset-block-start: 8px;
  inset-inline: 8px;
  z-index: 1;
  display: flex;
  gap: 3px;
}
.bar .segs i {
  flex: 1 1 0;
  height: 3px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--ta-light) 35%, transparent);
}
.bar .poster[data-seen] .segs i { background: var(--ta-light); }
.bar .scrim {
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  height: 60%;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--ta-dark) 90%, transparent) 0%,
    color-mix(in srgb, var(--ta-dark) 70%, transparent) 40%,
    transparent 100%
  );
}
.bar .ptext {
  position: absolute;
  inset-inline: 10px;
  inset-block-end: 10px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--ta-light);
  text-align: start;
}
.bar .ptitle {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.1;
  unicode-bidi: plaintext;
}
.bar .pcaption { font-size: 11px; line-height: 14px; }

/* Collapsed stack: overlapping covers, a "+N" bubble and the count of new groups, in one row. */
.bar[data-layout="stack"] { padding-block: 4px; }
.bar .stack {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 100%;
  min-height: 60px;
  padding-block: 10px;
  padding-inline: 24px 14px;
  border-radius: 16px;
  background: var(--ta-surface);
  color: var(--ta-title, inherit);
}
.bar .stack-avs { display: flex; align-items: center; flex: none; }
.bar .stack-av,
.bar .stack-more {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  box-sizing: border-box;
  width: var(--ta-size);
  height: var(--ta-size);
  margin-inline-start: -14px;
  border-radius: 50%;
  border: 3px solid var(--ta-paper);
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
}
.bar .stack-av:first-child { margin-inline-start: 0; }
.bar .stack-av > .cover { width: 100%; height: 100%; border: 0; border-radius: 0; }
.bar .stack-more { background: color-mix(in srgb, currentColor 14%, var(--ta-paper)); }
.bar .stack-caption {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  text-align: start;
  unicode-bidi: plaintext;
}
.bar .stack[data-none] .stack-caption { color: var(--ta-muted); }

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
