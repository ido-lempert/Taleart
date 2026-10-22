import type { TaleDocument, TaleElement } from '@taleart/contract/tale-document';
import { MEDIA_CONTRAST_STRIPS } from '@taleart/contract/text-style';
import {
  BackdropReads,
  canvasColor,
  FRAME_CACHE_SIZE,
  FRAME_TIMEOUT_MS,
  fitRect,
  labelSamplePoints,
  loadFrame,
  MAX_SAMPLES,
  mediaLook,
  SAMPLE_CANVAS,
  SAMPLE_CONCURRENCY,
  SAMPLE_RETRY_DELAYS_MS,
  stripColors,
  TaleBackdropSampler,
  type BackdropResults,
  type Frame,
} from './tale-backdrop';

// Tale Studio story 7.10 review: the geometry, cache, reads and loading behind the contrast check.
const box = (x: number, y: number, w: number, h: number, rotation = 0) => ({ x, y, w, h, rotation });
let n = 0;
const element = (type: string, b: TaleElement['box'], props: Record<string, unknown>): TaleElement =>
  ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    type,
    box: b,
    hidden: false,
    locked: false,
    a11y: { label: 'x' },
    props,
  }) as TaleElement;
const doc = (elements: TaleElement[]): TaleDocument => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements,
});
const photo = (b = box(0, 0, 1, 1)) => element('image', b, { mediaKey: 'media/a.jpg', fit: 'cover' });

describe('sampling geometry', () => {
  it('fits a picture with cover or contain, centred', () => {
    const rect = { x: 0, y: 0, w: 180, h: 320 };
    // A square picture: contain fits its width and centres it; cover fills the height and crops the sides.
    expect(fitRect(100, 100, rect, 'contain')).toEqual({ x: 0, y: 70, w: 180, h: 180 });
    expect(fitRect(100, 100, rect, 'cover')).toEqual({ x: -70, y: 0, w: 320, h: 320 });
    // A box centred on the origin, as the painter draws a placed element.
    expect(fitRect(200, 100, { x: -50, y: -50, w: 100, h: 100 }, 'contain')).toEqual({ x: -50, y: -25, w: 100, h: 50 });
  });

  it('draws media as the SDK does: radius and opacity in range, none on a sticker, an opaque image button', () => {
    expect(mediaLook({ type: 'image', props: { fit: 'contain', radius: 0.1, opacity: 0.5 } })).toEqual({
      fit: 'contain',
      radius: 0.1,
      opacity: 0.5,
    });
    // Out of range or not numbers: the SDK's defaults.
    expect(mediaLook({ type: 'video', props: { radius: 0.9, opacity: 2 } })).toEqual({ fit: 'cover', radius: 0, opacity: 1 });
    expect(mediaLook({ type: 'image', props: { radius: -1, opacity: Number.NaN } })).toEqual({
      fit: 'cover',
      radius: 0,
      opacity: 1,
    });
    expect(mediaLook({ type: 'sticker', props: { radius: 0.2, opacity: 0.4 } })).toEqual({
      fit: 'contain',
      radius: 0,
      opacity: 0.4,
    });
    expect(mediaLook({ type: 'image-button', props: { radius: 0.2, opacity: 0.4 } })).toEqual({
      fit: 'contain',
      radius: 0.2,
      opacity: 1,
    });
  });

  it('reads a label in strips of its box, top first, with at most MAX_SAMPLES points', () => {
    expect(SAMPLE_CANVAS).toEqual({ width: 180, height: 320 });
    const strips = labelSamplePoints(box(0.1, 0.4, 0.8, 0.1));
    expect(strips).toHaveLength(MEDIA_CONTRAST_STRIPS);
    const all = strips.flat();
    expect(all.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(all.length).toBeGreaterThan(MAX_SAMPLES / 2);
    // Inside the box: x from 18 to 162, y from 128 to 160.
    expect(all.every(([x, y]) => x >= 18 && x < 162 && y >= 128 && y < 160)).toBe(true);
    // Each strip lies below the one before it.
    const ys = strips.map((s) => s.map(([, y]) => y));
    for (let i = 1; i < ys.length; i++) expect(Math.min(...ys[i])).toBeGreaterThanOrEqual(Math.max(...ys[i - 1]));
  });

  it('reads a rotated label only inside its turned box', () => {
    // A wide label turned 90 degrees about its centre (90, 160): it stands upright, about 32 px wide
    // and 144 px tall on the sample canvas, so no point lies far left or right of the centre.
    const strips = labelSamplePoints(box(0.1, 0.45, 0.8, 0.1, 90));
    const all = strips.flat();
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(([x]) => x >= 90 - 17 && x <= 90 + 17)).toBe(true);
    expect(Math.min(...all.map(([, y]) => y))).toBeLessThan(100);
    expect(Math.max(...all.map(([, y]) => y))).toBeGreaterThan(220);
    // Its strips run along its own top-to-bottom, which now crosses the canvas from right to left.
    const firstX = strips[0].map(([x]) => x);
    const lastX = strips[MEDIA_CONTRAST_STRIPS - 1].map(([x]) => x);
    expect(Math.min(...firstX)).toBeGreaterThan(Math.max(...lastX));
  });

  it('leaves out points off the canvas, and gives nothing for a label wholly off it', () => {
    const half = labelSamplePoints(box(-0.4, 0.4, 0.8, 0.1)).flat();
    expect(half.length).toBeGreaterThan(0);
    expect(half.every(([x]) => x >= 0 && x < 72)).toBe(true);
    expect(labelSamplePoints(box(1.1, 0.4, 0.5, 0.1)).flat()).toEqual([]);
  });

  it('turns pixel data into colours, strip by strip', () => {
    const data = new Uint8ClampedArray(4 * 2 * 4);
    data.set([255, 0, 128, 255], 0);
    data.set([1, 2, 3, 255], 4 * 5);
    expect(stripColors(data, 4, [[[0, 0]], [[1, 1], [0, 1]]])).toEqual([['#ff0080'], ['#010203', '#000000']]);
    expect(canvasColor('#ff000080')).toBe('rgba(255, 0, 0, 0.5019607843137255)');
  });
});

// A stand-in 2D context: it records nothing and answers getImageData with one colour, or throws as
// a canvas tainted by another origin's picture does.
function fakeContext(fill: [number, number, number] | 'tainted') {
  const noop = () => undefined;
  return {
    fillRect: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    rect: noop,
    roundRect: noop,
    ellipse: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    drawImage: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    getImageData: () => {
      if (fill === 'tainted') throw new DOMException('The canvas has been tainted', 'SecurityError');
      const data = new Uint8ClampedArray(180 * 320 * 4);
      for (let i = 0; i < data.length; i += 4) data.set([...fill, 255], i);
      return { data };
    },
  };
}

class TestSampler extends TaleBackdropSampler {
  ctx: ReturnType<typeof fakeContext> = fakeContext([255, 255, 255]);
  loads: string[] = [];
  frames = new Map<string, Frame | null>();
  protected override context() {
    return this.ctx as unknown as OffscreenCanvasRenderingContext2D;
  }
  protected override load(url: string): Promise<Frame | null> {
    this.loads.push(url);
    return Promise.resolve(this.frames.has(url) ? (this.frames.get(url) ?? null) : bitmap());
  }
}
const bitmap = () => ({ width: 100, height: 100, close: vi.fn() }) as unknown as Frame;

describe('TaleBackdropSampler', () => {
  const tale = (key = 'media/a.jpg') =>
    doc([element('image', box(0, 0, 1, 1), { mediaKey: key, fit: 'cover' }), element('text', box(0.1, 0.4, 0.8, 0.1), {})]);

  it('reads the colours behind a label in strips', async () => {
    const sampler = new TestSampler();
    const strips = await sampler.sample(tale(), 1, (k) => `/m/${k}`);
    expect(strips).toHaveLength(MEDIA_CONTRAST_STRIPS);
    expect(strips?.flat().every((c) => c === '#ffffff')).toBe(true);
    expect(sampler.ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("gives null, never throwing, for a canvas another origin's picture tainted", async () => {
    const sampler = new TestSampler();
    sampler.ctx = fakeContext('tainted');
    await expect(sampler.sample(tale(), 1, (k) => k)).resolves.toBeNull();
  });

  it('gives null when a picture does not load, and tries it again next time', async () => {
    const sampler = new TestSampler();
    sampler.frames.set('media/a.jpg', null);
    await expect(sampler.sample(tale(), 1, (k) => k)).resolves.toBeNull();
    sampler.frames.delete('media/a.jpg');
    await expect(sampler.sample(tale(), 1, (k) => k)).resolves.not.toBeNull();
    expect(sampler.loads).toEqual(['media/a.jpg', 'media/a.jpg']);
  });

  it('does not read a label wholly off the canvas', async () => {
    const sampler = new TestSampler();
    const off = doc([photo(), element('text', box(1.2, 0.4, 0.3, 0.1), {})]);
    await expect(sampler.sample(off, 1, (k) => k)).resolves.toBeNull();
    expect(sampler.loads).toEqual([]);
  });

  it('keeps at most FRAME_CACHE_SIZE frames, closing the least recently used', async () => {
    const sampler = new TestSampler();
    const made: Frame[] = [];
    for (let i = 0; i <= FRAME_CACHE_SIZE; i++) {
      const frame = bitmap();
      made.push(frame);
      sampler.frames.set(`k${i}`, frame);
      await sampler.sample(tale(`k${i}`), 1, (k) => k);
    }
    expect(made[0].close).toHaveBeenCalledTimes(1);
    expect(made[1].close).not.toHaveBeenCalled();
    // A kept frame is not loaded again.
    await sampler.sample(tale('k5'), 1, (k) => k);
    expect(sampler.loads.filter((u) => u === 'k5')).toHaveLength(1);
  });

  it('loads one frame however many reads ask for it at once', async () => {
    const sampler = new TestSampler();
    await Promise.all([sampler.sample(tale(), 1, (k) => k), sampler.sample(tale(), 1, (k) => k)]);
    expect(sampler.loads).toEqual(['media/a.jpg']);
  });
});

describe('loadFrame', () => {
  const realBitmap = globalThis.createImageBitmap;
  let made: object[];
  beforeEach(() => {
    vi.useFakeTimers();
    made = [];
    globalThis.createImageBitmap = vi.fn((source: object) => {
      made.push(source);
      return Promise.resolve(bitmap());
    }) as unknown as typeof createImageBitmap;
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.createImageBitmap = realBitmap;
    vi.restoreAllMocks();
  });

  function created<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K][] {
    const nodes: HTMLElementTagNameMap[K][] = [];
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((name: string) => {
      const node = real(name);
      if (name === tag) nodes.push(node as HTMLElementTagNameMap[K]);
      return node;
    });
    return nodes;
  }

  it("draws a video's first frame, loading only metadata, then lets go of the video", async () => {
    const videos = created('video');
    const pending = loadFrame('/m/clip.webm', 'video');
    const video = videos[0];
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    const load = vi.spyOn(video, 'load').mockImplementation(() => undefined);
    Object.defineProperty(video, 'videoWidth', { value: 320 });
    Object.defineProperty(video, 'videoHeight', { value: 568 });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBeCloseTo(0.001);
    video.dispatchEvent(new Event('seeked'));
    await expect(pending).resolves.not.toBeNull();
    expect(made).toEqual([video]);
    expect(video.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it('gives up after the timeout and stops loading', async () => {
    const pending = loadFrame('/m/slow.jpg', 'image');
    let result: unknown = 'waiting';
    void pending.then((frame) => (result = frame));
    await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS - 1);
    expect(result).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });

  it('gives null for a picture with no size, such as an SVG without width and height', async () => {
    const real = globalThis.Image;
    let image: HTMLImageElement | null = null;
    globalThis.Image = class extends real {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        image = this;
      }
    } as typeof Image;
    try {
      const pending = loadFrame('/m/icon.svg', 'image');
      (image as unknown as HTMLImageElement).dispatchEvent(new Event('load'));
      await expect(pending).resolves.toBeNull();
      expect(made).toEqual([]);
      expect((image as unknown as HTMLImageElement).hasAttribute('src')).toBe(false);
    } finally {
      globalThis.Image = real;
    }
  });

  it('asks for media of another origin with CORS', () => {
    const videos = created('video');
    void loadFrame('https://cdn.example/clip.webm', 'video');
    expect(videos[0].crossOrigin).toBe('anonymous');
    void loadFrame('/m/clip.webm', 'video');
    expect(videos[1].crossOrigin).toBeNull();
  });
});

describe('BackdropReads', () => {
  const strips = [['#ffffff']];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const published: BackdropResults[] = [];
    const calls: string[] = [];
    const answers = new Map<string, ((v: string[][] | null) => void)[]>();
    const reads = new BackdropReads(
      (d, index) =>
        new Promise((resolve) => {
          const key = `k${index}`;
          calls.push(key);
          answers.set(key, [...(answers.get(key) ?? []), resolve]);
        }),
      (results) => published.push(results),
    );
    const answer = async (key: string, value: string[][] | null) => {
      answers.get(key)?.shift()?.(value);
      await vi.advanceTimersByTimeAsync(0);
    };
    return { reads, published, calls, answer };
  }
  const want = (...indexes: number[]) => indexes.map((index) => ({ key: `k${index}`, index }));
  const d = doc([]);

  it(`reads at most ${SAMPLE_CONCURRENCY} at once, publishing each result as it arrives`, async () => {
    const { reads, published, calls, answer } = setup();
    reads.update(d, want(1, 2, 3, 4, 5));
    expect(calls).toEqual(['k1', 'k2', 'k3']);
    await answer('k2', strips);
    expect(reads.results.get('k2')).toEqual(strips);
    expect(published).toHaveLength(1);
    expect(calls).toEqual(['k1', 'k2', 'k3', 'k4']);
  });

  it('reads each key once, however often a pass asks for it (rapid edits)', async () => {
    const { reads, calls, answer } = setup();
    for (let i = 0; i < 10; i++) reads.update(d, want(1));
    expect(calls).toEqual(['k1']);
    await answer('k1', strips);
    reads.update(d, want(1));
    expect(calls).toEqual(['k1']);
    // A key that comes back after being dropped is read again.
    reads.update(d, want());
    expect(reads.results.has('k1')).toBe(false);
    reads.update(d, want(1));
    expect(calls).toEqual(['k1', 'k1']);
  });

  it('drops a result the document no longer needs when it arrives', async () => {
    const { reads, answer } = setup();
    reads.update(d, want(1));
    reads.update(d, want(2));
    await answer('k1', strips);
    expect(reads.results.has('k1')).toBe(false);
  });

  it('publishes a failed read as null and tries again with backoff, then stops', async () => {
    const { reads, calls, answer } = setup();
    reads.update(d, want(1));
    await answer('k1', null);
    expect(reads.results.get('k1')).toBeNull();
    // Another pass does not carry the failure into a new read before its time, nor drop it.
    reads.update(d, want(1));
    expect(calls).toEqual(['k1']);
    for (const [i, delay] of SAMPLE_RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(i + 2);
      await answer('k1', null);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    reads.update(d, want(1));
    expect(calls).toHaveLength(SAMPLE_RETRY_DELAYS_MS.length + 1);
  });

  it('keeps a retried read that succeeds', async () => {
    const { reads, answer } = setup();
    reads.update(d, want(1));
    await answer('k1', null);
    await vi.advanceTimersByTimeAsync(SAMPLE_RETRY_DELAYS_MS[0]);
    await answer('k1', strips);
    expect(reads.results.get('k1')).toEqual(strips);
  });

  it('stops on destroy: no retry fires and nothing more is published', async () => {
    const { reads, published, calls, answer } = setup();
    reads.update(d, want(1, 2));
    await answer('k1', null);
    const count = published.length;
    reads.destroy();
    await answer('k2', strips);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(published).toHaveLength(count);
    expect(calls).toEqual(['k1', 'k2']);
    reads.update(d, want(3));
    expect(calls).toEqual(['k1', 'k2']);
  });
});
