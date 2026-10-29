import type { Db } from '@taleart/server-access';
import { purgeAnalyticsEvents } from './retention';

const DAY = 24 * 60 * 60 * 1000;

describe('purgeAnalyticsEvents', () => {
  it('deletes events older than 400 days by default, counted from now', async () => {
    const query = vi.fn(async () => ({ rowCount: 3 }));
    const now = new Date('2026-10-29T12:00:00.000Z');
    const deleted = await purgeAnalyticsEvents({ query } as unknown as Db, undefined, now);
    expect(deleted).toBe(3);
    expect(query).toHaveBeenCalledWith('DELETE FROM analytics_events WHERE at < $1', [
      new Date(now.getTime() - 400 * DAY).toISOString(),
    ]);
  });

  it('takes the number of days it is given', async () => {
    const query = vi.fn(async () => ({ rowCount: null }));
    const now = new Date('2026-10-29T12:00:00.000Z');
    expect(await purgeAnalyticsEvents({ query } as unknown as Db, 30, now)).toBe(0);
    expect(query.mock.calls[0]?.[1]).toEqual([new Date(now.getTime() - 30 * DAY).toISOString()]);
  });

  it('refuses a number of days that is not a whole number of at least 1', async () => {
    const query = vi.fn();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(purgeAnalyticsEvents({ query } as unknown as Db, bad)).rejects.toThrow(/olderThanDays/);
    }
    expect(query).not.toHaveBeenCalled();
  });
});
