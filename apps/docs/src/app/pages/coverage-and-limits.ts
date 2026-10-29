import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-coverage-and-limits',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Coverage and limits</h1>
<p>What these docs cover, and what was not found in the current source. "Not found" means the repository has no such feature today. It does not say the feature will never exist.</p>
<h2 id="covered">Covered</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Area</th>
<th>Where</th>
</tr>
</thead>
<tbody>
<tr>
<td>Concepts and glossary</td>
<td><a routerLink="/concepts">Concepts</a></td>
</tr>
<tr>
<td>Install and first campaign</td>
<td><a routerLink="/guides-install">Install TaleArt locally</a>, <a routerLink="/guides-create-campaign">Create a campaign</a></td>
</tr>
<tr>
<td>Zones, bars and banners</td>
<td><a routerLink="/zones-and-displays">Zones and displays</a></td>
</tr>
<tr>
<td>Tale groups, tales, scheduling</td>
<td><a routerLink="/tale-groups-and-tales">Tale groups and tales</a></td>
</tr>
<tr>
<td>Editor and elements</td>
<td><a routerLink="/tale-studio">Tale Studio</a></td>
</tr>
<tr>
<td>Poll, quiz, rating</td>
<td><a routerLink="/interactive-components">Interactive components</a></td>
</tr>
<tr>
<td>Look and fonts</td>
<td><a routerLink="/theme-and-fonts">Theme and fonts</a></td>
</tr>
<tr>
<td>Targeting</td>
<td><a routerLink="/targeting">Targeting</a></td>
</tr>
<tr>
<td>Web, Android, iOS</td>
<td><a routerLink="/guides-web-sdk">Web SDK</a>, <a routerLink="/guides-android-sdk">Android SDK</a>, <a routerLink="/guides-ios-sdk">iOS SDK</a></td>
</tr>
<tr>
<td>API, tokens, CLI, agents</td>
<td><a routerLink="/api-tokens">API tokens</a>, <a routerLink="/api-reference">API reference</a>, <a routerLink="/cli">Command-line tool</a>, <a routerLink="/ai-agents">AI agents</a></td>
</tr>
</tbody>
</table></div>
<h2 id="not-found-in-the-current-source">Not found in the current source</h2>
<ul>
<li>Product feeds and shoppable content.</li>
<li>Multi-step flows and other widget types beyond the bar and the banner.</li>
<li>Integrations with marketing platforms.</li>
<li>React Native and Flutter SDKs.</li>
<li>Charts of interactive answers. The Analytics tab counts impressions, opens, views and clicks; answers are read through the API or the Tale Studio's Responses panel.</li>
</ul>
<h2 id="verification-limits">Verification limits</h2>
<ul>
<li>The Android and iOS guides are reviewed against the source. They were not run on a device or emulator, and no published artifact was confirmed.</li>
<li>The install guide documents <code>npx nx serve dashboard</code>, but it was not completed on the test machine (it needs JVM 17 or later). The tested path is listed in the guide.</li>
<li>Only the Heading element in Tale Studio was exercised by hand.</li>
<li>The furniture pictures are AI-generated samples, not real products.</li>
</ul>
  `,
})
export class CoverageAndLimitsPage {}
