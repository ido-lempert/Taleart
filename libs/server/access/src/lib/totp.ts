import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** One-time codes as RFC 6238 defines them for authenticator apps: HMAC-SHA1, 6 digits, a new code every 30 seconds. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
/** Steps either side of now that are accepted, for a phone clock that is a little off. */
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new random secret: 20 bytes, the length authenticator apps expect for SHA-1. */
export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4648 base32 without padding: the form an authenticator app takes as a typed key. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The bytes of an RFC 4648 base32 key, as an authenticator app reads it; spaces and case are ignored. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not a base32 key');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 30-second step a moment in time falls in. */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation of the HMAC, taken to {@link TOTP_DIGITS} digits). */
export function totpCode(secret: Uint8Array, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * The step whose code equals `code`, or null. Steps up to `afterStep` never match, so a code that was accepted once
 * is refused again (the caller stores the step it got back). Every step in the window is compared, in constant time,
 * so the answer does not show how close a wrong code was.
 */
export function matchTotp(secret: Uint8Array, code: string, nowMs: number, afterStep: number | null = null): number | null {
  const given = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(given)) return null;
  const givenBytes = Buffer.from(given);
  const now = totpStep(nowMs);
  let matched: number | null = null;
  for (let step = now - TOTP_WINDOW_STEPS; step <= now + TOTP_WINDOW_STEPS; step++) {
    const same = timingSafeEqual(Buffer.from(totpCode(secret, step)), givenBytes);
    if (same && matched === null && (afterStep === null || step > afterStep)) matched = step;
  }
  return matched;
}

/** The otpauth:// address an authenticator app reads from a QR code. */
export function otpauthUri(input: { secret: Uint8Array; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const query = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
