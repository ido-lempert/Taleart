import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MAX_ANIMATED_COVER_BYTES } from '@taleart/contract/core';
import { CLIP_LENGTHS, CoverCapture, formatBytes } from './cover-capture';
import { DashboardStore } from './dashboard.store';

/** Where a new cover comes from. */
export type CoverSource = 'upload' | 'frame' | 'clip';

/** The image types a cover upload accepts. */
export const COVER_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

/** A cover made in the browser, waiting for Save: the file and its preview URL. */
interface MadeCover {
  blob: Blob;
  url: string;
}

/**
 * The body of the Cover drawer (epic web zones R12): the group's current
 * cover (or the default, its first tale's image), and a new one from an
 * uploaded image, a frame of a video tale picked with a timeline knob and
 * taken with "Use this frame", or a short animated clip of a video tale.
 * Frames and clips are made in the browser and uploaded by the drawer's Save,
 * which calls {@link save}. Messages for the drawer's alert go out through `problem`.
 */
@Component({
  selector: 'app-cover-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (group(); as group) {
      <div class="cover-current">
        <span class="ring ring--cover" aria-hidden="true">
          @if (group.cover; as cover) {
            @if (cover.kind === 'video') {
              <video
                class="ring__cover"
                [src]="store.coverSrc(group)"
                [muted]="true"
                [autoplay]="cover.animated && !reducedMotion"
                [loop]="cover.animated"
                playsinline
              ></video>
            } @else {
              <img class="ring__cover" [src]="store.coverSrc(group)" alt="" />
            }
          } @else if (defaultTale(); as tale) {
            @if (tale.media?.kind === 'video') {
              <video class="ring__cover" [src]="store.mediaSrc(tale) + '#t=0.001'" [muted]="true" playsinline preload="metadata"></video>
            } @else {
              <img class="ring__cover" [src]="store.mediaSrc(tale)" alt="" />
            }
          } @else {
            {{ group.name.charAt(0) }}
          }
        </span>
        <p class="muted">
          @if (group.cover; as cover) {
            {{ cover.animated ? 'Animated cover' : 'Still cover' }}
          } @else {
            First tale's media, or its background colour (default)
          }
        </p>
        @if (group.cover) {
          <button type="button" class="btn btn--secondary btn--sm" [disabled]="busy()" (click)="remove()">
            Remove cover
          </button>
        }
      </div>

      <fieldset class="tag-options" [disabled]="busy()">
        <legend class="field__label">New cover</legend>
        <label class="checkbox">
          <input type="radio" name="coverSource" [checked]="source() === 'upload'" (change)="pickSource('upload')" />
          Upload an image
        </label>
        <label class="checkbox">
          <input
            type="radio"
            name="coverSource"
            [checked]="source() === 'frame'"
            [disabled]="videoTales().length === 0"
            (change)="pickSource('frame')"
          />
          Frame of a video tale
        </label>
        <label class="checkbox">
          <input
            type="radio"
            name="coverSource"
            [checked]="source() === 'clip'"
            [disabled]="videoTales().length === 0 || !canRecord"
            (change)="pickSource('clip')"
          />
          Animated, from a video tale
        </label>
        @if (videoTales().length === 0) {
          <p class="field__hint">Add a video tale to this group to pick a frame or make an animated cover.</p>
        } @else if (!canRecord) {
          <p class="field__hint">This browser cannot record an animated cover.</p>
        }
      </fieldset>

      @if (source() === 'upload') {
        <div class="field">
          <label class="field__label" for="cover-file">Image</label>
          <input
            id="cover-file"
            class="input input--file"
            type="file"
            name="coverFile"
            [accept]="imageTypes"
            (change)="pickFile($event)"
            aria-describedby="cover-file-hint"
          />
          <p class="field__hint" id="cover-file-hint">
            JPEG, PNG, WebP or GIF up to 10 MB; an animated image up to {{ maxAnimated }}.
          </p>
        </div>
      } @else if (selectedTale(); as tale) {
        @if (videoTales().length > 1) {
          <div class="field">
            <label class="field__label" for="cover-tale">Video tale</label>
            <select id="cover-tale" class="select" name="coverTale" [disabled]="busy()" (change)="pickTale($event)">
              @for (option of videoTales(); track option.id) {
                <option [value]="option.id" [selected]="option.id === tale.id">{{ option.title }}</option>
              }
            </select>
          </div>
        }
        <video
          #sourceVideo
          class="cover-source"
          [src]="store.mediaSrc(tale)"
          [muted]="true"
          playsinline
          preload="auto"
          [attr.aria-label]="'Video of ' + tale.title"
          (loadedmetadata)="loaded()"
        ></video>
        <div class="field">
          <label class="field__label" for="cover-time">{{ source() === 'clip' ? 'Start time' : 'Frame time' }}</label>
          <input
            id="cover-time"
            class="range"
            type="range"
            name="coverTime"
            min="0"
            [max]="duration()"
            step="0.1"
            [value]="time()"
            [disabled]="busy()"
            [attr.aria-valuetext]="timeText()"
            (input)="seek($event)"
          />
          <p class="field__hint">{{ timeText() }}</p>
        </div>
        @if (source() === 'frame') {
          <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="useFrame()">Use this frame</button>
          @if (frame(); as made) {
            <div class="cover-made">
              <img class="cover-preview" [src]="made.url" alt="Chosen frame" />
              <p class="muted">Frame at {{ frameTime().toFixed(1) }} s</p>
            </div>
          }
        } @else {
          <div class="field">
            <label class="field__label" for="cover-length">Length</label>
            <select id="cover-length" class="select" name="coverLength" [disabled]="busy()" (change)="pickLength($event)">
              @for (length of lengths; track length) {
                <option [value]="length" [selected]="length === seconds()">{{ length }} s</option>
              }
            </select>
          </div>
          <button type="button" class="btn btn--secondary" [disabled]="busy()" (click)="makeClip()">
            {{ recording() ? 'Recording…' : clip() ? 'Make again' : 'Make animated cover' }}
          </button>
          @if (clip(); as made) {
            <div class="cover-made">
              <video
                class="cover-preview"
                [src]="made.url"
                [muted]="true"
                autoplay
                loop
                playsinline
                aria-label="Animated cover preview"
              ></video>
              <p class="cover-size" [class.cover-size--over]="made.blob.size > maxAnimatedBytes">
                {{ formatBytes(made.blob.size) }} of {{ maxAnimated }}
              </p>
            </div>
          }
        }
      }
      <p class="visually-hidden" aria-live="polite">{{ status() }}</p>
    } @else {
      <p class="muted">This tale group no longer exists.</p>
    }
  `,
})
export class CoverEditor {
  protected readonly store = inject(DashboardStore);
  private readonly capture = inject(CoverCapture);

  readonly taleGroupId = input.required<string>();
  /** A message for the drawer's alert; '' clears it. */
  readonly problem = output<string>();
  /** Emitted once the cover is removed; the drawer then closes. */
  readonly removed = output<void>();

  protected readonly imageTypes = COVER_IMAGE_TYPES;
  protected readonly lengths = CLIP_LENGTHS;
  protected readonly formatBytes = formatBytes;
  protected readonly maxAnimatedBytes = MAX_ANIMATED_COVER_BYTES;
  protected readonly maxAnimated = formatBytes(MAX_ANIMATED_COVER_BYTES);
  protected readonly canRecord = this.capture.canRecord();
  protected readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  protected readonly group = computed(() => this.store.taleGroup(this.taleGroupId()));
  /**
   * The tale whose media is the default cover (Tale Studio R16): the first tale, when it has media;
   * the bar then shows its lowest media element, which a tale's media is unless a person moved it.
   */
  protected readonly defaultTale = computed(() => {
    const first = this.group()?.tales[0];
    return first?.media ? first : undefined;
  });
  /** The group's tales whose media is a video: the sources of a frame or a clip. */
  protected readonly videoTales = computed(() => this.group()?.tales.filter((t) => t.media?.kind === 'video') ?? []);
  protected readonly source = signal<CoverSource>('upload');
  protected readonly taleId = linkedSignal(() => this.videoTales()[0]?.id ?? '');
  protected readonly selectedTale = computed(() => this.videoTales().find((t) => t.id === this.taleId()));
  /** The source video's length and the knob's position, in seconds. */
  protected readonly duration = signal(0);
  protected readonly time = signal(0);
  protected readonly seconds = signal<number>(2);
  protected readonly recording = signal(false);
  protected readonly capturing = signal(false);
  protected readonly removing = signal(false);
  protected readonly busy = computed(() => this.recording() || this.capturing() || this.removing());
  /** The frame taken with "Use this frame", and the knob time it was taken at. */
  protected readonly frame = signal<MadeCover | null>(null);
  protected readonly frameTime = signal(0);
  /** The clip made last. */
  protected readonly clip = signal<MadeCover | null>(null);
  /** What the polite live region last announced. */
  protected readonly status = signal('');
  private file: File | null = null;
  private recordingAbort: AbortController | null = null;
  private destroyed = false;
  private readonly sourceVideo = viewChild<ElementRef<HTMLVideoElement>>('sourceVideo');

  protected readonly timeText = computed(() => `${this.time().toFixed(1)} s of ${this.duration().toFixed(1)} s`);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelRecording();
      this.setFrame(null);
      this.setClip(null);
    });
  }

  protected pickSource(source: CoverSource): void {
    this.cancelRecording();
    this.source.set(source);
    this.problem.emit('');
  }

  protected pickFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.problem.emit('');
  }

  protected pickTale(event: Event): void {
    this.cancelRecording();
    this.taleId.set((event.target as HTMLSelectElement).value);
    this.duration.set(0);
    this.time.set(0);
    this.setFrame(null);
    this.setClip(null);
  }

  protected pickLength(event: Event): void {
    this.seconds.set(Number((event.target as HTMLSelectElement).value));
    this.setClip(null);
  }

  protected loaded(): void {
    const video = this.sourceVideo()?.nativeElement;
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
    this.duration.set(duration);
    this.time.set(Math.min(this.time(), duration));
  }

  /** Moves the video to the knob's time, so the frame shown is the one a still cover takes. */
  protected seek(event: Event): void {
    if (this.busy()) return;
    const time = Number((event.target as HTMLInputElement).value);
    this.time.set(time);
    const video = this.sourceVideo()?.nativeElement;
    if (video) video.currentTime = time;
    // A frame or clip made at another time no longer matches the knob.
    this.setFrame(null);
    this.setClip(null);
  }

  // The frame at the knob's time: the video is moved there first, since a clip recording moves it.
  private async frameAtKnob(video: HTMLVideoElement): Promise<Blob> {
    const time = this.time();
    await this.capture.seekTo(video, time);
    const blob = await this.capture.captureFrame(video);
    this.frameTime.set(time);
    return blob;
  }

  /** Takes the frame at the knob's time into the preview; Save uploads it. */
  protected async useFrame(): Promise<void> {
    const video = this.sourceVideo()?.nativeElement;
    if (!video || this.busy()) return;
    this.capturing.set(true);
    this.problem.emit('');
    try {
      const blob = await this.frameAtKnob(video);
      if (this.destroyed) return;
      this.setFrame(blob);
      this.status.set(`Frame at ${this.frameTime().toFixed(1)} s chosen`);
    } catch (err) {
      if (!this.destroyed) this.problem.emit(err instanceof Error ? err.message : 'The frame could not be taken.');
    } finally {
      this.capturing.set(false);
    }
  }

  /** Records the animated cover from the knob's time and shows it with its size. */
  protected async makeClip(): Promise<void> {
    const video = this.sourceVideo()?.nativeElement;
    if (!video || this.busy()) return;
    const abort = new AbortController();
    this.recordingAbort = abort;
    this.recording.set(true);
    this.problem.emit('');
    this.status.set('Recording the animated cover');
    try {
      const blob = await this.capture.recordClip(video, this.time(), this.seconds(), abort.signal);
      // A cancelled recording shows and announces nothing.
      if (abort.signal.aborted) return;
      this.setClip(blob);
      const size = formatBytes(blob.size);
      if (blob.size > MAX_ANIMATED_COVER_BYTES) {
        this.status.set('');
        this.problem.emit(`This animated cover is ${size}, above the ${this.maxAnimated} limit. Choose a shorter length.`);
      } else {
        this.status.set(`Animated cover ready, ${size}`);
      }
    } catch (err) {
      if (abort.signal.aborted) return;
      this.status.set('');
      this.problem.emit(err instanceof Error ? err.message : 'The animated cover could not be made.');
    } finally {
      if (this.recordingAbort === abort) this.recordingAbort = null;
      this.recording.set(false);
    }
  }

  /** Saves the new cover; resolves to '' or the message to show. */
  async save(): Promise<string> {
    const taleGroupId = this.taleGroupId();
    if (this.busy()) return 'Wait until the cover is ready.';
    switch (this.source()) {
      case 'upload':
        return this.file ? this.store.uploadCover(taleGroupId, this.file) : 'Choose an image to upload.';
      case 'frame': {
        const chosen = this.frame();
        if (chosen) return this.store.uploadCover(taleGroupId, chosen.blob);
        const video = this.sourceVideo()?.nativeElement;
        if (!video) return 'Choose a video tale.';
        let blob: Blob;
        try {
          blob = await this.frameAtKnob(video);
        } catch (err) {
          return err instanceof Error ? err.message : 'The frame could not be saved.';
        }
        return this.store.uploadCover(taleGroupId, blob);
      }
      case 'clip': {
        const clip = this.clip();
        if (!clip) return 'Make the animated cover first.';
        if (clip.blob.size > MAX_ANIMATED_COVER_BYTES) {
          return `This animated cover is ${formatBytes(clip.blob.size)}, above the ${this.maxAnimated} limit. Choose a shorter length.`;
        }
        return this.store.uploadCover(taleGroupId, clip.blob);
      }
    }
  }

  /** Removes the cover at once; the drawer closes when it is gone. */
  protected async remove(): Promise<void> {
    if (this.busy()) return;
    this.removing.set(true);
    this.problem.emit('');
    try {
      const message = await this.store.removeCover(this.taleGroupId());
      if (message) this.problem.emit(message);
      else this.removed.emit();
    } finally {
      this.removing.set(false);
    }
  }

  // Stops a recording in progress; its result is then dropped.
  private cancelRecording(): void {
    this.recordingAbort?.abort();
    this.recordingAbort = null;
  }

  private setFrame(blob: Blob | null): void {
    this.frame.set(this.made(this.frame(), blob));
  }

  private setClip(blob: Blob | null): void {
    this.clip.set(this.made(this.clip(), blob));
  }

  // Releases the previous preview URL and makes one for the new file, unless the editor is gone.
  private made(previous: MadeCover | null, blob: Blob | null): MadeCover | null {
    if (previous?.url) URL.revokeObjectURL(previous.url);
    if (!blob || this.destroyed) return null;
    return { blob, url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '' };
  }
}
