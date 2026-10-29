# Analytics (epic 6, 2026-10-29)

Source of truth for the analytics build. Decisions by the main agent, from the owner's choice "dashboard with published metric definitions".

## Principles
- Privacy (AD-13): events carry zone, group and tale ids, an event type and a timestamp, plus the SDK's anonymous visitor id. Never the external user id, tags, user attributes, IP or user agent. Reach counts distinct anonymous visitor ids.
- Visitor ids are stored only as the SHA-256 hash of `projectId + ':' + visitorId` (so ids do not link across projects); raw ids are never stored.
- Sending is on by default and off with `Taleart.init({ analytics: false })` or the attribute `analytics="off"` on an element (element wins). Native: `TaleartConfig.analytics`.
- Events are accepted only with a zone key; a revoked key gets the same 401 as everywhere. Events older than 7 days or more than 1 hour in the future are dropped. Retention of raw events: 400 days.

## Events (sent by the SDK)
| type | when | ids |
|---|---|---|
| `impression` | a tale group's circle/banner is visible in the viewport for the first time in a render (same moment as `onGroupImpression`) | group |
| `open` | the viewer opens on a group | group |
| `view` | a tale is shown in the viewer (same moment as `onTaleShown`) | group, tale |
| `click` | a tale's button, image button or swipe-up link is activated (same moment as `onActionClicked`, whether or not the host cancels it) | group, tale |
| `answer` | already stored in responses; NOT sent as an event (counted from the responses store) | |

## Metrics (published definitions; the docs page `/reference/analytics` shows them verbatim)
- **Impressions**: number of `impression` events.
- **Reach**: distinct visitors with at least one `impression` in the period.
- **Opens**: number of `open` events.
- **Tale views**: number of `view` events.
- **Clicks**: number of `click` events.
- **Engagement rate**: engaged visitors ÷ Reach, as a percentage, one decimal, where engaged visitors are the distinct visitors with at least one `impression` AND at least one `open` in the period (the same group, for a group's row). Engaged visitors are part of Reach, so the rate never exceeds 100. 0 when Reach is 0.
- **CTR (click-through rate)**: Clicks ÷ Tale views, as a percentage, one decimal. 0 when there are no views.
- Periods: last 7, 30, 90 days (UTC days). Breakdown by day, by zone, by tale group, by tale. Reach is distinct per row, so Reach of a total is not the sum of its rows (docs say so).

## Delivery API
`POST /delivery/v1/events`, zone-key bearer, body `{ "events": [ { "type", "groupId", "taleId?", "at" (ISO UTC) } ] }`, max 50 events per request, 202 with `{ accepted, dropped }`.
- Beacon decisions (2026-10-29): `navigator.sendBeacon` cannot set headers, so a beacon sends the zone key as a `key` field and its visitor id as a `visitor` field of the body. Both fields are accepted only on this endpoint; the header `X-TaleArt-Visitor` stays the normal way to send the visitor id. A beacon's body is accepted as `text/plain` as well as `application/json`, the type a string body is sent as (no CORS preflight). Rate-limited per visitor like responses (stricter than reads). The visitor id comes from the existing header. Unknown group/tale ids (not in the key's zone) count as dropped.

## Management API
`GET /zones/{zoneId}/analytics?period=7d|30d|90d` → totals + per-day series + per-group rows + per-tale rows (all the metrics above). Auth like other management reads (project member). `GET /tale-groups/{id}/analytics` is NOT in this batch.

## Web SDK
- Queue in memory, flush every 5 s, when 20 events are queued, and on `pagehide`/`visibilitychange=hidden` via `navigator.sendBeacon` (fetch keepalive fallback; Authorization cannot be set on a beacon, so the beacon path sends the key as a `key` field in the JSON body and the server accepts it only on this endpoint). Failures are dropped silently (never retried forever, never block the UI). Honour `Taleart.init({ analytics: false })`.
- No new hook: existing hooks stay. Add the `analytics` option/attribute to README and reference tables.

## Dashboard
A zone "Analytics" tab: period picker, six metric tiles with an info link to each definition, a daily line chart (impressions and clicks), tables by group and by tale, empty state explaining how data arrives, a link to the published definitions.

## Docs
`/reference/analytics` (definitions table + event table + privacy section + opt-out), a guide section on reading the analytics tab with real screenshots, SDK reference rows for `analytics`.

## Native
Out of scope for this batch (documented as not sending events yet).
