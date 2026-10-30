import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CONFIG_FIELDS,
  EVENT_FIELDS,
  IOS_FUNCTIONS,
  IOS_ZONE_MEMBERS,
  BAR_LAYOUTS,
  BAR_SETTING_FIELDS,
  BANNER_SETTING_FIELDS,
  BANNER_VARIANTS,
  NATIVE_THEME_FIELDS,
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
      Countdowns, promo codes, polls, quizzes, ratings and reactions are drawn. A visitor’s answers are sent to the API and counted there.
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
      its default. The layouts, and the settings each one ignores, are described in <a routerLink="/ios-guide">the guide</a>
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
      its default. The variants, and the settings each one ignores, are described in <a routerLink="/ios-guide">the guide</a>
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
  protected readonly themeFields = NATIVE_THEME_FIELDS;
  protected readonly barLayouts = BAR_LAYOUTS;
  protected readonly barSettings = BAR_SETTING_FIELDS;
  protected readonly bannerVariants = BANNER_VARIANTS;
  protected readonly bannerSettings = BANNER_SETTING_FIELDS;
  protected readonly functions = IOS_FUNCTIONS;
  protected readonly hooks = LISTENER_HOOKS;
  protected readonly eventFields = EVENT_FIELDS;
  protected readonly stringKeys = STRING_KEYS;
  protected readonly mapping = MAPPING;
  protected readonly notYet = NOT_YET_NATIVE;
}
