import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** For the people who put the Web SDK on their own site: the Content Security Policy it needs, and how to turn analytics off. */
@Component({
  selector: 'docs-web-sdk-security',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Web SDK: CSP and analytics</h1>
    <p class="lede">
      If your site embeds the Web SDK, your site sets the Content Security Policy (CSP) that the browser enforces. This
      page lists the directives the SDK needs, and how to turn off the analytics it sends.
    </p>

    <h2 id="csp">Content Security Policy</h2>
    <p>
      Replace <code>https://api.example.com</code> with the address of your TaleArt API (the address the SDK script is
      loaded from). Every request the SDK makes goes to that one origin: the script, the Delivery API, analytics, media
      and fonts.
    </p>
    <p>
      Generate a new random nonce for each page load (at least 16 random bytes, base64). Put the same value in the policy
      header and in <code>Taleart.init</code>. The SDK gives every style sheet it adds that nonce, so the policy needs no
      <code>'unsafe-inline'</code>.
    </p>
    <pre tabindex="0"><code>Content-Security-Policy: default-src 'self';
  script-src 'self' https://api.example.com;
  connect-src 'self' https://api.example.com;
  img-src 'self' https://api.example.com;
  media-src 'self' https://api.example.com;
  font-src 'self' https://api.example.com;
  style-src 'self' 'nonce-R4nd0mN0nce'</code></pre>
    <pre tabindex="0"><code>&lt;script type="module" src="https://api.example.com/sdk/v1/taleart.js"&gt;&lt;/script&gt;
&lt;script nonce="R4nd0mN0nce"&gt;
  Taleart.init({{ '{' }} nonce: "R4nd0mN0nce" {{ '}' }});
&lt;/script&gt;</code></pre>
    <p>
      The nonce must be base64 text of 8 to 256 characters. An invalid one is ignored with a console warning, and the
      previous value stays.
    </p>

    <h3 id="directives">What each directive is for</h3>
    <table>
      <thead>
        <tr>
          <th scope="col">Directive</th>
          <th scope="col">Needed for</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>script-src</code></td>
          <td>Loading the SDK script from the API. No <code>'unsafe-eval'</code> or <code>'unsafe-inline'</code> is needed for scripts.</td>
        </tr>
        <tr>
          <td><code>connect-src</code></td>
          <td>Reading the zone from the Delivery API, and sending analytics events.</td>
        </tr>
        <tr>
          <td><code>img-src</code>, <code>media-src</code></td>
          <td>Pictures and video in tales, served by the API.</td>
        </tr>
        <tr>
          <td><code>font-src</code></td>
          <td>Project fonts, served by the API.</td>
        </tr>
        <tr>
          <td><code>style-src</code></td>
          <td>
            The SDK's own style sheets, which carry the nonce from <code>init</code>. Your page's own inline styles, if
            any, need their own nonce or hash.
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="what-is-not-needed">What is not needed</h3>
    <ul>
      <li>
        <code>'unsafe-eval'</code>: the SDK does not evaluate strings as code, and it does not use iframes or web workers.
      </li>
      <li>
        <code>'unsafe-inline'</code> for styles, once the nonce is set in <code>init</code>.
      </li>
      <li>
        <code>data:</code> or <code>blob:</code> in <code>img-src</code> or <code>media-src</code>: the SDK does not create
        such URLs itself. Add them only for your own page's needs.
      </li>
    </ul>

    <h3 id="sri">Pin the script with Subresource Integrity</h3>
    <p>
      The install information of the API (<code>GET /api/v1/install</code>, for a signed-in user or an API token) gives the
      hash of the current SDK build. Put it in the <code>integrity</code> attribute of the script tag, so the browser runs
      only that exact build. Pages that pin an earlier build by its URL keep working after an upgrade, as long as the
      API keeps that build (see <code>SDK_BUILDS_KEPT</code> in the install settings).
    </p>

    <h2 id="analytics">Turning analytics off</h2>
    <p>
      By default the SDK reports impressions (a tale group was shown), opens, tale views and clicks to the TaleArt API.
      Each event carries only its type, the group and tale it is about, and the time. Each request carries the zone key
      and a random visitor id kept in this browser. No external user id, tags or page data are sent. If you do not want
      any of this, turn analytics off in one of two places.
    </p>
    <ul>
      <li>
        <strong>On one element.</strong> Set <code>analytics="off"</code> on the element. Its impressions, opens, views
        and clicks are not reported. Any other value, or no attribute, leaves it on.
      </li>
      <li>
        <strong>On the whole page.</strong> Call <code>init</code> with <code>analytics: false</code> before you use the
        elements. Every element then reports nothing, unless an element sets <code>analytics</code> to <code>on</code>:
        an element's own attribute wins over the page setting. The <a routerLink="/reference/analytics">analytics
        reference</a> lists the events in full.
      </li>
    </ul>
    <pre tabindex="0"><code>&lt;taleart-view analytics="off" api-url="https://api.example.com" zone-key="…"&gt;&lt;/taleart-view&gt;</code></pre>

    <h3 id="what-still-happens">What still happens with analytics off</h3>
    <p>
      The SDK still reads the zone from the Delivery API and still loads the media it shows. The API still counts requests
      for rate limits. Turning analytics off stops the events, not the requests.
    </p>

    <p>
      For the installs' own hardening, read <a routerLink="/security">Security and hardening</a>.
    </p>
  `,
})
export class WebSdkSecurityPage {}
