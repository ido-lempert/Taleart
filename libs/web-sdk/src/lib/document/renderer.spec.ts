import {
  SYSTEM_FONT_STACKS,
  textFontFamily,
  type DeliveryTaleDocument,
  type DeliveryTaleElement,
} from '@taleart/contract';
import { createTranslate } from '../i18n';
import { DOCUMENT_STYLES, renderTaleDocument } from './renderer';

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
    const line = p.firstElementChild as HTMLElement;
    expect(p.children).toHaveLength(1);
    expect(line.className).toBe('ta-line');
    expect(line.children).toHaveLength(1);
    const span = line.firstElementChild as HTMLElement;
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

  it('lets each text take its direction from its own first strong character', () => {
    const area = renderTaleDocument(doc([text('a', 'מבצע: 50% off', 0.1, 0.1), text('b', 'Free — חינם', 0.1, 0.5)]));
    expect(texts(area).map((p) => p.getAttribute('dir'))).toEqual(['auto', 'auto']);
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

  it('skips an element marked hidden, as an editor copy may hold one, and keeps the z-order of the rest', () => {
    const area = renderTaleDocument(
      doc([text('a', 'Bottom'), { ...text('b', 'Hidden'), hidden: true }, text('c', 'Top', 0.1, 0.5)]),
    );
    const shown = texts(area);
    expect(shown.map((p) => p.textContent)).toEqual(['Bottom', 'Top']);
    expect(shown.map((p) => p.style.zIndex)).toEqual(['1', '2']);
  });
});

describe('text style (story 7.4)', () => {
  const styled = (props: Record<string, unknown>, value = 'Styled') =>
    texts(renderTaleDocument(doc([text('a', value, 0.1, 0.2, { props: { text: value, ...props } as never })])))[0];
  const sans = SYSTEM_FONT_STACKS.sans;
  const serif = SYSTEM_FONT_STACKS.serif;

  it('renders a text without style as before: sans, 600, 4 % of the canvas, white, centred, its own direction', () => {
    const p = styled({});
    expect(p.style.fontFamily).toBe(sans);
    expect(p.style.fontWeight).toBe('600');
    expect(p.style.fontSize).toBe('4cqh');
    expect(p.style.lineHeight).toBe('1.25');
    expect(p.style.color).toBe('rgb(255, 255, 255)');
    expect(p.style.textAlign).toBe('center');
    expect(p.style.fontStyle).toBe('normal');
    expect(p.style.backgroundColor).toBe('');
    expect(p.getAttribute('dir')).toBe('auto');
  });

  it('applies every setting through CSSOM', () => {
    const p = styled({
      font: { source: 'system', stack: 'serif' },
      size: 0.12,
      weight: 'regular',
      italic: true,
      color: '#ff0000',
      align: 'end',
      direction: 'rtl',
      lineHeight: 1.6,
      background: 'box',
      backgroundColor: '#000000',
    });
    expect(p.style.fontFamily).toBe(serif);
    expect(p.style.fontSize).toBe('12cqh');
    expect(p.style.fontWeight).toBe('400');
    expect(p.style.fontStyle).toBe('italic');
    expect(p.style.color).toBe('rgb(255, 0, 0)');
    expect(p.style.textAlign).toBe('end');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.style.lineHeight).toBe('1.6');
    expect(p.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(p.querySelector<HTMLElement>('.ta-glyphs')?.style.backgroundColor).toBe('');
  });

  it.each([
    ['regular', '400'],
    ['medium', '500'],
    ['bold', '700'],
  ])('maps the %s weight to %s', (weight, css) => {
    expect(styled({ weight }).style.fontWeight).toBe(css);
  });

  it.each(['auto', 'rtl', 'ltr'])('sets the %s direction as the dir attribute', (direction) => {
    expect(styled({ direction }, 'שלום world').getAttribute('dir')).toBe(direction);
  });

  it('aligns start and end logically, so they follow the direction', () => {
    expect(styled({ align: 'start' }).style.textAlign).toBe('start');
    expect(DOCUMENT_STYLES).not.toMatch(/text-align: (left|right)/);
  });

  it('highlights each line of the glyphs, not the box', () => {
    const p = styled({ background: 'highlight', backgroundColor: '#ffcc00' });
    const glyphs = p.querySelector<HTMLElement>('.ta-glyphs') as HTMLElement;
    expect(p.style.backgroundColor).toBe('');
    expect(glyphs.classList.contains('ta-hl')).toBe(true);
    expect(glyphs.style.backgroundColor).toBe('rgb(255, 204, 0)');
    expect(DOCUMENT_STYLES).toMatch(/\.ta-hl \{[^}]*box-decoration-break: clone;/);
  });

  it('puts a named font, quoted, before its fallback stack', () => {
    expect(styled({ font: { source: 'name', family: 'Inter' }, fallback: 'serif' }).style.fontFamily).toBe(
      `"Inter", ${serif}`,
    );
    // CSS refuses `Source Sans 3` bare (a word starting with a digit); quoted, it applies.
    expect(styled({ font: { source: 'name', family: 'Source Sans 3' } }).style.fontFamily).toBe(
      `"Source Sans 3", ${sans}`,
    );
  });

  it("reads the theme's font from the theme's custom property, with the fallback stack", () => {
    const value = textFontFamily({ font: { source: 'theme' }, fallback: 'sans' });
    expect(value).toBe(`var(--ta-font, ${sans}), ${sans}`);
    expect(styled({ font: { source: 'theme' } }).style.getPropertyValue('font-family')).toBe(value);
  });

  it.each([
    ['font', { source: 'name', family: 'inherit' }, 'fontFamily', sans],
    ['font', { source: 'name', family: 'x;color:red' }, 'fontFamily', sans],
    ['color', 'red; background:url(x)', 'color', 'rgb(255, 255, 255)'],
    ['backgroundColor', 'url(x)', 'backgroundColor', 'rgb(0, 0, 0)'],
    ['size', 0.5, 'fontSize', '4cqh'],
    ['lineHeight', 40, 'lineHeight', '1.25'],
    ['align', 'left', 'textAlign', 'center'],
  ])('falls back to the default for an invalid %s (%j)', (field, value, css, expected) => {
    const props: Record<string, unknown> = { [field]: value };
    if (field === 'backgroundColor') props['background'] = 'box';
    const p = styled(props);
    expect((p.style as unknown as Record<string, string>)[css]).toBe(expected);
  });

  it('keeps an invalid direction at auto, and never writes a style attribute from content', () => {
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute');
    const p = styled({ direction: 'up;x', color: '#00ff00' });
    expect(p.getAttribute('dir')).toBe('auto');
    expect(setAttribute.mock.calls.some(([name]) => name === 'style')).toBe(false);
    setAttribute.mockRestore();
  });
});

describe('renderTaleDocument strings', () => {
  it('shows a poll and a button in the locale of the t it is given, through the full renderer path', () => {
    const hebrew = createTranslate('he-IL', {
      he: { 'poll.previewNotRecorded': 'ההצבעות לא נשמרות בתצוגה המקדימה.', 'links.newTab': ' (נפתח בלשונית חדשה)' },
    });
    const poll: DeliveryTaleElement = {
      id: '00000000-0000-4000-8000-0000000000a1',
      type: 'poll',
      box: box(0.1, 0.4, { w: 0.8, h: 0.3 }),
      a11y: {},
      props: { question: 'Tea?', theme: 'light', options: [{ id: 'tea', label: 'Tea' }, { id: 'coffee', label: 'Coffee' }] } as never,
    };
    const button: DeliveryTaleElement = {
      id: '00000000-0000-4000-8000-0000000000a2',
      type: 'button',
      box: box(0.1, 0.8),
      a11y: {},
      props: { label: 'Go', href: 'https://example.com/', newTab: true } as never,
    };
    const node = renderTaleDocument(
      { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [poll, button] },
      { t: hebrew },
    );
    // No response client, so a press records nothing and shows the preview's message in the poll's live region.
    (node.querySelector('.ta-poll-opt') as HTMLButtonElement).click();
    expect(node.querySelector('.ta-poll [aria-live]')?.textContent).toBe('You chose Tea. ההצבעות לא נשמרות בתצוגה המקדימה.');
    expect(node.querySelector('a.ta-button .ta-sr')?.textContent).toBe(' (נפתח בלשונית חדשה)');
  });
});
