import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ANDROID_COORDINATES,
  APPLICATION_INIT,
  ANDROID_HOOKS,
  ANDROID_LOCALE,
  BACKUP_RULES_NEW,
  BACKUP_RULES_OLD,
  COMPOSE_ZONE,
  GRADLE_GROOVY,
  GRADLE_KTS,
  MANIFEST_APPLICATION,
  MANIFEST_INTERNET,
  NATIVE_STYLES,
  NOT_YET_NATIVE,
  XML_LAYOUT,
} from './native-docs-content';

@Component({
  selector: 'docs-android-guide',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: NATIVE_STYLES,
  template: `
    <h1 tabindex="-1">Android guide</h1>
    <p class="lede">
      Show a TaleArt zone in an Android app with the Android SDK: a view for XML layouts, or a composable for Jetpack
      Compose. You need the zone key from the dashboard, the same key the Web SDK uses.
    </p>

    <h2 id="before">Before you start</h2>
    <ul>
      <li>Android 7.0 (API 24) or later, and Kotlin. The SDK brings its own Compose UI; a Compose app needs nothing more.</li>
      <li>
        For the XML view: a host with a lifecycle, such as a <code>ComponentActivity</code>, an
        <code>AppCompatActivity</code> or a Fragment. A plain <code>Activity</code> shows nothing and logs a warning.
      </li>
      <li>A zone with a display, and its key (<code>tak_…</code>), from the zone's Install tab in the dashboard.</li>
    </ul>

    <h2 id="steps">Steps</h2>
    <ol class="steps">
      <li>
        <h3 id="step-dependency">Add the dependency</h3>
        <p>
          Add <code>android-sdk</code> to your app module. It comes from Maven Central, group
          <code>site.lempert.taleart</code>, and brings <code>mobile-sdk</code> (the shared core) with it. Gradle Kotlin
          DSL:
        </p>
        <pre tabindex="0" role="region" aria-label="Gradle Kotlin DSL dependency"><code>{{ gradleKts }}</code></pre>
        <p>Groovy (<code>build.gradle</code>):</p>
        <pre tabindex="0" role="region" aria-label="Gradle Groovy dependency"><code>{{ gradleGroovy }}</code></pre>
        <p>
          Your app also needs the internet permission, which the SDK does not add for you. In
          <code>AndroidManifest.xml</code>:
        </p>
        <pre tabindex="0" role="region" aria-label="Internet permission"><code>{{ manifestInternet }}</code></pre>
        <figure class="native-figure">
          <img
            src="images/android-1-dependency.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: your app module depends on android-sdk 0.1.0, which pulls in mobile-sdk 0.1.0. Both come from Maven Central."
          />
          <figcaption class="muted">Diagram of the dependency graph (not a screenshot).</figcaption>
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
            src="images/android-2-zone-key.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram of the dashboard's Install tab for a zone: the zone key starts with tak_, is shown once, and has a Copy button."
          />
          <figcaption class="muted">Diagram of the Install tab (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-place">Place the zone: XML or Compose</h3>
        <p>
          In XML, add a <code>TaleartView</code> with the key in <code>app:taleartZoneKey</code>. Its width fills the
          parent and its height is <code>wrap_content</code>: the bar or banner sets the height.
        </p>
        <pre tabindex="0" role="region" aria-label="XML layout with TaleartView"><code>{{ xmlLayout }}</code></pre>
        <p>
          In Compose, call <code>TaleartZone</code>. It takes the API origin and the key first; an empty API origin uses
          the one set in step 4.
        </p>
        <pre tabindex="0" role="region" aria-label="Compose TaleartZone"><code>{{ composeZone }}</code></pre>
        <figure class="native-figure native-shot">
          <img
            src="images/android-shot-zone.png"
            width="506"
            height="900"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app on Android: a bar of three round covers with group names under them (Summer sale, Staff picks and a Hebrew group), below the app's title and Settings button."
          />
          <figcaption class="muted">
            The bar in the TaleArt sample app (taller) on Android, a real screenshot. The lines below it are the sample
            app's own debug text, not part of the SDK.
          </figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-init">Initialise once in Application</h3>
        <p>
          Set the SDK's configuration once, in <code>Application.onCreate</code>, before any view shows. Every view reads
          it; a later <code>TaleartSdk.init</code> replaces it, and the views read it again. Set
          <code>apiUrl</code>: a native app has no page to take the origin from, and with an empty one a zone shows
          nothing. Register the class in the manifest:
        </p>
        <pre tabindex="0" role="region" aria-label="Application class"><code>{{ applicationInit }}</code></pre>
        <pre tabindex="0" role="region" aria-label="Manifest application element"><code>{{ manifestApplication }}</code></pre>
        <figure class="native-figure">
          <img
            src="images/android-4-init.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: Application.onCreate calls TaleartSdk.init once. The configuration holds apiUrl, locale, strings and listener, and every zone reads it."
          />
          <figcaption class="muted">Diagram of the start-up order (not a screenshot).</figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-hooks">Listen to hooks and override a link</h3>
        <p>
          A listener gets the zone's events: <code>onLoaded</code>, <code>onLoadFailed</code>, <code>onPresented</code>,
          <code>onActionClicked</code> and the rest. Set it in <code>TaleartConfig.listener</code> for every view, or on
          one view with its <code>listener</code>; the view's runs first. Each method has a default that does nothing, so
          override only what you use.
        </p>
        <p>
          <code>onActionClicked</code> is the one hook with an answer. Return <code>true</code> when your app routed the
          link, and the SDK does not open the URL. Return <code>false</code> and the system browser opens it.
        </p>
        <pre tabindex="0" role="region" aria-label="Listener and link override"><code>{{ androidHooks }}</code></pre>
        <p>
          The methods, their payloads and the events are in the <a routerLink="/reference/android-sdk">Android SDK
          reference</a>. <code>onGroupImpression</code> and <code>onUserInteracted</code> are not called by the native
          SDK yet.
        </p>
        <figure class="native-figure">
          <img
            src="images/android-5-listeners.svg"
            width="800"
            height="450"
            loading="lazy"
            alt="Diagram: a zone event goes to the view's listener, then to the global listener. If onActionClicked returns true the app routes the link; if it returns false the system browser opens it."
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
          English, never the key. With no locale set, the device's locale is used.
        </p>
        <pre tabindex="0" role="region" aria-label="Localised configuration"><code>{{ androidLocale }}</code></pre>
        <p>
          The key names are in the <a routerLink="/reference/android-sdk">Android SDK reference</a>. Each string key has its
          English default there.
        </p>
        <figure class="native-figure native-shot">
          <img
            src="images/android-shot-viewer-he.png"
            width="506"
            height="900"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's viewer on Android, open on a Hebrew group: a right-to-left Hebrew headline, text and call-to-action button over an illustrated slide, with the group name in a chip and pause and close buttons."
          />
          <figcaption class="muted">
            A Hebrew tale in the sample app's viewer (taller), a real screenshot. The group name and the caption are right
            to left. The viewer's buttons are icons in this shot, so it does not show their localised labels.
          </figcaption>
        </figure>
      </li>

      <li>
        <h3 id="step-verify">Verify</h3>
        <p>Run the app on a device or an emulator, then check, in order:</p>
        <ul>
          <li>The bar (or banner) appears where you placed the view.</li>
          <li>A tap on a circle opens the full-screen viewer, and Close (in your locale) returns to the bar.</li>
          <li>
            Logcat, filtered on <code>TaleArt</code>, shows the warnings the SDK logs. A wrong key shows no zone and
            logs one failure; <code>onLoadFailed</code> gets the message.
          </li>
        </ul>
        <p>
          When the API runs on your own computer, newer Android versions can ask once to allow access to nearby devices
          or the local network; allow it, then reload.
        </p>
        <figure class="native-figure native-shot">
          <img
            src="images/android-shot-viewer.png"
            width="506"
            height="900"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's viewer on Android, open on the Summer sale group: a Summer sale poster slide with a headline, a line of text and a Shop the sale button, with a group chip, pause and close buttons and four progress bars."
          />
          <figcaption class="muted">A tale open in the viewer, a real screenshot of the TaleArt sample app (taller).</figcaption>
        </figure>
        <figure class="native-figure native-shot">
          <img
            src="images/android-shot-settings.png"
            width="506"
            height="900"
            loading="lazy"
            alt="Screenshot of the TaleArt sample app's debug settings screen on Android, not an SDK screen: an API URL field, a zone key field with the key partly masked, and Load and Cancel buttons."
          />
          <figcaption class="muted">
            The settings screen of the TaleArt sample app (taller), not an SDK screen. It is where the sample app takes its
            API URL and zone key. The key is partly masked here.
          </figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="backups">Backups and the visitor id</h2>
    <p>
      The SDK makes a visitor id once and keeps it in its own store on the device: the <code>taleart-sdk</code>
      SharedPreferences. It is random, not derived from the person or the device, and tied to no account. It is still a
      stable identifier of an app install, so cover it in your privacy notice and your consent setup. Clearing the app's
      data makes a new one. A reinstall does too, unless a device backup restores the store, and Android Auto Backup
      does restore it. To start fresh after a reinstall, exclude <code>sharedpref/taleart-sdk.xml</code> in the app's
      backup rules: <code>android:fullBackupContent</code> for Android 11 and lower, and
      <code>android:dataExtractionRules</code> from Android 12.
    </p>
    <pre tabindex="0" role="region" aria-label="Backup rules before Android 12"><code>{{ backupOld }}</code></pre>
    <pre tabindex="0" role="region" aria-label="Backup rules from Android 12"><code>{{ backupNew }}</code></pre>

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
export class AndroidGuidePage {
  protected readonly gradleKts = GRADLE_KTS;
  protected readonly gradleGroovy = GRADLE_GROOVY;
  protected readonly manifestInternet = MANIFEST_INTERNET;
  protected readonly xmlLayout = XML_LAYOUT;
  protected readonly composeZone = COMPOSE_ZONE;
  protected readonly applicationInit = APPLICATION_INIT;
  protected readonly manifestApplication = MANIFEST_APPLICATION;
  protected readonly androidHooks = ANDROID_HOOKS;
  protected readonly androidLocale = ANDROID_LOCALE;
  protected readonly backupOld = BACKUP_RULES_OLD;
  protected readonly backupNew = BACKUP_RULES_NEW;
  protected readonly coordinates = ANDROID_COORDINATES;
  protected readonly notYet = NOT_YET_NATIVE;
}
