import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DOCS_SNIPPET } from '../docs-content';

@Component({
  selector: 'docs-getting-started',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Getting started</h1>
    <p class="lede">
      TaleArt shows tales (full-screen pages of images, video and text) in spots on your site called zones. This page
      takes you from a new project to a tale on a test page.
    </p>

    <h2>From sign-up to a visible tale</h2>
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
        <strong>Install tab.</strong> Issue the project's site key (admins), then copy the snippet or choose
        <em>Open test page</em>. The zone page says <em>Visible on site</em> once everything is in place.
      </li>
    </ol>

    <p>The snippet looks like this, with your API URL and your zone's slug filled in:</p>
    <pre><code>{{ snippet }}</code></pre>
    <p>
      Put it in any page of your site, with your site key in place of <code>YOUR_SITE_KEY</code>.
      <a routerLink="/install">Install a zone</a> explains each part.
    </p>

    <h2>Visible on site, or not visible because…</h2>
    <p>
      Every zone, tale group and tale in the dashboard says <em>Visible on site</em> or <em>Not visible:</em> and the
      first reason, such as "group is off", "zone has no display" or "zone not installed" (the project has no site
      key). The dashboard and the Delivery API use the same rule, so they never disagree.
    </p>

    <p>Next: <a routerLink="/concepts">Concepts</a> explains zones, displays, templates and the rest.</p>
  `,
})
export class GettingStartedPage {
  protected readonly snippet = DOCS_SNIPPET;
}
