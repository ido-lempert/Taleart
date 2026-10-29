import { ANALYTICS_RETENTION_DAYS } from '@taleart/contract';
import type { Db } from '@taleart/server-access';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the raw analytics events older than `olderThanDays` (400 by default, the analytics spec's
 * retention), counted from their time. Returns how many it deleted. Run daily by the API process
 * (apps/api main.ts): a missed run only keeps events a little longer.
 */
export async function purgeAnalyticsEvents(
  db: Db,
  olderThanDays: number = ANALYTICS_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<number> {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1) {
    throw new Error('olderThanDays must be a whole number of days, at least 1');
  }
  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);
  const result = await db.query('DELETE FROM analytics_events WHERE at < $1', [cutoff.toISOString()]);
  return result.rowCount ?? 0;
}
