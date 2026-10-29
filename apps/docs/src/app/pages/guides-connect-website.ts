import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-guides-connect-website',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Connect a website</h1>
<h2 id="issue-the-zone-key">Issue the zone key</h2>
<p>Open the zone, then the <strong>Install</strong> tab, then <strong>Issue zone key</strong>. The key (<code>tak_...</code>) is shown once. It opens only that zone and sits in page HTML, so it is not a secret. If you lose it, rotate it.</p>
<p><img class="guide-img" alt="Install tab with the key and snippet" src="guides/images/05-install-tab.png" width="1280" height="800" /></p>
<h2 id="paste-the-snippet">Paste the snippet</h2>
<pre><code class="language-html">&lt;script type=&quot;module&quot; src=&quot;http://localhost:3333/sdk/v1/taleart.js&quot;&gt;&lt;/script&gt;
&lt;taleart-view zone-key=&quot;YOUR_ZONE_KEY&quot;&gt;&lt;/taleart-view&gt;
</code></pre>
<p>Replace the URL with your API's public URL and <code>YOUR_ZONE_KEY</code> with the issued key. Load the script once; place one element per zone, each with its own key. The <a routerLink="/guides/web">Web guide</a> covers the global setup, languages and hooks.</p>
<p>A complete example page is in <a routerLink="/guides/demo-furniture-site.html">demo-furniture-site.html</a>. Serve it from any static server, for example <code>python3 -m http.server</code>.</p>
<h2 id="what-visitors-see">What visitors see</h2>
<p>The bar shows one circle per tale group. Tapping a circle opens the full-screen viewer.</p>
<p><img class="guide-img" alt="The example store page with the Stories bar" src="guides/images/07-demo-site.png" width="430" height="800" />
<img class="guide-img" alt="A tale open in the viewer" src="guides/images/08-demo-viewer.webp" width="430" height="800" /></p>
<h2 id="test-before-you-publish">Test before you publish</h2>
<p><code>&lt;api-url&gt;/sdk/v1/test-page?zone=home-top</code> renders a zone with the SDK and asks for its zone key. Details are in the <a routerLink="/guides/web">Web guide</a>.</p>
  `,
})
export class GuidesConnectWebsitePage {}
