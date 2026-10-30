import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-interactive-components',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Interactive components</h1>
<p>Six elements sit on a tale. Four let a visitor answer: a poll, a quiz, a rating and a reaction, and a tale holds at most one of each kind. Two show something the visitor can use: a countdown and a promo code, and a tale may hold several of each.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Interactive components"><table>
<thead>
<tr>
<th>Component</th>
<th>What the visitor does</th>
<th>Setup</th>
</tr>
</thead>
<tbody>
<tr>
<td>Poll</td>
<td>Picks one of 2 options</td>
<td>Two labels</td>
</tr>
<tr>
<td>Quiz</td>
<td>Picks one of 2 to 4 answers</td>
<td>Optionally mark one answer correct. The results are public.</td>
</tr>
<tr>
<td>Rating</td>
<td>Moves an emoji slider from 0 to 100</td>
<td>Choose the emoji</td>
</tr>
<tr>
<td>Reaction</td>
<td>Taps one of 2 to 6 emoji, then sees each emoji's count</td>
<td>The question and the emoji</td>
</tr>
<tr>
<td>Countdown</td>
<td>Watches the time left until an instant</td>
<td>The end time in UTC</td>
</tr>
<tr>
<td>Promo code</td>
<td>Copies a code</td>
<td>The code</td>
</tr>
</tbody>
</table></div>

<h2 id="what-the-visitor-sees">What the visitor sees</h2>
<p>These are real screenshots of the Web SDK in the viewer at phone size, with sample tales. The same components look the same in the Android and iOS SDKs.</p>
<h3 id="poll-view">Poll</h3>
<p>A poll asks two options. Its <strong>View</strong> picks how it is drawn, and each option may have its own colour. Every view answers the same way, and shows the same shares once a visitor has voted.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Poll views"><table>
<caption>Poll views</caption>
<thead>
<tr>
<th scope="col">View</th>
<th scope="col">How it looks</th>
<th scope="col">When to use it</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>sticker</code> (default)</td>
<td>A small card with two pills. Each pill fills with its share after the vote, and the visitor's choice is marked.</td>
<td>A question over a photo. The default for a tale.</td>
</tr>
<tr>
<td><code>embed</code></td>
<td>A full-width card with a results header, a full bar for each option, and a total line such as "101 votes".</td>
<td>A poll that reads as a result: on a page, a blog post or below a story.</td>
</tr>
<tr>
<td><code>this-or-that</code></td>
<td>Two halves that fill the card. After the vote the split moves to the two shares, with a VS marker on the split.</td>
<td>Two choices that are opposites, such as two colourways.</td>
</tr>
<tr>
<td><code>grid</code></td>
<td>Two large coloured tiles. After the vote each tile shows its share along its bottom edge.</td>
<td>Two choices that work as pictures in colour.</td>
</tr>
<tr>
<td><code>inline</code></td>
<td>Compact pills in one row. After the vote the pills give way to a stacked bar with its legend.</td>
<td>A poll under a banner or in a feed, where there is little room.</td>
</tr>
</tbody>
</table></div>
<p>
  <strong>Option colour.</strong> An option may carry a colour, <code>#rrggbb</code>. The <code>this-or-that</code> and
  <code>grid</code> views use it for their halves and tiles, and the text on each colour is picked automatically, black or
  white, whichever reads at 4.5:1 or better. An option without a colour takes the tale's accent and ink colours from the
  theme. The other views ignore the colour. It is content (the colour of that answer), not part of the theme.
</p>
<p>
  The views other than the sticker load their own module the first time a tale that shows one is drawn. A page whose tales
  are all stickers never fetches it.
</p>
<figure><img src="images/web-poll-view-sticker.png" alt="A sticker poll in the viewer: a white card on a sunset picture with the title Poll, the question Which colourway next? and two pills, Midnight and Coral." width="780" height="1400" /><figcaption>The sticker, before a vote.</figcaption></figure>
<figure><img src="images/web-shot-poll-answered.png" alt="The sticker poll after a tap on Midnight: each pill fills with its share, Midnight 61 percent and Coral 39 percent, and the chosen pill has a thicker border." width="780" height="1400" /><figcaption>The sticker after a vote: each pill fills with its share, and the visitor's choice is marked.</figcaption></figure>
<figure><img src="images/web-poll-view-embed.png" alt="An embed poll: a full-width white card on a sky picture with the question Which colourway next?, the text Results appear after you vote, and two full bars, Midnight and Coral." width="780" height="1400" /><figcaption>The embed, before a vote: its results header says when the results appear.</figcaption></figure>
<figure><img src="images/web-poll-view-embed-voted.png" alt="The same embed after a vote for Midnight: the bars fill to 58 and 42 percent, the header reads Results and the total line reads 101 votes." width="780" height="1400" /><figcaption>The embed after a vote: each bar fills with its share, and the total line counts the votes.</figcaption></figure>
<figure><img src="images/web-poll-view-this-or-that.png" alt="A this-or-that poll: two halves, Midnight in blue and Coral in coral, split evenly, with a white VS marker at the split." width="780" height="1400" /><figcaption>This or that, before a vote: two halves of equal size, with the VS marker in the middle.</figcaption></figure>
<figure><img src="images/web-poll-view-this-or-that-voted.png" alt="The same this-or-that after a vote for Midnight: the blue half is wider, 60 percent, and the coral half shows 40 percent, with the VS marker on the split." width="780" height="1400" /><figcaption>After a vote the split moves to the shares, and the marker stays on it.</figcaption></figure>
<figure>
<video class="guide-clip" src="images/web-clip-poll-this-or-that.webm" muted loop playsinline controls preload="metadata" poster="images/web-poll-view-this-or-that-voted.png" width="260" height="467" aria-describedby="clip-poll-caption">Your browser cannot play this clip. The visitor votes, and the split moves to the shares.</video>
<figcaption id="clip-poll-caption">A vote in this-or-that: the split moves to the shares. Press play to watch: the clip does not start by itself.</figcaption>
</figure>
<figure><img src="images/web-poll-view-this-or-that-rtl.png" alt="The this-or-that poll on a right-to-left page in Hebrew: the question is Hebrew, the first option, Midnight in Hebrew, is on the right with 60 percent, the second, Coral in Hebrew, on the left with 40 percent, and the VS marker on the split." width="780" height="1400" /><figcaption>On a right-to-left page the first option sits on the right, and the percentages still read left to right.</figcaption></figure>
<figure><img src="images/web-poll-view-grid.png" alt="A grid poll: two large tiles, Midnight in blue and Coral in coral, side by side on a night picture, with no shares yet." width="780" height="1400" /><figcaption>The grid, before a vote.</figcaption></figure>
<figure><img src="images/web-poll-view-grid-voted.png" alt="The same grid after a vote for Midnight: each tile fills along its bottom edge to its share, 55 and 45 percent, and the chosen tile's label is underlined." width="780" height="1400" /><figcaption>After a vote each tile shows its share, and the chosen one is underlined.</figcaption></figure>
<figure><img src="images/web-poll-view-inline.png" alt="An inline poll in a white strip near the bottom of a sunset picture: the title Poll, the question Which colourway next? and two pills in one row." width="780" height="1400" /><figcaption>The inline view, before a vote. After a vote its pills give way to a stacked bar with the shares.</figcaption></figure>
<h3 id="quiz-view">Quiz</h3>
<figure><img src="images/web-shot-quiz.png" alt="A quiz card on a blue sky picture with the title Quiz, the question What is the capital of France? and three outlined answers: Paris, Lyon and Nice." width="780" height="1400" /><figcaption>A quiz before the visitor answers.</figcaption></figure>
<figure><img src="images/web-shot-quiz-answered.png" alt="The same quiz after a tap on Lyon: Paris is marked correct with a green check and 73%, Lyon is marked wrong with a red cross and 19%, and Nice shows 8%." width="780" height="1400" /><figcaption>With a correct answer set, the correct answer is marked, and a wrong choice too. Marks are a glyph and a colour, so they do not rely on colour alone.</figcaption></figure>
<figure>
<video class="guide-clip" src="images/web-clip-quiz.webm" muted loop playsinline controls preload="metadata" poster="images/web-shot-quiz.png" width="260" height="467" aria-describedby="clip-quiz-caption">Your browser cannot play this clip. A wrong answer shakes, and the right one is marked.</video>
<figcaption id="clip-quiz-caption">A wrong answer shakes and the right one turns green. Press play to watch: the clip does not start by itself.</figcaption>
</figure>
<h3 id="rating-view">Rating</h3>
<figure><img src="images/web-shot-rating.png" alt="A dark rating card on a night picture with the title Rate us, the question How was your visit? and a slider with a star on its thumb." width="780" height="1400" /><figcaption>A rating: the visitor drags the emoji along the slider, or uses the arrow keys and Enter.</figcaption></figure>
<figure><img src="images/web-shot-rating-answered.png" alt="The same card after rating: the slider keeps the visitor's value, a mark shows the average, and the text reads Average 78 from 213 ratings." width="780" height="1400" /><figcaption>After rating, the card shows the average and how many people rated.</figcaption></figure>
<p>Countdown, promo code and reaction are shown in their own sections below.</p>

<h2 id="in-tale-studio">In Tale Studio</h2>
<p>Countdown, promo code and reaction are in the <strong>Interactive</strong> group of the Elements palette, with poll, rating and quiz.</p>
<p><img class="guide-img" src="images/studio-shot-palette.png" width="223" height="509" alt="The Elements palette's Interactive group: Poll, Rating and Quiz in the first row, and in the second row Countdown, Promo code and Reaction, each with its icon." /></p>
<p>Each one's inspector lists its fields. A countdown's inspector:</p>
<p><img class="guide-img" src="images/studio-shot-countdown-inspector.png" width="296" height="509" alt="The inspector of a countdown: Ends at (UTC) with a date and time in ISO 8601 UTC, a title Sale ends in, Text when it ends, the theme and the position and size." /></p>
<p>A promo code's inspector:</p>
<p><img class="guide-img" src="images/studio-shot-promo-code-inspector.png" width="296" height="509" alt="The inspector of a promo code: the code SUMMER25, a title Your welcome gift, a note 20% off sandals, until Sunday, the theme and the position and size." /></p>

<h2 id="countdown">Countdown</h2>
<figure><img src="images/web-shot-countdown.png" alt="A countdown in the viewer: the title Sale ends in, and the units 02 Days, 05 Hours, 40 Min and 00 Sec, each number on a grey tile." width="780" height="1400" /><figcaption>A countdown: each unit is a tile with its name under it.</figcaption></figure>
<figure>
<video class="guide-clip" src="images/web-clip-countdown.webm" muted loop playsinline controls preload="metadata" poster="images/web-shot-countdown.png" width="260" height="467" aria-describedby="clip-countdown-caption">Your browser cannot play this clip. The seconds turn over.</video>
<figcaption id="clip-countdown-caption">The digits turn over each second. Press play to watch: the clip does not start by itself.</figcaption>
</figure>
<p>
  A countdown shows the days, hours, minutes and seconds left until its end, and ticks each second. Each number turns over
  when it changes, on a tile of its own. It counts with the
  <strong>visitor's clock</strong>, so a visitor whose clock is wrong sees a different time. At the end, and after it, the
  countdown shows its end text instead. Assistive technology is told the days, hours and minutes once a minute, not every second. A visitor who
  prefers reduced motion sees no flip animation.
</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Countdown props"><table>
<caption>Countdown props</caption>
<thead>
<tr>
<th scope="col">Prop</th>
<th scope="col">Type</th>
<th scope="col">Required</th>
<th scope="col">Limits</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>endsAt</code></td>
<td>Instant (text)</td>
<td>Yes</td>
<td>ISO 8601 in UTC, ending in <code>Z</code>, such as <code>2026-12-31T21:00:00Z</code>. A real date and time, at most 40 characters.</td>
</tr>
<tr>
<td><code>title</code></td>
<td>Text</td>
<td>No</td>
<td>1 to 80 characters, on one line. A heading above the countdown.</td>
</tr>
<tr>
<td><code>endedText</code></td>
<td>Text</td>
<td>No</td>
<td>1 to 80 characters, on one line. Shown at and after <code>endsAt</code>. Left out, the page says "Ended".</td>
</tr>
<tr>
<td><code>theme</code></td>
<td><code>light</code> or <code>dark</code></td>
<td>No</td>
<td>Light (dark text on a light card) when left out.</td>
</tr>
</tbody>
</table></div>
<p>
  The SDK's texts for the countdown: <code>countdown.ended</code> (Ended), <code>countdown.days</code> (Days),
  <code>countdown.hours</code> (Hours), <code>countdown.minutes</code> (Min) and <code>countdown.seconds</code> (Sec).
  Change them with <code>strings</code>, as described in the <a routerLink="/reference/web-sdk">Web SDK reference</a>.
</p>
<p>
  At the end the countdown reports a component event, <code>ended</code>, once per render. See
  <a routerLink="/guides/web">Listen for component events</a> in the Web guide.
</p>

<h2 id="promo-code">Promo code</h2>
<p>
  A promo code shows its code on a ticket: the code on one side, and a Copy stub on the other, with notches cut at the tear
  line. Copy puts the code on the clipboard (or selects it, when the browser does not allow a copy), and a toast in the top
  corner of the card says Copied for four seconds. A copy reports a component event, <code>copied</code>, with the code as
  its value.
</p>
<figure><img src="images/web-shot-promo.png" alt="A promo code in the viewer: the title Your welcome gift, the code SUMMER25 on a ticket with a Copy stub, and the note 20% off sandals, until Sunday." width="780" height="1400" /><figcaption>A promo code before the copy.</figcaption></figure>
<figure><img src="images/web-shot-promo-copied.png" alt="The same promo code after Copy: a Copied toast in the top corner of the card." width="780" height="1400" /><figcaption>After Copy, a toast says Copied and leaves after four seconds.</figcaption></figure>
<div class="table-wrap" tabindex="0" role="region" aria-label="Promo code props"><table>
<caption>Promo code props</caption>
<thead>
<tr>
<th scope="col">Prop</th>
<th scope="col">Type</th>
<th scope="col">Required</th>
<th scope="col">Limits</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>code</code></td>
<td>Text</td>
<td>Yes</td>
<td>1 to 32 characters: letters <code>A-Z</code> and <code>a-z</code>, digits, <code>_</code> and <code>-</code>.</td>
</tr>
<tr>
<td><code>title</code></td>
<td>Text</td>
<td>No</td>
<td>1 to 80 characters, on one line. A heading above the code.</td>
</tr>
<tr>
<td><code>note</code></td>
<td>Text</td>
<td>No</td>
<td>1 to 120 characters, on one line. A line under the code, such as its terms.</td>
</tr>
<tr>
<td><code>theme</code></td>
<td><code>light</code> or <code>dark</code></td>
<td>No</td>
<td>Light (dark text on a light card) when left out.</td>
</tr>
</tbody>
</table></div>
<p>
  The SDK's texts for the promo code: <code>promo.copy</code> (Copy), <code>promo.copied</code> (Copied) and
  <code>promo.copyFailed</code>, which says the copy failed and asks the visitor to select the code.
</p>
<p>
  <strong>The code is not a secret.</strong> Every visitor who opens the tale can read it, and the copy event reports it.
  Use a promo code for an offer that anyone may use, not for a code that must stay private.
</p>

<h2 id="reaction">Reaction</h2>
<figure><img src="images/web-shot-reaction.png" alt="A reaction in the viewer: the question How do you feel? over a row of three emoji, each with its count." width="780" height="1400" /><figcaption>A reaction before a tap.</figcaption></figure>
<figure><img src="images/web-shot-reaction-answered.png" alt="The reaction after a tap on the heart: the heart is pressed and shows 129, the laughing face 41 and the surprised face 17." width="780" height="1400" /><figcaption>After a tap, each emoji shows its count, and the one tapped is pressed. The emoji rises and fades over it.</figcaption></figure>
<p>
  A reaction asks a question over a row of two to six emoji. A visitor taps one, and the tap is posted like a poll vote; then
  each emoji shows how many taps it has, and the one tapped is pressed. A visitor taps once. A tale holds one reaction, and
  its counts are shown to every visitor, not only to the one who tapped.
</p>
<p>
  In the studio, a reaction shows its question on the canvas. Its inspector lists the question, the title, the theme and the
  emoji, in the order they show to a visitor:
</p>
<p><img class="guide-img" src="images/studio-shot-reaction-studio.png" width="1200" height="750" alt="Tale Studio with a reaction on the canvas: its question, How do you feel?, in a box on the purple tale, and the Reaction tile in the Interactive group of the palette greyed, since a tale holds one." /></p>
<p><img class="guide-img" src="images/studio-shot-reaction-inspector.png" width="296" height="509" alt="The inspector of a reaction: the question How do you feel?, the title Your reaction, the theme Light, and the start of the Emoji list: a red heart and a face with tears of joy, each with a Choose emoji button." /></p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Reaction props"><table>
<caption>Reaction props</caption>
<thead>
<tr>
<th scope="col">Prop</th>
<th scope="col">Type</th>
<th scope="col">Required</th>
<th scope="col">Limits</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>question</code></td>
<td>Text</td>
<td>Yes</td>
<td>1 to 200 characters, on one line. The question visitors answer, and the name of the row for assistive technology.</td>
</tr>
<tr>
<td><code>emojis</code></td>
<td>List of emoji</td>
<td>Yes</td>
<td>2 to 6 emoji, all different, each one emoji such as <code>❤️</code> or <code>😂</code>. They show in this order. A tap is counted by its emoji, so an emoji that is kept keeps its count; one that is replaced drops it.</td>
</tr>
<tr>
<td><code>title</code></td>
<td>Text</td>
<td>No</td>
<td>1 to 80 characters, on one line. A heading above the question.</td>
</tr>
<tr>
<td><code>theme</code></td>
<td><code>light</code> or <code>dark</code></td>
<td>No</td>
<td>Light (dark text on a light card) when left out.</td>
</tr>
</tbody>
</table></div>
<p>
  The SDK's texts for the reaction: <code>reaction.count</code> (Reactions: &#123;count&#125;), which names each emoji's count for
  assistive technology, and <code>reaction.failed</code> (Your reaction could not be sent. Try again.), shown when a tap is not
  sent. Change them with <code>strings</code>, as described in the <a routerLink="/reference/web-sdk">Web SDK reference</a>.
</p>
<p>
  An accepted tap reports a component event, <code>selected</code>, with the emoji as its value. See
  <a routerLink="/guides/web">Listen for component events</a> in the Web guide.
</p>

<h2 id="results">Results</h2>
<p>Read the answers through the Management API: <code>GET /tales/&#123;id&#125;/responses</code>. The SDK sends a visitor's answer to <code>POST /delivery/v1/responses</code>.</p>
<p>
  In Tale Studio, the inspector of a poll, quiz, rating or reaction has a <strong>Responses</strong> panel. Press
  <strong>Refresh</strong> to read the counts: for a reaction, each emoji with its taps and the total.
</p>
<p><img class="guide-img" src="images/studio-shot-reaction-responses.png" width="271" height="260" alt="The Responses panel of a reaction after Refresh: a red heart with 14, a face with tears of joy with 6 and a surprised face with 2, and 22 reactions in total." /></p>
<p>Counts are kept per visitor id (a random id in the browser's local storage), so they are indicative only. The same person on two devices counts twice, and clearing storage resets the count.</p>
<h2 id="not-in-the-current-source">Not in the current source</h2>
<p>A dashboard page with charts for answers, and a per-tale analytics view, were not found in the current source.</p>
  `,
})
export class InteractiveComponentsPage {}
