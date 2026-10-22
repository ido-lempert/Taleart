// What lies behind a text or a link label over media, for its contrast check (epic Tale Studio R12,
// story 7.10). The contract judges a label against a colour it can work out (the canvas, its own
// box, an opaque rectangle); over media it needs the pixels. This paints the layers below the label
// (the canvas colour, a background image, media, shapes, buttons and emoji) on an offscreen canvas,
// as the Web SDK draws them, and reads the colours behind the label from it. It never reads the
// preview or the page, and a picture the browser will not let it read means "can't be checked".
import { Injectable } from '@angular/core';
import {
  BUTTON_OUTLINE_WIDTH,
  EMOJI_FONT_STACK,
  elementBounds,
  isTaleMediaElement,
  resolveButtonStyle,
  resolveShapeStyle,
  stageTaleMedia,
  type CanvasRect,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
} from '@taleart/contract/tale-document';

/** The size, in pixels, of the canvas the layers are painted on: 9:16, small enough to paint at once. */
export const SAMPLE_CANVAS = { width: 180, height: 320 } as const;
/** At most this many pixels are read behind one label; larger areas are read on a grid. */
export const MAX_SAMPLES = 4096;
/** How long a picture or video may take to load before the check gives up on it. */
export const FRAME_TIMEOUT_MS = 8000;

/** True for the elements a label contrast check is made for: texts, buttons and the swipe-up link. */
export const hasLabel = (element: { type: string }) =>
  element.type === 'text' || element.type === 'button' || element.type === 'swipe-up';

// True when the rectangles share some area.
const overlaps = (a: CanvasRect, b: CanvasRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The layers painted behind the element at `index`, bottom first: the visible elements below it
 * in the z-order whose area meets its own, except texts (a label is never judged against another
 * text, as the contract's `textBackdropAt` does not) and kinds that draw nothing to judge against.
 */
export function layersBehind(elements: readonly TaleElement[], index: number): TaleElement[] {
  const label = elements[index];
  if (!label) return [];
  const at = elementBounds(label.box);
  return elements
    .slice(0, index)
    .filter((e) => !e.hidden && e.type !== 'text' && e.type !== 'swipe-up' && overlaps(at, elementBounds(e.box)));
}

/**
 * A key for what lies behind the element at `index`: the canvas background, the layers behind it
 * and its own area. Samples read for one key stay good until any of these change.
 */
export function backdropKey(doc: TaleDocument, index: number): string {
  const label = doc.elements[index];
  if (!label) return '';
  const below = layersBehind(doc.elements, index).map((e) => [e.id, e.type, e.box, e.props]);
  return JSON.stringify([doc.canvas.background, elementBounds(label.box), below]);
}

/** The pixel area of a canvas rectangle, clipped to the canvas; null when nothing of it is on it. */
export function pixelArea(rect: CanvasRect): { x: number; y: number; w: number; h: number } | null {
  const { width, height } = SAMPLE_CANVAS;
  const x0 = Math.max(0, Math.floor(rect.x * width));
  const y0 = Math.max(0, Math.floor(rect.y * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.w) * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.h) * height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The colours of RGBA pixel data (as `getImageData` gives it) as opaque `#rrggbb`, read on a grid
 * of at most {@link MAX_SAMPLES} pixels. The canvas is painted opaque, so alpha is ignored.
 */
export function pixelColors(data: Uint8ClampedArray, width: number, height: number): string[] {
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const colors: string[] = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      colors.push(`#${hex(data[i])}${hex(data[i + 1])}${hex(data[i + 2])}`);
    }
  }
  return colors;
}

/** A `#RRGGBB` or `#RRGGBBAA` colour as a CSS colour every canvas understands. */
export function canvasColor(color: string): string {
  const n = (i: number) => parseInt(color.slice(i, i + 2), 16);
  const alpha = color.length === 9 ? n(7) / 255 : 1;
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${alpha})`;
}

/** Where a picture or video of the project loads from (the studio's own media URLs). */
export type MediaSource = (mediaKey: string) => string;
type Frame = HTMLImageElement | HTMLVideoElement;
type Context = OffscreenCanvasRenderingContext2D;

const W = SAMPLE_CANVAS.width;
const H = SAMPLE_CANVAS.height;

// The source's natural size.
const sizeOf = (frame: Frame) =>
  frame instanceof HTMLVideoElement
    ? { w: frame.videoWidth, h: frame.videoHeight }
    : { w: frame.naturalWidth, h: frame.naturalHeight };

/**
 * Paints the layers below a label and reads the colours behind it, for `textContrast`'s samples.
 * One instance for the app: pictures and first video frames are loaded once per URL.
 */
@Injectable({ providedIn: 'root' })
export class TaleBackdropSampler {
  private readonly frames = new Map<string, Promise<Frame | null>>();

  /**
   * The colours behind the element at `index` of `doc` as opaque `#rrggbb`, or null when they
   * cannot be read: no offscreen canvas, a picture that does not load, or one the browser will not
   * let the page read (another origin without CORS). Never throws.
   */
  async sample(doc: TaleDocument, index: number, source: MediaSource): Promise<string[] | null> {
    try {
      const label = doc.elements[index];
      if (!label || typeof OffscreenCanvas === 'undefined') return null;
      const area = pixelArea(elementBounds(label.box));
      if (!area) return null;
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      const painted = await this.paint(ctx, doc, layersBehind(doc.elements, index), source);
      if (!painted) return null;
      const pixels = ctx.getImageData(area.x, area.y, area.w, area.h);
      return pixelColors(pixels.data, area.w, area.h);
    } catch {
      // A tainted canvas (SecurityError) or anything else: the contrast stays unknown.
      return null;
    }
  }

  // Paints the stage, the canvas and the layers, bottom first; false when a picture fails to load.
  private async paint(ctx: Context, doc: TaleDocument, layers: TaleElement[], source: MediaSource): Promise<boolean> {
    const background = doc.canvas.background;
    // The viewer's black stage, then the canvas colour over it (its bands, under a media background).
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = canvasColor(background.color);
    ctx.fillRect(0, 0, W, H);
    const stage = stageTaleMedia(doc);
    const backgroundFirst = background.type === 'media' && !(stage && layers[0] === stage);
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
        const fit = e.type === 'sticker' || e.type === 'image-button' || p['fit'] === 'contain' ? 'contain' : 'cover';
        const own = isTaleMediaElement(e);
        place(ctx, e.box, (w, h) => {
          ctx.globalAlpha = numberOr(p['opacity'], 1);
          const radius = e.type === 'sticker' || own ? 0 : numberOr(p['radius'], 0) * H;
          if (radius > 0) {
            ctx.beginPath();
            ctx.roundRect(-w / 2, -h / 2, w, h, radius);
            ctx.clip();
          }
          drawFitted(ctx, frame, { x: -w / 2, y: -h / 2, w, h }, fit);
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
          const side = Math.min(h, w);
          ctx.font = `${side * 0.8}px ${EMOJI_FONT_STACK}`;
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

  // A picture, or a video's first frame, loaded once per URL; null when it does not load in time.
  private frame(url: string, kind: 'image' | 'video'): Promise<Frame | null> {
    const id = `${kind} ${url}`;
    let pending = this.frames.get(id);
    if (!pending) {
      pending = loadFrame(url, kind);
      this.frames.set(id, pending);
      // A failure is not kept, so the next check tries again.
      void pending.then((frame) => frame ?? this.frames.delete(id));
    }
    return pending;
  }
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

// Draws with the origin at the box's centre, turned by its rotation, inside a saved state.
function place(ctx: Context, box: TaleElementBox, draw: (w: number, h: number) => void): void {
  ctx.save();
  ctx.translate((box.x + box.w / 2) * W, (box.y + box.h / 2) * H);
  if (box.rotation) ctx.rotate((box.rotation * Math.PI) / 180);
  draw(box.w * W, box.h * H);
  ctx.restore();
}

// Draws a picture into a rectangle with `object-fit` cover or contain.
function drawFitted(
  ctx: Context,
  frame: Frame,
  rect: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
): void {
  const { w: sw, h: sh } = sizeOf(frame);
  if (!sw || !sh) return;
  const scale = fit === 'cover' ? Math.max(rect.w / sw, rect.h / sh) : Math.min(rect.w / sw, rect.h / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(frame, rect.x + (rect.w - w) / 2, rect.y + (rect.h - h) / 2, w, h);
  ctx.restore();
}

// Loads a picture, or a video up to its first frame. Media of another origin is asked for with
// CORS, so its pixels can be read when its server allows it.
function loadFrame(url: string, kind: 'image' | 'video'): Promise<Frame | null> {
  if (!url) return Promise.resolve(null);
  const crossOrigin = new URL(url, location.href).origin !== location.origin;
  return new Promise<Frame | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), FRAME_TIMEOUT_MS);
    const done = (frame: Frame | null) => {
      clearTimeout(timer);
      resolve(frame);
    };
    if (kind === 'image') {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
      return;
    }
    const video = document.createElement('video');
    if (crossOrigin) video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => done(video);
    video.onerror = () => done(null);
    video.src = url;
  });
}
