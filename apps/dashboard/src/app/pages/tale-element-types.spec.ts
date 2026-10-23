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
  TEST_ELEMENT_TYPES_STORAGE_KEY,
  type InspectorField,
  type StudioElementType,
} from './tale-element-types';
import { TaleFieldsInspector } from './tale-fields-inspector';
import type { ElementChange } from './tale-shapes';
import { kindName } from './tale-canvas-view';
import { TaleStudioPage } from './tale-studio';

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
  const live = () => root.querySelector('p.visually-hidden[aria-live=polite]')?.textContent;
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
    // The error line is a polite live region, described with the hint; no second announcement.
    const error = q(`#field-test-badge-label-${id}-error`);
    expect(error.getAttribute('aria-live')).toBe('polite');
    expect(error.getAttribute('role')).toBeNull();
    expect(label.getAttribute('aria-describedby')).toBe(
      `field-test-badge-label-${id}-hint field-test-badge-label-${id}-error`,
    );
    expect(live()).not.toContain('Not applied');
    await edit(`#field-test-badge-count-${id}`, '100');
    await edit(`#field-test-badge-color-${id}-hex`, 'red');
    for (const control of [`#field-test-badge-color-${id}`, `#field-test-badge-color-${id}-hex`]) {
      expect(q(control).getAttribute('aria-invalid')).toBe('true');
      expect(q(control).getAttribute('aria-describedby')).toBe(`field-test-badge-color-${id}-error`);
    }
    expect(q(`#field-test-badge-color-${id}-hex`).getAttribute('aria-required')).toBe('true');
    await edit(`#field-test-badge-label-${id}`, '');
    expect(props()).toEqual({ label: 'Hot', color: '#00AA55', tone: 'outline', count: 7 });
    // An optional value left empty is removed.
    await edit(`#field-test-badge-count-${id}`, '');
    expect(props()).toEqual({ label: 'Hot', color: '#00AA55', tone: 'outline' });

    // A refused value typed into the field, then an undo that changes the prop under it: the
    // field shows the document's value again, without the stale error.
    await edit(`#field-test-badge-count-${id}`, '100', 'input');
    expect(q(`#field-test-badge-count-${id}-error`).textContent).toBe('Enter a number from 0 to 99.');
    // Undo takes back the last edit, as for any type.
    q<HTMLButtonElement>('#studio-undo').click();
    await settle(fixture);
    expect(props()['count']).toBe(7);
    expect(q(`#field-test-badge-count-${id}-error`).textContent).toBe('');
    expect(q(`#field-test-badge-count-${id}`).getAttribute('aria-invalid')).toBeNull();
    expect(q<HTMLInputElement>(`#field-test-badge-count-${id}`).value).toBe('7');
    // The label's refused text is still in its field, so its error stays.
    expect(q(`#field-test-badge-label-${id}-error`).textContent).toBe('Enter some text.');

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

  it('keeps a stored type it has no descriptor for, with a neutral inspector that can delete it', async () => {
    const badge = {
      id: '00000000-0000-4000-8000-0000000000b1',
      type: 'test-badge',
      box: { x: 0.1, y: 0.2, w: 0.4, h: 0.08, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { label: 'New', color: '#FF0055', tone: 'solid' },
    };
    await open(false, {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [badge as never],
    });
    expect(q('#studio-add-test-badge')).toBeNull();
    q<HTMLButtonElement>(`#studio-el-${badge.id}`).click();
    await settle(fixture);
    expect(q('#studio-unknown-type-hint').textContent).toContain("This layer's type can't be edited here");
    expect(root.querySelector('app-tale-fields-inspector, app-tale-media-style, app-tale-text-style')).toBeNull();
    const del = [...root.querySelectorAll<HTMLButtonElement>('fieldset.selected button')].find((b) =>
      b.textContent?.trim().startsWith('Delete'),
    );
    del?.click();
    await settle(fixture);
    expect(doc().elements).toEqual([]);
  });

  it('shows the swipe-up hint before the video hint when both limits are reached, as before', async () => {
    const element = (
      n: number,
      type: string,
      props: Record<string, unknown>,
      box = { x: 0.1, y: 0.1, w: 0.5, h: 0.2, rotation: 0 },
    ) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      type,
      box,
      hidden: false,
      locked: false,
      a11y: { decorative: true },
      props,
    });
    await open(false, {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        element(1, 'video', { mediaKey: 'media/0b7c9d4e-1111-4222-8333-944455556669.mp4', fit: 'cover' }),
        element(
          2,
          'swipe-up',
          { label: 'Up', color: '#FFFFFF', background: '#000000B3' },
          { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 },
        ),
      ] as never,
    });
    const hints = [...root.querySelectorAll('.panel > p.field__hint')].map((h) => h.id);
    expect(hints).toEqual(['studio-swipe-up-hint', 'studio-video-hint']);
    expect(q('#studio-add-video').getAttribute('aria-describedby')).toBe('studio-video-hint');
    expect(q('#studio-add-swipe-up').getAttribute('aria-describedby')).toBe('studio-swipe-up-hint');
  });
});

describe('studio descriptors that do not fit their schema (R8)', () => {
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
  const create = { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) };
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', maxLength: 10 },
      kind: { type: 'string', enum: ['a', 'b'] },
      tint: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      n: { type: 'integer', minimum: 0 },
    },
  };
  const build = (s: Record<string, unknown>, fields: InspectorField[]) =>
    studioElementTypes({
      registry: [{ key: 'poll', label: 'Poll', schema: s }],
      descriptors: { poll: { add, inspector: { fields }, create } },
    });

  it('accepts one that fits', () => {
    expect(
      build(schema, [
        { prop: 'q', label: 'Q', control: 'text' },
        { prop: 'kind', label: 'Kind', control: 'select', options: [{ value: 'a', label: 'A' }] },
        { prop: 'tint', label: 'Tint', control: 'color' },
        { prop: 'n', label: 'N', control: 'number' },
      ]),
    ).toHaveLength(1);
  });

  it.each([
    ['a schema keyword it does not check', { ...schema, oneOf: [] }, [], 'its schema uses "oneOf"'],
    [
      'a prop keyword it does not check',
      { ...schema, properties: { ...schema.properties, q: { type: 'string', format: 'email' } } },
      [],
      '"q" uses "format"',
    ],
    [
      'a select option outside the enum',
      schema,
      [{ prop: 'kind', label: 'K', control: 'select', options: [{ value: 'c', label: 'C' }] }],
      'must be values of its enum',
    ],
    ['a select without options', schema, [{ prop: 'kind', label: 'K', control: 'select' }], 'must be values of its enum'],
    ['a colour field without the hex pattern', schema, [{ prop: 'q', label: 'Q', control: 'color' }], 'its pattern must be'],
    ['a number field on a string', schema, [{ prop: 'q', label: 'Q', control: 'number' }], 'which a number field does not edit'],
    ['a text field on a number', schema, [{ prop: 'n', label: 'N', control: 'text' }], 'which a text field does not edit'],
  ])('refuses %s', (_, s, fields, message) => {
    expect(() => build(s as Record<string, unknown>, fields as InspectorField[])).toThrow(message);
  });

  it('lets the real test badge through', () => {
    expect(() => studioElementTypes({ testTypes: true })).not.toThrow();
  });
});

describe('the fields inspector (R8)', () => {
  const type = {
    key: 'poll',
    label: 'Poll',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['low', 'high'],
      properties: {
        low: { type: 'integer', minimum: 0, maximum: 10 },
        high: { type: 'integer', minimum: 0, maximum: 10 },
        mood: { type: 'string', enum: ['calm', 'loud'] },
      },
    },
    add: [],
    inspector: {
      fields: [
        { prop: 'low', label: 'Low', control: 'number' },
        { prop: 'high', label: 'High', control: 'number' },
        {
          prop: 'mood',
          label: 'Mood',
          control: 'select',
          options: [
            { value: 'calm', label: 'Calm' },
            { value: 'loud', label: 'Loud' },
          ],
        },
      ],
    },
    check: (props: Readonly<Record<string, unknown>>) =>
      (props['low'] as number) > (props['high'] as number) ? 'Low must not be above high.' : null,
  } as unknown as StudioElementType;

  function inspector(props: Record<string, unknown>) {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(TaleFieldsInspector);
    fixture.componentRef.setInput('element', { id: 'e1', props });
    fixture.componentRef.setInput('type', type);
    const changes: ElementChange[] = [];
    fixture.componentInstance.changed.subscribe((c) => changes.push(c));
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const set = (selector: string, value: string) => {
      const field = root.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      field.value = value;
      field.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    return { root, changes, set };
  }

  it("runs the descriptor's check after the schema, and refuses what it refuses", () => {
    const { root, changes, set } = inspector({ low: 2, high: 5 });
    set('#field-poll-low-e1', '7');
    expect(changes).toEqual([]);
    expect(root.querySelector('#field-poll-low-e1-error')?.textContent).toBe('Low must not be above high.');
    set('#field-poll-low-e1', '4');
    expect(changes).toEqual([{ label: 'Low changed', props: { low: 4 }, said: 'Low set' }]);
  });

  it('offers None in an optional select, which removes the prop', () => {
    const { root, changes, set } = inspector({ low: 2, high: 5, mood: 'calm' });
    const options = [...root.querySelectorAll('#field-poll-mood-e1 option')].map((o) => o.textContent);
    expect(options).toEqual(['None', 'Calm', 'Loud']);
    expect(root.querySelector('#field-poll-mood-e1')?.getAttribute('aria-required')).toBeNull();
    set('#field-poll-mood-e1', '');
    expect(changes).toEqual([{ label: 'Mood changed', props: { mood: undefined }, said: 'Mood cleared' }]);
    expect(root.querySelector('#field-poll-low-e1')?.getAttribute('aria-required')).toBe('true');
  });
});

describe('gating the test-only types (R8)', () => {
  const dev = (globalThis as { ngDevMode?: unknown }).ngDevMode;
  afterEach(() => {
    (globalThis as { ngDevMode?: unknown }).ngDevMode = dev;
    localStorage.removeItem(TEST_ELEMENT_TYPES_STORAGE_KEY);
    TestBed.resetTestingModule();
  });

  it('is on in a development build only with the localStorage switch', () => {
    localStorage.setItem(TEST_ELEMENT_TYPES_STORAGE_KEY, 'on');
    TestBed.configureTestingModule({});
    expect(TestBed.inject(STUDIO_TEST_ELEMENT_TYPES)).toBe(true);
    TestBed.resetTestingModule();
    localStorage.setItem(TEST_ELEMENT_TYPES_STORAGE_KEY, 'yes');
    TestBed.configureTestingModule({});
    expect(TestBed.inject(STUDIO_TEST_ELEMENT_TYPES)).toBe(false);
  });

  it('is never on in a production build (ngDevMode false), whatever is asked', () => {
    localStorage.setItem(TEST_ELEMENT_TYPES_STORAGE_KEY, 'on');
    (globalThis as { ngDevMode?: unknown }).ngDevMode = false;
    TestBed.configureTestingModule({});
    expect(TestBed.inject(STUDIO_TEST_ELEMENT_TYPES)).toBe(false);
    expect(studioElementTypes({ testTypes: true }).map((t) => t.key)).toEqual(
      TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key),
    );
    expect(kindName({ type: 'test-badge' as never })).toBe('Layer');
  });
});
