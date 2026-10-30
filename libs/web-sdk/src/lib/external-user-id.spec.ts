import { EXTERNAL_USER_ID_HEADER, type DeliveryTaleGroup, type DeliveryZone } from '@taleart/contract';
import { defineTaleartElement, setExternalUserId, setTags, TALEART_ELEMENT_TAG, TaleartElement } from './taleart-element';

const API = 'https://api.example.com';

function group(id: string, tags: string[] = []): DeliveryTaleGroup {
  return {
    id,
    name: id,
    cover: null,
    tags,
    tagMatch: 'any',
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

// The Delivery API as the server answers (epic targeting R4): group L is targeted to a list that
// holds `cust-1` and `m\u00FCller-7`; it is left out for anyone else. O has no audience.
function zoneFor(header: string | null): DeliveryZone {
  const listed = header === b64('cust-1') || header === b64('m\u00FCller-7');
  return {
    id: 'z1',
    name: 'Home',
    slug: 'home',
    frame: { id: 'f1', type: 'bar', settings: {} },
    taleGroups: [...(listed ? [{ ...group('L', ['vip']), userListMatched: true }] : []), group('O')],
  } as DeliveryZone;
}

const b64 = (id: string) => Buffer.from(id, 'utf8').toString('base64url');

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

describe('setExternalUserId (epic targeting R4, R5)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.spyOn>;
  const headerOf = (call: number) =>
    ((fetchMock.mock.calls[call] as [string, RequestInit])[1].headers as Record<string, string>)[EXTERNAL_USER_ID_HEADER] ?? null;

  beforeAll(() => defineTaleartElement());

  beforeEach(() => {
    setExternalUserId(null);
    setTags(null);
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const header = (init.headers as Record<string, string>)[EXTERNAL_USER_ID_HEADER] ?? null;
      return new Response(JSON.stringify(zoneFor(header)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setExternalUserId(null);
    setTags(null);
  });

  it('sends no ID header until the page sets one, and the server leaves list groups out', async () => {
    const el = await mount();
    expect(shown(el)).toEqual(['O']);
    expect(headerOf(0)).toBeNull();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].cache).toBeUndefined();
  });

  it('sends the ID base64url-encoded in its header, never in the URL, and asks the browser to keep no copy', async () => {
    setExternalUserId('  cust-1 ');
    const el = await mount();
    expect(shown(el)).toEqual(['L', 'O']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerOf(0)).toBe(b64('cust-1'));
    expect(init.cache).toBe('no-store');
    expect(init.credentials).toBe('omit');
    expect(url).not.toContain('cust');
    expect(url).not.toContain(b64('cust-1'));
    expect(url).toBe(`${API}/delivery/v1/zone`);
  });

  it('carries an ID outside ASCII as its UTF-8 bytes', async () => {
    setExternalUserId('m\u00FCller-7');
    expect(shown(await mount())).toEqual(['L', 'O']);
    expect(headerOf(0)).toBe(b64('m\u00FCller-7'));
  });

  it('reads every element again when the ID changes, and not when it is set to the same one', async () => {
    const first = await mount();
    const second = await mount();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    setExternalUserId('cust-1');
    await settle();
    // Both elements read the zone again, in one shared request for the new viewer.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(shown(first)).toEqual(['L', 'O']);
    expect(shown(second)).toEqual(['L', 'O']);
    setExternalUserId(' cust-1');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    setExternalUserId('cust-2');
    await settle();
    expect(shown(first)).toEqual(['O']);
    setExternalUserId(null);
    await settle();
    expect(headerOf(fetchMock.mock.calls.length - 1)).toBeNull();
    expect(shown(second)).toEqual(['O']);
  });

  it('drops a previous ID when given one no list can hold, with one warning', async () => {
    setExternalUserId('cust-1');
    const el = await mount();
    expect(shown(el)).toEqual(['L', 'O']);
    for (const bad of ['', '  ', 'a\nb', 'x'.repeat(257), 42 as unknown as string]) {
      setExternalUserId('cust-1');
      await settle();
      warn.mockClear();
      setExternalUserId(bad);
      await settle();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain('cust-1');
      expect(headerOf(fetchMock.mock.calls.length - 1)).toBeNull();
      expect(shown(el)).toEqual(['O']);
    }
  });

  it('keeps the ID in memory only: nothing in storage, a cookie or the visitor id', async () => {
    setExternalUserId('cust-1');
    await mount();
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join('\n');
    expect(stored).not.toContain('cust-1');
    expect(stored).not.toContain(b64('cust-1'));
    expect(document.cookie).not.toContain('cust-1');
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers['X-TaleArt-Visitor']).not.toContain(b64('cust-1'));
  });

  it('combines with the tag rule in the browser: a listed group still needs its tags to pass', async () => {
    setExternalUserId('cust-1');
    setTags(['summer']);
    const el = await mount();
    expect(shown(el)).toEqual(['O']);
    setTags(['vip']);
    expect(shown(el)).toEqual(['L', 'O']);
  });
});
