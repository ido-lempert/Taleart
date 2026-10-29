import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, parseSecretKey } from './secrets';

const KEY = randomBytes(32);
const SECRET = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMG\n-----END PRIVATE KEY-----';

describe('secret key', () => {
  it('reads 32 bytes of standard base64 and refuses anything else', () => {
    expect(parseSecretKey(KEY.toString('base64'))?.equals(KEY)).toBe(true);
    expect(parseSecretKey(`  ${KEY.toString('base64')}\n`)?.equals(KEY)).toBe(true);
    expect(parseSecretKey(undefined)).toBeNull();
    expect(parseSecretKey('')).toBeNull();
    expect(parseSecretKey(randomBytes(31).toString('base64'))).toBeNull();
    expect(parseSecretKey(randomBytes(33).toString('base64'))).toBeNull();
    expect(parseSecretKey('not base64 at all!!')).toBeNull();
    expect(parseSecretKey(KEY.toString('base64').replace(/=$/, ''))).toBeNull();
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret(SECRET, KEY);
    expect(decryptSecret(stored, KEY)).toBe(SECRET);
  });

  it('never stores the plain secret', () => {
    const stored = encryptSecret(SECRET, KEY);
    expect(stored.includes(Buffer.from(SECRET))).toBe(false);
    expect(stored.toString('utf8')).not.toContain('PRIVATE KEY');
  });

  it('uses a fresh random nonce for every value', () => {
    const a = encryptSecret(SECRET, KEY);
    const b = encryptSecret(SECRET, KEY);
    expect(a.subarray(1, 13).equals(b.subarray(1, 13))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('fails with the wrong key, without echoing the secret', () => {
    const stored = encryptSecret(SECRET, KEY);
    let message = '';
    try {
      decryptSecret(stored, randomBytes(32));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('the key is wrong');
    expect(message).not.toContain('PRIVATE');
  });

  it('fails when any byte of the ciphertext, the tag or the nonce changed', () => {
    const stored = encryptSecret(SECRET, KEY);
    for (const index of [1, 13, 29, stored.length - 1]) {
      const tampered = Buffer.from(stored);
      tampered[index] ^= 0x01;
      expect(() => decryptSecret(tampered, KEY), `byte ${index}`).toThrow();
    }
  });

  it('fails on a value of an unknown version or a truncated length', () => {
    const stored = encryptSecret(SECRET, KEY);
    const wrongVersion = Buffer.from(stored);
    wrongVersion[0] = 9;
    expect(() => decryptSecret(wrongVersion, KEY)).toThrow('unknown format');
    expect(() => decryptSecret(stored.subarray(0, 20), KEY)).toThrow('unknown format');
  });

  it('refuses a key of the wrong length', () => {
    expect(() => encryptSecret(SECRET, randomBytes(16))).toThrow('32 bytes');
  });
});
