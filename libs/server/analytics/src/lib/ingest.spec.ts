import type { Db } from '@taleart/server-access';
import { parseAnalyticsEvent, recordAnalyticsEvents } from './ingest';

const zoneTaleTargets = vi.hoisted(() => vi.fn());
vi.mock('@taleart/server-tales', () => ({ zoneTaleTargets }));

const projectId = '00000000-0000-4000-8000-000000000001';
const zoneId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-0000000000a1';
const otherGroupId = '00000000-0000-4000-8000-0000000000a2';
const taleId = '00000000-0000-4000-8000-0000000000b1';
const visitorId = '0f0e0d0c-0b0a-4908-8706-050403020100';
const now = new Date('2026-10-29T12:00:00.000Z');
const at = '2026-10-29T11:00:00.000Z';

const impression = { type: 'impression', groupId, at };
const view = { type: 'view', groupId, taleId, at };

describe('parseAnalyticsEvent', () => {
  it('keeps each of the four types with the ids its type takes', () => {
    expect(parseAnalyticsEvent(impression, now)).toEqual({ type: 'impression', groupId, taleId: null, at: new Date(at) });
    expect(parseAnalyticsEvent({ type: 'open', groupId, at }, now)?.type).toBe('open');
    expect(parseAnalyticsEvent(view, now)).toEqual({ type: 'view', groupId, taleId, at: new Date(at) });
    expect(parseAnalyticsEvent({ type: 'click', groupId, taleId, at }, now)?.type).toBe('click');
    expect(parseAnalyticsEvent({ ...impression, taleId: null }, now)?.taleId).toBeNull();
  });

  it('drops an unknown type, the answer type and a changed case of a type', () => {
    expect(parseAnalyticsEvent({ ...impression, type: 'answer' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, type: 'Impression' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, type: undefined }, now)).toBeNull();
  });

  it('drops an event with a field the spec does not name', () => {
    expect(parseAnalyticsEvent({ ...impression, ip: '203.0.113.7' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, userAgent: 'x' }, now)).toBeNull();
  });

  it('drops a tale id on view or click that is missing or not a UUID, and one on impression or open', () => {
    expect(parseAnalyticsEvent({ type: 'view', groupId, at }, now)).toBeNull();
    expect(parseAnalyticsEvent({ type: 'click', groupId, taleId: 'tale', at }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, taleId }, now)).toBeNull();
    expect(parseAnalyticsEvent({ type: 'open', groupId, taleId, at }, now)).toBeNull();
  });

  it('drops a group id that is not a UUID or is missing', () => {
    expect(parseAnalyticsEvent({ ...impression, groupId: 'summer' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ type: 'impression', at }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, groupId: 7 }, now)).toBeNull();
  });

  it('drops a time that is not ISO UTC with Z, or is outside the window', () => {
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-29T11:00:00.000+02:00' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-29 11:00:00Z' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-29' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: 1793278800000 }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-22T11:59:59.999Z' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-29T13:00:01.000Z' }, now)).toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-22T12:00:00.000Z' }, now)).not.toBeNull();
    expect(parseAnalyticsEvent({ ...impression, at: '2026-10-29T13:00:00.000Z' }, now)).not.toBeNull();
  });

  it('drops anything that is not an object', () => {
    expect(parseAnalyticsEvent(null, now)).toBeNull();
    expect(parseAnalyticsEvent('impression', now)).toBeNull();
    expect(parseAnalyticsEvent([impression], now)).toBeNull();
  });
});

describe('recordAnalyticsEvents', () => {
  beforeEach(() => {
    zoneTaleTargets.mockReset();
  });

  function fakeDb() {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    return { db: { query } as unknown as Db, query };
  }

  it('stores the kept events in one insert, with the visitor hash, and counts the rest as dropped', async () => {
    zoneTaleTargets.mockResolvedValue({ placedGroupIds: new Set([groupId]), taleGroupIds: new Map([[taleId, groupId]]) });
    const { db, query } = fakeDb();
    const counted = await recordAnalyticsEvents(db, {
      projectId,
      zoneId,
      visitorId,
      events: [impression, view, { ...impression, type: 'nope' }],
      now,
    });
    expect(counted).toEqual({ accepted: 2, dropped: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO analytics_events/);
    expect(params[0]).toBe(projectId);
    expect(params[1]).toBe(zoneId);
    expect(params[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(params)).not.toContain(visitorId);
    expect(params[3]).toEqual([groupId, groupId]);
    expect(params[4]).toEqual([null, taleId]);
    expect(params[5]).toEqual(['impression', 'view']);
  });

  it('drops events whose group is not placed in the zone, and a tale of another group', async () => {
    zoneTaleTargets.mockResolvedValue({ placedGroupIds: new Set([groupId]), taleGroupIds: new Map([[taleId, otherGroupId]]) });
    const { db, query } = fakeDb();
    const counted = await recordAnalyticsEvents(db, {
      projectId,
      zoneId,
      visitorId,
      events: [{ ...impression, groupId: otherGroupId }, view],
      now,
    });
    expect(counted).toEqual({ accepted: 0, dropped: 2 });
    expect(query).not.toHaveBeenCalled();
  });

  it('drops a tale the zone does not hold (its target is absent)', async () => {
    zoneTaleTargets.mockResolvedValue({ placedGroupIds: new Set([groupId]), taleGroupIds: new Map() });
    const { db } = fakeDb();
    expect(await recordAnalyticsEvents(db, { projectId, zoneId, visitorId, events: [view], now })).toEqual({
      accepted: 0,
      dropped: 1,
    });
  });

  it('asks the tales module about valid events only, and touches no database for none', async () => {
    zoneTaleTargets.mockResolvedValue({ placedGroupIds: new Set(), taleGroupIds: new Map() });
    const { db, query } = fakeDb();
    expect(await recordAnalyticsEvents(db, { projectId, zoneId, visitorId, events: [{ bad: true }], now })).toEqual({
      accepted: 0,
      dropped: 1,
    });
    expect(zoneTaleTargets).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
