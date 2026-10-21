import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { TaleDocument, ZoneTaleGroup } from '@taleart/contract';
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

  it('moves by the position fields, kept inside the canvas, and deletes from the keyboard', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const x = root.querySelector('#studio-x') as HTMLInputElement;
    x.value = '95';
    x.dispatchEvent(new Event('change'));
    await settle(fixture);
    // The box is 80% wide, so it can start at most at 20%.
    expect(elements()[0].style.left).toBe('20%');
    key(elements()[0], 'Delete');
    await settle(fixture);
    expect(elements()).toHaveLength(0);
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

  it("shows the API's message when a save is refused", async () => {
    await open({ document: existing, revision: 1 });
    buttonNamed(root, 'Save').click();
    await settle(fixture);
    http
      .expectOne(url)
      .flush(
        { error: { code: 'invalid_tale_document', message: '/elements/0/props/text holds at most 1000 characters' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('holds at most 1000 characters');
    expect(status()).toBe('Not saved');
  });
});
