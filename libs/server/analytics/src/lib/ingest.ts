import {
  ANALYTICS_TALE_EVENT_TYPES,
  isAnalyticsEventTimeAccepted,
  isAnalyticsEventType,
  type AnalyticsEventType,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { zoneTaleTargets } from '@taleart/server-tales';
import { visitorHash } from './visitor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An ISO 8601 date and time in UTC: the `Z` is required, so no offset has to be judged.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const EVENT_FIELDS = new Set(['type', 'groupId', 'taleId', 'at']);

/** One event the Delivery API accepted and will store. */
export interface AcceptedEvent {
  type: AnalyticsEventType;
  groupId: string;
  /** Set for `view` and `click` only. */
  taleId: string | null;
  at: Date;
}

/** One request's events as the Delivery API received them, for the zone its key names. */
export interface AnalyticsIngest {
  projectId: string;
  zoneId: string;
  /** The visitor's id, a lowercase UUID v4 (the header or the beacon's body). */
  visitorId: string;
  /** The request's events as sent (at most 50; the API checks the count). */
  events: readonly unknown[];
  /** The API's clock; defaults to now. */
  now?: Date;
}

/** What one request kept and what it dropped. */
export interface AnalyticsIngestResult {
  accepted: number;
  dropped: number;
}

/**
 * Checks one event as the analytics spec states it, without the database: exactly the four fields,
 * a known type, a group id (and a tale id for `view` and `click`, none for the others), and an ISO
 * UTC time within the accepted window. Null when any check fails.
 */
export function parseAnalyticsEvent(raw: unknown, now: Date): AcceptedEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const event = raw as Record<string, unknown>;
  if (Object.keys(event).some((key) => !EVENT_FIELDS.has(key))) return null;
  if (!isAnalyticsEventType(event['type'])) return null;
  const type = event['type'];
  const groupId = event['groupId'];
  if (typeof groupId !== 'string' || !UUID.test(groupId)) return null;
  const taleId = event['taleId'] ?? null;
  const takesTale = (ANALYTICS_TALE_EVENT_TYPES as readonly string[]).includes(type);
  if (takesTale) {
    if (typeof taleId !== 'string' || !UUID.test(taleId)) return null;
  } else if (taleId !== null) {
    return null;
  }
  const at = event['at'];
  if (typeof at !== 'string' || !ISO_UTC.test(at)) return null;
  const time = new Date(at);
  if (!isAnalyticsEventTimeAccepted(time, now)) return null;
  return { type, groupId: groupId.toLowerCase(), taleId: takesTale ? (taleId as string).toLowerCase() : null, at: time };
}

/**
 * Records one request's analytics events (analytics spec, Delivery API). Each event is checked by
 * {@link parseAnalyticsEvent}; then its group, and its tale, must be placed in the key's zone, and a
 * tale must belong to the event's group. Any event that fails a check is dropped and counted; the
 * others are stored in one statement, with the visitor's hash of the project.
 */
export async function recordAnalyticsEvents(db: Db, input: AnalyticsIngest): Promise<AnalyticsIngestResult> {
  const now = input.now ?? new Date();
  const parsed = input.events.map((raw) => parseAnalyticsEvent(raw, now));
  const valid = parsed.filter((event): event is AcceptedEvent => event !== null);
  if (valid.length === 0) return { accepted: 0, dropped: input.events.length };
  const targets = await zoneTaleTargets(
    db,
    input.zoneId,
    valid.map((event) => event.groupId),
    valid.flatMap((event) => (event.taleId === null ? [] : [event.taleId])),
  );
  const kept = valid.filter((event) => {
    if (!targets.placedGroupIds.has(event.groupId)) return false;
    if (event.taleId === null) return true;
    return targets.taleGroupIds.get(event.taleId) === event.groupId;
  });
  if (kept.length > 0) {
    await db.query(
      `INSERT INTO analytics_events (project_id, zone_id, group_id, tale_id, type, visitor_hash, at)
       SELECT $1::uuid, $2::uuid, e.group_id, e.tale_id, e.type, $3::text, e.at
       FROM unnest($4::uuid[], $5::uuid[], $6::text[], $7::timestamptz[]) AS e(group_id, tale_id, type, at)`,
      [
        input.projectId,
        input.zoneId,
        visitorHash(input.projectId, input.visitorId),
        kept.map((event) => event.groupId),
        kept.map((event) => event.taleId),
        kept.map((event) => event.type),
        kept.map((event) => event.at.toISOString()),
      ],
    );
  }
  return { accepted: kept.length, dropped: input.events.length - kept.length };
}
