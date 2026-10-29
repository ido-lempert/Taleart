import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EXAMPLE_INSTALL } from '../docs-content';

const OPT_OUT_SAMPLE = `import { init } from '${EXAMPLE_INSTALL.sdkUrl}';

// Off for every element on the page:
init({ analytics: false });`;

const OPT_OUT_ELEMENT_SAMPLE = `<!-- Off for this element only; any other value, or none, leaves it to the page: -->
<taleart-view zone-key="YOUR_ZONE_KEY" analytics="off"></taleart-view>`;

@Component({
  selector: 'docs-analytics-guide',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Read your analytics</h1>
    <p class="lede">
      This guide reads a zone's Analytics tab, step by step: the period, the metric tiles and their definitions, the chart
      and the tables, and the empty state with the opt-out. The tab counts what the Web SDK sends from a page, so the zone
      must be on a page first (see the <a routerLink="/guides/web">Web guide</a>). The definitions and the event rules are
      in the <a routerLink="/reference/analytics">Analytics reference</a>.
    </p>

    <ol class="steps">
      <li>
        <strong>Open the zone's Analytics tab and choose the period.</strong> On the zone page, select the
        <em>Analytics</em> tab. The period picker sets the window: the last 7, 30 or 90 days, in UTC days with today
        included. The default is 30 days, and the choice stays in the address (<code>?period=7d</code>), so a reload or
        a shared link shows the same window.
        <figure>
          <img
            src="/images/analytics-shot-tab.png"
            alt="The Analytics tab of a zone with 30 days chosen: seven metric tiles across the top with their numbers, and below them a line chart of daily impressions and clicks that rises through the month and peaks on a launch day."
            width="980"
            height="829"
          />
          <figcaption>
            The Analytics tab, a real screenshot of the dashboard with a sample zone's events. The numbers are the sample's.
          </figcaption>
        </figure>
      </li>

      <li>
        <strong>Read a tile, and open its definition.</strong> Each tile shows one metric of the period. Under each tile,
        <em>Definition</em> opens the published definition, the same text as the
        <a routerLink="/reference/analytics">Analytics reference</a>. Engagement rate, for one, is the engaged visitors
        divided by Reach, and the tile says so.
        <figure>
          <img
            src="/images/analytics-shot-definition.png"
            alt="The metric tiles with the Engagement rate tile's Definition open. It reads: engaged visitors divided by Reach, as a percentage, one decimal, where engaged visitors are the distinct visitors with at least one impression and at least one open in the period."
            width="930"
            height="460"
          />
          <figcaption>The Engagement rate tile with its definition open, a real screenshot of the dashboard.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Read the tables by tale group and by tale.</strong> The chart plots impressions and clicks by UTC day, and a
        day's counts show when you point at it. Under it, <em>By tale group</em> gives each group's figures, and
        <em>By tale</em> gives each tale's views and clicks. A dash means the count is not kept per tale: impressions,
        reach, opens and engagement name a group. Reach is distinct per row, so a total is not the sum of its rows.
        <figure>
          <img
            src="/images/analytics-shot-tables.png"
            alt="Two tables. By tale group lists four groups with impressions, reach, opens, tale views, clicks, engagement rate and CTR. By tale lists tales with their group, a dash where a group-level count does not apply, views, clicks and CTR."
            width="930"
            height="721"
          />
          <figcaption>The two tables of a period, a real screenshot of the dashboard with the sample zone.</figcaption>
        </figure>
      </li>

      <li>
        <strong>When nothing is counted yet, or to turn sending off.</strong> Until a visitor sees a tale group, the tab
        shows <em>No events yet</em> and every count stays at zero. Sending is on by default. Turn it off for the whole
        page with <code>analytics: false</code> in <code>init</code>, or for one element with <code>analytics="off"</code>;
        the element's attribute wins.
        <pre tabindex="0" role="region" aria-label="Turn analytics off for the page"><code>{{ optOutSample }}</code></pre>
        <pre tabindex="0" role="region" aria-label="Turn analytics off for one element"><code>{{ optOutElementSample }}</code></pre>
        <figure>
          <img
            src="/images/analytics-shot-empty.png"
            alt="The Analytics tab of a zone with no events: the heading No events yet, a paragraph that says the counts stay at zero until a visitor sees a tale group, and the note on setting analytics off on the element or with Taleart.init."
            width="980"
            height="406"
          />
          <figcaption>
            The empty state of a zone with no events, a real screenshot of the dashboard. It names the same opt-out as the
            snippets above.
          </figcaption>
        </figure>
      </li>
    </ol>

    <h2>Where the numbers come from</h2>
    <p>
      The Web SDK sends four events: an impression when a group is half on screen, an open, a view of a tale and a click
      on a tale's button. Events are sent in batches. The Delivery API accepts an event up to 7 days after it happened, and
      the counts are kept for 400 days, so every period the tab offers is counted from stored events. The Android and iOS
      SDKs do not send analytics events yet, so the tab counts the web only. The full rules, the endpoints and the stored fields are in the
      <a routerLink="/reference/analytics">Analytics reference</a>.
    </p>
  `,
})
export class AnalyticsGuidePage {
  protected readonly optOutSample = OPT_OUT_SAMPLE;
  protected readonly optOutElementSample = OPT_OUT_ELEMENT_SAMPLE;
}
