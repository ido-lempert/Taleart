import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { isImportActive, type ImportJob, type ImportStatus, type StorylyApp } from '@taleart/contract';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { IMPORT_POLL_INTERVAL_MS, ImportService } from '../import.service';

const STATUS_LABELS: Record<ImportStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

/**
 * "Import from Storyly" for one project (admins only): paste a Storyly API
 * token, find its apps, pick one and start. The import runs on the server; the
 * page reads its state every 2 s while it is queued or running, then shows the report.
 */
@Component({
  selector: 'app-import-page',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
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
    .import-status {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .pill--done {
      background: #ecfdf3;
      color: #067647;
    }
    .pill--failed {
      background: var(--danger-tint);
      color: var(--danger-text);
    }
    .pill--active {
      background: var(--ember-tint);
      color: var(--ember-strong-hover);
    }
    .import-report {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .import-report__row {
      font-weight: 600;
    }
    .import-notes {
      margin: 0;
      padding-left: var(--space-5);
      color: var(--text-secondary);
    }
  `,
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
      } @else if (job(); as job) {
        <section class="card section import-section" aria-labelledby="import-status-title">
          <div class="section__header">
            <h3 class="section__title" id="import-status-title">Import status</h3>
            <span class="import-status" role="status">
              <span class="pill" [class]="statusClass(job.status)">{{ statusLabel(job.status) }}</span>
            </span>
          </div>
          @if (job.sourceAppName) {
            <p class="muted">From the app {{ job.sourceAppName }}</p>
          }
          @if (job.report; as report) {
            <ul class="import-report" aria-label="Report">
              <li class="import-report__row">
                Zones: {{ report.zones.source }} source / {{ report.zones.imported }} imported{{
                  report.zones.skipped > 0 ? ' / ' + report.zones.skipped + ' skipped' : ''
                }}
              </li>
            </ul>
            @if (report.notes.length > 0) {
              <ul class="import-notes" aria-label="Notes">
                @for (note of report.notes; track $index) {
                  <li>{{ note }}</li>
                }
              </ul>
            }
          } @else if (active()) {
            <p class="muted">The import runs on the server. You can leave this page; it keeps running.</p>
          }
          @if (job.status === 'failed') {
            <p class="form-error" role="alert">{{ job.error || 'The import failed.' }}</p>
          }
          @if (error()) {
            <p class="form-error" role="alert">{{ error() }}</p>
          }
          @if (!active()) {
            <div class="import-form__actions">
              @if (job.status === 'done') {
                <a class="btn btn--primary" routerLink="/zones">See zones</a>
              }
              <button type="button" class="btn btn--secondary" (click)="again()">Start another import</button>
            </div>
          }
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
      }
    </div>
  `,
})
export class ImportPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly imports = inject(ImportService);
  private readonly pollInterval = inject(IMPORT_POLL_INTERVAL_MS);

  /** The project to import into, bound from the route's `:projectId`. */
  readonly projectId = input.required<string>();

  protected token = '';
  protected appId = '';
  protected readonly apps = signal<StorylyApp[]>([]);
  protected readonly job = signal<ImportJob | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly active = computed(() => {
    const job = this.job();
    return job !== null && isImportActive(job.status);
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
    });
  }

  ngOnInit(): void {
    // The imported zones show on the Zones page of this project.
    this.store.selectProject(this.projectId());
  }

  protected statusLabel(status: ImportStatus): string {
    return STATUS_LABELS[status];
  }

  protected statusClass(status: ImportStatus): string {
    return `pill ${status === 'done' ? 'pill--done' : status === 'failed' ? 'pill--failed' : 'pill--active'}`;
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
    this.job.set({
      id: value.id,
      status: value.status,
      sourceAppName: null,
      report: null,
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    this.schedulePoll(value.id);
  }

  protected again(): void {
    clearTimeout(this.timer);
    this.job.set(null);
    this.error.set('');
  }

  private schedulePoll(importId: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(importId), this.pollInterval);
  }

  private async poll(importId: string): Promise<void> {
    const { value, message } = await this.imports.job(this.projectId(), importId);
    if (this.destroyed || this.job()?.id !== importId) return;
    if (value === null) {
      // The job keeps running on the server; try again at the next poll.
      this.error.set(message);
      this.schedulePoll(importId);
      return;
    }
    this.error.set('');
    this.job.set(value);
    if (isImportActive(value.status)) {
      this.schedulePoll(importId);
    } else if (value.status === 'done') {
      // New zones: load them so the Zones page and project cards show them.
      await this.store.refresh();
    }
  }
}
