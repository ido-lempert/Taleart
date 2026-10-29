import type { DeliveryTaleElement, DeliveryZone } from '@taleart/contract';
import { COVER_MOTION_MS } from './bar';
import { init } from './config';
import { FIRST_CONTENT_MARK, ZONE_MARK } from './first-content';
import { configureZone, defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';
import { visitorId } from './visitor';

const API = 'https://api.example.com';
// Elements are placed with the project's site key and a zone slug (zone keys are gone, story 8.7).
const SITE = 'tak_testkey';
const SLUG = 'home';
// A second zone key: its zone is named 'other' (the response's slug).
const OTHER_KEY = 'tak_otherzone0001';

const zone: DeliveryZone = {
  id: 'z1',
  name: 'Home',
  slug: 'home',
  frame: { id: 'f1', type: 'bar', settings: {} },
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

async function mount(attrs: Record<string, string> = { 'api-url': API, 'zone-key': SITE }): Promise<TaleartElement> {
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
    fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      respond(200, (init.headers as Record<string, string>)['Authorization'] === `Bearer ${OTHER_KEY}` ? { ...zone, slug: 'other' } : zone),
    );
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
    expect(init.headers).toEqual({ Authorization: `Bearer ${SITE}`, 'X-TaleArt-Visitor': visitorId() });
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
      respond(200, { ...zone, frame: { id: 'f1', type: 'bar', settings } }),
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

  it("styles the display and the viewer with the zone's project theme (R9)", async () => {
    const theme = { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' };
    fetchMock.mockImplementation(async () =>
      respond(200, { ...zone, theme, frame: { id: 'f1', type: 'bar', settings: { shape: 'rounded-square' } } }),
    );
    const el = await mount();
    const themed = el.shadowRoot?.querySelector<HTMLElement>('.taleart');
    expect(themed?.style.getPropertyValue('--ta-ring')).toBe('#0055ff');
    expect(themed?.style.getPropertyValue('--ta-radius')).toBe('0px');
    expect(themed?.style.getPropertyValue('--ta-font')).toBe('"Georgia", serif');
    expect(themed?.style.getPropertyValue('--ta-seen')).toBe('#6b7280');
    // The display and, once open, the viewer sit inside the themed wrapper, so they inherit it.
    expect(themed?.querySelector('.bar')).not.toBeNull();
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

  describe('with an SDK theme override (R9)', () => {
    // The project's theme: a solid red ring, 3 px, black titles.
    const projectTheme = { ringStyle: 'solid', ringColors: ['#ff0000'], ringWidth: 3, titleColor: '#000000' };
    const prop = (el: TaleartElement, name: string) =>
      el.shadowRoot?.querySelector<HTMLElement>('.taleart')?.style.getPropertyValue(name);
    const warnings = () => warnSpy.mock.calls.map((call: unknown[]) => String(call[0]));

    beforeEach(() =>
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
        respond(200, {
          ...zone,
          slug: (init?.headers as Record<string, string> | undefined)?.['Authorization'] === `Bearer ${OTHER_KEY}` ? 'other' : SLUG,
          theme: projectTheme,
          frame: { id: 'f1', type: 'bar', settings: {} },
        }),
      ),
    );
    afterEach(() => {
      configureZone(SLUG, {});
      configureZone('other', {});
    });

    it("uses the project's theme when the SDK configuration sets none, without logging", async () => {
      const el = await mount();
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("lets the zone's configured theme win for every element of that zone", async () => {
      configureZone(SLUG, { theme: { ringColors: ['#0000ff'] } });
      const a = await mount();
      const b = await mount();
      const other = await mount({ 'api-url': API, 'zone-key': OTHER_KEY });
      for (const el of [a, b]) {
        expect(prop(el, '--ta-ring')).toBe('#0000ff');
        // The display sits in the one themed wrapper.
        const themed = el.shadowRoot?.querySelector('.taleart');
        expect(themed?.querySelector('.bar')).not.toBeNull();
      }
      expect(prop(other, '--ta-ring')).toBe('#ff0000');
      // Fields the override leaves out come from the project.
      expect(prop(a, '--ta-ring-width')).toBe('3px');
      expect(prop(a, '--ta-title')).toBe('#000000');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("lets the element's theme property win over the zone's", async () => {
      configureZone(SLUG, { theme: { ringColors: ['#0000ff'], accentColor: '#ffcc00' } });
      const el = await mount();
      const sibling = await mount();
      el.theme = { ringColors: ['#00ff00'] };
      expect(prop(el, '--ta-ring')).toBe('#00ff00');
      expect(prop(el, '--ta-accent')).toBe('#ffcc00');
      expect(prop(sibling, '--ta-ring')).toBe('#0000ff');
      expect(el.theme).toEqual({ ringColors: ['#00ff00'] });
    });

    it('reads the theme attribute as JSON', async () => {
      const el = await mount({
        'api-url': API,
        'zone-key': SITE,
        theme: '{"cornerRadius":0,"fontFamily":"Georgia, serif"}',
      });
      expect(prop(el, '--ta-radius')).toBe('0px');
      expect(prop(el, '--ta-font')).toBe('"Georgia", serif');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Changing it restyles without a new request.
      el.setAttribute('theme', '{"cornerRadius":8}');
      await settle();
      expect(prop(el, '--ta-radius')).toBe('8px');
      expect(prop(el, '--ta-font')).toBe('');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      el.removeAttribute('theme');
      expect(prop(el, '--ta-radius')).toBe('');
    });

    it("restores the project's values live when an override is removed, without a new request", async () => {
      configureZone(SLUG, { theme: { ringColors: ['#0000ff'] } });
      const el = await mount();
      el.theme = { ringWidth: 1 };
      expect([prop(el, '--ta-ring'), prop(el, '--ta-ring-width')]).toEqual(['#0000ff', '1px']);
      el.theme = null;
      expect(prop(el, '--ta-ring-width')).toBe('3px');
      configureZone(SLUG, {});
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('restyles an open viewer, which sits inside the themed wrapper', async () => {
      const el = await mount();
      items(el)[0].click();
      const dialog = el.shadowRoot?.querySelector('.taleart dialog.viewer');
      expect(dialog).not.toBeNull();
      el.theme = { accentColor: '#ffcc00' };
      expect(prop(el, '--ta-accent')).toBe('#ffcc00');
      expect(el.shadowRoot?.querySelector('.taleart dialog.viewer')).toBe(dialog);
    });

    it("takes an explicit null as the host page's value, over the project's", async () => {
      const el = await mount();
      expect(prop(el, '--ta-title')).toBe('#000000');
      el.theme = { titleColor: null };
      expect(prop(el, '--ta-title')).toBe('');
      expect(el.shadowRoot?.querySelector('.taleart')?.hasAttribute('data-title')).toBe(false);
    });

    it('ignores an invalid field with one warning naming it, and keeps the valid ones', async () => {
      configureZone(SLUG, { theme: { ringWidth: 9, ringColors: ['#0000ff'] } as never });
      const el = await mount();
      expect(prop(el, '--ta-ring')).toBe('#0000ff');
      expect(prop(el, '--ta-ring-width')).toBe('3px');
      expect(warnings()).toEqual([expect.stringContaining('"ringWidth"')]);
      // A reload does not warn again.
      el.reload();
      await settle();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('never lets an unsafe or unknown value reach the style', async () => {
      const el = await mount();
      el.theme = { fontFamily: 'x;}body{', backgroundColor: 'url(x)', titleColor: 'red', size: 1 } as never;
      const style = el.shadowRoot?.querySelector<HTMLElement>('.taleart')?.getAttribute('style') ?? '';
      expect(style).not.toMatch(/url|body|red|size/);
      expect(warnings()).toHaveLength(4);
      for (const field of ['fontFamily', 'backgroundColor', 'titleColor', 'size']) {
        expect(warnings().filter((w) => w.includes(`"${field}"`))).toHaveLength(1);
      }
      expect(prop(el, '--ta-title')).toBe('#000000');
    });

    it('ignores an override that is not an object, with one warning', async () => {
      const el = await mount();
      el.theme = 'blue' as never;
      el.theme = ['#0000ff'] as never;
      el.setAttribute('theme', '{bad json');
      configureZone(SLUG, { theme: 42 as never });
      configureZone('', { theme: {} });
      expect(warnSpy).toHaveBeenCalledTimes(5);
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      expect(el.theme).toEqual({});
    });

    it('applies the zone and element overrides set before the element loads, and after a reload', async () => {
      configureZone(SLUG, { theme: { ringColors: ['#0000ff'] } });
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.theme = { ringWidth: 4 };
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      document.body.appendChild(el);
      await settle();
      expect([prop(el, '--ta-ring'), prop(el, '--ta-ring-width')]).toEqual(['#0000ff', '4px']);
      el.zoneKey = OTHER_KEY;
      await settle();
      // Another zone: the zone option no longer applies, the element's own still does.
      expect([prop(el, '--ta-ring'), prop(el, '--ta-ring-width')]).toEqual(['#ff0000', '4px']);
    });

    it('returns copies from el.theme: mutating them changes nothing', async () => {
      const el = await mount();
      el.theme = { ringColors: ['#00ff00'] };
      const read = el.theme;
      read.ringColors?.push('#000000');
      (read.ringColors as string[])[0] = 'red;}x{';
      read.ringWidth = 4;
      expect(el.theme).toEqual({ ringColors: ['#00ff00'] });
      el.retheme();
      expect([prop(el, '--ta-ring'), prop(el, '--ta-ring-width')]).toEqual(['#00ff00', '3px']);
    });

    it('warns once for theme="null", and clears silently for a missing or empty attribute', async () => {
      const el = await mount({ 'api-url': API, 'zone-key': SITE,
        theme: '{"ringColors":["#00ff00"]}' });
      expect(prop(el, '--ta-ring')).toBe('#00ff00');
      el.setAttribute('theme', 'null');
      expect(warnings()).toEqual([expect.stringContaining('theme attribute must be a JSON object')]);
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      el.setAttribute('theme', '{"ringColors":["#00ff00"]}');
      el.setAttribute('theme', '');
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      el.setAttribute('theme', '{"ringColors":["#00ff00"]}');
      el.removeAttribute('theme');
      expect(prop(el, '--ta-ring')).toBe('#ff0000');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('names a site key passed by mistake in its warnings by its start only', async () => {
      const key = 'tak_0123456789abcdef';
      configureZone(key, { theme: { ringWidth: 9 } as never });
      expect(warnings()).toEqual([
        'TaleArt: the theme of zone "tak_0123…" has an invalid or unknown field "ringWidth"; it is ignored',
      ]);
      expect(warnings()[0]).not.toContain(key);
      configureZone(key);
    });

    it('removes the zone configuration with configureZone(key) or configureZone(key, {})', async () => {
      const el = await mount();
      const clears = [() => configureZone(SLUG), () => configureZone(SLUG, {}), () => configureZone(SLUG, { theme: null })];
      for (const clear of clears) {
        configureZone(SLUG, { theme: { ringColors: ['#0000ff'] } });
        expect(prop(el, '--ta-ring')).toBe('#0000ff');
        clear();
        expect(prop(el, '--ta-ring')).toBe('#ff0000');
      }
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("never applies a new zone's override to content rendered for the old zone", async () => {
      configureZone('other', { theme: { ringColors: ['#0000ff'] } });
      const el = await mount();
      const oldWrapper = el.shadowRoot?.querySelector<HTMLElement>('.taleart');
      el.zoneKey = OTHER_KEY;
      // Before the new load runs, the old content still belongs to the old zone.
      el.retheme();
      expect(oldWrapper?.style.getPropertyValue('--ta-ring')).toBe('#ff0000');
      configureZone('other', { theme: { ringColors: ['#0000fe'] } });
      expect(oldWrapper?.style.getPropertyValue('--ta-ring')).toBe('#ff0000');
      await settle();
      expect(prop(el, '--ta-ring')).toBe('#0000fe');
    });

    it('lets a theme property set before upgrade win over a theme attribute present at upgrade, silently', async () => {
      const tag = 'taleart-prop-first-view';
      const el = document.createElement(tag) as TaleartElement;
      el.setAttribute('theme', '{bad json');
      (el as unknown as { theme: unknown }).theme = { ringColors: ['#00ff00'] };
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      document.body.appendChild(el);
      customElements.define(tag, class extends TaleartElement {});
      await settle();
      expect(prop(el, '--ta-ring')).toBe('#00ff00');
      expect(el.theme).toEqual({ ringColors: ['#00ff00'] });
      expect(warnSpy).not.toHaveBeenCalled();
      // A later attribute change applies as usual.
      el.setAttribute('theme', '{"ringColors":["#0000ff"]}');
      expect(prop(el, '--ta-ring')).toBe('#0000ff');
    });

    it('checks a pre-upgrade theme when upgraded while detached, and never returns it unchecked', () => {
      const tag = 'taleart-detached-view';
      // Created before the definition and kept detached, so defining it does not upgrade it.
      const el = document.createElement(tag) as TaleartElement;
      (el as unknown as { theme: unknown }).theme = { ringColors: ['#00ff00'], fontFamily: 'x;}body{' };
      customElements.define(tag, class extends TaleartElement {});
      expect(el instanceof TaleartElement).toBe(false);
      customElements.upgrade(el);
      expect(el instanceof TaleartElement).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(el, 'theme')).toBe(false);
      expect(el.theme).toEqual({ ringColors: ['#00ff00'] });
      expect(warnings()).toEqual([expect.stringContaining('"fontFamily"')]);
    });

    it('takes a theme set on the element before the SDK defined it', async () => {
      const tag = 'taleart-late-view';
      const el = document.createElement(tag) as TaleartElement;
      (el as unknown as { theme: unknown }).theme = { ringColors: ['#00ff00'] };
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      document.body.appendChild(el);
      customElements.define(tag, class extends TaleartElement {});
      await settle();
      expect(prop(el, '--ta-ring')).toBe('#00ff00');
      expect(el.theme).toEqual({ ringColors: ['#00ff00'] });
    });
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

  // The default cover (R16): the first tale's lowest media element, else its canvas colour.
  const textTale = (id: string, color: string) => ({
    id,
    title: 'Words',
    media: null,
    document: { version: 1, canvas: { background: { type: 'color', color } }, elements: [] },
  });
  const mediaTale = (id: string, elements: unknown[], background?: unknown) => ({
    id,
    title: 'Pic',
    media: null,
    document: { version: 1, canvas: { background: background ?? { type: 'color', color: '#000000' } }, elements },
  });
  const mediaElement = (type: string, url: string) => ({
    id: `00000000-0000-4000-8000-0000000000${type === 'image' ? 'a1' : 'b2'}`,
    type,
    box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, rotation: 0 },
    a11y: {},
    props: { url, fit: 'cover' },
  });

  it("covers with the first tale that has media, as before; with none, the first tale's colour and the title", async () => {
    const later = {
      id: 'gd',
      name: 'Later',
      cover: null,
      tales: [textTale('t3', '#1f3a5f'), mediaTale('t4', [mediaElement('image', `${API}/media/tales/d.png`)])],
    };
    const words = {
      id: 'gw',
      name: 'Words',
      cover: null,
      tales: [textTale('t5', '#1f3a5f'), textTale('t6', '#ffffff')],
    };
    const old = {
      id: 'go',
      name: 'Old',
      cover: null,
      tales: [
        {
          id: 't7',
          title: 'Old',
          media: { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/o.png` },
          document: null,
        },
      ],
    };
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [later, words, old] }));
    const el = await mount();
    const [picture, colour, legacy] = items(el).map((item) => item.querySelector('.cover') as HTMLElement);
    expect((picture as HTMLImageElement).src).toBe(`${API}/media/tales/d.png`);
    expect(colour.tagName).toBe('SPAN');
    expect(colour.hasAttribute('data-placeholder')).toBe(true);
    expect(colour.style.backgroundColor).toBe('rgb(31, 58, 95)');
    expect(items(el)[1].querySelector('.title')?.textContent).toBe('Words');
    expect((legacy as HTMLImageElement).src).toBe(`${API}/media/tales/o.png`);
  });

  it('counts an image sticker as media for the cover', async () => {
    const sticker = { ...mediaElement('image', `${API}/media/media/s.png`), type: 'sticker' };
    const group = { id: 'gs', name: 'Sticker', cover: null, tales: [mediaTale('t8', [sticker])] };
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [group] }));
    const el = await mount();
    expect((items(el)[0].querySelector('.cover') as HTMLImageElement).src).toBe(`${API}/media/media/s.png`);
  });

  it("covers with the first tale's lowest media element: its background, else its first image or video", async () => {
    const lowest = mediaTale('t5', [
      mediaElement('video', `${API}/media/tales/v.mp4`),
      mediaElement('image', `${API}/media/tales/i.png`),
    ]);
    const background = mediaTale('t6', [mediaElement('image', `${API}/media/tales/i.png`)], {
      type: 'media',
      url: `${API}/media/media/bg.png`,
      fit: 'cover',
      color: '#000000',
    });
    const groups = [
      { id: 'ge', name: 'Video', cover: null, tales: [lowest] },
      { id: 'gf', name: 'Background', cover: null, tales: [background] },
    ];
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: groups }));
    const el = await mount();
    const [video, image] = items(el).map((item) => item.querySelector('.cover'));
    expect(video).toBeInstanceOf(HTMLVideoElement);
    expect((video as HTMLVideoElement).src).toBe(`${API}/media/tales/v.mp4#t=0.001`);
    expect((image as HTMLImageElement).src).toBe(`${API}/media/media/bg.png`);
  });

  it.each([
    ['an HTML page', () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
    ['a body without taleGroups', () => respond(200, { id: 'z1', name: 'Home', frame: { id: 'f1', type: 'bar', settings: {} } })],
    ['a body without a frame', () => respond(200, { id: 'z1', name: 'Home', taleGroups: [] })],
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
    el.zoneKey = OTHER_KEY;
    await settle();
    expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
    expect(items(el)).toHaveLength(3);
    expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
  });

  it('moves focus to the first item when the reloaded bar no longer has the group', async () => {
    const el = await mount();
    items(el)[1].click();
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [zone.taleGroups[0], zone.taleGroups[2]] }));
    el.zoneKey = OTHER_KEY;
    await settle();
    expect(el.shadowRoot?.activeElement).toBe(items(el)[0]);
  });

  describe('zone key (epic UX rework R3, zone keys again)', () => {
    const KEY_TOP = 'tak_hometop0001';
    const KEY_PROMO = 'tak_homepromo001';
    const refused = { error: { code: 'invalid_site_key', message: 'A valid zone key is required' } };
    // Each key names its zone; an unknown or revoked key gets the refusal.
    const zones: Record<string, string> = { [KEY_TOP]: 'home-top', [KEY_PROMO]: 'home-promo' };
    const zoneFor = (slug: string, type = 'bar') => ({
      ...zone,
      id: `z-${slug}`,
      slug,
      frame: { id: `f-${slug}`, type, settings: {} },
      taleGroups: [{ ...zone.taleGroups[0], id: `g-${slug}`, name: `Group of ${slug}` }],
    });
    const answer = () => async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)['Authorization'] ?? '';
      const slug = zones[auth.replace('Bearer ', '')];
      return slug ? respond(200, zoneFor(slug)) : respond(401, refused);
    };
    const keyed = (key: string, extra: Record<string, string> = {}) => ({ 'api-url': API, 'zone-key': key, ...extra });
    const prop = (el: TaleartElement, name: string) =>
      el.shadowRoot?.querySelector<HTMLElement>('.taleart')?.style.getPropertyValue(name);

    afterEach(() => {
      configureZone('home-top', {});
      configureZone('home-promo', {});
    });

    it('reads the zone with the zone key as a bearer token, and no zone query', async () => {
      fetchMock.mockImplementation(answer());
      const el = await mount(keyed(KEY_TOP));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API}/delivery/v1/zone`);
      expect(init.headers).toEqual({ Authorization: `Bearer ${KEY_TOP}`, 'X-TaleArt-Visitor': visitorId() });
      expect(init.credentials).toBe('omit');
      expect(items(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Group of home-top']);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('takes the zone key as a property, and a change of key loads that zone', async () => {
      fetchMock.mockImplementation(answer());
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.apiUrl = API;
      el.zoneKey = KEY_TOP;
      document.body.appendChild(el);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(el.getAttribute('zone-key')).toBe(KEY_TOP);
      expect(items(el)[0].getAttribute('aria-label')).toBe('Group of home-top');
      el.zoneKey = KEY_PROMO;
      await settle();
      expect(items(el)[0].getAttribute('aria-label')).toBe('Group of home-promo');
    });

    it('sends one request per zone key: elements that read the same zone at once share it', async () => {
      fetchMock.mockImplementation(answer());
      const els = [KEY_TOP, KEY_PROMO, KEY_TOP].map((key) => {
        const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
        for (const [name, value] of Object.entries(keyed(key))) el.setAttribute(name, value);
        document.body.appendChild(el);
        return el;
      });
      await settle();
      expect(els.map((el) => items(el)[0]?.getAttribute('aria-label'))).toEqual([
        'Group of home-top',
        'Group of home-promo',
        'Group of home-top',
      ]);
      expect(fetchMock.mock.calls.map(([url, init]) => [String(url), (init as RequestInit).headers])).toEqual([
        [`${API}/delivery/v1/zone`, { Authorization: `Bearer ${KEY_TOP}`, 'X-TaleArt-Visitor': visitorId() }],
        [`${API}/delivery/v1/zone`, { Authorization: `Bearer ${KEY_PROMO}`, 'X-TaleArt-Visitor': visitorId() }],
      ]);
      // Each renders its own copy.
      expect(els[0].shadowRoot?.querySelector('.bar')).not.toBe(els[2].shadowRoot?.querySelector('.bar'));
    });

    it('asks again on a later load instead of reusing a settled answer', async () => {
      fetchMock.mockImplementation(answer());
      await mount(keyed(KEY_TOP));
      await mount(keyed(KEY_TOP));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('renders nothing and logs exactly one error per element for an unknown or revoked key', async () => {
      fetchMock.mockImplementation(answer());
      const unknown = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const sameUnknown = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const revoked = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const good = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      for (const [el, attrs] of [
        [unknown, keyed('tak_nopenope0001')],
        [sameUnknown, keyed('tak_nopenope0001')],
        [revoked, keyed('tak_revokedkey01')],
        [good, keyed(KEY_TOP)],
      ] as const) {
        for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
        document.body.appendChild(el);
      }
      await settle();
      for (const el of [unknown, sameUnknown, revoked]) expect(el.shadowRoot?.childNodes.length).toBe(0);
      expect(items(good)).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledTimes(3);
      for (const [message] of errorSpy.mock.calls) expect(String(message)).toBe(`TaleArt: ${refused.error.message}`);
    });

    it('waits, rendering and logging nothing, while the zone key is missing', async () => {
      const noKey = await mount({ 'api-url': API });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(noKey.shadowRoot?.childNodes.length).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("applies a theme configured for a zone's slug to the element showing that zone only", async () => {
      fetchMock.mockImplementation(answer());
      configureZone('home-top', { theme: { ringColors: ['#0000ff'] } });
      const top = await mount(keyed(KEY_TOP));
      const promo = await mount(keyed(KEY_PROMO));
      expect(prop(top, '--ta-ring')).toBe('#0000ff');
      expect(prop(promo, '--ta-ring')).not.toBe('#0000ff');
      // Live, without a new request, and removable.
      const requests = fetchMock.mock.calls.length;
      configureZone('home-promo', { theme: { ringColors: ['#00ff00'] } });
      expect(prop(promo, '--ta-ring')).toBe('#00ff00');
      configureZone('home-top');
      expect(prop(top, '--ta-ring')).not.toBe('#0000ff');
      expect(fetchMock.mock.calls.length).toBe(requests);
      // A warning names the slug in full (it is no secret), and a zone key passed by mistake only by its start.
      configureZone('home-top', { theme: { ringWidth: 9 } as never });
      configureZone('tak_secretsecret', { theme: { ringWidth: 9 } as never });
      expect(warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
        'TaleArt: the theme of zone "home-top" has an invalid or unknown field "ringWidth"; it is ignored',
        'TaleArt: the theme of zone "tak_secr…" has an invalid or unknown field "ringWidth"; it is ignored',
      ]);
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('secretsecret');
      configureZone('tak_secretsecret', {});
    });
  });

  it('renders nothing and logs one error with the API message for a refused key', async () => {
    fetchMock.mockImplementation(async () =>
      respond(401, { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } }),
    );
    const el = await mount();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('A valid site key and zone are required');
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

  it('skips frame types it does not know: a zone whose display is a feed renders nothing, without an error', async () => {
    fetchMock.mockImplementation(async () => respond(200, { ...zone, frame: { id: 'f0', type: 'feed', settings: {} } }));
    const el = await mount();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders nothing, without an error, for a zone without a display (AD-17)', async () => {
    for (const frame of [null, 'bar', 7]) {
      fetchMock.mockImplementation(async () => respond(200, { ...zone, frame }));
      const el = await mount();
      expect(el.shadowRoot?.querySelector('.bar')).toBeNull();
      el.remove();
    }
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not read a site-key attribute: it warns once and fetches nothing with it', async () => {
    const el = await mount({ 'api-url': API, 'site-key': 'tas_oldproject' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    // One warning tells the page what to use instead, and names no key.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toBe('TaleArt: the site-key attribute is no longer read; place the zone with zone-key');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('oldproject');
  });

  it('ignores a stage attribute: stages are gone (AD-17)', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': SITE, stage: 'nope' });
    expect(el.shadowRoot?.querySelector('.bar')).not.toBeNull();
    expect('stage' in el).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('renders an empty bar for a zone without tale groups', async () => {
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [] }));
    const el = await mount();
    expect(el.shadowRoot?.querySelector('.bar')).not.toBeNull();
    expect(items(el)).toEqual([]);
  });

  describe('with a banner display', () => {
    const withBanner = (frame: DeliveryZone['frame']) =>
      fetchMock.mockImplementation(async () => respond(200, { ...zone, frame }));
    const slideButtons = (el: TaleartElement) => [
      ...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('.banner button.b-open') ?? []),
    ];

    it('renders the banner with its settings', async () => {
      withBanner({ id: 'f2', type: 'banner', settings: { aspectRatio: '3:1', showDots: false } });
      const el = await mount();
      const frames = [...(el.shadowRoot?.querySelector('.taleart')?.children ?? [])];
      expect(frames.map((node) => node.className)).toEqual(['banner']);
      const banner = el.shadowRoot?.querySelector<HTMLElement>('.banner');
      expect(banner?.dataset['ratio']).toBe('3:1');
      expect(banner?.querySelector('.b-dots')).toBeNull();
      // The group without tales gets a bar item but no slide.
      expect(slideButtons(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter']);
      expect(items(el)).toHaveLength(0);
      expect(el.shadowRoot?.querySelector('style')?.textContent).toContain('.b-viewport');
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('renders nothing for a zone whose only frame is a banner and no group has a tale', async () => {
      fetchMock.mockImplementation(async () =>
        respond(200, { ...zone, frame: { id: 'f2', type: 'banner', settings: {} }, taleGroups: [zone.taleGroups[2]] }),
      );
      const el = await mount();
      expect(el.shadowRoot?.childNodes.length).toBe(0);
    });

    it('opens the viewer at the activated slide group and returns focus to that slide', async () => {
      withBanner({ id: 'f2', type: 'banner', settings: {} });
      const el = await mount();
      slideButtons(el)[1].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.getAttribute('aria-label')).toBe('Winter');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
    });

    it('shows the slide of the group shown last when the viewer closes', async () => {
      withBanner({ id: 'f2', type: 'banner', settings: {} });
      const el = await mount();
      slideButtons(el)[0].click();
      const dialog = el.shadowRoot?.querySelector('dialog') as HTMLDialogElement;
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(dialog.getAttribute('aria-label')).toBe('Winter');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
      expect(slideButtons(el)[1].closest('.b-slide')?.hasAttribute('inert')).toBe(false);
    });

    it('restores focus to the opener bar item after a reload', async () => {
      withBanner({ id: 'f1', type: 'bar', settings: {} });
      const el = await mount();
      items(el)[1].click();
      expect(el.shadowRoot?.querySelector('dialog')?.hasAttribute('open')).toBe(true);
      el.zoneKey = OTHER_KEY;
      await settle();
      expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
      expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
    });

    it('restores focus to the opener banner slide after a reload, without stopping its autoplay', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      withBanner({ id: 'f2', type: 'banner', settings: {} });
      const el = await mount();
      slideButtons(el)[1].click();
      el.zoneKey = OTHER_KEY;
      await settle();
      expect(el.shadowRoot?.activeElement).toBe(slideButtons(el)[1]);
      // Focus moved by the SDK is not the visitor interacting: the new banner still rotates.
      expect(el.shadowRoot?.querySelector('.b-track')?.getAttribute('aria-live')).toBe('off');
    });

    it("stops the banner's autoplay timer when the element is removed or reloads", async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      withBanner({ id: 'f2', type: 'banner', settings: { intervalSeconds: 3 } });
      const timeouts = vi.spyOn(globalThis, 'clearTimeout');
      const el = await mount();
      const track = () => el.shadowRoot?.querySelector<HTMLElement>('.b-track');
      const first = track();
      expect(first?.getAttribute('aria-live')).toBe('off');
      timeouts.mockClear();
      el.zoneKey = OTHER_KEY;
      await settle();
      expect(timeouts).toHaveBeenCalled();
      expect(track()).not.toBe(first);
      timeouts.mockClear();
      el.remove();
      expect(timeouts).toHaveBeenCalled();
    });
  });

  it('accepts the API URL and zone key as properties, and waits until both are set', async () => {
    const el = await mount({});
    expect(fetchMock).not.toHaveBeenCalled();
    el.zoneKey = SITE;
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    el.apiUrl = API;
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(el.getAttribute('zone-key')).toBe(SITE);
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

  it('stills an animated cover after COVER_MOTION_MS (WCAG 2.2.2), and again after reduced motion turns off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
        taleGroups: [{ ...zone.taleGroups[0], cover: { kind: 'video', contentType: 'video/webm', animated: true, url } }],
      }),
    );
    const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
    el.setAttribute('api-url', API);
    el.setAttribute('zone-key', SITE);
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(10);
    const cover = () => el.shadowRoot?.querySelector<HTMLVideoElement>('video.cover');
    expect(cover()?.autoplay).toBe(true);
    await vi.advanceTimersByTimeAsync(COVER_MOTION_MS - 20);
    expect(cover()?.autoplay).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(cover()?.autoplay).toBe(false);
    expect(cover()?.getAttribute('src')).toBe(`${url}#t=0.001`);

    reduced = true;
    for (const listener of listeners) listener({ matches: true });
    reduced = false;
    for (const listener of listeners) listener({ matches: false });
    expect(cover()?.autoplay).toBe(true);
    await vi.advanceTimersByTimeAsync(COVER_MOTION_MS);
    expect(cover()?.autoplay).toBe(false);

    el.remove();
    vi.useRealTimers();
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

  describe('first content (NFR-006)', () => {
    let markSpy: ReturnType<typeof vi.spyOn>;
    const marks = (name: string) => markSpy.mock.calls.filter(([n]) => n === name).length;
    // The first-content mark waits for the next animation frame.
    const paint = async () => {
      await settle();
      await new Promise((done) => requestAnimationFrame(() => done(undefined)));
      await settle();
    };

    beforeEach(async () => {
      // Earlier tests' elements may still be waiting for a frame to mark.
      await paint();
      markSpy = vi.spyOn(performance, 'mark');
    });

    it('marks the zone and the first content once per element, not again on a reload', async () => {
      const el = await mount();
      await paint();
      expect(marks(ZONE_MARK)).toBe(1);
      expect(marks(FIRST_CONTENT_MARK)).toBe(1);
      el.setAttribute('zone-key', OTHER_KEY);
      await paint();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect([marks(ZONE_MARK), marks(FIRST_CONTENT_MARK)]).toEqual([1, 1]);
    });

    it('marks the zone once even when the render shows nothing (a zone without a display)', async () => {
      fetchMock.mockImplementation(async () => respond(200, { ...zone, frame: null }));
      const el = await mount();
      el.setAttribute('zone-key', OTHER_KEY);
      await paint();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect([marks(ZONE_MARK), marks(FIRST_CONTENT_MARK)]).toEqual([1, 0]);
    });

    // The bar's image cover (group Summer) is in view; its video cover (group Winter) is below the
    // fold, so it is one of "the rest of this render's pictures", held until the first content is laid out.
    function videoBelowTheFold(): void {
      const inView = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 } as DOMRect;
      const below = { left: 0, top: 5000, right: 100, bottom: 5100, width: 100, height: 100, x: 0, y: 5000 } as DOMRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return this.matches('video.cover') ? below : inView;
      });
    }

    describe('with a cover in view and a picture that never loads', () => {
      beforeEach(() => videoBelowTheFold());

      afterEach(() => vi.useRealTimers());

      const heldVideo = (el: TaleartElement) => el.shadowRoot?.querySelector<HTMLVideoElement>('.bar video.cover');

      it("keeps a new render's pictures held past the old render's 3 s; marks only the shown render", async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
        el.setAttribute('api-url', API);
        el.setAttribute('zone-key', SITE);
        document.body.appendChild(el);
        await vi.advanceTimersByTimeAsync(1000);
        const first = heldVideo(el);
        expect(first?.getAttribute('src')).toBeNull();

        // A new zone one second in: the first render is dropped before it showed its covers.
        el.setAttribute('zone-key', OTHER_KEY);
        await vi.advanceTimersByTimeAsync(10);
        const second = heldVideo(el) as HTMLVideoElement;
        expect(second).not.toBe(first);
        await vi.advanceTimersByTimeAsync(2500);
        // Past the first render's 3 s: the new render's held picture still waits for its own first content.
        expect(second.getAttribute('src')).toBeNull();
        expect(first?.getAttribute('src')).toBeNull();
        expect(marks(FIRST_CONTENT_MARK)).toBe(0);

        const root = el.shadowRoot as ShadowRoot;
        root.querySelector('.bar img.cover')?.dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(50);
        // The mark waits for the next animation frame (jsdom's own clock).
        await new Promise((done) => requestAnimationFrame(() => done(undefined)));
        await vi.advanceTimersByTimeAsync(0);
        expect(second.getAttribute('src')).toBe(`${API}/media/tales/b.mp4#t=0.001`);
        expect(marks(FIRST_CONTENT_MARK)).toBe(1);
      });

      it('starts no downloads after the element leaves the page, and marks nothing', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
        el.setAttribute('api-url', API);
        el.setAttribute('zone-key', SITE);
        document.body.appendChild(el);
        await vi.advanceTimersByTimeAsync(10);
        const held = heldVideo(el) as HTMLVideoElement;
        const root = el.shadowRoot as ShadowRoot;
        const cover = root.querySelector('.bar img.cover');
        el.remove();
        cover?.dispatchEvent(new Event('load'));
        await vi.advanceTimersByTimeAsync(5000);
        expect(held.getAttribute('src')).toBeNull();
        expect(marks(FIRST_CONTENT_MARK)).toBe(0);
      });
    });

    it('marks nothing for a refused key', async () => {
      fetchMock.mockImplementation(async () => respond(401, { error: { code: 'invalid_site_key', message: 'No' } }));
      await mount();
      await paint();
      expect([marks(ZONE_MARK), marks(FIRST_CONTENT_MARK)]).toEqual([0, 0]);
    });

    it("loads the display's covers in view first, high priority, and the other pictures after them", async () => {
      videoBelowTheFold();
      const el = await mount();
      const root = el.shadowRoot as ShadowRoot;
      const barImage = root.querySelector<HTMLImageElement>('.bar img.cover') as HTMLImageElement;
      const barVideo = root.querySelector<HTMLVideoElement>('.bar video.cover') as HTMLVideoElement;
      expect(barImage.getAttribute('src')).toBe(`${API}/media/tales/a.png`);
      expect(barImage.getAttribute('fetchpriority')).toBe('high');
      expect(barImage.hasAttribute('loading')).toBe(false);
      // The cover below the fold waits until the cover in view has loaded.
      expect(barVideo.getAttribute('src')).toBeNull();
      expect(marks(FIRST_CONTENT_MARK)).toBe(0);
      barImage.dispatchEvent(new Event('load'));
      await paint();
      expect(barVideo.getAttribute('src')).toBe(`${API}/media/tales/b.mp4#t=0.001`);
      expect(barVideo.hasAttribute('fetchpriority')).toBe(false);
      expect(marks(FIRST_CONTENT_MARK)).toBe(1);
    });
  });
});

// Strings, hooks and the events an element emits (epic SDK v2: i18n wiring, hooks).
const POLL_ID = '00000000-0000-4000-8000-0000000000aa';
const BUTTON_ID = '00000000-0000-4000-8000-0000000000bb';
const doc = (elements: DeliveryTaleElement[] = []) => ({
  version: 1,
  canvas: { background: { type: 'color' as const, color: '#112233' } },
  elements,
});
// The zone with a document in each tale: `t1` (Beach, in Summer) holds `elements`.
function zoneWith(elements: DeliveryTaleElement[] = []): DeliveryZone {
  return {
    ...zone,
    taleGroups: [
      {
        id: 'ga',
        name: 'Summer',
        tags: [],
        tagMatch: 'any',
        cover: null,
        tales: [
          { id: 't1', title: 'Beach', media: null, document: doc(elements) },
          { id: 't1b', title: 'Sun', media: null, document: doc() },
        ],
      },
      {
        id: 'gb',
        name: 'Winter',
        tags: [],
        tagMatch: 'any',
        cover: null,
        tales: [{ id: 't2', title: 'Snow', media: null, document: doc() }],
      },
    ],
  } as unknown as DeliveryZone;
}
const button = (): DeliveryTaleElement => ({
  id: BUTTON_ID,
  type: 'button',
  box: { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
  a11y: {},
  props: { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', href: 'https://example.com/shop', newTab: true },
} as unknown as DeliveryTaleElement);
const poll = (): DeliveryTaleElement => ({
  id: POLL_ID,
  type: 'poll',
  box: { x: 0.1, y: 0.4, w: 0.8, h: 0.3, rotation: 0 },
  a11y: {},
  props: { question: 'Tea or coffee?', theme: 'light', options: [{ id: 'o1', label: 'Tea' }, { id: 'o2', label: 'Coffee' }] },
} as unknown as DeliveryTaleElement);

describe('TaleartElement: strings, hooks and events', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    fetchMock = vi.fn(async () => respond(200, zoneWith()));
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    init({ hooks: null, strings: null, locale: '' });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Every event the global hooks saw, as one JSON text: a key must never be in it.
  function recordEvents(): unknown[] {
    const events: unknown[] = [];
    init({ hooks: { onEvent: (e) => events.push(e) } });
    return events;
  }
  const names = (events: unknown[]) => events.map((e) => (e as { name: string }).name);
  const ofName = (events: unknown[], name: string) => events.filter((e) => (e as { name: string }).name === name);

  describe('i18n', () => {
    it('shows the close label in the element locale, from the SDK strings', async () => {
      init({ strings: { he: { 'viewer.close': 'סגור' } } });
      const el = await mount({ 'api-url': API, 'zone-key': SITE, locale: 'he' });
      items(el)[0].click();
      const close = el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .close');
      expect(close?.getAttribute('aria-label')).toBe('סגור');
    });

    it('takes the strings property of the element over the SDK strings', async () => {
      init({ locale: 'he', strings: { he: { 'viewer.close': 'סגור' } } });
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      el.strings = { he: { 'viewer.close': 'יציאה' } };
      await settle();
      items(el)[0].click();
      expect(el.shadowRoot?.querySelector('dialog.viewer .close')?.getAttribute('aria-label')).toBe('יציאה');
    });

    it('names a seen group in the element locale too (the bar item and the viewer)', async () => {
      init({ locale: 'he', strings: { he: { 'bar.seen': '{name}, נצפה' } } });
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .close')?.click();
      expect(items(el)[0].getAttribute('aria-label')).toBe('Summer, נצפה');
    });
  });

  describe('loaded and loadFailed', () => {
    it('emits loaded once with the zone key prefix and slug, never the whole key', async () => {
      const events = recordEvents();
      const seen: CustomEvent[] = [];
      const listener = (e: Event) => seen.push(e as CustomEvent);
      document.addEventListener('taleart:loaded', listener);
      await mount({ 'api-url': API, 'zone-key': SITE });
      document.removeEventListener('taleart:loaded', listener);
      expect(ofName(events, 'loaded')).toEqual([{ name: 'loaded', zoneKeyPrefix: 'tak_test', zoneSlug: 'home' }]);
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(seen[0].detail)).not.toContain('testkey');
    });

    it('emits loadFailed with the message when the key is refused, and nothing else', async () => {
      fetchMock.mockImplementation(async () => respond(401, { error: 'invalid_site_key' }));
      const events = recordEvents();
      await mount({ 'api-url': API, 'zone-key': SITE });
      const failed = ofName(events, 'loadFailed') as { error: string; zoneKeyPrefix: string }[];
      expect(failed).toHaveLength(1);
      expect(failed[0].error).toContain('401');
      expect(failed[0].zoneKeyPrefix).toBe('tak_test');
      expect(names(events)).not.toContain('loaded');
      expect(JSON.stringify(events)).not.toContain('testkey');
    });
  });

  describe('groupImpression', () => {
    class FakeObserver {
      static instances: FakeObserver[] = [];
      observed: Element[] = [];
      disconnected = false;
      constructor(readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        FakeObserver.instances.push(this);
      }
      observe(target: Element) {
        this.observed.push(target);
      }
      unobserve(target: Element) {
        this.observed = this.observed.filter((t) => t !== target);
      }
      disconnect() {
        this.disconnected = true;
      }
    }

    beforeEach(() => {
      FakeObserver.instances = [];
      vi.stubGlobal('IntersectionObserver', FakeObserver);
    });

    it('emits once per group, when its item is half on screen', async () => {
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      const observer = FakeObserver.instances.at(-1) as FakeObserver;
      // The zone's two groups with tales are observed (the Empty group has none, as before).
      expect(observer.observed).toHaveLength(2);
      const [summer, winter] = items(el);
      observer.callback([{ isIntersecting: true, target: summer }, { isIntersecting: false, target: winter }]);
      observer.callback([{ isIntersecting: true, target: summer }]);
      observer.callback([{ isIntersecting: true, target: winter }]);
      const impressions = ofName(events, 'groupImpression') as { group: { id: string; index: number; name: string } }[];
      expect(impressions.map((e) => e.group)).toEqual([
        { id: 'ga', name: 'Summer', index: 0 },
        { id: 'gb', name: 'Winter', index: 1 },
      ]);
    });

    it('emits nothing when no IntersectionObserver is there, and renders as before', async () => {
      vi.stubGlobal('IntersectionObserver', undefined);
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      expect(items(el)).toHaveLength(2);
      expect(names(events)).toEqual(['loaded']);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('viewer events', () => {
    it('emits presented, taleShown and dismissed as the viewer opens, steps and closes', async () => {
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      const dialog = el.shadowRoot?.querySelector<HTMLDialogElement>('dialog.viewer');
      expect(names(events).filter((n) => n !== 'groupImpression')).toEqual(['loaded', 'presented', 'taleShown']);
      expect(ofName(events, 'presented')[0]).toMatchObject({ group: { id: 'ga', name: 'Summer', index: 0 } });
      expect(ofName(events, 'taleShown')[0]).toMatchObject({
        group: { id: 'ga', index: 0 },
        tale: { id: 't1', index: 0, title: 'Beach' },
      });
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(ofName(events, 'taleShown').at(-1)).toMatchObject({ tale: { id: 't1b', index: 1, title: 'Sun' } });
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(ofName(events, 'dismissed')).toEqual([
        { name: 'dismissed', zoneKeyPrefix: 'tak_test', zoneSlug: 'home', group: { id: 'ga', name: 'Summer', index: 0 } },
      ]);
    });

    it('calls the element hooks before the global ones, and a throwing hook does not stop the viewer', async () => {
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      const calls: string[] = [];
      el.hooks = {
        onPresented: () => {
          calls.push('element');
          throw new Error('host bug');
        },
      };
      init({ hooks: { onPresented: () => calls.push('global') } });
      items(el)[0].click();
      expect(calls).toEqual(['element', 'global']);
      expect(errorSpy).toHaveBeenCalled();
      expect(el.shadowRoot?.querySelector('dialog.viewer')?.hasAttribute('open')).toBe(true);
    });
  });

  describe('userInteracted', () => {
    it('emits once the server accepts a poll answer, with the component and its value', async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/delivery/v1/responses')
          ? respond(200, { value: 'o1', result: { total: 1, choices: [{ id: 'o1', count: 1, percent: 100 }, { id: 'o2', count: 0, percent: 0 }] } })
          : respond(200, zoneWith([poll()])),
      );
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .ta-poll-opt')?.click();
      await settle();
      expect(ofName(events, 'userInteracted')).toEqual([
        {
          name: 'userInteracted',
          zoneKeyPrefix: 'tak_test',
          zoneSlug: 'home',
          group: { id: 'ga', name: 'Summer', index: 0 },
          tale: { id: 't1', index: 0, title: 'Beach' },
          component: { id: POLL_ID, type: 'poll', value: 'o1' },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain('testkey');
    });
  });

  describe('componentEvent (components, 2026-10-29)', () => {
    const COUNTDOWN_ID = '00000000-0000-4000-8000-0000000000cc';
    const PROMO_ID = '00000000-0000-4000-8000-0000000000dd';
    const countdown = (endsAt: string): DeliveryTaleElement =>
      ({
        id: COUNTDOWN_ID,
        type: 'countdown',
        box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2, rotation: 0 },
        a11y: {},
        props: { endsAt, endedText: 'Sale over' },
      }) as unknown as DeliveryTaleElement;
    const promo = (): DeliveryTaleElement =>
      ({
        id: PROMO_ID,
        type: 'promo-code',
        box: { x: 0.1, y: 0.5, w: 0.8, h: 0.2, rotation: 0 },
        a11y: {},
        props: { code: 'SPRING26', note: 'Once per visitor' },
      }) as unknown as DeliveryTaleElement;
    const base = { zoneKeyPrefix: 'tak_test', zoneSlug: 'home', groupId: 'ga', taleId: 't1' };

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'clipboard');
    });

    it('reports a countdown that has ended when its tale shows, with no value', async () => {
      fetchMock.mockImplementation(async () => respond(200, zoneWith([countdown('2020-01-01T00:00:00Z')])));
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      expect(ofName(events, 'componentEvent')).toEqual([
        { name: 'componentEvent', ...base, component: 'countdown', action: 'ended' },
      ]);
      expect(el.shadowRoot?.querySelector('dialog.viewer .ta-cd-ended')?.textContent).toBe('Sale over');
    });

    it('reports a copied promo code with its code, and a failed copy with nothing', async () => {
      fetchMock.mockImplementation(async () => respond(200, zoneWith([promo()])));
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .ta-promo-copy')?.click();
      await settle();
      expect(writeText).toHaveBeenCalledWith('SPRING26');
      expect(ofName(events, 'componentEvent')).toEqual([
        { name: 'componentEvent', ...base, component: 'promo-code', action: 'copied', value: 'SPRING26' },
      ]);

      events.length = 0;
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => Promise.reject(new Error('no'))) }, configurable: true });
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .ta-promo-copy')?.click();
      await settle();
      expect(ofName(events, 'componentEvent')).toEqual([]);
    });

    it('reports a poll answer as selected, with its option id, next to userInteracted', async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/delivery/v1/responses')
          ? respond(200, { value: 'o1', result: { total: 1, choices: [{ id: 'o1', count: 1, percent: 100 }, { id: 'o2', count: 0, percent: 0 }] } })
          : respond(200, zoneWith([poll()])),
      );
      const events = recordEvents();
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .ta-poll-opt')?.click();
      await settle();
      expect(names(events)).toEqual(expect.arrayContaining(['userInteracted', 'componentEvent']));
      expect(ofName(events, 'componentEvent')).toEqual([
        { name: 'componentEvent', ...base, component: 'poll', action: 'selected', value: 'o1' },
      ]);
    });

    it('reaches the element hook and the DOM event as well as the global hook', async () => {
      fetchMock.mockImplementation(async () => respond(200, zoneWith([countdown('2020-01-01T00:00:00Z')])));
      const own: unknown[] = [];
      const domEvents: CustomEvent[] = [];
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      el.hooks = { onComponentEvent: (e) => own.push(e) };
      el.addEventListener('taleart:component-event', (e) => domEvents.push(e as CustomEvent));
      const global: unknown[] = [];
      init({ hooks: { onComponentEvent: (e) => global.push(e) } });
      items(el)[0].click();
      const expected = { name: 'componentEvent', ...base, component: 'countdown', action: 'ended' };
      expect(own).toEqual([expected]);
      expect(global).toEqual([expected]);
      expect(domEvents.map((e) => e.detail)).toEqual([expected]);
      el.hooks = null;
    });
  });

  describe('actionClicked', () => {
    async function openButton(): Promise<HTMLAnchorElement> {
      fetchMock.mockImplementation(async () => respond(200, zoneWith([button()])));
      const el = await mount({ 'api-url': API, 'zone-key': SITE });
      items(el)[0].click();
      const link = el.shadowRoot?.querySelector<HTMLAnchorElement>('dialog.viewer a.ta-button');
      if (!link) throw new Error('the button link is not rendered');
      return link;
    }

    it('emits before the link navigates, with its url and new-tab flag', async () => {
      const link = await openButton();
      const order: string[] = [];
      const events: unknown[] = [];
      link.addEventListener('click', () => order.push('navigation'));
      init({ hooks: { onActionClicked: () => order.push('hook'), onEvent: (e) => events.push(e) } });
      link.click();
      expect(order).toEqual(['hook', 'navigation']);
      expect(ofName(events, 'actionClicked')).toMatchObject([
        {
          name: 'actionClicked',
          group: { id: 'ga', index: 0 },
          tale: { id: 't1', index: 0 },
          component: { id: BUTTON_ID, type: 'button' },
          url: 'https://example.com/shop',
          newTab: true,
        },
      ]);
    });

    it('does not navigate when the host calls preventDefault on the event', async () => {
      const link = await openButton();
      const seen: boolean[] = [];
      link.addEventListener('click', (e) => seen.push(e.defaultPrevented));
      init({ hooks: { onActionClicked: (e) => e.preventDefault() } });
      const notCanceled = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(notCanceled).toBe(false);
      expect(seen).toEqual([true]);
    });

    it('does not navigate when a DOM listener on the element prevents taleart:action-clicked', async () => {
      const link = await openButton();
      const el = document.querySelector(TALEART_ELEMENT_TAG) as TaleartElement;
      el.addEventListener('taleart:action-clicked', (e) => e.preventDefault());
      const notCanceled = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(notCanceled).toBe(false);
    });
  });

  it('keeps the zone key out of every event of a whole session', async () => {
    const events = recordEvents();
    const el = await mount({ 'api-url': API, 'zone-key': SITE });
    items(el)[0].click();
    el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .close')?.click();
    expect(names(events)).toEqual(expect.arrayContaining(['loaded', 'presented', 'taleShown', 'dismissed']));
    expect(JSON.stringify(events)).not.toContain('testkey');
    expect(JSON.stringify(events)).not.toContain(SITE);
  });
});


describe('TaleartElement: fallback, retry and frequency cap (QW1, QW3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    fetchMock = vi.fn(async () => respond(200, zone));
    vi.stubGlobal('fetch', fetchMock);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    init({ fallback: null, frequency: null, hooks: null });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const failing = () => fetchMock.mockImplementation(async () => respond(500, { error: 'boom' }));
  const text = (el: TaleartElement) => el.shadowRoot?.textContent?.trim() ?? '';
  const sample = (groups: string[]) => localStorage.setItem('taleart.views', JSON.stringify(Object.fromEntries(groups.map((id) => [id, [Date.now()]]))));

  describe('the load-failure placeholder', () => {
    it('shows the light-DOM fallback child only while the zone fails to load', async () => {
      failing();
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      el.innerHTML = '<div slot="fallback">Stories are down</div>';
      document.body.appendChild(el);
      await settle();
      expect(el.getAttribute('data-state')).toBe('failed');
      const slot = el.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="fallback"]');
      expect(slot).not.toBeNull();
      expect(slot?.assignedElements().map((node) => node.textContent)).toEqual(['Stories are down']);
      expect(text(el)).toBe('');
      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows no placeholder when the zone loads, and removes the failed state', async () => {
      const el = await mount();
      expect(el.hasAttribute('data-state')).toBe(false);
      expect(el.shadowRoot?.querySelector('slot')).toBeNull();
      expect(items(el)).toHaveLength(3);
    });

    it('shows the SDK text and a retry button for fallback="message", with no slotted child', async () => {
      failing();
      const el = await mount({ 'api-url': API, 'zone-key': SITE, fallback: 'message' });
      expect(el.getAttribute('data-state')).toBe('failed');
      expect(el.shadowRoot?.querySelector('p')?.textContent).toBe('Stories could not be loaded.');
      const button = el.shadowRoot?.querySelector<HTMLButtonElement>('button');
      expect(button?.textContent).toBe('Try again');
      expect(button?.type).toBe('button');
    });

    it('shows the slotted child instead of the message when there is one', async () => {
      failing();
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      el.setAttribute('fallback', 'message');
      el.innerHTML = '<p slot="fallback">Later</p>';
      document.body.appendChild(el);
      await settle();
      expect(el.shadowRoot?.querySelector('button')).toBeNull();
      expect(el.shadowRoot?.querySelector('slot[name="fallback"]')).not.toBeNull();
    });

    it('renders nothing for fallback="none", the default', async () => {
      failing();
      const el = await mount();
      expect(el.getAttribute('data-state')).toBe('failed');
      expect(text(el)).toBe('');
      expect(el.shadowRoot?.querySelector('button')).toBeNull();
    });

    it('takes the SDK option when the element has none, and the element wins over it', async () => {
      failing();
      init({ fallback: 'message' });
      const fromInit = await mount();
      expect(text(fromInit)).toContain('Stories could not be loaded.');
      fromInit.remove();
      const own = await mount({ 'api-url': API, 'zone-key': SITE, fallback: 'none' });
      expect(text(own)).toBe('');
      expect(own.shadowRoot?.querySelector('button')).toBeNull();
    });

    it('retry button reloads the zone, and the zone renders once it loads', async () => {
      failing();
      const el = await mount({ 'api-url': API, 'zone-key': SITE, fallback: 'message' });
      fetchMock.mockImplementation(async () => respond(200, zone));
      el.shadowRoot?.querySelector<HTMLButtonElement>('button')?.click();
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(el.hasAttribute('data-state')).toBe(false);
      expect(items(el)).toHaveLength(3);
    });

    it('retry() reloads the zone', async () => {
      failing();
      const el = await mount();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      el.retry();
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('takes fallback as a property too', async () => {
      failing();
      const el = await mount();
      el.fallback = 'message';
      await settle();
      expect(el.getAttribute('fallback')).toBe('message');
      expect(el.fallback).toBe('message');
      expect(text(el)).toContain('Stories could not be loaded.');
    });

    it('ignores an invalid fallback with one warning, and the SDK option applies', async () => {
      failing();
      init({ fallback: 'message' });
      const el = await mount({ 'api-url': API, 'zone-key': SITE, fallback: 'banana' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('"none" or "message"');
      expect(text(el)).toContain('Stories could not be loaded.');
    });
  });

  describe('the frequency cap', () => {
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    it.each([
      ['once', [Date.now() - 3 * day], ['ga'] as const],
      ['daily', [Date.now() - hour], ['ga'] as const],
      ['daily', [Date.now() - 2 * day], [] as const],
      ['weekly', [Date.now() - 6 * day], ['ga'] as const],
      ['weekly', [Date.now() - 8 * day], [] as const],
      [2, [Date.now() - 3 * day, Date.now() - day], ['ga'] as const],
      [2, [Date.now() - day], [] as const],
    ])('hides a group by the %s rule when it has reached it (views %j)', async (rule, views, hidden) => {
      localStorage.setItem('taleart.views', JSON.stringify({ ga: views }));
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: String(rule) });
      const shown = items(el).map((b) => b.getAttribute('aria-label'));
      expect(shown).toEqual(hidden.length ? ['Winter', 'Empty'] : ['Summer', 'Winter', 'Empty']);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('counts a view when the viewer opens a group, and the group is then capped', async () => {
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: 'once' });
      expect(items(el)).toHaveLength(3);
      items(el)[0].click();
      el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .close')?.click();
      expect(JSON.parse(localStorage.getItem('taleart.views') ?? '{}')).toMatchObject({ ga: [expect.any(Number)] });
      el.remove();
      const again = await mount({ 'api-url': API, 'zone-key': SITE, frequency: 'once' });
      expect(items(again).map((b) => b.getAttribute('aria-label'))).toEqual(['Winter', 'Empty']);
    });

    it('removes the capped group from the display and emits groupCapped once per group', async () => {
      sample(['ga', 'gb']);
      const onGroupCapped = vi.fn();
      init({ hooks: { onGroupCapped } });
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: 'once' });
      expect(items(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Empty']);
      expect(onGroupCapped).toHaveBeenCalledTimes(2);
      expect(onGroupCapped.mock.calls.map(([event]) => event)).toEqual([
        expect.objectContaining({ name: 'groupCapped', groupId: 'ga', rule: 'once', zoneSlug: 'home' }),
        expect.objectContaining({ name: 'groupCapped', groupId: 'gb', rule: 'once' }),
      ]);
      expect(JSON.stringify(onGroupCapped.mock.calls)).not.toContain('testkey');
    });

    it('renders nothing when every group is capped', async () => {
      sample(['ga', 'gb', 'gc']);
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: 'once' });
      expect(el.shadowRoot?.childElementCount).toBe(0);
      expect(el.shadowRoot?.querySelector('.bar')).toBeNull();
    });

    it('renders as before with no cap: nothing is counted or hidden', async () => {
      sample(['ga', 'gb', 'gc']);
      const onGroupCapped = vi.fn();
      init({ hooks: { onGroupCapped } });
      const el = await mount();
      expect(items(el)).toHaveLength(3);
      expect(onGroupCapped).not.toHaveBeenCalled();
    });

    it('takes the element attribute over the SDK option, and the SDK option when the attribute is absent', async () => {
      sample(['ga']);
      init({ frequency: 'once' });
      const fromInit = await mount({ 'api-url': API, 'zone-key': SITE });
      expect(items(fromInit)).toHaveLength(2);
      fromInit.remove();
      const own = await mount({ 'api-url': API, 'zone-key': SITE, frequency: '3' });
      expect(items(own)).toHaveLength(3);
    });

    it('takes frequency as a property too', async () => {
      sample(['ga']);
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.setAttribute('api-url', API);
      el.setAttribute('zone-key', SITE);
      el.frequency = 'once';
      document.body.appendChild(el);
      await settle();
      expect(el.getAttribute('frequency')).toBe('once');
      expect(el.frequency).toBe('once');
      expect(items(el)).toHaveLength(2);
    });

    it('ignores a count above 50 with one warning, and shows every group', async () => {
      sample(['ga', 'gb', 'gc']);
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: '51' });
      expect(items(el)).toHaveLength(3);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('once, daily, weekly or a positive integer');
    });

    it('ignores an invalid frequency with one warning, and shows every group', async () => {
      sample(['ga', 'gb', 'gc']);
      const el = await mount({ 'api-url': API, 'zone-key': SITE, frequency: 'often' });
      expect(items(el)).toHaveLength(3);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('once, daily, weekly or a positive integer');
    });
  });
});
