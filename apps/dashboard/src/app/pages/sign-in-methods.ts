import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import type { AuthProvider, AuthSettings } from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { Drawer } from '../drawer';
import { ShowSwitch } from '../status';
import { SignInMethodsApi } from '../sign-in-methods.service';
import { adminRefusal } from '../sign-in-methods';
import { ProviderDrawer } from './provider-drawer';
import { SettingsTabs } from './settings-tabs';

/** The kind of each provider, as the list reads it. */
const KIND_LABELS: Record<AuthProvider['kind'], string> = { google: 'Google', apple: 'Apple', oidc: 'OpenID Connect' };

/**
 * Settings > Sign-in methods (admins only, epic sign-in methods): the passkey and password methods on
 * or off, and the external providers (add, edit, delete). A change that would lock an admin out, or
 * leave no method on, is refused by the API and explained here. Secrets are write-only: the list shows
 * only whether one is set.
 */
@Component({
  selector: 'app-sign-in-methods-page',
  imports: [SettingsTabs, Drawer, ShowSwitch, ProviderDrawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .methods-section,
    .providers-section {
      max-width: 760px;
    }
    .method-list,
    .provider-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .method,
    .provider {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .method__text,
    .provider__text {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }
    .method__name,
    .provider__name {
      margin: 0;
      font-size: var(--text-md);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .provider__facts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .provider__actions {
      display: flex;
      gap: var(--space-2);
    }
    .notice {
      max-width: 760px;
      border-left: 4px solid var(--danger-text);
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">Sign-in methods</h2>
        <p class="page-header__meta">
          Choose how people sign in to TaleArt. A method can be turned off only while every admin can still sign in with
          another one.
        </p>
      </header>

      @if (!auth.isAdmin()) {
        <p class="muted">Only admins can change the sign-in methods.</p>
      } @else if (loadFailed()) {
        <div class="invite-actions" role="alert">
          <p class="form-error">The sign-in methods could not be read.</p>
          <button type="button" class="btn btn--secondary btn--sm" (click)="load()">Retry</button>
        </div>
      } @else if (settings(); as current) {
        @if (!current.secretKeyConfigured) {
          <section class="card section notice" aria-labelledby="secret-key-title">
            <h3 class="section__title" id="secret-key-title">Provider secrets cannot be saved yet</h3>
            <p>
              The server has no valid <code>TALEART_SECRET_KEY</code>, so the client secret of a provider (and the Apple
              private key) cannot be stored. Providers that need one stay unusable until the key is set. To set it,
              generate 32 random bytes encoded as base64 (for example with <code>openssl rand -base64 32</code>), put
              the value in <code>TALEART_SECRET_KEY</code> on the API, and restart the API.
            </p>
          </section>
        }

        <section class="card section methods-section" aria-labelledby="methods-title">
          <h3 class="section__title" id="methods-title">Methods</h3>
          <p class="muted">
            Turn passkeys and usernames with passwords on or off. A method is refused when it is the last one on, or
            when an admin would have no way left to sign in.
          </p>
          <ul class="method-list">
            <li class="method">
              <div class="method__text">
                <h4 class="method__name" id="method-passkey-name">Passkey</h4>
                <p class="muted">Signs in with a passkey stored on the device or in a password manager.</p>
              </div>
              <app-show-switch
                [on]="current.passkeyEnabled"
                label="Passkey sign-in"
                [stateText]="current.passkeyEnabled ? 'On' : 'Off'"
                [disabled]="toggling() !== null"
                (toggled)="setMethod('passkey', $event)"
              />
            </li>
            <li class="method">
              <div class="method__text">
                <h4 class="method__name" id="method-password-name">Username and password</h4>
                <p class="muted">People sign in with a username and password they choose when they join.</p>
              </div>
              <app-show-switch
                [on]="current.passwordEnabled"
                label="Username and password sign-in"
                [stateText]="current.passwordEnabled ? 'On' : 'Off'"
                [disabled]="toggling() !== null"
                (toggled)="setMethod('password', $event)"
              />
            </li>
          </ul>
          @if (settingsError()) {
            <p class="form-error" role="alert">{{ settingsError() }}</p>
          }
        </section>

        <section class="card section providers-section" aria-labelledby="providers-title">
          <div class="invite-actions">
            <h3 class="section__title" id="providers-title" tabindex="-1">Providers</h3>
            <button type="button" class="btn btn--primary" id="provider-add" (click)="openAdd($event)">
              Add a provider
            </button>
          </div>
          <p class="muted">
            Sign in with Google, Apple, or any OpenID Connect provider. A provider never creates an account by itself:
            people join by invitation or first-admin setup, or link a provider in My sign-in methods.
          </p>
          @if (providers().length === 0) {
            <p class="muted" id="providers-empty">No providers yet.</p>
          } @else {
            <ul class="provider-list" aria-labelledby="providers-title">
              @for (provider of providers(); track provider.slug) {
                <li class="provider">
                  <div class="provider__text">
                    <h4 class="provider__name">{{ provider.displayName }}</h4>
                    <p class="provider__facts">
                      <code class="key-prefix">{{ provider.id }}</code>
                      <span>{{ kindLabel(provider) }}</span>
                      <span class="pill">{{ provider.enabled ? 'On' : 'Off' }}</span>
                      <span class="pill">{{ provider.usable ? 'Usable' : 'Not usable' }}</span>
                      <span class="pill">{{ provider.hasSecret ? 'Secret set' : 'No secret' }}</span>
                    </p>
                  </div>
                  <div class="provider__actions">
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-label]="'Edit ' + provider.displayName"
                      (click)="openEdit(provider, $event)"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn btn--secondary btn--sm"
                      [attr.aria-label]="'Delete ' + provider.displayName"
                      (click)="askDelete(provider, $event)"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
          <p class="visually-hidden" role="status">{{ announcement() }}</p>
        </section>
      } @else {
        <p class="muted" role="status">Reading the sign-in methods…</p>
      }
    </div>

    @if (editing(); as target) {
      <app-provider-drawer
        [provider]="target === 'new' ? null : target"
        [focusBack]="focusBack"
        (saved)="onSaved($event)"
        (closed)="closeEditor()"
      />
    }

    @if (deleting(); as provider) {
      <app-drawer
        heading="Delete provider"
        dialogRole="alertdialog"
        describedBy="provider-delete-text"
        [returnFocus]="focusBack"
        [busy]="deleteBusy()"
        (closed)="closeDelete()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); remove()" novalidate>
          <div class="drawer__body">
            <p id="provider-delete-text">
              Delete <strong>{{ provider.displayName }}</strong
              >? Its secret is removed. People who linked it cannot sign in with it until it is added again. This cannot
              be undone.
            </p>
            @if (deleteError()) {
              <p class="form-error" role="alert">{{ deleteError() }}</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" [disabled]="deleteBusy()" (click)="closeDelete()">
              Cancel
            </button>
            <button type="submit" class="btn btn--danger" id="provider-delete" [disabled]="deleteBusy()">
              Delete provider
            </button>
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class SignInMethodsPage implements OnInit {
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(SignInMethodsApi);

  protected readonly settings = signal<AuthSettings | null>(null);
  protected readonly providers = signal<AuthProvider[]>([]);
  protected readonly loadFailed = signal(false);
  protected readonly toggling = signal<'passkey' | 'password' | null>(null);
  protected readonly settingsError = signal('');
  /** The drawer: a provider to edit, `new` to add one, or null when closed. */
  protected readonly editing = signal<AuthProvider | 'new' | null>(null);
  protected readonly deleting = signal<AuthProvider | null>(null);
  protected readonly deleteBusy = signal(false);
  protected readonly deleteError = signal('');
  protected readonly announcement = signal('');
  private returnFocus: HTMLElement | null = null;
  /** Where a drawer puts focus back, read when it closes: the list's heading, which stays on the page. */
  protected readonly focusBack = () => this.returnFocus ?? document.getElementById('providers-title');

  ngOnInit(): void {
    if (this.auth.isAdmin()) void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const [settings, providers] = await Promise.all([this.api.settings(), this.api.providers()]);
      this.settings.set(settings);
      this.providers.set(providers);
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected kindLabel(provider: AuthProvider): string {
    return KIND_LABELS[provider.kind];
  }

  protected async setMethod(which: 'passkey' | 'password', on: boolean): Promise<void> {
    const current = this.settings();
    if (!current || this.toggling() !== null) return;
    const body = {
      passkeyEnabled: which === 'passkey' ? on : current.passkeyEnabled,
      passwordEnabled: which === 'password' ? on : current.passwordEnabled,
    };
    this.toggling.set(which);
    this.settingsError.set('');
    try {
      this.settings.set(await this.api.saveSettings(body));
      this.announcement.set(
        `${which === 'passkey' ? 'Passkey' : 'Username and password'} sign-in ${on ? 'on' : 'off'}.`,
      );
    } catch (err) {
      this.settingsError.set(adminRefusal(err, 'The setting was not saved. Try again.'));
    } finally {
      this.toggling.set(null);
    }
  }

  protected openAdd(event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.editing.set('new');
  }

  protected openEdit(provider: AuthProvider, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.editing.set(provider);
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  protected onSaved(saved: AuthProvider): void {
    this.providers.update((list) => {
      const others = list.filter((p) => p.slug !== saved.slug);
      return [...others, saved].sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    this.editing.set(null);
    this.announcement.set(`${saved.displayName} saved.`);
  }

  protected askDelete(provider: AuthProvider, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.deleteError.set('');
    this.deleting.set(provider);
  }

  protected closeDelete(): void {
    if (this.deleteBusy()) return;
    this.deleting.set(null);
  }

  protected async remove(): Promise<void> {
    const provider = this.deleting();
    if (!provider || this.deleteBusy()) return;
    this.deleteBusy.set(true);
    this.deleteError.set('');
    try {
      await this.api.deleteProvider(provider.slug);
    } catch (err) {
      // Already gone elsewhere (404): it is gone either way.
      if (!(err instanceof HttpErrorResponse && err.status === 404)) {
        this.deleteBusy.set(false);
        this.deleteError.set(adminRefusal(err, 'The provider was not deleted. Try again.'));
        return;
      }
    }
    this.deleteBusy.set(false);
    this.providers.update((list) => list.filter((p) => p.slug !== provider.slug));
    this.returnFocus = document.getElementById('providers-title');
    this.deleting.set(null);
    this.announcement.set(`${provider.displayName} deleted.`);
  }
}
