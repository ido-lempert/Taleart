/** Set when the Delivery API's zone has arrived, before it renders. */
export const ZONE_MARK = 'taleart:zone';

/**
 * Set once the element's first frame is on the page and the covers of its
 * items in view have loaded or failed: the first zone content a visitor sees
 * (NFR-006). Its `startTime` is milliseconds since navigation start.
 */
export const FIRST_CONTENT_MARK = 'taleart:first-content';

/** How long pictures out of the first content wait at most for it, in ms. */
export const HOLD_MAX_MS = 3000;

// True while frames are built inside {@link holdMedia}.
let holding = false;

/**
 * Sets a cover's URL, or, while frames are built inside {@link holdMedia},
 * keeps it in `data-hold` so nothing loads until {@link releaseMedia}.
 */
export function setSource(el: HTMLImageElement | HTMLVideoElement, url: string): void {
  if (holding) el.dataset['hold'] = url;
  else el.src = url;
}

/** Builds frames whose cover pictures do not load until released. */
export function holdMedia<T>(build: () => T): T {
  holding = true;
  try {
    return build();
  } finally {
    holding = false;
  }
}

/** Lets held pictures load. */
export function releaseMedia(els: Iterable<Element>): void {
  for (const el of els) {
    const url = (el as HTMLElement).dataset?.['hold'];
    if (url === undefined || !(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) continue;
    delete el.dataset['hold'];
    el.src = url;
  }
}

/** Sets a User Timing mark; does nothing where the browser has none. */
export function mark(name: string): void {
  try {
    performance.mark(name);
  } catch {
    // No User Timing: nothing to mark.
  }
}

/** The cover pictures of `frame` that intersect both the frame's box and the window. */
export function coversInView(frame: Element): Element[] {
  const box = frame.getBoundingClientRect();
  const left = Math.max(0, box.left);
  const right = Math.min(innerWidth, box.right);
  const top = Math.max(0, box.top);
  const bottom = Math.min(innerHeight, box.bottom);
  return [...frame.querySelectorAll('.cover, .b-media')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > left && r.left < right && r.bottom > top && r.top < bottom;
  });
}

/**
 * Resolves once a cover has its picture: an image loaded and decoded, a video
 * with its first frame, a canvas drawn (`data-ready`), each also on failure;
 * a placeholder at once.
 */
export function coverSettled(el: Element): Promise<void> {
  return new Promise((done) => {
    const settle = () => done();
    if (el instanceof HTMLImageElement) {
      // A held image has no URL yet, so decode() would fail at once: wait for its load instead.
      if (typeof el.decode === 'function' && el.dataset['hold'] === undefined) el.decode().then(settle, settle);
      else if (el.complete && el.dataset['hold'] === undefined) settle();
      else {
        el.addEventListener('load', settle, { once: true });
        el.addEventListener('error', settle, { once: true });
      }
    } else if (el instanceof HTMLVideoElement) {
      // HAVE_CURRENT_DATA: the first frame can show.
      if (el.readyState >= 2 || el.error) settle();
      else {
        el.addEventListener('loadeddata', settle, { once: true });
        el.addEventListener('error', settle, { once: true });
      }
    } else if (el instanceof HTMLCanvasElement && !el.hasAttribute('data-ready')) {
      el.addEventListener('load', settle, { once: true });
    } else settle();
  });
}

/**
 * Loads these covers first: images become eager (covers start lazy) and high
 * fetch priority, so the first content does not share the network with
 * pictures out of view.
 */
export function prioritize(covers: readonly Element[]): void {
  for (const el of covers) {
    if (el instanceof HTMLImageElement) {
      el.setAttribute('fetchpriority', 'high');
      el.removeAttribute('loading');
    }
  }
}

// Resolves at the next frame the browser paints (at once where there is none).
function nextPaint(): Promise<void> {
  return new Promise((done) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => done());
    else done();
  });
}

/**
 * Loads the first content first (NFR-006): `covers`, the first frame's covers
 * in view, load at once with high priority; every other picture held under
 * `root` loads once they have settled, or after {@link HOLD_MAX_MS}. With
 * `markIt`, sets {@link FIRST_CONTENT_MARK} at the next paint after they
 * settle. Resolves when both are done.
 */
export function loadFirstContent(root: ParentNode, covers: readonly Element[], markIt: boolean): Promise<void> {
  prioritize(covers);
  releaseMedia(covers);
  const settled = Promise.all(covers.map(coverSettled));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<void>((done) => (timer = setTimeout(done, HOLD_MAX_MS)));
  const released = Promise.race([settled, capped]).then(() => {
    clearTimeout(timer);
    releaseMedia(root.querySelectorAll('[data-hold]'));
  });
  const marked = markIt ? settled.then(nextPaint).then(() => mark(FIRST_CONTENT_MARK)) : settled;
  return Promise.all([released, marked]).then(() => undefined);
}
