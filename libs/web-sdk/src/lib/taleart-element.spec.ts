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

  it('does nothing and does not throw when an item is clicked', async () => {
    const el = await mount();
    expect(() => items(el)[0].click()).not.toThrow();
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
});
