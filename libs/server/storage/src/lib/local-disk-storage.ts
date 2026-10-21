import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { InvalidStorageKeyError, type MediaStorage } from './media-storage';

/** What a write in progress is named: `<key>.<uuid>.tmp`, renamed to the key once complete. */
const TEMP_SUFFIX = '.tmp';

/** Opens a file; tests pass a stand-in to exercise short writes. */
export type OpenFile = (path: string, flags: string) => Promise<Pick<FileHandle, 'write' | 'sync' | 'close'>>;

// Plain relative segments only: no empty, '.', '..' or backslash segments.
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** The default storage adapter (AD-11): one file per key under a root folder. */
export class LocalDiskStorage implements MediaStorage {
  /** The absolute folder every key is stored under. */
  readonly root: string;

  constructor(
    root: string,
    private readonly openFile: OpenFile = open,
  ) {
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

  async putStream(key: string, chunks: AsyncIterable<Uint8Array>): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}${TEMP_SUFFIX}`;
    // The temp file is open before any chunk is read, so a failure can always remove it.
    const file = await this.openFile(temp, 'wx');
    try {
      try {
        for await (const chunk of chunks) {
          // A write may take only part of a chunk: write the rest until it is all on disk.
          for (let written = 0; written < chunk.length; ) {
            const { bytesWritten } = await file.write(chunk, written, chunk.length - written);
            if (bytesWritten <= 0) throw new Error('The storage write made no progress');
            written += bytesWritten;
          }
        }
        // On disk before the name points at it, so a crash never leaves a short file under the key.
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  /**
   * The keys stored under a folder key (such as `tales`), with when each was
   * last written. Temporary files of writes in progress are left out.
   */
  async listKeys(folder: string): Promise<{ key: string; modifiedAt: Date }[]> {
    const dir = this.pathOf(folder);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const keys: { key: string; modifiedAt: Date }[] = [];
    for (const name of names) {
      if (name.endsWith(TEMP_SUFFIX) || !SEGMENT.test(name)) continue;
      const info = await stat(join(dir, name)).catch(() => null);
      if (info?.isFile()) keys.push({ key: `${folder}/${name}`, modifiedAt: info.mtime });
    }
    return keys;
  }

  /**
   * Removes temporary files that writes left behind (a crash between write and
   * rename) and that are older than `olderThanMs`, under a folder key. Returns
   * how many it removed. A younger temporary file may belong to a write in progress.
   */
  async removeStaleTemporaryFiles(folder: string, olderThanMs: number, now = Date.now()): Promise<number> {
    const dir = this.pathOf(folder);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw err;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(TEMP_SUFFIX)) continue;
      const path = join(dir, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isFile() || now - info.mtimeMs < olderThanMs) continue;
      await rm(path, { force: true });
      removed++;
    }
    return removed;
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
