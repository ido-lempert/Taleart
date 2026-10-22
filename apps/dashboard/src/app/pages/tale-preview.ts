import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { ProjectFont } from '@taleart/contract/core';
import { projectFontIds } from '@taleart/contract/project-fonts';
import type { TaleDocument } from '@taleart/contract/tale-document';
import {
  DEFAULT_PREVIEW_SIZE,
  PREVIEW_SIZES,
  previewDocument,
  TalePreview,
  type PreviewSizeId,
  type PreviewTale,
} from '@taleart/web-sdk/preview';
import { projectFontFileUrl } from '../project-fonts.service';
import { projectMediaSrc } from '../project-media.service';

// An absolute URL, as the Delivery API sends them and the SDK requires: the dashboard's media and
// font URLs are paths on its own origin.
function absolute(url: string): string {
  return new URL(url, globalThis.location?.href ?? 'http://localhost/').href;
}

/**
 * The Tale Studio preview (epic Tale Studio R10, AD-16): the Web SDK's own viewer and document
 * renderer, mounted on the unsaved document, at a phone size, with the viewer's chrome, playing the
 * tale for its duration. Every change to the document shows at once. Links show but go nowhere.
 */
@Component({
  selector: 'app-tale-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      flex: none;
      /* As wide as the phone screen: the controls wrap above it, so the pane fits beside the panel. */
      width: min-content;
      max-width: 100%;
      overflow-x: auto;
    }
    .preview__controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    .preview__size {
      width: auto;
    }
    .preview__screen {
      position: relative;
      flex: none;
      overflow: hidden;
      border-radius: var(--radius-control);
      background: #000;
    }
    .preview__host {
      width: 100%;
      height: 100%;
    }
    .preview__ended {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      background: rgb(0 0 0 / 70%);
    }
  `,
  template: `
    <h4 class="field__label" id="preview-title">Preview</h4>
    <p class="field__hint" id="preview-hint">
      As the Web SDK shows it on a phone, with your unsaved changes. Links show but do not open here, and sound is
      off until you turn it on.
    </p>
    <div class="preview__controls">
      <label class="field__label" for="preview-size">Phone size</label>
      <select
        id="preview-size"
        class="input preview__size"
        [value]="size()"
        (change)="size.set($any($event.target).value)"
      >
        @for (s of sizes; track s.id) {
          <option [value]="s.id" [selected]="s.id === size()">{{ s.label }} ({{ s.width }} × {{ s.height }})</option>
        }
      </select>
      <label class="checkbox">
        <input
          type="checkbox"
          id="preview-safe-area"
          [checked]="safeArea()"
          (change)="safeArea.set($any($event.target).checked)"
        />
        Show safe areas
      </label>
      <label class="checkbox">
        <input type="checkbox" id="preview-sound" [checked]="sound()" (change)="sound.set($any($event.target).checked)" />
        Sound
      </label>
      <button #replayButton type="button" class="btn btn--secondary btn--sm" id="preview-replay" (click)="replay()">
        Play from the start
      </button>
    </div>
    <div
      class="preview__screen"
      role="group"
      aria-labelledby="preview-title"
      aria-describedby="preview-hint"
      [style.width.px]="screen().width"
      [style.height.px]="screen().height"
    >
      <div #host class="preview__host" id="preview-host"></div>
      @if (ended()) {
        <div class="preview__ended">
          <button type="button" class="btn btn--primary" id="preview-play-again" (click)="replay()">Play again</button>
        </div>
      }
    </div>
  `,
})
export class TalePreviewPane {
  /** The studio's unsaved document. */
  readonly document = input.required<TaleDocument>();
  readonly projectId = input<string | undefined>();
  readonly taleId = input.required<string>();
  readonly title = input('');
  readonly groupName = input('');
  /** The project's complete theme, as the Delivery API sends it, or null before it loads. */
  readonly theme = input<unknown>(null);
  readonly fonts = input<readonly ProjectFont[] | null>(null);

  protected readonly sizes = PREVIEW_SIZES;
  protected readonly size = signal<PreviewSizeId>(DEFAULT_PREVIEW_SIZE);
  protected readonly screen = computed(() => PREVIEW_SIZES.find((s) => s.id === this.size()) ?? PREVIEW_SIZES[1]);
  protected readonly safeArea = signal(false);
  protected readonly sound = signal(false);
  protected readonly ended = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly replayButton = viewChild.required<ElementRef<HTMLButtonElement>>('replayButton');
  private readonly preview = signal<TalePreview | null>(null);

  /** The tale as a visitor's SDK would be sent it: the draft, delivered. */
  private readonly tale = computed<PreviewTale>(() => {
    const projectId = this.projectId();
    const doc = this.document();
    const used = projectFontIds(doc);
    const fonts = (this.fonts() ?? [])
      .filter((font) => projectId && used.includes(font.id))
      .map((font) => ({
        id: font.id,
        url: absolute(projectFontFileUrl(projectId as string, font.id)),
        weight: font.weight,
        style: font.style,
      }));
    return {
      id: this.taleId(),
      title: this.title(),
      groupName: this.groupName() || this.title(),
      document: previewDocument(doc, (key) => (projectId ? absolute(projectMediaSrc(projectId, key)) : null)),
      fonts,
    };
  });

  constructor() {
    afterNextRender(() => {
      this.preview.set(
        new TalePreview(this.host().nativeElement, {
          onEnded: () => this.ended.set(true),
          onStarted: () => this.ended.set(false),
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => this.preview()?.destroy());
    effect(() => this.preview()?.show(this.tale()));
    effect(() => this.preview()?.setTheme(this.theme()));
    effect(() => this.preview()?.setSafeArea(this.safeArea()));
    effect(() => this.preview()?.setSound(this.sound()));
  }

  /** Plays the tale again from its start, with the document as it is now. */
  protected replay(): void {
    const preview = this.preview();
    if (!preview) return;
    const fromEnd = this.ended();
    preview.replay();
    // "Play again" goes away with the end card: focus stays in the pane, on Play from the start.
    if (fromEnd) this.replayButton().nativeElement.focus();
  }
}
