import type { DeliveryTaleDocument, DeliveryTaleElement, DeliveryTaleGroup } from '@taleart/contract';
import { TaleViewer } from '../viewer';
import { DOCUMENT_STYLES, renderTaleDocument } from './renderer';

// Tale Studio story 7.10 (R12, AD-15): visual reading and focus order, a name (or hidden) for every
// node, and a still tale under reduced motion.
const CDN = 'https://cdn.example/media';
let n = 0;
function el(
  type: string,
  x: number,
  y: number,
  props: Record<string, unknown>,
  a11y: DeliveryTaleElement['a11y'] = {},
  size: { w?: number; h?: number; rotation?: number } = {},
): DeliveryTaleElement {
  return {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    type,
    box: { x, y, w: size.w ?? 0.35, h: size.h ?? 0.08, rotation: size.rotation ?? 0 },
    a11y,
    props: props as DeliveryTaleElement['props'],
  } as DeliveryTaleElement;
}
const doc = (elements: DeliveryTaleElement[]): DeliveryTaleDocument => ({
  version: 1,
  canvas: { background: { type: 'color', color: '#1f3a5f' } },
  elements,
});

// A composed tale, in z-order: a decorative shape behind everything, the button, an image a bit lower
// than the text beside it (same row), the title, an emoji and a swipe-up link stored at the top.
const composed = () =>
  doc([
    el('shape', 0, 0, { shape: 'rectangle', fill: '#000000' }, { decorative: true }, { w: 1, h: 1 }),
    el('button', 0.3, 0.75, { label: 'Shop now', href: 'https://example.com/shop' }),
    el('image', 0.05, 0.41, { url: `${CDN}/look.jpg` }, { label: 'A red coat' }),
    el('text', 0.55, 0.4, { text: 'New season' }),
    el('text', 0.1, 0.12, { text: 'Autumn edit' }),
    el('emoji', 0.8, 0.12, { emoji: '🍂' }, { label: 'Falling leaf' }, { w: 0.1, h: 0.06 }),
    el('swipe-up', 0.2, 0.0, { label: 'See more', href: 'https://example.com/more' }, {}, { w: 0.6, h: 0.09 }),
  ]);

// What a screen reader announces for each node in DOM order (the accessible name, or null when hidden).
function announced(area: HTMLElement): (string | null)[] {
  return [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')].map((node) => {
    if (node.getAttribute('aria-hidden') === 'true') return null;
    if (node instanceof HTMLImageElement) return node.alt || null;
    return node.getAttribute('aria-label') ?? (node.textContent?.trim() || null);
  });
}

describe('reading order of a composed tale (R12, AD-15)', () => {
  it('puts the DOM, which screen readers and Tab follow, in visual order', () => {
    const area = renderTaleDocument(composed());
    expect(announced(area)).toEqual([
      null, // the decorative backdrop, hidden
      'Autumn edit',
      'Falling leaf',
      'A red coat', // the image is 1 % lower than the text beside it: one row, left first
      'New season',
      'Shop now',
      'See more', // drawn in the bottom safe area, whatever its stored box says
    ]);
    // The z-order stays the document's.
    const z = [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')].map((node) => node.style.zIndex);
    expect(z).toEqual(['1', '5', '6', '3', '4', '2', '7']);
  });

  it('reads a row right to left on a right-to-left page', () => {
    const area = renderTaleDocument(composed(), { direction: 'rtl' });
    expect(announced(area).filter(Boolean)).toEqual([
      'Falling leaf',
      'Autumn edit',
      'New season',
      'A red coat',
      'Shop now',
      'See more',
    ]);
  });

  it('focuses the links in reading order', () => {
    const area = renderTaleDocument(
      doc([
        el('button', 0.55, 0.6, { label: 'Right', href: 'https://example.com/r' }),
        el('button', 0.05, 0.605, { label: 'Left', href: 'https://example.com/l' }),
        el('button', 0.3, 0.2, { label: 'Top', href: 'https://example.com/t' }),
      ]),
    );
    const links = [...area.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links.map((a) => a.textContent)).toEqual(['Top', 'Left', 'Right']);
    expect(links.every((a) => a.tabIndex === 0)).toBe(true);
  });

  it('orders by the host direction in the viewer', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const real = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) => {
      const style = real(node, pseudo);
      return node instanceof HTMLDialogElement ? ({ ...style, direction: 'rtl' } as CSSStyleDeclaration) : style;
    });
    const group: DeliveryTaleGroup = {
      id: 'g',
      name: 'G',
      cover: null,
      tales: [
        {
          id: 't',
          title: 'T',
          media: null,
          document: doc([el('text', 0.05, 0.4, { text: 'Left' }), el('text', 0.6, 0.4, { text: 'Right' })]),
        },
      ],
    };
    const viewer = new TaleViewer(host, [group]);
    try {
      viewer.open('g');
      const texts = [...host.querySelectorAll('dialog .ta-canvas .ta-text')].map((p) => p.textContent);
      expect(texts).toEqual(['Right', 'Left']);
    } finally {
      viewer.close();
      spy.mockRestore();
      host.remove();
    }
  });
});

describe('names (R12)', () => {
  it('names every node of a composed tale, or hides it from assistive technology', () => {
    const area = renderTaleDocument(
      doc([
        el('text', 0.1, 0.1, { text: 'Title' }),
        el('image', 0.1, 0.2, { url: `${CDN}/a.jpg` }, { label: 'Alt text' }),
        el('image', 0.1, 0.3, { url: `${CDN}/b.jpg` }, { decorative: true }),
        el('video', 0.1, 0.4, { url: `${CDN}/c.mp4` }, { label: 'A clip' }),
        el('sticker', 0.1, 0.5, { url: `${CDN}/d.png` }, { label: 'Sticker' }),
        el('shape', 0.1, 0.55, { shape: 'ellipse', fill: '#ff0000' }, { label: 'Red dot' }),
        el('shape', 0.1, 0.6, { shape: 'line', stroke: '#ffffff', strokeWidth: 0.005 }),
        el('emoji', 0.1, 0.65, { emoji: '🎉' }),
        el('button', 0.1, 0.7, { label: 'Buy', href: 'https://example.com' }),
        el('image-button', 0.6, 0.7, { url: `${CDN}/e.png`, href: 'https://example.com/e' }, { label: 'Look' }),
      ]),
    );
    const nodes = [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')];
    expect(nodes).toHaveLength(10);
    for (const node of nodes) {
      const hidden = node.getAttribute('aria-hidden') === 'true';
      const name =
        node instanceof HTMLImageElement ? node.alt : (node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '');
      expect(hidden || name !== '').toBe(true);
    }
    expect(announced(area)).toEqual([
      'Title',
      'Alt text',
      null,
      'A clip',
      'Sticker',
      'Red dot',
      null,
      '🎉',
      'Buy',
      expect.stringContaining('Look'),
    ]);
  });

  it('hides a picture or video that has no name yet, as an unpublished draft may hold', () => {
    const area = renderTaleDocument(
      doc([el('video', 0.1, 0.1, { url: `${CDN}/c.mp4` }), el('image', 0.1, 0.5, { url: `${CDN}/a.gif` })]),
      { reducedMotion: true },
    );
    const [video, still] = [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')];
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(still.tagName).toBe('CANVAS');
    expect(still.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('reduced motion (R12)', () => {
  it('draws pictures that may move once, keeps videos on their first frame and stops any animation', () => {
    const area = renderTaleDocument(
      doc([
        el('image', 0.1, 0.1, { url: `${CDN}/a.gif` }, { label: 'Dancing' }),
        el('sticker', 0.1, 0.3, { url: `${CDN}/b.webp` }, { label: 'Waving' }),
        el('image', 0.1, 0.5, { url: `${CDN}/c.jpg` }, { label: 'Photo' }),
        el('video', 0.1, 0.7, { url: `${CDN}/d.mp4` }, { label: 'Clip' }),
      ]),
      { reducedMotion: true },
    );
    const [gif, sticker, photo, video] = [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')];
    expect(gif.tagName).toBe('CANVAS');
    expect(gif.getAttribute('role')).toBe('img');
    expect(gif.getAttribute('aria-label')).toBe('Dancing');
    expect(sticker.tagName).toBe('CANVAS');
    expect(photo.tagName).toBe('IMG');
    const v = video as HTMLVideoElement;
    expect(v.autoplay).toBe(false);
    expect(v.muted).toBe(true);
    expect(v.preload).toBe('metadata');
    expect(v.getAttribute('src')).toBe(`${CDN}/d.mp4#t=0.001`);
    expect(DOCUMENT_STYLES).toContain(
      '@media (prefers-reduced-motion: reduce) { .ta-canvas * { animation: none !important; transition: none !important; } }',
    );
  });

  it('keeps moving pictures as they are without the preference', () => {
    const area = renderTaleDocument(doc([el('image', 0.1, 0.1, { url: `${CDN}/a.gif` }, { label: 'Dancing' })]));
    const [gif] = [...area.querySelectorAll<HTMLElement>('.ta-canvas > .ta-el')];
    expect(gif.tagName).toBe('IMG');
  });
});
