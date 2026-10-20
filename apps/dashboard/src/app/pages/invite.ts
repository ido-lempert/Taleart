import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { InvitationPreview } from '@taleart/contract';
import { AuthStore, PasskeyClient } from '../auth';
import { Mark } from '../icon';

/** Opened from an invitation link: registers the invitee's passkey and joins the project as a content manager. */
@Component({
  selector: 'app-invite-page',
  imports: [FormsModule, RouterLink, Mark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="auth-page">
      <section class="auth-card" aria-labelledby="invite-heading" [attr.aria-busy]="state() === 'loading' ? 'true' : null">
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
              You join as a content manager. Your passkey is stored on this device or in your password manager.
            </p>
            @if (supported) {
              <form class="auth-card__form" (ngSubmit)="submit()" novalidate>
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
                @if (error()) {
                  <p class="form-error" id="invite-error" role="alert">{{ error() }}</p>
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
        }
      </section>
    </main>
  `,
})
export class InvitePage implements OnInit {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  /** The token from the link, bound from the route's `:token`. */
  readonly token = input.required<string>();

  protected readonly supported = inject(PasskeyClient).supported();
  protected readonly state = signal<'loading' | 'ready' | 'invalid' | 'unreachable'>('loading');
  protected readonly preview = signal<InvitationPreview | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected name = '';
  protected email = '';

  async ngOnInit(): Promise<void> {
    try {
      const preview = await this.auth.invitation(this.token());
      this.preview.set(preview);
      this.state.set(preview ? 'ready' : 'invalid');
    } catch {
      this.state.set('unreachable');
    }
  }

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
    // A content manager is a member of this project only, so it is the selected one.
    await this.router.navigateByUrl('/zones');
  }
}
