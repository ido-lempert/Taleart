import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AuthProvider, AuthProviderKind } from '@taleart/contract/core';
import { Drawer } from '../drawer';
import { ShowSwitch } from '../status';
import { SignInMethodsApi } from '../sign-in-methods.service';
import {
  adminRefusal,
  PROVIDER_PRESETS,
  providerBody,
  providerProblems,
  providerTestText,
  secretLabel,
  type ProviderDraft,
  type ProviderField,
  type SecretAction,
} from '../sign-in-methods';

/** The id of each drawer field's input; its error text is that id plus `-error`. */
const FIELD_IDS: Record<ProviderField, string> = {
  displayName: 'provider-name',
  slug: 'provider-slug',
  issuer: 'provider-issuer',
  clientId: 'provider-client-id',
  teamId: 'provider-team-id',
  keyId: 'provider-key-id',
  secret: 'provider-secret',
};

/**
 * Add or edit an external sign-in provider (Settings > Sign-in methods). The kind decides the fields:
 * Google takes a client ID and secret, Apple a team ID, key ID, client ID and private key, and a
 * generic OpenID Connect provider an issuer URL, a slug, a client ID and secret. The secret is
 * write-only: once stored, the drawer shows only that it is set, with Replace and Remove. It is never
 * sent back, and the drawer closes after a save, so it is never shown again.
 */
@Component({
  selector: 'app-provider-drawer',
  imports: [FormsModule, Drawer, ShowSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .provider-kinds {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
  `,
  template: `
    <app-drawer [heading]="heading()" [busy]="saving()" [returnFocus]="focusBack()" (closed)="closed.emit()">
      <form class="drawer__form" (submit)="$event.preventDefault(); save()" novalidate>
        <div class="drawer__body">
          @if (!provider()) {
            <fieldset class="provider-kinds">
              <legend class="field__label">Kind of provider</legend>
              @for (preset of presets; track preset.kind) {
                <label class="checkbox">
                  <input
                    type="radio"
                    name="provider-kind"
                    [value]="preset.kind"
                    [checked]="kind() === preset.kind"
                    (change)="chooseKind(preset.kind)"
                  />
                  {{ preset.label }}
                </label>
              }
            </fieldset>
          } @else {
            <p class="muted">{{ kindLabel() }}. The kind cannot change; to use another provider, add it.</p>
          }

          <div class="field">
            <label class="field__label" for="provider-name">Button name</label>
            <input
              id="provider-name"
              class="input"
              name="displayName"
              maxlength="80"
              autocomplete="off"
              [(ngModel)]="displayName"
              [attr.aria-invalid]="errors().displayName ? 'true' : null"
              [attr.aria-describedby]="describe('displayName', 'provider-name-hint')"
            />
            <span class="field__hint" id="provider-name-hint">The sign-in button reads "Continue with" this name.</span>
            @if (errors().displayName; as message) {
              <span class="field__error" id="provider-name-error">{{ message }}</span>
            }
          </div>

          @if (kind() === 'oidc') {
            <div class="field">
              <label class="field__label" for="provider-slug">Slug</label>
              <input
                id="provider-slug"
                class="input input--mono"
                name="slug"
                autocomplete="off"
                spellcheck="false"
                [readOnly]="!!provider()"
                [(ngModel)]="slug"
                [attr.aria-invalid]="errors().slug ? 'true' : null"
                [attr.aria-describedby]="describe('slug', 'provider-slug-hint')"
              />
              <span class="field__hint" id="provider-slug-hint">
                Lower-case letters, digits and hyphens. It names the method "oidc:" followed by the slug, and the
                redirect address.
              </span>
              @if (errors().slug; as message) {
                <span class="field__error" id="provider-slug-error">{{ message }}</span>
              }
            </div>
            <div class="field">
              <label class="field__label" for="provider-issuer">Issuer URL</label>
              <input
                id="provider-issuer"
                class="input"
                name="issuer"
                type="url"
                inputmode="url"
                autocomplete="off"
                spellcheck="false"
                [(ngModel)]="issuer"
                [attr.aria-invalid]="errors().issuer ? 'true' : null"
                [attr.aria-describedby]="describe('issuer', 'provider-issuer-hint')"
              />
              <span class="field__hint" id="provider-issuer-hint">
                The address that serves the provider's discovery document, such as https://id.example.com.
              </span>
              @if (errors().issuer; as message) {
                <span class="field__error" id="provider-issuer-error">{{ message }}</span>
              }
            </div>
          }

          <div class="field">
            <label class="field__label" for="provider-client-id">Client ID</label>
            <input
              id="provider-client-id"
              class="input input--mono"
              name="clientId"
              autocomplete="off"
              spellcheck="false"
              [(ngModel)]="clientId"
              [attr.aria-invalid]="errors().clientId ? 'true' : null"
              [attr.aria-describedby]="describe('clientId')"
            />
            @if (errors().clientId; as message) {
              <span class="field__error" id="provider-client-id-error">{{ message }}</span>
            }
          </div>

          @if (kind() === 'apple') {
            <div class="field">
              <label class="field__label" for="provider-team-id">Team ID</label>
              <input
                id="provider-team-id"
                class="input input--mono"
                name="teamId"
                autocomplete="off"
                spellcheck="false"
                maxlength="10"
                [(ngModel)]="teamId"
                [attr.aria-invalid]="errors().teamId ? 'true' : null"
                [attr.aria-describedby]="describe('teamId', 'provider-team-id-hint')"
              />
              <span class="field__hint" id="provider-team-id-hint"
                >The 10-character team ID from your developer account.</span
              >
              @if (errors().teamId; as message) {
                <span class="field__error" id="provider-team-id-error">{{ message }}</span>
              }
            </div>
            <div class="field">
              <label class="field__label" for="provider-key-id">Key ID</label>
              <input
                id="provider-key-id"
                class="input input--mono"
                name="keyId"
                autocomplete="off"
                spellcheck="false"
                maxlength="10"
                [(ngModel)]="keyId"
                [attr.aria-invalid]="errors().keyId ? 'true' : null"
                [attr.aria-describedby]="describe('keyId', 'provider-key-id-hint')"
              />
              <span class="field__hint" id="provider-key-id-hint">The 10-character key ID of the private key.</span>
              @if (errors().keyId; as message) {
                <span class="field__error" id="provider-key-id-error">{{ message }}</span>
              }
            </div>
          }

          <div class="field">
            @if (provider()?.hasSecret && !replacing()) {
              <span class="field__label">{{ secretName() }}</span>
              @if (removing()) {
                <p class="field__hint" role="status">It will be removed when you save.</p>
                <div class="invite-actions">
                  <button type="button" class="btn btn--secondary" (click)="removing.set(false)">Keep it</button>
                </div>
              } @else {
                <p><span class="pill">Secret is set</span></p>
                <p class="field__hint">The stored value is never shown. Replace it to store a new one.</p>
                <div class="invite-actions">
                  <button type="button" class="btn btn--secondary" (click)="startReplace()">Replace</button>
                  <button type="button" class="btn btn--secondary" (click)="removing.set(true)">Remove</button>
                </div>
              }
            } @else {
              <label class="field__label" for="provider-secret">{{ secretName() }}</label>
              @if (kind() === 'apple') {
                <textarea
                  id="provider-secret"
                  class="input input--mono"
                  name="privateKey"
                  rows="6"
                  autocomplete="off"
                  spellcheck="false"
                  [(ngModel)]="secretValue"
                  [attr.aria-invalid]="errors().secret ? 'true' : null"
                  [attr.aria-describedby]="describe('secret', 'provider-secret-hint')"
                ></textarea>
              } @else {
                <input
                  id="provider-secret"
                  class="input"
                  type="password"
                  name="clientSecret"
                  autocomplete="off"
                  spellcheck="false"
                  [(ngModel)]="secretValue"
                  [attr.aria-invalid]="errors().secret ? 'true' : null"
                  [attr.aria-describedby]="describe('secret', 'provider-secret-hint')"
                />
              }
              <span class="field__hint" id="provider-secret-hint">
                Stored encrypted. It is never shown again after you save.
              </span>
              @if (provider()?.hasSecret) {
                <div class="invite-actions">
                  <button type="button" class="btn btn--ghost" (click)="cancelReplace()">Keep the stored secret</button>
                </div>
              }
              @if (errors().secret; as message) {
                <span class="field__error" id="provider-secret-error">{{ message }}</span>
              }
            }
          </div>

          @if (provider(); as saved) {
            <div class="field">
              <label class="field__label" for="provider-redirect">Redirect URI</label>
              <input
                id="provider-redirect"
                class="input input--mono"
                name="redirectUri"
                readonly
                spellcheck="false"
                autocomplete="off"
                [value]="saved.redirectUri"
                aria-describedby="provider-redirect-hint"
                (focus)="selectAll($event)"
              />
              <p class="field__hint" id="provider-redirect-hint">
                Register this address as an authorized redirect URI at the provider.
              </p>
              <div class="invite-actions">
                <button type="button" class="btn btn--secondary" (click)="copyRedirect(saved)">
                  Copy redirect URI
                </button>
              </div>
              <p class="muted" role="status">{{ copyStatus() }}</p>
            </div>
          } @else {
            <p class="field__hint">
              The redirect URI to register at the provider appears here once the provider is saved.
            </p>
          }

          <div class="field">
            <app-show-switch
              [on]="enabled()"
              [label]="'Turn on ' + (displayName.trim() || 'this provider')"
              [stateText]="enabled() ? 'On' : 'Off'"
              [disabled]="saving()"
              (toggled)="enabled.set($event)"
            />
          </div>

          @if (provider(); as saved) {
            <div class="field">
              <div class="invite-actions">
                <button
                  type="button"
                  class="btn btn--secondary"
                  id="provider-test"
                  [disabled]="testing()"
                  (click)="test(saved)"
                >
                  {{ testing() ? 'Testing…' : 'Test' }}
                </button>
              </div>
              <p class="field__hint">Checks the saved settings against the provider's discovery document.</p>
              @if (testMessage(); as message) {
                <p [class.form-error]="testOk() === false" role="status" id="provider-test-result">{{ message }}</p>
              }
            </div>
          }

          @if (saveError()) {
            <p class="form-error" role="alert">{{ saveError() }}</p>
          }
        </div>

        <div class="drawer__footer">
          <button type="button" class="btn btn--secondary" [disabled]="saving()" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn btn--primary" id="provider-save" [disabled]="saving()">
            {{ saving() ? 'Saving…' : 'Save provider' }}
          </button>
        </div>
      </form>
    </app-drawer>
  `,
})
export class ProviderDrawer implements OnInit {
  private readonly api = inject(SignInMethodsApi);

  /** The provider being edited, or null to add one. */
  readonly provider = input<AuthProvider | null>(null);
  /** Where the drawer puts focus back when it closes, read on close. */
  readonly focusBack = input<() => HTMLElement | null>(() => null);
  readonly saved = output<AuthProvider>();
  readonly closed = output<void>();

  protected readonly presets = PROVIDER_PRESETS;
  protected readonly kind = signal<AuthProviderKind>('google');
  protected readonly enabled = signal(true);
  protected readonly errors = signal<Partial<Record<ProviderField, string>>>({});
  protected readonly saveError = signal('');
  protected readonly saving = signal(false);

  protected readonly replacing = signal(false);
  protected readonly removing = signal(false);
  protected readonly copyStatus = signal('');
  protected readonly testing = signal(false);
  protected readonly testMessage = signal('');
  protected readonly testOk = signal<boolean | null>(null);

  protected displayName = '';
  protected slug = '';
  protected issuer = '';
  protected clientId = '';
  protected teamId = '';
  protected keyId = '';
  protected secretValue = '';

  protected readonly heading = computed(() =>
    this.provider() ? `Edit ${this.provider()?.displayName}` : 'Add a sign-in provider',
  );

  ngOnInit(): void {
    const provider = this.provider();
    if (provider) {
      this.kind.set(provider.kind);
      this.enabled.set(provider.enabled);
      this.displayName = provider.displayName;
      this.slug = provider.slug;
      this.issuer = provider.config.issuer ?? '';
      this.clientId = provider.config.clientId ?? '';
      this.teamId = provider.config.teamId ?? '';
      this.keyId = provider.config.keyId ?? '';
    } else {
      this.chooseKind('google');
    }
  }

  protected kindLabel(): string {
    return this.presets.find((p) => p.kind === this.kind())?.label ?? this.kind();
  }

  protected secretName(): string {
    return secretLabel(this.kind());
  }

  /** Picks the kind of a new provider; the name follows it until the admin types one. */
  protected chooseKind(kind: AuthProviderKind): void {
    this.kind.set(kind);
    const preset = this.presets.find((p) => p.kind === kind);
    if (!preset) return;
    if (!this.displayName.trim()) this.displayName = preset.displayName;
    if (kind !== 'oidc') this.slug = preset.slug;
    else if (this.slug === 'google' || this.slug === 'apple') this.slug = '';
  }

  protected startReplace(): void {
    this.removing.set(false);
    this.replacing.set(true);
    this.secretValue = '';
  }

  protected cancelReplace(): void {
    this.replacing.set(false);
    this.removing.set(false);
    this.secretValue = '';
  }

  protected describe(field: ProviderField, hint = ''): string | null {
    const ids = [hint, this.errors()[field] ? `${FIELD_IDS[field]}-error` : ''].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  // What the drawer does with the stored secret: remove it, replace it with what was typed, or keep it.
  private secretAction(): SecretAction {
    if (this.removing()) return { op: 'remove' };
    const typed = this.secretValue.trim();
    if ((this.replacing() || !this.provider()?.hasSecret) && typed) return { op: 'replace', value: this.secretValue };
    return { op: 'keep' };
  }

  private draft(): ProviderDraft {
    return {
      kind: this.kind(),
      slug: this.slug,
      displayName: this.displayName,
      enabled: this.enabled(),
      issuer: this.issuer,
      clientId: this.clientId,
      teamId: this.teamId,
      keyId: this.keyId,
    };
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const provider = this.provider();
    const draft = this.draft();
    const secret = this.secretAction();
    const found = providerProblems(draft, provider?.hasSecret ?? false, secret, !provider);
    this.errors.set(found);
    this.saveError.set('');
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(FIELD_IDS[first as ProviderField])?.focus();
      return;
    }
    const slug = provider?.slug ?? (draft.kind === 'oidc' ? draft.slug.trim() : draft.kind);
    this.saving.set(true);
    try {
      const saved = await this.api.saveProvider(slug, providerBody(draft, secret));
      this.secretValue = '';
      this.saved.emit(saved);
    } catch (err) {
      this.saveError.set(adminRefusal(err, 'The provider was not saved. Try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async copyRedirect(provider: AuthProvider): Promise<void> {
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(provider.redirectUri);
      this.copyStatus.set('Redirect URI copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the address and copy it.');
    }
  }

  protected async test(provider: AuthProvider): Promise<void> {
    if (this.testing()) return;
    this.testing.set(true);
    this.testMessage.set('');
    try {
      const result = await this.api.testProvider(provider.slug);
      this.testOk.set(result.ok);
      this.testMessage.set(providerTestText(result));
    } catch (err) {
      this.testOk.set(false);
      this.testMessage.set(adminRefusal(err, 'The test did not run. Try again.'));
    } finally {
      this.testing.set(false);
    }
  }
}
