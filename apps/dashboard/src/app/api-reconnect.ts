import { DestroyRef, DOCUMENT, effect, inject, Injectable, InjectionToken, PLATFORM_ID, signal, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from './auth';
import { DashboardStore } from './dashboard.store';

/** How the shell retries while the API cannot be reached (ms). */
export interface ApiRetryTiming {
  /** The wait before each try: doubling from 2 s, then the last one again and again. */
  delaysMs: readonly number[];
  /** A try that has not answered by then counts as failed, so a hung request cannot stall the retries. */
  tryTimeoutMs: number;
  /** How long "Connected to TaleArt again." stays in the live region. */
  announceMs: number;
}

/** The wait used when no delays are given. */
export const FALLBACK_RETRY_MS = 30_000;

export const API_RETRY_TIMING = new InjectionToken<ApiRetryTiming>('API_RETRY_TIMING', {
  providedIn: 'root',
  factory: () => ({ delaysMs: [2_000, 4_000, 8_000, 16_000, 30_000], tryTimeoutMs: 15_000, announceMs: 5_000 }),
});

/** The wait before try number `attempt` (0 first): the last delay once they run out, 30 s when there are none. */
export function apiRetryDelay(attempt: number, delays: readonly number[]): number {
  if (delays.length === 0) return FALLBACK_RETRY_MS;
  return delays[Math.min(Math.max(attempt, 0), delays.length - 1)];
}

/**
 * Brings the dashboard back when the API answers again (report §6 #17). While the API-down banner
 * shows, it tries again with a growing wait: the auth state when it was never read (a signed-in
 * user's data then loads; without one, sign-in or setup opens), else the store's data. Tries never
 * overlap, except that the browser coming back online starts a fresh one; none runs while the tab
 * is hidden or the browser is offline, and the tab becoming visible tries at once. After a try that
 * reached the API, `reconnected` is true for a few seconds, until the user signs out or navigates.
 * Only in the browser.
 */
@Injectable({ providedIn: 'root' })
export class ApiReconnect {
  private readonly store = inject(DashboardStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly timing = inject(API_RETRY_TIMING);

  /** True for a moment after the API answered again; the shell announces it politely. */
  readonly reconnected = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  /** Bumped by each try, so only the newest one schedules the next or announces. */
  private tries = 0;
  private running = false;
  private destroyed = false;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    effect(() => {
      const down = this.store.apiDown();
      untracked(() => (down ? this.onDown() : this.stop()));
    });
    effect(() => {
      if (!this.auth.user()) untracked(() => this.clearAnnouncement());
    });
    const navigation = this.router.events
      .pipe(filter((event) => event instanceof NavigationStart))
      .subscribe(() => this.clearAnnouncement());
    const view = this.document.defaultView;
    const online = () => this.onOnline();
    const visibility = () => this.onVisibility();
    view?.addEventListener('online', online);
    this.document.addEventListener('visibilitychange', visibility);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.tries++;
      navigation.unsubscribe();
      view?.removeEventListener('online', online);
      this.document.removeEventListener('visibilitychange', visibility);
      this.stop();
      this.clearAnnouncement();
    });
  }

  private onDown(): void {
    this.clearAnnouncement();
    if (this.timer === null && !this.running) this.schedule();
  }

  /** Coming back online starts a fresh try, even when one is waiting on a request that hung. */
  private onOnline(): void {
    if (!this.store.apiDown()) return;
    this.stop();
    void this.tryNow();
  }

  private onVisibility(): void {
    if (this.document.hidden || !this.store.apiDown() || this.running) return;
    this.stop();
    void this.tryNow();
  }

  /** True while a try would only fail or go unseen: the tab is hidden, or the browser is offline. */
  private paused(): boolean {
    return this.document.hidden || this.document.defaultView?.navigator.onLine === false;
  }

  private schedule(): void {
    if (this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // Resumed by the tab becoming visible or the browser coming online.
      if (!this.paused()) void this.tryNow();
    }, apiRetryDelay(this.attempt++, this.timing.delaysMs));
  }

  private stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.attempt = 0;
  }

  private async tryNow(): Promise<void> {
    if (this.destroyed || !this.store.apiDown()) return;
    const id = ++this.tries;
    this.running = true;
    let answered = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      answered = await Promise.race([
        this.reach(),
        new Promise<boolean>((resolve) => (timeout = setTimeout(() => resolve(false), this.timing.tryTimeoutMs))),
      ]);
    } catch {
      answered = false;
    } finally {
      clearTimeout(timeout);
    }
    if (id !== this.tries) return;
    this.running = false;
    if (this.store.apiDown()) {
      if (this.timer === null) this.schedule();
    } else if (answered) {
      this.announce();
    }
  }

  /** One try; true when the API answered and the dashboard has what it needs again. */
  private async reach(): Promise<boolean> {
    if (this.auth.state() === null) {
      const state = await this.auth.ensure();
      if (!state) return false;
      if (state.user) {
        await this.store.loadFor(state.user);
        return !this.store.apiDown();
      }
      this.store.apiDown.set(false);
      const returnUrl = this.router.url;
      await this.router.navigate([state.setupRequired ? '/setup' : '/sign-in'], { queryParams: { returnUrl } });
      return true;
    }
    if (!this.auth.user()) return false;
    await this.store.refresh();
    // A 401 signs the user out and clears the banner: the API answered, but nothing came back.
    return !this.store.apiDown() && this.auth.user() !== null;
  }

  private announce(): void {
    this.clearAnnouncement();
    this.reconnected.set(true);
    this.announceTimer = setTimeout(() => this.reconnected.set(false), this.timing.announceMs);
  }

  private clearAnnouncement(): void {
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.reconnected.set(false);
  }
}
