import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'docs-guides-ios-sdk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">iOS SDK</h1>
<p>Status: <strong>reviewed against the source, not run on a device or simulator.</strong> Steps come from the KDoc in <code>libs/ios-sdk/src/iosMain/kotlin/site/lempert/taleart/sdk/ios/TaleartViewController.kt</code>. This guide does not give a package or framework name because no published artifact was confirmed.</p>
<p><code>TaleartZoneView</code> shows the zone with slug <code>zone</code>, read from <code>apiUrl</code> with the project's <code>siteKey</code>.</p>
<pre><code class="language-swift">let zone = TaleartZoneView(apiUrl: url, siteKey: key, zone: &quot;home-top&quot;)
// embed zone.viewController as a child view controller,
// or wrap it in UIViewControllerRepresentable for SwiftUI
</code></pre>
<h2 id="notes">Notes</h2>
<ul>
<li>Keep the <code>TaleartZoneView</code> object as long as its view controller.</li>
<li><code>reload()</code> reads the zone again and keeps the display on screen until the new one arrives.</li>
<li>The bar scrolls sideways (at most 126 points tall). The banner's height follows its width and aspect ratio. <code>height</code> and <code>onHeightChange</code> tell you the current size so you can size the container.</li>
<li>A tap on a group opens the full-screen viewer modally over the top view controller; Close or a swipe down dismisses it. Set <code>opensViewer</code> to false to handle taps yourself.</li>
<li>The visitor id is stored in the <code>taleart-sdk</code> NSUserDefaults suite.</li>
</ul>
  `,
})
export class GuidesIosSdkPage {}
