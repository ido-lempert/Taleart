import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Install with Docker. The commands and the variable table come from docker-compose.yml, .env.docker.example and
 * deploy/README.md; the page's spec checks that the table lists every variable of .env.docker.example.
 */
@Component({
  selector: 'docs-docker',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Install with Docker</h1>
    <p class="lede">
      One <code>docker compose up</code> runs the whole install: the database, the API, the dashboard and a small proxy
      that gives them one address. Use it to try TaleArt on your machine in a few minutes, or to run it on a server with
      automatic https. For running from source without Docker, see
      <a routerLink="/guides-install">Install TaleArt locally</a>.
    </p>

    <h2 id="what-you-get">What you get</h2>
    <p>Compose starts four services. Only the proxy publishes ports; the others are reachable inside the compose network.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="The four services">
      <table>
        <thead>
          <tr><th>Service</th><th>What it is</th><th>Ports</th></tr>
        </thead>
        <tbody>
          <tr><th scope="row"><code>db</code></th><td>PostgreSQL 16. Holds all the data.</td><td>None published</td></tr>
          <tr><th scope="row"><code>api</code></th><td>The TaleArt API: management, delivery, media and the Web SDK files.</td><td>3333, inside the network</td></tr>
          <tr><th scope="row"><code>dashboard</code></th><td>The dashboard (server-rendered Angular).</td><td>4000, inside the network</td></tr>
          <tr><th scope="row"><code>proxy</code></th><td>Caddy. One address for everything, and the https certificate.</td><td>80 and 443 on the host (8080 and 8443 in the quick try)</td></tr>
        </tbody>
      </table>
    </div>
    <p>The proxy gives the dashboard and the API <strong>one origin</strong>, which passkeys and the session cookie need. It routes by path:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="One origin routing">
      <table>
        <thead>
          <tr><th>Path</th><th>Goes to</th></tr>
        </thead>
        <tbody>
          <tr><td><code>/api/*</code>, <code>/delivery/*</code>, <code>/media/*</code>, <code>/sdk/*</code></td><td><code>api</code></td></tr>
          <tr><td>Everything else</td><td><code>dashboard</code></td></tr>
        </tbody>
      </table>
    </div>
    <p>Five named volumes keep the data across restarts and upgrades:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Volumes">
      <table>
        <thead>
          <tr><th>Volume</th><th>Holds</th></tr>
        </thead>
        <tbody>
          <tr><td><code>taleart_db-data</code></td><td>The PostgreSQL data.</td></tr>
          <tr><td><code>taleart_media</code></td><td>Uploaded media files (<code>/data/media</code> in the api).</td></tr>
          <tr><td><code>taleart_sdk-builds</code></td><td>Earlier Web SDK builds, so pages that pin them keep working.</td></tr>
          <tr><td><code>taleart_caddy-data</code></td><td>The https certificates. Keep it, or Let's Encrypt limits may bite when they are issued again.</td></tr>
          <tr><td><code>taleart_caddy-config</code></td><td>The proxy's own configuration state.</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="requirements">Requirements</h2>
    <ul>
      <li>Docker Engine 24 or later with the Compose plugin (v2.24 or later).</li>
      <li>2 GB of RAM free for running it, and about 6 GB of disk during the first build.</li>
      <li>The images are <strong>built from source</strong> on the machine that runs compose, for its own architecture (amd64 or arm64). The first build takes about two minutes; later ones reuse the cache.</li>
      <li>The repository, cloned with <code>git</code>.</li>
    </ul>

    <h2 id="quick-try">Quick try on localhost</h2>
    <p>Nothing to configure. This uses the placeholder values in <code>.env.docker.example</code> and serves TaleArt on port 8080.</p>
    <pre tabindex="0" role="region" aria-label="Quick try commands"><code class="language-sh">{{ quickTry }}</code></pre>
    <p>Open <code>http://localhost:8080</code>. The setup screen allows a username and password, as well as a passkey.</p>
    <p>
      The quick try also fills the install with <a routerLink="/demo-data">demo data</a>: <code>TALEART_SEED_DEMO=true</code> is
      on in <code>.env.docker.example</code>, so a few seconds after the first admin finishes setup there is a ready project, with
      zones, tale groups, tales and a small team. Set it to <code>false</code> on a real install.
    </p>
    <p>
      <strong>Warning:</strong> the database password, the secret key and the setup password in that file are
      <strong>public values</strong>, printed in the repository. Use them only on your own machine, never on a server.
    </p>

    <h2 id="real-install">A real install on a domain</h2>
    <p>This gives you a public address with an https certificate that the proxy gets and renews by itself.</p>
    <ol class="steps">
      <li>
        <h3 class="step-title" id="step-point-the-dns">Point a name at the server.</h3> Create a DNS A (and AAAA) record for the
        name, such as <code>taleart.example.com</code>, that points at the host. The DNS must be correct before the first start, and
        ports 80 and 443 must be open: the certificate is requested over them.
      </li>
      <li>
        <h3 class="step-title" id="step-copy-the-env-file">Copy the example file.</h3> Clone the repository and copy
        <code>.env.docker.example</code> to <code>.env</code>.
        <pre tabindex="0" role="region" aria-label="Clone and copy the env file"><code class="language-sh">{{ cloneAndCopy }}</code></pre>
      </li>
      <li>
        <h3 class="step-title" id="step-set-the-address-and-ports">Set the address and the ports.</h3> In <code>.env</code> set
        <code>TALEART_URL=https://taleart.example.com</code>, with no trailing slash, and use the real ports:
        <code>TALEART_HTTP_PORT=80</code> and <code>TALEART_HTTPS_PORT=443</code>.
      </li>
      <li>
        <h3 class="step-title" id="step-generate-the-secrets">Generate the secrets.</h3> Replace the two placeholders with random values and keep a copy of them.
        <pre tabindex="0" role="region" aria-label="Generate the secrets"><code class="language-sh">{{ secrets }}</code></pre>
        Put the first output in <code>POSTGRES_PASSWORD</code> and the second in <code>TALEART_SECRET_KEY</code>. Leave
        <code>TALEART_SETUP_PASSWORD=false</code> (the default) so the first admin must use a passkey.
      </li>
      <li>
        <h3 class="step-title" id="step-start-it">Start it.</h3> Build and start the stack, then check that all four services are healthy.
        <pre tabindex="0" role="region" aria-label="Start the stack"><code class="language-sh">{{ start }}</code></pre>
        Open <code>https://taleart.example.com</code>.
      </li>
    </ol>
    <p>
      Do not skip the secrets. <code>POSTGRES_PASSWORD</code> has no default: compose refuses to start while it is empty.
      Changing it later does not change the existing database, so set it before the first start.
    </p>

    <h2 id="environment-variables">Environment variables</h2>
    <p>Set these in <code>.env</code>, next to <code>docker-compose.yml</code>. The file <code>.env.docker.example</code> lists all of them.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Environment variables">
      <table id="env-table">
        <thead>
          <tr><th>Variable</th><th>Required</th><th>Default</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr data-env="TALEART_URL"><td><code>TALEART_URL</code></td><td>Yes</td><td>None (the example file sets <code>http://localhost:8080</code>)</td><td>The exact address people open, with no trailing slash. The passkey domain and origin, the public media and SDK URL and the host the dashboard accepts all come from it. <code>https://</code> turns on automatic certificates; <code>http://</code> serves plain HTTP.</td></tr>
          <tr data-env="TALEART_HTTP_PORT"><td><code>TALEART_HTTP_PORT</code></td><td>No</td><td><code>80</code> (the example file sets <code>8080</code>)</td><td>Host port of the proxy for http.</td></tr>
          <tr data-env="TALEART_HTTPS_PORT"><td><code>TALEART_HTTPS_PORT</code></td><td>No</td><td><code>443</code> (the example file sets <code>8443</code>)</td><td>Host port of the proxy for https.</td></tr>
          <tr data-env="POSTGRES_PASSWORD"><td><code>POSTGRES_PASSWORD</code></td><td>Yes</td><td>None</td><td>Password of the <code>taleart</code> database user. Letters and digits are safest, because it goes into a connection URL. Only set it before the first start.</td></tr>
          <tr data-env="TALEART_SECRET_KEY"><td><code>TALEART_SECRET_KEY</code></td><td>Recommended</td><td>Empty</td><td>32 random bytes, base64. Encrypts the sign-in provider secrets (Google, Apple, OIDC) stored in the database. Keep it: if it is lost, the saved secrets cannot be read. Left empty, the API runs but refuses to save provider secrets.</td></tr>
          <tr data-env="TALEART_SETUP_PASSWORD"><td><code>TALEART_SETUP_PASSWORD</code></td><td>No</td><td><code>false</code> (the example file sets <code>true</code>)</td><td><code>true</code> lets the first admin set up with a username and password instead of a passkey.</td></tr>
          <tr data-env="TALEART_SEED_DEMO"><td><code>TALEART_SEED_DEMO</code></td><td>No</td><td><code>false</code> (the example file sets <code>true</code>)</td><td><code>true</code> makes the <a routerLink="/demo-data">demo project</a> for the first admin right after setup. Quick try only; once, and only on an install with no other user.</td></tr>
          <tr data-env="TALEART_VERSION"><td><code>TALEART_VERSION</code></td><td>No</td><td><code>local</code></td><td>Tag of the images compose builds (<code>taleart/api</code>, <code>taleart/dashboard</code>).</td></tr>
          <tr data-env="TRUST_PROXY"><td><code>TRUST_PROXY</code></td><td>No</td><td><code>1</code></td><td>How many proxies in front of the API are trusted for <code>X-Forwarded-For</code>: a number of hops, or a list of addresses. 1 is the bundled proxy; 2 when your own proxy sits in front of it. Used for the per-visitor rate limit.</td></tr>
          <tr data-env="DELIVERY_RATE_LIMIT_BURST"><td><code>DELIVERY_RATE_LIMIT_BURST</code></td><td>No</td><td>Empty (built-in default)</td><td>Delivery API requests a visitor may make at once. <code>0</code> turns the limit off.</td></tr>
          <tr data-env="DELIVERY_RATE_LIMIT_PER_SECOND"><td><code>DELIVERY_RATE_LIMIT_PER_SECOND</code></td><td>No</td><td>Empty (built-in default)</td><td>Delivery API requests per second per visitor.</td></tr>
          <tr data-env="DATABASE_POOL_MAX"><td><code>DATABASE_POOL_MAX</code></td><td>No</td><td><code>20</code></td><td>Database connections the API holds.</td></tr>
          <tr data-env="SDK_BUILDS_KEPT"><td><code>SDK_BUILDS_KEPT</code></td><td>No</td><td><code>5</code></td><td>How many Web SDK builds stay at their pinned URLs (2 to 100).</td></tr>
          <tr data-env="TALEART_API_PORT"><td><code>TALEART_API_PORT</code></td><td>No</td><td><code>3333</code></td><td>Only with the external-proxy file: the loopback port of the api.</td></tr>
          <tr data-env="TALEART_DASHBOARD_PORT"><td><code>TALEART_DASHBOARD_PORT</code></td><td>No</td><td><code>4000</code></td><td>Only with the external-proxy file: the loopback port of the dashboard.</td></tr>
        </tbody>
      </table>
    </div>
    <p>
      The API also reads <code>PROJECT_MEDIA_MAX_FILES</code>, <code>PROJECT_MEDIA_MAX_BYTES</code>, <code>RP_ID</code>,
      <code>RP_ORIGIN</code> and <code>PUBLIC_API_URL</code>. The last three are derived from <code>TALEART_URL</code>; set them
      in <code>docker-compose.yml</code> under <code>api</code> only to override.
    </p>

    <h2 id="first-run">First run</h2>
    <p>
      The first visit shows the setup screen. Enter a name, an email and the name of your first project, then create the administrator.
      Setup is open only until the first admin exists.
    </p>
    <figure>
      <img
        src="images/docker-shot-setup.png"
        alt="The Set up TaleArt screen on a fresh Docker install: the text You become the admin, fields for Name, Email and First project, a Create passkey button, and below it a username and password section."
        width="1280"
        height="800"
      />
      <figcaption>The setup screen of a new Docker install, a real screenshot. The username and password section appears when <code>TALEART_SETUP_PASSWORD=true</code>.</figcaption>
    </figure>
    <ul>
      <li><strong>Passkey.</strong> Choose <em>Create passkey</em>. Browsers register passkeys only on <code>https://</code> addresses and on <code>http://localhost</code>. An <code>http://</code> address such as <code>http://192.168.1.20</code> cannot register a passkey: use a real domain with https, or localhost.</li>
      <li><strong>Username and password.</strong> Set <code>TALEART_SETUP_PASSWORD=true</code> in <code>.env</code> and restart the api to offer this on the setup screen. It is off by default; turn it on only if you cannot use a passkey, and consider turning it off after setup.</li>
      <li><strong>The domain is fixed.</strong> The passkey is bound to the domain in <code>TALEART_URL</code>. Changing the domain later makes existing passkeys unusable.</li>
    </ul>
    <p>After setup you land on the Zones page of your first project. In the quick try, the <a routerLink="/demo-data">demo data</a> appears a few seconds later.</p>
    <figure>
      <img
        src="images/docker-shot-demo-zones.png"
        alt="The dashboard after setup on the quick try: the Zones page of the Spring Campaign demo project, signed in as Ada Admin, with three zone cards, Home stories, Sale banner and Collection posters."
        width="1280"
        height="800"
      />
      <figcaption>The first sign-in on the Docker quick try, a real screenshot: the demo project, with three zones. Without the demo data, the page shows an empty project.</figcaption>
    </figure>
    <p>Next: <a routerLink="/">Getting started</a> walks through the first zone, and <a routerLink="/install">Install a zone</a> shows the snippet.</p>

    <h2 id="own-reverse-proxy">Behind your own reverse proxy</h2>
    <p>
      If you already run a reverse proxy on the host, do not publish the bundled one. The overlay file
      <code>deploy/docker-compose.external-proxy.yml</code> turns the bundled proxy off and publishes the api and the dashboard on
      loopback only, at <code>127.0.0.1:3333</code> and <code>127.0.0.1:4000</code>.
    </p>
    <pre tabindex="0" role="region" aria-label="Start with an external proxy"><code class="language-sh">{{ external }}</code></pre>
    <p>
      Set <code>TALEART_URL</code> to the address your proxy serves. Your proxy must route <code>/api/</code>, <code>/delivery/</code>,
      <code>/media/</code> and <code>/sdk/</code> to port 3333 and everything else to port 4000, keep the original <code>Host</code> header,
      send <code>X-Forwarded-For</code>, and allow bodies of at least 100 MB and requests of 300 seconds. An nginx server block:
    </p>
    <pre tabindex="0" role="region" aria-label="nginx configuration"><code class="language-nginx">{{ nginx }}</code></pre>
    <p>
      If another proxy, such as a CDN or a load balancer, sits in front of yours, use <code>$proxy_add_x_forwarded_for</code> and set
      <code>TRUST_PROXY=2</code>.
    </p>

    <h2 id="data-and-backups">Data and backups</h2>
    <p>Everything lives in the volumes listed above. Back up the database and the media files, and keep <code>.env</code> with them: the secret key in it is needed to read the saved provider secrets.</p>
    <pre tabindex="0" role="region" aria-label="Backup commands"><code class="language-sh">{{ backup }}</code></pre>
    <p>
      The <code>taleart_sdk-builds</code> volume holds earlier Web SDK builds so pages that pin one keep working; include it
      in your volume backups if you rely on pinned builds. To restore, bring up an empty install and run the
      <code>pg_restore</code> command.
    </p>

    <h2 id="upgrades">Upgrades</h2>
    <pre tabindex="0" role="region" aria-label="Upgrade commands"><code class="language-sh">{{ upgrade }}</code></pre>
    <p>
      The API applies database migrations itself when it starts. They only go <strong>forward</strong>: there is no automatic way
      back to an older version, so take a database backup before every upgrade.
    </p>

    <h2 id="logs-and-health">Logs and health</h2>
    <pre tabindex="0" role="region" aria-label="Logs and status commands"><code class="language-sh">{{ logs }}</code></pre>
    <p>
      <code>docker compose ps</code> should show <code>db</code>, <code>api</code>, <code>dashboard</code> and <code>proxy</code> as
      <em>healthy</em>. The proxy starts only after the api and the dashboard are healthy. API logs are structured JSON, one line per entry.
    </p>

    <h2 id="stopping-and-resetting">Stopping and resetting</h2>
    <pre tabindex="0" role="region" aria-label="Stop and reset commands"><code class="language-sh">{{ stop }}</code></pre>
    <p>
      <code>docker compose down -v</code> deletes everything, including the administrator, so setup starts again. To reset only the
      setup, restore a database backup instead. If you changed <code>POSTGRES_PASSWORD</code> after the first start, change the user's
      password in the database to match: <code>ALTER USER taleart PASSWORD '...'</code> in
      <code>docker compose exec db psql -U taleart</code>.
    </p>

    <h2 id="troubleshooting">Troubleshooting</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Troubleshooting">
      <table id="troubleshooting-table">
        <thead>
          <tr><th>What you see</th><th>Why</th><th>What to do</th></tr>
        </thead>
        <tbody>
          <tr><td>Compose says a port is already in use, or <code>proxy</code> does not start</td><td>Another program uses port 80, 443, 8080 or 8443 on the host.</td><td>Stop it, or set <code>TALEART_HTTP_PORT</code> and <code>TALEART_HTTPS_PORT</code> to free ports and start again. On a server with a domain, 80 and 443 must be free.</td></tr>
          <tr><td>Compose refuses to start: <code>Set POSTGRES_PASSWORD in .env</code> or <code>Set TALEART_URL in .env</code></td><td>A required variable is empty, or there is no <code>.env</code> file.</td><td>Copy <code>.env.docker.example</code> to <code>.env</code> and fill in both values.</td></tr>
          <tr><td>The setup page does not load, or the dashboard answers with 400</td><td>The dashboard accepts only the host name in <code>TALEART_URL</code>. You opened the stack by another name or address.</td><td>Open exactly the address in <code>TALEART_URL</code>, or correct it in <code>.env</code> and run <code>docker compose up -d</code> again.</td></tr>
          <tr><td>The browser refuses to create a passkey</td><td>The address is plain <code>http://</code> on a name other than localhost.</td><td>Use https on a real domain, or localhost. With <code>TALEART_SETUP_PASSWORD=true</code> the first admin can use a password.</td></tr>
          <tr><td>No https certificate, or the browser warns about the certificate</td><td>The DNS record does not point at the host, or ports 80 and 443 are not reachable from outside.</td><td>Fix the DNS record and the firewall, then check <code>docker compose logs -f proxy</code>.</td></tr>
          <tr><td>The api log says <code>Provider secrets off: TALEART_SECRET_KEY is not set</code></td><td>The secret key is empty (or, with a different message, is not 32 bytes of base64).</td><td>Set it with <code>openssl rand -base64 32</code>. Until then the API runs but cannot save sign-in provider secrets.</td></tr>
          <tr><td>The api cannot connect to the database after you changed <code>POSTGRES_PASSWORD</code></td><td>The password only applies when the database is first created.</td><td>Restore the old value, or change the user's password inside the database (see Stopping and resetting).</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="security-notes">Security notes</h2>
    <ul>
      <li>The database publishes no port. It is reachable only from the other services in the compose network.</li>
      <li>Only the proxy is published, or, with the external-proxy file, the api and the dashboard on <code>127.0.0.1</code> only.</li>
      <li>The api and the dashboard containers run as a non-root user.</li>
      <li>Replace every placeholder secret from <code>.env.docker.example</code> before a server is reachable from the internet, and keep <code>.env</code> out of version control.</li>
      <li>Keep <code>TALEART_SETUP_PASSWORD</code> off on a server unless you need it.</li>
    </ul>
  `,
})
export class DockerPage {
  protected readonly quickTry = `git clone <this repository> taleart && cd taleart
docker compose --env-file .env.docker.example up -d --build`;

  protected readonly cloneAndCopy = `git clone <this repository> taleart && cd taleart
cp .env.docker.example .env`;

  protected readonly secrets = `openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 32   # TALEART_SECRET_KEY`;

  protected readonly start = `docker compose up -d --build
docker compose ps          # db, api, dashboard and proxy should be "healthy"`;

  protected readonly external = `docker compose -f docker-compose.yml -f deploy/docker-compose.external-proxy.yml up -d --build`;

  protected readonly nginx = `server {
  server_name taleart.example.com;                # listen 443 ssl; certificates as usual
  client_max_body_size 110m;
  proxy_read_timeout 300s;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;  # one trusted hop: TRUST_PROXY=1
  proxy_set_header X-Forwarded-Proto $scheme;
  location ~ ^/(api|delivery|media|sdk)/ { proxy_pass http://127.0.0.1:3333; }
  location / { proxy_pass http://127.0.0.1:4000; }
}`;

  protected readonly backup = `# database
docker compose exec -T db pg_dump -U taleart -Fc taleart > taleart-$(date +%F).dump
# media files
docker run --rm -v taleart_media:/data -v "$PWD":/backup alpine tar czf /backup/media-$(date +%F).tgz -C /data .
# restore the database into an empty install
docker compose exec -T db pg_restore -U taleart -d taleart --clean --if-exists < taleart-2026-01-01.dump`;

  protected readonly upgrade = `git pull
docker compose up -d --build`;

  protected readonly logs = `docker compose logs -f api            # structured JSON, one line per entry
docker compose logs -f proxy dashboard
docker compose ps`;

  protected readonly stop = `docker compose down       # stops; data stays in the volumes
docker compose down -v    # stops AND DELETES the database, media and certificates`;
}
