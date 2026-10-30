import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryTaleGroup } from '@taleart/contract';
import {
  BAR_CHOICES,
  BAR_DEFAULTS,
  BAR_IGNORED,
  BAR_LAYOUTS,
  BAR_SIZE_PX,
  BAR_STYLES,
  barLayoutOf,
  CHIP_COVER_PX,
  markBarSeen,
  readBarSettings,
  renderBar,
  renderBarSkeleton,
  STACK_COVER_PX,
} from './bar';
import { createTranslate } from './i18n';

const tale = (id: string) => ({
  id,
  title: id,
  media: { kind: 'image' as const, contentType: 'image/png' as const, url: `https://api.example.com/media/tales/${id}.png` },
});
// Six groups: three tales, one, none, one, one and one; the stack shows four covers and a "+2" bubble.
const groups: DeliveryTaleGroup[] = [
  { id: 'g1', name: 'Summer', cover: null, tales: [tale('a'), tale('b'), tale('c')] },
  { id: 'g2', name: 'Winter', cover: null, tales: [tale('d')] },
  { id: 'g3', name: 'Trips', cover: null, tales: [] },
  { id: 'g4', name: 'Food', cover: null, tales: [tale('e')] },
  { id: 'g5', name: 'Music', cover: null, tales: [tale('f')] },
  { id: 'g6', name: 'Sport', cover: null, tales: [tale('g')] },
];

const buttons = (list: HTMLElement) => [...list.querySelectorAll<HTMLButtonElement>('button.item')];
// The list in a page with a direction, attached so focus and the keyboard work.
function attached(list: HTMLElement, dir: 'ltr' | 'rtl' = 'ltr'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.dir = dir;
  wrap.append(list);
  document.body.append(wrap);
  return wrap;
}
const key = (el: Element, name: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

afterEach(() => {
  document.body.replaceChildren();
});

describe('bar layouts: settings', () => {
  it('match the contract: the layouts, their default and the ignored settings', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '../../../contract/frame-types/bar.schema.json'), 'utf8'),
    ) as { properties: { layout: { enum: string[]; default: string } } };
    expect(BAR_CHOICES.layout).toEqual(schema.properties.layout.enum);
    expect(BAR_DEFAULTS.layout).toBe(schema.properties.layout.default);
    expect(BAR_LAYOUTS).toEqual(['ring', 'chip', 'poster', 'stack']);
    // The dashboard's display options name these (apps/dashboard/src/app/display-options.ts).
    expect(BAR_IGNORED).toEqual({
      ring: [],
      chip: ['shape'],
      poster: ['shape', 'size'],
      stack: ['shape', 'showTitles', 'alignment', 'gap'],
    });
  });

  it('reads a missing or unknown layout as the ring, and keeps each known one', () => {
    expect(readBarSettings({}).layout).toBe('ring');
    expect(readBarSettings({ layout: 'tile' }).layout).toBe('ring');
    expect(readBarSettings({ layout: 7 }).layout).toBe('ring');
    for (const layout of BAR_LAYOUTS) expect(readBarSettings({ layout }).layout).toBe(layout);
  });

  it('names a layout for the loading skeleton only when the name is one', () => {
    expect(barLayoutOf('chip')).toBe('chip');
    expect(barLayoutOf('tile')).toBeNull();
    expect(barLayoutOf(null)).toBeNull();
  });

  it('draws the layout the settings name', () => {
    for (const layout of BAR_LAYOUTS) {
      expect(renderBar(groups, new Set(), { layout }).dataset['layout']).toBe(layout);
    }
    expect(renderBar(groups, new Set(), {}).dataset['layout']).toBe('ring');
  });
});

describe('bar layouts: ring', () => {
  it('draws each group as a cover in a ring, named by the group, with no overlay layer', () => {
    const list = renderBar(groups, new Set(), {}, false);
    const items = buttons(list);
    expect(items).toHaveLength(6);
    expect(items[0].querySelector('.ring > .cover')).not.toBeNull();
    expect(items[0].getAttribute('aria-label')).toBe('Summer');
    expect(list.querySelector('.blob')).toBeNull();
    expect(list.querySelector('.ring')?.children).toHaveLength(1);
  });

  it('marks a seen group with the seen ring and a seen name', () => {
    const items = buttons(renderBar(groups, new Set(['g2']), {}, false));
    expect(items[1].hasAttribute('data-seen')).toBe(true);
    expect(items[1].getAttribute('aria-label')).toBe('Winter, seen');
    expect(items[0].hasAttribute('data-seen')).toBe(false);
  });

  it('turns the unseen ring only, four seconds a turn, and stops it for reduced motion', () => {
    expect(BAR_STYLES).toContain('.item:not([data-seen]) .ring::before { animation: ta-bar-spin 4s linear infinite; }');
    expect(BAR_STYLES).toContain('.item[data-seen] .ring::before { background: var(--ta-seen, var(--ta-muted)); }');
    expect(BAR_STYLES).toMatch(/\.ring \{[^}]*padding: var\(--ta-ring-width, 2px\);/);
    expect(BAR_STYLES).toContain('.item:hover .ring { transform: scale(1.07); }');
    expect(BAR_STYLES).toContain('.item:active .ring { transform: scale(0.94); }');
    expect(BAR_STYLES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.bar \.ring::before[\s\S]*animation: none !important/);
  });

  it('staggers the entrance by item, 60 ms apart', () => {
    const items = [...renderBar(groups, new Set(), {}, false).querySelectorAll<HTMLElement>(':scope > li')];
    expect(items.map((li) => li.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(BAR_STYLES).toContain('animation-delay: calc(var(--i, 0) * 60ms);');
  });

  it('draws a rounded square for the shape, and the circle by default', () => {
    expect(renderBar(groups, new Set(), { shape: 'rounded-square' }).dataset['shape']).toBe('rounded-square');
    expect(renderBar(groups, new Set(), {}).dataset['shape']).toBe('circle');
    expect(BAR_STYLES).toContain('.bar[data-shape="rounded-square"] .ring { border-radius: var(--ta-radius, calc(var(--ta-size) / 4)); }');
  });

  it('sizes its covers by the size setting', () => {
    for (const [size, px] of Object.entries(BAR_SIZE_PX)) {
      expect(renderBar(groups, new Set(), { size }).style.getPropertyValue('--ta-size')).toBe(`${px}px`);
    }
  });
});

describe('bar layouts: chip', () => {
  const chips = (settings: object = {}) => renderBar(groups, new Set(), { layout: 'chip', ...settings }, false);

  it('draws each group as a pill with a round cover, its title and an unseen dot', () => {
    const items = buttons(chips());
    expect(items).toHaveLength(6);
    expect(items[0].classList.contains('chip')).toBe(true);
    expect(items[0].querySelector('.avatar > .cover')).not.toBeNull();
    expect(items[0].querySelector('.title')?.textContent).toBe('Summer');
    expect(items[0].querySelector('.dot')).not.toBeNull();
    expect(BAR_STYLES).toContain('min-height: 44px;');
  });

  it('mutes a seen chip, and its dot goes', () => {
    const list = attached(renderBar(groups, new Set(['g1']), { layout: 'chip' }, false));
    const [first, second] = buttons(list);
    expect(first.hasAttribute('data-seen')).toBe(true);
    expect(second.hasAttribute('data-seen')).toBe(false);
    expect(BAR_STYLES).toContain('.bar .chip[data-seen] .dot { display: none; }');
    expect(BAR_STYLES).toContain('.bar .chip[data-seen] { color: var(--ta-muted); }');
  });

  it('sizes its cover by the size setting, and wraps its items', () => {
    expect(chips({ size: 'large' }).style.getPropertyValue('--ta-size')).toBe(`${CHIP_COVER_PX.large}px`);
    expect(BAR_STYLES).toContain('.bar[data-layout="chip"] { flex-wrap: wrap; overflow: visible; }');
  });

  it('ignores the shape: no shape is set on the list, and the covers stay round', () => {
    const list = chips({ shape: 'rounded-square' });
    expect(list.hasAttribute('data-shape')).toBe(false);
  });

  it('applies the alignment, the titles and the gap', () => {
    const list = chips({ alignment: 'center', showTitles: false, gap: 20 });
    expect(list.dataset).toMatchObject({ align: 'center', titles: 'hidden' });
    expect(list.style.gap).toBe('20px');
  });
});

describe('bar layouts: poster', () => {
  const posters = (settings: object = {}) => renderBar(groups, new Set(), { layout: 'poster', ...settings }, false);

  it('draws each group as a card with the cover full bleed, a scrim and its name', () => {
    const items = buttons(posters());
    expect(items[0].classList.contains('poster')).toBe(true);
    expect(items[0].querySelector(':scope > .cover')).not.toBeNull();
    expect(items[0].querySelector('.scrim')).not.toBeNull();
    expect(items[0].querySelector('.ptitle')?.textContent).toBe('Summer');
    expect(BAR_STYLES).toContain('width: 112px;\n  height: 188px;');
  });

  it('shows one segment per tale, at most twelve', () => {
    const items = buttons(posters());
    expect(items[0].querySelectorAll('.segs i')).toHaveLength(3);
    expect(items[2].querySelectorAll('.segs i')).toHaveLength(0);
    const many = { id: 'gm', name: 'Many', cover: null, tales: Array.from({ length: 15 }, (_, i) => tale(`m${i}`)) };
    expect(buttons(renderBar([many], new Set(), { layout: 'poster' }, false))[0].querySelectorAll('.segs i')).toHaveLength(12);
  });

  it('captions the count of tales, in the singular for one', () => {
    const items = buttons(posters());
    expect(items.map((b) => b.querySelector('.pcaption')?.textContent)).toEqual([
      '3 stories',
      '1 story',
      '0 stories',
      '1 story',
      '1 story',
      '1 story',
    ]);
    const many = { id: 'gm', name: 'Many', cover: null, tales: Array.from({ length: 15 }, (_, i) => tale(`m${i}`)) };
    expect(buttons(renderBar([many], new Set(), { layout: 'poster' }, false))[0].querySelector('.pcaption')?.textContent).toBe(
      '15 stories',
    );
  });

  it('marks an unseen card with the accent border and a seen one filled', () => {
    expect(BAR_STYLES).toContain('.bar .poster:not([data-seen]) {\n  box-shadow: inset 0 0 0 2px var(--ta-accent)');
    expect(BAR_STYLES).toContain('.bar .poster[data-seen] .segs i { background: var(--ta-light); }');
    const items = buttons(renderBar(groups, new Set(['g1']), { layout: 'poster' }, false));
    expect(items[0].hasAttribute('data-seen')).toBe(true);
    expect(items[0].getAttribute('aria-label')).toBe('Summer, seen');
  });

  it('lifts on hover with a tilt that mirrors in right-to-left', () => {
    expect(BAR_STYLES).toContain('.bar .poster:hover {\n  transform: translateY(-8px) rotate(-1.5deg);');
    expect(BAR_STYLES).toContain('.bar .poster:dir(rtl):hover { transform: translateY(-8px) rotate(1.5deg); }');
  });

  it('ignores the shape and the size: no shape is set, and no cover size either', () => {
    const list = posters({ shape: 'rounded-square', size: 'large' });
    expect(list.hasAttribute('data-shape')).toBe(false);
    expect(list.style.getPropertyValue('--ta-size')).toBe('');
  });

  it('keeps the alignment, the titles and the gap', () => {
    const list = posters({ alignment: 'center', showTitles: false, gap: 8 });
    expect(list.dataset).toMatchObject({ align: 'center', titles: 'hidden' });
    expect(list.style.gap).toBe('8px');
  });

  it('keeps white text readable on its scrim over the lightest picture (4.5:1 or more)', () => {
    // The scrim's stops (bar-layouts.ts): 90 % of the dark token at the foot, 70 % at 40 % of its 60 % height,
    // nothing at the top. The title sits between 10 px and 49 px above the foot of a 188 px card.
    const scrimHeight = 188 * 0.6;
    const alphaAt = (fromFoot: number) => {
      const t = fromFoot / scrimHeight;
      return t <= 0.4 ? 0.9 - (0.2 * t) / 0.4 : 0.7 * (1 - (t - 0.4) / 0.6);
    };
    const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = (rgb: number[]) => 0.2126 * channel(rgb[0] / 255) + 0.7152 * channel(rgb[1] / 255) + 0.0722 * channel(rgb[2] / 255);
    const dark = [0x11, 0x18, 0x27]; // the scheme's dark ground, #111827
    const white = [255, 255, 255];
    let worst = Infinity;
    for (let d = 10; d <= 49; d++) {
      const a = alphaAt(d);
      // A white picture under the scrim is the worst case for white text.
      const behind = dark.map((c, i) => c * a + white[i] * (1 - a));
      const contrast = (1 + 0.05) / (luminance(behind) + 0.05);
      worst = Math.min(worst, contrast);
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});

describe('bar layouts: stack', () => {
  const stack = (settings: object = {}, seen: string[] = []) =>
    renderBar(groups, new Set(seen), { layout: 'stack', ...settings }, false);

  it('draws up to four overlapping covers, a +N bubble and the count of new groups in one button', () => {
    const list = stack();
    const [button] = buttons(list);
    expect(buttons(list)).toHaveLength(1);
    expect(button.querySelectorAll('.stack-av')).toHaveLength(4);
    expect(button.querySelector('.stack-av > .cover')).not.toBeNull();
    expect(button.querySelector('.stack-more')?.textContent).toBe('+2');
    expect(button.querySelector('.stack-caption')?.textContent).toBe('6 new stories');
    expect(button.getAttribute('aria-label')).toBe('6 new stories');
  });

  it('has no bubble for four groups or fewer, and the singular for one new group', () => {
    const few = renderBar(groups.slice(0, 4), new Set(), { layout: 'stack' }, false);
    expect(buttons(few)[0].querySelector('.stack-more')).toBeNull();
    const one = renderBar(groups.slice(0, 1), new Set(), { layout: 'stack' }, false);
    expect(buttons(one)[0].querySelector('.stack-caption')?.textContent).toBe('1 new story');
  });

  it('opens the first unseen group, and lists every group in its ids for the impressions', () => {
    const [button] = buttons(stack({}, ['g1']));
    expect(button.dataset['taleGroupId']).toBe('g2');
    expect(button.dataset['taleGroupIds']).toBe('g1 g2 g3 g4 g5 g6');
    expect(button.querySelector('.stack-caption')?.textContent).toBe('5 new stories');
  });

  it('moves to the next unseen group as the visitor sees them, and says so when none is new', () => {
    const list = stack();
    const [button] = buttons(list);
    markBarSeen(list, 'g1', 'Summer');
    expect(button.dataset['taleGroupId']).toBe('g2');
    expect(button.querySelector('.stack-caption')?.textContent).toBe('5 new stories');
    for (const id of ['g2', 'g3', 'g4', 'g5']) markBarSeen(list, id, id);
    expect(button.querySelector('.stack-caption')?.textContent).toBe('1 new story');
    markBarSeen(list, 'g6', 'Sport');
    expect(button.querySelector('.stack-caption')?.textContent).toBe('No new stories');
    expect(button.hasAttribute('data-none')).toBe(true);
    expect(button.dataset['taleGroupId']).toBe('g1');
  });

  it('sizes its covers by the size setting, and ignores the shape, the titles, the alignment and the gap', () => {
    const list = stack({ size: 'small', shape: 'rounded-square', showTitles: false, alignment: 'center', gap: 20 });
    expect(list.style.getPropertyValue('--ta-size')).toBe(`${STACK_COVER_PX.small}px`);
    expect(list.hasAttribute('data-shape')).toBe(false);
    expect(list.hasAttribute('data-titles')).toBe(false);
    expect(list.hasAttribute('data-align')).toBe(false);
    expect(list.style.gap).toBe('');
  });

  it('renders no items for a zone without groups', () => {
    expect(renderBar([], new Set(), { layout: 'stack' }, false).querySelectorAll('li')).toHaveLength(0);
  });
});

describe('bar layouts: keyboard', () => {
  it.each(['ltr', 'rtl'] as const)('moves focus through the items in visual order (%s)', (dir) => {
    attached(renderBar(groups, new Set(), { layout: 'chip' }, false), dir);
    const items = buttons(document.querySelector('ul.bar') as HTMLElement);
    items[0].focus();
    // The next item in the reading direction is on the left in right-to-left.
    key(items[0], dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
    expect(document.activeElement).toBe(items[0]);
  });

  it('does not move past the ends, and takes Home and End to them', () => {
    attached(renderBar(groups, new Set(), {}, false));
    const items = buttons(document.querySelector('ul.bar') as HTMLElement);
    items[0].focus();
    key(items[0], 'ArrowLeft');
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'End');
    expect(document.activeElement).toBe(items[5]);
    key(items[5], 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  it('takes the up and down arrows to the previous and next item of the reading order', () => {
    attached(renderBar(groups, new Set(), { layout: 'chip' }, false));
    const items = buttons(document.querySelector('ul.bar') as HTMLElement);
    items[1].focus();
    key(items[1], 'ArrowDown');
    expect(document.activeElement).toBe(items[2]);
    key(items[2], 'ArrowUp');
    expect(document.activeElement).toBe(items[1]);
  });
});

describe('bar layouts: loading skeleton', () => {
  it.each([
    ['ring', 5],
    ['chip', 4],
    ['poster', 4],
    ['stack', 1],
  ] as const)('draws the %s footprint, busy and with no content in it', (layout, count) => {
    const list = renderBarSkeleton(layout);
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(list.classList.contains('skeleton')).toBe(true);
    expect(list.dataset['layout']).toBe(layout);
    expect(list.querySelectorAll(':scope > li')).toHaveLength(count);
    expect(list.querySelectorAll('li[aria-hidden="true"]')).toHaveLength(count);
    expect(list.querySelector('button, .cover')).toBeNull();
    expect(list.querySelector('.sk')).not.toBeNull();
  });

  it('keeps the skeleton still under reduced motion, and off the first-content path', () => {
    expect(BAR_STYLES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.bar \.sk \{ animation: none !important/);
    expect(BAR_STYLES).toContain('.bar.skeleton > li { animation: none; }');
    expect(BAR_STYLES).toContain('animation: ta-bar-shimmer 1.4s linear infinite;');
  });

  it('draws the ring skeleton at the default footprint: a circle and a title line per item', () => {
    const [first] = [...renderBarSkeleton('ring').querySelectorAll<HTMLElement>(':scope > li')];
    expect(first.querySelector('.sk-circle')).not.toBeNull();
    expect(first.querySelector('.sk-line')).not.toBeNull();
    expect(BAR_STYLES).toContain('.bar.skeleton[data-layout="ring"] > li { display: flex;');
  });
});

describe('bar layouts: motion and text', () => {
  it('gives every title its own direction, and the titles of the other layouts their look', () => {
    const titles = [...renderBar(groups, new Set(), { layout: 'chip' }, false).querySelectorAll<HTMLElement>('.title')];
    expect(titles).toHaveLength(6);
    expect(titles.every((t) => t.dir === 'auto')).toBe(true);
    expect(BAR_STYLES).toMatch(/\.bar\[data-layout="chip"\] \.title \{[^}]*text-overflow: ellipsis;[^}]*unicode-bidi: plaintext;/);
    expect(BAR_STYLES).toMatch(/\.bar \.ptitle \{[^}]*unicode-bidi: plaintext;/);
  });

  it('hides the titles last, so a layout display rule cannot show them again', () => {
    const hidden = BAR_STYLES.indexOf('.bar[data-titles="hidden"] .title,');
    expect(hidden).toBeGreaterThan(BAR_STYLES.indexOf('.bar[data-layout="ring"] .title {'));
    expect(hidden).toBeGreaterThan(BAR_STYLES.indexOf('.bar .ptitle {'));
  });

  it('keeps the seen label in the locale the render was given', () => {
    const t = createTranslate('he', { he: { 'bar.seen': '{name}, נצפה' } });
    const [first] = buttons(renderBar(groups, new Set(['g1']), { layout: 'chip' }, false, t));
    expect(first.getAttribute('aria-label')).toBe('Summer, נצפה');
  });
});
