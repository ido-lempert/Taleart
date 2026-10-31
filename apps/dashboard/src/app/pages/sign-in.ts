import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { ProviderButtons } from '../sign-in-controls';
import { authErrorMessage } from '../sign-in-methods';
import { Mark } from '../icon';
import { LegalLinks } from '../legal-links';

/**
 * The sign-in page: the sign-in methods an admin has turned on (`/auth/state.methods`). A passkey
 * button when passkeys are on, a username and password form when passwords are on, and one button
 * per external provider. Failures read as generic text; a provider callback's `auth_error` reads as a
 * friendly message. Until the state is known (or when the API is unreachable) passkey is offered.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, Mark, ProviderButtons, LegalLinks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="sign-in-heading">
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        <h1 class="auth-card__title" id="sign-in-heading">Sign in</h1>
        @if (authError(); as message) {
          <p class="form-error" id="sign-in-auth-error" role="alert">{{ message }}</p>
        }
        @if (methods().length === 0 && known()) {
          <p class="form-error" role="alert">No sign-in method is turned on. Ask an admin of TaleArt to turn one on.</p>
        }

        @if (hasPasskey()) {
          <div class="auth-card__form">
            @if (supported) {
              <p class="auth-card__help">Your passkey is stored on this device or in your password manager.</p>
              @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
              }
              <button type="button" class="btn btn--primary auth-card__submit" [disabled]="busy()" (click)="signIn()">
                {{ busy() ? 'Waiting for your passkey…' : 'Sign in with a passkey' }}
              </button>
            } @else {
              <p class="form-error" role="alert">
                This browser does not support passkeys. Open TaleArt in a current version of Chrome, Safari, Edge or
                Firefox.
              </p>
            }
          </div>
        }

        @if (hasPassword()) {
          <form
            class="auth-card__form"
            aria-labelledby="sign-in-password-title"
            (ngSubmit)="signInWithPassword()"
            novalidate
          >
            <h2 class="auth-card__subtitle" id="sign-in-password-title">With a username and password</h2>
            <div class="field">
              <label class="field__label" for="sign-in-username">Username</label>
              <input
                id="sign-in-username"
                class="input"
                name="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                [(ngModel)]="username"
                [attr.aria-invalid]="passwordError() ? 'true' : null"
                [attr.aria-describedby]="passwordError() ? 'sign-in-password-error' : null"
              />
            </div>
            <div class="field">
              <label class="field__label" for="sign-in-password">Password</label>
              <input
                id="sign-in-password"
                class="input"
                type="password"
                name="password"
                autocomplete="current-password"
                [(ngModel)]="password"
                [attr.aria-invalid]="passwordError() ? 'true' : null"
                [attr.aria-describedby]="passwordError() ? 'sign-in-password-error' : null"
              />
            </div>
            @if (passwordError(); as message) {
              <p class="form-error" id="sign-in-password-error" role="alert">{{ message }}</p>
            }
            <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
              {{ busy() ? 'Signing in…' : 'Sign in with a password' }}
            </button>
          </form>
        }

        <div class="auth-card__form">
          <app-provider-buttons [methods]="methods()" purpose="sign-in" />
        </div>
        <app-legal-links />
      </section>
    </main>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly supported = inject(PasskeyClient).supported();
  /** Whether the state was read; until then the page offers passkey, the method every install starts with. */
  protected readonly known = computed(() => this.auth.state() !== null);
  protected readonly methods = computed(() => this.auth.state()?.methods ?? []);
  protected readonly hasPasskey = computed(() => !this.known() || this.methods().some((m) => m.id === 'passkey'));
  protected readonly hasPassword = computed(() => this.methods().some((m) => m.id === 'password'));
  /** A provider callback's failure, as the friendly message for its code. */
  protected readonly authError = signal(authErrorMessage(this.route.snapshot.queryParamMap.get('auth_error')));

  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly passwordError = signal('');
  protected username = '';
  protected password = '';

  protected async signIn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const message = await this.auth.signIn();
    this.busy.set(false);
    if (message) {
      this.error.set(message);
      return;
    }
    await this.router.navigateByUrl(this.returnUrl());
  }

  protected async signInWithPassword(): Promise<void> {
    if (this.busy()) return;
    if (!this.username.trim() || !this.password) {
      this.passwordError.set('Enter your username and password.');
      return;
    }
    this.busy.set(true);
    this.passwordError.set('');
    const refusal = await this.auth.signInWithPassword(this.username, this.password);
    this.busy.set(false);
    if (refusal) {
      this.password = '';
      this.passwordError.set(refusal.message);
      return;
    }
    await this.router.navigateByUrl(this.returnUrl());
  }

  private returnUrl(): string {
    return safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  }
}
