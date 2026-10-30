import type { DeliveryZone } from '@taleart/contract';
import { resetAnalyticsForTests } from './analytics';
import { init } from './config';
import { defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

// The bar layouts in the element: the loading skeleton (its layout from the `layout` attribute, else the last
// zone shown), the stack's clicks and impressions, and what a failed or empty zone leaves on the page.

const API = 'https://api.example.com';
// Each mount reads a zone key of its own: elements that read the same key at once share one request.
let keys = 0;
const nextKey = () => `tak_layouts${++keys}`;

const tale = (id: string) => ({
  id,
  title: id,
  media: { kind: 'image' as const, contentType: 'image/png' as const, url: `${API}/media/tales/${id}.png` },
});
const zoneWith = (layout: string): DeliveryZone => ({
  id: 'z1',
  name: 'Home',
  slug: 'home',
  frame: { id: 'f1', type: 'bar', settings: { layout } },
  taleGroups: [
    { id: 'ga', name: 'Summer', cover: null, tales: [tale('a')] },
    { id: 'gb', name: 'Winter', cover: null, tales: [tale('b')] },
    { id: 'gc', name: 'Trips', cover: null, tales: [tale('c')] },
    { id: 'gd', name: 'Food', cover: null, tales: [tale('d')] },
    { id: 'ge', name: 'Music', cover: null, tales: [tale('e')] },
  ],
});

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(attrs: Record<string, string> = { 'api-url': API, 'zone-key': nextKey() }): Promise<TaleartElement> {
  const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  await settle();
  return el;
}

const skeleton = (el: TaleartElement) => el.shadowRoot?.querySelector<HTMLElement>('ul.skeleton') ?? null;

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
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
    // Nothing to release in the fake.
  }
}

describe('TaleartElement: the bar layouts while a zone loads and in the page', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // A response the test settles itself: the zone is still loading until then.
  let release: ((response: Response) => void) | null = null;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    release = null;
    fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    resetAnalyticsForTests();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    init({ hooks: null });
  });

  it('shows the ring skeleton while the zone loads, busy and with no content', async () => {
    const el = await mount();
    const shown = skeleton(el);
    expect(shown?.getAttribute('aria-busy')).toBe('true');
    expect(shown?.dataset['layout']).toBe('ring');
    expect(el.shadowRoot?.querySelector('.bar')).toBe(shown);
    expect(el.shadowRoot?.querySelector('button')).toBeNull();
  });

  it('draws the skeleton in the layout the layout attribute names', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey(), layout: 'poster' });
    expect(skeleton(el)?.dataset['layout']).toBe('poster');
    expect(skeleton(el)?.querySelectorAll('.sk-card')).toHaveLength(4);
  });

  it('takes an unknown layout attribute as the ring', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey(), layout: 'tile' });
    expect(skeleton(el)?.dataset['layout']).toBe('ring');
  });

  it('gives way to the zone display when the zone arrives, and draws its layout', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey() });
    release?.(respond(200, zoneWith('chip')));
    await settle();
    expect(skeleton(el)).toBeNull();
    expect(el.shadowRoot?.querySelector('.bar')?.getAttribute('data-layout')).toBe('chip');
    expect(el.shadowRoot?.querySelectorAll('button.item.chip')).toHaveLength(5);
  });

  it('keeps the layout of the zone last shown for the skeleton of a reload', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey() });
    release?.(respond(200, zoneWith('poster')));
    await settle();
    el.reload();
    await settle();
    expect(skeleton(el)?.dataset['layout']).toBe('poster');
  });

  it('takes the skeleton off when the zone fails, and shows the failure', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey(), fallback: 'message' });
    release?.(respond(401, { error: { code: 'invalid_zone_key', message: 'no' } }));
    await settle();
    expect(skeleton(el)).toBeNull();
    expect(el.shadowRoot?.querySelector('.failed')).not.toBeNull();
    expect(el.getAttribute('data-state')).toBe('failed');
  });

  it('takes the skeleton off for a zone with no display', async () => {
    const el = await mount({ 'api-url': API, 'zone-key': nextKey() });
    release?.(respond(200, { ...zoneWith('ring'), frame: null }));
    await settle();
    expect(skeleton(el)).toBeNull();
    expect(el.shadowRoot?.querySelector('.bar')).toBeNull();
  });
});

describe('TaleartElement: the stack', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    fetchMock = vi.fn(async () => respond(200, zoneWith('stack')));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    resetAnalyticsForTests();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    init({ hooks: null });
  });

  it('counts an impression for each group the stack draws, once it is half on screen', async () => {
    const events: { name: string; group?: { id: string } }[] = [];
    init({ hooks: { onEvent: (e) => events.push(e) } });
    const el = await mount();
    const observer = FakeObserver.instances.at(-1) as FakeObserver;
    const [button] = [...(el.shadowRoot?.querySelectorAll<HTMLElement>('button.item') ?? [])];
    expect(observer.observed).toEqual([button]);
    observer.callback([{ isIntersecting: true, target: button }]);
    const impressions = events.filter((e) => e.name === 'groupImpression').map((e) => e.group?.id);
    expect(impressions).toEqual(['ga', 'gb', 'gc', 'gd', 'ge']);
    // Once per group: a second look counts nothing again.
    observer.callback([{ isIntersecting: true, target: button }]);
    expect(events.filter((e) => e.name === 'groupImpression')).toHaveLength(5);
  });

  it('opens the first unseen group from its one button, named by the count of new groups', async () => {
    const el = await mount();
    const button = el.shadowRoot?.querySelector<HTMLButtonElement>('button.item.stack');
    expect(button?.getAttribute('aria-label')).toBe('5 new stories');
    button?.click();
    await vi.dynamicImportSettled();
    const dialog = el.shadowRoot?.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('aria-label')).toBe('Summer');
  });
});
