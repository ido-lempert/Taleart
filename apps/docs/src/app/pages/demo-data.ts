import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Demo data. The numbers and the flags come from libs/seed-demo, apps/cli/src/commands/seed-demo.ts and
 * deploy/README.md; the page's spec checks the flags and the exit code against the CLI source.
 */
@Component({
  selector: 'docs-demo-data',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Demo data</h1>
    <p class="lede">
      A new install is empty. The demo seed fills it with a made-up furniture store's campaign, so you can see zones, tale
      groups, tales and a team working without building them first. Use it to try TaleArt, to take screenshots, or to test an
      integration against realistic content.
    </p>

    <h2 id="what-it-is">What it contains</h2>
    <p>
      One project named <strong>Spring Campaign</strong>, for a fictional brand, <strong>Nordic Home</strong>. The products, the
      brand and the people are invented, and the pictures show no real product or person.
    </p>
    <figure>
      <img
        src="images/docker-shot-demo-zones.png"
        alt="The Zones page of the Spring Campaign project: three zone cards, Home stories, Sale banner and Collection posters, each marked Visible on site and Installed, with 5, 2 and 3 tale groups."
        width="1280"
        height="800"
      />
      <figcaption>The Zones page right after the seed, a real screenshot: three zones, all installed and visible.</figcaption>
    </figure>
    <figure>
      <img
        src="images/demo-shot-tale-groups.png"
        alt="The Tale groups page of Spring Campaign: five groups, Care tips, Living room, Meet the makers, New arrivals and Spring sale, each with a round cover, tags and the zones it is in. Meet the makers is marked Scheduled."
        width="1280"
        height="800"
      />
      <figcaption>The five tale groups, a real screenshot. <em>Meet the makers</em> is scheduled to start later, so it is not visible yet.</figcaption>
    </figure>
    <figure>
      <img
        src="images/demo-shot-zone-groups.png"
        alt="The Home stories zone page, Tale groups tab: a list of tale groups with covers, tags, On switches and the reason each is visible on the site."
        width="1280"
        height="800"
      />
      <figcaption>Inside the zone <em>Home stories</em>: each group shows why it is visible, here for viewers with a matching tag.</figcaption>
    </figure>
    <p>The details are in the table at the end of the page.</p>

    <h2 id="two-ways">Two ways to get it</h2>
    <h3 id="docker-quick-try">The Docker quick try</h3>
    <p>
      The example file of the <a routerLink="/docker">Docker install</a> sets <code>TALEART_SEED_DEMO=true</code>. When the first
      admin finishes the setup screen, the API makes the demo project for them within a few seconds, through its own Management
      API, and then revokes the short-lived token it used. Refresh the dashboard to see it.
    </p>
    <pre tabindex="0" role="region" aria-label="Quick try commands"><code class="language-sh">{{ quickTry }}</code></pre>
    <p>
      This is the only way to get the demo <strong>team</strong> as well (see below), because no API token may create a user or an
      invitation.
    </p>

    <h3 id="cli">The command line</h3>
    <p>
      On any other install, an admin runs <code>taleart seed-demo</code> with an <a routerLink="/api-tokens">API token</a>
      (Settings, API tokens in the dashboard). Check first, then make it:
    </p>
    <pre tabindex="0" role="region" aria-label="Seed with the CLI"><code class="language-sh">{{ cliCommands }}</code></pre>
    <p>
      The CLI finds the install through <code>--api-url</code> or <code>TALEART_API_URL</code>, and signs in with
      <code>TALEART_TOKEN</code> or with <code>taleart login</code>. The token's user must be an admin, because creating a
      project needs one. See the <a routerLink="/cli">command-line tool</a> page for the rest of the CLI.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="seed-demo options">
      <table id="seed-demo-options">
        <thead>
          <tr><th>Option</th><th>Does</th></tr>
        </thead>
        <tbody>
          <tr><td><code>--dry-run</code></td><td>Checks the install and says what would be made. Changes nothing.</td></tr>
          <tr><td><code>--force</code></td><td>Seeds even when the install already has projects or the demo project. The new project is named <code>Spring Campaign 2</code> when the first one exists.</td></tr>
          <tr><td><code>--json</code></td><td>Prints the result as JSON: <code>status</code> (<code>created</code>, <code>exists</code> or <code>dry-run</code>), the project, the counts and, for a created run, the zone keys.</td></tr>
          <tr><td><code>--api-url</code></td><td>The address of the install. Also read from <code>TALEART_API_URL</code>.</td></tr>
        </tbody>
      </table>
    </div>
    <p>
      If the command refuses (the install already has other projects), it exits with code <strong>6</strong> and the error code
      <code>seed_refused</code>. Rerun with <code>--force</code>, or use a fresh install.
    </p>

    <h2 id="safety">Safety rules</h2>
    <ul>
      <li><strong>Never on a populated install, by accident.</strong> The CLI refuses an install whose user already has other projects. <code>--force</code> overrides it.</li>
      <li><strong>Running twice does nothing.</strong> A project named <code>Spring Campaign</code> is the marker: the second run reports <code>exists</code> and changes nothing. With <code>--force</code> it makes <code>Spring Campaign 2</code>.</li>
      <li><strong>Docker: only at the first admin's setup.</strong> <code>TALEART_SEED_DEMO=true</code> runs once, for the first admin of an install that has no other user. Turning it on later does nothing, because setup has already happened.</li>
      <li><strong>Real installs keep it <code>false</code>.</strong> It is on in <code>.env.docker.example</code> for the quick try only. Set it to <code>false</code> in the <code>.env</code> of a server.</li>
      <li><strong>It uses only the Management API</strong>, so every value passes the API's own checks, and the token it uses is revoked at the end.</li>
    </ul>

    <h2 id="the-team">The demo team</h2>
    <p>
      With <code>TALEART_SEED_DEMO</code> the project also gets a small team, to show every role and the states of an
      access. The four members have <code>example.com</code> email addresses and <strong>cannot sign in</strong>: they have no
      passkey, password or provider. There are also two pending invitations. The seeded people are not in the first admin's own
      list of members, so the screenshot shows the admin only in the page header.
    </p>
    <figure>
      <img
        src="images/demo-shot-team.png"
        alt="Settings, Team for Spring Campaign: four members, Pia Publisher, Elin Editor, Viktor Viewer with access until 14 Nov 2026 and Olle Former marked Expired, and below them a Pending invitations table with a Viewer and a Publisher invitation."
        width="1280"
        height="800"
      />
      <figcaption>The demo team, a real screenshot: members with their roles, one access that ends soon, one that has ended, and two pending invitations.</figcaption>
    </figure>
    <p>
      The CLI cannot make the team. A project seeded with <code>taleart seed-demo</code> has no members besides the token's
      user. See <a routerLink="/roles-and-permissions">Roles and permissions</a> for what each role can do.
    </p>

    <h2 id="artwork">The artwork</h2>
    <p>
      The pictures are original flat illustrations of furniture scenes, drawn for the TaleArt repository as SVG and rendered to
      JPEG. Nothing comes from a photo library or a stock site. They are licensed under Apache-2.0, like the rest of the repository.
      There are 18 files, about 580 KB in all: five round covers for the tale groups and thirteen full-screen pictures
      (1080 by 1920) for the tales.
    </p>

    <h2 id="what-is-created">What is created</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="What the seed creates">
      <table id="seed-demo-contents">
        <thead>
          <tr><th>Thing</th><th>Count</th><th>Details</th></tr>
        </thead>
        <tbody>
          <tr><th scope="row">Project</th><td>1</td><td><code>Spring Campaign</code>, with a theme of warm sand and terracotta rings and a serif font.</td></tr>
          <tr><th scope="row">Zones</th><td>3</td><td><code>Home stories</code> (a ring bar), <code>Sale banner</code> (a banner) and <code>Collection posters</code> (a poster bar). Each has a zone key, so it reads as installed.</td></tr>
          <tr><th scope="row">Tale groups</th><td>5</td><td><code>New arrivals</code>, <code>Spring sale</code>, <code>Living room</code>, <code>Care tips</code> and <code>Meet the makers</code>, with covers and tags. One is scheduled.</td></tr>
          <tr><th scope="row">Tales</th><td>13</td><td>Pictures, text and buttons, plus interactive elements: a countdown, a promo code, a poll, a quiz, a rating and a reaction. One tale is hidden (a saved draft nobody sees yet).</td></tr>
          <tr><th scope="row">User list</th><td>1</td><td><code>Newsletter subscribers</code>.</td></tr>
          <tr><th scope="row">Team members</th><td>4</td><td>Pia (Publisher), Elin (Editor), Viktor (Viewer, access ends in 14 days) and Olle (Editor, access already ended). Docker only.</td></tr>
          <tr><th scope="row">Pending invitations</th><td>2</td><td>A Publisher and a Viewer (access for 30 days). Docker only.</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="limits">Limits</h2>
    <ul>
      <li><strong>A failed run leaves a partial project.</strong> The seed is not a transaction. If it stops half way, the project stays as it is. Start from a fresh database, or run it again with <code>--force</code> to get <code>Spring Campaign 2</code>.</li>
      <li><strong>Zone keys are printed once.</strong> A created CLI run prints each zone's key in its result. Save it then; rotating the key in the dashboard shows a new one.</li>
      <li><strong>Tale Studio shows interactive elements as placeholders.</strong> The countdown, promo code, poll, quiz, rating and reaction render for real on a page with the Web SDK, such as the SDK test page, not inside the studio. See <a routerLink="/interactive-components">Interactive components</a>.</li>
      <li><strong>No project delete.</strong> The API cannot delete a project, so the demo is removed only by a fresh database.</li>
    </ul>

    <h2 id="reset">How to reset</h2>
    <p>Remove everything, the demo and your own data, and set up again:</p>
    <pre tabindex="0" role="region" aria-label="Reset the install"><code class="language-sh">{{ reset }}</code></pre>
    <p>
      <code>docker compose down -v</code> deletes the database, the media and the certificates, so the setup screen comes back and
      the seed runs again for the new first admin. See <a routerLink="/docker">Stopping and resetting</a>.
    </p>
  `,
})
export class DemoDataPage {
  protected readonly quickTry = `git clone <this repository> taleart && cd taleart
docker compose --env-file .env.docker.example up -d --build   # TALEART_SEED_DEMO=true is in the example file`;

  protected readonly cliCommands = `export TALEART_API_URL=http://localhost:8080 TALEART_TOKEN=tat_...
taleart seed-demo --dry-run     # checks the install and says what it would make
taleart seed-demo
taleart seed-demo --json        # for scripts
taleart seed-demo --force       # adds it even to an install with projects`;

  protected readonly reset = `docker compose down -v
docker compose --env-file .env.docker.example up -d --build`;
}
