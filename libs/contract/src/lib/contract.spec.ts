import {
  ERROR_CODES,
  ErrorCodes,
  invitationPath,
  isErrorBody,
  isMediaContentType,
  maxMediaBytes,
  MEDIA_CONTENT_TYPES,
  mediaKind,
  normalizeTagName,
  publicMediaUrl,
  taleMediaUrl,
  USER_ROLES,
  ZONE_KEY_PREFIX,
  zoneKeyPrefix,
} from '../index';

describe('contract', () => {
  it('lists the error codes from the OpenAPI document', () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.values(ErrorCodes).sort());
  });

  it('recognises the standard error body', () => {
    expect(isErrorBody({ error: { code: 'not_found', message: 'x' } })).toBe(true);
    expect(isErrorBody({ error: 'text' })).toBe(false);
    expect(isErrorBody(null)).toBe(false);
  });
});

describe('tale media', () => {
  it('accepts the six media types and classifies them', () => {
    expect([...MEDIA_CONTENT_TYPES]).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
    ]);
    expect(isMediaContentType('image/gif')).toBe(true);
    expect(isMediaContentType('application/pdf')).toBe(false);
    expect(mediaKind('image/gif')).toBe('image');
    expect(mediaKind('video/webm')).toBe('video');
    expect(maxMediaBytes('image/png')).toBe(10 * 1024 * 1024);
    expect(maxMediaBytes('video/mp4')).toBe(100 * 1024 * 1024);
  });

  it('derives the media URL from the tale id', () => {
    expect(taleMediaUrl('t1')).toBe('/api/v1/tales/t1/media');
  });

  it('builds the absolute public media URL from the API URL and the key', () => {
    expect(publicMediaUrl('http://localhost:3333', 'tales/abc.png')).toBe('http://localhost:3333/media/tales/abc.png');
    expect(publicMediaUrl('https://api.example.com/', 'tales/abc.mp4')).toBe(
      'https://api.example.com/media/tales/abc.mp4',
    );
  });
});

describe('auth', () => {
  it('has the admin and content manager roles', () => {
    expect([...USER_ROLES]).toEqual(['admin', 'content_manager']);
  });
});

describe('invitations', () => {
  it('builds the dashboard path of an invitation link', () => {
    expect(invitationPath('abc_-1')).toBe('/invite/abc_-1');
  });
});

describe('tags', () => {
  it('trims tag names and accepts 1 to 40 characters', () => {
    expect(normalizeTagName('  summer ')).toBe('summer');
    expect(normalizeTagName('   ')).toBeNull();
    expect(normalizeTagName(42)).toBeNull();
    expect(normalizeTagName('a'.repeat(40))).toBe('a'.repeat(40));
    expect(normalizeTagName('a'.repeat(41))).toBeNull();
    expect(normalizeTagName('\u{1F31E}'.repeat(40))).toBe('\u{1F31E}'.repeat(40));
  });
});

describe('zone keys', () => {
  it('shows tak_ and the next 6 characters as the prefix', () => {
    expect(ZONE_KEY_PREFIX).toBe('tak_');
    expect(zoneKeyPrefix('tak_abcdefghijklmnop')).toBe('tak_abcdef');
  });
});
