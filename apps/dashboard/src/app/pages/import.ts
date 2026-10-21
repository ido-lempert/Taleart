import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  isImportActive,
  type ImportJobSummary,
  type ImportPreview,
  type ImportPreviewZone,
  type StorylyApp,
} from '@taleart/contract';
import { AuthStore } from '../auth';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { ImportService } from '../import.service';
import { IMPORT_PILL_STYLES, importStatusClass, importStatusLabel, importTimeText } from './import-shared';

/**
 * "Import from Storyly" for one project (admins only): paste a Storyly API
 * token, find its apps, pick one, choose which zones and which content to
 * import, and start; starting opens the import's own page, which follows it.
 * Below the form, the project's past imports with their state, times and
 * failure reason, each opening its page and report.
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
      .import-pick {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        margin-top: var(--space-5);
        padding-top: var(--space-5);
        border-top: 1px solid var(--border);
      }
      .import-pick__title {
        margin: 0;
        font-size: var(--text-md);
        font-weight: 600;
      }
      .import-pick__list {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin: 0;
        padding: 0 0 0 var(--space-6);
        list-style: none;
      }
      .import-pick__zone {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: var(--space-3);
      }
      .import-pick__count {
        margin: 0;
        color: var(--text-secondary);
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
            <form class="import-form" (ngSubmit)="choose()" novalidate>
              <div class="field">
                <label class="field__label" for="import-app">App</label>
                <select id="import-app" class="select" name="appId" [(ngModel)]="appId" (ngModelChange)="appChanged()">
                  @for (app of apps(); track app.id) {
                    <option [value]="app.id">{{ app.name }}</option>
                  }
                </select>
              </div>
              <div class="import-form__actions">
                <button type="submit" class="btn btn--secondary" [disabled]="busy()">
                  {{ busy() && !preview() ? 'Reading the app…' : 'Choose what to import' }}
                </button>
              </div>
            </form>
          }

          @if (preview(); as preview) {
            <form class="import-pick" (ngSubmit)="start()" novalidate aria-labelledby="import-pick-title">
              <h4 class="import-pick__title" id="import-pick-title">What to import from {{ preview.appName }}</h4>

              <fieldset class="tag-options">
                <legend class="field__label">Zones</legend>
                <span class="field__hint" id="import-zones-hint">
                  Each instance of the app becomes a zone, with its tale groups and tales.
                </span>
                <label class="checkbox">
                  <input
                    type="checkbox"
                    name="allZones"
                    aria-controls="import-zone-list"
                    aria-describedby="import-zones-hint"
                    [checked]="allPicked()"
                    [indeterminate]="somePicked()"
                    (change)="toggleAll(checkedOf($event))"
                  />
                  All zones
                </label>
                <ul class="import-pick__list" id="import-zone-list" aria-label="Zones of the app">
                  @for (zone of preview.zones; track zone.id) {
                    <li class="import-pick__zone">
                      <label class="checkbox">
                        <input
                          type="checkbox"
                          [name]="'zone-' + $index"
                          [checked]="picked().has(zone.id)"
                          [attr.aria-describedby]="'import-zone-count-' + $index"
                          (change)="toggleZone(zone.id, checkedOf($event))"
                        />
                        {{ zone.name }}
                      </label>
                      <span class="field__hint" [id]="'import-zone-count-' + $index">{{ zoneCounts(zone) }}</span>
                    </li>
                  }
                </ul>
                <p class="import-pick__count" role="status">
                  {{ picked().size }} of {{ preview.zones.length }} {{ preview.zones.length === 1 ? 'zone' : 'zones' }}
                  selected
                </p>
                @if (preview.zonesBeyond > 0) {
                  <p class="field__hint">
                    This app has {{ preview.zonesBeyond }} more {{ preview.zonesBeyond === 1 ? 'zone' : 'zones' }} than
                    can be listed here; only the listed zones can be imported.
                  </p>
                }
                @if (!preview.countsComplete) {
                  <p class="field__hint">Some counts were not read, to keep this check short.</p>
                }
              </fieldset>

              <fieldset class="tag-options">
                <legend class="field__label">Content</legend>
                <label class="checkbox">
                  <input
                    type="checkbox"
                    name="taleGroups"
                    [checked]="taleGroups()"
                    (change)="taleGroups.set(checkedOf($event))"
                  />
                  Tale groups and tales
                </label>
                <ul class="import-pick__list" aria-label="Content of the tale groups">
                  <li>
                    <label class="checkbox">
                      <input
                        type="checkbox"
                        name="media"
                        [disabled]="!taleGroups()"
                        [checked]="taleGroups() && media()"
                        [attr.aria-describedby]="taleGroups() ? null : 'import-needs-groups'"
                        (change)="media.set(checkedOf($event))"
                      />
                      Media
                    </label>
                  </li>
                  <li>
                    <label class="checkbox">
                      <input
                        type="checkbox"
                        name="tags"
                        [disabled]="!taleGroups()"
                        [checked]="taleGroups() && tags()"
                        [attr.aria-describedby]="taleGroups() ? null : 'import-needs-groups'"
                        (change)="tags.set(checkedOf($event))"
                      />
                      Tags
                    </label>
                  </li>
                </ul>
                @if (!taleGroups()) {
                  <span class="field__hint" id="import-needs-groups">Media and tags need tale groups and tales.</span>
                }
              </fieldset>

              <div class="import-form__actions">
                <button
                  type="submit"
                  class="btn btn--primary"
                  [disabled]="busy() || picked().size === 0"
                  [attr.aria-describedby]="picked().size === 0 ? 'import-none-picked' : null"
                >
                  Start import
                </button>
              </div>
              @if (picked().size === 0) {
                <span class="field__hint" id="import-none-picked">Pick at least one zone to import.</span>
              }
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
  /** What the chosen app holds; null until "Choose what to import". */
  protected readonly preview = signal<ImportPreview | null>(null);
  /** The source ids of the zones to import. */
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly taleGroups = signal(true);
  protected readonly media = signal(true);
  protected readonly tags = signal(true);
  protected readonly allPicked = computed(() => {
    const zones = this.preview()?.zones ?? [];
    return zones.length > 0 && this.picked().size === zones.length;
  });
  /** Some zones, not all: the "All zones" box shows mixed. */
  protected readonly somePicked = computed(() => this.picked().size > 0 && !this.allPicked());
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
    this.preview.set(null);
  }

  // Another app holds other zones.
  protected appChanged(): void {
    this.preview.set(null);
  }

  protected checkedOf(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /** A zone's counts as the picker shows them, such as "3 tale groups, 8 tales". */
  protected zoneCounts(zone: ImportPreviewZone): string {
    const count = (n: number | null, one: string, many: string) =>
      n === null ? `${many} not counted` : `${n} ${n === 1 ? one : many}`;
    return `${count(zone.taleGroups, 'tale group', 'tale groups')}, ${count(zone.tales, 'tale', 'tales')}`;
  }

  /** "All zones": picks every zone, or none. */
  protected toggleAll(checked: boolean): void {
    this.picked.set(new Set(checked ? (this.preview()?.zones ?? []).map((zone) => zone.id) : []));
  }

  protected toggleZone(id: string, checked: boolean): void {
    const next = new Set(this.picked());
    if (checked) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  /** Reads what the chosen app holds; every zone and every kind of content starts picked. */
  protected async choose(): Promise<void> {
    if (this.busy()) return;
    const token = this.token.trim();
    if (!token || !this.appId) return;
    this.busy.set(true);
    this.error.set('');
    this.preview.set(null);
    const { value, message } = await this.imports.preview(this.projectId(), token, this.appId);
    this.busy.set(false);
    if (value === null) {
      this.error.set(message);
      return;
    }
    if (value.zones.length === 0) {
      this.error.set('This app has no zones to import.');
      return;
    }
    this.picked.set(new Set(value.zones.map((zone) => zone.id)));
    this.taleGroups.set(true);
    this.media.set(true);
    this.tags.set(true);
    this.preview.set(value);
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
    const preview = this.preview();
    if (!token || !preview || this.picked().size === 0) return;
    this.busy.set(true);
    this.error.set('');
    const taleGroups = this.taleGroups();
    const { value, message } = await this.imports.start(this.projectId(), token, preview.appId, {
      selectionKey: preview.selectionKey,
      // In the preview's order.
      zones: preview.zones.filter((zone) => this.picked().has(zone.id)).map((zone) => zone.id),
      taleGroups,
      media: taleGroups && this.media(),
      tags: taleGroups && this.tags(),
    });
    this.busy.set(false);
    if (value === null) {
      this.error.set(message);
      return;
    }
    // The server holds the token now, encrypted, until the import ends.
    this.token = '';
    this.apps.set([]);
    this.preview.set(null);
    // The import's own URL, so a reload keeps following it.
    await this.router.navigate(['/projects', this.projectId(), 'import', value.id]);
  }
}
