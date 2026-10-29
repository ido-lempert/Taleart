// Analytics (epic analytics, spec 2026-10-29): the event types the Web SDK sends, the periods the
// dashboard reads, the window of accepted event times, and the two published rates. The metric
// definitions here are the ones the docs page `/reference/analytics` shows verbatim.

import type { components } from '../generated/api';

type Schemas = components['schemas'];

/** The Management API's analytics of a zone (`GET /zones/{zoneId}/analytics`). */
export type ZoneAnalytics = Schemas['ZoneAnalytics'];
export type AnalyticsTotals = Schemas['AnalyticsTotals'];
export type AnalyticsDay = Schemas['AnalyticsDay'];
export type AnalyticsGroupRow = Schemas['AnalyticsGroupRow'];
export type AnalyticsTaleRow = Schemas['AnalyticsTaleRow'];
/** The body of `POST /delivery/v1/events`. */
export type AnalyticsEventsRequest = Schemas['AnalyticsEventsRequest'];
/** The answer to `POST /delivery/v1/events`. */
export type AnalyticsAccepted = Schemas['AnalyticsAccepted'];

/** The event types the Delivery API accepts (`POST /delivery/v1/events`). `answer` is not an event: responses count it. */
export const ANALYTICS_EVENT_TYPES = ['impression', 'open', 'view', 'click'] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/** Events that name a tale as well as their group; the others name the group alone. */
export const ANALYTICS_TALE_EVENT_TYPES: readonly AnalyticsEventType[] = ['view', 'click'];

/** The most events one `POST /delivery/v1/events` request may carry. */
export const MAX_ANALYTICS_EVENTS_PER_REQUEST = 50;

/** An event older than this is dropped (UTC clock of the API). */
export const ANALYTICS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** An event more than this far in the future is dropped (clock skew allowance). */
export const ANALYTICS_MAX_FUTURE_MS = 60 * 60 * 1000;

/** Raw events are kept this many days, then deleted (the retention job). */
export const ANALYTICS_RETENTION_DAYS = 400;

/** The periods of the Management API's analytics read, in days (UTC days, today included). */
export const ANALYTICS_PERIODS = ['7d', '30d', '90d'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/** The period the Management API reads when none is named. */
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = '30d';

export function isAnalyticsEventType(value: unknown): value is AnalyticsEventType {
  return typeof value === 'string' && (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

export function isAnalyticsPeriod(value: unknown): value is AnalyticsPeriod {
  return typeof value === 'string' && (ANALYTICS_PERIODS as readonly string[]).includes(value);
}

/** The number of UTC days a period covers. */
export function analyticsPeriodDays(period: AnalyticsPeriod): number {
  return Number.parseInt(period, 10);
}

/** True when an event's time is accepted at `now`: not older than 7 days, not more than 1 hour ahead. */
export function isAnalyticsEventTimeAccepted(at: Date, now: Date): boolean {
  const time = at.getTime();
  if (Number.isNaN(time)) return false;
  return time >= now.getTime() - ANALYTICS_MAX_AGE_MS && time <= now.getTime() + ANALYTICS_MAX_FUTURE_MS;
}

/**
 * A percentage with one decimal, rounded half up, from a count and its denominator: 0 when the
 * denominator is 0.
 */
function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((1000 * numerator) / denominator) / 10;
}

/**
 * The engagement rate (published definition): the engaged visitors, those with at least one
 * impression AND at least one open in the period, as a percentage of Reach (the visitors with at
 * least one impression), one decimal. Engaged visitors are a part of Reach, so the rate never
 * exceeds 100. 0 when Reach is 0.
 */
export function engagementRate(engagedVisitors: number, reach: number): number {
  return percentage(engagedVisitors, reach);
}

/**
 * The click-through rate, CTR (published definition): Clicks as a percentage of Tale views, one
 * decimal. 0 when there are no views.
 */
export function ctr(clicks: number, taleViews: number): number {
  return percentage(clicks, taleViews);
}
