import {
  contactLikeWarning,
  externalUserIdRefusal,
  looksLikeEmail,
  looksLikePhone,
  MAX_EXTERNAL_USER_ID_LENGTH,
  normalizeExternalUserId,
  normalizeUserListName,
  parseUserListCsvLine,
  reportContactCounts,
  sampleUserListCsv,
} from './user-lists';

describe('normalizeUserListName', () => {
  it('trims and keeps 1 to 100 characters without controls', () => {
    expect(normalizeUserListName('  Loyal  ')).toBe('Loyal');
    expect(normalizeUserListName('x'.repeat(100))).toBe('x'.repeat(100));
    expect(normalizeUserListName('😀'.repeat(100))).toBe('😀'.repeat(100));
    expect(normalizeUserListName('x'.repeat(101))).toBeNull();
    expect(normalizeUserListName('   ')).toBeNull();
    expect(normalizeUserListName('a\tb')).toBeNull();
    expect(normalizeUserListName(42)).toBeNull();
  });
});

describe('external user IDs', () => {
  it('accepts up to 256 code points and refuses longer ones and controls', () => {
    expect(externalUserIdRefusal('a'.repeat(MAX_EXTERNAL_USER_ID_LENGTH))).toBeNull();
    expect(externalUserIdRefusal('~'.repeat(MAX_EXTERNAL_USER_ID_LENGTH))).toBeNull();
    expect(externalUserIdRefusal('a'.repeat(MAX_EXTERNAL_USER_ID_LENGTH + 1))).toBe('too-long');
    expect(externalUserIdRefusal('a\u0000b')).toBe('control-character');
    expect(externalUserIdRefusal('a\u0085b')).toBe('control-character');
  });

  it('refuses IDs outside ASCII until the Delivery header defines its encoding (story 5.4)', () => {
    expect(externalUserIdRefusal('müller-7')).toBe('not-ascii');
    expect(externalUserIdRefusal('user-😀')).toBe('not-ascii');
    expect(externalUserIdRefusal('é'.repeat(MAX_EXTERNAL_USER_ID_LENGTH + 1))).toBe('too-long');
    expect(normalizeExternalUserId('ü')).toBeNull();
    expect(parseUserListCsvLine('"zoë"')).toEqual({ kind: 'refused', reason: 'not-ascii' });
  });

  it('normalizes by trimming only, case kept', () => {
    expect(normalizeExternalUserId('  User-42 ')).toBe('User-42');
    expect(normalizeExternalUserId('')).toBeNull();
    expect(normalizeExternalUserId(null)).toBeNull();
  });
});

describe('parseUserListCsvLine', () => {
  it.each([
    ['u-1', { kind: 'id', id: 'u-1' }],
    ['  u-1  ', { kind: 'id', id: 'u-1' }],
    ['', { kind: 'empty' }],
    ['   ', { kind: 'empty' }],
    ['""', { kind: 'empty' }],
    ['"u,1"', { kind: 'id', id: 'u,1' }],
    ['"say ""hi"""', { kind: 'id', id: 'say "hi"' }],
    [' " u-2 " ', { kind: 'id', id: 'u-2' }],
    ['a,b', { kind: 'refused', reason: 'not-one-column' }],
    ['u-1,', { kind: 'refused', reason: 'not-one-column' }],
    ['"a",b', { kind: 'refused', reason: 'not-one-column' }],
    ['"open', { kind: 'refused', reason: 'not-one-column' }],
    ['a"b', { kind: 'refused', reason: 'not-one-column' }],
    ['a\tb', { kind: 'refused', reason: 'control-character' }],
    ['x'.repeat(300), { kind: 'refused', reason: 'too-long' }],
  ])('%j', (line, row) => {
    expect(parseUserListCsvLine(line)).toEqual(row);
  });
});

describe('email and phone heuristics', () => {
  it.each(['ana@example.com', 'a.b+c@mail.co.uk'])('%s looks like an email', (id) => {
    expect(looksLikeEmail(id)).toBe(true);
  });
  it.each(['user@local', 'u-42', '@handle'])('%s does not look like an email', (id) => {
    expect(looksLikeEmail(id)).toBe(false);
  });
  it.each(['+15551234567', '(555) 123-4567', '+44 20 7946 0958', '555.123.4567'])('%s looks like a phone', (id) => {
    expect(looksLikePhone(id)).toBe(true);
  });
  it.each(['123456789', '12-34', 'u-5551234567', '+1234'])('%s does not look like a phone', (id) => {
    expect(looksLikePhone(id)).toBe(false);
  });

  it('warns only when more than half look like contacts', () => {
    expect(contactLikeWarning({ accepted: 10, emailLike: 6, phoneLike: 0 })).toBe('email');
    expect(contactLikeWarning({ accepted: 10, emailLike: 2, phoneLike: 4 })).toBe('phone');
    expect(contactLikeWarning({ accepted: 10, emailLike: 5, phoneLike: 0 })).toBeNull();
    expect(contactLikeWarning({ accepted: 0, emailLike: 0, phoneLike: 0 })).toBeNull();
  });

  it('reads the counts of a report', () => {
    const report = { added: 3, alreadyPresent: 1, refused: 0, refusedRows: [], emptyRows: 0, emailLike: 3, phoneLike: 0, idCount: 3 };
    expect(contactLikeWarning(reportContactCounts(report))).toBe('email');
  });
});

describe('sampleUserListCsv', () => {
  it('counts as the server reads, header and a cut last line left out', () => {
    const text = '\uFEFFemail\r\nana@example.com\nbo@example.com\r\nu-3\nca@exa';
    expect(sampleUserListCsv(text, { header: true, truncated: true })).toEqual({ accepted: 3, emailLike: 2, phoneLike: 0 });
    expect(sampleUserListCsv(text)).toEqual({ accepted: 5, emailLike: 2, phoneLike: 0 });
  });
});
