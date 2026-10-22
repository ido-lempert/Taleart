import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import {
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_TEST_ELEMENT_TYPES,
  type TaleDocument,
} from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import {
  addMenuRows,
  STUDIO_TEST_ELEMENT_TYPES,
  STUDIO_TYPE_DESCRIPTORS,
  studioElementTypes,
} from './tale-element-types';
import { kindName, TaleStudioPage } from './tale-studio';

// Tale Studio story 7.8 (epic Tale Studio R8): the Add menu and the inspector come from the
// element-type registry; a test-only type registered by configuration goes end to end.
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

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('studio element types (R8)', () => {
  it('has one descriptor per registered type, in registry order', () => {
    expect(studioElementTypes().map((t) => t.key)).toEqual(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key));
    expect(Object.keys(STUDIO_TYPE_DESCRIPTORS).sort()).toEqual(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key).sort());
    for (const type of studioElementTypes()) {
      expect(type.label).toBe(TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === type.key)?.label);
      expect(type.add.length).toBeGreaterThan(0);
    }
  });

  it('refuses a registered type without a descriptor, or a field its schema lacks', () => {
    const poll = { key: 'poll', label: 'Poll', schema: { type: 'object', properties: { q: { type: 'string' } } } };
    expect(() => studioElementTypes({ registry: [poll] })).toThrow('Element type "poll" has no Tale Studio descriptor');
    const add = [
      {
        id: 'studio-add-poll',
        label: 'Add poll',
        icon: 'plus' as const,
        row: 3,
        small: true,
        needsProject: false,
        action: { kind: 'configured' as const },
      },
    ];
    expect(() => studioElementTypes({ registry: [poll], descriptors: { poll: { add, inspector: 'text' } } })).toThrow(
      'says nothing of how',
    );
    expect(() =>
      studioElementTypes({
        registry: [poll],
        descriptors: {
          poll: {
            add,
            inspector: { fields: [{ prop: 'answer', label: 'Answer', control: 'text' }] },
            create: { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) },
          },
        },
      }),
    ).toThrow('the inspector edits "answer", which its schema lacks');
  });

  it('builds the Add menu rows from the descriptors, keeping the menu as it was', () => {
    const rows = addMenuRows(studioElementTypes()).map((row) => row.map((r) => r.entry.label));
    expect(rows).toEqual([
      ['Add text', 'Add image', 'Add video'],
      ['Add rectangle', 'Add ellipse', 'Add line', 'Add emoji', 'Add sticker'],
      ['Add button', 'Add image button', 'Add swipe-up link'],
    ]);
  });

  it('adds the test-only types only when asked', () => {
    expect(studioElementTypes({ testTypes: true }).map((t) => t.key)).toEqual([
      ...TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key),
      ...TALE_TEST_ELEMENT_TYPES.map((t) => t.key),
    ]);
    const rows = addMenuRows(studioElementTypes({ testTypes: true }));
    expect(rows[3].map((r) => r.entry.id)).toEqual(['studio-add-test-badge']);
    expect(kindName({ type: 'test-badge' as never })).toBe('Test badge');
  });

  it('is off by default in the studio', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(STUDIO_TEST_ELEMENT_TYPES)).toBe(false);
  });
});

describe('Tale Studio: a type registered by configuration (R8)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;
  let withTestTypes = false;

  async function open(testTypes: boolean, document: TaleDocument | null = null): Promise<void> {
    withTestTypes = testTypes;
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
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const live = () => root.querySelector('[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const props = () => doc().elements[0].props as Record<string, unknown>;
  const edit = async (selector: string, value: string, event: 'input' | 'change' = 'change') => {
    const field = q<HTMLInputElement | HTMLSelectElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event(event));
    await settle(fixture);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
        { provide: STUDIO_TEST_ELEMENT_TYPES, useFactory: () => withTestTypes },
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

  it('keeps the Add menu as it was without the test types', async () => {
    await open(false);
    const ids = [...root.querySelectorAll('.panel > .row > button[id^="studio-add"]')].map((b) => b.id);
    expect(ids).toEqual([
      'studio-add',
      'studio-add-image',
      'studio-add-video',
      'studio-add-rectangle',
      'studio-add-ellipse',
      'studio-add-line',
      'studio-add-emoji',
      'studio-add-sticker',
      'studio-add-button',
      'studio-add-image-button',
      'studio-add-swipe-up',
    ]);
    expect(q('#studio-add').classList.contains('btn--sm')).toBe(false);
    expect(q('#studio-add-emoji').classList.contains('btn--sm')).toBe(true);
    expect(q('#studio-add-test-badge')).toBeNull();
    expect(q('#studio-add-emoji').textContent?.trim()).toBe('Add emoji');
  });

  it('adds it from the Add menu, edits it in its inspector, refuses an invalid value and saves it', async () => {
    await open(true);
    const add = q<HTMLButtonElement>('#studio-add-test-badge');
    expect(add.textContent?.trim()).toBe('Add test badge');
    add.click();
    await settle(fixture);
    expect(live()).toBe('Test badge added');
    const element = doc().elements[0];
    expect(element.type as string).toBe('test-badge');
    expect(element.props).toEqual({ label: 'Test badge', color: '#7C3AED', tone: 'solid' });
    const id = element.id;
    expect(globalThis.document.activeElement?.id).toBe(`field-test-badge-label-${id}`);
    expect(q('fieldset.selected legend').textContent).toContain('Selected test badge');
    expect(q(`#studio-el-${id}`).getAttribute('aria-label')).toBe('Test badge: Layer 1');
    expect(q(`#studio-el-${id} .el__link`).textContent).toBe('Test badge');
    // Each field is labelled.
    for (const prop of ['label', 'color', 'tone', 'count']) {
      const control = q(`#field-test-badge-${prop}-${id}`);
      expect(root.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()).toBeTruthy();
    }

    await edit(`#field-test-badge-label-${id}`, 'Hot');
    await edit(`#field-test-badge-tone-${id}`, 'outline');
    await edit(`#field-test-badge-count-${id}`, '7');
    await edit(`#field-test-badge-color-${id}-hex`, '#00AA55');
    expect(props()).toEqual({ label: 'Hot', color: '#00AA55', tone: 'outline', count: 7 });
    expect(q(`#studio-el-${id} .el__link`).textContent).toBe('Hot 7');

    // Invalid values are refused, said, and not applied.
    await edit(`#field-test-badge-label-${id}`, 'x'.repeat(41), 'input');
    const label = q<HTMLInputElement>(`#field-test-badge-label-${id}`);
    expect(label.getAttribute('aria-invalid')).toBe('true');
    expect(q(`#field-test-badge-label-${id}-error`).textContent).toBe('Use at most 40 characters.');
    await edit(`#field-test-badge-label-${id}`, 'x'.repeat(41));
    expect(live()).toBe('Label: Use at most 40 characters. Not applied.');
    await edit(`#field-test-badge-count-${id}`, '100');
    await edit(`#field-test-badge-color-${id}-hex`, 'red');
    await edit(`#field-test-badge-label-${id}`, '');
    expect(props()).toEqual({ label: 'Hot', color: '#00AA55', tone: 'outline', count: 7 });
    // An optional value left empty is removed.
    await edit(`#field-test-badge-count-${id}`, '');
    expect(props()).toEqual({ label: 'Hot', color: '#00AA55', tone: 'outline' });

    // Undo takes back the last edit, as for any type.
    q<HTMLButtonElement>('#studio-undo').click();
    await settle(fixture);
    expect(props()['count']).toBe(7);

    // Saving sends it as it is, in a version 1 document.
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    expect(body.document.version).toBe(1);
    expect(body.document.elements[0]).toMatchObject({
      type: 'test-badge',
      props: { label: 'Hot', color: '#00AA55', tone: 'outline', count: 7 },
    });
    req.flush({ document: body.document, revision: 1 });
    expect(await leaving).toBe(true);
  });

  it('shows a refused save of it like any other element', async () => {
    await open(true);
    q<HTMLButtonElement>('#studio-add-test-badge').click();
    await settle(fixture);
    const id = doc().elements[0].id;
    void fixture.componentInstance.canLeave();
    await settle(fixture);
    http
      .expectOne(url)
      .flush(
        { error: { code: 'invalid_tale_document', message: 'bad', pointer: '/elements/0/props/tone' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    expect(q(`#studio-el-${id}`).getAttribute('aria-invalid')).toBe('true');
  });
});
