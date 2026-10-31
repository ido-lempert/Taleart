import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ANDROID_COORDINATES,
  ANDROID_MOBILE_COORDINATES,
  ANDROID_VIEW_MEMBERS,
  ANDROID_ZONE_PARAMS,
  BAR_LAYOUTS,
  BAR_SETTING_FIELDS,
  BANNER_SETTING_FIELDS,
  BANNER_VARIANTS,
  NATIVE_THEME_FIELDS,
  CONFIG_FIELDS,
  EVENT_FIELDS,
  LISTENER_HOOKS,
  MAPPING,
  NATIVE_STYLES,
  NOT_YET_NATIVE,
  STRING_KEYS,
  TALEART_SDK_MEMBERS,
  XML_ATTRIBUTES,
} from './native-docs-content';


const NO_BACKEND_MEMBERS = [
  { name: 'TaleartZone(zoneJson = …)', type: '@Composable', meaning: 'Shows the zone JSON (the body of GET /delivery/v1/zone) with no request. Also takes modifier, onGroupClick, onError, seenGroups, titleStyle, opensViewer, locale, strings, listener and fallback.' },
  { name: 'TaleartView.zoneJson', type: 'String?', meaning: 'The zone JSON to show, with no key or API URL. Null clears it.' },
  { name: 'TaleartView.setZone(zone)', type: '(DeliveryZone) -> Unit', meaning: 'Shows a DeliveryZone object the app already holds.' },
  { name: 'TaleartZoneController.configureLocalJson(json)', type: '(String) -> Unit', meaning: 'The same for a controller you hold: shows the zone JSON, or fails like a failed read.' },
  { name: 'TaleartZoneController.configureLocal(zone)', type: '(DeliveryZone) -> Unit', meaning: 'The same for a DeliveryZone object.' },
  { name: 'TaleartSdk.parseZoneJson(json)', type: 'ZoneParse', meaning: 'Checks a text without showing it: ZoneParse.Success with the zone, or ZoneParse.Failure with errors, a readable list of what is wrong. Never throws.' },
];

@Component({
  selector: 'docs-android-sdk-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: NATIVE_STYLES,
  template: `
    <h1 tabindex="-1">Android SDK reference</h1>
    <p class="lede">
      The Android SDK's classes, members, hooks and texts, as its Kotlin and XML sources declare them. The steps are in
      the <a routerLink="/android-guide">Android guide</a>.
      Countdowns, promo codes, polls, quizzes, ratings and reactions are drawn. A visitor’s answers are sent to the API and counted there.
    </p>

    <h2 id="coordinates">Coordinates and requirements</h2>
    <pre tabindex="0" role="region" aria-label="Android SDK coordinates"><code>{{ coordinates }}
{{ mobileCoordinates }}</code></pre>
    <ul>
      <li>Maven Central, group <code>site.lempert.taleart</code>, version 0.1.1. <code>android-sdk</code> depends on <code>mobile-sdk</code>.</li>
      <li>Minimum Android 7.0 (API 24). Kotlin; the Compose UI comes with the SDK.</li>
      <li>The INTERNET permission, which the app declares.</li>
      <li>A host with a lifecycle for <code>TaleartView</code>: a ComponentActivity, an AppCompatActivity or a Fragment.</li>
    </ul>

    <h2 id="sdk">TaleartSdk</h2>
    <p>
      <code>object TaleartSdk</code> in <code>site.lempert.taleart.sdk</code>. Its configuration is shared by every view.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="sdk-caption">
      <table id="sdk">
        <caption id="sdk-caption">TaleartSdk members</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of sdkMembers; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="config">TaleartConfig</h2>
    <p>The options of <code>TaleartSdk.init</code>. Every field is optional.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="config-caption">
      <table id="config">
        <caption id="config-caption">TaleartConfig fields</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of configFields; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="view">TaleartView (XML and code)</h2>
    <p>
      A view that shows one zone, the Android counterpart of <code>&lt;taleart-view&gt;</code>. Its XML attributes:
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="xml-caption">
      <table id="xml">
        <caption id="xml-caption">TaleartView XML attributes</caption>
        <thead>
          <tr>
            <th scope="col">Attribute</th>
            <th scope="col">Format</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of xmlAttributes; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p>Its members in code:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="view-caption">
      <table id="view-members">
        <caption id="view-caption">TaleartView members</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of viewMembers; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="zone">TaleartZone (Compose)</h2>
    <p>The composable in <code>site.lempert.taleart.sdk.ui</code>. Its first two parameters have no default.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="zone-caption">
      <table id="zone-params">
        <caption id="zone-caption">TaleartZone parameters</caption>
        <thead>
          <tr>
            <th scope="col">Parameter</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of zoneParams; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="no-backend">Without a backend</h2>
    <p>The entry points that take the zone as JSON (or an object) instead of a key, all in <code>site.lempert.taleart.sdk</code>.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="local-caption">
      <table id="local">
        <caption id="local-caption">Zone data without a backend</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Type</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of noBackendMembers; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p>
      With zone data the view makes no call to the Delivery API: no zone request, no analytics events and no poll answer
      is sent (an answer is marked on the device only). Targeting by tags, properties and audience, the frequency cap,
      the theme, the listener events (<code>onLoaded</code> and <code>onLoadFailed</code>, with an empty key prefix),
      right-to-left layouts, and the bar, banner and viewer behave as with a fetched zone. Media URLs must be absolute
      <code>http(s)</code> addresses. Text that is not a zone is a failed read: logged once, <code>onLoadFailed</code>,
      never a crash. Setting a zone key or API URL afterwards reads from the API again.
    </p>

    <h2 id="theme">TaleartTheme</h2>
    <p>The project's theme as the native SDK reads it. The fields and their rules are the Web SDK's (see <a routerLink="/theme-and-fonts">Theme and fonts</a>); a field left out or not valid takes its default.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="theme-caption">
      <table id="theme-fields">
        <caption id="theme-caption">TaleartTheme fields</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of themeFields; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="bar">Bar settings</h2>
    <p>
      The bar display's settings, set in the dashboard on a bar zone's frame. A setting that is missing or not valid takes
      its default. The layouts, and the settings each one ignores, are described in <a routerLink="/android-guide">the guide</a>
      under Bar layouts.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="bar-layouts-caption">
      <table id="bar-layouts-table">
        <caption id="bar-layouts-caption">Bar layouts</caption>
        <thead>
          <tr>
            <th scope="col">Layout</th>
            <th scope="col">Use</th>
            <th scope="col">Ignored settings</th>
          </tr>
        </thead>
        <tbody>
          @for (row of barLayouts; track row.layout) {
            <tr>
              <td><code>{{ row.layout }}</code></td>
              <td>{{ row.use }}</td>
              <td>{{ row.ignored }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="bar-settings-caption">
      <table id="bar-settings-fields">
        <caption id="bar-settings-caption">Bar settings</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of barSettings; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="banner">Banner settings</h2>
    <p>
      The banner display's settings, set in the dashboard on a banner zone's frame. A setting that is missing or not valid takes
      its default. The variants, and the settings each one ignores, are described in <a routerLink="/android-guide">the guide</a>
      under Banner variants.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="banner-variants-caption">
      <table id="banner-variants-table">
        <caption id="banner-variants-caption">Banner variants</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            <th scope="col">Use</th>
            <th scope="col">Ignored settings</th>
          </tr>
        </thead>
        <tbody>
          @for (row of bannerVariants; track row.variant) {
            <tr>
              <td><code>{{ row.variant }}</code></td>
              <td>{{ row.use }}</td>
              <td>{{ row.ignored }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="banner-settings-caption">
      <table id="banner-settings-fields">
        <caption id="banner-settings-caption">Banner settings</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of bannerSettings; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="poll-views">Poll views</h2>
    <p>
      A poll element's <code>view</code> picks how it is drawn: sticker (the default; a missing or unknown view is a sticker),
      embed, this-or-that, grid or inline. Each option may carry a <code>color</code> (<code>#rrggbb</code>), used only by this-or-that
      and grid; without one, the theme's colours are used. The embed header is the strings <code>poll.votes</code> and
      <code>poll.resultsAfterVote</code> (see String keys). The guide shows each view under Poll views.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="poll-views-caption">
      <table>
        <caption id="poll-views-caption">The poll views and their option colours</caption>
        <thead>
          <tr><th scope="col">View</th><th scope="col">Use</th><th scope="col">Option colour</th></tr>
        </thead>
        <tbody>
          <tr><td><code>sticker</code></td><td>A small card over the tale (default).</td><td>Not used.</td></tr>
          <tr><td><code>embed</code></td><td>A full-width card with its own results header (the vote total, or the hint before a vote).</td><td>Not used.</td></tr>
          <tr><td><code>this-or-that</code></td><td>Two halves split at the vote's share, with a VS mark on the seam.</td><td>Each half: its colour, else the theme's.</td></tr>
          <tr><td><code>grid</code></td><td>Two large tiles with their shares.</td><td>Each tile: its colour, else the theme's.</td></tr>
          <tr><td><code>inline</code></td><td>Compact rows, in the flow of a page.</td><td>Not used.</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="listener">TaleartListener</h2>
    <p>
      The hooks. Implement the interface and override the methods you need; each default does nothing. A hook that throws
      is logged, and the SDK goes on. The view's listener runs first, then the SDK's.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="hooks-caption">
      <table id="hooks">
        <caption id="hooks-caption">TaleartListener methods</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">When it fires</th>
            <th scope="col">Payload</th>
            <th scope="col">Can handle</th>
          </tr>
        </thead>
        <tbody>
          @for (row of hooks; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td>{{ row.fired }}</td>
              <td>{{ row.payload }}</td>
              <td>{{ row.handles }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="event">TaleartEvent</h2>
    <p>
      What each hook receives. Groups and tales are <code>GroupRef</code> (id, name, index) and <code>TaleRef</code>
      (id, index, title); a component is <code>ComponentRef</code> (id, type, value).
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="event-caption">
      <table id="event-fields">
        <caption id="event-caption">TaleartEvent fields</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of eventFields; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td><code>{{ row.type }}</code></td>
              <td>{{ row.def }}</td>
              <td>{{ row.meaning }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="strings">String keys</h2>
    <p>
      The texts the SDK shows, with the English default of each. Give your own per locale in <code>strings</code>. A
      <code>&#123;name&#125;</code>-style value is filled in by the SDK. <code>links.open</code> is native only.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="strings-caption">
      <table id="string-keys">
        <caption id="strings-caption">String keys and English defaults</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">English default</th>
            <th scope="col">Where it shows</th>
          </tr>
        </thead>
        <tbody>
          @for (row of stringKeys; track row.key) {
            <tr>
              <td><code>{{ row.key }}</code></td>
              <td>{{ row.english }}</td>
              <td>{{ row.note }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="side-by-side">Web, Android and iOS side by side</h2>
    <p>The same SDK in each platform. The Web SDK's page is <a routerLink="/install">Install a zone</a>.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="mapping-caption">
      <table id="mapping">
        <caption id="mapping-caption">Web, Android and iOS side by side</caption>
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col">Web</th>
            <th scope="col">Android</th>
            <th scope="col">iOS</th>
          </tr>
        </thead>
        <tbody>
          @for (row of mapping; track row.topic) {
            <tr>
              <th scope="row">{{ row.topic }}</th>
              <td>{{ row.web }}</td>
              <td>{{ row.android }}</td>
              <td>{{ row.ios }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="not-yet">Not available natively yet</h2>
    <ul>
      @for (line of notYet; track line) {
        <li>{{ line }}</li>
      }
    </ul>
  `,
})
export class AndroidSdkReferencePage {
  protected readonly coordinates = ANDROID_COORDINATES;
  protected readonly mobileCoordinates = ANDROID_MOBILE_COORDINATES;
  protected readonly sdkMembers = TALEART_SDK_MEMBERS;
  protected readonly configFields = CONFIG_FIELDS;
  protected readonly xmlAttributes = XML_ATTRIBUTES;
  protected readonly viewMembers = ANDROID_VIEW_MEMBERS;
  protected readonly zoneParams = ANDROID_ZONE_PARAMS;
  protected readonly noBackendMembers = NO_BACKEND_MEMBERS;
  protected readonly themeFields = NATIVE_THEME_FIELDS;
  protected readonly barLayouts = BAR_LAYOUTS;
  protected readonly barSettings = BAR_SETTING_FIELDS;
  protected readonly bannerVariants = BANNER_VARIANTS;
  protected readonly bannerSettings = BANNER_SETTING_FIELDS;
  protected readonly hooks = LISTENER_HOOKS;
  protected readonly eventFields = EVENT_FIELDS;
  protected readonly stringKeys = STRING_KEYS;
  protected readonly mapping = MAPPING;
  protected readonly notYet = NOT_YET_NATIVE;
}
