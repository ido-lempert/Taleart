import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isImportActive, type ImportJob } from '@taleart/contract';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { IMPORT_POLL_INTERVAL_MS, ImportService } from '../import.service';
import {
  IMPORT_PILL_STYLES,
  importCountText,
  importProgressText,
  importStatusClass,
  importStatusLabel,
  importTimeText,
} from './import-shared';

/**
 * One import of a project, at its own URL so a reload keeps following it
 * (admins only). The page reads the job at once and then every 2 s while it is
 * queued or running, showing per-entity progress (read so far, written so
 * far); when it ends it shows the report, or the failure reason with how far
 * the job got.
 */
@Component({
  selector: 'app-import-job-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    IMPORT_PILL_STYLES,
    `
      .import-section {
        max-width: 640px;
      }
      .import-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
      }
      .import-times {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-6);
        margin: 0;
        color: var(--text-secondary);
      }
      .import-times dt {
        display: inline;
        font-weight: 600;
      }
      .import-times dd {
        display: inline;
        margin: 0 0 0 var(--space-1);
      }
      .import-counts {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .import-counts li {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .import-notes {
        margin: 0;
        padding-left: var(--space-5);
        color: var(--text-secondary);
      }
    `,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <a class="back-link" [routerLink]="['/projects', projectId(), 'import']">
          <app-icon name="back" /> Import from Storyly
        </a>
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
        <section class="card section import-section" aria-labelledby="import-status-title">
          <div class="section__header">
            <h3 class="section__title" id="import-status-title">Import status</h3>
            @if (job(); as job) {
              <span role="status">
                <span [class]="statusClass(job.status)">{{ statusLabel(job.status) }}</span>
              </span>
            }
          </div>

          @if (job(); as job) {
            @if (job.sourceAppName) {
              <p class="muted">From the app {{ job.sourceAppName }}</p>
            }
            <dl class="import-times">
              <div>
                <dt>Started</dt>
                <dd>
                  @if (job.startedAt) {
                    <time [attr.datetime]="job.startedAt">{{ time(job.startedAt) }}</time>
                  } @else {
                    not yet
                  }
                </dd>
              </div>
              @if (job.finishedAt) {
                <div>
                  <dt>Finished</dt>
                  <dd><time [attr.datetime]="job.finishedAt">{{ time(job.finishedAt) }}</time></dd>
                </div>
              }
            </dl>

            @if (job.report; as report) {
              <ul class="import-counts" aria-label="Report">
                <li>Zones: {{ countText(report.zones) }}</li>
                @if (report.taleGroups; as taleGroups) {
                  <li>Tale groups: {{ countText(taleGroups) }}</li>
                }
                @if (report.tales; as tales) {
                  <li>Tales: {{ countText(tales) }}</li>
                }
              </ul>
              @if (report.notes.length > 0) {
                <ul class="import-notes" aria-label="Notes">
                  @for (note of report.notes; track $index) {
                    <li>{{ note }}</li>
                  }
                </ul>
              }
            } @else if (job.progress; as progress) {
              <ul class="import-counts" aria-label="Progress" aria-live="polite">
                <li>Zones: {{ progressText(progress.zones) }}</li>
                <li>Tale groups: {{ progressText(progress.taleGroups) }}</li>
                <li>Tales: {{ progressText(progress.tales) }}</li>
              </ul>
            }
            @if (active()) {
              <p class="muted">
                {{ job.status === 'queued' ? 'Waiting to start.' : 'Importing.' }}
                The import runs on the server; you can leave this page and come back.
              </p>
            }
            @if (job.status === 'failed') {
              <p class="form-error" role="alert">{{ job.error || 'The import failed.' }}</p>
            }
          } @else if (!error()) {
            <p class="muted">Loading the import…</p>
          }

          @if (error()) {
            <p class="form-error" role="alert">{{ error() }}</p>
          }
          @if (job() && !active()) {
            <div class="import-actions">
              @if (job()?.status === 'done') {
                <a class="btn btn--primary" routerLink="/zones">See zones</a>
              }
              <a class="btn btn--secondary" [routerLink]="['/projects', projectId(), 'import']">Start another import</a>
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class ImportJobPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly imports = inject(ImportService);
  private readonly pollInterval = inject(IMPORT_POLL_INTERVAL_MS);

  /** The project, bound from the route's `:projectId`. */
  readonly projectId = input.required<string>();
  /** The import job, bound from the route's `:importId`. */
  readonly importId = input.required<string>();

  protected readonly job = signal<ImportJob | null>(null);
  protected readonly error = signal('');
  protected readonly active = computed(() => {
    const job = this.job();
    return job !== null && isImportActive(job.status);
  });

  protected readonly statusLabel = importStatusLabel;
  protected readonly statusClass = importStatusClass;
  protected readonly countText = importCountText;
  protected readonly progressText = importProgressText;
  protected readonly time = importTimeText;

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
    if (this.auth.isAdmin()) void this.read();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.read(), this.pollInterval);
  }

  private async read(): Promise<void> {
    const wasActive = this.active();
    const { value, message } = await this.imports.job(this.projectId(), this.importId());
    if (this.destroyed) return;
    if (value === null) {
      this.error.set(message);
      // A job we were following keeps running on the server: try again at the next poll.
      // A job that could not be read at all (such as an unknown id) is not retried.
      if (wasActive) this.schedule();
      return;
    }
    this.error.set('');
    this.job.set(value);
    if (isImportActive(value.status)) {
      this.schedule();
    } else if (value.status === 'done') {
      // The import may have added zones since the dashboard loaded: load them so
      // the Zones page and project cards show them.
      await this.store.refresh();
    }
  }
}
