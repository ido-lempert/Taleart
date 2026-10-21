import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { elementBounds, type TaleDocument, type ZoneTaleGroup } from '@taleart/contract';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { TaleStudioPage } from './tale-studio';

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
  media: { kind: 'image', contentType: 'image/png', url: '/api/v1/tales/t1/media' },
};
const group = { id: 'g1', name: 'Summer', projectId: 'p1', tales: [tale] } as unknown as ZoneTaleGroup;
const existing: TaleDocument = {
  version: 1,
  canvas: { background: { type: 'color', color: '#000000' } },
  elements: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'text',
      box: { x: 0.1, y: 0.5, w: 0.8, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: 'Hi <b>there</b>' },
    },
  ],
};

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`No ${name} button`);
  return button;
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

describe('TaleStudioPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  async function open(read: { document: TaleDocument | null; revision: number }): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush(read);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
  }

  const elements = () => [...root.querySelectorAll<HTMLButtonElement>('button.el')];
  const status = () => root.querySelector('[role=status]')?.textContent?.trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it('shows a tale without a document on an empty 9:16 canvas with its media as the background', async () => {
    await open({ document: null, revision: 0 });
    const canvas = root.querySelector('.canvas') as HTMLElement;
    expect(canvas.getAttribute('aria-label')).toBe('Canvas, 9:16');
    expect(canvas.querySelector('img')?.getAttribute('src')).toBe('/api/v1/tales/t1/media');
    expect(canvas.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(elements()).toHaveLength(0);
    expect(root.querySelector('a.back-link')?.getAttribute('href')).toBe('/zones/z1');
  });

  it('shows saved text as literal text, placed from its box', async () => {
    await open({ document: existing, revision: 3 });
    const [el] = elements();
    expect(el.textContent?.trim()).toBe('Hi <b>there</b>');
    expect(el.querySelector('b')).toBeNull();
    expect(el.getAttribute('aria-label')).toBe('Text: Hi <b>there</b>');
    expect(el.style.top).toBe('50%');
    expect(el.style.left).toBe('10%');
  });

  it('adds text, types it in place, moves it with arrow keys and saves it with the revision', async () => {
    await open({ document: null, revision: 0 });
    buttonNamed(root, 'Add text').click();
    await settle(fixture);
    const field = root.querySelector('textarea.el-edit') as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    field.value = 'Hello';
    field.dispatchEvent(new Event('input'));
    key(field, 'Escape');
    await settle(fixture);
    const [el] = elements();
    expect(el.textContent?.trim()).toBe('Hello');
    expect(document.activeElement).toBe(el);
    // From 42% down: ArrowUp twice with Shift (10% each), then once (1%).
    key(el, 'ArrowUp', { shiftKey: true });
    key(el, 'ArrowUp', { shiftKey: true });
    key(el, 'ArrowUp');
    await settle(fixture);
    expect(elements()[0].style.top).toBe('21%');
    expect((root.querySelector('#studio-y') as HTMLInputElement).value).toBe('21');
    expect(root.querySelector('[aria-live=polite]')?.textContent).toContain('Text moved');

    buttonNamed(root, 'Save').click();
    await settle(fixture);
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    const body = req.request.body as { document: TaleDocument; revision: number };
    expect(body.revision).toBe(0);
    expect(body.document.elements).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        type: 'text',
        box: { x: 0.1, y: 0.21, w: 0.8, h: 0.16, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: 'Hello' },
      },
    ]);
    req.flush({ document: body.document, revision: 1 });
    await settle(fixture);
    expect(status()).toBe('Saved');

    // The next save is based on the new revision.
    buttonNamed(root, 'Save').click();
    await settle(fixture);
    const next = http.expectOne(url);
    expect((next.request.body as { revision: number }).revision).toBe(1);
    next.flush({ document: body.document, revision: 2 });
    await settle(fixture);
  });

  const live = () => root.querySelector('[aria-live=polite]')?.textContent;

  it('moves by the position fields, writing back the applied value and announcing a clamp', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const x = root.querySelector('#studio-x') as HTMLInputElement;
    x.value = '95';
    x.dispatchEvent(new Event('change'));
    // The field shows the value applied at once, even though the box did not move far enough to re-render it.
    expect(x.value).toBe('20');
    await settle(fixture);
    // The box is 80% wide, so it can start at most at 20%.
    expect(elements()[0].style.left).toBe('20%');
    expect(live()).toBe('Text moved to left 20%, as far as it goes');
    // A second clamp to the same place still writes the field back.
    x.value = '90';
    x.dispatchEvent(new Event('change'));
    expect(x.value).toBe('20');
    const y = root.querySelector('#studio-y') as HTMLInputElement;
    y.value = '30';
    y.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(y.value).toBe('30');
    expect(live()).toBe('Text moved to top 30%');
    y.value = '';
    y.dispatchEvent(new Event('change'));
    expect(y.value).toBe('30');
    await settle(fixture);
    expect(live()).toBe('Enter a number for top; it stays at 30%');
  });

  it('deletes with the Delete key only, then focuses the next element, the previous one, or the canvas', async () => {
    const second = { ...existing.elements[0], id: '00000000-0000-4000-8000-000000000002', props: { text: 'Two' } };
    await open({ document: { ...existing, elements: [...existing.elements, second] }, revision: 1 });
    key(elements()[0], 'Backspace');
    await settle(fixture);
    expect(elements()).toHaveLength(2);
    key(elements()[0], 'Delete');
    await settle(fixture);
    expect(elements()).toHaveLength(1);
    expect(document.activeElement).toBe(elements()[0]);
    expect(elements()[0].textContent).toBe('Two');
    key(elements()[0], 'Delete');
    await settle(fixture);
    expect(elements()).toHaveLength(0);
    expect(document.activeElement).toBe(root.querySelector('.canvas'));
    expect(live()).toBe('Text deleted');
  });

  it('shows text without added whitespace, and keeps the rotation while typing in place', async () => {
    const rotated = { ...existing.elements[0], box: { ...existing.elements[0].box, rotation: 15 } };
    await open({ document: { ...existing, elements: [rotated] }, revision: 1 });
    expect(elements()[0].textContent).toBe('Hi <b>there</b>');
    expect(elements()[0].style.transform).toBe('rotate(15deg)');
    key(elements()[0], 'Enter');
    await settle(fixture);
    const field = root.querySelector('textarea.el-edit') as HTMLTextAreaElement;
    expect(field.style.transform).toBe('rotate(15deg)');
  });

  it('counts the text limit in characters, emoji included, and stops input past it', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const field = root.querySelector('#studio-text') as HTMLTextAreaElement;
    expect(field.hasAttribute('maxlength')).toBe(false);
    // 1,000 emoji are 2,000 UTF-16 units but 1,000 characters: all kept.
    field.value = '😀'.repeat(1000);
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(elements()[0].textContent).toBe('😀'.repeat(1000));
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe('Up to 1,000 characters.');
    field.value = '😀'.repeat(1000) + 'ab';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(field.value).toBe('😀'.repeat(1000));
    expect(elements()[0].textContent).toBe('😀'.repeat(1000));
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe('A text holds at most 1,000 characters.');
  });

  it('removes control characters and bidi overrides from typed or pasted text, keeping line feeds and RTL text', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const field = root.querySelector('#studio-text') as HTMLTextAreaElement;
    field.value = 'שלום\u0007\nworld\u202e 👩‍👩‍👧‍👦\u2067x\u2069';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(field.value).toBe('שלום\nworld 👩‍👩‍👧‍👦\u2067x\u2069');
    expect(elements()[0].textContent).toBe('שלום\nworld 👩‍👩‍👧‍👦\u2067x\u2069');
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe(
      'Characters that text cannot hold were removed.',
    );
  });

  it('moves an element by dragging it', async () => {
    await open({ document: existing, revision: 1 });
    const canvas = root.querySelector('.canvas') as HTMLElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
    const el = elements()[0];
    const pointer = (type: string, x: number, y: number) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
    pointer('pointerdown', 100, 300);
    pointer('pointermove', 100, 180);
    pointer('pointerup', 100, 180);
    await settle(fixture);
    expect(elements()[0].style.top).toBe('30%');
  });

  it('offers to reload when the save is refused as stale', async () => {
    await open({ document: existing, revision: 1 });
    buttonNamed(root, 'Save').click();
    await settle(fixture);
    http
      .expectOne(url)
      .flush({ error: { code: 'stale_revision', message: 'stale' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Someone saved this tale after you opened it');
    buttonNamed(root, 'Reload latest version').click();
    await settle(fixture);
    const changed = { ...existing, elements: [{ ...existing.elements[0], props: { text: 'Theirs' } }] };
    http.expectOne(url).flush({ document: changed, revision: 2 });
    await settle(fixture);
    expect(elements()[0].textContent?.trim()).toBe('Theirs');
    expect(root.querySelector('[role=alert]')).toBeNull();
  });

  it('explains a refused save in plain words and marks the element its pointer names', async () => {
    await open({ document: existing, revision: 1 });
    buttonNamed(root, 'Save').click();
    await settle(fixture);
    http.expectOne(url).flush(
      {
        error: {
          code: 'invalid_tale_document',
          message: '/elements/0/props/text holds at most 1000 characters',
          pointer: '/elements/0/props/text',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    const alert = root.querySelector('[role=alert]')?.textContent ?? '';
    expect(alert).toContain('A text could not be saved');
    expect(alert).not.toContain('/elements');
    expect(elements()[0].getAttribute('aria-invalid')).toBe('true');
    expect(elements()[0].getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe('Not saved');

    buttonNamed(root, 'Save').click();
    await settle(fixture);
    http
      .expectOne(url)
      .flush({ error: { code: 'tale_document_too_large', message: 'x' } }, { status: 413, statusText: 'Too Large' });
    await settle(fixture);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('This tale is too large to save');
  });
  describe('layers, background and safe areas (story 2)', () => {
    const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const at = (n: number, text: string, y: number, extra: Partial<TaleDocument['elements'][number]> = {}) => ({
      ...existing.elements[0],
      id: ID(n),
      box: { x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 },
      props: { text },
      ...extra,
    });
    // A at the bottom of the z-order, then B, then C on top; A and B overlap.
    const three: TaleDocument = { ...existing, elements: [at(1, 'A', 0.4), at(2, 'B', 0.42), at(3, 'C', 0.2)] };

    const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.layer__select')];
    const rowNames = () => rows().map((r) => r.querySelector('.layer__name')?.textContent);
    const canvasTexts = () => elements().map((e) => e.textContent);
    const row = (n: number) => root.querySelector(`#layer-${ID(n)}`) as HTMLButtonElement;
    const canvasEl = (n: number) => root.querySelector(`#studio-el-${ID(n)}`) as HTMLButtonElement | null;
    const selected = () => rows().map((r) => r.parentElement?.getAttribute('aria-selected'));
    const state = (n: number) => root.querySelector(`#layer-state-${ID(n)}`)?.textContent?.trim();

    async function saved(): Promise<TaleDocument> {
      buttonNamed(root, 'Save').click();
      await settle(fixture);
      const req = http.expectOne(url);
      const body = req.request.body as { document: TaleDocument };
      req.flush({ document: body.document, revision: 2 });
      await settle(fixture);
      return body.document;
    }

    it('lists every layer top first, with its type and a name from its text', async () => {
      await open({ document: three, revision: 1 });
      expect(rowNames()).toEqual(['C', 'B', 'A']);
      expect(rows()[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('Text: C');
      expect(rows()[0].querySelector('svg')).not.toBeNull();
      const grid = root.querySelector('[role=grid]') as HTMLElement;
      expect(grid.getAttribute('aria-labelledby')).toBe('layers-title');
      expect(grid.getAttribute('aria-multiselectable')).toBe('true');
      expect(grid.querySelectorAll('[role=row]')).toHaveLength(3);
      expect(rows()[0].getAttribute('role')).toBe('gridcell');
      expect(rows()[0].getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowUp');
      // The state reads with the name, inside the same cell.
      expect(rows()[0].querySelector(`#layer-state-${ID(3)}`)).not.toBeNull();
    });

    it('reorders from the list with the keyboard only, and the canvas and the saved document follow', async () => {
      await open({ document: three, revision: 1 });
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'A', 'B']);
      expect(canvasTexts()).toEqual(['B', 'A', 'C']);
      expect(canvasEl(1)?.style.zIndex).toBe('2');
      expect(canvasEl(2)?.style.zIndex).toBe('1');
      expect(document.activeElement).toBe(row(1));
      expect(live()).toBe('Layer brought forward');
      key(row(1), 'ArrowUp', { altKey: true, shiftKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['A', 'C', 'B']);
      expect(live()).toBe('Layer moved to the front');
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect(live()).toBe('Already at the front');
      key(row(1), 'ArrowDown', { altKey: true, shiftKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'B', 'A']);
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect((await saved()).elements.map((e) => e.props.text)).toEqual(['B', 'A', 'C']);
    });

    it('is one tab stop, a grid: the arrows move between layers and their controls', async () => {
      await open({ document: three, revision: 1 });
      const stops = () => [...root.querySelectorAll('[role=grid] [tabindex="0"]')];
      expect(stops()).toEqual([row(3)]);
      expect(root.querySelectorAll('[role=grid] [tabindex="-1"]')).toHaveLength(11);
      row(3).focus();
      key(row(3), 'ArrowDown');
      expect(document.activeElement).toBe(row(2));
      key(row(2), 'ArrowRight');
      const hide2 = root.querySelector(`#layer-hide-${ID(2)}`) as HTMLButtonElement;
      expect(document.activeElement).toBe(hide2);
      key(hide2, 'ArrowDown');
      expect(document.activeElement?.id).toBe(`layer-hide-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'End');
      expect(document.activeElement?.id).toBe(`layer-more-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'ArrowRight');
      expect(document.activeElement?.id).toBe(`layer-more-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'Home');
      expect(document.activeElement).toBe(row(1));
      key(row(1), 'Home', { ctrlKey: true });
      expect(document.activeElement).toBe(row(3));
      key(row(3), 'ArrowUp');
      expect(document.activeElement).toBe(row(3));
      key(row(3), 'End', { ctrlKey: true });
      expect(document.activeElement).toBe(row(1));
      await settle(fixture);
      // The tab stop follows focus.
      expect(stops()).toEqual([row(1)]);
      // Enter or Space on a name selects that layer alone.
      key(row(1), 'Enter');
      await settle(fixture);
      expect(selected()).toEqual(['false', 'false', 'true']);
    });

    it('selects several layers with Shift+click and Shift+Space, then moves, reorders and deletes them together', async () => {
      await open({ document: three, revision: 1 });
      row(1).click();
      row(3).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, detail: 1 }));
      await settle(fixture);
      expect(selected()).toEqual(['true', 'false', 'true']);
      expect(canvasEl(1)?.getAttribute('aria-pressed')).toBe('true');
      expect(root.querySelector('fieldset legend')?.textContent).toBe('2 layers selected');
      // Shift+Space takes B in and out of the selection; the click a button fires for it changes nothing.
      key(row(2), ' ', { shiftKey: true });
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      await settle(fixture);
      expect(selected()).toEqual(['true', 'true', 'true']);
      key(row(2), ' ', { ctrlKey: true });
      await settle(fixture);
      expect(selected()).toEqual(['true', 'false', 'true']);

      key(canvasEl(1) as HTMLElement, 'ArrowRight', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('20%');
      expect(canvasEl(3)?.style.left).toBe('20%');
      expect(canvasEl(2)?.style.left).toBe('10%');
      expect(live()).toBe('2 layers moved');
      // As a group: the boxes are 80% wide, so they stop together at the right edge.
      key(canvasEl(1) as HTMLElement, 'ArrowRight', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('20%');

      key(row(3), 'ArrowDown', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['B', 'C', 'A']);
      expect(live()).toBe('2 layers sent backward');

      key(row(3), 'Delete');
      await settle(fixture);
      expect(rowNames()).toEqual(['B']);
      expect(live()).toBe('2 layers deleted');
      expect(document.activeElement).toBe(row(2));
    });

    it('selects every layer with Ctrl+A', async () => {
      await open({ document: three, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      await settle(fixture);
      expect(selected()).toEqual(['true', 'true', 'true']);
      expect(live()).toBe('All 3 layers selected');
    });

    it('hides a layer: gone from the canvas, marked in its row, and saved as hidden', async () => {
      await open({ document: three, revision: 1 });
      const hide = root.querySelector(`#layer-hide-${ID(2)}`) as HTMLButtonElement;
      expect(hide.getAttribute('aria-label')).toBe('Hide B');
      expect(hide.getAttribute('aria-pressed')).toBe('false');
      hide.click();
      await settle(fixture);
      expect(canvasEl(2)).toBeNull();
      expect(canvasTexts()).toEqual(['A', 'C']);
      expect(state(2)).toBe('Hidden');
      expect(hide.getAttribute('aria-pressed')).toBe('true');
      expect(live()).toBe('Layer hidden');
      expect((await saved()).elements.map((e) => e.hidden)).toEqual([false, true, false]);
      // From the canvas, the shortcut hides it and focus moves to its row.
      key(canvasEl(1) as HTMLElement, 'h', { code: 'KeyH' });
      await settle(fixture);
      expect(canvasEl(1)).toBeNull();
      expect(document.activeElement).toBe(row(1));
      // A Hebrew layout types י on the H key.
      key(row(1), 'י', { code: 'KeyH' });
      await settle(fixture);
      expect(canvasEl(1)).not.toBeNull();
      expect(live()).toBe('Layer shown');
    });

    it('locks a layer: dragging, arrow keys, the fields and editing leave it as it is', async () => {
      await open({ document: three, revision: 1 });
      (root.querySelector(`#layer-lock-${ID(3)}`) as HTMLButtonElement).click();
      await settle(fixture);
      expect(state(3)).toBe('Locked');
      expect(live()).toBe('Layer locked');
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      const el = canvasEl(3) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
      pointer('pointerdown', 100, 150);
      pointer('pointermove', 100, 300);
      pointer('pointerup', 100, 300);
      await settle(fixture);
      expect(canvasEl(3)?.style.top).toBe('20%');
      expect(live()).toContain('This layer is locked');
      key(el, 'ArrowDown');
      key(el, 'Enter');
      await settle(fixture);
      expect(canvasEl(3)?.style.top).toBe('20%');
      expect(root.querySelector('textarea.el-edit')).toBeNull();
      const y = root.querySelector('#studio-y') as HTMLInputElement;
      expect(y.readOnly).toBe(true);
      y.value = '50';
      y.dispatchEvent(new Event('change'));
      expect(y.value).toBe('20');
      const textField = root.querySelector('#studio-text') as HTMLTextAreaElement;
      expect(textField.readOnly).toBe(true);
      textField.value = 'Changed';
      textField.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(canvasEl(3)?.textContent).toBe('C');
      // It can still be reordered, and unlocked.
      key(row(3), 'ArrowDown', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['B', 'C', 'A']);
      key(row(3), 'l');
      await settle(fixture);
      expect(live()).toBe('Layer unlocked');
      const saved1 = await saved();
      expect(saved1.elements.map((e) => e.locked)).toEqual([false, false, false]);
    });

    it('moves a selection without its locked layers, and says so', async () => {
      const doc = { ...three, elements: [at(1, 'A', 0.4, { locked: true }), at(2, 'B', 0.3)] };
      await open({ document: doc, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      key(elements()[1], 'ArrowDown');
      await settle(fixture);
      expect(canvasEl(1)?.style.top).toBe('40%');
      expect(canvasEl(2)?.style.top).toBe('31%');
      expect(live()).toBe('Text moved to left 10%, top 31%; a locked layer stays');
    });

    it('duplicates a layer just above it with a new id, and stops at the element limit', async () => {
      await open({ document: three, revision: 1 });
      key(canvasEl(1) as HTMLElement, 'd');
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'B', 'A', 'A']);
      const copy = rows()[2].id.replace('layer-', '');
      expect(copy).toMatch(/^[0-9a-f-]{36}$/);
      expect(copy).not.toBe(ID(1));
      expect(document.activeElement?.id).toBe(`studio-el-${copy}`);
      expect(live()).toBe('Layer duplicated');
      const doc = await saved();
      expect(doc.elements[1]).toEqual({
        ...three.elements[0],
        id: copy,
        box: { ...three.elements[0].box, x: 0.12, y: 0.42 },
      });

      const full = {
        ...existing,
        elements: Array.from({ length: 60 }, (_, i) => ({
          ...at(1, `T${i}`, 0.4),
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
      };
      fixture.destroy();
      await open({ document: full, revision: 1 });
      key(elements()[0], 'd');
      await settle(fixture);
      expect(elements()).toHaveLength(60);
      expect(live()).toBe('A tale holds at most 60 layers');
    });

    it('opens the actions menu from a row, by Shift+F10 and by right-click, and returns focus when it closes', async () => {
      await open({ document: three, revision: 1 });
      const more = root.querySelector(`#layer-more-${ID(2)}`) as HTMLButtonElement;
      expect(more.getAttribute('aria-label')).toBe('More actions for B');
      expect(more.getAttribute('aria-haspopup')).toBe('menu');
      more.click();
      await settle(fixture);
      const menu = () => root.querySelector('[role=menu]') as HTMLElement | null;
      const items = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(items().map((i) => i.firstElementChild?.textContent)).toEqual([
        'Bring forward',
        'Send backward',
        'Bring to front',
        'Send to back',
        'Hide',
        'Lock',
        'Duplicate',
        'Delete',
      ]);
      // The menu shows the shortcuts, which work on the canvas and in the list, not in the menu.
      expect(items()[0].querySelector('.layer-menu__key')?.textContent).toMatch(/^(⌥↑|Alt\+↑)$/);
      expect(items()[0].hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(document.activeElement).toBe(items()[0]);
      key(items()[0], 'ArrowUp');
      expect(document.activeElement).toBe(items()[7]);
      key(items()[7], 'Home');
      key(items()[0], 'ArrowDown');
      expect(document.activeElement).toBe(items()[1]);
      key(items()[1], 'Escape');
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(more);

      // The More actions button toggles the menu.
      more.click();
      await settle(fixture);
      expect(menu()).not.toBeNull();
      more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      more.click();
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(more.getAttribute('aria-expanded')).toBe('false');

      // Shift+F10 or the context-menu key fire contextmenu at the focused canvas element (at 0, 0):
      // the studio menu opens and the browser's does not.
      canvasEl(1)?.focus();
      const keyMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      canvasEl(1)?.dispatchEvent(keyMenu);
      expect(keyMenu.defaultPrevented).toBe(true);
      await settle(fixture);
      const onItem = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      items()[0].dispatchEvent(onItem);
      expect(onItem.defaultPrevented).toBe(true);
      items()[2].click();
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(rowNames()).toEqual(['A', 'C', 'B']);
      expect(document.activeElement).toBe(canvasEl(1));

      // A right-click on a row of a two-layer selection offers the actions for both.
      row(1).click();
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, detail: 1 }));
      await settle(fixture);
      const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
      row(2).dispatchEvent(context);
      await settle(fixture);
      expect(context.defaultPrevented).toBe(true);
      expect(items().map((i) => i.firstElementChild?.textContent)).toEqual([
        'Bring forward',
        'Send backward',
        'Bring to front',
        'Send to back',
        'Delete 2 layers',
      ]);
      // A press outside closes it, leaving focus where it went.
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await settle(fixture);
      expect(menu()).toBeNull();
    });

    it('warns in the row when a layer reaches outside the safe area, and clears when it moves back', async () => {
      await open({ document: three, revision: 1 });
      expect(state(3)).toBe('');
      const el = canvasEl(3) as HTMLElement;
      // From 20% up by 10%: into the top safe area (12%).
      key(el, 'ArrowUp', { shiftKey: true });
      await settle(fixture);
      expect(state(3)).toBe('Outside safe area');
      expect(canvasEl(3)?.getAttribute('aria-describedby')).toBe(`layer-state-${ID(3)}`);
      key(el, 'ArrowDown', { shiftKey: true });
      await settle(fixture);
      expect(state(3)).toBe('');
      // Into the bottom 16%: still saved.
      const y = root.querySelector('#studio-y') as HTMLInputElement;
      y.value = '80';
      y.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(state(3)).toBe('Outside safe area');
      expect((await saved()).elements[2].box.y).toBe(0.8);
    });

    it('shows and hides the safe-area guides', async () => {
      await open({ document: three, revision: 1 });
      const guides = () => root.querySelector('.guides') as HTMLElement | null;
      expect(guides()?.getAttribute('aria-hidden')).toBe('true');
      expect(guides()?.style.top).toBe('12%');
      expect(guides()?.style.bottom).toBe('16%');
      expect(guides()?.style.left).toBe('4%');
      const toggle = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((c) =>
        c.parentElement?.textContent?.includes('Show safe areas'),
      ) as HTMLInputElement;
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(guides()).toBeNull();
      expect(live()).toBe('Safe areas hidden');
    });

    it('snaps a dragged layer to the canvas centre and other layers, and not with Alt held', async () => {
      const doc = {
        ...three,
        elements: [at(1, 'A', 0.5, { box: { x: 0.1, y: 0.5, w: 0.2, h: 0.1, rotation: 0 } }), at(2, 'B', 0.3)],
      };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number, altKey = false) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, altKey }),
        );
      // Its centre from 60 px to 147 px: 3 px short of the canvas centre (150 px), so it snaps there.
      pointer('pointerdown', 60, 330);
      pointer('pointermove', 147, 333);
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('40%');
      expect((root.querySelector('.snap-line--x') as HTMLElement).style.left).toBe('50%');
      // With Alt it lands where it is dropped.
      pointer('pointermove', 147, 333, true);
      pointer('pointerup', 147, 333, true);
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('39%');
      expect(root.querySelector('.snap-line--x')).toBeNull();
      expect(live()).toBe('Text moved');
    });

    it('moves a selection by arrows without its hidden layers, which neither move nor hold the group back', async () => {
      const doc = {
        ...three,
        elements: [
          at(1, 'A', 0.4, { hidden: true, box: { x: 0.1, y: 0.9, w: 0.8, h: 0.1, rotation: 0 } }),
          at(2, 'B', 0.3),
        ],
      };
      await open({ document: doc, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      key(canvasEl(2) as HTMLElement, 'ArrowDown', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(2)?.style.top).toBe('40%');
      expect(live()).toBe('Text moved to left 10%, top 40%');
      const saved1 = await saved();
      expect(saved1.elements[0].box.y).toBe(0.9);
    });

    it('drags the unlocked layers of a selection when a locked one is pressed, and says the locked one stays', async () => {
      const doc = { ...three, elements: [at(1, 'A', 0.4, { locked: true }), at(2, 'B', 0.2)] };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      key(elements()[0], 'a', { ctrlKey: true });
      await settle(fixture);
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, altKey: true }),
        );
      pointer('pointerdown', 150, 270);
      pointer('pointermove', 150, 330);
      pointer('pointerup', 150, 330);
      await settle(fixture);
      expect(canvasEl(1)?.style.top).toBe('40%');
      expect(canvasEl(2)?.style.top).toBe('30%');
      expect(live()).toBe('Text moved; a locked layer stays');
    });

    it("snaps by a turned layer's visible edge, the one the safe-area warning measures", async () => {
      // A quarter-turned box 0.3 wide and 0.05 high: it shows 0.15 × 9/16 ≈ 0.0889 wide, centred at x 0.5.
      const turned = { x: 0.35, y: 0.5, w: 0.3, h: 0.05, rotation: 90 };
      const doc = { ...three, elements: [at(1, 'A', 0.5, { box: turned })] };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 1600 }) as DOMRect;
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
      // It shows 0.16875 high, so its visible top is at 0.4406 (705 px). Dragged up 509 px, that edge
      // is 4 px below the top safe-area edge (0.12, 192 px) and snaps onto it; its box does not.
      pointer('pointerdown', 450, 800);
      pointer('pointermove', 450, 291);
      await settle(fixture);
      expect((root.querySelector('.snap-line--y') as HTMLElement).style.top).toBe('12%');
      pointer('pointerup', 450, 291);
      const box = (await saved()).elements[0].box;
      expect(elementBounds(box).y).toBeCloseTo(0.12, 3);
      expect(box.y).toBeCloseTo(0.1794, 4);
    });

    it('sets the background colour from the picker or the hex field, and saves it', async () => {
      await open({ document: three, revision: 1 });
      const picker = root.querySelector('#studio-bg') as HTMLInputElement;
      expect(picker.type).toBe('color');
      expect(root.querySelector('label[for=studio-bg]')?.textContent).toBe('Background colour');
      picker.value = '#112233';
      picker.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect((root.querySelector('.canvas') as HTMLElement).style.backgroundColor).toBe('rgb(17, 34, 51)');
      expect(live()).toBe('Background colour set to #112233');
      const hex = root.querySelector('#studio-bg-hex') as HTMLInputElement;
      expect(hex.value).toBe('#112233');
      hex.value = 'red; background:url(x)';
      hex.dispatchEvent(new Event('change'));
      await settle(fixture);
      // The entry stays, marked invalid and described by the message; the canvas keeps its colour.
      expect(hex.value).toBe('red; background:url(x)');
      expect(hex.getAttribute('aria-invalid')).toBe('true');
      expect(hex.getAttribute('aria-describedby')).toBe('studio-bg-hint studio-bg-error');
      expect(root.querySelector('#studio-bg-error')?.textContent).toBe(
        'Enter a colour as #RRGGBB or #RRGGBBAA. The background stays #112233.',
      );
      expect((root.querySelector('.canvas') as HTMLElement).style.backgroundColor).toBe('rgb(17, 34, 51)');
      hex.value = 'AABBCC80';
      hex.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(hex.value).toBe('#AABBCC80');
      expect(hex.hasAttribute('aria-invalid')).toBe(false);
      expect(root.querySelector('#studio-bg-error')).toBeNull();
      expect(picker.value).toBe('#aabbcc');
      expect((await saved()).canvas).toEqual({ background: { type: 'color', color: '#AABBCC80' } });
    });
  });
});
