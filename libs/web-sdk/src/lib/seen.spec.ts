import { markGroupSeen, SEEN_LIMIT, SEEN_STORAGE_KEY, seenGroupIds } from './seen';

describe('seen tale groups', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reads nothing seen at first, then the groups marked seen, kept in local storage', () => {
    expect(seenGroupIds().size).toBe(0);
    markGroupSeen('ga');
    markGroupSeen('gb');
    markGroupSeen('ga');
    expect([...seenGroupIds()]).toEqual(['gb', 'ga']);
    expect(JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) ?? '')).toEqual(['gb', 'ga']);
  });

  it(`keeps at most ${SEEN_LIMIT} ids, dropping the oldest`, () => {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from({ length: SEEN_LIMIT }, (_, i) => `g${i}`)));
    markGroupSeen('new');
    const ids = [...seenGroupIds()];
    expect(ids).toHaveLength(SEEN_LIMIT);
    expect(ids[0]).toBe('g1');
    expect(ids.at(-1)).toBe('new');
  });

  it.each([['not JSON', '{oops'], ['not an array', '{"a":1}'], ['non-string ids', '[1, null, "ok"]']])(
    'reads %s as nothing (or only the valid ids) without throwing',
    (_label, value) => {
      localStorage.setItem(SEEN_STORAGE_KEY, value);
      expect([...seenGroupIds()].filter((id) => id !== 'ok')).toEqual([]);
      expect(() => markGroupSeen('ga')).not.toThrow();
      expect(seenGroupIds().has('ga')).toBe(true);
    },
  );

  it('reads nothing seen and does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(seenGroupIds().size).toBe(0);
    expect(() => markGroupSeen('ga')).not.toThrow();
  });
});
