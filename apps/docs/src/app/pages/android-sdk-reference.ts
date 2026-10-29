import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ANDROID_COORDINATES,
  ANDROID_MOBILE_COORDINATES,
  ANDROID_VIEW_MEMBERS,
  ANDROID_ZONE_PARAMS,
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
      Polls, quizzes, ratings and reactions are not rendered by the native SDKs yet. Countdowns and promo codes are drawn.
    </p>

    <h2 id="coordinates">Coordinates and requirements</h2>
    <pre tabindex="0" role="region" aria-label="Android SDK coordinates"><code>{{ coordinates }}
{{ mobileCoordinates }}</code></pre>
    <ul>
      <li>Maven Central, group <code>site.lempert.taleart</code>, version 0.1.0. <code>android-sdk</code> depends on <code>mobile-sdk</code>.</li>
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
            <th scope="col">Native SDK</th>
          </tr>
        </thead>
        <tbody>
          @for (row of hooks; track row.name) {
            <tr>
              <td><code>{{ row.name }}</code></td>
              <td>{{ row.fired }}</td>
              <td>{{ row.payload }}</td>
              <td>{{ row.handles }}</td>
              <td>{{ row.native ? 'Yes' : 'Not yet' }}</td>
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
  protected readonly hooks = LISTENER_HOOKS;
  protected readonly eventFields = EVENT_FIELDS;
  protected readonly stringKeys = STRING_KEYS;
  protected readonly mapping = MAPPING;
  protected readonly notYet = NOT_YET_NATIVE;
}
