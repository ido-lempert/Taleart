import type { DeliveryZone } from '@taleart/contract';
import { resetAnalyticsForTests } from './analytics';
import { getConfig, init } from './config';
import { localResponseClient, storedResponse } from './responses';
import { readLocalZone } from './local-zone';
import { validateZone } from './validate-zone';
import {
  configureZone,
  defineTaleartElement,
  setProperties,
  setTags,
  setZoneData,
  TALEART_ELEMENT_TAG,
  TaleartElement,
} from './taleart-element';

// Zone data the page brings itself (no backend): the body of GET /delivery/v1/zone as an object or JSON text.

const MEDIA = (name: string) => ({ kind: 'image', contentType: 'image/png', url: `images/${name}.png` });

const zone = (): DeliveryZone =>
  ({
    id: 'z1',
    name: 'Home',
    slug: 'home-top',
    theme: undefined,
    frame: { id: 'f1', type: 'bar', settings: {} },
    taleGroups: [
      {
        id: 'ga',
        name: 'Summer',
        tags: [],
        tagMatch: 'any',
        audience: null,
        cover: null,
        tales: [{ id: 't1', title: 'Beach', media: MEDIA('beach'), document: null }],
      },
      {
        id: 'gb',
        name: 'Winter',
        tags: ['vip'],
        tagMatch: 'any',
        audience: null,
        cover: null,
        tales: [{ id: 't2', title: 'Snow', media: MEDIA('snow'), document: null }],
      },
    ],
  }) as unknown as DeliveryZone;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function place(attrs: Record<string, string> = {}): TaleartElement {
  const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  return el;
}

async function mount(attrs: Record<string, string>, data?: unknown): Promise<TaleartElement> {
  const el = place(attrs);
  if (data !== undefined) el.data = data;
  document.body.appendChild(el);
  await settle();
  return el;
}

const names = (el: TaleartElement) =>
  [...(el.shadowRoot?.querySelectorAll('button.item') ?? [])].map((b) => b.getAttribute('aria-label'));

describe('validateZone', () => {
  it('accepts a zone object and the same zone as JSON text', () => {
    expect(validateZone(zone())).toEqual({ ok: true });
    expect(validateZone(JSON.stringify(zone()))).toEqual({ ok: true });
  });

  it('accepts the smallest zone: a frame and no groups', () => {
    expect(validateZone({ frame: null, taleGroups: [] })).toEqual({ ok: true });
  });

  it('says when the text is not JSON', () => {
    const result = validateZone('{ "frame": ');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors).toHaveLength(1);
    expect(result.ok === false && result.errors[0]).toMatch(/^the zone is not valid JSON \(/);
  });

  it('says what the root must be', () => {
    for (const value of [null, 5, [], 'null']) {
      const result = validateZone(value);
      expect(result.ok === false && result.errors[0], String(value)).toMatch(/^the zone: must be a JSON object/);
    }
  });

  it('names the path and the problem of each mistake', () => {
    const bad = zone() as unknown as Record<string, unknown>;
    delete bad['taleGroups'];
    delete bad['frame'];
    expect(validateZone(bad)).toEqual({
      ok: false,
      errors: ['frame: is missing (it must be an object or null)', 'taleGroups: is missing (it must be a list)'],
    });
  });

  it('walks into groups, tales, media and document elements', () => {
    const bad = zone() as unknown as { taleGroups: Record<string, unknown>[] };
    bad.taleGroups[0]['name'] = 7;
    bad.taleGroups[0]['tagMatch'] = 'some';
    bad.taleGroups[1]['tales'] = [{ id: 't2', title: 'Snow', media: { kind: 'gif' } }, 'oops', { id: 't3', title: 'x' }];
    const result = validateZone(bad);
    expect(result).toEqual({
      ok: false,
      errors: [
        'taleGroups[0].name: must be text, but is a number',
        'taleGroups[0].tagMatch: must be "any" or "all", but is "some"',
        'taleGroups[1].tales[0].media.kind: must be "image" or "video", but is "gif"',
        'taleGroups[1].tales[0].media.url: is missing (it must be text)',
        'taleGroups[1].tales[1]: must be an object, but is text',
        'taleGroups[1].tales[2]: needs `media` or `document`, or it has nothing to show',
      ],
    });
  });

  it('checks document elements and repeated group ids', () => {
    const bad = zone() as unknown as { taleGroups: { id: string; tales: Record<string, unknown>[] }[] };
    bad.taleGroups[1].id = 'ga';
    bad.taleGroups[0].tales[0]['document'] = { elements: [{ type: 'text' }, 4] };
    const result = validateZone(bad);
    expect(result.ok === false && result.errors).toEqual([
      'taleGroups[0].tales[0].document.elements[0].id: is missing (it must be text)',
      'taleGroups[0].tales[0].document.elements[1]: must be an object, but is a number',
      'taleGroups[1].id: "ga" is used by an earlier group; every group needs its own id',
    ]);
  });

  it('cuts a long list of problems', () => {
    const groups = Array.from({ length: 40 }, () => 1);
    const result = validateZone({ frame: null, taleGroups: groups });
    expect(result.ok === false && result.errors).toHaveLength(26);
    expect(result.ok === false && result.errors[25]).toBe('…and 15 more problems');
  });

  it('never throws and sends nothing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(() => validateZone(undefined)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('readLocalZone', () => {
  it('copies the data, fills the optional group fields and leaves the caller object alone', () => {
    const input = { frame: null, taleGroups: [{ id: 'g', name: 'G', tales: [{ id: 't', title: 'T', media: MEDIA('a') }] }] };
    const read = readLocalZone(input);
    expect(read.taleGroups[0]).toMatchObject({ tags: [], tagMatch: 'any', audience: null });
    expect(input.taleGroups[0]).not.toHaveProperty('tags');
    expect(readLocalZone(JSON.stringify(input)).taleGroups).toHaveLength(1);
  });

  it('throws one Error with every problem for data that is not valid', () => {
    expect(() => readLocalZone({ taleGroups: 3 })).toThrow(/The zone data is not valid\. frame: .*; taleGroups: must be a list/);
  });
});

describe('localResponseClient', () => {
  const withElements = (): DeliveryZone => {
    const z = zone();
    z.taleGroups[0].tales[0].document = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        { id: 'poll', type: 'poll', box: {}, a11y: {}, props: { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } },
        { id: 'rate', type: 'rating', box: {}, a11y: {}, props: {} },
        { id: 'react', type: 'reaction', box: {}, a11y: {}, props: { emojis: ['😀', '🔥'] } },
      ],
    } as never;
    return z;
  };

  beforeEach(() => localStorage.clear());

  it('answers a poll on the device with no request, and the first answer wins', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = localResponseClient(withElements());
    const first = await client.send('t1', 'poll', 'b');
    expect(first).toEqual({
      value: 'b',
      result: { total: 1, choices: [{ id: 'a', count: 0, percent: 0 }, { id: 'b', count: 1, percent: 100 }] },
    });
    expect(await client.send('t1', 'poll', 'a')).toEqual(first);
    expect(storedResponse('t1', 'poll')?.value).toBe('b');
    expect((await client.send('t1', 'rate', '80')).result).toEqual({ total: 1, average: 80 });
    expect((await client.send('t1', 'react', '🔥')).result).toEqual({
      total: 1,
      reactions: [{ emoji: '😀', count: 0 }, { emoji: '🔥', count: 1 }],
    });
    await expect(client.send('t1', 'missing', 'x')).rejects.toThrow('not in the zone data');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('<taleart-view> with zone data', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beaconMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...zone(), taleGroups: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    beaconMock = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconMock, configurable: true, writable: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
    init({ apiUrl: '', tags: [], properties: {}, analytics: true });
  });

  afterEach(() => {
    for (const name of ['home-top', 'other']) setZoneData(name, null);
    resetAnalyticsForTests();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    init({ apiUrl: '', tags: [], properties: {} });
    configureZone('home-top', null);
  });

  const flushAnalytics = () => window.dispatchEvent(new Event('pagehide'));

  it('renders the data of the data property (an object) with no zone key and no API URL', async () => {
    const el = await mount({}, zone());
    expect(names(el)).toEqual(['Summer', 'Winter']);
    expect(el.shadowRoot?.querySelector('.bar')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders JSON text the same, and returns what was set', async () => {
    const text = JSON.stringify(zone());
    const el = await mount({}, text);
    expect(names(el)).toEqual(['Summer', 'Winter']);
    expect(el.data).toBe(text);
  });

  it('renders again when data is set after connecting, and clears with null', async () => {
    const el = await mount({});
    expect(el.shadowRoot?.querySelector('.bar')).toBeNull();
    el.data = zone();
    await settle();
    expect(names(el)).toEqual(['Summer', 'Winter']);
    el.data = null;
    await settle();
    expect(names(el)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('takes a data property set before the SDK defined the element', async () => {
    const upgraded = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
    Object.defineProperty(upgraded, 'data', { value: zone(), configurable: true, writable: true });
    document.body.append(upgraded);
    await settle();
    expect(names(upgraded)).toEqual(['Summer', 'Winter']);
  });

  it('renders the data registered for the zone slug, and re-renders on every later call', async () => {
    const el = await mount({ zone: 'home-top' });
    expect(names(el)).toEqual([]);
    setZoneData('home-top', zone());
    await settle();
    expect(names(el)).toEqual(['Summer', 'Winter']);
    const next = zone();
    next.taleGroups[0].name = 'Autumn';
    setZoneData('home-top', JSON.stringify(next));
    await settle();
    expect(names(el)).toEqual(['Autumn', 'Winter']);
    setZoneData('home-top', null);
    await settle();
    expect(names(el)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders registered data for an element that connects later, and ignores other zones', async () => {
    setZoneData('home-top', zone());
    const other = await mount({ zone: 'other' });
    const home = await mount({ zone: 'home-top' });
    expect(names(home)).toEqual(['Summer', 'Winter']);
    expect(names(other)).toEqual([]);
  });

  it('prefers the element data over the registered data over the network', async () => {
    setZoneData('home-top', zone());
    const own = zone();
    own.taleGroups[0].name = 'Own';
    const el = await mount({ zone: 'home-top', 'api-url': 'https://api.example.com', 'zone-key': 'tak_testkey0001' }, own);
    expect(names(el)).toEqual(['Own', 'Winter']);
    el.data = null;
    await settle();
    expect(names(el)).toEqual(['Summer', 'Winter']);
    setZoneData('home-top', null);
    await settle();
    // Only now, with no data at all, the network is asked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes no network request at all: no read, no analytics, no vote', async () => {
    const el = await mount({ zone: 'home-top' }, zone());
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.item')?.click();
    await vi.dynamicImportSettled();
    expect(el.shadowRoot?.querySelector('dialog.viewer')).not.toBeNull();
    flushAnalytics();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it('still sends analytics for fetched data (the control of the test above)', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(zone()), { status: 200 }));
    const el = await mount({ 'api-url': 'https://api.example.com', 'zone-key': 'tak_testkey0001' });
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.item')?.click();
    await vi.dynamicImportSettled();
    flushAnalytics();
    expect(beaconMock).toHaveBeenCalled();
  });

  it('targets by tags and audience exactly as with fetched data', async () => {
    const data = zone();
    data.taleGroups[0].audience = { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] } as never;
    const el = await mount({}, data);
    // No tags and no properties: tag rules do not hide, an audience rule needs its property.
    expect(names(el)).toEqual(['Winter']);
    setTags(['kids']);
    await settle();
    expect(names(el)).toEqual([]);
    setTags(['vip']);
    setProperties({ plan: 'pro' });
    await settle();
    expect(names(el)).toEqual(['Summer', 'Winter']);
    setTags(null);
    setProperties(null);
  });

  it('keeps the frequency cap and the seen state', async () => {
    const el = await mount({ frequency: 'once' }, zone());
    expect(names(el)).toEqual(['Summer', 'Winter']);
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.item')?.click();
    await vi.dynamicImportSettled();
    el.shadowRoot?.querySelector<HTMLButtonElement>('dialog.viewer .close')?.click();
    await vi.dynamicImportSettled();
    el.remove();
    const again = await mount({ frequency: 'once' }, zone());
    expect(names(again)).toEqual(['Winter']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applies configureZone and the data theme', async () => {
    const data = zone();
    configureZone('home-top', { theme: { accentColor: '#ff0000' } });
    const el = await mount({ zone: 'home-top' }, data);
    expect(el.shadowRoot?.querySelector<HTMLElement>('.taleart')?.style.getPropertyValue('--ta-accent')).toBeTruthy();
  });

  it('emits loaded with an empty zoneKeyPrefix and the slug', async () => {
    const seen: { name: string; zoneKeyPrefix: string; zoneSlug: string }[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener('taleart:loaded', listener);
    await mount({}, zone());
    document.removeEventListener('taleart:loaded', listener);
    expect(seen).toEqual([{ name: 'loaded', zoneKeyPrefix: '', zoneSlug: 'home-top' }]);
  });

  it('fails like a failed load for invalid data: one console error, loadFailed, the fallback, no throw', async () => {
    const seen: { name: string; error?: string; zoneKeyPrefix: string }[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener('taleart:load-failed', listener);
    document.addEventListener('taleart:loaded', listener);
    const el = place({ fallback: 'message' });
    document.body.appendChild(el);
    el.data = { frame: null, taleGroups: 'nope' };
    await settle();
    el.data = '{ not json';
    await settle();
    document.removeEventListener('taleart:load-failed', listener);
    document.removeEventListener('taleart:loaded', listener);
    expect(seen.map((s) => s.name)).toEqual(['loadFailed', 'loadFailed']);
    expect(seen[0].error).toContain('taleGroups: must be a list');
    expect(seen[0].zoneKeyPrefix).toBe('');
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[0][0])).toContain('TaleArt: The zone data is not valid');
    expect(el.getAttribute('data-state')).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    // Valid data afterwards recovers.
    el.data = zone();
    await settle();
    expect(names(el)).toEqual(['Summer', 'Winter']);
    expect(el.hasAttribute('data-state')).toBe(false);
  });

  const imageOf = (el: TaleartElement, index: number) => {
    const img = el.shadowRoot?.querySelectorAll('button.item')[index]?.querySelector('img');
    return img?.getAttribute('src') ?? img?.dataset['hold'] ?? null;
  };

  it('draws page-relative, absolute and data: media URLs of the data', async () => {
    const data = zone();
    data.taleGroups[0].tales[0].media = { kind: 'image', contentType: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' };
    data.taleGroups[1].tales[0].media = { kind: 'image', contentType: 'image/png', url: 'https://cdn.example.com/a.png' };
    const el = await mount({}, data);
    expect(names(el)).toEqual(['Summer', 'Winter']);
    expect(imageOf(el, 0)).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(imageOf(el, 1)).toBe('https://cdn.example.com/a.png');
    const relative = await mount({}, zone());
    expect(imageOf(relative, 0)).toBe(new URL('images/beach.png', document.baseURI).href);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps refusing relative and data: URLs of a zone read from the Delivery API', async () => {
    // Only the exact URLs the page gave in its own data are trusted: this one it never gave.
    const fetched = zone();
    fetched.taleGroups[0].tales[0].media = { kind: 'image', contentType: 'image/png', url: 'images/only-the-server-sent-this.png' };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(fetched), { status: 200 }));
    const el = await mount({ 'api-url': 'https://api.example.com', 'zone-key': 'tak_testkey0001' });
    expect(names(el)).toEqual(['Summer', 'Winter']);
    expect(imageOf(el, 0)).toBeNull();
  });

  it('shows the bar right to left on a page with dir=rtl, as with fetched data', async () => {
    const el = await mount({ dir: 'rtl' }, zone());
    expect(el.shadowRoot?.querySelector('.taleart')?.getAttribute('dir')).toBe('rtl');
  });

  it('keeps the Web SDK global in step: setZoneData and validateZone are on Taleart', async () => {
    await import('../index');
    const handle = (globalThis as unknown as { Taleart: Record<string, unknown> }).Taleart;
    expect(typeof handle['setZoneData']).toBe('function');
    expect(typeof handle['validateZone']).toBe('function');
    expect((handle['validateZone'] as (v: unknown) => unknown)(zone())).toEqual({ ok: true });
    expect(getConfig().apiUrl).toBe('');
  });
});
