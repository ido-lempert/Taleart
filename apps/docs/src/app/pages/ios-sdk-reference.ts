import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CONFIG_FIELDS,
  EVENT_FIELDS,
  IOS_FUNCTIONS,
  IOS_ZONE_MEMBERS,
  LISTENER_HOOKS,
  MAPPING,
  NATIVE_STYLES,
  NATIVE_VERSION,
  NOT_YET_NATIVE,
  STRING_KEYS,
  SWIFT_PACKAGE,
  TALEART_SDK_MEMBERS,
} from './native-docs-content';

@Component({
  selector: 'docs-ios-sdk-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: NATIVE_STYLES,
  template: `
    <h1 tabindex="-1">iOS SDK reference</h1>
    <p class="lede">
      The iOS SDK's classes, members, hooks and texts, as its Kotlin sources declare them and Swift sees them. The steps
      are in the <a routerLink="/ios-guide">iOS guide</a>.
      Interactive components, such as the countdown, the promo code and the reaction, are not rendered by the native SDKs yet.
    </p>

    <h2 id="package">Package and requirements</h2>
    <ul>
      <li>
        Version {{ version }}. The framework is <code>TaleartSDK.xcframework.zip</code>, attached to a GitHub release of
        <code>github.com/ido-lempert/Taleart</code>. Add it with Swift Package Manager (a binary target, from the
        repository's <code>Package.swift</code>), or unzip it and drag the XCFramework into the app target.
      </li>
      <li>iOS 15 or later (the minimum of the package). Device (arm64) and simulator on Apple silicon; the build has no Intel simulator slice.</li>
    </ul>
    <pre tabindex="0" role="region" aria-label="Swift package dependency"><code>{{ swiftPackage }}</code></pre>

    <h2 id="sdk">TaleartSdk</h2>
    <p>
      <code>object TaleartSdk</code>, used from Swift as <code>TaleartSdk.shared</code>. Kotlin's <code>init</code> is
      named <code>doInit</code> in Swift.
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
    <p>
      The options of <code>TaleartSdk.doInit(config:)</code>, built with <code>TaleartConfig(…)</code> and every argument
      given. Every field is optional on Android; pass all of them from Swift.
    </p>
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

    <h2 id="zone-view">TaleartZoneView</h2>
    <p>
      A zone's view, the iOS counterpart of <code>&lt;taleart-view&gt;</code>. Create it with
      <code>TaleartZoneView(apiUrl:zoneKey:)</code> and embed its <code>viewController</code>. Keep the object alive as
      long as the controller.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="zone-caption">
      <table id="zone-members">
        <caption id="zone-caption">TaleartZoneView members</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Type</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of zoneMembers; track row.name) {
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
    <p>Two functions return a view controller directly, for a zone whose key does not change:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="functions-caption">
      <table id="functions">
        <caption id="functions-caption">TaleartViewController functions</caption>
        <thead>
          <tr>
            <th scope="col">Function</th>
            <th scope="col">Returns</th>
            <th scope="col">Default</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (row of functions; track row.name) {
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

    <h2 id="listener">TaleartListener and TaleartListenerBase</h2>
    <p>
      The hooks. In Swift, subclass <code>TaleartListenerBase</code> (an open class whose methods do nothing) and override
      the hooks you need; a protocol cannot inherit those defaults. A hook that throws is logged, and the SDK goes on.
      The view's listener runs first, then the SDK's.
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
    <p>What each hook receives:</p>
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
      value in braces is filled in by the SDK. <code>links.open</code> is native only.
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
export class IosSdkReferencePage {
  protected readonly version = NATIVE_VERSION;
  protected readonly swiftPackage = SWIFT_PACKAGE;
  protected readonly sdkMembers = TALEART_SDK_MEMBERS;
  protected readonly configFields = CONFIG_FIELDS;
  protected readonly zoneMembers = IOS_ZONE_MEMBERS;
  protected readonly functions = IOS_FUNCTIONS;
  protected readonly hooks = LISTENER_HOOKS;
  protected readonly eventFields = EVENT_FIELDS;
  protected readonly stringKeys = STRING_KEYS;
  protected readonly mapping = MAPPING;
  protected readonly notYet = NOT_YET_NATIVE;
}
