import type { DeliveryZone } from '@taleart/contract';
import { defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

const API = 'https://api.example.com';
const KEY = 'tak_testkey';

const zone: DeliveryZone = {
  id: 'z1',
  name: 'Home',
  frames: [
    { id: 'f0', type: 'feed', settings: {} },
    { id: 'f1', type: 'bar', settings: {} },
  ],
  taleGroups: [
    {
      id: 'ga',
      name: 'Summer',
      tales: [
        { id: 't1', title: 'Beach', media: { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/a.png` } },
      ],
    },
    {
      id: 'gb',
      name: 'Winter',
      tales: [
        { id: 't2', title: 'Snow', media: { kind: 'video', contentType: 'video/mp4', url: `${API}/media/tales/b.mp4` } },
      ],
    },
    { id: 'gc', name: 'Empty', tales: [] },
  ],
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Waits for the element's microtask-scheduled load and the mocked fetch to settle.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(attrs: Record<string, string> = { 'api-url': API, 'zone-key': KEY }): Promise<TaleartElement> {
  const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  await settle();
  return el;
}

const items = (el: TaleartElement) => [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.item') ?? [])];

describe('TaleartElement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    fetchMock = vi.fn(async () => respond(200, zone));
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers the custom element', () => {
    expect(customElements.get(TALEART_ELEMENT_TAG)).toBe(TaleartElement);
  });

  it('reads the zone from the Delivery API with the key as a bearer token, once', async () => {
    await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/delivery/v1/zone`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(init.credentials).toBe('omit');
  });

  it('renders one bar item per tale group, in order, named by the group', async () => {
    const el = await mount();
    const buttons = items(el);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter', 'Empty']);
    expect(buttons.map((b) => b.querySelector('.title')?.textContent)).toEqual(['Summer', 'Winter', 'Empty']);
    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    expect(el.shadowRoot?.querySelector('.bar')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("applies the bar frame's settings from the Delivery API", async () => {
    const settings = { shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 };
    fetchMock.mockImplementation(async () =>
      respond(200, { ...zone, frames: [{ id: 'f1', type: 'bar', settings }] }),
    );
    const el = await mount();
    const bar = el.shadowRoot?.querySelector<HTMLElement>('.bar');
    expect(bar?.dataset).toMatchObject({ shape: 'rounded-square', align: 'center', titles: 'hidden' });
    expect(bar?.style.getPropertyValue('--ta-size')).toBe('80px');
    expect(bar?.style.gap).toBe('20px');
    // Hidden titles keep each item's name.
    expect(items(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter', 'Empty']);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("styles the frames and the viewer with the zone's project theme (R9)", async () => {
    const theme = { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' };
    fetchMock.mockImplementation(async () =>
      respond(200, {
        ...zone,
        theme,
        frames: [
          { id: 'f1', type: 'bar', settings: { shape: 'rounded-square' } },
          { id: 'f2', type: 'banner', settings: {} },
        ],
      }),
    );
    const el = await mount();
    const themed = el.shadowRoot?.querySelector<HTMLElement>('.taleart');
    expect(themed?.style.getPropertyValue('--ta-ring')).toBe('#0055ff');
    expect(themed?.style.getPropertyValue('--ta-radius')).toBe('0px');
    expect(themed?.style.getPropertyValue('--ta-font')).toBe('Georgia, serif');
    expect(themed?.style.getPropertyValue('--ta-seen')).toBe('#6b7280');
    // Both frames and, once open, the viewer sit inside the themed wrapper, so they inherit it.
    expect(themed?.querySelector('.bar')).not.toBeNull();
    expect(themed?.querySelector('.banner')).not.toBeNull();
    items(el)[0].click();
    expect(themed?.querySelector('dialog.viewer')).not.toBeNull();
    // The style text holds only the SDK's own rules, never a theme value.
    expect(el.shadowRoot?.querySelector('style')?.textContent).not.toContain('#0055ff');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('renders the default theme when the theme is missing or invalid, without logging', async () => {
    for (const theme of [undefined, { titleColor: 'red;}</style>', ringWidth: 9, fontFamily: 'a{b}' }]) {
      fetchMock.mockImplementation(async () => respond(200, { ...zone, theme }));
      const el = await mount();
      const themed = el.shadowRoot?.querySelector<HTMLElement>('.taleart');
      // Unset: the host page's title colour and font, the frame's radius, a transparent background.
      expect(themed?.style.getPropertyValue('--ta-title')).toBe('');
      expect(themed?.style.getPropertyValue('--ta-font')).toBe('');
      expect(themed?.style.getPropertyValue('--ta-radius')).toBe('');
      expect(themed?.style.getPropertyValue('--ta-bg')).toBe('transparent');
      expect(themed?.style.getPropertyValue('--ta-ring-width')).toBe('2px');
      el.remove();
    }
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("covers with the first tale's image, a video's first frame without autoplay, or a placeholder", async () => {
    const el = await mount();
    const [image, video, empty] = items(el).map((b) => b.querySelector('.cover'));
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect((image as HTMLImageElement).src).toBe(`${API}/media/tales/a.png`);
    expect((image as HTMLImageElement).alt).toBe('');
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect((video as HTMLVideoElement).src).toBe(`${API}/media/tales/b.mp4#t=0.001`);
    expect((video as HTMLVideoElement).preload).toBe('metadata');
    expect((video as HTMLVideoElement).autoplay).toBe(false);
    expect(empty?.hasAttribute('data-placeholder')).toBe(true);
  });

  it('covers with the first tale that has media when the first tale has none', async () => {
    const group = {
      id: 'gd',
      name: 'Later',
      tales: [
        { id: 't3', title: 'None', media: null },
        { id: 't4', title: 'Pic', media: { kind: 'image' as const, contentType: 'image/png' as const, url: `${API}/media/tales/d.png` } },
      ],
    };
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [group] }));
    const el = await mount();
    const cover = items(el)[0].querySelector('.cover');
    expect(cover).toBeInstanceOf(HTMLImageElement);
    expect((cover as HTMLImageElement).src).toBe(`${API}/media/tales/d.png`);
  });

  it.each([
    ['an HTML page', () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['a body without taleGroups', () => respond(200, { id: 'z1', name: 'Home', frames: [{ id: 'f1', type: 'bar', settings: {} }] })],
    ['a body without frames', () => respond(200, { id: 'z1', name: 'Home', taleGroups: [] })],
  ])('treats %s on 200 as a failure: renders nothing, one error, no unhandled rejection', async (_label, body) => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      fetchMock.mockImplementation(async () => body());
      const el = await mount();
      expect(el.shadowRoot?.childNodes.length).toBe(0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('opens the group of an activated bar item in the full-screen viewer', async () => {
    const el = await mount();
    items(el)[1].click();
    const dialog = el.shadowRoot?.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('aria-label')).toBe('Winter');
    expect(el.shadowRoot?.activeElement).toBe(dialog);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('opens nothing for a group without tales', async () => {
    const el = await mount();
    expect(() => items(el)[2].click()).not.toThrow();
    expect(el.shadowRoot?.querySelector('dialog')).toBeNull();
  });

  it('returns focus to the bar item of the group shown last when the viewer closes', async () => {
    const el = await mount();
    items(el)[0].click();
    const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(dialog.getAttribute('aria-label')).toBe('Winter');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
  });

  it('shows the seen ring for viewed groups, now and after a reload', async () => {
    const el = await mount();
    expect(items(el).some((b) => b.hasAttribute('data-seen'))).toBe(false);
    items(el)[0].click();
    el.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    expect(items(el)[0].hasAttribute('data-seen')).toBe(true);
    el.remove();

    const again = await mount();
    const [summer, winter] = items(again);
    expect(summer.hasAttribute('data-seen')).toBe(true);
    expect(summer.getAttribute('aria-label')).toBe('Summer, seen');
    expect(winter.hasAttribute('data-seen')).toBe(false);
    expect(winter.getAttribute('aria-label')).toBe('Winter');
  });

  it('renders the bar as unseen when local storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const el = await mount();
    expect(items(el)).toHaveLength(3);
    expect(items(el).some((b) => b.hasAttribute('data-seen'))).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('closes an open viewer when the element is removed', async () => {
    const el = await mount();
    items(el)[0].click();
    el.remove();
    expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
  });

  it('moves focus to the matching item of the new bar when a reload closes the open viewer', async () => {
    const el = await mount();
    items(el)[1].click();
    el.zoneKey = 'tak_other';
    await settle();
    expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
    expect(items(el)).toHaveLength(3);
    expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
  });

  it('moves focus to the first item when the reloaded bar no longer has the group', async () => {
    const el = await mount();
    items(el)[1].click();
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [zone.taleGroups[0], zone.taleGroups[2]] }));
    el.zoneKey = 'tak_other';
    await settle();
    expect(el.shadowRoot?.activeElement).toBe(items(el)[0]);
  });

  it('renders nothing and logs one error with the API message for a refused key', async () => {
    fetchMock.mockImplementation(async () =>
      respond(401, { error: { code: 'invalid_zone_key', message: 'A valid zone key is required' } }),
    );
    const el = await mount();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('A valid zone key is required');
  });

  it('renders nothing and logs one error on a network failure', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const el = await mount();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('Failed to fetch');
  });

  it('skips frame types it does not know: a zone with only a feed renders nothing, without an error', async () => {
    fetchMock.mockImplementation(async () => respond(200, { ...zone, frames: [{ id: 'f0', type: 'feed', settings: {} }] }));
    const el = await mount();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders an empty bar for a zone without tale groups', async () => {
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [] }));
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.bar')).not.toBeNull();
    expect(items(el)).toEqual([]);
  });

  describe('with a banner frame', () => {
    const withBanner = (frames: DeliveryZone['frames']) =>
      fetchMock.mockImplementation(async () => respond(200, { ...zone, frames }));
    const slideButtons = (el: TaleartElement) => [
      ...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('.banner button.b-open') ?? []),
    ];

    it("renders the bar and the banner in the zone's frame order, skipping unknown types", async () => {
      withBanner([
        { id: 'f2', type: 'banner', settings: { aspectRatio: '3:1', showDots: false } },
        { id: 'f0', type: 'feed', settings: {} },
        { id: 'f1', type: 'bar', settings: {} },
      ]);
      const el = await mount();
      const frames = [...(el.shadowRoot?.querySelector('.taleart')?.children ?? [])];
      expect(frames.map((node) => node.className)).toEqual(['banner', 'bar']);
      const banner = el.shadowRoot?.querySelector<HTMLElement>('.banner');
      expect(banner?.dataset['ratio']).toBe('3:1');
      expect(banner?.querySelector('.b-dots')).toBeNull();
      // The group without tales gets a bar item but no slide.
      expect(slideButtons(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter']);
      expect(items(el)).toHaveLength(3);
      expect(el.shadowRoot?.querySelector('style')?.textContent).toContain('.b-viewport');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('renders nothing for a zone whose only frame is a banner and no group has a tale', async () => {
      fetchMock.mockImplementation(async () =>
        respond(200, { ...zone, frames: [{ id: 'f2', type: 'banner', settings: {} }], taleGroups: [zone.taleGroups[2]] }),
      );
      const el = await mount();
      expect(el.shadowRoot?.childNodes.length).toBe(0);
    });

    it('opens the viewer at the activated slide group and returns focus to that slide', async () => {
      withBanner([
        { id: 'f1', type: 'bar', settings: {} },
        { id: 'f2', type: 'banner', settings: {} },
      ]);
      const el = await mount();
      slideButtons(el)[1].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-label')).toBe('Winter');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
      // The viewed group shows the seen ring in the bar.
      expect(items(el)[1].hasAttribute('data-seen')).toBe(true);
    });

    it('shows the slide of the group shown last when the viewer closes', async () => {
      withBanner([{ id: 'f2', type: 'banner', settings: {} }]);
      const el = await mount();
      slideButtons(el)[0].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(dialog.getAttribute('aria-label')).toBe('Winter');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
      expect(slideButtons(el)[1].closest('.b-slide')?.hasAttribute('inert')).toBe(false);
    });

    it('renders two bar frames of one zone, each opening the viewer and taking focus back', async () => {
      withBanner([
        { id: 'f1', type: 'bar', settings: {} },
        { id: 'f3', type: 'bar', settings: { size: 'large' } },
      ]);
      const el = await mount();
      const bars = [...(el.shadowRoot?.querySelectorAll<HTMLElement>('.bar') ?? [])];
      expect(bars).toHaveLength(2);
      expect(bars[1].style.getPropertyValue('--ta-size')).toBe('80px');
      const second = bars[1].querySelectorAll<HTMLButtonElement>('button.item');
      second[0].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.getAttribute('aria-label')).toBe('Summer');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(el.shadowRoot?.activeElement).toBe(second[0]);
      // Both bars show the seen ring.
      expect(bars.map((bar) => bar.querySelector('button.item')?.hasAttribute('data-seen'))).toEqual([true, true]);
    });

    it('restores focus to the opener frame after a reload, not the first frame with the group', async () => {
      withBanner([
        { id: 'f2', type: 'banner', settings: {} },
        { id: 'f1', type: 'bar', settings: {} },
      ]);
      const el = await mount();
      items(el)[1].click();
      expect(el.shadowRoot?.querySelector('dialog')?.hasAttribute('open')).toBe(true);
      el.zoneKey = 'tak_other';
      await settle();
      expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
      expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
    });

    it('restores focus to the opener banner slide after a reload, without stopping its autoplay', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      withBanner([
        { id: 'f1', type: 'bar', settings: {} },
        { id: 'f2', type: 'banner', settings: {} },
      ]);
      const el = await mount();
      slideButtons(el)[1].click();
      el.zoneKey = 'tak_other';
      await settle();
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
      // Focus moved by the SDK is not the visitor interacting: the new banner still rotates.
      expect(el.shadowRoot?.querySelector('.b-track')?.getAttribute('aria-live')).toBe('off');
    });

    it("stops the banner's autoplay timer when the element is removed or reloads", async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      withBanner([{ id: 'f2', type: 'banner', settings: { intervalSeconds: 3 } }]);
      const timeouts = vi.spyOn(globalThis, 'clearTimeout');
      const el = await mount();
      const track = () => el.shadowRoot?.querySelector<HTMLElement>('.b-track');
      const first = track();
      expect(first?.getAttribute('aria-live')).toBe('off');
      timeouts.mockClear();
      el.zoneKey = 'tak_other';
      await settle();
      expect(timeouts).toHaveBeenCalled();
      expect(track()).not.toBe(first);
      timeouts.mockClear();
      el.remove();
      expect(timeouts).toHaveBeenCalled();
    });
  });

  describe('with stages (R7)', () => {
    // Two bar frames of one zone, circle and rounded-square, a banner, a feed, and a stage for each.
    const staged: DeliveryZone = {
      ...zone,
      frames: [
        { id: 'f1', type: 'bar', settings: { shape: 'circle' } },
        { id: 'f2', type: 'bar', settings: { shape: 'rounded-square' } },
        { id: 'f3', type: 'banner', settings: { autoplay: false } },
        { id: 'f4', type: 'feed', settings: {} },
      ],
      stages: [
        { key: 'round', frameId: 'f1' },
        { key: 'square', frameId: 'f2' },
        { key: 'hero', frameId: 'f3' },
        { key: 'feed', frameId: 'f4' },
        { key: 'gone', frameId: 'f9' },
      ],
    };
    const bars = (el: TaleartElement) => [...(el.shadowRoot?.querySelectorAll<HTMLElement>('.bar') ?? [])];
    const withStage = (stage: string) => mount({ 'api-url': API, 'zone-key': KEY, stage });

    beforeEach(() => fetchMock.mockImplementation(async () => respond(200, staged)));

    it("renders only the named stage's frame: two elements show their own bar shapes", async () => {
      const round = await withStage('round');
      const square = await withStage('square');
      expect(bars(round).map((bar) => bar.dataset['shape'])).toEqual(['circle']);
      expect(bars(square).map((bar) => bar.dataset['shape'])).toEqual(['rounded-square']);
      expect(round.shadowRoot?.querySelector('section.banner')).toBeNull();
      expect(items(round)).toHaveLength(3);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('renders a banner stage alone', async () => {
      const el = await withStage(' hero ');
      expect(el.shadowRoot?.querySelector('section.banner')).not.toBeNull();
      expect(bars(el)).toHaveLength(0);
    });

    it('renders every known frame in order when no stage, or an empty one, is named', async () => {
      for (const el of [await mount(), await withStage(''), await withStage('  ')]) {
        expect(bars(el).map((bar) => bar.dataset['shape'])).toEqual(['circle', 'rounded-square']);
        expect(el.shadowRoot?.querySelector('section.banner')).not.toBeNull();
      }
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('renders nothing and warns once that the zone has no such stage for an unknown key', async () => {
      for (const key of ['nope', 'ROUND']) {
        warnSpy.mockClear();
        const el = await withStage(key);
        expect(el.shadowRoot?.childNodes).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toBe(`TaleArt: the zone has no stage "${key}"; nothing is rendered for it`);
      }
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('renders nothing and warns once, distinctly, for a stage that points to a missing frame', async () => {
      const broken = { ...staged, stages: [...(staged.stages ?? []), { key: 'odd', frameId: 7 }, { key: 'bare' }] };
      fetchMock.mockImplementation(async () => respond(200, broken));
      for (const key of ['gone', 'odd', 'bare']) {
        warnSpy.mockClear();
        const el = await withStage(key);
        expect(el.shadowRoot?.childNodes).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toBe(
          `TaleArt: stage "${key}" points to a frame the zone does not have; nothing is rendered for it`,
        );
      }
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('renders nothing, silently, for a stage of a frame type it does not know', async () => {
      const el = await withStage('feed');
      expect(el.shadowRoot?.childNodes).toHaveLength(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('treats a missing, malformed or junk stages list as no stages', async () => {
      const junk: [unknown, string][] = [
        [{ ...staged, stages: undefined }, 'has no stage'],
        [{ ...staged, stages: 'round' }, 'has no stage'],
        [{ ...staged, stages: [null, 7, 'round', { key: ['round'], frameId: 'f1' }] }, 'has no stage'],
        [{ ...staged, stages: [{ key: 'round', frameId: 1 }, { key: 'round', frameId: 'f1' }] }, 'points to a frame'],
      ];
      for (const [body, message] of junk) {
        fetchMock.mockImplementation(async () => respond(200, body));
        warnSpy.mockClear();
        const el = await withStage('round');
        expect(el.shadowRoot?.childNodes).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain(message);
        // With no stage named, the same response renders every frame.
        expect(bars(await mount())).toHaveLength(2);
      }
    });

    it('reloads and renders the new stage when the stage attribute or property changes', async () => {
      const el = await withStage('round');
      el.setAttribute('stage', 'square');
      await settle();
      expect(bars(el).map((bar) => bar.dataset['shape'])).toEqual(['rounded-square']);
      el.stage = 'nope';
      await settle();
      expect(el.shadowRoot?.childNodes).toHaveLength(0);
      el.removeAttribute('stage');
      await settle();
      expect(bars(el)).toHaveLength(2);
      expect(el.stage).toBe('');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("opens the viewer from a staged bar and returns focus to that bar's item", async () => {
      const el = await withStage('square');
      items(el)[1].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.getAttribute('aria-label')).toBe('Winter');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
      expect(items(el)[1].hasAttribute('data-seen')).toBe(true);
    });
  });

  it('accepts the API URL and key as properties, and waits until both are set', async () => {
    const el = await mount({});
    expect(fetchMock).not.toHaveBeenCalled();
    el.apiUrl = API;
    el.zoneKey = KEY;
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.getAttribute('zone-key')).toBe(KEY);
    expect(items(el)).toHaveLength(3);
  });

  it('animates an animated cover and stills it when the visitor turns reduced motion on, and back', async () => {
    let reduced = false;
    const listeners = new Set<(event: { matches: boolean }) => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return query === '(prefers-reduced-motion: reduce)' && reduced;
        },
        addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
      })),
    );
    const url = `${API}/media/covers/c.webm`;
    fetchMock.mockImplementation(async () =>
      respond(200, {
        ...zone,
        taleGroups: [
          { ...zone.taleGroups[0], cover: { kind: 'video', contentType: 'video/webm', animated: true, url } },
        ],
      }),
    );
    const el = await mount();
    const cover = () => el.shadowRoot?.querySelector<HTMLVideoElement>('video.cover');
    expect(cover()?.autoplay).toBe(true);
    expect(cover()?.getAttribute('src')).toBe(url);

    reduced = true;
    for (const listener of listeners) listener({ matches: true });
    expect(cover()?.autoplay).toBe(false);
    expect(cover()?.getAttribute('src')).toBe(`${url}#t=0.001`);

    reduced = false;
    for (const listener of listeners) listener({ matches: false });
    expect(cover()?.autoplay).toBe(true);

    el.remove();
    expect(listeners.size).toBe(0);
  });

  it('follows the reduced-motion setting through addListener where addEventListener is missing', async () => {
    let listener: ((event: { matches: boolean }) => void) | null = null;
    const removeListener = vi.fn();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addListener: (l: (event: { matches: boolean }) => void) => (listener = l),
        removeListener,
      })),
    );
    const url = `${API}/media/covers/c.webm`;
    fetchMock.mockImplementation(async () =>
      respond(200, {
        ...zone,
        taleGroups: [{ ...zone.taleGroups[0], cover: { kind: 'video', contentType: 'video/webm', animated: true, url } }],
      }),
    );
    const el = await mount();
    expect(el.shadowRoot?.querySelector<HTMLVideoElement>('video.cover')?.autoplay).toBe(true);
    listener?.({ matches: true });
    expect(el.shadowRoot?.querySelector<HTMLVideoElement>('video.cover')?.autoplay).toBe(false);
    el.remove();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
});
