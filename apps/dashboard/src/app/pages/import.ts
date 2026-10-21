import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { isImportActive, type ImportJobSummary, type StorylyApp } from '@taleart/contract';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { ImportService } from '../import.service';
import { IMPORT_PILL_STYLES, importStatusClass, importStatusLabel, importTimeText } from './import-shared';

/**
 * "Import from Storyly" for one project (admins only): paste a Storyly API
 * token, find its apps, pick one and start; starting opens the import's own
 * page, which follows it. Below the form, the project's past imports with
 * their state, times and failure reason, each opening its page and report.
 */
@Component({
  selector: 'app-import-page',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    IMPORT_PILL_STYLES,
    `
      .import-section {
        max-width: 640px;
      }
      .import-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .import-form__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
      }
      .import-history {
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .import-history__run {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
        padding: var(--space-4) 0;
        border-top: 1px solid var(--border);
      }
      .import-history__run:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .import-history__head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-3);
      }
      .import-history__app {
        font-weight: 600;
      }
      .import-history__times {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1) var(--space-6);
        margin: 0;
        color: var(--text-secondary);
      }
      .import-history__times dt {
        display: inline;
        font-weight: 600;
      }
      .import-history__times dd {
        display: inline;
        margin: 0 0 0 var(--space-1);
      }
      .import-history__error {
        margin: 0;
        color: var(--danger-text);
      }
    `,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <a class="back-link" routerLink="/projects"><app-icon name="back" /> Projects</a>
        <h2 class="page-header__title">Import from Storyly</h2>
        @if (store.loaded()) {
          <p class="page-header__meta">into {{ store.projectName(projectId()) }}</p>
        }
      </header>

      @if (!auth.isAdmin()) {
        <section class="card section import-section">
          <p class="muted">Only admins can import content.</p>
        </section>
      } @else {
        <section class="card section import-section" aria-labelledby="import-form-title">
          <h3 class="section__title" id="import-form-title">Storyly account</h3>
          <form class="import-form" (ngSubmit)="findApps()" novalidate>
            <div class="field">
              <label class="field__label" for="import-token">Storyly API token</label>
              <input
                id="import-token"
                class="input"
                name="token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                [(ngModel)]="token"
                (ngModelChange)="tokenChanged()"
                [attr.aria-invalid]="error() ? 'true' : null"
                [attr.aria-describedby]="error() ? 'import-token-hint import-error' : 'import-token-hint'"
              />
              <span class="field__hint" id="import-token-hint">
                Used only for this import and deleted from TaleArt when the import ends.
              </span>
            </div>
            <div class="import-form__actions">
              <button type="submit" class="btn btn--secondary" [disabled]="busy()">
                {{ busy() && apps().length === 0 ? 'Finding apps…' : 'Find apps' }}
              </button>
            </div>
          </form>

          @if (apps().length > 0) {
            <form class="import-form" (ngSubmit)="start()" novalidate>
              <div class="field">
                <label class="field__label" for="import-app">App</label>
                <select id="import-app" class="select" name="appId" [(ngModel)]="appId">
                  @for (app of apps(); track app.id) {
                    <option [value]="app.id">{{ app.name }}</option>
                  }
                </select>
              </div>
              <div class="import-form__actions">
                <button type="submit" class="btn btn--primary" [disabled]="busy()">Start import</button>
              </div>
            </form>
          }

          @if (error()) {
            <p class="form-error" id="import-error" role="alert">{{ error() }}</p>
          }
        </section>

        <section class="card section import-section" aria-labelledby="import-history-title">
          <h3 class="section__title" id="import-history-title">Past imports</h3>
          @if (history(); as history) {
            @if (history.length === 0) {
              <p class="muted">No imports into this project yet.</p>
            } @else {
              <ul class="import-history" aria-label="Past imports">
                @for (run of history; track run.id) {
                  <li class="import-history__run">
                    <div class="import-history__head">
                      <span [class]="statusClass(run.status)">{{ statusLabel(run.status) }}</span>
                      <span class="import-history__app">{{ run.sourceAppName ?? 'App not read yet' }}</span>
                    </div>
                    <dl class="import-history__times">
                      <div>
                        <dt>Started</dt>
                        <dd>
                          @if (run.startedAt) {
                            <time [attr.datetime]="run.startedAt">{{ time(run.startedAt) }}</time>
                          } @else {
                            not yet
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>Finished</dt>
                        <dd>
                          @if (run.finishedAt) {
                            <time [attr.datetime]="run.finishedAt">{{ time(run.finishedAt) }}</time>
                          } @else {
                            not yet
                          }
                        </dd>
                      </div>
                    </dl>
                    @if (run.status === 'failed') {
                      <p class="import-history__error">{{ run.error || 'The import failed.' }}</p>
                    }
                    <a class="btn btn--secondary btn--sm" [routerLink]="['/projects', projectId(), 'import', run.id]">
                      {{ isActive(run.status) ? 'View progress' : 'View report' }}
                    </a>
                  </li>
                }
              </ul>
            }
          } @else if (historyError()) {
            <p class="form-error" role="alert">{{ historyError() }}</p>
          } @else {
            <p class="muted">Loading past imports…</p>
          }
        </section>
      }
    </div>
  `,
})
export class ImportPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly imports = inject(ImportService);
  private readonly router = inject(Router);

  /** The project to import into, bound from the route's `:projectId`. */
  readonly projectId = input.required<string>();

  protected token = '';
  protected appId = '';
  protected readonly apps = signal<StorylyApp[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** The project's imports, newest first; null until read. */
  protected readonly history = signal<ImportJobSummary[] | null>(null);
  protected readonly historyError = signal('');

  protected readonly statusLabel = importStatusLabel;
  protected readonly statusClass = importStatusClass;
  protected readonly time = importTimeText;
  protected readonly isActive = isImportActive;

  ngOnInit(): void {
    // The imported zones show on the Zones page of this project.
    this.store.selectProject(this.projectId());
    if (this.auth.isAdmin()) void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const { value, message } = await this.imports.list(this.projectId());
    if (value === null) {
      this.historyError.set(message);
      return;
    }
    this.history.set(value);
  }

  // A new token needs its own apps.
  protected tokenChanged(): void {
    if (this.apps().length > 0) {
      this.apps.set([]);
      this.appId = '';
    }
  }

  protected async findApps(): Promise<void> {
    if (this.busy()) return;
    const token = this.token.trim();
    if (!token) {
      this.error.set('Paste a Storyly API token.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const { value, message } = await this.imports.findApps(this.projectId(), token);
    this.busy.set(false);
    if (value === null) {
      this.error.set(message);
      return;
    }
    if (value.length === 0) {
      this.error.set('This token has no apps to import.');
      return;
    }
    this.apps.set(value);
    this.appId = value[0].id;
  }

  protected async start(): Promise<void> {
    if (this.busy()) return;
    const token = this.token.trim();
    if (!token || !this.appId) return;
    this.busy.set(true);
    this.error.set('');
    const { value, message } = await this.imports.start(this.projectId(), token, this.appId);
    this.busy.set(false);
    if (value === null) {
      this.error.set(message);
      return;
    }
    // The server holds the token now, encrypted, until the import ends.
    this.token = '';
    this.apps.set([]);
    // The import's own URL, so a reload keeps following it.
    await this.router.navigate(['/projects', this.projectId(), 'import', value.id]);
  }
}
