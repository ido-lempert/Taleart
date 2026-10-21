import type { DeliveryTaleDocument, DeliveryTaleElement } from '@taleart/contract';
import { renderTaleDocument } from './renderer';

const box = (x: number, y: number, extra: Partial<DeliveryTaleElement['box']> = {}) => ({
  x,
  y,
  w: 0.5,
  h: 0.1,
  rotation: 0,
  ...extra,
});

function text(
  id: string,
  value: string,
  x = 0.1,
  y = 0.2,
  extra: Partial<DeliveryTaleElement> = {},
): DeliveryTaleElement {
  return {
    id,
    type: 'text',
    box: box(x, y),
    a11y: {},
    props: { text: value } as DeliveryTaleElement['props'],
    ...extra,
  };
}

function doc(elements: unknown[], color = '#112233'): DeliveryTaleDocument {
  return {
    version: 1,
    canvas: { background: { type: 'color', color } },
    elements: elements as DeliveryTaleElement[],
  };
}

const canvasOf = (area: HTMLElement) => area.querySelector('.ta-canvas') as HTMLElement;
const texts = (area: HTMLElement) => [...area.querySelectorAll<HTMLElement>('.ta-text')];

describe('renderTaleDocument', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders text as a literal text node, never as HTML', () => {
    const area = renderTaleDocument(doc([text('a', '<b>x</b>\n<img src=x onerror=alert(1)>')]));
    const [p] = texts(area);
    expect(p.tagName).toBe('P');
    const span = p.firstElementChild as HTMLElement;
    expect(p.children).toHaveLength(1);
    expect(span.className).toBe('ta-glyphs');
    expect(span.childNodes).toHaveLength(1);
    expect(span.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(p.textContent).toBe('<b>x</b>\n<img src=x onerror=alert(1)>');
    expect(area.querySelector('b, img')).toBeNull();
  });

  it('strips characters text may not hold, and keeps right-to-left text and emoji sequences', () => {
    const area = renderTaleDocument(
      doc([text('a', 'pay\u202e \u0007x\ud800', 0.1, 0.1), text('b', 'שלום \u2067עולם\u2069 👩‍👩‍👧‍👦', 0.1, 0.5)]),
    );
    expect(texts(area).map((p) => p.textContent)).toEqual(['pay x', 'שלום \u2067עולם\u2069 👩‍👩‍👧‍👦']);
  });

  it('treats inherited property names as unknown types', () => {
    const area = renderTaleDocument(
      doc([
        { ...text('c', 'x'), type: 'constructor' },
        { ...text('p', 'x'), type: '__proto__' },
        { ...text('t', 'x'), type: 'toString' },
        text('a', 'Shown'),
      ]),
    );
    expect(texts(area).map((p) => p.textContent)).toEqual(['Shown']);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('names the canvas after the tale only when asked, so a tale without media keeps its name', () => {
    const named = renderTaleDocument(doc([]), { label: 'Sunset', background: true });
    expect(canvasOf(named).getAttribute('role')).toBe('group');
    expect(canvasOf(named).getAttribute('aria-label')).toBe('Sunset');
    expect(canvasOf(named).style.backgroundColor).toBe('rgb(17, 34, 51)');
    const plain = renderTaleDocument(doc([]));
    expect(canvasOf(plain).hasAttribute('role')).toBe(false);
    expect(canvasOf(plain).style.backgroundColor).toBe('');
  });

  it('places each element from its box through CSSOM, without a style attribute from content', () => {
    const area = renderTaleDocument(
      doc([text('a', 'Hi', 0.1, 0.25, { box: { x: 0.1, y: 0.25, w: 0.8, h: 0.2, rotation: 15 } })]),
      { background: true },
    );
    const [p] = texts(area);
    expect(p.style.left).toBe('10%');
    expect(p.style.top).toBe('25%');
    expect(p.style.width).toBe('80%');
    expect(p.style.height).toBe('20%');
    expect(p.style.transform).toBe('rotate(15deg)');
    expect(p.style.fontSize).toBe('4cqh');
    expect(canvasOf(area).style.backgroundColor).toBe('rgb(17, 34, 51)');
  });

  it('stacks by document order and reads top to bottom, then left to right', () => {
    const area = renderTaleDocument(
      doc([text('low', 'Low', 0.1, 0.7), text('right', 'Right', 0.5, 0.2), text('left', 'Left', 0.1, 0.2)]),
    );
    expect(texts(area).map((p) => p.textContent)).toEqual(['Left', 'Right', 'Low']);
    expect(texts(area).map((p) => p.style.zIndex)).toEqual(['3', '2', '1']);
  });

  it('skips an unknown element type with one warning per type, and keeps the rest', () => {
    const poll = { ...text('p', 'x'), type: 'poll-test' };
    const area = renderTaleDocument(doc([poll, text('a', 'Shown'), { ...poll, id: 'p2' }]));
    expect(texts(area).map((p) => p.textContent)).toEqual(['Shown']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('poll-test');
  });

  it('skips elements that are not placeable and empty text, and hides decorative ones from screen readers', () => {
    const area = renderTaleDocument(
      doc([
        { ...text('a', 'Bad'), box: { x: 'x' } },
        null,
        text('b', ''),
        text('c', 'Decor', 0.1, 0.2, { a11y: { decorative: true } }),
      ]),
    );
    const shown = texts(area);
    expect(shown.map((p) => p.textContent)).toEqual(['Decor']);
    expect(shown[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores a background colour that is not hex', () => {
    const area = renderTaleDocument(doc([text('a', 'Over')], 'red;x'), { background: true });
    expect(canvasOf(area).style.backgroundColor).toBe('');
  });
});
