import type { DeliveryTale, DeliveryTaleDocument, DeliveryTaleGroup } from '@taleart/contract';
import { IMAGE_DURATION_MS, TaleViewer, VIEWER_STYLES } from './viewer';

const API = 'https://api.example.com';

function doc(text: string, extra: Partial<DeliveryTaleDocument> = {}): DeliveryTaleDocument {
  return {
    version: 1,
    canvas: { background: { type: 'color', color: '#000000' } },
    elements: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        type: 'text',
        box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
        a11y: {},
        props: { text } as never,
      },
    ],
    ...extra,
  };
}

function tale(id: string, document: DeliveryTaleDocument | null, media = true): DeliveryTale {
  return {
    id,
    title: `Tale ${id}`,
    media: media ? { kind: 'image', contentType: 'image/png', url: `${API}/media/tales/${id}.png` } : null,
    document,
  };
}

let host: HTMLElement;
let viewer: TaleViewer;
const dialog = () => host.querySelector('dialog') as HTMLDialogElement;
const position = () => `${dialog().querySelectorAll('.segment.done').length + 1}`;

describe('TaleViewer with tale documents (AD-16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    const groups: DeliveryTaleGroup[] = [
      {
        id: 'g',
        name: 'G',
        cover: null,
        tales: [
          tale('t1', doc('<b>Hello</b>')),
          tale('t2', null),
          tale('t3', doc('Text only', { durationMs: 8000 }), false),
          tale('t4', null),
        ],
      },
    ];
    viewer = new TaleViewer(host, groups);
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the document's text over the tale's media, framed as a tale without a document", () => {
    viewer.open('g');
    const area = dialog().querySelector('.ta-area') as HTMLElement;
    expect(area).not.toBeNull();
    const canvas = area.querySelector('.ta-canvas') as HTMLElement;
    const text = canvas.querySelector('p.ta-text') as HTMLElement;
    expect(text.textContent).toBe('<b>Hello</b>');
    expect(text.querySelector('b')).toBeNull();
    // The media stays full-bleed in the stage, exactly where a tale without a document has it.
    const media = dialog().querySelector('.stage > img.media') as HTMLImageElement;
    expect(media.getAttribute('src')).toBe(`${API}/media/tales/t1.png`);
    expect(media.alt).toBe('Tale t1');
    expect(canvas.querySelector('.media')).toBeNull();
    // With media, the canvas paints no colour over it and the image names the tale.
    expect(canvas.style.backgroundColor).toBe('');
    expect(canvas.hasAttribute('aria-label')).toBe(false);
    // The canvas sits between the stage (tap zones) and the top bar (progress, controls).
    expect(area.previousElementSibling?.classList.contains('stage')).toBe(true);
    expect(area.nextElementSibling?.classList.contains('top')).toBe(true);
  });

  it('does not step when the text is clicked', () => {
    viewer.open('g');
    const glyphs = dialog().querySelector('p.ta-text .ta-glyphs') as HTMLElement;
    glyphs.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(position()).toBe('1');
  });

  it("lets taps through the empty part of a text's box: only the glyphs take pointer events", () => {
    expect(VIEWER_STYLES).toMatch(/\.ta-text \{[^}]*pointer-events: none;/);
    expect(VIEWER_STYLES).toMatch(/\.ta-glyphs \{[^}]*pointer-events: auto;/);
    expect(VIEWER_STYLES).toMatch(/\.ta-area \{[^}]*pointer-events: none;/);
  });

  it('keeps the context menu and touch moves on the text, for selecting it, and blocks them elsewhere', () => {
    viewer.open('g');
    const glyphs = dialog().querySelector('p.ta-text .ta-glyphs') as HTMLElement;
    const stage = dialog().querySelector('.stage') as HTMLElement;
    const fire = (target: Element, event: Event) => {
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const menu = () => new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const move = () => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{}] });
      return event;
    };
    expect(fire(glyphs, menu())).toBe(false);
    expect(fire(glyphs, move())).toBe(false);
    expect(fire(stage, menu())).toBe(true);
    expect(fire(stage, move())).toBe(true);
  });

  it('names an empty document without media by the tale title', () => {
    const empty = new TaleViewer(host, [
      { id: 'e', name: 'E', cover: null, tales: [tale('e1', { ...doc('x'), elements: [] }, false)] },
    ]);
    empty.open('e');
    const canvas = host.querySelector('dialog .ta-canvas') as HTMLElement;
    expect(canvas.getAttribute('aria-label')).toBe('Tale e1');
    expect(canvas.children).toHaveLength(0);
    empty.close();
  });

  it("paints a document tale's canvas colour behind its media, and leaves other tales black", () => {
    const colored = new TaleViewer(host, [
      {
        id: 'c',
        name: 'C',
        cover: null,
        tales: [
          tale('c1', doc('x', { canvas: { background: { type: 'color', color: '#112233' } } })),
          tale('c2', null),
          tale('c3', doc('x', { canvas: { background: { type: 'color', color: 'red;x' } } })),
        ],
      },
    ]);
    colored.open('c');
    const stage = () => host.querySelector('dialog .stage') as HTMLElement;
    expect(stage().style.backgroundColor).toBe('rgb(17, 34, 51)');
    // Behind the media, which stays on top of it.
    expect(stage().querySelector('img.media')).not.toBeNull();
    colored.next();
    expect(stage().style.backgroundColor).toBe('');
    colored.next();
    expect(stage().style.backgroundColor).toBe('');
    colored.close();
  });

  it('renders a tale without a document exactly as before, and removes the canvas when it moves on', () => {
    viewer.open('g');
    viewer.next();
    expect(dialog().querySelector('.ta-area')).toBeNull();
    expect(dialog().querySelector('.stage img.media')?.getAttribute('src')).toBe(`${API}/media/tales/t2.png`);
  });

  it("uses the document's duration, and shows text on its background, named by the tale's title", () => {
    viewer.open('g');
    viewer.next();
    viewer.next();
    expect(position()).toBe('3');
    const canvas = dialog().querySelector('.ta-canvas') as HTMLElement;
    expect(dialog().querySelector('.media')).toBeNull();
    expect(canvas.querySelector('p.ta-text')?.textContent).toBe('Text only');
    // Without media to carry it, the canvas carries the tale's name.
    expect(canvas.getAttribute('role')).toBe('group');
    expect(canvas.getAttribute('aria-label')).toBe('Tale t3');
    expect(canvas.style.backgroundColor).toBe('rgb(0, 0, 0)');
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('3');
    vi.advanceTimersByTime(8000 - IMAGE_DURATION_MS);
    expect(position()).toBe('4');
  });
});
