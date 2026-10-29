import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'docs-guides-android-sdk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Android SDK</h1>
<p>Status: <strong>reviewed against the source, not run on a device or emulator.</strong> The sample steps below come from the KDoc in <code>libs/android-sdk/src/main/kotlin/site/lempert/taleart/sdk/android/TaleartView.kt</code>. This guide does not give Maven coordinates because no published artifact was confirmed.</p>
<p><code>TaleartView</code> is the Android counterpart of <code>&lt;taleart-view&gt;</code>. It shows a zone (bar or banner) and opens the full-screen tale viewer in a dialog when a group is tapped.</p>
<h2 id="from-xml">From XML</h2>
<p>Attributes: <code>app:taleartApiUrl</code> and <code>app:taleartZoneKey</code>.</p>
<h2 id="from-code">From code</h2>
<p>Set <code>apiUrl</code> and <code>zoneKey</code> (or call <code>configure</code>). The view reads the zone once both are set, and again when one changes or <code>reload()</code> is called. Set <code>opensViewer = false</code> and use <code>onGroupClickListener</code> to handle taps yourself.</p>
<h2 id="requirements-and-notes">Requirements and notes</h2>
<ul>
<li>It needs a ViewTreeLifecycleOwner: an <code>AppCompatActivity</code>, <code>ComponentActivity</code> or <code>Fragment</code> provides one. Without one it draws nothing and logs a warning.</li>
<li>Width fills the parent; height is <code>wrap_content</code>.</li>
<li>The visitor id lives in the <code>taleart-sdk</code> SharedPreferences. To get a fresh id after reinstall, exclude <code>sharedpref/taleart-sdk.xml</code> in Android backup rules.</li>
<li>Use the API's public HTTPS URL and the project's site key from the dashboard Install tab.</li>
</ul>
  `,
})
export class GuidesAndroidSdkPage {}
