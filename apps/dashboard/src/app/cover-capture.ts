import { Injectable } from '@angular/core';

/**
 * Makes tale group covers in the browser (epic web zones R12): the server
 * stores what it is sent and never transcodes (AD-11). A still cover is one
 * video frame drawn to a canvas; an animated cover is a short clip of a video
 * tale, drawn frame by frame to a canvas and recorded with MediaRecorder.
 * Both are cropped to the centred square, since the bar shows covers in a
 * circle or rounded square.
 */

/** The edge of a still cover made from a video frame, in px: sharp at the largest bar size on dense screens. */
export const STILL_COVER_PX = 320;

/** The edge of an animated cover, in px: twice the largest bar size (80 px). */
export const CLIP_COVER_PX = 160;

/** Frames per second of an animated cover. */
export const CLIP_FPS = 15;

/** The recording bit rate of an animated cover: 3 s stay well under the 300 KB cap. */
export const CLIP_BITS_PER_SECOND = 400_000;

/** The lengths, in seconds, an animated cover can have. */
export const CLIP_LENGTHS = [1, 2, 3] as const;

/** JPEG quality of a still cover. */
const STILL_QUALITY = 0.85;

/** The recording types tried, best first: WebM where the browser records it, else MP4 (Safari). */
const RECORDER_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

/** The centred square of a `width` x `height` frame: where it starts and its side. */
export function centredSquare(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height);
  return { sx: (width - side) / 2, sy: (height - side) / 2, side };
}

// Draws the video's current frame, cropped to its centred square, over the whole canvas.
function drawSquare(context: CanvasRenderingContext2D, video: HTMLVideoElement, size: number): void {
  const { sx, sy, side } = centredSquare(video.videoWidth, video.videoHeight);
  context.drawImage(video, sx, sy, side, side, 0, 0, size, size);
}

function squareCanvas(size: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw video frames.');
  return { canvas, context };
}

/** Moves the video to `time` (seconds) and waits until that frame can be drawn. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      resolve();
    };
    const failed = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', failed);
      reject(new Error('The video could not be read.'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', failed);
    video.currentTime = time;
  });
}

/** The video's current frame as a square JPEG: a still cover. */
export async function captureFrame(video: HTMLVideoElement, size = STILL_COVER_PX): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video has not loaded yet.');
  const { canvas, context } = squareCanvas(size);
  drawSquare(context, video, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', STILL_QUALITY));
  if (!blob) throw new Error('The frame could not be saved.');
  return blob;
}

/** The type this browser records clips in, or null when it cannot record them. */
export function recorderType(): string | null {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof HTMLCanvasElement === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  ) {
    return null;
  }
  return RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** The media type a recorded clip is uploaded as: its recording type without codecs. */
export function clipUploadType(recordedType: string): 'video/webm' | 'video/mp4' {
  return recordedType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
}

/**
 * Records `seconds` of the video from `start` as a square clip: an animated
 * cover. The video plays muted while it records, and stops at its end if that
 * comes first. Throws when the browser cannot record.
 */
export async function recordClip(
  video: HTMLVideoElement,
  start: number,
  seconds: number,
  size = CLIP_COVER_PX,
): Promise<Blob> {
  const type = recorderType();
  if (!type) throw new Error('This browser cannot record an animated cover. Try a recent Chrome, Edge, Firefox or Safari.');
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video has not loaded yet.');
  const { canvas, context } = squareCanvas(size);
  await seekTo(video, start);
  drawSquare(context, video, size);

  const stream = canvas.captureStream(CLIP_FPS);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: CLIP_BITS_PER_SECOND });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  video.muted = true;
  recorder.start();
  try {
    await video.play();
    // Draws each frame until the clip's end, the video's end, or a stall (a wall-clock guard).
    const deadline = performance.now() + seconds * 1000 + 5000;
    await new Promise<void>((resolve) => {
      const tick = () => {
        drawSquare(context, video, size);
        if (video.currentTime >= start + seconds || video.ended || performance.now() > deadline) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    video.pause();
    recorder.stop();
    for (const track of stream.getTracks()) track.stop();
  }
  await stopped;
  return new Blob(chunks, { type: clipUploadType(type) });
}

/** A size in bytes as people read it, such as "212 KB" or "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The capture functions as a service, so the cover drawer can be tested
 * without a browser that draws and records video.
 */
@Injectable({ providedIn: 'root' })
export class CoverCapture {
  /** True when this browser can record an animated cover. */
  canRecord(): boolean {
    return recorderType() !== null;
  }

  captureFrame(video: HTMLVideoElement): Promise<Blob> {
    return captureFrame(video);
  }

  recordClip(video: HTMLVideoElement, start: number, seconds: number): Promise<Blob> {
    return recordClip(video, start, seconds);
  }
}
