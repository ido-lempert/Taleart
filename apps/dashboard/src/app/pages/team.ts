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
import { TeamApi } from '../team.service';
import { SettingsTabs } from './settings-tabs';

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
  imports: [Drawer, Icon, SettingsTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .team-section {
      max-width: 1000px;
      margin-bottom: var(--space-4);
    }
    .team-scroll {
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
    .team-table td {
      overflow-wrap: anywhere;
    }
    .team-table .select,
    .team-table .input {
      min-height: 32px;
      font-size: var(--text-sm);
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
                      <td>{{ member.email }}</td>
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
                      <td>{{ joined(member) }}</td>
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
              <div class="team-scroll">
                <table class="team-table" aria-labelledby="team-invitations-title">
                  <caption class="visually-hidden">
                    Invitation links that have not been used yet
                  </caption>
                  <thead>
                    <tr>
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
                          <span class="role-badge" [attr.data-role]="invitation.role">{{
                            roleLabels[invitation.role]
                          }}</span>
                        </td>
                        <td>
                          {{ invitation.accessExpiresAt ? 'Until ' + date(invitation.accessExpiresAt) : 'Permanent' }}
                        </td>
                        <td>{{ invitation.createdBy?.name ?? 'Former member' }}, {{ date(invitation.createdAt) }}</td>
                        <td>{{ date(invitation.expiresAt) }}</td>
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
}
