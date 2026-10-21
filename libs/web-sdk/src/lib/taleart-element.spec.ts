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
