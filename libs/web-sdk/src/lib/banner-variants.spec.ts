import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryTaleGroup } from '@taleart/contract';
import {
  BANNER_IGNORED,
  BANNER_STYLES,
  BANNER_VARIANTS,
  type BannerView,
  preloadBannerVariants,
  renderBanner,
} from './banner';
import { BANNER_VARIANT_STYLES, mountBannerVariant } from './banner-variants';

// The variants other than the carousel, LTR and RTL (epic end-user redesign P5): structure, navigation, the
// placement each direction takes, the settings a variant ignores, reduced motion, the sticky dismissal and the
// strip's marquee. The variants' chunk is loaded once for the file, so each banner here is drawn at once.
beforeAll(() => preloadBannerVariants());

const API = 'https://api.example.com';
const group = (id: string, tales = 1): DeliveryTaleGroup => ({
  id,
  name: `Group ${id}`,
  tales: Array.from({ length: tales }, (_, i) => ({
    id: `${id}-${i}`,
    title: id,
    media: { kind: 'image' as const, contentType: 'image/png' as const, url: `${API}/media/tales/${id}-${i}.png` },
  })),
});
const five = ['a', 'b', 'c', 'd', 'e'].map((id) => group(id));
const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => group(id));

function stubMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: reduce,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
}

const views: BannerView[] = [];
const wrappers: HTMLElement[] = [];

// A banner of `variant` (with `settings`) on a page in direction `dir`, drawn at once (the variants are loaded). As the
// element does, it is placed on the page and then refreshed, so its slides read the page's direction.
function banner(variant: string, settings: Record<string, unknown> = {}, dir: 'ltr' | 'rtl' = 'ltr', groups = five) {
  const wrap = document.createElement('div');
  wrap.dir = dir;
  document.body.appendChild(wrap);
  wrappers.push(wrap);
  const onOpen = vi.fn();
  const view = renderBanner(groups, { variant, ...settings }, onOpen);
  if (!view) throw new Error('no banner');
  views.push(view);
  wrap.appendChild(view.element);
  view.refresh();
  const q = <T extends Element>(sel: string) => view.element.querySelector<T>(sel);
  const qa = <T extends Element>(sel: string) => [...view.element.querySelectorAll<T>(sel)];
  return {
    view,
    onOpen,
    root: view.element,
    // The visible slides' buttons: the strip's second copy is hidden and not counted.
    opens: () => qa<HTMLButtonElement>('[data-tale-group-id]'),
    slides: () => qa<HTMLElement>('.b-slide'),
    dots: () => qa<HTMLButtonElement>('.b-dot'),
    prev: q<HTMLButtonElement>('.b-prev') as HTMLButtonElement,
    next: q<HTMLButtonElement>('.b-next') as HTMLButtonElement,
    rotate: q<HTMLButtonElement>('.b-rotate') as HTMLButtonElement,
    track: q<HTMLElement>('.b-track') as HTMLElement,
    dismiss: q<HTMLButtonElement>('.b-dismiss') as HTMLButtonElement,
    key: (k: string) => view.element.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
  sessionStorage.clear();
});

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const wrap of wrappers.splice(0)) wrap.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SLIDE_VARIANTS = ['coverflow', 'peek', 'deck'] as const;
const NAV_VARIANTS = ['carousel', 'coverflow', 'peek', 'deck', 'sticky'] as const;

describe('banner variants: the setting maps to the variant', () => {
  it.each(BANNER_VARIANTS)('draws %s as its variant, with the variant on the section', (variant) => {
    expect(banner(variant).root.dataset['variant']).toBe(variant);
  });

  it('reads an unknown or missing variant as the carousel', () => {
    expect(banner('pyramid').root.dataset['variant']).toBe('carousel');
    expect(banner(undefined as unknown as string).root.dataset['variant']).toBe('carousel');
  });

  it('draws the visible slides of every variant: one per group, labelled as the carousel labels them', () => {
    for (const variant of BANNER_VARIANTS) {
      const b = banner(variant);
      expect(b.opens().map((o) => o.getAttribute('aria-label'))).toEqual(five.map((g) => g.name));
    }
  });

  it('keeps the carousel as the default look: the banner is not a variant until the setting says so', () => {
    const b = banner('carousel');
    expect(b.track?.style.transform).toBe('translateX(0%)');
    expect(b.root.querySelector('.b-strip')).toBeNull();
  });
});

describe('banner variants: structure', () => {
  it('gives the neighbours of coverflow, peek and deck a place in view, hidden from assistive technology', () => {
    for (const variant of SLIDE_VARIANTS) {
      const b = banner(variant);
      const [first, second] = b.slides();
      expect(first.hasAttribute('aria-hidden')).toBe(false);
      expect(second.getAttribute('aria-hidden')).toBe('true');
      expect(second.hasAttribute('inert')).toBe(false);
      expect(b.opens()[1].tabIndex).toBe(-1);
    }
  });

  it('draws the carousel slides inert when they are not shown', () => {
    const b = banner('carousel');
    expect(b.slides()[1].hasAttribute('inert')).toBe(true);
  });

  it('gives the sticky banner a dismiss button and the name beside each cover', () => {
    const b = banner('sticky');
    expect(b.dismiss?.getAttribute('aria-label')).toBe('Dismiss banner');
    expect(b.opens()[0].querySelector('.b-title')?.textContent).toBe('Group a');
  });

  it('draws the strip as two lists of the groups, the second hidden, inert and not counted', () => {
    const b = banner('strip');
    const lists = [...b.root.querySelectorAll<HTMLUListElement>('.b-strip-list')];
    expect(lists).toHaveLength(2);
    expect(lists[0].hasAttribute('aria-hidden')).toBe(false);
    expect(lists[1].getAttribute('aria-hidden')).toBe('true');
    expect(lists[1].inert).toBe(true);
    expect(lists[1].dataset['copy']).toBe('');
    expect(b.opens()).toHaveLength(5);
  });
});

describe.each(['ltr', 'rtl'] as const)('banner variants: navigation (%s)', (dir) => {
  it.each(NAV_VARIANTS)('%s moves with next and previous, and the dots show the slide', (variant) => {
    const b = banner(variant, {}, dir);
    b.next.click();
    expect(b.view.index).toBe(1);
    b.prev.click();
    b.prev.click();
    expect(b.view.index).toBe(4);
    if (variant !== 'sticky') {
      b.dots()[2].click();
      expect(b.view.index).toBe(2);
      expect(b.dots().map((d) => d.getAttribute('aria-current'))).toEqual([null, null, 'true', null, null]);
    }
  });

  it.each(NAV_VARIANTS)('%s takes the arrow keys in visual order, and Home and End', (variant) => {
    const b = banner(variant, {}, dir);
    // In a right-to-left page the next slide is to the left, so Left is "next" there.
    b.key(dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    expect(b.view.index).toBe(1);
    b.key(dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
    expect(b.view.index).toBe(0);
    b.key('End');
    expect(b.view.index).toBe(4);
    b.key('Home');
    expect(b.view.index).toBe(0);
  });

  it.each(SLIDE_VARIANTS)('%s opens the front slide and moves to a neighbour when it is clicked', (variant) => {
    const b = banner(variant, {}, dir);
    b.opens()[1].click();
    expect(b.view.index).toBe(1);
    expect(b.onOpen).not.toHaveBeenCalled();
    b.opens()[1].click();
    expect(b.onOpen).toHaveBeenCalledWith('b');
  });

  it('strip has no previous, next, dots or rotation: it is a marquee', () => {
    const b = banner('strip', {}, dir);
    expect(b.prev).toBeNull();
    expect(b.next).toBeNull();
    expect(b.dots()).toHaveLength(0);
    expect(b.rotate).toBeNull();
    expect(b.view.index).toBe(0);
  });
});

describe('banner variants: placement', () => {
  it('places the coverflow neighbours by their inline start, the next one on the inline end side', () => {
    const ltr = banner('coverflow', {}, 'ltr');
    // The front slide sits at 22% (its width is 56%, so it is centred); each step away moves it 26%.
    expect(ltr.slides()[0].style.insetInlineStart).toBe('calc(22%)');
    expect(ltr.slides()[1].style.insetInlineStart).toBe('calc(48%)');
    expect(ltr.slides()[4].style.insetInlineStart).toBe('calc(-4%)');
    expect(ltr.slides()[1].style.transform).toBe('rotateY(-32deg) scale(0.8)');
    expect(ltr.slides()[4].style.transform).toBe('rotateY(32deg) scale(0.8)');
    expect(ltr.slides()[2].style.visibility).toBe('hidden');
  });

  it('mirrors the coverflow in right to left: the inline start moves the next slide to the left, and its turn follows', () => {
    const rtl = banner('coverflow', {}, 'rtl');
    // The inline start is logical, so the same value puts the next slide on the inline end (the left in right to left).
    expect(rtl.slides()[1].style.insetInlineStart).toBe('calc(48%)');
    expect(rtl.slides()[1].style.transform).toBe('rotateY(32deg) scale(0.8)');
    rtl.next.click();
    expect(rtl.slides()[1].style.insetInlineStart).toBe('calc(22%)');
    expect(rtl.slides()[2].style.insetInlineStart).toBe('calc(48%)');
  });

  it('places the first draw by the direction the page reads once it is refreshed, not before', () => {
    const wrap = document.createElement('div');
    wrap.dir = 'rtl';
    document.body.appendChild(wrap);
    wrappers.push(wrap);
    const view = renderBanner(five, { variant: 'coverflow' }, vi.fn());
    if (!view) throw new Error('no banner');
    views.push(view);
    // Before it is on the page, the banner cannot read the direction: its first draw turns the left-to-right way.
    expect(view.element.querySelectorAll<HTMLElement>('.b-slide')[1].style.transform).toBe('rotateY(-32deg) scale(0.8)');
    wrap.appendChild(view.element);
    view.refresh();
    expect(view.element.querySelectorAll<HTMLElement>('.b-slide')[1].style.transform).toBe('rotateY(32deg) scale(0.8)');
  });

  it('gives each slide its title on a scrim and a call to action that the name already covers', () => {
    const b = banner('carousel');
    const [first] = b.slides();
    expect(first.querySelector('.b-title')?.textContent).toBe('Group a');
    expect(first.querySelector('.b-title')?.getAttribute('dir')).toBe('auto');
    expect(first.querySelector('.b-cta')?.textContent).toBe('Watch');
    expect(first.querySelector('.b-cta')?.getAttribute('aria-hidden')).toBe('true');
    expect(BANNER_STYLES).toContain('background: linear-gradient(to top, color-mix(in srgb, var(--ta-dark) 85%, transparent), transparent);');
  });

  it('fans the deck toward the inline end, and mirrors the fan in right to left', () => {
    const ltr = banner('deck', {}, 'ltr');
    expect(ltr.slides()[1].style.translate).toBe('44px 0');
    expect(ltr.slides()[1].style.transform).toBe('rotate(6deg)');
    const rtl = banner('deck', {}, 'rtl');
    expect(rtl.slides()[1].style.translate).toBe('-44px 0');
    expect(rtl.slides()[1].style.transform).toBe('rotate(-6deg)');
    expect(rtl.slides()[0].style.zIndex).toBe('10');
  });

  it('hides the deck cards more than two steps away', () => {
    const b = banner('deck', {}, 'ltr', seven);
    expect(b.slides()[3].style.visibility).toBe('hidden');
    expect(b.slides()[2].style.visibility).toBe('');
    // With loop, slide 5 of 7 is two steps back (visible) and slide 4 three steps back (hidden).
    expect(b.slides()[4].style.visibility).toBe('hidden');
    expect(b.slides()[5].style.visibility).toBe('');
  });

  it('scrolls the peek track so the shown slide is in the middle, by the boxes on screen', () => {
    const b = banner('peek');
    const scrollBy = vi.fn();
    b.track.scrollBy = scrollBy;
    const box = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) });
    const slides = b.slides();
    vi.spyOn(slides[1], 'getBoundingClientRect').mockReturnValue(box(300, 200));
    vi.spyOn(b.track, 'getBoundingClientRect').mockReturnValue(box(0, 600));
    b.next.click();
    // The slide's middle (400) is 100 px right of the track's middle (300): the track moves 100 px.
    expect(scrollBy).toHaveBeenCalledWith({ left: 100, behavior: 'smooth' });
  });

  it('draws the strip with its loop moving in the page direction', () => {
    const ltr = banner('strip', {}, 'ltr').root;
    expect(ltr.style.getPropertyValue('--b-flow')).toBe('1');
    const rtl = banner('strip', {}, 'rtl').root;
    expect(rtl.style.getPropertyValue('--b-flow')).toBe('-1');
  });
});

describe('banner variants: settings a variant ignores', () => {
  it('lists the settings each variant ignores (the dashboard says the same)', () => {
    expect(BANNER_IGNORED.carousel).toEqual([]);
    expect(BANNER_IGNORED.coverflow).toEqual([]);
    expect(BANNER_IGNORED.peek).toEqual([]);
    expect(BANNER_IGNORED.deck).toEqual([]);
    expect(BANNER_IGNORED.sticky).toEqual(['aspectRatio', 'showDots', 'loop']);
    expect(BANNER_IGNORED.strip).toEqual(['aspectRatio', 'showDots', 'loop', 'autoplay', 'intervalSeconds']);
  });

  it('sticky ignores the dots and the loop: no dots, and the last slide loops to the first', () => {
    const b = banner('sticky', { showDots: true, loop: false });
    expect(b.dots()).toHaveLength(0);
    b.prev.click();
    expect(b.view.index).toBe(4);
    expect(b.prev.getAttribute('aria-disabled')).toBe('false');
  });

  it('sticky ignores the aspect ratio: its viewport is a strip of fixed height, whatever the ratio', () => {
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="sticky"] .b-viewport { flex: 1 1 auto; min-width: 0; height: 64px; aspect-ratio: auto; }');
    expect(banner('sticky', { aspectRatio: '1:1' }).root.dataset['ratio']).toBe('1:1');
  });

  it('sticky still autoplays with its interval', () => {
    const b = banner('sticky', { intervalSeconds: 3 });
    expect(b.view.rotating).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(b.view.index).toBe(1);
  });

  it('strip ignores autoplay and its interval: it never advances by itself', () => {
    const b = banner('strip', { autoplay: true, intervalSeconds: 3 });
    expect(b.view.rotating).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
  });

  it('strip ignores the loop and the dots as well, and never offers the controls', () => {
    const b = banner('strip', { loop: false, showDots: true });
    expect(b.dots()).toHaveLength(0);
    expect(b.root.querySelector('.b-row')).toBeNull();
  });
});

describe('banner variants: reduced motion', () => {
  it.each(SLIDE_VARIANTS)('%s does not autoplay when the visitor prefers reduced motion', (variant) => {
    stubMotion(true);
    const b = banner(variant, { intervalSeconds: 3 });
    expect(b.view.rotating).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(b.view.index).toBe(0);
  });

  it('places peek without a smooth scroll under reduced motion', () => {
    stubMotion(true);
    const b = banner('peek');
    const scrollBy = vi.fn();
    b.track.scrollBy = scrollBy;
    b.next.click();
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ behavior: 'auto' });
  });

  it('stops the strip and turns its scroll to the page: no animation, a horizontal scroll, the second copy hidden', () => {
    expect(BANNER_VARIANT_STYLES).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.banner\[data-variant\] \.b-slide,[\s\S]*\.banner\[data-variant="strip"\] \.b-strip \{ overflow-x: auto; \}/);
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="strip"] .b-strip-track { animation: none; }');
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="strip"] .b-strip-list[data-copy] { display: none; }');
  });

  it('moves the strip for the page direction and never pauses it unless hovered or focused', () => {
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="strip"] .b-strip:hover .b-strip-track,');
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="strip"] .b-strip:focus-within .b-strip-track { animation-play-state: paused; }');
    expect(BANNER_VARIANT_STYLES).toContain('@keyframes b-marquee { to { translate: calc(var(--b-flow, 1) * -50%) 0; } }');
  });
});

describe('banner variants: the strip', () => {
  it('runs one loop of the groups in 18 seconds', () => {
    expect(BANNER_VARIANT_STYLES).toContain('animation: b-marquee 18s linear infinite;');
  });

  it('focuses a group on its visible copy only', () => {
    const b = banner('strip');
    expect(b.view.focus('c')).toBe(true);
    expect(document.activeElement).toBe(b.opens()[2]);
    expect(b.view.focus('zz')).toBe(false);
  });

  it('names each group by its cover and its name is read as text in its own direction', () => {
    const b = banner('strip');
    expect(b.opens()[0].getAttribute('aria-label')).toBe('Group a');
    expect(BANNER_VARIANT_STYLES).toContain('.b-name { unicode-bidi: plaintext; }');
  });
});

describe('banner variants: sticky', () => {
  it('docks to the bottom, leaves room for the safe area, and keeps its controls at 44 px', () => {
    expect(BANNER_VARIANT_STYLES).toContain('.banner[data-variant="sticky"] {');
    expect(BANNER_VARIANT_STYLES).toContain('inset-block-end: 0;');
    expect(BANNER_VARIANT_STYLES).toContain('env(safe-area-inset-bottom, 0px)');
    expect(BANNER_STYLES).toMatch(/\.b-btn \{[^}]*width: 44px;[^}]*height: 44px;/);
  });

  it('is dismissed for the session: it hides, and a new banner of the same groups stays hidden', () => {
    const b = banner('sticky');
    b.dismiss.click();
    expect(b.root.hidden).toBe(true);
    // Its own display would undo the hidden attribute, so the stylesheet hides it explicitly.
    expect(BANNER_VARIANT_STYLES).toContain('.banner[hidden] { display: none; }');
    expect(b.view.rotating).toBe(false);
    const again = banner('sticky');
    expect(again.root.hidden).toBe(true);
  });

  it('shows again when the session storage is blocked: the dismissal is kept for the page view only', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const b = banner('sticky');
      expect(() => b.dismiss.click()).not.toThrow();
      expect(b.root.hidden).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('stays apart for another set of groups', () => {
    banner('sticky').dismiss.click();
    const other = banner('sticky', {}, 'ltr', five.slice(0, 2));
    expect(other.root.hidden).toBe(false);
  });
});

describe('banner variants: loading', () => {
  it('stands the skeleton of the banner in for a variant until its chunk is in, then draws it', async () => {
    vi.useRealTimers();
    vi.resetModules();
    const fresh = await import('./banner');
    const onReady = vi.fn();
    const wrap = document.createElement('div');
    document.body.appendChild(wrap);
    wrappers.push(wrap);
    const view = fresh.renderBanner(five, { variant: 'peek' }, vi.fn(), undefined, onReady);
    if (!view) throw new Error('no banner');
    views.push(view);
    wrap.appendChild(view.element);
    view.refresh();
    expect(view.element.querySelector('.b-skeleton')).not.toBeNull();
    expect(view.element.querySelector('.b-open')).toBeNull();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(view.element));
    expect(view.element.querySelectorAll('[data-tale-group-id]')).toHaveLength(5);
    expect(view.element.querySelector('.b-skeleton')).toBeNull();
    expect(view.focus('d')).toBe(true);
    expect(document.activeElement).toBe(view.element.querySelectorAll('.b-open')[3]);
  });

  it('keeps a focus asked for while the chunk loads', async () => {
    vi.useRealTimers();
    vi.resetModules();
    const fresh = await import('./banner');
    const view = fresh.renderBanner(five, { variant: 'deck' }, vi.fn());
    if (!view) throw new Error('no banner');
    views.push(view);
    document.body.appendChild(view.element);
    expect(view.focus('c')).toBe(true);
    await vi.waitFor(() => expect(view.element.querySelector('.b-skeleton')).toBeNull());
    expect(document.activeElement).toBe(view.element.querySelectorAll('.b-open')[2]);
    expect(view.focus('zz')).toBe(false);
  });

  it('draws the variants from the module in one call, for a test that mounts one directly', () => {
    const root = document.createElement('section');
    root.className = 'banner';
    root.dataset['ratio'] = '16:9';
    document.body.appendChild(root);
    const view = mountBannerVariant('coverflow', root, five, { variant: 'coverflow', aspectRatio: '16:9', autoplay: false, intervalSeconds: 5, showDots: true, loop: true }, vi.fn(), (k: string) => k as never);
    views.push(view);
    expect(root.querySelector('style')?.textContent).toContain('[data-variant="coverflow"]');
    expect(root.querySelectorAll('.b-open')).toHaveLength(5);
  });
});

describe('banner variants: the stylesheet', () => {
  it('draws the variant slides in the page direction without a physical offset of their own', () => {
    expect(BANNER_VARIANT_STYLES).not.toMatch(/translateX\(/);
  });

  it('keeps every variant on the same tokens as the carousel (no colour literals)', () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
    expect(BANNER_VARIANT_STYLES).not.toMatch(literal);
    const source = readFileSync(join(__dirname, 'banner-variants.ts'), 'utf8');
    expect(source).toContain('BANNER_VARIANT_STYLES');
  });
});
