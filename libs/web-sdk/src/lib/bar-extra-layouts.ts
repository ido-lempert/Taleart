import type { BarSettings, DeliveryTaleGroup } from '@taleart/contract';
import { cover } from './bar-cover';
import {
  applyRowSettings,
  buttonOf,
  itemOf,
  listOf,
  refreshStack,
  stacks,
  type StackState,
  titleOf,
} from './bar-layouts';
import { CHIP_COVER_PX, POSTER_MAX_SEGMENTS, type BarLayout, STACK_COVER_PX, STACK_MAX_COVERS } from './bar-settings';
import type { Translate } from './i18n';

// The bar's chip, poster and collapsed stack (epic end-user redesign P4), in their own chunk: they load on the
// first bar that asks for one (bar.ts renderBar), and the ring, which is the default, stays in the core with
// the loading skeleton. Each fills its list in the core's helpers (listOf, buttonOf, ...), so every layout
// shares the same items, seen state and keyboard handling.

/** The look of the chip, the poster and the stack (after the base bar look; the core draws the ring and skeleton). */
export const EXTRA_LAYOUT_STYLES = `
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

`;

/** The layouts this chunk draws, as the bar's layout names. */
export type ExtraLayout = Exclude<BarLayout, 'ring'>;

/** Draws one of the chunk's layouts as a list of items, as the core's renderRing does for the ring. */
export function renderExtraLayout(
  layout: ExtraLayout,
  groups: readonly DeliveryTaleGroup[],
  seen: ReadonlySet<string>,
  s: BarSettings,
  reduced: boolean,
  t: Translate,
): HTMLUListElement {
  return layout === 'chip'
    ? renderChip(groups, seen, s, reduced, t)
    : layout === 'poster'
      ? renderPoster(groups, seen, s, reduced, t)
      : renderStack(groups, seen, s, reduced, t);
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

