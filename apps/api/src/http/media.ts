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

// Magic numbers: the leading bytes each accepted type must start with.
const SIGNATURES: Record<MediaContentType, (data: Buffer) => boolean> = {
  'image/png': (d) => startsWith(d, [0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': (d) => startsWith(d, [0xff, 0xd8, 0xff]),
  'image/gif': (d) => startsWith(d, ascii('GIF8')),
  'image/webp': (d) => startsWith(d, ascii('RIFF')) && startsWith(d, ascii('WEBP'), 8),
  'video/mp4': (d) => startsWith(d, ascii('ftyp'), 4),
  'video/webm': (d) => startsWith(d, [0x1a, 0x45, 0xdf, 0xa3]),
};

/** True when the file's leading bytes match the declared type. */
export function matchesMagicNumber(contentType: MediaContentType, data: Buffer): boolean {
  return SIGNATURES[contentType](data);
}

const EXTENSIONS: Record<MediaContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** The file extension a storage key gets for this type. */
export function mediaExtension(contentType: MediaContentType): string {
  return EXTENSIONS[contentType];
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
