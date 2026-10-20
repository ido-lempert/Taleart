import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('answers null for a missing key and deletes a missing key quietly', async () => {
    expect(await storage.get('tales/missing.png')).toBeNull();
    await expect(storage.delete('tales/missing.png')).resolves.toBeUndefined();
  });

  it.each(['../outside.png', 'tales/../../outside.png', '/etc/passwd', '', 'tales//a.png', 'tales/.', '..', 'a\\..\\b'])(
    'refuses the key %j',
    async (key) => {
      writeFileSync(join(root, 'outside.png'), 'secret');
      await expect(storage.put(key, Buffer.from('x'))).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.get(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      expect(existsSync(join(root, 'outside.png'))).toBe(true);
    },
  );
});
