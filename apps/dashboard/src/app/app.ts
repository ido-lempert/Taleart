import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import type { User } from '@taleart/contract/core';
import { AuthStore } from './auth';
import { CreateDrawer } from './create-drawer';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Icon, Mark } from './icon';
import type { BareData, ShellData } from './app.routes';

export { API_BASE, API_ORIGIN } from './dashboard.store';

/**
 * How long the shell waits before each try to reach the API again while the banner shows (ms):
 * doubling from 2 s, then every 30 s. Tests shorten it.
 */
export const API_RETRY = { delaysMs: [2_000, 4_000, 8_000, 16_000, 30_000] };

/** The wait before retry number `attempt` (0 first), the last delay once they run out. */
export function apiRetryDelay(attempt: number, delays: readonly number[] = API_RETRY.delaysMs): number {
  return delays[Math.min(attempt, delays.length - 1)];
}

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
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** True once the API answered again after the banner showed; a polite announcement says so. */
  protected readonly reconnected = signal(false);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private retrying = false;
  private destroyed = false;
  /** The signed-in user whose data was loaded, so a user is loaded once. */
  private loadedFor: User | null = null;

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
        return this.store.projects().length > 0 ? { kind: 'zone' } : null;
      case 'taleGroup': {
        const zoneId = this.route()?.paramMap.get('zoneId') ?? '';
        return this.store.zone(zoneId) ? { kind: 'taleGroup', zoneId } : null;
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
      untracked(() => {
        if (user && user !== this.loadedFor) void this.loadFor(user);
        else if (!user) this.loadedFor = null;
      });
    });

    // While the API cannot be reached, try again with a growing wait; an answer clears the banner.
    if (this.isBrowser) {
      let wasDown = false;
      effect(() => {
        const down = this.store.apiDown();
        untracked(() => {
          if (down) {
            wasDown = true;
            this.reconnected.set(false);
            if (this.retryTimer === null && !this.retrying) this.scheduleRetry();
          } else {
            this.stopRetrying();
            if (wasDown) this.reconnected.set(true);
            wasDown = false;
          }
        });
      });
      // The browser coming back online tries at once, unless a try is under way.
      const online = () => {
        if (!this.store.apiDown() || this.retrying) return;
        this.stopRetrying();
        void this.retry();
      };
      this.document.defaultView?.addEventListener('online', online);
      inject(DestroyRef).onDestroy(() => {
        this.destroyed = true;
        this.document.defaultView?.removeEventListener('online', online);
        this.stopRetrying();
      });
    }
  }

  /** Loads the data for a user once; the effect above and a retry that read the auth state share it. */
  private loadFor(user: User): Promise<void> {
    this.loadedFor = user;
    return this.store.refresh();
  }

  private scheduleRetry(): void {
    if (this.destroyed) return;
    const delay = apiRetryDelay(this.retryAttempt++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retry();
    }, delay);
  }

  private stopRetrying(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  /**
   * One try, and the next one's wait when the API still cannot be reached; tries never overlap.
   * The auth state when it was never read (a signed-in user then loads the data through the
   * effect above; without one, sign-in or setup opens), else the store's data.
   */
  private async retry(): Promise<void> {
    if (!this.store.apiDown()) return;
    this.retrying = true;
    try {
      if (this.auth.state() === null) {
        const state = await this.auth.ensure();
        if (state?.user && state.user !== this.loadedFor) await this.loadFor(state.user);
        else if (state && !state.user) {
          this.store.apiDown.set(false);
          const returnUrl = this.router.url;
          await this.router.navigate([state.setupRequired ? '/setup' : '/sign-in'], { queryParams: { returnUrl } });
        }
      } else if (this.auth.user()) {
        await this.store.refresh();
      }
    } finally {
      this.retrying = false;
    }
    if (this.store.apiDown() && this.retryTimer === null) this.scheduleRetry();
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
