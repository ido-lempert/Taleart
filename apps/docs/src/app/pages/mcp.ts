import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The MCP server (Model Context Protocol, over SSE): how an assistant or script connects, and the kill switch. */
@Component({
  selector: 'docs-mcp',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">MCP server</h1>
    <p class="lede">
      TaleArt runs a Model Context Protocol (MCP) server over SSE. An MCP client, such as an assistant or a tool that
      speaks MCP, connects to it with an <a routerLink="/api-tokens">API token</a> and works with your projects through
      the same operations as the <a routerLink="/api-reference">API reference</a>, as you and within the token's limits.
    </p>

    <h2 id="connect">Connect</h2>
    <p>Three steps. You need a <a routerLink="/api-tokens">read-write or read-only API token</a> first.</p>
    <ol class="steps">
      <li>
        <strong>Copy your token.</strong> In the dashboard, open <strong>Settings</strong>, then <strong>API tokens</strong>,
        and create one. It starts <code>tat_</code>; copy it now, it is shown only once.
      </li>
      <li>
        <strong>Add the server to Claude Code.</strong> Open a terminal in any folder, paste this command, and replace
        <code>tat_your_token</code> with your token and <code>your-taleart-api</code> with your API's host:
        <pre tabindex="0" role="region" aria-label="Add the TaleArt server to Claude Code"><code>claude mcp add --transport sse taleart https://your-taleart-api/api/v1/mcp/sse --header "Authorization: Bearer tat_your_token"</code></pre>
        On Windows, the same command works in Command Prompt, PowerShell and Windows Terminal.
      </li>
      <li>
        <strong>Check it.</strong> Start <code>claude</code> and type <code>/mcp</code>. <code>taleart</code> should show as
        connected. Then ask Claude something like "list my TaleArt projects": it calls <code>list_operations</code> and
        <code>call_operation</code> for you.
      </li>
    </ol>
    <p>To remove it later: <code>claude mcp remove taleart</code>.</p>

    <h3 id="config-file">Or put it in a config file</h3>
    <p>
      To share the setup with a project, save this as <code>.mcp.json</code> in the project folder. Claude Code reads
      <code>&#36;&#123;TALEART_TOKEN&#125;</code> from an environment variable of that name, so the token stays out of the file:
    </p>
    <pre tabindex="0" role="region" aria-label="Claude Code project config"><code>{{ projectConfig }}</code></pre>
    <p>
      Set the variable before starting Claude Code: on macOS or Linux, <code>export TALEART_TOKEN=tat_your_token</code>;
      on Windows, <code>setx TALEART_TOKEN "tat_your_token"</code>, then open a new terminal.
    </p>

    <h3 id="other-clients">Other MCP clients</h3>
    <p>
      Any client that supports MCP over SSE takes the same three values: the URL, the transport (<code>sse</code>) and the
      <code>Authorization</code> header. In a JSON settings file they look like this:
    </p>
    <pre tabindex="0" role="region" aria-label="Generic MCP client settings"><code>{{ genericConfig }}</code></pre>
    <p>
      The server answers <code>401</code> without a token, and a session cookie is never accepted here. Use a
      <em>read-only</em> token when the assistant only needs to look.
    </p>

    <h2 id="tools">Tools</h2>
    <p>The server offers two tools:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
      <thead>
        <tr>
          <th>Tool</th>
          <th>What it does</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>list_operations</code></td>
          <td>Lists the operations this token may call: <code>operationId</code>, method, path, tag and summary. Takes an optional <code>tag</code>.</td>
        </tr>
        <tr>
          <td><code>call_operation</code></td>
          <td>
            Calls one operation by its <code>operationId</code>, with <code>pathParams</code>, <code>query</code> and
            <code>body</code> as the operation needs. Returns the HTTP status and the JSON body.
          </td>
        </tr>
      </tbody>
    </table></div>
    <p>
      Uploads (fonts, media and user list files) are not offered: they send files, which the tools do not carry. Use the
      dashboard or the <a routerLink="/cli">command-line tool</a> for them.
    </p>

    <h2 id="limits">What it can do</h2>
    <ul>
      <li>Everything the token can do over the Management API, and nothing more: the token's projects and its read-only limit apply to every call.</li>
      <li>Nothing a token can never do: creating, listing or revoking API tokens, sign-in and sessions, and member changes.</li>
      <li>Calls are made by the API itself with the same token, so they are limited and recorded like any other request.</li>
    </ul>

    <h2 id="kill-switch">Kill switch</h2>
    <p>
      The server is on by default. To turn it off for the whole install, set <code>TALEART_MCP=off</code> in the API's
      environment and restart the API. Then <code>/api/v1/mcp/…</code> answers <code>404</code>, and no MCP client can
      connect. Leave it unset, or set <code>TALEART_MCP=on</code>, to keep it on. Any other value stops the API at start.
    </p>

    <h2 id="reference">Reference</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table>
      <thead>
        <tr>
          <th>Setting or path</th>
          <th>Meaning</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>GET /api/v1/mcp/sse</code></td>
          <td>Opens the event stream. Needs <code>Authorization: Bearer tat_…</code>.</td>
        </tr>
        <tr>
          <td><code>POST /api/v1/mcp/messages?sessionId=…</code></td>
          <td>Carries the client's messages. Repeat the same token; another token answers <code>401</code>.</td>
        </tr>
        <tr>
          <td><code>TALEART_MCP</code></td>
          <td><code>on</code> (default) or <code>off</code>, the kill switch.</td>
        </tr>
      </tbody>
    </table></div>
  `,
})
export class McpPage {
  /** The .mcp.json for a project; ${TALEART_TOKEN} stays a placeholder for the environment variable. */
  readonly projectConfig = `{
  "mcpServers": {
    "taleart": {
      "type": "sse",
      "url": "https://your-taleart-api/api/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer \${TALEART_TOKEN}"
      }
    }
  }
}`;
  /** The same three values in a generic client's JSON settings. */
  readonly genericConfig = `{
  "taleart": {
    "type": "sse",
    "url": "https://your-taleart-api/api/v1/mcp/sse",
    "headers": {
      "Authorization": "Bearer tat_your_token"
    }
  }
}`;
}
