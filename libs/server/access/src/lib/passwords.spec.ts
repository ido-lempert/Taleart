import * as nodeCrypto from 'node:crypto';
import { hashPassword, checkPassword, normalizeUsername, verifyAgainstDummyHash, verifyPassword } from './passwords';
import { COMMON_PASSWORDS } from './common-passwords';
import { PasswordRejectedError, InputInvalidError } from './errors';

// The timing helper is spied on through the module's own namespace, so the test can tell it was used.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const PASSWORD = 'correct horse battery';

describe('password hashing', () => {
  it('writes the self-describing scrypt format with a fresh salt', async () => {
    const stored = await hashPassword(PASSWORD);
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(64);
    expect(await hashPassword(PASSWORD)).not.toBe(stored);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword('correct horse battery!', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('compares the derived key with timingSafeEqual', async () => {
    const stored = await hashPassword(PASSWORD);
    const spy = vi.mocked(nodeCrypto.timingSafeEqual);
    spy.mockClear();
    await verifyPassword(PASSWORD, stored);
    expect(spy).toHaveBeenCalledTimes(1);
    const [derived, expected] = spy.mock.calls[0] as Buffer[];
    expect(derived).toHaveLength(64);
    expect(expected.equals(Buffer.from(stored.split('$')[5], 'base64url'))).toBe(true);
  });

  it('refuses a tampered hash without throwing', async () => {
    const parts = (await hashPassword(PASSWORD)).split('$');
    const hash = parts[5];
    const flipped = (hash[0] === 'A' ? 'B' : 'A') + hash.slice(1);
    expect(await verifyPassword(PASSWORD, [...parts.slice(0, 5), flipped].join('$'))).toBe(false);
  });

  it('refuses a tampered salt, a changed parameter and a malformed value', async () => {
    const parts = (await hashPassword(PASSWORD)).split('$');
    const salt = parts[4];
    const otherSalt = (salt[0] === 'A' ? 'B' : 'A') + salt.slice(1);
    expect(await verifyPassword(PASSWORD, [...parts.slice(0, 4), otherSalt, parts[5]].join('$'))).toBe(false);
    // Another work factor is not a hash this module wrote for N=2^15 with this salt: it refuses.
    expect(await verifyPassword(PASSWORD, ['scrypt', '1024', '8', '1', parts[4], parts[5]].join('$'))).toBe(false);
    // A huge N is refused before any work is done.
    expect(await verifyPassword(PASSWORD, ['scrypt', String(2 ** 30), '8', '1', parts[4], parts[5]].join('$'))).toBe(false);
    for (const bad of ['', 'md5$1$2$3$aaaa$bbbb', 'scrypt$x$8$1$aaaa$bbbb', 'scrypt$32768$8$1']) {
      expect(await verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });

  it('runs a check that never succeeds for an unknown user', async () => {
    expect(await verifyAgainstDummyHash(PASSWORD)).toBe(false);
  });
});

describe('username', () => {
  it('lower-cases and trims a valid username', () => {
    expect(normalizeUsername('  Ada.Admin_1-x ')).toBe('ada.admin_1-x');
  });

  it('refuses a username outside 3 to 40 characters of the allowed set', () => {
    for (const bad of ['ab', 'a'.repeat(41), 'ada admin', 'ada@x', 'ada/x', '', undefined, 42]) {
      expect(() => normalizeUsername(bad), String(bad)).toThrow(InputInvalidError);
    }
    expect(normalizeUsername('a'.repeat(40))).toHaveLength(40);
  });
});

describe('password policy', () => {
  it('accepts a password of 12 to 128 characters that is not refused', () => {
    expect(checkPassword('x'.repeat(12), {})).toBe('x'.repeat(12));
    expect(checkPassword('Pass phrase 2026!'.padEnd(128, '#'), {})).toHaveLength(128);
  });

  it('refuses a password shorter than 12 or longer than 128 characters', () => {
    expect(() => checkPassword('x'.repeat(11), {})).toThrow(PasswordRejectedError);
    expect(() => checkPassword('x'.repeat(129), {})).toThrow(PasswordRejectedError);
    // Characters, not bytes: 12 emoji are 12 characters.
    expect(checkPassword('🔑'.repeat(12), {})).toBeTruthy();
  });

  it('refuses the username and the email local part, without case', () => {
    expect(() => checkPassword('Ada.Admin.Name', { username: 'ada.admin.name' })).toThrow(PasswordRejectedError);
    expect(() => checkPassword('ADA.LOVELACE1', { email: 'ada.lovelace1@example.com' })).toThrow(PasswordRejectedError);
    // Only equal is refused: a password that contains the username is fine.
    expect(checkPassword('ada.admin.name-plus', { username: 'ada.admin.name' })).toBeTruthy();
  });

  it('refuses a password on the common list, whatever its case', () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThanOrEqual(100);
    expect(() => checkPassword('Password123', {})).toThrow(PasswordRejectedError);
    expect(() => checkPassword('QWERTYUIOP123', {})).toThrow(PasswordRejectedError);
  });

  it('refuses a password that is not a string', () => {
    expect(() => checkPassword(undefined, {})).toThrow(InputInvalidError);
  });
});
