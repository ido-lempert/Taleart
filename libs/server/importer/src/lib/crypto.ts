import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const VERSION = 'v1';

/**
 * The key that encrypts source tokens, from `IMPORT_TOKEN_KEY` (32 bytes,
 * base64). Null when the value is missing or is not 32 bytes of base64.
 */
export function parseTokenKey(value: string | undefined): Buffer | null {
  const text = value?.trim() ?? '';
  if (!text || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null;
  const key = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length === KEY_BYTES ? key : null;
}

/** Encrypts a source token with AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>`, each part base64. */
export function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

/** Decrypts {@link encryptToken}'s output; throws when the key is wrong or the value was changed. */
export function decryptToken(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error('The stored token has an unknown format');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
