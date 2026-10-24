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
import { PALETTE_COUNT_DELAY_MS, TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

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

describe('studio element types (R8)', () => {
  it('has one descriptor per registered type, in registry order, each with a palette entry', () => {
    expect(studioElementTypes().map((t) => t.key)).toEqual(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key));
    expect(Object.keys(STUDIO_TYPE_DESCRIPTORS).sort()).toEqual(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key).sort());
    for (const type of studioElementTypes()) {
      expect(type.label).toBe(TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === type.key)?.label);
      expect(type.palette?.keywords.length, type.key).toBeGreaterThan(0);
    }
  });

  it('refuses a registered type without a descriptor, or a field its schema lacks', () => {
    const widget = { key: 'widget', label: 'Widget', schema: { type: 'object', properties: { q: { type: 'string' } } } };
    expect(() => studioElementTypes({ registry: [widget] })).toThrow('Element type "widget" has no Tale Studio descriptor');
    const palette = {
      category: 'interactive' as const,
      order: 9,
      keywords: ['thing'],
      icon: 'plus' as const,
      action: { kind: 'configured' as const },
    };
    expect(() => studioElementTypes({ registry: [widget], descriptors: { widget: { palette, inspector: 'text' } } })).toThrow(
      'says nothing of how',
    );
    // Without a palette entry it shows under More, added by its create: so it needs one.
    expect(() => studioElementTypes({ registry: [widget], descriptors: { widget: { inspector: 'text' } } })).toThrow(
      'has no palette entry and says nothing of how it is added',
    );
    expect(() =>
      studioElementTypes({
        registry: [widget],
        descriptors: {
          widget: {
            palette,
            inspector: { fields: [{ prop: 'answer', label: 'Answer', control: 'text' }] },
            create: { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) },
          },
        },
      }),
    ).toThrow('the inspector edits "answer", which its schema lacks');
  });

  it('adds the test-only types only when asked', () => {
    expect(studioElementTypes({ testTypes: true }).map((t) => t.key)).toEqual([
      ...TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key),
      ...TALE_TEST_ELEMENT_TYPES.map((t) => t.key),
    ]);
    // The test badge has no palette entry: it shows under More (epic Tale Studio 2 R2).
    expect(studioElementTypes({ testTypes: true }).at(-1)?.palette).toBeUndefined();
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

  it('shows the palette in its categories without the test types', async () => {
    await open(false);
    const ids = [...root.querySelectorAll('#studio-panel-elements .tiles > button[id^="studio-add"]')].map((b) => b.id);
    expect(ids).toEqual([
      'studio-add-heading',
      'studio-add-subheading',
      'studio-add-text',
      'studio-add-caption',
      'studio-add-label',
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
      'studio-add-poll',
      'studio-add-rating',
      'studio-add-quiz',
    ]);
    // Buttons in groups named by their headings (Tale Studio 2, story 11.3).
    const groups = [...root.querySelectorAll('#studio-panel-elements [role=group]')];
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual([
      'Text',
      'Media',
      'Shapes',
      'Stickers & emoji',
      'Buttons & links',
      'Interactive',
    ]);
    expect(groups[3].querySelector('#studio-add-emoji')).not.toBeNull();
    expect(q('#studio-add-test-badge')).toBeNull();
    expect(q('#studio-add-emoji').textContent?.trim()).toBe('Add emoji');
    // A text preset shows its word in its own style, in place of an icon.
    const heading = q<HTMLElement>('#studio-add-heading');
    expect(heading.textContent?.trim()).toBe('Add heading');
    expect(heading.querySelector('.icon')).toBeNull();
    expect(heading.querySelector('.tile__sample')?.textContent).toBe('heading');
    expect(q('#studio-palette-search').getAttribute('aria-keyshortcuts')).toBe('/');
    expect(root.querySelector('label[for="studio-palette-search"]')?.textContent).toBe('Search elements');
  });

  it('finds elements as one types, says how many, and clears with Escape', async () => {
    await open(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const search = q<HTMLInputElement>('#studio-palette-search');
      search.focus();
      search.value = 'vote';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      const tiles = () => [...root.querySelectorAll('#studio-panel-elements .tile')].map((t) => t.id);
      expect(tiles()).toEqual(['studio-add-poll']);
      expect(q('#studio-palette-count').textContent?.trim()).toBe('1 element');
      // Said once typing pauses, in the studio's one polite live region.
      vi.advanceTimersByTime(PALETTE_COUNT_DELAY_MS + 10);
      fixture.detectChanges();
      expect(live()).toBe('1 element');
      expect(root.querySelectorAll('[aria-live=polite]').length).toBe(1);

      // Arrow Down goes to the first one found.
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement?.id).toBe('studio-add-poll');

      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(tiles()).toEqual([]);
      expect(q('.palette-empty').textContent).toContain('No elements match “zzz”.');

      // Escape clears; a second Escape goes back to the canvas.
      search.focus();
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(10);
      fixture.detectChanges();
      expect(search.value).toBe('');
      expect(tiles().length).toBe(18);
      expect(document.activeElement).toBe(search);
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      vi.advanceTimersByTime(10);
      expect(document.activeElement?.id).toBe('studio-canvas');
    } finally {
      vi.useRealTimers();
    }
  });

  it('focuses the search with / from outside a text field, on the Elements tab', async () => {
    await open(false);
    q<HTMLButtonElement>('#studio-tab-layers').click();
    await settle(fixture);
    const canvas = q<HTMLElement>('#studio-canvas');
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(document.activeElement?.id).toBe('studio-palette-search');
    expect(q('#studio-tab-elements').getAttribute('aria-selected')).toBe('true');
  });

  it('shows a type without a palette entry under More in a test build', async () => {
    await open(true);
    const groups = [...root.querySelectorAll('#studio-panel-elements [role=group]')];
    const more = groups.at(-1) as HTMLElement;
    expect(document.getElementById(more.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('More');
    expect([...more.querySelectorAll('.tile')].map((t) => t.id)).toEqual(['studio-add-test-badge']);
  });

  it('says once, above the groups, why the media tiles cannot add to a tale with no project', async () => {
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [{ ...group, tales: [{ ...tale, projectId: null }] } as unknown as ZoneTaleGroup] });
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document: null, revision: 0, published: { document: null, revision: 0 } });
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
    const reason = "This tale has no project, so it can't use the project's media.";
    expect(root.querySelectorAll('#studio-project-hint').length).toBe(1);
    expect(q('#studio-project-hint').textContent?.trim()).toBe(reason);
    expect(q('#studio-project-hint').closest('[role=group]')).toBeNull();
    for (const id of ['image', 'video', 'sticker', 'image-button']) {
      const tile = q<HTMLButtonElement>(`#studio-add-${id}`);
      expect(tile.disabled, id).toBe(false);
      expect(tile.getAttribute('aria-disabled'), id).toBe('true');
      expect(tile.getAttribute('aria-describedby'), id).toBe('studio-project-hint');
      expect(tile.hasAttribute('title'), id).toBe(false);
    }
    expect(q('#studio-add-emoji').hasAttribute('aria-disabled')).toBe(false);
    q<HTMLButtonElement>('#studio-add-image').click();
    await settle(fixture);
    expect(live()).toBe(reason);
    expect(root.querySelector('[role=dialog]')).toBeNull();
  });

  it('drops a count not said yet when a tile is added, and says the count with no contrast note', async () => {
    await open(false);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const search = q<HTMLInputElement>('#studio-palette-search');
      search.value = 'rect';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      // A contrast note waiting for a change is not taken by the count.
      (fixture.componentInstance as unknown as { contrastNote: string }).contrastNote = 'NOTE';
      vi.advanceTimersByTime(PALETTE_COUNT_DELAY_MS + 10);
      fixture.detectChanges();
      expect(live()).toBe('1 element');
      expect((fixture.componentInstance as unknown as { contrastNote: string }).contrastNote).toBe('NOTE');
      (fixture.componentInstance as unknown as { contrastNote: string }).contrastNote = '';
      // Typing again, then adding before the pause ends: the add is said, not the count.
      search.value = 'ellipse';
      search.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      q<HTMLButtonElement>('#studio-add-ellipse').click();
      vi.advanceTimersByTime(PALETTE_COUNT_DELAY_MS + 10);
      fixture.detectChanges();
      expect(live()).toContain('Ellipse added');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps blocked tiles focusable, each saying why', async () => {
    await open(false, {
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          type: 'poll',
          box: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: {
            question: 'Q',
            theme: 'light',
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
        },
      ] as never,
    });
    const poll = q<HTMLButtonElement>('#studio-add-poll');
    expect(poll.disabled).toBe(false);
    expect(poll.getAttribute('aria-disabled')).toBe('true');
    expect(poll.getAttribute('aria-describedby')).toBe('studio-poll-hint');
    expect(poll.closest('[role=group]')?.querySelector('#studio-poll-hint')?.textContent).toContain('A tale holds one poll');
    poll.focus();
    poll.click();
    await settle(fixture);
    expect(document.activeElement).toBe(poll);
    expect(live()).toContain('A tale holds one poll');
    expect(doc().elements.length).toBe(1);
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
    expect(q('#inspector-title').textContent).toContain('Test badge');
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
    const del = [...root.querySelectorAll<HTMLButtonElement>('.studio-inspector button')].find((b) =>
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
    // Each reason shows under the group of the tile it describes (Tale Studio 2, story 11.3).
    const hints = [...root.querySelectorAll('#studio-panel-elements [role=group] > p.field__hint')].map((h) => h.id);
    expect(hints).toEqual(['studio-video-hint', 'studio-swipe-up-hint']);
    expect(q('#studio-video-hint').closest('[role=group]')?.querySelector('#studio-add-video')).not.toBeNull();
    expect(q('#studio-add-video').getAttribute('aria-describedby')).toBe('studio-video-hint');
    expect(q('#studio-add-swipe-up').getAttribute('aria-describedby')).toBe('studio-swipe-up-hint');
  });
});

describe('studio descriptors that do not fit their schema (R8)', () => {
  const palette = {
    category: 'interactive' as const,
    order: 0,
    keywords: ['vote'],
    icon: 'poll' as const,
    action: { kind: 'configured' as const },
  };
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
      descriptors: { poll: { palette, inspector: { fields }, create } },
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
