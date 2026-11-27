import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  TOTP_PERIOD_SECONDS,
  totpCode,
  totpStep,
} from './totp';

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890"; the RFC lists 8 digits, these are the last 6.
const RFC_SECRET = Buffer.from('12345678901234567890');
const VECTORS: Array<[seconds: number, code: string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('totp', () => {
  it.each(VECTORS)('gives the RFC 6238 code at %i seconds', (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it('encodes base32 as RFC 4648 does, without padding', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('fooba'))).toBe('MZXW6YTB');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodes what it encodes, ignoring case and spaces', () => {
    const secret = newTotpSecret();
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Decode('gezd gnbv GY3T QOJQ GEZD GNBV GY3T QOJQ').equals(RFC_SECRET)).toBe(true);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('makes a 20-byte random secret each time', () => {
    const a = newTotpSecret();
    expect(a).toHaveLength(20);
    expect(a.equals(newTotpSecret())).toBe(false);
  });

  it('accepts the current code and one step either side, and nothing further', () => {
    const now = 1111111111 * 1000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBeNull();
  });

  it('refuses a step that was already accepted, and any earlier one', () => {
    const now = 1111111111 * 1000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it('ignores spaces and refuses anything that is not six digits', () => {
    const now = 59 * 1000;
    expect(matchTotp(RFC_SECRET, '287 082', now)).toBe(1);
    expect(matchTotp(RFC_SECRET, '28708', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '2870820', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '28708a', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, '', now)).toBeNull();
  });

  it('writes the address an authenticator app reads from a QR code', () => {
    const uri = new URL(otpauthUri({ secret: RFC_SECRET, account: 'cy@example.com', issuer: 'TaleArt' }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/TaleArt:cy@example.com');
    expect(uri.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri.searchParams.get('issuer')).toBe('TaleArt');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe(String(TOTP_PERIOD_SECONDS));
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
  });
});
