import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_SNIPPET } from '../docs-content';
import { DocsLiveZone } from '../live-zone';
import { landingBannerZone, landingZone } from '../live-zones';

/** One stories bar of the landing page's "Try it" section: the zone, the element's attributes and the feature's page. */
interface PromoItem {
  readonly name: string;
  readonly text: string;
  readonly link: string;
  readonly linkText: string;
}

@Component({
  selector: 'docs-getting-started',
  imports: [RouterLink, DocsLiveZone],
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

    <h2 id="try-it">Try the Web SDK on this page</h2>
    <p>
      The bar and the banner below are the real Web SDK, rendered from zone data written into this page: no zone key, no
      API and no request. Tap a group to open its tales. Answers to a poll, a quiz, a rating or a reaction stay on this
      device.
    </p>

    <h3 id="try-features">Features: one stories bar</h3>
    <docs-live-zone
      [zone]="features"
      [attributes]="featuresAttributes"
      caption="Each group is one feature. Tap a circle to open it."
      label="Features: a live stories bar"
      [minHeight]="130"
    />
    <dl class="feature-list">
      @for (item of featureList; track item.name) {
        <div class="feature-list__item">
          <dt>{{ item.name }}</dt>
          <dd>
            {{ item.text }}
            <a [routerLink]="item.link">{{ item.linkText }}</a>
          </dd>
        </div>
      }
    </dl>

    <h3 id="try-banners">Promotion banner</h3>
    <p>A banner shows one slide per group, in a carousel. Use the arrows or the dots; nothing moves by itself.</p>
    <docs-live-zone
      [zone]="banner"
      caption="Spring promotion: an offer, a vote, a picture and a sale countdown."
      label="Spring promotion: a live banner"
      [minHeight]="220"
    />

    <p class="credits-note">
      The example photos come from Unsplash. They are credited in the <a routerLink="/legal/terms" fragment="photo-credits">terms of service</a>.
    </p>

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
        <strong>New tale group.</strong> On the zone page, click New tale group. Its draft tale opens in Tale Studio:
        give it an image or video as its background and click Update tale. Leave the studio and name the group in the
        Tale group drawer. New tales are Shown.
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
      <a routerLink="/visibility">Visibility and troubleshooting</a> explains a zone that does not show. To show tales on a page with no TaleArt server, pass the zone JSON yourself:
      <a routerLink="/guides/no-backend">Use without a backend</a>.
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
      <li><a routerLink="/demo-data">Demo data</a></li>
      <li><a routerLink="/security">Security and hardening</a></li>
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
      <li><a routerLink="/guides/no-backend">Use without a backend</a></li>
      <li><a routerLink="/android-guide">Android guide</a></li>
      <li><a routerLink="/web-sdk-security">Web SDK: CSP and analytics</a></li>
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
      <li><a routerLink="/mcp">MCP server</a></li>
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

  // One bar and one banner for the whole section. The countdown is built when the page is, so it runs for three days.
  protected readonly features = landingZone();
  protected readonly banner = landingBannerZone();
  // The theme is set once on the one bar: its accent and ring colours.
  protected readonly featuresAttributes = {
    theme: JSON.stringify({ accentColor: '#2b829f', ringColors: ['#2b829f', '#f0a500'] }),
  };

  // What each group of the bar shows, in the same order as the bar.
  protected readonly featureList: readonly PromoItem[] = [
    {
      name: 'Poll',
      text: 'A question with two options. Each vote counts once per device, then the poll shows the percentages.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Quiz',
      text: 'Four answers and one correct one. The viewer sees right or wrong, and how everyone else answered.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Rating',
      text: 'A slider with an emoji as its thumb, from 0 to 100. The rating shows the average of all ratings.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Reaction',
      text: 'A row of emoji to tap. Each emoji shows how many people tapped it.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Countdown',
      text: 'Days, hours, minutes and seconds until a sale ends, then the text you choose.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Promo code',
      text: 'A code in a chip with a Copy button. The code is visible to everyone, so it is not a secret.',
      link: '/interactive-components',
      linkText: 'Interactive components',
    },
    {
      name: 'Frequency',
      text: 'frequency="once" hides a group after the viewer has seen it. Tap it, then reload: it is gone.',
      link: '/guides/web',
      linkText: 'Web guide',
    },
    {
      name: 'Audience',
      text: 'The Pro group is left out: this viewer has no plan. A page sets the viewer\'s properties to show it.',
      link: '/targeting',
      linkText: 'Targeting',
    },
    {
      name: 'Right to left',
      text: 'The Hebrew group: on a Hebrew or Arabic page the bar and its texts turn with the reading direction.',
      link: '/guides/web',
      linkText: 'Web guide',
    },
    {
      name: 'Theme',
      text: 'Colours, rings and fonts. This bar sets its own accent and ring colours in its element.',
      link: '/theme-and-fonts',
      linkText: 'Theme and fonts',
    },
  ];
}
