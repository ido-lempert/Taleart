import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Hardening guide for the people who run a TaleArt install: what to set, what to back up, and what is still open. */
@Component({
  selector: 'docs-security',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Security and hardening</h1>
    <p class="lede">
      This is the checklist for running TaleArt on a real server. Work through it before you open the install to
      visitors or to other people on your team.
    </p>

    <h2 id="before-anyone-else">Before anyone else can reach it</h2>
    <p>
      On a new install, the first person to open the setup page becomes the first admin. Finish setup right after the
      first start, before the address is shared. Until then the install has no admin, so anyone who reaches it can claim
      that role.
    </p>

    <h2 id="secrets">Secrets</h2>
    <ul>
      <li>
        <strong>Replace the placeholders.</strong> <code>.env.docker.example</code> ships two public values:
        <code>POSTGRES_PASSWORD</code> and <code>TALEART_SECRET_KEY</code>. Anyone can read them in the repository.
        Generate new ones with <code>openssl rand -base64 32</code>, and use the generated key for
        <code>TALEART_SECRET_KEY</code>. The API logs a warning at start while the placeholder key is still set.
      </li>
      <li>
        <strong>Keep <code>TALEART_SECRET_KEY</code> safe.</strong> It encrypts the sign-in provider secrets (Google,
        Apple, OIDC) and the authenticator-app secrets stored in the database. If it is lost, the provider secrets cannot be
        read and must be entered again. If
        it is copied, the stored secrets can be decrypted by anyone holding the database and the key.
      </li>
      <li>
        <strong>Back up the database and the key together.</strong> A backup of the database alone does not contain the
        key, so restore it with the key from the same time.
      </li>
      <li>
        <strong>Do not publish the database.</strong> The bundled compose file publishes only the proxy. Keep it that
        way, and do not add a port for <code>db</code> or the API.
      </li>
    </ul>

    <h2 id="setup-password">Password setup</h2>
    <p>
      <code>TALEART_SETUP_PASSWORD</code> lets the first admin use a username and password instead of a passkey. It is
      off by default. The quick try in <code>.env.docker.example</code> turns it on so the setup screen works without a
      passkey device. On a real server, set it to <code>false</code> before the first start.
    </p>

    <h2 id="two-factor">Two-factor sign-in</h2>
    <ul>
      <li>
        <strong>Turn on Required once everyone has an app.</strong> Under <em>Settings > Sign-in methods</em>, the two-factor
        mode Required blocks a person without an authenticator app at sign-in until they set one up, administrators included.
        Optional leaves the choice to each person, and Off means nobody can set one up.
      </li>
      <li>
        <strong>Use a real <code>TALEART_SECRET_KEY</code>.</strong> Optional and Required refuse to save without the key, and
        the key must be private and not the placeholder from <code>.env.docker.example</code>. See the secrets above.
      </li>
      <li>
        <strong>Store the recovery codes safely.</strong> The ten codes are shown once, and each works once. Keep them
        somewhere other than the phone that runs the app, such as a password manager.
      </li>
      <li>
        <strong>Plan for a lost phone.</strong> With the phone and the recovery codes both gone, there is no self-service
        recovery. Another admin removes that user, and the user is invited again. Read
        <a routerLink="/guides/sign-in-methods">Sign-in methods</a> for the steps.
      </li>
    </ul>

    <h2 id="https-and-cookies">HTTPS, cookies and passkeys</h2>
    <ul>
      <li>
        Serve TaleArt over HTTPS: set <code>TALEART_URL</code> to an <code>https://</code> address. The bundled proxy then
        gets a certificate, and the session cookie is marked <code>Secure</code>.
      </li>
      <li>
        Passkeys work only from the dashboard's exact address. <code>RP_ID</code> is the domain, and
        <code>RP_ORIGIN</code> is the full origin with the scheme. Both must match the real address.
      </li>
      <li>
        Session cookies are <code>HttpOnly</code> and <code>SameSite=Strict</code>. Sign-out ends the session on the server
        as well as in the browser.
      </li>
    </ul>

    <h2 id="proxy">Reverse proxy and client addresses</h2>
    <p>
      The API counts failed sign-ins and rate limits by client address. It learns that address from the proxy only when
      <code>TRUST_PROXY</code> is set to the number of proxies in front of it. The bundled compose file sets it to
      <code>1</code>, which is right for the bundled Caddy. Set it wrongly and either every visitor shares one bucket, or
      a client can pick its own address.
    </p>
    <ul>
      <li>
        Do not publish the API port (3333) or the dashboard port (4000) on the host. The external-proxy overlay binds
        them to <code>127.0.0.1</code> for this reason.
      </li>
      <li>
        The bundled Caddy sets no security headers. At minimum, add HSTS and <code>nosniff</code> to the site block in
        <code>deploy/Caddyfile</code>:
        <pre tabindex="0"><code>header Strict-Transport-Security "max-age=31536000"
header X-Content-Type-Options nosniff</code></pre>
      </li>
    </ul>

    <h2 id="rate-limits">Rate limits and guessing</h2>
    <ul>
      <li>
        Password sign-in allows a burst of 10 attempts per client address, refilled at 10 per minute. Each username gets
        5 wrong guesses, then waits 30 seconds, doubling after each further failure up to 15 minutes. The wait is
        forgotten after an hour without a new failure.
      </li>
      <li>
        The guess counters live in each API process's memory. If you run several API processes, each keeps its own
        counters, so a guesser gets that many times the allowance. Run one API process, or add a shared limit at the
        proxy.
      </li>
      <li>
        The API does not limit the volume of public media and SDK requests. Add a request limit at your proxy if the
        install is public.
      </li>
    </ul>

    <h2 id="mcp">The MCP server</h2>
    <p>
      The MCP server is on by default. If you do not use it with Claude Code or another MCP client, set
      <code>TALEART_MCP=off</code>: its paths then answer 404 for the whole install.
    </p>

    <h2 id="tokens">API tokens</h2>
    <ul>
      <li>Create a token for one script, with <em>Read-only</em> on unless the script must change things.</li>
      <li>Pick only the projects it needs, and set an expiry.</li>
      <li>
        TaleArt stores only a hash of each token. A lost token cannot be shown again: revoke it and create another. Revoke
        a token as soon as its script is gone.
      </li>
    </ul>

    <h2 id="open-issues">Known limits</h2>
    <p>These are open in this version. Plan around them until they are fixed.</p>
    <ul>
      <li>
        <strong>Invitations made before the address was required cannot be used.</strong> Each invitation is now for one
        email address, which must join with it. An invitation created before that change has no address, so create a new one
        for each person who still needs access.
      </li>
      <li>
        <strong>Password guess limits are per process.</strong> See the rate-limit section above.
      </li>
      <li>
        <strong>No security headers beyond what you add.</strong> The dashboard does not set a Content Security Policy.
      </li>
    </ul>

    <p>
      If you embed the Web SDK on another site, read <a routerLink="/web-sdk-security">Web SDK: CSP and analytics</a>. The
      site that embeds it sets its own policy.
    </p>
  `,
})
export class SecurityPage {}
