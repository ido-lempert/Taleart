import { closeSync, existsSync, openAsBlob, openSync, readSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import {
  matchesMagicNumber,
  maxMediaBytes,
  MEDIA_CONTENT_TYPES,
  MEDIA_MAGIC_BYTES,
  type MediaContentType,
} from '@taleart/contract/core';
import { CliError, EXIT } from './errors';

const BY_EXTENSION: Record<string, MediaContentType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
};

export interface LocalFile {
  path: string;
  name: string;
  size: number;
}

/** A local file that exists and is not empty, or exit 7 (`file_not_found`, `file_empty`). */
export function localFile(cwd: string, path: string): LocalFile {
  const full = resolve(cwd, path);
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw new CliError(`No such file: ${path}`, EXIT.invalid, 'file_not_found');
  }
  const size = statSync(full).size;
  if (size === 0) throw new CliError(`The file is empty: ${path}`, EXIT.invalid, 'file_empty');
  return { path: full, name: basename(full), size };
}

/**
 * A tale media file's type, from its first bytes (the rule the API checks), the extension breaking
 * ties; exit 7 for a file of another type or over the API's limit (10 MB images, 100 MB videos).
 */
export function mediaFile(cwd: string, path: string): LocalFile & { contentType: MediaContentType } {
  const file = localFile(cwd, path);
  const head = Buffer.alloc(MEDIA_MAGIC_BYTES);
  const fd = openSync(file.path, 'r');
  let read: number;
  try {
    read = readSync(fd, head, 0, MEDIA_MAGIC_BYTES, 0);
  } finally {
    closeSync(fd);
  }
  const bytes = head.subarray(0, read);
  const byExtension = BY_EXTENSION[extname(file.path).toLowerCase()];
  const matching = MEDIA_CONTENT_TYPES.filter((type) => matchesMagicNumber(type, bytes));
  const contentType = byExtension && matching.includes(byExtension) ? byExtension : matching[0];
  if (!contentType) {
    throw new CliError(
      `${path} is not a PNG, JPEG, GIF, WebP, MP4 or WebM file`,
      EXIT.invalid,
      'unsupported_media_type',
    );
  }
  if (file.size > maxMediaBytes(contentType)) {
    throw new CliError(
      `${path} is ${file.size} bytes; a ${contentType} tale holds at most ${maxMediaBytes(contentType)}`,
      EXIT.invalid,
      'media_too_large',
    );
  }
  return { ...file, contentType };
}

/** The file as a Blob of the given type, read from disk as it is sent. */
export function fileBlob(path: string, type: string): Promise<Blob> {
  return openAsBlob(path, { type });
}

/** A tale's title from its file name: the name without its extension. */
export function titleFromFile(name: string): string {
  const stem = name.slice(0, name.length - extname(name).length).trim();
  return stem || name;
}
