import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-guides-web-sdk',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Web SDK</h1>
<p>The Web SDK is the <code>&lt;taleart-view&gt;</code> custom element. The complete reference is <a href="https://github.com/ido-lempert/Taleart/blob/main/libs/web-sdk/README.md">libs/web-sdk/README.md</a>; this page is the short version.</p>
<ol>
<li>Load the SDK from your API: <code>&lt;script type="module" src="&lt;api-url&gt;/sdk/v1/taleart.js"&gt;&lt;/script&gt;</code>. A site can also host the file itself or install the npm package (see the reference).</li>
<li>Place a zone: <code>&lt;taleart-view api-url="&lt;api-url&gt;" site-key="tas_..." zone="&lt;slug&gt;"&gt;&lt;/taleart-view&gt;</code>.</li>
<li>An element renders only with both a site key and a slug. An unknown slug, or a revoked or rotated key, renders nothing and logs one console error.</li>
<li>Pin a build with the pinned URL and integrity value on the Install tab if you want the browser to refuse any other file.</li>
<li>Privacy: the SDK keeps a random visitor id in local storage under <code>taleart.visitor</code>. Cover it in your privacy notice.</li>
</ol>
<p>Verified: the snippet and viewer were run in a real browser against a local API (screenshots in <a routerLink="/guides-connect-website">Connect a website</a>).</p>
  `,
})
export class GuidesWebSdkPage {}
