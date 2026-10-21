/** Set once per element when the Delivery API's zone first arrives, before it renders. */
export const ZONE_MARK = 'taleart:zone';

/**
 * Set once the element's first frame is on the page and the covers of its
 * items in view have loaded or failed: the first zone content a visitor sees
 * (NFR-006). Its `startTime` is milliseconds since navigation start.
 */
export const FIRST_CONTENT_MARK = 'taleart:first-content';

/** How long pictures out of the first content wait at most for it, in ms. */
export const HOLD_MAX_MS = 3000;

/**
 * How long a still video cover (metadata-only preload) may take, after its
 * metadata, to show its first frame before it counts as settled, in ms: a
 * browser that loads only metadata never fires `loadeddata`.
 */
export const STILL_VIDEO_MAX_MS = 1000;

// True while covers are built inside {@link holdMedia}.
let holding = false;

// The hidden image that draws each still canvas cover (an animated image under reduced motion).
const canvasImages = new WeakMap<HTMLCanvasElement, HTMLImageElement>();

// For a cover the first content waits on: what to do when it is replaced (see replaceCover).
const replacements = new WeakMap<Element, (next: Element) => void>();

/**
 * Sets a cover's URL, or, while covers are built inside {@link holdMedia},
 * keeps it in `data-hold` so nothing loads until {@link releaseMedia}.
 */
export function setSource(el: HTMLImageElement | HTMLVideoElement, url: string): void {
  if (holding) el.dataset['hold'] = url;
  else el.src = url;
}

/**
 * Sets the URL of the image that draws a canvas cover: held inside
 * {@link holdMedia}, else loaded once the canvas comes near the window.
 */
export function setCanvasSource(canvas: HTMLCanvasElement, img: HTMLImageElement, url: string): void {
  canvasImages.set(canvas, img);
  canvas.dataset['hold'] = url;
  if (!holding) releaseMedia([canvas], true);
}

/** Builds covers whose pictures do not load until released. */
export function holdMedia<T>(build: () => T): T {
  const outer = holding;
  holding = true;
  try {
    return build();
  } finally {
    holding = outer;
  }
}

// Calls `load` once `el` comes within 1250 px of the window (as browsers lazy-load images),
// or at once without IntersectionObserver.
function whenNear(el: Element, load: () => void): void {
  if (typeof IntersectionObserver !== 'function') return load();
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    },
    { rootMargin: '1250px' },
  );
  observer.observe(el);
}

/**
 * Lets held pictures load. Images and videos get their URL (an image keeps
 * `loading="lazy"` unless prioritized); a canvas cover's image loads at once,
 * or with `lazy` once the canvas comes near the window.
 */
export function releaseMedia(els: Iterable<Element>, lazy = false): void {
  for (const el of els) {
    const url = (el as HTMLElement).dataset?.['hold'];
    if (url === undefined) continue;
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) {
      delete el.dataset['hold'];
      el.src = url;
    } else if (el instanceof HTMLCanvasElement) {
      const img = canvasImages.get(el);
      if (!img) continue;
      delete el.dataset['hold'];
      if (lazy) whenNear(el, () => (img.src = url));
      else img.src = url;
    }
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
 * Resolves once a cover has its picture: an image loaded and decoded; a video
 * with its first frame (`loadeddata`), or, for a still video (metadata-only
 * preload), {@link STILL_VIDEO_MAX_MS} after its metadata; a canvas drawn
 * (`data-ready`); each also on failure; a placeholder at once. Resolves at
 * once when `signal` aborts, and removes its listeners and timers either way.
 */
export function coverSettled(el: Element, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const cleanups: (() => void)[] = [];
    const settle = () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      done();
    };
    const on = (target: EventTarget, type: string, listener: () => void = settle) => {
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    };
    const after = (ms: number) => {
      const timer = setTimeout(settle, ms);
      cleanups.push(() => clearTimeout(timer));
    };
    if (signal?.aborted) return settle();
    if (signal) on(signal, 'abort');
    const held = (el as HTMLElement).dataset?.['hold'] !== undefined;
    if (el instanceof HTMLImageElement) {
      // A held image has no URL yet, so decode() would fail at once: wait for its load instead.
      if (typeof el.decode === 'function' && !held) el.decode().then(settle, settle);
      else if (el.complete && !held) settle();
      else {
        on(el, 'load');
        on(el, 'error');
      }
    } else if (el instanceof HTMLVideoElement) {
      // HAVE_CURRENT_DATA: the first frame can show.
      if (!held && (el.readyState >= 2 || el.error)) return settle();
      on(el, 'loadeddata');
      on(el, 'error');
      if (el.preload === 'metadata' && !el.autoplay) {
        if (!held && el.readyState >= 1) after(STILL_VIDEO_MAX_MS);
        else on(el, 'loadedmetadata', () => after(STILL_VIDEO_MAX_MS));
      }
    } else if (el instanceof HTMLCanvasElement && !el.hasAttribute('data-ready')) {
      on(el, 'load');
    } else settle();
  });
}

// Resolves once the cover in `el`'s place has settled, following replacements (see replaceCover).
function slotSettled(el: Element, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const wait = (current: Element) => {
      let replaced = false;
      replacements.set(current, (next) => {
        replaced = true;
        wait(next);
      });
      void coverSettled(current, signal).then(() => {
        if (replaced) return;
        replacements.delete(current);
        done();
      });
    };
    wait(el);
  });
}

/**
 * Loads these covers first: images become eager (covers start lazy) and high
 * fetch priority, so the first content does not share the network with
 * pictures out of view. Every one is tagged `data-first`, so a replacement
 * keeps its place.
 */
export function prioritize(covers: readonly Element[]): void {
  for (const el of covers) {
    el.setAttribute('data-first', '');
    if (el instanceof HTMLImageElement) {
      el.setAttribute('fetchpriority', 'high');
      el.removeAttribute('loading');
    }
  }
}

/**
 * Replaces a cover with one `build` makes, keeping its loading state: held
 * when it was held, first content (prioritized, loaded at once) when it was;
 * the first content then waits on the new cover instead.
 */
export function replaceCover(old: HTMLElement, build: () => HTMLElement): void {
  const first = old.hasAttribute('data-first');
  const held = old.dataset['hold'] !== undefined;
  const next = first || held ? holdMedia(build) : build();
  if (first) {
    prioritize([next]);
    releaseMedia([next]);
  }
  old.replaceWith(next);
  const follow = replacements.get(old);
  replacements.delete(old);
  follow?.(next);
}

// Resolves at the next frame the browser paints (at once where there is none).
function nextPaint(): Promise<void> {
  return new Promise((done) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => done());
    else done();
  });
}

/**
 * Loads one render's first content first (NFR-006): `covers`, its first
 * frame's covers in view, load at once with high priority; every other
 * picture held under `container` (that render's own) loads once they have
 * settled, or after {@link HOLD_MAX_MS}. Then, at the next paint, calls
 * `onShown` while `container` is still on the page. Aborting `signal` (a new
 * render, or the element leaving the page) stops it: its timer and listeners
 * go, nothing more loads and `onShown` is not called. Resolves when done or
 * aborted.
 */
export function loadFirstContent(
  container: Element,
  covers: readonly Element[],
  signal: AbortSignal,
  onShown: () => void,
): Promise<void> {
  prioritize(covers);
  releaseMedia(covers);
  const settled = Promise.all(covers.map((cover) => slotSettled(cover, signal)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<void>((done) => {
    timer = setTimeout(done, HOLD_MAX_MS);
    signal.addEventListener('abort', () => done(), { once: true });
  });
  const released = Promise.race([settled, capped]).then(() => {
    clearTimeout(timer);
    if (!signal.aborted) releaseMedia(container.querySelectorAll('[data-hold]'), true);
  });
  const shown = settled.then(nextPaint).then(() => {
    if (!signal.aborted && container.isConnected) onShown();
  });
  return Promise.all([released, shown]).then(() => undefined);
}
