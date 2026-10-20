import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthStore, PasskeyClient, safeReturnUrl } from '../auth';
import { Mark } from '../icon';

/** Shown on an empty install: registers the first admin's passkey. */
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

  protected readonly supported = inject(PasskeyClient).supported();
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  /** True when someone else finished setup first. */
  protected readonly closed = signal(false);
  protected name = '';
  protected email = '';

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    const name = this.name.trim();
    const email = this.email.trim();
    if (!name || !email) {
      this.error.set('Enter your name and email.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const message = await this.auth.setUp(name, email);
    this.busy.set(false);
    if (message) {
      this.error.set(message);
      this.closed.set(this.auth.state()?.setupRequired === false);
      return;
    }
    await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')));
  }
}
