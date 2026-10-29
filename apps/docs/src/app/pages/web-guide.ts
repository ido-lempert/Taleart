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

const COMPONENT_SAMPLE = `import { init } from '${EXAMPLE_INSTALL.sdkUrl}';

init({
  hooks: {
    onComponentEvent: (e) => {
      // A countdown reached its end, or a visitor copied a promo code (e.value is the code).
      if (e.component === 'countdown' && e.action === 'ended') analytics.track('countdown_ended', { group: e.groupId });
      if (e.component === 'promo-code' && e.action === 'copied') analytics.track('promo_copied', { code: e.value });
    },
  },
});`;

const COMPONENT_DOM_SAMPLE = `document.querySelector('taleart-view').addEventListener('taleart:component-event', (e) => {
  // The same payload as the hook: component, action, and value when there is one.
  console.log(e.detail.component, e.detail.action, e.detail.value);
});`;

const REACTION_SAMPLE = `import { init } from '${EXAMPLE_INSTALL.sdkUrl}';

init({
  hooks: {
    onComponentEvent: (e) => {
      // A visitor tapped an emoji of a reaction: e.value is the emoji.
      if (e.component === 'reaction' && e.action === 'selected') analytics.track('reaction', { emoji: e.value, group: e.groupId });
    },
  },
});`;

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
      hooks, a check on the test page, and five optional steps: a placeholder for a zone that cannot load, a limit on how often a group shows, countdown and promo-code elements, component events, and a reaction. The full list of attributes, options, strings, hooks and events is in the
      <a routerLink="/reference/web-sdk">Web SDK reference</a>.
    </p>

    <ol class="steps">
      <li>
        <strong>Issue the zone key.</strong> On the zone's <em>Install</em> tab in the dashboard, an admin issues the
        zone key (<code>tak_…</code>). It is shown once: copy it then. Rotating the key issues a new one and revokes
        the old, for that zone only.
        <figure>
          <img
            src="images/web-step-1-zone-key.svg"
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
            src="images/web-step-2-script.svg"
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
            src="images/web-view-bar.png"
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
            src="images/web-view-banner.png"
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
            src="images/web-view-hebrew.png"
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
            src="images/web-step-5-hooks.svg"
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
            src="images/web-step-6-test-page.svg"
            alt="Diagram: the Install tab's Open test page link opens a test page served by TaleArt, whose URL carries the zone key after the hash sign."
            width="640"
            height="260"
          />
          <figcaption>The test page link. A diagram, not a screenshot.</figcaption>
        </figure>
        <figure>
          <img
            src="images/web-view-viewer.png"
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
            src="images/web-shot-failure-slot.png"
            alt="A home page with the heading Home and a zone that cannot load. In the zone's place is a card with a yellow-to-violet gradient and the text Today's stories are on their way and Check back in a moment, the placeholder from the slot."
            width="1120"
            height="376"
          />
          <figcaption>
            A slot placeholder, a real screenshot of the SDK: the zone's key is refused, so the card of the page shows in
            its place.
          </figcaption>
        </figure>
        <figure>
          <img
            src="images/web-shot-failure-message.png"
            alt="The same home page with the zone set to fallback message: the text Stories could not be loaded. in the zone's place, and a Try again button below it."
            width="1120"
            height="416"
          />
          <figcaption>
            <code>fallback="message"</code>, a real screenshot of the SDK with the same refused key: its text and a Try again
            button.
          </figcaption>
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
            src="images/web-shot-frequency-before.png"
            alt="A bar of three circles, each with a picture and a name under it: Morning, Afternoon and Evening. Nothing has been viewed yet."
            width="1120"
            height="284"
          />
          <figcaption>Before: three groups on the bar, with <code>frequency="once"</code>. A real screenshot of the SDK.</figcaption>
        </figure>
        <figure>
          <img
            src="images/web-shot-frequency-after.png"
            alt="The same bar after a viewer opened the Morning group and the page was reloaded: the Morning circle is gone, and Afternoon and Evening remain."
            width="1120"
            height="284"
          />
          <figcaption>
            After: the Morning group was viewed once, so it is left out. A real screenshot of the SDK, after a reload.
          </figcaption>
        </figure>
      </li>

      <li>
        <strong>Add a countdown or a promo code.</strong> Both are elements of a tale, in the Interactive group of Tale
        Studio's palette. A countdown shows the days, hours, minutes and seconds to an instant in UTC, counted by the
        visitor's own clock, and then its end text. A promo code shows a code with a Copy button. The code is visible to
        every visitor, so it is not a secret. A tale may hold several of each.
        <ol class="substeps">
          <li>
            In the tale's studio, add <em>Countdown</em> or <em>Promo code</em> from the palette, then set its end time
            (UTC) or its code in the inspector. Every field and its limit is in the
            <a routerLink="/interactive-components">Interactive components</a> page.
          </li>
          <li>
            Check it on the test page or in the viewer: the countdown ticks each second, and the promo code has its Copy
            button.
          </li>
        </ol>
        <figure>
          <img
            src="images/web-shot-countdown.png"
            alt="A tale in the viewer at phone size: a sunset sale picture with a white card that reads Sale ends in, and the days, hours and minutes left: 2 days, 5 hours and 40 minutes."
            width="780"
            height="1400"
          />
          <figcaption>A countdown in the viewer, a real screenshot of the SDK with a sample tale.</figcaption>
        </figure>
        <figure>
          <img
            src="images/web-shot-promo.png"
            alt="A tale in the viewer at phone size: a teal picture with a gift box, and a white card with the title Your welcome gift, the code SUMMER25 in a dashed chip, its note, and a Copy button."
            width="780"
            height="1400"
          />
          <figcaption>A promo code in the viewer, a real screenshot of the SDK, before anyone copies it.</figcaption>
        </figure>
      </li>

      <li>
        <strong>Listen for component events.</strong> A countdown that ends and a promo code that is copied report a
        component event: the component's type, the action and, for a copy, the code. Set the hook for every element with
        <code>init</code>, or use the DOM event on one element. Poll, quiz, rating and reaction answers report one too, as
        <code>selected</code>, alongside <code>onUserInteracted</code>; for a reaction, the value is the emoji tapped.
        <pre tabindex="0" role="region" aria-label="Component event hook"><code>{{ componentSample }}</code></pre>
        <pre tabindex="0" role="region" aria-label="Component event DOM event"><code>{{ componentDomSample }}</code></pre>
        <figure>
          <img
            src="images/web-shot-promo-copied.png"
            alt="The promo code card after a visitor pressed Copy: the code SUMMER25 in its chip, and the status under the button, Copied. The viewer's header at the top names the group, Welcome gift."
            width="780"
            height="1400"
          />
          <figcaption>
            After Copy, a real screenshot of the SDK: the status reads Copied, and the hook has fired with the code.
          </figcaption>
        </figure>
      </li>

      <li>
        <strong>Add a reaction.</strong> A reaction asks one question and offers two to six emoji. A visitor taps one, the
        tap is counted, and then every emoji shows its count. A tale holds one reaction, and every visitor sees the counts.
        <ol class="substeps">
          <li>
            In the tale's studio, add <em>Reaction</em> from the Interactive group of the palette. In the inspector, type
            the question and an optional title, and choose the emoji: two to six, each different. Every field and its limit
            is in the <a routerLink="/interactive-components">Interactive components</a> page.
          </li>
          <li>
            Check it in the viewer: after a tap, each emoji shows its count and the tapped one is pressed. A visitor can tap
            once, and the tap is kept on that device, so a reload shows the same counts.
          </li>
          <li>
            Count the taps: the inspector's <em>Responses</em> panel lists each emoji with its taps (press Refresh), or read
            them from the Management API, <code>GET /tales/&#123;id&#125;/responses</code>.
          </li>
          <li>
            Listen for a tap: the component event's <code>component</code> is <code>reaction</code>, its action is
            <code>selected</code>, and its <code>value</code> is the emoji.
          </li>
        </ol>
        <pre tabindex="0" role="region" aria-label="Reaction event hook"><code>{{ reactionSample }}</code></pre>
        <figure>
          <img
            src="images/web-shot-reaction.png"
            alt="The viewer at phone size on the Tonight group: a fireworks picture, and a white card with the title Your reaction, the question How do you feel? and three emoji buttons, a red heart, a face with tears of joy and a surprised face, with no counts yet."
            width="780"
            height="1400"
          />
          <figcaption>A reaction in the viewer before a tap, a real screenshot of the SDK with a sample tale.</figcaption>
        </figure>
        <figure>
          <img
            src="images/web-shot-reaction-answered.png"
            alt="The same card after a tap on the red heart: each emoji shows its count, 129, 41 and 17, and the heart is pressed, marked by a thicker border and a grey background."
            width="780"
            height="1400"
          />
          <figcaption>
            After a tap, a real screenshot of the SDK: each emoji shows its count and the tapped heart is pressed. The counts
            are the sample's.
          </figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="when-it-is-live">When it is live</h2>
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
  protected readonly componentSample = COMPONENT_SAMPLE;
  protected readonly componentDomSample = COMPONENT_DOM_SAMPLE;
  protected readonly reactionSample = REACTION_SAMPLE;
}
