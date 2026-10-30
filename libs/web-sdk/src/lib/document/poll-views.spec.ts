import type { DeliveryTaleElement } from '@taleart/contract';
import type { ResponseClient, StoredResponse } from '../responses';
import { onAccent } from '../theme';
import { loadPollViews, pollViewOf, POLL_STYLES, POLL_VIEWS, renderPoll } from './poll';
import { POLL_VIEW_STYLES } from './poll-views';

// Epic interactive components, the poll views (R2, R10; the end-user redesign P6a): the four views other than the
// sticker, drawn by their own chunk, in both directions.
const pollId = '00000000-0000-4000-8000-0000000000bb';
const options = [
  { id: 'midnight', label: 'Midnight', color: '#3B2FC9' },
  { id: 'coral', label: 'Coral', color: '#FF6F61' },
];

function poll(props: Record<string, unknown> = {}): DeliveryTaleElement {
  return {
    id: pollId,
    type: 'poll',
    box: { x: 0.1, y: 0.4, w: 0.8, h: 0.3, rotation: 0 },
    a11y: {},
    props: { question: 'Which colourway?', theme: 'light', options, ...props } as DeliveryTaleElement['props'],
  };
}

function result(value: string, total: number, percents: [number, number]): StoredResponse {
  const counts = value === 'midnight' ? [Math.round((total * percents[0]) / 100), total - Math.round((total * percents[0]) / 100)] : [0, 0];
  return {
    value,
    result: {
      total,
      choices: [
        { id: 'midnight', count: counts[0], percent: percents[0] },
        { id: 'coral', count: counts[1], percent: percents[1] },
      ],
    },
  };
}

function client(kept: StoredResponse | null = null) {
  const send = vi.fn(async (_taleId: string, _elementId: string, value: string) => result(value, 100, [60, 40]));
  const stored = vi.fn(() => kept);
  return { client: { send, stored } satisfies ResponseClient, send };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const optionsOf = (node: HTMLElement) => [...node.querySelectorAll<HTMLButtonElement>('button')];
const pct = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>('.ta-poll-pct')].map((p) => p.textContent);

// The WCAG contrast of two `#rrggbb` colours.
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the poll views chunk', () => {
  it('draws a view other than the sticker as a placeholder until its chunk loads, then fills it (C10, lazy)', async () => {
    const node = renderPoll(poll({ view: 'grid' }), { reducedMotion: false }) as HTMLElement;
    expect(node.classList).toContain('ta-poll-pending');
    expect(node.getAttribute('aria-busy')).toBe('true');
    expect(node.querySelector('.ta-tile')).toBeNull();
    await loadPollViews();
    await flush();
    expect(node.classList).not.toContain('ta-poll-pending');
    expect(node.getAttribute('aria-busy')).toBeNull();
    expect(node.querySelectorAll('.ta-tile')).toHaveLength(2);
  });

  it('keeps the sticker-free page path synchronous: the sticker draws at once', () => {
    const node = renderPoll(poll(), { reducedMotion: false }) as HTMLElement;
    expect(node.classList).not.toContain('ta-poll-pending');
    expect(optionsOf(node)).toHaveLength(2);
  });

  it('draws an unknown view as the sticker, and a missing one too', () => {
    expect(pollViewOf({ view: 'carousel' })).toBe('sticker');
    expect(pollViewOf({})).toBe('sticker');
    expect(POLL_VIEWS).toEqual(['sticker', 'embed', 'this-or-that', 'grid', 'inline']);
    expect((renderPoll(poll({ view: 'carousel' }), { reducedMotion: false }) as HTMLElement).classList).toContain('ta-poll-v-sticker');
  });
});

describe.each(['ltr', 'rtl'])('poll views in a %s page', (dir) => {
  let wrapper: HTMLElement;
  beforeAll(async () => {
    await loadPollViews();
  });
  beforeEach(() => {
    wrapper = document.createElement('div');
    wrapper.dir = dir;
    document.body.appendChild(wrapper);
  });
  afterEach(() => wrapper.remove());

  it('embed: a full-width card with a results header and a total line that fills after the vote', async () => {
    const { client: responses, send } = client();
    const node = renderPoll(poll({ view: 'embed' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(node);
    expect(node.classList).toContain('ta-poll-v-embed');
    expect(node.querySelector('.ta-embed-head')?.textContent).toBe('Results appear after you vote');
    expect(node.querySelector('.ta-poll-total')?.textContent).toBe('');
    optionsOf(node)[0].click();
    await flush();
    expect(send).toHaveBeenCalledWith('t1', pollId, 'midnight');
    expect(node.querySelector('.ta-embed-head')?.textContent).toBe('Results');
    expect(node.querySelector('.ta-poll-total')?.textContent).toBe('100 votes');
    expect(pct(node)).toEqual(['60%', '40%']);
    expect(node.hasAttribute('data-voted')).toBe(true);
    expect(optionsOf(node).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(optionsOf(node).every((b) => b.getAttribute('aria-disabled') === 'true')).toBe(true);
    // The colour rule: embed draws in the theme, not in the option colours.
    expect(node.querySelector<HTMLElement>('.ta-poll-opt')?.style.getPropertyValue('--ta-opt')).toBe('');
  });

  it('this-or-that: two halves filling the box, split at the vote percentage, the VS marker at the same share', async () => {
    const { client: responses } = client();
    const node = renderPoll(poll({ view: 'this-or-that' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(node);
    const box = node.querySelector<HTMLElement>('.ta-split');
    expect(box).not.toBeNull();
    const [a, b] = [node.querySelector<HTMLButtonElement>('.ta-half-a'), node.querySelector<HTMLButtonElement>('.ta-half-b')];
    expect(a?.textContent).toBe('Midnight');
    expect(b?.textContent).toBe('Coral');
    expect(node.querySelector('.ta-vs')?.getAttribute('aria-hidden')).toBe('true');
    // Before the vote the halves are even.
    expect(box?.style.getPropertyValue('--ta-split')).toBe('');
    // The colours of the options, and text on each that reads at 4.5:1.
    expect(a?.style.getPropertyValue('--ta-opt')).toBe('#3b2fc9');
    expect(a?.style.getPropertyValue('--ta-opt-ink')).toBe(onAccent('#3B2FC9'));
    expect(contrast('#3B2FC9', onAccent('#3B2FC9'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FF6F61', onAccent('#FF6F61'))).toBeGreaterThanOrEqual(4.5);

    a?.click();
    await flush();
    expect(box?.style.getPropertyValue('--ta-split')).toBe('60%');
    expect(pct(node)).toEqual(['60%', '40%']);
    expect(a?.getAttribute('aria-pressed')).toBe('true');
    expect(a?.querySelector('.ta-poll-pct')?.getAttribute('dir')).toBe('ltr');
  });

  it('this-or-that: an option with no colour takes the theme (accent, then an ink tint), and an empty vote keeps the halves even', async () => {
    const node = renderPoll(poll({ view: 'this-or-that', options: [{ id: 'midnight', label: 'Midnight' }, { id: 'coral', label: 'Coral' }] }), {
      reducedMotion: false,
    }) as HTMLElement;
    wrapper.appendChild(node);
    expect(node.querySelector<HTMLElement>('.ta-half-a')?.style.getPropertyValue('--ta-opt')).toBe('var(--ta-accent)');
    expect(node.querySelector<HTMLElement>('.ta-half-b')?.style.getPropertyValue('--ta-opt-ink')).toBe('var(--ta-paper)');
    const { client: responses } = client(result('midnight', 0, [0, 0]));
    const kept = renderPoll(poll({ view: 'this-or-that' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(kept);
    expect(kept.querySelector<HTMLElement>('.ta-split')?.style.getPropertyValue('--ta-split')).toBe('50%');
  });

  it('grid: two big tiles in the option colours, each with its share once voted', async () => {
    const { client: responses } = client();
    const node = renderPoll(poll({ view: 'grid' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(node);
    const tiles = [...node.querySelectorAll<HTMLButtonElement>('.ta-tile')];
    expect(tiles.map((t) => t.textContent)).toEqual(['Midnight', 'Coral']);
    expect(tiles[1].style.getPropertyValue('--ta-opt')).toBe('#ff6f61');
    tiles[0].click();
    await flush();
    expect(pct(node)).toEqual(['60%', '40%']);
    expect(tiles[0].querySelector<HTMLElement>('.ta-poll-fill')?.style.width).toBe('60%');
    expect(tiles[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('inline: pills in one row, and once voted the stacked bar with its legend, the visitor\'s choice in bold', async () => {
    const { client: responses } = client();
    const node = renderPoll(poll({ view: 'inline' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(node);
    expect(node.querySelector('.ta-inline-row')?.querySelectorAll('button')).toHaveLength(2);
    expect(node.querySelector('.ta-stackbar')).toBeNull();
    expect(node.querySelector('.ta-inline-row')?.querySelector('[style*="--ta-opt"]')).toBeNull();
    optionsOf(node)[1].click();
    await flush();
    const segments = [...node.querySelectorAll<HTMLElement>('.ta-stackbar > i')];
    expect(segments.map((s) => s.style.inlineSize)).toEqual(['60%', '40%']);
    const legend = [...node.querySelectorAll<HTMLElement>('.ta-legend-item')];
    expect(legend.map((item) => item.textContent)).toEqual(['Midnight60%', 'Coral40%']);
    // The visitor chose Coral: its share is the bold one.
    expect(legend.map((item) => item.classList.contains('ta-mine'))).toEqual([false, true]);
    expect(legend[0].querySelector('.ta-poll-pct')?.getAttribute('dir')).toBe('ltr');
  });

  it('a press with no response client marks the choice in the preview and records nothing', () => {
    const node = renderPoll(poll({ view: 'grid' }), { reducedMotion: false }) as HTMLElement;
    wrapper.appendChild(node);
    const [first] = [...node.querySelectorAll<HTMLButtonElement>('.ta-tile')];
    first.click();
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(node.querySelector('[aria-live]')?.textContent).toMatch(/Votes are not recorded in the preview/);
  });

  it('a kept vote shows at once, without posting again (C11)', () => {
    const { client: responses, send } = client(result('coral', 100, [60, 40]));
    const node = renderPoll(poll({ view: 'this-or-that' }), { reducedMotion: false, responses: { client: responses, taleId: 't1' } }) as HTMLElement;
    wrapper.appendChild(node);
    expect(send).not.toHaveBeenCalled();
    expect(node.querySelector<HTMLElement>('.ta-split')?.style.getPropertyValue('--ta-split')).toBe('60%');
    expect(node.querySelector('.ta-half-a')?.getAttribute('aria-pressed')).toBe('false');
    expect(node.querySelector('.ta-half-b')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('poll view styles', () => {
  it('draws the views with theme tokens only, and keeps the springs and the pop under the renderer\'s reduced-motion rule', () => {
    expect(POLL_VIEW_STYLES).toMatch(/\.ta-split \{/);
    expect(POLL_VIEW_STYLES).toContain('--ta-split: 50%');
    expect(POLL_VIEW_STYLES).toContain('inset-inline-start: var(--ta-split)');
    expect(POLL_VIEW_STYLES).toContain('var(--ta-opt)');
    expect(POLL_VIEW_STYLES).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(POLL_STYLES).toContain('@keyframes ta-shake');
    expect(POLL_STYLES).toContain('@keyframes ta-pop');
  });
});
