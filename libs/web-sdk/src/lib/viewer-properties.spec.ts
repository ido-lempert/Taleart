import type { AudienceRule, DeliveryTaleGroup, DeliveryZone } from '@taleart/contract';
import { resetAnalyticsForTests } from './analytics';
import { getConfig, init } from './config';
import {
  defineTaleartElement,
  setProperties,
  setProperty,
  setTags,
  TALEART_ELEMENT_TAG,
  TaleartElement,
} from './taleart-element';

const API = 'https://api.example.com';

// Audience rules as the dashboard saves them: A is for pro plans, C for viewers 30 or over, or in the beta segment.
const PRO: AudienceRule = { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] };
const SENIOR_OR_BETA: AudienceRule = {
  match: 'any',
  conditions: [
    { property: 'age', operator: 'gte', value: 30 },
    { property: 'segment', operator: 'in', value: ['beta'] },
  ],
};

function group(id: string, audience: AudienceRule | null = null): DeliveryTaleGroup {
  return {
    id,
    name: id,
    cover: null,
    tags: [],
    tagMatch: 'any',
    audience,
    tales: [
      {
        id: `t-${id}`,
        title: id,
        media: { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/${id}.png` },
        document: null as unknown as DeliveryTaleGroup['tales'][0]['document'],
      },
    ],
  } as DeliveryTaleGroup;
}

// The same three groups for both display types: A (pro plans), B (everyone), C (30 or over, or beta).
const groups = [group('A', PRO), group('B'), group('C', SENIOR_OR_BETA)];
const zoneWith = (type: 'bar' | 'banner'): DeliveryZone =>
  ({ id: 'z1', name: 'Home', slug: 'home', frame: { id: 'f1', type, settings: {} }, taleGroups: groups }) as DeliveryZone;

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(): Promise<TaleartElement> {
  const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
  el.setAttribute('api-url', API);
  el.setAttribute('zone-key', 'tak_testkey');
  el.setAttribute('zone', 'home');
  document.body.appendChild(el);
  await settle();
  return el;
}

// The groups a viewer sees, read from the rendered display: a bar's items, or a banner's slides.
const shown = (el: TaleartElement) => {
  const root = el.shadowRoot;
  const items = root?.querySelectorAll<HTMLElement>('button.item, .b-open') ?? [];
  return [...items].map((item) => item.dataset['taleGroupId']);
};
const dots = (el: TaleartElement) => el.shadowRoot?.querySelectorAll('.b-dot').length ?? 0;

describe('viewer properties (Web SDK)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;
  let zone: DeliveryZone;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    init({ properties: null });
    setTags(null);
    zone = zoneWith('bar');
    fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/delivery/v1/events') ? respond({ accepted: 1, dropped: 0 }) : respond(zone),
    );
    beacon = vi.fn(() => true);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    resetAnalyticsForTests();
    init({ properties: null });
    setTags(null);
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
  });

  describe('the bar', () => {
    it('shows every group while no properties are set', async () => {
      expect(shown(await mount())).toEqual(['A', 'B', 'C']);
    });

    it('hides a group for one viewer and shows it for another', async () => {
      setProperties({ plan: 'free', age: 40 });
      expect(shown(await mount())).toEqual(['B', 'C']);
    });

    it('shows the same group to a viewer who passes its rule', async () => {
      setProperties({ plan: 'pro', age: 20 });
      expect(shown(await mount())).toEqual(['A', 'B']);
    });

    it('re-renders at once when the properties change, without a new request', async () => {
      const el = await mount();
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/zone'))).toHaveLength(1);
      setProperties({ plan: 'pro', age: 20 });
      expect(shown(el)).toEqual(['A', 'B']);
      setProperties({ plan: 'free', age: 40 });
      expect(shown(el)).toEqual(['B', 'C']);
      setProperties(null);
      expect(shown(el)).toEqual(['A', 'B', 'C']);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/zone'))).toHaveLength(1);
    });
  });

  describe('the banner', () => {
    beforeEach(() => {
      zone = zoneWith('banner');
    });

    it('shows every slide while no properties are set, with a dot for each', async () => {
      const el = await mount();
      expect(shown(el)).toEqual(['A', 'B', 'C']);
      expect(dots(el)).toBe(3);
    });

    it('hides a slide for one viewer and shows it for another', async () => {
      setProperties({ plan: 'free', age: 40 });
      const free = await mount();
      expect(shown(free)).toEqual(['B', 'C']);
      expect(dots(free)).toBe(2);
      document.body.replaceChildren();

      setProperties({ plan: 'pro', age: 20 });
      const pro = await mount();
      expect(shown(pro)).toEqual(['A', 'B']);
    });

    it('updates its slides and dots when the properties change after render', async () => {
      const el = await mount();
      expect(shown(el)).toEqual(['A', 'B', 'C']);
      expect(dots(el)).toBe(3);

      setProperties({ plan: 'pro', age: 20 });
      expect(shown(el)).toEqual(['A', 'B']);
      expect(dots(el)).toBe(2);

      setProperty('age', 40);
      expect(shown(el)).toEqual(['A', 'B', 'C']);
      expect(dots(el)).toBe(3);

      setProperty('plan', 'free');
      expect(shown(el)).toEqual(['B', 'C']);
      expect(dots(el)).toBe(2);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/zone'))).toHaveLength(1);
    });
  });

  describe('setProperty', () => {
    it('sets one property and keeps the others', async () => {
      const el = await mount();
      setProperty('plan', 'pro');
      expect(getConfig().properties).toEqual({ plan: 'pro' });
      expect(shown(el)).toEqual(['A', 'B']);
      setProperty('age', 20);
      expect(getConfig().properties).toEqual({ plan: 'pro', age: 20 });
      expect(shown(el)).toEqual(['A', 'B']);
    });

    it('removes a property with null, so a rule that needs it fails', async () => {
      const el = await mount();
      setProperties({ plan: 'pro', age: 40 });
      expect(shown(el)).toEqual(['A', 'B', 'C']);
      setProperty('plan', null);
      expect(getConfig().properties).toEqual({ age: 40 });
      expect(shown(el)).toEqual(['B', 'C']);
    });

    it('leaves a page with no properties as it is when the value is null', async () => {
      const el = await mount();
      setProperty('plan', null);
      expect(getConfig().properties).toBeNull();
      expect(shown(el)).toEqual(['A', 'B', 'C']);
    });

    it('ignores a name that is not valid, with one warning, and keeps the properties', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setProperty('1plan', 'pro');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(getConfig().properties).toBeNull();
      setProperties({ plan: 'pro' });
      setProperty('bad name', 'x');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(getConfig().properties).toEqual({ plan: 'pro' });
    });
  });

  describe('normalising the values', () => {
    it('drops the invalid entries with one warning, and keeps the valid ones', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setProperties({ plan: 'pro', '1bad': true, age: Number.NaN, segment: ['beta', 3] } as never);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(getConfig().properties).toEqual({ plan: 'pro' });
    });

    it('keeps the first 50 valid properties', () => {
      const many: Record<string, number> = {};
      for (let i = 0; i < 60; i += 1) many[`p${i}`] = i;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setProperties(many);
      expect(Object.keys(getConfig().properties ?? {})).toHaveLength(50);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('keeps a copy: changing the object after the call changes nothing', () => {
      const source: Record<string, string> = { plan: 'pro' };
      setProperties(source);
      source['plan'] = 'free';
      expect(getConfig().properties).toEqual({ plan: 'pro' });
    });

    it('refuses a value that is not an object, with one warning, and keeps the properties', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setProperties({ plan: 'pro' });
      init({ properties: ['pro'] as never });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(getConfig().properties).toEqual({ plan: 'pro' });
    });
  });

  it('never sends a property value: not in a request, a header, a URL or an analytics event', async () => {
    const secrets = ['Secret-Plan-Zeta-4242', 'secret-segment-omega', '987654'];
    setProperties({ plan: secrets[0], segment: [secrets[1]], age: 987654 });
    const el = await mount();
    // Open a group and close it, then hide the page: the analytics events go out by beacon.
    el.shadowRoot?.querySelector<HTMLButtonElement>('button.item')?.click();
    await vi.dynamicImportSettled();
    window.dispatchEvent(new Event('pagehide'));
    await vi.dynamicImportSettled();

    const sent = [
      ...fetchMock.mock.calls.map(([url, init]) => [String(url), JSON.stringify(init ?? {})].join('\n')),
      ...beacon.mock.calls.map((call) => JSON.stringify(call)),
    ].join('\n');
    // The open reached the Delivery API, so the check below is not vacuous.
    expect(beacon).toHaveBeenCalled();
    expect(String(beacon.mock.calls[0]?.[1])).toContain('"open"');
    for (const secret of secrets) expect(sent).not.toContain(secret);
  });
});
