import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthStore } from '../auth';

/**
 * The tabs of Settings: API tokens, the project's Team, the signed-in user's own sign-in methods, and (admins only) the
 * sign-in methods and users of the install.
 */
@Component({
  selector: 'app-settings-tabs',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .settings-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .settings-tabs a {
      padding: var(--space-1) var(--space-3);
      border-radius: var(--radius-control);
      color: var(--text-secondary);
      text-decoration: none;
    }
    .settings-tabs a[aria-current='page'] {
      background: var(--surface-sunken);
      color: var(--ink);
      font-weight: 600;
    }
  `,
  template: `
    <nav class="settings-tabs" aria-label="Settings">
      <a routerLink="/settings/api-tokens" routerLinkActive="active" ariaCurrentWhenActive="page">API tokens</a>
      <a routerLink="/settings/my-sign-in-methods" routerLinkActive="active" ariaCurrentWhenActive="page">
        My sign-in methods
      </a>
      <a routerLink="/settings/team" routerLinkActive="active" ariaCurrentWhenActive="page">Team</a>
      @if (auth.isAdmin()) {
        <a routerLink="/settings/sign-in-methods" routerLinkActive="active" ariaCurrentWhenActive="page"
          >Sign-in methods</a
        >
        <a routerLink="/settings/users" routerLinkActive="active" ariaCurrentWhenActive="page">Users</a>
      }
    </nav>
  `,
})
export class SettingsTabs {
  protected readonly auth = inject(AuthStore);
}
