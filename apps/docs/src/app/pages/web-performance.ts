import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

// The budget figures are the sizes the build measures (libs/web-sdk/scripts/measure-budget.mjs). They are
// written here as numbers, and web-performance.spec.ts fails when they differ from SDK_BUDGET in
// sdk-budget.generated.ts: after a new measurement, change both.
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
            <td>ES module build (<code>index.js</code>), gzipped</td>
            <td>50 KB</td>
            <td>35.32 KB</td>
          </tr>
          <tr>
            <td>UMD build (<code>index.umd.cjs</code>), gzipped</td>
            <td>50 KB</td>
            <td>32.25 KB</td>
          </tr>
          <tr>
            <td>Script requests per page</td>
            <td>1</td>
            <td>1</td>
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
      The budget covers all of the SDK's script, gzipped. Each zone adds one request to the TaleArt API, and the page
      makes no call to any other host. Pictures load as described below.
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
    <pre><code>pnpm nx run web-sdk:measure-budget
pnpm nx run web-sdk:size</code></pre>
    <p>
      <code>measure-budget</code> builds the SDK, measures its gzipped ES and UMD builds, and writes
      <code>apps/docs/src/app/pages/sdk-budget.generated.ts</code>. <code>size</code> builds it and fails when the SDK is
      over the budget. To check the docs agree with the measurement, run the docs tests:
    </p>
    <pre><code>pnpm nx test docs</code></pre>
    <p>
      The docs test <em>web-performance.spec.ts</em> fails when a number on this page differs from the generated file.
      To check the requests yourself, open your page with the browser's developer tools on the Network tab: one script
      request, one request per zone, and no request to another host.
    </p>
  `,
})
export class WebPerformancePage {}
