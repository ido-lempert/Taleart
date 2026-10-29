import {
  analyticsPeriodDays,
  ctr,
  engagementRate,
  type AnalyticsPeriod,
  type ZoneAnalytics,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { taleGroupNames, taleTitlesById } from '@taleart/server-tales';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The counts of one set of events, as the SQL below selects them. */
interface Counts {
  impressions: number;
  reach: number;
  opens: number;
  engagedVisitors: number;
  taleViews: number;
  clicks: number;
}

// The aggregate columns every metric shares, counted per row of the GROUP BY. Reach is the distinct
// visitors with an impression, so a total's Reach is not the sum of its rows.
const COUNT_COLUMNS = `
  count(*) FILTER (WHERE type = 'impression') AS impressions,
  count(DISTINCT visitor_hash) FILTER (WHERE type = 'impression') AS reach,
  count(*) FILTER (WHERE type = 'open') AS opens,
  count(*) FILTER (WHERE type = 'view') AS "taleViews",
  count(*) FILTER (WHERE type = 'click') AS clicks`;

type Row = Record<'impressions' | 'reach' | 'opens' | 'taleViews' | 'clicks', string | number>;

function countsOf(row: Row, engagedVisitors: number): Counts {
  return {
    impressions: Number(row.impressions),
    reach: Number(row.reach),
    opens: Number(row.opens),
    engagedVisitors,
    taleViews: Number(row.taleViews),
    clicks: Number(row.clicks),
  };
}

// The metrics of counts, as the published definitions state them.
function metricsOf(counts: Counts) {
  return {
    impressions: counts.impressions,
    reach: counts.reach,
    opens: counts.opens,
    taleViews: counts.taleViews,
    clicks: counts.clicks,
    engagementRate: engagementRate(counts.engagedVisitors, counts.reach),
    ctr: ctr(counts.clicks, counts.taleViews),
  };
}

/** The first UTC day of a period: `days` UTC days, today included, ending with today. */
export function periodStart(period: AnalyticsPeriod, now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (analyticsPeriodDays(period) - 1) * DAY_MS);
}

/**
 * A zone's analytics for a period (analytics spec, Metrics; Management API): the totals, one entry
 * per UTC day, and the rows per tale group and per tale. Only the zone's events count. Engaged
 * visitors are those with at least one impression AND at least one open in the period (the same
 * group, for a group's row), so the engagement rate, engaged over Reach, never exceeds 100 percent.
 * A tale's row has the views and clicks; impressions and opens name a group, so the tale's null
 * fields are left null. Each group's and tale's name is read from the tales module (empty when gone).
 */
export async function zoneAnalytics(
  db: Db,
  input: { projectId: string; zoneId: string; period: AnalyticsPeriod; now?: Date },
): Promise<ZoneAnalytics> {
  const now = input.now ?? new Date();
  const days = analyticsPeriodDays(input.period);
  const from = periodStart(input.period, now);
  const to = new Date(from.getTime() + days * DAY_MS);
  const range = [input.zoneId, from.toISOString(), to.toISOString()];
  const where = 'WHERE zone_id = $1 AND at >= $2 AND at < $3';

  const [totals, engagedTotals, groups, engagedGroups, tales, daily] = await Promise.all([
    db.query<Row>(`SELECT ${COUNT_COLUMNS} FROM analytics_events ${where}`, range),
    // Visitors with an impression and an open anywhere in the zone's period.
    db.query<{ engaged: string }>(
      `SELECT count(*) AS engaged FROM (
         SELECT visitor_hash FROM analytics_events ${where} AND type = 'impression'
         INTERSECT
         SELECT visitor_hash FROM analytics_events ${where} AND type = 'open'
       ) engaged`,
      range,
    ),
    db.query<Row & { groupId: string }>(
      `SELECT group_id AS "groupId", ${COUNT_COLUMNS} FROM analytics_events ${where}
       GROUP BY group_id ORDER BY impressions DESC, group_id`,
      range,
    ),
    // Per group: visitors with an impression and an open of that same group.
    db.query<{ groupId: string; engaged: string }>(
      `SELECT group_id AS "groupId", count(*) AS engaged FROM (
         SELECT group_id, visitor_hash FROM analytics_events ${where} AND type = 'impression'
         INTERSECT
         SELECT group_id, visitor_hash FROM analytics_events ${where} AND type = 'open'
       ) engaged GROUP BY group_id`,
      range,
    ),
    db.query<Row & { taleId: string; groupId: string }>(
      `SELECT tale_id AS "taleId", group_id AS "groupId", ${COUNT_COLUMNS} FROM analytics_events
       ${where} AND tale_id IS NOT NULL GROUP BY tale_id, group_id ORDER BY "taleViews" DESC, tale_id`,
      range,
    ),
    db.query<{ day: string; impressions: string; opens: string; taleViews: string; clicks: string }>(
      `SELECT to_char((at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
         count(*) FILTER (WHERE type = 'impression') AS impressions,
         count(*) FILTER (WHERE type = 'open') AS opens,
         count(*) FILTER (WHERE type = 'view') AS "taleViews",
         count(*) FILTER (WHERE type = 'click') AS clicks
       FROM analytics_events ${where} GROUP BY 1`,
      range,
    ),
  ]);

  const groupNames = await taleGroupNames(
    db,
    input.projectId,
    groups.rows.map((row) => row.groupId),
  );
  const taleNames = await taleTitlesById(
    db,
    input.projectId,
    tales.rows.map((row) => row.taleId),
  );
  const engagedByGroup = new Map(engagedGroups.rows.map((row) => [row.groupId, Number(row.engaged)]));

  // Every day of the period, oldest first; a day without events is zero.
  const byDay = new Map(daily.rows.map((row) => [row.day, row]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    const row = byDay.get(date);
    return {
      date,
      impressions: Number(row?.impressions ?? 0),
      clicks: Number(row?.clicks ?? 0),
      opens: Number(row?.opens ?? 0),
      taleViews: Number(row?.taleViews ?? 0),
    };
  });

  const totalRow = totals.rows[0] ?? ({} as Row);
  return {
    period: input.period,
    totals: metricsOf(countsOf(totalRow, Number(engagedTotals.rows[0]?.engaged ?? 0))),
    daily: series,
    groups: groups.rows.map((row) => ({
      groupId: row.groupId,
      name: groupNames.get(row.groupId) ?? '',
      ...metricsOf(countsOf(row, engagedByGroup.get(row.groupId) ?? 0)),
    })),
    tales: tales.rows.map((row) => ({
      taleId: row.taleId,
      name: taleNames.get(row.taleId) ?? '',
      groupId: row.groupId,
      impressions: null,
      reach: null,
      opens: null,
      taleViews: Number(row.taleViews),
      clicks: Number(row.clicks),
      engagementRate: null,
      ctr: ctr(Number(row.clicks), Number(row.taleViews)),
    })),
  };
}
