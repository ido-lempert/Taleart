import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { Mark } from '../icon';

/** Passkey sign-in. The passkey is discoverable, so no email is asked for. */
@Component({
  selector: 'app-sign-in-page',
  imports: [Mark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="sign-in-heading">
        <div class="auth-card__brand">
          <app-mark />
          <span class="auth-card__wordmark">TaleArt</span>
        </div>
        <h1 class="auth-card__title" id="sign-in-heading">Sign in</h1>
        <p class="auth-card__help">Your passkey is stored on this device or in your password manager.</p>
        @if (supported) {
          <div class="auth-card__form">
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
            <button type="button" class="btn btn--primary auth-card__submit" [disabled]="busy()" (click)="signIn()">
              {{ busy() ? 'Waiting for your passkey…' : 'Sign in with a passkey' }}
            </button>
          </div>
        } @else {
          <p class="form-error" role="alert">
            This browser does not support passkeys. Open TaleArt in a current version of Chrome, Safari, Edge or Firefox.
          </p>
        }
      </section>
    </main>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly supported = inject(PasskeyClient).supported();
  protected readonly error = signal('');
  protected readonly busy = signal(false);

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
    await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }
}
