import type { DeliveryTaleElement, DeliveryZone } from '@taleart/contract';
import { resetAnalyticsForTests } from './analytics';
import { getConfig, init } from './config';
import { TalePreview } from './preview';
import { defineTaleartElement, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

// The element's analytics wiring (analytics.ts): each hook that the SDK emits also queues its event, and
// the queue is sent by beacon when the page is hidden, so a test reads what the element sent.

const API = 'https://api.example.com';
const KEY = 'tak_wiringkey0001';
const BUTTON_ID = '00000000-0000-4000-8000-0000000000bb';

const doc = (elements: DeliveryTaleElement[] = []) => ({
  version: 1,
  canvas: { background: { type: 'color' as const, color: '#112233' } },
  elements,
});
const button = (): DeliveryTaleElement =>
  ({
    id: BUTTON_ID,
    type: 'button',
    box: { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
    a11y: {},
    props: { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', href: 'https://example.com/shop', newTab: true },
  }) as unknown as DeliveryTaleElement;

// Two groups: Summer (tales `t1` with the button, and `t1b`) and Winter (`t2`).
function zoneWith(elements: DeliveryTaleElement[] = []): DeliveryZone {
  return {
    id: 'z1',
    name: 'Home',
    slug: 'home',
    frame: { id: 'f1', type: 'bar', settings: {} },
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

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

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

interface Sent {
  type: string;
  groupId: string;
  taleId?: string;
  at: string;
}

describe('analytics on the element (Web SDK)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/delivery/v1/events') ? respond(202, { accepted: 1, dropped: 0 }) : respond(200, zoneWith([button()])),
    );
    beacon = vi.fn(() => true);
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    resetAnalyticsForTests();
    init({ analytics: null, externalUserId: null, tags: null, hooks: null });
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (navigator as unknown as { sendBeacon?: unknown }).sendBeacon;
  });

  // Hides the page, as the browser does when it leaves: returns every event the SDK sent, in order.
  function hideAndCollect(): Sent[] {
    window.dispatchEvent(new Event('pagehide'));
    const fromBeacon = beacon.mock.calls.flatMap((call) => (JSON.parse(call[1] as string) as { events: Sent[] }).events);
    const fromFetch = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/delivery/v1/events'))
      .flatMap(([, init]) => (JSON.parse((init as RequestInit).body as string) as { events: Sent[] }).events);
    return [...fromBeacon, ...fromFetch];
  }

  const event = (type: string, groupId: string, taleId?: string) => ({
    type,
    groupId,
    ...(taleId === undefined ? {} : { taleId }),
    at: expect.any(String),
  });

  it('reports an impression when a group is half on screen, with its group and no tale', async () => {
    const instances: { callback: (entries: Partial<IntersectionObserverEntry>[]) => void }[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          instances.push(this);
        }
        // The test calls the callback itself; nothing is observed.
        observe() {
          // Nothing to observe in the test.
        }
        unobserve() {
          // Nothing to stop in the test.
        }
        disconnect() {
          // Nothing to stop in the test.
        }
      },
    );
    const el = await mount();
    instances.at(-1)?.callback([{ isIntersecting: true, target: items(el)[0] }]);
    expect(hideAndCollect()).toEqual([event('impression', 'ga')]);
  });

  it('reports an open, then a view of the tale shown, when the viewer opens a group', async () => {
    const el = await mount();
    items(el)[0].click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toEqual([event('open', 'ga'), event('view', 'ga', 't1')]);
  });

  it('reports a view of each tale the viewer steps to', async () => {
    const el = await mount();
    items(el)[0].click();
    await vi.dynamicImportSettled();
    el.shadowRoot?.querySelector<HTMLDialogElement>('dialog.viewer')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toEqual([event('open', 'ga'), event('view', 'ga', 't1'), event('view', 'ga', 't1b')]);
  });

  it('reports a click whether or not the host cancels the navigation', async () => {
    const el = await mount();
    items(el)[0].click();
    await vi.dynamicImportSettled();
    const link = el.shadowRoot?.querySelector<HTMLAnchorElement>('dialog.viewer a.ta-button');
    if (!link) throw new Error('the button link is not rendered');
    init({ hooks: { onActionClicked: (e) => e.preventDefault() } });
    link.click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toContainEqual(event('click', 'ga', 't1'));
  });

  it('reports a click the host does not cancel', async () => {
    const el = await mount();
    items(el)[0].click();
    await vi.dynamicImportSettled();
    const link = el.shadowRoot?.querySelector<HTMLAnchorElement>('dialog.viewer a.ta-button');
    if (!link) throw new Error('the button link is not rendered');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toContainEqual(event('click', 'ga', 't1'));
  });

  it('reports nothing with analytics="off" on the element, whatever the SDK option', async () => {
    init({ analytics: true });
    const el = await mount({ 'api-url': API, 'zone-key': KEY, analytics: 'off' });
    items(el)[0].click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toEqual([]);
    expect(beacon).not.toHaveBeenCalled();
  });

  it('reports nothing with init({ analytics: false }), and an element attribute of on wins over it', async () => {
    init({ analytics: false });
    const off = await mount();
    items(off)[0].click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toEqual([]);
    off.remove();
    const on = await mount({ 'api-url': API, 'zone-key': KEY, analytics: 'on' });
    items(on)[0].click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toEqual([event('open', 'ga'), event('view', 'ga', 't1')]);
  });

  it('takes an analytics attribute of any value but off as on', async () => {
    init({ analytics: false });
    const el = await mount({ 'api-url': API, 'zone-key': KEY, analytics: 'yes' });
    items(el)[0].click();
    await vi.dynamicImportSettled();
    expect(hideAndCollect()).toHaveLength(2);
  });

  it('reads and sets the analytics property as the attribute', async () => {
    const el = await mount();
    expect(el.analytics).toBeNull();
    el.analytics = false;
    expect(el.getAttribute('analytics')).toBe('off');
    expect(el.analytics).toBe(false);
    el.analytics = true;
    expect(el.getAttribute('analytics')).toBe('on');
    el.analytics = null;
    expect(el.hasAttribute('analytics')).toBe(false);
  });

  it('does not read the zone again when only the analytics attribute changes', async () => {
    const el = await mount();
    const zoneReads = fetchMock.mock.calls.length;
    el.setAttribute('analytics', 'off');
    await settle();
    expect(fetchMock.mock.calls.length).toBe(zoneReads);
  });

  it('reports nothing when the zone request failed: no zone, no event', async () => {
    fetchMock.mockImplementation(async () => respond(404, { error: { code: 'zone_not_found', message: 'No such zone' } }));
    const el = await mount();
    expect(items(el)).toHaveLength(0);
    expect(hideAndCollect()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('sends no external user ID and no tags with its events', async () => {
    init({ externalUserId: 'user-secret-42', tags: ['vip-tag'] });
    const el = await mount();
    items(el)[0].click();
    await vi.dynamicImportSettled();
    const sent = hideAndCollect();
    expect(sent).toHaveLength(2);
    const text = JSON.stringify(sent) + beacon.mock.calls.map((call) => call[1]).join('');
    expect(text).not.toContain('user-secret-42');
    expect(text).not.toContain('vip-tag');
  });

  it('reports nothing from the studio preview, which is the SDK viewer and not an element', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const preview = new TalePreview(host);
    try {
      preview.show({ id: 't1', title: 'Sale', groupName: 'Summer', document: doc([button()]) as never });
      expect(hideAndCollect()).toEqual([]);
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      preview.destroy();
    }
  });

  it('applies init({ analytics }): a boolean sets it, null restores on, anything else is ignored with a warning', () => {
    init({ analytics: false });
    expect(getConfig().analytics).toBe(false);
    init({ analytics: 'yes' as never });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(getConfig().analytics).toBe(false);
    init({});
    expect(getConfig().analytics).toBe(false);
    init({ analytics: null });
    expect(getConfig().analytics).toBe(true);
    expect(getConfig().analytics).toBe(true);
  });
});
