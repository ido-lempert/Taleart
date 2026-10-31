import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_SNIPPET } from '../docs-content';

@Component({
  selector: 'docs-getting-started',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero" aria-labelledby="hero-title">
      <h1 id="hero-title" tabindex="-1">Getting started</h1>
      <p class="lede">
        TaleArt shows tales (full-screen pages of images, video and text) in spots on your site called zones. This page
        takes you from a new project to a tale on a test page.
      </p>
      <div class="hero__actions">
        <a class="button button--primary" routerLink="/guides/web">Start with the Web guide</a>
        <a class="button" routerLink="/reference/web-sdk">Browse the reference</a>
      </div>
    </section>

    <h2 id="platform-guides">Build with an SDK</h2>
    <p>Each platform guide takes a zone from its key to a visible tale in an app or site, step by step.</p>
    <ul class="cards">
      <li>
        <a class="card" routerLink="/guides/web">
          <span class="card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 8h18M7 21h10M12 18v3" />
            </svg>
          </span>
          <span class="card__title">Web</span>
          <span class="card__text">A web page: the script, the zone element and a test on your site.</span>
          <span class="card__link">Web guide</span>
        </a>
      </li>
      <li>
        <a class="card" routerLink="/android-guide">
          <span class="card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
              <path d="M10.5 18.5h3" />
            </svg>
          </span>
          <span class="card__title">Android</span>
          <span class="card__text">A Compose or Views app, with the Android SDK.</span>
          <span class="card__link">Android guide</span>
        </a>
      </li>
      <li>
        <a class="card" routerLink="/ios-guide">
          <span class="card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="6" y="2.5" width="12" height="19" rx="3" />
              <circle cx="12" cy="18" r="0.6" />
            </svg>
          </span>
          <span class="card__title">iOS</span>
          <span class="card__text">A SwiftUI or UIKit app, with the iOS SDK.</span>
          <span class="card__link">iOS guide</span>
        </a>
      </li>
    </ul>

    <h2 id="from-sign-up-to-a-visible-tale">From sign-up to a visible tale</h2>
    <ol class="steps">
      <li>Set up TaleArt and name your first project: your app or site.</li>
      <li>
        <strong>New zone.</strong> Name the spot (for example "Home – top"), keep or change its slug
        (<code>home-top</code>, the name a page uses for it) and pick a template: <em>Stories bar</em>,
        <em>Promo banner</em> or <em>Blank</em>. The template sets the zone's display once.
      </li>
      <li>
        <strong>New tale group.</strong> On the zone page, create a tale group and add images or videos: each file
        becomes a tale. New tales are Shown.
      </li>
      <li><strong>Turn the group On.</strong> Its Shown tales are now visible in the zone.</li>
      <li>
        <strong>Install tab.</strong> Issue the zone key (admins), then copy the snippet or choose
        <em>Open test page</em>. The zone page says <em>Visible on site</em> once everything is in place.
      </li>
    </ol>

    <p>The snippet looks like this, with your API URL filled in:</p>
    <pre tabindex="0" role="region" aria-label="Install snippet"><code>{{ snippet }}</code></pre>
    <p>
      Put it in any page of your site, with the zone's key in place of <code>YOUR_ZONE_KEY</code>.
      <a routerLink="/install">Install a zone</a> explains each part.
    </p>

    <h2 id="visible-on-site-or-not-visible-because">Visible on site, or not visible because…</h2>
    <p>
      Every zone, tale group and tale in the dashboard says <em>Visible on site</em> or <em>Not visible:</em> and the
      first reason, such as "group is off", "zone has no display" or "zone not installed" (the zone has no zone key
      yet). The dashboard and the Delivery API decide visibility with the same rule.
    </p>

    <p>
      Next: <a routerLink="/concepts">Concepts</a> explains zones, displays, templates and the rest, and
      <a routerLink="/visibility">Visibility and troubleshooting</a> explains a zone that does not show.
    </p>

    <h2 id="all-pages">All pages</h2>
    <p>The same groups as the navigation.</p>
    <h3 id="index-introduction">Introduction</h3>
    <ul>
      <li><a routerLink="/concepts">Concepts</a></li>
      <li><a routerLink="/coverage-and-limits">Coverage and limits</a></li>
    </ul>
    <h3 id="index-installation">Installation</h3>
    <ul>
      <li><a routerLink="/guides-install">Install TaleArt locally</a></li>
      <li><a routerLink="/docker">Install with Docker</a></li>
      <li><a routerLink="/install">Install a zone</a></li>
      <li><a routerLink="/guides-connect-website">Connect a website</a></li>
    </ul>
    <h3 id="index-campaigns">Campaigns</h3>
    <ul>
      <li><a routerLink="/guides-create-campaign">Create a campaign</a></li>
      <li><a routerLink="/zones-and-displays">Zones and displays</a></li>
      <li><a routerLink="/tale-groups-and-tales">Tale groups and tales</a></li>
      <li><a routerLink="/tale-studio">Tale Studio</a></li>
      <li><a routerLink="/interactive-components">Interactive components</a></li>
      <li><a routerLink="/theme-and-fonts">Theme and fonts</a></li>
      <li><a routerLink="/visibility">Visibility and troubleshooting</a></li>
      <li><a routerLink="/targeting">Targeting</a></li>
      <li><a routerLink="/guides/analytics">Read your analytics</a></li>
    </ul>
    <h3 id="index-workspace">Workspace</h3>
    <ul>
      <li><a routerLink="/projects-and-team">Projects, team and sign-in</a></li>
      <li><a routerLink="/roles-and-permissions">Roles and permissions</a></li>
      <li><a routerLink="/guides/sign-in-methods">Sign-in methods</a></li>
    </ul>
    <h3 id="index-sdk-guides">SDK guides</h3>
    <ul>
      <li><a routerLink="/guides/web">Web guide</a></li>
      <li><a routerLink="/android-guide">Android guide</a></li>
      <li><a routerLink="/ios-guide">iOS guide</a></li>
    </ul>
    <h3 id="index-reference">Reference</h3>
    <ul>
      <li><a routerLink="/reference/web-sdk">Web SDK reference</a></li>
      <li><a routerLink="/reference/performance">Performance</a></li>
      <li><a routerLink="/reference/android-sdk">Android SDK reference</a></li>
      <li><a routerLink="/reference/ios-sdk">iOS SDK reference</a></li>
      <li><a routerLink="/reference/analytics">Analytics reference</a></li>
      <li><a routerLink="/reference/sign-in-methods">Sign-in methods reference</a></li>
      <li><a routerLink="/api-reference">API reference</a></li>
      <li><a routerLink="/api-tokens">API tokens</a></li>
      <li><a routerLink="/cli">Command-line tool</a></li>
      <li><a routerLink="/ai-agents">AI agents</a></li>
      <li><a routerLink="/moving-from-stages">Stages and zone keys</a></li>
    </ul>
    <h3 id="index-legal">Legal</h3>
    <ul>
      <li><a routerLink="/legal/terms">Terms of service</a></li>
      <li><a routerLink="/legal/privacy">Privacy policy</a></li>
      <li><a routerLink="/legal/accessibility">Accessibility statement</a></li>
    </ul>
  `,
})
export class GettingStartedPage {
  protected readonly snippet = DOCS_SNIPPET;
}
