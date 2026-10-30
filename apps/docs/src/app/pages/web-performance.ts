import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SDK_BUDGET } from './sdk-budget.generated';

// The budget figures are read from SDK_BUDGET, the sizes the build measured
// (libs/web-sdk/scripts/measure-budget.mjs writes sdk-budget.generated.ts).
@Component({
  selector: 'docs-web-performance',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Performance</h1>
    <p class="lede">
      The Web SDK's size budget, what it loads and when, and how to check the numbers yourself. For every option and
      hook, read the <a routerLink="/reference/web-sdk">Web SDK reference</a>.
    </p>

    <h2 id="budget">Budget</h2>
    <p>
      The SDK's size is measured gzipped, from the build. The budget is the most the SDK may weigh; the measured value is
      from the build this page was written against.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="budget-caption">
      <table id="budget">
        <caption id="budget-caption">Size and request budget of the Web SDK</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Budget</th>
            <th scope="col">Measured</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ES module build (all its chunks: <code>index.js</code>, <code>core</code>, and the chunks loaded on first use), gzipped</td>
            <td>{{ budgetKb }} KB</td>
            <td>{{ esmKb }} KB</td>
          </tr>
          <tr>
            <td>UMD build (<code>index.umd.cjs</code>), gzipped</td>
            <td>{{ budgetKb }} KB</td>
            <td>{{ umdKb }} KB</td>
          </tr>
          <tr>
            <td>Script requests per page</td>
            <td>2</td>
            <td>2</td>
          </tr>
          <tr>
            <td>Zone requests per zone</td>
            <td>1</td>
            <td>1</td>
          </tr>
          <tr>
            <td>Third-party requests</td>
            <td>None</td>
            <td>None</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      The budget covers all of the SDK's script, gzipped (100 KB, all its chunks together). The page loads two script files:
      <code>index.js</code> and the <code>core</code> chunk it imports, which together hold the ring, the carousel and the
      rest the page needs. Four more chunks load the first time they are needed, so a display that does not use them never
      fetches them: the viewer and the renderers of tale documents (on the first open of a group), the banner's other
      variants (coverflow, peek, deck, sticky and strip, on the first banner that uses one), the bar's chip, poster and
      stack (on the first bar that uses one), and the poll views other than the sticker (embed, this-or-that, grid and
      inline, on the first tale that has one). Until its chunk arrives, a display shows its loading skeleton in the same space. The UMD build
      is one file that includes all of them. Each zone adds one request to the TaleArt API, and the page makes no call to
      any other host. Pictures load as described below.
    </p>

    <h2 id="loading">Loading rules</h2>
    <ul>
      <li>
        <strong>The script loads once per page.</strong> Put the script tag once, with <code>type="module"</code> (which
        defers it) or with <code>defer</code> or <code>async</code>. Several zones on one page share that one script.
      </li>
      <li>
        <strong>The zone call starts when the element connects.</strong> Each <code>&lt;taleart-view&gt;</code> requests its
        zone once it is added to the page, so a zone that is added later makes its request then.
      </li>
      <li>
        <strong>Media loads lazily.</strong> Covers and banner slide pictures start with <code>loading="lazy"</code> and
        load when they come within about 1,250 px of the window.
      </li>
    </ul>

    <h2 id="verify">How to verify</h2>
    <p>From the repository root, run the build's size check and the budget measurement:</p>
    <pre tabindex="0" role="region" aria-label="Budget command"><code>pnpm nx run web-sdk:measure-budget
pnpm nx run web-sdk:size</code></pre>
    <p>
      <code>measure-budget</code> builds the SDK, measures its gzipped ES and UMD builds, and writes
      <code>apps/docs/src/app/pages/sdk-budget.generated.ts</code>. <code>size</code> builds it and fails when the SDK is
      over the budget. To check the docs agree with the measurement, run the docs tests:
    </p>
    <pre tabindex="0" role="region" aria-label="Test command"><code>pnpm nx test docs</code></pre>
    <p>
      The numbers above are read from the measured file the build writes, so they change with each measurement.
      To check the requests yourself, open your page with the browser's developer tools on the Network tab: one script
      request, one request per zone, and no request to another host.
    </p>
  `,
})
export class WebPerformancePage {
  protected readonly budgetKb = SDK_BUDGET.budgetKb;
  protected readonly esmKb = SDK_BUDGET.esmGzipKb.toFixed(2);
  protected readonly umdKb = SDK_BUDGET.umdGzipKb.toFixed(2);
}
