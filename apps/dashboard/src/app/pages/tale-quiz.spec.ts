import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { QuizElement, TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import {
  applyChoiceEdit,
  STUDIO_TEST_ELEMENT_TYPES,
  studioElementTypes,
  type ChoicesField,
  type InspectorField,
} from './tale-element-types';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Epic interactive components story 4.3: a quiz in Tale Studio (R1, R3, R11): added from the Add
// menu, its two to four answers added, removed and moved by id in a list field, one picked as
// correct or none, limited to one per tale, and its answers counted per answer from the Management API.
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
const answers = [
  { id: 'a', label: 'Mercury' },
  { id: 'b', label: 'Venus' },
  { id: 'c', label: 'Earth' },
  { id: 'd', label: 'Mars' },
];

describe('applyChoiceEdit', () => {
  const props = { question: 'Q', answers, correctAnswerId: 'b' };

  it("relabels a choice by its index, keeping its id", () => {
    expect(applyChoiceEdit(props, { prop: 'answers', index: 1, label: 'Venus!' })?.['answers']).toEqual([
      answers[0],
      { id: 'b', label: 'Venus!' },
      answers[2],
      answers[3],
    ]);
    expect(applyChoiceEdit(props, { prop: 'answers', index: 4, label: 'x' })).toBeNull();
  });

  it('adds a choice up to the most allowed, never with an id it holds', () => {
    const two = { answers: answers.slice(0, 2) };
    expect(applyChoiceEdit(two, { prop: 'answers', add: { id: 'n', label: 'New' }, max: 4 })?.['answers']).toEqual([
      ...answers.slice(0, 2),
      { id: 'n', label: 'New' },
    ]);
    expect(applyChoiceEdit(props, { prop: 'answers', add: { id: 'n', label: 'New' }, max: 4 })).toBeNull();
    expect(applyChoiceEdit(two, { prop: 'answers', add: { id: 'a', label: 'Again' }, max: 4 })).toBeNull();
  });

  it('removes a choice by id down to the fewest allowed, clearing the correct pick when it was that one', () => {
    expect(applyChoiceEdit(props, { prop: 'answers', remove: 'd', min: 2, clears: 'correctAnswerId' })).toEqual({
      question: 'Q',
      answers: answers.slice(0, 3),
      correctAnswerId: 'b',
    });
    expect(applyChoiceEdit(props, { prop: 'answers', remove: 'b', min: 2, clears: 'correctAnswerId' })).toEqual({
      question: 'Q',
      answers: [answers[0], answers[2], answers[3]],
    });
    expect(applyChoiceEdit({ answers: answers.slice(0, 2) }, { prop: 'answers', remove: 'a', min: 2 })).toBeNull();
    expect(applyChoiceEdit(props, { prop: 'answers', remove: 'z', min: 2 })).toBeNull();
  });

  it('moves a choice one place by id, not past either end', () => {
    expect(applyChoiceEdit(props, { prop: 'answers', move: 'c', by: -1 })?.['answers']).toEqual([
      answers[0],
      answers[2],
      answers[1],
      answers[3],
    ]);
    expect(applyChoiceEdit(props, { prop: 'answers', move: 'a', by: -1 })).toBeNull();
    expect(applyChoiceEdit(props, { prop: 'answers', move: 'd', by: 1 })).toBeNull();
    expect(applyChoiceEdit({ answers: 'none' }, { prop: 'answers', move: 'a', by: 1 })).toBeNull();
  });
});

describe('the quiz descriptor and the list field', () => {
  const add = [
    {
      id: 'studio-add-widget',
      label: 'Add widget',
      icon: 'plus' as const,
      row: 3,
      small: true,
      needsProject: false,
      action: { kind: 'configured' as const },
    },
  ];
  const create = { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) };
  const item = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label'],
    properties: { id: { type: 'string', pattern: '^[a-z]+$' }, label: { type: 'string', maxLength: 9 } },
  };
  const list: ChoicesField = {
    prop: 'choices',
    label: 'Choices',
    itemLabel: (i) => `Choice ${i + 1}`,
    newLabel: (i) => `Choice ${i + 1}`,
    addLabel: 'Add choice',
    correct: { prop: 'right', label: 'Right one', none: 'None' },
  };
  const build = (right: Record<string, unknown>, required: string[] = []) =>
    studioElementTypes({
      registry: [
        {
          key: 'widget',
          label: 'Widget',
          schema: {
            type: 'object',
            additionalProperties: false,
            required,
            properties: { q: { type: 'string' }, choices: { type: 'array', minItems: 2, maxItems: 4, items: item }, right },
          },
        },
      ],
      descriptors: {
        widget: { add, create, inspector: { fields: [{ prop: 'q', label: 'Q', control: 'text' }] as InspectorField[], choices: list } },
      },
    });

  it('lets the real quiz through, on the Add menu after the rating', () => {
    const quiz = studioElementTypes().find((t) => t.key === 'quiz');
    expect(quiz?.add[0]).toMatchObject({ id: 'studio-add-quiz', label: 'Add quiz', row: 3 });
  });

  it('accepts a list of two to four with a label for new items and an optional correct pick', () => {
    expect(build({ type: 'string' })).toHaveLength(1);
  });

  it('refuses a correct pick that is required, of another type or missing', () => {
    expect(() => build({ type: 'string' }, ['right'])).toThrow('must be an optional string prop');
    expect(() => build({ type: 'integer' })).toThrow('must be an optional string prop');
  });

  it("checks the quiz's own rules", () => {
    const quiz = studioElementTypes().find((t) => t.key === 'quiz');
    expect(quiz?.check?.({ question: 'Hottest?', answers, correctAnswerId: 'b' })).toBeNull();
    expect(quiz?.check?.({ question: 'Hottest?', answers })).toBeNull();
    expect(quiz?.check?.({ question: 'Hottest?', answers, correctAnswerId: 'z' })).toBe('Pick one of the answers, or none.');
    expect(quiz?.check?.({ question: 'Hottest?', answers: [answers[0], { id: 'a', label: 'B' }] })).toBe(
      'Each answer needs its own id.',
    );
    expect(quiz?.check?.({ question: 'Hottest?', answers: [{ id: 'a', label: 'Two\nlines' }, answers[1]] })).toBe(
      'Use one line of plain text.',
    );
    expect(quiz?.preview?.({ question: 'Hottest?', answers })).toBe('Hottest?');
  });
});

// A quiz as a stored draft holds it: four answers, B correct.
function storedQuiz(extra: Partial<QuizElement> = {}): QuizElement {
  return {
    id: '00000000-0000-4000-8000-0000000000cc',
    type: 'quiz',
    box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { question: 'Which planet is hottest?', theme: 'light', answers, correctAnswerId: 'b' },
    ...extra,
  };
}

describe('Tale Studio: a quiz (epic interactive components story 4.3)', () => {
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

  async function openStored(element: QuizElement = storedQuiz()): Promise<void> {
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [element] });
    q<HTMLButtonElement>(`#studio-el-${element.id}`).click();
    await settle(fixture);
  }

  const q = <T extends Element>(selector: string) => root.querySelector(selector) as T;
  const live = () => root.querySelector('p.visually-hidden[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const quiz = () => doc().elements[0] as QuizElement;
  const labels = () => quiz().props.answers.map((a) => a.label);
  const field = (id: string) => `#field-quiz-answers-${id}`;
  const press = async (selector: string) => {
    q<HTMLButtonElement>(selector).click();
    await settle(fixture);
  };
  const edit = async (selector: string, value: string, event: 'input' | 'change' = 'change') => {
    const input = q<HTMLInputElement | HTMLSelectElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event(event));
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

  it('adds a quiz, adds answers up to four, picks a correct one and saves it', async () => {
    await open();
    const add = q<HTMLButtonElement>('#studio-add-quiz');
    expect(add.textContent?.trim()).toBe('Add quiz');
    add.click();
    await settle(fixture);
    expect(live()).toBe('Quiz added');
    const id = quiz().id;
    expect(quiz().props.question).toBe('Ask a question');
    expect(labels()).toEqual(['Answer 1', 'Answer 2']);
    expect(quiz().props.correctAnswerId).toBeUndefined();
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-question-${id}`);
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    expect(counts()).toEqual(['Answer 1 0', 'Answer 2 0']);
    expect(q('#studio-responses-title').textContent?.trim()).toBe('Answers');
    expect(q('#studio-responses-total').textContent?.trim()).toBe('0 answers');

    // One quiz per tale: the Add entry says so.
    expect(q('#studio-add-quiz').getAttribute('aria-disabled')).toBe('true');
    expect(q('#studio-quiz-hint').textContent).toContain('A tale holds one quiz');

    // At two answers none can be removed; the Add button says how many it holds.
    const g = field(id);
    expect(q(`${g}-0-remove`).getAttribute('aria-disabled')).toBe('true');
    expect(q(`${g}-0-up`).getAttribute('aria-disabled')).toBe('true');
    expect(q(`${g}-1-down`).getAttribute('aria-disabled')).toBe('true');
    expect(q(`${g}-add`).textContent?.trim()).toBe('Add answer');
    expect(q(`${g}-count`).textContent?.trim()).toBe('2 of 4: it needs at least 2.');
    await press(`${g}-add`);
    expect(labels()).toEqual(['Answer 1', 'Answer 2', 'Answer 3']);
    expect(live()).toBe('Answer 3 added. 3 of 4.');
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-answers-${id}-2`);
    await press(`${g}-add`);
    expect(q(`${g}-add`).getAttribute('aria-disabled')).toBe('true');
    expect(q(`${g}-count`).textContent?.trim()).toBe('4 of 4: the most it holds.');
    await press(`${g}-add`);
    expect(labels()).toHaveLength(4);
    const ids = quiz().props.answers.map((a) => a.id);
    expect(new Set(ids).size).toBe(4);

    for (const [i, label] of ['Mercury', 'Venus', 'Earth', 'Mars'].entries()) await edit(`${g}-${i}`, label);
    await edit(`#field-quiz-question-${id}`, 'Which planet is hottest?');
    // The correct answer is picked from the answers by name, or none.
    const options = [...root.querySelectorAll(`${g}-correct option`)].map((o) => o.textContent?.trim());
    expect(options).toEqual([
      'None: show only the percentages',
      'Answer 1: Mercury',
      'Answer 2: Venus',
      'Answer 3: Earth',
      'Answer 4: Mars',
    ]);
    expect(root.querySelector(`label[for="field-quiz-answers-${id}-correct"]`)?.textContent?.trim()).toBe('Correct answer');
    await edit(`${g}-correct`, ids[1]);
    expect(quiz().props.correctAnswerId).toBe(ids[1]);
    expect(live()).toBe('Correct answer: answer 2, Venus');

    // Each list button is named by its visible text first, then the answer (WCAG 2.5.3).
    expect(q(`${g}-1-remove`).textContent?.replace(/\s+/g, ' ').trim()).toBe('Remove: Answer 2');

    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    expect(body.document.elements[0]).toMatchObject({
      type: 'quiz',
      props: { question: 'Which planet is hottest?', correctAnswerId: ids[1] },
    });
    req.flush({ document: body.document, revision: 1 });
    expect(await leaving).toBe(true);
  });

  it('moves answers by id with their counts, keeping focus on the moved answer', async () => {
    await openStored();
    const id = storedQuiz().id;
    const g = field(id);
    http.expectOne(responsesUrl).flush({
      elements: [{ elementId: id, elementType: 'quiz', total: 3, values: [{ value: 'c', count: 2 }, { value: 'b', count: 1 }] }],
    });
    await settle(fixture);
    expect(counts()).toEqual(['Mercury 0', 'Venus (correct) 1', 'Earth 2', 'Mars 0']);

    await press(`${g}-2-up`);
    expect(labels()).toEqual(['Mercury', 'Earth', 'Venus', 'Mars']);
    expect(live()).toBe('Answer 3 moved up; it is now answer 2.');
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-answers-${id}-1-up`);
    expect(counts()).toEqual(['Mercury 0', 'Earth 2', 'Venus (correct) 1', 'Mars 0']);
    // At the top, focus goes to the other direction's button.
    await press(`${g}-1-up`);
    expect(labels()).toEqual(['Earth', 'Mercury', 'Venus', 'Mars']);
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-answers-${id}-0-down`);
    await press(`${g}-0-up`);
    expect(labels()).toEqual(['Earth', 'Mercury', 'Venus', 'Mars']);
    await press(`${g}-2-down`);
    expect(labels()).toEqual(['Earth', 'Mercury', 'Mars', 'Venus']);
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-answers-${id}-3-up`);
    expect(quiz().props.correctAnswerId).toBe('b');
  });

  it("keeps an answer's count when its text changes, and drops a removed answer's", async () => {
    await openStored();
    const id = storedQuiz().id;
    const g = field(id);
    http.expectOne(responsesUrl).flush({
      elements: [
        {
          elementId: id,
          elementType: 'quiz',
          total: 4,
          values: [
            { value: 'b', count: 2 },
            { value: 'c', count: 1 },
            { value: 'd', count: 1 },
          ],
        },
      ],
    });
    await settle(fixture);
    expect(q('#studio-responses-note').textContent).toContain('This quiz already has answers');
    expect(q('#studio-responses-total').textContent?.trim()).toBe('4 answers');
    await edit(`${g}-1`, 'Venus, second planet');
    expect(counts()).toEqual(['Mercury 0', 'Venus, second planet (correct) 2', 'Earth 1', 'Mars 1']);
    await press(`${g}-3-remove`);
    expect(labels()).toEqual(['Mercury', 'Venus, second planet', 'Earth']);
    expect(live()).toBe('Answer 4 removed. 3 of 4.');
    expect(globalThis.document.activeElement?.id).toBe(`field-quiz-answers-${id}-2`);
    expect(counts()).toEqual(['Mercury 0', 'Venus, second planet (correct) 2', 'Earth 1']);
    expect(q('#studio-responses-total').textContent?.trim()).toBe('3 answers');

    // Removing the correct answer leaves none correct.
    await press(`${g}-1-remove`);
    expect(labels()).toEqual(['Mercury', 'Earth']);
    expect(quiz().props.correctAnswerId).toBeUndefined();
    expect(live()).toBe('Answer 2 removed; no correct answer now. 2 of 4.');
    expect(q<HTMLSelectElement>(`${g}-correct`).value).toBe('');
    // Two answers are the fewest: no more can be removed.
    await press(`${g}-0-remove`);
    expect(labels()).toEqual(['Mercury', 'Earth']);
  });

  it('keeps a refused answer text and its error together when another answer is removed', async () => {
    await openStored();
    const id = storedQuiz().id;
    const g = field(id);
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    // Answer 2 is cleared: refused, its error shown, the quiz unchanged.
    await edit(`${g}-1`, '');
    expect(q(`${g}-1-error`).textContent).toBe('Enter some text.');
    expect(labels()).toEqual(['Mercury', 'Venus', 'Earth', 'Mars']);
    // Answer 1 is removed: the cleared input is now answer 1, still empty and still with its error.
    await press(`${g}-0-remove`);
    expect(labels()).toEqual(['Venus', 'Earth', 'Mars']);
    expect(q<HTMLInputElement>(`${g}-0`).value).toBe('');
    expect(q(`${g}-0-error`).textContent).toBe('Enter some text.');
    expect(q<HTMLInputElement>(`${g}-1`).value).toBe('Earth');
    expect(q(`${g}-1-error`).textContent).toBe('');
    // Typing a label again applies it to the right answer, by its id.
    await edit(`${g}-0`, 'Venus again');
    expect(quiz().props.answers[0]).toEqual({ id: 'b', label: 'Venus again' });
    expect(q(`${g}-0-error`).textContent).toBe('');
  });

  it('labels a new answer with the next free "Answer N"', async () => {
    await openStored(
      storedQuiz({
        props: { question: 'Q?', theme: 'light', answers: [{ id: 'a', label: 'Answer 3' }, { id: 'b', label: 'Answer 4' }] },
      }),
    );
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    await press(`${field(storedQuiz().id)}-add`);
    expect(labels()).toEqual(['Answer 3', 'Answer 4', 'Answer 5']);
  });

  it('works as a survey with no correct answer picked', async () => {
    await openStored();
    const id = storedQuiz().id;
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    await edit(`${field(id)}-correct`, '');
    expect('correctAnswerId' in quiz().props).toBe(false);
    expect(live()).toBe('No correct answer');
    expect(counts()).toEqual(['Mercury 0', 'Venus 0', 'Earth 0', 'Mars 0']);
  });

  it('changes nothing in a locked quiz', async () => {
    await openStored(storedQuiz({ locked: true }));
    const id = storedQuiz().id;
    const g = field(id);
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    expect(q(`${g}-add`).getAttribute('aria-disabled')).toBe('true');
    expect(q(`${g}-1-remove`).getAttribute('aria-disabled')).toBe('true');
    expect(q<HTMLSelectElement>(`${g}-correct`).disabled).toBe(true);
    await press(`${g}-1-remove`);
    await press(`${g}-1-up`);
    expect(labels()).toEqual(['Mercury', 'Venus', 'Earth', 'Mars']);
  });

  it('refuses to duplicate a quiz, since a tale holds one', async () => {
    await openStored();
    http.expectOne(responsesUrl).flush({ elements: [] });
    const el = q<HTMLButtonElement>(`#studio-el-${storedQuiz().id}`);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(doc().elements).toHaveLength(1);
    expect(live()).toBe('A tale holds one quiz, so it cannot be duplicated');
  });
});
