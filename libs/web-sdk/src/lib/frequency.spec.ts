import { cappedGroupIds, parseFrequency, recordView, VIEWED_GROUPS_LIMIT, VIEWS_PER_GROUP, VIEWS_STORAGE_KEY } from './frequency';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 29, 12);

const capped = (rule: Parameters<typeof cappedGroupIds>[1], now = NOW) => cappedGroupIds(['ga'], rule, now).has('ga');

describe('frequency options', () => {
  it('reads once, daily, weekly and a count from 1 to 50 (a number or its text), and nothing for none', () => {
    expect(parseFrequency('once')).toBe('once');
    expect(parseFrequency('daily')).toBe('daily');
    expect(parseFrequency('weekly')).toBe('weekly');
    expect(parseFrequency(3)).toBe(3);
    expect(parseFrequency('3')).toBe(3);
    expect(parseFrequency(1)).toBe(1);
    expect(parseFrequency(VIEWS_PER_GROUP)).toBe(VIEWS_PER_GROUP);
    expect(parseFrequency(String(VIEWS_PER_GROUP))).toBe(VIEWS_PER_GROUP);
    expect(parseFrequency(null)).toBeNull();
    expect(parseFrequency(undefined)).toBeNull();
    expect(parseFrequency('')).toBeNull();
  });

  it.each([['0'], ['-1'], ['1.5'], ['often'], ['03'], ['51'], [0], [2.5], [51], [true]])('reads %j as invalid', (value) => {
    expect(parseFrequency(value)).toBeUndefined();
  });
});

describe('recorded views', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('counts each view in local storage, newest last, and never sends them anywhere', () => {
    recordView('ga', NOW - DAY);
    recordView('gb', NOW);
    recordView('ga', NOW);
    expect(JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY) ?? '')).toEqual({ gb: [NOW], ga: [NOW - DAY, NOW] });
  });

  it(`keeps at most ${VIEWS_PER_GROUP} views per group, the newest`, () => {
    for (let i = 0; i < VIEWS_PER_GROUP + 5; i++) recordView('ga', NOW + i);
    const views = JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY) ?? '{}') as Record<string, number[]>;
    expect(views['ga']).toHaveLength(VIEWS_PER_GROUP);
    expect(views['ga'].at(-1)).toBe(NOW + VIEWS_PER_GROUP + 4);
    expect(views['ga'][0]).toBe(NOW + 5);
  });

  it(`keeps at most ${VIEWED_GROUPS_LIMIT} groups, dropping the least recently viewed`, () => {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(Array.from({ length: VIEWED_GROUPS_LIMIT }, (_, i) => [`g${i}`, [NOW]]))),
    );
    recordView('g0', NOW);
    recordView('new', NOW);
    const ids = Object.keys(JSON.parse(localStorage.getItem(VIEWS_STORAGE_KEY) ?? '{}'));
    expect(ids).toHaveLength(VIEWED_GROUPS_LIMIT);
    expect(ids).toContain('g0');
    expect(ids).not.toContain('g1');
    expect(ids.at(-1)).toBe('new');
  });

  it.each([['not JSON', '{oops'], ['not an object', '[1,2]'], ['bad entries', '{"ga":"x","gb":[1,"y",2]}']])(
    'reads %s as what it can and does not throw',
    (_label, value) => {
      localStorage.setItem(VIEWS_STORAGE_KEY, value);
      expect(() => recordView('ga', NOW)).not.toThrow();
      expect(cappedGroupIds(['ga'], 'once', NOW).has('ga')).toBe(true);
    },
  );

  it('counts nothing and does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => recordView('ga', NOW)).not.toThrow();
    expect(capped('once')).toBe(false);
  });
});

describe('the frequency rules', () => {
  beforeEach(() => localStorage.clear());

  it('once: capped after the first view', () => {
    expect(capped('once')).toBe(false);
    recordView('ga', NOW - 3 * DAY);
    expect(capped('once')).toBe(true);
  });

  it('daily: at most one view per 24 hours, from the last view', () => {
    recordView('ga', NOW - 23 * HOUR);
    expect(capped('daily')).toBe(true);
    expect(capped('daily', NOW + 2 * HOUR)).toBe(false);
  });

  it('weekly: one view per 7 days, from the last view', () => {
    recordView('ga', NOW - 6 * DAY);
    expect(capped('weekly')).toBe(true);
    expect(capped('weekly', NOW + 2 * DAY)).toBe(false);
  });

  it('N: capped after N views over the lifetime of the group', () => {
    recordView('ga', NOW - 10 * DAY);
    recordView('ga', NOW - 5 * DAY);
    expect(capped(3)).toBe(false);
    recordView('ga', NOW - DAY);
    expect(capped(3)).toBe(true);
    expect(capped(3, NOW + 365 * DAY)).toBe(true);
  });

  it('judges each group by its own views', () => {
    recordView('gb', NOW);
    expect([...cappedGroupIds(['ga', 'gb'], 'once', NOW)]).toEqual(['gb']);
    expect(cappedGroupIds([], 'once', NOW).size).toBe(0);
  });
});
