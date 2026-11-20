import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiReconnect } from './api-reconnect';
import { AuthStore } from './auth';
import { CreateDrawer } from './create-drawer';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { NewTaleGroupFlow } from './new-tale-group';
import { Icon, Mark } from './icon';
import { ROLE_LABELS } from './project-roles';
import type { BareData, ShellData } from './app.routes';

export { API_BASE, API_ORIGIN } from './dashboard.store';

/** The top bar's "New …" button's action: a drawer, or a new tale group through Tale Studio. */
type CreateAction = DrawerRequest | { kind: 'newTaleGroup'; projectId: string; zoneId: string };

function deepest(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return snapshot.firstChild ? deepest(snapshot.firstChild) : snapshot;
}

/**
 * The app shell: navigation rail, top bar with the project switcher and the
 * signed-in user, the routed page and the create drawer. Setup and sign-in show
 * without the shell.
 */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet, Icon, Mark, CreateDrawer],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(DashboardStore);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly auth = inject(AuthStore);
  private readonly newTaleGroup = inject(NewTaleGroupFlow);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  /** Retries while the API-down banner shows, and says when the API answers again. */
  protected readonly reconnect = inject(ApiReconnect);

  /** A phone-width screen (below 640 px, where the rail moves to the bottom): the top bar keeps only logo, project and user. */
  protected readonly phone = signal(false);
  /** Whether a phone's user panel (name and Sign out) is open. */
  protected readonly userPanelOpen = signal(false);

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

  /** What the top bar's "New …" button does on this page, or null when it can't be used here. */
  protected readonly createRequest = computed<CreateAction | null>(() => {
    switch (this.shell().create) {
      case 'project':
        // Only admins create projects.
        return this.auth.isAdmin() ? { kind: 'project' } : null;
      case 'zone':
        return this.store.projects().length > 0 && this.store.can('zones.manage') ? { kind: 'zone' } : null;
      case 'taleGroup': {
        const zone = this.store.zone(this.route()?.paramMap.get('zoneId') ?? '');
        return zone && this.store.can('content.edit', zone.projectId)
          ? { kind: 'newTaleGroup', projectId: zone.projectId, zoneId: zone.id }
          : null;
      }
      default:
        return null;
    }
  });

  /** Runs what the top bar's button or a page's own "New …" control asks for. */
  protected runCreate(action: CreateAction, event: Event): void {
    if (action.kind === 'newTaleGroup') {
      void this.newTaleGroup.start(action.projectId, action.zoneId);
      return;
    }
    this.store.openDrawer(action, event);
  }

  constructor() {
    // Follows the phone breakpoint; without matchMedia (no window) the shell keeps the wide layout.
    const query = this.document.defaultView?.matchMedia?.('(max-width: 639.98px)');
    if (query) {
      this.phone.set(query.matches);
      const onChange = (event: MediaQueryListEvent) => this.phone.set(event.matches);
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    // A drawer belongs to the page that opened it; leaving the page closes it.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.store.closeDrawer();
        this.store.newGroupNotice.set('');
      });

    // A new tale group's options come once its Tale Studio is left and the page it led to is shown.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        const pending = this.store.pendingGroupOptions();
        if (!pending) return;
        this.store.pendingGroupOptions.set(null);
        this.store.openDrawer({
          kind: 'taleGroupOptions',
          taleGroupId: pending.taleGroupId,
          zoneId: pending.zoneId,
          projectId: pending.projectId || undefined,
        });
      });

    // Data loads once someone is signed in; signing out clears it (AuthStore resets the store).
    effect(() => {
      const user = this.auth.user();
      if (user) untracked(() => void this.store.loadFor(user));
    });
  }

  /** Initials for the phone's user chip, such as "AA" for "Ada Admin". */
  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('');
  }

  protected userPanelToggled(event: Event): void {
    this.userPanelOpen.set((event as ToggleEvent).newState === 'open');
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
