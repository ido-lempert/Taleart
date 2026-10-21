import type { Db } from '@taleart/server-access';
import {
  checkTaleDocument,
  clearDeliveryCache,
  deliverableTaleDocument,
  getTaleDocument,
  InvalidTaleDocumentError,
  saveTaleDocument,
  publishTaleDocument,
  discardTaleDraft,
  StaleRevisionError,
  TaleDocumentTooLargeError,
} from './tale-document';
import { TaleNotFoundError } from './tales';
import { DELIVERY_CACHE_SIZE } from './tale-document';

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
    expect(checkTaleDocument(value)).toEqual(value);
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
    // Labels follow the same rule as text: C0, DEL and C1 are all refused.
    for (const c of ['\u007f', '\u0085', '\u009f']) {
      expect(refusal(doc([text(1, 'x', { a11y: { label: `a${c}b` } })]))).toBe('/elements/0/a11y/label');
      expect(refusal(doc([text(1, `a${c}b`)]))).toBe('/elements/0/props/text');
    }
  });

  it('refuses a duplicate element id, ignoring case', () => {
    expect(refusal(doc([text(1), { ...text(2), id: id(1).toUpperCase() }]))).toBe('/elements/1/id');
  });

  it('refuses a document over 128 KB', () => {
    // 60 texts of 1,000 three-byte characters: valid in every other way, about 180 KB.
    const big = doc(Array.from({ length: 60 }, (_, i) => text(i + 1, '€'.repeat(1000))));
    expect(() => checkTaleDocument(big)).toThrow(TaleDocumentTooLargeError);
  });

  it('refuses lone surrogates and bidi embeddings and overrides in text and labels', () => {
    for (const c of ['\ud800', '\udc00', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e']) {
      expect(refusal(doc([text(1, `a${c}b`)]))).toBe('/elements/0/props/text');
      expect(refusal(doc([text(1, 'x', { a11y: { label: `a${c}b` } })]))).toBe('/elements/0/a11y/label');
    }
    // Through JSON, as the API receives it.
    expect(refusal(JSON.parse(JSON.stringify(doc([text(1, 'LONE')])).replace('"LONE"', '"\\ud800"')))).toBe(
      '/elements/0/props/text',
    );
  });

  it('keeps Hebrew and Arabic text, bidi marks and isolates, ZWJ and ZWNJ, and emoji sequences', () => {
    const texts = [
      'שלום, עולם! 123',
      'مرحبا\u200f بالعالم',
      '\u2067שלום\u2069 and \u2066hello\u2069 \u200e',
      '👩‍👩‍👧‍👦 👍🏽 🏳️‍🌈 👨‍💻',
      'می\u200cخواهم',
    ];
    for (const value of texts) {
      expect(checkTaleDocument(doc([text(1, value, { a11y: { label: value } })])).elements[0].props.text).toBe(value);
    }
  });

  it('stores text and labels in Unicode NFC', () => {
    const decomposed = 'Cafe\u0301';
    const checked = checkTaleDocument(doc([text(1, decomposed, { a11y: { label: decomposed } })]));
    expect(checked.elements[0].props.text).toBe('Caf\u00e9');
    expect(checked.elements[0].a11y.label).toBe('Caf\u00e9');
  });

  it('escapes every key in a refusal pointer (RFC 6901)', () => {
    expect(refusal(doc(undefined, { 'a/b': 1 }))).toBe('/a~1b');
    expect(refusal(doc(undefined, { 'c~d': 1 }))).toBe('/c~0d');
    expect(refusal(doc([{ ...text(1), props: { text: 'x', 'e/f~g': 1 } }]))).toBe('/elements/0/props/e~1f~0g');
    const body = JSON.stringify(doc()).replace('"elements"', '"x/y":{"z":1e999},"elements"');
    expect(refusal(JSON.parse(body))).toBe('/x~1y/z');
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

  it('refuses an unknown version or oversize stored text at once, and checks in full once per tale and revision', () => {
    clearDeliveryCache();
    expect(deliverableTaleDocument(doc(undefined, { version: 2 }), 't:1')).toBeNull();
    expect(deliverableTaleDocument(doc(), 't:1', 300 * 1024)).toBeNull();
    const first = deliverableTaleDocument(doc([text(1, 'One')]), 't:1');
    expect(first?.elements[0].props).toEqual({ text: 'One' });
    // The same tale and revision is not checked again: a changed row with the same key reads as cached.
    expect(deliverableTaleDocument(doc([{ ...text(1), type: 'poll' }]), 't:1')).toBe(first);
    // A save raises the revision, and the new key is checked.
    expect(deliverableTaleDocument(doc([{ ...text(1), type: 'poll' }]), 't:2')).toBeNull();
    clearDeliveryCache();
  });

  it('keeps at most DELIVERY_CACHE_SIZE documents, dropping the least recently used', () => {
    clearDeliveryCache();
    const kept = deliverableTaleDocument(doc([text(1, 'Kept')]), 'kept:1');
    for (let i = 0; i < DELIVERY_CACHE_SIZE; i++) {
      deliverableTaleDocument(doc([text(1, `T${i}`)]), `t${i}:1`);
      // Read again, so it stays the most recently used.
      if (i % 100 === 0) deliverableTaleDocument(doc(), 'kept:1');
    }
    expect(deliverableTaleDocument(doc(), 'kept:1')).toBe(kept);
    // The oldest entry other than the one read again is gone, so it is checked again.
    expect(deliverableTaleDocument(doc([text(1, 'Again')]), 't0:1')?.elements[0].props).toEqual({ text: 'Again' });
    clearDeliveryCache();
  });
});

// A fake database answering queries in order.
function fakeDb(answers: { rows: unknown[] }[]) {
  const query = vi.fn(async () => answers.shift() ?? { rows: [] });
  return { db: { query } as unknown as Db, query };
}

describe('tale document storage', () => {
  const NONE = { publishedDocument: null, publishedRevision: 0 };

  it('reads a tale without a document as null at revision 0, draft and published', async () => {
    const { db } = fakeDb([{ rows: [{ document: null, revision: 0, ...NONE }] }]);
    expect(await getTaleDocument(db, taleId)).toEqual({
      document: null,
      revision: 0,
      published: { document: null, revision: 0 },
    });
  });

  it('refuses an unknown tale without querying for a malformed id', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    await expect(getTaleDocument(db, 'nope')).rejects.toBeInstanceOf(TaleNotFoundError);
    expect(query).not.toHaveBeenCalled();
    await expect(getTaleDocument(db, taleId)).rejects.toBeInstanceOf(TaleNotFoundError);
  });

  it('saves the draft only when its revision matches, never the published document', async () => {
    const published = doc([text(9)]);
    const { db, query } = fakeDb([
      { rows: [{ document: {}, revision: 4, publishedDocument: published, publishedRevision: 2 }] },
    ]);
    const value = doc();
    expect(await saveTaleDocument(db, taleId, value, 3)).toEqual({
      document: value,
      revision: 4,
      published: { document: published, revision: 2 },
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET draft_document = \$2::jsonb, draft_revision = draft_revision \+ 1/);
    expect(sql).toMatch(/WHERE id = \$1 AND draft_revision = \$3/);
    expect(sql.split('RETURNING')[0]).not.toMatch(/SET document|document_revision =/);
    expect(params).toEqual([taleId, JSON.stringify(value), 3]);
  });

  it('publishes the checked draft with compare-and-set on both revisions', async () => {
    const draft = doc();
    const { db, query } = fakeDb([
      { rows: [{ document: draft, revision: 4, ...NONE }] },
      { rows: [{ document: draft, revision: 4, publishedDocument: draft, publishedRevision: 1 }] },
    ]);
    expect(await publishTaleDocument(db, taleId, 4, 0)).toEqual({
      document: draft,
      revision: 4,
      published: { document: draft, revision: 1 },
    });
    const [sql, params] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET document = draft_document, document_revision = document_revision \+ 1/);
    expect(sql).toMatch(/WHERE id = \$1 AND draft_revision = \$2 AND document_revision = \$3/);
    expect(params).toEqual([taleId, 4, 0]);
  });

  it('refuses to publish on a stale revision, a draft that no longer passes, or an unknown tale', async () => {
    const stale = fakeDb([
      { rows: [{ document: doc(), revision: 4, ...NONE }] },
      { rows: [] },
      { rows: [{ revision: 6 }] },
    ]);
    const err = await publishTaleDocument(stale.db, taleId, 4, 0).catch((e: unknown) => e);
    expect((err as StaleRevisionError).currentRevision).toBe(6);
    const invalid = fakeDb([{ rows: [{ document: doc([{ ...text(1), type: 'poll' }]), revision: 1, ...NONE }] }]);
    await expect(publishTaleDocument(invalid.db, taleId, 1, 0)).rejects.toBeInstanceOf(InvalidTaleDocumentError);
    expect(invalid.query).toHaveBeenCalledTimes(1);
    await expect(publishTaleDocument(fakeDb([{ rows: [] }]).db, taleId, 0, 0)).rejects.toBeInstanceOf(
      TaleNotFoundError,
    );
  });

  it('discards the draft back to the published document with compare-and-set on both revisions', async () => {
    const published = doc();
    const { db, query } = fakeDb([
      { rows: [{ document: published, revision: 5, publishedDocument: published, publishedRevision: 2 }] },
    ]);
    expect((await discardTaleDraft(db, taleId, 4, 2)).revision).toBe(5);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/SET draft_document = document, draft_revision = draft_revision \+ 1/);
    expect(sql).toMatch(/AND draft_revision = \$2 AND document_revision = \$3/);
    expect(params).toEqual([taleId, 4, 2]);
    const stale = fakeDb([{ rows: [] }, { rows: [{ revision: 7 }] }]);
    await expect(discardTaleDraft(stale.db, taleId, 4, 1)).rejects.toBeInstanceOf(StaleRevisionError);
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
