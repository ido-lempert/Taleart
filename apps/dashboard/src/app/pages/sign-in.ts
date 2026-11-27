import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import type { TwoFactorEnrolment, User } from '@taleart/contract/core';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { ProviderButtons } from '../sign-in-controls';
import { authErrorMessage } from '../sign-in-methods';
import { Mark } from '../icon';
import { LegalLinks } from '../legal-links';
import { TotpQr } from './totp-qr';

/** The screens of the sign-in: the password, the code of an app already set up, the app's set-up, the recovery codes. */
type SignInStep = 'password' | 'code' | 'enrol' | 'recovery';

/**
 * The sign-in page: the sign-in methods an admin has turned on (`/auth/state.methods`). A passkey
 * button when passkeys are on, a username and password form when passwords are on, and one button
 * per external provider. Failures read as generic text; a provider callback's `auth_error` reads as a
 * friendly message. Until the state is known (or when the API is unreachable) passkey is offered.
 *
 * After the password, a user with an authenticator app gets the code screen. While the install requires
 * two-factor sign-in and the user has no app yet, the enrolment screen sets one up, then the recovery codes
 * are shown, and only then does the sign-in complete. A provider sign-in that waits for the app comes back here
 * with `?second-step=1` (the code screen) or `?enrol=1` (the set-up screen). Passkey sign-in has no second step:
 * a passkey is itself a strong second factor.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [FormsModule, Mark, ProviderButtons, LegalLinks, TotpQr],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .enrol-secret {
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
      user-select: all;
    }
    .enrol-codes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      list-style: none;
      user-select: all;
    }
  `,
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
        } @else if (step() === 'enrol') {
          <form
            class="auth-card__form"
            aria-labelledby="sign-in-enrol-title"
            (ngSubmit)="turnOnAndSignIn()"
            novalidate
          >
            <h2 class="auth-card__subtitle" id="sign-in-enrol-title">Set up your authenticator app</h2>
            <p class="auth-card__help">Your administrator requires an authenticator app.</p>
            @if (enrolment(); as setup) {
              <p class="auth-card__help">Add TaleArt to your authenticator app by scanning this QR code, then enter the code it shows.</p>
              <app-totp-qr [uri]="setup.otpauthUri" />
              <p class="auth-card__help">Cannot scan? Type this key instead.</p>
              <div class="field">
                <span class="field__label">Secret key</span>
                <p class="enrol-secret" id="sign-in-enrol-secret">{{ grouped(setup.secret) }}</p>
              </div>
              <div class="field">
                <button type="button" class="btn btn--secondary auth-card__submit" id="sign-in-enrol-copy" (click)="copyKey(setup.secret)">
                  Copy key
                </button>
                <p class="muted" role="status">{{ copyStatus() }}</p>
              </div>
              <div class="field">
                <span class="field__label">Address</span>
                <p class="enrol-secret" id="sign-in-enrol-uri">{{ setup.otpauthUri }}</p>
              </div>
              <div class="field">
                <label class="field__label" for="sign-in-enrol-code">Code from your app</label>
                <input
                  id="sign-in-enrol-code"
                  class="input input--mono"
                  name="enrolCode"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  [(ngModel)]="enrolCode"
                  [attr.aria-invalid]="enrolError() ? 'true' : null"
                  [attr.aria-describedby]="enrolError() ? 'sign-in-enrol-error' : null"
                />
              </div>
            }
            @if (enrolError(); as message) {
              <p class="form-error" id="sign-in-enrol-error" role="alert">{{ message }}</p>
            }
            <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy() || !enrolment()">
              {{ busy() ? 'Turning on…' : 'Turn on and sign in' }}
            </button>
            <button type="button" class="btn btn--secondary auth-card__submit" id="sign-in-enrol-back" [disabled]="busy()" (click)="leaveEnrolment()">
              Back
            </button>
          </form>
        } @else if (step() === 'recovery') {
          <section class="auth-card__form" aria-labelledby="sign-in-recovery-title">
            <h2 class="auth-card__subtitle" id="sign-in-recovery-title">Save your recovery codes</h2>
            <p class="auth-card__help">
              Save these codes now. Each works once if you lose your phone. They are not shown again.
            </p>
            <ul class="enrol-codes" id="sign-in-recovery-list">
              @for (recoveryCode of recoveryCodes(); track recoveryCode) {
                <li>{{ recoveryCode }}</li>
              }
            </ul>
            <button type="button" class="btn btn--secondary auth-card__submit" id="sign-in-recovery-copy" (click)="copyCodes()">
              Copy all
            </button>
            <button type="button" class="btn btn--secondary auth-card__submit" id="sign-in-recovery-download" (click)="downloadCodes()">
              Download
            </button>
            <p class="muted" role="status">{{ copyStatus() }}</p>
            <button type="button" class="btn btn--primary auth-card__submit" id="sign-in-recovery-continue" (click)="continueSignIn()">
              I saved them, continue
            </button>
          </section>
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
  /** The screen in place of the password form: the code of an app already set up, or the app's set-up, or the codes. */
  protected readonly step = signal<SignInStep>('password');
  protected readonly codeError = signal('');
  /** Whether the code field takes one of the recovery codes instead of the app's six digits. */
  protected readonly recovery = signal(false);
  /** The app's secret and address while the set-up waits for a code from the app. */
  protected readonly enrolment = signal<TwoFactorEnrolment | null>(null);
  protected readonly enrolError = signal('');
  /** The recovery codes the set-up made, shown until the user says they saved them. */
  protected readonly recoveryCodes = signal<string[]>([]);
  protected readonly copyStatus = signal('');
  protected username = '';
  protected password = '';
  protected code = '';
  protected enrolCode = '';
  /** The user the set-up signed in, applied to the store only after the recovery codes were shown. */
  private signedInUser: User | null = null;

  constructor() {
    // A provider sign-in of a user with an authenticator app lands here with a marker (the API's redirect): the code
    // screen for `second-step`, the app's set-up for `enrol`. The challenge cookie is already set.
    const query = this.route.snapshot.queryParamMap;
    if (query.get('second-step') === '1') {
      this.step.set('code');
    } else if (query.get('enrol') === '1') {
      this.step.set('enrol');
      void this.startEnrolment();
    }
  }

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
    if (attempt === 'enrolment') {
      this.password = '';
      this.enrolCode = '';
      this.enrolError.set('');
      this.step.set('enrol');
      await this.startEnrolment();
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

  /** The secret in groups of four, which is easier to type. */
  protected grouped(secret: string): string {
    return secret.replace(/(.{4})(?=.)/g, '$1 ');
  }

  protected async copyKey(secret: string): Promise<void> {
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(secret);
      this.copyStatus.set('Key copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the key and copy it.');
    }
  }

  /** Back to the password form from the set-up or the codes; the set-up is started again at the next sign-in. */
  protected leaveEnrolment(passwordMessage = ''): void {
    this.enrolment.set(null);
    this.enrolCode = '';
    this.enrolError.set('');
    this.copyStatus.set('');
    this.recoveryCodes.set([]);
    this.signedInUser = null;
    this.step.set('password');
    this.passwordError.set(passwordMessage);
  }

  /** Turns the app on with the code from it: the recovery codes are shown next, the sign-in is not complete yet. */
  protected async turnOnAndSignIn(): Promise<void> {
    if (this.busy() || !this.enrolment()) return;
    const code = this.enrolCode.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      this.enrolError.set('Enter the 6-digit code from your app.');
      return;
    }
    this.busy.set(true);
    this.enrolError.set('');
    const result = await this.auth.confirmEnrolment(code);
    this.busy.set(false);
    if ('recoveryCodes' in result) {
      this.signedInUser = result.user;
      this.recoveryCodes.set(result.recoveryCodes);
      this.enrolment.set(null);
      this.enrolCode = '';
      this.step.set('recovery');
      return;
    }
    if (result.invalid) {
      this.leaveEnrolment(result.message);
      return;
    }
    this.enrolCode = '';
    this.enrolError.set(result.message);
  }

  /** Copies all recovery codes, one to a line. */
  protected async copyCodes(): Promise<void> {
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(this.recoveryCodes().join('\n'));
      this.copyStatus.set('Recovery codes copied.');
    } catch {
      this.copyStatus.set('Could not copy. Select the codes and copy them.');
    }
  }

  /** Saves the codes as a plain text file, one code to a line. */
  protected downloadCodes(): void {
    const url = URL.createObjectURL(new Blob([`${this.recoveryCodes().join('\n')}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'taleart-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** The user saw and saved the codes: the sign-in completes and the page goes on to the return URL. */
  protected async continueSignIn(): Promise<void> {
    const user = this.signedInUser;
    if (!user) return;
    this.auth.completeSignIn(user);
    await this.router.navigateByUrl(this.returnUrl());
  }

  /** Starts the app's set-up when the enrolment screen opens: the secret and address to add it with. */
  private async startEnrolment(): Promise<void> {
    this.busy.set(true);
    const result = await this.auth.startEnrolment();
    this.busy.set(false);
    if ('secret' in result) {
      this.enrolment.set(result);
      return;
    }
    if (result.invalid) {
      this.leaveEnrolment(result.message);
      return;
    }
    this.enrolError.set(result.message);
  }

  private returnUrl(): string {
    return safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  }
}
