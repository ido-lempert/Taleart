import {
  coverSettled,
  coversInView,
  HOLD_MAX_MS,
  holdMedia,
  loadFirstContent,
  mark,
  prioritize,
  releaseMedia,
  replaceCover,
  setCanvasSource,
  setSource,
  STILL_VIDEO_MAX_MS,
} from './first-content';

const URL_A = 'https://api.example.com/media/covers/a.jpg';

// Gives an element a box, as layout would.
function place(el: Element, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
}

function img(url = URL_A): HTMLImageElement {
  const el = document.createElement('img');
  el.className = 'cover';
  el.src = url;
  return el;
}

// Lets pending promise callbacks run.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('first content', () => {
  beforeEach(() => {
    performance.clearMarks();
    vi.stubGlobal('innerWidth', 412);
    vi.stubGlobal('innerHeight', 823);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sets a User Timing mark, and does nothing where marking throws', () => {
    mark('taleart:test');
    expect(performance.getEntriesByName('taleart:test')).toHaveLength(1);
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('no User Timing');
    });
    expect(() => mark('taleart:test')).not.toThrow();
  });

  it('finds the covers in view: inside the frame and the window, with a size', () => {
    const frame = document.createElement('ul');
    place(frame, 0, 100, 412, 340);
    const covers = [0, 1, 2, 3, 4, 5, 6].map(() => img());
    covers.forEach((cover, i) => place(cover, 4 + i * 88, 104, 64, 64));
    const hidden = img();
    place(hidden, 10, 104, 0, 0);
    const banner = document.createElement('img');
    banner.className = 'b-media';
    place(banner, 0, 200, 412, 232);
    const offSlide = document.createElement('img');
    offSlide.className = 'b-media';
    place(offSlide, 412, 200, 412, 232);
    frame.append(...covers, hidden, banner, offSlide);
    // Items 0-4 reach into the 412 px window; 5 and 6 start past it.
    expect(coversInView(frame)).toEqual([...covers.slice(0, 5), banner]);
  });

  it('finds no covers in a frame below the window or clipped by its scroller', () => {
    const below = document.createElement('div');
    place(below, 0, 900, 412, 94);
    const cover = img();
    place(cover, 4, 904, 64, 64);
    below.appendChild(cover);
    expect(coversInView(below)).toEqual([]);

    const scroller = document.createElement('ul');
    place(scroller, 0, 0, 200, 94);
    const past = img();
    place(past, 250, 4, 64, 64);
    scroller.appendChild(past);
    expect(coversInView(scroller)).toEqual([]);
  });

  it('settles an image once decoded, and also when decoding fails', async () => {
    const ok = img();
    ok.decode = () => Promise.resolve();
    const bad = img();
    bad.decode = () => Promise.reject(new Error('broken'));
    await expect(Promise.all([coverSettled(ok), coverSettled(bad)])).resolves.toBeDefined();
  });

  it('settles a held image only after its load or error', async () => {
    const held = holdMedia(() => {
      const el = document.createElement('img');
      setSource(el, URL_A);
      return el;
    });
    const decode = vi.fn(() => Promise.resolve());
    held.decode = decode;
    let done = false;
    void coverSettled(held).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    held.dispatchEvent(new Event('load'));
    await flush();
    expect(done).toBe(true);
    expect(decode).not.toHaveBeenCalled();
  });

  it('settles a video at its first frame or error, a canvas when drawn, a placeholder at once', async () => {
    const ready = document.createElement('video');
    Object.defineProperty(ready, 'readyState', { value: 2 });
    await coverSettled(ready);

    const waiting = document.createElement('video');
    let done = false;
    void coverSettled(waiting).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    waiting.dispatchEvent(new Event('loadeddata'));
    await flush();
    expect(done).toBe(true);

    const failing = document.createElement('video');
    const failed = coverSettled(failing);
    failing.dispatchEvent(new Event('error'));
    await failed;

    const canvas = document.createElement('canvas');
    done = false;
    void coverSettled(canvas).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    canvas.dispatchEvent(new Event('load'));
    await flush();
    expect(done).toBe(true);
    const drawn = document.createElement('canvas');
    drawn.setAttribute('data-ready', '');
    await coverSettled(drawn);

    await coverSettled(document.createElement('span'));
  });

  it('holds URLs while frames are built and sets them when released; outside a hold it sets them at once', () => {
    const [image, video] = holdMedia(() => {
      const i = document.createElement('img');
      const v = document.createElement('video');
      setSource(i, URL_A);
      setSource(v, `${URL_A}#t=0.001`);
      return [i, v];
    });
    expect(image.getAttribute('src')).toBeNull();
    expect(video.getAttribute('src')).toBeNull();
    expect(image.dataset['hold']).toBe(URL_A);
    releaseMedia([image, video, document.createElement('span')]);
    expect(image.src).toBe(URL_A);
    expect(video.src).toBe(`${URL_A}#t=0.001`);
    expect(image.dataset['hold']).toBeUndefined();

    const direct = document.createElement('img');
    setSource(direct, URL_A);
    expect(direct.src).toBe(URL_A);
  });

  it('ends the hold even when building throws', () => {
    expect(() =>
      holdMedia(() => {
        throw new Error('bad frame');
      }),
    ).toThrow('bad frame');
    const el = document.createElement('img');
    setSource(el, URL_A);
    expect(el.src).toBe(URL_A);
  });

  it('makes the first covers eager and high priority; videos keep their own loading', () => {
    const image = img();
    image.setAttribute('loading', 'lazy');
    const video = document.createElement('video');
    video.preload = 'auto';
    prioritize([image, video]);
    expect(image.getAttribute('fetchpriority')).toBe('high');
    expect(image.hasAttribute('loading')).toBe(false);
    expect(video.hasAttribute('fetchpriority')).toBe(false);
  });

  describe('loadFirstContent', () => {
    const URL_B = 'https://api.example.com/media/tales/b.jpg';
    let root: HTMLElement;

    beforeEach(() => {
      root = document.createElement('div');
      document.body.appendChild(root);
    });

    afterEach(() => document.body.replaceChildren());

    const heldImage = (url: string) =>
      holdMedia(() => {
        const el = document.createElement('img');
        setSource(el, url);
        return el;
      });

    it('loads the first covers, then the rest once they settle, and calls back at the next paint', async () => {
      const first = heldImage(URL_A);
      const rest = heldImage(URL_B);
      let decoded: () => void = () => undefined;
      first.decode = () => new Promise<void>((done) => (decoded = done));
      root.append(first, rest);
      const shown = vi.fn();

      const done = loadFirstContent(root, [first], new AbortController().signal, shown);
      expect(first.src).toBe(URL_A);
      expect(first.getAttribute('fetchpriority')).toBe('high');
      await flush();
      expect(rest.getAttribute('src')).toBeNull();
      expect(shown).not.toHaveBeenCalled();

      decoded();
      await done;
      expect(rest.src).toBe(URL_B);
      expect(shown).toHaveBeenCalledTimes(1);
    });

    it('releases only its own container, and everything at once with no covers in view', async () => {
      const own = heldImage(URL_A);
      const other = heldImage(URL_B);
      root.appendChild(own);
      document.body.appendChild(other);
      await loadFirstContent(root, [], new AbortController().signal, () => undefined);
      expect(own.src).toBe(URL_A);
      expect(other.getAttribute('src')).toBeNull();
    });

    it('does not call back for a container no longer on the page', async () => {
      const shown = vi.fn();
      const done = loadFirstContent(root, [], new AbortController().signal, shown);
      root.remove();
      await done;
      expect(shown).not.toHaveBeenCalled();
    });

    it(`releases the rest after ${HOLD_MAX_MS} ms when a first cover never settles, without calling back`, async () => {
      vi.useFakeTimers();
      const stuck = document.createElement('video');
      const rest = heldImage(URL_A);
      root.append(stuck, rest);
      const shown = vi.fn();
      void loadFirstContent(root, [stuck], new AbortController().signal, shown);
      await vi.advanceTimersByTimeAsync(HOLD_MAX_MS - 1);
      expect(rest.getAttribute('src')).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(rest.src).toBe(URL_A);
      expect(shown).not.toHaveBeenCalled();
    });

    it('stops when aborted: no release, no call back, its timer and cover listeners gone', async () => {
      vi.useFakeTimers();
      const stuck = document.createElement('video');
      const rest = heldImage(URL_A);
      root.append(stuck, rest);
      const removed = vi.spyOn(stuck, 'removeEventListener');
      const shown = vi.fn();
      const abort = new AbortController();
      const done = loadFirstContent(root, [stuck], abort.signal, shown);
      abort.abort();
      // The next paint after the abort, which calls back nothing.
      await vi.advanceTimersByTimeAsync(20);
      await done;
      expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['error', 'loadeddata']);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(HOLD_MAX_MS);
      stuck.dispatchEvent(new Event('loadeddata'));
      await vi.advanceTimersByTimeAsync(20);
      expect(rest.getAttribute('src')).toBeNull();
      expect(shown).not.toHaveBeenCalled();
    });

    it('waits on a replacement cover instead of the one it replaced', async () => {
      const old = heldImage(URL_A);
      root.appendChild(old);
      old.decode = () => new Promise<void>(() => undefined);
      const shown = vi.fn();
      const done = loadFirstContent(root, [old], new AbortController().signal, shown);
      let next: HTMLVideoElement | null = null;
      replaceCover(old, () => {
        next = document.createElement('video');
        setSource(next, URL_B);
        return next;
      });
      const video = next as unknown as HTMLVideoElement;
      // The replacement is first content: loading at once, tagged.
      expect(video.src).toBe(URL_B);
      expect(video.hasAttribute('data-first')).toBe(true);
      await flush();
      expect(shown).not.toHaveBeenCalled();
      video.dispatchEvent(new Event('loadeddata'));
      await done;
      expect(shown).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps a held cover held when it is replaced, and an unheld one unheld', () => {
    const root = document.createElement('div');
    const held = holdMedia(() => {
      const el = document.createElement('img');
      setSource(el, URL_A);
      return el;
    });
    const loaded = img();
    root.append(held, loaded);
    const make = () => {
      const el = document.createElement('img');
      setSource(el, URL_A);
      return el;
    };
    replaceCover(held, make);
    replaceCover(loaded, make);
    const [a, b] = [...root.querySelectorAll('img')];
    expect(a.getAttribute('src')).toBeNull();
    expect(a.dataset['hold']).toBe(URL_A);
    expect(b.src).toBe(URL_A);
  });

  it('settles a still video 1 s after its metadata when no frame comes, or at its first frame', async () => {
    vi.useFakeTimers();
    const still = document.createElement('video');
    still.preload = 'metadata';
    let done = false;
    void coverSettled(still).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toBe(false);
    still.dispatchEvent(new Event('loadedmetadata'));
    await vi.advanceTimersByTimeAsync(STILL_VIDEO_MAX_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    const framed = document.createElement('video');
    framed.preload = 'metadata';
    const settled = coverSettled(framed);
    framed.dispatchEvent(new Event('loadedmetadata'));
    framed.dispatchEvent(new Event('loadeddata'));
    await settled;
    expect(vi.getTimerCount()).toBe(0);

    // A moving cover has no cap: it waits for its first frame.
    const moving = document.createElement('video');
    moving.preload = 'auto';
    moving.autoplay = true;
    let movingDone = false;
    void coverSettled(moving).then(() => (movingDone = true));
    moving.dispatchEvent(new Event('loadedmetadata'));
    await vi.advanceTimersByTimeAsync(STILL_VIDEO_MAX_MS * 2);
    expect(movingDone).toBe(false);
  });

  it('holds a canvas cover image like other covers, and loads it lazily near the window', () => {
    const canvas = document.createElement('canvas');
    const image = new Image();
    holdMedia(() => setCanvasSource(canvas, image, URL_A));
    expect(image.getAttribute('src')).toBeNull();
    expect(canvas.dataset['hold']).toBe(URL_A);
    releaseMedia([canvas]);
    expect(image.src).toBe(URL_A);

    let near: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof near) {
          near = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const lazyCanvas = document.createElement('canvas');
    const lazyImage = new Image();
    setCanvasSource(lazyCanvas, lazyImage, URL_A);
    expect(lazyImage.getAttribute('src')).toBeNull();
    near([{ isIntersecting: false }]);
    expect(lazyImage.getAttribute('src')).toBeNull();
    near([{ isIntersecting: true }]);
    expect(lazyImage.src).toBe(URL_A);
    expect(disconnect).toHaveBeenCalled();
  });

  it('nests holds', () => {
    const el = document.createElement('img');
    holdMedia(() => {
      holdMedia(() => undefined);
      setSource(el, URL_A);
    });
    expect(el.getAttribute('src')).toBeNull();
  });
});
