import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { isErrorBody } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Mark } from '../icon';
import { PasswordFields, ProviderButtons } from '../sign-in-controls';
import { authErrorMessage, checkPasswordForm, type PasswordFieldErrors } from '../sign-in-methods';

/** The first project's name until the admin types another (epic UX rework: first run in 15 actions). */
export const FIRST_PROJECT_NAME = 'My project';

/** The most characters setup takes for the first project's name. */
export const MAX_FIRST_PROJECT_NAME = 100;

/**
 * Shown on an empty install: the first admin registers, then the first project is created (named
 * "My project" unless they type another name), so the first run goes straight to a zone. The admin
 * chooses a method that is on: a passkey, a username and password (when the server allows it for
 * setup), or a provider. A provider's name and email come from the provider.
 */
@Component({
  selector: 'app-setup-page',
  imports: [FormsModule, RouterLink, Mark, PasswordFields, ProviderButtons],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="setup-heading">
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        <h1 class="auth-card__title" id="setup-heading">Set up TaleArt</h1>
        <p class="auth-card__help">You become the admin. Choose how you sign in.</p>

        <div class="auth-card__fields">
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
        </div>

        @if (error()) {
          <p class="form-error" id="setup-error" role="alert">{{ error() }}</p>
        }
        @if (authError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        @if (closed()) {
          <a class="btn btn--secondary" routerLink="/sign-in">Go to sign-in</a>
        }

        @if (!ready()) {
          <p class="muted" role="status">Reading the sign-in methods…</p>
        } @else if (unreachable()) {
          <p class="form-error" role="alert">
            Could not reach TaleArt to read the sign-in methods. Reload the page to try again.
          </p>
        }

        @if (ready() && !unreachable() && offersPasskey()) {
          @if (supported) {
            <form class="auth-card__form" (ngSubmit)="submitPasskey()" novalidate>
              <p class="field__hint">Your passkey is stored on this device or in your password manager.</p>
              @if (passkeyError()) {
                <p class="form-error" id="setup-passkey-error" role="alert">{{ passkeyError() }}</p>
              }
              <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
                {{ busy() ? 'Waiting for your passkey…' : 'Create passkey' }}
              </button>
            </form>
          } @else {
            <p class="form-error" role="alert">
              This browser does not support passkeys. Open TaleArt in a current version of Chrome, Safari, Edge or
              Firefox.
            </p>
          }
        }

        @if (ready() && !unreachable() && offersPassword()) {
          <form class="auth-card__form" aria-labelledby="setup-password-title" (ngSubmit)="submitPassword()" novalidate>
            <h2 class="auth-card__subtitle" id="setup-password-title">With a username and password</h2>
            <app-password-fields
              idPrefix="setup"
              [(username)]="pwUsername"
              [(password)]="pwPassword"
              [(confirm)]="pwConfirm"
              [errors]="pwErrors()"
            />
            @if (passwordError()) {
              <p class="form-error" role="alert">{{ passwordError() }}</p>
            }
            <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
              {{ busy() && passwordBusy() ? 'Creating your account…' : 'Create account with password' }}
            </button>
          </form>
        }

        @if (ready() && !unreachable() && providers().length > 0) {
          <div class="auth-card__form">
            <app-provider-buttons [methods]="providers()" purpose="setup" />
            <p class="field__hint">
              With a provider, your email comes from the provider, so the name and email above are not used.
            </p>
          </div>
        }
      </section>
    </main>
  `,
})
export class SetupPage implements OnInit {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly store = inject(DashboardStore);
  protected readonly maxProject = MAX_FIRST_PROJECT_NAME;

  protected readonly supported = inject(PasskeyClient).supported();
  /** The methods that are on; before the state is known, passkey, the method every install starts with. */
  private readonly methods = computed(() => this.auth.state()?.methods ?? null);
  protected readonly offersPasskey = computed(() => {
    const methods = this.methods();
    return methods === null || methods.some((m) => m.id === 'passkey');
  });
  protected readonly offersPassword = computed(() => this.methods()?.some((m) => m.id === 'password') ?? false);
  protected readonly providers = computed(() =>
    (this.methods() ?? []).filter((m) => m.kind !== 'passkey' && m.kind !== 'password'),
  );
  protected readonly authError = signal(authErrorMessage(this.route.snapshot.queryParamMap.get('auth_error')));
  /** False while the sign-in methods are read (a fresh page), true once they are known or failed to load. */
  protected readonly ready = signal(false);
  protected readonly unreachable = signal(false);

  protected readonly error = signal('');
  protected readonly passkeyError = signal('');
  protected readonly passwordError = signal('');
  protected readonly pwErrors = signal<PasswordFieldErrors>({});
  protected readonly busy = signal(false);
  protected readonly passwordBusy = signal(false);
  /** True when someone else finished setup first. */
  protected readonly closed = signal(false);
  protected name = '';
  protected email = '';
  protected project = FIRST_PROJECT_NAME;
  protected readonly pwUsername = signal('');
  protected readonly pwPassword = signal('');
  protected readonly pwConfirm = signal('');

  /** The name, email and project name as typed, or the message to show. */
  private details(): { name: string; email: string; project: string } | string {
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name || !email) return 'Enter your name and email.';
    const project = [...(this.project.trim() || FIRST_PROJECT_NAME)];
    if (project.length > MAX_FIRST_PROJECT_NAME) {
      return `The project name is longer than ${MAX_FIRST_PROJECT_NAME} characters. Shorten it.`;
    }
    return { name, email, project: project.join('') };
  }

  ngOnInit(): void {
    // Known already (the setup guard read it): show the choices at once; otherwise read them first.
    if (this.auth.state() !== null) this.ready.set(true);
    else void this.loadMethods();
  }

  private async loadMethods(): Promise<void> {
    const loaded = await this.auth.ensure();
    this.unreachable.set(loaded === null);
    this.ready.set(true);
  }

  protected async submitPasskey(): Promise<void> {
    if (this.busy()) return;
    const details = this.details();
    if (typeof details === 'string') {
      this.error.set(details);
      return;
    }
    this.busy.set(true);
    this.passkeyError.set('');
    const message = await this.auth.setUp(details.name, details.email);
    if (message) {
      this.busy.set(false);
      this.passkeyError.set(message);
      this.closed.set(this.auth.state()?.setupRequired === false);
      return;
    }
    await this.afterSignIn(details.project);
  }

  protected async submitPassword(): Promise<void> {
    if (this.busy()) return;
    const details = this.details();
    if (typeof details === 'string') {
      this.passwordError.set(details);
      return;
    }
    const found = checkPasswordForm(
      { username: this.pwUsername(), password: this.pwPassword(), confirm: this.pwConfirm() },
      { username: true, currentPassword: false, confirm: true },
    );
    this.pwErrors.set(found);
    this.passwordError.set('');
    if (Object.keys(found).length > 0) {
      document.getElementById(`setup-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    this.busy.set(true);
    this.passwordBusy.set(true);
    const refusal = await this.auth.setUpWithPassword(
      details.name,
      details.email,
      this.pwUsername(),
      this.pwPassword(),
    );
    this.busy.set(false);
    this.passwordBusy.set(false);
    if (refusal) {
      if (refusal.field) this.pwErrors.set({ [refusal.field]: refusal.message });
      else this.passwordError.set(refusal.message);
      this.closed.set(refusal.closed === true);
      return;
    }
    await this.afterSignIn(details.project);
  }

  // The admin is signed in: create the first project, then open the zones (or the return page).
  private async afterSignIn(project: string): Promise<void> {
    // A refused project leaves the zones page's "Create your first project".
    try {
      await firstValueFrom(this.http.post(`${API_BASE}/projects`, { name: project }));
      // The sign-in's data load may have read the projects before this one existed; read them again
      // before the zones page opens, or it shows "Create your first project" with the project made.
      await this.store.refresh();
    } catch (err) {
      // Nothing to undo: the account and its method are made. The zones page says why.
      this.store.firstProjectRefusal.set(
        err instanceof HttpErrorResponse && isErrorBody(err.error)
          ? err.error.error.message
          : 'Try again with New project.',
      );
    }
    this.busy.set(false);
    await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }
}
