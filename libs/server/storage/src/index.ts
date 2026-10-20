// Public interface of the storage module (AD-11). Media goes through the
// MediaStorage port by key; content stores only the key, never a path or URL.
export { type MediaStorage, InvalidStorageKeyError } from './lib/media-storage';
export { LocalDiskStorage } from './lib/local-disk-storage';
