import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  InjectionToken,
  input,
  signal,
} from '@angular/core';
import type { Tale } from '@taleart/contract/core';
import type { TaleDocument, TaleDocumentRevision } from '@taleart/contract/tale-document';
import { firstValueFrom } from 'rxjs';
import { captureFrame, seekTo } from './cover-capture';
import { API_BASE, API_ORIGIN } from './dashboard.store';
import { projectMediaSrc } from './project-media.service';

/**
 * A tale's thumbnail outside the studio (the tale group page's cards, the group rows' default cover):
 * the tale's FIRST media background (an image is its picture; a video background is its first frame,
 * drawn once by the cover capture and kept). A tale without one shows its own media (`tale.media`, the
 * same frame rule), else its canvas colour, and a tale with none shows a placeholder: the card's tone.
 * A group's default thumbnail is that of its first tale with a picture, else its first tale's colour.
 */
export type TaleThumbnail = { kind: 'image'; src: string } | { kind: 'color'; color: string | null };

/**
 * A media background of a document: a project file (its storage key), or an external https address
 * (`url`, with an empty key); and what kind of file it is.
 */
export interface BackgroundMedia {
  key: string;
  url?: string;
  kind: 'image' | 'video';
}

/**
 * The document media keys, as the contract's `MEDIA_KEY_PATTERN` says. Kept here, not imported: the
 * contract's document module is lazy-only in the dashboard.
 */
const MEDIA_KEY = /^(tales|media)\/[a-z0-9][a-z0-9-]{0,99}\.(png|jpg|gif|webp|mp4|webm)$/;

/** An external background address: https only, as the contract's document check asks. */
const EXTERNAL_URL = /^https:\/\/\S+$/i;

/**
 * What kind of file a media background is, as the contract's `backgroundKind` says (kept here, not
 * imported, like {@link MEDIA_KEY}): its `kind` when set, else a video when its key ends .mp4/.webm.
 */
function backgroundFileKind(background: { kind?: unknown; mediaKey?: unknown }): 'image' | 'video' {
  if (background.kind === 'image' || background.kind === 'video') return background.kind;
  return typeof background.mediaKey === 'string' && /\.(mp4|webm)$/.test(background.mediaKey) ? 'video' : 'image';
}

/**
 * The first background of a document when it is media (an image, or a video's first frame), else null.
 * A background on another site (`externalUrl`) is returned with its `url` and no key.
 */
export function firstBackground(doc: TaleDocument | null | undefined): BackgroundMedia | null {
  const background = doc?.canvas?.background as
    | { type?: unknown; mediaKey?: unknown; externalUrl?: unknown; kind?: unknown }
    | undefined;
  if (background?.type !== 'media') return null;
  if (typeof background.externalUrl === 'string') {
    if (!EXTERNAL_URL.test(background.externalUrl)) return null;
    return { key: '', url: background.externalUrl, kind: backgroundFileKind(background) };
  }
  if (typeof background.mediaKey !== 'string' || !MEDIA_KEY.test(background.mediaKey)) return null;
  return { key: background.mediaKey, kind: backgroundFileKind(background) };
}

/**
 * The picture a document's first background shows in a tale strip: the image's source ('' for a colour
 * or a video background), or undefined when there is no document to read.
 */
export function documentPicture(doc: TaleDocument | null | undefined, projectId: string): string | undefined {
  if (!doc) return undefined;
  const background = firstBackground(doc);
  if (background?.kind !== 'image') return '';
  return background.url ?? projectMediaSrc(projectId, background.key);
}

/** The canvas colour of a document as a CSS colour, or null when its background is not a colour. */
export function backgroundColor(doc: TaleDocument | null | undefined): string | null {
  const background = doc?.canvas?.background as { type?: unknown; color?: unknown } | undefined;
  if (background?.type !== 'color' || typeof background.color !== 'string') return null;
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(background.color) ? background.color : null;
}

/** The API address of a tale's own media (its picture or video), or '' when it has none. */
export function taleMediaSrc(tale: Tale): string {
  return tale.media ? `${API_ORIGIN}${tale.media.url}` : '';
}

/** How long a video's first frame may take to load before its thumbnail gives up, in ms. */
export const FRAME_LOAD_TIMEOUT_MS = 8000;

/**
 * Draws the first frame of the video at `src` to a square JPEG and returns an object URL of it.
 * Throws when the video cannot be read. Reuses the cover capture: the frame is cropped and sized as a cover.
 */
export async function captureFirstFrame(src: string): Promise<string> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The video took too long to load.')), FRAME_LOAD_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const failed = () => {
        clearTimeout(timer);
        reject(new Error('The video could not be read.'));
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', failed, { once: true });
      video.src = src;
    });
    await seekTo(video, 0);
    const blob = await captureFrame(video);
    return URL.createObjectURL(blob);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

/**
 * The source of a video background's first frame: an object URL (see {@link captureFirstFrame}). A
 * test replaces it through {@link FIRST_FRAME}; a null result means the frame could not be made.
 */
export const FIRST_FRAME = new InjectionToken<(src: string) => Promise<string>>('first frame of a video', {
  providedIn: 'root',
  factory: () => captureFirstFrame,
});

/**
 * Makes and caches tale thumbnails for the dashboard lists and cards. A tale's document is read once
 * (its draft, else its published document) and its thumbnail kept; a video's first frame is drawn once
 * per file. Frames are drawn one at a time, so a long list does not decode many videos at once.
 * {@link forget} drops a tale's cached document and thumbnail after it is saved.
 */
@Injectable({ providedIn: 'root' })
export class TaleThumbnails {
  private readonly http = inject(HttpClient);
  private readonly firstFrame = inject(FIRST_FRAME);
  private readonly documents = new Map<string, Promise<TaleDocument | null | undefined>>();
  private readonly thumbnails = new Map<string, Promise<TaleThumbnail>>();
  private readonly frames = new Map<string, Promise<string | null>>();
  private frameQueue: Promise<unknown> = Promise.resolve();

  /**
   * The thumbnail of a group's tales: the first tale with a media background, else the first tale's
   * colour. A group with no tales has no colour (`color: null`).
   */
  async forTales(tales: readonly Tale[]): Promise<TaleThumbnail> {
    let first: TaleThumbnail | null = null;
    for (const tale of tales) {
      const thumbnail = await this.ofTale(tale);
      if (thumbnail.kind === 'image') return thumbnail;
      first ??= thumbnail;
    }
    return first ?? { kind: 'color', color: null };
  }

  /**
   * A tale group with its tales (`GET /tale-groups/{id}`), read now and not kept: a list that shows
   * only counts reads it for its default thumbnail. A failed read answers no tales.
   */
  groupTales(taleGroupId: string): Promise<readonly Tale[]> {
    return firstValueFrom(
      this.http.get<{ tales: Tale[] }>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}`),
    ).then(
      (group) => group.tales,
      () => [],
    );
  }

  /** Drops a tale's cached document and thumbnail, so the next read sees what was saved. */
  forget(taleId: string): void {
    this.documents.delete(taleId);
    this.thumbnails.delete(taleId);
  }

  private ofTale(tale: Tale): Promise<TaleThumbnail> {
    let thumbnail = this.thumbnails.get(tale.id);
    if (!thumbnail) {
      thumbnail = this.make(tale);
      this.thumbnails.set(tale.id, thumbnail);
    }
    return thumbnail;
  }

  private async make(tale: Tale): Promise<TaleThumbnail> {
    const doc = await this.document(tale.id);
    if (doc === undefined) {
      // The read failed: nothing is kept, so the next render asks again.
      this.thumbnails.delete(tale.id);
      return (await this.mediaPicture(tale)) ?? { kind: 'color', color: null };
    }
    const background = firstBackground(doc);
    if (background) {
      const src = background.url ?? projectMediaSrc(tale.projectId, background.key);
      if (background.kind === 'image') return { kind: 'image', src };
      const frame = await this.frame(src);
      if (frame) return { kind: 'image', src: frame };
    }
    return (await this.mediaPicture(tale)) ?? { kind: 'color', color: backgroundColor(doc) };
  }

  /** The tale's own media as its picture (an image, or a video's first frame); null when it has none or no frame. */
  private async mediaPicture(tale: Tale): Promise<TaleThumbnail | null> {
    if (!tale.media) return null;
    const src = taleMediaSrc(tale);
    if (tale.media.kind === 'image') return { kind: 'image', src };
    const frame = await this.frame(src);
    return frame ? { kind: 'image', src: frame } : null;
  }

  /** The tale's draft document (else its published one): null when it has none, undefined when the read failed. */
  private document(taleId: string): Promise<TaleDocument | null | undefined> {
    let document = this.documents.get(taleId);
    if (!document) {
      document = firstValueFrom(
        this.http.get<TaleDocumentRevision>(`${API_BASE}/tales/${encodeURIComponent(taleId)}/document`),
      ).then(
        (revision) => revision.document ?? revision.published.document,
        () => {
          // A failed read is not kept: the next render asks again.
          this.documents.delete(taleId);
          return undefined;
        },
      );
      this.documents.set(taleId, document);
    }
    return document;
  }

  /** The object URL of a video's first frame, drawn once per file; null when it cannot be drawn. */
  private frame(src: string): Promise<string | null> {
    let frame = this.frames.get(src);
    if (!frame) {
      const next = this.frameQueue.then(() => this.firstFrame(src));
      this.frameQueue = next.catch(() => undefined);
      frame = next.catch(() => {
        this.frames.delete(src);
        return null;
      });
      this.frames.set(src, frame);
    }
    return frame;
  }
}

/**
 * A tale thumbnail (or a group's default thumbnail) as an element: an `<img>` of the picture or the
 * video's first frame, else the canvas colour. `mediaClass` names the element's classes, so each
 * place sizes it as it sizes its own cover.
 */
@Component({
  selector: 'app-tale-thumbnail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (picture(); as src) {
      <img [class]="mediaClass()" [src]="src" alt="" loading="lazy" decoding="async" (error)="broken.set(src)" />
    } @else {
      <span [class]="mediaClass()" [style.background-color]="colour()" aria-hidden="true"></span>
    }
  `,
})
export class TaleThumbnailComponent {
  private readonly thumbnails = inject(TaleThumbnails);

  /** The tales whose thumbnail this shows: one tale's, or a group's default. */
  readonly tales = input.required<readonly Tale[]>();
  /** The classes of the element that shows the thumbnail. */
  readonly mediaClass = input('');

  protected readonly shown = signal<TaleThumbnail>({ kind: 'color', color: null });
  /** The picture whose file failed to load: it is shown as no picture, so the placeholder is seen instead. */
  protected readonly broken = signal('');
  /** The picture to show, or '' for none (the colour, or the placeholder when there is none). */
  protected readonly picture = computed(() => {
    const thumbnail = this.shown();
    return thumbnail.kind === 'image' && thumbnail.src !== this.broken() ? thumbnail.src : '';
  });
  protected readonly colour = computed(() => {
    const thumbnail = this.shown();
    return thumbnail.kind === 'color' ? thumbnail.color : null;
  });

  constructor() {
    effect((onCleanup) => {
      const tales = this.tales();
      let current = true;
      onCleanup(() => (current = false));
      void this.thumbnails.forTales(tales).then((thumbnail) => {
        if (current) this.shown.set(thumbnail);
      });
    });
  }
}
