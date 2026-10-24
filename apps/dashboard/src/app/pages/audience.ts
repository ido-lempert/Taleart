import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  contactLikeWarning,
  MAX_EXTERNAL_USER_ID_LENGTH,
  MAX_USER_LIST_CSV_BYTES,
  MAX_USER_LIST_CSV_ROWS,
  MAX_USER_LIST_NAME_LENGTH,
  MAX_USER_LISTS_PER_PROJECT,
  normalizeUserListName,
  reportContactCounts,
  sampleUserListCsv,
  USER_LIST_CSV_SAMPLE_BYTES,
  type UserList,
  type UserListRefusal,
  type UserListUploadReport,
} from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { Icon } from '../icon';
import { UserListsService } from '../user-lists.service';

/** What an open drawer is for, and the control focus goes back to. */
type AudienceDrawer =
  | { kind: 'create'; returnTo: HTMLElement | null }
  | { kind: 'upload' | 'rename' | 'delete'; list: UserList; returnTo: HTMLElement | null };

/** The warning the dashboard gives (owner decision: it warns, never refuses). */
export type ContactWarning = 'email' | 'phone' | null;

const REFUSAL_TEXT: Readonly<Record<UserListRefusal, string>> = {
  'too-long': `longer than ${MAX_EXTERNAL_USER_ID_LENGTH} characters`,
  'control-character': 'holds a control character, such as a tab',
  'not-one-column': 'more than one column',
};

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The words of an upload report, in counts and line numbers only (never a value). */
export function reportLines(report: UserListUploadReport): string[] {
  const lines = [`Added ${count(report.added, 'ID')}.`];
  if (report.alreadyPresent > 0) lines.push(`${count(report.alreadyPresent, 'row')} already in the list (or earlier in the file).`);
  if (report.refused > 0) {
    const named = report.refusedRows.map((row) => `line ${row.line} (${REFUSAL_TEXT[row.reason]})`).join(', ');
    const more = report.refused > report.refusedRows.length ? `, and ${report.refused - report.refusedRows.length} more` : '';
    lines.push(`${count(report.refused, 'row')} refused: ${named}${more}.`);
  }
  if (report.emptyRows > 0) lines.push(`${count(report.emptyRows, 'empty row')} skipped.`);
  lines.push(`The list now holds ${count(report.idCount, 'ID')}.`);
  return lines;
}

/** The warning's words. */
export function warningText(warning: Exclude<ContactWarning, null>): string {
  const what = warning === 'email' ? 'email addresses' : 'phone numbers';
  return (
    `Most of these values look like ${what}. TaleArt stores each one only as a keyed hash, but anyone with ` +
    `your site key could test whether a given ${warning === 'email' ? 'address' : 'number'} is in a list. ` +
    'We recommend your own opaque user IDs instead. You can still upload this file.'
  );
}

// The start of a file as text, for the warning before it is sent.
function readSample(file: Blob): Promise<string> {
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(new TextDecoder('utf-8').decode(reader.result as ArrayBuffer));
    reader.onerror = () => done('');
    reader.readAsArrayBuffer(file.slice(0, USER_LIST_CSV_SAMPLE_BYTES));
  });
}

/**
 * The Audience page (epic targeting): who targeted tale groups are for. Its User lists tab (R3, R5)
 * creates a list, uploads a single-column CSV of external user IDs to it with the report and a
 * warning when they look like emails or phone numbers, renames and deletes it. IDs are never shown:
 * a list tells only how many it holds. Story 6 adds a Segments tab.
 */
@Component({
  selector: 'app-audience-page',
  imports: [Drawer, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .audience-tabs {
      display: flex;
      gap: var(--space-1);
      margin-bottom: calc(var(--space-6) * -1 + var(--space-4));
      border-bottom: 1px solid var(--border-strong);
    }
    .audience-tab {
      min-height: 44px;
      padding: 0 var(--space-4);
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: var(--text-secondary);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .audience-tab[aria-selected='true'] {
      border-bottom-color: var(--ember-strong);
      color: var(--ink);
    }
    .audience-tab:focus-visible {
      outline-offset: -3px;
    }
    .audience-panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      max-width: 880px;
    }
    .user-lists {
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      list-style: none;
      border-top: 1px solid var(--border);
    }
    .user-list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-4) 0;
      border-bottom: 1px solid var(--border);
    }
    .user-list__text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 200px;
    }
    .user-list__name {
      margin: 0;
      font-size: var(--text-lg);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .user-list__count {
      font-variant-numeric: tabular-nums;
    }
    .user-list__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .audience-note {
      margin: 0;
      color: var(--text-secondary);
    }
    .audience-warning {
      display: flex;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid #fedf89;
      border-radius: var(--radius-control);
      background: #fffaeb;
      color: #7a2e0e;
    }
    .audience-report {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: var(--space-4);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
      list-style: none;
    }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <h2 class="page-header__title">Audience</h2>
        @if (projectId()) {
          <p class="page-header__meta">Who targeted tale groups of {{ store.projectName(projectId()) }} are for</p>
        }
      </header>

      <div class="audience-tabs" role="tablist" aria-label="Audience sections">
        <button
          type="button"
          role="tab"
          class="audience-tab"
          id="audience-tab-lists"
          aria-selected="true"
          aria-controls="audience-panel-lists"
          tabindex="0"
        >
          User lists
        </button>
      </div>

      <div class="audience-panel" role="tabpanel" id="audience-panel-lists" aria-labelledby="audience-tab-lists">
        <section class="card section" aria-labelledby="user-lists-title">
          <div class="section__header">
            <h3 class="section__title" id="user-lists-title">User lists</h3>
            @if (projectId()) {
              <button
                type="button"
                class="btn btn--primary"
                id="user-list-new"
                [disabled]="atLimit()"
                [attr.aria-describedby]="atLimit() ? 'user-list-limit' : null"
                (click)="open({ kind: 'create', returnTo: $any($event.currentTarget) })"
              >
                <app-icon name="plus" /> New user list
              </button>
            }
          </div>
          <p class="audience-note">
            A user list holds your site's external user IDs, uploaded as a CSV. TaleArt keeps each ID only as a keyed
            hash: it shows how many IDs a list holds, never which, and cannot export them. Use your own opaque user
            IDs, not email addresses or phone numbers.
          </p>
          @if (atLimit()) {
            <p class="muted" id="user-list-limit">A project holds at most {{ maxLists }} user lists. Delete one to add another.</p>
          }
          @if (listError()) {
            <p class="form-error" role="alert">{{ listError() }}</p>
          }
          @if (!projectId()) {
            <p class="muted">Create a project first: user lists belong to a project.</p>
          } @else if (lists(); as all) {
            @if (all.length === 0) {
              <div class="empty">
                <span class="empty__icon"><app-icon name="audience" /></span>
                <p class="empty__title">No user lists yet</p>
                <p class="empty__text">Create one and upload a CSV with one external user ID per row.</p>
              </div>
            } @else {
              <ul class="user-lists" aria-labelledby="user-lists-title">
                @for (list of all; track list.id) {
                  <li class="user-list">
                    <div class="user-list__text">
                      <h4 class="user-list__name">{{ list.name }}</h4>
                      <span class="muted">
                        <span class="user-list__count">{{ idCount(list) }}</span> · Changed {{ date(list.updatedAt) }}
                      </span>
                    </div>
                    <div class="user-list__actions">
                      <button
                        type="button"
                        class="btn btn--secondary btn--sm"
                        [attr.aria-label]="'Add IDs to ' + list.name"
                        (click)="open({ kind: 'upload', list, returnTo: $any($event.currentTarget) })"
                      >
                        Add IDs
                      </button>
                      <button
                        type="button"
                        class="btn btn--secondary btn--sm"
                        [attr.aria-label]="'Rename ' + list.name"
                        (click)="open({ kind: 'rename', list, returnTo: $any($event.currentTarget) })"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        class="btn btn--secondary btn--sm"
                        [attr.aria-label]="'Delete ' + list.name"
                        (click)="open({ kind: 'delete', list, returnTo: $any($event.currentTarget) })"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                }
              </ul>
            }
          } @else if (!listError()) {
            <p class="muted">Loading the user lists…</p>
          }
        </section>
      </div>
      <p class="visually-hidden" role="status">{{ said() }}</p>
    </div>

    @if (drawer(); as d) {
      @switch (d.kind) {
        @case ('delete') {
          <app-drawer
            heading="Delete user list"
            dialogRole="alertdialog"
            describedBy="user-list-delete-text"
            initialFocus="#user-list-delete-cancel"
            [returnFocus]="returnFocus"
            [busy]="busy()"
            (closed)="close()"
          >
            <div class="drawer__body">
              <p id="user-list-delete-text">
                Delete <strong>{{ listOf(d)?.name }}</strong> and the {{ idCount(listOf(d)) }} it holds? They are
                deleted for good, not kept anywhere. This cannot be undone.
              </p>
              @if (error()) {
                <p class="form-error" role="alert">{{ error() }}</p>
              }
            </div>
            <div class="drawer__footer">
              <button type="button" class="btn btn--secondary" id="user-list-delete-cancel" [disabled]="busy()" (click)="close()">
                Cancel
              </button>
              <button type="button" class="btn btn--danger" [disabled]="busy()" (click)="remove()">
                {{ busy() ? 'Deleting…' : 'Delete user list' }}
              </button>
            </div>
          </app-drawer>
        }
        @case ('rename') {
          <app-drawer heading="Rename user list" [returnFocus]="returnFocus" [busy]="busy()" (closed)="close()">
            <form class="drawer__form" (submit)="$event.preventDefault(); rename()" novalidate>
              <div class="drawer__body">
                <div class="field">
                  <label class="field__label" for="user-list-name">Name</label>
                  <input
                    id="user-list-name"
                    class="input"
                    type="text"
                    autocomplete="off"
                    aria-required="true"
                    [attr.maxlength]="maxName"
                    [value]="name()"
                    [attr.aria-invalid]="error() ? 'true' : null"
                    [attr.aria-describedby]="error() ? 'user-list-name-error' : null"
                    (input)="name.set($any($event.target).value)"
                  />
                  @if (error()) {
                    <span class="field__error" id="user-list-name-error" role="alert">{{ error() }}</span>
                  }
                </div>
              </div>
              <div class="drawer__footer">
                <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="close()">Cancel</button>
                <button type="submit" class="btn btn--primary" [disabled]="busy()">Rename</button>
              </div>
            </form>
          </app-drawer>
        }
        @default {
          <app-drawer
            [heading]="d.kind === 'create' ? 'New user list' : 'Add IDs to ' + (listOf(d)?.name ?? '')"
            [returnFocus]="returnFocus"
            [busy]="busy()"
            (closed)="close()"
          >
            @if (report(); as r) {
              <div class="drawer__body">
                <h3 class="section__title" id="user-list-report-title" tabindex="-1">
                  {{ d.kind === 'create' ? 'Created ' + (listOf(d)?.name ?? '') : 'Upload done' }}
                </h3>
                <ul class="audience-report" aria-labelledby="user-list-report-title">
                  @for (line of reportText(r); track $index) {
                    <li>{{ line }}</li>
                  }
                </ul>
                @if (reportWarning(r); as w) {
                  <div class="audience-warning" role="note">
                    <app-icon name="alert" />
                    <span>{{ warning(w) }}</span>
                  </div>
                }
              </div>
              <div class="drawer__footer">
                <button type="button" class="btn btn--primary" id="user-list-done" (click)="close()">Done</button>
              </div>
            } @else {
              <form class="drawer__form" (submit)="$event.preventDefault(); submit()" novalidate>
                <div class="drawer__body">
                  @if (d.kind === 'create') {
                    <div class="field">
                      <label class="field__label" for="user-list-name">Name</label>
                      <input
                        id="user-list-name"
                        class="input"
                        type="text"
                        autocomplete="off"
                        aria-required="true"
                        [attr.maxlength]="maxName"
                        [value]="name()"
                        [attr.aria-invalid]="nameError() ? 'true' : null"
                        [attr.aria-describedby]="nameError() ? 'user-list-name-hint user-list-name-error' : 'user-list-name-hint'"
                        (input)="name.set($any($event.target).value)"
                      />
                      <span class="field__hint" id="user-list-name-hint">Such as Loyal customers. Unique in the project.</span>
                      @if (nameError()) {
                        <span class="field__error" id="user-list-name-error">{{ nameError() }}</span>
                      }
                    </div>
                  }
                  <div class="field">
                    <label class="field__label" for="user-list-file">
                      CSV file{{ d.kind === 'create' ? ' (optional)' : '' }}
                    </label>
                    <input
                      id="user-list-file"
                      class="input input--file"
                      type="file"
                      accept=".csv,.txt,text/csv,text/plain"
                      [attr.aria-required]="d.kind === 'upload' ? 'true' : null"
                      [attr.aria-invalid]="fileError() ? 'true' : null"
                      [attr.aria-describedby]="fileError() ? 'user-list-file-hint user-list-file-error' : 'user-list-file-hint'"
                      (change)="pick($any($event.target).files)"
                    />
                    <span class="field__hint" id="user-list-file-hint">
                      UTF-8, one external user ID per row, at most {{ maxRows }} rows and {{ maxMb }} MB. Each ID is
                      trimmed, matched exactly (case counts) and at most {{ maxIdLength }} characters. The file is read
                      once and not kept.
                    </span>
                    @if (fileError()) {
                      <span class="field__error" id="user-list-file-error">{{ fileError() }}</span>
                    }
                  </div>
                  <label class="checkbox">
                    <input
                      id="user-list-header"
                      type="checkbox"
                      [checked]="header()"
                      (change)="setHeader($any($event.target).checked)"
                    />
                    The first row is a header (skip it)
                  </label>
                  <div role="status">
                    @if (sampleWarning(); as w) {
                      <div class="audience-warning">
                        <app-icon name="alert" />
                        <span>{{ warning(w) }}</span>
                      </div>
                    }
                  </div>
                  @if (error()) {
                    <p class="form-error" role="alert">{{ error() }}</p>
                  }
                </div>
                <div class="drawer__footer">
                  <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="close()">Cancel</button>
                  <button type="submit" class="btn btn--primary" [disabled]="busy()">
                    {{ busy() ? (file() ? 'Uploading…' : 'Creating…') : d.kind === 'create' ? 'Create list' : 'Upload' }}
                  </button>
                </div>
              </form>
            }
          </app-drawer>
        }
      }
    }
  `,
})
export class AudiencePage {
  protected readonly store = inject(DashboardStore);
  private readonly service = inject(UserListsService);

  protected readonly projectId = this.store.selectedProjectId;
  protected readonly lists = signal<UserList[] | null>(null);
  protected readonly listError = signal('');
  protected readonly said = signal('');
  protected readonly atLimit = computed(() => (this.lists()?.length ?? 0) >= MAX_USER_LISTS_PER_PROJECT);

  protected readonly drawer = signal<AudienceDrawer | null>(null);
  protected readonly name = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly header = signal(false);
  private readonly sample = signal<{ text: string; truncated: boolean } | null>(null);
  protected readonly sampleWarning = computed<ContactWarning>(() => {
    const sample = this.sample();
    if (!sample) return null;
    return contactLikeWarning(sampleUserListCsv(sample.text, { header: this.header(), truncated: sample.truncated }));
  });
  protected readonly nameError = signal('');
  protected readonly fileError = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly report = signal<UserListUploadReport | null>(null);
  /** The list the open drawer is about; for a new list, set once it is created. */
  private readonly created = signal<UserList | null>(null);

  protected readonly maxName = MAX_USER_LIST_NAME_LENGTH;
  protected readonly maxLists = MAX_USER_LISTS_PER_PROJECT;
  protected readonly maxRows = MAX_USER_LIST_CSV_ROWS.toLocaleString('en-US');
  protected readonly maxMb = MAX_USER_LIST_CSV_BYTES / (1024 * 1024);
  protected readonly maxIdLength = MAX_EXTERNAL_USER_ID_LENGTH;

  /** Where focus goes when a drawer closes: its trigger, else (once that row is gone) the New button. */
  protected readonly returnFocus = (): HTMLElement | null => {
    const target = this.drawer()?.returnTo ?? this.lastReturn;
    return target?.isConnected ? target : document.getElementById('user-list-new');
  };
  private lastReturn: HTMLElement | null = null;

  constructor() {
    // The selected project's lists, read again when the project changes.
    effect(() => {
      const projectId = this.projectId();
      untracked(() => {
        this.lists.set(null);
        this.close();
        if (projectId) void this.load(projectId);
      });
    });
  }

  private async load(projectId: string): Promise<void> {
    const { value, message } = await this.service.list(projectId);
    if (projectId !== this.projectId()) return;
    if (value === null) {
      this.listError.set(message);
      return;
    }
    this.listError.set('');
    this.lists.set(value);
  }

  protected idCount(list: UserList | null | undefined): string {
    return count(list?.idCount ?? 0, 'ID');
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected listOf(d: AudienceDrawer): UserList | null {
    return d.kind === 'create' ? this.created() : d.list;
  }

  protected reportText(report: UserListUploadReport): string[] {
    return reportLines(report);
  }

  protected reportWarning(report: UserListUploadReport): ContactWarning {
    return contactLikeWarning(reportContactCounts(report));
  }

  protected warning(w: Exclude<ContactWarning, null>): string {
    return warningText(w);
  }

  protected open(d: AudienceDrawer): void {
    this.name.set(d.kind === 'rename' ? d.list.name : '');
    this.file.set(null);
    this.header.set(false);
    this.sample.set(null);
    this.nameError.set('');
    this.fileError.set('');
    this.error.set('');
    this.report.set(null);
    this.created.set(null);
    this.lastReturn = d.returnTo;
    this.drawer.set(d);
  }

  protected close(): void {
    if (this.busy()) return;
    this.drawer.set(null);
  }

  protected setHeader(checked: boolean): void {
    this.header.set(checked);
  }

  protected async pick(files: FileList | null): Promise<void> {
    const file = files?.[0] ?? null;
    this.file.set(file);
    this.fileError.set('');
    this.sample.set(null);
    if (!file) return;
    if (file.size > MAX_USER_LIST_CSV_BYTES) {
      this.fileError.set(`This file is larger than ${this.maxMb} MB. Split it and upload each part to the list.`);
      return;
    }
    const text = await readSample(file);
    // Another file may have been picked meanwhile.
    if (this.file() === file) this.sample.set({ text, truncated: file.size > USER_LIST_CSV_SAMPLE_BYTES });
  }

  private refuseFile(message: string): void {
    this.fileError.set(message);
    document.getElementById('user-list-file')?.focus();
  }

  /** Creates the list (for a new one) and sends the file, then shows the report. */
  protected async submit(): Promise<void> {
    const d = this.drawer();
    const projectId = this.projectId();
    if (!d || this.busy() || !projectId || (d.kind !== 'create' && d.kind !== 'upload')) return;
    this.error.set('');
    this.nameError.set('');
    const file = this.file();
    if (d.kind === 'upload' && !file) return this.refuseFile('Choose a CSV file.');
    if (file && file.size > MAX_USER_LIST_CSV_BYTES) return this.refuseFile(`This file is larger than ${this.maxMb} MB.`);
    if (file && file.size === 0) return this.refuseFile('This file is empty.');
    let list = d.kind === 'upload' ? d.list : this.created();
    if (!list) {
      const name = normalizeUserListName(this.name());
      if (name === null) {
        this.nameError.set(`Enter a name of 1 to ${this.maxName} characters.`);
        document.getElementById('user-list-name')?.focus();
        return;
      }
      this.busy.set(true);
      const created = await this.service.create(projectId, name);
      this.busy.set(false);
      if (created.value === null) {
        this.nameError.set(created.message);
        document.getElementById('user-list-name')?.focus();
        return;
      }
      list = created.value;
      this.created.set(list);
      await this.load(projectId);
      if (!file) {
        this.said.set(`${list.name} created.`);
        this.drawer.set(null);
        return;
      }
    }
    if (!file) return;
    this.busy.set(true);
    const sent = await this.service.upload(projectId, list.id, file, this.header());
    this.busy.set(false);
    await this.load(projectId);
    if (sent.value === null) {
      const prefix = d.kind === 'create' ? `${list.name} was created, but the file was not added: ` : '';
      this.error.set(`${prefix}${sent.message}`);
      return;
    }
    this.report.set(sent.value);
    this.said.set(`${list.name}: ${reportLines(sent.value).join(' ')}`);
    setTimeout(() => document.getElementById('user-list-report-title')?.focus());
  }

  protected async rename(): Promise<void> {
    const d = this.drawer();
    const projectId = this.projectId();
    if (!d || d.kind !== 'rename' || this.busy() || !projectId) return;
    const name = normalizeUserListName(this.name());
    if (name === null) {
      this.error.set(`Enter a name of 1 to ${this.maxName} characters.`);
      document.getElementById('user-list-name')?.focus();
      return;
    }
    this.busy.set(true);
    const result = await this.service.rename(projectId, d.list.id, name);
    this.busy.set(false);
    if (result.value === null) {
      this.error.set(result.message);
      document.getElementById('user-list-name')?.focus();
      return;
    }
    await this.load(projectId);
    this.said.set(`${d.list.name} renamed to ${result.value.name}.`);
    this.drawer.set(null);
  }

  protected async remove(): Promise<void> {
    const d = this.drawer();
    const projectId = this.projectId();
    if (!d || d.kind !== 'delete' || this.busy() || !projectId) return;
    this.busy.set(true);
    this.error.set('');
    const result = await this.service.remove(projectId, d.list.id);
    this.busy.set(false);
    if (result.value === null) {
      this.error.set(result.message);
      return;
    }
    await this.load(projectId);
    this.said.set(`${d.list.name} deleted, with its ${this.idCount(d.list)}.`);
    this.drawer.set(null);
  }
}
