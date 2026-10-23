import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BannerSettings,
  type BarSettings,
  canSetStatus,
  type ContentStatus,
  groupShownStatus,
  isSwitchable,
  NEW_TALE_GROUP_STATUS,
  NEW_TALE_STATUS,
  SHOWN_STATUS_LABELS,
  switchStatus,
  taleShownStatus,
  CONTENT_STATUS_HTTP_CODES,
  CONTENT_STATUSES,
  isContentStatus,
  isSettableStatus,
  nextStatuses,
  isInWindow,
  isValidWindow,
  readContentStatus,
  readTaleStatus,
  statusHttpCode,
  ERROR_CODES,
  ErrorCodes,
  IMPORT_STATUSES,
  isZoneSlug,
  MAX_ZONE_SLUG_LENGTH,
  zoneSlugFromName,
  uniqueZoneSlug,
  invitationPath,
  isImportActive,
  isErrorBody,
  isMediaContentType,
  maxMediaBytes,
  MAX_ANIMATED_COVER_BYTES,
  maxCoverBytes,
  MEDIA_CONTENT_TYPES,
  mediaKind,
  hasControlCharacter,
  normalizeTagName,
  publicMediaUrl,
  taleGroupCoverUrl,
  taleMediaUrl,
  USER_ROLES,
  SITE_KEY_PREFIX,
  siteKeyPrefix,
  type DeliveryFont,
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

describe('bar frame schema', () => {
  // The schema file is the source of the R2 fields; BarSettings mirrors it.
  const schema = JSON.parse(readFileSync(join(__dirname, '../../frame-types/bar.schema.json'), 'utf8')) as {
    properties: Record<string, object>;
    additionalProperties: boolean;
  };

  it('has the R2 fields with their values and defaults, and nothing else', () => {
    const fields: Record<keyof BarSettings, object> = {
      shape: { enum: ['circle', 'rounded-square'], default: 'circle' },
      size: { enum: ['small', 'medium', 'large'], default: 'medium' },
      showTitles: { type: 'boolean', default: true },
      alignment: { enum: ['start', 'center'], default: 'start' },
      gap: { type: 'integer', minimum: 4, maximum: 24, default: 12 },
    };
    expect(Object.keys(schema.properties)).toEqual(Object.keys(fields));
    for (const [key, expected] of Object.entries(fields)) expect(schema.properties[key]).toMatchObject(expected);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('banner frame schema', () => {
  // The schema file is the source of the R3 fields; BannerSettings mirrors it.
  const schema = JSON.parse(readFileSync(join(__dirname, '../../frame-types/banner.schema.json'), 'utf8')) as {
    properties: Record<string, object>;
    additionalProperties: boolean;
  };

  it('has the R3 fields with their values and defaults, and nothing else', () => {
    const fields: Record<keyof BannerSettings, object> = {
      aspectRatio: { enum: ['16:9', '3:1', '1:1'], default: '16:9' },
      autoplay: { type: 'boolean', default: true },
      intervalSeconds: { type: 'integer', minimum: 3, maximum: 15, default: 5 },
      showDots: { type: 'boolean', default: true },
      loop: { type: 'boolean', default: true },
    };
    expect(Object.keys(schema.properties)).toEqual(Object.keys(fields));
    for (const [key, expected] of Object.entries(fields)) expect(schema.properties[key]).toMatchObject(expected);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('delivery fonts (story 9.8)', () => {
  it("names each project font's family, which native SDKs resolve against the host app's fonts", () => {
    const spec = readFileSync(join(__dirname, '../../openapi/openapi.yaml'), 'utf8');
    const block = spec.slice(spec.indexOf('    DeliveryFont:'), spec.indexOf('    DeliveryTaleDocument:'));
    expect(block).toContain('required: [id, family, url, weight, style]');
    expect(block).toMatch(/\n        family:\n          type: string\n/);
    const font: DeliveryFont = {
      id: '0f0e0d0c-0000-4000-8000-00000000000a',
      family: 'Brand Sans',
      url: 'https://api.test/media/fonts/x.woff2',
      weight: 400,
      style: 'normal',
    };
    expect(font.family).toBe('Brand Sans');
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

  it('caps animated covers at 300 KB and still covers at the image limit', () => {
    expect(MAX_ANIMATED_COVER_BYTES).toBe(307_200);
    expect(maxCoverBytes('video/webm', true)).toBe(307_200);
    expect(maxCoverBytes('image/gif', true)).toBe(307_200);
    expect(maxCoverBytes('image/jpeg', false)).toBe(10 * 1024 * 1024);
  });

  it('derives the cover URL from the tale group id', () => {
    expect(taleGroupCoverUrl('g1')).toBe('/api/v1/tale-groups/g1/cover');
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

  it('refuses a tag name holding a control character, NUL included', () => {
    for (const name of ['a\u0000b', 'a\u0007b', 'a\nb', 'a\u001fb', 'a\u007fb']) {
      expect(normalizeTagName(name)).toBeNull();
    }
    expect(hasControlCharacter('plain text')).toBe(false);
    expect(normalizeTagName(' summer\n')).toBe('summer');
  });
});

describe('site keys (epic UX rework R3)', () => {
  it('shows tas_ and the next 6 characters as the prefix, and names its error codes', () => {
    expect(SITE_KEY_PREFIX).toBe('tas_');
    expect(siteKeyPrefix('tas_abcdefghijklmnop')).toBe('tas_abcdef');
    expect(ErrorCodes.invalidSiteKey).toBe('invalid_site_key');
    expect(ErrorCodes.siteKeyNotFound).toBe('site_key_not_found');
  });

  it('has no zone key codes left (story 8.7: zone keys are removed)', () => {
    expect(Object.values(ErrorCodes)).not.toContain('invalid_zone_key');
    expect(Object.values(ErrorCodes)).not.toContain('zone_key_not_found');
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

    it('reads a live tale of a draft or paused group as blocked-by-group, else its own key', () => {
      expect(readTaleStatus('live', 'paused')).toBe('blocked-by-group');
      expect(readTaleStatus('live', 'draft')).toBe('blocked-by-group');
      expect(readTaleStatus('live', 'live')).toBe('live');
      expect(readTaleStatus('paused', 'paused')).toBe('paused');
      expect(readTaleStatus('draft', 'paused')).toBe('draft');
      expect(readTaleStatus('paused', 'draft')).toBe('paused');
      expect(readTaleStatus('live', 'archived')).toBe('live');
    });

    describe('shown status (AD-6 amended 2026-10-23)', () => {
      it('shows a group live as On, draft or paused as Off, and archived as Archived', () => {
        expect(CONTENT_STATUSES.map((s) => [s, groupShownStatus(s)])).toEqual([
          ['draft', 'off'],
          ['live', 'on'],
          ['scheduled', 'off'],
          ['processing', 'off'],
          ['invalid-media', 'off'],
          ['paused', 'off'],
          ['blocked-by-group', 'off'],
          ['expired', 'off'],
          ['quota-reached', 'off'],
          ['archived', 'archived'],
        ]);
      });

      it('shows a tale live as Shown, draft or paused as Hidden, and archived as Archived', () => {
        expect(taleShownStatus('live')).toBe('shown');
        expect(taleShownStatus('draft')).toBe('hidden');
        expect(taleShownStatus('paused')).toBe('hidden');
        expect(taleShownStatus('processing')).toBe('hidden');
        expect(taleShownStatus('archived')).toBe('archived');
      });

      it('names each shown status once', () => {
        expect(SHOWN_STATUS_LABELS).toEqual({ on: 'On', off: 'Off', shown: 'Shown', hidden: 'Hidden', archived: 'Archived' });
      });

      it('turns on or shows by storing live, and off or hides by storing paused', () => {
        expect(switchStatus('draft', true)).toBe('live');
        expect(switchStatus('paused', true)).toBe('live');
        expect(switchStatus('live', false)).toBe('paused');
      });

      it('changes nothing when content is already there, archived, or in a key a process set', () => {
        expect(switchStatus('live', true)).toBeNull();
        expect(switchStatus('draft', false)).toBeNull();
        expect(switchStatus('paused', false)).toBeNull();
        expect(switchStatus('archived', true)).toBeNull();
        expect(switchStatus('archived', false)).toBeNull();
        expect(switchStatus('processing', true)).toBeNull();
        expect(['draft', 'live', 'paused'].every((s) => isSwitchable(s as ContentStatus))).toBe(true);
        expect(['archived', 'processing', 'invalid-media', 'quota-reached'].some((s) => isSwitchable(s as ContentStatus))).toBe(false);
      });

      it('every status the switch sets is one a person may set from where it starts', () => {
        for (const from of CONTENT_STATUSES) {
          for (const on of [true, false]) {
            const to = switchStatus(from, on);
            if (to !== null) expect(canSetStatus(from, to)).toBe(true);
          }
        }
      });

      it('starts new tales live (Shown) and new groups draft (Off)', () => {
        expect(NEW_TALE_STATUS).toBe('live');
        expect(taleShownStatus(NEW_TALE_STATUS)).toBe('shown');
        expect(groupShownStatus(NEW_TALE_GROUP_STATUS)).toBe('off');
      });
    });

    describe('schedules', () => {
      const start = '2026-10-21T10:00:00.000Z';
      const end = '2026-10-21T12:00:00.000Z';
      const at = (iso: string) => new Date(iso);

      it('contains now from the start up to, not including, the end', () => {
        const window = { startsAt: start, endsAt: end };
        expect(isInWindow(window, at('2026-10-21T09:59:59.999Z'))).toBe(false);
        expect(isInWindow(window, at(start))).toBe(true);
        expect(isInWindow(window, at('2026-10-21T11:59:59.999Z'))).toBe(true);
        expect(isInWindow(window, at(end))).toBe(false);
        expect(isInWindow({ startsAt: null, endsAt: null }, at(end))).toBe(true);
        expect(isInWindow({ startsAt: new Date(start), endsAt: null }, at(end))).toBe(true);
      });

      it('reads live content as scheduled before its start and expired from its end', () => {
        const window = { startsAt: start, endsAt: end };
        expect(readContentStatus('live', window, at('2026-10-21T09:00:00Z'))).toBe('scheduled');
        expect(readContentStatus('live', window, at(start))).toBe('live');
        expect(readContentStatus('live', window, at(end))).toBe('expired');
      });

      it('keeps a stored key other than live, so paused wins over scheduled', () => {
        const future = { startsAt: end, endsAt: null };
        const now = at(start);
        expect(readContentStatus('paused', future, now)).toBe('paused');
        expect(readContentStatus('draft', future, now)).toBe('draft');
        expect(readContentStatus('archived', { startsAt: null, endsAt: start }, at(end))).toBe('archived');
      });

      it('reads a tale as blocked-by-group before its own window', () => {
        const past = { startsAt: null, endsAt: start };
        expect(readTaleStatus('live', 'paused', past, at(end))).toBe('blocked-by-group');
        expect(readTaleStatus('live', 'live', past, at(end))).toBe('expired');
      });

      it('accepts open bounds and refuses an end not later than the start', () => {
        expect(isValidWindow({ startsAt: start, endsAt: end })).toBe(true);
        expect(isValidWindow({ startsAt: null, endsAt: end })).toBe(true);
        expect(isValidWindow({ startsAt: end, endsAt: start })).toBe(false);
        expect(isValidWindow({ startsAt: start, endsAt: start })).toBe(false);
      });
    });
  });
});

describe('zone slugs (epic UX rework R1)', () => {
  it('accepts lowercase words joined by single hyphens, up to 64 characters', () => {
    for (const key of ['home', 'home-top', 'bar-2', '2024', 'a'.repeat(MAX_ZONE_SLUG_LENGTH)]) {
      expect(isZoneSlug(key)).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const key of ['', 'Home', 'home top', '-home', 'home-', 'home--top', 'home_top', 'héro', 'a'.repeat(65), 7, null]) {
      expect(isZoneSlug(key)).toBe(false);
    }
  });

  it('suggests a key from a name', () => {
    expect(zoneSlugFromName(' Home page: Top bar! ')).toBe('home-page-top-bar');
    expect(zoneSlugFromName('Héro Bänner 2')).toBe('hero-banner-2');
    expect(zoneSlugFromName('***')).toBe('');
    const long = zoneSlugFromName(`${'a'.repeat(63)} b`);
    expect(long).toBe('a'.repeat(63));
    expect(isZoneSlug(long)).toBe(true);
  });

  it('makes a slug unique with a numeric suffix, within 64 characters', () => {
    const taken = new Set(['home', 'home-2', 'zone']);
    expect(uniqueZoneSlug('shop', (s) => taken.has(s))).toBe('shop');
    expect(uniqueZoneSlug('home', (s) => taken.has(s))).toBe('home-3');
    expect(uniqueZoneSlug('', (s) => taken.has(s))).toBe('zone-2');
    const long = 'a'.repeat(MAX_ZONE_SLUG_LENGTH);
    const next = uniqueZoneSlug(long, (s) => s === long);
    expect(next).toBe(`${'a'.repeat(62)}-2`);
    expect(isZoneSlug(next)).toBe(true);
    // A base made longer than a slug (a long name plus "-banner-1") is cut to one.
    expect(uniqueZoneSlug(`${'a'.repeat(60)}-banner-1`, () => false)).toBe(`${'a'.repeat(60)}-ban`);
    expect(zoneSlugFromName('דף הבית')).toBe('');
  });
});
