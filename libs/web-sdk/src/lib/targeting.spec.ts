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
    audience: null,
    tales: [
      {
        id: `t-${id}`,
        title: id,
        media: { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/${id}.png` },
        document: null as unknown as DeliveryTaleGroup['tales'][0]['document'],
      },
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
  el.setAttribute('zone-key', 'tak_testkey');
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
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
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

  it('renders the response with the tags set while it loaded', async () => {
    let answer: (res: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)));
    const el = await mount();
    expect(shown(el)).toEqual([]);
    setTags(['vip']);
    setTags(['summer']);
    answer(respond(zone));
    await settle();
    expect(shown(el)).toEqual(['A', 'D']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('with the viewer open', () => {
    const viewerDialog = (el: TaleartElement) => el.shadowRoot?.querySelector<HTMLDialogElement>('dialog.viewer');
    const openGroup = async (el: TaleartElement, id: string) => {
      el.shadowRoot?.querySelector<HTMLButtonElement>(`button.item[data-tale-group-id="${id}"]`)?.click();
      await vi.dynamicImportSettled();
    };

    it('keeps it open while its group still matches, and shows the new groups once it closes', async () => {
      const el = await mount();
      await openGroup(el, 'C');
      const dialog = viewerDialog(el);
      expect(dialog?.hasAttribute('open')).toBe(true);
      expect(dialog?.getAttribute('aria-label')).toBe('C');

      setTags(['vip']);
      expect(viewerDialog(el)).toBe(dialog);
      expect(dialog?.hasAttribute('open')).toBe(true);
      // The display behind it waits for the viewer.
      expect(shown(el)).toEqual(['A', 'B', 'C', 'D']);

      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await vi.dynamicImportSettled();
      expect(shown(el)).toEqual(['C', 'D']);
      expect(el.shadowRoot?.activeElement?.getAttribute('data-tale-group-id')).toBe('C');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('closes it when its group no longer matches, and focuses the display', async () => {
      const el = await mount();
      await openGroup(el, 'C');
      expect(viewerDialog(el)?.hasAttribute('open')).toBe(true);

      setTags(['summer']);
      expect(el.shadowRoot?.querySelector('dialog.viewer[open]')).toBeNull();
      expect(shown(el)).toEqual(['A', 'D']);
      expect(el.shadowRoot?.activeElement?.getAttribute('data-tale-group-id')).toBe('A');
    });

    it('shows a group again once the tags match it again, and it opens', async () => {
      const el = await mount();
      await openGroup(el, 'C');
      setTags(['summer']);
      expect(shown(el)).toEqual(['A', 'D']);
      setTags(['vip']);
      expect(shown(el)).toEqual(['C', 'D']);
      await openGroup(el, 'C');
      expect(viewerDialog(el)?.getAttribute('aria-label')).toBe('C');
      expect(viewerDialog(el)?.hasAttribute('open')).toBe(true);
    });

    it('closes it after all when tags change again so that its group no longer matches', async () => {
      const el = await mount();
      await openGroup(el, 'C');
      setTags(['vip']);
      expect(viewerDialog(el)?.hasAttribute('open')).toBe(true);
      setTags(['summer']);
      expect(el.shadowRoot?.querySelector('dialog.viewer[open]')).toBeNull();
      expect(shown(el)).toEqual(['A', 'D']);
    });
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
