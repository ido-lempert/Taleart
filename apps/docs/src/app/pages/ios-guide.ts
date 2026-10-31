import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BAR_LAYOUTS,
  BANNER_VARIANTS,
  NATIVE_STYLES,
  NOT_YET_NATIVE,
  SWIFT_ANALYTICS,
  SWIFT_COMPONENTS,
  SWIFT_FALLBACK,
  SWIFT_FREQUENCY,
  SWIFT_HOOKS,
  SWIFT_INIT,
  SWIFT_LAYOUT_DIRECTION,
  SWIFT_LOCALE,
  SWIFT_PACKAGE,
  SWIFT_PROPERTIES,
  SWIFT_UIKIT,
  SWIFTUI_REPRESENTABLE,
} from './native-docs-content';


const SWIFT_NO_BACKEND = `// UIKit or SwiftUI: no key, no API URL
let zone = TaleartZoneView(zoneJson: zoneJson)   // zoneJson: String
// embed zone.viewController as before; keep zone alive as long as the controller
// Later, new data: zone.zoneJson = newJson

// Check the text first: a readable list of what is wrong
let parsed = TaleartSdk.shared.parseZoneJson(json: zoneJson)
if let failure = parsed as? ZoneParseFailure {
    failure.errors.forEach { print($0) }
}`;

const SWIFT_NO_BACKEND_JSON = `// The body of GET /delivery/v1/zone, copied from the dashboard or kept in your app
let zoneJson = """
{
  "frame": { "type": "bar", "settings": { "layout": "ring", "size": "large" } },
  "taleGroups": [
    { "id": "welcome", "name": "Welcome", "tales": [
      { "id": "welcome-1", "title": "Hello",
        "media": { "kind": "image", "contentType": "image/jpeg", "url": "https://example.com/hello.jpg" } }
    ] }
  ]
}
"""`;

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
        width="590"
        height="161"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS showing only the zone: a bar of round covers in gradient rings with the group names Summer, New arrivals, Winter and Trips under them, on a plain light page."
      />
      <figcaption class="muted">
        The bar in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator. It shows only the zone (its <code>taller.zoneOnly</code> debug option), so the picture holds nothing but the SDK's own output. The zone has six groups, and the row scrolls sideways.
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
        <h3 id="step-properties">Pass viewer properties</h3>
        <p>
          Pass what the app knows about the viewer as <code>properties</code>: a dictionary from a name to a String, a
          number, a Boolean or an array of Strings. A tale group can carry an audience rule, set in the dashboard under its
          targeting, and the SDK shows the group only when the rule passes these values. The rule can test a value with
          <code>eq</code>, <code>in</code>, <code>gt</code>, <code>contains</code>, <code>exists</code> and the other
          operators listed on the <a routerLink="/targeting">Targeting</a> page.
        </p>
        <p>
          Put the properties in <code>TaleartConfig</code> at launch. Swift needs every argument of the configuration, so
          pass <code>nil</code> when the app has none:
        </p>
        <pre tabindex="0" role="region" aria-label="Viewer properties in the configuration"><code>{{ swiftProperties }}</code></pre>
        <p>
          A name starts with a letter and uses letters, digits, <code>_</code>, <code>.</code> or <code>-</code>, up to 64
          characters, and is case-sensitive. A dictionary has at most 50 properties, a string at most 256 characters and an
          array at most 50 items. An invalid entry is ignored. Dates go as epoch milliseconds.
        </p>
        <p>
          With no properties (<code>nil</code>) every group's audience rule passes, as it does with no tags. An empty
          dictionary means the app knows nothing about the viewer: a group whose rule needs a value is then left out, while
          the negative conditions (<code>neq</code>, <code>notIn</code>, <code>notExists</code>) pass.
        </p>
        <p>
          A group shows only when its tags and its audience rule both pass. The properties stay on the device: the SDK
          sends them in no request header, no URL and no analytics event. The rule itself is public, as the tag names are,
          so keep private content out of rule values.
        </p>
        <p>
          A zone can use its own properties, which replace the SDK's for that zone only. Setting <code>properties</code> on a
          <code>TaleartZoneView</code> reads its zone again at once. A later <code>doInit</code> applies its properties on
          the next read of a zone: a zone already on screen keeps the groups it shows until it reads again, as it does for
          tags.
        </p>
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
        <figure class="native-figure native-shot">
          <img
            src="images/ios-shot-viewer-he.png"
            width="590"
            height="1283"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's viewer on iOS with the Hebrew locale and right-to-left layout, open on a Hebrew group: a pale sun over a sea gradient, the group name in a chip on the right, the close and pause buttons on the left, and two progress bars."
          />
          <figcaption class="muted">
            A Hebrew group in the sample app's viewer (taller), a real screenshot taken in the simulator. The group name and the controls sit by right-to-left rules. The viewer's buttons are icons in this shot, so it does not show their localised labels.
          </figcaption>
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
        <figure class="native-figure native-shot">
          <img
            src="images/ios-shot-viewer.png"
            width="590"
            height="1283"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's viewer on iOS, open on the group Summer: a pale sun over a gradient of sand and sea, the group name in a dark chip at the top left, the pause and close buttons at the top right and two progress bars along the top. Dark bands fill the screen above and below the tale."
          />
          <figcaption class="muted">
            A tale open in the viewer, a real screenshot taken in the simulator. The viewer is running (the Pause button shows, not Play), and the first of the group's two progress bars is filling. The tale is 9:16 and this phone is taller, so the dark ground shows above and below it.
          </figcaption>
        </figure>
        <figure class="native-figure native-shot">
          <img
            src="images/ios-shot-settings.png"
            width="590"
            height="1283"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's debug settings screen on iOS, not an SDK screen: an API URL field, a zone key field that shows only its first eight characters, tak_demo, followed by dots, and Load and Cancel buttons."
          />
          <figcaption class="muted">
            The settings screen of the TaleArt sample app (taller), not an SDK screen. It is where the sample app takes its API URL and zone key. The key is masked after its first eight characters in this picture.
          </figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="no-backend">Without a backend</h2>
    <p>
      The SDK can show tales with no TaleArt server at all: give it the zone as JSON, the exact body of
      <code>GET /delivery/v1/zone</code>, held in your app (a string, a bundled file, or a file you copied from the
      dashboard). Nothing is read from or sent to the API: no zone request, no analytics events, and a poll answer is
      marked on the device only. Everything else works as with a fetched zone: tags, viewer properties and audience
      rules, the frequency cap, the theme, the listener (<code>onLoaded</code> comes with an empty key prefix),
      right-to-left layouts, and the bar, the banner and the viewer. Media URLs in the JSON must be absolute
      <code>https://</code> (or <code>http://</code>) addresses. JSON that is not a zone is a failed read: it is logged
      once, <code>onLoadFailed</code> fires and the view shows its fallback, never a crash.
      <code>TaleartSdk.shared.parseZoneJson(json:)</code> checks a text and lists the problems.
    </p>
    <pre tabindex="0" role="region" aria-label="Zone from JSON without a backend"><code>{{ noBackend }}</code></pre>
    <pre tabindex="0" role="region" aria-label="Zone JSON held in the app"><code>{{ noBackendJson }}</code></pre>
    <figure class="native-figure native-shot">
      <img
        src="images/nobackend-ios-bar.png"
        width="720"
        height="391"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS showing a bar of three round covers in gradient rings, labelled Welcome, Vote and News, drawn from JSON held in the app."
      />
      <figcaption class="muted">
        A bar drawn from zone JSON inside the app, with no TaleArt server running: a real screenshot taken on the iOS simulator (the sample app's <code>taller.noBackend</code> debug option).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/nobackend-ios-viewer.png"
        width="360"
        height="780"
        loading="lazy"
        alt="Screenshot of the tale viewer on iOS over a dark blue tale: a poll card titled 'Day or night?' with the line 'Results appear after you vote' and two options, Day and Night."
      />
      <figcaption class="muted">
        The viewer opened on the same local zone: a poll answers on the device only (a real screenshot taken on the iOS simulator).
      </figcaption>
    </figure>

    <h2 id="fallback">Show a message when a zone fails</h2>
    <p>
      By default a zone that cannot be read shows nothing. Set <code>fallback: FallbackMode.message</code> in
      <code>TaleartConfig</code> to show the translated "Stories could not be loaded." text with a "Try again" button,
      which reads the zone again. A zone can show your own view controller instead with
      <code>fallbackViewController</code>, at <code>fallbackHeight</code> points (120 by default); it wins over the message.
    </p>
    <pre tabindex="0" role="region" aria-label="Fallback placeholder for one zone"><code>{{ swiftFallback }}</code></pre>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-fallback.png"
        width="590"
        height="113"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS when its zone cannot be read: on a plain page, the centred message 'Stories could not be loaded.' with a Try again button under it."
      />
      <figcaption class="muted">
        The fallback message in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator. The sample app asks for a key the stand-in API refuses, and shows only the zone (its <code>taller.zoneOnly</code> debug option), so the message and the button are all there is.
      </figcaption>
    </figure>

    <h2 id="frequency">Cap how often a viewer sees a group</h2>
    <p>
      <code>frequency</code> hides a tale group after the viewer has seen enough of it. A view is one opening of the
      viewer on the group. The count stays on this device and is never sent to TaleArt. Groups over the cap leave the
      display, and when none are left nothing shows. The default is no cap: pass <code>nil</code>.
    </p>
    <pre tabindex="0" role="region" aria-label="Frequency cap in the configuration"><code>{{ swiftFrequency }}</code></pre>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-frequency-before.png"
        width="590"
        height="161"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a frequency cap of once, before any view: the zone bar shows three round covers in gradient rings, labelled Morning, Afternoon and Evening."
      />
      <figcaption class="muted">
        The zone bar before the viewer has opened a group, with the cap set to once (<code>taller.frequency</code> in the sample app), a real screenshot taken in the simulator.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-frequency-after.png"
        width="590"
        height="161"
        loading="lazy"
        alt="Screenshot of the same TaleArt sample app on iOS after the group Morning was viewed once and the app opened again: the zone bar shows only two covers, Afternoon and Evening, and the first group is gone."
      />
      <figcaption class="muted">
        The same zone after the viewer had opened the first group, Morning, once: the group has left the bar and the other two stay (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <h2 id="bar-layouts">Bar layouts</h2>
    <p>
      A bar zone draws its groups in one of four layouts, set by the bar's <code>layout</code> setting in the dashboard.
      Ring is the default. The other bar settings (shape, size, titles, alignment and gap) apply where the table says so,
      and the rest are ignored. While the zone is read, the bar shows a loading skeleton in the footprint it had last, so
      the page does not move when the groups arrive. The skeleton is announced as busy, and it stands still under reduced
      motion.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="ios-bar-layouts-caption">
      <table>
        <caption id="ios-bar-layouts-caption">The bar layouts and the settings each one ignores</caption>
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
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-bar-ring.png"
        width="590"
        height="161"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with the bar in the ring layout: round covers in gradient rings with the group names Summer, New arrivals, Winter and Trips under them."
      />
      <figcaption class="muted">
        The ring layout, the default. The sample app (taller) sets the layout with its <code>taller.barLayout</code> debug option and shows only the zone; a real screenshot taken in the simulator. Its zone has six groups, and the row scrolls sideways.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-bar-chip.png"
        width="590"
        height="279"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with the bar in the chip layout: six pills, each with a round cover, the group name (Summer, New arrivals, Winter, Trips, Food, Music) and a small ring for a group not yet seen, two pills to a row."
      />
      <figcaption class="muted">
        The chip layout, a real screenshot taken in the simulator. The pills wrap onto several rows.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-bar-poster.png"
        width="590"
        height="339"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with the bar in the poster layout: tall cards, each with its group's picture, a white title and a line such as '2 stories' over a dark scrim, a bar for each tale along the top, and the third card cut off at the edge because the row scrolls sideways."
      />
      <figcaption class="muted">
        The poster layout, a real screenshot taken in the simulator. Each group's card shows a bar for each of its tales.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-bar-stack.png"
        width="590"
        height="138"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with the bar in the stack layout: one rounded pill holding four overlapping round covers and a +2 bubble for the other groups, with the line '6 new stories' beside them."
      />
      <figcaption class="muted">
        The stack layout, a real screenshot taken in the simulator. The zone has six groups, so two of them are in the +2 bubble.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-bar-loading.png"
        width="590"
        height="159"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS while its zone is still being read: four round grey placeholders with a short grey bar under each, in the footprint of the ring layout."
      />
      <figcaption class="muted">
        The loading skeleton while the zone is read, a real screenshot taken in the simulator before the zone arrived (the stand-in API held the answer back). It uses the footprint of the ring layout on the first read.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-viewer.png" width="360" height="782">
        <source src="images/ios-clip-ring.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the ring bar for a moment, then the second group opens in the viewer and its progress runs, a swipe turns the cube to the next group, and Close returns to the bar, now with the groups seen gray. A recording of the sample app (taller) in the iPhone 16 Pro simulator, set up with its <code>taller.zoneOnly</code> and <code>taller.autoOpenItem</code> debug options; the swipe and the Close are mouse gestures on the simulator. It is under 8 seconds.
      </figcaption>
    </figure>

    <h2 id="banner-variants">Banner variants</h2>
    <p>
      A banner zone shows its groups one at a time, or in one of five other variants: the frame's <code>variant</code>
      setting in the dashboard picks it. A missing or unknown value is the carousel. Each variant ignores the settings the
      table names, and the rest apply. The carousel has been restyled: each slide shows the group's name and a Watch stories
      button on a scrim, and its previous and next buttons are 48 dp, so they are easy to touch. Right to left, the line of
      slides, the turn of the coverflow and the fan of the deck, and the marquee run the other way, and the buttons sit on the
      other edge.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="ios-banner-variants-caption">
      <table>
        <caption id="ios-banner-variants-caption">The banner variants and the settings each one ignores</caption>
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
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-carousel.png"
        width="590"
        height="360"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the carousel variant: the group name Summer and a Watch stories button over the cover on a dark scrim, previous and next arrows at the edges, and a row of six dots below."
      />
      <figcaption class="muted">
        The carousel: the group name and a Watch stories button on a dark scrim over the shown cover, the previous and next buttons on the edges and the dots under it; a real screenshot taken in the simulator.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-coverflow.png"
        width="590"
        height="360"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the coverflow variant: the front card with the name Summer and a Watch stories button, the covers of the neighbouring groups turned behind it at both sides, previous and next arrows and six dots below."
      />
      <figcaption class="muted">
        The coverflow: the shown group in front, its neighbours turned away at the sides (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-peek.png"
        width="590"
        height="360"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the peek variant: the front card with the name Summer and a Watch stories button, and the edges of the neighbouring cards showing at both sides, with arrows and six dots."
      />
      <figcaption class="muted">
        Peek: the shown group with the edges of its neighbours at both sides (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-deck.png"
        width="590"
        height="360"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the deck variant: the front card with the name Summer and a Watch stories button, and the other cards fanned out behind it, with arrows and six dots."
      />
      <figcaption class="muted">
        Deck: the other groups fanned out behind the shown one (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-sticky.png"
        width="590"
        height="103"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the sticky variant: a full-width bar on a white ground with previous and next buttons, a round cover, the group name Summer and a dismiss cross."
      />
      <figcaption class="muted">
        Sticky: a full-width bar for the shown group, with the previous and next buttons, a round cover and the name, and its dismiss button (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-banner-strip.png"
        width="590"
        height="115"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app on iOS with a banner in the strip variant: the group names and round covers (New arrivals, Winter, Trips) scrolling across a soft grey strip, the first cut off at the edge."
      />
      <figcaption class="muted">
        Strip: the groups scrolling as a marquee, covers and names moving toward the start of the line (a real screenshot taken in the simulator, in the middle of its motion).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-banner-coverflow.png" width="360" height="220">
        <source src="images/ios-clip-banner-coverflow.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the coverflow advances by itself to the second group, a tap on the next arrow shows the third and stops the slide show (the button turns to Play), and the dots follow each change. A recording of the sample app (taller) in the iPhone 16 Pro simulator, under 8 seconds; the tap is a mouse click on the simulator. It stays still under reduced motion.
      </figcaption>
    </figure>

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
      tale can also hold a promo code: the code on a ticket, with a Copy stub beside it. Add either in the dashboard, as you add any
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
      Set the code: 1 to 32 letters, digits, <code>_</code> or <code>-</code>. Copy puts it on the clipboard and a toast
      over the card's top corner says Copied for four seconds; when the clipboard refuses, it says Could not copy. A copy reaches your listener as
      <code>onComponentEvent</code> with <code>event.action</code> "copied" and the code as <code>event.component.value</code>.
    </p>
    <pre tabindex="0" role="region" aria-label="Countdown and promo code events"><code>{{ swiftComponents }}</code></pre>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-countdown.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample countdown on iOS over a sunset picture: a white card reading 'Sale ends in' with 02 Days, 05 Hours, 39 Min and a seconds figure in large digits, each in a grey tile with its unit below."
      />
      <figcaption class="muted">
        A countdown in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator. The figures flip as they tick on the device's clock.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-countdown.png" width="360" height="782">
        <source src="images/ios-clip-countdown.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the viewer shows the countdown and its seconds tile flips each second for about five seconds. A recording of the sample app (taller) with its <code>taller.autoOpenItem</code> debug option.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-promo.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample promo code on iOS over a teal picture of a gift: a white card titled 'Your welcome gift' with a ticket that holds the code SUMMER25 and a Copy stub, and the note '20% off sandals, until Sunday' under it."
      />
      <figcaption class="muted">
        A promo code in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator, before a copy.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-promo-copied.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The same promo code card on iOS just after Copy was pressed: a dark 'Copied' toast sits over the card's top corner."
      />
      <figcaption class="muted">
        The same promo code after Copy, a real screenshot taken in the simulator. The toast shows for four seconds. The code is on the clipboard; iOS shows nothing of its own when an app copies.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-clip-promo-poster.png"
        width="590"
        height="372"
        loading="lazy"
        alt="A close-up of the promo code card on iOS just after Copy: the card's top, the ticket with the code SUMMER25 and the Copy stub, and a dark Copied toast over the card's top corner."
      />
      <figcaption class="muted">
        The Copied toast in close-up, cropped from a real screenshot taken in the simulator. It is also the poster of the clip below.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-clip-promo-poster.png" width="360" height="226">
        <source src="images/ios-clip-promo.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the Copy stub is pressed and a Copied toast shows over the card's corner for about four seconds. A recording of the sample app (taller) with its <code>taller.autoCopy</code> debug option, cropped to the card.
      </figcaption>
    </figure>

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
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample poll on iOS over a sunrise picture: the title 'Quick poll', the question 'Tea or coffee?' and two answer buttons, Tea and Coffee, before any vote."
      />
      <figcaption class="muted">
        A poll before the visitor votes, in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-answered.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The same poll on iOS after a vote for Tea: Tea is selected and shows 61 percent, Coffee shows 39 percent, each with a bar filled to its share."
      />
      <figcaption class="muted">
        After a vote each option shows its share as a filled bar and the vote is selected. The result is also said to VoiceOver, as text that is never drawn (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <h3 id="answer-poll-views">Poll views</h3>
    <p>
      A poll is drawn in one of five views, chosen by the poll's <code>view</code>. The sticker is the default, and a poll
      without a view, or with one the SDK does not know, is a sticker. The view changes how the poll looks, not what it
      records. Two options can carry a colour (<code>options[].color</code>, <code>#rrggbb</code>); only this-or-that and grid
      use it, and without one the theme's colours are used.
    </p>
    <table>
      <thead>
        <tr><th>View</th><th>Use</th><th>Option colour</th></tr>
      </thead>
      <tbody>
        <tr><td><code>sticker</code> (default)</td><td>A small card over the tale, for a quick question.</td><td>Not used: the theme's colours.</td></tr>
        <tr><td><code>embed</code></td><td>A full-width card with its own results header: the vote total once voted, else the line that results appear after a vote.</td><td>Not used: the theme's colours.</td></tr>
        <tr><td><code>this-or-that</code></td><td>Two halves that fill the card. Once voted they split at the vote's share and a VS mark sits on the seam; mirrored in right to left.</td><td>Each half takes its option's colour, else the theme's; the text on it is white or black, whichever reads better.</td></tr>
        <tr><td><code>grid</code></td><td>Two large tiles side by side, each with its label and, once voted, its share.</td><td>Each tile takes its option's colour, else the theme's; the text on it is white or black, whichever reads better.</td></tr>
        <tr><td><code>inline</code></td><td>Compact rows, for a poll in the flow of a page.</td><td>Not used: the theme's colours.</td></tr>
      </tbody>
    </table>
    <p>
      The embed, this-or-that, grid and inline views are shown before a vote and after one. The voted images are real votes in
      the sample app: a vote for Midnight in each view.
    </p>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-embed.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of the embed poll view on iOS: a card with the title Poll, the question 'Which colourway next?', the line 'Results appear after you vote' and two option rows, Midnight and Coral, before a vote."
      />
      <figcaption class="muted">
        The embed view before a vote, in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-embed-voted.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The embed view on iOS after a vote for Midnight: the header reads '101 votes', the rows show Midnight at 58 percent, selected, and Coral at 42 percent, each with a bar filled to its share."
      />
      <figcaption class="muted">
        The embed view after a vote: its header counts the votes and each row shows its share (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-this-or-that.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of the this-or-that poll view on iOS: the question 'Which colourway next?' over two equal halves, a blue half for Midnight and a coral half for Coral, with a VS mark on the seam, before a vote."
      />
      <figcaption class="muted">
        The this-or-that view before a vote: two equal halves, each in its option's colour (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-this-or-that-voted.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The this-or-that view on iOS after a vote for Midnight: the blue half takes 60 percent of the card and the coral half 40 percent, the vote's label is underlined and the VS mark sits on the seam."
      />
      <figcaption class="muted">
        The this-or-that view after a vote: the seam moves to the vote's share, and each figure steps down in size when its half is narrow, so the 40 percent is never cut at the edge (a real screenshot taken in the simulator).
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-grid.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of the grid poll view on iOS: two large tiles side by side under the question, Midnight in blue and Coral in coral, before a vote."
      />
      <figcaption class="muted">
        The grid view before a vote: two large tiles (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-grid-voted.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The grid view on iOS after a vote for Midnight: each tile shows its share, Midnight at 55 percent and Coral at 45 percent, and the chosen label is underlined."
      />
      <figcaption class="muted">
        The grid view after a vote: each tile shows its share (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-inline.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of the inline poll view on iOS: the question 'Which colourway next?' and two compact pills, Midnight and Coral, in a short card near the foot of the tale, before a vote."
      />
      <figcaption class="muted">
        The inline view before a vote: compact pills in a row (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-poll-view-inline-voted.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The inline view on iOS after a vote for Midnight: the pills give way to a stacked bar split at 52 and 48 percent, with the legend 'Midnight 52% Coral 48%' under it."
      />
      <figcaption class="muted">
        The inline view after a vote: a stacked bar of the shares with a legend, the vote in bold (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-poll-view-this-or-that.png" width="360" height="782">
        <source src="images/ios-clip-poll-this-or-that.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the tale opens on the this-or-that poll, a vote for Midnight follows, and the halves move to the vote's share, which then holds for about four seconds. A recording of the sample app (taller), driven by its <code>taller.autoOpenItem</code> and <code>taller.autoVote</code> debug options.
      </figcaption>
    </figure>
    <h3 id="answer-quiz">Quiz</h3>
    <p>
      Two to four answers. Once answered, the quiz says whether the answer was right: the correct answer is marked with a
      tick and a wrong one with a cross, as words too. Without a correct answer the quiz works as a survey and shows only the
      shares. The correct answer comes with the tale, so a quiz is not a secure test.
    </p>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-quiz.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample quiz on iOS over a sky picture with clouds: the title Quiz, the question 'What is the capital of France?' and three answer buttons, Paris, Lyon and Nice, before an answer."
      />
      <figcaption class="muted">
        A quiz before the visitor answers, in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-quiz-answered.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The same quiz on iOS after the visitor picked Lyon, a wrong answer: Paris is outlined in green with a tick and 73 percent, Lyon is outlined in red with a cross and 19 percent, Nice shows 8 percent."
      />
      <figcaption class="muted">
        A wrong answer is marked with a cross and the right one with a tick, each with its share. The marks are read to VoiceOver as words too (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-quiz.png" width="360" height="782">
        <source src="images/ios-clip-quiz.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the quiz opens, a wrong answer (Lyon) is picked, the wrong and the right ones are marked with their shares, and the result holds for about four seconds. A recording of the sample app (taller) with its <code>taller.autoVote</code> debug option.
      </figcaption>
    </figure>
    <h3 id="answer-rating">Rating</h3>
    <p>
      A slider from 0 to 100 whose thumb is an emoji you choose. The visitor drags it or taps the track, and the rating is
      sent when they let go. Once rated, the count and the average show.
    </p>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-rating.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample rating on iOS over a night sky with a moon: a dark card titled 'Rate us' with the question 'How was your visit?' and a slider whose thumb is a star, set to the middle, before a rating."
      />
      <figcaption class="muted">
        A rating before the visitor sends one, in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-rating-answered.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The same rating on iOS after the visitor tapped near 90: the star thumb sits near 90 percent of the track, a small mark shows the average at 78 percent, and the line under the track reads 'Average 78 from 213 ratings'."
      />
      <figcaption class="muted">
        The rating once sent: the thumb is the visitor's own rating, and the line under the track shows the average of all ratings (a real screenshot taken in the simulator; the tap is a mouse click on the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-rating.png" width="360" height="782">
        <source src="images/ios-clip-rating.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the star is dragged along the track and let go, and the average of all ratings shows. A recording of the sample app (taller) in the simulator; the drag is a mouse gesture on the simulator.
      </figcaption>
    </figure>
    <h3 id="answer-reaction">Reaction</h3>
    <p>
      Two to six different emoji. A tap sends that emoji; every emoji then shows its count, and the tapped one is selected.
    </p>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-reaction.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of a TaleArt sample reaction on iOS over fireworks on a night sky: a white card titled 'Your reaction' with the question 'How do you feel?' and three emoji buttons, a heart, a laughing face and a surprised face, before a tap."
      />
      <figcaption class="muted">
        A reaction row before a tap, in the sample app (taller) on iOS, a real screenshot taken in the iPhone 16 Pro simulator.
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-reaction-answered.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="The same reaction row on iOS after a tap on the heart: the heart button is outlined as selected and shows a count of 129, and the laughing and surprised faces show 41 and 17."
      />
      <figcaption class="muted">
        After a tap the tapped emoji is selected and every emoji shows its count (a real screenshot taken in the simulator).
      </figcaption>
    </figure>

    <figure class="native-figure native-shot">
      <video muted loop playsinline controls preload="metadata" poster="images/ios-shot-reaction.png" width="360" height="782">
        <source src="images/ios-clip-reaction.mp4" type="video/mp4" />
      </video>
      <figcaption class="muted">
        What you see: the heart is pressed, rises from its button, and every emoji then shows its count. A recording of the sample app (taller) with its <code>taller.autoPress</code> debug option.
      </figcaption>
    </figure>
    <p>
      Each accepted answer reaches your listener as <code>onUserInteracted</code>, with the element in
      <code>event.component</code> and the answer as its value, and as <code>onComponentEvent</code> with
      <code>event.action</code> "selected". An answer kept from an earlier visit is not reported again. When an answer fails,
      the SDK says so on screen and the visitor can answer again.
    </p>

    <h2 id="right-to-left">Right to left</h2>
    <p>
      The SDK's views lay out in the device's direction: Hebrew and Arabic are right to left, so the bar starts on the
      right, a viewer's progress fills from the right, Previous is the right third of the tale, and the poll and rating
      layouts follow. Numbers, promo codes and a countdown's digits stay left to right. To set the direction yourself,
      pass <code>layoutDirection: "rtl"</code> or <code>"ltr"</code>; nil, or any other value, follows the device.
    </p>
    <pre tabindex="0" role="region" aria-label="Layout direction in the configuration"><code>{{ swiftLayoutDirection }}</code></pre>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-rtl-bar.png"
        width="590"
        height="161"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app's bar on iOS with a Hebrew locale and right-to-left layout: round covers in gradient rings with Hebrew group names under them, the first group on the right and the row running to the left."
      />
      <figcaption class="muted">
        The bar with the Hebrew locale and <code>layoutDirection</code> set to <code>rtl</code>, a real screenshot taken in the simulator. The first group is on the right.
      </figcaption>
    </figure>
    <figure class="native-figure native-shot">
      <img
        src="images/ios-shot-rtl-viewer.png"
        width="590"
        height="1283"
        loading="lazy"
        alt="Screenshot of the TaleArt sample app's viewer on iOS in right-to-left layout, on the second tale of a Hebrew group: the group name chip on the right, the close and pause buttons on the left, and the progress bars, the first full and the second filling, starting from the right."
      />
      <figcaption class="muted">
        The viewer in the same setup, a real screenshot taken in the simulator: the progress fills from the right, and the group name sits at the start of the line.
      </figcaption>
    </figure>

    <h2 id="backups">Backups and the visitor id</h2>
    <p>
      The SDK makes a visitor id once and keeps it in its own store on the device: the <code>taleart-sdk</code>
      NSUserDefaults suite, under the key <code>taleart.visitor</code>. It is random, not derived from the person or the
      device, and tied to no account. It is still a stable identifier of an app install, so cover it in your privacy
      notice and your consent setup. Deleting the app makes a new one. iOS backups restore that store too, so a restored
      device keeps its id. The SDK does not exclude the store from backups, and iOS has no backup rule for a single
      defaults key. To start fresh after a restore, remove the key once, in the app, when it first runs after the
      restore: <code>UserDefaults(suiteName: "taleart-sdk")?.removeObject(forKey: "taleart.visitor")</code>. The SDK makes
      a new id the next time the app starts. Do not remove it on every launch, or every launch gets a new id.
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
  protected readonly swiftProperties = SWIFT_PROPERTIES;
  protected readonly noBackend = SWIFT_NO_BACKEND;
  protected readonly noBackendJson = SWIFT_NO_BACKEND_JSON;
  protected readonly swiftFallback = SWIFT_FALLBACK;
  protected readonly swiftFrequency = SWIFT_FREQUENCY;
  protected readonly swiftAnalytics = SWIFT_ANALYTICS;
  protected readonly swiftLayoutDirection = SWIFT_LAYOUT_DIRECTION;
  protected readonly swiftComponents = SWIFT_COMPONENTS;
  protected readonly barLayouts = BAR_LAYOUTS;
  protected readonly bannerVariants = BANNER_VARIANTS;
  protected readonly notYet = NOT_YET_NATIVE;
}
