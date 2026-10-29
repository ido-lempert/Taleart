import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'docs-guides-install',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Install TaleArt locally</h1>
<h2 id="requirements">Requirements</h2>
<ul>
<li>Node.js 22 or later (the API refuses to start without it; see the root README).</li>
<li>A PostgreSQL database. The API defaults to <code>postgres://taleart:taleart&#64;localhost:5432/taleart</code>; set <code>DATABASE_URL</code> to use another one.</li>
<li>The repo's npm dependencies: <code>npm ci</code>.</li>
</ul>
<h2 id="run-it">Run it</h2>
<p>The repo README documents:</p>
<pre tabindex="0" role="region" aria-label="Install commands"><code class="language-sh">npm ci
npx nx serve dashboard   # documented, not executed for this guide
</code></pre>
<p>This starts the API (port 3333) and the dashboard (port 4200); the dashboard proxies <code>/api</code> to the API. Sign-in redirect and passkeys use <code>http://localhost:4200</code> by default (<code>RP_ID</code>, <code>RP_ORIGIN</code>).</p>
<h3 id="what-was-actually-tested">What was actually tested</h3>
<ul>
<li><code>npm ci</code> (Node 22).</li>
<li>PostgreSQL on localhost:5432 with user, password and database <code>taleart</code> (the API's default).</li>
<li><code>npx nx build api</code>, then <code>node dist/apps/api/main.js</code> (API on port 3333).</li>
<li><code>npx nx build dashboard --configuration=development</code>, served as static files on port 4200 with <code>/api</code>, <code>/delivery</code> and <code>/sdk</code> forwarded to port 3333.
<code>npx nx serve dashboard</code> itself was not completed: the Gradle Nx plugin needs JVM 17 or later and the test machine had JVM 11. Passkey creation was done with a browser's virtual authenticator.</li>
</ul>
<h2 id="first-run-setup">First-run setup</h2>
<p>The first screen creates the admin and your first project. You give a name, an email and a project name, then create a passkey (stored on your device or in your password manager), or a username and password if your server has TALEART_SETUP_PASSWORD=true.</p>
<p><img class="guide-img" alt="First-run setup screen" src="guides/images/01-setup.png" width="1280" height="800" /></p>
<p>After setup you land on the Zones page of your new project.</p>
<p><img class="guide-img" alt="Dashboard after setup, no zones yet" src="guides/images/02-dashboard.png" width="1280" height="800" /></p>
  `,
})
export class GuidesInstallPage {}
