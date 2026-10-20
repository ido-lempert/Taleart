import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { CreateDrawer } from './create-drawer';
import { DashboardStore, type DrawerRequest } from './dashboard.store';
import { Icon, Mark } from './icon';
import type { ShellData } from './app.routes';

export { API_BASE } from './dashboard.store';

function deepest(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return snapshot.firstChild ? deepest(snapshot.firstChild) : snapshot;
}

/** The app shell: navigation rail, top bar with the project switcher, the routed page and the create drawer. */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Mark, CreateDrawer],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  private readonly route = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => deepest(this.router.routerState.snapshot.root)),
    ),
    { initialValue: null },
  );

  protected readonly shell = computed(() => (this.route()?.data as Partial<ShellData> | undefined) ?? {});

  /** What the top bar's "New …" button opens on this page, or null when it can't be used here. */
  protected readonly createRequest = computed<DrawerRequest | null>(() => {
    switch (this.shell().create) {
      case 'project':
        return { kind: 'project' };
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
  }

  ngOnInit(): void {
    void this.store.refresh();
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
