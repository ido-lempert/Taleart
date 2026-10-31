import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Project-level roles: what each role can do, how to add and invite people, and how access ends.
 * The roles table below is checked against the contract's PROJECT_ROLE_PERMISSIONS by the page's spec.
 */
@Component({
  selector: 'docs-roles-and-permissions',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Roles and permissions</h1>
    <p class="lede">
      Every person has a <strong>role in each project</strong>: Viewer, Editor, Publisher or Admin. The role decides what
      they can see and change there. An admin of the project sets it from <strong>Settings &gt; Team</strong>, can give it an
      end date, and can read who changed what. The people and sign-in side is in
      <a routerLink="/projects-and-team">Projects, team and sign-in</a>.
    </p>

    <h2 id="the-four-roles">The four roles</h2>
    <p>Each role includes everything the one before it can do.</p>
    <ul>
      <li><strong>Viewer</strong> reads. They see the project, its zones, tale groups and tales, and the analytics. They change nothing.</li>
      <li><strong>Editor</strong> works on content. They create and edit tale groups and tales and save drafts, but cannot make anything live.</li>
      <li><strong>Publisher</strong> makes content live. They publish what editors saved, set visibility and schedules, and manage zones and their displays.</li>
      <li><strong>Admin</strong> runs the project. They also reveal and rotate zone keys and the site key, and manage the team: invite people, change roles, remove access.</li>
    </ul>
    <p>
      A person can have a different role in each project: Publisher in one, Viewer in another. Projects they are not in are
      not shown to them at all.
    </p>

    <h2 id="what-each-role-can-do">What each role can do</h2>
    <p>
      This is the table the dashboard shows under <em>What each role can do</em>, and the one the API enforces on every
      project request. A dash means the role cannot do it.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="What each project role can do">
      <table>
        <thead>
          <tr>
            <th>Can</th>
            <th>Viewer</th>
            <th>Editor</th>
            <th>Publisher</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          <tr data-permission="project.view">
            <td>See the project, its zones, tale groups and tales</td>
            <td data-role="viewer">Yes</td><td data-role="editor">Yes</td><td data-role="publisher">Yes</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="analytics.view">
            <td>See analytics</td>
            <td data-role="viewer">Yes</td><td data-role="editor">Yes</td><td data-role="publisher">Yes</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="content.edit">
            <td>Create and edit tale groups and tales, and save drafts</td>
            <td data-role="viewer">No</td><td data-role="editor">Yes</td><td data-role="publisher">Yes</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="content.publish">
            <td>Publish: turn content on, set visibility and schedules</td>
            <td data-role="viewer">No</td><td data-role="editor">No</td><td data-role="publisher">Yes</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="zones.manage">
            <td>Create and edit zones and their displays</td>
            <td data-role="viewer">No</td><td data-role="editor">No</td><td data-role="publisher">Yes</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="keys.manage">
            <td>Reveal and rotate zone keys and the site key</td>
            <td data-role="viewer">No</td><td data-role="editor">No</td><td data-role="publisher">No</td><td data-role="admin">Yes</td>
          </tr>
          <tr data-permission="members.manage">
            <td>Manage the team: invite people, change roles, remove access</td>
            <td data-role="viewer">No</td><td data-role="editor">No</td><td data-role="publisher">No</td><td data-role="admin">Yes</td>
          </tr>
        </tbody>
      </table>
    </div>
    <figure>
      <img
        src="images/team-shot-roles-matrix.png"
        alt="The What each role can do table on the Team page: seven capabilities down the side, the columns Viewer, Editor, Publisher and Admin, a green tick where the role can do it and a dash where it cannot. A sentence per role sits below the table."
        width="1280"
        height="800"
      />
      <figcaption>The same table in the dashboard, a real screenshot of Settings &gt; Team. Every member of the project can see it.</figcaption>
    </figure>

    <h2 id="install-admins">Install admins</h2>
    <p>
      The admin of the whole install (the person who set TaleArt up, and anyone made an admin under
      <strong>Settings &gt; Users</strong>) is an <strong>Admin in every project</strong>, whether or not they are listed as
      a member. They appear in a project's member list only when someone added them there, marked
      <em>Install admin</em>. Everyone else is a content manager, and their power comes from the role they hold in each project.
    </p>
    <figure>
      <img
        src="images/team-shot-users-roles.png"
        alt="The Users page of Settings, listing five people. Dana Levi has the role Admin and the projects All projects. The others are content managers, each listed with their project and role, such as Spring Campaign: Editor, Spring Campaign: Viewer (until 12 Dec 2026) and Spring Campaign: Editor (access expired)."
        width="1280"
        height="800"
      />
      <figcaption>Settings &gt; Users shows each person's role in every project they are in, with an end date or an expired note. A real screenshot, with example people.</figcaption>
    </figure>

    <h2 id="drafts-and-publishing">Editors save drafts, publishers make them live</h2>
    <p>
      The split between Editor and Publisher works like an approval step. An editor can build and change tales and save the
      changes as a draft, which does not change what visitors see. A publisher reviews the draft and makes it live. Give people
      who write content the Editor role, and give the people who answer for what visitors see the Publisher role.
    </p>
    <p>
      In Tale Studio an editor sees <em>Ask a publisher to publish</em> where a publisher has the publish controls, and the
      status line says the change is not visible yet. In a tale group, the switches that turn content on or off, and the
      schedule, are for publishers: an editor sees the same menu item greyed out with the reason <em>Needs the Publisher role
      or higher.</em>
    </p>
    <figure>
      <img
        src="images/team-shot-editor-draft.png"
        alt="Tale Studio open as an editor named Sam Cohen, with an Editor badge in the header. The toolbar reads All changes saved, Not visible: not updated yet, 1 change, and Ask a publisher to publish in place of a publish button."
        width="1280"
        height="800"
      />
      <figcaption>Tale Studio for an Editor, a real screenshot. The change is saved as a draft and is not visible; the toolbar says to ask a publisher.</figcaption>
    </figure>
    <p>
      A Viewer sees the same screens in read-only form: controls that change something are off, with a note such as
      <em>View only: your role cannot change this group.</em>
    </p>
    <figure>
      <img
        src="images/team-shot-viewer-readonly.png"
        alt="A tale group opened as a Viewer. A note under the header reads View only: your role cannot change this group. The three tales are listed, and their Shown switches cannot be changed."
        width="1280"
        height="800"
      />
      <figcaption>A tale group for a Viewer, a real screenshot. The group can be read but not changed.</figcaption>
    </figure>

    <h2 id="steps">Manage the team, step by step</h2>
    <p>Only an Admin of the project, or an install admin, sees the controls below. Everyone else sees the member list and the roles table, read-only.</p>
    <ol class="steps">
      <li>
        <h3 class="step-title" id="step-open-settings-team">Open Settings > Team.</h3> Pick the project in the header, then choose
        <em>Settings</em> and the <em>Team</em> tab. The page names the project and your own role beside it. The
        <em>Members</em> table lists each person with their <em>Role</em>, their <em>Access</em> (permanent, until a date, or
        expired), when they <em>Joined</em>, and a <em>Remove</em> button.
        <figure>
          <img
            src="images/team-shot-members.png"
            alt="Settings, Team tab, for the project Spring Campaign. The Members table lists Dana Levi (Admin, You, Install admin), Alex Rivera (Publisher), Sam Cohen (Editor), Kim Park (Viewer, until 12 Dec 2026) and Noa Katz (Editor, Expired, ended 25 Oct 2026). A role list, a Change button and a Remove button sit on each row, and an Add or invite button is at the top right."
            width="1280"
            height="800"
          />
          <figcaption>Settings &gt; Team for an Admin, a real screenshot with example people. Kim Park's access ends on a date; Noa Katz's already has.</figcaption>
        </figure>
      </li>

      <li>
        <h3 class="step-title" id="step-invite-someone-with-a-role">Invite someone with a role.</h3> Choose <em>Add or invite</em>, then
        <em>Create a one-time invitation link</em>. Pick the <strong>Role</strong>: the hint under the list says what it allows
        and what it does not. The default is Editor. Optionally set <strong>Access ends</strong>. Choose
        <em>Create link</em>, then <em>Copy link</em> and send it to the person yourself: TaleArt sends no email.
        The link is shown once, works once, and expires after 7 days. The person opens it, signs up with a passkey, a username
        and password or a provider, and joins the project with the role you chose.
        <figure>
          <img
            src="images/team-shot-invitation-link.png"
            alt="The Add or invite drawer after an invitation was created. The invitation link is shown with the note Works once, until Nov 7, 2026, This link is shown only now. Below it: Joins as Editor, Access: Until 31 Jan 2027, a Copy link button and a Done button."
            width="1280"
            height="800"
          />
          <figcaption>The invitation link, a real screenshot. The link is a local test address; the note says it is shown only now, so copy it before choosing Done.</figcaption>
        </figure>
      </li>

      <li>
        <h3 class="step-title" id="step-add-an-existing-user">Add an existing user.</h3> Someone who already has an account on this install needs no
        invitation. Choose <em>Add or invite</em>, keep <em>Add someone who already has an account</em>, type their
        <strong>Email</strong>, pick the <strong>Role</strong>, optionally set <strong>Access ends</strong>, and choose
        <em>Add to project</em>. They have access at once. If the email has no account, the answer is
        <code>user_not_found</code>: invite them instead. If they are already a member (even with expired access) it is
        <code>member_exists</code>: change their role in the table.
        <figure>
          <img
            src="images/team-shot-add-or-invite.png"
            alt="The Add or invite drawer, to the project Spring Campaign. The option Add someone who already has an account is chosen, the email field holds maya.stern@example.com, the role is Publisher with a hint saying what a Publisher can and cannot do, and Access ends (optional) is empty. The buttons are Cancel and Add to project."
            width="1280"
            height="800"
          />
          <figcaption>Adding an existing user as a Publisher, a real screenshot with an example email. The hint under Role changes with the role chosen.</figcaption>
        </figure>
      </li>

      <li>
        <h3 class="step-title" id="step-change-a-role">Change a role.</h3> In the <em>Members</em> table, pick another role in the person's
        <em>Role</em> list. It saves at once, and takes effect on their next request: they do not need to sign in again.
        TaleArt will not leave a project without an Admin: see <a href="#last-admin">the last admin</a>.
      </li>

      <li>
        <h3 class="step-title" id="step-set-an-end-date">Set an end date.</h3> In the person's <em>Access</em> cell choose <em>Change</em>, pick a date, and
        it saves. <em>Permanent</em> removes the limit. After the end date the person can no longer open the project, and the
        row is marked <em>Expired</em>. Their membership stays in the list, so you can give a new date to restore access.
        The same <em>Access ends</em> field is on the add and invite forms.
      </li>

      <li>
        <h3 class="step-title" id="step-revoke-an-invitation">Revoke an invitation.</h3> Invitations that were created and not yet used are in
        <em>Pending invitations</em>, with the role, the access end date, who invited, and when the link expires. Choose
        <em>Revoke</em> and the link stops working at once. A person who opened it before then, and finished joining, is
        already a member: remove them from <em>Members</em> instead.
        <figure>
          <img
            src="images/team-shot-pending-invitations.png"
            alt="The Pending invitations table of the Team page with two rows: a Viewer with access until 31 Dec 2026 and an Editor with permanent access, both invited by Dana Levi on 31 Oct 2026, link expiring 7 Nov 2026, each with a Revoke button. The roles table starts below."
            width="1280"
            height="800"
          />
          <figcaption>Pending invitations, a real screenshot. Revoke ends a link before its seven days are up.</figcaption>
        </figure>
      </li>

      <li>
        <h3 class="step-title" id="step-remove-a-member">Remove a member.</h3> Choose <em>Remove</em> on the person's row and confirm. They lose
        access to the project at once; their account stays, and so do their roles in other projects.
      </li>

      <li>
        <h3 class="step-title" id="step-read-the-activity">Read the activity.</h3> At the bottom of the page, <em>Activity</em> lists the
        newest changes first, in words: <em>Dana Levi changed Sam Cohen from Editor to Publisher</em>. It records
        invitations created and revoked, people who joined, people added, role changes, end-date changes and removals,
        with the time of each. Only admins see it.
        <figure>
          <img
            src="images/team-shot-activity.png"
            alt="The Activity list at the bottom of the Team page, newest first: Dana Levi created an invitation link for a Viewer and for an Editor, changed Alex Rivera and Sam Cohen between roles, and added Noa Katz as Editor, Kim Park as Viewer, Alex Rivera as Publisher and Sam Cohen as Editor, each with its date and time."
            width="1280"
            height="800"
          />
          <figcaption>The activity log, a real screenshot. Each line says who did what to whom, and when.</figcaption>
        </figure>
      </li>
    </ol>

    <h2 id="time-limited-access">Time-limited access</h2>
    <p>
      Any membership or invitation can have an end date. Until that day the role works as usual. After it, the person has
      no access to the project, but stays in the list as <em>Expired</em> so an admin can extend it or remove them. The date must be in
      the future when it is set, and counts in UTC. An invitation's end date applies to the membership once the person joins,
      not to the link, which always lasts 7 days.
    </p>

    <h2 id="adding-or-inviting">Add or invite: which one</h2>
    <table>
      <thead>
        <tr><th></th><th>Add someone who already has an account</th><th>Create an invitation link</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">For</th><td>A person who has signed in to this install before</td><td>A new person with no account yet</td></tr>
        <tr><th scope="row">You give</th><td>Their email, a role, an optional end date</td><td>A role and an optional end date; you send the link</td></tr>
        <tr><th scope="row">Takes effect</th><td>At once</td><td>When the person opens the link and signs up</td></tr>
        <tr><th scope="row">Link</th><td>None</td><td>One use, 7 days, shown once; revoke it from Pending invitations</td></tr>
        <tr><th scope="row">If it is wrong</th><td><code>user_not_found</code> (no such account), <code>member_exists</code> (already a member)</td><td>Revoke it and create another</td></tr>
      </tbody>
    </table>

    <h2 id="last-admin">The last admin is protected</h2>
    <p>
      A project always keeps at least one <em>active</em> Admin. Lowering the role of the last one, or removing them, is refused with <code>last_project_admin</code>: make another person an Admin first. An install admin
      is not held to this, since they are an Admin in every project anyway.
    </p>

    <h2 id="api-tokens-and-the-api">API tokens and the API</h2>
    <ul>
      <li>
        An <a routerLink="/api-tokens">API token</a> acts with <strong>your role</strong> in each project, as it is at the time
        of each request, narrowed to the projects the token was given. A token never has more power than its owner: if you are
        a Viewer in a project, your token reads it and changes nothing there, even when it is read-write.
      </li>
      <li>
        Zone keys and the site key can be revealed, issued and rotated only with the Admin role, so a token or the command-line
        tool needs an Admin owner for those.
      </li>
      <li>
        The member, invitation and activity operations marked <em>Dashboard only</em> in the
        <a routerLink="/api-reference">API reference</a> need a signed-in dashboard session. An API token cannot add people,
        change roles or create invitations: it is refused with 403 <code>forbidden</code>. Listing members needs only the
        right to see the project.
      </li>
    </ul>

    <h2 id="refused-actions">What a refused action looks like</h2>
    <p>
      The dashboard turns off or hides what your role cannot do, and says why, for example
      <em>Needs the Publisher role or higher.</em> If a request gets through anyway, from an API token or an old page, the
      API answers 403 with this body, and changes nothing:
    </p>
    <pre tabindex="0" role="region" aria-label="A refused request"><code>{{ forbiddenSample }}</code></pre>
    <p>Someone who is not a member of the project at all is refused the same way, and an expired membership counts as no membership.</p>

    <h3 id="error-codes">Error codes</h3>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Team error codes">
      <table>
        <thead>
          <tr><th>Status</th><th>Code</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td>403</td><td><code>forbidden</code></td><td>Your role in the project does not allow this, or an API token called a dashboard-only operation.</td></tr>
          <tr><td>404</td><td><code>user_not_found</code></td><td>No account has that email. Invite the person instead.</td></tr>
          <tr><td>409</td><td><code>member_exists</code></td><td>The person is already a member, expired or not. Change their role instead.</td></tr>
          <tr><td>404</td><td><code>member_not_found</code></td><td>That person is not a member of the project.</td></tr>
          <tr><td>404</td><td><code>invitation_not_found</code></td><td>The invitation is unknown, already used, expired or already revoked.</td></tr>
          <tr><td>409</td><td><code>last_project_admin</code></td><td>The change would leave the project without an active Admin.</td></tr>
        </tbody>
      </table>
    </div>

    <h2 id="coming-from-before-roles">If you used TaleArt before roles</h2>
    <p>
      Everyone who was a member of a project before roles existed became a <strong>Publisher</strong> there, which is the
      closest to what they could do. Nothing changed for them on the day. Install admins are still Admins everywhere. Review
      the team under Settings &gt; Team and lower or raise roles as needed: Editor for people who should not publish, Admin for those
      who manage keys and people.
    </p>

    <h2 id="recommended-setups">Recommended setups</h2>
    <table>
      <thead>
        <tr><th>Person</th><th>Role</th><th>Why</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Agency contractor, for a campaign</th><td>Editor, with an end date</td><td>They build tales and save drafts, nothing goes live without a publisher, and access ends by itself when the contract does.</td></tr>
        <tr><th scope="row">Marketing lead</th><td>Publisher</td><td>They decide what visitors see and when, and manage zones, without handling keys or the team.</td></tr>
        <tr><th scope="row">Analyst or stakeholder</th><td>Viewer</td><td>They read tales and analytics and cannot change anything.</td></tr>
        <tr><th scope="row">Owner of the site or brand</th><td>Admin (at least two people)</td><td>They manage keys and the team; a second admin means the project is never left without one.</td></tr>
      </tbody>
    </table>
  `,
})
export class RolesAndPermissionsPage {
  protected readonly forbiddenSample = `HTTP/1.1 403 Forbidden

{
  "error": {
    "code": "forbidden",
    "message": "Your role in this project does not allow this"
  }
}`;
}
