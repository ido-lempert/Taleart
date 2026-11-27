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

        @if (step() === 'password') {
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
        } @else {
          <form
            class="auth-card__form"
            aria-labelledby="sign-in-code-title"
            (ngSubmit)="signInWithCode()"
            novalidate
          >
            <h2 class="auth-card__subtitle" id="sign-in-code-title">Two-step sign-in</h2>
            @if (recovery()) {
              <p class="auth-card__help">Enter one of the recovery codes you saved. Each works once.</p>
            } @else {
              <p class="auth-card__help">Open your authenticator app and enter the code it shows for TaleArt.</p>
            }
            <div class="field">
              <label class="field__label" for="sign-in-code">{{ recovery() ? 'Recovery code' : 'Authenticator code' }}</label>
              <input
                id="sign-in-code"
                class="input input--mono"
                name="code"
                [attr.inputmode]="recovery() ? 'text' : 'numeric'"
                autocomplete="one-time-code"
                autocapitalize="none"
                spellcheck="false"
                [(ngModel)]="code"
                [attr.aria-invalid]="codeError() ? 'true' : null"
                [attr.aria-describedby]="codeError() ? 'sign-in-code-error' : null"
              />
            </div>
            @if (codeError(); as message) {
              <p class="form-error" id="sign-in-code-error" role="alert">{{ message }}</p>
            }
            <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
              {{ busy() ? 'Verifying…' : 'Verify' }}
            </button>
            <button type="button" class="btn btn--secondary auth-card__submit" [disabled]="busy()" (click)="back()">
              Back
            </button>
            <button
              type="button"
              class="btn btn--secondary auth-card__submit"
              [disabled]="busy()"
              (click)="toggleRecovery()"
            >
              {{ recovery() ? 'Use the app code' : 'Use a recovery code' }}
            </button>
          </form>
        }

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
  /** The password form, or the screen for the authenticator app's code once the password was right. */
  protected readonly step = signal<'password' | 'code'>('password');
  protected readonly codeError = signal('');
  /** Whether the code field takes one of the recovery codes instead of the app's six digits. */
  protected readonly recovery = signal(false);
  protected username = '';
  protected password = '';
  protected code = '';

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
    const attempt = await this.auth.signInWithPassword(this.username, this.password);
    this.busy.set(false);
    if (attempt === 'second-step') {
      this.password = '';
      this.code = '';
      this.codeError.set('');
      this.recovery.set(false);
      this.step.set('code');
      return;
    }
    if (attempt) {
      this.password = '';
      this.passwordError.set(attempt.message);
      return;
    }
    await this.router.navigateByUrl(this.returnUrl());
  }

  protected async signInWithCode(): Promise<void> {
    if (this.busy()) return;
    // A recovery code is not six digits: it is whatever the user typed, and the API checks it.
    const code = this.recovery() ? this.code.trim() : this.code.replace(/\s/g, '');
    if (this.recovery() ? !code : !/^\d{6}$/.test(code)) {
      this.codeError.set(this.recovery() ? 'Enter a recovery code.' : 'Enter the 6-digit code from your app.');
      return;
    }
    this.busy.set(true);
    this.codeError.set('');
    const refusal = await this.auth.signInWithSecondStep(code);
    this.busy.set(false);
    if (refusal?.invalid) {
      // The challenge ended: the password is needed again.
      this.code = '';
      this.password = '';
      this.step.set('password');
      this.passwordError.set(refusal.message);
      return;
    }
    if (refusal) {
      this.code = '';
      this.codeError.set(refusal.message);
      return;
    }
    await this.router.navigateByUrl(this.returnUrl());
  }

  /** Back to the password form, with the username kept and the password asked again. */
  protected back(): void {
    this.code = '';
    this.codeError.set('');
    this.recovery.set(false);
    this.step.set('password');
  }

  /** Switches the code field between the app's code and a recovery code. */
  protected toggleRecovery(): void {
    this.code = '';
    this.codeError.set('');
    this.recovery.update((on) => !on);
  }

  private returnUrl(): string {
    return safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  }
}
