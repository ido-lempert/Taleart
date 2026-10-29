import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-web-sdk-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Web SDK reference</h1>
    <p class="lede">
      The Web SDK (<code>@lempert/taleart</code>): the element, the page options, the functions, the texts, the hooks
      and the DOM events, and what happens when something goes wrong. For the steps, read the
      <a routerLink="/guides/web">Web guide</a>.
    </p>

    <h2 id="element">The element</h2>
    <p>
      Loading the SDK registers <code>&lt;taleart-view&gt;</code>. Each attribute has a property of the same meaning,
      named in camel case.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="attributes-caption">
      <table id="attributes">
        <caption id="attributes-caption">Attributes of &lt;taleart-view&gt;</caption>
        <thead>
          <tr>
            <th scope="col">Attribute</th>
            <th scope="col">Property</th>
            <th scope="col">Required</th>
            <th scope="col">Type and meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>zone-key</code></td>
            <td><code>zoneKey</code></td>
            <td>Yes</td>
            <td>
              The zone's key, <code>tak_…</code>, issued in the dashboard. It names the zone, so the element needs no
              slug. Without it the element renders nothing.
            </td>
          </tr>
          <tr>
            <td><code>api-url</code></td>
            <td><code>apiUrl</code></td>
            <td>No</td>
            <td>
              The TaleArt API origin. Default: the page's <code>apiUrl</code> option, else the origin the script loaded
              from.
            </td>
          </tr>
          <tr>
            <td><code>locale</code></td>
            <td><code>locale</code></td>
            <td>No</td>
            <td>
              This element's locale (BCP 47, such as <code>he-IL</code>). Default: the page's <code>locale</code> option,
              else the page's <code>lang</code>, else <code>en</code>.
            </td>
          </tr>
          <tr>
            <td><code>theme</code></td>
            <td><code>theme</code></td>
            <td>No</td>
            <td>
              Theme fields for this element only: JSON in the attribute (a JSON object), an object in the property. A
              field left out falls through to the next source (see the theme section of the SDK's README).
            </td>
          </tr>
          <tr>
            <td><code>fallback</code></td>
            <td><code>fallback</code></td>
            <td>No</td>
            <td>
              What the element shows when its zone fails to load: <code>none</code> (default, nothing) or
              <code>message</code> (the SDK's text and a retry button). A child with <code>slot="fallback"</code> is shown
              instead when there is one.
            </td>
          </tr>
          <tr>
            <td><code>frequency</code></td>
            <td><code>frequency</code></td>
            <td>No</td>
            <td>
              How often a viewer sees a tale group: <code>once</code>, <code>daily</code>, <code>weekly</code>, or a whole
              number from 1 to 50 (hidden after that many views). Default: none. Counted in this browser only.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="properties-caption">
      <table id="properties">
        <caption id="properties-caption">Properties without an attribute</caption>
        <thead>
          <tr>
            <th scope="col">Property</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>zone</code></td>
            <td>
              The zone's slug, such as <code>home-top</code>, from the response. Set it only to name the zone for
              <code>configureZone</code> when the response does not carry the slug.
            </td>
          </tr>
          <tr>
            <td><code>strings</code></td>
            <td>
              This element's texts, per locale or flat, added to the page's <code>strings</code>. This element's texts win.
            </td>
          </tr>
          <tr>
            <td><code>hooks</code></td>
            <td>This element's hooks. They are called before the page's <code>hooks</code>.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      The element's method <code>retry()</code> reads the zone again after a failed load. The button of
      <code>fallback="message"</code> calls it.
    </p>

    <h2 id="init">Taleart.init options</h2>
    <p>
      <code>init(config)</code> sets the page's options, before or after the elements connect. Every option is
      optional: an option left out keeps its value, and an element attribute overrides the option. <code>null</code>
      clears <code>locale</code>, <code>strings</code>, <code>theme</code>, <code>externalUserId</code>,
      <code>tags</code>, <code>hooks</code> and <code>frequency</code>; <code>fallback: null</code> means <code>none</code>.
      An invalid option logs one console warning that names it and keeps its value.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="init-options-caption">
      <table id="init-options">
        <caption id="init-options-caption">Options of Taleart.init</caption>
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>apiUrl</code></td>
            <td>string</td>
            <td>The origin the script loaded from</td>
            <td>The TaleArt API origin. Needed with the npm package, which has no script origin. An element's <code>api-url</code> wins.</td>
          </tr>
          <tr>
            <td><code>locale</code></td>
            <td>string or null</td>
            <td><code>document.documentElement.lang</code>, then <code>en</code></td>
            <td>The locale of the SDK's texts (BCP 47). An element's <code>locale</code> wins.</td>
          </tr>
          <tr>
            <td><code>strings</code></td>
            <td>object or null</td>
            <td>None: the SDK's English texts</td>
            <td>Texts per locale, such as <code>&#123; he: &#123; … &#125; &#125;</code>, or flat for every locale. See the strings table below.</td>
          </tr>
          <tr>
            <td><code>theme</code></td>
            <td>theme object or null</td>
            <td>None: the project's theme</td>
            <td>Theme fields for every element. A zone's <code>configureZone</code> theme and an element's own theme win over it.</td>
          </tr>
          <tr>
            <td><code>externalUserId</code></td>
            <td>string or null</td>
            <td>None</td>
            <td>
              The viewer's external user ID, for the user lists of the Audience page: an opaque ID, matched exactly, never
              an email address or a phone number.
            </td>
          </tr>
          <tr>
            <td><code>tags</code></td>
            <td>array of strings or null</td>
            <td>None: every group shows</td>
            <td>The viewer's targeting tags. Matched ignoring case and surrounding spaces. Same as <code>setTags</code>.</td>
          </tr>
          <tr>
            <td><code>hooks</code></td>
            <td>object or null</td>
            <td>None</td>
            <td>Hook functions for every element. See the hooks table below.</td>
          </tr>
          <tr>
            <td><code>fallback</code></td>
            <td><code>'none'</code> or <code>'message'</code>, or null</td>
            <td><code>none</code></td>
            <td>What every element shows when its zone fails to load: nothing, or the SDK's text and a retry button. An element's <code>fallback</code> wins.</td>
          </tr>
          <tr>
            <td><code>frequency</code></td>
            <td>Number from 1 to 50, <code>once</code>, <code>daily</code>, <code>weekly</code>, or null</td>
            <td>None: every group shows</td>
            <td>How often a viewer sees a tale group, counted in this browser. An element's <code>frequency</code> wins.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="functions">Exported functions</h2>
    <p>
      The module (<code>import … from</code> the script's URL, or the npm package) exports the functions below. The
      script also sets a global <code>Taleart</code> object with the same functions, except <code>getConfig</code>.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="functions-caption">
      <table id="functions">
        <caption id="functions-caption">Exports of the Web SDK</caption>
        <thead>
          <tr>
            <th scope="col">Export</th>
            <th scope="col">Signature</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>init</code></td>
            <td><code>init(config)</code>, returns nothing</td>
            <td>Sets the page's options (above). Calling it again changes only the options it names.</td>
          </tr>
          <tr>
            <td><code>getConfig</code></td>
            <td><code>getConfig()</code></td>
            <td>Returns every option with the value the SDK uses now. Module export only, not on the global object.</td>
          </tr>
          <tr>
            <td><code>configureZone</code></td>
            <td><code>configureZone(zone, options?)</code></td>
            <td>
              Sets the theme of the zone with this slug: <code>options.theme</code>, the same fields as the theme option.
              <code>configureZone(zone)</code> with no theme removes it. Import it from exactly the script's URL.
            </td>
          </tr>
          <tr>
            <td><code>setExternalUserId</code></td>
            <td><code>setExternalUserId(id)</code></td>
            <td>The same as <code>init</code> with <code>externalUserId</code>. Pass <code>null</code> after sign-out.</td>
          </tr>
          <tr>
            <td><code>setTags</code></td>
            <td><code>setTags(tags)</code></td>
            <td>The same as <code>init</code> with <code>tags</code>. Rendered elements show the matching groups at once.</td>
          </tr>
          <tr>
            <td><code>defineTaleartElement</code></td>
            <td><code>defineTaleartElement(tag?)</code></td>
            <td>Registers the element under <code>tag</code> (default <code>taleart-view</code>). Loading the SDK already does this.</td>
          </tr>
          <tr>
            <td><code>TaleartElement</code></td>
            <td>class</td>
            <td>The custom element's class, for <code>instanceof</code> checks and typings.</td>
          </tr>
          <tr>
            <td><code>TALEART_ELEMENT_TAG</code></td>
            <td><code>'taleart-view'</code></td>
            <td>The element's tag name.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="strings-section">Locale and strings</h2>
    <p>
      A text is looked up under the full locale (<code>he-IL</code>), then its language (<code>he</code>), then the flat
      <code>strings</code> option, then English. A key that nobody defines shows English, never the key itself. A
      <code>&#123;name&#125;</code> in a text is filled in by the SDK. The keys below are the SDK's texts; the English
      column is the default. Three defaults start with a space, so they follow a number or a name in a sentence.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="strings-caption">
      <table id="strings">
        <caption id="strings-caption">Text keys of the SDK and their English defaults</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">English default</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>viewer.close</code></td><td>Close</td></tr>
          <tr><td><code>viewer.play</code></td><td>Play</td></tr>
          <tr><td><code>viewer.pause</code></td><td>Pause</td></tr>
          <tr><td><code>viewer.previousTale</code></td><td>Previous tale</td></tr>
          <tr><td><code>viewer.nextTale</code></td><td>Next tale</td></tr>
          <tr><td><code>viewer.previousGroup</code></td><td>Previous</td></tr>
          <tr><td><code>viewer.nextGroup</code></td><td>Next</td></tr>
          <tr><td><code>viewer.previousGroupName</code></td><td>Previous group: &#123;name&#125;</td></tr>
          <tr><td><code>viewer.nextGroupName</code></td><td>Next group: &#123;name&#125;</td></tr>
          <tr><td><code>viewer.progress</code></td><td>&#123;group&#125;, tale &#123;tale&#125; of &#123;count&#125;</td></tr>
          <tr><td><code>viewer.taleFallback</code></td><td>Tale &#123;number&#125;</td></tr>
          <tr><td><code>banner.label</code></td><td>Banner</td></tr>
          <tr><td><code>banner.carousel</code></td><td>carousel</td></tr>
          <tr><td><code>banner.slide</code></td><td>slide</td></tr>
          <tr><td><code>banner.slideOf</code></td><td>&#123;index&#125; of &#123;count&#125;</td></tr>
          <tr><td><code>banner.previousSlide</code></td><td>Previous slide</td></tr>
          <tr><td><code>banner.nextSlide</code></td><td>Next slide</td></tr>
          <tr><td><code>banner.showGroup</code></td><td>Show &#123;name&#125;</td></tr>
          <tr><td><code>banner.stopRotation</code></td><td>Stop automatic slide show</td></tr>
          <tr><td><code>banner.startRotation</code></td><td>Start automatic slide show</td></tr>
          <tr><td><code>bar.seen</code></td><td>&#123;name&#125;, seen</td></tr>
          <tr><td><code>load.failed</code></td><td>Stories could not be loaded.</td></tr>
          <tr><td><code>load.retry</code></td><td>Try again</td></tr>
          <tr><td><code>links.newTab</code></td><td>(opens in a new tab)</td></tr>
          <tr><td><code>poll.voted</code></td><td>You voted &#123;label&#125;.</td></tr>
          <tr><td><code>poll.chose</code></td><td>You chose &#123;label&#125;.</td></tr>
          <tr><td><code>poll.previewNotRecorded</code></td><td>Votes are not recorded in the preview.</td></tr>
          <tr><td><code>poll.failed</code></td><td>Your vote could not be sent. Try again.</td></tr>
          <tr><td><code>quiz.answered</code></td><td>You answered &#123;label&#125;.</td></tr>
          <tr><td><code>quiz.right</code></td><td>Right! You answered &#123;label&#125;.</td></tr>
          <tr><td><code>quiz.wrongAnswer</code></td><td>Wrong: you answered &#123;label&#125;. The correct answer is &#123;correct&#125;.</td></tr>
          <tr><td><code>quiz.correct</code></td><td>correct answer</td></tr>
          <tr><td><code>quiz.wrong</code></td><td>wrong</td></tr>
          <tr><td><code>quiz.previewNotRecorded</code></td><td>Answers are not recorded in the preview.</td></tr>
          <tr><td><code>quiz.failed</code></td><td>Your answer could not be sent. Try again.</td></tr>
          <tr><td><code>rating.sliderLabel</code></td><td>Your rating</td></tr>
          <tr><td><code>rating.valueText</code></td><td>&#123;value&#125; out of &#123;max&#125;</td></tr>
          <tr><td><code>rating.ratedValueText</code></td><td>You rated &#123;value&#125; out of &#123;max&#125;</td></tr>
          <tr><td><code>rating.sent</code></td><td>You rated &#123;value&#125;.</td></tr>
          <tr><td><code>rating.previewRated</code></td><td>You rated &#123;value&#125;. Ratings are not recorded in the preview.</td></tr>
          <tr><td><code>rating.failed</code></td><td>Your rating could not be sent. Try again.</td></tr>
          <tr><td><code>rating.summary</code></td><td>Average &#123;average&#125; from &#123;total&#125; &#123;count&#125;</td></tr>
          <tr><td><code>rating.singular</code></td><td>rating</td></tr>
          <tr><td><code>rating.plural</code></td><td>ratings</td></tr>
          <tr><td><code>countdown.ended</code></td><td>Ended</td></tr>
          <tr><td><code>countdown.days</code></td><td>Days</td></tr>
          <tr><td><code>countdown.hours</code></td><td>Hours</td></tr>
          <tr><td><code>countdown.minutes</code></td><td>Min</td></tr>
          <tr><td><code>countdown.seconds</code></td><td>Sec</td></tr>
          <tr><td><code>promo.copy</code></td><td>Copy</td></tr>
          <tr><td><code>promo.copied</code></td><td>Copied</td></tr>
          <tr><td><code>promo.copyFailed</code></td><td>Could not copy. Select the code and copy it yourself.</td></tr>
          <tr><td><code>preview.stop</code></td><td>Stop preview</td></tr>
          <tr><td><code>preview.size.small</code></td><td>Small</td></tr>
          <tr><td><code>preview.size.default</code></td><td>Default</td></tr>
          <tr><td><code>preview.size.large</code></td><td>Large</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="hooks">Hooks</h2>
    <p>
      Hooks are set with <code>init({{ '{' }} hooks {{ '}' }})</code> for every element, or with an element's
      <code>hooks</code> property for one. The element's hook runs first, then the page's. Each hook gets one event
      object with <code>name</code>, <code>zoneKeyPrefix</code> (the first 8 characters of the key: the full key is never
      in an event) and <code>zoneSlug</code>, plus the fields in the table. A hook that throws is logged with
      <code>console.error</code>, and the viewer keeps going.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="hooks-caption">
      <table id="hooks">
        <caption id="hooks-caption">Hooks</caption>
        <thead>
          <tr>
            <th scope="col">Hook</th>
            <th scope="col">When it fires</th>
            <th scope="col">Payload fields</th>
            <th scope="col">Cancelable</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>onLoaded</code></td>
            <td>The zone was read. Once per load.</td>
            <td>none</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onLoadFailed</code></td>
            <td>The zone could not be read: a refused, unknown, rotated or revoked key, a network failure, a bad answer.</td>
            <td><code>error</code>: the message</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onGroupImpression</code></td>
            <td>A group's bar item or banner slide first is half on screen. Once per group per load.</td>
            <td><code>group</code>: <code>id</code>, <code>name</code>, <code>index</code> (from 0)</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onPresented</code></td>
            <td>The full-screen viewer opened on a group.</td>
            <td><code>group</code></td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onTaleShown</code></td>
            <td>A tale came on screen in the viewer.</td>
            <td><code>group</code>; <code>tale</code>: <code>id</code>, <code>index</code> (from 0 in the group), <code>title</code></td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onActionClicked</code></td>
            <td>A button, an image button or the swipe-up link was activated, before it navigates.</td>
            <td>
              <code>group</code>, <code>tale</code>; <code>component</code>: <code>id</code>, <code>type</code>; <code>url</code>,
              <code>newTab</code>; <code>preventDefault()</code>, which stops the navigation
            </td>
            <td>Yes</td>
          </tr>
          <tr>
            <td><code>onUserInteracted</code></td>
            <td>The server accepted a poll, quiz or rating answer.</td>
            <td><code>group</code>, <code>tale</code>; <code>component</code>: <code>id</code>, <code>type</code>, <code>value</code></td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onComponentEvent</code></td>
            <td>A component of a tale did something: a countdown <code>ended</code>, a promo code was <code>copied</code>, a poll, quiz or rating answer was <code>selected</code> (it fires with <code>onUserInteracted</code> for an answer).</td>
            <td><code>groupId</code>, <code>taleId</code>, <code>component</code> (the element type, such as <code>countdown</code>), <code>action</code>, <code>value</code> (the promo code, the option id, the answer id or the rating's number, when there is one)</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onDismissed</code></td>
            <td>The viewer closed.</td>
            <td><code>group</code></td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onGroupCapped</code></td>
            <td>The frequency cap left a tale group out of the display. Once per group per render.</td>
            <td><code>groupId</code>, <code>rule</code> (the cap: <code>once</code>, <code>daily</code>, <code>weekly</code> or a number)</td>
            <td>No</td>
          </tr>
          <tr>
            <td><code>onEvent</code></td>
            <td>Every event above, in one stream. Its argument is the event itself.</td>
            <td>The same as the event</td>
            <td>Only <em>action clicked</em>, as above</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 id="dom-events">DOM events</h2>
    <p>
      Each event is also a DOM event on the <code>&lt;taleart-view&gt;</code> element: it bubbles and is composed, and
      its <code>detail</code> is the event's payload (the same fields as the hook, with <code>name</code> omitted). The
      name is <code>taleart:</code> plus the event's name in kebab case. Only <code>taleart:action-clicked</code> can be
      canceled, with <code>preventDefault()</code> on the event.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="dom-events-caption">
      <table id="dom-events">
        <caption id="dom-events-caption">DOM events on the element</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Hook</th>
            <th scope="col">Cancelable</th>
          </tr>
        </thead>
        <tbody>
          <tr><td><code>taleart:loaded</code></td><td><code>onLoaded</code></td><td>No</td></tr>
          <tr><td><code>taleart:load-failed</code></td><td><code>onLoadFailed</code></td><td>No</td></tr>
          <tr><td><code>taleart:group-impression</code></td><td><code>onGroupImpression</code></td><td>No</td></tr>
          <tr><td><code>taleart:presented</code></td><td><code>onPresented</code></td><td>No</td></tr>
          <tr><td><code>taleart:tale-shown</code></td><td><code>onTaleShown</code></td><td>No</td></tr>
          <tr><td><code>taleart:action-clicked</code></td><td><code>onActionClicked</code></td><td>Yes</td></tr>
          <tr><td><code>taleart:user-interacted</code></td><td><code>onUserInteracted</code></td><td>No</td></tr>
          <tr><td><code>taleart:component-event</code></td><td><code>onComponentEvent</code></td><td>No</td></tr>
          <tr><td><code>taleart:dismissed</code></td><td><code>onDismissed</code></td><td>No</td></tr>
          <tr><td><code>taleart:group-capped</code></td><td><code>onGroupCapped</code></td><td>No</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="errors">Errors and edge behaviour</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="errors-caption">
      <table id="errors">
        <caption id="errors-caption">What the SDK does when something goes wrong</caption>
        <thead>
          <tr>
            <th scope="col">Situation</th>
            <th scope="col">What happens</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>The zone key is missing, refused, rotated or revoked</td>
            <td>The element renders nothing and logs one console error for it. <em>Load failed</em> fires.</td>
          </tr>
          <tr>
            <td>A rate limit (HTTP 429) or a network failure</td>
            <td>The element renders nothing and logs one console error. A reload later shows the zone again.</td>
          </tr>
          <tr>
            <td>An invalid <code>init</code> option</td>
            <td>One console warning names it, and the option keeps its value.</td>
          </tr>
          <tr>
            <td>An invalid <code>fallback</code> or <code>frequency</code> attribute</td>
            <td>One console warning names it, and the page's option (or none) applies.</td>
          </tr>
          <tr>
            <td>The zone cannot be loaded, and the element has a <code>slot="fallback"</code> child or <code>fallback="message"</code></td>
            <td>The element shows the child, or the SDK's text and a retry button. <code>retry()</code> reads the zone again.</td>
          </tr>
          <tr>
            <td>An invalid external user ID</td>
            <td>One console warning, and no ID is sent.</td>
          </tr>
          <tr>
            <td>An invalid theme field, or a <code>theme</code> attribute that is not a JSON object</td>
            <td>The field, or the attribute, is ignored with one console warning, and the next source's value applies.</td>
          </tr>
          <tr>
            <td><code>configureZone</code> without a zone slug</td>
            <td>One console warning, and the call is ignored.</td>
          </tr>
          <tr>
            <td>An element with the old <code>site-key</code> attribute</td>
            <td>One console warning, and nothing is placed with it. Use the element with <code>zone-key</code>.</td>
          </tr>
          <tr>
            <td>A hook throws</td>
            <td>The error is logged with <code>console.error</code>. The viewer keeps going.</td>
          </tr>
          <tr>
            <td>A button's or the swipe-up link's destination is not an absolute <code>http</code> or <code>https</code> URL of at most 2,048 characters</td>
            <td>The SDK does not draw that link.</td>
          </tr>
          <tr>
            <td>The page sets no tags, or no external user ID</td>
            <td>Every group shows, except those with user lists, which need the ID.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="note">
      Targeting and user lists are not access control: anyone with the zone key can read every visible group and its
      tag names. Keep private content out of tags and out of the zone.
    </p>
  `,
})
export class WebSdkReferencePage {}
