import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  NATIVE_STYLES,
  NOT_YET_NATIVE,
  SWIFT_HOOKS,
  SWIFT_INIT,
  SWIFT_LOCALE,
  SWIFT_PACKAGE,
  SWIFT_UIKIT,
  SWIFTUI_REPRESENTABLE,
} from './native-docs-content';

@Component({
  selector: 'docs-ios-guide',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: NATIVE_STYLES,
  template: `
    <h1 tabindex="-1">iOS guide</h1>
    <p class="lede">
      Show a TaleArt zone in an iOS app with the iOS SDK: a view controller for UIKit, or a SwiftUI view made from it.
      You need the zone key from the dashboard, the same key the Web SDK uses.
    </p>

    <h2 id="before">Before you start</h2>
    <ul>
      <li>iOS 15 or later, Xcode and Swift. The framework is built for devices (arm64) and for the simulator on Apple silicon.</li>
      <li>A zone with a display, and its key (<code>tak_…</code>), from the zone's Install tab in the dashboard.</li>
    </ul>

    <h2 id="steps">Steps</h2>
    <ol class="steps">
      <li>
        <h3 id="step-package">Add the SDK</h3>
        <p>
          The easiest way is Swift Package Manager: in Xcode choose <strong>File &gt; Add Package Dependencies</strong>
          and enter the repository URL. The repository's <code>Package.swift</code> points at the
          <code>TaleartSDK.xcframework.zip</code> attached to a GitHub release, so the version you choose is the framework
          you get.
        </p>
        <pre tabindex="0" role="region" aria-label="Swift package dependency"><code>{{ swiftPackage }}</code></pre>
        <p>
          Or add the framework by hand: download <code>TaleartSDK.xcframework.zip</code> from the release page, unzip it,
          and drag <code>TaleartSDK.xcframework</code> into your app target. Set its embed option to match the framework's
          type: embed and sign a dynamic framework, do not embed a static one (its <code>Info.plist</code> says which).
        </p>
        <figure class="native-figure">
          <img
            src="images/ios-1-package.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: your Xcode project adds the Taleart package, which downloads TaleartSDK.xcframework.zip from a GitHub release. Dragging the unzipped framework into the target is the other way."
          />
          <figcaption class="muted">Diagram of the two ways to add the SDK (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-zone-key">Get the zone key</h3>
        <p>
          On the zone's <strong>Install</strong> tab in the dashboard, copy the key (<code>tak_…</code>). The key is
          shown once, when it is issued. Put it in your code as a value, never in a URL. It reads that one zone, so treat
          what the zone shows as public. Rotating the key issues a new one and stops the old one at once.
        </p>
        <figure class="native-figure">
          <img
            src="images/ios-2-zone-key.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram of the dashboard's Install tab for a zone: the zone key starts with tak_, is shown once, and has a Copy button."
          />
          <figcaption class="muted">Diagram of the Install tab (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-place">Place the zone: UIKit or SwiftUI</h3>
        <p>
          <code>TaleartZoneView</code> shows one zone. Its <code>viewController</code> is the controller to embed, and
          <code>onHeightChange</code> reports the bar's or banner's height, so the container can size to it. Keep the
          <code>TaleartZoneView</code> alive as long as the controller: it holds the zone's state. A UIKit screen embeds
          it as a child controller.
        </p>
        <pre tabindex="0" role="region" aria-label="UIKit child view controller"><code>{{ swiftUikit }}</code></pre>
        <p>
          In SwiftUI, wrap the controller in a <code>UIViewControllerRepresentable</code>. Its coordinator keeps the
          <code>TaleartZoneView</code>, and the height goes back to a state value:
        </p>
        <pre tabindex="0" role="region" aria-label="SwiftUI representable"><code>{{ swiftUI }}</code></pre>
        <figure class="native-figure">
          <img
            src="images/ios-3-place-view.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: two phones show the same bar above the app's content. One embeds the zone as a UIKit child controller, the other wraps it in a SwiftUI representable."
          />
          <figcaption class="muted">Diagram: the same bar in both ways (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-init">Initialise once at launch</h3>
        <p>
          Set the SDK's configuration once, at launch, before any zone view shows. Every view reads it; a later call
          replaces it, and the views read it again. Set <code>apiUrl</code>: a native app has no page to take the origin
          from, and with an empty one a zone shows nothing. The call is <code>doInit(config:)</code> in Swift, because
          Kotlin's <code>init</code> is named that way for Objective-C.
        </p>
        <pre tabindex="0" role="region" aria-label="Initialise at launch"><code>{{ swiftInit }}</code></pre>
        <figure class="native-figure">
          <img
            src="images/ios-4-init.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: the app calls TaleartSdk once at launch. The configuration holds apiUrl, locale, strings and listener, and every zone view reads it."
          />
          <figcaption class="muted">Diagram of the start-up order (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-hooks">Listen to hooks and override a link</h3>
        <p>
          Subclass <code>TaleartListenerBase</code> in Swift and override the hooks you need. Its methods do nothing by
          default, so override only what you use. Pass the subclass as <code>listener</code> in the configuration, or on
          one zone view. The view's listener runs first, then the global one.
        </p>
        <p>
          <code>onActionClicked</code> returns a Boolean. Return <code>true</code> when your app routed the link, and the
          SDK does not open it. Return <code>false</code> and the system opens it in the browser.
        </p>
        <pre tabindex="0" role="region" aria-label="Listener subclass and link override"><code>{{ swiftHooks }}</code></pre>
        <p>
          The methods, their payloads and the events are in the <a routerLink="/reference/ios-sdk">iOS SDK reference</a>.
          <code>onGroupImpression</code> and <code>onUserInteracted</code> are not called by the native SDK yet.
        </p>
        <figure class="native-figure">
          <img
            src="images/ios-5-listeners.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: a zone event goes to the view's listener, then to the global listener. If onActionClicked returns true the app routes the link; if it returns false the system opens the browser."
          />
          <figcaption class="muted">Diagram of the hook order and the link decision (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-locale">Localise the texts</h3>
        <p>
          The SDK's texts (the viewer's buttons, the banner's controls, the names it announces) are English by default.
          Set <code>locale</code> (BCP 47, such as <code>he-IL</code>) and the texts per locale. A text is looked up under
          the full locale, then its language, then <code>stringsForEveryLocale</code>, then English. A missing key shows
          English, never the key. With no locale set, the device's locale is used. A single zone view takes its own
          locale and strings:
        </p>
        <pre tabindex="0" role="region" aria-label="Localise one zone view"><code>{{ swiftLocale }}</code></pre>
        <p>
          Each string key and its English default is in the <a routerLink="/reference/ios-sdk">iOS SDK reference</a>.
        </p>
        <figure class="native-figure">
          <img
            src="images/ios-6-localise.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: a configuration with locale he-IL and Hebrew strings, and a phone whose viewer shows the close label in Hebrew and a seen label reading name then, in Hebrew."
          />
          <figcaption class="muted">Diagram of the localised result (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-verify">Verify</h3>
        <p>Run the app in the simulator (Apple silicon) or on a device, then check, in order:</p>
        <ul>
          <li>The bar (or banner) appears where you placed the zone view, and takes its height.</li>
          <li>A tap on a circle opens the viewer, and Close (in your locale) dismisses it.</li>
          <li>
            The Xcode console shows the SDK's messages, marked <code>TaleArt</code>. A wrong key shows no zone and logs
            one failure; <code>onLoadFailed</code> gets the message.
          </li>
        </ul>
        <figure class="native-figure">
          <img
            src="images/ios-7-verify.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: a phone with the viewer open, and a checklist: the bar shows the zone, a tap opens the viewer, Close returns to the bar, and onLoaded is printed to the console."
          />
          <figcaption class="muted">Diagram of the checks (not a screenshot).</figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="backups">Backups and the visitor id</h2>
    <p>
      The SDK makes a visitor id once and keeps it in its own store on the device: the <code>taleart-sdk</code>
      NSUserDefaults suite. It is random, not derived from the person or the device, and tied to no account. It is still a
      stable identifier of an app install, so cover it in your privacy notice and your consent setup. Deleting the app
      makes a new one, and iOS backups restore that store too. The docs do not yet show how to exclude it from a backup
      (an open item), so a restored device keeps its id.
    </p>

    <h2 id="not-yet">Not available natively yet</h2>
    <ul>
      @for (line of notYet; track line) {
        <li>{{ line }}</li>
      }
    </ul>
    <p>
      The Web SDK sends these and the native SDK does not yet. The <a routerLink="/install">Install a zone</a> page
      covers the Web SDK.
    </p>
  `,
})
export class IosGuidePage {
  protected readonly swiftPackage = SWIFT_PACKAGE;
  protected readonly swiftUikit = SWIFT_UIKIT;
  protected readonly swiftUI = SWIFTUI_REPRESENTABLE;
  protected readonly swiftInit = SWIFT_INIT;
  protected readonly swiftHooks = SWIFT_HOOKS;
  protected readonly swiftLocale = SWIFT_LOCALE;
  protected readonly notYet = NOT_YET_NATIVE;
}
