import { recordTaleMedia } from './document-media';
import {
  AltTextRequiredError,
  checkPublishableDocument,
  checkTaleDocument,
  deliverableTaleDocument,
  draftProblem,
  InvalidTaleDocumentError,
  saveTaleDocument,
} from './tale-document';
import type { TransactionalDb } from './tales';

// Tale Studio story 7.6: shapes, emoji and image stickers.
const taleId = '00000000-0000-4000-8000-000000000010';
const projectId = '00000000-0000-4000-8000-0000000000aa';
const STICKER = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function element(n: number, type: string, props: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: id(n),
    type,
    box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props,
    ...extra,
  };
}

const doc = (elements: unknown[]) => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements,
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

function fakeDb(answers: { rows: unknown[] }[]) {
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    return answers.shift() ?? { rows: [] };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as TransactionalDb;
  const statements = () => (query.mock.calls as unknown as [string][]).map(([sql]) => sql);
  return { db, query, statements };
}

describe('checkTaleDocument: shapes, emoji and stickers (story 7.6)', () => {
  it('accepts a rounded rectangle, an ellipse, a line, emoji and a sticker', () => {
    const value = doc([
      element(
        1,
        'shape',
        { shape: 'rectangle', fill: '#ff0000', stroke: '#000000', strokeWidth: 0.01, radius: 0.04 },
        {
          a11y: { decorative: true },
        },
      ),
      element(2, 'shape', { shape: 'ellipse', fill: '#00ff0080', opacity: 0.5 }, { a11y: { label: 'A green dot' } }),
      element(
        3,
        'shape',
        { shape: 'line', stroke: '#ffffff', strokeWidth: 0.004 },
        { box: { x: 0, y: 0.5, w: 1, h: 0.02, rotation: 45 } },
      ),
      element(4, 'emoji', { emoji: '😀' }, { a11y: { label: 'grinning face' } }),
      element(5, 'emoji', { emoji: '👩🏽‍💻' }, { a11y: { label: 'woman technologist: medium skin tone' } }),
      element(6, 'emoji', { emoji: '🇮🇱' }),
      element(7, 'sticker', { mediaKey: STICKER, opacity: 0.8 }, { a11y: { label: 'A party hat' } }),
    ]);
    expect(checkTaleDocument(value)).toEqual(value);
    expect(checkPublishableDocument(value)).toEqual(value);
  });

  it.each([
    ['an unknown shape', { shape: 'star' }, '/elements/0/props/shape'],
    ['a fill that is not hex', { shape: 'rectangle', fill: 'red' }, '/elements/0/props/fill'],
    ['CSS in a stroke colour', { shape: 'rectangle', stroke: '#fff;x:url(y)' }, '/elements/0/props/stroke'],
    ['a stroke too wide', { shape: 'rectangle', stroke: '#ffffff', strokeWidth: 0.2 }, '/elements/0/props/strokeWidth'],
    ['an opacity over 1', { shape: 'ellipse', opacity: 1.5 }, '/elements/0/props/opacity'],
    ['SVG markup', { shape: 'rectangle', svg: '<svg/>' }, '/elements/0/props/svg'],
  ])('refuses %s, naming the prop', (_name, props, pointer) => {
    expect(refusal(doc([element(1, 'shape', props)]))).toBe(pointer);
  });

  it.each([
    ['a radius on an ellipse', { shape: 'ellipse', radius: 0.1 }],
    ['a fill on a line', { shape: 'line', stroke: '#ffffff', strokeWidth: 0.01, fill: '#000000' }],
    ['a line without a stroke', { shape: 'line', strokeWidth: 0.01 }],
    ['a line of no width', { shape: 'line', stroke: '#ffffff', strokeWidth: 0 }],
    ['a stroke width of Infinity', { shape: 'rectangle', stroke: '#ffffff', strokeWidth: Infinity }],
  ])('refuses %s', (_name, props) => {
    expect(refusal(doc([element(1, 'shape', props)]))).toMatch(/^\/elements\/0\/props/);
  });

  it.each([
    ['text', 'abc'],
    ['two emoji', '😀😀'],
    ['markup', '<img src=x onerror=alert(1)>'],
    ['a bidi override', '😀‮'],
    ['a control character', '😀\u0000'],
    ['an unqualified heart', '❤'],
  ])('refuses %s as an emoji', (_name, emoji) => {
    expect(refusal(doc([element(1, 'emoji', { emoji })]))).toBe('/elements/0/props/emoji');
  });

  it('refuses an empty or missing emoji, and an emoji image URL', () => {
    expect(refusal(doc([element(1, 'emoji', { emoji: '' })]))).toBe('/elements/0/props/emoji');
    expect(refusal(doc([element(1, 'emoji', {})]))).toBe('/elements/0/props/emoji');
    expect(refusal(doc([element(1, 'emoji', { emoji: '😀', url: 'https://cdn.example/1f600.png' })]))).toBe(
      '/elements/0/props/url',
    );
  });

  it.each([
    ['a JPEG', 'media/0b7c9d4e-1111-4222-8333-944455556666.jpg'],
    ['a video', 'media/0b7c9d4e-1111-4222-8333-944455556666.mp4'],
    ['a URL', 'https://cdn.example/sticker.png'],
  ])('refuses %s as a sticker', (_name, mediaKey) => {
    expect(refusal(doc([element(1, 'sticker', { mediaKey })]))).toBe('/elements/0/props/mediaKey');
  });

  it('lets a draft hold a sticker without alt text, and refuses to publish it, naming "Sticker 1"', () => {
    const value = doc([element(1, 'shape', { shape: 'ellipse' }), element(2, 'sticker', { mediaKey: STICKER })]);
    expect(checkTaleDocument(value)).toEqual(value);
    let err: unknown;
    try {
      checkPublishableDocument(value);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AltTextRequiredError);
    expect(err).toMatchObject({ pointer: '/elements/1/a11y/label' });
    expect((err as Error).message).toMatch(/^"Sticker 1" needs alt text/);
    expect(draftProblem(err as AltTextRequiredError, value)).toMatch(/^"Sticker 1" needs alt text/);
    expect(deliverableTaleDocument(value)).toBeNull();
  });

  it('names a sticker, a shape and an emoji in a draft problem as Tale Studio does', () => {
    const value = doc([
      element(1, 'sticker', { mediaKey: STICKER }),
      element(2, 'shape', { shape: 'rectangle' }),
      element(3, 'shape', { shape: 'rectangle' }),
      element(4, 'emoji', { emoji: '🎉' }, { a11y: { label: 'party popper' } }),
      element(5, 'shape', { shape: 'line' }, { a11y: { label: 'Divider' } }),
    ]);
    const problem = (i: number) =>
      draftProblem(new InvalidTaleDocumentError(`/elements/${i}/props/opacity`, 'x'), value);
    expect(problem(0)).toBe('"Sticker 1" has a setting that is not valid.');
    expect(problem(2)).toBe('"Rectangle 2" has a setting that is not valid.');
    expect(problem(3)).toBe('"🎉 party popper" has a setting that is not valid.');
    expect(problem(4)).toBe('"Divider" has a setting that is not valid.');
  });

  it('delivers shapes, emoji and stickers without the editor-only fields', () => {
    const value = doc([
      element(1, 'shape', { shape: 'line', stroke: '#ffffff', strokeWidth: 0.01 }, { a11y: { decorative: true } }),
      element(2, 'emoji', { emoji: '🎉' }, { a11y: { label: 'party popper' }, locked: true }),
      element(3, 'sticker', { mediaKey: STICKER }, { a11y: { decorative: true }, hidden: true }),
    ]);
    const delivered = deliverableTaleDocument(value);
    expect(delivered?.elements.map((e) => e.type)).toEqual(['shape', 'emoji']);
    expect(delivered?.elements[1]).not.toHaveProperty('locked');
  });
});

describe('stickers are media of the project (story 7.6)', () => {
  const NONE = { publishedDocument: null, publishedRevision: 0 };

  it("saves a sticker of the tale's project, share locked, and records it", async () => {
    const value = doc([element(1, 'sticker', { mediaKey: STICKER }, { a11y: { decorative: true } })]);
    const { db, query, statements } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [] },
      { rows: [{ key: STICKER }] },
      { rows: [{ document: value, revision: 1, ...NONE }] },
    ]);
    expect((await saveTaleDocument(db, taleId, value, 0)).revision).toBe(1);
    expect(statements().some((s) => /pg_advisory_xact_lock_shared/.test(s))).toBe(true);
    const insert = query.mock.calls.find((c) => /^INSERT INTO tale_media/.test(c[0] as string));
    expect(insert?.[1]).toEqual([taleId, 'draft', [STICKER], ['image/png'], [false]]);
  });

  it('refuses a sticker key of another project, writing nothing', async () => {
    const value = doc([element(1, 'sticker', { mediaKey: STICKER })]);
    const { db, statements } = fakeDb([{ rows: [{ projectId }] }, { rows: [] }, { rows: [] }]);
    const refused = saveTaleDocument(db, taleId, value, 0);
    await expect(refused).rejects.toMatchObject({ pointer: '/elements/0/props/mediaKey' });
    expect(statements().some((s) => /^UPDATE tales/.test(s))).toBe(false);
  });

  it('records no media for shapes and emoji', async () => {
    const { db, query } = fakeDb([]);
    await recordTaleMedia(db, taleId, 'draft', doc([element(1, 'emoji', { emoji: '😀' })]), false);
    expect(query.mock.calls.some((c) => /^INSERT INTO tale_media/.test(c[0] as string))).toBe(false);
  });
});
