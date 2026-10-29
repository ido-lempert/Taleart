import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The metric definitions, as the dashboard's Analytics tab shows them (apps/dashboard/src/app/pages/
 * analytics-definitions.ts). The spec checks this text against that file, so keep the wording in step.
 */
export const ANALYTICS_METRICS = [
  { label: 'Impressions', definition: 'Number of impression events.' },
  { label: 'Reach', definition: 'Distinct visitors with at least one impression in the period.' },
  { label: 'Opens', definition: 'Number of open events.' },
  { label: 'Tale views', definition: 'Number of view events.' },
  { label: 'Clicks', definition: 'Number of click events.' },
  {
    label: 'Engagement rate',
    definition:
      "Engaged visitors ÷ Reach, as a percentage, one decimal, where engaged visitors are the distinct visitors with at least one impression AND at least one open in the period (the same group, for a group's row). Engaged visitors are part of Reach, so the rate never exceeds 100. 0 when Reach is 0.",
  },
  { label: 'CTR (click-through rate)', definition: 'Clicks ÷ Tale views, as a percentage, one decimal. 0 when there are no views.' },
] as const;

/** The period note under the Analytics tab's picker, and the note under its tables: the same wording as the tab. */
export const ANALYTICS_PERIOD_NOTE = 'UTC days, today included.';
export const ANALYTICS_REACH_NOTE = 'Reach is distinct per row: the Reach of a total is not the sum of its rows.';

@Component({
  selector: 'docs-analytics-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Analytics reference</h1>
    <p class="lede">
      What the zone's Analytics tab counts, how the Web SDK sends the events, what is stored and what is never sent, how to
      turn sending off, and the two API endpoints behind the numbers. For the steps to read the tab, see the
      <a routerLink="/guides/analytics">Read your analytics</a> guide.
    </p>

    <h2 id="metrics">Metrics</h2>
    <p>
      The Analytics tab shows these seven metrics for a period of the last 7, 30 or 90 days ({{ periodNote }}). Each
      definition is the published one: the tab shows the same text.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="metrics-caption">
      <table id="metrics">
        <caption id="metrics-caption">Metric definitions</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Definition</th>
          </tr>
        </thead>
        <tbody>
          @for (metric of metrics; track metric.label) {
          <tr>
            <th scope="row">{{ metric.label }}</th>
            <td>{{ metric.definition }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>
    <p>{{ reachNote }}</p>
    <p>
      The engagement rate is the visitors who both saw a group (an impression) and opened it (an open), divided by Reach.
      Read per group, each group's row counts its own impressions and opens.
    </p>

    <h2 id="events">Events</h2>
    <p>
      The Web SDK sends four event types. Each carries its type, its tale group's id, its tale's id (views and clicks
      only) and the time in UTC. The Delivery API accepts only these four (<code>impression</code>, <code>open</code>,
      <code>view</code> and <code>click</code>).
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="events-caption">
      <table id="events">
        <caption id="events-caption">Events the Web SDK sends</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">When it is sent</th>
            <th scope="col">Ids it carries</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>impression</code></td>
            <td>A tale group's circle or banner is half on screen for the first time in a render. The same moment as the <code>onGroupImpression</code> hook.</td>
            <td>Group</td>
          </tr>
          <tr>
            <td><code>open</code></td>
            <td>The viewer opens the tale group.</td>
            <td>Group</td>
          </tr>
          <tr>
            <td><code>view</code></td>
            <td>A tale is shown in the viewer. The same moment as the <code>onTaleShown</code> hook.</td>
            <td>Group and tale</td>
          </tr>
          <tr>
            <td><code>click</code></td>
            <td>A tale's button, image button or swipe-up link is activated, whether or not the host cancels the navigation. The same moment as the <code>onActionClicked</code> hook.</td>
            <td>Group and tale</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      An answer to an interactive component (a reaction, for one) is not an event: the responses store counts it, not the
      analytics store.
    </p>

    <h2 id="privacy">What is stored and what is never sent</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="privacy-caption">
      <table id="privacy">
        <caption id="privacy-caption">Stored and not sent</caption>
        <thead>
          <tr>
            <th scope="col">Stored for each event</th>
            <th scope="col">Never sent, never stored</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              The zone, the tale group and (for views and clicks) the tale; the event type; the time in UTC; and the
              visitor, as a hash: SHA-256 of the project id and the visitor id. The hash is per project, so the same visitor
              does not link across projects, and the raw visitor id is not stored.
            </td>
            <td>
              The external user id, tags and user attributes; the IP address; the user agent; and anything else from the
              page. Raw events are kept 400 days, then deleted.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="opt-out">Turn sending off</h2>
    <p>
      Analytics are on by default. Turn them off for the whole page with the SDK's option, or for one element with its
      attribute. The element's attribute wins: any value other than <code>off</code> leaves the element to the option.
    </p>
    <pre tabindex="0" role="region" aria-label="Turn analytics off for the page"><code>{{ optOutSample }}</code></pre>
    <pre tabindex="0" role="region" aria-label="Turn analytics off for one element"><code>{{ optOutElementSample }}</code></pre>
    <p>
      The option is <code>analytics</code> (default <code>true</code>) and the attribute is <code>analytics</code>. Both are
      in the <a routerLink="/reference/web-sdk">Web SDK reference</a>.
    </p>

    <h2 id="batching">Batching and sending</h2>
    <p>
      The SDK keeps events in memory and sends them together: every 5 seconds while any wait, when 20 are waiting, and when
      the page is hidden. The page-hidden send uses <code>navigator.sendBeacon</code>, which cannot set headers, so the
      beacon carries the zone key as a <code>key</code> field and the visitor id as a <code>visitor</code> field of its
      body; the Delivery API accepts those two fields on this endpoint only. A failed send is retried once, then dropped
      without a message. A zone that failed to load sends nothing, and so does the Tale Studio preview.
    </p>

    <h2 id="delivery">Delivery endpoint</h2>
    <p>
      <code>POST /delivery/v1/events</code> takes a batch of events with a zone key. The SDK calls it; a server can call it
      too, with the same rules.
    </p>
    <pre tabindex="0" role="region" aria-label="Request body"><code>{{ deliverySample }}</code></pre>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="delivery-caption">
      <table id="delivery-limits">
        <caption id="delivery-caption">Limits and answers of POST /delivery/v1/events</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Authorization</td>
            <td>
              <code>Bearer tak_…</code>, the zone key. A site key, a revoked key or no key answers 401 <code>invalid_site_key</code>.
            </td>
          </tr>
          <tr>
            <td>Visitor id</td>
            <td>
              The <code>X-TaleArt-Visitor</code> header (a lowercase UUID), or the <code>visitor</code> field of a beacon. Missing
              or invalid answers 400 <code>visitor_id_required</code>.
            </td>
          </tr>
          <tr>
            <td>Events per request</td>
            <td>At most 50. More answers 400 <code>validation_failed</code>, and the body is at most 32 KB.</td>
          </tr>
          <tr>
            <td>Accepted time</td>
            <td>
              Not older than 7 days and not more than 1 hour in the future (UTC, <code>Z</code> required). An event outside
              the window is dropped.
            </td>
          </tr>
          <tr>
            <td>Checked per event</td>
            <td>
              The four fields only; a known type; a tale id for views and clicks, none for the others; and a group, and a
              tale, placed in the key's zone. An event that fails is dropped.
            </td>
          </tr>
          <tr>
            <td>Rate limit</td>
            <td>
              Per visitor: a burst of 30 requests, refilled at one request every 2 seconds. Over the limit answers 429
              <code>rate_limited</code> with <code>Retry-After</code>.
            </td>
          </tr>
          <tr>
            <td>Answer</td>
            <td>
              202 with <code>&#123; "accepted": n, "dropped": m &#125;</code>: the events kept and the events dropped.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="management">Management endpoint</h2>
    <p>
      <code>GET /zones/&#123;zoneId&#125;/analytics?period=7d|30d|90d</code> returns a zone's metrics, for a project member.
      The period defaults to <code>30d</code>. A zone the caller cannot reach, and an unknown one, answer 404
      <code>zone_not_found</code>. The Analytics tab reads this endpoint.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="response-caption">
      <table id="response-fields">
        <caption id="response-caption">Fields of the response</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>period</code></td>
            <td>String</td>
            <td><code>7d</code>, <code>30d</code> or <code>90d</code>.</td>
          </tr>
          <tr>
            <td><code>totals</code></td>
            <td>Object</td>
            <td>
              The seven metrics of the period: <code>impressions</code>, <code>reach</code>, <code>opens</code>,
              <code>taleViews</code>, <code>clicks</code>, <code>engagementRate</code> and <code>ctr</code>. Rates are
              percentages with one decimal.
            </td>
          </tr>
          <tr>
            <td><code>daily</code></td>
            <td>Array</td>
            <td>
              One entry per UTC day, oldest first: <code>date</code> (<code>YYYY-MM-DD</code>), <code>impressions</code>,
              <code>clicks</code>, <code>opens</code> and <code>taleViews</code>. A day with no events is zero.
            </td>
          </tr>
          <tr>
            <td><code>groups</code></td>
            <td>Array</td>
            <td>
              One row per tale group with events, most impressions first: <code>groupId</code>, <code>name</code> and the
              seven metrics for that group.
            </td>
          </tr>
          <tr>
            <td><code>tales</code></td>
            <td>Array</td>
            <td>
              One row per tale with views or clicks, most views first: <code>taleId</code>, <code>name</code>,
              <code>groupId</code>, <code>taleViews</code>, <code>clicks</code> and <code>ctr</code>. Its
              <code>impressions</code>, <code>reach</code>, <code>opens</code> and <code>engagementRate</code> are
              <code>null</code>: they name a group, not a tale.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>{{ reachNote }} Days and rows are counted in UTC.</p>

    <h2 id="retention">Retention and limits</h2>
    <ul>
      <li>Raw events are kept 400 days, then deleted by the retention job. The metrics are counted from them.</li>
      <li>The Web SDK sends events. The Android and iOS SDKs do not send analytics events yet, so their visitors are not counted.</li>
      <li>There is no per-group endpoint for analytics yet: the rows of <code>GET /zones/&#123;zoneId&#125;/analytics</code> are the group figures.</li>
    </ul>
  `,
})
export class AnalyticsReferencePage {
  protected readonly metrics = ANALYTICS_METRICS;
  protected readonly periodNote = ANALYTICS_PERIOD_NOTE;
  protected readonly reachNote = ANALYTICS_REACH_NOTE;
  protected readonly optOutSample = `Taleart.init({ analytics: false });`;
  protected readonly optOutElementSample = `<taleart-view zone-key="YOUR_ZONE_KEY" analytics="off"></taleart-view>`;
  protected readonly deliverySample = `POST /delivery/v1/events
Authorization: Bearer tak_…
X-TaleArt-Visitor: 3f1c9a52-7d4e-4b8a-9c21-6e0f5a8d2b47
Content-Type: application/json

{
  "events": [
    { "type": "impression", "groupId": "…", "at": "2026-10-29T09:15:02.418Z" },
    { "type": "open", "groupId": "…", "at": "2026-10-29T09:15:09.007Z" },
    { "type": "view", "groupId": "…", "taleId": "…", "at": "2026-10-29T09:15:10.330Z" },
    { "type": "click", "groupId": "…", "taleId": "…", "at": "2026-10-29T09:15:18.764Z" }
  ]
}`;
}
