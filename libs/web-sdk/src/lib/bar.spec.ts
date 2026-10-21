import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryTaleGroup } from '@taleart/contract';
import {
  applyCoverMotion,
  BAR_CHOICES,
  BAR_DEFAULTS,
  BAR_GAP_RANGE,
  BAR_SIZE_PX,
  BAR_STYLES,
  readBarSettings,
  renderBar,
} from './bar';

const groups: DeliveryTaleGroup[] = [
  { id: 'ga', name: 'Summer', cover: null, tales: [] },
  { id: 'gb', name: 'Winter', cover: null, tales: [] },
];

function bar(settings?: unknown): HTMLElement {
  return renderBar(groups, new Set(), settings);
}

describe('bar settings', () => {
  it('match the contract schema: values, range and defaults', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '../../../contract/frame-types/bar.schema.json'), 'utf8'),
    ) as { properties: Record<string, { enum?: string[]; default: unknown; minimum?: number; maximum?: number }> };
    const { properties } = schema;
    expect(BAR_DEFAULTS).toEqual(Object.fromEntries(Object.entries(properties).map(([k, p]) => [k, p.default])));
    expect(BAR_CHOICES.shape).toEqual(properties['shape'].enum);
    expect(BAR_CHOICES.size).toEqual(properties['size'].enum);
    expect(BAR_CHOICES.alignment).toEqual(properties['alignment'].enum);
    expect(BAR_GAP_RANGE).toEqual({ min: properties['gap'].minimum, max: properties['gap'].maximum });
  });

  it('keeps every valid value', () => {
    const settings = { shape: 'rounded-square', size: 'small', showTitles: false, alignment: 'center', gap: 4 };
    expect(readBarSettings(settings)).toEqual(settings);
    expect(readBarSettings({ gap: 24 }).gap).toBe(24);
  });

  it.each([undefined, null, 'bar', [], {}])('reads %j as the defaults', (raw) => {
    expect(readBarSettings(raw)).toEqual(BAR_DEFAULTS);
  });

  it('replaces each invalid value with its default', () => {
    expect(
      readBarSettings({ shape: 'star', size: 9, showTitles: 'no', alignment: 'end', gap: 'x' }),
    ).toEqual(BAR_DEFAULTS);
    for (const gap of [3, 25, 12.5, Number.NaN]) expect(readBarSettings({ gap }).gap).toBe(12);
  });
});

describe('renderBar', () => {
  it('renders the default bar: circle, 64 px, titles shown, start, 12 px gap', () => {
    const list = bar();
    expect(list.dataset).toMatchObject({ shape: 'circle', align: 'start', titles: 'shown' });
    expect(list.style.getPropertyValue('--ta-size')).toBe('64px');
    expect(list.style.gap).toBe('12px');
  });

  it('applies each setting', () => {
    const list = bar({ shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 });
    expect(list.dataset).toMatchObject({ shape: 'rounded-square', align: 'center', titles: 'hidden' });
    expect(list.style.getPropertyValue('--ta-size')).toBe('80px');
    expect(list.style.gap).toBe('20px');
  });

  it.each(Object.entries(BAR_SIZE_PX))('sizes %s covers at %i px', (size, px) => {
    expect(bar({ size }).style.getPropertyValue('--ta-size')).toBe(`${px}px`);
  });

  it('keeps the accessible names and the title text when titles are hidden', () => {
    const list = bar({ showTitles: false });
    const buttons = [...list.querySelectorAll('button.item')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter']);
    expect(buttons.map((b) => b.querySelector('.title')?.textContent)).toEqual(['Summer', 'Winter']);
  });

  it('has the style rules each setting relies on', () => {
    expect(BAR_STYLES).toContain('.bar[data-titles="hidden"] .title { display: none; }');
    expect(BAR_STYLES).toContain('.bar[data-shape="rounded-square"] .ring');
    // Auto margins centre the row without clipping the first item when it overflows.
    expect(BAR_STYLES).toContain('.bar[data-align="center"] > li:first-child { margin-inline-start: auto; }');
    expect(BAR_STYLES).toContain('.bar[data-align="center"] > li:last-child { margin-inline-end: auto; }');
  });
});

describe('covers', () => {
  const API = 'https://api.example.com';
  const tale = (id: string, kind: 'image' | 'video', url: string) => ({
    id,
    title: id,
    media: { kind, contentType: kind === 'image' ? ('image/png' as const) : ('video/mp4' as const), url },
  });
  const withCover = (
    cover: DeliveryTaleGroup['cover'],
    tales = [tale('t1', 'image', `${API}/media/tales/first.png`)],
  ): DeliveryTaleGroup[] => [{ id: 'g', name: 'G', cover, tales }];
  const coverOf = (list: HTMLElement) => list.querySelector<HTMLElement>('.cover');
  const still = { kind: 'image', contentType: 'image/jpeg', animated: false, url: `${API}/media/covers/s.jpg` } as const;
  const clip = { kind: 'video', contentType: 'video/webm', animated: true, url: `${API}/media/covers/c.webm` } as const;
  const gif = { kind: 'image', contentType: 'image/gif', animated: true, url: `${API}/media/covers/a.gif` } as const;

  it("shows the group's cover instead of its first tale's media", () => {
    const img = coverOf(renderBar(withCover(still), new Set(), {}, false));
    expect(img?.tagName).toBe('IMG');
    expect(img?.getAttribute('src')).toBe(still.url);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.hasAttribute('data-animated')).toBe(false);
  });

  it('starts image covers lazy and decoded off the main thread, with the URL set after `loading`', () => {
    const img = coverOf(renderBar(withCover(still), new Set(), {}, false)) as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.decoding).toBe('async');
    // Attribute order shows `loading` was set first, so the browser never starts an eager load.
    const names = [...img.attributes].map((a) => a.name);
    expect(names.indexOf('loading')).toBeLessThan(names.indexOf('src'));
  });

  it('marks a still canvas ready when its picture is drawn or fails to load', () => {
    const images: { onload: (() => void) | null; onerror: (() => void) | null; naturalWidth: number; naturalHeight: number }[] = [];
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 160;
        naturalHeight = 160;
        src = '';
        constructor() {
          images.push(this);
        }
      },
    );
    try {
      const drawn = coverOf(renderBar(withCover(gif), new Set(), {}, true)) as HTMLCanvasElement;
      const failed = coverOf(renderBar(withCover(gif), new Set(), {}, true)) as HTMLCanvasElement;
      const loads = vi.fn();
      drawn.addEventListener('load', loads);
      failed.addEventListener('load', loads);
      expect(drawn.hasAttribute('data-ready')).toBe(false);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      images[0].onload?.();
      images[1].onerror?.();
      expect(drawn.hasAttribute('data-ready')).toBe(true);
      expect(drawn.width).toBe(160);
      expect(failed.hasAttribute('data-ready')).toBe(true);
      expect(loads).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("falls back to the first tale's image, or a video's first frame, without a cover", () => {
    expect(coverOf(renderBar(withCover(null), new Set(), {}, false))?.getAttribute('src')).toBe(`${API}/media/tales/first.png`);
    const video = coverOf(renderBar(withCover(null, [tale('t1', 'video', `${API}/media/tales/v.mp4`)]), new Set(), {}, false));
    expect(video?.tagName).toBe('VIDEO');
    expect((video as HTMLVideoElement).autoplay).toBe(false);
    expect(video?.getAttribute('src')).toBe(`${API}/media/tales/v.mp4#t=0.001`);
  });

  it('plays an animated video cover muted, looping and inline', () => {
    const video = coverOf(renderBar(withCover(clip), new Set(), {}, false)) as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect([video.autoplay, video.loop, video.muted, video.playsInline]).toEqual([true, true, true, true]);
    expect(video.getAttribute('src')).toBe(clip.url);
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(video.dataset).toMatchObject({ animated: '', kind: 'video', src: clip.url });
  });

  it('keeps an animated video cover on its first frame under reduced motion', () => {
    const video = coverOf(renderBar(withCover(clip), new Set(), {}, true)) as HTMLVideoElement;
    expect([video.autoplay, video.loop]).toEqual([false, false]);
    expect(video.preload).toBe('metadata');
    expect(video.getAttribute('src')).toBe(`${clip.url}#t=0.001`);
  });

  it('draws an animated image cover to a still canvas under reduced motion', () => {
    const list = renderBar(withCover(gif), new Set(), {}, true);
    expect(coverOf(list)?.tagName).toBe('CANVAS');
    expect(list.querySelector('img')).toBeNull();
    expect(coverOf(renderBar(withCover(gif), new Set(), {}, false))?.tagName).toBe('IMG');
  });

  it('reads the reduced-motion setting when none is passed', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })));
    try {
      expect((coverOf(renderBar(withCover(clip))) as HTMLVideoElement).autoplay).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect((coverOf(renderBar(withCover(clip))) as HTMLVideoElement).autoplay).toBe(true);
  });

  it('redraws animated covers when the setting changes, leaving still ones', () => {
    const list = renderBar([...withCover(clip), { ...withCover(gif)[0], id: 'g2' }, { ...withCover(still)[0], id: 'g3' }], new Set(), {}, false);
    const stillImg = list.querySelectorAll('.cover')[2];
    applyCoverMotion(list, true);
    const [video, canvas, kept] = [...list.querySelectorAll<HTMLElement>('.cover')];
    expect((video as HTMLVideoElement).autoplay).toBe(false);
    expect(canvas.tagName).toBe('CANVAS');
    expect(kept).toBe(stillImg);
    applyCoverMotion(list, false);
    const [moving, img] = [...list.querySelectorAll<HTMLElement>('.cover')];
    expect((moving as HTMLVideoElement).autoplay).toBe(true);
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe(gif.url);
  });
});
