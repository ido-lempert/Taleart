import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import type { AuthMethod } from '@taleart/contract/core';
import {
  continueLabel,
  isEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  providerStartUrl,
  slugOfMethod,
  type PasswordFieldErrors,
  type ProviderPurpose,
} from './sign-in-methods';

/**
 * The username, password and confirmation of a password form, with the policy hint and inline errors.
 * Each value is two-way bound (`[(password)]="…"`) to the page's signal; the page checks them with
 * `checkPasswordForm` before it sends.
 */
@Component({
  selector: 'app-password-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (withUsername()) {
      <div class="field">
        <label class="field__label" [attr.for]="idPrefix() + '-username'">Username</label>
        <input
          [attr.id]="idPrefix() + '-username'"
          class="input"
          name="username"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          [value]="username()"
          (input)="username.set(valueOf($event))"
          [attr.aria-invalid]="errors().username ? 'true' : null"
          [attr.aria-describedby]="describedBy('username', idPrefix() + '-username-hint')"
        />
        <span class="field__hint" [attr.id]="idPrefix() + '-username-hint'">
          3 to 40 letters, digits, dots, underscores or hyphens. Upper-case letters are kept in lower case.
        </span>
        @if (errors().username; as message) {
          <span class="field__error" [attr.id]="idPrefix() + '-username-error'">{{ message }}</span>
        }
      </div>
    }
    @if (withCurrent()) {
      <div class="field">
        <label class="field__label" [attr.for]="idPrefix() + '-current'">Current password</label>
        <input
          [attr.id]="idPrefix() + '-current'"
          class="input"
          type="password"
          name="currentPassword"
          autocomplete="current-password"
          [value]="currentPassword()"
          (input)="currentPassword.set(valueOf($event))"
          [attr.aria-invalid]="errors().currentPassword ? 'true' : null"
          [attr.aria-describedby]="describedBy('currentPassword')"
        />
        @if (errors().currentPassword; as message) {
          <span class="field__error" [attr.id]="idPrefix() + '-current-error'">{{ message }}</span>
        }
      </div>
    }
    <div class="field">
      <label class="field__label" [attr.for]="idPrefix() + '-password'">{{ passwordLabel() }}</label>
      <input
        [attr.id]="idPrefix() + '-password'"
        class="input"
        type="password"
        name="password"
        autocomplete="new-password"
        [attr.maxlength]="maxLength"
        [value]="password()"
        (input)="password.set(valueOf($event))"
        [attr.aria-invalid]="errors().password ? 'true' : null"
        [attr.aria-describedby]="describedBy('password', idPrefix() + '-password-hint')"
      />
      <span class="field__hint" [attr.id]="idPrefix() + '-password-hint'">
        {{ minLength }} to {{ maxLength }} characters. Not your username or your email, and not a common password.
      </span>
      @if (errors().password; as message) {
        <span class="field__error" [attr.id]="idPrefix() + '-password-error'">{{ message }}</span>
      }
    </div>
    @if (withConfirm()) {
      <div class="field">
        <label class="field__label" [attr.for]="idPrefix() + '-confirm'">Confirm password</label>
        <input
          [attr.id]="idPrefix() + '-confirm'"
          class="input"
          type="password"
          name="confirm"
          autocomplete="new-password"
          [value]="confirm()"
          (input)="confirm.set(valueOf($event))"
          [attr.aria-invalid]="errors().confirm ? 'true' : null"
          [attr.aria-describedby]="describedBy('confirm')"
        />
        @if (errors().confirm; as message) {
          <span class="field__error" [attr.id]="idPrefix() + '-confirm-error'">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class PasswordFields {
  readonly idPrefix = input.required<string>();
  readonly withUsername = input(true);
  readonly withCurrent = input(false);
  readonly withConfirm = input(true);
  readonly passwordLabel = input('Password');
  readonly errors = input<PasswordFieldErrors>({});

  readonly username = model('');
  readonly currentPassword = model('');
  readonly password = model('');
  readonly confirm = model('');

  protected readonly minLength = PASSWORD_MIN_LENGTH;
  protected readonly maxLength = PASSWORD_MAX_LENGTH;

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** The ids that describe a field: its hint, when it has one, and its error. */
  protected describedBy(field: keyof PasswordFieldErrors, hint = ''): string | null {
    const ids = [hint, this.errors()[field] ? `${this.idPrefix()}-${this.errorSuffix(field)}` : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  private errorSuffix(field: keyof PasswordFieldErrors): string {
    return field === 'currentPassword' ? 'current-error' : field === 'confirm' ? 'confirm-error' : `${field}-error`;
  }
}

/**
 * The buttons that start a provider flow: a link to the API's start route, which redirects to the
 * provider. Shows only the provider methods of `/auth/state` (passkey and password are not here).
 * An invitation's flow needs the invitee's email: when it is missing or malformed the click stops and
 * `refused` says why, so the page can show it inline.
 */
@Component({
  selector: 'app-provider-buttons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (method of providers(); track method.id) {
      <a class="btn btn--secondary auth-card__submit" [attr.href]="startUrl(method)" (click)="check($event)">{{
        continueLabel(method)
      }}</a>
    }
  `,
})
export class ProviderButtons {
  readonly methods = input<readonly AuthMethod[]>([]);
  readonly purpose = input.required<ProviderPurpose>();
  /** The setup or invitation token, for the purposes that have one. */
  readonly token = input<string | undefined>(undefined);
  /** The invitee's email, which an invitation's flow sends and the provider's verified email must equal. */
  readonly email = input<string | undefined>(undefined);
  /** Why a click did not start the flow; empty when it did. */
  readonly refused = output<string>();

  protected readonly providers = computed(() =>
    this.methods().filter((m) => m.kind !== 'passkey' && m.kind !== 'password'),
  );

  protected startUrl(method: AuthMethod): string {
    const email = this.purpose() === 'invitation' ? (this.email()?.trim() ?? '') : undefined;
    return providerStartUrl(slugOfMethod(method.id), this.purpose(), this.token(), email);
  }

  protected continueLabel(method: AuthMethod): string {
    return continueLabel(method);
  }

  // An invitation's flow needs a well-formed email first; anything else navigates as it is.
  protected check(event: Event): void {
    if (this.purpose() !== 'invitation') return;
    const email = this.email()?.trim() ?? '';
    if (isEmail(email)) {
      this.refused.emit('');
      return;
    }
    event.preventDefault();
    this.refused.emit(
      email
        ? 'Enter a valid email address to continue with a provider.'
        : 'Enter your email to continue with a provider.',
    );
  }
}
