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

<h2 id="in-tale-studio">In Tale Studio</h2>
<p>Countdown, promo code and reaction are in the <strong>Interactive</strong> group of the Elements palette, with poll, rating and quiz.</p>
<p><img class="guide-img" src="/images/studio-shot-palette.png" width="223" height="509" alt="The Elements palette's Interactive group: Poll, Rating and Quiz in the first row, and in the second row Countdown, Promo code and Reaction, each with its icon." /></p>
<p>Each one's inspector lists its fields. A countdown's inspector:</p>
<p><img class="guide-img" src="/images/studio-shot-countdown-inspector.png" width="296" height="509" alt="The inspector of a countdown: Ends at (UTC) with a date and time in ISO 8601 UTC, a title Sale ends in, Text when it ends, the theme and the position and size." /></p>
<p>A promo code's inspector:</p>
<p><img class="guide-img" src="/images/studio-shot-promo-code-inspector.png" width="296" height="509" alt="The inspector of a promo code: the code SUMMER25, a title Your welcome gift, a note 20% off sandals, until Sunday, the theme and the position and size." /></p>

<h2 id="countdown">Countdown</h2>
<p>
  A countdown shows the days, hours, minutes and seconds left until its end, and ticks each second. It counts with the
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
  A promo code shows its code in a chip, with a Copy button. Copy puts the code on the clipboard (or selects it, when
  the browser does not allow a copy), and the button then says Copied for two seconds. A copy reports a component event,
  <code>copied</code>, with the code as its value.
</p>
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
<p>
  A reaction asks a question over a row of two to six emoji. A visitor taps one, and the tap is posted like a poll vote; then
  each emoji shows how many taps it has, and the one tapped is pressed. A visitor taps once. A tale holds one reaction, and
  its counts are shown to every visitor, not only to the one who tapped.
</p>
<p>
  In the studio, a reaction shows its question on the canvas. Its inspector lists the question, the title, the theme and the
  emoji, in the order they show to a visitor:
</p>
<p><img class="guide-img" src="/images/studio-shot-reaction-studio.png" width="1200" height="750" alt="Tale Studio with a reaction on the canvas: its question, How do you feel?, in a box on the purple tale, and the Reaction tile in the Interactive group of the palette greyed, since a tale holds one." /></p>
<p><img class="guide-img" src="/images/studio-shot-reaction-inspector.png" width="296" height="509" alt="The inspector of a reaction: the question How do you feel?, the title Your reaction, the theme Light, and the start of the Emoji list: a red heart and a face with tears of joy, each with a Choose emoji button." /></p>
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
<p><img class="guide-img" src="/images/studio-shot-reaction-responses.png" width="271" height="260" alt="The Responses panel of a reaction after Refresh: a red heart with 14, a face with tears of joy with 6 and a surprised face with 2, and 22 reactions in total." /></p>
<p>Counts are kept per visitor id (a random id in the browser's local storage), so they are indicative only. The same person on two devices counts twice, and clearing storage resets the count.</p>
<h2 id="not-in-the-current-source">Not in the current source</h2>
<p>A dashboard page with charts for answers, and a per-tale analytics view, were not found in the current source.</p>
  `,
})
export class InteractiveComponentsPage {}
