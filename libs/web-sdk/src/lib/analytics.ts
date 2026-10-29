// Analytics (spec 2026-10-29, Web SDK): the element's impressions, opens, tale views and clicks, queued in
// memory per API origin and zone key and sent to the Delivery API's `POST /events`. An event carries only
// its type, its group id, its tale id (views and clicks) and its time; the request carries the zone key
// and this browser's visitor id. Nothing else is sent (no external user id, tags or page data).
import { DELIVERY_API_BASE, MAX_ANALYTICS_EVENTS_PER_REQUEST, type AnalyticsEventType } from '@taleart/contract';
import { VISITOR_HEADER, visitorId } from './visitor';

/** A queue that holds events this long is sent (the timer runs only while the queue is not empty). */
export const ANALYTICS_FLUSH_MS = 5000;
/** A queue that reaches this many events is sent at once. */
export const ANALYTICS_FLUSH_AT = 20;
/** The most events a queue holds; past it the oldest go first, so a queue never grows without bound. */
export const ANALYTICS_QUEUE_CAP = 200;

/** Where events go: the API origin and the zone key of the element that saw them. */
export interface AnalyticsTarget {
  apiUrl: string;
  key: string;
}

/** An event as the element records it: its type, its group, and its tale for a view or a click. */
export interface AnalyticsEventInput {
  type: AnalyticsEventType;
  groupId: string;
  taleId?: string;
}

// The event as it is sent: exactly these four fields, `taleId` only where the type names a tale.
interface AnalyticsEvent {
  type: AnalyticsEventType;
  groupId: string;
  taleId?: string;
  at: string;
}

// An event waiting to be sent; `attempts` counts the sends that failed (one retry, then it is dropped).
interface Pending {
  event: AnalyticsEvent;
  attempts: number;
}

interface Queue {
  readonly apiUrl: string;
  readonly key: string;
  items: Pending[];
  timer: ReturnType<typeof setTimeout> | null;
}

const queues = new Map<string, Queue>();
let listening = false;

/**
 * Queues one event for the zone of `target`. The queue is sent when it reaches
 * {@link ANALYTICS_FLUSH_AT} events, or {@link ANALYTICS_FLUSH_MS} after its first queued event, and when
 * the page is hidden. Nothing is reported to the caller: a failure is dropped silently.
 */
export function recordAnalyticsEvent(target: AnalyticsTarget, input: AnalyticsEventInput): void {
  listenForPageHide();
  const queue = queueFor(target);
  const event: AnalyticsEvent =
    input.taleId === undefined
      ? { type: input.type, groupId: input.groupId, at: new Date().toISOString() }
      : { type: input.type, groupId: input.groupId, taleId: input.taleId, at: new Date().toISOString() };
  queue.items.push({ event, attempts: 0 });
  trim(queue);
  if (queue.items.length >= ANALYTICS_FLUSH_AT) flush(queue, false);
  else arm(queue);
}

/** Forgets every queue and timer, for tests. */
export function resetAnalyticsForTests(): void {
  for (const queue of queues.values()) {
    if (queue.timer !== null) clearTimeout(queue.timer);
    queue.timer = null;
  }
  queues.clear();
}

function queueFor(target: AnalyticsTarget): Queue {
  const id = `${target.apiUrl}\n${target.key}`;
  let queue = queues.get(id);
  if (!queue) {
    queue = { apiUrl: target.apiUrl, key: target.key, items: [], timer: null };
    queues.set(id, queue);
  }
  return queue;
}

// The queue's timer runs only while it holds events, so an idle SDK has no timer at all.
function arm(queue: Queue): void {
  if (queue.timer !== null || queue.items.length === 0) return;
  queue.timer = setTimeout(() => {
    queue.timer = null;
    flush(queue, false);
  }, ANALYTICS_FLUSH_MS);
  // Node-style timers do not keep a process alive; a browser's number has no unref.
  (queue.timer as unknown as { unref?: () => void } | null)?.unref?.();
}

function trim(queue: Queue): void {
  const excess = queue.items.length - ANALYTICS_QUEUE_CAP;
  if (excess > 0) queue.items.splice(0, excess);
}

// Sends everything queued, in requests of at most MAX_ANALYTICS_EVENTS_PER_REQUEST events. A beacon
// (the page is going away) gets no retry.
function flush(queue: Queue, beacon: boolean): void {
  if (queue.timer !== null) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  const batch = queue.items.splice(0, queue.items.length);
  for (let start = 0; start < batch.length; start += MAX_ANALYTICS_EVENTS_PER_REQUEST) {
    send(queue, batch.slice(start, start + MAX_ANALYTICS_EVENTS_PER_REQUEST), beacon);
  }
}

// One request: a beacon when asked and the browser takes it, else a fetch (with keepalive for a beacon's
// fallback, so it outlives the page). A failed fetch of a normal flush puts its events back once.
function send(queue: Queue, batch: Pending[], beacon: boolean): void {
  const url = `${queue.apiUrl}${DELIVERY_API_BASE}/events`;
  const events = batch.map((pending) => pending.event);
  const visitor = visitorId();
  if (beacon && beaconSend(url, JSON.stringify({ key: queue.key, visitor, events }))) return;
  const retry = beacon ? undefined : () => requeue(queue, batch);
  fetchSend(url, queue.key, visitor, events, beacon, retry);
}

// The body is a string, so the beacon goes as text/plain: no CORS preflight.
function beaconSend(url: string, body: string): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body);
  } catch {
    return false;
  }
}

function fetchSend(
  url: string,
  key: string,
  visitor: string,
  events: AnalyticsEvent[],
  keepalive: boolean,
  onFailure: (() => void) | undefined,
): void {
  const fail = () => onFailure?.();
  try {
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, [VISITOR_HEADER]: visitor, 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      credentials: 'omit',
      keepalive,
    }).then((res) => {
      if (!res.ok) fail();
    }, fail);
  } catch {
    fail();
  }
}

// Puts the events of a failed send back once, ahead of the newer ones; those that already failed once are dropped.
function requeue(queue: Queue, batch: Pending[]): void {
  const again = batch.filter((pending) => pending.attempts === 0).map((pending) => ({ event: pending.event, attempts: 1 }));
  if (again.length === 0) return;
  queue.items.unshift(...again);
  trim(queue);
  arm(queue);
}

// Sends every queue when the page is hidden or closed, by beacon.
function flushAll(): void {
  for (const queue of queues.values()) flush(queue, true);
}

function listenForPageHide(): void {
  if (listening || typeof window === 'undefined' || typeof document === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}
