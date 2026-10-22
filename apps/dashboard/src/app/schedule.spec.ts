import { describeWindow, formatShort, fromLocalInput, parseLocalInput, toLocalInput, windowChip } from './schedule';

describe('schedule chips (epic UX rework R8)', () => {
  const now = new Date(2026, 9, 22, 12, 0);
  const local = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();
  const short = (iso: string, options: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString(undefined, options);
  const dayTime: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  const day: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

  it('says when a window starts, with the time unless it is midnight', () => {
    const start = local(2026, 11, 1, 9, 0);
    expect(windowChip({ startsAt: start, endsAt: null }, now)).toBe(`Starts ${short(start, dayTime)}`);
    expect(formatShort(start, now)).toBe(short(start, dayTime));
    const midnight = local(2026, 11, 1, 0, 0);
    expect(formatShort(midnight, now)).toBe(short(midnight, day));
  });

  it('says when a window ends, and both ends of a window with a dash', () => {
    const start = local(2026, 11, 1, 9, 0);
    const end = local(2026, 10, 3, 0, 0);
    expect(windowChip({ startsAt: null, endsAt: end }, now)).toBe(`Ends ${short(end, day)}`);
    expect(windowChip({ startsAt: start, endsAt: end }, now)).toBe(`${short(start, dayTime)} – ${short(end, day)}`);
  });

  it('names the year only when it is not this year, and says nothing without a window', () => {
    const next = local(2027, 0, 5, 0, 0);
    expect(formatShort(next, now)).toBe(short(next, { ...day, year: 'numeric' }));
    expect(formatShort(next, now)).toContain('2027');
    expect(windowChip({ startsAt: null, endsAt: null }, now)).toBe('');
  });

  it('reads like "Starts 1 Dec 09:00" and "Ends 3 Nov" in British English', () => {
    const start = local(2026, 11, 1, 9, 0);
    const toLocale = Date.prototype.toLocaleString;
    const spy = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockImplementation(function (this: Date, _locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return toLocale.call(this, 'en-GB', options);
      });
    try {
      expect(windowChip({ startsAt: start, endsAt: null }, now)).toBe('Starts 1 Dec, 09:00');
      expect(windowChip({ startsAt: null, endsAt: local(2026, 10, 3, 0, 0) }, now)).toBe('Ends 3 Nov');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('schedule times', () => {
  it('round-trips a local field value through UTC', () => {
    const utc = fromLocalInput('2030-03-04T05:06');
    expect(utc).toBe(new Date(2030, 2, 4, 5, 6).toISOString());
    expect(toLocalInput(utc ?? null)).toBe('2030-03-04T05:06');
  });

  it('reads an empty field as no bound and a malformed or impossible one as invalid', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('  ')).toBeNull();
    expect(fromLocalInput('tomorrow')).toBeUndefined();
    expect(fromLocalInput('2030-02-30T10:00')).toBeUndefined();
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('not a time')).toBe('');
  });

  describe('across daylight-saving changes (Europe/Berlin)', () => {
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env['TZ'];
      process.env['TZ'] = 'Europe/Berlin';
    });

    afterEach(() => {
      if (saved === undefined) delete process.env['TZ'];
      else process.env['TZ'] = saved;
    });

    it('runs in the fixed zone', () => {
      // Winter is UTC+1, summer UTC+2.
      expect(new Date(2030, 0, 15, 12, 0).toISOString()).toBe('2030-01-15T11:00:00.000Z');
      expect(new Date(2030, 6, 15, 12, 0).toISOString()).toBe('2030-07-15T10:00:00.000Z');
    });

    it('refuses a time the clocks skip in spring instead of shifting it', () => {
      // On 31 March 2030 the clocks go from 02:00 to 03:00.
      expect(parseLocalInput('2030-03-31T02:30')).toEqual({ error: 'nonexistent' });
      expect(fromLocalInput('2030-03-31T02:30')).toBeUndefined();
      expect(parseLocalInput('2030-03-31T01:59')).toEqual({ iso: '2030-03-31T00:59:00.000Z' });
      expect(parseLocalInput('2030-03-31T03:00')).toEqual({ iso: '2030-03-31T01:00:00.000Z' });
    });

    it('reads a time that happens twice in autumn as its first occurrence', () => {
      // On 27 October 2030 02:00 to 03:00 happens first in summer time (UTC+2), then in winter time.
      expect(parseLocalInput('2030-10-27T02:30')).toEqual({ iso: '2030-10-27T00:30:00.000Z' });
    });
  });

  it('refuses out-of-range parts as invalid', () => {
    expect(parseLocalInput('2030-13-01T10:00')).toEqual({ error: 'invalid' });
    expect(parseLocalInput('2030-01-01T24:00')).toEqual({ error: 'invalid' });
  });

  it('describes a window with either bound open', () => {
    const start = new Date(2030, 0, 1, 10, 0).toISOString();
    const end = new Date(2030, 0, 2, 10, 0).toISOString();
    expect(describeWindow({ startsAt: null, endsAt: null })).toBe('');
    expect(describeWindow({ startsAt: start, endsAt: null })).toMatch(/^From /);
    expect(describeWindow({ startsAt: null, endsAt: end })).toMatch(/^Until /);
    expect(describeWindow({ startsAt: start, endsAt: end })).toMatch(/^From .+ until .+$/);
  });
});
