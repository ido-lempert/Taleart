import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-legal-privacy',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Privacy policy</h1>
    <p class="lede">
      What TaleArt collects, why, for how long, who is responsible, and how to ask for your data to be corrected or
      deleted. Version of 31 October 2026.
    </p>
    <p class="muted">
      The owner wrote this text personally, from what the code does. It is not legal advice, and the owner may have it
      reviewed by a lawyer later. Where something is not automated, this page says so and says what the owner does by
      hand on request.
    </p>

    <h2 id="who">1. Who is responsible</h2>
    <p>
      The controller of the data described here is Ido Lempert, an individual developer in Israel ("the owner",
      "we"), for the documentation site and for the TaleArt workspaces and accounts the owner runs. Contact:
      <a href="https://github.com/ido-lempert/Taleart/issues">GitHub issues</a> (see
      <a routerLink="/legal/privacy" fragment="rights">Your rights</a> for how to ask privately).
    </p>
    <p>There are three situations, and the roles differ:</p>
    <ol>
      <li>
        <strong>You read the documentation</strong> (<a routerLink="/legal/privacy" fragment="docs-site">section 3</a>). The owner is the controller.
      </li>
      <li>
        <strong>You have an account in a workspace the owner runs</strong> (<a routerLink="/legal/privacy" fragment="accounts">section 4</a>). The
        owner is the controller of your account data. TaleArt is self-hosted: if you have an account in a workspace run
        by someone else, <em>that operator</em> is the controller and the owner has no access to the data.
      </li>
      <li>
        <strong>You see a TaleArt zone on someone's site or in someone's app</strong> (<a routerLink="/legal/privacy" fragment="sdk">section 5</a>).
        The site or app owner (the "customer") is the controller of its end-users' data. When the customer uses an API
        run by the owner, the owner is only a processor: the owner handles that data on the customer's behalf and for the
        purpose of delivering the zone, and not for the owner's own purposes. When the customer runs the API itself, the owner
        never receives that data.
      </li>
    </ol>

    <h2 id="summary">2. In short</h2>
    <ul>
      <li>No advertising, no tracking pixels, no analytics trackers on the documentation site, no profiling.</li>
      <li>No sale of personal data, and no sharing with data brokers or advertisers.</li>
      <li>
        The SDKs send a random visitor id and anonymous counts. Viewer properties, tags and the seen-and-frequency
        state stay on the device. The optional external user ID is used only to match a list and is not stored.
      </li>
      <li>The API stores no IP address, no user agent and no access log.</li>
    </ul>

    <h2 id="docs-site">3. The documentation site</h2>
    <p>
      The documentation site is static pages hosted on GitHub Pages at taleart.lempert.site. The site's own code sets
      no cookie, loads no analytics, advertising or social-media script, and loads no web font or other resource from
      another company's server. Its two settings stay in your browser's local storage (see
      <a routerLink="/legal/privacy" fragment="storage">Cookies and local storage</a>): your light or dark theme choice, and, if you change it, the
      API address typed on the API reference page. The API reference calls only the address you typed there, and only
      when you press "Execute".
    </p>
    <p>
      GitHub, which hosts the pages, receives your IP address and the request details when you load a page, and keeps
      its own logs under <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement">its privacy statement</a>.
      The owner does not see those logs. The same applies to GitHub issues you open: they are public, and GitHub
      processes your GitHub account data.
    </p>

    <h2 id="accounts">4. Accounts in a workspace (dashboard and API)</h2>
    <p>The dashboard and the Management API store the following about the people who use them:</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Account data table">
      <table>
        <caption class="visually-hidden">Account data the dashboard and the Management API store</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Why</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Name, e-mail address, role (admin or content manager), time created</td>
            <td>To run your account and show who did what in a project</td>
            <td>Stored as typed. An invitation is needed to register; there is no open sign-up.</td>
          </tr>
          <tr>
            <td>Passkey: credential id, public key, counter, transports, times created and last used</td>
            <td>To sign you in</td>
            <td>Only the public key is stored. The private key stays on your device or in your password manager.</td>
          </tr>
          <tr>
            <td>Username and password hash (when the password method is on)</td>
            <td>To sign you in</td>
            <td>
              The password itself is never stored. The hash is salted scrypt. Passwords found in a list of common
              passwords are refused.
            </td>
          </tr>
          <tr>
            <td>Provider identity: provider (Google, Apple or another OpenID Connect provider), the provider's subject
              id, the e-mail the provider gave, times created and last used</td>
            <td>To sign you in with an external provider, when an admin turned one on</td>
            <td>
              The provider receives a sign-in request and tells us who you are; see its own policy. The e-mail is shown
              and is not used to sign in.
            </td>
          </tr>
          <tr>
            <td>Session: a hash of a random token, time created, expiry</td>
            <td>To keep you signed in</td>
            <td>The token itself is only in your cookie. A session lasts 7 days.</td>
          </tr>
          <tr>
            <td>Short-lived sign-in challenges (passkey or provider steps)</td>
            <td>To finish a sign-in safely</td>
            <td>Valid 5 minutes (passkey) or 10 minutes (provider) and used once.</td>
          </tr>
          <tr>
            <td>Invitations and password reset links: hash of the token, who made it, times, when and by whom used</td>
            <td>To let you join or recover access</td>
            <td>Invitations last 7 days and reset links 24 hours. Each works once.</td>
          </tr>
          <tr>
            <td>API tokens you create: a hash of the token, name, projects, times</td>
            <td>For scripts and the command-line tool</td>
            <td>The token is shown to you once.</td>
          </tr>
          <tr>
            <td>Project membership, and the projects, zones, tales, fonts, media, theme and targeting settings you create</td>
            <td>To provide the service you use</td>
            <td>
              This is your content. Tale media is served from public addresses so viewers can see it. Uploads are images
              up to 10 MB and video up to 100 MB each.
            </td>
          </tr>
          <tr>
            <td>User lists you upload: the external user IDs, stored only as a keyed hash (HMAC-SHA-256) with a secret
              of the project</td>
            <td>To show tale groups to the viewers on a list</td>
            <td>The original IDs are not kept, and the hashes go with the list when you delete it.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      The API writes errors to its standard output as structured lines (the error name, message and stack). It keeps no
      per-request access log and no audit log of its own. A host that runs an API (for example a reverse proxy or a
      hosting provider) may keep its own logs, which the operator controls.
    </p>
    <p>
      <strong>Legal bases.</strong> For account data: it is necessary to give you the service you asked for (the
      contract in the <a routerLink="/legal/terms">Terms</a>) and to keep it secure, which is also a legitimate
      interest of the owner and of the operator. For the Israeli Protection of Privacy Law, 5741-1981: you give the
      data to us knowingly and for these purposes when you accept an invitation and sign in, and we use it only for
      them. Where the law requires your consent for something, we ask for it first.
    </p>

    <h2 id="sdk">5. What the SDKs and the Delivery API process (end-users)</h2>
    <p>
      This section is for the customers who use the SDKs and for the end-users who see a zone. The customer decides
      to use TaleArt and is the controller (<a routerLink="/legal/privacy" fragment="who">section 1</a>); a customer must cover these points in its
      own privacy notice and ask for consent where the law or the platform requires it (for example before storing a
      visitor id or sending analytics). See the
      <a routerLink="/reference/analytics">Analytics reference</a> and the <a routerLink="/guides/web">Web guide</a>
      for the details.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="SDK data table">
      <table>
        <caption class="visually-hidden">What the SDKs and the Delivery API process</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Where it goes</th>
            <th scope="col">Why and notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Zone key</td>
            <td>Sent to the Delivery API in the Authorization header (never in a URL)</td>
            <td>Says which zone to deliver. It is a credential for reading the zone, not a personal identifier.</td>
          </tr>
          <tr>
            <td>Visitor id: a random UUID the SDK makes once per browser or app install</td>
            <td>
              Kept on the device. Sent in the X-TaleArt-Visitor header (in the body of a beacon) with analytics events
              and answers, and when reading a zone.
            </td>
            <td>
              Limits requests per visitor and counts each visitor once. It contains no personal data and is tied to no
              account, but it is a stable identifier of a browser or an install, so the customer should treat it like
              other local identifiers.
            </td>
          </tr>
          <tr>
            <td>Analytics events: type (impression, open, view, click), tale group id, tale id (views and clicks), time</td>
            <td>Sent to the Delivery API, which stores them with a hash of the project id and visitor id</td>
            <td>
              Gives the customer counts in the dashboard. The stored hash is SHA-256 of the project id and the visitor
              id, so a visitor cannot be linked across projects. No IP address, user agent, external user ID, tags or
              viewer properties are stored with an event. Can be turned off with <code>analytics: false</code> in the
              SDK.
            </td>
          </tr>
          <tr>
            <td>Answers to a poll, quiz, rating or reaction: the chosen value, tale, element, time and the visitor id</td>
            <td>Sent to the Delivery API and stored in the project's database</td>
            <td>
              Gives the customer its results and lets each visitor answer once. The visitor id is stored as received
              here, not hashed. The data is the customer's.
            </td>
          </tr>
          <tr>
            <td>External user ID (optional, set by the customer's code)</td>
            <td>
              Sent only as a request header (X-TaleArt-External-User-Id) when reading a zone; held in memory in the
              page or app, not in storage or a cookie
            </td>
            <td>
              The API hashes it as soon as it reads it, checks it against the project's user lists, and does not log or
              store it. It is not sent with analytics events and is never combined with the visitor id. The customer
              must use an opaque ID, not an e-mail address or phone number.
            </td>
          </tr>
          <tr>
            <td>Viewer properties, targeting tags, locale, theme</td>
            <td>Stay on the device. Never sent to the server</td>
            <td>
              The API sends every group with its audience rule, and the SDK evaluates the rule in the page or app.
            </td>
          </tr>
          <tr>
            <td>Seen tale groups, frequency-cap views, the answers given</td>
            <td>Stay on the device, in local storage or native preferences</td>
            <td>Used to show a group once or a limited number of times, and to show an answer already given.</td>
          </tr>
          <tr>
            <td>IP address</td>
            <td>Seen by the API for each request; used in memory only</td>
            <td>
              Used to rate limit abuse (a request without a visitor id is limited by its address; every request also
              counts against an address allowance). Never written to the database or to a log by the API. A host in
              front of the API may log it.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      The customer's tale content (text, images, video, links) is shown to every viewer who has the zone key. It
      should not contain personal data.
    </p>

    <h2 id="storage">6. Cookies and local storage</h2>
    <p>
      <strong>Cookies.</strong> The documentation site, the dashboard's pages and the Delivery API (which serves the
      SDKs) set no cookie. Only the Management API sets these three, all <code>HttpOnly</code>, all strictly for
      signing in, and no consent is needed for them under most laws because they are strictly necessary:
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Cookies table">
      <table>
        <caption class="visually-hidden">Cookies the Management API sets</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Purpose</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>taleart_session</code></td>
            <td>Keeps you signed in. SameSite=Strict, and Secure when the workspace is served over HTTPS.</td>
            <td>Up to 7 days, or until you sign out</td>
          </tr>
          <tr>
            <td><code>taleart_challenge</code></td>
            <td>Links a passkey sign-in or sign-up step to your browser. SameSite=Strict.</td>
            <td>5 minutes</td>
          </tr>
          <tr>
            <td><code>taleart_oauth</code></td>
            <td>Links a Google, Apple or other provider sign-in to your browser. SameSite=Lax.</td>
            <td>10 minutes</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      <strong>Local storage and similar.</strong> These stay on your device. The owner never receives them, except the
      visitor id as described above.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Local storage table">
      <table>
        <caption class="visually-hidden">Local storage keys by place</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Where</th>
            <th scope="col">Purpose</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>taleart-docs-theme</code></td>
            <td>This documentation site</td>
            <td>Your light or dark theme choice</td>
            <td>Until you clear site data</td>
          </tr>
          <tr>
            <td><code>taleart-docs:api-reference:api-url</code></td>
            <td>This documentation site</td>
            <td>The API address you typed on the API reference page (kept only when it is not the default)</td>
            <td>Until you clear site data</td>
          </tr>
          <tr>
            <td><code>taleart.selectedProjectId</code></td>
            <td>The dashboard</td>
            <td>The project you picked in the top bar</td>
            <td>Until you clear site data</td>
          </tr>
          <tr>
            <td><code>taleart.visitor</code></td>
            <td>Web SDK, on the customer's site</td>
            <td>The random visitor id</td>
            <td>Until cleared by the visitor (Safari may clear it after 7 days without a visit)</td>
          </tr>
          <tr>
            <td><code>taleart.seen</code></td>
            <td>Web SDK, on the customer's site</td>
            <td>The ids of the tale groups viewed (up to 500)</td>
            <td>Until cleared</td>
          </tr>
          <tr>
            <td><code>taleart.views</code></td>
            <td>Web SDK, on the customer's site</td>
            <td>Times of recent views for the frequency cap (up to 50 per group, 500 groups)</td>
            <td>Until cleared</td>
          </tr>
          <tr>
            <td><code>taleart.responses</code></td>
            <td>Web SDK, on the customer's site</td>
            <td>The answers the visitor gave, so they are shown again (up to 200)</td>
            <td>Until cleared</td>
          </tr>
          <tr>
            <td><code>taleart-banner-dismissed:&lt;group ids&gt;</code></td>
            <td>Web SDK, on the customer's site (session storage)</td>
            <td>Remembers that a sticky banner was closed</td>
            <td>The browser session</td>
          </tr>
          <tr>
            <td><code>taleart.visitor</code>, <code>taleart.seen</code>, <code>taleart.views</code>,
              <code>taleart.responses</code></td>
            <td>Android SDK (the <code>taleart-sdk</code> SharedPreferences) and iOS SDK (the
              <code>taleart-sdk</code> NSUserDefaults suite)</td>
            <td>The same four uses as above</td>
            <td>Until the app's data is cleared or the app is removed; a device backup may restore them</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      If the storage is missing or blocked, the SDK still works: the visitor id then lasts only for the page load, and
      the seen and frequency state is not kept.
    </p>

    <h2 id="sharing">7. Sharing, sale and advertising</h2>
    <p>
      The owner does not sell personal data, does not use it for advertising or marketing, and does not build
      profiles. He shares data only with:
    </p>
    <ul>
      <li>
        <strong>GitHub</strong> (hosting of the documentation pages, the source code, the issues and the build and
        release automation);
      </li>
      <li>
        <strong>npm</strong> and <strong>Maven Central</strong>, where the SDK packages are published (they see the
        usual package download data; the owner receives no personal data from them);
      </li>
      <li>
        <strong>sign-in providers</strong> (Google, Apple or another provider), only if an admin turned one on and you
        choose it;
      </li>
      <li>
        the <strong>hosting provider</strong> of a workspace the owner runs, which stores the database and the uploaded
        media for the owner;
      </li>
      <li>authorities, when the law requires it, or to protect the owner's legal rights.</li>
    </ul>

    <h2 id="transfers">8. International transfers</h2>
    <p>
      The owner is in Israel. GitHub, npm and some providers process data in the United States and elsewhere. A
      workspace stores its data wherever its operator hosts it. When data of people in the European Economic Area is
      moved out of it, the owner relies on the transfer tools that apply to the provider (such as an adequacy decision
      or standard contractual clauses in the provider's own terms). Israel has an adequacy decision from the European
      Commission.
    </p>

    <h2 id="retention">9. How long data is kept, and what can be deleted</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Retention table">
      <table>
        <caption class="visually-hidden">Retention and deletion by kind of data</caption>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Kept</th>
            <th scope="col">Deletion</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Analytics events</td>
            <td>400 days, then deleted by a job that runs once a day</td>
            <td>Automatic</td>
          </tr>
          <tr>
            <td>Sessions</td>
            <td>Stop working after 7 days or when you sign out</td>
            <td>
              Sign-out deletes the session. Expired rows are cleared the next time the same user signs in, and all of a
              user's sessions end when a password reset link is used.
            </td>
          </tr>
          <tr>
            <td>Sign-in challenges</td>
            <td>Minutes</td>
            <td>Used once; expired ones are cleared by later sign-ins</td>
          </tr>
          <tr>
            <td>Passkeys, the password, linked provider identities</td>
            <td>Until you remove them</td>
            <td>
              Self-service in your account's sign-in methods (the dashboard stops you removing your last method)
            </td>
          </tr>
          <tr>
            <td>API tokens, zone keys, site keys</td>
            <td>Until revoked</td>
            <td>Self-service, in the dashboard or the API</td>
          </tr>
          <tr>
            <td>Tales, tale groups, user lists, fonts</td>
            <td>Until you delete them</td>
            <td>
              Self-service. Deleting a tale deletes its answers. Deleting a user list deletes its hashes.
            </td>
          </tr>
          <tr>
            <td>Account (name, e-mail, role, membership), projects, uploaded media files, answers of a deleted zone,
              used invitations and reset links</td>
            <td>Until the owner or operator deletes them</td>
            <td>
              <strong>Not automated.</strong> There is no self-service account deletion, project deletion or data
              export in the dashboard today. On request, the owner (or the operator) deletes or exports the data by hand
              in the database and the media storage.
            </td>
          </tr>
          <tr>
            <td>Data on your device (local storage, preferences)</td>
            <td>Until cleared</td>
            <td>You clear the site's data or the app's data. The SDKs have no remote way to do that.</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      Backups made by an operator are the operator's own and may keep deleted data until they expire.
    </p>

    <h2 id="security">10. Security</h2>
    <p>These measures exist in the code. No system is perfectly secure, and the owner cannot promise it.</p>
    <ul>
      <li>
        Passwords are hashed with scrypt and a random salt, never stored in clear. Session, invitation and reset
        tokens are random and only their SHA-256 hash is stored.
      </li>
      <li>
        The session cookie is <code>HttpOnly</code> and <code>SameSite=Strict</code>, and <code>Secure</code> when the
        workspace is served over HTTPS (HTTPS is the operator's responsibility).
      </li>
      <li>Passkeys keep their private key on your device; the server holds only the public key.</li>
      <li>Sign-in attempts with a password are throttled. The Delivery API is rate limited per visitor and per address.</li>
      <li>Secrets of external sign-in providers are stored encrypted with AES-256-GCM.</li>
      <li>
        Users reach only the projects they belong to; user list IDs are kept only as keyed hashes; analytics visitor ids
        are stored only as hashes that differ per project.
      </li>
    </ul>
    <p>
      If a breach of personal data in a workspace the owner runs puts people at risk, the owner will notify them and the
      authorities as the law requires.
    </p>

    <h2 id="children">11. Children</h2>
    <p>
      TaleArt is not meant for children. The dashboard is for adults who run campaigns, and the owner does not
      knowingly collect data from children. A customer whose site or app is directed at children is responsible for
      meeting the rules that apply to them, including whether to use the SDK's visitor id and analytics at all.
    </p>

    <h2 id="rights">12. Your rights and how to use them</h2>
    <p>
      Depending on where you live, you may have the right to ask whether we hold data about you and to get a copy; to
      correct it; to have it deleted; to restrict or object to its use; to take it with you (portability); and to
      withdraw a consent you gave. Under the Israeli Protection of Privacy Law you may inspect information held about
      you and ask for it to be corrected or deleted. You may also complain to your data protection authority (in
      Israel, the Privacy Protection Authority).
    </p>
    <p>To use a right:</p>
    <ul>
      <li>
        Open an issue at <a href="https://github.com/ido-lempert/Taleart/issues">GitHub issues</a> with the title
        "Privacy request" and no personal details, asking for a private way to talk. The owner will answer there and
        agree with you how to confirm that you are who you say you are, before the owner gives out or deletes anything.
      </li>
      <li>
        The owner aims to answer within 30 days. Deletion and export are done by hand (see
        <a routerLink="/legal/privacy" fragment="retention">section 9</a>).
      </li>
      <li>
        If you are an end-user of a site or app that uses TaleArt, ask that site or app first; it is the controller.
        The owner can then help it, as its processor. Because the visitor id is random and tied to no name, the owner
        can find a visitor's records only if you give the visitor id from your device (the value of
        <code>taleart.visitor</code>). Clearing your browser's or app's data gives you a new id.
      </li>
    </ul>

    <h2 id="changes">13. Changes</h2>
    <p>
      The owner may update this policy when the software or the law changes. The date at the top shows the current
      version, and the repository's history on GitHub keeps earlier ones. A change that matters to account holders
      will be announced on this site or the dashboard sign-in page before it applies.
    </p>
    <p>
      Read also the <a routerLink="/legal/terms">Terms of service</a> and the
      <a routerLink="/legal/accessibility">Accessibility statement</a>.
    </p>
  `,
})
export class LegalPrivacyPage {}
