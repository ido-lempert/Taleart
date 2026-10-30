import type { DeliveryTale, DeliveryTaleElement, DeliveryTaleGroup, DeliveryZone } from '@taleart/contract';
import { BAR_STYLES, renderBar } from './bar';
import { BANNER_STYLES, renderBanner } from './banner';
import { getConfig, init } from './config';
import { isRtl, parseDir } from './direction';
import { defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';
import { renderCountdown, COUNTDOWN_STYLES } from './document/countdown';
import { PROMO_STYLES, renderPromoCode } from './document/promo-code';
import { renderPoll, POLL_STYLES } from './document/poll';
import { renderQuiz } from './document/quiz';
import { ratingKey, renderRating } from './document/rating';
import { renderReaction } from './document/reaction';
import type { ResponseClient, StoredResponse } from './responses';
import { TaleViewer, VIEWER_STYLES } from './viewer';

// Every directional component, in both directions (handoff 3.2). jsdom does no layout and no `direction`
// inheritance, so each test reads what the browser would act on: the `dir` attribute the SDK sets on the
// display and its parts, the CSS rules the page gets, the keys and the pointer maths.

const API = 'https://api.example.com';
const DIRECTIONS = ['ltr', 'rtl'] as const;
type Dir = (typeof DIRECTIONS)[number];

// A wrapper with the direction on it, in the document, as a page's `dir` is.
function inDirection(dir: Dir): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.dir = dir;
  document.body.appendChild(wrapper);
  return wrapper;
}

const tale = (id: string): DeliveryTale => ({ id, title: `Tale ${id}`, media: null, document: null });
const group = (id: string, name: string, count = 1): DeliveryTaleGroup => ({
  id,
  name,
  tales: Array.from({ length: count }, (_, i) => tale(`${id}${i + 1}`)),
});

function element(type: string, props: Record<string, unknown>): DeliveryTaleElement {
  return {
    id: `00000000-0000-4000-8000-0000000000${type.length.toString().padStart(2, '0')}`,
    type,
    box: { x: 0.1, y: 0.6, w: 0.8, h: 0.25, rotation: 0 },
    a11y: {},
    props: props as DeliveryTaleElement['props'],
  } as DeliveryTaleElement;
}

// The node a selector finds; the test fails at once when there is none.
function must<T extends Element>(node: T | null, what: string): T {
  if (!node) throw new Error(`no ${what}`);
  return node;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const keydown = (target: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};
const rect = (width: number, height = 40) => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });

describe('reading direction', () => {
  it('parses the three options and nothing else', () => {
    expect(['auto', 'ltr', 'rtl'].map(parseDir)).toEqual(['auto', 'ltr', 'rtl']);
    expect(parseDir('up')).toBeUndefined();
    expect(parseDir(null)).toBeUndefined();
  });

  it('reads a dir attribute on the node or its ancestors, through a shadow root', () => {
    const outer = inDirection('rtl');
    const inner = document.createElement('div');
    outer.appendChild(inner);
    expect(isRtl(inner)).toBe(true);
    const host = document.createElement('div');
    host.dir = 'ltr';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const inShadow = document.createElement('div');
    shadow.appendChild(inShadow);
    expect(isRtl(inShadow)).toBe(false);
    outer.remove();
    host.remove();
  });

  it('takes the SDK option from init, validated, and keeps the last valid one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(getConfig().dir).toBe('auto');
      init({ dir: 'rtl' });
      expect(getConfig().dir).toBe('rtl');
      init({ dir: 'sideways' as never });
      expect(getConfig().dir).toBe('rtl');
      expect(warn).toHaveBeenCalledTimes(1);
      init({ dir: null });
      expect(getConfig().dir).toBe('auto');
    } finally {
      init({ dir: 'auto' });
      warn.mockRestore();
    }
  });
});

describe('the bar, in both directions', () => {
  for (const dir of DIRECTIONS) {
    it(`keeps the groups in order and lets the flow run ${dir === 'rtl' ? 'from the right' : 'from the left'}`, () => {
      const wrapper = inDirection(dir);
      const bar = renderBar([group('a', 'Alpha'), group('b', 'Beta')], new Set(), {});
      wrapper.appendChild(bar);
      const items = [...bar.querySelectorAll<HTMLButtonElement>('button.item')];
      expect(items.map((b) => b.dataset['taleGroupId'])).toEqual(['a', 'b']);
      // Flex rows follow the direction; the list keeps no physical offset of its own.
      expect(BAR_STYLES).toContain('justify-content: flex-start;');
      expect(bar.querySelector('.title')?.getAttribute('dir')).toBe('auto');
      wrapper.remove();
    });
  }

  it('gives each name its own bidi run, so a Latin first line does not turn the rest around', () => {
    expect(BAR_STYLES).toMatch(/\.title \{[^}]*unicode-bidi: plaintext;/);
  });
});

describe('the viewer, in both directions', () => {
  let host: HTMLElement;
  let viewer: TaleViewer;
  const groups = [group('ga', 'A', 1), group('gb', 'B', 3)];
  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const position = () => `${dialog().getAttribute('aria-label')}, tale ${dialog().querySelectorAll('.segment.done').length + 1}`;
  const stageRect = (width: number) => {
    const stage = dialog().querySelector('.stage') as HTMLElement;
    stage.getBoundingClientRect = () => rect(width);
    return stage;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });
  afterEach(() => {
    viewer?.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function open(dir: Dir): void {
    host = document.createElement('div');
    host.dir = dir;
    document.body.appendChild(host);
    viewer = new TaleViewer(host, groups);
    viewer.open('gb');
  }

  it('moves the next tale to the right with the right arrow in left-to-right, and to the left in right-to-left', () => {
    open('ltr');
    expect(dialog().hasAttribute('data-rtl')).toBe(false);
    keydown(dialog(), 'ArrowRight');
    expect(position()).toBe('B, tale 2');
    keydown(dialog(), 'ArrowLeft');
    expect(position()).toBe('B, tale 1');
  });

  it('reverses the arrow keys in right-to-left: left is the next tale', () => {
    open('rtl');
    expect(dialog().hasAttribute('data-rtl')).toBe(true);
    keydown(dialog(), 'ArrowLeft');
    expect(position()).toBe('B, tale 2');
    keydown(dialog(), 'ArrowRight');
    expect(position()).toBe('B, tale 1');
  });

  it('takes a tap on the left third as the previous tale in left-to-right, and the next one in right-to-left', () => {
    open('ltr');
    stageRect(300);
    must(dialog().querySelector('.stage'), 'stage').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, detail: 1 }));
    expect(position()).toBe('A, tale 1');
    viewer.close();
    open('rtl');
    stageRect(300);
    must(dialog().querySelector('.stage'), 'stage').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, detail: 1 }));
    expect(position()).toBe('B, tale 2');
  });

  it('grows the progress from the start: from the left in left-to-right, from the right in right-to-left', () => {
    open('ltr');
    expect(VIEWER_STYLES).toMatch(/\.fill \{[^}]*transform-origin: left;/);
    expect(VIEWER_STYLES).toMatch(/\.viewer\[data-rtl\] \.fill \{ transform-origin: right; \}/);
    viewer.close();
    open('rtl');
    expect(dialog().hasAttribute('data-rtl')).toBe(true);
  });

  it('puts the close button and the name in the same places in both: the name bidi-isolated', () => {
    open('rtl');
    expect(dialog().querySelector('.name')?.getAttribute('dir')).toBe('auto');
    expect(VIEWER_STYLES).toMatch(/\.name \{\s*unicode-bidi: plaintext;/);
  });
});

describe('the banner, in both directions', () => {
  const slides = [group('a', 'A'), group('b', 'B'), group('c', 'C')];
  const settings = { autoplay: false, showDots: true, loop: true };
  let mounted: HTMLElement | null = null;
  afterEach(() => {
    mounted?.remove();
    mounted = null;
  });

  for (const dir of DIRECTIONS) {
    it(`steps with the arrow keys as the ${dir} page does, and moves the track the way the slides run`, () => {
      const wrapper = inDirection(dir);
      mounted = wrapper;
      const view = must(renderBanner(slides, settings, () => undefined), 'banner');
      wrapper.appendChild(view.element);
      const track = must(view.element.querySelector<HTMLElement>('.b-track'), 'track');
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      keydown(must(view.element.querySelector('.b-open'), 'slide'), forward);
      expect(view.index).toBe(1);
      expect(track.style.transform).toBe(dir === 'rtl' ? 'translateX(100%)' : 'translateX(-100%)');
      keydown(must(view.element.querySelector('.b-open'), 'slide'), back);
      expect(view.index).toBe(0);
      expect(track.style.transform).toBe('translateX(0%)');
      view.destroy();
    });
  }

  it('shows the previous button on the start side and mirrors its chevron right to left', () => {
    expect(BANNER_STYLES).toContain('.b-prev { inset-inline-start: 8px; }');
    expect(BANNER_STYLES).toContain('.b-prev:dir(rtl) svg, .b-next:dir(rtl) svg { transform: scaleX(-1); }');
  });
});

describe('a poll, a quiz and a reaction, in both directions', () => {
  const pollProps = { question: 'Tea or coffee?', options: [{ id: 'a', label: 'Tea' }, { id: 'b', label: 'Coffee' }] };
  const stored = (value: string, percents: Record<string, number>): StoredResponse => ({
    value,
    result: { choices: Object.entries(percents).map(([id, percent]) => ({ id, percent })) } as never,
  });
  const clientWith = (kept: StoredResponse | null): ResponseClient => ({
    send: vi.fn(async () => kept as StoredResponse),
    stored: vi.fn(() => kept),
  });

  for (const dir of DIRECTIONS) {
    it(`shows each share left to right, in a ${dir} card`, () => {
      const wrapper = inDirection(dir);
      const card = renderPoll(element('poll', pollProps), {
        reducedMotion: false,
        responses: { client: clientWith(stored('a', { a: 32, b: 68 })), taleId: 't1' },
      }) as HTMLElement;
      wrapper.appendChild(card);
      const pct = must(card.querySelector<HTMLElement>('.ta-poll-pct'), 'percentage');
      expect(pct.textContent).toBe('32%');
      expect(pct.dir).toBe('ltr');
      expect(card.querySelector('.ta-poll-fill')).not.toBeNull();
      expect(POLL_STYLES).toMatch(/\.ta-poll-fill \{\s*position: absolute;\s*inset-block: 0;\s*inset-inline-start: 0;/);
      wrapper.remove();
    });

    it(`marks a quiz's answers the same in a ${dir} card`, () => {
      const wrapper = inDirection(dir);
      const quiz = renderQuiz(
        element('quiz', { question: 'Two plus two?', answers: [{ id: 'a', label: '4' }, { id: 'b', label: '5' }], correctAnswerId: 'a' }),
        { reducedMotion: false, responses: { client: clientWith(stored('b', { a: 70, b: 30 })), taleId: 't1' } },
      ) as HTMLElement;
      wrapper.appendChild(quiz);
      expect(quiz.querySelector('.ta-quiz-right')?.textContent).toContain('4');
      expect(quiz.querySelector('.ta-quiz-wrong')?.textContent).toContain('5');
      wrapper.remove();
    });

    it(`keeps a reaction's count left to right in a ${dir} card`, () => {
      const wrapper = inDirection(dir);
      const card = renderReaction(element('reaction', { question: 'Like?', emojis: ['👍', '👎'] }), {
        reducedMotion: false,
        responses: {
          client: clientWith({ value: '👍', result: { reactions: [{ emoji: '👍', count: 12 }, { emoji: '👎', count: 3 }] } as never }),
          taleId: 't1',
        },
      }) as HTMLElement;
      wrapper.appendChild(card);
      expect(card.querySelector<HTMLElement>('.ta-reaction-count')?.dir).toBe('ltr');
      expect(card.querySelector('.ta-reaction-count')?.textContent).toBe('12');
      wrapper.remove();
    });
  }
});

describe('a rating, in both directions', () => {
  const rating = () => element('rating', { question: 'How was it?', emoji: '❤️' });
  const sized = (node: HTMLElement) => {
    node.getBoundingClientRect = () => rect(200);
    return node;
  };

  it('moves the value up with the left arrow in left-to-right, and with the right arrow in right-to-left', () => {
    expect(ratingKey(50, 'ArrowLeft', false)).toBe(40);
    expect(ratingKey(50, 'ArrowRight', false)).toBe(60);
    expect(ratingKey(50, 'ArrowLeft', true)).toBe(60);
    expect(ratingKey(50, 'ArrowRight', true)).toBe(40);
  });

  for (const dir of DIRECTIONS) {
    it(`reads the slider by its direction in a ${dir} card`, () => {
      const wrapper = inDirection(dir);
      const card = renderRating(rating(), { reducedMotion: false }) as HTMLElement;
      wrapper.appendChild(card);
      const track = sized(must(card.querySelector<HTMLElement>('[role="slider"]'), 'slider'));
      expect(track.getAttribute('aria-valuenow')).toBe('50');
      // A press a quarter of the way along, as the browser lays it out in this direction.
      const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 50, pointerId: 1 });
      track.dispatchEvent(press);
      track.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
      const expected = dir === 'rtl' ? '75' : '25';
      track.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 50, pointerId: 2 }));
      expect(track.getAttribute('aria-valuenow')).toBe(expected);
      // The thumb sits at the start of the value in the direction the page runs.
      expect((track.querySelector('.ta-rate-thumb') as HTMLElement).style.insetInlineStart).toBe(`${expected}%`);
      wrapper.remove();
    });
  }
});

describe('a countdown and a promo code, in both directions', () => {
  const endsAt = new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  for (const dir of DIRECTIONS) {
    it(`keeps the digits and their order left to right in a ${dir} card`, () => {
      const wrapper = inDirection(dir);
      const card = renderCountdown(element('countdown', { title: 'Sale ends', endsAt }), { reducedMotion: true }) as HTMLElement;
      wrapper.appendChild(card);
      const numbers = [...card.querySelectorAll<HTMLElement>('.ta-cd-num')];
      expect(numbers).toHaveLength(4);
      expect(numbers.every((n) => n.dir === 'ltr')).toBe(true);
      expect(COUNTDOWN_STYLES).toMatch(/\.ta-cd-units:not\(\[hidden\]\) \{[^}]*direction: ltr;/);
      expect(COUNTDOWN_STYLES).toMatch(/\.ta-cd-units:not\(\[hidden\]\) \{[^}]*font-variant-numeric: tabular-nums;/);
      wrapper.remove();
    });

    it(`keeps the code left to right in a ${dir} card, with no letter-spacing or capitals`, () => {
      const wrapper = inDirection(dir);
      const card = renderPromoCode(element('promo-code', { title: 'Hi', code: 'SAVE10', note: 'Ten off' }), {
        reducedMotion: false,
      }) as HTMLElement;
      wrapper.appendChild(card);
      const chip = must(card.querySelector<HTMLElement>('.ta-promo-chip'), 'code');
      expect(chip.textContent).toBe('SAVE10');
      expect(chip.dir).toBe('ltr');
      expect(PROMO_STYLES).not.toMatch(/letter-spacing|text-transform/);
      wrapper.remove();
    });
  }
});

describe('the element, in both directions', () => {
  const zone: DeliveryZone = {
    id: 'z1',
    name: 'Home',
    slug: 'home',
    frame: { id: 'f1', type: 'bar', settings: {} },
    taleGroups: [group('ga', 'Summer')],
  } as DeliveryZone;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(zone), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    document.body.replaceChildren();
    init({ dir: 'auto' });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(attrs: Record<string, string>): Promise<TaleartElement> {
    const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
    el.setAttribute('api-url', API);
    el.setAttribute('zone-key', 'tak_testkey');
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.body.appendChild(el);
    for (let i = 0; i < 5; i++) await flush();
    return el;
  }
  const wrapperOf = (el: TaleartElement) => must(el.shadowRoot?.querySelector<HTMLElement>('.taleart') ?? null, 'wrapper');

  it('draws in the page direction by default, with no dir of its own', async () => {
    const el = await mount({});
    expect(wrapperOf(el).hasAttribute('dir')).toBe(false);
  });

  it('turns its display around with its own dir attribute', async () => {
    const el = await mount({ dir: 'rtl' });
    expect(wrapperOf(el).dir).toBe('rtl');
    el.setAttribute('dir', 'ltr');
    expect(wrapperOf(el).dir).toBe('ltr');
    el.setAttribute('dir', 'auto');
    expect(wrapperOf(el).hasAttribute('dir')).toBe(false);
  });

  it('takes the SDK option when the element has none, and its own attribute wins over it', async () => {
    init({ dir: 'rtl' });
    const el = await mount({});
    expect(wrapperOf(el).dir).toBe('rtl');
    el.setAttribute('dir', 'ltr');
    expect(wrapperOf(el).dir).toBe('ltr');
    init({ dir: 'ltr' });
    expect(wrapperOf(el).dir).toBe('ltr');
  });

  it('warns once for a dir attribute it does not know, and keeps the page direction', async () => {
    const el = await mount({});
    el.setAttribute('dir', 'up');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dir attribute'));
    expect(wrapperOf(el).hasAttribute('dir')).toBe(false);
  });
});
