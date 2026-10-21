import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryTaleGroup } from '@taleart/contract';
import {
  BANNER_DEFAULTS,
  BANNER_INTERVAL_RANGE,
  BANNER_RATIOS,
  BANNER_STYLES,
  type BannerView,
  readBannerSettings,
  renderBanner,
} from './banner';

const API = 'https://api.example.com';
const image = (id: string, title = id) => ({
  id,
  title,
  media: { kind: 'image' as const, contentType: 'image/png' as const, url: `${API}/media/tales/${id}.png` },
});
const groups: DeliveryTaleGroup[] = [
  { id: 'ga', name: 'Summer', tales: [image('a1'), image('a2')] },
  { id: 'gb', name: 'Winter', tales: [{ id: 'b1', title: 'Snow', media: { kind: 'video', contentType: 'video/mp4', url: `${API}/media/tales/b1.mp4` } }] },
  { id: 'ge', name: 'Empty', tales: [] },
  { id: 'gc', name: 'Spring', tales: [{ id: 'c1', title: 'Text only', media: null }] },
];

// A stubbed `prefers-reduced-motion` query whose answer a test can flip.
function stubMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: reduce,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return {
    set(value: boolean) {
      mql.matches = value;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}

const views: BannerView[] = [];
function banner(settings: unknown = {}, list: readonly DeliveryTaleGroup[] = groups, onOpen = vi.fn()) {
  const view = renderBanner(list, settings, onOpen);
  if (!view) throw new Error('no banner');
  views.push(view);
  document.body.appendChild(view.element);
  const q = <T extends Element>(sel: string) => view.element.querySelector<T>(sel);
  const qa = <T extends Element>(sel: string) => [...view.element.querySelectorAll<T>(sel)];
  return {
    view,
    onOpen,
    root: view.element,
    slides: () => qa<HTMLElement>('.b-slide'),
    opens: () => qa<HTMLButtonElement>('.b-open'),
    dots: () => qa<HTMLButtonElement>('.b-dot'),
    prev: q<HTMLButtonElement>('.b-prev') as HTMLButtonElement,
    next: q<HTMLButtonElement>('.b-next') as HTMLButtonElement,
    rotate: q<HTMLButtonElement>('.b-rotate') as HTMLButtonElement,
    track: q<HTMLElement>('.b-track') as HTMLElement,
    viewport: q<HTMLElement>('.b-viewport') as HTMLElement,
  };
}

function pointer(type: string, target: Element, x: number, y = 10, pointerType = 'touch') {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

describe('banner settings', () => {
  it('match the contract schema: values, range and defaults', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '../../../contract/frame-types/banner.schema.json'), 'utf8'),
    ) as { properties: Record<string, { enum?: string[]; default: unknown; minimum?: number; maximum?: number }> };
    const { properties } = schema;
    expect(BANNER_DEFAULTS).toEqual(Object.fromEntries(Object.entries(properties).map(([k, p]) => [k, p.default])));
    expect(BANNER_RATIOS).toEqual(properties['aspectRatio'].enum);
    expect(BANNER_INTERVAL_RANGE).toEqual({
      min: properties['intervalSeconds'].minimum,
      max: properties['intervalSeconds'].maximum,
    });
  });

  it('keeps every valid value', () => {
    const settings = { aspectRatio: '3:1', autoplay: false, intervalSeconds: 3, showDots: false, loop: false };
    expect(readBannerSettings(settings)).toEqual(settings);
    expect(readBannerSettings({ intervalSeconds: 15, aspectRatio: '1:1' })).toMatchObject({ intervalSeconds: 15, aspectRatio: '1:1' });
  });

  it.each([undefined, null, 'banner', [], {}])('reads %j as the defaults', (raw) => {
    expect(readBannerSettings(raw)).toEqual(BANNER_DEFAULTS);
  });

  it('replaces each invalid or hostile value with its default', () => {
    expect(
      readBannerSettings({
        aspectRatio: '16/9"; background:url(x)',
        autoplay: 'true',
        intervalSeconds: '5',
        showDots: 1,
        loop: null,
      }),
    ).toEqual(BANNER_DEFAULTS);
    for (const intervalSeconds of [2, 16, 4.5, Number.NaN, Infinity]) {
      expect(readBannerSettings({ intervalSeconds }).intervalSeconds).toBe(5);
    }
  });
});

describe('renderBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubMotion(false);
  });

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a named carousel with one slide per group that has a tale, showing its first tale', () => {
    const b = banner();
    expect(b.root.tagName).toBe('SECTION');
    expect(b.root.getAttribute('aria-roledescription')).toBe('carousel');
    expect(b.root.getAttribute('aria-label')).toBe('Banner');
    expect(b.slides().map((s) => [s.getAttribute('role'), s.getAttribute('aria-roledescription'), s.getAttribute('aria-label')])).toEqual([
      ['group', 'slide', '1 of 3'],
      ['group', 'slide', '2 of 3'],
      ['group', 'slide', '3 of 3'],
    ]);
    expect(b.opens().map((o) => o.getAttribute('aria-label'))).toEqual(['Summer', 'Winter', 'Spring']);
    expect(b.opens().every((o) => o.type === 'button')).toBe(true);
    const [img, video, placeholder] = b.opens().map((o) => o.firstElementChild);
    expect((img as HTMLImageElement).src).toBe(`${API}/media/tales/a1.png`);
    expect((img as HTMLImageElement).alt).toBe('');
    expect((video as HTMLVideoElement).autoplay).toBe(false);
    expect((video as HTMLVideoElement).preload).toBe('metadata');
    expect(placeholder?.tagName).toBe('SPAN');
  });

  it('keeps group names as text: markup in a name is never parsed', () => {
    const b = banner({}, [{ id: 'gx', name: '<img src=x onerror=alert(1)>', tales: [image('x1')] }]);
    expect(b.opens()[0].getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
    expect(b.root.querySelectorAll('img')).toHaveLength(1);
  });

  it('renders nothing for groups without tales', () => {
    expect(renderBanner([], {}, vi.fn())).toBeNull();
    expect(renderBanner([groups[2]], {}, vi.fn())).toBeNull();
  });

  it('applies the defaults: 16:9, dots, previous and next, autoplay on', () => {
    const b = banner();
    expect(b.root.dataset['ratio']).toBe('16:9');
    expect(b.dots()).toHaveLength(3);
    expect(b.dots().map((d) => d.getAttribute('aria-label'))).toEqual(['Show Summer', 'Show Winter', 'Show Spring']);
    expect(b.dots()[0].getAttribute('aria-current')).toBe('true');
    expect(b.prev.getAttribute('aria-label')).toBe('Previous slide');
    expect(b.next.getAttribute('aria-label')).toBe('Next slide');
    expect(b.rotate.hidden).toBe(false);
    expect(b.rotate.getAttribute('aria-label')).toBe('Stop automatic slide show');
    expect(b.view.rotating).toBe(true);
  });

  it('applies 3:1, 1:1 and no dots', () => {
    expect(banner({ aspectRatio: '3:1', showDots: false }).root.dataset['ratio']).toBe('3:1');
    expect(views[0].element.querySelector('.b-dots')).toBeNull();
    expect(banner({ aspectRatio: '1:1' }).root.dataset['ratio']).toBe('1:1');
  });

  it('reads junk settings as the defaults', () => {
    const b = banner({ aspectRatio: '4:3', showDots: 'no', intervalSeconds: 99 });
    expect(b.root.dataset['ratio']).toBe('16:9');
    expect(b.dots()).toHaveLength(3);
    vi.advanceTimersByTime(5000);
    expect(b.view.index).toBe(1);
  });

  it('has the style rules each setting and reduced motion rely on', () => {
    expect(BANNER_STYLES).toContain('.banner[data-ratio="3:1"] .b-viewport { aspect-ratio: 3 / 1; }');
    expect(BANNER_STYLES).toContain('.banner[data-ratio="1:1"] .b-viewport { aspect-ratio: 1 / 1; }');
    expect(BANNER_STYLES).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.b-track \{ transition: none; \}/);
  });

  it('shows only the current slide to assistive technology and the keyboard', () => {
    const b = banner();
    const state = () => b.slides().map((s) => [s.hasAttribute('inert'), s.getAttribute('aria-hidden')]);
    expect(state()).toEqual([
      [false, null],
      [true, 'true'],
      [true, 'true'],
    ]);
    expect(b.track.style.transform).toBe('translateX(0%)');
    b.next.click();
    expect(state()).toEqual([
      [true, 'true'],
      [false, null],
      [true, 'true'],
    ]);
    expect(b.track.style.transform).toBe('translateX(-100%)');
  });

  it('moves with next, previous and dots, wrapping with loop', () => {
    const b = banner();
    b.next.click();
    expect(b.view.index).toBe(1);
    b.prev.click();
    b.prev.click();
    expect(b.view.index).toBe(2);
    b.next.click();
    expect(b.view.index).toBe(0);
    b.dots()[1].click();
    expect(b.view.index).toBe(1);
    expect(b.dots().map((d) => d.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(b.prev.getAttribute('aria-disabled')).toBe('false');
  });

  it('stops at the ends without loop, marking the buttons disabled', () => {
    const b = banner({ loop: false });
    expect(b.prev.getAttribute('aria-disabled')).toBe('true');
    b.prev.click();
    expect(b.view.index).toBe(0);
    b.next.click();
    b.next.click();
    expect(b.view.index).toBe(2);
    expect(b.next.getAttribute('aria-disabled')).toBe('true');
    b.next.click();
    expect(b.view.index).toBe(2);
  });

  it('moves by swipe, and a swipe does not open the slide', () => {
    const b = banner();
    const open = b.opens()[0];
    pointer('pointerdown', open, 200);
    pointer('pointerup', open, 120);
    open.click();
    expect(b.view.index).toBe(1);
    expect(b.onOpen).not.toHaveBeenCalled();
    const second = b.opens()[1];
    pointer('pointerdown', second, 100);
    pointer('pointerup', second, 180);
    second.click();
    expect(b.view.index).toBe(0);
    expect(b.onOpen).not.toHaveBeenCalled();
  });

  it('treats a short or vertical drag as a tap', () => {
    const b = banner();
    const open = b.opens()[0];
    pointer('pointerdown', open, 100, 10);
    pointer('pointerup', open, 130, 10);
    expect(b.view.index).toBe(0);
    pointer('pointerdown', open, 100, 10);
    pointer('pointerup', open, 160, 200);
    expect(b.view.index).toBe(0);
    open.click();
    expect(b.onOpen).toHaveBeenCalledWith('ga');
  });

  it('does not swipe past the ends without loop', () => {
    const b = banner({ loop: false });
    pointer('pointerdown', b.viewport, 100);
    pointer('pointerup', b.viewport, 200);
    expect(b.view.index).toBe(0);
  });

  it('opens the viewer at the activated slide group', () => {
    const b = banner();
    b.next.click();
    b.opens()[1].click();
    expect(b.onOpen).toHaveBeenCalledWith('gb');
  });

  it('autoplays every interval, wrapping with loop', () => {
    const b = banner({ intervalSeconds: 3 });
    expect(b.track.getAttribute('aria-live')).toBe('off');
    vi.advanceTimersByTime(2999);
    expect(b.view.index).toBe(0);
    vi.advanceTimersByTime(1);
    expect(b.view.index).toBe(1);
    vi.advanceTimersByTime(6000);
    expect(b.view.index).toBe(0);
    expect(b.view.rotating).toBe(true);
  });

  it('autoplays to the last slide and stops there without loop', () => {
    const b = banner({ loop: false, intervalSeconds: 3 });
    vi.advanceTimersByTime(6000);
    expect(b.view.index).toBe(2);
    expect(b.view.rotating).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(b.view.index).toBe(2);
    expect(b.rotate.getAttribute('aria-label')).toBe('Start automatic slide show');
  });

  it('does not autoplay with the autoplay setting off, and offers no rotation button', () => {
    const b = banner({ autoplay: false });
    expect(b.rotate.hidden).toBe(true);
    expect(b.track.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
  });

  it('does not autoplay when the visitor prefers reduced motion', () => {
    stubMotion(true);
    const b = banner({ intervalSeconds: 3 });
    expect(b.view.rotating).toBe(false);
    expect(b.rotate.hidden).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
  });

  it('stops autoplay when reduced motion turns on, and stops listening once destroyed', () => {
    const motion = stubMotion(false);
    const b = banner({ intervalSeconds: 3 });
    motion.set(true);
    expect(b.view.rotating).toBe(false);
    expect(b.rotate.hidden).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
    b.view.destroy();
    expect(motion.listeners.size).toBe(0);
  });

  it.each([
    ['pointer down', (b: ReturnType<typeof banner>) => pointer('pointerdown', b.opens()[0], 10)],
    ['focus entering', (b: ReturnType<typeof banner>) => b.opens()[0].focus()],
    ['next', (b: ReturnType<typeof banner>) => b.next.click()],
    ['a dot', (b: ReturnType<typeof banner>) => b.dots()[2].click()],
  ])('stops autoplay for good on %s', (_label, act) => {
    const b = banner({ intervalSeconds: 3 });
    act(b);
    const at = b.view.index;
    expect(b.view.rotating).toBe(false);
    expect(b.track.getAttribute('aria-live')).toBe('polite');
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(at);
  });

  it('stops and restarts with the rotation button, which focus alone does not stop', () => {
    const b = banner({ intervalSeconds: 3 });
    b.rotate.focus();
    pointer('pointerdown', b.rotate, 10, 10, 'mouse');
    expect(b.view.rotating).toBe(true);
    b.rotate.click();
    expect(b.view.rotating).toBe(false);
    expect(b.rotate.getAttribute('aria-label')).toBe('Start automatic slide show');
    vi.advanceTimersByTime(9000);
    expect(b.view.index).toBe(0);
    b.rotate.click();
    expect(b.rotate.getAttribute('aria-label')).toBe('Stop automatic slide show');
    vi.advanceTimersByTime(3000);
    expect(b.view.index).toBe(1);
  });

  it('pauses while a mouse hovers and resumes after', () => {
    const b = banner({ intervalSeconds: 3 });
    pointer('pointerenter', b.root, 10, 10, 'mouse');
    vi.advanceTimersByTime(9000);
    expect(b.view.index).toBe(0);
    pointer('pointerleave', b.root, 10, 10, 'mouse');
    vi.advanceTimersByTime(3000);
    expect(b.view.index).toBe(1);
    expect(b.view.rotating).toBe(true);
  });

  it('has no navigation, dots or autoplay with one slide', () => {
    const b = banner({}, [groups[0]]);
    expect(b.prev.hidden).toBe(true);
    expect(b.next.hidden).toBe(true);
    expect(b.rotate.hidden).toBe(true);
    expect(b.root.querySelector('.b-dots')).toBeNull();
    expect(b.view.rotating).toBe(false);
  });

  it('focuses the slide of a group, or the first slide, and stops autoplay', () => {
    const b = banner();
    expect(b.view.focus('gc')).toBe(true);
    expect(b.view.index).toBe(2);
    expect(document.activeElement).toBe(b.opens()[2]);
    expect(b.view.rotating).toBe(false);
    expect(b.view.focus('ge')).toBe(false);
    expect(b.view.focus(null)).toBe(true);
    expect(document.activeElement).toBe(b.opens()[0]);
  });

  it('stops its timer when destroyed', () => {
    const b = banner({ intervalSeconds: 3 });
    b.view.destroy();
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
  });
});
