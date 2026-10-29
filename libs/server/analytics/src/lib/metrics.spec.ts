import type { Db } from '@taleart/server-access';
import { periodStart, zoneAnalytics } from './metrics';

const taleGroupNames = vi.hoisted(() => vi.fn());
const taleTitlesById = vi.hoisted(() => vi.fn());
vi.mock('@taleart/server-tales', () => ({ taleGroupNames, taleTitlesById }));

const projectId = '00000000-0000-4000-8000-000000000001';
const zoneId = '00000000-0000-4000-8000-000000000002';
const now = new Date('2026-10-29T12:00:00.000Z');

// A fake database answering the four queries of zoneAnalytics in order.
function fakeDb(answers: { rows: unknown[] }[]) {
  const query = vi.fn(async () => answers.shift() ?? { rows: [] });
  return { db: { query } as unknown as Db, query };
}

const zeros = { impressions: '0', reach: '0', opens: '0', taleViews: '0', clicks: '0' };

describe('periodStart', () => {
  it('is the first of the period UTC days, today included', () => {
    expect(periodStart('7d', now).toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(periodStart('30d', now).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(periodStart('90d', now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('zoneAnalytics', () => {
  beforeEach(() => {
    taleGroupNames.mockReset().mockResolvedValue(new Map());
    taleTitlesById.mockReset().mockResolvedValue(new Map());
  });

  it('answers zeros for a zone without events, with a zero for each day of the period', async () => {
    const { db } = fakeDb([{ rows: [zeros] }, { rows: [{ engaged: '0' }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
    const body = await zoneAnalytics(db, { projectId, zoneId, period: '7d', now });
    expect(body.period).toBe('7d');
    expect(body.totals).toEqual({
      impressions: 0,
      reach: 0,
      opens: 0,
      taleViews: 0,
      clicks: 0,
      engagementRate: 0,
      ctr: 0,
    });
    expect(body.daily.map((day) => day.date)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
    ]);
    expect(body.daily.every((day) => day.impressions === 0 && day.clicks === 0)).toBe(true);
    expect(body.groups).toEqual([]);
    expect(body.tales).toEqual([]);
  });

  it('turns counts into the published rates, one decimal, and fills the series from the rows', async () => {
    const groupId = '00000000-0000-4000-8000-0000000000a1';
    const taleId = '00000000-0000-4000-8000-0000000000b1';
    const { db, query } = fakeDb([
      { rows: [{ impressions: '3', reach: '2', opens: '1', taleViews: '3', clicks: '1' }] },
      { rows: [{ engaged: '1' }] },
      { rows: [{ groupId, impressions: '3', reach: '2', opens: '1', taleViews: '3', clicks: '1' }] },
      { rows: [{ groupId, engaged: '1' }] },
      { rows: [{ taleId, groupId, taleViews: '3', clicks: '1' }] },
      { rows: [{ day: '2026-10-28', impressions: '3', opens: '1', taleViews: '3', clicks: '1' }] },
    ]);
    taleGroupNames.mockResolvedValue(new Map([[groupId, 'Summer']]));
    taleTitlesById.mockResolvedValue(new Map([[taleId, 'Beach']]));
    const body = await zoneAnalytics(db, { projectId, zoneId, period: '7d', now });
    expect(body.totals).toEqual({
      impressions: 3,
      reach: 2,
      opens: 1,
      taleViews: 3,
      clicks: 1,
      engagementRate: 50,
      ctr: 33.3,
    });
    expect(body.groups).toEqual([
      {
        groupId,
        name: 'Summer',
        impressions: 3,
        reach: 2,
        opens: 1,
        taleViews: 3,
        clicks: 1,
        engagementRate: 50,
        ctr: 33.3,
      },
    ]);
    expect(body.tales).toEqual([
      {
        taleId,
        name: 'Beach',
        groupId,
        impressions: null,
        reach: null,
        opens: null,
        taleViews: 3,
        clicks: 1,
        engagementRate: null,
        ctr: 33.3,
      },
    ]);
    expect(body.daily[5]).toEqual({ date: '2026-10-28', impressions: 3, clicks: 1, opens: 1, taleViews: 3 });
    expect(body.daily[6]).toEqual({ date: '2026-10-29', impressions: 0, clicks: 0, opens: 0, taleViews: 0 });
    // The window is the period's days, in UTC, as the queries' parameters.
    expect(query.mock.calls[0]?.[1]).toEqual([zoneId, '2026-10-23T00:00:00.000Z', '2026-10-30T00:00:00.000Z']);
  });
});
