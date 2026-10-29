import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import type { AdminUser } from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { PasswordResetLinkDrawer } from '../password-reset-link';
import { providerNameOf } from '../sign-in-methods';
import { SignInMethodsApi } from '../sign-in-methods.service';
import { SettingsTabs } from './settings-tabs';

const ROLE_LABELS: Record<AdminUser['role'], string> = { admin: 'Admin', content_manager: 'Content manager' };

/**
 * Settings > Users (admins only): everyone who can sign in to the install, how they sign in (passkey,
 * password, linked providers) and how many projects they are in. Admins reach every project, so their
 * row says "All projects". Each row can issue a one-time password reset link, which needs the password
 * method to be on.
 */
@Component({
  selector: 'app-users-page',
  imports: [SettingsTabs, PasswordResetLinkDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .users-section {
      max-width: 960px;
    }
    .users-scroll {
      max-width: 100%;
      overflow-x: auto;
    }
    .users-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--text-sm);
    }
    .users-table th,
    .users-table td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--border);
      text-align: start;
      vertical-align: top;
    }
    .users-table th {
      font-weight: 600;
    }
    .users-table td {
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">Users</h2>
        <p class="page-header__meta">
          Who can sign in to this install, how they sign in, and the projects they are in.
        </p>
      </header>

      @if (!auth.isAdmin()) {
        <p class="muted">Only admins can see the users of this install.</p>
      } @else if (loadFailed()) {
        <div class="invite-actions" role="alert">
          <p class="form-error">The users could not be read.</p>
          <button type="button" class="btn btn--secondary btn--sm" (click)="load()">Retry</button>
        </div>
      } @else if (loaded()) {
        <section class="card section users-section" aria-labelledby="users-list-title">
          <h3 class="section__title" id="users-list-title" tabindex="-1">Everyone</h3>
          @if (!passwordOn()) {
            <p class="muted" id="users-password-off">
              Username and password is off. Turn it on under Sign-in methods to issue reset links.
            </p>
          }
          @if (users().length === 0) {
            <p class="muted" id="users-empty">No users yet.</p>
          } @else {
            <div class="users-scroll">
              <table class="users-table" aria-labelledby="users-list-title">
                <caption class="visually-hidden">
                  Users of this install, with their sign-in methods and projects
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Sign-in methods</th>
                    <th scope="col">Projects</th>
                    <th scope="col"><span class="visually-hidden">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  @for (user of users(); track user.id) {
                    <tr>
                      <th scope="row">{{ user.name }}</th>
                      <td>{{ user.email }}</td>
                      <td>{{ roleLabel(user) }}</td>
                      <td>{{ methodsText(user) }}</td>
                      <td>{{ user.role === 'admin' ? 'All projects' : user.projects }}</td>
                      <td>
                        <button
                          type="button"
                          class="btn btn--secondary btn--sm"
                          [disabled]="!passwordOn()"
                          [attr.aria-label]="'Issue reset link for ' + user.name"
                          [attr.aria-describedby]="passwordOn() ? null : 'users-password-off'"
                          (click)="openReset(user, $event)"
                        >
                          Issue reset link
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (truncated()) {
            <p class="muted" role="status">Only the first 500 users are listed. There are more users than that.</p>
          }
          <p class="visually-hidden" role="status">{{ announcement() }}</p>
        </section>
      } @else {
        <p class="muted" role="status">Reading the users…</p>
      }
    </div>

    @if (resetFor(); as user) {
      <app-password-reset-link
        [userId]="user.id"
        [userName]="user.name"
        [focusBack]="focusBack"
        (closed)="closeReset()"
      />
    }
  `,
})
export class UsersPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(SignInMethodsApi);

  protected readonly users = signal<AdminUser[]>([]);
  protected readonly truncated = signal(false);
  protected readonly passwordOn = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadFailed = signal(false);
  /** The user whose reset link drawer is open. */
  protected readonly resetFor = signal<AdminUser | null>(null);
  protected readonly announcement = signal('');
  private returnFocus: HTMLElement | null = null;
  /** Where the drawer puts focus back: the row's button when it is still there, else the list's heading. */
  protected readonly focusBack = () => this.returnFocus ?? document.getElementById('users-list-title');

  ngOnInit(): void {
    if (this.auth.isAdmin()) void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const [list, settings] = await Promise.all([this.api.users(), this.api.settings()]);
      this.users.set(list.users);
      this.truncated.set(list.truncated);
      this.passwordOn.set(settings.passwordEnabled);
      this.loaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected roleLabel(user: AdminUser): string {
    return ROLE_LABELS[user.role];
  }

  /** The methods a user holds, in words: "Passkey, Password, Google", or "None". */
  protected methodsText(user: AdminUser): string {
    const methods = this.auth.state()?.methods ?? [];
    const names = [
      ...(user.methods.passkey ? ['Passkey'] : []),
      ...(user.methods.password ? ['Password'] : []),
      ...user.methods.identities.map((id) => providerNameOf(id, methods)),
    ];
    return names.length > 0 ? names.join(', ') : 'None';
  }

  protected openReset(user: AdminUser, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.resetFor.set(user);
  }

  protected closeReset(): void {
    const user = this.resetFor();
    this.resetFor.set(null);
    if (user) this.announcement.set(`Reset link for ${user.name} closed.`);
  }
}
