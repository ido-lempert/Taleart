// The viewer's external user ID on its way to the Delivery API (epic targeting R4, R5): the request
// header that carries it and its one encoding, base64url (RFC 4648 section 5, no padding) of the ID's
// UTF-8 bytes. A header value is ASCII whatever the ID holds, so an ID outside ASCII arrives as it was
// uploaded; the server decodes the header strictly, then reads the ID with `normalizeExternalUserId`.
// The ID travels only in this header, never in a URL. Plain code with no `import` of generated
// values, so the Web SDK bundles only these lines.
import { MAX_EXTERNAL_USER_ID_LENGTH, normalizeExternalUserId } from './user-lists';

/**
 * The request header of the viewer's external user ID. Separate from the device's visitor id
 * (`X-TaleArt-Visitor`): the two are never linked, stored together or used together.
 */
export const EXTERNAL_USER_ID_HEADER = 'X-TaleArt-External-User-Id';

/**
 * The longest header value an accepted ID encodes to: 256 code points of at most 4 UTF-8 bytes
 * each, in base64url without padding (1,366 characters).
 */
export const MAX_EXTERNAL_USER_ID_HEADER_LENGTH = Math.ceil((MAX_EXTERNAL_USER_ID_LENGTH * 4 * 4) / 3);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The header value for an external user ID: the ID trimmed (`normalizeExternalUserId`), its UTF-8
 * bytes in base64url without padding. Null when the ID is not one a user list can hold (not text,
 * blank, over 256 code points, a control character); then no header is sent.
 */
export function encodeExternalUserIdHeader(id: unknown): string | null {
  const normalized = normalizeExternalUserId(id);
  if (normalized === null) return null;
  const bytes = new TextEncoder().encode(normalized);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

/**
 * The external user ID a header value carries, or null when it carries none: not text, empty,
 * longer than {@link MAX_EXTERNAL_USER_ID_HEADER_LENGTH}, not base64url (padding, `+`, `/`, spaces
 * or the comma of a repeated header included), not canonical (a length no byte count gives, or
 * nonzero bits after the last byte), not UTF-8, or an ID a user list could not hold. The ID is then
 * trimmed, exactly as `normalizeExternalUserId` reads an uploaded one; no Unicode normalization.
 */
export function decodeExternalUserIdHeader(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_USER_ID_HEADER_LENGTH) return null;
  if (value.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((value.length * 3) / 4));
  let bits = 0;
  let n = 0;
  let at = 0;
  for (let i = 0; i < value.length; i++) {
    const digit = ALPHABET.indexOf(value[i]);
    if (digit < 0) return null;
    n = ((n << 6) | digit) & 0xfff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (n >> bits) & 0xff;
    }
  }
  // Bits left over after the last byte must be zero, so one ID has exactly one header value.
  if ((n & ((1 << bits) - 1)) !== 0) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return normalizeExternalUserId(text);
}
