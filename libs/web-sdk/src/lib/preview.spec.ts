import type { DeliveryTaleDocument, DeliveryTaleElement } from '@taleart/contract';
import * as entry from '../preview';
import * as sdk from '../index';
import { renderTaleDocument } from './document/renderer';
import {
  PREVIEW_REDRAW_MS,
  PREVIEW_RESTART_MS,
  PREVIEW_SIZES,
  previewDocument,
  TalePreview,
  type PreviewTale,
} from './preview';
import { TaleViewer, WIDE_QUERY } from './viewer';

// Tale Studio story 7.9 (R10, AD-16): the studio preview is the SDK's own viewer and renderer.

const box = (y: number) => ({ x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 });
const text = (value: string, y = 0.2): DeliveryTaleElement =>
  ({ id: `t-${value}`, type: 'text', box: box(y), a11y: {}, props: { text: value } }) as unknown as DeliveryTaleElement;
const button = (href: string, newTab = false): DeliveryTaleElement =>
  ({
    id: 'b',
    type: 'button',
    box: box(0.6),
    a11y: {},
    props: { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', href, newTab },
  }) as unknown as DeliveryTaleElement;
const swipeUp = (href: string): DeliveryTaleElement =>
  ({
    id: 's',
    type: 'swipe-up',
    box: box(0.87),
    a11y: {},
    props: { label: 'See more', color: '#ffffff', background: '#000000b3', href },
  }) as unknown as DeliveryTaleElement;

const doc = (elements: DeliveryTaleElement[], durationMs?: number): DeliveryTaleDocument => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#112233' } },
  ...(durationMs === undefined ? {} : { durationMs }),
  elements,
});
const ownVideo = (url = 'https://media.test/tales/own.mp4'): DeliveryTaleElement =>
  ({
    id: 'own',
    type: 'video',
    box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    a11y: { decorative: true },
    props: { url, fit: 'contain', taleMedia: true },
  }) as unknown as DeliveryTaleElement;
const docVideo = (url = 'https://media.test/media/clip.mp4'): DeliveryTaleElement =>
  ({ id: 'clip', type: 'video', box: box(0.3), a11y: { decorative: true }, props: { url, fit: 'cover' } }) as unknown as DeliveryTaleElement;
const tale = (document: DeliveryTaleDocument, groupName = 'Summer', id = 'tale-1'): PreviewTale => ({
  id,
  title: 'Sale',
  groupName,
  document,
});

let host: HTMLElement;
let outside: HTMLInputElement;
let preview: TalePreview;
let ended: number;
let started: number;
const root = () => host.shadowRoot as ShadowRoot;
const q = (selector: string) => root().querySelector(selector) as HTMLElement | null;
const texts = () => [...root().querySelectorAll('.ta-glyphs')].map((n) => n.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  outside = document.createElement('input');
  host = document.createElement('div');
  document.body.append(outside, host);
  outside.focus();
  ended = 0;
  started = 0;
  preview = new TalePreview(host, { onEnded: () => ended++, onStarted: () => started++ });
});

afterEach(() => {
  preview.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the preview entry point', () => {
  it('exports the preview from its own entry point, not from the host page bundle', () => {
    expect(entry.TalePreview).toBe(TalePreview);
    expect(entry.previewDocument).toBe(previewDocument);
    expect(Object.keys(sdk)).not.toContain('TalePreview');
    expect(Object.keys(sdk).sort()).toEqual(
      [
        'TALEART_ELEMENT_TAG',
        'TaleartElement',
        'configureZone',
        'defineTaleartElement',
        'getConfig',
        'init',
        'setExternalUserId',
        'setProperties',
        'setProperty',
        'setTags',
        'setZoneData',
        'validateZone',
      ].sort(),
    );
  });

  it('offers the default 390 x 844 and a smaller and a larger phone size', () => {
    expect(PREVIEW_SIZES.map((s) => `${s.width}x${s.height}`)).toEqual(['375x667', '390x844', '430x932']);
    expect(entry.DEFAULT_PREVIEW_SIZE).toBe('default');
  });
});

describe('previewDocument', () => {
  it('delivers the draft as the Delivery API would: no hidden layers or editor fields, media keys as URLs', () => {
    const draft = {
      version: 1,
      canvas: { background: { type: 'media', mediaKey: 'media/bg.png', fit: 'cover', color: '#000000' } },
      elements: [
        { id: 'a', type: 'text', box: box(0.1), a11y: {}, hidden: false, locked: true, props: { text: 'A' } },
        { id: 'h', type: 'text', box: box(0.2), a11y: {}, hidden: true, locked: false, props: { text: 'H' } },
        { id: 'i', type: 'image', box: box(0.3), a11y: {}, props: { mediaKey: 'media/a.png', fit: 'cover' } },
        { id: 'x', type: 'image', box: box(0.4), a11y: {}, props: { mediaKey: 'media/gone.png', fit: 'cover' } },
      ],
    };
    const delivered = previewDocument(draft, (key) => (key === 'media/gone.png' ? null : `https://api.test/${key}`));
    expect(delivered.elements.map((e) => e.id)).toEqual(['a', 'i']);
    expect(delivered.elements[0]).not.toHaveProperty('locked');
    expect(delivered.elements[0]).not.toHaveProperty('hidden');
    expect(delivered.elements[1].props).toEqual({ url: 'https://api.test/media/a.png', fit: 'cover' });
    expect(delivered.canvas.background).toEqual({
      type: 'media',
      url: 'https://api.test/media/bg.png',
      fit: 'cover',
      color: '#000000',
    });
    // The draft is not changed.
    expect(draft.elements[0]).toHaveProperty('locked', true);
  });
});

describe('TalePreview', () => {
  it("mounts the SDK's viewer in place, with its chrome, without taking focus from the studio", () => {
    preview.show(tale(doc([text('Hello')])));
    const dialog = q('dialog.viewer') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.hasAttribute('data-embedded')).toBe(true);
    expect(root().querySelectorAll('.segment')).toHaveLength(1);
    // Not announced as a dialog: a region described as a preview, its Close stops the preview.
    expect(dialog.getAttribute('role')).toBe('region');
    expect(dialog.getAttribute('aria-roledescription')).toBe('preview');
    expect(dialog.getAttribute('aria-label')).toBe('Summer');
    expect(q('.close')?.getAttribute('aria-label')).toBe('Stop preview');
    expect(q('.pause')?.getAttribute('aria-label')).toBe('Pause');
    expect(q('.name')?.textContent).toBe('Summer');
    expect(texts()).toEqual(['Hello']);
    expect(q('.ta-canvas')?.getAttribute('aria-label')).toBe('Sale');
    expect(document.activeElement).toBe(outside);
    expect(preview.isOpen).toBe(true);
  });

  it('uses the phone-sized viewer styles only: no wide-screen deck, whatever the window', () => {
    preview.show(tale(doc([])));
    const css = root().querySelector('style')?.textContent ?? '';
    expect(css).toContain('.ta-canvas');
    expect(css).toContain('.segments');
    expect(css).not.toContain(WIDE_QUERY);
  });

  it('plays the tale for its duration, then ends and can play again', () => {
    preview.show(tale(doc([text('Hello')], 4000)));
    const fill = q('.fill') as HTMLElement;
    expect(fill.classList.contains('timed')).toBe(true);
    expect(fill.style.getPropertyValue('--taleart-duration')).toBe('4000ms');
    vi.advanceTimersByTime(3999);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended).toBe(1);
    expect(preview.isOpen).toBe(false);
    preview.replay();
    expect(preview.isOpen).toBe(true);
    expect(texts()).toEqual(['Hello']);
    vi.advanceTimersByTime(4000);
    expect(ended).toBe(2);
  });

  it('plays from the start while playing, without saying the tale ended', () => {
    preview.show(tale(doc([text('Hello')], 4000)));
    vi.advanceTimersByTime(3000);
    preview.replay();
    expect(ended).toBe(0);
    expect(preview.isOpen).toBe(true);
    vi.advanceTimersByTime(3999);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended).toBe(1);
    preview.destroy();
    expect(ended).toBe(1);
  });

  it('pauses and resumes the tale', () => {
    preview.show(tale(doc([text('Hello')], 3000)));
    vi.advanceTimersByTime(1000);
    preview.togglePause();
    expect(q('dialog')?.hasAttribute('data-paused')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(ended).toBe(0);
    preview.togglePause();
    vi.advanceTimersByTime(2000);
    expect(ended).toBe(1);
  });

  it('shows an unsaved change at once, and keeps playing where it was', () => {
    preview.show(tale(doc([text('Hello')])));
    vi.advanceTimersByTime(3000);
    const fill = q('.fill');
    preview.show(tale(doc([text('Hello, world'), text('Second', 0.5)]), 'Renamed'));
    vi.advanceTimersByTime(PREVIEW_REDRAW_MS);
    expect(texts()).toEqual(['Hello, world', 'Second']);
    expect(q('.name')?.textContent).toBe('Renamed');
    // The same progress bar runs on: the tale ends 7 s after it started, not after the change.
    expect(q('.fill')).toBe(fill);
    vi.advanceTimersByTime(4000 - PREVIEW_REDRAW_MS);
    expect(ended).toBe(1);
  });

  it('redraws once typing pauses, and not at all for an unchanged tale', () => {
    preview.show(tale(doc([text('H')])));
    const image = q('.ta-canvas');
    for (const value of ['He', 'Hel', 'Hell']) {
      preview.show(tale(doc([text(value)])));
      vi.advanceTimersByTime(PREVIEW_REDRAW_MS - 1);
    }
    expect(texts()).toEqual(['H']);
    vi.advanceTimersByTime(1);
    expect(texts()).toEqual(['Hell']);
    const drawn = q('.ta-canvas');
    expect(drawn).not.toBe(image);
    preview.show(tale(doc([text('Hell')])));
    vi.advanceTimersByTime(PREVIEW_REDRAW_MS);
    expect(q('.ta-canvas')).toBe(drawn);
  });

  it('starts over when the duration changes, once the changes stop, without announcing the tale again', () => {
    preview.show(tale(doc([text('Hello')], 5000)));
    vi.advanceTimersByTime(4000);
    const status = q('.sr-only') as HTMLElement;
    expect(status.textContent).toBe('Summer, tale 1 of 1');
    status.textContent = '';
    for (const ms of [5500, 6000]) {
      preview.show(tale(doc([text('Hello')], ms)));
      vi.advanceTimersByTime(PREVIEW_RESTART_MS - 1);
    }
    expect(q('.fill')?.style.getPropertyValue('--taleart-duration')).toBe('5000ms');
    vi.advanceTimersByTime(1);
    expect(q('.fill')?.style.getPropertyValue('--taleart-duration')).toBe('6000ms');
    vi.advanceTimersByTime(10);
    expect(status.textContent).toBe('');
    expect(started).toBe(1);
    vi.advanceTimersByTime(5989);
    expect(ended).toBe(0);
    vi.advanceTimersByTime(1);
    expect(ended).toBe(1);
  });

  it('keeps a change made after the tale ended for the next play', () => {
    preview.show(tale(doc([text('Hello')], 3000)));
    vi.advanceTimersByTime(3000);
    preview.show(tale(doc([text('Changed')], 3000)));
    expect(preview.isOpen).toBe(false);
    preview.replay();
    expect(texts()).toEqual(['Changed']);
  });

  it('draws the safe-area overlay over the canvas only when asked', () => {
    preview.show(tale(doc([])));
    const overlay = q('.ta-safe-overlay') as HTMLElement;
    expect(overlay.hidden).toBe(true);
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    // The same geometry as the document's canvas.
    expect(overlay.classList.contains('ta-area')).toBe(true);
    expect(overlay.querySelector('.ta-canvas > .ta-safe')).not.toBeNull();
    preview.setSafeArea(true);
    expect(overlay.hidden).toBe(false);
    const css = root().querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/top: 12%;\s*bottom: 16%;\s*inset-inline: 4%;/);
    preview.setSafeArea(false);
    expect(overlay.hidden).toBe(true);
  });

  it('applies the project theme as the viewer would', () => {
    preview.setTheme({ accentColor: '#ff0000', fontFamily: 'Georgia, serif' });
    const themed = q('.taleart') as HTMLElement;
    expect(themed.style.getPropertyValue('--ta-accent')).toBe('#ff0000');
    expect(themed.style.getPropertyValue('--ta-font')).toContain('Georgia');
  });

  it('renders links that look the same but go nowhere', () => {
    preview.show(tale(doc([button('https://example.com/shop', true), swipeUp('https://example.com/more')])));
    const links = [...root().querySelectorAll<HTMLAnchorElement>('a.ta-cta')];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.hasAttribute('href')).toBe(false);
      expect(a.hasAttribute('target')).toBe(false);
      expect(a.getAttribute('role')).toBe('link');
      expect(a.hasAttribute('aria-disabled')).toBe(false);
      expect(a.tabIndex).toBe(0);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
      a.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
    }
    // Its look and name are the visitor's: the new-tab note is still said.
    expect(links[0].textContent).toBe('Shop now (opens in a new tab)');
    expect(links[0].style.backgroundColor).not.toBe('');
  });

  it('waits while a link has focus, as for a visitor', () => {
    preview.show(tale(doc([button('https://example.com/shop')], 3000)));
    (q('a.ta-cta') as HTMLAnchorElement).focus();
    expect(q('dialog')?.hasAttribute('data-paused')).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(ended).toBe(0);
    outside.focus();
    vi.advanceTimersByTime(3000);
    expect(ended).toBe(1);
  });

  it('lets the page scroll over the preview', () => {
    preview.show(tale(doc([])));
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    q('.stage')?.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('starts another tale from its start, even after the last one ended', () => {
    preview.show(tale(doc([text('One')], 3000)));
    vi.advanceTimersByTime(3000);
    expect(ended).toBe(1);
    preview.show(tale(doc([text('Two')], 3000), 'Summer', 'tale-2'));
    expect(preview.isOpen).toBe(true);
    expect(started).toBe(2);
    expect(texts()).toEqual(['Two']);
  });

  it('renders nothing for a draft link the SDK would refuse', () => {
    preview.show(tale(doc([button('javascript:alert(1)')])));
    expect(q('a')).toBeNull();
  });

  it('a swipe up over the stage opens nothing', () => {
    preview.show(tale(doc([swipeUp('https://example.com/more')])));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const stage = q('.stage') as HTMLElement;
    const pointer = (type: string, y: number) =>
      stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: y, pointerId: 1 }));
    pointer('pointerdown', 500);
    pointer('pointerup', 300);
    for (const call of click.mock.instances) expect((call as HTMLAnchorElement).hasAttribute('href')).toBe(false);
    expect(preview.isOpen).toBe(true);
  });

  it('closes from its Close button and says the tale ended', () => {
    preview.show(tale(doc([])));
    (q('.close') as HTMLButtonElement).click();
    expect(ended).toBe(1);
    expect(preview.isOpen).toBe(false);
  });
});

describe('renderTaleDocument links', () => {
  it('keeps live links for visitors and makes them inert only when asked', () => {
    const live = renderTaleDocument(doc([button('https://example.com/shop')])).querySelector('a') as HTMLAnchorElement;
    expect(live.getAttribute('href')).toBe('https://example.com/shop');
    expect(live.rel).toBe('noopener noreferrer');
    const inert = renderTaleDocument(doc([button('https://example.com/shop')]), { inertLinks: true }).querySelector(
      'a',
    ) as HTMLAnchorElement;
    expect(inert.hasAttribute('href')).toBe(false);
    expect(inert.className).toBe(live.className);
    expect(inert.style.cssText).toBe(live.style.cssText);
  });
});

describe('TalePreview with video', () => {
  let play: ReturnType<typeof vi.spyOn>;
  let load: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  it("starts muted, and plays the tale's own video with sound only when asked", () => {
    preview.show(tale(doc([ownVideo(), text('Hi')])));
    const video = q('video.media') as HTMLVideoElement;
    expect(play).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    preview.setSound(true);
    expect(video.muted).toBe(false);
    preview.setSound(false);
    expect(video.muted).toBe(true);
  });

  it("keeps the running video through repeated edits, redrawing only the document", () => {
    preview.show(tale(doc([ownVideo(), text('Hi')])));
    const video = q('video.media');
    const plays = play.mock.calls.length;
    for (const value of ['Hi there', 'Hi there!', 'Hi there!!']) {
      preview.show(tale(doc([ownVideo(), text(value)])));
      vi.advanceTimersByTime(PREVIEW_REDRAW_MS);
      expect(q('video.media')).toBe(video);
      expect(texts()).toEqual([value]);
    }
    expect(video?.hasAttribute('src')).toBe(true);
    expect(load).not.toHaveBeenCalled();
    // Only asked to go on playing (a no-op for a playing video), never paused or reloaded.
    expect(play.mock.calls.length).toBeGreaterThanOrEqual(plays);
  });

  it("restarts a tale run by a document's video once edits stop, releasing the old video", () => {
    preview.show(tale(doc([docVideo(), text('Hi')])));
    const first = q('video') as HTMLVideoElement;
    for (const value of ['A', 'AB', 'ABC']) {
      preview.show(tale(doc([docVideo(), text(value)])));
      vi.advanceTimersByTime(200);
    }
    expect(q('video')).toBe(first);
    vi.advanceTimersByTime(PREVIEW_RESTART_MS);
    expect(q('video')).not.toBe(first);
    expect(texts()).toEqual(['ABC']);
    expect(first.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect((q('video') as HTMLVideoElement).muted).toBe(true);
  });
});

describe('the public viewer', () => {
  it('still opens as a modal dialog that takes focus and keeps the page from scrolling', () => {
    const proto = HTMLDialogElement.prototype as { showModal?: () => void };
    const original = proto.showModal;
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    proto.showModal = showModal;
    try {
      const viewer = new TaleViewer(host, [
        { id: 'g', name: 'G', cover: null, tales: [{ id: 't', title: 'T', media: null, document: doc([]) }] },
      ]);
      viewer.open('g');
      const dialog = host.querySelector('dialog') as HTMLDialogElement;
      expect(showModal).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(dialog);
      expect(dialog.hasAttribute('data-embedded')).toBe(false);
      expect(dialog.hasAttribute('role')).toBe(false);
      expect(dialog.querySelector('.close')?.getAttribute('aria-label')).toBe('Close');
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true });
      dialog.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true);
      viewer.close();
    } finally {
      proto.showModal = original;
    }
  });
});
