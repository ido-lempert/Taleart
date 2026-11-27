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
<p><strong>New tale group</strong> is on the zone page and on the <strong>Tale groups</strong> page. It makes a draft group with one draft tale and opens that tale in <a routerLink="/tale-studio">Tale Studio</a>. Give the tale its image or video as its background, then click <strong>Update tale</strong>.</p>
<p>When you leave Tale Studio, a <strong>Tale group</strong> drawer asks for the group's name and, if you like, its zone. <strong>Done</strong> keeps the group as a draft; <strong>Discard group</strong> takes it out of its zone and archives it. New tales are <strong>Shown</strong>. New groups are <strong>Off</strong>: turn the group <strong>On</strong> to publish it.</p>
<p><img class="guide-img" alt="The tale group list" src="guides/images/04-tale-groups.png" width="1280" height="800" /></p>
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
<h2 id="select-several">Select several groups</h2>
<p>Select several tale groups with the checkboxes. A bar shows how many are selected and offers <strong>Archive</strong>, <strong>Show in another zone</strong> and <strong>Copy to zone</strong>. The same checkboxes work on API tokens, team members, invitations, user lists, tales in a tale group, and fonts.</p>
<figure>
  <img class="guide-img" alt="The Tale groups list with two groups selected: the checkboxes of Care tips and Living room are ticked. A bar above the list reads 2 selected and offers Show in another zone, Copy to zone, Archive and Clear selection." src="images/bulk-shot-tale-groups-selection.png" width="1000" height="800" />
  <figcaption>Two tale groups selected, a real screenshot. <em>Select all</em> sits above the list.</figcaption>
</figure>
<h2 id="the-group-menu">The group menu</h2>
<p>The <strong>...</strong> menu on each group has:</p>
<ul>
<li><strong>Rename</strong> and <strong>Cover</strong>: a still image, or an animated cover of at most 300 KB. Without a cover, the group shows its first tale's first background.</li>
<li><strong>Audience</strong>: tags, user lists and viewer properties. See <a routerLink="/targeting">Targeting</a>.</li>
<li><strong>Schedule</strong>: a start and an end time. Leave a field empty for no start or no end. The panel shows the time zone it uses.</li>
<li><strong>Show in another zone</strong>: place the same group in more than one zone. An edit shows in every zone.</li>
<li><strong>Copy to zone</strong>: make an independent copy. Later edits do not carry over.</li>
<li><strong>Archive</strong>.</li>
</ul>
<p><img class="guide-img" alt="The group menu" src="guides/images/16-group-menu.png" width="1280" height="800" />
<img class="guide-img" alt="The Schedule panel" src="guides/images/17-schedule.png" width="1280" height="800" /></p>
<h2 id="tales">Tales</h2>
<p>Open a group to see its tales. <strong>Add tale</strong> adds a tale titled <strong>Untitled tale</strong> at the end of the group and opens it in Tale Studio. Set its media there, and rename it from the studio's <strong>⋯</strong> menu. Reorder tales by dragging their card, or with the card's move arrows. A tale can have its own schedule too.</p>
<p>Each tale card shows the tale's first background: its image, or the first frame of its video. The card's <strong>Shown</strong> or <strong>Hidden</strong> label only reads the state: change it in Tale Studio's <strong>⋯</strong> menu, with <strong>Show on site</strong> or <strong>Hide from site</strong>. The card's open button goes to Tale Studio too.</p>
<p>The group's cover, when it has none of its own, is the first background of its first tale.</p>
<p><img class="guide-img" alt="Tale group page" src="guides/images/09-tale-group.png" width="1280" height="800" /></p>
<h3 id="tale-card-menu">Tale card menu and right-click</h3>
<p>Each tale card has a <strong>⋯</strong> menu with <strong>Edit in Tale Studio</strong>, <strong>Duplicate</strong>, <strong>Archive</strong> (<strong>Restore</strong> when archived) and <strong>Delete</strong>. Delete asks first, and names the tale.</p>
<p>The same menu opens with a right-click on the card, or with <kbd>Shift</kbd>+<kbd>F10</kbd> or the Context Menu key from any control on the card. Keyboard and screen reader users get the same actions with no pointer needed.</p>
<p><img class="guide-img" alt="A tale card's ⋯ menu: Edit in Tale Studio, Duplicate, Archive and Delete" src="guides/images/10-tale-card-menu.png" width="1280" height="800" /></p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Action</th>
<th>Where</th>
</tr>
</thead>
<tbody>
<tr>
<td>Add a tale</td>
<td>Add tale, in the group view</td>
</tr>
<tr>
<td>Open a tale in Tale Studio</td>
<td>The card's open button, or Edit in Tale Studio in its menu</td>
</tr>
<tr>
<td>Duplicate, archive, restore, delete</td>
<td>The card's menu (right-click, Shift+F10 or the Context Menu key)</td>
</tr>
<tr>
<td>Show or hide a tale</td>
<td>Tale Studio's <strong>⋯</strong> menu: Show on site or Hide from site</td>
</tr>
<tr>
<td>Rename, replace media, schedule, discard changes</td>
<td>Tale Studio's <strong>⋯</strong> menu</td>
</tr>
</tbody>
</table></div>
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
