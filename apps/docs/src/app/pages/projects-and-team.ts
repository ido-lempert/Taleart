import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-projects-and-team',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Projects, team and sign-in</h1>
<p>A <strong>project</strong> holds zones, tale groups, themes, fonts, user lists and one site key. Most teams have one project per site or brand.</p>
<p><img class="guide-img" alt="Projects" src="guides/images/20-projects.png" /></p>
<h2 id="sign-in">Sign-in</h2>
<p>TaleArt signs people in with passkeys, with no password. The first screen creates the admin and the first project.</p>
<p><img class="guide-img" alt="First-run setup" src="guides/images/01-setup.png" /></p>
<h2 id="invite-people">Invite people</h2>
<p>An admin invites a person from the project's <strong>Invite</strong> button. The invite link is <code>/invite/&lt;token&gt;</code> and expires after 7 days. The person creates their own passkey.</p>
<h2 id="settings">Settings</h2>
<p><strong>Settings</strong> holds your <a routerLink="/api-tokens">API tokens</a>.</p>
<h2 id="switching-projects">Switching projects</h2>
<p>The project picker in the header changes which project the dashboard shows. <strong>New project</strong> creates another one.</p>
  `,
})
export class ProjectsAndTeamPage {}
