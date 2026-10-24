import {
  decodeExternalUserIdHeader,
  encodeExternalUserIdHeader,
  EXTERNAL_USER_ID_HEADER,
  MAX_EXTERNAL_USER_ID_HEADER_LENGTH,
} from './external-user-id';
import { MAX_EXTERNAL_USER_ID_LENGTH } from './user-lists';

// The reference encoder: Node's own base64url of the UTF-8 bytes.
const reference = (id: string) => Buffer.from(id, 'utf8').toString('base64url');

describe('the external user ID header (epic targeting R4, story 5.4)', () => {
  it('is its own header, apart from the visitor id', () => {
    expect(EXTERNAL_USER_ID_HEADER).toBe('X-TaleArt-External-User-Id');
    expect(EXTERNAL_USER_ID_HEADER.toLowerCase()).not.toBe('x-taleart-visitor');
  });

  it.each([
    'u',
    'ab',
    'abc',
    'user-42',
    'User-42',
    'm\u00FCller-7',
    'zo\u00EB',
    'zoe\u0308',
    'user-\uD83D\uDE00',
    '\u7528\u6237-1',
    'a/b+c=d?e',
    // A byte order mark inside the ID (one at its start is trimmed, as in an upload).
    'b\uFEFFom',
    'x'.repeat(MAX_EXTERNAL_USER_ID_LENGTH),
    '\uD83D\uDE00'.repeat(MAX_EXTERNAL_USER_ID_LENGTH),
  ])('encodes %j as base64url of its UTF-8 bytes, without padding, and decodes it back', (id) => {
    const header = encodeExternalUserIdHeader(id);
    expect(header).toBe(reference(id));
    expect(header).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(String(header).length).toBeLessThanOrEqual(MAX_EXTERNAL_USER_ID_HEADER_LENGTH);
    expect(decodeExternalUserIdHeader(header)).toBe(id);
  });

  it('trims as an upload does, and keeps case and Unicode form exactly', () => {
    expect(encodeExternalUserIdHeader('  User-42 ')).toBe(reference('User-42'));
    expect(decodeExternalUserIdHeader(reference(' User-42\t'))).toBe('User-42');
    expect(decodeExternalUserIdHeader(reference('zo\u00EB'))).not.toBe(decodeExternalUserIdHeader(reference('zoe\u0308')));
    expect(decodeExternalUserIdHeader(reference('USER-42'))).not.toBe('user-42');
  });

  it('encodes nothing for an ID no list can hold', () => {
    for (const id of [null, undefined, 42, '', '   ', 'a\u0000b', 'a\nb', 'x'.repeat(MAX_EXTERNAL_USER_ID_LENGTH + 1)]) {
      expect(encodeExternalUserIdHeader(id)).toBeNull();
    }
  });

  it('reads anything but canonical base64url of a valid ID as no ID', () => {
    const cases: unknown[] = [
      undefined,
      null,
      ['dXNlcg'],
      '',
      // Padding, the standard alphabet, spaces, and two headers joined by a comma.
      'dXNlcg==',
      'dXNl+g',
      'dXNl/g',
      'dXNl cg',
      'dXNlcg, dXNlcg',
      // A length no byte count gives, and nonzero bits after the last byte.
      'dXNlc',
      'dXNlch',
      // Invalid UTF-8: a lone continuation byte, an overlong form, a surrogate.
      Buffer.from([0x80]).toString('base64url'),
      Buffer.from([0xc0, 0xaf]).toString('base64url'),
      Buffer.from([0xed, 0xa0, 0x80]).toString('base64url'),
      // Decodes to a blank ID, a control character, or one over 256 code points.
      reference('   '),
      reference('a\u0007b'),
      reference('x'.repeat(MAX_EXTERNAL_USER_ID_LENGTH + 1)),
      // Longer than any accepted ID encodes to.
      'A'.repeat(MAX_EXTERNAL_USER_ID_HEADER_LENGTH + 1),
    ];
    for (const value of cases) expect(decodeExternalUserIdHeader(value)).toBeNull();
  });

  it('sizes the longest header for 256 four-byte code points', () => {
    expect(MAX_EXTERNAL_USER_ID_HEADER_LENGTH).toBe(1366);
    expect(reference('\uD83D\uDE00'.repeat(MAX_EXTERNAL_USER_ID_LENGTH)).length).toBe(MAX_EXTERNAL_USER_ID_HEADER_LENGTH);
  });
});
