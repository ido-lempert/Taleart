// Tale Studio's media parts (epic Tale Studio R5, R2, R12): the picker over the project's media,
// with upload, and the inspector of a selected image or video.
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { isMediaContentType, maxMediaBytes, type MediaKind, type ProjectMedia } from '@taleart/contract/core';
import {
  MAX_LABEL_LENGTH,
  MAX_MEDIA_RADIUS,
  MAX_TALE_VIDEO_MS,
  MEDIA_FITS,
  type ImageElementProps,
  type ImageButtonElement,
  type MediaElement,
  type MediaFit,
  type StickerElementProps,
  type TaleElementA11y,
} from '@taleart/contract/tale-document';
import { Drawer } from '../drawer';
import { ProjectMediaService, projectMediaSrc } from '../project-media.service';
import { cleanLabel, percent } from './tale-layers';

/** The names people read for each fit. */
export const FIT_NAMES: Readonly<Record<MediaFit, string>> = {
  cover: 'Fill the box (crop)',
  contain: 'Fit inside the box',
};

/** The file types each kind of upload takes, as the file input's `accept`. */
const ACCEPT: Readonly<Record<MediaKind, string>> = {
  image: 'image/png,image/jpeg,image/gif,image/webp',
  video: 'video/mp4,video/webm',
};

const KIND_NAMES: Readonly<Record<MediaKind | 'sticker', string>> = {
  image: 'image',
  video: 'video',
  sticker: 'sticker',
};

/** The file types an image sticker takes (R6): PNG, WebP and GIF, which may be transparent. */
export const STICKER_CONTENT_TYPES: readonly string[] = ['image/png', 'image/webp', 'image/gif'];

/** How the picker names a piece of media, for its button. */
export function mediaChoiceName(media: ProjectMedia): string {
  const kind = KIND_NAMES[media.kind];
  if (media.source === 'tale') return `The ${kind} of the tale “${media.taleTitle ?? ''}”`;
  if (media.source === 'document') return kind === 'image' ? 'An image used in a tale' : 'A video used in a tale';
  const when = media.createdAt ? new Date(media.createdAt) : null;
  const date = when ? when.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return `Uploaded ${kind}${date ? `, ${date}` : ''}`;
}

/**
 * The project's media to pick an image or a video from (R5), in a drawer: the project's uploads,
 * its tales' media and what its tales' documents use, of the kind asked for, each a button showing
 * it; and an upload, through the storage port, whose file is then picked. The server judges the file
 * by its bytes.
 */
@Component({
  selector: 'app-tale-media-picker',
  imports: [Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .media-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .media-choice {
      display: block;
      width: 100%;
      aspect-ratio: 9 / 16;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--line, #ccc);
      border-radius: var(--radius-control);
      background: #111;
      cursor: pointer;
    }
    .media-choice:focus-visible {
      outline: 3px solid var(--ember);
      outline-offset: 2px;
    }
    .media-choice img,
    .media-choice video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      pointer-events: none;
    }
  `,
  template: `
    <app-drawer [heading]="heading()" [returnFocus]="returnFocus()" [busy]="uploading()" (closed)="closed.emit()">
      <div class="drawer__body">
        <div class="field">
          <label class="field__label" for="media-upload">Upload {{ kindName() }}</label>
          <input
            id="media-upload"
            class="input"
            type="file"
            [accept]="accept()"
            aria-describedby="media-upload-hint"
            [attr.aria-invalid]="error() ? 'true' : null"
            [disabled]="uploading()"
            (change)="uploadFrom($any($event.target))"
          />
          <span class="field__hint" id="media-upload-hint">{{ hint() }}</span>
          @if (error()) {
            <span class="field__error" role="alert">{{ error() }}</span>
          }
          @if (uploading()) {
            <span class="field__hint" role="status">Uploading…</span>
          }
        </div>
        <h3 class="field__label" id="media-list-title">
          The project's {{ stickers() ? 'PNG, WebP and GIF images' : kindName() + 's' }}
        </h3>
        @if (items() === null) {
          <p class="muted" role="status">{{ loadError() || 'Loading…' }}</p>
        } @else if (items()?.length === 0) {
          <p class="muted">
            No {{ stickers() ? 'PNG, WebP or GIF images' : kindName() + 's' }} in this project yet. Upload one above.
          </p>
        } @else {
          <ul class="media-grid" aria-labelledby="media-list-title">
            @for (media of items(); track media.key) {
              <li>
                <button
                  type="button"
                  class="media-choice"
                  [attr.aria-label]="'Use ' + choiceName(media)"
                  [attr.aria-current]="media.key === currentKey() ? 'true' : null"
                  (click)="chosen.emit(media)"
                >
                  @if (media.kind === 'video') {
                    <video
                      [src]="src(media)"
                      [muted]="true"
                      muted
                      playsinline
                      preload="metadata"
                      aria-hidden="true"
                    ></video>
                  } @else {
                    <img [src]="src(media)" alt="" loading="lazy" />
                  }
                </button>
              </li>
            }
          </ul>
        }
      </div>
    </app-drawer>
  `,
})
export class TaleMediaPicker {
  private readonly media = inject(ProjectMediaService);
  readonly projectId = input.required<string>();
  readonly kind = input.required<MediaKind>();
  /** Picks an image sticker (R6): PNG, WebP and GIF images only. */
  readonly stickers = input(false);
  readonly heading = input.required<string>();
  /** The key in use now, marked in the list. */
  readonly currentKey = input<string | null>(null);
  /** Where focus goes when the picker closes. */
  readonly returnFocus = input<HTMLElement | null>(null);
  readonly chosen = output<ProjectMedia>();
  readonly closed = output<void>();

  private readonly all = signal<readonly ProjectMedia[] | null>(null);
  protected readonly items = computed(
    () =>
      this.all()?.filter(
        (m) => m.kind === this.kind() && (!this.stickers() || STICKER_CONTENT_TYPES.includes(m.contentType)),
      ) ?? null,
  );
  protected readonly uploading = signal(false);
  protected readonly error = signal('');
  protected readonly loadError = signal('');
  protected readonly kindName = computed(() => KIND_NAMES[this.kind()]);
  protected readonly accept = computed(() => (this.stickers() ? STICKER_CONTENT_TYPES.join(',') : ACCEPT[this.kind()]));
  protected readonly hint = computed(() =>
    this.kind() === 'video'
      ? 'An MP4 or WebM video, at most 100 MB. It is used as it is, without converting it.'
      : this.stickers()
        ? 'A PNG, WebP or GIF image, at most 10 MB. A transparent background suits a sticker.'
        : 'A JPEG, PNG, WebP or GIF image, at most 10 MB.',
  );

  constructor() {
    effect(() => {
      void this.load(this.projectId());
    });
  }

  private async load(projectId: string): Promise<void> {
    const result = await this.media.list(projectId);
    if (projectId !== this.projectId()) return;
    if (result.value === null) this.loadError.set(result.message);
    else this.all.set(result.value);
  }

  protected src(media: ProjectMedia): string {
    return projectMediaSrc(this.projectId(), media.key);
  }

  protected choiceName(media: ProjectMedia): string {
    return mediaChoiceName(media);
  }

  /** Uploads the chosen file; once stored it is picked. A refusal stays on the field. */
  protected async uploadFrom(field: HTMLInputElement): Promise<void> {
    const file = field.files?.[0];
    if (!file || this.uploading()) return;
    this.error.set('');
    if (isMediaContentType(file.type) && file.size > maxMediaBytes(file.type)) {
      this.error.set(
        `The file is larger than ${maxMediaBytes(file.type) / (1024 * 1024)} MB. Choose a smaller ${this.kindName()}.`,
      );
      field.value = '';
      return;
    }
    if (!this.accept().split(',').includes(file.type)) {
      this.error.set(
        this.kind() === 'video'
          ? 'Choose an MP4 or WebM video.'
          : this.stickers()
            ? 'Choose a PNG, WebP or GIF image.'
            : 'Choose a JPEG, PNG, WebP or GIF image.',
      );
      field.value = '';
      return;
    }
    this.uploading.set(true);
    const result = await this.media.upload(this.projectId(), file);
    this.uploading.set(false);
    field.value = '';
    if (result.value === null) {
      this.error.set(result.message);
      return;
    }
    this.all.set([result.value, ...(this.all() ?? [])]);
    this.chosen.emit(result.value);
  }
}

/** A change the media inspector asks for: one history step, with what the live region says. */
export interface MediaChange {
  label: string;
  props?: Partial<ImageElementProps> | Partial<StickerElementProps>;
  a11y?: TaleElementA11y;
  said: string;
}

/**
 * The inspector of a selected image, video or image sticker (R5, R6, R12): its alt text or the
 * decorative mark, how it fills its box and its corner radius (not for a sticker, which shows the
 * whole image), its opacity, and a way to pick other media. Values are
 * checked here as the server checks them; a value out of range is put back with a message.
 */
@Component({
  selector: 'app-tale-media-style',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label class="field__label" [for]="'media-alt-' + element().id">Alt text</label>
      <textarea
        class="input"
        rows="2"
        [id]="'media-alt-' + element().id"
        [attr.aria-describedby]="'media-alt-hint-' + element().id"
        [attr.aria-invalid]="needsAlt() ? 'true' : null"
        [readOnly]="locked()"
        [disabled]="decorative()"
        [maxLength]="maxLabel"
        [value]="element().a11y.label ?? ''"
        (change)="setAlt($any($event.target))"
      ></textarea>
      <span class="field__hint" [id]="'media-alt-hint-' + element().id">
        @if (needsAlt()) {
          Needs alt text, or mark it decorative, before the tale can be updated.
        } @else {
          What the {{ kindName() }} shows, for people who cannot see it. Up to {{ maxLabel }} characters.
        }
      </span>
    </div>
    <label class="checkbox">
      <input
        type="checkbox"
        [checked]="decorative()"
        [disabled]="locked()"
        (change)="setDecorative($any($event.target))"
      />
      Decorative: it adds nothing to the tale, and screen readers skip it
    </label>
    <div class="row">
      @if (element().type !== 'sticker') {
        <div class="field">
          <label class="field__label" [for]="'media-fit-' + element().id">Fit</label>
          <select
            class="input"
            [id]="'media-fit-' + element().id"
            [disabled]="locked()"
            (change)="setFit($any($event.target).value)"
          >
            @for (fit of fits; track fit) {
              <option [value]="fit" [selected]="fit === currentFit()">{{ fitNames[fit] }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label class="field__label" [for]="'media-radius-' + element().id">Corner radius (%)</label>
          <input
            class="input"
            type="number"
            min="0"
            [max]="maxRadius"
            step="0.5"
            [id]="'media-radius-' + element().id"
            [readOnly]="locked()"
            [value]="radius()"
            (change)="setRadius($any($event.target))"
          />
        </div>
      }
      <div class="field">
        <label class="field__label" [for]="'media-opacity-' + element().id">Opacity (%)</label>
        <input
          class="input"
          type="number"
          min="0"
          max="100"
          step="5"
          [id]="'media-opacity-' + element().id"
          [readOnly]="locked()"
          [value]="opacity()"
          (change)="setOpacity($any($event.target))"
        />
      </div>
    </div>
    @if (element().type !== 'sticker') {
      <span class="field__hint">The corner radius is a share of the canvas height.</span>
    }
    @if (videoSeconds(); as seconds) {
      @if (seconds > maxVideoSeconds) {
        <p class="field__hint layer__warning" role="status">
          This video is {{ seconds.toFixed(1) }} s long: only the first {{ maxVideoSeconds }} s will play.
        </p>
      }
    }
    <div class="row">
      <button
        type="button"
        class="btn btn--secondary btn--sm"
        [id]="'media-replace-' + element().id"
        [attr.aria-disabled]="locked() ? 'true' : null"
        (click)="locked() ? notice.emit(lockedHint()) : replace.emit()"
      >
        Choose another {{ kindName() }}…
      </button>
    </div>
  `,
})
export class TaleMediaStyle {
  readonly element = input.required<Exclude<MediaElement, ImageButtonElement>>();
  readonly locked = input(false);
  readonly lockedHint = input('');
  /** The video's length in seconds once the canvas read it; null for an image or before. */
  readonly videoSeconds = input<number | null>(null);
  readonly changed = output<MediaChange>();
  readonly notice = output<string>();
  readonly replace = output<void>();

  protected readonly fits = MEDIA_FITS;
  protected readonly fitNames = FIT_NAMES;
  protected readonly maxVideoSeconds = MAX_TALE_VIDEO_MS / 1000;
  protected readonly maxLabel = MAX_LABEL_LENGTH;
  protected readonly maxRadius = percent(MAX_MEDIA_RADIUS);
  protected readonly kindName = computed(() => KIND_NAMES[this.element().type]);
  protected readonly decorative = computed(() => this.element().a11y.decorative === true);
  protected readonly needsAlt = computed(
    () => !this.decorative() && (this.element().a11y.label ?? '').trim() === '' && !this.element().hidden,
  );
  // A sticker has no fit or radius: it always shows the whole image.
  private readonly props = computed(() => this.element().props as Partial<ImageElementProps>);
  protected readonly currentFit = computed(() => this.props().fit ?? 'contain');
  protected readonly radius = computed(() => percent(this.props().radius ?? 0));
  protected readonly opacity = computed(() => Math.round((this.element().props.opacity ?? 1) * 100));

  protected setAlt(field: HTMLTextAreaElement): void {
    if (this.locked()) return;
    // One line, without the characters a label may not hold (the server refuses them), and within its limit.
    const label = cleanLabel(field.value);
    field.value = label;
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (label.trim()) a11y.label = label;
    else delete a11y.label;
    this.changed.emit({
      label: 'Alt text changed',
      a11y,
      said: label.trim() ? 'Alt text set' : `Alt text removed; the ${this.kindName()} needs it before the tale can be updated`,
    });
  }

  protected setDecorative(box: HTMLInputElement): void {
    if (this.locked()) {
      box.checked = this.decorative();
      return;
    }
    const a11y: TaleElementA11y = { ...this.element().a11y };
    if (box.checked) a11y.decorative = true;
    else delete a11y.decorative;
    this.changed.emit({
      label: box.checked ? 'Marked decorative' : 'Decorative mark removed',
      a11y,
      said: box.checked ? 'Marked decorative: screen readers skip it' : 'No longer decorative',
    });
  }

  protected setFit(fit: string): void {
    if (this.locked() || !(MEDIA_FITS as readonly string[]).includes(fit)) return;
    const value = fit as MediaFit;
    this.changed.emit({ label: 'Fit changed', props: { fit: value }, said: `Fit set to ${FIT_NAMES[value]}` });
  }

  protected setRadius(field: HTMLInputElement): void {
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.radius());
      if (!this.locked()) this.notice.emit(`Enter a number from 0 to ${this.maxRadius}; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(MAX_MEDIA_RADIUS, Math.max(0, Math.round(requested * 10) / 1000));
    field.value = String(percent(value));
    this.changed.emit({
      label: 'Corner radius changed',
      props: { radius: value },
      said: `Corner radius set to ${percent(value)}%`,
    });
  }

  protected setOpacity(field: HTMLInputElement): void {
    const requested = Number(field.value);
    if (this.locked() || field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.opacity());
      if (!this.locked()) this.notice.emit(`Enter a number from 0 to 100; it stays at ${field.value}%`);
      return;
    }
    const value = Math.min(1, Math.max(0, Math.round(requested) / 100));
    field.value = String(Math.round(value * 100));
    this.changed.emit({
      label: 'Opacity changed',
      props: { opacity: value },
      said: `Opacity set to ${Math.round(value * 100)}%`,
    });
  }
}
