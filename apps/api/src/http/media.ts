import { isMediaContentType, type MediaContentType } from '@taleart/contract';
import type { Request, Response } from 'express';

/** The declared `Content-Type` without parameters, lower-cased; null when it is not a tale media type. */
export function declaredMediaType(header: string | undefined): MediaContentType | null {
  const type = (header ?? '').split(';')[0].trim().toLowerCase();
  return isMediaContentType(type) ? type : null;
}

function startsWith(data: Buffer, bytes: number[], offset = 0): boolean {
  return data.length >= offset + bytes.length && bytes.every((b, i) => data[offset + i] === b);
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

// The type rules live in the contract.
export { matchesMagicNumber, mediaExtension } from '@taleart/contract';

// The number of images in a GIF, read from its blocks; null when the file cannot be walked.
function gifFrameCount(d: Buffer): number | null {
  if (d.length < 13) return null;
  let at = 13;
  // A global colour table follows the screen descriptor when its flag is set.
  if (d[10] & 0x80) at += 3 * 2 ** ((d[10] & 0x07) + 1);
  // Skips data sub-blocks (a length byte, then that many bytes) up to the 0 terminator.
  const skipSubBlocks = (from: number): number => {
    let i = from;
    while (i < d.length && d[i] !== 0) i += d[i] + 1;
    return i + 1;
  };
  let frames = 0;
  while (at < d.length) {
    const block = d[at];
    if (block === 0x3b) return frames;
    if (block === 0x21) {
      at = skipSubBlocks(at + 2);
    } else if (block === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      if (at + 10 > d.length) return null;
      const packed = d[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * 2 ** ((packed & 0x07) + 1);
      // The LZW minimum code size, then the image data sub-blocks.
      at = skipSubBlocks(at + 1);
    } else {
      return null;
    }
  }
  return frames;
}

// True when a PNG has an animation control chunk (APNG) before its image data.
function isAnimatedPng(d: Buffer): boolean {
  let at = 8;
  while (at + 8 <= d.length) {
    const type = d.toString('latin1', at + 4, at + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    at += 12 + d.readUInt32BE(at);
  }
  return false;
}

/**
 * True when the file moves (epic web zones R12): every video; a GIF with more
 * than one image, or one that cannot be read (counted as animated, so the
 * animated-cover cap applies); a WebP whose extended header sets the
 * animation flag; a PNG with an `acTL` chunk (APNG). JPEG never.
 */
export function isAnimatedMedia(contentType: MediaContentType, data: Buffer): boolean {
  switch (contentType) {
    case 'video/mp4':
    case 'video/webm':
      return true;
    case 'image/gif': {
      const frames = gifFrameCount(data);
      return frames === null || frames > 1;
    }
    case 'image/webp':
      return startsWith(data, ascii('VP8X'), 12) && data.length > 20 && (data[20] & 0x02) !== 0;
    case 'image/png':
      return isAnimatedPng(data);
    default:
      return false;
  }
}

/**
 * True when an `If-None-Match` header names this strong ETag: `*`, or a
 * comma-separated list of tags, each possibly weak (`W/"…"`), compared weakly
 * as RFC 9110 asks for GET.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => {
    const value = tag.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  });
}

/**
 * Sends media bytes, honouring one byte range: browsers (Safari and iOS in
 * particular) need ranges to play and seek videos. One satisfiable bytes range
 * answers 206; an unsatisfiable one 416 with the size; none, a malformed one or
 * several answer 200 with the whole file. Headers other than ranges are the caller's.
 */
export function sendMediaBytes(req: Request, res: Response, data: Buffer): void {
  res.setHeader('Accept-Ranges', 'bytes');
  const ranges = req.headers.range ? req.range(data.length) : undefined;
  if (ranges === -1) {
    res.setHeader('Content-Range', `bytes */${data.length}`);
    res.status(416).end();
    return;
  }
  if (Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length === 1) {
    const { start, end } = ranges[0];
    res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
    res.status(206).send(data.subarray(start, end + 1));
    return;
  }
  res.send(data);
}
