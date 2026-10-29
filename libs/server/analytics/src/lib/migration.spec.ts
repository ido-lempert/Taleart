import type { Db } from '@taleart/server-access';
import { migrateAnalytics } from './migration';

function fakeDb() {
  const query = vi.fn(async () => ({ rows: [] }));
  return { db: { query } as unknown as Db, query };
}

describe('migrateAnalytics', () => {
  it('creates the events table with the spec columns and no visitor id column', async () => {
    const { db, query } = fakeDb();
    await migrateAnalytics(db);
    const sql = query.mock.calls.map((c) => (c as unknown[])[0] as string).join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS analytics_events/);
    expect(sql).toMatch(/id bigserial PRIMARY KEY/);
    expect(sql).toMatch(/project_id uuid NOT NULL REFERENCES projects\(id\)/);
    expect(sql).toMatch(/tale_id uuid,/);
    expect(sql).toMatch(/type text NOT NULL CHECK \(type IN \('impression', 'open', 'view', 'click'\)\)/);
    expect(sql).toMatch(/visitor_hash text NOT NULL/);
    expect(sql).toMatch(/at timestamptz NOT NULL/);
    expect(sql).toMatch(/received_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).not.toMatch(/\bvisitor_id\b/);
  });

  it('indexes the time for the retention purge, the zone and time, and the zone, type and visitor', async () => {
    const { db, query } = fakeDb();
    await migrateAnalytics(db);
    const sql = query.mock.calls.map((c) => (c as unknown[])[0] as string).join('\n');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS analytics_events_at_idx ON analytics_events \(at\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS analytics_events_zone_at_idx ON analytics_events \(zone_id, at\)/);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS analytics_events_zone_type_visitor_idx ON analytics_events \(zone_id, type, visitor_hash\)/,
    );
  });
});
