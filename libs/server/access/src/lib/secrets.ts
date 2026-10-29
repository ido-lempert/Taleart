import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** The first byte of a stored secret: the format version. */
const VERSION = 1;

/** Environment variable holding the key that encrypts provider secrets (32 bytes, base64). */
export const SECRET_KEY_ENV = 'TALEART_SECRET_KEY';

// Standard base64 of exactly 32 bytes: 43 characters and one `=`.
const KEY_TEXT = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The key that encrypts provider secrets, from {@link SECRET_KEY_ENV}: standard base64 of 32 bytes.
 * Null when the value is missing or not that. The value itself is never logged or echoed.
 */
export function parseSecretKey(value: string | undefined): Buffer | null {
  const text = value?.trim() ?? '';
  if (!KEY_TEXT.test(text)) return null;
  const key = Buffer.from(text, 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/**
 * Encrypts a secret with AES-256-GCM under a fresh random 12-byte nonce. The stored value is one
 * version byte, the nonce, the 16-byte tag and the ciphertext, so each value has its own nonce.
 */
export function encryptSecret(plain: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new Error('The secret key must be 32 bytes');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypts {@link encryptSecret}'s output. Throws when the key is wrong, the value was changed or
 * its format is unknown; the error never includes the value or the key.
 */
export function decryptSecret(stored: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('The secret key must be 32 bytes');
  if (stored.length < 1 + NONCE_BYTES + TAG_BYTES || stored[0] !== VERSION) {
    throw new Error('The stored secret has an unknown format');
  }
  const nonce = stored.subarray(1, 1 + NONCE_BYTES);
  const tag = stored.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = stored.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('The stored secret could not be decrypted: the key is wrong or the value was changed');
  }
}
