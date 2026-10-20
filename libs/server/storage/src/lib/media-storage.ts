/**
 * The media storage port (AD-11): put, get and delete bytes by key. A key is a
 * relative, slash-separated name such as `tales/<uuid>.png`. Adapters decide
 * where the bytes live; callers never see a path or URL.
 */
export interface MediaStorage {
  /** Stores `data` under `key`, replacing anything already there. */
  put(key: string, data: Buffer): Promise<void>;
  /** The bytes stored under `key`, or null when there are none. */
  get(key: string): Promise<Buffer | null>;
  /** Removes what is stored under `key`. Removing a missing key is not an error. */
  delete(key: string): Promise<void>;
}

/** Thrown for a key an adapter refuses, such as one that would leave its storage root. */
export class InvalidStorageKeyError extends Error {
  constructor(readonly key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = 'InvalidStorageKeyError';
  }
}
