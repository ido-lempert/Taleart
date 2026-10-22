import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument, TaleElement } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { backdropKey, layersBehind, TaleBackdropSampler } from './tale-backdrop';
import { TaleStudioPage } from './tale-studio';

// Tale Studio story 7.10 (epic Tale Studio R12): contrast warnings on the element and its layer row,
// against the canvas, a shape, or the colours read behind a label over media.
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
const WAIT_FOR_TEST = { debounceMs: 3_600_000, maxWaitMs: 3_600_000, retryDelaysMs: [3_600_000] };
const box = (x: number, y: number, w = 0.8, h = 0.1, rotation = 0) => ({ x, y, w, h, rotation });
let n = 0;
const element = (type: string, b: TaleElement['box'], props: Record<string, unknown>, extra = {}): TaleElement =>
  ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    type,
    box: b,
    hidden: false,
    locked: false,
    a11y: {},
    props,
    ...extra,
  }) as TaleElement;
const photo = (b = box(0, 0, 1, 1)) =>
  element('image', b, { mediaKey: 'media/0b7c9d4e-1111-4222-8333-944455556668.jpg', fit: 'cover' }, { a11y: { label: 'Sea' } });
const doc = (elements: TaleElement[], color = '#ffffff'): TaleDocument => ({
  version: 1,
  canvas: { background: { type: 'color', color } },
  elements,
});

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('what lies behind a label (story 7.10)', () => {
  it('paints the visible layers below the label that meet it, bottom first, and texts only by their solid box', () => {
    const under = photo();
    const rect = element('shape', box(0, 0.3, 1, 0.4), { shape: 'rectangle', fill: '#ff000080' });
    const away = element('shape', box(0, 0.8, 1, 0.1), { shape: 'rectangle', fill: '#000000' });
    const hidden = element('emoji', box(0.1, 0.4, 0.1, 0.05), { emoji: '🎉' }, { hidden: true });
    const textBelow = element('text', box(0.1, 0.4), { text: 'Under' });
    const boxBelow = element('text', box(0.1, 0.4), { text: 'Boxed', background: 'box', backgroundColor: '#ffffff' });
    const label = element('text', box(0.1, 0.4), { text: 'Over' });
    const above = element('shape', box(0, 0, 1, 1), { shape: 'rectangle', fill: '#00ff00' });
    const elements = [under, rect, away, hidden, textBelow, boxBelow, label, above];
    expect(layersBehind(elements, 6).map((e) => e.id)).toEqual([under.id, rect.id, boxBelow.id]);
    expect(layersBehind(elements, 0)).toEqual([]);
  });

  it('keys samples by what lies behind the label, so a change above it or elsewhere keeps them', () => {
    const under = photo();
    const label = element('text', box(0.1, 0.4), { text: 'Over' });
    const base = doc([under, label]);
    const key = backdropKey(base, 1);
    // Restyling the label or adding a layer above it keeps the key.
    expect(backdropKey(doc([under, { ...label, props: { text: 'Over', color: '#000000' } } as TaleElement]), 1)).toBe(key);
    expect(backdropKey(doc([under, label, element('shape', box(0, 0, 1, 1), { shape: 'ellipse' })]), 1)).toBe(key);
    // Moving the label, changing the media below or the canvas changes it.
    expect(backdropKey(doc([under, { ...label, box: box(0.1, 0.5) } as TaleElement]), 1)).not.toBe(key);
    expect(backdropKey(doc([{ ...under, props: { ...under.props, fit: 'contain' } } as TaleElement, label]), 1)).not.toBe(key);
    expect(backdropKey(doc([under, label], '#000000'), 1)).not.toBe(key);
  });

  it('cannot read where there is no offscreen canvas, and says so without throwing', async () => {
    const sampler = new TaleBackdropSampler();
    await expect(sampler.sample(doc([photo(), element('text', box(0.1, 0.4), { text: 'x' })]), 1, (k) => k)).resolves.toBeNull();
  });
});

describe('Tale Studio contrast warnings (R12, story 7.10)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;
  // The colours the stand-in sampler reads behind every label, or a read that never ends.
  let behind: string[][] | null | 'pending';
  const sampled: number[] = [];
  let finish: (value: null) => void = () => undefined;

  async function open(document: TaleDocument): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document, revision: 1, published: { document: null, revision: 0 } });
    http
      .expectOne(`${API_BASE}/projects/p1/theme`)
      .flush({ projectId: 'p1', theme: {}, resolved: { ...DEFAULT_THEME, fontFamily: null } });
    http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const set = async (selector: string, value: string) => {
    const field = q<HTMLInputElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event('change'));
    await settle(fixture);
  };
  const badge = (id: string) => root.querySelector(`#studio-el-${id} .el__warn`);
  const row = (id: string) => root.querySelector(`#layer-state-${id}`)?.textContent ?? '';
  const contrast = () => root.querySelector('#ts-contrast')?.textContent?.trim() ?? '';

  beforeEach(async () => {
    behind = null;
    sampled.length = 0;
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
        {
          provide: TaleBackdropSampler,
          useValue: {
            sample: (_doc: TaleDocument, index: number) => {
              sampled.push(index);
              return behind === 'pending'
                ? new Promise<null>((resolve) => (finish = resolve))
                : Promise.resolve(behind);
            },
          },
        },
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
    // The autosave of the edits is not what these test.
    http.match(url);
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('warns about light grey text on white on the element and its layer row, and clears when it darkens', async () => {
    const text = element('text', box(0.1, 0.4), { text: 'Sale', color: '#cccccc', size: 0.03 });
    await open(doc([text]));
    expect(badge(text.id)).not.toBeNull();
    expect(badge(text.id)?.getAttribute('aria-hidden')).toBe('true');
    expect(row(text.id)).toContain('Low contrast');
    // The canvas element is described by its layer's state, so a screen reader hears the warning there too.
    expect(q(`#studio-el-${text.id}`).getAttribute('aria-describedby')).toBe(`layer-state-${text.id}`);
    q<HTMLButtonElement>(`#studio-el-${text.id}`).click();
    await settle(fixture);
    expect(contrast()).toMatch(/^Low contrast: 1\.6:1 against the canvas colour/);
    await set('#ts-color-hex', '#333333');
    expect(badge(text.id)).toBeNull();
    expect(row(text.id)).not.toContain('Low contrast');
    expect(contrast()).toMatch(/^Contrast 12\.\d:1 against the canvas colour/);
    // Never a block: nothing marks the tale as unpublishable.
    expect(root.querySelector('[aria-invalid=true]')).toBeNull();
  });

  it('shows each layer\'s place in the reading order, leaving out hidden and decorative layers', async () => {
    const backdrop = element('shape', box(0, 0, 1, 1), { shape: 'rectangle', fill: '#000000' }, { a11y: { decorative: true } });
    const right = element('text', box(0.55, 0.4, 0.4, 0.08), { text: 'Right' });
    const left = element('text', box(0.05, 0.41, 0.4, 0.08), { text: 'Left' });
    const title = element('text', box(0.1, 0.1), { text: 'Title' });
    const hidden = element('text', box(0.1, 0.05), { text: 'Hidden' }, { hidden: true });
    await open(doc([backdrop, right, left, title, hidden], '#000000'));
    const order = (id: string) => root.querySelector(`#layer-${id} .layer__order`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    expect([title, left, right].map((e) => order(e.id))).toEqual([', read #1', ', read #2', ', read #3']);
    expect(order(backdrop.id)).toBeNull();
    expect(order(hidden.id)).toBeNull();
  });

  it('marks a button label on the canvas too', async () => {
    const button = element('button', box(0.2, 0.6, 0.6, 0.08), {
      label: 'Shop',
      href: 'https://example.com',
      color: '#eeeeee',
      fill: '#ffffff',
    });
    await open(doc([button], '#000000'));
    expect(badge(button.id)).not.toBeNull();
    expect(row(button.id)).toContain('Low contrast');
  });

  it('judges a text over a photo against the colours read behind it', async () => {
    const under = photo();
    const text = element('text', box(0.1, 0.4), { text: 'Sale', color: '#ffffff', size: 0.03 });
    behind = [['#f5f5f5', '#ffffff', '#eeeeee']];
    await open(doc([under, text], '#000000'));
    expect(sampled).toEqual([1]);
    expect(badge(text.id)).not.toBeNull();
    expect(row(text.id)).toContain('Low contrast');
    q<HTMLButtonElement>(`#studio-el-${text.id}`).click();
    await settle(fixture);
    // An estimate from the picture, never a claim of conformance.
    expect(contrast()).toMatch(/^Low contrast: about 1\.\d:1 against the media behind it, so the text may be hard to read\./);
    expect(contrast()).not.toContain('WCAG');
    // A dark colour on the bright photo is enough; the photo is not read again for a colour change.
    await set('#ts-color-hex', '#111111');
    expect(contrast()).toMatch(/^Contrast about \d+\.\d:1 against the media behind it \(an estimate from the picture\)\.$/);
    expect(badge(text.id)).toBeNull();
    expect(sampled).toEqual([1]);
  });

  it('reads again when the label moves, and stops warning when an opaque box covers what lies behind', async () => {
    const under = photo();
    const text = element('text', box(0.1, 0.4), { text: 'Sale', color: '#ffffff', size: 0.03 });
    behind = [['#ffffff']];
    await open(doc([under, text], '#000000'));
    q<HTMLButtonElement>(`#studio-el-${text.id}`).click();
    await settle(fixture);
    behind = [['#000000']];
    await set('#studio-y', '20');
    expect(sampled).toEqual([1, 1]);
    expect(badge(text.id)).toBeNull();
    behind = [['#ffffff']];
    await set('#studio-y', '30');
    expect(badge(text.id)).not.toBeNull();
    await set('#ts-background', 'box');
    expect(badge(text.id)).toBeNull();
    expect(contrast()).toMatch(/against its box/);
  });

  it("says it is checking while the media loads, and that it can't check when it cannot be read", async () => {
    const under = photo();
    const text = element('text', box(0.1, 0.4), { text: 'Sale', size: 0.03 });
    behind = 'pending';
    await open(doc([under, text], '#000000'));
    q<HTMLButtonElement>(`#studio-el-${text.id}`).click();
    await settle(fixture);
    expect(contrast()).toBe('Checking the contrast against the media behind it…');
    expect(badge(text.id)).toBeNull();
    // The media cannot be read (it failed to load, or another origin forbids it).
    behind = null;
    finish(null);
    await settle(fixture);
    expect(contrast()).toContain("can't be checked over media");
    expect(row(text.id)).not.toContain('Low contrast');
  });
});
