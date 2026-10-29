import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import type { ReactionElement, TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { STUDIO_TEST_ELEMENT_TYPES, studioElementTypes, type EmojiListField, type InspectorField } from './tale-element-types';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Components (2026-10-29): a Reaction in Tale Studio. Added from the Add menu, limited to one per tale,
// edited in its inspector (question, title, theme and its two to six emoji through the emoji picker), and
// its count per emoji shown from the Management API.
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
const reactionId = '00000000-0000-4000-8000-0000000000ee';

function storedReaction(emojis = ['❤️', '😂', '😮']): ReactionElement {
  return {
    id: reactionId,
    type: 'reaction',
    box: { x: 0.1, y: 0.62, w: 0.8, h: 0.22, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { question: 'How was the beach?', emojis, theme: 'light' },
  };
}

describe('the reaction descriptor and its emoji list', () => {
  const reaction = () => studioElementTypes().find((t) => t.key === 'reaction');

  it('is offered after the promo code, limited to one per tale', () => {
    const add = reaction()?.palette;
    expect(add?.category).toBe('interactive');
    expect(add?.order).toBe(5);
    expect(add?.limit?.reached({ elements: [{ type: 'reaction' }] })).toBe(true);
    expect(add?.limit?.reached({ elements: [{ type: 'promo-code' }] })).toBe(false);
    expect(reaction()?.create?.props()).toEqual({ question: 'How do you feel?', emojis: ['❤️', '😂', '😮'], theme: 'light' });
  });

  it('edits its question, title and theme as fields, and its emoji as a list', () => {
    const inspector = reaction()?.inspector as { fields: InspectorField[]; emojis?: EmojiListField };
    expect(inspector.fields.map((f) => [f.prop, f.control])).toEqual([
      ['question', 'text'],
      ['title', 'text'],
      ['theme', 'select'],
    ]);
    expect(inspector.emojis?.prop).toBe('emojis');
    expect(inspector.emojis?.itemLabel(1)).toBe('Emoji 2');
  });

  it("checks the Reaction's own rules: one line of text, two to six emoji, each one emoji and all different", () => {
    const check = reaction()?.check;
    expect(check?.({ question: 'How was it?', emojis: ['❤️', '😂'] })).toBeNull();
    expect(check?.({ question: 'How was it?', emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏'] })).toBeNull();
    expect(check?.({ question: 'Q', emojis: ['❤️'] })).toBe('Pick two to six emoji.');
    expect(check?.({ question: 'Q', emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏', '😮'] })).toBe('Pick two to six emoji.');
    expect(check?.({ question: 'Q', emojis: ['❤️', '❤️'] })).toBe('Each emoji can be picked once.');
    expect(check?.({ question: 'Q', emojis: ['❤️', 'love'] })).toBe('Choose one emoji for each.');
    expect(check?.({ question: 'Q', emojis: ['❤️', '😂😂'] })).toBe('Choose one emoji for each.');
    expect(check?.({ question: 'How\nwas it?', emojis: ['❤️', '😂'] })).toBe('Use one line of plain text.');
    expect(check?.({ question: '  ', emojis: ['❤️', '😂'] })).toBe('Enter some text.');
    expect(reaction()?.preview?.({ question: 'How was it?' })).toBe('How was it?');
  });

  it('refuses an emoji list whose prop is not an array', () => {
    expect(() =>
      studioElementTypes({
        registry: [{ key: 'widget', label: 'Widget', schema: { type: 'object', properties: { e: { type: 'string' } } } }],
        descriptors: {
          widget: {
            create: { box: { x: 0, y: 0, w: 0.5, h: 0.1, rotation: 0 }, props: () => ({}) },
            inspector: { fields: [], emojis: { prop: 'e', label: 'E', itemLabel: () => 'E' } },
          },
        },
      }),
    ).toThrow('must be an array');
  });
});

describe('Tale Studio: a Reaction (components, 2026-10-29)', () => {
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
  const reaction = () => doc().elements[0] as ReactionElement;
  const emojis = () => reaction().props.emojis;
  const listId = () => `field-reaction-emojis-${reaction().id}`;
  const pickInPicker = async (name: string) => {
    const picker = q<HTMLElement>('app-tale-emoji-picker');
    expect(picker).not.toBeNull();
    (picker.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement).click();
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

  it('adds a Reaction, edits its emoji list through the picker, and keeps two to six emoji', async () => {
    await open();
    const add = q<HTMLButtonElement>('#studio-add-reaction');
    expect(add.textContent?.trim()).toBe('Add reaction');
    add.click();
    await settle(fixture);
    const id = reaction().id;
    expect(emojis()).toEqual(['❤️', '😂', '😮']);
    http.expectOne(responsesUrl).flush({ elements: [] });
    await settle(fixture);
    expect(q('#studio-responses-title').textContent).toBe('Reactions');
    expect(q('#studio-responses-total').textContent).toBe('0 reactions');

    // One Reaction per tale: the Add entry says so.
    expect(q('#studio-add-reaction').getAttribute('aria-disabled')).toBe('true');
    expect(q('#studio-reaction-hint').textContent).toContain('A tale holds one reaction');

    // Adding an emoji opens the picker; the emoji is appended.
    q<HTMLButtonElement>(`#${listId()}-add`).click();
    await settle(fixture);
    await pickInPicker('fire');
    expect(emojis()).toEqual(['❤️', '😂', '😮', '🔥']);
    expect(live()).toBe('Emoji 4 added. 4 of 6.');

    // A duplicate is refused, and says so in the list's error line.
    q<HTMLButtonElement>(`#${listId()}-1`).click();
    await settle(fixture);
    await pickInPicker('red heart');
    expect(emojis()).toEqual(['❤️', '😂', '😮', '🔥']);
    expect(q(`#${listId()}-error`).textContent).toBe('Each emoji can be picked once.');

    // Moving and removing keep the list in order; removing stops at two.
    q<HTMLButtonElement>(`#${listId()}-3-remove`).click();
    await settle(fixture);
    expect(emojis()).toEqual(['❤️', '😂', '😮']);
    q<HTMLButtonElement>(`#${listId()}-2-up`).click();
    await settle(fixture);
    expect(emojis()).toEqual(['❤️', '😮', '😂']);
    q<HTMLButtonElement>(`#${listId()}-0-remove`).click();
    await settle(fixture);
    expect(emojis()).toEqual(['😮', '😂']);
    expect(q(`#${listId()}-0-remove`).getAttribute('aria-disabled')).toBe('true');
    q<HTMLButtonElement>(`#${listId()}-0-remove`).click();
    await settle(fixture);
    expect(emojis()).toEqual(['😮', '😂']);
    expect(reaction().id).toBe(id);
  });

  it('shows the taps per emoji from the Management API, as the emoji list holds them now', async () => {
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [storedReaction()] });
    q<HTMLButtonElement>(`#studio-el-${reactionId}`).click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({
      elements: [{ elementId: reactionId, elementType: 'reaction', total: 3, values: [{ value: '❤️', count: 2 }, { value: '😂', count: 1 }, { value: 'gone', count: 4 }] }],
    });
    await settle(fixture);
    expect(q('#studio-responses-total').textContent).toBe('3 reactions');
    const counts = [...root.querySelectorAll('#studio-responses .responses__count')].map((c) => c.textContent);
    expect(counts).toEqual(['2', '1', '0']);
    expect(q('#studio-responses-note').textContent).toContain('This reaction already has taps');
  });

  it('does not open the picker for a locked Reaction', async () => {
    const locked = { ...storedReaction(), locked: true };
    await open({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [locked] });
    q<HTMLButtonElement>(`#studio-el-${reactionId}`).click();
    await settle(fixture);
    http.expectOne(responsesUrl).flush({ elements: [] });
    const choose = q<HTMLButtonElement>(`#${listId()}-0`);
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    choose.click();
    await settle(fixture);
    expect(q('app-tale-emoji-picker')).toBeNull();
  });
});
