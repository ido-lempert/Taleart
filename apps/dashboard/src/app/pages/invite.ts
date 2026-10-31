import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AuthMethod, InvitationPreview } from '@taleart/contract/core';
import { AuthStore, PasskeyClient } from '../auth';
import { Mark } from '../icon';
import { PasswordFields, ProviderButtons } from '../sign-in-controls';
import { authErrorMessage, checkPasswordForm, type PasswordFieldErrors } from '../sign-in-methods';
import { LegalLinks } from '../legal-links';
import { roleWithArticle, shortDate } from '../project-roles';

/**
 * Opened from an invitation link: the invitee joins the project as a content manager, with a passkey,
 * a username and password, or a provider (the methods that are on).
 */
@Component({
  selector: 'app-invite-page',
  imports: [FormsModule, RouterLink, Mark, PasswordFields, ProviderButtons, LegalLinks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section
        class="auth-card"
        aria-labelledby="invite-heading"
        [attr.aria-busy]="state() === 'loading' ? 'true' : null"
      >
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        @switch (state()) {
          @case ('loading') {
            <h1 class="auth-card__title" id="invite-heading">Opening your invitation…</h1>
          }
          @case ('invalid') {
            <h1 class="auth-card__title" id="invite-heading">This invitation is no longer valid</h1>
            <p class="auth-card__help">
              Invitation links work once and for 7 days. Ask an admin of the project for a new link.
            </p>
            <a class="btn btn--secondary auth-card__submit" routerLink="/sign-in">Go to sign-in</a>
          }
          @case ('unreachable') {
            <h1 class="auth-card__title" id="invite-heading">Join TaleArt</h1>
            <p class="form-error" role="alert">Could not reach the API. Reload the page to try again.</p>
          }
          @case ('ready') {
            <h1 class="auth-card__title" id="invite-heading">Join {{ preview()?.projectName }} on TaleArt</h1>
            <p class="auth-card__help">
              @if (preview(); as invitation) {
                <strong id="invite-role-line"
                  >You'll join {{ invitation.projectName }} as {{ roleText(invitation.role) }}.</strong
                >
                @if (invitation.accessExpiresAt) {
                  Your access lasts until {{ accessEnd(invitation.accessExpiresAt) }}.
                }
              }
              Choose how you sign in: a passkey stored on this device or in your password manager, a username and
              password, or a provider.
            </p>
            @if (authError(); as message) {
              <p class="form-error" role="alert">{{ message }}</p>
            }

            <div class="auth-card__fields">
              <div class="field">
                <label class="field__label" for="invite-name">Name</label>
                <input
                  id="invite-name"
                  class="input"
                  name="name"
                  autocomplete="name"
                  [(ngModel)]="name"
                  [attr.aria-invalid]="error() ? 'true' : null"
                  [attr.aria-describedby]="error() ? 'invite-error' : null"
                />
              </div>
              <div class="field">
                <label class="field__label" for="invite-email">Email</label>
                <input
                  id="invite-email"
                  class="input"
                  name="email"
                  type="email"
                  autocomplete="email"
                  [(ngModel)]="email"
                  [attr.aria-invalid]="error() ? 'true' : null"
                  [attr.aria-describedby]="error() ? 'invite-error' : null"
                />
              </div>
            </div>
            @if (error()) {
              <p class="form-error" id="invite-error" role="alert">{{ error() }}</p>
            }

            @if (offersPasskey()) {
              @if (supported) {
                <form class="auth-card__form" (ngSubmit)="submitPasskey()" novalidate>
                  <p class="field__hint">Your passkey is stored on this device or in your password manager.</p>
                  <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
                    {{ busy() && !passwordBusy() ? 'Waiting for your passkey…' : 'Create passkey' }}
                  </button>
                </form>
              } @else {
                <p class="form-error" role="alert">
                  This browser does not support passkeys. Open TaleArt in a current version of Chrome, Safari, Edge or
                  Firefox.
                </p>
              }
            }

            @if (offersPassword()) {
              <form
                class="auth-card__form"
                aria-labelledby="invite-password-title"
                (ngSubmit)="submitPassword()"
                novalidate
              >
                <h2 class="auth-card__subtitle" id="invite-password-title">With a username and password</h2>
                <app-password-fields
                  idPrefix="invite"
                  [(username)]="pwUsername"
                  [(password)]="pwPassword"
                  [(confirm)]="pwConfirm"
                  [errors]="pwErrors()"
                />
                @if (passwordError()) {
                  <p class="form-error" role="alert">{{ passwordError() }}</p>
                }
                <button type="submit" class="btn btn--primary auth-card__submit" [disabled]="busy()">
                  {{ busy() && passwordBusy() ? 'Creating your account…' : 'Join with a password' }}
                </button>
              </form>
            }

            @if (providers().length > 0) {
              <div class="auth-card__form">
                <app-provider-buttons
                  [methods]="providers()"
                  purpose="invitation"
                  [token]="token()"
                  [email]="email"
                  (refused)="providerError.set($event)"
                />
                @if (providerError()) {
                  <p class="form-error" id="invite-provider-error" role="alert">{{ providerError() }}</p>
                }
              </div>
            }
          }
        }
        <app-legal-links />
      </section>
    </main>
  `,
})
export class InvitePage implements OnInit {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** The token from the link, bound from the route's `:token`. */
  readonly token = input.required<string>();

  protected readonly supported = inject(PasskeyClient).supported();
  protected readonly state = signal<'loading' | 'ready' | 'invalid' | 'unreachable'>('loading');
  protected readonly preview = signal<InvitationPreview | null>(null);
  private readonly methods = computed<readonly AuthMethod[] | null>(() => this.auth.state()?.methods ?? null);
  protected readonly offersPasskey = computed(() => {
    const methods = this.methods();
    return methods === null || methods.some((m) => m.id === 'passkey');
  });
  protected readonly offersPassword = computed(() => this.methods()?.some((m) => m.id === 'password') ?? false);
  protected readonly providers = computed(() =>
    (this.methods() ?? []).filter((m) => m.kind !== 'passkey' && m.kind !== 'password'),
  );
  protected readonly authError = signal(authErrorMessage(this.route.snapshot.queryParamMap.get('auth_error')));

  protected roleText(role: InvitationPreview['role']): string {
    return roleWithArticle(role);
  }

  protected accessEnd(iso: string): string {
    return shortDate(iso);
  }

  protected readonly error = signal('');
  /** Why a provider button did not start: the email is missing or malformed. */
  protected readonly providerError = signal('');
  protected readonly passwordError = signal('');
  protected readonly pwErrors = signal<PasswordFieldErrors>({});
  protected readonly busy = signal(false);
  protected readonly passwordBusy = signal(false);
  protected name = '';
  protected email = '';
  protected readonly pwUsername = signal('');
  protected readonly pwPassword = signal('');
  protected readonly pwConfirm = signal('');

  // The choices come from the sign-in methods, so the page reads them with the invitation, not after.
  async ngOnInit(): Promise<void> {
    try {
      const [loaded, preview] = await Promise.all([this.auth.ensure(), this.auth.invitation(this.token())]);
      if (!loaded) {
        this.state.set('unreachable');
        return;
      }
      this.preview.set(preview);
      this.state.set(preview ? 'ready' : 'invalid');
    } catch {
      this.state.set('unreachable');
    }
  }

  protected async submitPasskey(): Promise<void> {
    if (this.busy()) return;
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name || !email) {
      this.error.set('Enter your name and email.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const { message, invalid } = await this.auth.join(this.token(), name, email);
    this.busy.set(false);
    if (invalid) {
      this.state.set('invalid');
      return;
    }
    if (message) {
      this.error.set(message);
      return;
    }
    await this.router.navigateByUrl('/zones');
  }

  protected async submitPassword(): Promise<void> {
    if (this.busy()) return;
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name || !email) {
      this.passwordError.set('Enter your name and email.');
      return;
    }
    const found = checkPasswordForm(
      { username: this.pwUsername(), password: this.pwPassword(), confirm: this.pwConfirm() },
      { username: true, currentPassword: false, confirm: true },
    );
    this.pwErrors.set(found);
    this.passwordError.set('');
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`invite-${first}`)?.focus();
      return;
    }
    this.busy.set(true);
    this.passwordBusy.set(true);
    const refusal = await this.auth.joinWithPassword(this.token(), name, email, this.pwUsername(), this.pwPassword());
    this.busy.set(false);
    this.passwordBusy.set(false);
    if (refusal?.invalid) {
      this.state.set('invalid');
      return;
    }
    if (refusal) {
      if (refusal.field) this.pwErrors.set({ [refusal.field]: refusal.message });
      else this.passwordError.set(refusal.message);
      return;
    }
    // A content manager is a member of this project only, so it is the selected one.
    await this.router.navigateByUrl('/zones');
  }
}
