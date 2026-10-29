import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ZoneTaleGroup } from '@taleart/contract/core';
import {
  propSchema,
  propValueProblem,
  type PropSchema,
  TALE_ELEMENT_TYPE_REGISTRY,
  type CountdownElement,
  type PromoCodeElement,
  isUtcInstant,
  type TaleDocument,
} from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { STUDIO_TEST_ELEMENT_TYPES, studioElementTypes, type InspectorField, type StudioElementType } from './tale-element-types';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Components (2026-10-29): a countdown and a promo code in Tale Studio. Each is added from the
// Interactive group, edited in its inspector, and checked against its schema and the server's rules as
// people type: a countdown's end is a real UTC date and time, a promo code's code is 1 to 32 letters,
// digits, underscores or hyphens.
const schemaOf = (key: string) => {
  const entry = TALE_ELEMENT_TYPE_REGISTRY.find((t) => t.key === key);
  if (!entry) throw new Error(`no ${key} in the registry`);
  return entry.schema;
};
const propOf = (key: string, prop: string): PropSchema => {
  const found = propSchema(schemaOf(key), prop);
  if (!found) throw new Error(`${key} has no ${prop}`);
  return found.schema;
};
const typeOf = (key: string): StudioElementType => {
  const type = studioElementTypes().find((t) => t.key === key);
  if (!type) throw new Error(`no ${key} type`);
  return type;
};
const fieldsOf = (key: string) => (typeOf(key).inspector as { fields: InspectorField[] }).fields;

describe('the countdown and promo-code descriptors (components, 2026-10-29)', () => {
  it('are offered in the Interactive group, with no limit per tale', () => {
    expect(typeOf('countdown').palette).toMatchObject({ category: 'interactive', order: 3, icon: 'countdown' });
    expect(typeOf('countdown').palette?.limit).toBeUndefined();
    expect(typeOf('promo-code').palette).toMatchObject({ category: 'interactive', order: 4, icon: 'promo-code' });
    expect(typeOf('promo-code').palette?.limit).toBeUndefined();
  });

  it('edit the props their schemas name, the theme as a select', () => {
    expect(fieldsOf('countdown').map((f) => [f.prop, f.control])).toEqual([
      ['endsAt', 'text'],
      ['title', 'text'],
      ['endedText', 'text'],
      ['theme', 'select'],
    ]);
    expect(fieldsOf('promo-code').map((f) => [f.prop, f.control])).toEqual([
      ['code', 'text'],
      ['title', 'text'],
      ['note', 'text'],
      ['theme', 'select'],
    ]);
  });

  it('add a countdown that ends a week from now, in UTC, which its schema accepts', () => {
    const props = typeOf('countdown').create?.props() ?? {};
    expect(isUtcInstant(props['endsAt'])).toBe(true);
    const days = (Date.parse(props['endsAt'] as string) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(propValueProblem(propOf('countdown', 'endsAt'), props['endsAt'], true)).toBeNull();
  });

  it('add a promo code that its schema accepts', () => {
    const props = typeOf('promo-code').create?.props() ?? {};
    expect(propValueProblem(propOf('promo-code', 'code'), props['code'], true)).toBeNull();
  });

  it("checks a countdown's end is a real date and time in UTC, and its texts are one line", () => {
    const check = typeOf('countdown').check;
    expect(check?.({ endsAt: '2026-12-31T21:00:00Z', theme: 'dark' })).toBeNull();
    expect(check?.({ endsAt: '2026-02-30T00:00:00Z' })).toBe('Use a real date and time in UTC, such as 2026-12-31T21:00:00Z.');
    expect(check?.({ endsAt: '2026-12-31T21:00:00Z', title: '  ' })).toBe('Enter some text.');
    expect(check?.({ endsAt: '2026-12-31T21:00:00Z', endedText: 'Over\nnow' })).toBe('Use one line of plain text.');
    expect(typeOf('countdown').preview?.({ title: 'Sale' })).toBe('Sale');
    expect(typeOf('countdown').preview?.({})).toBe('Countdown');
  });

  it("checks a promo code's title and note are one line of text", () => {
    const check = typeOf('promo-code').check;
    expect(check?.({ code: 'SPRING26', note: 'Once per visitor' })).toBeNull();
    expect(check?.({ code: 'SPRING26', note: 'Terms‮' })).toBe('Use one line of plain text.');
    expect(typeOf('promo-code').preview?.({ code: 'SPRING26' })).toBe('SPRING26');
  });

  it('refuse each value its schema refuses, in the words the inspector shows', () => {
    const endsAt = propOf('countdown', 'endsAt');
    expect(propValueProblem(endsAt, '2026-12-31T21:00:00+02:00', true)).toBe('This value is not allowed here.');
    expect(propValueProblem(endsAt, '2026-12-31 21:00:00Z', true)).toBe('This value is not allowed here.');
    expect(propValueProblem(endsAt, '', true)).toBe('This value is not allowed here.');
    expect(propValueProblem(endsAt, undefined, true)).toBe('This is required.');
    expect(propValueProblem(endsAt, '2026-12-31T21:00:00.5Z', true)).toBeNull();

    const code = propOf('promo-code', 'code');
    for (const bad of ['SPRING 26', 'SPRING.26', 'CAFÉ', 'SAVE🎉', 'A/B', '<b>x</b>']) {
      expect(propValueProblem(code, bad, true), bad).toBe('This value is not allowed here.');
    }
    expect(propValueProblem(code, '', true)).toBe('Enter some text.');
    expect(propValueProblem(code, 'a'.repeat(33), true)).toBe('Use at most 32 characters.');
    for (const good of ['A', 'spring_26-x', 'a'.repeat(32)]) expect(propValueProblem(code, good, true), good).toBeNull();

    const note = propOf('promo-code', 'note');
    expect(propValueProblem(note, 'x'.repeat(121), false)).toBe('Use at most 120 characters.');
    const endedText = propOf('countdown', 'endedText');
    expect(propValueProblem(endedText, 'x'.repeat(81), false)).toBe('Use at most 80 characters.');
  });

  it('keep the inspector hints the schemas state', () => {
    const hint = (key: string, prop: string) => fieldsOf(key).find((f) => f.prop === prop)?.hint;
    expect(hint('countdown', 'endsAt')).toContain('2026-12-31T21:00:00Z');
    expect(hint('promo-code', 'code')).toContain('up to 32 characters');
  });
});

const countdownId = '00000000-0000-4000-8000-0000000000c1';
const promoId = '00000000-0000-4000-8000-0000000000f1';

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

describe('Tale Studio: a countdown and a promo code (components, 2026-10-29)', () => {
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
  const doc = () => (fixture.componentInstance as unknown as { doc: () => TaleDocument }).doc();
  const edit = async (selector: string, value: string) => {
    const field = q<HTMLInputElement | HTMLSelectElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event('change'));
    await settle(fixture);
  };
  const errorOf = (id: string) => q(`#${id}-error`)?.textContent ?? '';

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

  it('adds a countdown, refuses an end that is no real moment, and keeps the last valid one', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-countdown').click();
    await settle(fixture);
    const countdown = doc().elements[0] as CountdownElement;
    expect(countdown.type).toBe('countdown');
    const endsId = `field-countdown-endsAt-${countdown.id}`;

    await edit(`#${endsId}`, '2026-02-30T00:00:00Z');
    expect(errorOf(endsId)).toBe('Use a real date and time in UTC, such as 2026-12-31T21:00:00Z.');
    expect((doc().elements[0] as CountdownElement).props.endsAt).not.toBe('2026-02-30T00:00:00Z');

    await edit(`#${endsId}`, '2026-12-31T21:00:00Z');
    expect(errorOf(endsId)).toBe('');
    expect((doc().elements[0] as CountdownElement).props.endsAt).toBe('2026-12-31T21:00:00Z');
  });

  it('adds a promo code and refuses a code with a space, then accepts one of letters and digits', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-promo-code').click();
    await settle(fixture);
    const promo = doc().elements[0] as PromoCodeElement;
    expect(promo.type).toBe('promo-code');
    const codeId = `field-promo-code-code-${promo.id}`;

    await edit(`#${codeId}`, 'SPRING 26');
    expect(errorOf(codeId)).toBe('This value is not allowed here.');
    expect((doc().elements[0] as PromoCodeElement).props.code).toBe('WELCOME10');

    await edit(`#${codeId}`, 'SPRING26');
    expect(errorOf(codeId)).toBe('');
    expect((doc().elements[0] as PromoCodeElement).props.code).toBe('SPRING26');
  });

  it('keeps a countdown and a promo code in the document as they are saved', async () => {
    await open({
      version: 1,
      canvas: { background: { type: 'color', color: '#000000' } },
      elements: [
        {
          id: countdownId,
          type: 'countdown',
          box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { endsAt: '2026-12-31T21:00:00Z', endedText: 'Sale over', theme: 'dark' },
        },
        {
          id: promoId,
          type: 'promo-code',
          box: { x: 0.1, y: 0.62, w: 0.8, h: 0.22, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { code: 'SPRING26', note: 'Once per visitor' },
        },
      ],
    } as unknown as TaleDocument);
    expect(q(`#studio-el-${countdownId}`)).not.toBeNull();
    expect(q(`#studio-el-${promoId}`)).not.toBeNull();
    q<HTMLButtonElement>(`#studio-el-${countdownId}`).click();
    await settle(fixture);
    expect(q(`#field-countdown-endedText-${countdownId}`)).not.toBeNull();
    q<HTMLButtonElement>(`#studio-el-${promoId}`).click();
    await settle(fixture);
    expect(q(`#field-promo-code-note-${promoId}`)).not.toBeNull();
    expect(doc().elements.map((e) => e.props)).toEqual([
      { endsAt: '2026-12-31T21:00:00Z', endedText: 'Sale over', theme: 'dark' },
      { code: 'SPRING26', note: 'Once per visitor' },
    ]);
  });
});
