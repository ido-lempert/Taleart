import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { PollElement, TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { STUDIO_TEST_ELEMENT_TYPES, studioElementTypes, type InspectorField } from './tale-element-types';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Epic interactive components story 4.1: a poll in Tale Studio (R1, R2, R11): added from the Add
// menu, edited in its inspector (question, title, theme and the two options' text, their ids kept),
// limited to one per tale, and its votes shown from the Management API.
const url = `${API_BASE}/tales/t1/document`;
const responsesUrl = `${API_BASE}/tales/t1/responses`;
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

describe('the poll descriptor and the choices field', () => {
  const palette = {
    category: 'interactive' as const,
    order: 9,
    keywords: ['widget'],
    icon: 'plus' as const,
    action: { kind: 'configured' as const },
  };
  const create = { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) };
  const item = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label'],
    properties: { id: { type: 'string', pattern: '^[a-z]+$' }, label: { type: 'string', maxLength: 9 } },
  };
  const schema = (choices: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    properties: { q: { type: 'string' }, choices },
  });
  const build = (s: Record<string, unknown>) =>
    studioElementTypes({
      registry: [{ key: 'widget', label: 'Widget', schema: s }],
      descriptors: {
        widget: {
          palette,
          create,
          inspector: {
            fields: [{ prop: 'q', label: 'Q', control: 'text' }] as InspectorField[],
            choices: { prop: 'choices', label: 'Choices', itemLabel: (i) => `Choice ${i + 1}` },
          },
        },
      },
    });

  it('lets the real poll through', () => {
    expect(studioElementTypes().find((t) => t.key === 'poll')?.palette).toMatchObject({ category: 'interactive', order: 0 });
  });

  it('accepts a fixed list of closed id and label items', () => {
    expect(build(schema({ type: 'array', minItems: 2, maxItems: 2, items: item }))).toHaveLength(1);
  });

  it.each([
    ['a list whose length may change, without saying how a new item is labelled', { type: 'array', minItems: 2, maxItems: 4, items: item }, 'how a new one is labelled'],
    ['a list without a fewest number of items', { type: 'array', maxItems: 4, items: item }, 'a number of items'],
    ['a list that may be empty', { type: 'array', minItems: 0, maxItems: 4, items: item }, 'a number of items'],
    ['an item that is not closed', { type: 'array', minItems: 2, maxItems: 2, items: { ...item, additionalProperties: true } }, 'closed objects'],
    [
      'an item keyword the inspector does not check',
      {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { ...item, properties: { ...item.properties, label: { type: 'string', format: 'email' } } },
      },
      'uses "format"',
    ],
    ['an array keyword it does not check', { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: item }, 'uses "uniqueItems"'],
  ])('refuses %s', (_, choices, message) => {
    expect(() => build(schema(choices))).toThrow(message);
  });

  it("checks the poll's own rules", () => {
    const poll = studioElementTypes().find((t) => t.key === 'poll');
    const options = [
      { id: 'a', label: 'Tea' },
      { id: 'b', label: 'Coffee' },
    ];
    expect(poll?.check?.({ question: 'Tea?', options })).toBeNull();
    expect(poll?.check?.({ question: '  ', options })).toBe('Enter some text.');
    expect(poll?.check?.({ question: 'Tea?', options: [options[0], { id: 'a', label: 'B' }] })).toBe(
      'Each option needs its own id.',
    );
    expect(poll?.preview?.({ question: 'Tea?', options })).toBe('Tea?');
  });
});

// A poll as a stored draft holds it.
function storedPoll(): PollElement {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    type: 'poll',
    box: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: {
      question: 'Tea or coffee?',
      theme: 'light',
      options: [
        { id: 'tea', label: 'Tea' },
        { id: 'coffee', label: 'Coffee' },
      ],
    },
  };
}

describe('Tale Studio: a poll (epic interactive components story 4.1)', () => {
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
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const live = () => root.querySelector('p.visually-hidden[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const poll = () => doc().elements[0] as PollElement;
  const edit = async (selector: string, value: string, event: 'input' | 'change' = 'change') => {
    const field = q<HTMLInputElement | HTMLSelectElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event(event));
    await settle(fixture);
  };
  const counts = () =>
    [...root.querySelectorAll('#studio-responses li')].map((li) =>
      [...li.children].map((span) => span.textContent?.trim()).join(' '),
    );

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
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+$/.test(r.url))) {
      read.flush({ visibility: { visible: true, reasons: [] } });
    }
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('adds a poll, edits its question and options keeping their ids, and shows its votes', async () => {
    await open();
    const add = q<HTMLButtonElement>('#studio-add-poll');
    expect(add.textContent?.trim()).toBe('Add poll');
    add.click();
    await settle(fixture);
    expect(live()).toBe('Poll added at 10%, 34%. Selected.');
    const id = poll().id;
    expect(poll().type).toBe('poll');
    expect(poll().props.question).toBe('Ask a question');
    const [first, second] = poll().props.options.map((o) => o.id);
    expect(first).not.toBe(second);
    // Focus is on the new poll on the canvas (epic Tale Studio 2 R3).
    expect(globalThis.document.activeElement?.id).toBe(`studio-el-${id}`);
    // Its votes are read for the selected poll: none yet.
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    expect(counts()).toEqual(['Yes 0', 'No 0']);
    expect(q('#studio-responses-note')).toBeNull();

    // One poll per tale: the Add entry says so.
    expect(q('#studio-add-poll').getAttribute('aria-disabled')).toBe('true');
    expect(q('#studio-poll-hint').textContent).toContain('A tale holds one poll');

    await edit(`#field-poll-question-${id}`, 'Tea or coffee?');
    await edit(`#field-poll-options-${id}-0`, 'Tea');
    await edit(`#field-poll-options-${id}-1`, 'Coffee');
    await edit(`#field-poll-theme-${id}`, 'dark');
    expect(poll().props).toEqual({
      question: 'Tea or coffee?',
      theme: 'dark',
      options: [
        { id: first, label: 'Tea' },
        { id: second, label: 'Coffee' },
      ],
    });
    // Each option is a labelled field in a named group; a blank option is refused and said.
    expect(root.querySelector(`label[for="field-poll-options-${id}-0"]`)?.textContent?.trim()).toBe('Option 1');
    expect(q('fieldset.fields-choices legend').textContent?.trim()).toBe('Options');
    await edit(`#field-poll-options-${id}-0`, '   ');
    expect(q(`#field-poll-options-${id}-0-error`).textContent).toBe('Enter some text.');
    expect(poll().props.options[0].label).toBe('Tea');
    await edit(`#field-poll-options-${id}-0`, 'x'.repeat(61), 'input');
    expect(q(`#field-poll-options-${id}-0-error`).textContent).toBe('Use at most 60 characters.');

    // After votes on the site: the counts per option, and a note before its choices are edited.
    q<HTMLButtonElement>('#studio-responses-refresh').click();
    http.expectOne(responsesUrl).flush({
      elements: [{ elementId: id, elementType: 'poll', total: 1, values: [{ value: first, count: 1 }] }],
    });
    await settle(fixture);
    expect(counts()).toEqual(['Tea 1', 'Coffee 0']);
    expect(q('#studio-responses-note').textContent).toContain('This poll already has votes');
    // Editing an option's text does not read the votes again, and its count stays.
    await edit(`#field-poll-options-${id}-0`, 'Green tea');
    expect(counts()).toEqual(['Green tea 1', 'Coffee 0']);

    // Saving sends the poll as it is.
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    expect(body.document.elements[0]).toMatchObject({ type: 'poll', props: { question: 'Tea or coffee?' } });
    req.flush({ document: body.document, revision: 1 });
    expect(await leaving).toBe(true);
  });

  it('refuses to duplicate a poll, since a tale holds one', async () => {
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [storedPoll()] });
    const el = q<HTMLButtonElement>(`#studio-el-${storedPoll().id}`);
    el.click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ elements: [] });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(doc().elements).toHaveLength(1);
    expect(live()).toBe('A tale holds one poll, so it cannot be duplicated');
  });

  it('applies each option edit to the poll as it is then, even when two land before a redraw', async () => {
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [storedPoll()] });
    const id = storedPoll().id;
    q<HTMLButtonElement>(`#studio-el-${id}`).click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ elements: [] });
    // Both fields change before the inspector sees the first edit.
    for (const [i, label] of ['Green tea', 'Black coffee'].entries()) {
      const field = q<HTMLInputElement>(`#field-poll-options-${id}-${i}`);
      field.value = label;
      field.dispatchEvent(new Event('change'));
    }
    await settle(fixture);
    expect(poll().props.options).toEqual([
      { id: 'tea', label: 'Green tea' },
      { id: 'coffee', label: 'Black coffee' },
    ]);
  });

  it('says when the votes cannot be read', async () => {
    const element: PollElement = {
      id: '00000000-0000-4000-8000-0000000000aa',
      type: 'poll',
      box: { x: 0.1, y: 0.36, w: 0.8, h: 0.28, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: {
        question: 'Tea or coffee?',
        theme: 'light',
        options: [
          { id: 'tea', label: 'Tea' },
          { id: 'coffee', label: 'Coffee' },
        ],
      },
    };
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [element] });
    q<HTMLButtonElement>(`#studio-el-${element.id}`).click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ error: { code: 'internal_error', message: 'x' } }, { status: 500, statusText: 'Error' });
    await settle(fixture);
    expect(root.textContent).toContain('Could not read the votes');
  });
});
