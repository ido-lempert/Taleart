import type { DeliveryTale, DeliveryTaleGroup } from '@taleart/contract';
import { HOLD_MIN_MS, IMAGE_DURATION_MS, TaleViewer, VIEWER_STYLES } from './viewer';

const API = 'https://api.example.com';

// A tale as a server from before R16 sent it: its media, and no document. The viewer draws it as before.
function legacy(id: string, kind: 'image' | 'video', url: string): DeliveryTale {
  const contentType = kind === 'image' ? ('image/png' as const) : ('video/mp4' as const);
  return { id, title: `Tale ${id}`, media: { kind, contentType, url }, document: null };
}

// A tale as the Delivery API sends it since R16: its media is the `taleMedia` element of its
// document (full canvas, contain, decorative, 5 s), with `media` kept for older SDKs.
function own(id: string, kind: 'image' | 'video', url: string): DeliveryTale {
  const contentType = kind === 'image' ? ('image/png' as const) : ('video/mp4' as const);
  return {
    id,
    title: `Tale ${id}`,
    media: { kind, contentType, url },
    document: {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      durationMs: 5000,
      elements: [
        {
          id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
          type: kind,
          box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
          a11y: { decorative: true },
          props: { url, fit: 'contain', taleMedia: true } as never,
        },
      ],
    },
  };
}
function image(id: string): DeliveryTale {
  return own(id, 'image', `${API}/media/tales/${id}.png`);
}
function video(id: string): DeliveryTale {
  return own(id, 'video', `${API}/media/tales/${id}.mp4`);
}

const groups: DeliveryTaleGroup[] = [
  { id: 'ga', name: 'A', tales: [image('a1')] },
  { id: 'gb', name: 'B', tales: [image('b1'), image('b2')] },
  { id: 'empty', name: 'Empty', tales: [] },
  { id: 'gc', name: 'C', tales: [image('c1'), { id: 'c2', title: '', media: null }] },
];

let host: HTMLElement;
let viewer: TaleViewer;
let shown: string[];
let closed: string[];
let playMock: ReturnType<typeof vi.fn>;
let pauseMock: ReturnType<typeof vi.fn>;

const dialog = () => host.querySelector('dialog') as HTMLDialogElement | null;
const q = <T extends Element>(selector: string) => dialog()?.querySelector<T>(selector) as T;
const mediaSrc = () => q<HTMLImageElement | HTMLVideoElement>('.media').getAttribute('src');
// Where the viewer is, read synchronously from its name and segments (the live region, filled a
// task later, says the same; see its own test).
const position = () => {
  const d = dialog();
  const segments = d?.querySelectorAll('.segment') ?? [];
  const done = d?.querySelectorAll('.segment.done').length ?? 0;
  return `${d?.getAttribute('aria-label')}, tale ${done + 1} of ${segments.length}`;
};
// A pointer click (detail 1); `click()` is a keyboard-like activation (detail 0).
const tap = (selector: string) => q(selector).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  (dialog()?.ownerDocument.activeElement ?? dialog())?.dispatchEvent(e);
  return e;
};
function pointer(type: string, x: number, y = 100, target: Element = q('.stage')): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

function setup(list: DeliveryTaleGroup[] = groups): void {
  viewer = new TaleViewer(host, list, {
    onGroupShown: (id) => shown.push(id),
    onClose: (id) => closed.push(id),
  });
}

describe('TaleViewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    shown = [];
    closed = [];
    playMock = vi.fn(() => Promise.resolve());
    pauseMock = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock);
    setup();
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('draws a tale sent without a document as before: its media named by its title, for 5 s (R16)', () => {
    setup([
      {
        id: 'l',
        name: 'L',
        tales: [legacy('l1', 'image', `${API}/media/tales/l1.png`), legacy('l2', 'video', `${API}/media/tales/l2.mp4`)],
      },
    ]);
    viewer.open('l');
    expect(q<HTMLImageElement>('.stage > img.media').alt).toBe('Tale l1');
    expect(q('.ta-area')).toBeNull();
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('L, tale 2 of 2');
    const video = q<HTMLVideoElement>('.stage > video.media');
    expect(video.getAttribute('aria-label')).toBe('Tale l2');
    expect(video.muted).toBe(false);
  });

  it('paints the placeholder colour across the stage for a tale with neither media nor a document (R16)', () => {
    const placeholder: DeliveryTale = {
      id: 'p1',
      title: 'Empty',
      media: null,
      document: {
        version: 1,
        canvas: { background: { type: 'color', color: '#1f2937' } },
        durationMs: 5000,
        placeholder: true,
        elements: [],
      },
    };
    // A stored document with nothing in it is no placeholder: its canvas paints, the stage stays black.
    const stored: DeliveryTale = {
      id: 'p2',
      title: 'Nothing yet',
      media: null,
      document: { version: 1, canvas: { background: { type: 'color', color: '#1f2937' } }, elements: [] },
    };
    setup([{ id: 'p', name: 'P', tales: [placeholder, stored] }]);
    viewer.open('p');
    expect(q<HTMLElement>('.stage').style.backgroundColor).toBe('rgb(31, 41, 55)');
    expect(q('.ta-canvas').getAttribute('aria-label')).toBe('Empty');
    viewer.next();
    expect(q<HTMLElement>('.stage').style.backgroundColor).toBe('');
    expect(q<HTMLElement>('.ta-canvas').style.backgroundColor).toBe('rgb(31, 41, 55)');
  });

  it('opens a group as a named modal dialog at its first tale, one segment per tale, focus in the dialog', () => {
    expect(viewer.open('gb')).toBe(true);
    const d = dialog();
    expect(d?.hasAttribute('open')).toBe(true);
    expect(d?.getAttribute('aria-label')).toBe('B');
    expect(document.activeElement).toBe(d);
    expect(d?.querySelectorAll('.segment')).toHaveLength(2);
    expect(mediaSrc()).toBe(`${API}/media/tales/b1.png`);
    // The tale's own media is decorative (R16); the canvas carries the tale's name, as the media's alt text did.
    expect(q<HTMLImageElement>('.media').alt).toBe('');
    expect(q('.media').getAttribute('aria-hidden')).toBe('true');
    expect(q('.ta-canvas').getAttribute('aria-label')).toBe('Tale b1');
    expect(position()).toBe('B, tale 1 of 2');
    expect(shown).toEqual(['gb']);
    for (const name of ['Pause', 'Close', 'Previous tale', 'Next tale']) {
      expect(d?.querySelector(`button[aria-label="${name}"]`)).not.toBeNull();
    }
  });

  it('opens nothing for a group without tales or an unknown group', () => {
    expect(viewer.open('empty')).toBe(false);
    expect(viewer.open('nope')).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('shows an image for the fixed duration, then the next tale', () => {
    viewer.open('gb');
    vi.advanceTimersByTime(IMAGE_DURATION_MS - 1);
    expect(position()).toBe('B, tale 1 of 2');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('B, tale 2 of 2');
    expect(q('.segment').classList.contains('done')).toBe(true);
  });

  it('steps by the tap zones and the arrow keys, across groups, skipping groups without tales', () => {
    viewer.open('ga');
    tap('.zone.next');
    expect(position()).toBe('B, tale 1 of 2');
    key('ArrowRight');
    expect(position()).toBe('B, tale 2 of 2');
    key('ArrowRight');
    expect(position()).toBe('C, tale 1 of 2');
    expect(dialog()?.getAttribute('aria-label')).toBe('C');
    key('ArrowLeft');
    expect(position()).toBe('B, tale 2 of 2');
    tap('.zone.prev');
    expect(position()).toBe('B, tale 1 of 2');
    key('ArrowLeft');
    expect(position()).toBe('A, tale 1 of 1');
    expect(shown).toEqual(['ga', 'gb', 'gb', 'gc', 'gb', 'gb', 'ga']);
  });

  it('restarts the very first tale on previous', () => {
    viewer.open('ga');
    vi.advanceTimersByTime(3000);
    key('ArrowLeft');
    expect(position()).toBe('A, tale 1 of 1');
    vi.advanceTimersByTime(IMAGE_DURATION_MS - 1);
    expect(position()).toBe('A, tale 1 of 1');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('B, tale 1 of 2');
  });

  it('closes after the last tale of the last group and reports that group', () => {
    viewer.open('gc');
    key('ArrowRight');
    // A tale sent without a document (a server before R16) shows the legacy placeholder, as before.
    expect(q('.media').getAttribute('aria-label')).toBe('Tale 2');
    expect(q('.media').getAttribute('role')).toBe('img');
    expect(q('.ta-area')).toBeNull();
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(dialog()?.hasAttribute('open')).toBe(false);
    expect(viewer.isOpen).toBe(false);
    expect(closed).toEqual(['gc']);
  });

  it('swipes left to the next group and right to the previous one, without also stepping', () => {
    viewer.open('gb');
    pointer('pointerdown', 300);
    pointer('pointerup', 200);
    tap('.zone.next'); // the click a browser fires after the gesture
    expect(position()).toBe('C, tale 1 of 2');
    pointer('pointerdown', 100);
    pointer('pointerup', 200);
    expect(position()).toBe('B, tale 1 of 2');
    // A tap after a swipe steps again.
    pointer('pointerdown', 300);
    pointer('pointerup', 300);
    tap('.zone.next');
    expect(position()).toBe('B, tale 2 of 2');
  });

  it('does nothing on a swipe right on the first group and closes on a swipe left on the last', () => {
    viewer.open('ga');
    pointer('pointerdown', 100);
    pointer('pointerup', 200);
    expect(position()).toBe('A, tale 1 of 1');
    expect(dialog()?.hasAttribute('data-paused')).toBe(false);
    viewer.close();
    viewer.open('gc');
    pointer('pointerdown', 300);
    pointer('pointerup', 100);
    expect(dialog()?.hasAttribute('open')).toBe(false);
    expect(closed).toEqual(['ga', 'gc']);
  });

  it('treats a mostly vertical drag as a tap, not a swipe', () => {
    viewer.open('gb');
    pointer('pointerdown', 300, 100);
    pointer('pointerup', 240, 300);
    expect(position()).toBe('B, tale 1 of 2');
  });

  it('pauses while held and resumes on release, without stepping', () => {
    viewer.open('gb');
    vi.advanceTimersByTime(1000);
    pointer('pointerdown', 300);
    expect(dialog()?.hasAttribute('data-paused')).toBe(true);
    vi.advanceTimersByTime(HOLD_MIN_MS + 10000);
    expect(position()).toBe('B, tale 1 of 2');
    pointer('pointerup', 300);
    tap('.zone.next');
    expect(position()).toBe('B, tale 1 of 2');
    expect(dialog()?.hasAttribute('data-paused')).toBe(false);
    vi.advanceTimersByTime(IMAGE_DURATION_MS - 1000 - 1);
    expect(position()).toBe('B, tale 1 of 2');
    vi.advanceTimersByTime(1);
    expect(position()).toBe('B, tale 2 of 2');
  });

  it('resumes after a cancelled pointer', () => {
    viewer.open('gb');
    pointer('pointerdown', 300);
    dialog()?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    expect(dialog()?.hasAttribute('data-paused')).toBe(false);
  });

  it('pauses and resumes with Space, keeping the time left, without activating the focused button', () => {
    viewer.open('gb');
    const pause = q<HTMLButtonElement>('button[aria-label="Pause"]');
    pause.focus();
    vi.advanceTimersByTime(2000);
    const down = key(' ');
    expect(down.defaultPrevented).toBe(true);
    expect(pause.getAttribute('aria-label')).toBe('Play');
    expect(dialog()?.hasAttribute('data-paused')).toBe(true);
    key(' ', { repeat: true });
    expect(pause.getAttribute('aria-label')).toBe('Play');
    vi.advanceTimersByTime(60000);
    expect(position()).toBe('B, tale 1 of 2');
    key(' ');
    expect(pause.getAttribute('aria-label')).toBe('Pause');
    vi.advanceTimersByTime(IMAGE_DURATION_MS - 2000);
    expect(position()).toBe('B, tale 2 of 2');
  });

  it('leaves Space on the focused Close button to the button, which closes', () => {
    viewer.open('gb');
    const close = q<HTMLButtonElement>('.control.close');
    close.focus();
    const down = key(' ');
    expect(down.defaultPrevented).toBe(false);
    expect(dialog()?.hasAttribute('data-paused')).toBe(false);
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true });
    close.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    // The browser then clicks the button.
    close.click();
    expect(dialog()?.hasAttribute('open')).toBe(false);
  });

  it('gives the group name its own direction, and the Close button an edge for forced colours', () => {
    viewer.open('gb');
    expect(q('.name').getAttribute('dir')).toBe('auto');
    expect(VIEWER_STYLES).toContain('border: 1px solid transparent;');
    expect(VIEWER_STYLES).toMatch(/@media \(forced-colors: active\) \{[^}]*\.segment \{ forced-color-adjust: none; background: GrayText; \}/);
  });

  describe('on a right-to-left page', () => {
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    afterEach(() => spy?.mockRestore());
    beforeEach(() => {
      const real = window.getComputedStyle.bind(window);
      spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
        const style = real(el, pseudo);
        return el instanceof HTMLDialogElement ? ({ ...style, direction: 'rtl' } as CSSStyleDeclaration) : style;
      });
    });

    it('marks the viewer right to left and mirrors the arrow keys', () => {
      viewer.open('gb');
      expect(dialog()?.hasAttribute('data-rtl')).toBe(true);
      key('ArrowLeft');
      expect(position()).toBe('B, tale 2 of 2');
      key('ArrowRight');
      expect(position()).toBe('B, tale 1 of 2');
    });

    it('mirrors swipes: toward the right shows the next group', () => {
      viewer.open('gb');
      pointer('pointerdown', 100);
      pointer('pointerup', 200);
      expect(position()).toBe('C, tale 1 of 2');
      pointer('pointerdown', 300);
      pointer('pointerup', 200);
      expect(position()).toBe('B, tale 1 of 2');
    });

    it('mirrors a tap that lands on the stage: the right third steps back', () => {
      viewer.open('gb');
      key('ArrowLeft');
      vi.spyOn(q('.stage'), 'getBoundingClientRect').mockReturnValue({ left: 0, right: 300, width: 300, top: 0, bottom: 600, height: 600 } as DOMRect);
      q('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 280 }));
      expect(position()).toBe('B, tale 1 of 2');
      q('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 20 }));
      expect(position()).toBe('B, tale 2 of 2');
    });
  });

  it('pauses and resumes with the Pause button, and stays paused on the next tale', () => {
    viewer.open('gb');
    q<HTMLButtonElement>('.control.pause').click();
    expect(q('.control.pause').getAttribute('aria-label')).toBe('Play');
    key('ArrowRight');
    vi.advanceTimersByTime(IMAGE_DURATION_MS * 2);
    expect(position()).toBe('B, tale 2 of 2');
    q<HTMLButtonElement>('.control.pause').click();
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('C, tale 1 of 2');
  });

  it.each([
    ['Escape', () => key('Escape')],
    ['the cancel event', () => dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }))],
    ['the Close button', () => q<HTMLButtonElement>('.control.close').click()],
  ])('closes with %s and reports the group shown', (_label, act) => {
    viewer.open('gb');
    key('ArrowRight');
    key('ArrowRight');
    act();
    expect(dialog()?.hasAttribute('open')).toBe(false);
    expect(closed).toEqual(['gc']);
    vi.advanceTimersByTime(IMAGE_DURATION_MS * 5);
    expect(closed).toEqual(['gc']);
  });

  it('leaves modified keys to the browser and keeps handled keys from the host page', () => {
    const hostKeys = vi.fn();
    document.addEventListener('keydown', hostKeys);
    try {
      viewer.open('gb');
      for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
        const e = key('ArrowRight', { [mod]: true });
        expect(e.defaultPrevented).toBe(false);
      }
      expect(position()).toBe('B, tale 1 of 2');
      expect(hostKeys).toHaveBeenCalledTimes(4);
      for (const k of ['ArrowRight', 'ArrowLeft', ' ', 'Escape']) {
        if (!viewer.isOpen) viewer.open('gb');
        expect(key(k).defaultPrevented).toBe(true);
      }
      expect(hostKeys).toHaveBeenCalledTimes(4);
      key('a');
      expect(hostKeys).toHaveBeenCalledTimes(5);
    } finally {
      document.removeEventListener('keydown', hostKeys);
    }
  });

  it('swallows only the pointer click right after a swipe, never a later one or a keyboard activation', () => {
    viewer.open('gb');
    pointer('pointerdown', 300);
    pointer('pointerup', 200);
    expect(position()).toBe('C, tale 1 of 2');
    // No click came with the swipe: a pointer click in a later task steps.
    vi.advanceTimersByTime(1);
    tap('.zone.next');
    expect(position()).toBe('C, tale 2 of 2');
    tap('.zone.prev');
    pointer('pointerdown', 300);
    vi.advanceTimersByTime(HOLD_MIN_MS);
    pointer('pointerup', 300);
    // A keyboard activation in the same task still steps.
    q<HTMLButtonElement>('.zone.next').click();
    expect(position()).toBe('C, tale 2 of 2');
  });

  it.each([
    ['pointercancel', () => dialog()?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))],
    ['lostpointercapture', () => q('.stage').dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }))],
    ['a window blur', () => window.dispatchEvent(new Event('blur'))],
  ])('ends a press on %s and resumes', (_label, release) => {
    viewer.open('gb');
    pointer('pointerdown', 300);
    expect(dialog()?.hasAttribute('data-paused')).toBe(true);
    release();
    expect(dialog()?.hasAttribute('data-paused')).toBe(false);
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('B, tale 2 of 2');
  });

  it('captures the pointer on press, so a release outside the window still arrives', () => {
    const capture = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: capture, configurable: true });
    try {
      viewer.open('gb');
      pointer('pointerdown', 300);
      expect(capture).toHaveBeenCalledTimes(1);
    } finally {
      delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture;
    }
  });

  it('keeps wheel and one-finger touch scrolling from reaching the host page, but not pinch', () => {
    viewer.open('gb');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    q('.stage').dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const touch = (n: number) => {
      const e = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'touches', { value: { length: n } });
      q('.stage').dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(touch(1)).toBe(true);
    expect(touch(2)).toBe(false);
  });

  it('keeps one live region and fills it a task after the change', () => {
    viewer.open('gb');
    const region = q('.sr-only');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe('B, tale 1 of 2');
    key('ArrowRight');
    expect(region.textContent).toBe('B, tale 1 of 2');
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe('B, tale 2 of 2');
    viewer.close();
    expect(region.textContent).toBe('');
    viewer.open('ga');
    expect(q('.sr-only')).toBe(region);
    vi.advanceTimersByTime(1);
    expect(region.textContent).toBe('A, tale 1 of 1');
  });

  describe('video', () => {
    const vgroups: DeliveryTaleGroup[] = [{ id: 'gv', name: 'V', tales: [video('v1'), image('v2')] }];
    const vid = () => q<HTMLVideoElement>('video.media');

    it('plays a video to its end with its segment following the time, then steps', () => {
      setup(vgroups);
      viewer.open('gv');
      expect(vid().getAttribute('src')).toBe(`${API}/media/tales/v1.mp4`);
      expect(vid().playsInline).toBe(true);
      expect(vid().getAttribute('aria-hidden')).toBe('true');
      expect(vid().muted).toBe(false);
      expect(q('.ta-canvas').getAttribute('aria-label')).toBe('Tale v1');
      expect(playMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(IMAGE_DURATION_MS * 3);
      expect(position()).toBe('V, tale 1 of 2');
      Object.defineProperty(vid(), 'duration', { value: 10, configurable: true });
      Object.defineProperty(vid(), 'currentTime', { value: 5, configurable: true });
      vid().dispatchEvent(new Event('timeupdate'));
      expect((q('.fill') as HTMLElement).style.transform).toBe('scaleX(0.5)');
      vid().dispatchEvent(new Event('ended'));
      expect(position()).toBe('V, tale 2 of 2');
      expect(pauseMock).toHaveBeenCalled();
    });

    it('pauses and resumes the video', () => {
      setup(vgroups);
      viewer.open('gv');
      key(' ');
      expect(pauseMock).toHaveBeenCalled();
      key(' ');
      expect(playMock).toHaveBeenCalledTimes(2);
    });

    it('retries muted when the browser refuses sound', async () => {
      playMock.mockImplementationOnce(() => Promise.reject(new DOMException('no sound', 'NotAllowedError')));
      setup(vgroups);
      viewer.open('gv');
      await vi.advanceTimersByTimeAsync(0);
      expect(vid().muted).toBe(true);
      expect(playMock).toHaveBeenCalledTimes(2);
    });

    it('ignores an AbortError from a superseded play() and keeps playing the video', async () => {
      playMock.mockImplementationOnce(() => Promise.reject(new DOMException('interrupted', 'AbortError')));
      setup(vgroups);
      viewer.open('gv');
      await vi.advanceTimersByTimeAsync(0);
      expect(vid()).not.toBeNull();
      expect(vid().muted).toBe(false);
      await vi.advanceTimersByTimeAsync(IMAGE_DURATION_MS * 2);
      expect(position()).toBe('V, tale 1 of 2');
    });

    it('falls back to the fixed duration when the video fails', () => {
      setup(vgroups);
      viewer.open('gv');
      vid().dispatchEvent(new Event('error'));
      vi.advanceTimersByTime(IMAGE_DURATION_MS);
      expect(position()).toBe('V, tale 2 of 2');
    });

    it('stops the video on close', () => {
      setup(vgroups);
      viewer.open('gv');
      pauseMock.mockClear();
      viewer.close();
      expect(pauseMock).toHaveBeenCalled();
    });
  });
  describe('reduced motion', () => {
    const vgroups: DeliveryTaleGroup[] = [{ id: 'gv', name: 'V', tales: [video('v1'), image('v2')] }];
    beforeEach(() => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query })),
      );
    });

    it('never autoplays or advances: a video waits for Play and stays at its end, an image stays', () => {
      setup(vgroups);
      viewer.open('gv');
      const pause = q<HTMLButtonElement>('.control.pause');
      expect(playMock).not.toHaveBeenCalled();
      expect(pause.getAttribute('aria-label')).toBe('Play');
      expect(pause.hidden).toBe(false);
      expect(q('video.media').getAttribute('src')).toBe(`${API}/media/tales/v1.mp4#t=0.001`);
      pause.click();
      expect(playMock).toHaveBeenCalledTimes(1);
      q('video.media').dispatchEvent(new Event('ended'));
      expect(position()).toBe('V, tale 1 of 2');
      expect(pause.getAttribute('aria-label')).toBe('Play');
      key('ArrowRight');
      expect(position()).toBe('V, tale 2 of 2');
      expect(pause.hidden).toBe(true);
      vi.advanceTimersByTime(IMAGE_DURATION_MS * 5);
      expect(position()).toBe('V, tale 2 of 2');
      expect(viewer.isOpen).toBe(true);
    });

    it('autoplays again once reduced motion is off', () => {
      setup(vgroups);
      viewer.open('gv');
      viewer.close();
      vi.unstubAllGlobals();
      viewer.open('gv');
      expect(playMock).toHaveBeenCalledTimes(1);
      expect(q('.control.pause').getAttribute('aria-label')).toBe('Pause');
      expect(q<HTMLButtonElement>('.control.pause').hidden).toBe(false);
    });
  });
});
