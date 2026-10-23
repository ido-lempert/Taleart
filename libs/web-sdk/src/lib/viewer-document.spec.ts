import {
  clearProjectFontLoads,
  type DeliveryTale,
  type DeliveryTaleDocument,
  type DeliveryTaleGroup,
} from '@taleart/contract';
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

// A tale as the Delivery API sends it since R16: with media, its document holds that media as the
// bottom `taleMedia` element (5 s unless the document set a duration); without a document, only it.
function tale(id: string, document: DeliveryTaleDocument | null, media = true): DeliveryTale {
  const url = `${API}/media/tales/${id}.png`;
  const own = {
    id: '00000000-0000-4000-8000-0000000000ff',
    type: 'image',
    box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    a11y: { decorative: true },
    props: { url, fit: 'contain', taleMedia: true } as never,
  };
  const base = document ?? {
    version: 1,
    canvas: { background: { type: 'color' as const, color: '#000000' } },
    elements: [],
  };
  return {
    id,
    title: `Tale ${id}`,
    media: media ? { kind: 'image', contentType: 'image/png', url } : null,
    document: media ? { durationMs: 5000, ...base, elements: [own, ...base.elements] } : document,
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
    // The tale's own media is decorative (R16): the canvas names the tale, as the media's alt text did.
    expect(media.alt).toBe('');
    expect(media.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.querySelector('.media, img')).toBeNull();
    // With media, the canvas paints no colour over it.
    expect(canvas.style.backgroundColor).toBe('');
    expect(canvas.getAttribute('aria-label')).toBe('Tale t1');
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
    // A tale of only its media has the black canvas, as the viewer always was behind it.
    colored.next();
    expect(stage().style.backgroundColor).toBe('rgb(0, 0, 0)');
    colored.next();
    expect(stage().style.backgroundColor).toBe('');
    colored.close();
  });

  it('renders a tale of only its media exactly as before: full-bleed in the stage, over an empty canvas', () => {
    viewer.open('g');
    viewer.next();
    expect(dialog().querySelectorAll('.ta-area')).toHaveLength(1);
    expect(dialog().querySelector('.ta-canvas')?.children).toHaveLength(0);
    const media = dialog().querySelector('.stage img.media') as HTMLImageElement;
    expect(media.getAttribute('src')).toBe(`${API}/media/tales/t2.png`);
    expect(media.style.objectFit).toBe('contain');
    expect(dialog().querySelectorAll('img')).toHaveLength(1);
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

describe('TaleViewer with project fonts (epic Tale Studio R18)', () => {
  const FONT_ID = '0f0e0d0c-0000-4000-8000-00000000000a';
  const FONT_URL = `${API}/media/fonts/a.woff2`;
  // A structurally sound WOFF2 file: TrueType flavour, one untransformed table, compressed data after.
  const woff2 = () => {
    const data = new Uint8Array(64);
    const view = new DataView(data.buffer);
    data.set([0x77, 0x4f, 0x46, 0x32]);
    view.setUint32(4, 0x00010000);
    view.setUint32(8, 64);
    view.setUint16(12, 1);
    view.setUint32(20, 14);
    data[49] = 0x10;
    return data.buffer;
  };
  const branded = (id: string): DeliveryTale => {
    const base = doc('Brand');
    const element = {
      ...base.elements[0],
      props: { text: 'Brand', font: { source: 'project', fontId: FONT_ID }, fallback: 'serif' } as never,
    };
    return {
      ...tale(id, { ...base, elements: [element] }),
      fonts: [{ id: FONT_ID, family: 'Brand Sans', url: FONT_URL, weight: 700, style: 'italic' }],
    };
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  let made: { family: string; descriptors: unknown }[];
  let added: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    clearProjectFontLoads();
    made = [];
    added = [];
    fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => woff2() }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(family: string, _bytes: ArrayBuffer, descriptors: unknown) {
          made.push({ family, descriptors });
        }
        async load() {
          return this;
        }
      },
    );
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (face: unknown) => added.push(face) },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    viewer = new TaleViewer(host, [
      { id: 'g', name: 'G', cover: null, tales: [tale('t1', doc('Plain')), branded('t2'), branded('t3')] },
    ]);
  });

  afterEach(() => {
    viewer.close();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  });

  it('fetches a font only when a tale that uses it opens, once, and adds it under its alias', async () => {
    viewer.open('g');
    await vi.advanceTimersByTimeAsync(0);
    // The first tale uses no project font: nothing is fetched.
    expect(fetchMock).not.toHaveBeenCalled();

    viewer.next();
    const text = dialog().querySelector('p.ta-text') as HTMLElement;
    // Drawn under its alias, then the fallback stack, which shows until the face is added.
    expect(text.style.fontFamily).toMatch(new RegExp(`^"taleart-font-${FONT_ID}", Georgia`));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(FONT_URL, expect.objectContaining({ credentials: 'omit', mode: 'cors' }));
    expect(made).toEqual([{ family: `taleart-font-${FONT_ID}`, descriptors: { weight: '700', style: 'italic' } }]);
    expect(added).toHaveLength(1);

    // Another tale with the same font, and the same tale again, fetch nothing more.
    viewer.next();
    viewer.previous();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips a font whose URL is not http(s), and keeps the fallback when the font fails', async () => {
    viewer.close();
    host.replaceChildren();
    const unsafe = {
      ...branded('t2'),
      fonts: [{ id: FONT_ID, family: 'Brand Sans', url: 'javascript:alert(1)', weight: 700, style: 'italic' }],
    };
    viewer = new TaleViewer(host, [{ id: 'g', name: 'G', cover: null, tales: [unsafe as DeliveryTale] }]);
    viewer.open('g');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    viewer.close();
    host.replaceChildren();
    fetchMock.mockRejectedValue(new Error('offline'));
    viewer = new TaleViewer(host, [{ id: 'g', name: 'G', cover: null, tales: [branded('t2')] }]);
    viewer.open('g');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(0);
    expect((dialog().querySelector('p.ta-text') as HTMLElement).textContent).toBe('Brand');
  });
});
