import type { DeliveryTaleGroup, DeliveryZone } from '@taleart/contract';
import { defineTaleartElement, setTags, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

const API = 'https://api.example.com';

function group(id: string, tags: string[], tagMatch: 'any' | 'all'): DeliveryTaleGroup {
  return {
    id,
    name: id,
    cover: null,
    tags,
    tagMatch,
    tales: [
      { id: `t-${id}`, title: id, media: null, document: null as unknown as DeliveryTaleGroup['tales'][0]['document'] },
    ],
  };
}

// The sample page matrix of epic targeting story 1: A {summer} Any, B {summer, vip} All, C {vip} Any, D untagged.
const zone: DeliveryZone = {
  id: 'z1',
  name: 'Home',
  slug: 'home',
  frame: { id: 'f1', type: 'bar', settings: {} },
  taleGroups: [
    group('A', ['summer'], 'any'),
    group('B', ['summer', 'vip'], 'all'),
    group('C', ['vip'], 'any'),
    group('D', [], 'any'),
  ],
} as DeliveryZone;

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(): Promise<TaleartElement> {
  const el = document.createElement(TALEART_ELEMENT_TAG) as TaleartElement;
  el.setAttribute('api-url', API);
  el.setAttribute('site-key', 'tas_testkey');
  el.setAttribute('zone', 'home');
  document.body.appendChild(el);
  await settle();
  return el;
}

const shown = (el: TaleartElement) =>
  [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.item') ?? [])].map((b) => b.dataset['taleGroupId']);

describe('setTags (epic targeting R2)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    setTags(null);
    fetchMock = vi.fn(async () => respond(zone));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setTags(null);
  });

  it('shows every group while the page has set no tags', async () => {
    expect(shown(await mount())).toEqual(['A', 'B', 'C', 'D']);
  });

  it('shows only the matching groups and groups without tags', async () => {
    setTags(['summer']);
    expect(shown(await mount())).toEqual(['A', 'D']);
  });

  it('ignores case and surrounding spaces', async () => {
    setTags(['SUMMER ', 'vip']);
    expect(shown(await mount())).toEqual(['A', 'B', 'C', 'D']);
  });

  it('renders again at once when the tags change, without a new request', async () => {
    const el = await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setTags(['vip']);
    expect(shown(el)).toEqual(['C', 'D']);
    setTags(['summer', 'vip']);
    expect(shown(el)).toEqual(['A', 'B', 'C', 'D']);
    setTags([]);
    expect(shown(el)).toEqual(['A', 'B', 'C', 'D']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the display when the matching groups stay the same', async () => {
    setTags(['summer']);
    const el = await mount();
    const bar = el.shadowRoot?.querySelector('.taleart');
    setTags(['Summer', 'winter']);
    expect(el.shadowRoot?.querySelector('.taleart')).toBe(bar);
  });

  it('applies to every element on the page, and to elements placed later', async () => {
    const first = await mount();
    setTags(['vip']);
    const second = await mount();
    expect(shown(first)).toEqual(['C', 'D']);
    expect(shown(second)).toEqual(['C', 'D']);
  });

  it('never sends the tags to TaleArt (AD-13)', async () => {
    setTags(['summer', 'vip']);
    await mount();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/summer|vip/);
    expect(JSON.stringify(init)).not.toMatch(/summer|vip/);
  });

  it('ignores a value that is not an array, with one warning, and keeps the tags', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setTags(['vip']);
    const el = await mount();
    setTags('summer' as unknown as string[]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(shown(el)).toEqual(['C', 'D']);
  });

  it('shows a group from an older API without tag fields', async () => {
    fetchMock.mockImplementation(async () =>
      respond({ ...zone, taleGroups: zone.taleGroups.map(({ tags: _tags, tagMatch: _match, ...rest }) => rest) }),
    );
    setTags(['vip']);
    expect(shown(await mount())).toEqual(['A', 'B', 'C', 'D']);
  });
});
