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
<li><strong>Stories bar</strong> - a row with one item per tale group, in the layout you pick (a ring by default).</li>
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
<h4 id="bar-layouts">Layouts</h4>
<p>The four layouts draw the same groups, and each one is set here, in the zone's Display tab. The web SDK draws all four. The table says when each one fits and which settings it leaves out.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Layout</th>
<th>When to use it</th>
<th>Settings it does not use</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>ring</code> (default)</td>
<td>The main row of a page: round covers in a ring that spins until the visitor has seen them.</td>
<td>None</td>
</tr>
<tr>
<td><code>ring</code> with the shape <strong>Rounded square</strong></td>
<td>The same row with square covers, for a page whose pictures are square.</td>
<td>None</td>
</tr>
<tr>
<td><code>chip</code></td>
<td>Headers and navigation: a small round cover and the name in a pill. The row wraps onto more lines.</td>
<td>Shape</td>
</tr>
<tr>
<td><code>poster</code></td>
<td>Editorial and desktop pages: a tall card with the cover full bleed, the name over it and one segment per tale.</td>
<td>Shape and size</td>
</tr>
<tr>
<td><code>stack</code></td>
<td>A tight space, such as a sticky header: the covers overlap in one row, with the number of new stories.</td>
<td>Shape, show titles, alignment and gap (the size still applies)</td>
</tr>
</tbody>
</table></div>
<p>The ring, as the default and in the rounded square:</p>
<p><img class="guide-img" src="images/web-bar-layout-ring.png" width="1120" height="284" alt="The ring layout: round covers in a gradient ring, each with its group name under it." /></p>
<p><img class="guide-img" src="images/web-bar-layout-tile.png" width="1120" height="284" alt="The ring layout with the shape set to rounded square: square covers in a gradient ring, each with its name under it." /></p>
<figure>
<video class="guide-clip" src="images/web-clip-ring.webm" muted loop playsinline controls preload="metadata" poster="images/web-bar-layout-ring.png" width="420" height="106" aria-describedby="clip-ring-caption">Your browser cannot play this clip. The unseen rings turn, and a hover enlarges a cover.</video>
<figcaption id="clip-ring-caption">The unseen rings turn, and a hover enlarges a cover. Press play to watch: the clip does not start by itself.</figcaption>
</figure>
<p>The chip, which wraps onto a second line when the row is full:</p>
<p><img class="guide-img" src="images/web-bar-layout-chip.png" width="1120" height="312" alt="The chip layout: each group a pill with a round cover and its name, and a dot on the groups not yet seen. The row wraps onto a second line." /></p>
<p>The poster, with a segment per tale along the top of each card and the number of stories at its foot:</p>
<p><img class="guide-img" src="images/web-bar-layout-poster.png" width="1120" height="600" alt="The poster layout: tall cards with the cover full bleed, the name and the number of stories over a dark band, and a segment per tale along the top of each card." /></p>
<p>The stack, collapsed into one row: the covers overlap, a bubble counts the groups not shown, and the text says how many stories are new. A visitor opens the first new group with one tap:</p>
<p><img class="guide-img" src="images/web-bar-layout-stack.png" width="1120" height="284" alt="The stack layout: four overlapping round covers, a +2 bubble for the two groups not shown, and the text 6 new stories, in one row." /></p>
<p>On a right-to-left page the layouts turn around with the page. The poster starts at the right, and the chip's cover sits at the right of its pill:</p>
<p><img class="guide-img" src="images/web-bar-layout-poster-rtl.png" width="1120" height="600" alt="The poster layout on a Hebrew page: the cards start at the right, and the names and counts are right-aligned." /></p>
<p><img class="guide-img" src="images/web-bar-layout-chip-rtl.png" width="1120" height="312" alt="The chip layout on a Hebrew page: the round cover sits at the right of each pill, the dot at the left, and the rows fill from the right." /></p>
<p>While a zone loads, the page shows a loading skeleton of the bar in the same space, so nothing moves when the zone arrives. The skeleton is grey and still under reduced motion. The layout is not known until the zone arrives, so the element draws the skeleton in the layout its <code>layout</code> attribute names (<code>ring</code>, <code>chip</code>, <code>poster</code> or <code>stack</code>), else the layout it last showed, else the ring. The attribute only shapes the skeleton; the dashboard sets the layout.</p>
<p><img class="guide-img" src="images/web-bar-layout-loading.png" width="1120" height="284" alt="The loading skeleton: five grey circles, each with a grey bar under it, in the footprint of the ring layout." /></p>
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
<h4 id="banner-variants">Variants</h4>
<p>The variant sets how the slides are shown. The web SDK draws all six. The table says when each one fits and which settings it leaves out, and the dashboard dims those settings.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Variant</th>
<th>When to use it</th>
<th>Settings it does not use</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>carousel</code> (default)</td>
<td>Most pages: one slide at a time, with the group's name and a Watch button on the picture.</td>
<td>None</td>
</tr>
<tr>
<td><code>coverflow</code></td>
<td>A hero at the top of a desktop page: the current slide in front, its neighbours turned away at the sides.</td>
<td>None</td>
</tr>
<tr>
<td><code>peek</code></td>
<td>A phone or a narrow column: the neighbouring slides show at the edges, and a swipe moves to the next one.</td>
<td>None</td>
</tr>
<tr>
<td><code>deck</code></td>
<td>A few campaigns at once: the groups fanned out like a hand of cards, with the front card open to the visitor.</td>
<td>None</td>
</tr>
<tr>
<td><code>sticky</code></td>
<td>A compact bar that stays on screen while its section scrolls, with a button to dismiss it.</td>
<td>Aspect ratio, dots and loop</td>
</tr>
<tr>
<td><code>strip</code></td>
<td>A ticker under a header: the groups move past in one continuous marquee at a fixed speed.</td>
<td>Aspect ratio, dots, loop, autoplay and interval</td>
</tr>
</tbody>
</table></div>
<p>The carousel, the default, is one slide at a time, with the group's name and a Watch button on a dark fade at the bottom of the picture. A dot per slide shows where the visitor is; the current dot is the longer one:</p>
<p><img class="guide-img" src="images/web-banner-variant-carousel.png" width="1120" height="760" alt="The carousel banner: one slide with the group's name and a Watch button over a dark fade, the previous and next buttons at the sides, and four dots with the first one a long pill." /></p>
<p>Coverflow puts the current slide in front, and its neighbours are turned away at the sides and partly hidden. A click on a neighbour shows it:</p>
<p><img class="guide-img" src="images/web-banner-variant-coverflow.png" width="1120" height="760" alt="The coverflow banner: the current slide in front with its title, and its two neighbours turned away and partly hidden at either side." /></p>
<figure>
<video class="guide-clip" src="images/web-clip-banner-coverflow.webm" muted loop playsinline controls preload="metadata" poster="images/web-banner-variant-coverflow.png" width="420" height="284" aria-describedby="clip-coverflow-caption">Your browser cannot play this clip. The coverflow banner changes its slide every three seconds.</video>
<figcaption id="clip-coverflow-caption">The coverflow banner moving on its own: the slides change every three seconds. Press play to watch; the clip does not start by itself.</figcaption>
</figure>
<p>Peek shows the neighbouring slides at the edges, so the visitor sees that there is more. A swipe, or the arrows, move one slide:</p>
<p><img class="guide-img" src="images/web-banner-variant-peek.png" width="1120" height="760" alt="The peek banner: the current card in the middle, with the neighbouring cards cut off at both edges, and the position dots under it." /></p>
<p>Deck fans the groups out like a hand of cards. The front card opens the group, and the others wait behind it:</p>
<p><img class="guide-img" src="images/web-banner-variant-deck.png" width="1120" height="760" alt="The deck banner: the groups fanned out behind the front card, which shows its name and a Watch button." /></p>
<p>Sticky is a compact bar with the current group's cover and name, the previous and next buttons, a rotation button and a dismiss button. It stays at the bottom of its section while the page scrolls, and it never covers the content around it: the bar takes its own space in the page, as any block does. A visitor who dismisses it does not see it again in the same browsing session; the dismissal is kept in the browser's session storage. In a browser that blocks session storage the bar shows again on the next page view:</p>
<p><img class="guide-img" src="images/web-banner-variant-sticky.png" width="1120" height="284" alt="The sticky banner: a compact bar with previous and next buttons, a round cover and the group's name, a rotation button and a close button." /></p>
<p>Strip is a marquee of the groups: the covers and names move past at a fixed speed, one full pass of the groups in 18 seconds, and the strip runs in the direction the page reads. Hovering over it, or moving the focus into it, pauses it. A visitor who prefers reduced motion sees it still, and can scroll it sideways:</p>
<p><img class="guide-img" src="images/web-banner-variant-strip.png" width="1120" height="300" alt="The strip banner: round covers with their group names in a row, cut off at both ends, as if moving past." /></p>
<figure>
<video class="guide-clip" src="images/web-clip-banner-strip.webm" muted loop playsinline controls preload="metadata" poster="images/web-banner-variant-strip.png" width="420" height="112" aria-describedby="clip-strip-caption">Your browser cannot play this clip. The strip moves its groups past at a fixed speed.</video>
<figcaption id="clip-strip-caption">The strip moving at its fixed speed. Press play to watch; the clip does not start by itself.</figcaption>
</figure>
<p>On a right-to-left page each variant turns with the page. The next slide of the coverflow is on the left, the peek and the deck open toward the left, and the strip's names and motion run from the right. These are the same four on a Hebrew page:</p>
<p><img class="guide-img" src="images/web-banner-variant-coverflow-rtl.png" width="1120" height="760" alt="The coverflow banner on a Hebrew page: the front slide with its Hebrew name, and the next slide turned away on the left." /></p>
<p><img class="guide-img" src="images/web-banner-variant-peek-rtl.png" width="1120" height="760" alt="The peek banner on a Hebrew page: the current card in the middle, with the previous group on the right and the next on the left." /></p>
<p><img class="guide-img" src="images/web-banner-variant-deck-rtl.png" width="1120" height="760" alt="The deck banner on a Hebrew page: the fan opens toward the left, with the front card's Hebrew name." /></p>
<p><img class="guide-img" src="images/web-banner-variant-strip-rtl.png" width="1120" height="300" alt="The strip banner on a Hebrew page: Hebrew group names read from the right, with the covers in the same order." /></p>
<p>Autoplay and its interval apply to every variant except the strip, which moves at its own speed. Loop, dots and the aspect ratio apply to the carousel, the coverflow, the peek and the deck. The stills here were taken with autoplay off, so each one holds still; the strip is frozen a third of the way along its loop.</p>
<p>A banner shows one group at a time. Here are three ways the carousel can be proportioned. The aspect ratio <strong>3:1</strong> gives a wide strip:</p>
<p><img class="guide-img" src="images/web-display-banner-wide.png" width="1120" height="526" alt="A wide 3:1 banner with the group's name and a Watch button on the slide, previous and next buttons, and four dots with the first one a long pill." /></p>
<p>The aspect ratio <strong>1:1</strong> gives a square card:</p>
<p><img class="guide-img" src="images/web-display-banner-square.png" width="1120" height="1208" alt="A square 1:1 banner with a large slide, its name and a Watch button, the arrows and four dots." /></p>
<p>With <strong>Dots</strong> off the banner keeps its arrows and hides the position dots:</p>
<p><img class="guide-img" src="images/web-display-banner-plain.png" width="1120" height="704" alt="A 16:9 banner with its name and a Watch button, arrows and no dots under it." /></p>
<p>Colours, ring style and fonts are not display settings. They come from the <a routerLink="/theme-and-fonts">theme</a>.</p>
<h2 id="several-zones-on-one-page">Several zones on one page</h2>
<p>One script tag serves every zone on a page. Each zone has its own zone key, so add one <code>&lt;taleart-view&gt;</code> element per zone, each with its key.</p>
<h2 id="not-in-the-current-source">Not in the current source</h2>
<p>Widget types other than the bar and the banner (for example a video feed, a swipe-card stack or a full-screen flow) were not found in the current source.</p>
  `,
})
export class ZonesAndDisplaysPage {}
