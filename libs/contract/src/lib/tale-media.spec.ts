import {
  DEFAULT_TALE_DURATION_MS,
  documentMediaKeys,
  documentMediaRefs,
  hasAltText,
  hasVideoElement,
  isMediaKey,
  MAX_MEDIA_RADIUS,
  MAX_TALE_DURATION_MS,
  MEDIA_FITS,
  MEDIA_KEY_PATTERN,
  mediaContentTypeOfKey,
  mediaElementName,
  MIN_TALE_DURATION_MS,
  missingAltText,
  missingAltTextMessage,
  NEW_MEDIA_BOX,
  isOutsideSafeArea,
  projectMediaFileUrl,
  resolveDocumentMedia,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_ELEMENT_TYPE_REGISTRY,
  type TaleDocument,
} from '../index';

const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const VIDEO = 'tales/0b7c9d4e-1111-4222-8333-944455556667.mp4';
const BG = 'tales/imported-0b7c9d4e-1111-4222-8333-944455556668.jpg';

const element = (type: 'image' | 'video', key: string, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  type,
  box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: {},
  props: { mediaKey: key, fit: 'cover' as const },
  ...extra,
});

function doc(elements: unknown[], background: unknown = { type: 'color', color: '#000000' }): TaleDocument {
  return { version: 1, canvas: { background }, elements } as TaleDocument;
}

describe('tale media schemas', () => {
  it('state the contract media rules', () => {
    const properties = TALE_DOCUMENT_V1_SCHEMA['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['durationMs']['minimum']).toBe(MIN_TALE_DURATION_MS);
    expect(properties['durationMs']['maximum']).toBe(MAX_TALE_DURATION_MS);
    expect(DEFAULT_TALE_DURATION_MS).toBe(7000);
    for (const key of ['image', 'video']) {
      const schema = TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === key)?.schema as Record<string, unknown>;
      const props = schema['properties'] as Record<string, Record<string, unknown>>;
      expect(props['mediaKey']['pattern']).toBe(MEDIA_KEY_PATTERN.source.replace(/\\\//g, '/'));
      expect(props['fit']['enum']).toEqual(MEDIA_FITS);
      expect(props['radius']['maximum']).toBe(MAX_MEDIA_RADIUS);
      expect(schema['additionalProperties']).toBe(false);
    }
    const defs = TALE_DOCUMENT_V1_SCHEMA['$defs'] as Record<string, Record<string, unknown>>;
    const background = (defs['MediaBackground']['properties'] as Record<string, Record<string, unknown>>)['mediaKey'];
    expect(background['pattern']).toBe(MEDIA_KEY_PATTERN.source.replace(/\\\//g, '/'));
  });

  it('places a new media box inside the safe areas', () => {
    expect(isOutsideSafeArea(NEW_MEDIA_BOX)).toBe(false);
  });
});

describe('tale media helpers', () => {
  it('accepts server-made media keys only', () => {
    expect(isMediaKey(IMAGE)).toBe(true);
    expect(isMediaKey(VIDEO)).toBe(true);
    expect(isMediaKey(BG)).toBe(true);
    for (const bad of [
      'fonts/x.woff2',
      'covers/a.png',
      '../media/a.png',
      'media/a.svg',
      'media/A.png',
      'media/a.png?x',
      'https://e.example/a.png',
      `media/${'a'.repeat(101)}.png`,
      42,
    ]) {
      expect(isMediaKey(bad)).toBe(false);
    }
  });

  it('reads the content type from the key', () => {
    expect(mediaContentTypeOfKey(IMAGE)).toBe('image/png');
    expect(mediaContentTypeOfKey(VIDEO)).toBe('video/mp4');
    expect(mediaContentTypeOfKey(BG)).toBe('image/jpeg');
    expect(mediaContentTypeOfKey('media/a.webm')).toBe('video/webm');
    expect(mediaContentTypeOfKey('fonts/a.woff2')).toBeNull();
  });

  it('lists the media a document references, with pointers and visibility', () => {
    const d = doc(
      [
        { id: 'x', type: 'text', props: { text: 'Hi' } },
        element('image', IMAGE, { hidden: true }),
        element('video', VIDEO),
        element('image', IMAGE),
      ],
      { type: 'media', mediaKey: BG, fit: 'contain', color: '#112233' },
    );
    expect(documentMediaRefs(d)).toEqual([
      { key: BG, pointer: '/canvas/background/mediaKey', kind: 'image', visible: true },
      { key: IMAGE, pointer: '/elements/1/props/mediaKey', kind: 'image', visible: false },
      { key: VIDEO, pointer: '/elements/2/props/mediaKey', kind: 'video', visible: true },
      { key: IMAGE, pointer: '/elements/3/props/mediaKey', kind: 'image', visible: true },
    ]);
    expect(documentMediaKeys(d)).toEqual([BG, IMAGE, VIDEO]);
    expect(documentMediaKeys(doc([element('image', IMAGE, { hidden: true })]), { visibleOnly: true })).toEqual([]);
    expect(documentMediaRefs(null)).toEqual([]);
    expect(documentMediaRefs({ elements: 'x' })).toEqual([]);
    expect(documentMediaRefs(doc([{ type: 'image', props: { mediaKey: 4 } }]))).toEqual([]);
    expect(hasVideoElement(d)).toBe(true);
    expect(hasVideoElement(doc([element('image', IMAGE)]))).toBe(false);
  });

  it('names media elements by alt text, or by type and place', () => {
    const elements = [
      element('image', IMAGE),
      { type: 'text', a11y: {} },
      element('image', IMAGE),
      element('video', VIDEO),
      element('image', IMAGE, { a11y: { label: '  A   red  bicycle ' } }),
      element('image', IMAGE, { a11y: { label: 'x'.repeat(50) } }),
    ];
    expect(mediaElementName(elements, 0)).toBe('Image 1');
    expect(mediaElementName(elements, 2)).toBe('Image 2');
    expect(mediaElementName(elements, 3)).toBe('Video 1');
    expect(mediaElementName(elements, 4)).toBe('A red bicycle');
    expect(mediaElementName(elements, 5)).toBe(`${'x'.repeat(40)}…`);
  });

  it('finds the first visible media element without alt text or the decorative mark', () => {
    expect(hasAltText({ a11y: { decorative: true } })).toBe(true);
    expect(hasAltText({ a11y: { label: '   ' } })).toBe(false);
    expect(missingAltText(doc([element('image', IMAGE, { a11y: { label: 'Cat' } })]))).toBeNull();
    expect(missingAltText(doc([element('image', IMAGE, { hidden: true })]))).toBeNull();
    const found = missingAltText(
      doc([element('image', IMAGE, { a11y: { decorative: true } }), element('image', IMAGE), element('video', VIDEO)]),
    );
    expect(found).toEqual({ index: 1, name: 'Image 2', type: 'image' });
    expect(missingAltTextMessage(found as NonNullable<typeof found>)).toBe(
      '"Image 2" needs alt text, or must be marked decorative, before the tale is published.',
    );
    expect(missingAltText(doc([element('video', VIDEO, { a11y: { label: '' } })]))?.name).toBe('Video 1');
  });

  it('turns keys into URLs for delivery, leaving out what is not delivered', () => {
    const d = doc(
      [{ id: 't', type: 'text', props: { text: 'Hi' } }, element('image', IMAGE), element('video', VIDEO)],
      { type: 'media', mediaKey: BG, fit: 'contain', color: '#112233' },
    );
    const delivered = resolveDocumentMedia(d, (key) => (key === VIDEO ? null : `https://api.example/media/${key}`));
    expect(delivered.canvas.background).toEqual({
      type: 'media',
      url: `https://api.example/media/${BG}`,
      fit: 'contain',
      color: '#112233',
    });
    expect(delivered.elements.map((e) => e.type)).toEqual(['text', 'image']);
    expect(delivered.elements[1].props).toEqual({ url: `https://api.example/media/${IMAGE}`, fit: 'cover' });
    expect(JSON.stringify(delivered)).not.toContain('mediaKey');
    const none = resolveDocumentMedia(d, () => null);
    expect(none.canvas.background).toEqual({ type: 'color', color: '#112233' });
    expect(none.elements.map((e) => e.type)).toEqual(['text']);
  });

  it('builds the management URL of a project media file', () => {
    expect(projectMediaFileUrl('p 1', IMAGE)).toBe(
      '/api/v1/projects/p%201/media/file?key=media%2F0b7c9d4e-1111-4222-8333-944455556666.png',
    );
  });
});
