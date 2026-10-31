import { type TaleDocument } from '@taleart/contract';
import { checkPublishableDocument } from './tale-document';
import { classifyMigrationError, documentTaleMedia, mergeTaleMedia, taleMediaDocument } from './tale-media-document';

const ID = '00000000-0000-4000-8000-0000000000ff';
const IMAGE = { key: 'tales/0a.png', kind: 'image' as const };
const VIDEO = { key: 'tales/0b.mp4', kind: 'video' as const };

function text(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'text' as const,
    box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { text: `Line ${n}` },
  };
}

function overlay(extra: Partial<TaleDocument> = {}): TaleDocument {
  return { version: 1, canvas: { background: { type: 'color', color: '#112233' } }, elements: [text(1)], ...extra };
}

describe('the tale media document (epic Tale Studio R16)', () => {
  it('makes a document of only the media: full canvas, contain, decorative, 5 s, publishable', () => {
    const doc = taleMediaDocument(IMAGE, ID);
    expect(doc).toEqual({
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      durationMs: 5000,
      elements: [
        {
          id: ID,
          type: 'image',
          box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: { decorative: true },
          props: { mediaKey: 'tales/0a.png', fit: 'contain', taleMedia: true },
        },
      ],
    });
    expect(() => checkPublishableDocument(doc)).not.toThrow();
    expect(() => checkPublishableDocument(taleMediaDocument(VIDEO, ID))).not.toThrow();
  });

  it("puts the media at the bottom of a person's document, keeping legacy timing only on the first merge", () => {
    const merged = mergeTaleMedia(overlay(), IMAGE, { id: ID, legacyTiming: true }) as TaleDocument;
    expect(merged.elements.map((e) => e.id)).toEqual([ID, text(1).id]);
    expect(merged.durationMs).toBe(5000);
    expect(merged.canvas).toEqual(overlay().canvas);
    // A duration a person set stays; a later write keeps the 7 s default.
    expect(
      (mergeTaleMedia(overlay({ durationMs: 9000 }), IMAGE, { legacyTiming: true }) as TaleDocument).durationMs,
    ).toBe(9000);
    expect((mergeTaleMedia(overlay(), IMAGE) as TaleDocument).durationMs).toBeUndefined();
  });

  it("replaces the media element's key and type in place, keeping a person's alt text, fit and box", () => {
    const own = {
      ...taleMediaDocument(IMAGE, ID).elements[0],
      a11y: { label: 'Beach' },
      box: { x: 0, y: 0, w: 1, h: 0.5, rotation: 0 },
    };
    const doc = overlay({ elements: [text(1), own as never] });
    const merged = mergeTaleMedia(doc, VIDEO) as TaleDocument;
    expect(merged.elements[1]).toEqual({ ...own, type: 'video', props: { ...own.props, mediaKey: VIDEO.key } });
    expect(merged.elements[0]).toBe(doc.elements[0]);
    // Already in step: the same object, so nothing is written.
    expect(mergeTaleMedia(merged, VIDEO)).toBe(merged);
  });

  it('accepts only media a document can hold: a document key whose kind agrees with the stored type', () => {
    expect(documentTaleMedia('tales/0a.png', 'image/png')).toEqual(IMAGE);
    expect(documentTaleMedia('tales/0b.webm', 'video/webm')).toEqual({
      key: 'tales/0b.webm',
      kind: 'video',
    });
    expect(documentTaleMedia(null, null)).toBeNull();
    expect(documentTaleMedia('uploads/A.PNG', 'image/png')).toBeNull();
    expect(documentTaleMedia('tales/0a.png', 'video/mp4')).toBeNull();
    expect(documentTaleMedia('tales/0a.png', 'text/html')).toBeNull();
  });

  it('lets the media video sit beside a document video, and refuses a second media element', () => {
    const video = { ...taleMediaDocument(VIDEO, ID).elements[0], props: { mediaKey: 'media/0d.mp4', fit: 'cover' } };
    const both = mergeTaleMedia(overlay({ elements: [{ ...video, id: text(9).id } as never] }), VIDEO, { id: ID });
    expect(() => checkPublishableDocument(both)).not.toThrow();
    const twice = {
      ...(both as TaleDocument),
      elements: [...(both as TaleDocument).elements, { ...taleMediaDocument(IMAGE, text(8).id).elements[0] }],
    };
    expect(() => checkPublishableDocument(twice)).toThrow(/one media/);
  });
});

describe('migration errors (R16)', () => {
  it('retries passing database errors later, marks shape errors, and fails the batch on anything else', () => {
    const pg = (code: string) => Object.assign(new Error(code), { code });
    for (const code of ['40P01', '40001', '55P03', '57014']) expect(classifyMigrationError(pg(code))).toBe('later');
    expect(classifyMigrationError(pg('22P02'))).toBe('malformed');
    expect(classifyMigrationError(new TypeError('x.filter is not a function'))).toBe('malformed');
    expect(classifyMigrationError(pg('23505'))).toBe('fatal');
    expect(classifyMigrationError(new Error('connection lost'))).toBe('fatal');
  });
});
