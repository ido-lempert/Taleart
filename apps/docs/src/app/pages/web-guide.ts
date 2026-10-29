import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_NPM_SNIPPET, DOCS_SNIPPET, DOCS_TEST_PAGE_WITH_KEY, EXAMPLE_INSTALL } from '../docs-content';

const LOCALE_SAMPLE = `import { init } from '${EXAMPLE_INSTALL.sdkUrl}';

init({
  locale: 'he',
  strings: { he: { 'viewer.close': 'סגור', 'viewer.nextGroup': 'הבאה' } },
});`;

const HOOKS_SAMPLE = `import { init } from '${EXAMPLE_INSTALL.sdkUrl}';

init({
  hooks: {
    // Analytics: one event per group the visitor sees (the analytics object is your own).
    onGroupImpression: (e) => analytics.track('group_seen', { group: e.group.id }),
    // Routing: stop the navigation for links to this site and open them in the app.
    onActionClicked: (e) => {
      if (e.url.startsWith('https://shop.example.com/')) {
        e.preventDefault();
        router.push(new URL(e.url).pathname);
      }
    },
  },
});`;

const DOM_SAMPLE = `document.querySelector('taleart-view').addEventListener('taleart:action-clicked', (e) => {
  // The same event as the hook, on the element: call e.preventDefault() to stop the link.
  console.log(e.detail.url, e.detail.newTab);
});`;

const FALLBACK_SAMPLE = `<!-- Your own placeholder, shown in place of the zone when it cannot be loaded: -->
<taleart-view zone-key="YOUR_ZONE_KEY">
  <p slot="fallback">Stories are unavailable right now.</p>
</taleart-view>

<!-- Or the SDK's text and a "Try again" button: -->
<taleart-view zone-key="YOUR_ZONE_KEY" fallback="message"></taleart-view>`;

const FREQUENCY_SAMPLE = `<!-- Once per group in each browser, for every element of the page: -->
<taleart-view zone-key="YOUR_ZONE_KEY" frequency="daily"></taleart-view>

<script>
  Taleart.init({
    frequency: 'once',
    hooks: { onGroupCapped: (e) => console.log('left out', e.groupId, e.rule) },
  });
</script>`;

const ELEMENT_SAMPLE = `<taleart-view zone-key="YOUR_ZONE_KEY"></taleart-view>

<!-- Give the element its height before it renders, so the page does not shift: -->
<style>
  taleart-view { display: block; min-height: 94px; }
</style>`;

@Component({
  selector: 'docs-web-guide',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Web guide</h1>
    <p class="lede">
      This guide puts a TaleArt zone on a web page, step by step: the zone key, the script, the element, the options, the
      hooks, a check on the test page, and two optional steps: a placeholder for a zone that cannot load, and a limit on how often a group shows. The full list of attributes, options, strings, hooks and events is in the
      <a routerLink="/reference/web-sdk">Web SDK reference</a>.
    </p>

    <ol class="steps">
      <li>
        <strong>Issue the zone key.</strong> On the zone's <em>Install</em> tab in the dashboard, an admin issues the
        zone key (<code>tak_…</code>). It is shown once: copy it then. Rotating the key issues a new one and revokes
        the old, for that zone only.
        <figure>
          <img
            src="/images/web-step-1-zone-key.svg"
            alt="Diagram of the zone's Install tab: first with no key, then with the new key shown once next to a Copy button."
            width="640"
            height="320"
          />
          <figcaption>A diagram of the Install tab, not a screenshot. The key is a placeholder.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Add the script once per page.</strong> Load the Web SDK from the TaleArt API with one script tag, or
        install the npm package if your app bundles its own code. The Install tab gives the tag for your API with the
        zone key filled in. For a pinned, integrity-checked version, see <a routerLink="/install">Install a zone</a>.
        <pre tabindex="0" role="region" aria-label="Script tag"><code>{{ snippet }}</code></pre>
        <pre tabindex="0" role="region" aria-label="npm install"><code>{{ npmSnippet }}</code></pre>
        <figure>
          <img
            src="/images/web-step-2-script.svg"
            alt="Two options side by side: a script tag that loads the SDK from the API, or the npm package imported in the app. Both place the same taleart-view element."
            width="640"
            height="300"
          />
          <figcaption>The two ways to get the SDK. The element is the same for both.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Place the zone.</strong> Put one <code>&lt;taleart-view&gt;</code> where the zone should appear, with
        its zone key. The element renders the zone's display (a bar of circles or a banner) and opens a group full
        screen when a visitor taps it. Each zone on the page takes its own element and key.
        <pre tabindex="0" role="region" aria-label="The zone element"><code>{{ elementSample }}</code></pre>
        <figure>
          <img
            src="/images/web-view-bar.png"
            alt="A rendered bar zone: four circles with group names under them (Summer, New arrivals, Winter, Trips), each with a picture from its first tale."
            width="1120"
            height="284"
          />
          <figcaption>
            A bar, rendered by the Web SDK from a sample zone (a real screenshot of the SDK, not the live API).
          </figcaption>
        </figure>
        <figure>
          <img
            src="/images/web-view-banner.png"
            alt="A rendered banner zone: a large picture slide with previous and next arrows, a pause button and four dots for the slides."
            width="1120"
            height="800"
          />
          <figcaption>A banner zone, from the same sample zone: its groups as slides.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Optional: set options once for the page.</strong> <code>Taleart.init</code> (or the named
        <code>init</code> of the npm package) sets the options for every element: the API origin (<code>apiUrl</code>,
        needed with npm, where the script has no origin), the locale, the texts (<code>strings</code>), the theme, the
        viewer's targeting and the hooks. An attribute on one element overrides the page's option. Here the texts are
        in Hebrew, and the viewer runs right to left.
        <pre tabindex="0" role="region" aria-label="Locale and strings"><code>{{ localeSample }}</code></pre>
        <figure>
          <img
            src="/images/web-view-hebrew.png"
            alt="The viewer open on a Hebrew group, right to left: the group name at the top right, a close button and a pause button, and the progress bars across the top."
            width="780"
            height="1400"
          />
          <figcaption>
            The viewer with <code>locale: 'he'</code>, a real screenshot of the SDK. The texts the SDK does not know show
            English.
          </figcaption>
        </figure>
      </li>

      <li>
        <strong>Listen to the hooks.</strong> The SDK reports what a visitor sees and does: a group coming on screen, a
        tap on a button, a poll answer, the viewer closing. Use them for analytics. A hook can also stop a link (its
        <code>preventDefault()</code>) and route it inside your app: only <em>action clicked</em> can be cancelled.
        Set hooks for every element with <code>init</code>, or for one element with its <code>hooks</code> property.
        <pre tabindex="0" role="region" aria-label="Hooks"><code>{{ hooksSample }}</code></pre>
        <pre tabindex="0" role="region" aria-label="DOM event"><code>{{ domSample }}</code></pre>
        <p>
          The same events are DOM events on the element, bubbling and named <code>taleart:</code> plus the event in
          kebab case (<code>taleart:group-impression</code>). Their <code>detail</code> is the payload. The full list
          is in the <a routerLink="/reference/web-sdk">Web SDK reference</a>.
        </p>
        <figure>
          <img
            src="/images/web-step-5-hooks.svg"
            alt="Diagram of one event's path: the element calls the element's hooks, then the page's init hooks, then dispatches a DOM event. A host route can call preventDefault to stop a link."
            width="640"
            height="330"
          />
          <figcaption>How one event reaches your page. A diagram, not a screenshot.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Verify with the test page.</strong> Before you touch your site, open the zone's test page from the
        Install tab (<em>Open test page</em>). It shows the zone on a page TaleArt serves, with the key in the URL
        fragment: a browser does not send the fragment to a server, and the page removes it from the address bar. Then
        open a group, to see the viewer the way a visitor does. If a zone does not show, the zone page says why
        (<em>Not visible:</em>), and the browser console shows one error for a key that is refused.
        <pre tabindex="0" role="region" aria-label="Test page link"><code>{{ testPageSample }}</code></pre>
        <figure>
          <img
            src="/images/web-step-6-test-page.svg"
            alt="Diagram: the Install tab's Open test page link opens a test page served by TaleArt, whose URL carries the zone key after the hash sign."
            width="640"
            height="260"
          />
          <figcaption>The test page link. A diagram, not a screenshot.</figcaption>
        </figure>
        <figure>
          <img
            src="/images/web-view-viewer.png"
            alt="The viewer open full screen on the Summer group of a phone-sized window: a sunset picture, a progress bar at the top, and the group name, a pause button and a close button."
            width="780"
            height="1400"
          />
          <figcaption>A group open in the viewer, at phone size (a real screenshot of the SDK).</figcaption>
        </figure>
      </li>

      <li>
        <strong>Show a placeholder when stories can't load.</strong> When the zone cannot be read (a refused or revoked
        key, a network failure), the element renders nothing by default. Choose what it shows instead:
        <ol class="substeps">
          <li>
            Your own markup: a child of the element with <code>slot="fallback"</code>. It is shown in place of the zone,
            and wins over the next option.
          </li>
          <li>
            The SDK's text: <code>fallback="message"</code> on the element, or <code>init({{ '{' }} fallback: 'message' {{ '}' }})</code>
            for every element. It shows "Stories could not be loaded." and a "Try again" button.
          </li>
          <li>
            Your code can read the zone again with <code>retry()</code> on the element. While the zone has failed, the
            element has <code>data-state="failed"</code>; a reload or a successful load removes it.
          </li>
        </ol>
        <pre tabindex="0" role="region" aria-label="Load-failure placeholder"><code>{{ fallbackSample }}</code></pre>
        <figure>
          <img
            src="/images/web-step-7-fallback.svg"
            alt="Diagram of what a zone shows when it cannot be loaded: a child with slot fallback is shown if there is one; otherwise, with fallback message, the SDK's text and a Try again button; with neither, nothing renders."
            width="640"
            height="310"
          />
          <figcaption>The placeholder rules, in order. A diagram, not a screenshot.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Limit how often a group shows.</strong> <code>frequency</code> leaves a tale group out of the display for
        a viewer after some views, or for a time after a view. Set it on the element, or for every element with
        <code>init({{ '{' }} frequency {{ '}' }})</code>; the element's attribute wins.
        <ol class="substeps">
          <li>
            Choose the rule: <code>once</code> (after the first view), <code>daily</code> (for 24 hours after a view),
            <code>weekly</code> (for 7 days after a view), or a whole number from 1 to 50 (after that many views, for good).
          </li>
          <li>
            Watch the cap: <code>onGroupCapped</code> fires for each group it leaves out, once per render (the DOM event
            is <code>taleart:group-capped</code>).
          </li>
          <li>
            Know the limit: views are counted in this browser only, under the local storage key
            <code>taleart.views</code>, and never sent to TaleArt. Another browser or device counts its own views.
          </li>
        </ol>
        <pre tabindex="0" role="region" aria-label="Frequency cap"><code>{{ frequencySample }}</code></pre>
        <figure>
          <img
            src="/images/web-step-8-frequency.svg"
            alt="Diagram of the frequency cap: a viewer opens a group, the view is counted in local storage, and the cap is checked. Under the cap the group shows; over the cap it is left out and onGroupCapped fires."
            width="640"
            height="316"
          />
          <figcaption>How a group is counted and left out. A diagram, not a screenshot.</figcaption>
        </figure>
      </li>
    </ol>

    <h2>When it is live</h2>
    <p>
      The zone shows on the page once the key is in place, the zone has a display, and it has visible content. The
      zone page's <em>Visible on site</em> says so. A page that places a zone must keep its key: rotating the key stops
      the old one at once, so update the page first. Read the
      <a routerLink="/reference/web-sdk">Web SDK reference</a> for the error behaviour.
    </p>
  `,
})
export class WebGuidePage {
  protected readonly snippet = DOCS_SNIPPET;
  protected readonly npmSnippet = DOCS_NPM_SNIPPET;
  protected readonly elementSample = ELEMENT_SAMPLE;
  protected readonly localeSample = LOCALE_SAMPLE;
  protected readonly hooksSample = HOOKS_SAMPLE;
  protected readonly domSample = DOM_SAMPLE;
  protected readonly testPageSample = DOCS_TEST_PAGE_WITH_KEY;
  protected readonly fallbackSample = FALLBACK_SAMPLE;
  protected readonly frequencySample = FREQUENCY_SAMPLE;
}
