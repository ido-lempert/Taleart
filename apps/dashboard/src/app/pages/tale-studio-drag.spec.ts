import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument, TaleElement } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { STUDIO_TEST_ELEMENT_TYPES } from './tale-element-types';
import { TaleStudioPage, TOUCH_HOLD_MS } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Story 11.4 (epic Tale Studio 2 R3): dragging a palette tile onto the canvas adds the element where
// it is dropped, snapped and clamped into the safe area; a drop outside the stage, Escape or a
// cancelled pointer adds nothing; a blocked tile only says why. Each add is one undo step.
const url = `${API_BASE}/tales/t1/document`;
const tale = {
  id: 't1',
  taleGroupId: 'g1',
  projectId: 'p1',
  title: 'Beach',
  position: 0,
  status: 'live',
  startsAt: null,
  endsAt: null,
  media: null,
};
const group = { id: 'g1', name: 'Summer', projectId: 'p1', tales: [tale] } as unknown as ZoneTaleGroup;
// The stage as these tests lay it out: 300 by 600 px, 100 px from the left of the window.
const STAGE = { left: 100, top: 0, width: 300, height: 600 };

describe('Tale Studio: drag an element onto the canvas (story 11.4)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  async function open(document: TaleDocument | null = null): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document, revision: 0, published: { document: null, revision: 0 } });
    http
      .expectOne(`${API_BASE}/projects/p1/theme`)
      .flush({ projectId: 'p1', theme: {}, resolved: { ...DEFAULT_THEME, fontFamily: null } });
    http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
    const canvas = q<HTMLElement>('#studio-canvas');
    canvas.getBoundingClientRect = () => ({ ...STAGE, right: 400, bottom: 600, x: 100, y: 0 }) as DOMRect;
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const live = () => root.querySelector('p.visually-hidden[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const pointer = (
    target: Element,
    type: string,
    x: number,
    y: number,
    init: PointerEventInit = {},
  ) =>
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, pointerType: 'mouse', clientX: x, clientY: y, ...init }),
    );
  /** Presses the tile, moves over (x, y) in client px, and optionally releases there. */
  async function dragTile(id: string, x: number, y: number, release = true, init: PointerEventInit = {}) {
    const tile = q<HTMLButtonElement>(`#${id}`);
    pointer(tile, 'pointerdown', 10, 10, init);
    pointer(tile, 'pointermove', 30, 10, init);
    pointer(tile, 'pointermove', x, y, init);
    await settle(fixture);
    if (release) {
      pointer(tile, 'pointerup', x, y, init);
      // The click a release fires on the pressed button.
      tile.click();
      await settle(fixture);
    }
    return tile;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
        { provide: STUDIO_TEST_ELEMENT_TYPES, useValue: false },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+(\/responses)?$/.test(r.url))) {
      read.flush(read.request.url.endsWith('/responses') ? { elements: [] } : { visibility: { visible: true, reasons: [] } });
    }
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows a ghost at the real size, snapped, with the safe area, and adds the poll where it is dropped', async () => {
    await open();
    // The lower third, 2 px right of the centre line: the poll's centre snaps to it.
    const x = STAGE.left + 152;
    const y = 0.7 * STAGE.height;
    const tile = await dragTile('studio-add-poll', x, y, false);
    const ghost = q<HTMLElement>('.drag-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost.classList).toContain('is-over');
    // At its size on the canvas (0.8 by 0.28), centred on the centre line, clamped into the safe area.
    expect(parseFloat(ghost.style.width)).toBeCloseTo(80, 6);
    expect(parseFloat(ghost.style.height)).toBeCloseTo(28, 6);
    expect(parseFloat(ghost.style.left)).toBeCloseTo(10, 6);
    expect(parseFloat(ghost.style.top)).toBeCloseTo(56, 6);
    expect(q('.drag-ghost__at').textContent?.trim()).toBe('10%, 56%');
    expect(q<HTMLElement>('.snap-line--x').style.left).toBe('50%');
    expect(q('#studio-canvas').classList).toContain('is-drop-target');
    expect(q('.guides').classList).toContain('guides--dragging');
    expect(tile.classList).toContain('is-dragging');
    expect(doc().elements).toEqual([]);

    pointer(tile, 'pointerup', x, y);
    tile.click();
    await settle(fixture);
    expect(q('.drag-ghost')).toBeNull();
    expect(q('.snap-line--x')).toBeNull();
    expect(doc().elements.map((e) => [e.type, e.box])).toEqual([['poll', { x: 0.1, y: 0.56, w: 0.8, h: 0.28, rotation: 0 }]]);
    const id = doc().elements[0].id;
    expect(live()).toBe('Poll added at 10%, 56%. Selected.');
    expect(q(`#studio-el-${id}`).getAttribute('aria-pressed')).toBe('true');
    expect(globalThis.document.activeElement?.id).toBe(`studio-el-${id}`);
  });

  it('clamps a drop half off the stage into the safe area, and Alt places it without snapping', async () => {
    await open();
    await dragTile('studio-add-rectangle', STAGE.left + 5, STAGE.height - 5);
    expect(doc().elements[0].box).toEqual({ x: 0.04, y: 0.64, w: 0.4, h: 0.2, rotation: 0 });
    await dragTile('studio-add-ellipse', STAGE.left + 152, 300, true, { altKey: true });
    // Not snapped to the centre (0.3 would be): 2 px right of it.
    expect(doc().elements[1].box.x).toBeCloseTo(0.3067, 4);
  });

  it('adds nothing when dropped outside the stage, and the release is no click', async () => {
    await open();
    await dragTile('studio-add-rectangle', 50, 300);
    expect(q('.drag-ghost')).toBeNull();
    expect(doc().elements).toEqual([]);
    expect(live()).toBe('Not added');
  });

  it('cancels with Escape: nothing is added, then or on release', async () => {
    await open();
    const tile = await dragTile('studio-add-rectangle', STAGE.left + 150, 300, false);
    expect(q('.drag-ghost')).not.toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    tile.dispatchEvent(escape);
    await settle(fixture);
    expect(escape.defaultPrevented).toBe(true);
    expect(q('.drag-ghost')).toBeNull();
    expect(live()).toBe('Not added');
    pointer(tile, 'pointerup', STAGE.left + 150, 300);
    tile.click();
    await settle(fixture);
    expect(doc().elements).toEqual([]);
  });

  it('a cancelled pointer adds nothing', async () => {
    await open();
    const tile = await dragTile('studio-add-rectangle', STAGE.left + 150, 300, false);
    pointer(tile, 'pointercancel', STAGE.left + 150, 300);
    await settle(fixture);
    expect(q('.drag-ghost')).toBeNull();
    expect(doc().elements).toEqual([]);
    expect(live()).toBe('Not added');
  });

  it('a blocked tile does not drag: it says why, by the pointer and in the live region', async () => {
    const poll = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'poll',
      box: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { question: 'Tea?', theme: 'light', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    } as unknown as TaleElement;
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [poll] });
    const tile = await dragTile('studio-add-poll', STAGE.left + 150, 300, false);
    expect(q('.drag-ghost')).toBeNull();
    expect(q('.drag-tip').textContent).toContain('A tale holds one poll');
    expect(live()).toContain('A tale holds one poll');
    pointer(tile, 'pointerup', STAGE.left + 150, 300);
    tile.click();
    await settle(fixture);
    expect(q('.drag-tip')).toBeNull();
    expect(doc().elements.length).toBe(1);
  });

  it('drags with a finger held on the tile; a quick swipe scrolls instead', async () => {
    await open();
    const tile = q<HTMLButtonElement>('#studio-add-rectangle');
    const touch = { pointerType: 'touch' };
    pointer(tile, 'pointerdown', 10, 10, touch);
    pointer(tile, 'pointermove', 10, 40, touch);
    pointer(tile, 'pointermove', STAGE.left + 150, 300, touch);
    await settle(fixture);
    expect(q('.drag-ghost')).toBeNull();
    pointer(tile, 'pointerup', STAGE.left + 150, 300, touch);

    pointer(tile, 'pointerdown', 10, 10, touch);
    await new Promise((resolve) => setTimeout(resolve, TOUCH_HOLD_MS + 30));
    pointer(tile, 'pointermove', STAGE.left + 150, 300, touch);
    await settle(fixture);
    expect(q('.drag-ghost')).not.toBeNull();
    pointer(tile, 'pointerup', STAGE.left + 150, 300, touch);
    await settle(fixture);
    expect(doc().elements.map((e) => e.type)).toEqual(['shape']);
    expect(live()).toBe('Rectangle added at 30%, 40%. Selected. It is decorative: screen readers skip it.');
  });

  it('makes each add, dragged or clicked, one undo step', async () => {
    await open();
    await dragTile('studio-add-rectangle', STAGE.left + 150, 300);
    q<HTMLButtonElement>('#studio-add-poll').click();
    await settle(fixture);
    expect(doc().elements.map((e) => e.type)).toEqual(['shape', 'poll']);
    q<HTMLButtonElement>('#studio-undo').click();
    await settle(fixture);
    expect(doc().elements.map((e) => e.type)).toEqual(['shape']);
    q<HTMLButtonElement>('#studio-undo').click();
    await settle(fixture);
    expect(doc().elements).toEqual([]);
  });
});
