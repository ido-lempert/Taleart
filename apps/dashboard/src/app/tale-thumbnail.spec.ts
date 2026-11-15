import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { Tale } from '@taleart/contract/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { API_BASE } from './dashboard.store';
import { projectMediaSrc } from './project-media.service';
import { backgroundColor, firstBackground, FIRST_FRAME, TaleThumbnails } from './tale-thumbnail';

const imageBackground = (key = 'media/beach.png') => ({ type: 'media', mediaKey: key, fit: 'cover', color: '#000000' });

function doc(background: object): TaleDocument {
  return { version: 1, canvas: { background }, elements: [] } as unknown as TaleDocument;
}

function tale(id: string): Tale {
  return { id, projectId: 'p1', title: id, taleGroupId: 'g1' } as unknown as Tale;
}

describe('firstBackground', () => {
  it('is the picture of a media background', () => {
    expect(firstBackground(doc(imageBackground('media/beach.png')))).toEqual({ key: 'media/beach.png', kind: 'image' });
    expect(firstBackground(doc(imageBackground('tales/a.gif')))).toEqual({ key: 'tales/a.gif', kind: 'image' });
  });

  it('is a video background, for its first frame', () => {
    expect(firstBackground(doc(imageBackground('media/clip.mp4')))).toEqual({ key: 'media/clip.mp4', kind: 'video' });
  });

  it('is null for a colour background, a key that is not a media key, or no document', () => {
    expect(firstBackground(doc({ type: 'color', color: '#112233' }))).toBeNull();
    expect(firstBackground(doc(imageBackground('../secret.png')))).toBeNull();
    expect(firstBackground(null)).toBeNull();
  });
});

describe('backgroundColor', () => {
  it('is the colour of a colour background, and null otherwise', () => {
    expect(backgroundColor(doc({ type: 'color', color: '#112233' }))).toBe('#112233');
    expect(backgroundColor(doc({ type: 'color', color: '#11223380' }))).toBe('#11223380');
    expect(backgroundColor(doc({ type: 'color', color: 'red' }))).toBeNull();
    expect(backgroundColor(doc(imageBackground()))).toBeNull();
  });
});

describe('TaleThumbnails', () => {
  let http: HttpTestingController;
  let frames: ReturnType<typeof vi.fn<(src: string) => Promise<string>>>;
  let thumbnails: TaleThumbnails;

  beforeEach(() => {
    frames = vi.fn<(src: string) => Promise<string>>(async () => 'blob:frame');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: FIRST_FRAME, useValue: frames }],
    });
    http = TestBed.inject(HttpTestingController);
    thumbnails = TestBed.inject(TaleThumbnails);
  });

  afterEach(() => http.verify());

  // Lets the pending reads start: a group reads its tales one after another.
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  // Answers the tale's document read: `draft` (or null), with the published document `published`.
  function answerDocument(taleId: string, draft: TaleDocument | null, published: TaleDocument | null = null): void {
    http.expectOne(`${API_BASE}/tales/${taleId}/document`).flush({
      document: draft,
      revision: draft ? 1 : 0,
      published: { document: published, revision: published ? 1 : 0 },
    });
  }

  it("shows a tale's image background as its picture", async () => {
    const pending = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc(imageBackground('media/beach.png')));
    await expect(pending).resolves.toEqual({ kind: 'image', src: projectMediaSrc('p1', 'media/beach.png') });
    expect(frames).not.toHaveBeenCalled();
  });

  it("shows a video background's first frame, drawn once per file", async () => {
    const first = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc(imageBackground('media/clip.mp4')));
    await expect(first).resolves.toEqual({ kind: 'image', src: 'blob:frame' });

    // Another tale with the same background reads its document, but the frame is not drawn again.
    const second = thumbnails.forTales([tale('t2')]);
    answerDocument('t2', doc(imageBackground('media/clip.mp4')));
    await expect(second).resolves.toEqual({ kind: 'image', src: 'blob:frame' });
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it('falls back to the canvas colour when a video frame cannot be drawn', async () => {
    frames.mockRejectedValueOnce(new Error('The video could not be read.'));
    const pending = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc(imageBackground('media/clip.mp4')));
    // A media background has no canvas colour of its own, so there is nothing to show.
    await expect(pending).resolves.toEqual({ kind: 'color', color: null });
  });

  it('shows the canvas colour of a tale with no media background', async () => {
    const pending = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc({ type: 'color', color: '#112233' }));
    await expect(pending).resolves.toEqual({ kind: 'color', color: '#112233' });
  });

  it('reads the published document when the tale has no draft', async () => {
    const pending = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', null, doc({ type: 'color', color: '#445566' }));
    await expect(pending).resolves.toEqual({ kind: 'color', color: '#445566' });
  });

  it('gives a group the first tale with a media background, else the first tale colour', async () => {
    const pending = thumbnails.forTales([tale('t1'), tale('t2')]);
    await tick();
    answerDocument('t1', doc({ type: 'color', color: '#111111' }));
    await tick();
    answerDocument('t2', doc(imageBackground('media/beach.png')));
    await expect(pending).resolves.toEqual({ kind: 'image', src: projectMediaSrc('p1', 'media/beach.png') });
  });

  it("gives a group with no media the first tale's colour", async () => {
    const pending = thumbnails.forTales([tale('t1'), tale('t2')]);
    await tick();
    answerDocument('t1', doc({ type: 'color', color: '#111111' }));
    await tick();
    answerDocument('t2', doc({ type: 'color', color: '#222222' }));
    await expect(pending).resolves.toEqual({ kind: 'color', color: '#111111' });
  });

  it('shows no colour for a group without tales', async () => {
    await expect(thumbnails.forTales([])).resolves.toEqual({ kind: 'color', color: null });
  });

  it('keeps a tale thumbnail, so a list does not read the document again', async () => {
    const pending = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc({ type: 'color', color: '#112233' }));
    await pending;
    await expect(thumbnails.forTales([tale('t1')])).resolves.toEqual({ kind: 'color', color: '#112233' });
  });

  it('reads the document again after it is forgotten', async () => {
    const first = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc({ type: 'color', color: '#112233' }));
    await first;

    thumbnails.forget('t1');
    const again = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc({ type: 'color', color: '#334455' }));
    await expect(again).resolves.toEqual({ kind: 'color', color: '#334455' });
  });

  it('does not keep a failed read: the next call asks again', async () => {
    const failed = thumbnails.forTales([tale('t1')]);
    http.expectOne(`${API_BASE}/tales/t1/document`).flush({}, { status: 500, statusText: 'Server Error' });
    await expect(failed).resolves.toEqual({ kind: 'color', color: null });

    const retry = thumbnails.forTales([tale('t1')]);
    answerDocument('t1', doc({ type: 'color', color: '#778899' }));
    await expect(retry).resolves.toEqual({ kind: 'color', color: '#778899' });
  });
});
