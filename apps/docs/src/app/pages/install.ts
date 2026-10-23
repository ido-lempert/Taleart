import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEFAULT_SDK_BUILDS_KEPT } from '@taleart/contract/core';
import {
  DOCS_PINNED_SCRIPT,
  DOCS_SNIPPET,
  DOCS_TEST_PAGE,
  DOCS_TEST_PAGE_WITH_KEY,
  DOCS_THEME_SCRIPT,
  DOCS_TWO_ZONES_SNIPPET,
  EXAMPLE_INSTALL,
  SDK_CACHE_TEXT,
  SDK_PINNED_CACHE_TEXT,
} from '../docs-content';

@Component({
  selector: 'docs-install',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Install a zone</h1>
    <p class="lede">
      A page shows a zone with the Web SDK, the project's site key and the zone's slug. The zone page's
      <strong>Install</strong> tab gives you all three.
    </p>

    <h2 id="snippet">The snippet</h2>
    <p>The Install tab shows this snippet for its zone, with your API URL and the zone's slug filled in:</p>
    <pre id="docs-snippet" tabindex="0" role="region" aria-label="Install snippet"><code>{{ snippet }}</code></pre>
    <p>
      Replace <code>YOUR_SITE_KEY</code> with the project's site key. Right after you issue the key, the Install tab
      shows the snippet with the key already in it, ready to copy; after that the key is never shown again.
    </p>

    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="attributes-caption">
      <table id="attributes">
        <caption id="attributes-caption">Attributes of &lt;taleart-view&gt;</caption>
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
        has a display and visible content.
      </li>
      <li>
        Slugs are not access control either: they are often easy to guess (<code>home</code>), so treat everything a
        visible zone shows as public.
      </li>
      <li>
        Put the key only in the <code>site-key</code> attribute (or the <code>siteKey</code> property), never in a
        query string: a URL ends up in server logs and Referer headers. The SDK sends it only in the
        <code>Authorization</code> header.
      </li>
      <li>
        <strong>Rotating</strong> it issues a new key and stops the old one at once, for every zone of the project:
        update every page that uses it. <strong>Revoking</strong> it stops every zone until a new key is issued.
      </li>
    </ul>

    <h2 id="several-zones">Several zones on one page</h2>
    <p>Load the script once and add one element per zone. They share the site key.</p>
    <pre tabindex="0" role="region" aria-label="Two zones on one page"><code>{{ twoZones }}</code></pre>

    <h2 id="sdk-url">Where the SDK comes from</h2>
    <p>
      The TaleArt API serves the Web SDK at <code>{{ sdkUrl }}</code>, an ES module. A deploy replaces it at the same
      URL, and browsers keep it for {{ cacheText }}. Its <code>v1</code> follows the Delivery API's version.
    </p>
    <h3 id="pinned">Pinning it with Subresource Integrity</h3>
    <p>
      The same build is also served at a URL pinned to its content, <code>/sdk/v1/taleart.&lt;hash&gt;.js</code>,
      cached for {{ pinnedCacheText }}. The zone page's Install tab shows the URL and its integrity value under
      <em>Pin this SDK version</em>, each with a Copy button, and <em>Copy pinned script tag</em> copies the whole tag.
      (<code>&lt;api&gt;/api/v1/install</code>, opened where you are signed in to the dashboard, gives them as
      <code>sdkPinnedUrl</code> and <code>sdkIntegrity</code>.)
    </p>
    <pre tabindex="0" role="region" aria-label="Pinned script tag"><code>{{ pinned }}</code></pre>
    <p>
      The browser then refuses any other file. The API keeps the last {{ buildsKept }} builds it served at their pinned
      URLs, the current one included, so a pinned page keeps working through the next {{ buildsKept - 1 }} releases:
      update the pin before then. An older or unknown hash answers 404.
    </p>
    <p>
      For the people who run TaleArt: the API writes each build it serves, at start and whenever the bundle changes,
      to the folder <code>SDK_BUILDS_DIR</code> names (default <code>.data/sdk-builds</code>, outside the build output),
      and keeps the newest <code>SDK_BUILDS_KEPT</code> ({{ buildsKept }} by default). API processes that serve the
      same URLs share that folder; <code>SDK_BUILDS_DIR=off</code> keeps only the current build.
    </p>

    <h2 id="test-page">The test page</h2>
    <p>
      <em>Open test page</em> on the Install tab renders the zone on a page TaleArt serves, before you touch your
      site:
    </p>
    <pre tabindex="0" role="region" aria-label="Test page link"><code>{{ testPageWithKey }}</code></pre>
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
      with its <code>theme</code> attribute. Import <code>configureZone</code> from exactly the URL of your script
      tag (the pinned one, if you pin it): another URL loads a second copy of the SDK, and the elements never see
      its settings.
    </p>
    <pre tabindex="0" role="region" aria-label="Theme for one zone"><code>{{ themeScript }}</code></pre>

    <h2 id="nothing-shows">When nothing shows</h2>
    <ul>
      <li>
        An unknown slug, or a revoked or rotated site key, renders nothing and logs one console error per element.
      </li>
      <li>
        The Delivery API limits how often one address may ask (by default bursts of 600, then 20 requests a second).
        Over the limit it answers 429, and the element renders nothing and logs one console error; a reload later
        shows the zone again.
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
  protected readonly cacheText = SDK_CACHE_TEXT;
  protected readonly pinnedCacheText = SDK_PINNED_CACHE_TEXT;
  protected readonly buildsKept = DEFAULT_SDK_BUILDS_KEPT;
  protected readonly pinned = DOCS_PINNED_SCRIPT;
  protected readonly testPage = DOCS_TEST_PAGE;
  protected readonly testPageWithKey = DOCS_TEST_PAGE_WITH_KEY;
  protected readonly themeScript = DOCS_THEME_SCRIPT;
}
