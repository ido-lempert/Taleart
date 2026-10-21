import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
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
  projectFontFamilyError,
  WOFF2_HEADER_BYTES,
  type ProjectFontStyle,
} from '@taleart/contract/project-fonts';
import { SYSTEM_FONT_STACK_KEYS, textFontFamily, type SystemFontStack } from '@taleart/contract/text-style';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { projectFontFileUrl, ProjectFontsService } from '../project-fonts.service';
import { STACK_NAMES } from './tale-text-style';

/** The fields of the upload form that can be refused. */
type FontField = 'file' | 'family' | 'licence';

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
  imports: [RouterLink, Icon],
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
    .fonts-saved {
      margin: 0;
      color: var(--text-secondary);
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
        <form class="fonts-form" (submit)="$event.preventDefault(); upload()" novalidate>
          <div class="field">
            <label class="field__label" for="font-file">Font file</label>
            <input
              #fileInput
              id="font-file"
              class="input"
              type="file"
              accept=".woff2,font/woff2"
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
            Text shows the fallback until the font has loaded, and keeps it if the font does not load within 3 seconds.
          </span>

          <div class="field">
            <label class="checkbox fonts-licence">
              <input
                id="font-licence"
                type="checkbox"
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
            <ul class="fonts-list" aria-labelledby="fonts-list-title">
              @for (group of families(); track group.family) {
                <li>
                  <h4 class="fonts-family">{{ group.family }}</h4>
                  <ul class="fonts-faces" [attr.aria-label]="group.family + ' faces'">
                    @for (font of group.faces; track font.id) {
                      <li class="fonts-face">
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
                            {{ font.inUse ? 'Used by a tale.' : 'Not used by any tale.' }}
                          </span>
                        </span>
                        <button
                          type="button"
                          class="btn btn--secondary btn--sm"
                          [attr.aria-label]="'Delete ' + group.family + ' ' + faceLabel(font)"
                          [disabled]="busy()"
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
          }
        } @else if (!listError()) {
          <p class="muted">Loading the fonts…</p>
        }
      </section>
    </div>
  `,
})
export class FontsPage implements OnInit {
  protected readonly store = inject(DashboardStore);
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

  protected readonly weights = FONT_WEIGHTS;
  protected readonly weightNames = FONT_WEIGHT_NAMES;
  protected readonly styles = FONT_STYLES;
  protected readonly stacks = SYSTEM_FONT_STACK_KEYS;
  protected readonly stackNames = STACK_NAMES;
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
    return STACK_NAMES[font.fallback as SystemFontStack] ?? font.fallback;
  }

  protected sampleFamily(font: ProjectFont): string {
    return textFontFamily({ font: { source: 'project', fontId: font.id }, fallback: font.fallback });
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
    if (projectFontFamilyError(this.family()) !== null) {
      errors.family =
        'Enter one font name of letters, digits, spaces and hyphens, starting with a letter, with no commas or quotes ' +
        `(not a CSS keyword such as inherit), at most ${this.maxFamily} characters.`;
    }
    if (!this.licence()) errors.licence = 'Confirm that you may use and distribute this font.';
    return errors;
  }

  protected async upload(): Promise<void> {
    if (this.busy()) return;
    this.uploadError.set('');
    this.said.set('');
    const errors = await this.check();
    this.errors.set(errors);
    const first = (['file', 'family', 'licence'] as const).find((field) => errors[field]);
    if (first) {
      this.uploadError.set(`The font was not uploaded: ${errors[first]}`);
      document.getElementById(first === 'file' ? 'font-file' : `font-${first}`)?.focus();
      return;
    }
    this.busy.set(true);
    const family = this.family().trim();
    const { value, message } = await this.service.upload(this.projectId(), this.file() as File, {
      family,
      weight: this.weight(),
      style: this.style(),
      fallback: this.fallback(),
    });
    this.busy.set(false);
    if (value === null) {
      this.uploadError.set(message);
      return;
    }
    this.said.set(`${value.family} ${fontFaceName(value)} uploaded.`);
    this.licence.set(false);
    await this.load();
  }

  protected async remove(font: ProjectFont, family: string): Promise<void> {
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
