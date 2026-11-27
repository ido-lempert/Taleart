import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ProjectFont } from '@taleart/contract/core';
import {
  fontFaceName,
  FONT_STYLES,
  FONT_WEIGHT_NAMES,
  FONT_WEIGHTS,
  isWoff2Header,
  loadProjectFont,
  MAX_FONT_BYTES,
  MAX_PROJECT_FONT_FAMILY_LENGTH,
  normalizeFontFamily,
  projectFontFamilyError,
  WOFF2_HEADER_BYTES,
  type ProjectFontStyle,
} from '@taleart/contract/project-fonts';
import {
  SYSTEM_FONT_STACK_KEYS,
  SYSTEM_FONT_STACK_NAMES,
  textFontFamily,
  type SystemFontStack,
} from '@taleart/contract/text-style';
import { BulkBar } from '../bulk-bar';
import { runLimited } from '../bulk-run';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { Icon } from '../icon';
import { projectFontFileUrl, ProjectFontsService } from '../project-fonts.service';
import { createSelection } from '../selection';

/** The fields of the upload form that can be refused. */
type FontField = 'file' | 'family' | 'licence';

/** The field a refusal from the server is about, by its code (and, for a validation, its message). */
export function refusedField(code: string, message: string): FontField {
  if (code === 'font_exists') return 'family';
  if (code === 'validation_failed') {
    if (/^family /.test(message)) return 'family';
    if (/distribute/.test(message)) return 'licence';
  }
  // unsupported_media_type, media_too_large, font_storage_full, font_limit_reached and the rest.
  return 'file';
}

const FIELD_IDS: Readonly<Record<FontField, string>> = {
  file: 'font-file',
  family: 'font-family',
  licence: 'font-licence',
};

/** How many single-font requests a bulk delete keeps in flight (as the other lists do). */
const BULK_CONCURRENCY = 3;

/** A font a bulk delete could not finish, kept selected and named. */
interface FontBulkFailure {
  id: string;
  name: string;
  message: string;
}

/** A family with its faces, as the list shows them. */
interface FontFamily {
  family: string;
  faces: ProjectFont[];
}

// The start of a file, enough for its WOFF2 header.
function readHead(file: Blob): Promise<Uint8Array> {
  return new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => done(new Uint8Array(0));
    reader.readAsArrayBuffer(file.slice(0, WOFF2_HEADER_BYTES));
  });
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * A project's fonts (epic Tale Studio R18): upload a WOFF2 face with its family, weight, style and
 * fallback, confirming the licence, and see each family with its faces, drawn in the face itself.
 * A face that a tale uses cannot be deleted; the refusal names the tale. Every control is labelled,
 * errors are tied to their fields and announced, and it works with the keyboard alone.
 */
@Component({
  selector: 'app-fonts-page',
  imports: [RouterLink, Icon, BulkBar, Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .fonts-section {
      max-width: 640px;
    }
    .fonts-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }
    .fonts-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--space-4);
    }
    .fonts-licence {
      align-items: flex-start;
    }
    .fonts-licence input {
      margin-top: 3px;
    }
    .fonts-list,
    .fonts-faces {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .fonts-family {
      margin: 0 0 var(--space-2);
      font-size: var(--text-md);
      font-weight: 600;
    }
    .fonts-face {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .fonts-face__text {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-1);
      min-width: 200px;
    }
    .fonts-sample {
      font-size: var(--text-lg);
      overflow-wrap: anywhere;
    }
    .fonts-in-use {
      color: var(--text-secondary);
      font-weight: 600;
    }
    .fonts-saved {
      margin: 0;
      color: var(--text-secondary);
    }
    .fonts-select {
      display: flex;
      align-items: center;
      align-self: flex-start;
    }
    .fonts-names {
      margin: var(--space-2) 0 0;
      padding-inline-start: var(--space-5);
    }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <a class="back-link" routerLink="/projects"><app-icon name="back" /> Projects</a>
        <h2 class="page-header__title">Fonts</h2>
        @if (store.loaded()) {
          <p class="page-header__meta">of {{ store.projectName(projectId()) }}, for text in Tale Studio</p>
        }
      </header>

      <section class="card section fonts-section" aria-labelledby="fonts-upload-title">
        <h3 class="section__title" id="fonts-upload-title">Upload a font</h3>
        @if (!canEdit()) {
          <p class="muted" id="fonts-readonly">View only: {{ store.roleNeeded('content.edit') }}</p>
        }
        <form class="fonts-form" (submit)="$event.preventDefault(); upload()" novalidate>
          <fieldset class="view-only-fieldset" [disabled]="!canEdit()">
            <div class="field">
              <label class="field__label" for="font-file">Font file</label>
              <input
                #fileInput
                id="font-file"
                class="input"
                type="file"
                accept=".woff2,font/woff2"
                aria-required="true"
                [attr.aria-invalid]="errors().file ? 'true' : null"
                [attr.aria-describedby]="errors().file ? 'font-file-hint font-file-error' : 'font-file-hint'"
                (change)="pickFile(fileInput.files)"
              />
              <span class="field__hint" id="font-file-hint"
                >WOFF2 only, at most {{ maxKb }} KB. One file is one face.</span
              >
              @if (errors().file) {
                <span class="field__error" id="font-file-error">{{ errors().file }}</span>
              }
            </div>

            <div class="field">
              <label class="field__label" for="font-family">Family name</label>
              <input
                id="font-family"
                class="input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                aria-required="true"
                [attr.maxlength]="maxFamily"
                [value]="family()"
                [attr.aria-invalid]="errors().family ? 'true' : null"
                [attr.aria-describedby]="errors().family ? 'font-family-hint font-family-error' : 'font-family-hint'"
                (input)="family.set($any($event.target).value)"
              />
              <span class="field__hint" id="font-family-hint">
                The name people pick in Tale Studio, such as Brand Sans: letters, digits, spaces and hyphens.
              </span>
              @if (errors().family) {
                <span class="field__error" id="font-family-error">{{ errors().family }}</span>
              }
            </div>

            <div class="fonts-row">
              <div class="field">
                <label class="field__label" for="font-weight">Weight</label>
                <select id="font-weight" class="select" (change)="weight.set(+$any($event.target).value)">
                  @for (w of weights; track w) {
                    <option [value]="w" [selected]="weight() === w">{{ w }} {{ weightNames[w] }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="font-style">Style</label>
                <select id="font-style" class="select" (change)="style.set($any($event.target).value)">
                  @for (s of styles; track s) {
                    <option [value]="s" [selected]="style() === s">{{ s === 'italic' ? 'Italic' : 'Normal' }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="font-fallback">Fallback font</label>
                <select
                  id="font-fallback"
                  class="select"
                  aria-describedby="font-fallback-hint"
                  (change)="fallback.set($any($event.target).value)"
                >
                  @for (key of stacks; track key) {
                    <option [value]="key" [selected]="fallback() === key">{{ stackNames[key] }}</option>
                  }
                </select>
              </div>
            </div>
            <span class="field__hint" id="font-fallback-hint">
              Text shows the fallback until the font has loaded, and keeps it if the font does not load within 3
              seconds.
            </span>

            <div class="field">
              <label class="checkbox fonts-licence">
                <input
                  id="font-licence"
                  type="checkbox"
                  aria-required="true"
                  [checked]="licence()"
                  [attr.aria-invalid]="errors().licence ? 'true' : null"
                  [attr.aria-describedby]="errors().licence ? 'font-licence-error' : null"
                  (change)="licence.set($any($event.target).checked)"
                />
                I confirm that I may use this font and distribute it to every site that shows this project's tales.
              </label>
              @if (errors().licence) {
                <span class="field__error" id="font-licence-error">{{ errors().licence }}</span>
              }
            </div>

            @if (uploadError()) {
              <p class="form-error" role="alert">{{ uploadError() }}</p>
            }
            <div>
              <button type="submit" class="btn btn--primary" [disabled]="busy()">
                <app-icon name="plus" /> Upload font
              </button>
            </div>
            <p class="fonts-saved" role="status">{{ said() }}</p>
          </fieldset>
        </form>
      </section>

      <section class="card section fonts-section" aria-labelledby="fonts-list-title">
        <h3 class="section__title" id="fonts-list-title">Project fonts</h3>
        @if (listError()) {
          <p class="form-error" role="alert">{{ listError() }}</p>
        }
        @if (fonts(); as list) {
          @if (list.length === 0) {
            <p class="muted">No fonts yet. A font uploaded here can be picked for any text in this project's tales.</p>
          } @else {
            <!-- Escape clears the selection while focus is in the list (its checkboxes, its faces, the bar). -->
            <div role="group" (keydown.escape)="selection.clear()">
            @if (canEdit()) {
              <div class="fonts-select">
                <label class="checkbox">
                  <input
                    type="checkbox"
                    aria-label="Select all fonts"
                    [checked]="selection.allSelected()"
                    [indeterminate]="selection.someSelected()"
                    (change)="selection.toggleAll()"
                  />
                  <span>Select all</span>
                </label>
              </div>
              <app-bulk-bar [count]="selection.count()" (cleared)="selection.clear()">
                <button type="button" class="btn btn--danger btn--sm" id="bulk-delete-fonts" [disabled]="busy()" (click)="askBulkDelete()">
                  Delete
                </button>
              </app-bulk-bar>
            }
            @if (bulkFailed().length > 0) {
              <p class="form-error" role="alert" id="bulk-fonts-failed">
                {{ bulkFailed().length }} could not be deleted: {{ bulkFailedNames() }}. They stay selected.
              </p>
            }
            <ul class="fonts-list" aria-labelledby="fonts-list-title">
              @for (group of families(); track group.family) {
                <li>
                  <h4 class="fonts-family">{{ group.family }}</h4>
                  <ul class="fonts-faces" [attr.aria-label]="group.family + ' faces'">
                    @for (font of group.faces; track font.id) {
                      <li class="fonts-face">
                        @if (canEdit()) {
                          <!-- A face a tale uses is disabled, with the reason, so a bulk delete never sends it. -->
                          <label class="checkbox">
                            <input
                              type="checkbox"
                              [attr.aria-label]="'Select ' + group.family + ' ' + faceLabel(font)"
                              [checked]="selection.isSelected(font.id)"
                              [disabled]="font.inUse"
                              [attr.aria-describedby]="font.inUse ? 'font-in-use-' + font.id : null"
                              (change)="selection.toggle(font.id)"
                            />
                          </label>
                        }
                        <span class="fonts-face__text">
                          <span
                            class="fonts-sample"
                            aria-hidden="true"
                            [style.font-family]="sampleFamily(font)"
                            [style.font-weight]="font.weight"
                            [style.font-style]="font.style"
                          >
                            {{ group.family }}: the quick brown fox
                          </span>
                          <strong>{{ faceLabel(font) }}</strong>
                          <span class="muted">
                            {{ size(font.sizeBytes) }}, fallback {{ fallbackName(font) }}. Uploaded with the licence
                            confirmed by {{ font.licenceConfirmedBy.name }} on {{ date(font.licenceConfirmedAt) }}.
                          </span>
                          @if (font.inUse) {
                            <span class="fonts-in-use" [id]="'font-in-use-' + font.id">
                              Used by a tale, so it cannot be deleted. Change that text's font first.
                            </span>
                          } @else {
                            <span class="muted">Not used by any tale.</span>
                          }
                        </span>
                        <button
                          type="button"
                          class="btn btn--secondary btn--sm"
                          [attr.aria-label]="'Delete ' + group.family + ' ' + faceLabel(font)"
                          [attr.aria-describedby]="font.inUse ? 'font-in-use-' + font.id : null"
                          [disabled]="busy() || font.inUse || !canEdit()"
                          (click)="remove(font, group.family)"
                        >
                          Delete
                        </button>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>
            </div>
          }
        } @else if (!listError()) {
          <p class="muted">Loading the fonts…</p>
        }
      </section>
    </div>
    @if (bulkDelete(); as run) {
      <app-drawer
        [heading]="bulkDeleteHeading()"
        dialogRole="alertdialog"
        describedBy="fonts-bulk-text"
        initialFocus="#fonts-bulk-cancel"
        [returnFocus]="bulkFocus"
        [busy]="run.phase === 'running'"
        (closed)="closeBulkDelete()"
      >
        <form class="drawer__form" (submit)="$event.preventDefault(); confirmBulkDelete()" novalidate>
          <div class="drawer__body">
            <p id="fonts-bulk-text">Texts can no longer pick them.</p>
            <ul class="fonts-names">
              @for (font of run.items.slice(0, 5); track font.id) {
                <li>{{ fontName(font) }}</li>
              }
              @if (run.items.length > 5) {
                <li class="muted">+{{ run.items.length - 5 }} more</li>
              }
            </ul>
            @if (run.phase === 'running') {
              <p class="muted" role="status">Deleting {{ run.done }} of {{ run.items.length }}…</p>
            }
          </div>
          <div class="drawer__footer">
            <button type="button" class="btn btn--secondary" id="fonts-bulk-cancel" [disabled]="run.phase === 'running'" (click)="closeBulkDelete()">
              Cancel
            </button>
            <button type="submit" class="btn btn--danger" id="fonts-bulk-submit" [disabled]="run.phase === 'running'">
              {{ run.phase === 'running' ? 'Deleting…' : bulkDeleteSubmitLabel() }}
            </button>
          </div>
        </form>
      </app-drawer>
    }
  `,
})
export class FontsPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  protected readonly canEdit = computed(() => this.store.can('content.edit', this.projectId()));
  private readonly service = inject(ProjectFontsService);

  /** The project whose fonts these are, bound from the route's `:projectId`. */
  readonly projectId = input.required<string>();

  protected readonly fonts = signal<ProjectFont[] | null>(null);
  protected readonly families = computed<FontFamily[]>(() => {
    const byFamily = new Map<string, ProjectFont[]>();
    for (const font of this.fonts() ?? []) byFamily.set(font.family, [...(byFamily.get(font.family) ?? []), font]);
    return [...byFamily].map(([family, faces]) => ({ family, faces }));
  });
  protected readonly file = signal<File | null>(null);
  protected readonly family = signal('');
  protected readonly weight = signal(400);
  protected readonly style = signal<ProjectFontStyle>('normal');
  protected readonly fallback = signal<SystemFontStack>('sans');
  protected readonly licence = signal(false);
  protected readonly errors = signal<Partial<Record<FontField, string>>>({});
  protected readonly uploadError = signal('');
  protected readonly listError = signal('');
  protected readonly said = signal('');
  protected readonly busy = signal(false);

  /** The faces picked for a bulk delete (the reusable selection, `selection.ts`). */
  protected readonly selection = createSelection(
    () => this.fonts() ?? [],
    (font: ProjectFont) => font.id,
  );
  /** The bulk delete being confirmed, then run. */
  protected readonly bulkDelete = signal<{ phase: 'confirm' | 'running'; items: readonly ProjectFont[]; done: number } | null>(null);
  protected readonly bulkFailed = signal<readonly FontBulkFailure[]>([]);
  protected readonly bulkFailedNames = computed(() => this.bulkFailed().map((f) => f.name).join(', '));
  protected readonly bulkDeleteHeading = computed(() => {
    const count = this.bulkDelete()?.items.length ?? 0;
    return `Delete ${count} ${count === 1 ? 'font' : 'fonts'}?`;
  });
  protected readonly bulkDeleteSubmitLabel = computed(() => {
    const count = this.bulkDelete()?.items.length ?? 0;
    return `Delete ${count} ${count === 1 ? 'font' : 'fonts'}`;
  });
  /** Where focus goes when the bulk delete confirmation closes: its button, else the upload button. */
  protected readonly bulkFocus = (): HTMLElement | null =>
    document.getElementById('bulk-delete-fonts') ?? document.querySelector<HTMLElement>('.fonts-form button[type=submit]');

  protected readonly weights = FONT_WEIGHTS;
  protected readonly weightNames = FONT_WEIGHT_NAMES;
  protected readonly styles = FONT_STYLES;
  protected readonly stacks = SYSTEM_FONT_STACK_KEYS;
  protected readonly stackNames = SYSTEM_FONT_STACK_NAMES;
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly maxKb = MAX_FONT_BYTES / 1024;
  protected readonly maxFamily = MAX_PROJECT_FONT_FAMILY_LENGTH;

  ngOnInit(): void {
    this.store.selectProject(this.projectId());
    void this.load();
  }

  private async load(): Promise<void> {
    const { value, message } = await this.service.list(this.projectId());
    if (value === null) {
      this.listError.set(message);
      return;
    }
    this.listError.set('');
    this.fonts.set(value);
    // Each face is drawn in itself once it loads; until then, and if it fails, in its fallback.
    for (const font of value) {
      void loadProjectFont(
        { id: font.id, url: projectFontFileUrl(this.projectId(), font.id), weight: font.weight, style: font.style },
        { credentials: 'same-origin' },
      );
    }
  }

  protected faceLabel(font: ProjectFont): string {
    return fontFaceName(font);
  }

  protected fallbackName(font: ProjectFont): string {
    return SYSTEM_FONT_STACK_NAMES[font.fallback as SystemFontStack] ?? font.fallback;
  }

  protected sampleFamily(font: ProjectFont): string {
    return textFontFamily({ font: { source: 'project', fontId: font.id }, fallback: font.fallback });
  }

  /** A face as a bulk action names it: its family and its face. */
  protected fontName(font: ProjectFont): string {
    return `${font.family} ${fontFaceName(font)}`;
  }

  /** Opens the confirmation of a bulk delete for the picked faces. */
  protected askBulkDelete(): void {
    if (this.busy() || !this.canEdit() || this.selection.count() === 0) return;
    this.bulkFailed.set([]);
    this.bulkDelete.set({ phase: 'confirm', items: this.selection.selectedItems(), done: 0 });
  }

  /** Closes the bulk delete confirmation; not while the deletes run. */
  protected closeBulkDelete(): void {
    if (this.bulkDelete()?.phase === 'running') return;
    this.bulkDelete.set(null);
  }

  /**
   * Deletes the confirmed faces through the single-font endpoint, a few at a time. The ones deleted
   * leave the list; the ones that failed stay selected and are named.
   */
  protected async confirmBulkDelete(): Promise<void> {
    const run = this.bulkDelete();
    if (!run || run.phase !== 'confirm' || !this.canEdit()) return;
    const projectId = this.projectId();
    this.bulkDelete.set({ ...run, phase: 'running', done: 0 });
    this.busy.set(true);
    this.said.set('');
    this.listError.set('');
    const outcome = await runLimited(
      run.items,
      BULK_CONCURRENCY,
      async (font) => {
        const { value, message } = await this.service.remove(projectId, font.id);
        return value === null ? message || 'The font was not deleted. Try again.' : '';
      },
      (done) => this.bulkDelete.update((current) => (current ? { ...current, done } : current)),
    );
    const deleted = new Set(outcome.succeeded.map((font) => font.id));
    this.fonts.update((list) => (list ? list.filter((font) => !deleted.has(font.id)) : list));
    const failed = outcome.failed.map(({ item, message }) => ({ id: item.id, name: this.fontName(item), message }));
    this.selection.replace(failed.map((f) => f.id));
    this.bulkFailed.set(failed);
    this.bulkDelete.set(null);
    this.busy.set(false);
    const count = outcome.succeeded.length;
    const summary = `${count} ${count === 1 ? 'font' : 'fonts'} deleted.`;
    this.said.set(failed.length === 0 ? summary : `${summary} ${failed.length} could not be deleted: ${this.bulkFailedNames()}.`);
  }

  protected size(bytes: number): string {
    return kb(bytes);
  }

  protected date(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  protected pickFile(files: FileList | null): void {
    this.file.set(files?.[0] ?? null);
    this.errors.update((errors) => ({ ...errors, file: undefined }));
  }

  /** Checks the form as the server will, so most mistakes are named before anything is sent. */
  private async check(): Promise<Partial<Record<FontField, string>>> {
    const errors: Partial<Record<FontField, string>> = {};
    const file = this.file();
    if (!file) errors.file = 'Choose a WOFF2 font file.';
    else if (file.size > MAX_FONT_BYTES)
      errors.file = `This file is ${kb(file.size)}. A font file is at most ${this.maxKb} KB.`;
    else if (!isWoff2Header(await readHead(file), file.size)) {
      errors.file = 'This is not a WOFF2 font file. Convert it to WOFF2 first; TTF, OTF and WOFF are not accepted.';
    }
    if (projectFontFamilyError(normalizeFontFamily(this.family())) !== null) {
      errors.family =
        'Enter one font name of letters, digits, spaces and hyphens, starting with a letter, with no commas or quotes ' +
        `(not a CSS keyword such as inherit), at most ${this.maxFamily} characters.`;
    }
    if (!this.licence()) errors.licence = 'Confirm that you may use and distribute this font.';
    return errors;
  }

  // Marks a field refused, says why in the alert, and moves focus to it.
  private refuse(field: FontField, message: string): void {
    this.errors.set({ [field]: message });
    this.uploadError.set(`The font was not uploaded: ${message}`);
    document.getElementById(FIELD_IDS[field])?.focus();
  }

  // After an upload: an empty form, the licence asked again for the next file.
  private resetForm(): void {
    this.file.set(null);
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
    this.family.set('');
    this.weight.set(400);
    this.style.set('normal');
    this.fallback.set('sans');
    this.licence.set(false);
    this.errors.set({});
  }

  protected async upload(): Promise<void> {
    // Busy before anything is awaited, so a second press does nothing.
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.uploadError.set('');
      this.said.set('');
      const errors = await this.check();
      this.errors.set(errors);
      const first = (['file', 'family', 'licence'] as const).find((field) => errors[field]);
      if (first) {
        this.refuse(first, errors[first] as string);
        return;
      }
      const result = await this.service.upload(this.projectId(), this.file() as File, {
        family: normalizeFontFamily(this.family()),
        weight: this.weight(),
        style: this.style(),
        fallback: this.fallback(),
      });
      if (result.value === null) {
        this.refuse(refusedField(result.code, result.message), result.message);
        return;
      }
      this.said.set(`${result.value.family} ${fontFaceName(result.value)} uploaded.`);
      this.resetForm();
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(font: ProjectFont, family: string): Promise<void> {
    if (this.busy() || font.inUse) return;
    const name = `${family} ${fontFaceName(font)}`;
    if (!window.confirm(`Delete the font ${name}? Texts can no longer pick it.`)) return;
    this.busy.set(true);
    this.said.set('');
    this.listError.set('');
    const { value, message } = await this.service.remove(this.projectId(), font.id);
    this.busy.set(false);
    if (value === null) {
      this.listError.set(message);
      return;
    }
    this.said.set(`${name} deleted.`);
    await this.load();
  }
}
