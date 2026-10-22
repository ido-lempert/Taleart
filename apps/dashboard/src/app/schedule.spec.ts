import { describeWindow, formatLocal, formatShort, fromLocalInput, parseLocalInput, toLocalInput, windowChip } from './schedule';

describe('schedule chips (epic UX rework R8)', () => {
  const now = new Date(2026, 9, 22, 12, 0);
  const local = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

  // Runs `check` with the browser's locale set to `locale`.
  function inLocale(locale: string, check: () => void): void {
    const toDate = Date.prototype.toLocaleDateString;
    const toTime = Date.prototype.toLocaleTimeString;
    const toString = Date.prototype.toLocaleString;
    const spies = [
      vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, _l, options) {
        return toDate.call(this, locale, options);
      }),
      vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (this: Date, _l, options) {
        return toTime.call(this, locale, options);
      }),
      vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (this: Date, _l, options) {
        return toString.call(this, locale, options);
      }),
    ];
    try {
      check();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  }

  it('reads "Starts 1 Dec, 09:00" in British English, with the time written as the indicator writes it', () => {
    inLocale('en-GB', () => {
      const start = local(2026, 11, 1, 9, 0);
      expect(windowChip({ startsAt: start, endsAt: null }, now)).toBe('Starts 1 Dec, 09:00');
      expect(formatLocal(start)).toBe('1 Dec 2026, 09:00');
    });
    inLocale('en-US', () => {
      const start = local(2026, 11, 1, 9, 0);
      expect(windowChip({ startsAt: start, endsAt: null }, now)).toBe('Starts Dec 1, 9:00 AM');
      expect(formatLocal(start)).toBe('Dec 1, 2026, 9:00 AM');
    });
  });

  it('shows the time of an end at midnight, so the day before is the last one shown', () => {
    inLocale('en-GB', () => {
      expect(windowChip({ startsAt: null, endsAt: local(2026, 10, 3, 0, 0) }, now)).toBe('Ends 3 Nov, 00:00');
    });
  });

  it('shows both ends of a window ahead with a dash, naming the year of a bound in another year', () => {
    inLocale('en-GB', () => {
      const window = { startsAt: local(2026, 11, 28, 9, 0), endsAt: local(2027, 0, 2, 0, 0) };
      expect(windowChip(window, now)).toBe('28 Dec, 09:00 – 2 Jan 2027, 00:00');
      // A tale card shows one bound: the start while it is ahead.
      expect(windowChip(window, now, 'short')).toBe('Starts 28 Dec, 09:00');
    });
  });

  it('says "Started" and "Ended" for bounds in the past', () => {
    inLocale('en-GB', () => {
      const past = local(2026, 9, 1, 9, 0);
      const ahead = local(2026, 10, 3, 18, 30);
      expect(windowChip({ startsAt: past, endsAt: null }, now)).toBe('Started 1 Oct, 09:00');
      expect(windowChip({ startsAt: null, endsAt: past }, now)).toBe('Ended 1 Oct, 09:00');
      expect(windowChip({ startsAt: local(2026, 8, 1, 9, 0), endsAt: past }, now)).toBe('Ended 1 Oct, 09:00');
      // Started already: what matters is when it ends.
      expect(windowChip({ startsAt: past, endsAt: ahead }, now)).toBe('Ends 3 Nov, 18:30');
      expect(windowChip({ startsAt: past, endsAt: ahead }, now, 'short')).toBe('Ends 3 Nov, 18:30');
      expect(windowChip({ startsAt: null, endsAt: local(2025, 11, 31, 9, 0) }, now)).toBe('Ended 31 Dec 2025, 09:00');
    });
  });

  it('says nothing without a window', () => {
    expect(windowChip({ startsAt: null, endsAt: null }, now)).toBe('');
    expect(formatShort(local(2027, 0, 5, 0, 0), now)).toContain('2027');
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
