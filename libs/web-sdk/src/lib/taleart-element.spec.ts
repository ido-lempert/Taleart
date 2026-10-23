import type { DeliveryZone } from '@taleart/contract';
import { COVER_MOTION_MS } from './bar';
import { FIRST_CONTENT_MARK, ZONE_MARK } from './first-content';
import { configureZone, defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';
import { visitorId } from './visitor';

const API = 'https://api.example.com';
// Elements are placed with the project's site key and a zone slug (zone keys are gone, story 8.7).
const SITE = 'tas_testkey';
const SLUG = 'home';

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

async function mount(attrs: Record<string, string> = { 'api-url': API, 'site-key': SITE, zone: SLUG }): Promise<TaleartElement> {
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
    expect(url).toBe(`${API}/delivery/v1/zone?zone=${SLUG}`);
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
      fetchMock.mockImplementation(async () =>
        respond(200, { ...zone, theme: projectTheme, frame: { id: 'f1', type: 'bar', settings: {} } }),
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
      const other = await mount({ 'api-url': API, 'site-key': SITE, zone: 'other' });
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
        'site-key': SITE,
        zone: SLUG,
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
      el.zone = SLUG;
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
      el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
      document.body.appendChild(el);
      await settle();
      expect([prop(el, '--ta-ring'), prop(el, '--ta-ring-width')]).toEqual(['#0000ff', '4px']);
      el.zone = 'other';
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
      const el = await mount({ 'api-url': API, 'site-key': SITE,
        zone: SLUG, theme: '{"ringColors":["#00ff00"]}' });
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
      const key = 'tas_0123456789abcdef';
      configureZone(key, { theme: { ringWidth: 9 } as never });
      expect(warnings()).toEqual([
        'TaleArt: the theme of zone "tas_0123…" has an invalid or unknown field "ringWidth"; it is ignored',
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
      el.zone = 'other';
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
      el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
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
      el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
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
    el.zone = 'other';
    await settle();
    expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
    expect(items(el)).toHaveLength(3);
    expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
  });

  it('moves focus to the first item when the reloaded bar no longer has the group', async () => {
    const el = await mount();
    items(el)[1].click();
    fetchMock.mockImplementation(async () => respond(200, { ...zone, taleGroups: [zone.taleGroups[0], zone.taleGroups[2]] }));
    el.zone = 'other';
    await settle();
    expect(el.shadowRoot?.activeElement).toBe(items(el)[0]);
  });

  describe('site key and zone slug (epic UX rework R3)', () => {
    const SITE_KEY = 'tas_sitekey';
    const refused = { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } };
    const zoneFor = (slug: string, type = 'bar') => ({
      ...zone,
      id: `z-${slug}`,
      slug,
      frame: { id: `f-${slug}`, type, settings: {} },
      taleGroups: [{ ...zone.taleGroups[0], id: `g-${slug}`, name: `Group of ${slug}` }],
    });
    // Answers each slug with its own zone, and an unknown slug or another key with the refusal.
    const answer = (known: string[]) => async (url: string, init: RequestInit) => {
      const slug = new URL(url).searchParams.get('zone') ?? '';
      const auth = (init.headers as Record<string, string>)['Authorization'];
      return auth === `Bearer ${SITE_KEY}` && known.includes(slug) ? respond(200, zoneFor(slug)) : respond(401, refused);
    };
    const site = (slug: string, extra: Record<string, string> = {}) => ({
      'api-url': API,
      'site-key': SITE_KEY,
      zone: slug,
      ...extra,
    });
    const prop = (el: TaleartElement, name: string) =>
      el.shadowRoot?.querySelector<HTMLElement>('.taleart')?.style.getPropertyValue(name);

    afterEach(() => {
      configureZone('home-top', {});
      configureZone('home-promo', {});
    });

    it('reads the zone by slug with the site key as a bearer token', async () => {
      fetchMock.mockImplementation(answer(['home-top']));
      const el = await mount(site('home-top'));
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API}/delivery/v1/zone?zone=home-top`);
      expect(init.headers).toEqual({ Authorization: `Bearer ${SITE_KEY}`, 'X-TaleArt-Visitor': visitorId() });
      expect(init.credentials).toBe('omit');
      expect(items(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Group of home-top']);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('takes the site key and slug as properties, and a change of slug loads that zone', async () => {
      fetchMock.mockImplementation(answer(['home-top', 'home-promo']));
      const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      el.apiUrl = API;
      el.siteKey = SITE_KEY;
      el.zone = 'home-top';
      document.body.appendChild(el);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect([el.getAttribute('site-key'), el.getAttribute('zone')]).toEqual([SITE_KEY, 'home-top']);
      expect(items(el)[0].getAttribute('aria-label')).toBe('Group of home-top');
      el.zone = 'home-promo';
      await settle();
      expect(items(el)[0].getAttribute('aria-label')).toBe('Group of home-promo');
    });

    it('sends one request per key when elements with different site keys name the same slug', async () => {
      fetchMock.mockImplementation(answer(['home-top']));
      for (const key of [SITE_KEY, 'tas_otherproject']) {
        const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
        for (const [name, value] of Object.entries(site('home-top', { 'site-key': key }))) el.setAttribute(name, value);
        document.body.appendChild(el);
      }
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers)).toEqual([
        { Authorization: `Bearer ${SITE_KEY}`, 'X-TaleArt-Visitor': visitorId() },
        { Authorization: 'Bearer tas_otherproject', 'X-TaleArt-Visitor': visitorId() },
      ]);
    });

    it('lets several elements share one site key, each showing its own zone, with one request per zone', async () => {
      fetchMock.mockImplementation(answer(['home-top', 'home-promo']));
      const els = ['home-top', 'home-promo', 'home-top'].map((slug) => {
        const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
        for (const [name, value] of Object.entries(site(slug))) el.setAttribute(name, value);
        document.body.appendChild(el);
        return el;
      });
      await settle();
      expect(els.map((el) => items(el)[0]?.getAttribute('aria-label'))).toEqual([
        'Group of home-top',
        'Group of home-promo',
        'Group of home-top',
      ]);
      // The two elements of home-top asked at once and shared one request.
      expect(fetchMock.mock.calls.map(([url]) => String(url)).sort()).toEqual([
        `${API}/delivery/v1/zone?zone=home-promo`,
        `${API}/delivery/v1/zone?zone=home-top`,
      ]);
      // Each renders its own copy.
      expect(els[0].shadowRoot?.querySelector('.bar')).not.toBe(els[2].shadowRoot?.querySelector('.bar'));
    });

    it('asks again on a later load instead of reusing a settled answer', async () => {
      fetchMock.mockImplementation(answer(['home-top']));
      await mount(site('home-top'));
      await mount(site('home-top'));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('renders nothing and logs exactly one error per element for an unknown slug or a revoked key', async () => {
      fetchMock.mockImplementation(answer(['home-top']));
      const unknown = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const sameUnknown = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const revoked = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      const good = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
      for (const [el, attrs] of [
        [unknown, site('nope')],
        [sameUnknown, site('nope')],
        [revoked, site('home-top', { 'site-key': 'tas_revoked' })],
        [good, site('home-top')],
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

    it('waits, rendering and logging nothing, while the slug or the site key is missing', async () => {
      const noSlug = await mount({ 'api-url': API, 'site-key': SITE_KEY });
      const noKey = await mount({ 'api-url': API, zone: 'home-top' });
      expect(fetchMock).not.toHaveBeenCalled();
      for (const el of [noSlug, noKey]) expect(el.shadowRoot?.childNodes.length).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("applies a theme configured for one slug to that zone's elements only", async () => {
      fetchMock.mockImplementation(answer(['home-top', 'home-promo']));
      configureZone('home-top', { theme: { ringColors: ['#0000ff'] } });
      const top = await mount(site('home-top'));
      const promo = await mount(site('home-promo'));
      expect(prop(top, '--ta-ring')).toBe('#0000ff');
      expect(prop(promo, '--ta-ring')).not.toBe('#0000ff');
      // Live, without a new request, and removable.
      const requests = fetchMock.mock.calls.length;
      configureZone('home-promo', { theme: { ringColors: ['#00ff00'] } });
      expect(prop(promo, '--ta-ring')).toBe('#00ff00');
      configureZone('home-top');
      expect(prop(top, '--ta-ring')).not.toBe('#0000ff');
      expect(fetchMock.mock.calls.length).toBe(requests);
      // A warning names the slug in full (it is no secret), and a site key passed by mistake only by its start.
      configureZone('home-top', { theme: { ringWidth: 9 } as never });
      configureZone('tas_secretsecret', { theme: { ringWidth: 9 } as never });
      expect(warnSpy.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
        'TaleArt: the theme of zone "home-top" has an invalid or unknown field "ringWidth"; it is ignored',
        'TaleArt: the theme of zone "tas_secr…" has an invalid or unknown field "ringWidth"; it is ignored',
      ]);
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('secretsecret');
      configureZone('tas_secretsecret', {});
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

  it('ignores a zone-key attribute: zone keys are gone (story 8.7)', async () => {
    const el = await mount({ 'api-url': API, ['zone' + '-key']: 'old' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.shadowRoot?.childNodes.length).toBe(0);
    expect(('zone' + 'Key') in el).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    // One warning tells the page what to use instead.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toBe(
      'TaleArt: the zone-key attribute is no longer supported; place the zone with site-key and zone',
    );
  });

  it('ignores a stage attribute: stages are gone (AD-17)', async () => {
    const el = await mount({ 'api-url': API, 'site-key': SITE, zone: SLUG, stage: 'nope' });
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
      el.zone = 'other';
      await settle();
      expect(el.shadowRoot?.querySelector('dialog[open]')).toBeNull();
      expect(el.shadowRoot?.activeElement).toBe(items(el)[1]);
    });

    it('restores focus to the opener banner slide after a reload, without stopping its autoplay', async () => {
      vi.stubGlobal('matchMedia', () => ({ matches: false }));
      withBanner({ id: 'f2', type: 'banner', settings: {} });
      const el = await mount();
      slideButtons(el)[1].click();
      el.zone = 'other';
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
      el.zone = 'other';
      await settle();
      expect(timeouts).toHaveBeenCalled();
      expect(track()).not.toBe(first);
      timeouts.mockClear();
      el.remove();
      expect(timeouts).toHaveBeenCalled();
    });
  });

  it('accepts the API URL, site key and slug as properties, and waits until all are set', async () => {
    const el = await mount({});
    expect(fetchMock).not.toHaveBeenCalled();
    el.apiUrl = API;
    el.siteKey = SITE;
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    el.zone = SLUG;
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([el.getAttribute('site-key'), el.getAttribute('zone')]).toEqual([SITE, SLUG]);
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
    el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
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
      el.setAttribute('zone', 'other');
      await paint();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect([marks(ZONE_MARK), marks(FIRST_CONTENT_MARK)]).toEqual([1, 1]);
    });

    it('marks the zone once even when the render shows nothing (a zone without a display)', async () => {
      fetchMock.mockImplementation(async () => respond(200, { ...zone, frame: null }));
      const el = await mount();
      el.setAttribute('zone', 'other');
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
        el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
        document.body.appendChild(el);
        await vi.advanceTimersByTimeAsync(1000);
        const first = heldVideo(el);
        expect(first?.getAttribute('src')).toBeNull();

        // A new zone one second in: the first render is dropped before it showed its covers.
        el.setAttribute('zone', 'other');
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
        el.setAttribute('site-key', SITE);
      el.setAttribute('zone', SLUG);
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
