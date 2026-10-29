import type { DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { SWIPE_MIN_PX, SWIPE_UP_MAX_MS, TaleViewer } from './viewer';

// Tale Studio story 7.7: the viewer opens a tale's swipe-up link on a swipe up (R7), and keeps its
// own gestures: tap to step, swipe sideways between groups, hold to pause.
const SWIPE_BOX = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 };

function link(type: string, props: Record<string, unknown>, box = SWIPE_BOX): DeliveryTaleElement {
  return { id: crypto.randomUUID(), type, box, a11y: {}, props: props as DeliveryTaleElement['props'] };
}

const doc = (elements: DeliveryTaleElement[]): DeliveryTaleDocument => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#112233' } },
  elements,
});

const swipeUp = (href = 'https://example.com/more', newTab = false) =>
  link('swipe-up', { label: 'See more', color: '#ffffff', background: '#000000b3', href, newTab });
const button = link(
  'button',
  { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', href: 'https://example.com/shop' },
  { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
);

let host: HTMLElement;
let viewer: TaleViewer;
let opened: string[];
const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
const position = () => `${dialog().querySelectorAll('.segment.done').length + 1}`;
const q = (selector: string) => dialog().querySelector(selector) as HTMLElement;
function pointer(type: string, x: number, y: number, target: Element = q('.stage'), pointerId = 1): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId }),
  );
}

describe('TaleViewer: the swipe-up link (R7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    opened = [];
    // jsdom does not navigate: record where a link's activation would go.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(`${this.href} ${this.target || '_self'} ${this.rel}`);
    });
    const groups: DeliveryTaleGroup[] = [
      {
        id: 'g',
        name: 'G',
        cover: null,
        tales: [
          { id: 't1', title: 'One', media: null, document: doc([button, swipeUp()]) },
          { id: 't2', title: 'Two', media: null, document: doc([button]) },
          { id: 't3', title: 'Three', media: null, document: doc([swipeUp('https://example.com/new', true)]) },
        ],
      },
      { id: 'h', name: 'H', cover: null, tales: [{ id: 'u1', title: 'U', media: null, document: doc([]) }] },
    ];
    viewer = new TaleViewer(host, groups);
    viewer.open('g');
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the links as focusable anchors over the stage, outside the tap zones', () => {
    const swipe = q('a.ta-swipe') as HTMLAnchorElement;
    expect(swipe.getAttribute('href')).toBe('https://example.com/more');
    expect(swipe.rel).toBe('noopener noreferrer');
    expect(swipe.closest('.stage')).toBeNull();
    expect(q('a.ta-button').textContent).toBe('Shop now');
  });

  it('opens the swipe-up link on a swipe up over the stage, without stepping', () => {
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 205, 500 - SWIPE_MIN_PX - 10);
    // The click a pointer release may also produce on the stage is swallowed.
    q('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(opened).toEqual(['https://example.com/more _self noopener noreferrer']);
    expect(position()).toBe('1');
    expect(dialog().hasAttribute('open')).toBe(true);
  });

  it('opens it on a swipe up that starts on the link, and only once', () => {
    const swipe = q('a.ta-swipe');
    pointer('pointerdown', 200, 700, swipe);
    pointer('pointerup', 200, 600, swipe);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    swipe.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(opened).toHaveLength(1);
    // A later click on it, after a new press, is the visitor's own: it is not swallowed.
    vi.advanceTimersByTime(1000);
    pointer('pointerdown', 200, 700, swipe);
    pointer('pointerup', 200, 700, swipe);
    const later = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    swipe.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('opens a new-tab swipe-up link in a new tab without opener access', () => {
    viewer.next();
    viewer.next();
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 200, 400);
    expect(opened).toEqual(['https://example.com/new _blank noopener noreferrer']);
  });

  it('keeps a short or mostly sideways drag a tap or a swipe between groups', () => {
    pointer('pointerdown', 300, 500);
    pointer('pointerup', 300, 500 - SWIPE_MIN_PX + 5);
    pointer('pointerdown', 300, 500);
    pointer('pointerup', 300 - 120, 500 - 60);
    expect(opened).toEqual([]);
    expect(dialog().getAttribute('aria-label')).toBe('H');
  });

  it('treats a swipe up on a tale without a swipe-up link as before: a tap', () => {
    viewer.next();
    expect(position()).toBe('2');
    pointer('pointerdown', 300, 500);
    pointer('pointerup', 300, 300);
    q('.stage').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: 300 }));
    expect(opened).toEqual([]);
    expect(position()).toBe('3');
  });

  it('does not step or pause when a link is clicked or a key other than the viewer keys is pressed on it', () => {
    const a = q('a.ta-button');
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    a.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(position()).toBe('1');
    expect(dialog().hasAttribute('data-paused')).toBe(false);
  });
  it('opens it only on a flick: not after a hold that drifts up, nor on a slow drag', () => {
    pointer('pointerdown', 200, 500);
    vi.advanceTimersByTime(SWIPE_UP_MAX_MS + 100);
    pointer('pointerup', 200, 250);
    pointer('pointerdown', 200, 500);
    vi.advanceTimersByTime(SWIPE_UP_MAX_MS);
    pointer('pointermove', 200, 400);
    pointer('pointerup', 200, 300);
    expect(opened).toEqual([]);
  });

  it('needs a swipe of at least 8% of the stage height on a tall stage', () => {
    vi.spyOn(q('.stage'), 'getBoundingClientRect').mockReturnValue({ height: 1000, width: 560 } as DOMRect);
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 200, 430);
    expect(opened).toEqual([]);
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 200, 410);
    expect(opened).toHaveLength(1);
  });

  it('ignores other pointers: a second finger makes the press a pinch, not a swipe', () => {
    pointer('pointerdown', 200, 500, q('.stage'), 1);
    pointer('pointerdown', 250, 500, q('.stage'), 2);
    pointer('pointerup', 250, 300, q('.stage'), 2);
    pointer('pointerup', 200, 300, q('.stage'), 1);
    expect(opened).toEqual([]);
    expect(position()).toBe('1');
    // A release of a pointer that never pressed is ignored too.
    pointer('pointerup', 200, 300, q('.stage'), 7);
    expect(opened).toEqual([]);
  });

  it('waits while a link has focus, and resumes when focus leaves it', () => {
    const a = q('a.ta-button') as HTMLAnchorElement;
    a.focus();
    expect(dialog().hasAttribute('data-paused')).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(position()).toBe('1');
    dialog().focus();
    expect(dialog().hasAttribute('data-paused')).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(position()).not.toBe('1');
  });

  it('moves focus to the dialog when the tale holding the focused link goes', () => {
    (q('a.ta-button') as HTMLAnchorElement).focus();
    viewer.next();
    expect(position()).toBe('2');
    expect(document.activeElement).toBe(dialog());
  });
});

describe('TaleViewer: the actions of a tale (hooks)', () => {
  let allow: boolean;
  let actions: { id: string; groupId: string; tale: number; type: string; url: string; newTab: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    allow = true;
    actions = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const groups: DeliveryTaleGroup[] = [
      { id: 'g', name: 'G', cover: null, tales: [{ id: 't1', title: 'One', media: null, document: doc([swipeUp()]) }] },
    ];
    viewer = new TaleViewer(host, groups, {
      onAction: (groupId, tale, action) => {
        actions.push({ groupId, tale, ...action });
        return allow;
      },
    });
    viewer.open('g');
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls onAction for a swipe-up flick, and a host that prevents it keeps the link from being followed', () => {
    const link = q('a.ta-swipe');
    const prevented: boolean[] = [];
    // Listeners added after the viewer's own see the state the host left: prevented or not.
    link.addEventListener('click', (e) => prevented.push(e.defaultPrevented));
    allow = false;
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 205, 500 - SWIPE_MIN_PX - 10);
    expect(actions).toEqual([
      expect.objectContaining({ groupId: 'g', tale: 0, type: 'swipe-up', url: 'https://example.com/more', newTab: false }),
    ]);
    expect(prevented).toEqual([true]);
    expect(position()).toBe('1');
  });

  it('lets the link be followed when the host does not prevent it', () => {
    const link = q('a.ta-swipe');
    const prevented: boolean[] = [];
    link.addEventListener('click', (e) => prevented.push(e.defaultPrevented));
    pointer('pointerdown', 200, 500);
    pointer('pointerup', 205, 500 - SWIPE_MIN_PX - 10);
    expect(actions).toHaveLength(1);
    expect(prevented).toEqual([false]);
  });
});
