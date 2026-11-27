import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import {
  isErrorBody,
  PROJECT_ROLES,
  type PendingInvitation,
  type ProjectAuditEntry,
  type ProjectMember,
  type ProjectRole,
} from '@taleart/contract/core';
import { BulkBar } from '../bulk-bar';
import { runLimited } from '../bulk-run';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { Icon } from '../icon';
import {
  accessText,
  describeAudit,
  describeRole,
  ROLE_LABELS,
  roleMatrixRows,
  shortDate,
  shortDateTime,
} from '../project-roles';
import { createSelection } from '../selection';
import { TeamApi } from '../team.service';
import { SettingsTabs } from './settings-tabs';

/** The bulk actions on the members: remove them, or give them one role, as the row's Remove and role select do. */
type MemberBulk = {
  kind: 'remove' | 'role';
  phase: 'confirm' | 'running';
  items: readonly ProjectMember[];
  done: number;
  /** The role picked for "Change role", or '' until one is picked. */
  role: ProjectRole | '';
};

/** The names a bulk action could not finish, kept selected until the next action. */
type BulkFailure = { id: string; name: string; message: string };

/** The explanation of a member who cannot be removed or lowered (the API refuses the last admin). */
const LAST_ADMIN_NOTE = 'The last admin of the project cannot be removed or lowered. Make another person an Admin first.';

// The API's own message when it sent the standard error body, else the fallback.
function refusal(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return `${fallback} Check the connection.`;
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

/**
 * Settings > Team: who is in the selected project and what each role can do. Everyone in the project
 * sees the members and the roles matrix; only an admin of the project (members.manage) gets the
 * controls: change a role or the end of access, remove a member, add or invite people, revoke
 * pending invitations and read the activity log. The API checks every call; the controls are hidden
 * for other roles so nobody meets a refusal.
 */
@Component({
  selector: 'app-team-page',
  imports: [Drawer, Icon, SettingsTabs, BulkBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .team-section {
      max-width: 1180px;
      margin-bottom: var(--space-4);
    }
    /* The row's first cell: its checkbox, narrow, at the top of the row. */
    .team-select {
      min-height: 0;
      padding: 0;
    }
    .team-bulk-roles {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .team-bulk-roles legend {
      margin-bottom: var(--space-2);
      padding: 0;
    }
    .bulk-names {
      margin: var(--space-2) 0 0;
      padding-inline-start: var(--space-5);
    }
    /* Positioned, so the visually hidden Actions heading does not widen the page on a phone. */
    .team-scroll {
      position: relative;
      max-width: 100%;
      overflow-x: auto;
    }
    .team-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .team-table th,
    .team-table td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--border);
      text-align: start;
      vertical-align: top;
    }
    .team-table th {
      font-weight: 600;
    }
    /* Words and addresses never break in the middle: a column takes its natural width and the scroll wrapper takes the rest. */
    .team-table td {
      overflow-wrap: normal;
      word-break: normal;
    }
    .team-table .select,
    .team-table .input {
      min-height: 32px;
      font-size: var(--text-sm);
    }
    .team-table .select {
      min-width: 9.5rem;
    }
    .team-table .team-email,
    .team-table .team-date,
    .team-table .access-text {
      white-space: nowrap;
    }
    .team-ends {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      margin-top: var(--space-1);
    }
    .team-error {
      margin: var(--space-1) 0 0;
    }
    .team-you {
      margin-inline-start: var(--space-1);
    }
    .team-matrix td,
    .team-matrix th[scope='col']:not(:first-child) {
      text-align: center;
    }
    .team-matrix th[scope='row'] {
      font-weight: 400;
    }
    .team-check {
      color: var(--success);
      font-weight: 700;
    }
    .team-none {
      color: var(--text-muted);
    }
    .team-role-descriptions {
      margin: var(--space-3) 0 0;
      padding: 0;
      list-style: none;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .team-activity {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .team-activity li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      justify-content: space-between;
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border);
    }
    .team-activity time {
      color: var(--text-secondary);
      font-size: var(--text-xs);
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">Team</h2>
        <p class="page-header__meta">
          Who works in <strong>{{ projectName() }}</strong> and what each role can do.
          @if (store.role(); as role) {
            You are <span class="role-badge" [attr.data-role]="role" id="team-your-role">{{ roleLabels[role] }}</span
            >.
          }
        </p>
      </header>

      @if (!store.selectedProject()) {
        <p class="muted">Pick a project to see its team.</p>
      } @else if (!store.can('project.view')) {
        <p class="muted">You cannot see the team of this project.</p>
      } @else {
        <section class="card section team-section" aria-labelledby="team-members-title">
          <div class="section__header">
            <h3 class="section__title" id="team-members-title" tabindex="-1">Members</h3>
            @if (canManage()) {
              <button type="button" class="btn btn--primary btn--sm" id="team-add" (click)="openAdd($event)">
                <app-icon name="plus" /> Add or invite
              </button>
            }
          </div>
          @if (!canManage()) {
            <p class="muted" id="team-readonly">
              You can see who is in this project. Ask an admin of the project to change roles or invite people.
            </p>
          }
          @if (membersFailed()) {
            <div class="invite-actions" role="alert">
              <p class="form-error">The members could not be read.</p>
              <button type="button" class="btn btn--secondary btn--sm" (click)="load()">Retry</button>
            </div>
          } @else if (!membersLoaded()) {
            <p class="muted" role="status">Reading the team…</p>
          } @else {
            <!-- Escape clears the selection while focus is in the list (its checkboxes, its rows, the bar). -->
            <div role="group" (keydown.escape)="memberSelection.clear()">
            @if (canManage()) {
              <app-bulk-bar [count]="memberSelection.count()" (cleared)="memberSelection.clear()">
                <button type="button" class="btn btn--secondary btn--sm" id="bulk-role" (click)="askMemberBulk('role')">
                  Change role…
                </button>
                <button type="button" class="btn btn--danger btn--sm" id="bulk-remove" (click)="askMemberBulk('remove')">
                  Remove
                </button>
              </app-bulk-bar>
              @if (memberBulkFailed().length > 0) {
                <div class="banner banner--inline" role="alert" id="bulk-members-failed">
                  <app-icon name="alert" />
                  <span>
                    {{ memberBulkFailed().length }} could not be {{ memberBulkFailedAction() }}: {{ memberBulkFailedNames() }}.
                    They stay selected.
                  </span>
                </div>
              }
            }
            <div class="team-scroll">
              <table class="team-table" aria-labelledby="team-members-title">
                <caption class="visually-hidden">
                  Members of
                  {{
                    projectName()
                  }}
                  with their role and access
                </caption>
                <thead>
                  <tr>
                    @if (canManage()) {
                      <th scope="col">
                        <label class="checkbox">
                          <input
                            type="checkbox"
                            aria-label="Select all members"
                            [checked]="memberSelection.allSelected()"
                            [indeterminate]="memberSelection.someSelected()"
                            (change)="memberSelection.toggleAll()"
                          />
                        </label>
                      </th>
                    }
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Access</th>
                    <th scope="col">Joined</th>
                    @if (canManage()) {
                      <th scope="col"><span class="visually-hidden">Actions</span></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (member of members(); track member.userId) {
                    <tr [attr.data-member]="member.userId">
                      @if (canManage()) {
                        <td>
                          <label class="checkbox team-select">
                            <input
                              type="checkbox"
                              [attr.aria-label]="'Select ' + member.name"
                              [checked]="memberSelection.isSelected(member.userId)"
                              [disabled]="isLocked(member)"
                              [attr.aria-describedby]="isLocked(member) ? 'team-locked-' + member.userId : null"
                              (change)="memberSelection.toggle(member.userId)"
                            />
                          </label>
                          @if (isLocked(member)) {
                            <span class="visually-hidden" [id]="'team-locked-' + member.userId">{{ lastAdminNote }}</span>
                          }
                        </td>
                      }
                      <th scope="row">
                        {{ member.name }}
                        @if (member.you) {
                          <span class="role-badge team-you">You</span>
                        }
                        @if (member.globalRole === 'admin') {
                          <span class="muted"> · Install admin</span>
                        }
                        @if (rowErrors()[member.userId]; as message) {
                          <p class="form-error team-error" role="alert">{{ message }}</p>
                        }
                      </th>
                      <td class="team-email">{{ member.email }}</td>
                      <td>
                        @if (canManage()) {
                          <label class="visually-hidden" [for]="'role-' + member.userId"
                            >Role of {{ member.name }}</label
                          >
                          <select
                            class="select"
                            [id]="'role-' + member.userId"
                            [disabled]="busyRows().has(member.userId)"
                            (change)="changeRole(member, $event)"
                          >
                            @for (role of roles; track role) {
                              <option [value]="role" [selected]="role === member.role">{{ roleLabels[role] }}</option>
                            }
                          </select>
                        } @else {
                          <span class="role-badge" [attr.data-role]="member.role">{{ roleLabels[member.role] }}</span>
                        }
                      </td>
                      <td>
                        @if (member.expired) {
                          <span class="role-badge role-badge--expired">Expired</span>
                        }
                        <span class="access-text">{{ access(member) }}</span>
                        @if (canManage()) {
                          @if (editingEnds() === member.userId) {
                            <div class="team-ends">
                              <label class="visually-hidden" [for]="'ends-' + member.userId"
                                >Access ends for {{ member.name }}</label
                              >
                              <input
                                type="date"
                                class="input"
                                [id]="'ends-' + member.userId"
                                [value]="member.expiresAt ? member.expiresAt.slice(0, 10) : ''"
                                [disabled]="busyRows().has(member.userId)"
                                (change)="changeEnds(member, $event)"
                                (keydown.escape)="stopEditingEnds(member)"
                              />
                              @if (member.expiresAt) {
                                <button
                                  type="button"
                                  class="btn btn--secondary btn--sm"
                                  [attr.aria-label]="'Make access of ' + member.name + ' permanent'"
                                  (click)="makePermanent(member)"
                                >
                                  Permanent
                                </button>
                              }
                              <button type="button" class="btn btn--ghost btn--sm" (click)="stopEditingEnds(member)">
                                Cancel
                              </button>
                            </div>
                          } @else {
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              [id]="'ends-button-' + member.userId"
                              [attr.aria-label]="'Change access of ' + member.name"
                              (click)="editEnds(member)"
                            >
                              Change
                            </button>
                          }
                        }
                      </td>
                      <td class="team-date">{{ joined(member) }}</td>
                      @if (canManage()) {
                        <td>
                          <button
                            type="button"
                            class="btn btn--secondary btn--sm"
                            [attr.aria-label]="'Remove ' + member.name"
                            (click)="askRemove(member, $event)"
                          >
                            Remove
                          </button>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            </div>
          }
          <p class="visually-hidden" role="status">{{ announcement() }}</p>
        </section>

        @if (canManage()) {
          <section class="card section team-section" aria-labelledby="team-invitations-title">
            <h3 class="section__title" id="team-invitations-title" tabindex="-1">Pending invitations</h3>
            @if (invitationsFailed()) {
              <p class="form-error" role="alert">The invitations could not be read.</p>
            } @else if (invitations().length === 0) {
              <p class="muted" id="team-no-invitations">
                No pending invitations. Invitation links work once and for 7 days.
              </p>
            } @else {
              <!-- Escape clears the selection while focus is in the list (its checkboxes, its rows, the bar). -->
              <div role="group" (keydown.escape)="inviteSelection.clear()">
              <app-bulk-bar [count]="inviteSelection.count()" (cleared)="inviteSelection.clear()">
                <button type="button" class="btn btn--danger btn--sm" id="bulk-revoke-invitations" (click)="askInviteBulk()">
                  Revoke
                </button>
              </app-bulk-bar>
              @if (inviteBulkFailed().length > 0) {
                <div class="banner banner--inline" role="alert" id="bulk-invitations-failed">
                  <app-icon name="alert" />
                  <span>
                    {{ inviteBulkFailed().length }} could not be revoked: {{ inviteBulkFailedNames() }}. They stay selected.
                  </span>
                </div>
              }
              <div class="team-scroll">
                <table class="team-table" aria-labelledby="team-invitations-title">
                  <caption class="visually-hidden">
                    Invitation links that have not been used yet
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <label class="checkbox">
                          <input
                            type="checkbox"
                            aria-label="Select all invitations"
                            [checked]="inviteSelection.allSelected()"
                            [indeterminate]="inviteSelection.someSelected()"
                            (change)="inviteSelection.toggleAll()"
                          />
                        </label>
                      </th>
                      <th scope="col">Role</th>
                      <th scope="col">Access</th>
                      <th scope="col">Invited by</th>
                      <th scope="col">Link expires</th>
                      <th scope="col"><span class="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (invitation of invitations(); track invitation.id) {
                      <tr [attr.data-invitation]="invitation.id">
                        <td>
                          <label class="checkbox team-select">
                            <input
                              type="checkbox"
                              [attr.aria-label]="'Select the ' + roleLabels[invitation.role] + ' invitation, ' + date(invitation.createdAt)"
                              [checked]="inviteSelection.isSelected(invitation.id)"
                              (change)="inviteSelection.toggle(invitation.id)"
                            />
                          </label>
                        </td>
                        <td>
                          <span class="role-badge" [attr.data-role]="invitation.role">{{
                            roleLabels[invitation.role]
                          }}</span>
                        </td>
                        <td class="team-date">
                          {{ invitation.accessExpiresAt ? 'Until ' + date(invitation.accessExpiresAt) : 'Permanent' }}
                        </td>
                        <td class="team-date">{{ invitation.createdBy?.name ?? 'Former member' }}, {{ date(invitation.createdAt) }}</td>
                        <td class="team-date">{{ date(invitation.expiresAt) }}</td>
                        <td>
                          <button
                            type="button"
                            class="btn btn--secondary btn--sm"
                            [disabled]="busyRows().has(invitation.id)"
                            [attr.aria-label]="
                              'Revoke the ' +
                              roleLabels[invitation.role] +
                              ' invitation from ' +
                              (invitation.createdBy?.name ?? 'a former member') +
                              ', ' +
                              date(invitation.createdAt)
                            "
                            (click)="revoke(invitation)"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              </div>
            }
            @if (invitationError()) {
              <p class="form-error" role="alert">{{ invitationError() }}</p>
            }
          </section>
        }

        <section class="card section team-section" aria-labelledby="team-roles-title">
          <h3 class="section__title" id="team-roles-title" tabindex="-1">What each role can do</h3>
          <div class="team-scroll">
            <table class="team-table team-matrix" aria-labelledby="team-roles-title">
              <caption class="visually-hidden">
                Roles and what each can do
              </caption>
              <thead>
                <tr>
                  <th scope="col">Can…</th>
                  @for (role of roles; track role) {
                    <th scope="col">{{ roleLabels[role] }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of matrix; track row.permission) {
                  <tr [attr.data-permission]="row.permission">
                    <th scope="row">{{ row.label }}</th>
                    @for (role of roles; track role) {
                      <td>
                        @if (row.roles[role]) {
                          <span class="team-check" aria-hidden="true">✓</span>
                          <span class="visually-hidden">{{ roleLabels[role] }} can</span>
                        } @else {
                          <span class="team-none" aria-hidden="true">–</span>
                          <span class="visually-hidden">{{ roleLabels[role] }} cannot</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <ul class="team-role-descriptions">
            @for (role of roles; track role) {
              <li>{{ describe(role) }}</li>
            }
          </ul>
        </section>

        @if (canManage()) {
          <section class="card section team-section" aria-labelledby="team-activity-title">
            <h3 class="section__title" id="team-activity-title" tabindex="-1">Activity</h3>
            @if (auditFailed()) {
              <div class="invite-actions" role="alert">
                <p class="form-error">The activity could not be read.</p>
                <button type="button" class="btn btn--secondary btn--sm" (click)="loadAudit(false)">Retry</button>
              </div>
            } @else if (audit().length === 0) {
              <p class="muted" id="team-no-activity">No activity yet.</p>
            } @else {
              <ul class="team-activity" aria-label="Team activity, newest first">
                @for (entry of audit(); track entry.id) {
                  <li>
                    <span>{{ sentence(entry) }}</span>
                    <time [attr.datetime]="entry.createdAt">{{ dateTime(entry.createdAt) }}</time>
                  </li>
                }
              </ul>
            }
            @if (auditNext()) {
              <button
                type="button"
                class="btn btn--secondary btn--sm"
                id="team-load-more"
                [disabled]="auditBusy()"
                (click)="loadAudit(true)"
              >
                Load more
              </button>
            }
          </section>
        }
      }
    </div>

    @if (removing(); as member) {
      <app-drawer
        heading="Remove from project"
        dialogRole="alertdialog"
        describedBy="team-remove-text"
        [returnFocus]="focusBack"
        [busy]="removeBusy()"
        (closed)="closeRemove()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); remove()" novalidate>
          <div class="drawer__body">
            <p id="team-remove-text">
              Remove <strong>{{ member.name }}</strong> ({{ member.email }}) from {{ projectName() }}? They lose access
              at once. Their account stays, and you can add them again.
            </p>
            @if (removeError()) {
              <p class="form-error" role="alert">{{ removeError() }}</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" [disabled]="removeBusy()" (click)="closeRemove()">
              Cancel
            </button>
            <button type="submit" class="btn btn--danger" id="team-remove-confirm" [disabled]="removeBusy()">
              Remove
            </button>
          </div>
        </form>
      </app-drawer>
    }

    @if (memberBulk(); as run) {
      <app-drawer
        [heading]="memberBulkHeading()"
        dialogRole="alertdialog"
        describedBy="team-bulk-text"
        initialFocus="#bulk-cancel"
        [returnFocus]="focusBack"
        [busy]="run.phase === 'running'"
        (closed)="closeMemberBulk()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); confirmMemberBulk()" novalidate>
          <div class="drawer__body">
            @if (run.kind === 'remove') {
              <p id="team-bulk-text">
                They lose access at once. Their accounts stay, and you can add them again.
              </p>
            } @else {
              <fieldset class="team-bulk-roles" aria-describedby="team-bulk-text">
                <legend class="field__label">Role</legend>
                @for (role of roles; track role) {
                  <label class="checkbox">
                    <input
                      type="radio"
                      name="team-bulk-role"
                      [value]="role"
                      [checked]="run.role === role"
                      (change)="setMemberBulkRole(role)"
                    />
                    {{ roleLabels[role] }}
                  </label>
                }
              </fieldset>
              <p class="field__hint" id="team-bulk-text">
                Each one gets this role at once. Their end-of-access dates stay as they are.
              </p>
            }
            <ul class="bulk-names">
              @for (member of run.items.slice(0, 5); track member.userId) {
                <li>{{ member.name }}</li>
              }
              @if (run.items.length > 5) {
                <li class="muted">+{{ run.items.length - 5 }} more</li>
              }
            </ul>
            @if (run.phase === 'running') {
              <p class="muted" role="status">
                {{ run.kind === 'remove' ? 'Removing' : 'Changing' }} {{ run.done }} of {{ run.items.length }}…
              </p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" id="bulk-cancel" [disabled]="run.phase === 'running'" (click)="closeMemberBulk()">
              Cancel
            </button>
            <button
              type="submit"
              [class]="run.kind === 'remove' ? 'btn btn--danger' : 'btn btn--primary'"
              id="bulk-submit"
              [disabled]="run.phase === 'running' || (run.kind === 'role' && !run.role)"
            >
              {{ run.phase === 'running' ? 'Working…' : memberBulkSubmitLabel() }}
            </button>
          </div>
        </form>
      </app-drawer>
    }

    @if (inviteBulk(); as run) {
      <app-drawer
        [heading]="inviteBulkHeading()"
        dialogRole="alertdialog"
        describedBy="team-invite-bulk-text"
        initialFocus="#bulk-cancel"
        [returnFocus]="focusBack"
        [busy]="run.phase === 'running'"
        (closed)="closeInviteBulk()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); confirmInviteBulk()" novalidate>
          <div class="drawer__body">
            <p id="team-invite-bulk-text">
              Their links stop working at once. You can send new invitations later.
            </p>
            <ul class="bulk-names">
              @for (invitation of run.items.slice(0, 5); track invitation.id) {
                <li>{{ inviteName(invitation) }}</li>
              }
              @if (run.items.length > 5) {
                <li class="muted">+{{ run.items.length - 5 }} more</li>
              }
            </ul>
            @if (run.phase === 'running') {
              <p class="muted" role="status">Revoking {{ run.done }} of {{ run.items.length }}…</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" id="bulk-cancel" [disabled]="run.phase === 'running'" (click)="closeInviteBulk()">
              Cancel
            </button>
            <button type="submit" class="btn btn--danger" id="bulk-submit" [disabled]="run.phase === 'running'">
              {{ run.phase === 'running' ? 'Revoking…' : inviteBulkSubmitLabel() }}
            </button>
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class TeamPage {
  protected readonly store = inject(DashboardStore);
  private readonly api = inject(TeamApi);
  private readonly injector = inject(Injector);

  protected readonly roles = PROJECT_ROLES;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly matrix = roleMatrixRows();

  protected readonly members = signal<ProjectMember[]>([]);
  protected readonly membersLoaded = signal(false);
  protected readonly membersFailed = signal(false);
  protected readonly invitations = signal<PendingInvitation[]>([]);
  protected readonly invitationsFailed = signal(false);
  protected readonly invitationError = signal('');
  protected readonly audit = signal<ProjectAuditEntry[]>([]);
  protected readonly auditNext = signal<string | null>(null);
  protected readonly auditFailed = signal(false);
  protected readonly auditBusy = signal(false);
  /** Per user id, the API's message when it refused a change (such as the last admin). */
  protected readonly rowErrors = signal<Record<string, string>>({});
  /** The ids of members and invitations whose change is being saved. */
  protected readonly busyRows = signal<ReadonlySet<string>>(new Set());
  protected readonly announcement = signal('');
  /** The id of the member whose end-of-access date is being edited. */
  protected readonly editingEnds = signal<string | null>(null);
  protected readonly removing = signal<ProjectMember | null>(null);
  protected readonly removeBusy = signal(false);
  protected readonly removeError = signal('');
  private returnFocus: HTMLElement | null = null;
  protected readonly focusBack = () => this.returnFocus ?? document.getElementById('team-members-title');

  protected readonly projectName = computed(() => this.store.selectedProject()?.name ?? '');
  protected readonly canManage = computed(() => this.store.can('members.manage'));

  /**
   * The last admin of the project, who the API refuses to remove or lower (`last_project_admin`): their
   * checkbox is disabled, with the reason, so a bulk action never sends them. An expired admin does not count.
   */
  private readonly lockedIds = computed(() => {
    const admins = this.members().filter((m) => m.role === 'admin' && !m.expired);
    return new Set(admins.length === 1 ? [admins[0].userId] : []);
  });
  protected readonly lastAdminNote = LAST_ADMIN_NOTE;
  protected isLocked(member: ProjectMember): boolean {
    return this.lockedIds().has(member.userId);
  }

  /**
   * The members picked for a bulk action (the reusable selection, `selection.ts`): every member the
   * row's Remove and role select allow, so the last admin is left out. Checkboxes and the bar show
   * only to a project admin (members.manage), as the row's controls do.
   */
  protected readonly memberSelection = createSelection(
    () => this.members().filter((m) => !this.isLocked(m)),
    (member: ProjectMember) => member.userId,
  );
  /** The invitations picked for a bulk revoke (the same rule as the single Revoke: any pending one). */
  protected readonly inviteSelection = createSelection(
    () => this.invitations(),
    (invitation: PendingInvitation) => invitation.id,
  );
  /** The bulk member action being confirmed, then run. */
  protected readonly memberBulk = signal<MemberBulk | null>(null);
  protected readonly memberBulkFailed = signal<readonly BulkFailure[]>([]);
  protected readonly memberBulkFailedAction = signal('removed');
  protected readonly memberBulkFailedNames = computed(() => this.memberBulkFailed().map((f) => f.name).join(', '));
  protected readonly memberBulkHeading = computed(() => {
    const run = this.memberBulk();
    const count = run?.items.length ?? 0;
    const people = `${count} ${count === 1 ? 'person' : 'people'}`;
    return run?.kind === 'role' ? `Change the role of ${people}?` : `Remove ${people} from the project?`;
  });
  protected readonly memberBulkSubmitLabel = computed(() => {
    const run = this.memberBulk();
    const count = run?.items.length ?? 0;
    const people = `${count} ${count === 1 ? 'person' : 'people'}`;
    return run?.kind === 'role' ? `Change role of ${people}` : `Remove ${people}`;
  });
  /** The bulk invitation revoke being confirmed, then run. */
  protected readonly inviteBulk = signal<{ phase: 'confirm' | 'running'; items: readonly PendingInvitation[]; done: number } | null>(null);
  protected readonly inviteBulkFailed = signal<readonly BulkFailure[]>([]);
  protected readonly inviteBulkFailedNames = computed(() => this.inviteBulkFailed().map((f) => f.name).join(', '));
  protected readonly inviteBulkHeading = computed(() => {
    const count = this.inviteBulk()?.items.length ?? 0;
    return `Revoke ${count} ${count === 1 ? 'invitation' : 'invitations'}?`;
  });
  protected readonly inviteBulkSubmitLabel = computed(() => {
    const count = this.inviteBulk()?.items.length ?? 0;
    return `Revoke ${count} ${count === 1 ? 'invitation' : 'invitations'}`;
  });
  /** How many single-item requests a bulk action keeps in flight. */
  private static readonly BULK_CONCURRENCY = 3;

  // A stale answer (the project changed meanwhile) is dropped.
  private generation = 0;

  constructor() {
    // Reads the team again when the project, the caller's role or the team (a drawer) changes.
    effect(() => {
      this.store.selectedProjectId();
      this.store.role();
      this.store.teamVersion();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    const projectId = this.store.selectedProjectId();
    const generation = ++this.generation;
    this.membersFailed.set(false);
    if (!projectId || !this.store.can('project.view')) return;
    try {
      const members = await this.api.members(projectId);
      if (generation !== this.generation) return;
      this.members.set(members);
      this.membersLoaded.set(true);
    } catch {
      if (generation === this.generation) this.membersFailed.set(true);
    }
    if (!this.store.can('members.manage')) return;
    this.invitationsFailed.set(false);
    try {
      const invitations = await this.api.invitations(projectId);
      if (generation === this.generation) this.invitations.set(invitations);
    } catch {
      if (generation === this.generation) this.invitationsFailed.set(true);
    }
    await this.loadAudit(false);
  }

  /** Reads the newest page of the activity, or the page after the last one when `more`. */
  protected async loadAudit(more: boolean): Promise<void> {
    const projectId = this.store.selectedProjectId();
    const generation = this.generation;
    this.auditFailed.set(false);
    this.auditBusy.set(true);
    try {
      const page = await this.api.auditLog(projectId, more ? (this.auditNext() ?? undefined) : undefined);
      if (generation !== this.generation) return;
      this.audit.update((list) => (more ? [...list, ...page.entries] : page.entries));
      this.auditNext.set(page.nextBefore);
    } catch {
      if (generation === this.generation) this.auditFailed.set(true);
    } finally {
      this.auditBusy.set(false);
    }
  }

  protected access(member: ProjectMember): string {
    return member.expired && member.expiresAt
      ? `Ended ${shortDate(member.expiresAt)}`
      : accessText(member.expiresAt, false);
  }

  protected joined(member: ProjectMember): string {
    return shortDate(member.joinedAt);
  }

  protected date(iso: string): string {
    return shortDate(iso);
  }

  protected dateTime(iso: string): string {
    return shortDateTime(iso);
  }

  protected describe(role: ProjectRole): string {
    return describeRole(role);
  }

  protected sentence(entry: ProjectAuditEntry): string {
    return describeAudit(entry, (id) => this.members().find((m) => m.userId === id)?.name);
  }

  protected openAdd(event: Event): void {
    this.store.openDrawer({ kind: 'invite', projectId: this.store.selectedProjectId(), mode: 'add' }, event);
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyRows.update((rows) => {
      const next = new Set(rows);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private setRowError(id: string, message: string): void {
    this.rowErrors.update((errors) => {
      const next = { ...errors };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  protected async changeRole(member: ProjectMember, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const role = select.value as ProjectRole;
    if (role === member.role) return;
    await this.update(member, { role }, select, `${member.name} is now ${ROLE_LABELS[role]}.`);
  }

  protected editEnds(member: ProjectMember): void {
    this.editingEnds.set(member.userId);
    afterNextRender(() => document.getElementById(`ends-${member.userId}`)?.focus(), { injector: this.injector });
  }

  protected stopEditingEnds(member: ProjectMember): void {
    this.editingEnds.set(null);
    afterNextRender(() => document.getElementById(`ends-button-${member.userId}`)?.focus(), {
      injector: this.injector,
    });
  }

  protected async makePermanent(member: ProjectMember): Promise<void> {
    const input = document.getElementById(`ends-${member.userId}`) as HTMLInputElement;
    await this.update(member, { expiresAt: null }, input, `${member.name} has permanent access.`);
    this.stopEditingEnds(member);
  }

  protected async changeEnds(member: ProjectMember, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const expiresAt = input.value ? `${input.value}T23:59:59.000Z` : null;
    await this.update(
      member,
      { expiresAt },
      input,
      expiresAt ? `Access of ${member.name} ends ${shortDate(expiresAt)}.` : `${member.name} has permanent access.`,
    );
    if (!this.rowErrors()[member.userId]) this.stopEditingEnds(member);
  }

  // Saves a change to one member; on a refusal puts the control back and shows the API's words by the name.
  private async update(
    member: ProjectMember,
    change: { role?: ProjectRole; expiresAt?: string | null },
    control: HTMLSelectElement | HTMLInputElement,
    done: string,
  ): Promise<void> {
    const projectId = this.store.selectedProjectId();
    this.setBusy(member.userId, true);
    this.setRowError(member.userId, '');
    try {
      const saved = await this.api.updateMember(projectId, member.userId, change);
      this.members.update((list) => list.map((m) => (m.userId === member.userId ? saved : m)));
      this.announcement.set(done);
      // The caller's own role changed: the project list (and what the pages show) follows it.
      if (member.you) void this.store.refresh();
      await this.loadAudit(false);
    } catch (err) {
      control.value = 'role' in change ? member.role : (member.expiresAt?.slice(0, 10) ?? '');
      this.setRowError(member.userId, refusal(err, 'The change was not saved. Try again.'));
    } finally {
      this.setBusy(member.userId, false);
    }
  }

  protected askRemove(member: ProjectMember, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.removeError.set('');
    this.removing.set(member);
  }

  protected closeRemove(): void {
    if (this.removeBusy()) return;
    this.removing.set(null);
  }

  protected async remove(): Promise<void> {
    const member = this.removing();
    if (!member || this.removeBusy()) return;
    this.removeBusy.set(true);
    this.removeError.set('');
    try {
      await this.api.removeMember(this.store.selectedProjectId(), member.userId);
    } catch (err) {
      // Already gone (404): it is removed either way.
      if (!(err instanceof HttpErrorResponse && err.status === 404)) {
        this.removeBusy.set(false);
        this.removeError.set(refusal(err, 'The person was not removed. Try again.'));
        return;
      }
    }
    this.removeBusy.set(false);
    this.members.update((list) => list.filter((m) => m.userId !== member.userId));
    this.returnFocus = document.getElementById('team-members-title');
    this.removing.set(null);
    this.announcement.set(`${member.name} removed from ${this.projectName()}.`);
    if (member.you) void this.store.refresh();
    await this.loadAudit(false);
  }

  protected async revoke(invitation: PendingInvitation): Promise<void> {
    this.setBusy(invitation.id, true);
    this.invitationError.set('');
    try {
      await this.api.revokeInvitation(this.store.selectedProjectId(), invitation.id);
      this.invitations.update((list) => list.filter((i) => i.id !== invitation.id));
      this.announcement.set(`${ROLE_LABELS[invitation.role]} invitation revoked.`);
      document.getElementById('team-invitations-title')?.focus();
      await this.loadAudit(false);
    } catch (err) {
      this.invitationError.set(refusal(err, 'The invitation was not revoked. Try again.'));
    } finally {
      this.setBusy(invitation.id, false);
    }
  }

  /** Opens the confirmation of a bulk Remove or Change role for the selected members. */
  protected askMemberBulk(kind: 'remove' | 'role'): void {
    if (!this.canManage() || this.memberSelection.count() === 0) return;
    this.returnFocus = document.getElementById(kind === 'role' ? 'bulk-role' : 'bulk-remove');
    this.memberBulkFailed.set([]);
    this.memberBulkFailedAction.set(kind === 'role' ? 'changed' : 'removed');
    this.memberBulk.set({ kind, phase: 'confirm', items: this.memberSelection.selectedItems(), done: 0, role: '' });
  }

  /** Picks the role a bulk "Change role" gives the selected members. */
  protected setMemberBulkRole(role: ProjectRole): void {
    this.memberBulk.update((run) => (run ? { ...run, role } : run));
  }

  /** Closes the bulk member confirmation; not while the actions run. */
  protected closeMemberBulk(): void {
    if (this.memberBulk()?.phase === 'running') return;
    this.memberBulk.set(null);
  }

  /**
   * Runs the confirmed bulk member action through the single-member endpoints, a few at a time. The
   * members removed leave the list; the ones that failed stay selected and are named.
   */
  protected async confirmMemberBulk(): Promise<void> {
    const run = this.memberBulk();
    if (!run || run.phase !== 'confirm' || !this.canManage()) return;
    if (run.kind === 'role' && !run.role) return;
    const projectId = this.store.selectedProjectId();
    const role = run.role;
    this.memberBulk.set({ ...run, phase: 'running', done: 0 });
    const outcome = await runLimited(
      run.items,
      TeamPage.BULK_CONCURRENCY,
      (member) => this.memberStep(run.kind, role, projectId, member),
      (done) => this.memberBulk.update((current) => (current ? { ...current, done } : current)),
    );
    const done = new Set(outcome.succeeded.map((m) => m.userId));
    if (run.kind === 'remove') this.members.update((list) => list.filter((m) => !done.has(m.userId)));
    const failed = outcome.failed.map(({ item, message }) => ({ id: item.userId, name: item.name, message }));
    this.memberSelection.replace(failed.map((f) => f.id));
    this.memberBulkFailed.set(failed);
    this.memberBulk.set(null);
    this.returnFocus = failed.length > 0
      ? document.getElementById(run.kind === 'role' ? 'bulk-role' : 'bulk-remove')
      : document.getElementById('team-members-title');
    const count = outcome.succeeded.length;
    const people = `${count} ${count === 1 ? 'person' : 'people'}`;
    const summary =
      run.kind === 'role' ? `${people} now ${ROLE_LABELS[role as ProjectRole]}.` : `${people} removed from ${this.projectName()}.`;
    this.announcement.set(
      failed.length === 0
        ? summary
        : `${summary} ${failed.length} could not be ${this.memberBulkFailedAction()}: ${this.memberBulkFailedNames()}.`,
    );
    if (outcome.succeeded.some((m) => m.you)) void this.store.refresh();
    await this.loadAudit(false);
  }

  /** One member's request for a bulk action: '' when it is done, else the message to show. */
  private async memberStep(kind: 'remove' | 'role', role: ProjectRole | '', projectId: string, member: ProjectMember): Promise<string> {
    if (kind === 'remove') {
      try {
        await this.api.removeMember(projectId, member.userId);
        return '';
      } catch (err) {
        // Already gone (404): it is removed either way.
        if (err instanceof HttpErrorResponse && err.status === 404) return '';
        return refusal(err, 'The person was not removed. Try again.');
      }
    }
    // A member who already has the role is left as it is, as the row's select leaves it.
    if (!role || member.role === role) return '';
    try {
      const saved = await this.api.updateMember(projectId, member.userId, { role });
      this.members.update((list) => list.map((m) => (m.userId === member.userId ? saved : m)));
      return '';
    } catch (err) {
      return refusal(err, 'The change was not saved. Try again.');
    }
  }

  /** Opens the confirmation of a bulk invitation revoke for the selected invitations. */
  protected askInviteBulk(): void {
    if (this.inviteSelection.count() === 0) return;
    this.returnFocus = document.getElementById('bulk-revoke-invitations');
    this.inviteBulkFailed.set([]);
    this.inviteBulk.set({ phase: 'confirm', items: this.inviteSelection.selectedItems(), done: 0 });
  }

  /** Closes the bulk invitation confirmation; not while the revokes run. */
  protected closeInviteBulk(): void {
    if (this.inviteBulk()?.phase === 'running') return;
    this.inviteBulk.set(null);
  }

  /** Revokes the confirmed invitations, a few at a time; the ones that failed stay selected and are named. */
  protected async confirmInviteBulk(): Promise<void> {
    const run = this.inviteBulk();
    if (!run || run.phase !== 'confirm' || !this.canManage()) return;
    const projectId = this.store.selectedProjectId();
    this.inviteBulk.set({ ...run, phase: 'running', done: 0 });
    const outcome = await runLimited(
      run.items,
      TeamPage.BULK_CONCURRENCY,
      (invitation) => this.revokeInvitationOne(projectId, invitation),
      (done) => this.inviteBulk.update((current) => (current ? { ...current, done } : current)),
    );
    const revoked = new Set(outcome.succeeded.map((i) => i.id));
    this.invitations.update((list) => list.filter((i) => !revoked.has(i.id)));
    const failed = outcome.failed.map(({ item, message }) => ({ id: item.id, name: this.inviteName(item), message }));
    this.inviteSelection.replace(failed.map((f) => f.id));
    this.inviteBulkFailed.set(failed);
    this.inviteBulk.set(null);
    this.returnFocus = failed.length > 0
      ? document.getElementById('bulk-revoke-invitations')
      : document.getElementById('team-invitations-title');
    const count = outcome.succeeded.length;
    const summary = `${count} ${count === 1 ? 'invitation' : 'invitations'} revoked.`;
    this.announcement.set(
      failed.length === 0 ? summary : `${summary} ${failed.length} could not be revoked: ${this.inviteBulkFailedNames()}.`,
    );
    await this.loadAudit(false);
  }

  /** An invitation as a bulk action names it: its role and the day it was sent. */
  protected inviteName(invitation: PendingInvitation): string {
    return `${ROLE_LABELS[invitation.role]}, ${this.date(invitation.createdAt)}`;
  }

  /** One invitation's revoke for a bulk action: '' when it is revoked, else the message to show. */
  private async revokeInvitationOne(projectId: string, invitation: PendingInvitation): Promise<string> {
    try {
      await this.api.revokeInvitation(projectId, invitation.id);
      return '';
    } catch (err) {
      return refusal(err, 'The invitation was not revoked. Try again.');
    }
  }
}
