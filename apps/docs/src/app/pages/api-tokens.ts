import { ChangeDetectionStrategy, Component } from '@angular/core';

/** API tokens for scripts (epic developer experience 10.1): what they are, their scope and their limits. */
@Component({
  selector: 'docs-api-tokens',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">API tokens</h1>
    <p class="lede">
      A personal API token lets a script, or the TaleArt command-line tool, call the Management API as you, without
      signing in with a passkey.
    </p>

    <h2>Create one</h2>
    <ol class="steps">
      <li>In the dashboard, open <strong>Settings</strong>, then <strong>API tokens</strong>.</li>
      <li>
        Name it for what it does, pick <em>All my projects</em> or only some, keep <em>Read-only</em> unless the script
        must change things, and choose when it expires.
      </li>
      <li>
        <strong>Copy the token now.</strong> It starts <code>tat_</code> and is shown only once: TaleArt keeps only a
        hash of it. Lost it? Revoke it and create another.
      </li>
    </ol>

    <h2>Use it</h2>
    <p>Send it in the <code>Authorization</code> header of each request:</p>
    <pre><code>curl -H "Authorization: Bearer $TALEART_TOKEN" https://your-taleart-api/api/v1/zones</code></pre>
    <p>
      Keep it in your script's secret settings, never in a page's HTML: a page uses the project's site key
      (<code>tas_</code>) instead. A token works only on the Management API, and a site key only on the Delivery API.
    </p>

    <h2>What a token can do</h2>
    <ul>
      <li>
        It acts as you, as you are at the time of each request: your role and your projects. It reaches the projects you
        gave it and can access, and nothing else. If you lose a project, the token loses it too.
      </li>
      <li>
        A token for <em>all my projects</em> follows your role: if you are made an admin, it reaches every project from
        then on. Pick only some projects when a script needs only those.
      </li>
      <li>A read-only token can read but never change anything.</li>
      <li>
        An admin's read-write token can do what the admin can in its projects, including issuing, rotating and revoking
        the project's site key, which affects every zone of the project. Give such a token only to scripts you trust
        with that.
      </li>
    </ul>

    <h2>What a token can never do</h2>
    <ul>
      <li>Create, list or revoke API tokens.</li>
      <li>Sign in or out, set up TaleArt, or manage passkeys and sessions.</li>
      <li>Invite people to a project.</li>
      <li>Create a project, unless it is an admin's read-write token for all projects.</li>
    </ul>
    <p>Those need you, signed in to the dashboard with your passkey.</p>

    <h2>Revoke and limits</h2>
    <ul>
      <li>Revoke a token under Settings &gt; API tokens; it stops working at once.</li>
      <li>
        An admin can revoke every token of a person at once (for a lost laptop or someone leaving) with
        <code>DELETE /api/v1/users/&lt;user id&gt;/api-tokens</code>, signed in to the dashboard.
      </li>
      <li>You can have up to 50 active tokens; expired and revoked ones do not count.</li>
      <li>
        Too many wrong tokens from one address in a short time answer <code>429</code> for a while; a valid token keeps
        working.
      </li>
    </ul>
  `,
})
export class ApiTokensPage {}
