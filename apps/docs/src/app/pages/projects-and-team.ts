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
<p>An admin of the project adds people from <strong>Settings &gt; Team</strong>, with <strong>Add or invite</strong>. Someone who already has an account is added by email. A new person gets a one-time invitation link, <code>/invite/&lt;token&gt;</code>, which works once and expires after 7 days. The person joins with a passkey, a username and password, or a provider whose verified email matches the email they type on the invitation page.</p>
<p>Each person has a <strong>role in the project</strong>: Viewer, Editor, Publisher or Admin, and the invitation says which (the default is Editor). The role can come with an end date, and an admin can change it or remove the person at any time. What each role can do, the draft and publish split, and the activity log are in <a routerLink="/roles-and-permissions">Roles and permissions</a>.</p>
<p><img class="guide-img" alt="Settings, Team tab: the Members table with each person's role and access, and the Add or invite button" src="images/team-shot-members.png" width="1280" height="800" /></p>
<h2 id="settings">Settings</h2>
<p><strong>Settings</strong> holds your <a routerLink="/api-tokens">API tokens</a>, your sign-in methods, the project's <strong>Team</strong>, and, for the install's admin, the sign-in methods of the install and the list of users.</p>
<h2 id="switching-projects">Switching projects</h2>
<p>The project picker in the header changes which project the dashboard shows. <strong>New project</strong> creates another one.</p>
  `,
})
export class ProjectsAndTeamPage {}
