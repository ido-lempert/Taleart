import {
  canSetStatus,
  CONTENT_STATUS_HTTP_CODES,
  CONTENT_STATUSES,
  isContentStatus,
  isSettableStatus,
  nextStatuses,
  readTaleStatus,
  statusHttpCode,
  ERROR_CODES,
  ErrorCodes,
  IMPORT_STATUSES,
  invitationPath,
  isImportActive,
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

describe('imports', () => {
  it('lists the job states and tells the active ones', () => {
    expect([...IMPORT_STATUSES]).toEqual(['queued', 'running', 'done', 'failed']);
    expect(IMPORT_STATUSES.filter(isImportActive)).toEqual(['queued', 'running']);
  });

  describe('status keys (AD-6)', () => {
    it('maps every key of the OpenAPI enum to its one HTTP code, draft to 204', () => {
      expect(Object.keys(CONTENT_STATUS_HTTP_CODES).sort()).toEqual([...CONTENT_STATUSES].sort());
      expect(CONTENT_STATUSES.map((s) => [s, statusHttpCode(s)])).toEqual([
        ['draft', 204],
        ['live', 200],
        ['scheduled', 202],
        ['processing', 102],
        ['invalid-media', 422],
        ['paused', 403],
        ['blocked-by-group', 423],
        ['expired', 410],
        ['quota-reached', 429],
        ['archived', 404],
      ]);
    });

    it('recognises status keys and the settable ones', () => {
      expect(isContentStatus('blocked-by-group')).toBe(true);
      expect(isContentStatus('published')).toBe(false);
      expect(['live', 'paused', 'archived'].every(isSettableStatus)).toBe(true);
      expect(['draft', 'expired', 'scheduled', 'blocked-by-group', 1, null].some(isSettableStatus)).toBe(false);
    });

    it('allows publish, pause, archive and restore, and the current status again', () => {
      expect(nextStatuses('draft')).toEqual(['live', 'archived']);
      expect(nextStatuses('live')).toEqual(['paused', 'archived']);
      expect(nextStatuses('paused')).toEqual(['live', 'archived']);
      expect(nextStatuses('archived')).toEqual(['paused']);
      expect(canSetStatus('live', 'live')).toBe(true);
      expect(canSetStatus('draft', 'paused')).toBe(false);
      expect(canSetStatus('archived', 'live')).toBe(false);
      expect(canSetStatus('processing', 'live')).toBe(false);
    });

    it('reads a live tale of a paused group as blocked-by-group, else its own key', () => {
      expect(readTaleStatus('live', 'paused')).toBe('blocked-by-group');
      expect(readTaleStatus('live', 'live')).toBe('live');
      expect(readTaleStatus('paused', 'paused')).toBe('paused');
      expect(readTaleStatus('draft', 'paused')).toBe('draft');
      expect(readTaleStatus('live', 'draft')).toBe('live');
    });
  });
});
