import {
  clearPublicMediaCache,
  createProjectMedia,
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
  deliverableTaleDocument,
  InvalidTaleDocumentError,
  publishTaleDocument,
  saveTaleDocument,
} from './tale-document';
import type { TransactionalDb } from './tales';

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
      message: 'Image "Image 2" needs alt text, or must be marked decorative, before the tale is published.',
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

  it('stores an upload with its row: a failed store rolls the row back, a failed commit removes the file', async () => {
    const row = { key: IMAGE, contentType: 'image/png', sizeBytes: 4, createdAt: new Date() };
    const ok = fakeDb([{ rows: [row] }]);
    const put = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const input = { projectId, storageKey: IMAGE, contentType: 'image/png' as const, sizeBytes: 4, uploaderId: id(9) };
    expect(await createProjectMedia(ok.db, input, { put, remove })).toMatchObject({ key: IMAGE, source: 'upload' });
    expect(ok.statements()).toEqual(['BEGIN', expect.stringMatching(/^INSERT INTO project_media/), 'COMMIT']);
    expect(ok.calls()[0][1]).toEqual([projectId, IMAGE, 'image/png', 4, id(9)]);
    expect(remove).not.toHaveBeenCalled();

    const failedPut = fakeDb([{ rows: [row] }]);
    await expect(
      createProjectMedia(failedPut.db, input, { put: async () => Promise.reject(new Error('disk')), remove }),
    ).rejects.toThrow('disk');
    expect(failedPut.statements()).toContain('ROLLBACK');
    expect(remove).not.toHaveBeenCalled();

    const failedCommit = fakeDb([{ rows: [row] }]);
    failedCommit.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit');
      return sql.startsWith('INSERT') ? { rows: [row] } : { rows: [] };
    });
    await expect(createProjectMedia(failedCommit.db, input, { put, remove })).rejects.toThrow('commit');
    expect(remove).toHaveBeenCalledTimes(1);
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
    expect(sql).toMatch(/t\.status = 'live'/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM zone_tale_groups dz WHERE dz\.tale_group_id = g\.id\)/);
    expect(params).toEqual([IMAGE, now]);
    // Kept: no second query within the TTL.
    expect(await findPublishedDocumentMedia(db, IMAGE, new Date(now.getTime() + 1000))).not.toBeNull();
    expect(calls()).toHaveLength(1);
    // After the TTL it asks again.
    expect(await findPublishedDocumentMedia(db, IMAGE, new Date(now.getTime() + PUBLIC_MEDIA_CACHE_TTL_MS))).toBeNull();
    expect(calls()).toHaveLength(2);
  });

  it('forgets its answers when cleared, keeps at most its size, and never asks about a key of another shape', async () => {
    const { db, calls } = fakeDb([]);
    const now = new Date();
    expect(await findPublishedDocumentMedia(db, IMAGE, now)).toBeNull();
    clearPublicMediaCache();
    await findPublishedDocumentMedia(db, IMAGE, now);
    expect(calls()).toHaveLength(2);
    expect(await findPublishedDocumentMedia(db, 'covers/x.png', now)).toBeNull();
    expect(await findPublishedDocumentMedia(db, 'fonts/x.woff2', now)).toBeNull();
    expect(calls()).toHaveLength(2);
    for (let i = 0; i <= PUBLIC_MEDIA_CACHE_SIZE; i++) {
      await findPublishedDocumentMedia(db, `media/k${i}.png`, now);
    }
    const before = calls().length;
    // The first key was dropped, so it is asked about again; the last is still kept.
    await findPublishedDocumentMedia(db, 'media/k0.png', now);
    await findPublishedDocumentMedia(db, `media/k${PUBLIC_MEDIA_CACHE_SIZE}.png`, now);
    expect(calls().length).toBe(before + 1);
  });
});

describe('document writes with media', () => {
  const NONE = { publishedDocument: null, publishedRevision: 0 };

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
