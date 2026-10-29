import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEFAULT_SDK_BUILDS_KEPT } from '@taleart/contract/core';
import {
  DOCS_PINNED_SCRIPT,
  DOCS_NPM_SNIPPET,
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
      A page shows a zone with the Web SDK and the zone's key. The zone page's <strong>Install</strong> tab gives you
      both.
    </p>

    <h2 id="snippet">The snippet</h2>
    <p>The Install tab shows this snippet for its zone, with your API URL filled in:</p>
    <pre id="docs-snippet" tabindex="0" role="region" aria-label="Install snippet"><code>{{ snippet }}</code></pre>
    <p>
      Replace <code>YOUR_ZONE_KEY</code> with the zone's key. Right after an admin issues the key, the Install tab
      shows the snippet with the key already in it, ready to copy; after that the key is never shown again. The
      second line is optional: <code>Taleart.init</code> sets page-wide options once, such as the locale, the
      strings and the theme.
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
            <td><code>zone-key</code> (<code>zoneKey</code>)</td>
            <td>Required. The zone's key, <code>tak_…</code>. It names the zone, so the element needs no slug.</td>
          </tr>
          <tr>
            <td><code>api-url</code> (<code>apiUrl</code>)</td>
            <td>Optional. The TaleArt API origin; by default the origin the script was loaded from.</td>
          </tr>
          <tr>
            <td><code>locale</code> (<code>locale</code>)</td>
            <td>Optional. The language of the viewer's own texts for this element; by default the page's.</td>
          </tr>
          <tr>
            <td><code>strings</code> (property only)</td>
            <td>Optional. Replacement texts for this element, an object set from script.</td>
          </tr>
          <tr>
            <td><code>theme</code> (<code>theme</code>)</td>
            <td>Optional. Theme fields for this element only (JSON in the attribute).</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="init">Page-wide options</h2>
    <p>
      The script loads once per page. <code>Taleart.init({{ '{' }} apiUrl, locale, strings, theme, hooks {{ '}' }})</code>
      sets options for every element on the page, before or after the elements connect; each option is optional, and
      an attribute on one element overrides it.
    </p>

    <h2 id="npm">With npm</h2>
    <p>
      If your app bundles the Web SDK itself, install the package and import <code>init</code> from it. The element
      markup is the same.
    </p>
    <pre tabindex="0" role="region" aria-label="npm install"><code>{{ npmSnippet }}</code></pre>

    <h2 id="zone-key">The zone key</h2>
    <ul>
      <li>
        A zone has at most one active key. An admin issues it on the zone's Install tab; it is shown once, so copy it
        then.
      </li>
      <li>
        It sits in your page's HTML, so anyone who sees it can read that one zone, while the zone has a display and
        visible content. It cannot read any other zone, so treat what the zone shows as public.
      </li>
      <li>
        Put the key only in the <code>zone-key</code> attribute (or the <code>zoneKey</code> property), never in a
        query string: a URL ends up in server logs and Referer headers. The SDK sends it only in the
        <code>Authorization</code> header.
      </li>
      <li>
        <strong>Rotating</strong> it issues a new key and stops the old one at once, for that zone only: update the
        pages that use it. <strong>Revoking</strong> it stops that zone until a new key is issued. Other zones are not
        affected.
      </li>
      <li>
        The project's site key (<code>tas_…</code>) is for server-side or legacy Delivery API calls, which also name
        the zone with <code>?zone=</code>. A web page does not use it.
      </li>
    </ul>

    <h2 id="several-zones">Several zones on one page</h2>
    <p>Load the script once and add one element per zone, each with its own zone key.</p>
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
      <code>sdkPinnedUrl</code> and <code>sdkIntegrity</code>, with <code>sdkBuildsKept</code>.)
    </p>
    <pre tabindex="0" role="region" aria-label="Pinned script tag"><code>{{ pinned }}</code></pre>
    <p>
      The browser then refuses any other file. By default the API keeps the last {{ buildsKept }} SDK builds this
      server served at their pinned URLs, the current one included, so a pinned page keeps working through the next
      {{ buildsKept - 1 }} SDK builds the server serves: update the pin before then. The Install tab says the server's
      own number; when it keeps only the current build, a pinned URL stops working at the next SDK build. An older or
      unknown hash answers 404, which no cache keeps.
    </p>
    <p>
      For the people who run TaleArt: the API writes each build it serves, at start and once the bundle has not
      changed for a second, to the folder <code>SDK_BUILDS_DIR</code> names (unset or empty:
      <code>.data/sdk-builds</code>, outside the build output), and keeps the newest <code>SDK_BUILDS_KEPT</code>
      ({{ buildsKept }} by default, at least 2: during a rolling deploy an old and a new process each keep their
      build). The folder must persist across deploys (a volume, in a container) and be shared by every API process
      that serves the same URLs, on hosts with synchronised clocks; in production the API warns at start when it holds
      no build. <code>SDK_BUILDS_DIR=off</code> (or <code>false</code>, <code>none</code>, <code>no</code>,
      <code>0</code>) keeps only the current build. Deploy a new SDK file atomically: write it elsewhere on the same
      disk, then rename it into place.
    </p>

    <h2 id="test-page">The test page</h2>
    <p>
      <em>Open test page</em> on the Install tab shows the zone on a page TaleArt serves, before you touch your
      site:
    </p>
    <pre tabindex="0" role="region" aria-label="Test page link"><code>{{ testPageWithKey }}</code></pre>
    <ul>
      <li>
        The zone key travels only in the URL fragment (after <code>#</code>), which a browser never sends to a server;
        the page removes it from the address bar. Opened as <code>{{ testPage }}</code>, it asks you to paste the
        key.
      </li>
      <li>The page stores the key nowhere and gives it only to the Web SDK.</li>
    </ul>

    <h2 id="theme">Theme for one zone</h2>
    <p>
      The project's theme styles every zone. A page can override it for one zone, by the zone's slug, or for one element
      with its <code>theme</code> attribute. Import <code>configureZone</code> from exactly the URL of your script
      tag (the pinned one, if you pin it): another URL loads a second copy of the SDK, and the elements never see
      its settings.
    </p>
    <pre tabindex="0" role="region" aria-label="Theme for one zone"><code>{{ themeScript }}</code></pre>

    <h2 id="visitor-id">The visitor id</h2>
    <p>
      Each device gets a visitor id: a random UUID v4 the SDK makes once and keeps on the device, in the page's local
      storage on the web (<code>taleart.visitor</code>) and in the SDK's own store in an app. It is random, not
      derived from the person or the device, and tied to no account. It is still a stable identifier of a browser or
      an app install, so cover it in your privacy notice and your consent setup like other local storage.
    </p>
    <p>
      The SDK sends it only to the Delivery API, in the <code>X-TaleArt-Visitor</code> header, so the API can limit
      requests per visitor and many visitors behind one network each get their own allowance. It also keys a
      visitor's vote on a poll, answer to a quiz and rating on a Rating, which count once per visitor; each needs the id.
      On the web the SDK keeps the visitor's answers in local storage too (<code>taleart.responses</code>), to show
      them on a return visit. Because the id is made on the device, poll and quiz counts and Rating averages are indicative,
      not tamper-proof: clearing site data, a private window or a script that invents ids can answer again, within
      the rate limits. Do not use a poll, a quiz or a Rating where the result must be trusted. A quiz's correct answer
      is published with the tale, so a quiz is not a secure test.
      Proxies, CDNs and access logs in front of the API can see the header too.
    </p>
    <ul>
      <li>
        On the web, clearing the site's data makes a new id, and Safari may clear script-written storage after seven
        days without a visit. Where local storage is blocked, the id lasts one page load.
      </li>
      <li>
        In an app, clearing the app's data makes a new id. A reinstall does too, unless a device backup restores it:
        Android Auto Backup and iOS backups restore the SDK's store. To start fresh after a reinstall on Android,
        exclude <code>sharedpref/taleart-sdk.xml</code> in the app's backup rules
        (<code>android:fullBackupContent</code> and <code>android:dataExtractionRules</code>).
      </li>
    </ul>

    <h2 id="nothing-shows">When nothing shows</h2>
    <ul>
      <li>
        A missing, revoked or rotated zone key, renders nothing and logs one console error per element.
      </li>
      <li>
        The Delivery API limits how often one visitor may ask (by default bursts of 600, then 20 requests a second),
        and one address ten times that in all. Over the limit it answers 429, and the element renders nothing and
        logs one console error; a reload later shows the zone again. A flood from one device behind a shared network
        (an office or a mobile carrier) can use up that address's allowance for everyone behind it.
      </li>
      <li>
        If you run the API behind a proxy, set <code>TRUST_PROXY</code> to exactly the proxies in front of it.
        Otherwise every visitor is counted as the proxy's address, and they all share one allowance.
      </li>
      <li>
        Otherwise, open the zone page: it says <em>Not visible:</em> and why, such as "zone has no display",
        "group is off" or "zone not installed".
      </li>
    </ul>

    <aside class="callout callout--note">
      <p>
        Coming from an earlier build with stages, or a page with a site key? See
        <a routerLink="/moving-from-stages">Stages and zone keys</a>.
      </p>
    </aside>
  `,
})
export class InstallPage {
  protected readonly snippet = DOCS_SNIPPET;
  protected readonly npmSnippet = DOCS_NPM_SNIPPET;
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
