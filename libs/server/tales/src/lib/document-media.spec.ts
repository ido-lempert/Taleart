import {
  checkProjectMediaRoom,
  clearPublicMediaCache,
  createProjectMedia,
  DEFAULT_PROJECT_MEDIA_LIMITS,
  MediaLimitError,
  MediaStorageFullError,
  MEDIA_UPLOAD_SWEEP_MIN_AGE_MS,
  sweepUnusedProjectMediaFiles,
  deliveredMediaKeys,
  findPublishedDocumentMedia,
  listProjectMedia,
  lockMediaKeys,
  projectMediaFile,
  projectMediaKeys,
  PUBLIC_MEDIA_CACHE_SIZE,
  PUBLIC_MEDIA_CACHE_TTL_MS,
  recordTaleMedia,
} from './document-media';
import {
  AltTextRequiredError,
  checkPublishableDocument,
  checkTaleDocument,
  clearDeliveryCache,
  draftProblem,
  TaleDocumentTooLargeError,
  deliverableTaleDocument,
  InvalidTaleDocumentError,
  publishTaleDocument,
  saveTaleDocument,
} from './tale-document';
import { copyTaleWithDocument, type TransactionalDb } from './tales';

const taleId = '00000000-0000-4000-8000-000000000010';
const projectId = '00000000-0000-4000-8000-0000000000aa';
const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const GIF = 'media/0b7c9d4e-1111-4222-8333-944455556669.gif';
const VIDEO = 'tales/0b7c9d4e-1111-4222-8333-944455556667.mp4';
const BG = 'tales/imported-0b7c9d4e-1111-4222-8333-944455556668.jpg';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function media(
  n: number,
  type: 'image' | 'video',
  key: string,
  extra: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id(n),
    type,
    box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, rotation: 15 },
    hidden: false,
    locked: false,
    a11y: { label: 'A cat' },
    props: { mediaKey: key, fit: 'cover', ...props },
    ...extra,
  };
}

function doc(elements: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements, ...extra };
}

const mediaBackground = (key = BG, extra: Record<string, unknown> = {}) => ({
  canvas: { background: { type: 'media', mediaKey: key, fit: 'contain', color: '#112233', ...extra } },
});

function refusal(value: unknown, check: (v: unknown) => unknown = checkTaleDocument): string {
  try {
    check(value);
  } catch (err) {
    if (err instanceof InvalidTaleDocumentError) return err.pointer;
    throw err;
  }
  throw new Error('the document was accepted');
}

// A fake pool whose one connection answers queries in order; transaction statements take no answer.
function fakeDb(answers: { rows: unknown[] }[]) {
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    return answers.shift() ?? { rows: [] };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as TransactionalDb;
  const calls = () =>
    (query.mock.calls as unknown as [string, unknown[]][]).filter(([sql]) => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql));
  const statements = () => (query.mock.calls as unknown as [string][]).map(([sql]) => sql);
  return { db, query, calls, statements };
}

describe('checkTaleDocument: images and video (story 7.5)', () => {
  it('accepts an image, a GIF and a video with fit, radius, opacity and rotation, a duration and a media background', () => {
    const value = doc(
      [
        media(1, 'image', IMAGE, {}, { radius: 0.05, opacity: 0.5 }),
        media(2, 'image', GIF, { a11y: { decorative: true } }, { fit: 'contain' }),
        media(3, 'video', VIDEO, {}, { radius: 0.5, opacity: 0 }),
      ],
      { durationMs: 5000, ...mediaBackground() },
    );
    expect(checkTaleDocument(value)).toEqual(value);
    expect(checkPublishableDocument(value)).toEqual(value);
  });

  it('refuses a second video, naming it', () => {
    expect(refusal(doc([media(1, 'video', VIDEO), media(2, 'image', IMAGE), media(3, 'video', VIDEO)]))).toBe(
      '/elements/2/type',
    );
    // A hidden second video counts too.
    expect(refusal(doc([media(1, 'video', VIDEO), media(2, 'video', VIDEO, { hidden: true })]))).toBe(
      '/elements/1/type',
    );
  });

  it.each([
    ['a fit that is not cover or contain', { fit: 'fill' }, '/elements/0/props/fit'],
    ['a radius over half the canvas height', { radius: 0.6 }, '/elements/0/props/radius'],
    ['a negative radius', { radius: -0.1 }, '/elements/0/props/radius'],
    ['an opacity over 1', { opacity: 1.5 }, '/elements/0/props/opacity'],
    ['an opacity of Infinity', { opacity: Infinity }, '/elements/0/props/opacity'],
    ['a URL for a key', { mediaKey: 'https://e.example/a.png' }, '/elements/0/props/mediaKey'],
    ['a font key', { mediaKey: 'fonts/0b7c9d4e-1111-4222-8333-944455556666.woff2' }, '/elements/0/props/mediaKey'],
    ['a key climbing out', { mediaKey: 'media/../x.png' }, '/elements/0/props/mediaKey'],
    ['a cover key', { mediaKey: 'covers/0b7c9d4e-1111-4222-8333-944455556666.png' }, '/elements/0/props/mediaKey'],
    ['an unknown prop', { src: 'x' }, '/elements/0/props/src'],
  ])('refuses %s', (_name, props, pointer) => {
    expect(refusal(doc([media(1, 'image', IMAGE, {}, props)]))).toBe(pointer);
  });

  it('refuses an image without a key or fit', () => {
    const element = media(1, 'image', IMAGE);
    expect(refusal(doc([{ ...element, props: { fit: 'cover' } }]))).toBe('/elements/0/props/mediaKey');
    expect(refusal(doc([{ ...element, props: { mediaKey: IMAGE } }]))).toBe('/elements/0/props/fit');
  });

  it('refuses a duration outside 3 to 15 s', () => {
    expect(refusal(doc([], { durationMs: 2999 }))).toBe('/durationMs');
    expect(refusal(doc([], { durationMs: 15001 }))).toBe('/durationMs');
    expect(refusal(doc([], { durationMs: 5000.5 }))).toBe('/durationMs');
    expect(checkTaleDocument(doc([], { durationMs: 3000 }))).toBeTruthy();
    expect(checkTaleDocument(doc([], { durationMs: 15000 }))).toBeTruthy();
  });

  it('refuses a media background with a bad key, fit or colour, or an unknown field', () => {
    for (const extra of [{ mediaKey: 'x' }, { fit: 'stretch' }, { color: 'red' }, { url: 'https://e.example/a' }]) {
      expect(refusal(doc([], mediaBackground(BG, extra)))).toMatch(/^\/canvas\/background/);
    }
  });

  it('lets a draft hold a media element without alt text, and refuses to publish it, naming the element', () => {
    const value = doc([media(1, 'image', IMAGE), media(2, 'image', IMAGE, { a11y: {} })]);
    expect(checkTaleDocument(value)).toEqual(value);
    const err = (() => {
      try {
        checkPublishableDocument(value);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(AltTextRequiredError);
    expect(err).toBeInstanceOf(InvalidTaleDocumentError);
    expect(err).toMatchObject({
      code: 'invalid_tale_document',
      pointer: '/elements/1/a11y/label',
      message: '"Image 2" needs alt text, or must be marked decorative, before the tale can be updated.',
    });
    // Blank alt text is none; a hidden element is not delivered, so it does not block.
    expect(refusal(doc([media(1, 'video', VIDEO, { a11y: { label: '  ' } })]), checkPublishableDocument)).toBe(
      '/elements/0/a11y/label',
    );
    expect(checkPublishableDocument(doc([media(1, 'image', IMAGE, { a11y: {}, hidden: true })]))).toBeTruthy();
  });

  it('does not deliver a published document that breaks the publish rule', () => {
    clearDeliveryCache();
    expect(deliverableTaleDocument(doc([media(1, 'image', IMAGE, { a11y: {} })]))).toBeNull();
    expect(deliverableTaleDocument(doc([media(1, 'image', IMAGE)]))?.elements).toHaveLength(1);
  });
});

describe('media of a project', () => {
  it('share locks keys in key order, once each', async () => {
    const { db, calls } = fakeDb([]);
    await lockMediaKeys(db, [VIDEO, IMAGE, VIDEO]);
    expect(calls().map((c) => c[1])).toEqual([[IMAGE], [VIDEO]]);
    expect(calls()[0][0]).toMatch(/pg_advisory_xact_lock_shared\(hashtextextended\('media:' \|\| \$1, 0\)\)/);
  });

  it("finds the keys that are the project's uploads, tale media or document media", async () => {
    const { db, calls } = fakeDb([{ rows: [{ key: IMAGE }] }]);
    expect(await projectMediaKeys(db, projectId, [IMAGE, VIDEO, 'nope', IMAGE])).toEqual(new Set([IMAGE]));
    const [sql, params] = calls()[0];
    expect(params).toEqual([projectId, [IMAGE, VIDEO]]);
    expect(sql).toMatch(/FROM project_media m WHERE m\.project_id = \$1 AND m\.storage_key = k\.key/);
    expect(sql).toMatch(/FROM tales t WHERE t\.project_id = \$1 AND t\.media_key = k\.key/);
    expect(sql).toMatch(/FROM tale_media tm WHERE tm\.project_id = \$1 AND tm\.storage_key = k\.key/);
    // Nothing to ask about, or a project id that is no UUID: no query.
    const none = fakeDb([]);
    expect(await projectMediaKeys(none.db, projectId, ['x'])).toEqual(new Set());
    expect(await projectMediaKeys(none.db, 'nope', [IMAGE])).toEqual(new Set());
    expect(none.query).not.toHaveBeenCalled();
  });

  it('serves a project media file only for a key of the project', async () => {
    expect(await projectMediaFile(fakeDb([{ rows: [{ key: VIDEO }] }]).db, projectId, VIDEO)).toEqual({
      key: VIDEO,
      contentType: 'video/mp4',
    });
    expect(await projectMediaFile(fakeDb([{ rows: [] }]).db, projectId, VIDEO)).toBeNull();
    const bad = fakeDb([]);
    expect(await projectMediaFile(bad.db, projectId, 'fonts/a.woff2')).toBeNull();
    expect(bad.query).not.toHaveBeenCalled();
  });

  it('records what a document uses, delivered only for visible keys of a deliverable published document', async () => {
    const value = doc([media(1, 'image', IMAGE), media(2, 'video', VIDEO, { hidden: true })], mediaBackground());
    const { db, calls } = fakeDb([]);
    await recordTaleMedia(db, taleId, 'published', value, true);
    expect(calls()[0]).toEqual(['DELETE FROM tale_media WHERE tale_id = $1 AND document = $2', [taleId, 'published']]);
    expect(calls()[1][0]).toMatch(/^INSERT INTO tale_media \(tale_id, storage_key, document, project_id/);
    expect(calls()[1][1]).toEqual([
      taleId,
      'published',
      [BG, IMAGE, VIDEO],
      ['image/jpeg', 'image/png', 'video/mp4'],
      [true, true, false],
    ]);
    const draft = fakeDb([]);
    await recordTaleMedia(draft.db, taleId, 'draft', value, true);
    expect(draft.calls()[1][1]).toEqual([
      taleId,
      'draft',
      [BG, IMAGE, VIDEO],
      expect.any(Array),
      [false, false, false],
    ]);
    const undeliverable = fakeDb([]);
    await recordTaleMedia(undeliverable.db, taleId, 'published', value, false);
    expect(undeliverable.calls()[1][1]).toEqual([
      taleId,
      'published',
      expect.any(Array),
      expect.any(Array),
      [false, false, false],
    ]);
    // No media: only the old rows go.
    const none = fakeDb([]);
    await recordTaleMedia(none.db, taleId, 'draft', doc([]), false);
    expect(none.calls()).toHaveLength(1);
  });

  it('lists uploads first, then tale media, then document media, each key once', async () => {
    const at = new Date('2026-10-22T10:00:00Z');
    const { db } = fakeDb([
      { rows: [{ key: IMAGE, contentType: 'image/png', sizeBytes: '2048', createdAt: at }] },
      {
        rows: [
          { key: VIDEO, contentType: 'video/mp4', taleTitle: 'Intro' },
          { key: IMAGE, contentType: 'image/png', taleTitle: 'Dup' },
        ],
      },
      {
        rows: [
          { key: BG, contentType: 'image/jpeg' },
          { key: VIDEO, contentType: 'video/mp4' },
        ],
      },
    ]);
    expect(await listProjectMedia(db, projectId)).toEqual([
      {
        key: IMAGE,
        kind: 'image',
        contentType: 'image/png',
        url: `/api/v1/projects/${projectId}/media/file?key=${encodeURIComponent(IMAGE)}`,
        source: 'upload',
        sizeBytes: 2048,
        createdAt: at.toISOString(),
      },
      {
        key: VIDEO,
        kind: 'video',
        contentType: 'video/mp4',
        url: `/api/v1/projects/${projectId}/media/file?key=${encodeURIComponent(VIDEO)}`,
        source: 'tale',
        taleTitle: 'Intro',
      },
      {
        key: BG,
        kind: 'image',
        contentType: 'image/jpeg',
        url: `/api/v1/projects/${projectId}/media/file?key=${encodeURIComponent(BG)}`,
        source: 'document',
      },
    ]);
    expect(await listProjectMedia(fakeDb([]).db, 'nope')).toEqual([]);
  });

  it('records an upload under the project lock, checking its caps again in the same transaction', async () => {
    const row = { key: IMAGE, contentType: 'image/png', sizeBytes: 4, createdAt: new Date() };
    const limits = { maxFiles: 3, maxBytes: 100 };
    const input = { projectId, storageKey: IMAGE, contentType: 'image/png' as const, sizeBytes: 4, uploaderId: id(9) };
    const ok = fakeDb([{ rows: [] }, { rows: [{ count: 2, bytes: '90' }] }, { rows: [row] }]);
    expect(await createProjectMedia(ok.db, input, limits)).toMatchObject({ key: IMAGE, source: 'upload' });
    expect(ok.statements()).toEqual([
      'BEGIN',
      expect.stringMatching(/pg_advisory_xact_lock\(hashtextextended\('project_media:' \|\| \$1, 0\)\)/),
      expect.stringMatching(/count\(\*\)::int AS count, COALESCE\(sum\(size_bytes\), 0\)/),
      expect.stringMatching(/^INSERT INTO project_media/),
      'COMMIT',
    ]);
    expect(ok.calls()[2][1]).toEqual([projectId, IMAGE, 'image/png', 4, id(9)]);

    const full = fakeDb([{ rows: [] }, { rows: [{ count: 3, bytes: '10' }] }]);
    await expect(createProjectMedia(full.db, input, limits)).rejects.toBeInstanceOf(MediaLimitError);
    expect(full.statements()).toContain('ROLLBACK');
    const heavy = fakeDb([{ rows: [] }, { rows: [{ count: 1, bytes: '97' }] }]);
    const err = await createProjectMedia(heavy.db, input, limits).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MediaStorageFullError);
    expect(err).toMatchObject({ code: 'media_storage_full' });
    expect(heavy.statements().some((sql) => /^INSERT/.test(sql))).toBe(false);
    expect(new MediaLimitError(500)).toMatchObject({ code: 'media_limit_reached' });
    expect(DEFAULT_PROJECT_MEDIA_LIMITS).toEqual({ maxFiles: 500, maxBytes: 2 * 1024 * 1024 * 1024 });
  });

  it('checks room before an upload is read', async () => {
    await expect(
      checkProjectMediaRoom(fakeDb([{ rows: [{ count: 0, bytes: 0 }] }]).db, projectId, 5, {
        maxFiles: 1,
        maxBytes: 4,
      }),
    ).rejects.toBeInstanceOf(MediaStorageFullError);
    await checkProjectMediaRoom(fakeDb([{ rows: [{ count: 0, bytes: 0 }] }]).db, projectId, 4, {
      maxFiles: 1,
      maxBytes: 4,
    });
  });

  it('sweeps upload files older than an hour that no row names, and nothing else', async () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    const old = new Date(now - MEDIA_UPLOAD_SWEEP_MIN_AGE_MS);
    const storage = {
      listKeys: vi.fn(async () => [
        { key: 'media/orphan.png', modifiedAt: old },
        { key: 'media/kept.png', modifiedAt: old },
        { key: 'media/fresh.png', modifiedAt: new Date(now - 1000) },
      ]),
      delete: vi.fn(async () => undefined),
    };
    const { db, calls } = fakeDb([{ rows: [] }, { rows: [{}] }]);
    expect(await sweepUnusedProjectMediaFiles(db, storage, now)).toBe(1);
    expect(storage.listKeys).toHaveBeenCalledWith('media');
    expect(storage.delete.mock.calls).toEqual([['media/orphan.png']]);
    expect(calls().map((c) => c[1])).toEqual([['media/orphan.png'], ['media/kept.png']]);
  });

  it('lists the delivered keys of each tale', async () => {
    const { db, calls } = fakeDb([
      {
        rows: [
          { taleId, key: IMAGE },
          { taleId, key: BG },
          { taleId: id(11), key: VIDEO },
        ],
      },
    ]);
    const keys = await deliveredMediaKeys(db, [taleId, id(11)]);
    expect(keys.get(taleId)).toEqual(new Set([IMAGE, BG]));
    expect(keys.get(id(11))).toEqual(new Set([VIDEO]));
    expect(calls()[0][0]).toMatch(/document = 'published' AND delivered/);
    const none = fakeDb([]);
    expect((await deliveredMediaKeys(none.db, [])).size).toBe(0);
    expect(none.query).not.toHaveBeenCalled();
  });
});

describe('public media of documents', () => {
  beforeEach(() => clearPublicMediaCache());

  it('answers only for a delivered row of a live tale of a delivered group, and keeps the answer a while', async () => {
    const { db, calls } = fakeDb([{ rows: [{ contentType: 'image/png' }] }, { rows: [] }]);
    const now = new Date('2026-10-22T10:00:00Z');
    expect(await findPublishedDocumentMedia(db, IMAGE, now)).toEqual({ key: IMAGE, contentType: 'image/png' });
    const [sql, params] = calls()[0];
    expect(sql).toMatch(/tm\.storage_key = \$1 AND tm\.document = 'published' AND tm\.delivered/);
    expect(sql).toMatch(/\(t\.status IN \('draft', 'paused'\)\) IS NOT TRUE/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM zone_tale_groups dz WHERE dz\.tale_group_id = g\.id\)/);
    expect(params).toEqual([IMAGE, now]);
    // Kept: no second query within the TTL.
    expect(await findPublishedDocumentMedia(db, IMAGE, new Date(now.getTime() + 1000))).not.toBeNull();
    expect(calls()).toHaveLength(1);
    // After the TTL it asks again.
    expect(await findPublishedDocumentMedia(db, IMAGE, new Date(now.getTime() + PUBLIC_MEDIA_CACHE_TTL_MS))).toBeNull();
    expect(calls()).toHaveLength(2);
  });

  it('never keeps a no, keeps at most its size of yeses, and never asks about a key of another shape', async () => {
    const now = new Date();
    const none = fakeDb([]);
    expect(await findPublishedDocumentMedia(none.db, IMAGE, now)).toBeNull();
    expect(await findPublishedDocumentMedia(none.db, IMAGE, now)).toBeNull();
    // A no is asked again each time.
    expect(none.calls()).toHaveLength(2);
    expect(await findPublishedDocumentMedia(none.db, 'covers/x.png', now)).toBeNull();
    expect(await findPublishedDocumentMedia(none.db, 'fonts/x.woff2', now)).toBeNull();
    expect(none.calls()).toHaveLength(2);

    const yes = { rows: [{ contentType: 'image/png' }] };
    const { db, calls } = fakeDb([]);
    (
      db.query as unknown as { mockImplementation: (f: (sql: string, p: unknown[]) => unknown) => void }
    ).mockImplementation(async (_sql: string, params: unknown[]) =>
      (params[0] as string).startsWith('media/k') ? yes : { rows: [] },
    );
    await findPublishedDocumentMedia(db, 'media/k0.png', now);
    // Random keys that are not public never push a kept yes out.
    for (let i = 0; i < PUBLIC_MEDIA_CACHE_SIZE * 2; i++) await findPublishedDocumentMedia(db, `media/x${i}.png`, now);
    let before = calls().length;
    await findPublishedDocumentMedia(db, 'media/k0.png', now);
    expect(calls().length).toBe(before);
    // Yeses beyond the size push out the least recently used one.
    for (let i = 1; i <= PUBLIC_MEDIA_CACHE_SIZE; i++) await findPublishedDocumentMedia(db, `media/k${i}.png`, now);
    before = calls().length;
    await findPublishedDocumentMedia(db, `media/k${PUBLIC_MEDIA_CACHE_SIZE}.png`, now);
    expect(calls().length).toBe(before);
    await findPublishedDocumentMedia(db, 'media/k0.png', now);
    expect(calls().length).toBe(before + 1);
    clearPublicMediaCache();
    await findPublishedDocumentMedia(db, `media/k${PUBLIC_MEDIA_CACHE_SIZE}.png`, now);
    expect(calls().length).toBe(before + 2);
  });
});

describe('document writes with media', () => {
  const NONE = { publishedDocument: null, publishedRevision: 0 };

  it('locks the tale row before the media keys and fonts on a save, as publishing does', async () => {
    const FONT = '0f0e0d0c-0000-4000-8000-00000000000a';
    const text = {
      id: id(1),
      type: 'text',
      box: { x: 0.1, y: 0.2, w: 0.5, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: 'Hi', font: { source: 'project', fontId: FONT } },
    };
    const { db, calls } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [{ id: FONT }] },
      { rows: [{ document: {}, revision: 1, ...NONE }] },
    ]);
    await saveTaleDocument(db, taleId, doc([text]), 0);
    expect(calls()[0][0]).toMatch(/FROM tales WHERE id = \$1 FOR UPDATE$/);
    expect(calls()[1][0]).toMatch(/FROM project_fonts[\s\S]*FOR SHARE/);
  });

  it('keeps a version as a new tale locking the group and source tale before its fonts and media keys', async () => {
    const value = doc([media(1, 'image', IMAGE)]);
    const tale = { id: id(20), taleGroupId: id(30), projectId, title: 'T (copy)', position: 1, mediaContentType: null };
    const { db, statements } = fakeDb([
      { rows: [{ groupId: id(30), projectId }] },
      { rows: [] },
      { rows: [{}] },
      { rows: [] },
      { rows: [{ key: IMAGE }] },
      { rows: [{ count: 1, next: 1 }] },
      { rows: [tale] },
    ]);
    await copyTaleWithDocument(db, taleId, value);
    const order = statements();
    const group = order.findIndex((sql) => /FROM tale_groups WHERE id = \$1 FOR UPDATE/.test(sql));
    const source = order.findIndex((sql) => /FROM tales WHERE id = \$1 FOR SHARE/.test(sql));
    const key = order.findIndex((sql) => /pg_advisory_xact_lock_shared/.test(sql));
    expect(group).toBeGreaterThan(-1);
    expect(group).toBeLessThan(source);
    expect(source).toBeLessThan(key);
    expect(order.findIndex((sql) => /^INSERT INTO tale_media/.test(sql))).toBeGreaterThan(key);
  });

  it('says in plain words why a draft was not published', () => {
    const value = doc([media(1, 'image', IMAGE), media(2, 'video', VIDEO)]);
    const at = (pointer: string) => new InvalidTaleDocumentError(pointer, 'is invalid');
    expect(draftProblem(new AltTextRequiredError('/elements/0/a11y/label', '"Image 1" needs alt text.'), value)).toBe(
      '"Image 1" needs alt text.',
    );
    expect(draftProblem(at('/elements/1/props/fit'), value)).toBe('"A cat" has a setting that is not valid.');
    expect(draftProblem(at('/elements/0/props/text'), doc([{ type: 'text', props: { text: '  Big   sale ' } }]))).toBe(
      'The text "Big sale" has a setting that is not valid.',
    );
    expect(draftProblem(at('/durationMs'), value)).toBe('Its duration is not between 3 and 15 seconds.');
    expect(draftProblem(at('/canvas/background/color'), value)).toBe('Its background has a setting that is not valid.');
    expect(draftProblem(at('/elements/7/type'), value)).toBe('Something in it is not valid.');
    expect(draftProblem(at('/elements/0/type'), doc([{ type: 'poll' }]))).toBe(
      'Layer 1 has a setting that is not valid.',
    );
    expect(draftProblem(new TaleDocumentTooLargeError(), value)).toBe('The draft is larger than 128 KB.');
    for (const reason of [draftProblem(at('/elements/1/props/fit'), value), draftProblem(at('/x'), value)]) {
      expect(reason).not.toMatch(/\//);
    }
  });

  it("saves media of the tale's project, share locked before the check, and records it", async () => {
    const value = doc([media(1, 'image', IMAGE), media(2, 'video', VIDEO)]);
    const { db, calls, statements } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ key: IMAGE }, { key: VIDEO }] },
      { rows: [{ document: value, revision: 1, ...NONE }] },
    ]);
    expect((await saveTaleDocument(db, taleId, value, 0)).revision).toBe(1);
    const sql = calls().map((c) => c[0]);
    expect(sql[1]).toMatch(/pg_advisory_xact_lock_shared/);
    expect(sql[2]).toMatch(/pg_advisory_xact_lock_shared/);
    expect(sql[3]).toMatch(/FROM unnest\(\$2::text\[\]\) AS k\(key\)/);
    expect(sql[4]).toMatch(/^UPDATE tales SET draft_document/);
    expect(sql.findIndex((s) => /^INSERT INTO tale_media/.test(s))).toBeGreaterThan(4);
    expect(statements().at(-1)).toBe('COMMIT');
  });

  it.each([
    ['a key of another project or none', [], '/elements/0/props/mediaKey'],
    ['a video key in an image element', [{ key: VIDEO }], '/elements/0/props/mediaKey'],
  ])('refuses %s and writes nothing', async (_name, known, pointer) => {
    const key = known.length ? VIDEO : IMAGE;
    const value = doc([media(1, 'image', key)]);
    const { db, statements } = fakeDb([{ rows: [{ projectId }] }, { rows: [] }, { rows: known }]);
    const refused = saveTaleDocument(db, taleId, value, 0);
    await expect(refused).rejects.toBeInstanceOf(InvalidTaleDocumentError);
    await expect(refused).rejects.toMatchObject({ pointer });
    expect(statements().some((s) => /^UPDATE tales/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
  });

  it('refuses an image key as the video, and a video as the background', async () => {
    const asVideo = fakeDb([{ rows: [{ projectId }] }, { rows: [] }, { rows: [{ key: IMAGE }] }]);
    await expect(saveTaleDocument(asVideo.db, taleId, doc([media(1, 'video', IMAGE)]), 0)).rejects.toMatchObject({
      pointer: '/elements/0/props/mediaKey',
      message: '/elements/0/props/mediaKey must be a video',
    });
    const background = fakeDb([
      { rows: [{ projectId }] },
      { rows: [] },
      { rows: [{ key: VIDEO.replace('tales/', 'media/') }] },
    ]);
    const value = doc([], mediaBackground('media/0b7c9d4e-1111-4222-8333-944455556667.mp4'));
    await expect(saveTaleDocument(background.db, taleId, value, 0)).rejects.toMatchObject({
      pointer: '/canvas/background/mediaKey',
    });
  });

  it('refuses to publish a draft with an image lacking alt text, before writing anything', async () => {
    const draft = doc([media(1, 'image', IMAGE, { a11y: {} })]);
    const { db, calls, statements } = fakeDb([{ rows: [{ document: draft, revision: 2, ...NONE }] }]);
    const refused = publishTaleDocument(db, taleId, 2, 0);
    await expect(refused).rejects.toBeInstanceOf(AltTextRequiredError);
    await expect(refused).rejects.toMatchObject({ pointer: '/elements/0/a11y/label' });
    expect(calls()).toHaveLength(1);
    expect(statements()).toContain('ROLLBACK');
  });

  it('publishes media checked again for the project and records it as delivered', async () => {
    const draft = doc([media(1, 'image', IMAGE)]);
    const { db, query, calls } = fakeDb([
      { rows: [{ document: draft, revision: 2, ...NONE }] },
      { rows: [{ projectId }] },
      { rows: [] },
      { rows: [{ key: IMAGE }] },
      { rows: [{ document: draft, revision: 2, publishedDocument: draft, publishedRevision: 1 }] },
    ]);
    await publishTaleDocument(db, taleId, 2, 0);
    expect(calls()[4][0]).toMatch(/SET document = draft_document/);
    const insert = query.mock.calls.find((c) => /^INSERT INTO tale_media/.test(c[0] as string));
    expect(insert?.[1]).toEqual([taleId, 'published', [IMAGE], ['image/png'], [true]]);
  });
});
