import { describeWindow, fromLocalInput, toLocalInput } from './schedule';

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

  it('describes a window with either bound open', () => {
    const start = new Date(2030, 0, 1, 10, 0).toISOString();
    const end = new Date(2030, 0, 2, 10, 0).toISOString();
    expect(describeWindow({ startsAt: null, endsAt: null })).toBe('');
    expect(describeWindow({ startsAt: start, endsAt: null })).toMatch(/^From /);
    expect(describeWindow({ startsAt: null, endsAt: end })).toMatch(/^Until /);
    expect(describeWindow({ startsAt: start, endsAt: end })).toMatch(/^From .+ until .+$/);
  });
});
