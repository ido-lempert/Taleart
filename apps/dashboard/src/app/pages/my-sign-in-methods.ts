import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  ErrorCodes,
  type AccountIdentity,
  type AccountMethods,
  type AccountPasskey,
  type TwoFactorEnrolment,
  type TwoFactorStatus,
} from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { Drawer } from '../drawer';
import { PasswordFields, ProviderButtons } from '../sign-in-controls';
import {
  accountRefusal,
  authErrorMessage,
  checkPasswordForm,
  errorCode,
  errorText,
  type PasswordFieldErrors,
} from '../sign-in-methods';
import { SignInMethodsApi } from '../sign-in-methods.service';
import { SettingsTabs } from './settings-tabs';

/** What the confirm drawer is about to remove. */
type Removal =
  | { kind: 'passkey'; item: AccountPasskey }
  | { kind: 'password' }
  | { kind: 'identity'; item: AccountIdentity };

/**
 * The account's authenticator app, a second step after the password: "Not set up" with Set up, or "On".
 * Set up shows the secret key to type into the app and the otpauth address; a code from the app turns it
 * on. No QR code yet.
 */
@Component({
  selector: 'app-authenticator-app-section',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .two-factor-secret {
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
      user-select: all;
    }
    .two-factor-setup {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
  `,
  template: `
    <section class="card section" aria-labelledby="two-factor-title">
      <h3 class="section__title" id="two-factor-title" tabindex="-1">Authenticator app</h3>
      @if (loadFailed()) {
        <div class="invite-actions" role="alert">
          <p class="form-error">Your authenticator app could not be read.</p>
          <button type="button" class="btn btn--secondary btn--sm" (click)="load()">Retry</button>
        </div>
      } @else if (status(); as current) {
        @if (enrolment(); as setup) {
          <form id="two-factor-form" class="two-factor-setup" (ngSubmit)="confirm()" novalidate>
            <p class="muted">Add TaleArt to your authenticator app with this key, then enter the code the app shows.</p>
            <div class="field">
              <span class="field__label">Secret key</span>
              <p class="two-factor-secret" id="two-factor-secret">{{ grouped(setup.secret) }}</p>
            </div>
            <div class="invite-actions">
              <button type="button" class="btn btn--secondary" id="two-factor-copy" (click)="copy(setup.secret)">
                Copy key
              </button>
            </div>
            <p class="muted" role="status">{{ copyStatus() }}</p>
            <div class="field">
              <span class="field__label">Address</span>
              <p class="two-factor-secret" id="two-factor-uri">{{ setup.otpauthUri }}</p>
            </div>
            <div class="field">
              <label class="field__label" for="two-factor-code">Code from your app</label>
              <input
                id="two-factor-code"
                class="input input--mono"
                name="code"
                inputmode="numeric"
                autocomplete="one-time-code"
                [(ngModel)]="code"
              />
            </div>
            <div class="invite-actions">
              <button type="submit" class="btn btn--primary" id="two-factor-confirm" [disabled]="busy()">
                {{ busy() ? 'Turning on…' : 'Turn on' }}
              </button>
            </div>
          </form>
        } @else if (current.enrolled) {
          <p id="two-factor-state">On</p>
          <p class="muted">Signing in with your password also asks for a code from this app.</p>
        } @else {
          <p id="two-factor-state">Not set up</p>
          <div class="invite-actions">
            <button type="button" class="btn btn--secondary" id="two-factor-set-up" [disabled]="busy()" (click)="start()">
              Set up
            </button>
          </div>
        }
      } @else {
        <p class="muted" role="status">Reading your authenticator app…</p>
      }
      @if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      }
      <p class="visually-hidden" role="status">{{ announcement() }}</p>
    </section>
  `,
})
export class AuthenticatorAppSection implements OnInit {
  private readonly api = inject(SignInMethodsApi);

  protected readonly status = signal<TwoFactorStatus | null>(null);
  protected readonly loadFailed = signal(false);
  /** The set-up in progress: the secret and address, until a code turns the app on. */
  protected readonly enrolment = signal<TwoFactorEnrolment | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly copyStatus = signal('');
  protected readonly announcement = signal('');
  protected code = '';

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      this.status.set(await this.api.twoFactorStatus());
    } catch {
      this.loadFailed.set(true);
    }
  }

  /** The secret in groups of four, which is easier to type. */
  protected grouped(secret: string): string {
    return secret.replace(/(.{4})(?=.)/g, '$1 ');
  }

  protected async start(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.copyStatus.set('');
    try {
      this.enrolment.set(await this.api.startTwoFactor());
    } catch (err) {
      if (errorCode(err) === ErrorCodes.twoFactorEnrolled) {
        await this.load();
      } else if (errorCode(err) === ErrorCodes.secretKeyMissing) {
        this.error.set("Two-factor sign-in needs the server's secret key (TALEART_SECRET_KEY) to be set.");
      } else {
        this.error.set(errorText(err, 'The authenticator app could not be set up. Try again.'));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(secret: string): Promise<void> {
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(secret);
      this.copyStatus.set('Key copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the key and copy it.');
    }
  }

  protected async confirm(): Promise<void> {
    if (this.busy()) return;
    const code = this.code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      this.error.set('Enter the 6-digit code from your app.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.confirmTwoFactor({ code });
      this.enrolment.set(null);
      this.code = '';
      this.status.set({ enrolled: true });
      this.announcement.set('Authenticator app is on.');
    } catch (err) {
      switch (errorCode(err)) {
        case ErrorCodes.twoFactorCodeInvalid:
          this.error.set('That code is not right. Try the current code from your app.');
          break;
        case ErrorCodes.twoFactorNotStarted:
          this.enrolment.set(null);
          this.code = '';
          this.error.set('The set-up was not started. Set up the authenticator app again.');
          break;
        case ErrorCodes.twoFactorEnrolled:
          this.enrolment.set(null);
          this.status.set({ enrolled: true });
          break;
        default:
          this.error.set(errorText(err, 'The authenticator app was not turned on. Try again.'));
      }
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Settings > My sign-in methods (any signed-in user): the passkeys, the password and the linked
 * providers of the account, with set, change and remove for the password, unlink for identities, and
 * a link for each provider not yet linked. The API refuses a removal that would leave no usable method
 * (409 `last_sign_in_method`), which the page explains.
 */
@Component({
  selector: 'app-my-sign-in-methods-page',
  imports: [FormsModule, SettingsTabs, Drawer, PasswordFields, ProviderButtons, AuthenticatorAppSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .methods-stack {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      max-width: 720px;
    }
    .method-rows {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .method-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .method-row__text {
      display: flex;
      flex: 1 1 14rem;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">My sign-in methods</h2>
        <p class="page-header__meta">
          The ways you sign in to TaleArt. Keep at least one of them usable: TaleArt will not remove the last one.
        </p>
      </header>

      @if (loadFailed()) {
        <div class="invite-actions" role="alert">
          <p class="form-error">Your sign-in methods could not be read.</p>
          <button type="button" class="btn btn--secondary btn--sm" (click)="load()">Retry</button>
        </div>
      } @else if (methods(); as current) {
        <div class="methods-stack">
          @if (authError(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }
          <section class="card section" aria-labelledby="passkeys-title">
            <h3 class="section__title" id="passkeys-title" tabindex="-1">Passkeys</h3>
            @if (current.passkeys.length === 0) {
              <p class="muted">No passkeys.</p>
            } @else {
              <ul class="method-rows" aria-labelledby="passkeys-title">
                @for (passkey of current.passkeys; track passkey.id) {
                  <li class="method-row">
                    <div class="method-row__text">
                      <span>Passkey added {{ date(passkey.createdAt) }}</span>
                      <span class="muted">{{
                        passkey.lastUsedAt ? 'Last used ' + date(passkey.lastUsedAt) : 'Not used yet'
                      }}</span>
                    </div>
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-label]="'Remove passkey added ' + date(passkey.createdAt)"
                      (click)="askRemove({ kind: 'passkey', item: passkey }, $event)"
                    >
                      Remove
                    </button>
                  </li>
                }
              </ul>
            }
          </section>

          <section class="card section" aria-labelledby="password-title">
            <h3 class="section__title" id="password-title">Username and password</h3>
            @if (current.password; as password) {
              <p>
                Username <code class="key-prefix">{{ password.username }}</code>
              </p>
              <p class="muted">Changed {{ date(password.updatedAt) }}</p>
              <div class="invite-actions">
                <button type="button" class="btn btn--secondary" id="password-change" (click)="openPassword($event)">
                  Change password
                </button>
                <button
                  type="button"
                  class="btn btn--secondary"
                  id="password-remove"
                  (click)="askRemove({ kind: 'password' }, $event)"
                >
                  Remove password
                </button>
              </div>
            } @else {
              <p class="muted">You have no password. Set one to sign in with a username and password.</p>
              <div class="invite-actions">
                <button type="button" class="btn btn--secondary" id="password-set" (click)="openPassword($event)">
                  Set a password
                </button>
              </div>
            }
          </section>

          <section class="card section" aria-labelledby="identities-title">
            <h3 class="section__title" id="identities-title">Linked providers</h3>
            @if (current.identities.length === 0) {
              <p class="muted">No provider is linked to your account.</p>
            } @else {
              <ul class="method-rows" aria-labelledby="identities-title">
                @for (identity of current.identities; track identity.id) {
                  <li class="method-row">
                    <div class="method-row__text">
                      <span>{{ providerLabel(identity.provider) }}</span>
                      <span class="muted">
                        {{ identity.email ?? 'No verified email from the provider' }}
                        · Linked {{ date(identity.createdAt) }}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-label]="'Unlink ' + providerLabel(identity.provider)"
                      (click)="askRemove({ kind: 'identity', item: identity }, $event)"
                    >
                      Unlink
                    </button>
                  </li>
                }
              </ul>
            }
            @if (unlinked().length > 0) {
              <h4 class="section__title">Link a provider</h4>
              <app-provider-buttons [methods]="unlinked()" purpose="link" />
            }
          </section>

          <app-authenticator-app-section />

          <p class="visually-hidden" role="status">{{ announcement() }}</p>
        </div>
      } @else {
        <p class="muted" role="status">Reading your sign-in methods…</p>
      }
    </div>

    @if (passwordOpen()) {
      <app-drawer
        [heading]="methods()?.password ? 'Change password' : 'Set a password'"
        [busy]="passwordBusy()"
        [returnFocus]="focusBack"
        (closed)="closePassword()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); savePassword()" novalidate>
          <div class="drawer__body">
            <app-password-fields
              idPrefix="my-password"
              [withUsername]="!methods()?.password"
              [withCurrent]="!!methods()?.password"
              [(username)]="pwUsername"
              [(currentPassword)]="pwCurrent"
              [(password)]="pwPassword"
              [(confirm)]="pwConfirm"
              [errors]="pwErrors()"
            />
            @if (passwordError()) {
              <p class="form-error" role="alert">{{ passwordError() }}</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" [disabled]="passwordBusy()" (click)="closePassword()">
              Cancel
            </button>
            <button type="submit" class="btn btn--primary" id="my-password-save" [disabled]="passwordBusy()">
              {{ passwordBusy() ? 'Saving…' : 'Save password' }}
            </button>
          </div>
        </form>
      </app-drawer>
    }

    @if (removing(); as removal) {
      <app-drawer
        [heading]="removalHeading(removal)"
        dialogRole="alertdialog"
        describedBy="my-removal-text"
        [returnFocus]="focusBack"
        [busy]="removeBusy()"
        (closed)="closeRemoval()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); remove()" novalidate>
          <div class="drawer__body">
            <p id="my-removal-text">{{ removalText(removal) }}</p>
            @if (removeError()) {
              <p class="form-error" role="alert">{{ removeError() }}</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" [disabled]="removeBusy()" (click)="closeRemoval()">
              Cancel
            </button>
            <button type="submit" class="btn btn--danger" id="my-removal-confirm" [disabled]="removeBusy()">
              {{ removalHeading(removal) }}
            </button>
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class MySignInMethodsPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(SignInMethodsApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly methods = signal<AccountMethods | null>(null);
  /** A failed provider link comes back here with ?auth_error=<code>. */
  protected readonly authError = signal(authErrorMessage(this.route.snapshot.queryParamMap.get('auth_error')));
  protected readonly loadFailed = signal(false);
  protected readonly announcement = signal('');
  private returnFocus: HTMLElement | null = null;
  protected readonly focusBack = () => this.returnFocus ?? document.getElementById('passkeys-title');

  /** The providers the state lists that the account has not linked yet. */
  protected readonly unlinked = computed(() => {
    const linked = new Set((this.methods()?.identities ?? []).map((i) => i.provider));
    return (this.auth.state()?.methods ?? []).filter(
      (m) => m.kind !== 'passkey' && m.kind !== 'password' && !linked.has(m.id),
    );
  });

  protected readonly passwordOpen = signal(false);
  protected readonly passwordBusy = signal(false);
  protected readonly passwordError = signal('');
  protected readonly pwErrors = signal<PasswordFieldErrors>({});
  protected readonly pwUsername = signal('');
  protected readonly pwCurrent = signal('');
  protected readonly pwPassword = signal('');
  protected readonly pwConfirm = signal('');

  protected readonly removing = signal<Removal | null>(null);
  protected readonly removeBusy = signal(false);
  protected readonly removeError = signal('');

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      this.methods.set(await this.api.accountMethods());
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected providerLabel(provider: string): string {
    const known = this.auth.state()?.methods.find((m) => m.id === provider);
    if (known) return known.label;
    if (provider === 'google') return 'Google';
    if (provider === 'apple') return 'Apple';
    return provider.replace(/^oidc:/, '');
  }

  protected openPassword(event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.pwErrors.set({});
    this.passwordError.set('');
    this.pwCurrent.set('');
    this.pwPassword.set('');
    this.pwConfirm.set('');
    this.passwordOpen.set(true);
  }

  protected closePassword(): void {
    if (this.passwordBusy()) return;
    this.passwordOpen.set(false);
  }

  protected async savePassword(): Promise<void> {
    if (this.passwordBusy()) return;
    const hasPassword = this.methods()?.password !== null;
    const found = checkPasswordForm(
      {
        username: this.pwUsername(),
        currentPassword: this.pwCurrent(),
        password: this.pwPassword(),
        confirm: this.pwConfirm(),
      },
      { username: !hasPassword, currentPassword: hasPassword, confirm: true },
    );
    this.pwErrors.set(found);
    this.passwordError.set('');
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`my-password-${first === 'currentPassword' ? 'current' : first}`)?.focus();
      return;
    }
    this.passwordBusy.set(true);
    try {
      await this.api.setPassword(
        hasPassword
          ? { currentPassword: this.pwCurrent(), password: this.pwPassword() }
          : { username: this.pwUsername().trim().toLowerCase(), password: this.pwPassword() },
      );
      this.passwordOpen.set(false);
      this.announcement.set('Password saved.');
      await this.load();
    } catch (err) {
      this.pwErrors.set(this.passwordFieldError(err));
      if (Object.keys(this.pwErrors()).length === 0)
        this.passwordError.set(errorText(err, 'The password was not saved. Try again.'));
    } finally {
      this.passwordBusy.set(false);
    }
  }

  // The field a refused password save belongs to: the current password, the username taken, or the policy.
  private passwordFieldError(err: unknown): PasswordFieldErrors {
    const message = errorText(err, 'The password was not saved. Try again.');
    switch (errorCode(err)) {
      case ErrorCodes.passwordIncorrect:
        return { currentPassword: 'That is not your current password.' };
      case ErrorCodes.usernameTaken:
        return { username: message };
      case ErrorCodes.passwordRejected:
        return { password: message };
      default:
        return {};
    }
  }

  protected askRemove(removal: Removal, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.removeError.set('');
    this.removing.set(removal);
  }

  protected closeRemoval(): void {
    if (this.removeBusy()) return;
    this.removing.set(null);
  }

  protected removalHeading(removal: Removal): string {
    switch (removal.kind) {
      case 'passkey':
        return 'Remove passkey';
      case 'password':
        return 'Remove password';
      case 'identity':
        return 'Unlink provider';
    }
  }

  protected removalText(removal: Removal): string {
    switch (removal.kind) {
      case 'passkey':
        return 'Remove this passkey? You will not be able to sign in with it again.';
      case 'password':
        return 'Remove your password? You will sign in with your other methods from now on.';
      case 'identity':
        return `Unlink ${this.providerLabel(removal.item.provider)}? You will no longer sign in with it.`;
    }
  }

  protected async remove(): Promise<void> {
    const removal = this.removing();
    if (!removal || this.removeBusy()) return;
    this.removeBusy.set(true);
    this.removeError.set('');
    try {
      if (removal.kind === 'passkey') await this.api.removePasskey(removal.item.id);
      else if (removal.kind === 'password') await this.api.removePassword();
      else await this.api.unlinkIdentity(removal.item.id);
    } catch (err) {
      // Already gone (404): it is gone either way.
      if (!(err instanceof HttpErrorResponse && err.status === 404)) {
        this.removeBusy.set(false);
        this.removeError.set(accountRefusal(err, 'Nothing was removed. Try again.'));
        return;
      }
    }
    this.removeBusy.set(false);
    this.removing.set(null);
    this.returnFocus = document.getElementById('passkeys-title');
    this.announcement.set(`${this.removalHeading(removal)}: done.`);
    await this.load();
  }
}
