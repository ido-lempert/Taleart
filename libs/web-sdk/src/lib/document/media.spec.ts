import type { DeliveryTale, DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { IMAGE_DURATION_MS, TaleViewer, VIDEO_STALL_MS } from '../viewer';
import { renderTaleDocument } from './renderer';

const API = 'https://api.example.com';
const IMG = `${API}/media/media/a.jpg`;
const GIF = `${API}/media/media/b.gif`;
const MP4 = `${API}/media/media/c.mp4`;

function element(
  n: number,
  type: string,
  props: Record<string, unknown>,
  a11y: DeliveryTaleElement['a11y'] = { label: `Media ${n}` },
): DeliveryTaleElement {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    type,
    box: { x: 0.1, y: 0.1 * n, w: 0.5, h: 0.25, rotation: 30 },
    a11y,
    props: props as never,
  };
}

function doc(elements: DeliveryTaleElement[], extra: Partial<DeliveryTaleDocument> = {}): DeliveryTaleDocument {
  return { version: 1, canvas: { background: { type: 'color', color: '#112233' } }, elements, ...extra };
}

describe('media elements (epic Tale Studio R5, AD-16)', () => {
  afterEach(() => document.body.replaceChildren());

  it('renders an image as <img> with its alt text, fit, rounded corners, opacity and rotation', () => {
    const area = renderTaleDocument(
      doc([element(1, 'image', { url: IMG, fit: 'contain', radius: 0.05, opacity: 0.5 })]),
    );
    const img = area.querySelector('img.ta-media') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(IMG);
    expect(img.alt).toBe('Media 1');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.borderRadius).toBe('5cqh');
    expect(img.style.opacity).toBe('0.5');
    expect(img.style.transform).toBe('rotate(30deg)');
    expect(img.style.width).toBe('50%');
    expect(img.hasAttribute('style')).toBe(true);
    expect(img.hasAttribute('aria-hidden')).toBe(false);
  });

  it('hides a decorative image with empty alt text, and defaults fit, radius and opacity', () => {
    const area = renderTaleDocument(doc([element(1, 'image', { url: IMG, fit: 'stretch' }, { decorative: true })]));
    const img = area.querySelector('img') as HTMLImageElement;
    expect(img.alt).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(img.style.objectFit).toBe('cover');
    expect(img.style.borderRadius).toBe('');
    expect(img.style.opacity).toBe('');
  });

  it('renders nothing for a URL that is not http(s), or a radius or opacity out of range as the default', () => {
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AA', 'media/a.png', 7]) {
      expect(
        renderTaleDocument(doc([element(1, 'image', { url, fit: 'cover' })])).querySelector('.ta-media'),
      ).toBeNull();
      expect(
        renderTaleDocument(doc([element(1, 'video', { url, fit: 'cover' })])).querySelector('.ta-media'),
      ).toBeNull();
    }
    const img = renderTaleDocument(doc([element(1, 'image', { url: IMG, radius: 9, opacity: -1 })])).querySelector(
      'img',
    ) as HTMLImageElement;
    expect(img.style.borderRadius).toBe('');
    expect(img.style.opacity).toBe('');
  });

  it('draws a GIF once to a canvas under reduced motion, named by its alt text; a JPEG stays an image', () => {
    const area = renderTaleDocument(
      doc([element(1, 'image', { url: GIF, fit: 'cover' }), element(2, 'image', { url: IMG, fit: 'cover' })]),
      { reducedMotion: true },
    );
    const still = area.querySelector('canvas.ta-media') as HTMLCanvasElement;
    expect(still.getAttribute('role')).toBe('img');
    expect(still.getAttribute('aria-label')).toBe('Media 1');
    expect(area.querySelectorAll('img.ta-media')).toHaveLength(1);
    // Without reduced motion the GIF is an image.
    expect(
      renderTaleDocument(doc([element(1, 'image', { url: GIF, fit: 'cover' })])).querySelector('img'),
    ).not.toBeNull();
  });

  it('renders a video muted and inline, named by its alt text, without playing it by itself', () => {
    const area = renderTaleDocument(doc([element(1, 'video', { url: MP4, fit: 'cover', radius: 0.1 })]));
    const video = area.querySelector('video.ta-media') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute('aria-label')).toBe('Media 1');
    expect(video.getAttribute('src')).toBe(MP4);
    expect(video.preload).toBe('auto');
    const reduced = renderTaleDocument(doc([element(1, 'video', { url: MP4, fit: 'cover' })]), { reducedMotion: true });
    const still = reduced.querySelector('video') as HTMLVideoElement;
    expect(still.getAttribute('src')).toBe(`${MP4}#t=0.001`);
    expect(still.preload).toBe('metadata');
  });

  it('paints a media background with its fit over its band colour, hidden from assistive technology', () => {
    const area = renderTaleDocument(
      doc([], { canvas: { background: { type: 'media', url: IMG, fit: 'contain', color: '#445566' } } }),
    );
    const canvas = area.querySelector('.ta-canvas') as HTMLElement;
    const bg = canvas.firstElementChild as HTMLImageElement;
    expect(bg.className).toBe('ta-bg');
    expect(bg.getAttribute('src')).toBe(IMG);
    expect(bg.alt).toBe('');
    expect(bg.getAttribute('aria-hidden')).toBe('true');
    expect(bg.style.objectFit).toBe('contain');
    // The band colour shows even over the tale's media.
    expect(canvas.style.backgroundColor).toBe('rgb(68, 85, 102)');
    const bad = renderTaleDocument(
      doc([], { canvas: { background: { type: 'media', url: 'javascript:x', fit: 'cover', color: '#445566' } } }),
    );
    expect(bad.querySelector('.ta-bg')).toBeNull();
    const gif = renderTaleDocument(
      doc([], { canvas: { background: { type: 'media', url: GIF, fit: 'cover', color: '#445566' } } }),
      { reducedMotion: true },
    );
    expect(gif.querySelector('canvas.ta-bg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TaleViewer with a document video (epic Tale Studio R5)', () => {
  let host: HTMLElement;
  let viewer: TaleViewer;
  const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
  const position = () => `${dialog().querySelectorAll('.segment.done').length + 1}`;

  function setTime(video: HTMLVideoElement, seconds: number): void {
    Object.defineProperty(video, 'currentTime', { value: seconds, configurable: true, writable: true });
    video.dispatchEvent(new Event('timeupdate'));
  }

  function tale(id: string, document: DeliveryTaleDocument | null, media: DeliveryTale['media'] = null): DeliveryTale {
    return { id, title: `Tale ${id}`, media, document };
  }

  function open(reduced = false, tales?: DeliveryTale[]): void {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: reduced && query.includes('reduce'), media: query })),
    );
    const groups: DeliveryTaleGroup[] = [
      {
        id: 'g',
        name: 'G',
        cover: null,
        tales: tales ?? [
          tale(
            't1',
            doc([element(1, 'image', { url: IMG, fit: 'cover' }), element(2, 'video', { url: MP4, fit: 'cover' })]),
          ),
          tale('t2', doc([element(1, 'image', { url: IMG, fit: 'cover' })])),
          tale('t3', doc([], { durationMs: 5000 })),
        ],
      },
    ];
    viewer = new TaleViewer(host, groups);
    viewer.open('g');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("plays the tale for the video's length: no timer, and the tale ends when the video ends", () => {
    open();
    const video = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    // It plays on while it makes progress, past the 7 s default.
    for (let t = 1; t <= 12; t++) {
      setTime(video, t);
      vi.advanceTimersByTime(1000);
    }
    expect(position()).toBe('1');
    video.dispatchEvent(new Event('ended'));
    expect(position()).toBe('2');
  });

  it('ends the tale at 15 s, however long the video is', () => {
    open();
    const video = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { value: 40, configurable: true });
    setTime(video, 7.5);
    expect((dialog().querySelector('.fill') as HTMLElement).style.transform).toBe('scaleX(0.5)');
    setTime(video, 14.9);
    expect(position()).toBe('1');
    setTime(video, 15);
    expect(position()).toBe('2');
  });

  it('ends the tale when its video makes no progress for 5 s, but not while it is paused', () => {
    open();
    const video = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    setTime(video, 1);
    viewer.togglePause();
    vi.advanceTimersByTime(VIDEO_STALL_MS * 3);
    expect(position()).toBe('1');
    viewer.togglePause();
    vi.advanceTimersByTime(VIDEO_STALL_MS - 1);
    expect(position()).toBe('1');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('2');
  });

  it('pauses the video with the viewer and plays it again on resume', () => {
    open();
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    viewer.togglePause();
    expect(pause).toHaveBeenCalled();
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    viewer.togglePause();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('runs a tale without a video for its duration, 7 s by default; a tale without a document keeps 5 s', () => {
    open(false, [
      tale('t1', doc([element(1, 'image', { url: IMG, fit: 'cover' })])),
      tale('t2', doc([], { durationMs: 5000 })),
      tale('t3', null, { kind: 'image', contentType: 'image/png', url: IMG }),
      tale('t4', null),
    ]);
    vi.advanceTimersByTime(6999);
    expect(position()).toBe('1');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('2');
    vi.advanceTimersByTime(4999);
    expect(position()).toBe('2');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('3');
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('4');
  });

  it('falls back to the timer when the video fails', () => {
    open();
    const video = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    video.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(7000);
    expect(position()).toBe('2');
  });

  it('does not play the video under reduced motion: its first frame shows, and Play plays it', () => {
    open(true);
    const video = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(`${MP4}#t=0.001`);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    const button = dialog().querySelector('.pause') as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Play');
    button.click();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("pauses and plays a document's video beside a tale video with the viewer, never while paused", () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    open(true, [
      tale('t1', doc([element(1, 'video', { url: MP4, fit: 'cover' })]), {
        kind: 'video',
        contentType: 'video/mp4',
        url: `${API}/media/tales/t.mp4`,
      }),
    ]);
    const docVideo = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    // Reduced motion: the viewer opens paused, so neither video starts.
    expect(play.mock.contexts).not.toContain(docVideo);
    (dialog().querySelector('.pause') as HTMLButtonElement).click();
    expect(play.mock.contexts).toContain(docVideo);
    pause.mockClear();
    viewer.togglePause();
    expect(pause.mock.contexts).toContain(docVideo);
  });

  it("keeps a tale video as the clock, the document's video looping along", () => {
    open(false, [
      tale('t1', doc([element(1, 'video', { url: MP4, fit: 'cover' })]), {
        kind: 'video',
        contentType: 'video/mp4',
        url: `${API}/media/tales/t.mp4`,
      }),
      tale('t2', null),
    ]);
    const docVideo = dialog().querySelector('.ta-canvas video') as HTMLVideoElement;
    expect(docVideo.loop).toBe(true);
    docVideo.dispatchEvent(new Event('ended'));
    expect(position()).toBe('1');
    (dialog().querySelector('.stage > video.media') as HTMLVideoElement).dispatchEvent(new Event('ended'));
    expect(position()).toBe('2');
  });
});
