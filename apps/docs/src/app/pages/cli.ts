import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-cli',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Command-line tool</h1>
<p>The <code>taleart</code> CLI drives the Management API from a terminal or a script. It signs in with an <a routerLink="/api-tokens">API token</a>, so it can do what the token allows, and nothing else.</p>
<h2 id="commands">Commands</h2>
<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
<thead>
<tr>
<th>Command</th>
<th>Does</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>login</code>, <code>logout</code>, <code>whoami</code>, <code>config</code></td>
<td>Sign in, sign out, show who you are, show settings</td>
</tr>
<tr>
<td><code>projects</code></td>
<td>List projects</td>
</tr>
<tr>
<td><code>zones</code></td>
<td>Zones, including <code>display</code>, <code>display-types</code> and <code>snippet</code></td>
</tr>
<tr>
<td><code>groups</code></td>
<td><code>create</code>, <code>on</code>, <code>off</code>, <code>tags</code>, <code>audience</code>, <code>rule</code>, <code>copy</code>, <code>place</code>, <code>unplace</code></td>
</tr>
<tr>
<td><code>tales</code></td>
<td>Tales</td>
</tr>
<tr>
<td><code>site-keys</code></td>
<td>Site keys</td>
</tr>
<tr>
<td><code>zone-keys</code></td>
<td>Zone keys (info, issue, rotate, revoke)</td>
</tr>
<tr>
<td><code>user-lists</code></td>
<td>User lists</td>
</tr>
<tr>
<td><code>skill install</code>, <code>skill show</code></td>
<td>The agent skill (see <a routerLink="/ai-agents">AI agents</a>)</td>
</tr>
</tbody>
</table></div>
<p>The tool acts with your role in each project (see <a routerLink="/roles-and-permissions">Roles and permissions</a>): <code>site-keys</code> and <code>zone-keys</code> need the project's Admin role, publishing needs Publisher, and an Editor can only save drafts. A refused command reports 403 <code>forbidden</code>. The tool cannot manage the team.</p>
<p>Run any command with <code>--help</code> for its options. Full HTTP details are in the <a routerLink="/api-reference">API reference</a>.</p>
<h2 id="audience-rules">Viewer property rules</h2>
<p>A group's audience rule (its <a routerLink="/targeting">viewer properties</a>) is set with <code>groups rule</code>. Give the rule as JSON, or clear it so every viewer passes it:</p>
<pre tabindex="0" role="region" aria-label="Example command"><code>taleart groups rule Summer --audience-json '&#123;"match":"all","conditions":[&#123;"property":"plan","operator":"eq","value":"pro"&#125;]&#125;'
taleart groups rule Summer --clear</code></pre>
<p>Give one of <code>--audience-json</code> or <code>--clear</code>. The command checks the rule as the dashboard does, and reports the rule it saved.</p>
<h2 id="read-only-tokens">Read-only tokens</h2>
<p>Make a token read-only for scripts that only report. A read-only token can read zones, groups and tales but cannot change them.</p>
  `,
})
export class CliPage {}
