import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DOCS_PINNED_SCRIPT,
  DOCS_SNIPPET,
  DOCS_TEST_PAGE,
  DOCS_TEST_PAGE_WITH_KEY,
  DOCS_THEME_SCRIPT,
  DOCS_TWO_ZONES_SNIPPET,
  EXAMPLE_INSTALL,
} from '../docs-content';

@Component({
  selector: 'docs-install',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Install a zone</h1>
    <p class="lede">
      A page shows a zone with the Web SDK, the project's site key and the zone's slug. The zone page's
      <strong>Install</strong> tab gives you all three.
    </p>

    <h2 id="snippet">The snippet</h2>
    <p>The Install tab shows this snippet for its zone, with your API URL and the zone's slug filled in:</p>
    <pre id="docs-snippet"><code>{{ snippet }}</code></pre>
    <p>
      Replace <code>YOUR_SITE_KEY</code> with the project's site key. Right after you issue the key, the Install tab
      shows the snippet with the key already in it, ready to copy; after that the key is never shown again.
    </p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Attribute (property)</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>api-url</code> (<code>apiUrl</code>)</td>
            <td>The TaleArt API origin.</td>
          </tr>
          <tr>
            <td><code>site-key</code> (<code>siteKey</code>)</td>
            <td>The project's site key, <code>tas_…</code>. One per project.</td>
          </tr>
          <tr>
            <td><code>zone</code> (<code>zone</code>)</td>
            <td>The zone's slug, such as <code>home-top</code>, shown on the zone page.</td>
          </tr>
          <tr>
            <td><code>theme</code> (<code>theme</code>)</td>
            <td>Optional theme fields for this element only (JSON in the attribute).</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="site-key">The site key</h2>
    <ul>
      <li>
        A project has one site key. An admin issues it on any zone's Install tab; every zone of the project is placed
        with it and its own slug.
      </li>
      <li>
        It sits in your page's HTML, so it is not a secret: anyone who sees it can read every zone of the project that
        has a display and visible content, by its slug.
      </li>
      <li>
        <strong>Rotating</strong> it issues a new key and stops the old one at once, for every zone of the project:
        update every page that uses it. <strong>Revoking</strong> it stops every zone until a new key is issued.
      </li>
    </ul>

    <h2 id="several-zones">Several zones on one page</h2>
    <p>Load the script once and add one element per zone. They share the site key.</p>
    <pre><code>{{ twoZones }}</code></pre>

    <h2 id="sdk-url">Where the SDK comes from</h2>
    <p>
      The TaleArt API serves the Web SDK at <code>{{ sdkUrl }}</code>, an ES module. A deploy replaces it at the same
      URL, and browsers keep it for five minutes. Its <code>v1</code> follows the Delivery API's version.
    </p>
    <h3 id="pinned">Pinning it with Subresource Integrity</h3>
    <p>
      The same build is also served at a URL pinned to its content, <code>/sdk/v1/taleart.&lt;hash&gt;.js</code>,
      cached for a year. Signed in to the dashboard, <code>GET /api/v1/install</code> gives it as
      <code>sdkPinnedUrl</code> with its integrity value, <code>sdkIntegrity</code>:
    </p>
    <pre><code>{{ pinned }}</code></pre>
    <p>
      The browser then refuses any other file. A pinned URL is gone with the next build, so a page that pins it
      updates it on each release.
    </p>

    <h2 id="test-page">The test page</h2>
    <p>
      <em>Open test page</em> on the Install tab renders the zone on a page TaleArt serves, before you touch your
      site:
    </p>
    <pre><code>{{ testPageWithKey }}</code></pre>
    <ul>
      <li>
        The site key travels only in the URL fragment (after <code>#</code>), which a browser never sends to a server;
        the page removes it from the address bar. Opened as <code>{{ testPage }}</code>, it asks you to paste the
        key.
      </li>
      <li>The page stores the key nowhere and gives it only to the Web SDK.</li>
    </ul>

    <h2 id="theme">Theme for one zone</h2>
    <p>
      The project's theme styles every zone. A page can override it for one zone, by its slug, or for one element
      with its <code>theme</code> attribute:
    </p>
    <pre><code>{{ themeScript }}</code></pre>

    <h2 id="nothing-shows">When nothing shows</h2>
    <ul>
      <li>
        An unknown slug, or a revoked or rotated site key, renders nothing and logs one console error per element.
      </li>
      <li>
        Otherwise, open the zone page: it says <em>Not visible:</em> and why, such as "zone has no display",
        "group is off" or "zone not installed".
      </li>
    </ul>

    <p class="note">
      Coming from an earlier build with zone keys or stages? See
      <a routerLink="/moving-from-stages">Stages and zone keys</a>.
    </p>
  `,
})
export class InstallPage {
  protected readonly snippet = DOCS_SNIPPET;
  protected readonly twoZones = DOCS_TWO_ZONES_SNIPPET;
  protected readonly sdkUrl = EXAMPLE_INSTALL.sdkUrl;
  protected readonly pinned = DOCS_PINNED_SCRIPT;
  protected readonly testPage = DOCS_TEST_PAGE;
  protected readonly testPageWithKey = DOCS_TEST_PAGE_WITH_KEY;
  protected readonly themeScript = DOCS_THEME_SCRIPT;
}
