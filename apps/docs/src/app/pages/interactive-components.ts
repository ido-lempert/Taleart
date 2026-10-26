import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'docs-interactive-components',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Interactive components</h1>
<p>Three elements let a visitor answer. A tale holds at most one of each kind.</p>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
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
</tbody>
</table></div>
<h2 id="results">Results</h2>
<p>Read the answers through the Management API: <code>GET /tales/&#123;id&#125;/responses</code>. The SDK sends a visitor's answer to <code>POST /delivery/v1/responses</code>.</p>
<p>Counts are kept per visitor id (a random id in the browser's local storage), so they are indicative only. The same person on two devices counts twice, and clearing storage resets the count.</p>
<h2 id="not-in-the-current-source">Not in the current source</h2>
<p>A dashboard page with charts for answers, and a per-tale analytics view, were not found in the current source.</p>
  `,
})
export class InteractiveComponentsPage {}
