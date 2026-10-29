// Public interface of the analytics module (AD-1; epic analytics). It owns the `analytics_events`
// table: the events the Delivery API's `POST /delivery/v1/events` keeps (impressions, opens, tale
// views and clicks, with the visitor's hash only), the Management API's zone analytics read, and the
// retention of the raw events. It reaches tale groups and tales only through @taleart/server-tales.
export { migrateAnalytics } from './lib/migration';
export {
  parseAnalyticsEvent,
  recordAnalyticsEvents,
  type AcceptedEvent,
  type AnalyticsIngest,
  type AnalyticsIngestResult,
} from './lib/ingest';
export { zoneAnalytics, periodStart } from './lib/metrics';
export { purgeAnalyticsEvents } from './lib/retention';
export { visitorHash } from './lib/visitor';
