import type { DeliveryTale, DeliveryTaleGroup } from '@taleart/contract';
import { HOLD_MIN_MS, IMAGE_DURATION_MS, TaleViewer } from './viewer';

const API = 'https://api.example.com';

function image(id: string): DeliveryTale {
  return { id, title: `Tale ${id}`, media: { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/${id}.png` } };
}
function video(id: string): DeliveryTale {
  return { id, title: `Tale ${id}`, media: { kind: 'video', contentType: 'video/mp4', url: `${API}/media/tales/${id}.mp4` } };
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
const position = () => q('.sr-only').textContent;
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

  it('opens a group as a named modal dialog at its first tale, one segment per tale, focus in the dialog', () => {
    expect(viewer.open('gb')).toBe(true);
    const d = dialog();
    expect(d?.hasAttribute('open')).toBe(true);
    expect(d?.getAttribute('aria-label')).toBe('B');
    expect(document.activeElement).toBe(d);
    expect(d?.querySelectorAll('.segment')).toHaveLength(2);
    expect(mediaSrc()).toBe(`${API}/media/tales/b1.png`);
    expect(q<HTMLImageElement>('.media').alt).toBe('Tale b1');
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
    q<HTMLButtonElement>('.zone.next').click();
    expect(position()).toBe('B, tale 1 of 2');
    key('ArrowRight');
    expect(position()).toBe('B, tale 2 of 2');
    key('ArrowRight');
    expect(position()).toBe('C, tale 1 of 2');
    expect(dialog()?.getAttribute('aria-label')).toBe('C');
    key('ArrowLeft');
    expect(position()).toBe('B, tale 2 of 2');
    q<HTMLButtonElement>('.zone.prev').click();
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
    expect(q('.media').getAttribute('aria-label')).toBe('Tale 2');
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(dialog()).toBeNull();
    expect(viewer.isOpen).toBe(false);
    expect(closed).toEqual(['gc']);
  });

  it('swipes left to the next group and right to the previous one, without also stepping', () => {
    viewer.open('gb');
    pointer('pointerdown', 300);
    pointer('pointerup', 200);
    q<HTMLButtonElement>('.zone.next').click(); // the click a browser fires after the gesture
    expect(position()).toBe('C, tale 1 of 2');
    pointer('pointerdown', 100);
    pointer('pointerup', 200);
    expect(position()).toBe('B, tale 1 of 2');
    // A tap after a swipe steps again.
    pointer('pointerdown', 300);
    pointer('pointerup', 300);
    q<HTMLButtonElement>('.zone.next').click();
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
    expect(dialog()).toBeNull();
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
    q<HTMLButtonElement>('.zone.next').click();
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
    expect(dialog()).toBeNull();
    expect(closed).toEqual(['gc']);
    vi.advanceTimersByTime(IMAGE_DURATION_MS * 5);
    expect(closed).toEqual(['gc']);
  });

  describe('video', () => {
    const vgroups: DeliveryTaleGroup[] = [{ id: 'gv', name: 'V', tales: [video('v1'), image('v2')] }];
    const vid = () => q<HTMLVideoElement>('video.media');

    it('plays a video to its end with its segment following the time, then steps', () => {
      setup(vgroups);
      viewer.open('gv');
      expect(vid().getAttribute('src')).toBe(`${API}/media/tales/v1.mp4`);
      expect(vid().playsInline).toBe(true);
      expect(vid().getAttribute('aria-label')).toBe('Tale v1');
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
});
