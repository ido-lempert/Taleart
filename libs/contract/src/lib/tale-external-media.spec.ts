import Ajv2020 from 'ajv/dist/2020';
import {
  documentMediaRefs,
  externalMediaRefs,
  externalMediaUrlProblem,
  resolveDocumentMedia,
  TALE_ELEMENT_TYPE_REGISTRY,
} from '../index';

const URL_OK = 'https://images.example.com/sunny-field.jpg';

describe('external media addresses', () => {
  it('accept https addresses and name what is wrong with the rest', () => {
    expect(externalMediaUrlProblem(URL_OK)).toBeNull();
    expect(externalMediaUrlProblem('http://images.example.com/a.jpg')).toBe('scheme');
    expect(externalMediaUrlProblem('javascript:alert(1)')).toBe('scheme');
    expect(externalMediaUrlProblem('https://user:pass@images.example.com/a.jpg')).toBe('credentials');
    expect(externalMediaUrlProblem(`https://images.example.com/${'a'.repeat(2100)}`)).toBe('tooLong');
    expect(externalMediaUrlProblem('')).toBe('empty');
    expect(externalMediaUrlProblem(42)).toBe('empty');
  });
});

describe('a document with an external address', () => {
  const doc = {
    canvas: { background: { type: 'color', color: '#fff' } },
    elements: [
      { id: 'a', type: 'image', props: { externalUrl: URL_OK, fit: 'cover' } },
      { id: 'b', type: 'image', props: { mediaKey: 'media/0b7c9d4e-1111-4222-8333-944455556666.png', fit: 'cover' } },
      { id: 'c', type: 'video', props: { externalUrl: 'https://videos.example.com/clip.mp4', fit: 'contain', taleMedia: true } },
    ],
  };

  it('is not a project media reference, and its address is listed with where it is', () => {
    expect(documentMediaRefs(doc).map((r) => r.pointer)).toEqual(['/elements/1/props/mediaKey']);
    expect(externalMediaRefs(doc)).toEqual([
      { url: URL_OK, pointer: '/elements/0/props/externalUrl', taleMedia: false },
      { url: 'https://videos.example.com/clip.mp4', pointer: '/elements/2/props/externalUrl', taleMedia: true },
    ]);
  });

  it('delivers its address as the element url, and leaves a key the resolver refuses out', () => {
    const delivered = resolveDocumentMedia(doc, () => null) as unknown as {
      elements: Array<{ id: string; props: Record<string, unknown> }>;
    };
    expect(delivered.elements.map((e) => e.id)).toEqual(['a', 'c']);
    expect(delivered.elements[0]!.props).toEqual({ url: URL_OK, fit: 'cover' });
    expect(delivered.elements[0]!.props['externalUrl']).toBeUndefined();
  });
});

describe('the image and video schemas', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validatorFor = (key: string) => {
    const schema = TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === key)?.schema;
    return ajv.compile(schema as object);
  };

  it.each(['image', 'video'])('take one of mediaKey or externalUrl, an https address, for %s', (key) => {
    const valid = validatorFor(key);
    const base = { fit: 'cover' };
    const mediaKey = key === 'image' ? 'media/0b7c9d4e-1111-4222-8333-944455556666.png' : 'media/0b7c9d4e-1111-4222-8333-944455556666.mp4';
    expect(valid({ ...base, externalUrl: URL_OK })).toBe(true);
    expect(valid({ ...base, mediaKey })).toBe(true);
    expect(valid({ ...base })).toBe(false);
    expect(valid({ ...base, mediaKey, externalUrl: URL_OK })).toBe(false);
    expect(valid({ ...base, externalUrl: 'http://images.example.com/a.jpg' })).toBe(false);
    expect(valid({ ...base, externalUrl: 'https://images.example.com/a b.jpg' })).toBe(false);
  });
});
