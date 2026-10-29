import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-visibility',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Visibility and troubleshooting</h1>
<p>Every zone, group and tale says <strong>Visible on site</strong>, or <strong>Not visible</strong> with the first reason. Check this before you debug the page.</p>
<h2 id="what-must-be-true">What must be true</h2>
<p>A visitor sees a group only when all of these hold:</p>
<ol>
<li>The zone has a display.</li>
<li>The project has an active site key, and the page uses it.</li>
<li>The group is <strong>On</strong> (not Off, paused or archived).</li>
<li>The group is placed in the zone.</li>
<li>The group has at least one <strong>Shown</strong> tale.</li>
<li>Now is inside the group's schedule, if it has one.</li>
<li>The visitor matches the group's tags and user lists, if it has any.</li>
</ol>
<p><img class="guide-img" alt="Not visible: group is off" src="guides/images/22-groups-visibility.png" /></p>
<h2 id="common-cases">Common cases</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Symptom</th>
<th>Check</th>
</tr>
</thead>
<tbody>
<tr>
<td>Nothing renders and the console shows one error</td>
<td>The slug is wrong, or the site key was rotated or revoked.</td>
</tr>
<tr>
<td>The zone says "group is off"</td>
<td>Turn the group On.</td>
</tr>
<tr>
<td>The zone is visible in the dashboard but not on one visitor's page</td>
<td>Tags or a user list may exclude that visitor.</td>
</tr>
<tr>
<td>An edit does not show</td>
<td>In Tale Studio, click <strong>Update tale</strong>.</td>
</tr>
<tr>
<td>Text is hard to read</td>
<td>Fix the contrast warning in Tale Studio.</td>
</tr>
</tbody>
</table></div>
<p>The <a routerLink="/install">test page</a> renders one zone with the SDK and asks for the site key. It is the quickest way to tell a page problem from a content problem.</p>
  `,
})
export class VisibilityPage {}
