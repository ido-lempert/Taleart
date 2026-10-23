// What lies behind a text or a link label over media, for its contrast check (epic Tale Studio R12,
// story 7.10). The contract judges a label against a colour it can work out (the canvas, its own
// box, an opaque rectangle); over media it needs the pixels. This paints the layers below the label
// (the canvas colour, a background image, media, shapes, buttons, emoji and the boxes of texts) on
// an offscreen canvas, as the Web SDK draws them, and reads the colours behind the label from it,
// in horizontal strips of the label's own (possibly rotated) box. It never reads the preview or the
// page, and a picture the browser will not let it read means "can't be checked". The result is an
// estimate, not a WCAG measurement: a photo has no single background colour.
import { Injectable } from '@angular/core';
import {
  BUTTON_OUTLINE_WIDTH,
  EMOJI_FONT_STACK,
  elementBounds,
  resolveButtonStyle,
  resolveShapeStyle,
  stageTaleMedia,
  type CanvasRect,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
} from '@taleart/contract/tale-document';
import { MEDIA_CONTRAST_STRIPS, resolveTextStyle } from '@taleart/contract/text-style';

/** The size, in pixels, of the canvas the layers are painted on: 9:16, small enough to paint at once. */
export const SAMPLE_CANVAS = { width: 180, height: 320 } as const;
/** At most this many pixels are read behind one label; larger areas are read on a grid. */
export const MAX_SAMPLES = 4096;
/** How long a picture or video may take to load before the check gives up on it (and stops loading it). */
export const FRAME_TIMEOUT_MS = 8000;
/** How many decoded pictures and first video frames are kept, the least recently used dropped first. */
export const FRAME_CACHE_SIZE = 20;

const W = SAMPLE_CANVAS.width;
const H = SAMPLE_CANVAS.height;

/** True for the elements a label contrast check is made for: texts, buttons and the swipe-up link. */
export const hasLabel = (element: { type: string }) =>
  element.type === 'text' || element.type === 'button' || element.type === 'swipe-up';

// True when the rectangles share some area.
const overlaps = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A text below the label draws something to judge against only with a solid box.
const paintsBox = (e: TaleElement) => e.type === 'text' && resolveTextStyle(e.props).background === 'box';

/**
 * The layers painted behind the element at `index`, bottom first: the visible elements below it
 * in the z-order whose area meets its own. A text below counts by its solid box (its glyphs and a
 * per-line highlight are not painted: where its lines fall is known only to the browser that lays
 * it out); the swipe-up link sits in the bottom safe area, under no label.
 */
export function layersBehind(elements: readonly TaleElement[], index: number): TaleElement[] {
  const label = elements[index];
  if (!label) return [];
  const at = elementBounds(label.box);
  return elements
    .slice(0, index)
    .filter(
      (e) =>
        !e.hidden &&
        e.type !== 'swipe-up' &&
        (e.type !== 'text' || paintsBox(e)) &&
        overlaps(at, elementBounds(e.box)),
    );
}

/**
 * A key for what lies behind the element at `index`: the canvas background, the layers behind it
 * and its own box. Samples read for one key stay good until any of these change.
 */
export function backdropKey(doc: TaleDocument, index: number): string {
  const label = doc.elements[index];
  if (!label) return '';
  const below = layersBehind(doc.elements, index).map((e) => [e.id, e.type, e.box, e.props]);
  return JSON.stringify([doc.canvas.background, label.box, below]);
}

/**
 * The pixels read behind a label, in {@link MEDIA_CONTRAST_STRIPS} horizontal strips of its box,
 * top first, turned with its rotation: a grid of at most {@link MAX_SAMPLES} points inside the
 * box, as pixel coordinates on the sample canvas. Points off the canvas are left out; a label
 * wholly off it gives empty strips.
 */
export function labelSamplePoints(box: TaleElementBox): [number, number][][] {
  const w = box.w * W;
  const h = box.h * H;
  const strips: [number, number][][] = Array.from({ length: MEDIA_CONTRAST_STRIPS }, () => []);
  if (!(w > 0 && h > 0)) return strips;
  const step = Math.max(1, Math.sqrt((w * h) / MAX_SAMPLES));
  const columns = Math.max(1, Math.floor(w / step));
  const rows = Math.max(MEDIA_CONTRAST_STRIPS, Math.floor(h / step));
  const angle = (box.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = (box.x + box.w / 2) * W;
  const cy = (box.y + box.h / 2) * H;
  for (let r = 0; r < rows; r++) {
    // The point's place in the box, from its centre, at the middle of its grid cell.
    const v = ((r + 0.5) / rows - 0.5) * h;
    const strip = strips[Math.min(MEDIA_CONTRAST_STRIPS - 1, Math.floor((r * MEDIA_CONTRAST_STRIPS) / rows))];
    for (let c = 0; c < columns; c++) {
      const u = ((c + 0.5) / columns - 0.5) * w;
      const x = Math.floor(cx + u * cos - v * sin);
      const y = Math.floor(cy + u * sin + v * cos);
      if (x >= 0 && x < W && y >= 0 && y < H) strip.push([x, y]);
    }
  }
  return strips;
}

/** The colours at the points of each strip in RGBA pixel data `width` pixels wide, as opaque `#rrggbb`. */
export function stripColors(data: Uint8ClampedArray, width: number, strips: [number, number][][]): string[][] {
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  return strips.map((strip) =>
    strip.map(([x, y]) => {
      const i = (y * width + x) * 4;
      return `#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}`;
    }),
  );
}

/** A `#RRGGBB` or `#RRGGBBAA` colour as a CSS colour every canvas understands. */
export function canvasColor(color: string): string {
  const n = (i: number) => parseInt(color.slice(i, i + 2), 16);
  const alpha = color.length === 9 ? n(7) / 255 : 1;
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${alpha})`;
}

/** Where a picture of `sw` × `sh` is drawn in `rect` with `object-fit` cover or contain. */
export function fitRect(
  sw: number,
  sh: number,
  rect: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
): { x: number; y: number; w: number; h: number } {
  const scale = fit === 'cover' ? Math.max(rect.w / sw, rect.h / sh) : Math.min(rect.w / sw, rect.h / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}

// A number in range, else the default, as the SDK checks props again.
const inRange = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

/**
 * How a media element is drawn, as the Web SDK draws it: its fit (a sticker and an image button
 * always show the whole picture), its corner radius as a fraction of the canvas height (from 0 to
 * 0.5; none on a sticker) and its opacity (from 0 to 1; an image button is always opaque).
 */
export function mediaLook(e: { type: string; props: unknown }): { fit: 'cover' | 'contain'; radius: number; opacity: number } {
  const p = (typeof e.props === 'object' && e.props !== null ? e.props : {}) as Record<string, unknown>;
  const whole = e.type === 'sticker' || e.type === 'image-button';
  return {
    fit: whole || p['fit'] === 'contain' ? 'contain' : 'cover',
    radius: e.type === 'sticker' ? 0 : inRange(p['radius'], 0, 0.5, 0),
    opacity: e.type === 'image-button' ? 1 : inRange(p['opacity'], 0, 1, 1),
  };
}

/** A decoded picture or first video frame, ready to draw; closed when dropped from the cache. */
export type Frame = ImageBitmap;
/** Where a picture or video of the project loads from (the studio's own media URLs). */
export type MediaSource = (mediaKey: string) => string;
type Context = OffscreenCanvasRenderingContext2D;

/**
 * Paints the layers below a label and reads the colours behind it, for `textContrast`'s samples.
 * One instance for the app: pictures and first video frames are decoded once per URL and kept in a
 * small cache, the least recently used dropped (and closed) first.
 */
@Injectable({ providedIn: 'root' })
export class TaleBackdropSampler {
  private readonly cache = new Map<string, Frame>();
  private readonly loading = new Map<string, Promise<Frame | null>>();

  /**
   * The colours behind the element at `index` of `doc`, in strips of its box, as opaque `#rrggbb`,
   * or null when they cannot be read: no offscreen canvas, a picture that does not load (or has no
   * size), or one the browser will not let the page read (another origin without CORS). Never throws.
   */
  async sample(doc: TaleDocument, index: number, source: MediaSource): Promise<string[][] | null> {
    try {
      const label = doc.elements[index];
      if (!label) return null;
      const strips = labelSamplePoints(label.box);
      if (strips.every((strip) => strip.length === 0)) return null;
      const ctx = this.context();
      if (!ctx) return null;
      if (!(await this.paint(ctx, doc, layersBehind(doc.elements, index), source))) return null;
      return stripColors(ctx.getImageData(0, 0, W, H).data, W, strips);
    } catch {
      // A tainted canvas (SecurityError) or anything else: the contrast stays unknown.
      return null;
    }
  }

  /** A 2D context on a new sample canvas, or null where there is no offscreen canvas. */
  protected context(): Context | null {
    if (typeof OffscreenCanvas === 'undefined') return null;
    return new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  }

  /** Loads a picture, or a video's first frame, as a frame; null when it cannot be. */
  protected load(url: string, kind: 'image' | 'video'): Promise<Frame | null> {
    return loadFrame(url, kind);
  }

  // Paints the stage, the canvas and the layers, bottom first; false when a picture fails to load.
  private async paint(ctx: Context, doc: TaleDocument, layers: TaleElement[], source: MediaSource): Promise<boolean> {
    const background = doc.canvas.background;
    // The viewer's black stage, then the canvas colour over it (its bands, under a media background).
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = canvasColor(background.color);
    ctx.fillRect(0, 0, W, H);
    const stageMedia = stageTaleMedia(doc);
    const backgroundFirst = background.type === 'media' && !(stageMedia && layers[0] === stageMedia);
    const paintBackground = async () => {
      if (background.type !== 'media') return true;
      const frame = await this.frame(source(background.mediaKey), 'image');
      if (!frame) return false;
      // Over the tale's own media, the background is drawn with its band colour, bands included.
      if (!backgroundFirst) {
        ctx.fillStyle = canvasColor(background.color);
        ctx.fillRect(0, 0, W, H);
      }
      drawFitted(ctx, frame, { x: 0, y: 0, w: W, h: H }, background.fit === 'cover' ? 'cover' : 'contain');
      return true;
    };
    if (backgroundFirst && !(await paintBackground())) return false;
    for (const [i, layer] of layers.entries()) {
      if (!(await this.paintLayer(ctx, layer, source))) return false;
      if (i === 0 && !backgroundFirst && background.type === 'media' && !(await paintBackground())) return false;
    }
    return true;
  }

  private async paintLayer(ctx: Context, e: TaleElement, source: MediaSource): Promise<boolean> {
    const p = e.props as Record<string, unknown>;
    switch (e.type) {
      case 'image':
      case 'video':
      case 'sticker':
      case 'image-button': {
        const key = typeof p['mediaKey'] === 'string' ? p['mediaKey'] : '';
        const frame = key ? await this.frame(source(key), e.type === 'video' ? 'video' : 'image') : null;
        if (!frame) return false;
        const look = mediaLook(e);
        place(ctx, e.box, (w, h) => {
          ctx.globalAlpha = look.opacity;
          if (look.radius > 0) {
            ctx.beginPath();
            ctx.roundRect(-w / 2, -h / 2, w, h, look.radius * H);
            ctx.clip();
          }
          drawFitted(ctx, frame, { x: -w / 2, y: -h / 2, w, h }, look.fit);
        });
        return true;
      }
      case 'text': {
        const look = resolveTextStyle(e.props);
        place(ctx, e.box, (w, h) => {
          ctx.fillStyle = canvasColor(look.backgroundColor);
          ctx.fillRect(-w / 2, -h / 2, w, h);
        });
        return true;
      }
      case 'shape': {
        const look = resolveShapeStyle(e.props);
        if (!look) return true;
        place(ctx, e.box, (w, h) => {
          ctx.globalAlpha = look.opacity;
          const stroke = look.stroke && look.strokeWidth > 0 ? look.strokeWidth * H : 0;
          if (look.shape === 'line') {
            if (!stroke || !look.stroke) return;
            ctx.fillStyle = canvasColor(look.stroke);
            ctx.fillRect(-w / 2, -stroke / 2, w, stroke);
            return;
          }
          ctx.beginPath();
          if (look.shape === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
          else ctx.roundRect(-w / 2, -h / 2, w, h, look.radius * H);
          if (look.fill) {
            ctx.fillStyle = canvasColor(look.fill);
            ctx.fill();
          }
          if (stroke && look.stroke) {
            // Drawn inside the edges, as a CSS border is.
            ctx.save();
            ctx.clip();
            ctx.lineWidth = stroke * 2;
            ctx.strokeStyle = canvasColor(look.stroke);
            ctx.stroke();
            ctx.restore();
          }
        });
        return true;
      }
      case 'button': {
        const look = resolveButtonStyle(e.props);
        place(ctx, e.box, (w, h) => {
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h / 2, w, h, look.radius * H);
          if (look.variant === 'filled') {
            ctx.fillStyle = canvasColor(look.fill);
            ctx.fill();
          } else {
            ctx.save();
            ctx.clip();
            ctx.lineWidth = BUTTON_OUTLINE_WIDTH * H * 2;
            ctx.strokeStyle = canvasColor(look.fill);
            ctx.stroke();
            ctx.restore();
          }
        });
        return true;
      }
      case 'emoji': {
        const emoji = typeof p['emoji'] === 'string' ? p['emoji'] : '';
        place(ctx, e.box, (w, h) => {
          ctx.font = `${Math.min(h, w) * 0.8}px ${EMOJI_FONT_STACK}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, 0, 0);
        });
        return true;
      }
      default:
        // A type registered by configuration draws a stand-in only in the studio: nothing to judge against.
        return true;
    }
  }

  // A frame from the cache (now the most recently used), or loaded once however many ask at once.
  private async frame(url: string, kind: 'image' | 'video'): Promise<Frame | null> {
    const id = `${kind} ${url}`;
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return cached;
    }
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(url, kind).catch(() => null);
      this.loading.set(id, pending);
    }
    const frame = await pending;
    this.loading.delete(id);
    // A failure is not kept, so a later check tries again.
    if (frame && !this.cache.has(id)) {
      this.cache.set(id, frame);
      while (this.cache.size > FRAME_CACHE_SIZE) {
        const [oldest, evicted] = this.cache.entries().next().value as [string, Frame];
        this.cache.delete(oldest);
        evicted.close();
      }
    }
    return frame;
  }
}

// Draws with the origin at the box's centre, turned by its rotation, inside a saved state.
function place(ctx: Context, box: TaleElementBox, draw: (w: number, h: number) => void): void {
  ctx.save();
  ctx.translate((box.x + box.w / 2) * W, (box.y + box.h / 2) * H);
  if (box.rotation) ctx.rotate((box.rotation * Math.PI) / 180);
  draw(box.w * W, box.h * H);
  ctx.restore();
}

// Draws a frame into a rectangle with `object-fit` cover or contain, clipped to it.
function drawFitted(
  ctx: Context,
  frame: Frame,
  rect: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
): void {
  const at = fitRect(frame.width, frame.height, rect, fit);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(frame, at.x, at.y, at.w, at.h);
  ctx.restore();
}

/**
 * Loads a picture, or a video up to its first frame, and decodes it to an `ImageBitmap`. Media of
 * another origin is asked for with CORS, so its pixels can be read when its server allows it. A
 * video loads only its metadata and the frame at its start, then lets go of its source. Gives up,
 * and stops loading, after {@link FRAME_TIMEOUT_MS}; null when it fails, times out, or the picture
 * has no size (an SVG without width and height: there is nothing to scale it from).
 */
export function loadFrame(url: string, kind: 'image' | 'video'): Promise<Frame | null> {
  if (!url || typeof createImageBitmap !== 'function') return Promise.resolve(null);
  const crossOrigin = new URL(url, location.href).origin !== location.origin;
  return new Promise<Frame | null>((resolve) => {
    let settled = false;
    let release = () => undefined as void;
    const finish = (frame: Frame | null) => {
      if (settled) {
        frame?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      release();
      resolve(frame);
    };
    const decode = (source: HTMLImageElement | HTMLVideoElement, width: number, height: number) => {
      if (!width || !height) return finish(null);
      createImageBitmap(source).then(finish, () => finish(null));
    };
    const timer = setTimeout(() => finish(null), FRAME_TIMEOUT_MS);
    if (kind === 'image') {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      release = () => {
        img.onload = img.onerror = null;
        // Stops a load still in progress.
        img.removeAttribute('src');
      };
      img.onload = () => decode(img, img.naturalWidth, img.naturalHeight);
      img.onerror = () => finish(null);
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    if (crossOrigin) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    release = () => {
      video.onloadedmetadata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };
    // Seeking to the start loads the first frame, as metadata alone may not.
    video.onloadedmetadata = () => {
      video.currentTime = 0.001;
    };
    video.onseeked = () => decode(video, video.videoWidth, video.videoHeight);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** How many labels are read at once. */
export const SAMPLE_CONCURRENCY = 3;
/** After a read that fails, when it is tried again; after the last, not until what lies behind changes. */
export const SAMPLE_RETRY_DELAYS_MS = [1000, 4000, 15000] as const;

/** A label whose backdrop is to be read: its key (`backdropKey`) and its place in the document. */
export interface WantedRead {
  key: string;
  index: number;
}

/** The colours read behind labels, by key: strips of `#rrggbb`, or null when they could not be read. */
export type BackdropResults = ReadonlyMap<string, readonly (readonly string[])[] | null>;

/**
 * The reads of what lies behind the labels of a document (R12, story 7.10): at most
 * {@link SAMPLE_CONCURRENCY} at once, one per key however often it is asked for, each result
 * published as it arrives. A read that fails is published as null (the label "can't be checked")
 * and tried again after {@link SAMPLE_RETRY_DELAYS_MS}; results for keys the document no longer
 * needs are dropped. `destroy` stops it: no timer fires and no result is published after.
 */
export class BackdropReads {
  private resultsNow: BackdropResults = new Map();
  private readonly inflight = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private queue: { key: string; run: () => Promise<readonly (readonly string[])[] | null> }[] = [];
  private running = 0;
  private wanted = new Set<string>();
  private last: { doc: TaleDocument; reads: readonly WantedRead[] } | null = null;
  private destroyed = false;

  constructor(
    private readonly read: (doc: TaleDocument, index: number) => Promise<readonly (readonly string[])[] | null>,
    private readonly publish: (results: BackdropResults) => void,
  ) {}

  /** The results so far. */
  get results(): BackdropResults {
    return this.resultsNow;
  }

  /** Asks for the reads `doc` needs now; what it no longer needs is dropped. */
  update(doc: TaleDocument, reads: readonly WantedRead[]): void {
    if (this.destroyed) return;
    this.last = { doc, reads };
    this.wanted = new Set(reads.map((r) => r.key));
    const kept = new Map([...this.resultsNow].filter(([key]) => this.wanted.has(key)));
    if (kept.size !== this.resultsNow.size) this.set(kept);
    for (const [key, timer] of this.retries) {
      if (this.wanted.has(key)) continue;
      clearTimeout(timer);
      this.retries.delete(key);
    }
    for (const key of this.failures.keys()) if (!this.wanted.has(key)) this.failures.delete(key);
    this.queue = this.queue.filter((task) => this.wanted.has(task.key));
    for (const { key, index } of reads) {
      const failed = this.resultsNow.get(key) === null;
      if ((this.resultsNow.has(key) && !failed) || this.inflight.has(key) || this.retries.has(key)) continue;
      // Failed as many times as it is retried: not again until what lies behind it changes.
      if (failed && (this.failures.get(key) ?? 0) > SAMPLE_RETRY_DELAYS_MS.length) continue;
      if (this.queue.some((task) => task.key === key)) continue;
      this.queue.push({ key, run: () => this.read(doc, index) });
    }
    this.pump();
  }

  /** Stops every read: timers are cleared and nothing is published any more. */
  destroy(): void {
    this.destroyed = true;
    this.queue = [];
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
  }

  private pump(): void {
    while (!this.destroyed && this.running < SAMPLE_CONCURRENCY && this.queue.length > 0) {
      const task = this.queue.shift() as (typeof this.queue)[number];
      this.running++;
      this.inflight.add(task.key);
      task
        .run()
        .catch(() => null)
        .then((result) => this.settle(task.key, result))
        .finally(() => {
          this.running--;
          this.inflight.delete(task.key);
          this.pump();
        });
    }
  }

  private settle(key: string, result: readonly (readonly string[])[] | null): void {
    if (this.destroyed || !this.wanted.has(key)) return;
    this.set(new Map(this.resultsNow).set(key, result));
    if (result !== null) {
      this.failures.delete(key);
      return;
    }
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    const delay = SAMPLE_RETRY_DELAYS_MS[count - 1];
    if (delay === undefined) return;
    this.retries.set(
      key,
      setTimeout(() => {
        this.retries.delete(key);
        if (this.last) this.update(this.last.doc, this.last.reads);
      }, delay),
    );
  }

  private set(results: BackdropResults): void {
    this.resultsNow = results;
    this.publish(results);
  }
}
