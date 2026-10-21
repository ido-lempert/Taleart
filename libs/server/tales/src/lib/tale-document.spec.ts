import type { Db } from '@taleart/server-access';
import {
  checkTaleDocument,
  deliverableTaleDocument,
  getTaleDocument,
  InvalidTaleDocumentError,
  saveTaleDocument,
  StaleRevisionError,
  TaleDocumentTooLargeError,
} from './tale-document';
import { TaleNotFoundError } from './tales';

const taleId = '00000000-0000-4000-8000-000000000010';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function text(n: number, value = 'Hello', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: id(n),
    type: 'text',
    box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { text: value },
    ...extra,
  };
}

function doc(elements: unknown[] = [text(1)], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements, ...extra };
}

// The pointer a refused document names.
function refusal(value: unknown): string {
  try {
    checkTaleDocument(value);
  } catch (err) {
    if (err instanceof InvalidTaleDocumentError) return err.pointer;
    throw err;
  }
  throw new Error('the document was accepted');
}

describe('checkTaleDocument', () => {
  it('accepts a version 1 document with text, a line feed, a label and a duration', () => {
    const value = doc([text(1, 'Hello\nworld', { a11y: { label: 'Greeting', decorative: false } })], {
      durationMs: 7000,
    });
    expect(checkTaleDocument(value)).toBe(value);
    expect(checkTaleDocument(doc([]))).toEqual(doc([]));
  });

  it('refuses an unknown element type, naming its pointer', () => {
    expect(refusal(doc([text(1), { ...text(2), type: 'poll' }]))).toBe('/elements/1/type');
  });

  it('refuses out-of-range boxes', () => {
    const box = (b: Record<string, number>) =>
      doc([text(1, 'x', { box: { x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0, ...b } })]);
    expect(refusal(box({ x: 1.5 }))).toBe('/elements/0/box/x');
    expect(refusal(box({ y: -0.1 }))).toBe('/elements/0/box/y');
    expect(refusal(box({ w: 0 }))).toBe('/elements/0/box/w');
    expect(refusal(box({ h: 1.01 }))).toBe('/elements/0/box/h');
    expect(refusal(box({ rotation: 400 }))).toBe('/elements/0/box/rotation');
    expect(refusal(box({ x: Infinity }))).toBe('/elements/0/box/x');
  });

  it('refuses unknown properties anywhere', () => {
    expect(refusal(doc(undefined, { extra: 1 }))).toBe('/extra');
    expect(refusal(doc([text(1, 'x', { style: 'color:red' })]))).toBe('/elements/0/style');
    expect(refusal(doc([{ ...text(1), props: { text: 'x', html: '<b>' } }]))).toBe('/elements/0/props/html');
    expect(refusal(doc([text(1, 'x', { box: { x: 0, y: 0, w: 1, h: 1, rotation: 0, z: 1 } })]))).toBe(
      '/elements/0/box/z',
    );
  });

  it('refuses a missing field, a wrong version and a colour that is not hex', () => {
    expect(refusal({ version: 1, elements: [] })).toBe('/canvas');
    expect(refusal(doc(undefined, { version: 2 }))).toBe('/version');
    expect(refusal(doc(undefined, { canvas: { background: { type: 'color', color: 'red;x:y' } } }))).toBe(
      '/canvas/background/color',
    );
    expect(refusal(doc(undefined, { durationMs: 100 }))).toBe('/durationMs');
    expect(refusal(doc([{ ...text(1), id: 'not-a-uuid' }]))).toBe('/elements/0/id');
  });

  it('refuses more than 60 elements', () => {
    expect(() => checkTaleDocument(doc(Array.from({ length: 60 }, (_, i) => text(i + 1))))).not.toThrow();
    expect(refusal(doc(Array.from({ length: 61 }, (_, i) => text(i + 1))))).toBe('/elements');
  });

  it('refuses text over 1,000 characters, counted as code points', () => {
    expect(() => checkTaleDocument(doc([text(1, '😀'.repeat(1000))]))).not.toThrow();
    expect(refusal(doc([text(1, 'a'.repeat(1001))]))).toBe('/elements/0/props/text');
  });

  it('refuses control characters other than a line feed, in text and labels', () => {
    expect(refusal(doc([text(1, 'a\u0007b')]))).toBe('/elements/0/props/text');
    expect(refusal(doc([text(1, 'a\tb')]))).toBe('/elements/0/props/text');
    expect(refusal(doc([text(1, 'x', { a11y: { label: 'a\nb' } })]))).toBe('/elements/0/a11y/label');
  });

  it('refuses a duplicate element id, ignoring case', () => {
    expect(refusal(doc([text(1), { ...text(2), id: id(1).toUpperCase() }]))).toBe('/elements/1/id');
  });

  it('refuses a document over 128 KB', () => {
    // 60 texts of 1,000 three-byte characters: valid in every other way, about 180 KB.
    const big = doc(Array.from({ length: 60 }, (_, i) => text(i + 1, '€'.repeat(1000))));
    expect(() => checkTaleDocument(big)).toThrow(TaleDocumentTooLargeError);
  });

  it('refuses what is not a document', () => {
    expect(refusal(null)).toBe('');
    expect(refusal([])).toBe('');
    expect(refusal('text')).toBe('');
  });
});

describe('deliverableTaleDocument', () => {
  it('drops hidden elements and the editor-only fields', () => {
    const delivered = deliverableTaleDocument(
      doc([text(1, 'Shown', { locked: true }), text(2, 'Hidden', { hidden: true })], { durationMs: 5000 }),
    );
    expect(delivered).toEqual({
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      durationMs: 5000,
      elements: [
        {
          id: id(1),
          type: 'text',
          box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
          a11y: {},
          props: { text: 'Shown' },
        },
      ],
    });
  });

  it('delivers nothing for no document or one that no longer validates', () => {
    expect(deliverableTaleDocument(null)).toBeNull();
    expect(deliverableTaleDocument(doc([{ ...text(1), type: 'poll' }]))).toBeNull();
  });
});

// A fake database answering queries in order.
function fakeDb(answers: { rows: unknown[] }[]) {
  const query = vi.fn(async () => answers.shift() ?? { rows: [] });
  return { db: { query } as unknown as Db, query };
}

describe('tale document storage', () => {
  it('reads a tale without a document as null at revision 0', async () => {
    const { db } = fakeDb([{ rows: [{ document: null, revision: 0 }] }]);
    expect(await getTaleDocument(db, taleId)).toEqual({ document: null, revision: 0 });
  });

  it('refuses an unknown tale without querying for a malformed id', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    await expect(getTaleDocument(db, 'nope')).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(query).not.toHaveBeenCalled();
    await expect(getTaleDocument(db, taleId)).rejects.toBeInstanceOf(TaleNotFoundError);
  });

  it('saves only when the revision matches, and answers the next one', async () => {
    const { db, query } = fakeDb([{ rows: [{ revision: 4 }] }]);
    const value = doc();
    expect(await saveTaleDocument(db, taleId, value, 3)).toEqual({ document: value, revision: 4 });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/WHERE id = \$1 AND document_revision = \$3/);
    expect(params).toEqual([taleId, JSON.stringify(value), 3]);
  });

  it('refuses a stale revision with the current one, and an unknown tale', async () => {
    const stale = fakeDb([{ rows: [] }, { rows: [{ revision: 5 }] }]);
    const err = await saveTaleDocument(stale.db, taleId, doc(), 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleRevisionError);
    expect((err as StaleRevisionError).currentRevision).toBe(5);
    const missing = fakeDb([{ rows: [] }, { rows: [] }]);
    await expect(saveTaleDocument(missing.db, taleId, doc(), 0)).rejects.toBeInstanceOf(TaleNotFoundError);
  });

  it('checks the document before writing', async () => {
    const { db, query } = fakeDb([]);
    await expect(saveTaleDocument(db, taleId, doc([{ ...text(1), type: 'poll' }]), 0)).rejects.toBeInstanceOf(
      InvalidTaleDocumentError,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
