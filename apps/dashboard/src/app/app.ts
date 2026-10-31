import { ChangeDetectionStrategy, Component, computed, DOCUMENT, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiReconnect } from './api-reconnect';
import { AuthStore } from './auth';
import { CreateDrawer } from './create-drawer';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Icon, Mark } from './icon';
import { ROLE_LABELS } from './project-roles';
import type { BareData, ShellData } from './app.routes';

export { API_BASE, API_ORIGIN } from './dashboard.store';

function deepest(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return snapshot.firstChild ? deepest(snapshot.firstChild) : snapshot;
}

/**
 * The app shell: navigation rail, top bar with the project switcher and the
 * signed-in user, the routed page and the create drawer. Setup and sign-in show
 * without the shell.
 */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Mark, CreateDrawer],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(DashboardStore);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  /** Retries while the API-down banner shows, and says when the API answers again. */
  protected readonly reconnect = inject(ApiReconnect);

  private readonly route = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => deepest(this.router.routerState.snapshot.root)),
    ),
    { initialValue: null },
  );

  /** True once a shell page is shown; setup, sign-in and the first navigation show only the page. */
  protected readonly showShell = computed(() => {
    const route = this.route();
    return route !== null && !(route.data as Partial<BareData>).bare;
  });

  protected readonly shell = computed(() => (this.route()?.data as Partial<ShellData> | undefined) ?? {});

  /** What the top bar's "New …" button opens on this page, or null when it can't be used here. */
  protected readonly createRequest = computed<DrawerRequest | null>(() => {
    switch (this.shell().create) {
      case 'project':
        // Only admins create projects.
        return this.auth.isAdmin() ? { kind: 'project' } : null;
      case 'zone':
        return this.store.projects().length > 0 && this.store.can('zones.manage') ? { kind: 'zone' } : null;
      case 'taleGroup': {
        const zoneId = this.route()?.paramMap.get('zoneId') ?? '';
        return this.store.zone(zoneId) && this.store.can('content.edit', this.store.zone(zoneId)?.projectId)
          ? { kind: 'taleGroup', zoneId }
          : null;
      }
      default:
        return null;
    }
  });

  constructor() {
    // A drawer belongs to the page that opened it; leaving the page closes it.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.store.closeDrawer());

    // Data loads once someone is signed in; signing out clears it (AuthStore resets the store).
    effect(() => {
      const user = this.auth.user();
      if (user) untracked(() => void this.store.loadFor(user));
    });
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/sign-in']);
  }

  // Handled in code: with <base href="/">, "#main" would resolve to "/#main" and leave the page.
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.document.getElementById('main')?.focus();
  }

  protected onProjectChange(event: Event): void {
    this.store.selectProject((event.target as HTMLSelectElement).value);
  }
}
