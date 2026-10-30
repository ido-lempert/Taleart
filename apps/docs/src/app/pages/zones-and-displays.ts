import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-zones-and-displays',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Zones and displays</h1>
<p>A <strong>zone</strong> is one spot on your site. It holds at most one <strong>display</strong>: a Stories bar or a Promo banner. A page places a zone with the zone's own zone key, from the zone's Install tab (see <a routerLink="/install">Install a zone</a>).</p>
<h2 id="create-a-zone">Create a zone</h2>
<p>Open <strong>Zones</strong>, then <strong>New zone</strong>. Give it a name. The slug is made from the name if you leave it empty. Pick a template:</p>
<ul>
<li><strong>Stories bar</strong> - a row of circles, one per tale group.</li>
<li><strong>Promo banner</strong> - one wide card that cycles through tale groups.</li>
<li><strong>Blank</strong> - a zone with no display yet. Choose one later on the Display tab.</li>
</ul>
<p>A template sets the display once, when the zone is created. After that you change the display on the zone's <strong>Display</strong> tab.</p>
<p><img class="guide-img" alt="A new zone that is not visible yet" src="guides/images/03-zone-new.png" width="1280" height="800" /></p>
<h2 id="the-zone-list">The zone list</h2>
<p>Each zone card shows its slug, whether it is <strong>Visible on site</strong>, how many tale groups it holds and whether the install snippet was used.</p>
<p><img class="guide-img" alt="The zone list" src="guides/images/15-zones.png" width="1280" height="800" /></p>
<h2 id="display-tab">Display tab</h2>
<p><img class="guide-img" alt="Display tab" src="guides/images/06-display-tab.png" width="1280" height="800" /></p>
<h3 id="stories-bar">Stories bar</h3>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Setting</th>
<th>Values</th>
</tr>
</thead>
<tbody>
<tr>
<td>Layout</td>
<td><code>ring</code> (default, the current look), <code>chip</code>, <code>poster</code> or <code>stack</code></td>
</tr>
<tr>
<td>Shape</td>
<td>circle or rounded square</td>
</tr>
<tr>
<td>Size</td>
<td>the size of each item</td>
</tr>
<tr>
<td>Show titles</td>
<td>on or off</td>
</tr>
<tr>
<td>Alignment</td>
<td>where the row sits in its container</td>
</tr>
<tr>
<td>Gap</td>
<td>4 to 24 px between items</td>
</tr>
</tbody>
</table></div>
<p>The layout sets how each group is drawn. <code>ring</code> is the default: a round cover in a ring that spins until the visitor has seen it. <code>chip</code> is a round cover beside its title in a pill; the shape is ignored. <code>poster</code> is a tall card with the title over the cover; the shape and the size are ignored. <code>stack</code> overlaps the items in one collapsed row; only the size applies. The dashboard dims the settings a layout does not use.</p>
<p>The new layouts and variants are set here now. The SDKs draw them from the next releases; until then a zone shows the look it had before, whatever you set.</p>
<p>The default bar is round, medium and titled. Here the shape is <strong>Rounded square</strong>, titles are off and the items sit in the centre:</p>
<p><img class="guide-img" src="images/web-display-bar-square.png" width="1120" height="284" alt="A stories bar with four rounded-square covers centred in the row, with no titles under them." /></p>
<p>Here the size is <strong>Large</strong> and the gap is 20 pixels:</p>
<p><img class="guide-img" src="images/web-display-bar-large.png" width="1120" height="316" alt="A stories bar with four large round covers titled Summer, New arrivals, Winter and Trips." /></p>
<h3 id="promo-banner">Promo banner</h3>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Setting</th>
<th>Values</th>
</tr>
</thead>
<tbody>
<tr>
<td>Variant</td>
<td><code>carousel</code> (default, the current look), <code>coverflow</code>, <code>peek</code>, <code>deck</code>, <code>sticky</code> or <code>strip</code></td>
</tr>
<tr>
<td>Aspect ratio</td>
<td>16:9, 3:1 or 1:1</td>
</tr>
<tr>
<td>Autoplay</td>
<td>on or off</td>
</tr>
<tr>
<td>Interval</td>
<td>3 to 15 seconds</td>
</tr>
<tr>
<td>Dots</td>
<td>show or hide the position dots</td>
</tr>
<tr>
<td>Loop</td>
<td>start again after the last card</td>
</tr>
</tbody>
</table></div>
<p>The variant sets how the slides are shown. <code>carousel</code> is the default: one slide at a time. <code>coverflow</code> puts the current slide in front with its neighbours turned away at the sides. <code>peek</code> shows the neighbours at the edges. <code>deck</code> fans the slides out like cards. <code>sticky</code> stays on screen while the page scrolls. <code>strip</code> is a continuous marquee of the slides. Autoplay, loop, dots and the aspect ratio apply to the first four; <code>sticky</code> and <code>strip</code> ignore the aspect ratio, the dots and loop. The dashboard dims the settings a variant does not use.</p>
<p>The new layouts and variants are set here now. The SDKs draw them from the next releases; until then a zone shows the look it had before, whatever you set.</p>
<p>A banner shows one group at a time as a slide, with previous and next arrows and a dot per slide. Here are three ways it can look. The aspect ratio <strong>3:1</strong> gives a wide strip:</p>
<p><img class="guide-img" src="images/web-display-banner-wide.png" width="1120" height="526" alt="A wide 3:1 banner with a slide, previous and next arrows and four dots, the first one filled." /></p>
<p>The aspect ratio <strong>1:1</strong> gives a square card:</p>
<p><img class="guide-img" src="images/web-display-banner-square.png" width="1120" height="1208" alt="A square 1:1 banner with a large slide, arrows and four dots." /></p>
<p>With <strong>Dots</strong> off the banner keeps its arrows and hides the position dots:</p>
<p><img class="guide-img" src="images/web-display-banner-plain.png" width="1120" height="704" alt="A 16:9 banner with arrows and no dots under it." /></p>
<p>Autoplay moves to the next slide by itself after the interval, and stops when the visitor interacts with the banner or prefers reduced motion. These screenshots were taken with autoplay off so each one holds still.</p>
<p>Colours, ring style and fonts are not display settings. They come from the <a routerLink="/theme-and-fonts">theme</a>.</p>
<h2 id="several-zones-on-one-page">Several zones on one page</h2>
<p>One script tag serves every zone on a page. Each zone has its own zone key, so add one <code>&lt;taleart-view&gt;</code> element per zone, each with its key.</p>
<h2 id="not-in-the-current-source">Not in the current source</h2>
<p>Widget types other than the bar and the banner (for example a video feed, a swipe-card stack or a full-screen flow) were not found in the current source.</p>
  `,
})
export class ZonesAndDisplaysPage {}
