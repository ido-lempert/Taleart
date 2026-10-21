import type { DeliveryTale, DeliveryTaleDocument, DeliveryTaleGroup } from '@taleart/contract';
import { IMAGE_DURATION_MS, TaleViewer } from './viewer';

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

  it("shows the document's text over the tale's media, above the tap zones and below the controls", () => {
    viewer.open('g');
    const area = dialog().querySelector('.ta-area') as HTMLElement;
    expect(area).not.toBeNull();
    const canvas = area.querySelector('.ta-canvas') as HTMLElement;
    expect(canvas.firstElementChild?.tagName).toBe('IMG');
    expect((canvas.firstElementChild as HTMLImageElement).src).toBe(`${API}/media/tales/t1.png`);
    const text = canvas.querySelector('p.ta-text') as HTMLElement;
    expect(text.textContent).toBe('<b>Hello</b>');
    expect(text.querySelector('b')).toBeNull();
    // The canvas sits between the stage (tap zones) and the top bar (progress, controls).
    expect(area.previousElementSibling?.classList.contains('stage')).toBe(true);
    expect(area.nextElementSibling?.classList.contains('top')).toBe(true);
    expect(dialog().querySelector('.stage .media')).toBeNull();
  });

  it('does not step when the text is clicked', () => {
    viewer.open('g');
    const text = dialog().querySelector('p.ta-text') as HTMLElement;
    text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(position()).toBe('1');
  });

  it('renders a tale without a document exactly as before, and removes the canvas when it moves on', () => {
    viewer.open('g');
    viewer.next();
    expect(dialog().querySelector('.ta-area')).toBeNull();
    expect(dialog().querySelector('.stage img.media')?.getAttribute('src')).toBe(`${API}/media/tales/t2.png`);
  });

  it("uses the document's duration, and shows text on its background without a media placeholder", () => {
    viewer.open('g');
    viewer.next();
    viewer.next();
    expect(position()).toBe('3');
    const canvas = dialog().querySelector('.ta-canvas') as HTMLElement;
    expect(canvas.querySelector('.media')).toBeNull();
    expect(canvas.querySelector('p.ta-text')?.textContent).toBe('Text only');
    vi.advanceTimersByTime(IMAGE_DURATION_MS);
    expect(position()).toBe('3');
    vi.advanceTimersByTime(8000 - IMAGE_DURATION_MS);
    expect(position()).toBe('4');
  });
});
