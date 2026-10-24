import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { RatingElement, TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { STUDIO_TEST_ELEMENT_TYPES, studioElementTypes, type InspectorField } from './tale-element-types';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Epic interactive components story 4.2: a Rating in Tale Studio (R1, R5, R11): added from the Add
// menu, edited in its inspector (question, title, theme, and its emoji through the emoji picker),
// limited to one per tale, and its count and average shown from the Management API.
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

describe('the rating descriptor and the emoji field', () => {
  const rating = () => studioElementTypes().find((t) => t.key === 'rating');

  it('is offered beside the poll, limited to one per tale', () => {
    const add = rating()?.palette;
    expect(add?.category).toBe('interactive');
    expect(add?.order).toBe(1);
    expect(add?.limit?.reached({ elements: [{ type: 'rating' }] })).toBe(true);
    expect(add?.limit?.reached({ elements: [{ type: 'poll' }] })).toBe(false);
    expect((rating()?.inspector as { fields: InspectorField[] }).fields.map((f) => [f.prop, f.control])).toEqual([
      ['question', 'text'],
      ['title', 'text'],
      ['emoji', 'emoji'],
      ['theme', 'select'],
    ]);
  });

  it("checks the Rating's own rules: one line of text and one emoji", () => {
    const check = rating()?.check;
    expect(check?.({ question: 'How was it?', emoji: '❤️', theme: 'light' })).toBeNull();
    expect(check?.({ question: '  ', emoji: '❤️' })).toBe('Enter some text.');
    expect(check?.({ question: 'How\nwas it?', emoji: '❤️' })).toBe('Use one line of plain text.');
    expect(check?.({ question: 'Q', emoji: 'ab' })).toBe('Choose one emoji.');
    expect(check?.({ question: 'Q', emoji: '❤️❤️' })).toBe('Choose one emoji.');
    expect(rating()?.preview?.({ question: 'How was it?', emoji: '❤️' })).toBe('❤️ How was it?');
  });

  it('refuses an emoji field whose prop is not text', () => {
    expect(() =>
      studioElementTypes({
        registry: [{ key: 'widget', label: 'Widget', schema: { type: 'object', properties: { e: { type: 'integer' } } } }],
        descriptors: {
          widget: {
            create: { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) },
            inspector: { fields: [{ prop: 'e', label: 'E', control: 'emoji' }] },
          },
        },
      }),
    ).toThrow('which a emoji field does not edit');
  });
});

function storedRating(): RatingElement {
  return {
    id: '00000000-0000-4000-8000-0000000000dd',
    type: 'rating',
    box: { x: 0.1, y: 0.62, w: 0.8, h: 0.22, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { question: 'How was the beach?', emoji: '❤️', theme: 'light' },
  };
}

describe('Tale Studio: a Rating (epic interactive components story 4.2)', () => {
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

  const q = <T extends Element>(selector: string) => (root.querySelector(selector) ?? globalThis.document.querySelector(selector)) as T;
  const live = () => root.querySelector('p.visually-hidden[aria-live=polite]')?.textContent;
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const rating = () => doc().elements[0] as RatingElement;
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

  it('adds a Rating, edits its question, picks its emoji from the picker, and shows its count and average', async () => {
    await open();
    const add = q<HTMLButtonElement>('#studio-add-rating');
    expect(add.textContent?.trim()).toBe('Add rating');
    add.click();
    await settle(fixture);
    expect(live()).toBe('Rating added near the centre of the safe area. Selected. Press F6 for its properties.');
    const id = rating().id;
    expect(rating().props).toEqual({ question: 'How much do you like it?', emoji: '❤️', theme: 'light' });
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    expect(q('#studio-responses-title').textContent).toBe('Ratings');
    expect(q('#studio-responses-total').textContent).toBe('0 ratings');
    expect(q('#studio-responses-note')).toBeNull();

    // One Rating per tale: the Add entry says so.
    expect(q('#studio-add-rating').getAttribute('aria-disabled')).toBe('true');
    expect(q('#studio-rating-hint').textContent).toContain('A tale holds one rating');

    await edit(`#field-rating-question-${id}`, 'How was the beach?');
    expect(rating().props.question).toBe('How was the beach?');

    // The emoji field: a button named by the emoji's Unicode name, opening the emoji picker.
    const choose = q<HTMLButtonElement>(`#field-rating-emoji-${id}`);
    // Its name starts with the text it shows (WCAG 2.5.3).
    expect(choose.getAttribute('aria-label')).toBe('Choose emoji… Current: red heart');
    expect(choose.getAttribute('aria-label')?.startsWith(choose.textContent?.trim() ?? '-')).toBe(true);
    expect(root.querySelector(`label[for="field-rating-emoji-${id}"]`)?.textContent?.trim()).toBe('Emoji');
    choose.click();
    await settle(fixture);
    const picker = q<HTMLElement>('app-tale-emoji-picker');
    expect(picker).not.toBeNull();
    expect(picker.querySelector('.drawer__title')?.textContent).toBe('Choose the emoji');
    expect(picker.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe('red heart');
    (picker.querySelector('button[aria-label="fire"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(q('app-tale-emoji-picker')).toBeNull();
    expect(rating().props.emoji).toBe('🔥');
    expect(live()).toBe('Emoji set');
    expect(q(`#field-rating-emoji-${id}`).getAttribute('aria-label')).toBe('Choose emoji… Current: fire');

    // After ratings on the site: the count and average, and a note before it is edited.
    q<HTMLButtonElement>('#studio-responses-refresh').click();
    http.expectOne(responsesUrl).flush({
      elements: [{ elementId: id, elementType: 'rating', total: 2, values: [{ value: '40', count: 1 }, { value: '80', count: 1 }] }],
    });
    await settle(fixture);
    expect(q('#studio-responses-total').textContent).toBe('2 ratings, average 60');
    expect(q('#studio-responses-note').textContent).toContain('This rating already has ratings');

    // Saving sends the Rating as it is.
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    expect(body.document.elements[0]).toMatchObject({ type: 'rating', props: { question: 'How was the beach?', emoji: '🔥' } });
    req.flush({ document: body.document, revision: 1 });
    expect(await leaving).toBe(true);
  });

  it('does not open the emoji picker for a locked Rating', async () => {
    const locked = { ...storedRating(), locked: true };
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [locked] });
    q<HTMLButtonElement>(`#studio-el-${locked.id}`).click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ elements: [] });
    const choose = q<HTMLButtonElement>(`#field-rating-emoji-${locked.id}`);
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    choose.click();
    await settle(fixture);
    expect(q('app-tale-emoji-picker')).toBeNull();
  });

  it('refuses to duplicate a Rating, since a tale holds one', async () => {
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [storedRating()] });
    const el = q<HTMLButtonElement>(`#studio-el-${storedRating().id}`);
    el.click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ elements: [] });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(doc().elements).toHaveLength(1);
    expect(live()).toBe('A tale holds one rating, so it cannot be duplicated');
  });
});
