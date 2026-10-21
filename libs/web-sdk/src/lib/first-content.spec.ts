import {
  coverSettled,
  coversInView,
  FIRST_CONTENT_MARK,
  HOLD_MAX_MS,
  holdMedia,
  loadFirstContent,
  mark,
  prioritize,
  releaseMedia,
  setSource,
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

  it('loads the first covers, then the rest once they settle, and marks first content at the next paint', async () => {
    const root = document.createElement('div');
    const [first, rest] = holdMedia(() => {
      const a = document.createElement('img');
      const b = document.createElement('img');
      setSource(a, URL_A);
      setSource(b, 'https://api.example.com/media/tales/b.jpg');
      return [a, b];
    });
    let decoded: () => void = () => undefined;
    first.decode = () => new Promise<void>((done) => (decoded = done));
    root.append(first, rest);

    const done = loadFirstContent(root, [first], true);
    expect(first.src).toBe(URL_A);
    expect(first.getAttribute('fetchpriority')).toBe('high');
    await flush();
    expect(rest.getAttribute('src')).toBeNull();
    expect(performance.getEntriesByName(FIRST_CONTENT_MARK)).toHaveLength(0);

    decoded();
    await done;
    expect(rest.src).toBe('https://api.example.com/media/tales/b.jpg');
    expect(performance.getEntriesByName(FIRST_CONTENT_MARK)).toHaveLength(1);
  });

  it('marks nothing when asked not to, and releases everything at once with no covers in view', async () => {
    const root = document.createElement('div');
    const held = holdMedia(() => {
      const el = document.createElement('img');
      setSource(el, URL_A);
      return el;
    });
    root.appendChild(held);
    await loadFirstContent(root, [], false);
    expect(held.src).toBe(URL_A);
    expect(performance.getEntriesByName(FIRST_CONTENT_MARK)).toHaveLength(0);
  });

  it(`releases the rest after ${HOLD_MAX_MS} ms when a first cover never settles, without marking`, async () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const stuck = document.createElement('video');
    const rest = holdMedia(() => {
      const el = document.createElement('img');
      setSource(el, URL_A);
      return el;
    });
    root.append(stuck, rest);
    void loadFirstContent(root, [stuck], true);
    await vi.advanceTimersByTimeAsync(HOLD_MAX_MS - 1);
    expect(rest.getAttribute('src')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(rest.src).toBe(URL_A);
    expect(performance.getEntriesByName(FIRST_CONTENT_MARK)).toHaveLength(0);
  });
});
