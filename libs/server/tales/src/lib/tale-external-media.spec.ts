import { InvalidTaleDocumentError } from './tale-document';
import { checkDocumentMedia } from './tale-document';

// The external-address checks come before any database read, so they run without one.
const db = null as never;
const PROJECT = '00000000-0000-4000-8000-000000000001';

function doc(element: Record<string, unknown>) {
  return { canvas: { background: { type: 'color', color: '#fff' } }, elements: [element] };
}

describe('checkDocumentMedia with an external address', () => {
  it('accepts an https image or video address that is not the tale’s own media', async () => {
    await expect(
      checkDocumentMedia(db, PROJECT, doc({ id: 'a', type: 'image', props: { externalUrl: 'https://images.example.com/a.jpg', fit: 'cover' } })),
    ).resolves.toBeUndefined();
  });

  it('refuses an address that is not https, and names the element', async () => {
    const error = await checkDocumentMedia(
      db,
      PROJECT,
      doc({ id: 'a', type: 'video', props: { externalUrl: 'http://videos.example.com/c.mp4', fit: 'cover' } }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(InvalidTaleDocumentError);
    expect((error as InvalidTaleDocumentError).message).toContain('/elements/0/props/externalUrl');
  });

  it('refuses an external address as the tale’s own media', async () => {
    const error = await checkDocumentMedia(
      db,
      PROJECT,
      doc({ id: 'a', type: 'video', props: { externalUrl: 'https://videos.example.com/c.mp4', fit: 'cover', taleMedia: true } }),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(InvalidTaleDocumentError);
    expect((error as InvalidTaleDocumentError).message).toContain("can't be the tale's own media");
  });
});
