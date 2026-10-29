import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { PasswordResetPreview } from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { Mark } from '../icon';
import { PasswordFields } from '../sign-in-controls';
import { checkPasswordForm, type PasswordFieldErrors } from '../sign-in-methods';

/**
 * Opened from a password reset link an admin issued: sets a new password and signs the person in.
 * The link works once, for 24 hours. A user who has no password yet also chooses a username here.
 */
@Component({
  selector: 'app-password-reset-page',
  imports: [RouterLink, Mark, PasswordFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section
        class="auth-card"
        aria-labelledby="reset-heading"
        [attr.aria-busy]="state() === 'loading' ? 'true' : null"
      >
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        @switch (state()) {
          @case ('loading') {
            <h1 class="auth-card__title" id="reset-heading">Opening your reset link…</h1>
          }
          @case ('invalid') {
            <h1 class="auth-card__title" id="reset-heading">This reset link is no longer valid</h1>
            <p class="auth-card__help">
              Reset links work once and for 24 hours. Ask an admin of TaleArt for a new link.
            </p>
            <a class="btn btn--secondary auth-card__submit" routerLink="/sign-in">Go to sign-in</a>
          }
          @case ('unreachable') {
            <h1 class="auth-card__title" id="reset-heading">Set a new password</h1>
            <p class="form-error" role="alert">Could not reach the API. Reload the page to try again.</p>
          }
          @case ('ready') {
            <h1 class="auth-card__title" id="reset-heading">Set a new password for {{ preview()?.name }}</h1>
            <p class="auth-card__help">
              Choose a password of 12 to 128 characters. Signing in here ends the other sessions of your account.
            </p>
            <form class="auth-card__form" (submit)="$event.preventDefault(); submit()" novalidate>
              <app-password-fields
                idPrefix="reset"
                [withUsername]="preview()?.usernameRequired ?? false"
                [(username)]="username"
                [(password)]="password"
                [(confirm)]="confirm"
                [errors]="errors()"
              />
              @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
              }
              <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
                {{ busy() ? 'Saving…' : 'Set password and sign in' }}
              </button>
            </form>
          }
        }
      </section>
    </main>
  `,
})
export class PasswordResetPage implements OnInit {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** The token from the link, bound from the route's `:token`. */
  readonly token = input.required<string>();

  protected readonly state = signal<'loading' | 'ready' | 'invalid' | 'unreachable'>('loading');
  protected readonly preview = signal<PasswordResetPreview | null>(null);
  protected readonly errors = signal<PasswordFieldErrors>({});
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const preview = await this.auth.passwordReset(this.token());
      this.preview.set(preview);
      this.state.set(preview ? 'ready' : 'invalid');
    } catch {
      this.state.set('unreachable');
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const usernameRequired = this.preview()?.usernameRequired ?? false;
    const found = checkPasswordForm(
      { username: this.username(), password: this.password(), confirm: this.confirm() },
      { username: usernameRequired, currentPassword: false, confirm: true },
    );
    this.errors.set(found);
    this.error.set('');
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`reset-${first}`)?.focus();
      return;
    }
    this.busy.set(true);
    const refusal = await this.auth.redeemPasswordReset(
      this.token(),
      this.password(),
      usernameRequired ? this.username() : undefined,
    );
    this.busy.set(false);
    if (refusal?.invalid) {
      this.state.set('invalid');
      return;
    }
    if (refusal) {
      if (refusal.field) this.errors.set({ [refusal.field]: refusal.message });
      else this.error.set(refusal.message);
      return;
    }
    await this.router.navigateByUrl('/zones');
  }
}
