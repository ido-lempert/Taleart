import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the table the analytics module owns (epic analytics). Runs after the
 * access module (a project row) and before nothing that depends on it.
 *
 * One row per event the Delivery API kept: the project, zone, tale group and (for `view` and
 * `click`) tale ids, the event type, the visitor's hash and the event's time. The visitor id itself
 * is never stored: `visitor_hash` is SHA-256 of `projectId + ':' + visitorId` (see
 * {@link visitorHash}), so ids do not link across projects. No IP address, user agent or external
 * user ID is stored. The ids carry no foreign keys into the tales module (as responses' zone and
 * group ids), so a history outlives the tale it names; the retention job deletes it after 400 days.
 */
export async function migrateAnalytics(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id bigserial PRIMARY KEY,
      project_id uuid NOT NULL REFERENCES projects(id),
      zone_id uuid NOT NULL,
      group_id uuid NOT NULL,
      tale_id uuid,
      type text NOT NULL CHECK (type IN ('impression', 'open', 'view', 'click')),
      visitor_hash text NOT NULL CHECK (char_length(visitor_hash) = 64),
      at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // A zone's events in a period: the dashboard's totals, daily series and rows.
  await db.query('CREATE INDEX IF NOT EXISTS analytics_events_zone_at_idx ON analytics_events (zone_id, at)');
  // The retention purge: deletes the events older than the cutoff without scanning the table.
  await db.query('CREATE INDEX IF NOT EXISTS analytics_events_at_idx ON analytics_events (at)');
  // Reach and engagement: the distinct visitors of a zone's events of one type.
  await db.query(
    'CREATE INDEX IF NOT EXISTS analytics_events_zone_type_visitor_idx ON analytics_events (zone_id, type, visitor_hash)',
  );
}
