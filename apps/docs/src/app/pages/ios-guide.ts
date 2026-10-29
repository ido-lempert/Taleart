import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  NATIVE_STYLES,
  NOT_YET_NATIVE,
  SWIFT_ANALYTICS,
  SWIFT_COMPONENTS,
  SWIFT_FALLBACK,
  SWIFT_FREQUENCY,
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
      You need the zone key from the dashboard, the same key the Web SDK uses. The iOS SDK sends analytics events too (see
      Analytics below), so the zone's Analytics tab counts the app along with the web.
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
        <figure class="native-figure native-shot">
          <img
            src="images/ios-shot-zone.png"
            width="415"
            height="900"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app on iOS: a bar of three round covers with group names under them (Summer sale, Staff picks and a Hebrew group), below the app's title and Settings button, above a list of the zone's groups."
          />
          <figcaption class="muted">
            The bar in the TaleArt sample app (taller) on iOS, a real screenshot. The list below it is the sample app's own
            text, not part of the SDK.
          </figcaption>
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
          <code>onGroupImpression</code> fires on native too, once per group per load. <code>onComponentEvent</code> reports a
          countdown's end and a promo code's copy, and <code>onUserInteracted</code> reports each answer the server accepts to a
          poll, a quiz, a rating or a reaction.
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

    <h2 id="fallback">Show a message when a zone fails</h2>
    <p>
      By default a zone that cannot be read shows nothing. Set <code>fallback: FallbackMode.message</code> in
      <code>TaleartConfig</code> to show the translated "Stories could not be loaded." text with a "Try again" button,
      which reads the zone again. A zone can show your own view controller instead with
      <code>fallbackViewController</code>, at <code>fallbackHeight</code> points (120 by default); it wins over the message.
    </p>
    <pre tabindex="0" role="region" aria-label="Fallback placeholder for one zone"><code>{{ swiftFallback }}</code></pre>

    <h2 id="frequency">Cap how often a viewer sees a group</h2>
    <p>
      <code>frequency</code> hides a tale group after the viewer has seen enough of it. A view is one opening of the
      viewer on the group. The count stays on this device and is never sent to TaleArt. Groups over the cap leave the
      display, and when none are left nothing shows. The default is no cap: pass <code>nil</code>.
    </p>
    <pre tabindex="0" role="region" aria-label="Frequency cap in the configuration"><code>{{ swiftFrequency }}</code></pre>

    <h2 id="analytics">Analytics events</h2>
    <p>
      The SDK sends impression, open, view and click events for each zone, in batches and in the background, so the app
      never waits on them. Turn them off for the whole app with <code>analytics: false</code> in the configuration, or
      for one zone with <code>zone.analytics</code>; a zone's setting wins, and <code>nil</code> follows the configuration.
      On native, an impression is a group's bar item first rendered, or a banner slide first shown: the SDK does not
      measure whether it is on screen.
    </p>
    <pre tabindex="0" role="region" aria-label="Analytics for one zone"><code>{{ swiftAnalytics }}</code></pre>

    <h2 id="components">Countdowns and promo codes</h2>
    <p>
      A tale can hold a countdown: the days, hours, minutes and seconds left to a moment in UTC, then its ended text. A
      tale can also hold a promo code: the code in a chip, with a Copy button. Add either in the dashboard, as you add any
      element of a tale; the SDK draws it as the web SDK does. The countdown counts on the device's clock, so a visitor with
      a wrong clock sees a wrong time. A promo code is visible to every visitor, so it is not a secret.
    </p>
    <h3 id="component-countdown">Countdown</h3>
    <p>
      Set the end as an instant in UTC, such as <code>2026-12-31T21:00:00Z</code>. The units read Days, Hours, Min and Sec,
      and from the end on the ended text shows (Ended, unless you set your own). The end reaches your listener once, as
      <code>onComponentEvent</code> with <code>event.action</code> "ended" and the countdown as <code>event.component</code>.
    </p>
    <h3 id="component-promo">Promo code</h3>
    <p>
      Set the code: 1 to 32 letters, digits, <code>_</code> or <code>-</code>. Copy puts it on the clipboard and the status
      line says Copied for two seconds; when the clipboard refuses, it says Could not copy. A copy reaches your listener as
      <code>onComponentEvent</code> with <code>event.action</code> "copied" and the code as <code>event.component.value</code>.
    </p>
    <pre tabindex="0" role="region" aria-label="Countdown and promo code events"><code>{{ swiftComponents }}</code></pre>

    <h2 id="answers">Polls, quizzes, ratings and reactions</h2>
    <p>
      A tale can hold one poll, one quiz, one rating and one reaction, each added in the dashboard as any element of a
      tale. A visitor answers each once: the answer is kept on the device, so a tale opened again shows the result at once.
      The server counts the answers and the SDK draws the counts it returns. In a preview nothing is sent or kept.
    </p>
    <h3 id="answer-poll">Poll</h3>
    <p>
      Two options as buttons. A vote shows each option's share, with the vote selected, and the result is read to VoiceOver.
    </p>
    <h3 id="answer-quiz">Quiz</h3>
    <p>
      Two to four answers. Once answered, the quiz says whether the answer was right: the correct answer is marked with a
      tick and a wrong one with a cross, as words too. Without a correct answer the quiz works as a survey and shows only the
      shares. The correct answer comes with the tale, so a quiz is not a secure test.
    </p>
    <h3 id="answer-rating">Rating</h3>
    <p>
      A slider from 0 to 100 whose thumb is an emoji you choose. The visitor drags it or taps the track, and the rating is
      sent when they let go. Once rated, the count and the average show.
    </p>
    <h3 id="answer-reaction">Reaction</h3>
    <p>
      Two to six different emoji. A tap sends that emoji; every emoji then shows its count, and the tapped one is selected.
    </p>
    <p>
      Each accepted answer reaches your listener as <code>onUserInteracted</code>, with the element in
      <code>event.component</code> and the answer as its value, and as <code>onComponentEvent</code> with
      <code>event.action</code> "selected". An answer kept from an earlier visit is not reported again. When an answer fails,
      the SDK says so on screen and the visitor can answer again.
    </p>

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
      The <a routerLink="/install">Install a zone</a> page covers the Web SDK, which draws the same elements.
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
  protected readonly swiftFallback = SWIFT_FALLBACK;
  protected readonly swiftFrequency = SWIFT_FREQUENCY;
  protected readonly swiftAnalytics = SWIFT_ANALYTICS;
  protected readonly swiftComponents = SWIFT_COMPONENTS;
  protected readonly notYet = NOT_YET_NATIVE;
}
