import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-tale-groups-and-tales',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Tale groups and tales</h1>
<p>A <strong>tale group</strong> is one circle in a bar (or one card in a banner). A <strong>tale</strong> is one full-screen page inside a group. A visitor taps a group and moves through its tales.</p>
<h2 id="create-a-group">Create a group</h2>
<p><strong>Tale groups</strong>, then <strong>New tale group</strong>. Name it and upload images or videos. Each file becomes one tale. New tales are <strong>Shown</strong>. New groups are <strong>Off</strong>: turn the group <strong>On</strong> to publish it.</p>
<p><img class="guide-img" alt="The tale group list" src="guides/images/04-tale-groups.png" /></p>
<h2 id="group-states">Group states</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>State</th>
<th>Meaning</th>
</tr>
</thead>
<tbody>
<tr>
<td>Draft (Off)</td>
<td>Not shown anywhere. Every new group starts here.</td>
</tr>
<tr>
<td>Live (On)</td>
<td>Shown in each zone it is placed in, if the other conditions hold.</td>
</tr>
<tr>
<td>Paused</td>
<td>Kept in its zones but not shown.</td>
</tr>
<tr>
<td>Archived</td>
<td>Removed from every list and from the site.</td>
</tr>
</tbody>
</table></div>
<p>The filter chips on the list (All, Visible, Off, Scheduled, Targeted, Not in a zone, Archived) count groups by state.</p>
<h2 id="the-group-menu">The group menu</h2>
<p>The <strong>...</strong> menu on each group has:</p>
<ul>
<li><strong>Rename</strong> and <strong>Cover</strong>: a still image, or an animated cover of at most 300 KB.</li>
<li><strong>Audience</strong>: tags and user lists. See <a routerLink="/targeting">Targeting</a>.</li>
<li><strong>Schedule</strong>: a start and an end time. Leave a field empty for no start or no end. The panel shows the time zone it uses.</li>
<li><strong>Show in another zone</strong>: place the same group in more than one zone. An edit shows in every zone.</li>
<li><strong>Copy to zone</strong>: make an independent copy. Later edits do not carry over.</li>
<li><strong>Archive</strong>.</li>
</ul>
<p><img class="guide-img" alt="The group menu" src="guides/images/16-group-menu.png" />
<img class="guide-img" alt="The Schedule panel" src="guides/images/17-schedule.png" /></p>
<h2 id="tales">Tales</h2>
<p>Open a group to see its tales. Use <strong>Add tale</strong> to add more. Click a tale to open its panel: <strong>Shown</strong> or <strong>Hidden</strong>, <strong>Archive</strong>, <strong>Delete</strong>, <strong>Replace media</strong> and <strong>Edit in Tale Studio</strong>. Reorder groups and tales by dragging. A tale can have its own schedule too.</p>
<p><img class="guide-img" alt="Tale group page" src="guides/images/09-tale-group.png" />
<img class="guide-img" alt="Tale panel" src="guides/images/10-tale-panel.png" /></p>
<h2 id="limits">Limits</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>What</th>
<th>Limit</th>
</tr>
</thead>
<tbody>
<tr>
<td>Tales per group</td>
<td>100</td>
</tr>
<tr>
<td>Tale groups per project</td>
<td>500</td>
</tr>
<tr>
<td>Image upload</td>
<td>10 MB</td>
</tr>
<tr>
<td>Video upload</td>
<td>100 MB</td>
</tr>
<tr>
<td>Animated cover</td>
<td>300 KB</td>
</tr>
</tbody>
</table></div>
  `,
})
export class TaleGroupsAndTalesPage {}
