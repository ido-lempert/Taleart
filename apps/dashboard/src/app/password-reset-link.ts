import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import type { PasswordResetLink } from '@taleart/contract/core';
import { Drawer } from './drawer';
import { SignInMethodsApi } from './sign-in-methods.service';
import { errorText } from './sign-in-methods';

/**
 * Issues a one-time password reset link for a user (admins only) and shows it once, with Copy, the way
 * invitation links are shown. The link works once, for 24 hours; issuing one replaces the user's earlier
 * unused links, and the user gets a password from it when they have none. TaleArt keeps only the link's
 * hash, so the link cannot be shown again: the drawer closes on Done and the link is forgotten.
 */
@Component({
  selector: 'app-password-reset-link',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-drawer [heading]="heading()" [busy]="busy()" [returnFocus]="focusBack()" (closed)="close()">
      <div class="drawer__form">
        <div class="drawer__body">
          @if (link(); as issued) {
            <div class="field">
              <label class="field__label" for="reset-link-url">Password reset link</label>
              <input
                id="reset-link-url"
                class="input input--mono"
                name="resetLink"
                readonly
                spellcheck="false"
                autocomplete="off"
                [value]="issued.url"
                aria-describedby="reset-link-hint"
                (focus)="selectAll($event)"
              />
              <p class="field__hint" id="reset-link-hint">
                Share it with {{ userName() }} once. It works once, until {{ expiry(issued) }}. This link is shown only
                now.
              </p>
            </div>
            <div class="invite-actions">
              <button type="button" class="btn btn--secondary" id="reset-link-copy" (click)="copy(issued)">
                Copy link
              </button>
            </div>
            <p class="muted" role="status">{{ copyStatus() }}</p>
          } @else {
            <p>
              Create a one-time link for <strong>{{ userName() }}</strong
              >. It sets a new password and signs them in, and works for 24 hours. A link issued earlier for them stops
              working.
            </p>
            @if (error()) {
              <p class="form-error" role="alert">{{ error() }}</p>
            }
          }
        </div>
        <div class="drawer__footer">
          @if (link()) {
            <button type="button" class="btn btn--primary" (click)="close()">Done</button>
          } @else {
            <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="close()">Cancel</button>
            <button
              type="button"
              class="btn btn--primary"
              id="reset-link-create"
              [disabled]="busy()"
              (click)="create()"
            >
              {{ busy() ? 'Creating…' : 'Create link' }}
            </button>
          }
        </div>
      </div>
    </app-drawer>
  `,
})
export class PasswordResetLinkDrawer {
  private readonly api = inject(SignInMethodsApi);

  /** The user the link is for. */
  readonly userId = input.required<string>();
  readonly userName = input.required<string>();
  /** Where focus goes back to when the drawer closes. */
  readonly focusBack = input<() => HTMLElement | null>(() => null);
  readonly closed = output<void>();

  protected readonly heading = computed(() => `Reset link for ${this.userName()}`);
  protected readonly link = signal<PasswordResetLink | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly copyStatus = signal('');

  protected expiry(issued: PasswordResetLink): string {
    return new Date(issued.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async create(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.link.set(await this.api.issuePasswordReset(this.userId()));
    } catch (err) {
      this.error.set(errorText(err, 'The link was not created. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(issued: PasswordResetLink): Promise<void> {
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(issued.url);
      this.copyStatus.set('Link copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the link and copy it.');
    }
  }

  /** Closes the drawer; the link is dropped from memory and never shown again. */
  protected close(): void {
    if (this.busy()) return;
    this.link.set(null);
    this.copyStatus.set('');
    this.closed.emit();
  }
}
