import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectMedia, ZoneTaleGroup } from '@taleart/contract/core';
import { isEmojiGlyph, type TaleDocument, type TaleElement } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { layerName } from './tale-layers';
import { EMOJI_COLUMNS, EMOJI_GROUPS, emojiGridMove, emojiLayout, emojiName, searchEmoji } from './tale-shapes';
import { shapeView } from './tale-canvas-view';
import { TaleStudioPage } from './tale-studio';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// Tale Studio story 7.6 (epic Tale Studio R6, R12, R13): shapes, emoji and image stickers.
const url = `${API_BASE}/tales/t1/document`;
const mediaUrl = `${API_BASE}/projects/p1/media`;
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
const PNG = 'media/0b7c9d4e-1111-4222-8333-944455556666.png';
const JPG = 'media/0b7c9d4e-1111-4222-8333-944455556668.jpg';
const media = (key: string, contentType: ProjectMedia['contentType']): ProjectMedia => ({
  key,
  kind: contentType.startsWith('video/') ? 'video' : 'image',
  contentType,
  url: `/api/v1/projects/p1/media/file?key=${encodeURIComponent(key)}`,
  source: 'upload',
  createdAt: '2026-10-22T10:00:00.000Z',
  sizeBytes: 100,
});
const empty: TaleDocument = { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] };

describe('the emoji catalog', () => {
  it('holds single RGI emoji, each once, each with its Unicode name', () => {
    const all = EMOJI_GROUPS.flatMap((g) => g.emoji);
    expect(all.length).toBeGreaterThan(90);
    expect(new Set(all.map((e) => e.emoji)).size).toBe(all.length);
    for (const choice of all) {
      expect(isEmojiGlyph(choice.emoji)).toBe(true);
      expect(choice.name.trim()).toBe(choice.name);
      expect(choice.name.length).toBeGreaterThan(1);
    }
  });

  it('holds 129 emoji', () => {
    expect(EMOJI_GROUPS.flatMap((g) => g.emoji)).toHaveLength(129);
  });

  it('moves through the grids by visual column, across groups, clamped to short rows', () => {
    // Groups of 10, 3 and 9: rows [0-7] [8 9] | [10 11 12] | [13-20] [21].
    const layout = emojiLayout([10, 3, 9]);
    expect(layout).toEqual([
      [
        [0, 1, 2, 3, 4, 5, 6, 7],
        [8, 9],
      ],
      [[10, 11, 12]],
      [[13, 14, 15, 16, 17, 18, 19, 20], [21]],
    ]);
    const move = (index: number, key: string, ctrl = false) => emojiGridMove(layout, index, key, ctrl);
    expect(move(5, 'ArrowDown')).toBe(9);
    expect(move(9, 'ArrowDown')).toBe(11);
    expect(move(12, 'ArrowDown')).toBe(15);
    expect(move(20, 'ArrowDown')).toBe(21);
    expect(move(21, 'ArrowDown')).toBe(21);
    expect(move(15, 'ArrowUp')).toBe(12);
    expect(move(10, 'ArrowUp')).toBe(8);
    expect(move(8, 'ArrowUp')).toBe(0);
    expect(move(3, 'ArrowUp')).toBe(3);
    expect(move(7, 'ArrowRight')).toBe(8);
    expect(move(21, 'ArrowRight')).toBe(21);
    expect(move(10, 'ArrowLeft')).toBe(9);
    expect(move(0, 'ArrowLeft')).toBe(0);
    expect(move(11, 'Home')).toBe(10);
    expect(move(11, 'End')).toBe(12);
    expect(move(11, 'Home', true)).toBe(0);
    expect(move(11, 'End', true)).toBe(21);
    expect(move(11, 'a')).toBeNull();
    expect(move(99, 'ArrowDown')).toBeNull();
  });

  it('searches by every word of the name', () => {
    expect(searchEmoji('heart').map((e) => e.emoji)).toContain('❤️');
    expect(searchEmoji('face tears').map((e) => e.name)).toEqual(['face with tears of joy']);
    expect(searchEmoji('nothing like this')).toEqual([]);
    expect(emojiName('🎉')).toBe('party popper');
    expect(emojiName('🦖')).toBeNull();
  });
});

describe('shape views and layer names', () => {
  it('draw a shape from its checked values only', () => {
    expect(
      shapeView({ shape: 'rectangle', fill: '#ff0000', stroke: '#000000', strokeWidth: 0.01, radius: 0.02 }),
    ).toEqual({ fill: '#ff0000', border: '1cqh solid #000000', radius: '2cqh', opacity: 1, line: null });
    expect(shapeView({ shape: 'ellipse', fill: 'url(x)', opacity: 0.5 })).toEqual({
      fill: null,
      border: null,
      radius: '50%',
      opacity: 0.5,
      line: null,
    });
    expect(shapeView({ shape: 'line', stroke: '#ffffff', strokeWidth: 0.006 }).line).toEqual({
      height: '0.6cqh',
      color: '#ffffff',
    });
    expect(shapeView({ shape: 'star' })).toEqual({ fill: null, border: null, radius: null, opacity: 1, line: null });
  });

  it('name shapes by kind and place, emoji with their name, and stickers as media', () => {
    const base = { box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, hidden: false, locked: false, a11y: {} };
    const elements = [
      { ...base, id: 'a', type: 'shape', props: { shape: 'rectangle' } },
      { ...base, id: 'b', type: 'shape', props: { shape: 'ellipse' } },
      { ...base, id: 'c', type: 'shape', props: { shape: 'rectangle' } },
      { ...base, id: 'd', type: 'shape', props: { shape: 'line' }, a11y: { label: 'Divider' } },
      { ...base, id: 'e', type: 'emoji', props: { emoji: '🎉' }, a11y: { label: 'party popper' } },
      { ...base, id: 'f', type: 'emoji', props: { emoji: '😀' } },
      { ...base, id: 'g', type: 'sticker', props: { mediaKey: PNG } },
    ] as TaleElement[];
    expect(elements.map((e) => layerName(e, elements))).toEqual([
      'Rectangle 1',
      'Ellipse 1',
      'Rectangle 2',
      'Divider',
      '🎉 party popper',
      '😀',
      'Sticker 1',
    ]);
  });
});

describe('Tale Studio shapes, emoji and stickers (epic Tale Studio R6)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  async function open(document: TaleDocument | null = null, revision = 0): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush({ document, revision, published: { document: null, revision: 0 } });
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
  const set = async (selector: string, value: string) => {
    const field = q<HTMLInputElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event('change'));
    await settle(fixture);
  };
  const check = async (selector: string, checked: boolean) => {
    const box = q<HTMLInputElement>(selector);
    box.checked = checked;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
  };

  async function saveNow(revision: number): Promise<TaleDocument> {
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    const body = req.request.body as { document: TaleDocument };
    req.flush({ document: body.document, revision });
    expect(await leaving).toBe(true);
    await settle(fixture);
    return body.document;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTOSAVE_TIMING, useValue: WAIT_FOR_TEST },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    // The studio reads the tale's visibility for its status line (story 8.4); not what these test.
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+$/.test(r.url))) {
      read.flush({ visibility: { visible: true, reasons: [] } });
    }
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('adds a rounded rectangle, an ellipse and a line, decorative, drawn as the SDK draws them', async () => {
    await open();
    for (const kind of ['rectangle', 'ellipse', 'line']) {
      q<HTMLButtonElement>(`#studio-add-${kind}`).click();
      await settle(fixture);
    }
    expect(live()).toBe('Line added. It is decorative: screen readers skip it.');
    const els = [...root.querySelectorAll<HTMLButtonElement>('button.el')];
    expect(els.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Rectangle: Rectangle 1',
      'Ellipse: Ellipse 1',
      'Line: Line 1',
    ]);
    const rect = els[0].querySelector('.el__shape') as HTMLElement;
    expect(rect.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(rect.style.borderRadius).toBe('2cqh');
    expect((els[1].querySelector('.el__shape') as HTMLElement).style.borderRadius).toBe('50%');
    const bar = els[2].querySelector('.el__stroke') as HTMLElement;
    expect(bar.style.height).toBe('0.6cqh');
    expect(q<HTMLElement>('#inspector-title').textContent).toContain('Line');
    const saved = await saveNow(1);
    expect(saved.elements.map((e) => [e.type, e.props, e.a11y])).toEqual([
      ['shape', { shape: 'rectangle', fill: '#FFFFFF', radius: 0.02 }, { decorative: true }],
      ['shape', { shape: 'ellipse', fill: '#FFFFFF' }, { decorative: true }],
      ['shape', { shape: 'line', stroke: '#FFFFFF', strokeWidth: 0.006 }, { decorative: true }],
    ]);
    expect(saved.elements[2].box).toEqual({ x: 0.2, y: 0.48, w: 0.6, h: 0.04, rotation: 0 });
  });

  it('styles a shape from its inspector, each change a step that undoes', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-rectangle').click();
    await settle(fixture);
    const id = doc().elements[0].id;
    await set(`#shape-fill-hex-${id}`, 'ff000080');
    expect(live()).toBe('Fill set to #ff000080');
    await set(`#shape-fill-hex-${id}`, 'red');
    expect(root.querySelector('[role=alert].field__error')?.textContent).toContain('#RRGGBB');
    expect(q<HTMLInputElement>(`#shape-fill-hex-${id}`).value).toBe('#ff000080');
    await check(`#shape-no-stroke-${id}`, false);
    expect(live()).toBe('Stroke added');
    await set(`#shape-stroke-width-${id}`, '9');
    expect(q<HTMLInputElement>(`#shape-stroke-width-${id}`).value).toBe('5');
    await set(`#shape-radius-${id}`, '4');
    await set(`#shape-opacity-${id}`, '50');
    const shape = q<HTMLElement>('.el__shape');
    expect(shape.style.borderWidth).toBe('5cqh');
    expect(shape.style.opacity).toBe('0.5');
    expect(doc().elements[0].props).toEqual({
      shape: 'rectangle',
      fill: '#ff000080',
      stroke: '#FFFFFF',
      strokeWidth: 0.05,
      radius: 0.04,
      opacity: 0.5,
    });
    await check(`#shape-no-fill-${id}`, true);
    expect(doc().elements[0].props).not.toHaveProperty('fill');
    expect(q<HTMLInputElement>(`#shape-fill-hex-${id}`).readOnly).toBe(true);
    q<HTMLButtonElement>('#studio-undo').click();
    await settle(fixture);
    expect(doc().elements[0].props).toMatchObject({ fill: '#ff000080' });
    // Named for screen readers, it is no longer decorative.
    await check(`#shape-decorative-${id}`, false);
    await set(`#shape-label-${id}`, 'A red badge');
    expect(doc().elements[0].a11y).toEqual({ label: 'A red badge' });
    expect(root.querySelector('.layer__name')?.textContent).toBe('A red badge');
    await saveNow(1);
  });

  it('refuses a change to a locked shape', async () => {
    const locked: TaleElement = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'shape',
      box: { x: 0.3, y: 0.4, w: 0.4, h: 0.2, rotation: 0 },
      hidden: false,
      locked: true,
      a11y: { decorative: true },
      props: { shape: 'ellipse', fill: '#00ff00' },
    };
    await open({ ...empty, elements: [locked] }, 1);
    q<HTMLButtonElement>('button.el').click();
    await settle(fixture);
    expect(q<HTMLInputElement>(`#shape-fill-hex-${locked.id}`).readOnly).toBe(true);
    await set(`#shape-opacity-${locked.id}`, '10');
    expect(doc().elements[0].props).toEqual({ shape: 'ellipse', fill: '#00ff00' });
    expect(root.querySelector(`#shape-radius-${locked.id}`)).toBeNull();
  });

  it('marks a tiny element, whose inner focus ring is thinner (story 8.17, WCAG 2.4.7)', async () => {
    const shape = (id: string, w: number, h: number): TaleElement => ({
      id,
      type: 'shape',
      box: { x: 0.1, y: 0.1, w, h, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { decorative: true },
      props: { shape: 'rectangle', fill: '#00ff00' },
    });
    await open(
      {
        ...empty,
        elements: [
          shape('00000000-0000-4000-8000-000000000001', 0.5, 0.3),
          shape('00000000-0000-4000-8000-000000000002', 0.05, 0.3),
          shape('00000000-0000-4000-8000-000000000003', 0.5, 0.03),
        ],
      },
      1,
    );
    const tiny = [...root.querySelectorAll('button.el')].map((el) => el.classList.contains('el--tiny'));
    expect(tiny).toEqual([false, true, true]);
  });

  it('lays the picker out as one WAI-ARIA grid per group, and announces search results, clearing too', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-emoji').click();
    await settle(fixture);
    const grids = [...root.querySelectorAll<HTMLElement>('[role=grid]')];
    expect(grids.map((g) => root.querySelector(`#${g.getAttribute('aria-labelledby')}`)?.textContent)).toEqual(
      EMOJI_GROUPS.map((g) => g.name),
    );
    expect(grids.every((g) => g.getAttribute('aria-describedby') === 'emoji-hint')).toBe(true);
    expect(q<HTMLElement>('#emoji-hint').textContent).toContain('arrow keys');
    const firstRow = grids[0].querySelector('[role=row]') as HTMLElement;
    expect(firstRow.querySelectorAll('[role=gridcell]')).toHaveLength(EMOJI_COLUMNS);
    expect(grids[0].querySelectorAll('[role=gridcell] > button.emoji-choice')).toHaveLength(
      EMOJI_GROUPS[0].emoji.length,
    );
    expect(root.querySelectorAll('.emoji-choice[tabindex="0"]')).toHaveLength(1);
    const status = () => root.querySelector('[role=dialog] [role=status]')?.textContent?.trim();
    expect(status()).toBe('');
    const search = q<HTMLInputElement>('#emoji-search');
    search.value = 'heart';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(status()).toBe(`${searchEmoji('heart').length} emoji found`);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(status()).toBe('No emoji found');
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(status()).toBe('Search cleared: all 129 emoji shown');
    // Down from the last row of a group goes to the next group's first row, keeping the column.
    const smileys = EMOJI_GROUPS[0].emoji.length;
    const lastRowStart = Math.floor((smileys - 1) / EMOJI_COLUMNS) * EMOJI_COLUMNS;
    const from = q<HTMLButtonElement>(`#emoji-choice-${lastRowStart + 1}`);
    from.focus();
    from.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await settle(fixture);
    expect(globalThis.document.activeElement?.id).toBe(`emoji-choice-${smileys + 1}`);
    globalThis.document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await settle(fixture);
    expect(globalThis.document.activeElement?.id).toBe(`emoji-choice-${lastRowStart + 1}`);
    q<HTMLButtonElement>('[role=dialog] .drawer__header button').click();
    await settle(fixture);
  });

  it('adds an emoji from the keyboard-operable picker, named by its Unicode name, and edits the name', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-emoji').click();
    await settle(fixture);
    const dialog = q<HTMLElement>('[role=dialog]');
    expect(dialog.querySelector('h2')?.textContent).toBe('Add an emoji');
    expect(globalThis.document.activeElement?.id).toBe('emoji-search');
    const search = q<HTMLInputElement>('#emoji-search');
    search.value = 'party';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.emoji-choice')];
    expect(choices.map((b) => b.getAttribute('aria-label'))).toEqual(['partying face', 'party popper']);
    expect(choices.map((b) => b.tabIndex)).toEqual([0, -1]);
    choices[0].focus();
    choices[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle(fixture);
    expect(globalThis.document.activeElement).toBe(choices[1]);
    expect(choices[1].tabIndex).toBe(0);
    choices[1].click();
    await settle(fixture);
    expect(root.querySelector('[role=dialog]')).toBeNull();
    expect(live()).toContain('Emoji added: party popper');
    const el = q<HTMLButtonElement>('button.el');
    // Named without the glyph, which a screen reader would read as the name a second time (story 7.15).
    expect(el.getAttribute('aria-label')).toBe('Emoji: party popper');
    const row = q<HTMLElement>('.layer__name');
    expect(row.textContent?.replace(/\s+/g, ' ').trim()).toBe('🎉 party popper');
    expect(row.querySelector('[aria-hidden=true]')?.textContent?.trim()).toBe('🎉');
    expect(q<HTMLElement>('[id^=layer-more-]').getAttribute('aria-label')).toBe('More actions for party popper');
    const glyph = el.querySelector('.el__emoji') as HTMLElement;
    expect(glyph.textContent).toBe('🎉');
    expect(glyph.style.fontFamily).toContain('Apple Color Emoji');
    expect(glyph.style.fontSize).toBe('11.25cqh');
    const id = doc().elements[0].id;
    await set(`#emoji-label-${id}`, 'Celebrate the launch');
    expect(live()).toBe('Emoji named Celebrate the launch');
    const saved = await saveNow(1);
    expect(saved.elements[0]).toMatchObject({
      type: 'emoji',
      a11y: { label: 'Celebrate the launch' },
      props: { emoji: '🎉' },
    });
  });

  it('replaces an emoji, which takes the new emoji name', async () => {
    const emoji: TaleElement = {
      id: '00000000-0000-4000-8000-000000000002',
      type: 'emoji',
      box: { x: 0.375, y: 0.43, w: 0.25, h: 0.140625, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { label: 'grinning face' },
      props: { emoji: '😀' },
    };
    await open({ ...empty, elements: [emoji] }, 1);
    q<HTMLButtonElement>('button.el').click();
    await settle(fixture);
    q<HTMLButtonElement>(`#emoji-replace-${emoji.id}`).click();
    await settle(fixture);
    expect(q<HTMLElement>('[role=dialog] h2').textContent).toBe('Choose another emoji');
    expect(q<HTMLButtonElement>('.emoji-choice[aria-current=true]').getAttribute('aria-label')).toBe('grinning face');
    const rocket = [...root.querySelectorAll<HTMLButtonElement>('.emoji-choice')].find(
      (b) => b.getAttribute('aria-label') === 'rocket',
    ) as HTMLButtonElement;
    rocket.click();
    await settle(fixture);
    expect(doc().elements[0]).toMatchObject({ a11y: { label: 'rocket' }, props: { emoji: '🚀' } });
    expect(live()).toBe('Emoji replaced by rocket');
    await saveNow(2);
  });

  it('adds an image sticker from the PNG, WebP and GIF media, which needs alt text and shows whole', async () => {
    await open();
    q<HTMLButtonElement>('#studio-add-sticker').click();
    await settle(fixture);
    http.expectOne(mediaUrl).flush([media(JPG, 'image/jpeg'), media(PNG, 'image/png')]);
    await settle(fixture);
    expect(q<HTMLElement>('[role=dialog] h2').textContent).toBe('Add an image sticker');
    expect(q<HTMLInputElement>('#media-upload').accept).toBe('image/png,image/webp,image/gif');
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.media-choice')];
    expect(choices).toHaveLength(1);
    choices[0].click();
    await settle(fixture);
    const el = q<HTMLButtonElement>('button.el');
    expect(el.getAttribute('aria-label')).toBe('Sticker: Sticker 1');
    expect((el.querySelector('img') as HTMLImageElement).style.objectFit).toBe('contain');
    expect(root.querySelector('.layer__state')?.textContent).toContain('Needs alt text');
    const id = doc().elements[0].id;
    expect(root.querySelector(`#media-fit-${id}`)).toBeNull();
    expect(root.querySelector(`#media-radius-${id}`)).toBeNull();
    await set(`#media-opacity-${id}`, '80');
    const alt = q<HTMLTextAreaElement>(`#media-alt-${id}`);
    alt.value = 'A party hat';
    alt.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(root.querySelector('.layer__state')?.textContent).not.toContain('Needs alt text');
    const saved = await saveNow(1);
    expect(saved.elements[0]).toEqual({
      id,
      type: 'sticker',
      box: { x: 0.3, y: 0.3875, w: 0.4, h: 0.225, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { label: 'A party hat' },
      props: { mediaKey: PNG, opacity: 0.8 },
    });
  });

  it('checks the contrast of a text against an opaque rectangle below it', async () => {
    const rect: TaleElement = {
      id: '00000000-0000-4000-8000-000000000003',
      type: 'shape',
      box: { x: 0, y: 0.3, w: 1, h: 0.4, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { decorative: true },
      props: { shape: 'rectangle', fill: '#ffffff' },
    };
    const text: TaleElement = {
      id: '00000000-0000-4000-8000-000000000004',
      type: 'text',
      box: { x: 0.1, y: 0.4, w: 0.8, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: 'Sale', color: '#FFFFFF' },
    };
    await open({ ...empty, elements: [rect, text] }, 1);
    const textRow = () => root.querySelectorAll('.layer__state')[0]?.textContent ?? '';
    expect(textRow()).toContain('Low contrast');
    // Hiding the rectangle leaves the white text on black: the turn of its verdict is said once.
    q<HTMLButtonElement>(`#layer-hide-${rect.id}`).click();
    await settle(fixture);
    expect(textRow()).not.toContain('Low contrast');
    expect(live()).toMatch(/"Sale" has enough contrast now\.$/);
    // The change and the verdict are two sentences (story 7.15).
    expect(live()).toBe('Layer hidden. "Sale" has enough contrast now.');
    expect(live()?.match(/contrast/g)).toHaveLength(1);
    q<HTMLButtonElement>(`#layer-hide-${rect.id}`).click();
    await settle(fixture);
    expect(live()).toMatch(/"Sale" now has low contrast\.$/);
    // Moving the rectangle off the text turns it too; a change that leaves it as it was says nothing of it.
    q<HTMLButtonElement>(`#studio-el-${rect.id}`).click();
    await settle(fixture);
    await set('#studio-y', '0');
    expect(live()).toContain('"Sale" has enough contrast now.');
    await set('#studio-x', '0');
    expect(live()).not.toContain('contrast');
    await saveNow(2);
  });
});
