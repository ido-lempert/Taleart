import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-guides-connect-website',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Connect the campaign to a website</h1>
<h2 id="issue-the-site-key">Issue the site key</h2>
<p>Open the zone, then the <strong>Install</strong> tab, then <strong>Issue site key</strong>. The key (<code>tas_...</code>) is shown once. It opens every zone of the project that has a display and visible content, by slug, and sits in page HTML, so it is not a secret. If you lose it, rotate it.</p>
<p><img class="guide-img" alt="Install tab with the site key and snippet" src="guides/images/05-install-tab.png" /></p>
<h2 id="paste-the-snippet">Paste the snippet</h2>
<pre><code class="language-html">&lt;script type=&quot;module&quot; src=&quot;http://localhost:3333/sdk/v1/taleart.js&quot;&gt;&lt;/script&gt;
&lt;taleart-view api-url=&quot;http://localhost:3333&quot; site-key=&quot;YOUR_SITE_KEY&quot; zone=&quot;home-top&quot;&gt;&lt;/taleart-view&gt;
</code></pre>
<p>Replace the URL with your API's public URL and <code>YOUR_SITE_KEY</code> with the issued key. Several zones can share one page and one key: one element per zone.</p>
<p>A complete example page is in <a routerLink="/guides/demo-furniture-site.html">demo-furniture-site.html</a>. Serve it from any static server, for example <code>python3 -m http.server</code>.</p>
<h2 id="what-visitors-see">What visitors see</h2>
<p>The bar shows one circle per tale group. Tapping a circle opens the full-screen viewer.</p>
<p><img class="guide-img" alt="The example store page with the Stories bar" src="guides/images/07-demo-site.png" />
<img class="guide-img" alt="A tale open in the viewer" src="guides/images/08-demo-viewer.png" /></p>
<h2 id="test-before-you-publish">Test before you publish</h2>
<p><code>&lt;api-url&gt;/sdk/v1/test-page?zone=home-top</code> renders a zone with the SDK and asks for the site key. Details are in the <a routerLink="/guides-web-sdk">Web SDK guide</a>.</p>
  `,
})
export class GuidesConnectWebsitePage {}
