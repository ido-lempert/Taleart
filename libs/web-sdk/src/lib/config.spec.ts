import { defaultApiUrl, getConfig, init, mergeStrings, onConfigChange, readStrings, type ConfigKey } from './config';

// Every option back to its default, so each test starts from the SDK's own state.
function reset(): void {
  init({ apiUrl: '', locale: '', strings: null, theme: null, externalUserId: null, tags: null, hooks: null, fallback: null, frequency: null });
}

describe('the SDK configuration (SDK v2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    reset();
    document.documentElement.removeAttribute('lang');
    vi.restoreAllMocks();
  });

  it('takes the API origin of the script URL, and none for a script without an http(s) origin', () => {
    expect(defaultApiUrl('https://api.example.com/sdk/v1/taleart.js')).toBe('https://api.example.com');
    expect(defaultApiUrl('http://localhost:3333/sdk/v1/taleart.js')).toBe('http://localhost:3333');
    expect(defaultApiUrl('file:///tmp/taleart.js')).toBe('');
    expect(defaultApiUrl('not a url')).toBe('');
  });

  it('uses the page language as the locale, then English', () => {
    expect(getConfig().locale).toBe('en');
    document.documentElement.lang = 'he-IL';
    expect(getConfig().locale).toBe('he-IL');
    init({ locale: 'de' });
    expect(getConfig().locale).toBe('de');
    init({ locale: '' });
    expect(getConfig().locale).toBe('he-IL');
  });

  it('merges: an option left out keeps its value, and one given replaces it', () => {
    init({ apiUrl: 'https://api.example.com/' });
    init({ locale: 'he' });
    expect(getConfig()).toMatchObject({ apiUrl: 'https://api.example.com', locale: 'he' });
    init({ apiUrl: undefined });
    expect(getConfig().apiUrl).toBe('https://api.example.com');
  });

  it('tells the listeners which options changed, and nothing when nothing did', () => {
    const seen: ConfigKey[][] = [];
    const stop = onConfigChange((changed) => seen.push([...changed]));
    init({ locale: 'he', tags: ['vip'] });
    init({ locale: 'he' });
    init({ tags: ['vip'] });
    expect(seen).toEqual([['locale', 'tags']]);
    stop();
    init({ locale: 'fr' });
    expect(seen).toHaveLength(1);
  });

  it('ignores an invalid option with one warning, and applies the valid ones in the same call', () => {
    init({ apiUrl: 42 as never, locale: 'he', tags: 'vip' as never });
    expect(getConfig()).toMatchObject({ apiUrl: '', locale: 'he', tags: null });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('warns about an unknown option and about a call that is not an object', () => {
    init({ nope: 1 } as never);
    expect(getConfig().locale).toBe('en');
    init(null as never);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('trims the external user ID, and drops one no list can hold with a warning, without logging it', () => {
    init({ externalUserId: '  cust-1 ' });
    expect(getConfig().externalUserId).toBe('cust-1');
    init({ externalUserId: 'x'.repeat(300) });
    expect(getConfig().externalUserId).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).not.toContain('xxxx');
  });

  it('keeps tags as a copy of the array, and clears them with null', () => {
    const tags = ['vip'];
    init({ tags });
    tags.push('other');
    expect(getConfig().tags).toEqual(['vip']);
    init({ tags: null });
    expect(getConfig().tags).toBeNull();
  });

  it('checks the theme: a valid override is kept, an invalid field is named in one warning', () => {
    init({ theme: { ringWidth: 2, ringWidthX: 1 } as never });
    expect(getConfig().theme).toEqual({ ringWidth: 2 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('"ringWidthX"');
  });

  it('reads strings: null clears, an object is copied, anything else is invalid', () => {
    expect(readStrings(null, 'x')).toBeNull();
    expect(readStrings('nope', 'x')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const source = { he: { 'viewer.close': 'סגור' } };
    const copy = readStrings(source, 'x');
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });

  it('takes fallback and frequency: none, message, once, daily, weekly or a count 1 to 50; anything else is ignored with one warning', () => {
    expect(getConfig()).toMatchObject({ fallback: 'none', frequency: null });
    init({ fallback: 'message', frequency: 'weekly' });
    expect(getConfig()).toMatchObject({ fallback: 'message', frequency: 'weekly' });
    init({ frequency: 50 });
    expect(getConfig().frequency).toBe(50);
    init({ fallback: null, frequency: null });
    expect(getConfig()).toMatchObject({ fallback: 'none', frequency: null });
    expect(warnSpy).not.toHaveBeenCalled();
    init({ frequency: 51 });
    init({ fallback: 'banner' as never });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toContain('init({ frequency })');
    expect(getConfig()).toMatchObject({ fallback: 'none', frequency: null });
  });

  it('merges an element\'s strings over the SDK\'s, locale by locale', () => {
    const base = { he: { 'viewer.close': 'סגור', 'bar.next': 'הבא' }, 'viewer.close': 'Close' };
    const own = { he: { 'viewer.close': 'סגירה' } };
    expect(mergeStrings(base, own)).toEqual({ he: { 'viewer.close': 'סגירה', 'bar.next': 'הבא' }, 'viewer.close': 'Close' });
    expect(mergeStrings(null, own)).toBe(own);
    expect(mergeStrings(base, null)).toBe(base);
  });
});
