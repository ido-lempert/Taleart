import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@taleart/contract';
import { COMMON_PASSWORDS } from './common-passwords';
import { InputInvalidError, PasswordRejectedError } from './errors';

// scrypt parameters for new hashes (spec: N=2^15, r=8, p=1, 64-byte output, 16-byte salt).
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// scrypt needs 128 * N * r bytes; Node's default memory cap is 32 MiB, just under what N=2^15 needs.
const MAX_MEMORY = 64 * 1024 * 1024;

const FORMAT = 'scrypt';
const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

// The bounds a stored hash's parameters must keep in, so a malformed row cannot ask for huge work.
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 20;

function deriveKey(password: string, salt: Buffer, length: number, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEMORY };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Hashes a password: `scrypt$N$r$p$salt$hash`, the salt and the hash base64url, the hash 64 bytes.
 * Each hash has its own random salt.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(password, salt, KEY_BYTES, { N, r: R, p: P });
  return [FORMAT, N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

// The parameters and bytes of a stored hash, or null when it is not one this module wrote.
function parseHash(stored: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return null;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (n < MIN_N || n > MAX_N || (n & (n - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(parts[4]) || !/^[A-Za-z0-9_-]+$/.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length < 16 || salt.length > 64 || hash.length < 16 || hash.length > 128) return null;
  return { N: n, r, p, salt, hash };
}

/**
 * True when `password` hashes to `stored` (from {@link hashPassword}). A malformed or tampered
 * value is false, never an error. The comparison is {@link timingSafeEqual}.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await deriveKey(password, parsed.salt, parsed.hash.length, parsed);
  // A stored hash of another length can never match, but the comparison still runs in full.
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

let dummy: Promise<string> | null = null;

/**
 * Runs a password check that can never succeed, as long as an unknown username or a turned-off
 * method takes as long as a real check: the time of a sign-in does not reveal which it was.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummy ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(password, await dummy);
  return false;
}

/**
 * A username as stored: trimmed, lower case, 3 to 40 characters of `a-z 0-9 . _ -`. Throws
 * {@link InputInvalidError} otherwise. Sign-in is case-insensitive, so the same name in any case.
 */
export function normalizeUsername(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (name.length < USERNAME_MIN_LENGTH || name.length > USERNAME_MAX_LENGTH || !USERNAME_PATTERN.test(name)) {
    throw new InputInvalidError(
      `A username is ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters: letters, digits, '.', '_' and '-'`,
    );
  }
  return name;
}

/** The part of an email before the `@`, lower case. */
export function emailLocalPart(email: string): string {
  return email.slice(0, email.lastIndexOf('@')).toLowerCase();
}

/**
 * Checks a new password against the policy (spec): 12 to 128 characters of any kind, not the
 * username, not the email's local part (both compared without case), not a common password.
 * Throws {@link PasswordRejectedError} with the rule that failed.
 */
export function checkPassword(password: unknown, context: { username?: string; email?: string }): string {
  if (typeof password !== 'string') throw new InputInvalidError('password is required');
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new PasswordRejectedError(`A password is ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`);
  }
  const lower = password.toLowerCase();
  if (context.username !== undefined && lower === context.username.toLowerCase()) {
    throw new PasswordRejectedError('A password cannot be the username');
  }
  if (context.email !== undefined && lower === emailLocalPart(context.email)) {
    throw new PasswordRejectedError("A password cannot be the name part of the email address");
  }
  if (COMMON_PASSWORDS.has(lower)) {
    throw new PasswordRejectedError('That password is too common. Choose another.');
  }
  return password;
}
