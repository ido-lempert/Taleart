import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage } from './local-disk-storage';
import { InvalidStorageKeyError } from './media-storage';

describe('LocalDiskStorage', () => {
  let root: string;
  let storage: LocalDiskStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'taleart-storage-'));
    storage = new LocalDiskStorage(join(root, 'media'));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('puts, gets and deletes bytes by key, creating folders as needed', async () => {
    await storage.put('tales/a.png', Buffer.from([1, 2, 3]));
    expect(existsSync(join(root, 'media', 'tales', 'a.png'))).toBe(true);
    expect(await storage.get('tales/a.png')).toEqual(Buffer.from([1, 2, 3]));

    await storage.delete('tales/a.png');
    expect(await storage.get('tales/a.png')).toBeNull();
  });

  it('replaces what a key held and leaves no temporary files', async () => {
    await storage.put('tales/a.png', Buffer.from('one'));
    await storage.put('tales/a.png', Buffer.from('two'));
    expect((await storage.get('tales/a.png'))?.toString()).toBe('two');
    expect(readdirSync(join(root, 'media', 'tales'))).toEqual(['a.png']);
  });

  it('streams chunks into a key, replacing what it held, with no temporary file left', async () => {
    await storage.put('tales/s.png', Buffer.from('old'));
    async function* chunks() {
      yield Buffer.from('one ');
      yield new Uint8Array(Buffer.from('two'));
    }
    await storage.putStream('tales/s.png', chunks());
    expect((await storage.get('tales/s.png'))?.toString()).toBe('one two');
    expect(readdirSync(join(root, 'media', 'tales'))).toEqual(['s.png']);
  });

  it('stores nothing and passes the error on when the chunks fail', async () => {
    const failure = new Error('source broke off');
    async function* chunks() {
      yield Buffer.alloc(64 * 1024, 1);
      throw failure;
    }
    await expect(storage.putStream('tales/f.png', chunks())).rejects.toBe(failure);
    expect(await storage.get('tales/f.png')).toBeNull();
    expect(readdirSync(join(root, 'media', 'tales'))).toEqual([]);
  });

  it('keeps what a key held when a stream into it fails', async () => {
    await storage.put('tales/k.png', Buffer.from('kept'));
    const chunks: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('no bytes')) }),
    };
    await expect(storage.putStream('tales/k.png', chunks)).rejects.toThrow('no bytes');
    expect((await storage.get('tales/k.png'))?.toString()).toBe('kept');
  });

  it('writes the rest of a chunk a short write left, and syncs before the rename', async () => {
    const calls: string[] = [];
    // A file handle that takes at most 3 bytes per write.
    const shortWrites = new LocalDiskStorage(join(root, 'media'), async (path, flags) => {
      const real = await open(path, flags);
      return {
        write: (async (data: Uint8Array, offset: number, length: number) => {
          calls.push(`write ${length}`);
          return real.write(data, offset, Math.min(3, length));
        }) as never,
        sync: async () => {
          calls.push('sync');
          await real.sync();
        },
        close: () => real.close(),
      };
    });
    await shortWrites.putStream(
      'tales/short.png',
      (async function* () {
        yield Buffer.from('abcdefgh');
      })(),
    );
    expect((await storage.get('tales/short.png'))?.toString()).toBe('abcdefgh');
    expect(calls).toEqual(['write 8', 'write 5', 'write 2', 'sync']);
  });

  it('lists stored keys without temporary files, and removes only stale temporary files', async () => {
    await storage.put('tales/a.png', Buffer.from('a'));
    const dir = join(root, 'media', 'tales');
    writeFileSync(join(dir, 'a.png.1111.tmp'), 'old');
    writeFileSync(join(dir, 'a.png.2222.tmp'), 'young');
    const hourAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
    utimesSync(join(dir, 'a.png.1111.tmp'), hourAgo, hourAgo);
    expect((await storage.listKeys('tales')).map((k) => k.key)).toEqual(['tales/a.png']);
    expect(await storage.listKeys('none')).toEqual([]);
    expect(await storage.removeStaleTemporaryFiles('tales', 60 * 60_000)).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['a.png', 'a.png.2222.tmp']);
  });

  it('answers null for a missing key and deletes a missing key quietly', async () => {
    expect(await storage.get('tales/missing.png')).toBeNull();
    await expect(storage.delete('tales/missing.png')).resolves.toBeUndefined();
  });

  it.each(['../outside.png', 'tales/../../outside.png', '/etc/passwd', '', 'tales//a.png', 'tales/.', '..', 'a\\..\\b'])(
    'refuses the key %j',
    async (key) => {
      writeFileSync(join(root, 'outside.png'), 'secret');
      await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.putStream(key, [Buffer.from('x')] as never)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      expect(existsSync(join(root, 'outside.png'))).toBe(true);
    },
  );
});
