import type { DeliveryTaleDocument, DeliveryTaleElement } from '@taleart/contract';
import { renderSticker } from './media';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';
import { renderEmoji, renderShape } from './shapes';

// Tale Studio story 7.6: shapes, emoji and image stickers.
function element(type: string, props: unknown, a11y: DeliveryTaleElement['a11y'] = {}): DeliveryTaleElement {
  return {
    id: crypto.randomUUID(),
    type,
    box: { x: 0.1, y: 0.2, w: 0.25, h: 0.140625, rotation: 0 },
    a11y,
    props: props as DeliveryTaleElement['props'],
  };
}

const URL_PNG = 'https://cdn.example/media/sticker.png';

describe('renderShape', () => {
  it('draws a rounded rectangle from its values through CSSOM', () => {
    const node = renderShape(
      element('shape', {
        shape: 'rectangle',
        fill: '#ff0000',
        stroke: '#00ff00',
        strokeWidth: 0.01,
        radius: 0.05,
        opacity: 0.5,
      }),
    ) as HTMLElement;
    expect(node.className).toBe('ta-el ta-shape');
    expect(node.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(node.style.borderWidth).toBe('1cqh');
    expect(node.style.borderStyle).toBe('solid');
    expect(node.style.borderColor).toBe('rgb(0, 255, 0)');
    expect(node.style.borderRadius).toBe('5cqh');
    expect(node.style.opacity).toBe('0.5');
    expect(node.children).toHaveLength(0);
    expect(node.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws an ellipse round, and a line as a bar across the middle of its box', () => {
    const ellipse = renderShape(element('shape', { shape: 'ellipse', fill: '#0000ff' })) as HTMLElement;
    expect(ellipse.style.borderRadius).toBe('50%');
    expect(ellipse.style.border).toBe('');
    const line = renderShape(element('shape', { shape: 'line', stroke: '#ffffff', strokeWidth: 0.004 })) as HTMLElement;
    expect(line.style.backgroundColor).toBe('');
    const bar = line.firstElementChild as HTMLElement;
    expect(bar.className).toBe('ta-stroke');
    expect(bar.style.height).toBe('0.4cqh');
    expect(bar.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('never applies a value that fails its check, and draws nothing for an unknown shape', () => {
    const node = renderShape(
      element('shape', { shape: 'rectangle', fill: 'url(javascript:x)', stroke: 'red', strokeWidth: 5, opacity: 3 }),
    ) as HTMLElement;
    expect(node.getAttribute('style')).toBeNull();
    expect(renderShape(element('shape', { shape: 'star', fill: '#ffffff' }))).toBeNull();
    expect(renderShape(element('shape', '<svg onload=x>'))).toBeNull();
  });

  it('names a shape with a label as an image, and hides a decorative one', () => {
    const named = renderShape(element('shape', { shape: 'ellipse' }, { label: 'A sun' })) as HTMLElement;
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('A sun');
    expect(named.hasAttribute('aria-hidden')).toBe(false);
    const decorative = renderShape(element('shape', { shape: 'ellipse' }, { label: 'x', decorative: true }));
    expect(decorative?.getAttribute('aria-hidden')).toBe('true');
    expect(decorative?.hasAttribute('role')).toBe(false);
  });
});

describe('renderEmoji', () => {
  it('renders the emoji as one text node in the emoji fonts, sized to its box, named by its label', () => {
    const node = renderEmoji(element('emoji', { emoji: '👩🏽‍💻' }, { label: 'woman technologist' })) as HTMLElement;
    expect(node.className).toBe('ta-el ta-emoji');
    expect(node.childNodes).toHaveLength(1);
    expect(node.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('👩🏽‍💻');
    expect(node.style.fontFamily).toContain('Apple Color Emoji');
    expect(node.style.fontSize).toBe('11.25cqh');
    expect(node.getAttribute('role')).toBe('img');
    expect(node.getAttribute('aria-label')).toBe('woman technologist');
    expect(node.querySelector('img')).toBeNull();
  });

  it('stays text without a label, and never parses markup', () => {
    const plain = renderEmoji(element('emoji', { emoji: '<img src=x onerror=alert(1)>' })) as HTMLElement;
    expect(plain.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(plain.children).toHaveLength(0);
    expect(plain.hasAttribute('role')).toBe(false);
    expect(renderEmoji(element('emoji', { emoji: '‮\u0000' }))).toBeNull();
    expect(renderEmoji(element('emoji', { emoji: 42 }))).toBeNull();
  });
});

describe('renderSticker', () => {
  it('shows the whole image with its alt text, without a corner radius', () => {
    const img = renderSticker(
      element('sticker', { url: URL_PNG, opacity: 0.4, fit: 'cover', radius: 0.2 }, { label: 'A party hat' }),
      { reducedMotion: false },
    ) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.alt).toBe('A party hat');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.borderRadius).toBe('');
    expect(img.style.opacity).toBe('0.4');
  });

  it('is still under reduced motion, and nothing without an http(s) URL', () => {
    const still = renderSticker(element('sticker', { url: URL_PNG }, { label: 'Hat' }), { reducedMotion: true });
    expect(still?.tagName).toBe('CANVAS');
    expect(still?.getAttribute('aria-label')).toBe('Hat');
    expect(renderSticker(element('sticker', { url: 'javascript:alert(1)' }), { reducedMotion: false })).toBeNull();
    expect(renderSticker(element('sticker', { mediaKey: 'media/a.png' }), { reducedMotion: false })).toBeNull();
  });
});

describe('the document renderer with shapes, emoji and stickers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers a renderer for each new type and places them like any element', () => {
    expect(['shape', 'emoji', 'sticker'].every((type) => ELEMENT_RENDERERS.has(type))).toBe(true);
    const doc: DeliveryTaleDocument = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        element('shape', { shape: 'rectangle', fill: '#ffffff' }, { decorative: true }),
        element('emoji', { emoji: '🎉' }, { label: 'party popper' }),
        element('sticker', { url: URL_PNG }, { decorative: true }),
      ],
    };
    const area = renderTaleDocument(doc);
    const shape = area.querySelector('.ta-shape') as HTMLElement;
    expect(shape.style.left).toBe('10%');
    expect(shape.style.zIndex).toBe('1');
    expect((area.querySelector('.ta-emoji') as HTMLElement).style.zIndex).toBe('2');
    const sticker = area.querySelector('img') as HTMLImageElement;
    expect(sticker.alt).toBe('');
    expect(sticker.getAttribute('aria-hidden')).toBe('true');
    expect(area.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it('skips the new types in an SDK that does not know them, with one warning per type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc: DeliveryTaleDocument = {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        element('hologram', { shape: 'rectangle' }),
        element('hologram', {}),
        element('emoji', { emoji: '😀' }),
      ],
    };
    const area = renderTaleDocument(doc);
    expect(area.querySelectorAll('.ta-el')).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
