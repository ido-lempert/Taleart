import type { DeliveryZone } from '@taleart/contract';
import { fetchZone } from './delivery-client';
import { randomVisitorId, resetVisitorIdForTests, VISITOR_STORAGE_KEY, visitorId } from './visitor';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('visitor id (story 8.23)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVisitorIdForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetVisitorIdForTests();
  });

  it('makes a UUID v4 once and keeps it in local storage under a taleart. key', () => {
    const id = visitorId();
    expect(id).toMatch(UUID_V4);
    expect(VISITOR_STORAGE_KEY).toMatch(/^taleart\./);
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBe(id);
    expect(visitorId()).toBe(id);
    // A reload (a new page load) reads the same id back.
    resetVisitorIdForTests();
    expect(visitorId()).toBe(id);
  });

  it('replaces a stored value that is not a UUID v4', () => {
    localStorage.setItem(VISITOR_STORAGE_KEY, 'tampered');
    const id = visitorId();
    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem(VISITOR_STORAGE_KEY)).toBe(id);
  });

  it('falls back to getRandomValues without crypto.randomUUID', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a) });
    const ids = new Set(Array.from({ length: 50 }, () => randomVisitorId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('keeps one id per page load when local storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const id = visitorId();
    expect(id).toMatch(UUID_V4);
    expect(visitorId()).toBe(id);
  });

  it('keeps one id per page load when local storage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    const id = visitorId();
    expect(id).toMatch(UUID_V4);
    expect(visitorId()).toBe(id);
  });

  it('is sent on every Delivery API request', async () => {
    const zone: DeliveryZone = {
      id: 'z',
      name: 'Z',
      slug: 'z',
      frame: { id: 'f', type: 'bar', settings: {} },
      taleGroups: [],
    } as unknown as DeliveryZone;
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify(zone), { status: 200 }),
    );
    for (const slug of ['a', 'b']) {
      await fetchZone('https://api.example.com', { key: 'tak_k', zone: slug }, fetchMock as unknown as typeof fetch);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>)['X-TaleArt-Visitor']).toBe(visitorId());
    }
  });
});
