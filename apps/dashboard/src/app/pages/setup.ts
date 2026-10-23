import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { isErrorBody } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Mark } from '../icon';

/** The first project's name until the admin types another (epic UX rework: first run in 15 actions). */
export const FIRST_PROJECT_NAME = 'My project';

/** The most characters setup takes for the first project's name. */
export const MAX_FIRST_PROJECT_NAME = 100;

/**
 * Shown on an empty install: registers the first admin's passkey, then creates their first project
 * (named "My project" unless they type another name), so the first run goes straight to a zone.
 */
@Component({
  selector: 'app-setup-page',
  imports: [FormsModule, RouterLink, Mark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="setup-heading">
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        <h1 class="auth-card__title" id="setup-heading">Set up TaleArt</h1>
        <p class="auth-card__help">
          You become the admin. Your passkey is stored on this device or in your password manager.
        </p>
        @if (supported) {
          <form class="auth-card__form" (ngSubmit)="submit()" novalidate>
            <div class="field">
              <label class="field__label" for="setup-name">Name</label>
              <input
                id="setup-name"
                class="input"
                name="name"
                autocomplete="name"
                [(ngModel)]="name"
                [attr.aria-invalid]="error() ? 'true' : null"
                [attr.aria-describedby]="error() ? 'setup-error' : null"
              />
            </div>
            <div class="field">
              <label class="field__label" for="setup-email">Email</label>
              <input
                id="setup-email"
                class="input"
                name="email"
                type="email"
                autocomplete="email"
                [(ngModel)]="email"
                [attr.aria-invalid]="error() ? 'true' : null"
                [attr.aria-describedby]="error() ? 'setup-error' : null"
              />
            </div>
            <div class="field">
              <label class="field__label" for="setup-project">First project</label>
              <input
                id="setup-project"
                class="input"
                name="project"
                autocomplete="off"
                [attr.maxlength]="maxProject"
                aria-describedby="setup-project-hint"
                [(ngModel)]="project"
              />
              <p class="field__hint" id="setup-project-hint">
                A project holds your zones, tale groups and tales. Up to {{ maxProject }} characters.
              </p>
            </div>
            @if (error()) {
              <p class="form-error" id="setup-error" role="alert">{{ error() }}</p>
            }
            @if (closed()) {
              <a class="btn btn--secondary" routerLink="/sign-in">Go to sign-in</a>
            }
            <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
              {{ busy() ? 'Waiting for your passkey…' : 'Create passkey' }}
            </button>
          </form>
        } @else {
          <p class="form-error" role="alert">
            This browser does not support passkeys. Open TaleArt in a current version of Chrome, Safari, Edge or Firefox.
          </p>
        }
      </section>
    </main>
  `,
})
export class SetupPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly store = inject(DashboardStore);
  protected readonly maxProject = MAX_FIRST_PROJECT_NAME;

  protected readonly supported = inject(PasskeyClient).supported();
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  /** True when someone else finished setup first. */
  protected readonly closed = signal(false);
  protected name = '';
  protected email = '';
  protected project = FIRST_PROJECT_NAME;

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name || !email) {
      this.error.set('Enter your name and email.');
      return;
    }
    const project = [...(this.project.trim() || FIRST_PROJECT_NAME)];
    if (project.length > MAX_FIRST_PROJECT_NAME) {
      this.error.set(`The project name is longer than ${MAX_FIRST_PROJECT_NAME} characters. Shorten it.`);
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const message = await this.auth.setUp(name, email);
    if (message) {
      this.busy.set(false);
      this.error.set(message);
      this.closed.set(this.auth.state()?.setupRequired === false);
      return;
    }
    // The admin is signed in. A refused project leaves the zones page's "Create your first project".
    try {
      await firstValueFrom(this.http.post(`${API_BASE}/projects`, { name: project.join('') }));
      // The sign-in's data load may have read the projects before this one existed; read them again
      // before the zones page opens, or it shows "Create your first project" with the project made.
      await this.store.refresh();
    } catch (err) {
      // Nothing to undo: the passkey and the account are made. The zones page says why.
      this.store.firstProjectRefusal.set(
        err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : 'Try again with New project.',
      );
    }
    this.busy.set(false);
    await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }
}
