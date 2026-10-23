import {
  checkPublishableDocument,
  checkTaleDocument,
  deliverableTaleDocument,
  draftProblem,
  InvalidTaleDocumentError,
  LinkUrlRequiredError,
  AltTextRequiredError,
  saveTaleDocument,
} from './tale-document';
import type { TransactionalDb } from '@taleart/server-access';

// Tale Studio story 7.7: buttons, image buttons and the swipe-up link (R7, R14).
const taleId = '00000000-0000-4000-8000-000000000010';
const projectId = '00000000-0000-4000-8000-0000000000aa';
const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.jpg';
const SWIPE_BOX = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ch = (code: number) => String.fromCharCode(code);

function element(n: number, type: string, props: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: id(n),
    type,
    box: type === 'swipe-up' ? { ...SWIPE_BOX } : { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props,
    ...extra,
  };
}

const button = (href?: string, extra: Record<string, unknown> = {}) => ({
  label: 'Shop now',
  variant: 'filled',
  color: '#111827',
  fill: '#ffffff',
  ...(href === undefined ? {} : { href }),
  ...extra,
});
const swipeUp = (href?: string) => ({
  label: 'See more',
  color: '#ffffff',
  background: '#000000b3',
  ...(href === undefined ? {} : { href }),
});

const doc = (elements: unknown[]) => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements,
});

function refused(value: unknown, check: (v: unknown) => unknown = checkTaleDocument): InvalidTaleDocumentError {
  try {
    check(value);
  } catch (err) {
    if (err instanceof InvalidTaleDocumentError) return err;
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
  return { db, query };
}

describe('checkTaleDocument: buttons, image buttons and the swipe-up link (story 7.7)', () => {
  it('accepts one of each, with destinations, in the same or a new tab', () => {
    const value = doc([
      element(1, 'button', button('https://example.com/shop', { newTab: true, variant: 'outline', radius: 0.03 })),
      element(
        2,
        'image-button',
        { mediaKey: IMAGE, href: 'http://example.com', radius: 0.02 },
        {
          a11y: { label: 'Shop the look' },
        },
      ),
      element(3, 'swipe-up', swipeUp('https://example.com/more')),
    ]);
    expect(checkTaleDocument(value)).toEqual(value);
    expect(checkPublishableDocument(value)).toEqual(value);
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a JavaScript: URL with a tab', `java${ch(9)}script:alert(1)`],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['an ftp: URL', 'ftp://example.com/file'],
    ['a relative URL', '/shop'],
    ['a protocol-relative URL', '//example.com/shop'],
    ['credentials in the URL', 'https://user:secret@example.com/'],
    ['a control character', `https://example.com/${ch(0)}`],
    ['a line feed', `https://example.com/a${ch(10)}b`],
    ['a space', 'https://example.com/a b'],
    ['a bidi override', `https://example.com/${ch(0x202e)}x`],
    ['no host', 'https://'],
    ['2,049 characters', `https://example.com/${'a'.repeat(2049 - 20)}`],
  ])('refuses %s as a destination, naming the href', (_name, href) => {
    for (const [type, props] of [
      ['button', button(href)],
      ['image-button', { mediaKey: IMAGE, href }],
      ['swipe-up', swipeUp(href)],
    ] as const) {
      expect(refused(doc([element(1, type, props)])).pointer).toBe('/elements/0/props/href');
    }
  });

  it('accepts a destination of exactly 2,048 characters', () => {
    const href = `https://example.com/${'a'.repeat(2048 - 20)}`;
    expect(href).toHaveLength(2048);
    expect(() => checkTaleDocument(doc([element(1, 'button', button(href))]))).not.toThrow();
  });

  it('says why a destination is refused', () => {
    const err = refused(doc([element(1, 'button', button('ftp://example.com'))]));
    expect(err.message).toBe(
      '/elements/0/props/href is refused: Only web addresses starting with http:// or https:// can be linked.',
    );
  });

  it.each([
    ['an empty label', button(undefined, { label: '' }), '/elements/0/props/label'],
    ['a blank label', button(undefined, { label: '   ' }), '/elements/0/props/label'],
    ['a label with a line feed', button(undefined, { label: `a${ch(10)}b` }), '/elements/0/props/label'],
    ['a label over 80 characters', button(undefined, { label: 'x'.repeat(81) }), '/elements/0/props/label'],
    ['an unknown style', button(undefined, { variant: 'ghost' }), '/elements/0/props/variant'],
    ['CSS in a colour', button(undefined, { fill: '#fff;x:url(y)' }), '/elements/0/props/fill'],
    ['an onclick prop', button(undefined, { onclick: 'alert(1)' }), '/elements/0/props/onclick'],
    ['a target prop', button(undefined, { target: '_top' }), '/elements/0/props/target'],
  ])('refuses a button with %s', (_name, props, pointer) => {
    expect(refused(doc([element(1, 'button', props)])).pointer).toBe(pointer);
  });

  it('refuses an image button showing a video or a URL', () => {
    const video = { mediaKey: 'media/0b7c9d4e-1111-4222-8333-944455556666.mp4' };
    expect(refused(doc([element(1, 'image-button', video)])).pointer).toBe('/elements/0/props/mediaKey');
    const url = { mediaKey: 'https://cdn.example/a.png' };
    expect(refused(doc([element(1, 'image-button', url)])).pointer).toBe('/elements/0/props/mediaKey');
  });

  it('refuses a second swipe-up link, hidden or not', () => {
    const value = doc([element(1, 'swipe-up', swipeUp()), element(2, 'swipe-up', swipeUp(), { hidden: true })]);
    const err = refused(value);
    expect(err.pointer).toBe('/elements/1/type');
    expect(err.message).toContain('a tale holds at most 1');
  });

  it('refuses a swipe-up link moved from the bottom safe area', () => {
    const moved = element(1, 'swipe-up', swipeUp(), { box: { ...SWIPE_BOX, y: 0.4 } });
    expect(refused(doc([moved])).pointer).toBe('/elements/0/box');
  });

  it('lets a draft hold links without destinations, and refuses to publish a visible one, by name', () => {
    const value = doc([element(1, 'button', button(undefined), { hidden: true }), element(2, 'swipe-up', swipeUp())]);
    expect(checkTaleDocument(value)).toEqual(value);
    const err = refused(value, checkPublishableDocument);
    expect(err).toBeInstanceOf(LinkUrlRequiredError);
    expect(err.pointer).toBe('/elements/1/props/href');
    expect(err.message).toBe('"See more" needs a web address before the tale can be updated.');
    expect(draftProblem(err, value)).toBe(err.message);
    expect(deliverableTaleDocument(value)).toBeNull();
  });

  it('refuses to publish an image button without alt text, even marked decorative', () => {
    const value = doc([
      element(1, 'image-button', { mediaKey: IMAGE, href: 'https://example.com' }, { a11y: { decorative: true } }),
    ]);
    const err = refused(value, checkPublishableDocument);
    expect(err).toBeInstanceOf(AltTextRequiredError);
    expect(err.message).toBe('"Image button 1" needs alt text before the tale can be updated.');
  });

  it('names links in a draft problem as Tale Studio does', () => {
    const value = doc([element(1, 'button', button()), element(2, 'image-button', { mediaKey: IMAGE })]);
    const problem = (i: number) => draftProblem(new InvalidTaleDocumentError(`/elements/${i}/props/href`, 'x'), value);
    expect(problem(0)).toBe('"Shop now" has a setting that is not valid.');
    expect(problem(1)).toBe('"Image button 1" has a setting that is not valid.');
  });

  it('stores labels in NFC', () => {
    const decomposed = 'Cafe' + ch(0x301);
    const saved = checkTaleDocument(doc([element(1, 'button', button(undefined, { label: decomposed }))]));
    expect((saved.elements[0].props as { label: string }).label).toBe('Caf' + ch(0xe9));
  });

  it('delivers links with their destination and without the editor-only fields', () => {
    const value = doc([
      element(1, 'button', button('https://example.com', { newTab: true }), { locked: true }),
      element(2, 'swipe-up', swipeUp('https://example.com/more')),
    ]);
    const delivered = deliverableTaleDocument(value);
    expect(delivered?.elements.map((e) => e.type)).toEqual(['button', 'swipe-up']);
    expect(delivered?.elements[0]).not.toHaveProperty('locked');
    expect(delivered?.elements[0].props).toMatchObject({ href: 'https://example.com', newTab: true });
  });
});

describe('image buttons are media of the project (story 7.7)', () => {
  const NONE = { publishedDocument: null, publishedRevision: 0 };

  it("saves an image button of the tale's project and records its media", async () => {
    const value = doc([element(1, 'image-button', { mediaKey: IMAGE })]);
    const { db, query } = fakeDb([
      { rows: [{ projectId }] },
      { rows: [] },
      { rows: [{ key: IMAGE }] },
      { rows: [{ document: value, revision: 1, ...NONE }] },
    ]);
    expect((await saveTaleDocument(db, taleId, value, 0)).revision).toBe(1);
    const insert = query.mock.calls.find((c) => /^INSERT INTO tale_media/.test(c[0] as string));
    expect(insert?.[1]).toEqual([taleId, 'draft', [IMAGE], ['image/jpeg'], [false]]);
  });

  it('refuses an image button key of another project', async () => {
    const value = doc([element(1, 'image-button', { mediaKey: IMAGE })]);
    const { db } = fakeDb([{ rows: [{ projectId }] }, { rows: [] }, { rows: [] }]);
    await expect(saveTaleDocument(db, taleId, value, 0)).rejects.toMatchObject({
      pointer: '/elements/0/props/mediaKey',
    });
  });
});
