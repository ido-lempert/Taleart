import { MAX_ANALYTICS_EVENTS_PER_REQUEST } from '@taleart/contract';
import {
  ANALYTICS_FLUSH_AT,
  ANALYTICS_FLUSH_MS,
  recordAnalyticsEvent,
  resetAnalyticsForTests,
  type AnalyticsTarget,
} from './analytics';
import { VISITOR_STORAGE_KEY, resetVisitorIdForTests, visitorId } from './visitor';

const TARGET: AnalyticsTarget = { apiUrl: 'https://api.example.com', key: 'tak_testkey0001' };
const OTHER: AnalyticsTarget = { apiUrl: 'https://other.example.com', key: 'tak_otherkey0001' };
const GROUP = '00000000-0000-4000-8000-0000000000a1';
const TALE = '00000000-0000-4000-8000-0000000000b1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Body {
  events: Record<string, unknown>[];
  key?: string;
  visitor?: string;
}

// The JSON body of a fetch call, parsed.
function fetchBody(call: unknown[]): Body {
  return JSON.parse((call[1] as RequestInit).body as string) as Body;
}

// Every event a fetch call or a beacon carried, in order.
function sentEvents(fetchMock: ReturnType<typeof vi.fn>, beacon: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  const fromFetch = fetchMock.mock.calls.flatMap((call) => fetchBody(call as unknown[]).events);
  const fromBeacon = beacon.mock.calls.flatMap((call) => (JSON.parse(call[1] as string) as Body).events);
  return [...fromFetch, ...fromBeacon];
}

describe('analytics queue (Web SDK)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let beacon: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The visitor id is made (and stored) before the fake clock starts: jsdom's storage writes schedule a
    // timer of their own, which would otherwise count as a queue timer.
    localStorage.clear();
    resetVisitorIdForTests();
    visitorId();
    vi.useFakeTimers({ now: new Date('2026-10-29T10:00:00.000Z') });
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: 1, dropped: 0 }), { status: 202 }));
    beacon = vi.fn(() => true);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetAnalyticsForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('sends the queue 5 seconds after its first event, by fetch with the bearer and visitor headers', async () => {
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/delivery/v1/events');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(false);
    expect(init.credentials).toBe('omit');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tak_testkey0001');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-TaleArt-Visitor']).toMatch(UUID_V4);
    expect(fetchBody(fetchMock.mock.calls[0] as unknown[])).toEqual({
      events: [{ type: 'impression', groupId: GROUP, at: '2026-10-29T10:00:00.000Z' }],
    });
  });

  it('has no timer while idle: the timer ends with the send and starts again with the next event', async () => {
    expect(vi.getTimerCount()).toBe(0);
    recordAnalyticsEvent(TARGET, { type: 'open', groupId: GROUP });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    recordAnalyticsEvent(TARGET, { type: 'open', groupId: GROUP });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends at once when the queue reaches 20 events, with no wait for the timer', async () => {
    for (let i = 0; i < ANALYTICS_FLUSH_AT - 1; i++) recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    expect(fetchMock).not.toHaveBeenCalled();
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchBody(fetchMock.mock.calls[0] as unknown[]).events).toHaveLength(ANALYTICS_FLUSH_AT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('names a tale for a view or a click only, and stamps each event with its UTC time', async () => {
    vi.setSystemTime(new Date('2026-10-29T12:34:56.789Z'));
    recordAnalyticsEvent(TARGET, { type: 'view', groupId: GROUP, taleId: TALE });
    recordAnalyticsEvent(TARGET, { type: 'click', groupId: GROUP, taleId: TALE });
    recordAnalyticsEvent(TARGET, { type: 'open', groupId: GROUP });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    const events = fetchBody(fetchMock.mock.calls[0] as unknown[]).events;
    expect(events).toEqual([
      { type: 'view', groupId: GROUP, taleId: TALE, at: '2026-10-29T12:34:56.789Z' },
      { type: 'click', groupId: GROUP, taleId: TALE, at: '2026-10-29T12:34:56.789Z' },
      { type: 'open', groupId: GROUP, at: '2026-10-29T12:34:56.789Z' },
    ]);
    expect(Object.keys(events[2]).sort()).toEqual(['at', 'groupId', 'type']);
  });

  it('sends exactly the type, group, tale and time of an event: no other field, whatever the caller passes', async () => {
    const leaky = { type: 'click', groupId: GROUP, taleId: TALE, externalUserId: 'user-secret-42', tags: ['vip-tag'] };
    recordAnalyticsEvent(TARGET, leaky as unknown as Parameters<typeof recordAnalyticsEvent>[1]);
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).not.toContain('user-secret-42');
    expect(init.body).not.toContain('vip-tag');
    const body = fetchBody(fetchMock.mock.calls[0] as unknown[]);
    expect(Object.keys(body)).toEqual(['events']);
    expect(Object.keys(body.events[0]).sort()).toEqual(['at', 'groupId', 'taleId', 'type']);
  });

  it('sends the queue on pagehide by beacon, as a text body with the key and the visitor id', async () => {
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    recordAnalyticsEvent(TARGET, { type: 'open', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as [string, unknown];
    expect(url).toBe('https://api.example.com/delivery/v1/events');
    expect(typeof body).toBe('string');
    const parsed = JSON.parse(body as string) as Body;
    expect(parsed.key).toBe('tak_testkey0001');
    expect(parsed.visitor).toBe(localStorage.getItem(VISITOR_STORAGE_KEY));
    expect(parsed.events.map((e) => e['type'])).toEqual(['impression', 'open']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends by beacon when the page becomes hidden, and not when it becomes visible', () => {
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('sends each zone its own queue, with its own key, on the same hide', () => {
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    recordAnalyticsEvent(OTHER, { type: 'impression', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon.mock.calls.map(([url, body]) => [url, (JSON.parse(body as string) as Body).key])).toEqual([
      ['https://api.example.com/delivery/v1/events', 'tak_testkey0001'],
      ['https://other.example.com/delivery/v1/events', 'tak_otherkey0001'],
    ]);
  });

  it('falls back to fetch with keepalive when sendBeacon is missing', () => {
    vi.stubGlobal('navigator', {});
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/delivery/v1/events');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tak_testkey0001');
    expect(fetchBody(fetchMock.mock.calls[0] as unknown[]).events).toHaveLength(1);
  });

  it('falls back to fetch with keepalive when the browser refuses the beacon', () => {
    beacon.mockReturnValue(false);
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].keepalive).toBe(true);
  });

  it('falls back to fetch when the beacon throws', () => {
    beacon.mockImplementation(() => {
      throw new Error('blocked');
    });
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on a hide when the queue is empty', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries a failed send once, on the next flush, then drops the events, silently', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * ANALYTICS_FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('counts an error answer as a failed send, and retries it the same way', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sends no event more than twice when every send fails, so the queue stays bounded', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    for (let i = 0; i < 1000; i++) recordAnalyticsEvent(TARGET, { type: 'impression', groupId: `g${i}` });
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS * 4);
    const groups = sentEvents(fetchMock, beacon).map((e) => e['groupId'] as string);
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(counts.size).toBe(1000);
    for (const call of fetchMock.mock.calls) {
      expect(fetchBody(call as unknown[]).events.length).toBeLessThanOrEqual(MAX_ANALYTICS_EVENTS_PER_REQUEST);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives a beacon no retry: its failed fallback is dropped', () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    beacon.mockReturnValue(false);
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgets its queues and timers on reset', async () => {
    recordAnalyticsEvent(TARGET, { type: 'impression', groupId: GROUP });
    resetAnalyticsForTests();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(ANALYTICS_FLUSH_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
