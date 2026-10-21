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
    expect(p.childNodes).toHaveLength(1);
    expect(p.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(p.textContent).toBe('<b>x</b>\n<img src=x onerror=alert(1)>');
    expect(area.querySelector('b, img')).toBeNull();
  });

  it('places each element from its box through CSSOM, without a style attribute from content', () => {
    const area = renderTaleDocument(
      doc([text('a', 'Hi', 0.1, 0.25, { box: { x: 0.1, y: 0.25, w: 0.8, h: 0.2, rotation: 15 } })]),
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

  it('puts the background below the elements and ignores a colour that is not hex', () => {
    const media = document.createElement('img');
    const area = renderTaleDocument(doc([text('a', 'Over')], 'red;x'), media);
    expect(canvasOf(area).firstElementChild).toBe(media);
    expect(canvasOf(area).style.backgroundColor).toBe('');
  });
});
