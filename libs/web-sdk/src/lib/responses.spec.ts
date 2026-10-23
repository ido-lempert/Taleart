import { DeliveryError } from './delivery-client';
import { keepResponse, MAX_STORED_RESPONSES, RESPONSES_STORAGE_KEY, responseClient, storedResponse } from './responses';
import { resetVisitorIdForTests, VISITOR_STORAGE_KEY } from './visitor';

// Epic interactive components story 4.1: the Web SDK posts a vote with the site key, the slug and
// the visitor id (R9, epic UX rework 8.23), and keeps the answer on the device (C11).
const visitor = '0f0e0d0c-0b0a-4908-8706-050403020100';
const result = {
  total: 1,
  choices: [
    { id: 'tea', count: 1, percent: 100 },
    { id: 'coffee', count: 0, percent: 0 },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(VISITOR_STORAGE_KEY, visitor);
  resetVisitorIdForTests();
});

describe('responseClient', () => {
  it('posts the vote with the site key, the slug and the visitor id, never a cookie, and keeps the answer', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ elementId: 'e', value: 'tea', recorded: true, result }), { status: 201 }),
    );
    const client = responseClient('https://api.example/', { key: 'tas_key', zone: 'home top' }, fetchImpl);
    expect(await client.send('t', 'e', 'tea')).toEqual({ value: 'tea', result });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/delivery/v1/responses?zone=home%20top');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tas_key',
      'Content-Type': 'application/json',
      'X-TaleArt-Visitor': visitor,
    });
    expect(JSON.parse(init.body as string)).toEqual({ taleId: 't', elementId: 'e', value: 'tea', clientAt: expect.any(String) });
    expect(client.stored('t', 'e')).toEqual({ value: 'tea', result });
  });

  it('keeps the stored first vote of a repeat', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ elementId: 'e', value: 'coffee', recorded: false, result }), { status: 200 }),
    );
    const client = responseClient('https://api.example', { key: 'k', zone: 'z' }, fetchImpl);
    expect((await client.send('t', 'e', 'tea')).value).toBe('coffee');
    expect(storedResponse('t', 'e')?.value).toBe('coffee');
  });

  it('throws a DeliveryError for a refusal, a bad body or a network failure, keeping nothing', async () => {
    const refused = responseClient('https://api.example', { key: 'k', zone: 'z' }, async () =>
      new Response('{"error":{"code":"response_target_not_found","message":"x"}}', { status: 404 }),
    );
    await expect(refused.send('t', 'e', 'tea')).rejects.toBeInstanceOf(DeliveryError);
    const garbled = responseClient('https://api.example', { key: 'k', zone: 'z' }, async () => new Response('<html>', { status: 200 }));
    await expect(garbled.send('t', 'e', 'tea')).rejects.toBeInstanceOf(DeliveryError);
    const offline = responseClient('https://api.example', { key: 'k', zone: 'z' }, async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.send('t', 'e', 'tea')).rejects.toThrow('Could not reach the TaleArt API');
    expect(storedResponse('t', 'e')).toBeNull();
  });
});

describe('kept answers (C11)', () => {
  it('reads nothing from missing, broken or foreign storage', () => {
    expect(storedResponse('t', 'e')).toBeNull();
    localStorage.setItem(RESPONSES_STORAGE_KEY, '{not json');
    expect(storedResponse('t', 'e')).toBeNull();
    localStorage.setItem(RESPONSES_STORAGE_KEY, JSON.stringify({ 't:e': { v: 'tea', r: { total: 'x' } } }));
    expect(storedResponse('t', 'e')).toBeNull();
  });

  it('keeps at most the newest answers', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i <= MAX_STORED_RESPONSES; i += 1) {
        vi.setSystemTime(1_000 + i);
        keepResponse('t', `e${i}`, { value: 'tea', result });
      }
      expect(storedResponse('t', 'e0')).toBeNull();
      expect(storedResponse('t', `e${MAX_STORED_RESPONSES}`)?.value).toBe('tea');
      expect(Object.keys(JSON.parse(localStorage.getItem(RESPONSES_STORAGE_KEY) as string))).toHaveLength(
        MAX_STORED_RESPONSES,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives blocked storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => keepResponse('t', 'e', { value: 'tea', result })).not.toThrow();
    spy.mockRestore();
  });
});
