import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'docs-projects-and-team',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h1 tabindex="-1">Projects, team and sign-in</h1>
<p>A <strong>project</strong> holds zones, tale groups, themes, fonts, user lists and one site key (for server-side callers). Most teams have one project per site or brand.</p>
<p><img class="guide-img" alt="Projects" src="guides/images/20-projects.png" width="1280" height="800" /></p>
<h2 id="sign-in">Sign-in</h2>
<p>People sign in with a passkey, a username and password, or a provider such as Google or Apple, for each method an admin has turned on. The first screen creates the admin and the first project. Nobody can sign up on their own: people join by invitation, and a provider never creates an account by itself. See the <a routerLink="/guides/sign-in-methods">sign-in methods guide</a>.</p>
<p><img class="guide-img" alt="First-run setup" src="guides/images/01-setup.png" width="1280" height="800" /></p>
<h2 id="invite-people">Invite people</h2>
<p>An admin invites a person from the project's <strong>Invite</strong> button. The invite link is <code>/invite/&lt;token&gt;</code> and expires after 7 days. The person joins with a passkey, a username and password, or a provider whose verified email matches the email they type on the invitation page.</p>
<h2 id="settings">Settings</h2>
<p><strong>Settings</strong> holds your <a routerLink="/api-tokens">API tokens</a>.</p>
<h2 id="switching-projects">Switching projects</h2>
<p>The project picker in the header changes which project the dashboard shows. <strong>New project</strong> creates another one.</p>
  `,
})
export class ProjectsAndTeamPage {}
