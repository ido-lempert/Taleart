import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  isErrorBody,
  MAX_API_TOKEN_NAME_LENGTH,
  type ApiToken,
  type CreateApiTokenRequest,
  type IssuedApiToken,
  type Project,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { SettingsTabs } from './settings-tabs';

const TOKENS_URL = `${API_BASE}/api-tokens`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The expiry choices of a new token, in days; 0 is never. */
export const EXPIRY_CHOICES: readonly { days: number; label: string }[] = [
  { days: 7, label: 'In 7 days' },
  { days: 30, label: 'In 30 days' },
  { days: 90, label: 'In 90 days' },
  { days: 365, label: 'In 1 year' },
  { days: 0, label: 'Never' },
];

/** The fields of the create form that can be refused. */
type TokenField = 'name' | 'projects';

// The API's own message when it sent the standard error body, else the fallback.
function refusal(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return `${fallback} Check the connection.`;
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

/** The token as the list shows it: everything but the secret. */
function withoutSecret(issued: IssuedApiToken): ApiToken {
  const shown: Partial<IssuedApiToken> = { ...issued };
  delete shown.token;
  return shown as ApiToken;
}

/** What a token may do and where, as one line: "Read-only · All your projects". */
export function tokenScope(token: Pick<ApiToken, 'readOnly' | 'projectIds'>, projects: readonly Project[]): string {
  const access = token.readOnly ? 'Read-only' : 'Read and write';
  if (token.projectIds === null) return `${access} · All your projects`;
  const names = token.projectIds.map((id) => projects.find((p) => p.id === id)?.name);
  const known = names.filter((name): name is string => !!name);
  const gone = names.length - known.length;
  const parts = [...known];
  if (gone) parts.push(gone === 1 ? '1 project you can no longer open' : `${gone} projects you can no longer open`);
  return `${access} · ${parts.join(', ')}`;
}

/**
 * Settings > API tokens (epic developer experience 10.1): personal tokens for scripts and the
 * `taleart` CLI. A token acts as the signed-in user, limited to some or all of their projects and,
 * by default, to reading. It is shown once, in a drawer with Copy; the list shows each token's
 * prefix, scope, dates and a Revoke that asks first. Every control is labelled, errors are tied to
 * their fields and announced, and the page works with the keyboard alone.
 */
@Component({
  selector: 'app-api-tokens-page',
  imports: [Drawer, SettingsTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tokens-section {
      max-width: 720px;
    }
    .tokens-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .tokens-choices {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .tokens-choices legend {
      margin-bottom: var(--space-2);
      padding: 0;
    }
    .tokens-projects {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0 0 0 var(--space-6);
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .tokens-expiry {
      max-width: 240px;
    }
    .tokens-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .tokens-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .token {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .token__text {
      display: flex;
      flex: 1 1 16rem;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 0;
    }
    .token__name {
      margin: 0;
      font-size: var(--text-md);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .token__facts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-4);
      margin: 0;
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }
    .token__facts div {
      display: flex;
      gap: var(--space-1);
    }
    .token__facts dt {
      font-weight: 600;
    }
    .token__facts dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .token__scope {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .token__expired {
      color: var(--danger-text);
      font-weight: 600;
    }
  `,
  template: `
    <div class="page">
      <app-settings-tabs />
      <header class="page-header">
        <h2 class="page-header__title">API tokens</h2>
        <p class="page-header__meta">
          Personal tokens for scripts and the TaleArt command-line tool. A token acts as you, limited to the projects
          and access you give it, and stops working the moment you revoke it.
        </p>
      </header>

      <section class="card section tokens-section" aria-labelledby="api-token-create-title">
        <h3 class="section__title" id="api-token-create-title">Create a token</h3>
        <form class="tokens-form" (submit)="$event.preventDefault(); create($event)" novalidate>
          <div class="field">
            <label class="field__label" for="api-token-name">Name</label>
            <input
              id="api-token-name"
              class="input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              aria-required="true"
              [attr.maxlength]="maxName"
              [value]="name()"
              [attr.aria-invalid]="errors().name ? 'true' : null"
              [attr.aria-describedby]="errors().name ? 'api-token-name-hint api-token-name-error' : 'api-token-name-hint'"
              (input)="name.set($any($event.target).value)"
            />
            <span class="field__hint" id="api-token-name-hint">What it is for, such as "Nightly import script".</span>
            @if (errors().name) {
              <span class="field__error" id="api-token-name-error">{{ errors().name }}</span>
            }
          </div>

          <fieldset
            class="tokens-choices"
            [attr.aria-invalid]="errors().projects ? 'true' : null"
            [attr.aria-describedby]="errors().projects ? 'api-token-projects-error' : null"
          >
            <legend class="field__label">Projects</legend>
            <label class="checkbox">
              <input
                type="radio"
                name="api-token-scope"
                id="api-token-all"
                [checked]="allProjects()"
                (change)="allProjects.set(true)"
              />
              All my projects, including ones I get later
            </label>
            <label class="checkbox">
              <input
                type="radio"
                name="api-token-scope"
                id="api-token-some"
                [checked]="!allProjects()"
                (change)="allProjects.set(false)"
              />
              Only the projects I pick
            </label>
            @if (!allProjects()) {
              <fieldset class="tokens-projects">
                <legend class="visually-hidden">Projects the token can reach</legend>
                @for (project of store.projects(); track project.id) {
                  <label class="checkbox">
                    <input
                      type="checkbox"
                      [checked]="picked().has(project.id)"
                      (change)="toggle(project.id, $any($event.target).checked)"
                    />
                    {{ project.name }}
                  </label>
                } @empty {
                  <p class="muted">You have no projects yet.</p>
                }
              </fieldset>
            }
            @if (errors().projects) {
              <span class="field__error" id="api-token-projects-error">{{ errors().projects }}</span>
            }
          </fieldset>

          <div class="field">
            <label class="checkbox" for="api-token-read-only">
              <input
                id="api-token-read-only"
                type="checkbox"
                aria-describedby="api-token-read-only-hint"
                [checked]="readOnly()"
                (change)="readOnly.set($any($event.target).checked)"
              />
              Read-only
            </label>
            <span class="field__hint" id="api-token-read-only-hint">
              A read-only token can read zones, tale groups and tales but cannot change anything. Clear it only for a
              script that must make changes.
            </span>
          </div>

          <div class="field tokens-expiry">
            <label class="field__label" for="api-token-expiry">Expires</label>
            <select
              id="api-token-expiry"
              class="select"
              aria-describedby="api-token-expiry-hint"
              (change)="expiryDays.set(+$any($event.target).value)"
            >
              @for (choice of expiryChoices; track choice.days) {
                <option [value]="choice.days" [selected]="choice.days === expiryDays()">{{ choice.label }}</option>
              }
            </select>
            <span class="field__hint" id="api-token-expiry-hint">An expired token stops working; create a new one then.</span>
          </div>

          @if (createError()) {
            <p class="form-error" role="alert">{{ createError() }}</p>
          }
          <div class="tokens-actions">
            <button type="submit" class="btn btn--primary" id="api-token-create" [disabled]="creating()">
              {{ creating() ? 'Creating…' : 'Create token' }}
            </button>
          </div>
        </form>
      </section>

      <section class="card section tokens-section" aria-labelledby="api-tokens-list-title">
        <h3 class="section__title" id="api-tokens-list-title" tabindex="-1">Your tokens</h3>
        @if (readFailed()) {
          <div class="tokens-actions" role="alert">
            <p class="form-error">Your tokens could not be read.</p>
            <button type="button" class="btn btn--secondary btn--sm" (click)="read()">Retry</button>
          </div>
        } @else if (loaded()) {
          @if (tokens().length === 0) {
            <p class="muted" id="api-tokens-empty">
              No API tokens yet. Create one above for a script or the command-line tool.
            </p>
          } @else {
            <ul class="tokens-list" aria-labelledby="api-tokens-list-title">
              @for (token of tokens(); track token.id) {
                <li class="token">
                  <div class="token__text">
                    <h4 class="token__name">{{ token.name }}</h4>
                    <p class="token__scope">{{ scope(token) }}</p>
                    <dl class="token__facts">
                      <div>
                        <dt>Token</dt>
                        <dd><code class="key-prefix">{{ token.prefix }}…</code></dd>
                      </div>
                      <div>
                        <dt>Created</dt>
                        <dd>{{ date(token.createdAt) }}</dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{{ token.lastUsedAt ? dateTime(token.lastUsedAt) : 'Never' }}</dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        @if (expired(token)) {
                          <dd class="token__expired">Expired {{ date(token.expiresAt!) }}</dd>
                        } @else {
                          <dd>{{ token.expiresAt ? date(token.expiresAt) : 'Never' }}</dd>
                        }
                      </div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    [attr.aria-label]="'Revoke ' + token.name"
                    (click)="askRevoke(token, $event)"
                  >
                    Revoke
                  </button>
                </li>
              }
            </ul>
          }
        }
        <p class="visually-hidden" role="status">{{ announcement() }}</p>
      </section>
    </div>

    @if (issued(); as token) {
      <app-drawer heading="Token created" [returnFocus]="focusBack" (closed)="closeIssued()">
        <div class="drawer__form">
          <div class="drawer__body">
            <div class="field">
              <label class="field__label" for="api-token-value">API token</label>
              <input
                id="api-token-value"
                class="input input--mono"
                name="apiToken"
                readonly
                spellcheck="false"
                autocomplete="off"
                [value]="token.token"
                aria-describedby="api-token-value-hint"
                (focus)="selectAll($event)"
              />
              <p class="field__hint" id="api-token-value-hint">
                Shown only now. Copy it into your script's secret settings; TaleArt keeps only a hash and cannot show it
                again. Send it as <code>Authorization: Bearer</code> followed by the token.
              </p>
            </div>
            <p>{{ token.name }}: {{ scope(token) }}.</p>
            <div class="invite-actions">
              <button type="button" class="btn btn--secondary" id="api-token-copy" (click)="copy(token)">Copy token</button>
            </div>
            <p class="muted" role="status">{{ copyStatus() }}</p>
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--primary" (click)="closeIssued()">Done</button>
          </div>
        </div>
      </app-drawer>
    }

    @if (revoking(); as token) {
      <app-drawer
        heading="Revoke API token"
        dialogRole="alertdialog"
        describedBy="api-token-revoke-text"
        [returnFocus]="focusBack"
        [busy]="busy()"
        (closed)="closeRevoke()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); revoke()" novalidate>
          <div class="drawer__body">
            <p id="api-token-revoke-text">
              Revoke <strong>{{ token.name }}</strong> (<code class="key-prefix">{{ token.prefix }}…</code>)?
              Scripts that use it stop working at once. This cannot be undone.
            </p>
            @if (revokeError()) {
              <p class="form-error" role="alert">{{ revokeError() }}</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="closeRevoke()">Cancel</button>
            <button type="submit" class="btn btn--danger" id="api-token-revoke" [disabled]="busy()">Revoke token</button>
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class ApiTokensPage {
  private readonly http = inject(HttpClient);
  protected readonly store = inject(DashboardStore);

  protected readonly maxName = MAX_API_TOKEN_NAME_LENGTH;
  protected readonly expiryChoices = EXPIRY_CHOICES;

  protected readonly tokens = signal<ApiToken[]>([]);
  protected readonly loaded = signal(false);
  protected readonly readFailed = signal(false);

  protected readonly name = signal('');
  protected readonly allProjects = signal(true);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly readOnly = signal(true);
  protected readonly expiryDays = signal(30);
  protected readonly errors = signal<Partial<Record<TokenField, string>>>({});
  protected readonly createError = signal('');
  protected readonly creating = signal(false);

  /** The token just created: shown once, in the drawer, then forgotten. */
  protected readonly issued = signal<IssuedApiToken | null>(null);
  protected readonly copyStatus = signal('');

  protected readonly revoking = signal<ApiToken | null>(null);
  protected readonly revokeError = signal('');
  protected readonly busy = signal(false);
  protected readonly announcement = signal('');
  private returnFocus: HTMLElement | null = null;
  /** Where a drawer puts focus back, read when it closes (the Revoke button may be gone by then). */
  protected readonly focusBack = () => this.returnFocus;

  private readonly projects = computed(() => this.store.projects());

  constructor() {
    void this.read();
  }

  protected async read(): Promise<void> {
    this.readFailed.set(false);
    try {
      this.tokens.set(await firstValueFrom(this.http.get<ApiToken[]>(TOKENS_URL)));
      this.loaded.set(true);
    } catch {
      this.readFailed.set(true);
    }
  }

  protected scope(token: Pick<ApiToken, 'readOnly' | 'projectIds'>): string {
    return tokenScope(token, this.projects());
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected dateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected expired(token: ApiToken): boolean {
    return token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now();
  }

  protected toggle(projectId: string, on: boolean): void {
    const next = new Set(this.picked());
    if (on) next.add(projectId);
    else next.delete(projectId);
    this.picked.set(next);
  }

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  // The form's problems, by field; empty when it can be sent.
  private check(): Partial<Record<TokenField, string>> {
    const found: Partial<Record<TokenField, string>> = {};
    const name = this.name().trim();
    if (!name) found.name = 'Enter a name for the token.';
    else if ([...name].length > MAX_API_TOKEN_NAME_LENGTH) found.name = `Use at most ${MAX_API_TOKEN_NAME_LENGTH} characters.`;
    if (!this.allProjects() && this.pickedIds().length === 0) found.projects = 'Pick at least one project, or choose all.';
    return found;
  }

  // The picked projects that are still the user's, in the order the switcher lists them.
  private pickedIds(): string[] {
    return this.projects()
      .map((p) => p.id)
      .filter((id) => this.picked().has(id));
  }

  protected async create(event: Event): Promise<void> {
    if (this.creating()) return;
    const found = this.check();
    this.errors.set(found);
    this.createError.set('');
    if (found.name || found.projects) {
      document.getElementById(found.name ? 'api-token-name' : this.allProjects() ? 'api-token-all' : 'api-token-some')?.focus();
      return;
    }
    const days = this.expiryDays();
    const body: CreateApiTokenRequest = {
      name: this.name().trim(),
      projectIds: this.allProjects() ? null : this.pickedIds(),
      readOnly: this.readOnly(),
      expiresAt: days ? new Date(Date.now() + days * DAY_MS).toISOString() : null,
    };
    this.returnFocus = (event.target as HTMLFormElement).querySelector<HTMLElement>('#api-token-create');
    this.creating.set(true);
    try {
      const token = await firstValueFrom(this.http.post<IssuedApiToken>(TOKENS_URL, body));
      this.tokens.update((list) => [withoutSecret(token), ...list]);
      this.loaded.set(true);
      this.copyStatus.set('');
      this.issued.set(token);
      this.name.set('');
      this.picked.set(new Set());
      this.allProjects.set(true);
      this.readOnly.set(true);
      this.announcement.set(`Token ${token.name} created.`);
    } catch (err) {
      this.createError.set(refusal(err, 'The token was not created. Try again.'));
    } finally {
      this.creating.set(false);
    }
  }

  protected async copy(token: IssuedApiToken): Promise<void> {
    // Cleared first, so copying twice announces again.
    this.copyStatus.set('');
    try {
      await navigator.clipboard.writeText(token.token);
      this.copyStatus.set('Token copied');
    } catch {
      this.copyStatus.set('Could not copy. Select the token and copy it.');
    }
  }

  /** Closes the shown-once drawer: the token is dropped from memory and never shown again. */
  protected closeIssued(): void {
    this.issued.set(null);
    this.copyStatus.set('');
  }

  protected askRevoke(token: ApiToken, event: Event): void {
    this.returnFocus = event.currentTarget as HTMLElement;
    this.revokeError.set('');
    this.revoking.set(token);
  }

  protected closeRevoke(): void {
    if (this.busy()) return;
    this.revoking.set(null);
  }

  protected async revoke(): Promise<void> {
    const token = this.revoking();
    if (!token || this.busy()) return;
    this.busy.set(true);
    this.revokeError.set('');
    try {
      await firstValueFrom(this.http.delete<void>(`${TOKENS_URL}/${encodeURIComponent(token.id)}`));
    } catch (err) {
      // Already revoked elsewhere (404): it is gone either way.
      if (!(err instanceof HttpErrorResponse && err.status === 404)) {
        this.busy.set(false);
        this.revokeError.set(refusal(err, 'The token was not revoked. Try again.'));
        return;
      }
    }
    this.busy.set(false);
    this.tokens.update((list) => list.filter((t) => t.id !== token.id));
    // The Revoke button that opened the drawer is gone with its token: focus the list's heading.
    this.returnFocus = document.getElementById('api-tokens-list-title');
    this.revoking.set(null);
    this.announcement.set(`Token ${token.name} revoked.`);
  }
}
