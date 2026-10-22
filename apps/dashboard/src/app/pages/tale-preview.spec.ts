import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { TaleStudioPage } from './tale-studio';

// Tale Studio story 7.9 (R10, AD-16): the preview mounts the Web SDK's viewer on the unsaved document.

const url = `${API_BASE}/tales/t1/document`;
const tale = {
  id: 't1',
  taleGroupId: 'g1',
  projectId: 'p1',
  title: 'Beach',
  position: 0,
  status: 'live',
  storedStatus: 'live',
  startsAt: null,
  endsAt: null,
  media: null,
};
const group = { id: 'g1', name: 'Summer', projectId: 'p1', tales: [tale] } as unknown as ZoneTaleGroup;
const IMAGE = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const box = (y: number) => ({ x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 });
const base = { a11y: {}, hidden: false, locked: false };
const DOC = {
  version: 1,
  canvas: { background: { type: 'color', color: '#123456' } },
  durationMs: 7000,
  elements: [
    { ...base, id: 'img', type: 'image', box: box(0.05), a11y: { label: 'Sea' }, props: { mediaKey: IMAGE, fit: 'cover' } },
    { ...base, id: 'txt', type: 'text', box: box(0.2), props: { text: 'Hello' } },
    { ...base, id: 'shp', type: 'shape', box: box(0.35), props: { shape: 'rectangle', fill: '#ff0000' } },
    { ...base, id: 'emo', type: 'emoji', box: box(0.5), props: { emoji: '🎉' } },
    {
      ...base,
      id: 'btn',
      type: 'button',
      box: box(0.65),
      props: { label: 'Shop now', variant: 'filled', color: '#111827', fill: '#ffffff', href: 'https://example.com/shop' },
    },
    { ...base, id: 'hid', type: 'text', box: box(0.8), hidden: true, props: { text: 'Hidden layer' } },
  ],
} as unknown as TaleDocument;

const WAIT_FOR_TEST = { debounceMs: 3_600_000, maxWaitMs: 3_600_000, retryDelaysMs: [3_600_000] };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('Tale Studio preview (epic Tale Studio R10)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const shadow = () => q<HTMLElement>('#preview-host').shadowRoot as ShadowRoot;
  const inPreview = <T extends Element>(selector: string) => shadow().querySelector(selector) as T | null;
  const previewTexts = () => [...shadow().querySelectorAll('.ta-glyphs')].map((n) => n.textContent);

  async function open(document: TaleDocument = DOC): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document, revision: 1, published: { document: null, revision: 0 } });
    http
      .expectOne(`${API_BASE}/projects/p1/theme`)
      .flush({ projectId: 'p1', theme: {}, resolved: { ...DEFAULT_THEME, accentColor: '#ff8800', fontFamily: null } });
    http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
  }

  async function openPreview(): Promise<void> {
    q<HTMLButtonElement>('#studio-preview').click();
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+$/.test(r.url))) {
      read.flush({ visibility: { visible: true, reasons: [] } });
    }
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('opens from the studio bar and mounts the SDK viewer on the document, with its chrome', async () => {
    await open();
    const toggle = q<HTMLButtonElement>('#studio-preview');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(q('#studio-preview-pane')).toBeNull();
    await openPreview();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const dialog = inPreview<HTMLDialogElement>('dialog.viewer');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(inPreview('.name')?.textContent).toBe('Summer');
    expect(inPreview('.close')).not.toBeNull();
    expect(shadow().querySelectorAll('.segment')).toHaveLength(1);
    // Every element type, rendered by the SDK; the hidden layer is not delivered, so not shown.
    expect(previewTexts()).toEqual(['Hello']);
    expect(inPreview<HTMLImageElement>('img.ta-media')?.src).toBe(
      new URL(`/api/v1/projects/p1/media/file?key=${encodeURIComponent(IMAGE)}`, location.href).href,
    );
    expect(inPreview('.ta-shape')).not.toBeNull();
    expect(inPreview('.ta-emoji')?.textContent).toBe('🎉');
    expect(inPreview('a.ta-button')?.textContent).toBe('Shop now');
    expect(shadow().textContent).not.toContain('Hidden layer');
    // The project's theme, as the visitor's viewer has it.
    expect(inPreview<HTMLElement>('.taleart')?.style.getPropertyValue('--ta-accent')).toBe('#ff8800');
  });

  it('shows an unsaved change at once', async () => {
    await open();
    await openPreview();
    q<HTMLElement>('#studio-el-txt').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle(fixture);
    const editor = q<HTMLTextAreaElement>('#studio-edit-txt');
    editor.value = 'Hello, sailor';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(previewTexts()).toEqual(['Hello, sailor']);
    // Nothing was saved for it.
    expect(http.match(url)).toHaveLength(0);
  });

  it('keeps links inert: they show but have no destination', async () => {
    await open();
    await openPreview();
    const link = inPreview<HTMLAnchorElement>('a.ta-button') as HTMLAnchorElement;
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(shadow().querySelector('a[href]')).toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('shows the phone sizes, 390 x 844 first', async () => {
    await open();
    await openPreview();
    const screen = q<HTMLElement>('.preview__screen');
    expect([screen.style.width, screen.style.height]).toEqual(['390px', '844px']);
    const select = q<HTMLSelectElement>('#preview-size');
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Small (375 × 667)',
      'Default (390 × 844)',
      'Large (430 × 932)',
    ]);
    select.value = 'large';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect([screen.style.width, screen.style.height]).toEqual(['430px', '932px']);
    select.value = 'small';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect([screen.style.width, screen.style.height]).toEqual(['375px', '667px']);
  });

  it('toggles the safe-area overlay', async () => {
    await open();
    await openPreview();
    const overlay = inPreview<HTMLElement>('.ta-safe-overlay') as HTMLElement;
    expect(overlay.hidden).toBe(true);
    const box = q<HTMLInputElement>('#preview-safe-area');
    box.click();
    fixture.detectChanges();
    expect(overlay.hidden).toBe(false);
    box.click();
    fixture.detectChanges();
    expect(overlay.hidden).toBe(true);
  });

  it('offers to play again once the tale ended or was closed, and plays the current document', async () => {
    await open();
    await openPreview();
    inPreview<HTMLButtonElement>('.close')?.click();
    await settle(fixture);
    const again = q<HTMLButtonElement>('#preview-play-again');
    expect(again).not.toBeNull();
    again.click();
    await settle(fixture);
    expect(q('#preview-play-again')).toBeNull();
    expect(inPreview('dialog')?.hasAttribute('open')).toBe(true);
    expect(previewTexts()).toEqual(['Hello']);
  });

  it('stops the viewer when the preview closes', async () => {
    await open();
    await openPreview();
    const host = q<HTMLElement>('#preview-host');
    q<HTMLButtonElement>('#studio-preview').click();
    await settle(fixture);
    expect(q('#studio-preview-pane')).toBeNull();
    expect(host.shadowRoot?.childElementCount).toBe(0);
  });
});
