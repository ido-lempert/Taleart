import type { DeliveryTaleDocument, DeliveryTaleElement } from '@taleart/contract';
import { linkHref, renderButton, renderImageButton, renderSwipeUp } from './links';
import { ELEMENT_RENDERERS, renderTaleDocument } from './renderer';

// Tale Studio story 7.7: buttons, image buttons and the swipe-up link (R7, R14; AD-16).
function element(type: string, props: unknown, extra: Partial<DeliveryTaleElement> = {}): DeliveryTaleElement {
  return {
    id: crypto.randomUUID(),
    type,
    box: { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
    a11y: {},
    props: props as DeliveryTaleElement['props'],
    ...extra,
  };
}

const ch = (code: number) => String.fromCharCode(code);
const button = (extra: Record<string, unknown> = {}) =>
  element('button', {
    label: 'Shop now',
    variant: 'filled',
    color: '#111827',
    fill: '#ffffff',
    radius: 0.03,
    href: 'https://example.com/shop',
    ...extra,
  });
const swipeUp = (extra: Record<string, unknown> = {}, box = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 }) =>
  element(
    'swipe-up',
    { label: 'See more', color: '#ffffff', background: '#000000b3', href: 'https://example.com/more', ...extra },
    { box },
  );
const imageButton = (
  extra: Record<string, unknown> = {},
  a11y: DeliveryTaleElement['a11y'] = { label: 'Shop the look' },
) =>
  element(
    'image-button',
    { url: 'https://cdn.example/media/look.png', href: 'https://example.com/look', ...extra },
    { a11y },
  );

describe('linkHref: the scheme checked again (AD-16)', () => {
  it('keeps absolute http and https URLs', () => {
    expect(linkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(linkHref('HTTP://EXAMPLE.COM')).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    `java${ch(9)}script:alert(1)`,
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://example.com',
    '/relative',
    '//example.com',
    'https://user:pass@example.com',
    `https://example.com/${'a'.repeat(2048)}`,
    42,
    undefined,
  ])('refuses %s', (value) => {
    expect(linkHref(value)).toBeNull();
  });
});

describe('renderButton', () => {
  it('is a real link, named by its label, in the same tab, without opener or referrer', () => {
    const a = renderButton(button()) as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.className).toBe('ta-el ta-cta ta-button');
    expect(a.getAttribute('href')).toBe('https://example.com/shop');
    expect(a.rel).toBe('noopener noreferrer');
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.textContent).toBe('Shop now');
    expect(a.childNodes).toHaveLength(1);
    expect(a.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(a.hasAttribute('aria-hidden')).toBe(false);
  });

  it('opens a new tab with noopener when asked', () => {
    const a = renderButton(button({ newTab: true })) as HTMLAnchorElement;
    expect(a.target).toBe('_blank');
    // The name says so, in a visually hidden note after the label.
    expect(a.textContent).toBe('Shop now (opens in a new tab)');
    expect(a.querySelector('.ta-sr')?.textContent).toBe(' (opens in a new tab)');
    expect(renderSwipeUp(swipeUp({ newTab: true }))?.textContent).toBe('See more (opens in a new tab)');
    expect(renderButton(button())?.querySelector('.ta-sr')).toBeNull();
    expect(a.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });

  it('styles a filled and an outline button through CSSOM', () => {
    const filled = renderButton(button()) as HTMLElement;
    expect(filled.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(filled.style.color).toBe('rgb(17, 24, 39)');
    expect(filled.style.borderRadius).toBe('3cqh');
    expect(filled.style.fontSize).toBe('2.8cqh');
    expect(filled.getAttribute('style')).not.toContain('url(');
    const outline = renderButton(button({ variant: 'outline', fill: '#ff0000' })) as HTMLElement;
    expect(outline.style.backgroundColor).toBe('');
    expect(outline.style.borderColor).toBe('rgb(255, 0, 0)');
    expect(outline.style.borderStyle).toBe('solid');
  });

  it('sets markup in a label as literal text', () => {
    const a = renderButton(button({ label: '<img src=x onerror=alert(1)>' })) as HTMLElement;
    expect(a.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(a.querySelector('img')).toBeNull();
  });

  it('renders nothing for a destination that fails the check, or without a label', () => {
    expect(renderButton(button({ href: 'javascript:alert(1)' }))).toBeNull();
    expect(renderButton(button({ href: 'ftp://example.com' }))).toBeNull();
    expect(renderButton(button({ href: undefined }))).toBeNull();
    expect(renderButton(button({ label: ch(0x202e) }))).toBeNull();
  });

  it('falls back on checked values for bad colours', () => {
    const a = renderButton(button({ color: 'red;background:url(x)', fill: 'expression(x)' })) as HTMLElement;
    expect(a.style.color).toBe('rgb(17, 24, 39)');
    expect(a.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });
});

describe('renderImageButton', () => {
  it('is a link holding its image, named by its alt text', () => {
    const a = renderImageButton(imageButton({ newTab: true }), { reducedMotion: false }) as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    // A new tab is said in the name (WCAG 3.2.5 advisory).
    expect(a.getAttribute('aria-label')).toBe('Shop the look (opens in a new tab)');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    const img = a.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example/media/look.png');
    expect(img.alt).toBe('');
    expect(img.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps an animated image still under reduced motion', () => {
    const a = renderImageButton(imageButton({ url: 'https://cdn.example/media/look.gif' }), { reducedMotion: true });
    expect(a?.querySelector('canvas')).not.toBeNull();
    expect(a?.querySelector('img')).toBeNull();
  });

  it('is named by its destination host without alt text, even marked decorative', () => {
    const a = renderImageButton(imageButton({}, { decorative: true }), { reducedMotion: false }) as HTMLElement;
    expect(a.getAttribute('aria-label')).toBe('example.com');
  });

  it('renders nothing without a usable destination or image URL', () => {
    expect(renderImageButton(imageButton({ href: 'data:text/html,x' }), { reducedMotion: false })).toBeNull();
    expect(renderImageButton(imageButton({ url: 'javascript:x' }), { reducedMotion: false })).toBeNull();
  });
});

describe('renderSwipeUp', () => {
  it('is a link named by its label, with an arrow hidden from assistive technology', () => {
    const a = renderSwipeUp(swipeUp()) as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.className).toBe('ta-el ta-cta ta-swipe');
    expect(a.getAttribute('href')).toBe('https://example.com/more');
    expect(a.rel).toBe('noopener noreferrer');
    expect(a.textContent).toBe('See more');
    expect(a.querySelector('.ta-swipe-arrow')?.getAttribute('aria-hidden')).toBe('true');
    expect((a.querySelector('.ta-swipe-label') as HTMLElement).style.backgroundColor).toBe('rgba(0, 0, 0, 0.7)');
  });

  it('renders nothing for a javascript: destination', () => {
    expect(renderSwipeUp(swipeUp({ href: 'javascript:alert(1)' }))).toBeNull();
  });
});

describe('links in a document', () => {
  const doc = (elements: DeliveryTaleElement[]): DeliveryTaleDocument => ({
    version: 1,
    canvas: { background: { type: 'color', color: '#000000' } },
    elements,
  });

  it('registers the three renderers', () => {
    expect(['button', 'image-button', 'swipe-up'].every((type) => ELEMENT_RENDERERS.has(type))).toBe(true);
  });

  it('pins the swipe-up link to the bottom safe area, whatever its box says, and draws one only', () => {
    const area = renderTaleDocument(
      doc([swipeUp({}, { x: 0, y: 0, w: 1, h: 1, rotation: 30 }), swipeUp({ label: 'Second' })]),
    );
    const links = area.querySelectorAll('a.ta-swipe');
    expect(links).toHaveLength(1);
    const a = links[0] as HTMLElement;
    expect(a.textContent).toBe('See more');
    expect(a.style.top).toBe('87%');
    expect(a.style.left).toBe('20%');
    expect(a.style.width).toBe('60%');
    expect(a.style.transform).toBe('');
  });

  it('never hides a link from assistive technology, even marked decorative', () => {
    const area = renderTaleDocument(doc([button({}), { ...button(), a11y: { decorative: true } }]));
    for (const a of area.querySelectorAll('a')) expect(a.hasAttribute('aria-hidden')).toBe(false);
  });

  it('puts links in reading order with the other elements, focusable', () => {
    const area = renderTaleDocument(
      doc([
        swipeUp(),
        button(),
        element('text', { text: 'Title' }, { box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 } }),
      ]),
    );
    const order = [...area.querySelectorAll('.ta-el')].map((n) => n.textContent);
    expect(order).toEqual(['Title', 'Shop now', 'See more']);
    for (const a of area.querySelectorAll('a')) expect((a as HTMLAnchorElement).tabIndex).toBe(0);
  });
});
