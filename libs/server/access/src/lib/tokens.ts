import { createHash, randomBytes } from 'node:crypto';

/** A new secret token: 32 random bytes, base64url. It goes to the browser once. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The SHA-256 hash of a token, hex. Only this is stored (NFR-003). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
