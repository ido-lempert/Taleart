import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { isImportActive, type ImportJob } from '@taleart/contract';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { IMPORT_POLL_INTERVAL_MS, ImportService } from '../import.service';
import {
  IMPORT_DIFFERENCES_OPEN_LIMIT,
  IMPORT_DIFFERENCES_PAGE,
  IMPORT_PILL_STYLES,
  type ImportDifferenceGroupView,
  importCountText,
  importDifferenceGroups,
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
      .import-differences {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .import-differences__title {
        margin: 0;
        font-size: 1rem;
      }
      .import-differences p {
        margin: 0;
      }
      .import-difference-group {
        border: 1px solid var(--border);
        border-radius: var(--radius-control);
        background: var(--surface);
      }
      .import-difference-group summary {
        padding: var(--space-2) var(--space-3);
        font-weight: 600;
        cursor: pointer;
        font-variant-numeric: tabular-nums;
      }
      /* A long list scrolls inside its group, so the page stays short. */
      .import-difference-records {
        max-height: 420px;
        overflow-y: auto;
        margin: 0;
        padding: 0 var(--space-3) var(--space-3);
        list-style: none;
        border-top: 1px solid var(--border);
      }
      .import-difference-records > li {
        padding: var(--space-2) 0;
        border-bottom: 1px solid var(--border);
        overflow-wrap: anywhere;
      }
      .import-difference-records > li:last-child {
        border-bottom: 0;
      }
      .import-difference-record {
        font-weight: 600;
      }
      .import-difference-lines {
        margin: var(--space-1) 0 0;
        padding-left: var(--space-5);
        color: var(--text-secondary);
      }
      .import-difference-more {
        padding: 0 var(--space-3) var(--space-3);
      }
      .import-by-design {
        margin: 0;
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
                @if (report.media; as media) {
                  <li>Media: {{ countText(media) }}</li>
                }
              </ul>
              @if (report.notes.length > 0) {
                <ul class="import-notes" aria-label="Notes">
                  @for (note of report.notes; track $index) {
                    <li>{{ note }}</li>
                  }
                </ul>
              }
              @if (report.differences; as differences) {
                <section class="import-differences" aria-labelledby="import-differences-title">
                  <h4 class="import-differences__title" id="import-differences-title">
                    Differences ({{ differences.length + (report.differencesOmitted ?? 0) }})
                  </h4>
                  @if (differences.length === 0) {
                    <p class="muted">No differences: every record matched the shape the import expects.</p>
                  } @else {
                    <p class="muted">What the source holds that did not come across as it was, record by record.</p>
                  }
                  @for (group of differenceGroups(); track group.entity) {
                    <details
                      class="import-difference-group"
                      [open]="isOpen(group)"
                      (toggle)="toggled(group, $event)"
                    >
                      <summary>
                        {{ group.label }}: {{ group.count }}
                        {{ group.count === 1 ? 'difference' : 'differences' }}
                        in {{ group.records.length }}
                        {{ group.records.length === 1 ? 'record' : 'records' }}
                      </summary>
                      <!-- A closed group renders nothing; an open one renders a page of records at a time. -->
                      @if (isOpen(group)) {
                        <ul class="import-difference-records" [attr.aria-label]="group.label + ' differences'">
                          @for (record of shownRecords(group); track record.key) {
                            <li>
                              <span class="import-difference-record">{{ record.label }}</span>
                              <ul class="import-difference-lines">
                                @for (line of record.lines; track $index) {
                                  <li>{{ line }}</li>
                                }
                              </ul>
                            </li>
                          }
                        </ul>
                        @if (group.records.length > shownRecords(group).length) {
                          <div class="import-difference-more">
                            <button type="button" class="btn btn--secondary" (click)="showMore(group)">
                              Show more ({{ group.records.length - shownRecords(group).length }} more
                              {{ group.records.length - shownRecords(group).length === 1 ? 'record' : 'records' }})
                            </button>
                          </div>
                        }
                      }
                    </details>
                  }
                  @if (report.differencesOmitted) {
                    <p class="muted">{{ report.differencesOmitted }} more differences were found and are not listed.</p>
                  }
                </section>
              }
              @if (report.notImportedByDesign; as byDesign) {
                @if (byDesign.length > 0) {
                  <p class="muted import-by-design">Not imported by design: {{ byDesign.join(', ') }}.</p>
                }
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

  /** The report's differences, by entity type and record. */
  protected readonly differenceGroups = computed(() => importDifferenceGroups(this.job()?.report?.differences ?? []));
  /** Groups the viewer opened or closed; the others follow {@link IMPORT_DIFFERENCES_OPEN_LIMIT}. */
  private readonly openGroups = signal<ReadonlyMap<string, boolean>>(new Map());
  /** How many records each open group shows. */
  private readonly shownCounts = signal<ReadonlyMap<string, number>>(new Map());

  protected isOpen(group: ImportDifferenceGroupView): boolean {
    return this.openGroups().get(group.entity) ?? group.count <= IMPORT_DIFFERENCES_OPEN_LIMIT;
  }

  protected toggled(group: ImportDifferenceGroupView, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.isOpen(group)) return;
    this.openGroups.update((groups) => new Map(groups).set(group.entity, open));
  }

  protected shownRecords(group: ImportDifferenceGroupView): ImportDifferenceGroupView['records'] {
    return group.records.slice(0, this.shownCounts().get(group.entity) ?? IMPORT_DIFFERENCES_PAGE);
  }

  protected showMore(group: ImportDifferenceGroupView): void {
    const shown = this.shownRecords(group).length;
    this.shownCounts.update((counts) => new Map(counts).set(group.entity, shown + IMPORT_DIFFERENCES_PAGE));
  }

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
    // The router reuses this page when only `:importId` changes: follow the new import from the start.
    effect(() => {
      const importId = this.importId();
      untracked(() => this.follow(importId));
    });
  }

  ngOnInit(): void {
    // The imported zones show on the Zones page of this project.
    this.store.selectProject(this.projectId());
  }

  private follow(importId: string): void {
    clearTimeout(this.timer);
    this.job.set(null);
    this.error.set('');
    this.openGroups.set(new Map());
    this.shownCounts.set(new Map());
    if (this.auth.isAdmin()) void this.read(importId);
  }

  private schedule(importId: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.read(importId), this.pollInterval);
  }

  private async read(importId: string): Promise<void> {
    const result = await this.imports.job(this.projectId(), importId);
    // The page was left, or moved on to another import meanwhile.
    if (this.destroyed || this.importId() !== importId) return;
    if (result.value === null) {
      this.error.set(result.message);
      // No access or no such import: reading again cannot help. Anything else
      // (no connection, a server error) may pass, so try again at the next poll.
      if (result.status !== 403 && result.status !== 404) this.schedule(importId);
      return;
    }
    const value = result.value;
    this.error.set('');
    this.job.set(value);
    if (isImportActive(value.status)) {
      this.schedule(importId);
    } else if (value.status === 'done') {
      // The import may have added zones since the dashboard loaded: load them so
      // the Zones page and project cards show them.
      await this.store.refresh();
    }
  }
}
