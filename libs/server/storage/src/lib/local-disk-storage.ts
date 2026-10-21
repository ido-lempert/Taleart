import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { InvalidStorageKeyError, type MediaStorage } from './media-storage';

// Plain relative segments only: no empty, '.', '..' or backslash segments.
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** The default storage adapter (AD-11): one file per key under a root folder. */
export class LocalDiskStorage implements MediaStorage {
  /** The absolute folder every key is stored under. */
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Write next to the target, then rename, so a reader never sees half a file.
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, data);
      await rename(temp, path);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  async putStream(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    // The temp file is open before any chunk is read, so a failure can always remove it.
    const file = await open(temp, 'wx');
    try {
      try {
        for await (const chunk of chunks) await file.write(chunk);
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  // Maps a key to a file under the root, refusing any key that would escape it.
  private pathOf(key: string): string {
    if (typeof key !== 'string' || isAbsolute(key) || !key.split('/').every((s) => SEGMENT.test(s))) {
      throw new InvalidStorageKeyError(key);
    }
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new InvalidStorageKeyError(key);
    return path;
  }
}
