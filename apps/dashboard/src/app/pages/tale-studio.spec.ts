import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import type { ProjectFont, ZoneTaleGroup } from '@taleart/contract/core';
import { clearProjectFontLoads } from '@taleart/contract/project-fonts';
import { elementBounds, type TaleDocument as AnyTaleDocument, type TextElement } from '@taleart/contract/tale-document';
import { DEFAULT_TEXT_STYLE, SYSTEM_FONT_STACKS } from '@taleart/contract/text-style';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { appRoutes } from '../app.routes';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { BACK_TO_PAGE_INTERVAL_MS, TaleStudioPage } from './tale-studio';
import { ratioText } from './tale-text-style';
import { settle, WAIT_FOR_TEST } from './tale-studio.testing';

// The documents here hold text only, typed so, which keeps a text's props a text's.
type TaleDocument = Omit<AnyTaleDocument, 'elements'> & { elements: TextElement[] };

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
// The tale's own media (R16): a full-canvas, decorative image marked `taleMedia`.
const OWN_MEDIA = {
  id: '00000000-0000-4000-8000-0000000000ff',
  type: 'image',
  box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: { decorative: true },
  props: { mediaKey: 'tales/0a.png', fit: 'contain', taleMedia: true },
} as unknown as TaleDocument['elements'][number];

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

// A read of the tale's document: the draft, and the published document, the same unless given.
function draftRead(read: {
  document: TaleDocument | null;
  revision: number;
  published?: { document: TaleDocument | null; revision: number };
}) {
  return { ...read, published: read.published ?? { document: read.document, revision: read.revision } };
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`No ${name} button`);
  return button;
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

const timing = { ...WAIT_FOR_TEST };

describe('TaleStudioPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleStudioPage>;
  let root: HTMLElement;

  async function open(
    read: Parameters<typeof draftRead>[0],
    themeFont: string | null = null,
    fonts: ProjectFont[] = [],
  ): Promise<void> {
    fixture = TestBed.createComponent(TaleStudioPage);
    fixture.componentRef.setInput('taleId', 't1');
    fixture.detectChanges();
    http.expectOne(url).flush(draftRead(read));
    // The project theme's font, for texts in the theme font (story 7.4).
    http
      .expectOne(`${API_BASE}/projects/p1/theme`)
      .flush({ projectId: 'p1', theme: {}, resolved: { ...DEFAULT_THEME, fontFamily: themeFont } });
    // The project's fonts, which the inspector offers (story 7.17).
    http.expectOne(`${API_BASE}/projects/p1/fonts`).flush(fonts);
    await settle(fixture);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
  }

  /** An item of the tale menu (Discard changes, Duplicate, Keyboard shortcuts), the menu opened first. */
  function menuItem(id: string): HTMLButtonElement {
    const button = root.querySelector('#studio-menu') as HTMLButtonElement;
    if (button.getAttribute('aria-expanded') !== 'true') {
      button.click();
      fixture.detectChanges();
    }
    return root.querySelector(`#${id}`) as HTMLButtonElement;
  }

  const elements = () => [...root.querySelectorAll<HTMLButtonElement>('button.el')];
  const status = () => root.querySelector('#studio-save')?.textContent?.trim();

  // Saves what is unsaved now, as leaving the studio does, and answers the save with `revision`.
  async function saveNow(
    revision: number,
  ): Promise<{ document: TaleDocument; revision: number; sawTaleMedia?: boolean }> {
    const leaving = fixture.componentInstance.canLeave();
    await settle(fixture);
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    const body = req.request.body as { document: TaleDocument; revision: number; sawTaleMedia?: boolean };
    req.flush({ document: body.document, revision });
    expect(await leaving).toBe(true);
    await settle(fixture);
    return body;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleStudioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // Autosave waits for the test to ask, unless a test sets its own timing.
        { provide: AUTOSAVE_TIMING, useValue: timing },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.taleGroups.set({ z1: [group] });
    store.loaded.set(true);
    // Leaving with changes that could not be saved asks; tests answer "stay" unless they say otherwise.
    vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    // The studio reads the tale's visibility for its status line (story 8.4); not what these test.
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+$/.test(r.url))) {
      read.flush({ visibility: { visible: true, reasons: [] } });
    }
    // A tale the store's zone lists do not hold has its group read (story 8.19); not what these test.
    for (const read of http.match((r) => r.method === 'GET' && /\/tale-groups\/[^/]+$/.test(r.url))) {
      read.flush(null, { status: 404, statusText: 'Not Found' });
    }
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows a tale without a document on an empty 9:16 canvas: its media lives in its document (R16)', async () => {
    await open({ document: null, revision: 0 });
    const canvas = root.querySelector('.canvas') as HTMLElement;
    expect(canvas.getAttribute('aria-label')).toBe('Canvas, 9:16');
    expect(canvas.querySelector('img, video')).toBeNull();
    expect(elements()).toHaveLength(0);
    expect(root.querySelector('a.back-link')?.getAttribute('href')).toBe('/zones/z1?group=g1');
  });

  describe('back link and keyboard help (story 8.15)', () => {
    it("names the tale's group in the back link", async () => {
      await open({ document: null, revision: 0 });
      const back = root.querySelector('a.back-link');
      expect(back?.textContent?.trim()).toBe('Back to Summer');
      expect(back?.getAttribute('href')).toBe('/zones/z1?group=g1');
    });

    it('says only "Back", to the zones list, while the group is not known', async () => {
      TestBed.inject(DashboardStore).taleGroups.set({});
      fixture = TestBed.createComponent(TaleStudioPage);
      fixture.componentRef.setInput('taleId', 't1');
      fixture.detectChanges();
      http.expectOne(url).flush(draftRead({ document: null, revision: 0 }));
      await settle(fixture);
      root = fixture.nativeElement as HTMLElement;
      const back = root.querySelector('a.back-link');
      expect(back?.textContent?.trim()).toBe('Back');
      expect(back?.getAttribute('href')).toBe('/zones');
    });

    const helpPanel = () => root.querySelector<HTMLElement>('#studio-help-panel') as HTMLElement;
    const helpItem = () => menuItem('studio-help-button');

    it('keeps the keyboard help closed in a panel that still describes the canvas, offered in the tale menu', async () => {
      await open({ document: null, revision: 0 });
      expect(helpPanel().hidden).toBe(true);
      expect(helpItem().getAttribute('role')).toBe('menuitem');
      expect(helpItem().textContent).toContain('Keyboard shortcuts');
      expect(helpItem().getAttribute('aria-keyshortcuts')).toBe('?');
      // The shortcut list is the one the studio had, still naming the canvas's keys, and F6.
      const keys = root.querySelector('#studio-keys') as HTMLElement;
      expect(keys.textContent).toContain('Select a layer to move it with the arrow keys');
      expect(keys.textContent).toContain('Changes save automatically.');
      expect(keys.textContent).toContain('F6 and Shift+F6 move between');
      expect(root.querySelector('#studio-canvas')?.getAttribute('aria-describedby')).toBe('studio-keys');
    });

    it('opens from the tale menu with focus in it, and Escape closes it and returns focus to the menu button', async () => {
      await open({ document: null, revision: 0 });
      helpItem().click();
      await settle(fixture);
      expect(root.querySelector('#studio-menu-list')).toBeNull();
      expect(helpPanel().hidden).toBe(false);
      expect(document.activeElement).toBe(helpPanel());
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      helpPanel().dispatchEvent(escape);
      fixture.detectChanges();
      expect(escape.defaultPrevented).toBe(true);
      expect(helpPanel().hidden).toBe(true);
      expect(document.activeElement).toBe(root.querySelector('#studio-menu'));
      // On a closed panel Escape does nothing.
      const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      helpPanel().dispatchEvent(again);
      expect(again.defaultPrevented).toBe(false);
    });

    it('opens with "?" outside a text field, and closes back to where focus was', async () => {
      await open({ document: existing, revision: 1 });
      const cell = root.querySelector<HTMLElement>(`#layer-${existing.elements[0].id}`) as HTMLElement;
      cell.focus();
      key(cell, '?');
      await settle(fixture);
      expect(helpPanel().hidden).toBe(false);
      (root.querySelector('.studio-help__close') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(true);
      expect(document.activeElement).toBe(cell);
      // Typing "?" in a field types it.
      const hex = root.querySelector('#studio-bg-hex') as HTMLInputElement;
      key(hex, '?');
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(true);
    });

    it('goes back to the zone it was opened from, when that zone lists the tale', async () => {
      const store = TestBed.inject(DashboardStore);
      store.taleGroups.set({ z1: [group], z2: [group] });
      fixture = TestBed.createComponent(TaleStudioPage);
      fixture.componentRef.setInput('taleId', 't1');
      fixture.componentRef.setInput('zone', 'z2');
      fixture.detectChanges();
      http.expectOne(url).flush(draftRead({ document: null, revision: 0 }));
      http.expectOne(`${API_BASE}/projects/p1/theme`).flush({ projectId: 'p1', theme: {}, resolved: DEFAULT_THEME });
      http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
      await settle(fixture);
      root = fixture.nativeElement as HTMLElement;
      const back = () => root.querySelector('a.back-link');
      expect(back()?.textContent?.trim()).toBe('Back to Summer');
      expect(back()?.getAttribute('href')).toBe('/zones/z2?group=g1');

      // A zone that does not list the tale falls back to the first one that does.
      fixture.componentRef.setInput('zone', 'z9');
      fixture.detectChanges();
      expect(back()?.getAttribute('href')).toBe('/zones/z1?group=g1');
    });

    it('reads the group of a tale in no zone and goes back to it on the Tale groups page (story 8.19)', async () => {
      const store = TestBed.inject(DashboardStore);
      store.taleGroups.set({});
      fixture = TestBed.createComponent(TaleStudioPage);
      fixture.componentRef.setInput('taleId', 't1');
      fixture.detectChanges();
      http.expectOne(url).flush(draftRead({ document: null, revision: 0 }));
      await settle(fixture);
      root = fixture.nativeElement as HTMLElement;
      // No zone lists it: the studio does not know the tale yet.
      expect(menuItem('studio-duplicate').getAttribute('aria-disabled')).toBe('true');
      const read = http.expectOne((r) => r.method === 'GET' && r.url === `${API_BASE}/tales/t1`);
      read.flush({ ...tale, visibility: { visible: false, reasons: [{ code: 'not-in-any-zone', subject: 'group' }] } });
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g1`)
        .flush({ ...group, zoneIds: [], tags: [], visibility: { visible: false, reasons: [] } });
      await settle(fixture);
      // Once the tale is known, its project's theme and fonts are read.
      http.expectOne(`${API_BASE}/projects/p1/theme`).flush({ projectId: 'p1', theme: {}, resolved: DEFAULT_THEME });
      http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
      await settle(fixture);
      expect(store.tale('t1')?.title).toBe('Beach');
      expect(root.querySelector('#studio-tale-name')?.textContent?.trim()).toBe('Beach');
      expect(menuItem('studio-duplicate').getAttribute('aria-disabled')).toBeNull();
      const back = root.querySelector('a.back-link');
      expect(back?.textContent?.trim()).toBe('Back to Summer');
      expect(back?.getAttribute('href')).toBe('/tale-groups?group=g1');
    });

    it('reads the group of a tale in no zone only once the store is loaded, and releases it on close and on another tale (story 8.19)', async () => {
      const store = TestBed.inject(DashboardStore);
      store.taleGroups.set({});
      store.loaded.set(false);
      fixture = TestBed.createComponent(TaleStudioPage);
      fixture.componentRef.setInput('taleId', 't1');
      fixture.detectChanges();
      http.expectOne(url).flush(draftRead({ document: null, revision: 0 }));
      await settle(fixture);
      http
        .expectOne((r) => r.method === 'GET' && r.url === `${API_BASE}/tales/t1`)
        .flush({ ...tale, visibility: { visible: false, reasons: [] } });
      await settle(fixture);
      // Not loaded yet: the zone lists may still list it, so its group is not read.
      http.expectNone(`${API_BASE}/tale-groups/g1`);
      store.loaded.set(true);
      await settle(fixture);
      const groupRead = { ...group, zoneIds: [], tags: [], visibility: { visible: false, reasons: [] } };
      http.expectOne(`${API_BASE}/tale-groups/g1`).flush(groupRead);
      await settle(fixture);
      for (const req of http.match((r) => /\/projects\/p1\/(theme|fonts)$/.test(r.url))) {
        req.flush(r(req.request.url));
      }
      expect(Object.keys(store.readGroups())).toEqual(['g1']);

      // Another tale: the first one's group is released.
      fixture.componentRef.setInput('taleId', 't2');
      await settle(fixture);
      expect(store.readGroups()).toEqual({});
      for (const req of http.match((r) => r.url.includes('/tales/t2'))) req.flush(null, { status: 404, statusText: 'Not Found' });
      await settle(fixture);

      // Back to the first tale, then the studio closes: released again.
      fixture.componentRef.setInput('taleId', 't1');
      await settle(fixture);
      for (const req of http.match((r) => r.url === url)) req.flush(draftRead({ document: null, revision: 0 }));
      await settle(fixture);
      for (const req of http.match((r) => r.method === 'GET' && r.url === `${API_BASE}/tales/t1`)) {
        req.flush({ ...tale, visibility: { visible: false, reasons: [] } });
      }
      await settle(fixture);
      for (const req of http.match(`${API_BASE}/tale-groups/g1`)) req.flush(groupRead);
      await settle(fixture);
      expect(Object.keys(store.readGroups())).toEqual(['g1']);
      fixture.destroy();
      expect(store.readGroups()).toEqual({});
      for (const req of http.match((r) => /\/projects\/p1\/(theme|fonts)$/.test(r.url))) req.flush(r(req.request.url));

      function r(requested: string): object {
        return requested.endsWith('/theme') ? { projectId: 'p1', theme: {}, resolved: DEFAULT_THEME } : [];
      }
    });

    it('goes back to the Tale groups page when opened from there, even for a group in a zone (story 8.19)', async () => {
      fixture = TestBed.createComponent(TaleStudioPage);
      fixture.componentRef.setInput('taleId', 't1');
      fixture.componentRef.setInput('from', 'tale-groups');
      fixture.detectChanges();
      http.expectOne(url).flush(draftRead({ document: null, revision: 0 }));
      http.expectOne(`${API_BASE}/projects/p1/theme`).flush({ projectId: 'p1', theme: {}, resolved: DEFAULT_THEME });
      http.expectOne(`${API_BASE}/projects/p1/fonts`).flush([]);
      await settle(fixture);
      root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('a.back-link')?.getAttribute('href')).toBe('/tale-groups?group=g1');
    });

    it('returns focus to the tale menu button when what had focus is gone', async () => {
      await open({ document: existing, revision: 1 });
      const el = root.querySelector<HTMLElement>(`#studio-el-${existing.elements[0].id}`) as HTMLElement;
      el.focus();
      key(el, '?');
      await settle(fixture);
      expect(helpPanel().hidden).toBe(false);
      // What had focus is gone meanwhile (a layer deleted or hidden from elsewhere), in its place a node no longer in the page.
      const gone = document.createElement('button');
      (fixture.componentInstance as unknown as { helpReturn: HTMLElement }).helpReturn = gone;
      expect(gone.isConnected).toBe(false);
      helpPanel().focus();
      helpPanel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(true);
      expect(document.activeElement).toBe(root.querySelector('#studio-menu'));
    });

    it('closes when focus leaves it, and stays open while focus moves inside it', async () => {
      await open({ document: null, revision: 0 });
      helpItem().click();
      await settle(fixture);
      (root.querySelector('.studio-help__close') as HTMLButtonElement).focus();
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(false);
      root.querySelector<HTMLButtonElement>('#studio-undo')?.focus();
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(true);
    });

    it('closes when a layer menu opens', async () => {
      await open({ document: existing, revision: 1 });
      helpItem().click();
      await settle(fixture);
      expect(helpPanel().hidden).toBe(false);
      root.querySelector<HTMLButtonElement>(`#layer-more-${existing.elements[0].id}`)?.click();
      await settle(fixture);
      expect(root.querySelector('[role=menu]')).not.toBeNull();
      expect(helpPanel().hidden).toBe(true);
    });

    it('closes when a press lands outside it', async () => {
      await open({ document: null, revision: 0 });
      helpItem().click();
      await settle(fixture);
      helpPanel().dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(false);
      root.querySelector('.studio-top__title')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(helpPanel().hidden).toBe(true);
    });
  });

  it("shows the tale's media as its bottom layer, and lets a video be added beside a media video (R16)", async () => {
    const video = { ...OWN_MEDIA, type: 'video', props: { ...OWN_MEDIA.props, mediaKey: 'tales/0b.mp4' } };
    await open({
      document: { ...existing, elements: [video as unknown as TaleDocument['elements'][number]] },
      revision: 1,
    });
    expect(elements()).toHaveLength(1);
    expect(root.querySelector('.canvas video')?.getAttribute('src')).toContain('tales%2F0b.mp4');
    expect(root.querySelector('#studio-add-video')?.hasAttribute('aria-disabled')).toBe(false);
    // Full-bleed by design: no safe-area warning on its row.
    expect(root.querySelector(`#layer-state-${OWN_MEDIA.id}`)?.textContent ?? '').not.toContain('Outside safe area');
  });

  it("says when moving the tale's media makes it a layer like any other, and the inspector tells how it plays", async () => {
    const video = { ...OWN_MEDIA, type: 'video', props: { ...OWN_MEDIA.props, mediaKey: 'tales/0b.mp4' } };
    await open({
      document: { ...existing, elements: [video as unknown as TaleDocument['elements'][number]] },
      revision: 1,
    });
    const el = root.querySelector(`#studio-el-${OWN_MEDIA.id}`) as HTMLElement;
    el.click();
    await settle(fixture);
    expect(root.querySelector('#studio-tale-media-hint')?.textContent).toContain('with sound and for its whole length');
    const rotation = root.querySelector('#studio-rotation') as HTMLInputElement;
    rotation.value = '10';
    rotation.dispatchEvent(new Event('change'));
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector('[aria-live=polite]')?.textContent).toContain(
      "The tale's video is now a layer like any other: muted, and at most 15 seconds.",
    );
    expect(root.querySelector('#studio-tale-media-hint')?.textContent).toContain('now a layer like any other');
  });

  it("draws a media background over the tale's own media, as the Web SDK does, and says it saw the media", async () => {
    const background = { type: 'media', mediaKey: 'media/0c.png', fit: 'contain', color: '#334455' };
    const doc = { ...existing, canvas: { background }, elements: [OWN_MEDIA, existing.elements[0]] } as TaleDocument;
    await open({ document: doc, revision: 1 });
    const backdrop = root.querySelector('.canvas > img.canvas__media') as HTMLElement;
    expect(backdrop.style.zIndex).toBe('2');
    expect(backdrop.style.backgroundColor).toBe('rgb(51, 68, 85)');
    expect((root.querySelector(`#studio-el-${OWN_MEDIA.id}`) as HTMLElement).style.zIndex).toBe('1');
    // The person removes the media: the save says this editor saw it, so it stays removed (R16).
    (root.querySelector(`#studio-el-${OWN_MEDIA.id}`) as HTMLElement).click();
    await settle(fixture);
    key(root.querySelector(`#studio-el-${OWN_MEDIA.id}`) as HTMLElement, 'Delete');
    await settle(fixture);
    const body = await saveNow(2);
    expect(body.document.elements.map((e) => e.id)).toEqual([existing.elements[0].id]);
    expect(body.sawTaleMedia).toBe(true);
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
    buttonNamed(root, 'Add body text').click();
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
    // From 40% down (the centre of the safe area): ArrowUp twice with Shift (10% each), then once (1%).
    key(el, 'ArrowUp', { shiftKey: true });
    key(el, 'ArrowUp', { shiftKey: true });
    key(el, 'ArrowUp');
    await settle(fixture);
    expect(elements()[0].style.top).toBe('19%');
    expect((root.querySelector('#studio-y') as HTMLInputElement).value).toBe('19');
    expect(root.querySelector('[aria-live=polite]')?.textContent).toContain('Text moved');

    const body = await saveNow(1);
    expect(body.revision).toBe(0);
    expect(body.document.elements).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        type: 'text',
        box: { x: 0.1, y: 0.19, w: 0.8, h: 0.16, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        // Every style setting is stored explicitly, the direction included (story 7.4).
        props: { ...DEFAULT_TEXT_STYLE, text: 'Hello' },
      },
    ]);
    expect(body.document.elements[0].props).toMatchObject({ direction: 'auto', font: { source: 'system' } });
    expect(status()).toBe('All changes saved');

    // The next save is based on the new revision.
    key(elements()[0], 'ArrowDown');
    await settle(fixture);
    expect(status()).toBe('Unsaved changes');
    expect((await saveNow(2)).revision).toBe(1);
  });

  const live = () => root.querySelector('[aria-live=polite]')?.textContent;

  it('moves by the position fields, writing back the applied value and announcing a clamp', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const x = root.querySelector('#studio-x') as HTMLInputElement;
    x.value = '95';
    x.dispatchEvent(new Event('change'));
    // The field shows the value applied at once, even though the box did not move far enough to re-render it.
    expect(x.value).toBe('20');
    await settle(fixture);
    // The box is 80% wide, so it can start at most at 20%.
    expect(elements()[0].style.left).toBe('20%');
    expect(live()).toBe('Text moved to left 20%, as far as it goes');
    // A second clamp to the same place still writes the field back.
    x.value = '90';
    x.dispatchEvent(new Event('change'));
    expect(x.value).toBe('20');
    const y = root.querySelector('#studio-y') as HTMLInputElement;
    y.value = '30';
    y.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(y.value).toBe('30');
    expect(live()).toBe('Text moved to top 30%');
    y.value = '';
    y.dispatchEvent(new Event('change'));
    expect(y.value).toBe('30');
    await settle(fixture);
    expect(live()).toBe('Enter a number for top; it stays at 30%');
  });

  it('deletes with the Delete key only, then focuses the next element, the previous one, or the canvas', async () => {
    const second = { ...existing.elements[0], id: '00000000-0000-4000-8000-000000000002', props: { text: 'Two' } };
    await open({ document: { ...existing, elements: [...existing.elements, second] }, revision: 1 });
    key(elements()[0], 'Backspace');
    await settle(fixture);
    expect(elements()).toHaveLength(2);
    key(elements()[0], 'Delete');
    await settle(fixture);
    expect(elements()).toHaveLength(1);
    expect(document.activeElement).toBe(elements()[0]);
    expect(elements()[0].textContent).toBe('Two');
    key(elements()[0], 'Delete');
    await settle(fixture);
    expect(elements()).toHaveLength(0);
    expect(document.activeElement).toBe(root.querySelector('.canvas'));
    expect(live()).toBe('Text deleted — press Ctrl+Z to undo');
  });

  it('shows text without added whitespace, and keeps the rotation while typing in place', async () => {
    const rotated = { ...existing.elements[0], box: { ...existing.elements[0].box, rotation: 15 } };
    await open({ document: { ...existing, elements: [rotated] }, revision: 1 });
    expect(elements()[0].textContent).toBe('Hi <b>there</b>');
    expect(elements()[0].style.transform).toBe('rotate(15deg)');
    key(elements()[0], 'Enter');
    await settle(fixture);
    const field = root.querySelector('textarea.el-edit') as HTMLTextAreaElement;
    expect(field.style.transform).toBe('rotate(15deg)');
  });

  it('counts the text limit in characters, emoji included, and stops input past it', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const field = root.querySelector('#studio-text') as HTMLTextAreaElement;
    expect(field.hasAttribute('maxlength')).toBe(false);
    // 1,000 emoji are 2,000 UTF-16 units but 1,000 characters: all kept.
    field.value = '😀'.repeat(1000);
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(elements()[0].textContent).toBe('😀'.repeat(1000));
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe('Up to 1,000 characters.');
    field.value = '😀'.repeat(1000) + 'ab';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(field.value).toBe('😀'.repeat(1000));
    expect(elements()[0].textContent).toBe('😀'.repeat(1000));
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe('A text holds at most 1,000 characters.');
  });

  it('removes control characters and bidi overrides from typed or pasted text, keeping line feeds and RTL text', async () => {
    await open({ document: existing, revision: 1 });
    elements()[0].click();
    await settle(fixture);
    const field = root.querySelector('#studio-text') as HTMLTextAreaElement;
    field.value = 'שלום\u0007\nworld\u202e 👩‍👩‍👧‍👦\u2067x\u2069';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(field.value).toBe('שלום\nworld 👩‍👩‍👧‍👦\u2067x\u2069');
    expect(elements()[0].textContent).toBe('שלום\nworld 👩‍👩‍👧‍👦\u2067x\u2069');
    expect(root.querySelector('#studio-text-hint')?.textContent?.trim()).toBe(
      'Characters that text cannot hold were removed.',
    );
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
    key(elements()[0], 'ArrowDown');
    void fixture.componentInstance.canLeave();
    await settle(fixture);
    http
      .expectOne(url)
      .flush({ error: { code: 'stale_revision', message: 'stale' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Someone saved this tale after you opened it');
    buttonNamed(root, 'Reload latest version').click();
    await settle(fixture);
    const changed = { ...existing, elements: [{ ...existing.elements[0], props: { text: 'Theirs' } }] };
    http.expectOne(url).flush(draftRead({ document: changed, revision: 2 }));
    await settle(fixture);
    expect(elements()[0].textContent?.trim()).toBe('Theirs');
    expect([...root.querySelectorAll('[role=alert]')].map((a) => a.textContent?.trim()).join('')).toBe('');
  });

  it('says plainly when a save is refused for media that no longer exists, such as a deleted tale media (story 8.20)', async () => {
    await open({ document: existing, revision: 1 });
    key(elements()[0], 'ArrowDown');
    void fixture.componentInstance.canLeave();
    await settle(fixture);
    http.expectOne(url).flush(
      {
        error: {
          code: 'invalid_tale_document',
          message: "/canvas/background/mediaKey is not media of this tale's project",
          pointer: '/canvas/background/mediaKey',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    const alert = root.querySelector('[role=alert]')?.textContent ?? '';
    expect(alert).toContain('this background uses a media file that no longer exists');
    expect(alert).toContain('Pick other media for it, or remove it.');
    expect(alert).not.toContain('/canvas');
  });

  it('explains a refused save in plain words and marks the element its pointer names', async () => {
    await open({ document: existing, revision: 1 });
    key(elements()[0], 'ArrowDown');
    void fixture.componentInstance.canLeave();
    await settle(fixture);
    http.expectOne(url).flush(
      {
        error: {
          code: 'invalid_tale_document',
          message: '/elements/0/props/text holds at most 1000 characters',
          pointer: '/elements/0/props/text',
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    const alert = root.querySelector('[role=alert]')?.textContent ?? '';
    expect(alert).toContain('A text could not be saved');
    expect(alert).not.toContain('/elements');
    expect(elements()[0].getAttribute('aria-invalid')).toBe('true');
    expect(elements()[0].getAttribute('aria-pressed')).toBe('true');
    expect(status()).toBe('Not saved');

    buttonNamed(root, 'Retry now').click();
    await settle(fixture);
    http
      .expectOne(url)
      .flush({ error: { code: 'tale_document_too_large', message: 'x' } }, { status: 413, statusText: 'Too Large' });
    await settle(fixture);
    // The visible block changes with each failure; the alert region keeps the first, announced once.
    expect(root.querySelector('#studio-save-problem')?.textContent).toContain('This tale is too large to save');
  });
  describe('layers, background and safe areas (story 2)', () => {
    const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const at = (n: number, text: string, y: number, extra: Partial<TaleDocument['elements'][number]> = {}) => ({
      ...existing.elements[0],
      id: ID(n),
      box: { x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 },
      props: { text },
      ...extra,
    });
    // A at the bottom of the z-order, then B, then C on top; A and B overlap.
    const three: TaleDocument = { ...existing, elements: [at(1, 'A', 0.4), at(2, 'B', 0.42), at(3, 'C', 0.2)] };

    const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.layer__select')];
    const rowNames = () => rows().map((r) => r.querySelector('.layer__name')?.textContent);
    const canvasTexts = () => elements().map((e) => e.textContent);
    const row = (n: number) => root.querySelector(`#layer-${ID(n)}`) as HTMLButtonElement;
    const canvasEl = (n: number) => root.querySelector(`#studio-el-${ID(n)}`) as HTMLButtonElement | null;
    const selected = () => rows().map((r) => r.parentElement?.getAttribute('aria-selected'));
    const state = (n: number) => root.querySelector(`#layer-state-${ID(n)}`)?.textContent?.trim();

    async function saved(): Promise<TaleDocument> {
      return (await saveNow(2)).document;
    }

    it('lists every layer top first, with its type and a name from its text', async () => {
      await open({ document: three, revision: 1 });
      expect(rowNames()).toEqual(['C', 'B', 'A']);
      // Its type, its name, and its place in the reading order (story 7.10).
      expect(rows()[0].textContent?.replace(/\s+/g, ' ').trim()).toBe('Text: C, read #1');
      expect(rows()[0].querySelector('svg')).not.toBeNull();
      const grid = root.querySelector('[role=grid]') as HTMLElement;
      expect(grid.getAttribute('aria-labelledby')).toBe('layers-title');
      expect(grid.getAttribute('aria-multiselectable')).toBe('true');
      expect(grid.querySelectorAll('[role=row]')).toHaveLength(3);
      expect(rows()[0].getAttribute('role')).toBe('gridcell');
      expect(rows()[0].getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowUp');
      // The state reads with the name, inside the same cell.
      expect(rows()[0].querySelector(`#layer-state-${ID(3)}`)).not.toBeNull();
    });

    it('reorders from the list with the keyboard only, and the canvas and the saved document follow', async () => {
      await open({ document: three, revision: 1 });
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'A', 'B']);
      expect(canvasTexts()).toEqual(['B', 'A', 'C']);
      expect(canvasEl(1)?.style.zIndex).toBe('2');
      expect(canvasEl(2)?.style.zIndex).toBe('1');
      expect(document.activeElement).toBe(row(1));
      expect(live()).toBe('Layer brought forward');
      key(row(1), 'ArrowUp', { altKey: true, shiftKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['A', 'C', 'B']);
      expect(live()).toBe('Layer moved to the front');
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect(live()).toBe('Already at the front');
      key(row(1), 'ArrowDown', { altKey: true, shiftKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'B', 'A']);
      key(row(1), 'ArrowUp', { altKey: true });
      await settle(fixture);
      expect((await saved()).elements.map((e) => e.props.text)).toEqual(['B', 'A', 'C']);
    });

    it('is one tab stop, a grid: the arrows move between layers and their controls', async () => {
      await open({ document: three, revision: 1 });
      const stops = () => [...root.querySelectorAll('[role=grid] [tabindex="0"]')];
      expect(stops()).toEqual([row(3)]);
      expect(root.querySelectorAll('[role=grid] [tabindex="-1"]')).toHaveLength(11);
      row(3).focus();
      key(row(3), 'ArrowDown');
      expect(document.activeElement).toBe(row(2));
      key(row(2), 'ArrowRight');
      const hide2 = root.querySelector(`#layer-hide-${ID(2)}`) as HTMLButtonElement;
      expect(document.activeElement).toBe(hide2);
      key(hide2, 'ArrowDown');
      expect(document.activeElement?.id).toBe(`layer-hide-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'End');
      expect(document.activeElement?.id).toBe(`layer-more-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'ArrowRight');
      expect(document.activeElement?.id).toBe(`layer-more-${ID(1)}`);
      key(document.activeElement as HTMLElement, 'Home');
      expect(document.activeElement).toBe(row(1));
      key(row(1), 'Home', { ctrlKey: true });
      expect(document.activeElement).toBe(row(3));
      key(row(3), 'ArrowUp');
      expect(document.activeElement).toBe(row(3));
      key(row(3), 'End', { ctrlKey: true });
      expect(document.activeElement).toBe(row(1));
      await settle(fixture);
      // The tab stop follows focus.
      expect(stops()).toEqual([row(1)]);
      // Enter or Space on a name selects that layer alone.
      key(row(1), 'Enter');
      await settle(fixture);
      expect(selected()).toEqual(['false', 'false', 'true']);
    });

    it('selects several layers with Shift+click and Shift+Space, then moves, reorders and deletes them together', async () => {
      await open({ document: three, revision: 1 });
      row(1).click();
      row(3).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, detail: 1 }));
      await settle(fixture);
      expect(selected()).toEqual(['true', 'false', 'true']);
      expect(canvasEl(1)?.getAttribute('aria-pressed')).toBe('true');
      expect(root.querySelector('#inspector-title')?.textContent?.trim()).toBe('2 layers selected');
      // Shift+Space takes B in and out of the selection; the click a button fires for it changes nothing.
      key(row(2), ' ', { shiftKey: true });
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      await settle(fixture);
      expect(selected()).toEqual(['true', 'true', 'true']);
      key(row(2), ' ', { ctrlKey: true });
      await settle(fixture);
      expect(selected()).toEqual(['true', 'false', 'true']);

      key(canvasEl(1) as HTMLElement, 'ArrowRight', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('20%');
      expect(canvasEl(3)?.style.left).toBe('20%');
      expect(canvasEl(2)?.style.left).toBe('10%');
      expect(live()).toBe('2 layers moved');
      // As a group: the boxes are 80% wide, so they stop together at the right edge.
      key(canvasEl(1) as HTMLElement, 'ArrowRight', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('20%');

      key(row(3), 'ArrowDown', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['B', 'C', 'A']);
      expect(live()).toBe('2 layers sent backward');

      key(row(3), 'Delete');
      await settle(fixture);
      expect(rowNames()).toEqual(['B']);
      expect(live()).toBe('2 layers deleted — press Ctrl+Z to undo');
      expect(document.activeElement).toBe(row(2));
    });

    it('selects every layer with Ctrl+A', async () => {
      await open({ document: three, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      await settle(fixture);
      expect(selected()).toEqual(['true', 'true', 'true']);
      expect(live()).toBe('All 3 layers selected');
    });

    it('hides a layer: gone from the canvas, marked in its row, and saved as hidden', async () => {
      await open({ document: three, revision: 1 });
      const hide = root.querySelector(`#layer-hide-${ID(2)}`) as HTMLButtonElement;
      expect(hide.getAttribute('aria-label')).toBe('Hide B');
      expect(hide.getAttribute('aria-pressed')).toBe('false');
      hide.click();
      await settle(fixture);
      expect(canvasEl(2)).toBeNull();
      expect(canvasTexts()).toEqual(['A', 'C']);
      expect(state(2)).toBe('Hidden');
      expect(hide.getAttribute('aria-pressed')).toBe('true');
      expect(live()).toBe('Layer hidden');
      expect((await saved()).elements.map((e) => e.hidden)).toEqual([false, true, false]);
      // From the canvas, the shortcut hides it and focus moves to its row.
      key(canvasEl(1) as HTMLElement, 'h', { code: 'KeyH' });
      await settle(fixture);
      expect(canvasEl(1)).toBeNull();
      expect(document.activeElement).toBe(row(1));
      // A Hebrew layout types י on the H key.
      key(row(1), 'י', { code: 'KeyH' });
      await settle(fixture);
      expect(canvasEl(1)).not.toBeNull();
      expect(live()).toBe('Layer shown');
    });

    it('locks a layer: dragging, arrow keys, the fields and editing leave it as it is', async () => {
      await open({ document: three, revision: 1 });
      (root.querySelector(`#layer-lock-${ID(3)}`) as HTMLButtonElement).click();
      await settle(fixture);
      expect(state(3)).toBe('Locked');
      expect(live()).toBe('Layer locked');
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      const el = canvasEl(3) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
      pointer('pointerdown', 100, 150);
      pointer('pointermove', 100, 300);
      pointer('pointerup', 100, 300);
      await settle(fixture);
      expect(canvasEl(3)?.style.top).toBe('20%');
      expect(live()).toContain('This layer is locked');
      key(el, 'ArrowDown');
      key(el, 'Enter');
      await settle(fixture);
      expect(canvasEl(3)?.style.top).toBe('20%');
      expect(root.querySelector('textarea.el-edit')).toBeNull();
      const y = root.querySelector('#studio-y') as HTMLInputElement;
      expect(y.readOnly).toBe(true);
      y.value = '50';
      y.dispatchEvent(new Event('change'));
      expect(y.value).toBe('20');
      const textField = root.querySelector('#studio-text') as HTMLTextAreaElement;
      expect(textField.readOnly).toBe(true);
      textField.value = 'Changed';
      textField.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(canvasEl(3)?.textContent).toBe('C');
      // It can still be reordered, and unlocked.
      key(row(3), 'ArrowDown', { altKey: true });
      await settle(fixture);
      expect(rowNames()).toEqual(['B', 'C', 'A']);
      key(row(3), 'l');
      await settle(fixture);
      expect(live()).toBe('Layer unlocked');
      const saved1 = await saved();
      expect(saved1.elements.map((e) => e.locked)).toEqual([false, false, false]);
    });

    it('moves a selection without its locked layers, and says so', async () => {
      const doc = { ...three, elements: [at(1, 'A', 0.4, { locked: true }), at(2, 'B', 0.3)] };
      await open({ document: doc, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      key(elements()[1], 'ArrowDown');
      await settle(fixture);
      expect(canvasEl(1)?.style.top).toBe('40%');
      expect(canvasEl(2)?.style.top).toBe('31%');
      expect(live()).toBe('Text moved to left 10%, top 31%; a locked layer stays');
    });

    it('duplicates a layer just above it with a new id, and stops at the element limit', async () => {
      await open({ document: three, revision: 1 });
      key(canvasEl(1) as HTMLElement, 'd');
      await settle(fixture);
      expect(rowNames()).toEqual(['C', 'B', 'A', 'A']);
      const copy = rows()[2].id.replace('layer-', '');
      expect(copy).toMatch(/^[0-9a-f-]{36}$/);
      expect(copy).not.toBe(ID(1));
      expect(document.activeElement?.id).toBe(`studio-el-${copy}`);
      expect(live()).toBe('Layer duplicated');
      const doc = await saved();
      expect(doc.elements[1]).toEqual({
        ...three.elements[0],
        id: copy,
        box: { ...three.elements[0].box, x: 0.12, y: 0.42 },
      });

      const full = {
        ...existing,
        elements: Array.from({ length: 60 }, (_, i) => ({
          ...at(1, `T${i}`, 0.4),
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
      };
      fixture.destroy();
      await open({ document: full, revision: 1 });
      key(elements()[0], 'd');
      await settle(fixture);
      expect(elements()).toHaveLength(60);
      expect(live()).toBe('A tale holds at most 60 layers');
    });

    it('opens the actions menu by the Shift+F10 and context-menu keys themselves, on any system (story 7.15)', async () => {
      await open({ document: three, revision: 1 });
      const menu = () => root.querySelector('[role=menu]') as HTMLElement | null;
      const first = () => menu()?.querySelector<HTMLElement>('[role=menuitem]') ?? null;
      // Shift+F10 on a canvas element: the studio's menu opens (no contextmenu event is needed, as on
      // a Mac), the key's default is stopped, and Escape brings focus back.
      const el = canvasEl(1) as HTMLButtonElement;
      el.focus();
      const shiftF10 = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(shiftF10);
      await settle(fixture);
      expect(shiftF10.defaultPrevented).toBe(true);
      expect(menu()).not.toBeNull();
      expect(document.activeElement).toBe(first());
      expect(el.getAttribute('aria-pressed')).toBe('true');
      key(first() as HTMLElement, 'Escape');
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(el);
      // The context-menu key on a layer row.
      row(2).focus();
      const menuKey = new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true });
      row(2).dispatchEvent(menuKey);
      await settle(fixture);
      expect(menuKey.defaultPrevented).toBe(true);
      expect(menu()).not.toBeNull();
      key(first() as HTMLElement, 'Escape');
      await settle(fixture);
      expect(document.activeElement).toBe(row(2));
      // F10 alone is not one.
      const f10 = new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true });
      row(2).dispatchEvent(f10);
      await settle(fixture);
      expect(f10.defaultPrevented).toBe(false);
      expect(menu()).toBeNull();
    });

    it('opens the actions menu from a row, by Shift+F10 and by right-click, and returns focus when it closes', async () => {
      await open({ document: three, revision: 1 });
      const more = root.querySelector(`#layer-more-${ID(2)}`) as HTMLButtonElement;
      expect(more.getAttribute('aria-label')).toBe('More actions for B');
      expect(more.getAttribute('aria-haspopup')).toBe('menu');
      more.click();
      await settle(fixture);
      const menu = () => root.querySelector('[role=menu]') as HTMLElement | null;
      const items = () => [...(menu()?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(items().map((i) => i.firstElementChild?.textContent)).toEqual([
        'Bring forward',
        'Send backward',
        'Bring to front',
        'Send to back',
        'Hide',
        'Lock',
        'Duplicate',
        'Delete',
      ]);
      // The menu shows the shortcuts, which work on the canvas and in the list, not in the menu.
      expect(items()[0].querySelector('.layer-menu__key')?.textContent).toMatch(/^(⌥↑|Alt\+↑)$/);
      expect(items()[0].hasAttribute('aria-keyshortcuts')).toBe(false);
      expect(document.activeElement).toBe(items()[0]);
      key(items()[0], 'ArrowUp');
      expect(document.activeElement).toBe(items()[7]);
      key(items()[7], 'Home');
      key(items()[0], 'ArrowDown');
      expect(document.activeElement).toBe(items()[1]);
      key(items()[1], 'Escape');
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(more);

      // The More actions button toggles the menu.
      more.click();
      await settle(fixture);
      expect(menu()).not.toBeNull();
      more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      more.click();
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(more.getAttribute('aria-expanded')).toBe('false');

      // Shift+F10 or the context-menu key fire contextmenu at the focused canvas element (at 0, 0):
      // the studio menu opens and the browser's does not.
      canvasEl(1)?.focus();
      const keyMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      canvasEl(1)?.dispatchEvent(keyMenu);
      expect(keyMenu.defaultPrevented).toBe(true);
      await settle(fixture);
      const onItem = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      items()[0].dispatchEvent(onItem);
      expect(onItem.defaultPrevented).toBe(true);
      items()[2].click();
      await settle(fixture);
      expect(menu()).toBeNull();
      expect(rowNames()).toEqual(['A', 'C', 'B']);
      expect(document.activeElement).toBe(canvasEl(1));

      // A right-click on a row of a two-layer selection offers the actions for both.
      row(1).click();
      row(2).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, detail: 1 }));
      await settle(fixture);
      const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
      row(2).dispatchEvent(context);
      await settle(fixture);
      expect(context.defaultPrevented).toBe(true);
      expect(items().map((i) => i.firstElementChild?.textContent)).toEqual([
        'Bring forward',
        'Send backward',
        'Bring to front',
        'Send to back',
        'Delete 2 layers',
      ]);
      // A press outside closes it, leaving focus where it went.
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await settle(fixture);
      expect(menu()).toBeNull();
    });

    it('warns in the row when a layer reaches outside the safe area, and clears when it moves back', async () => {
      await open({ document: three, revision: 1 });
      expect(state(3)).toBe('');
      const el = canvasEl(3) as HTMLElement;
      // From 20% up by 10%: into the top safe area (12%).
      key(el, 'ArrowUp', { shiftKey: true });
      await settle(fixture);
      expect(state(3)).toBe('Outside safe area');
      expect(canvasEl(3)?.getAttribute('aria-describedby')).toBe(`layer-state-${ID(3)}`);
      key(el, 'ArrowDown', { shiftKey: true });
      await settle(fixture);
      expect(state(3)).toBe('');
      // Into the bottom 16%: still saved.
      const y = root.querySelector('#studio-y') as HTMLInputElement;
      y.value = '80';
      y.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(state(3)).toBe('Outside safe area');
      expect((await saved()).elements[2].box.y).toBe(0.8);
    });

    it('shows and hides the safe-area guides', async () => {
      await open({ document: three, revision: 1 });
      const guides = () => root.querySelector('.guides') as HTMLElement | null;
      expect(guides()?.getAttribute('aria-hidden')).toBe('true');
      expect(guides()?.style.top).toBe('12%');
      expect(guides()?.style.bottom).toBe('16%');
      expect(guides()?.style.left).toBe('4%');
      // The top bar's Safe area toggle (Tale Studio 2).
      const toggle = root.querySelector('#studio-safe-area') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      toggle.click();
      await settle(fixture);
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(guides()).toBeNull();
      expect(live()).toBe('Safe areas hidden');
    });

    it('snaps a dragged layer to the canvas centre and other layers, and not with Alt held', async () => {
      const doc = {
        ...three,
        elements: [at(1, 'A', 0.5, { box: { x: 0.1, y: 0.5, w: 0.2, h: 0.1, rotation: 0 } }), at(2, 'B', 0.3)],
      };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number, altKey = false) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, altKey }),
        );
      // Its centre from 60 px to 147 px: 3 px short of the canvas centre (150 px), so it snaps there.
      pointer('pointerdown', 60, 330);
      pointer('pointermove', 147, 333);
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('40%');
      expect((root.querySelector('.snap-line--x') as HTMLElement).style.left).toBe('50%');
      // With Alt it lands where it is dropped.
      pointer('pointermove', 147, 333, true);
      pointer('pointerup', 147, 333, true);
      await settle(fixture);
      expect(canvasEl(1)?.style.left).toBe('39%');
      expect(root.querySelector('.snap-line--x')).toBeNull();
      expect(live()).toBe('Text moved');
    });

    it('moves a selection by arrows without its hidden layers, which neither move nor hold the group back', async () => {
      const doc = {
        ...three,
        elements: [
          at(1, 'A', 0.4, { hidden: true, box: { x: 0.1, y: 0.9, w: 0.8, h: 0.1, rotation: 0 } }),
          at(2, 'B', 0.3),
        ],
      };
      await open({ document: doc, revision: 1 });
      key(elements()[0], 'a', { ctrlKey: true });
      key(canvasEl(2) as HTMLElement, 'ArrowDown', { shiftKey: true });
      await settle(fixture);
      expect(canvasEl(2)?.style.top).toBe('40%');
      expect(live()).toBe('Text moved to left 10%, top 40%');
      const saved1 = await saved();
      expect(saved1.elements[0].box.y).toBe(0.9);
    });

    it('drags the unlocked layers of a selection when a locked one is pressed, and says the locked one stays', async () => {
      const doc = { ...three, elements: [at(1, 'A', 0.4, { locked: true }), at(2, 'B', 0.2)] };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      key(elements()[0], 'a', { ctrlKey: true });
      await settle(fixture);
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, altKey: true }),
        );
      pointer('pointerdown', 150, 270);
      pointer('pointermove', 150, 330);
      pointer('pointerup', 150, 330);
      await settle(fixture);
      expect(canvasEl(1)?.style.top).toBe('40%');
      expect(canvasEl(2)?.style.top).toBe('30%');
      expect(live()).toBe('Text moved; a locked layer stays');
    });

    it("snaps by a turned layer's visible edge, the one the safe-area warning measures", async () => {
      // A quarter-turned box 0.3 wide and 0.05 high: it shows 0.15 × 9/16 ≈ 0.0889 wide, centred at x 0.5.
      const turned = { x: 0.35, y: 0.5, w: 0.3, h: 0.05, rotation: 90 };
      const doc = { ...three, elements: [at(1, 'A', 0.5, { box: turned })] };
      await open({ document: doc, revision: 1 });
      const canvas = root.querySelector('.canvas') as HTMLElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 1600 }) as DOMRect;
      const el = canvasEl(1) as HTMLElement;
      const pointer = (type: string, x: number, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }));
      // It shows 0.16875 high, so its visible top is at 0.4406 (705 px). Dragged up 509 px, that edge
      // is 4 px below the top safe-area edge (0.12, 192 px) and snaps onto it; its box does not.
      pointer('pointerdown', 450, 800);
      pointer('pointermove', 450, 291);
      await settle(fixture);
      expect((root.querySelector('.snap-line--y') as HTMLElement).style.top).toBe('12%');
      pointer('pointerup', 450, 291);
      const box = (await saved()).elements[0].box;
      expect(elementBounds(box).y).toBeCloseTo(0.12, 3);
      expect(box.y).toBeCloseTo(0.1794, 4);
    });

    it('sets the background colour from the picker or the hex field, and saves it', async () => {
      await open({ document: three, revision: 1 });
      const picker = root.querySelector('#studio-bg') as HTMLInputElement;
      expect(picker.type).toBe('color');
      expect(root.querySelector('label[for=studio-bg]')?.textContent).toBe('Background colour');
      picker.value = '#112233';
      picker.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect((root.querySelector('.canvas') as HTMLElement).style.backgroundColor).toBe('rgb(17, 34, 51)');
      expect(live()).toBe('Background colour set to #112233');
      const hex = root.querySelector('#studio-bg-hex') as HTMLInputElement;
      expect(hex.value).toBe('#112233');
      hex.value = 'red; background:url(x)';
      hex.dispatchEvent(new Event('change'));
      await settle(fixture);
      // The entry stays, marked invalid and described by the message; the canvas keeps its colour.
      expect(hex.value).toBe('red; background:url(x)');
      expect(hex.getAttribute('aria-invalid')).toBe('true');
      expect(hex.getAttribute('aria-describedby')).toBe('studio-bg-hint studio-bg-error');
      expect(root.querySelector('#studio-bg-error')?.textContent).toBe(
        'Enter a colour as #RRGGBB or #RRGGBBAA. The background stays #112233.',
      );
      expect((root.querySelector('.canvas') as HTMLElement).style.backgroundColor).toBe('rgb(17, 34, 51)');
      hex.value = 'AABBCC80';
      hex.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(hex.value).toBe('#AABBCC80');
      expect(hex.hasAttribute('aria-invalid')).toBe(false);
      expect(root.querySelector('#studio-bg-error')).toBeNull();
      expect(picker.value).toBe('#aabbcc');
      expect((await saved()).canvas).toEqual({ background: { type: 'color', color: '#AABBCC80' } });
    });
  });

  describe('undo, redo and autosave (story 3)', () => {
    const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const at = (n: number, text: string, y: number) => ({
      ...existing.elements[0],
      id: ID(n),
      box: { x: 0.1, y, w: 0.8, h: 0.1, rotation: 0 },
      props: { text },
    });
    const three: TaleDocument = { ...existing, elements: [at(1, 'A', 0.4), at(2, 'B', 0.42), at(3, 'C', 0.2)] };
    const row = (n: number) => root.querySelector(`#layer-${ID(n)}`) as HTMLElement;
    const canvasEl = (n: number) => root.querySelector(`#studio-el-${ID(n)}`) as HTMLElement;
    const canvas = () => root.querySelector('#studio-canvas') as HTMLElement;
    const undoButton = () => root.querySelector('#studio-undo') as HTMLButtonElement;
    const redoButton = () => root.querySelector('#studio-redo') as HTMLButtonElement;
    const docNow = () => JSON.stringify((fixture.componentInstance as unknown as { doc(): TaleDocument }).doc());
    const alertText = () => [...root.querySelectorAll('[role=alert]')].map((a) => a.textContent).join(' ');
    const copyUrl = `${url}/copy`;

    it('undoes ten edits (add, move, reorder, hide…) one by one and redoes them, then saves the last state', async () => {
      await open({ document: three, revision: 1 });
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
      expect(undoButton().getAttribute('aria-keyshortcuts')).toBe('Control+Z');
      expect(redoButton().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Z Control+Y');
      const states = [docNow()];
      const step = async (act: () => void) => {
        act();
        await settle(fixture);
        states.push(docNow());
      };
      await step(() => buttonNamed(root, 'Add body text').click());
      key(root.querySelector('textarea.el-edit') as HTMLElement, 'Escape');
      await settle(fixture);
      await step(() => key(canvasEl(1), 'ArrowDown'));
      await step(() => key(canvasEl(1), 'ArrowUp', { altKey: true }));
      await step(() => key(canvasEl(2), 'h', { code: 'KeyH' }));
      await step(() => key(row(3), 'l', { code: 'KeyL' }));
      await step(() => key(row(1), 'd', { code: 'KeyD' }));
      await step(() => {
        const hex = root.querySelector('#studio-bg-hex') as HTMLInputElement;
        hex.value = '#112233';
        hex.dispatchEvent(new Event('change'));
      });
      await step(() => key(row(3), 'ArrowDown', { altKey: true }));
      canvasEl(1).click();
      await settle(fixture);
      await step(() => {
        const y = root.querySelector('#studio-y') as HTMLInputElement;
        y.value = '55';
        y.dispatchEvent(new Event('change'));
      });
      await step(() => key(canvasEl(1), 'Delete'));
      expect(new Set(states).size).toBe(11);
      expect(undoButton().title).toBe('Undo Text deleted (Ctrl+Z)');

      for (let i = 9; i >= 0; i--) {
        key(canvas(), 'z', { ctrlKey: true });
        await settle(fixture);
        expect(docNow()).toBe(states[i]);
      }
      expect(live()).toBe('Undone: Text added');
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
      undoButton().click();
      await settle(fixture);
      expect(live()).toBe('Nothing to undo');
      expect(docNow()).toBe(states[0]);

      for (let i = 1; i <= 10; i++) {
        if (i % 2) key(canvas(), 'Z', { ctrlKey: true, shiftKey: true });
        else redoButton().click();
        await settle(fixture);
        expect(docNow()).toBe(states[i]);
      }
      expect(redoButton().getAttribute('aria-disabled')).toBe('true');
      expect(live()).toBe('Redone: Text deleted');
      expect(JSON.stringify((await saveNow(2)).document)).toBe(states[10]);
    });

    it('undoes a delete, bringing the layer back selected, with Ctrl+Y redoing it', async () => {
      await open({ document: three, revision: 1 });
      key(canvasEl(2), 'Delete');
      await settle(fixture);
      expect(canvasEl(2)).toBeNull();
      expect(live()).toBe('Text deleted — press Ctrl+Z to undo');
      key(canvas(), 'z', { ctrlKey: true });
      await settle(fixture);
      expect(canvasEl(2)?.getAttribute('aria-pressed')).toBe('true');
      expect(live()).toBe('Undone: Text deleted');
      // Focus stays where the delete put it, on the next layer.
      expect(document.activeElement).toBe(canvasEl(3));
      key(canvas(), 'y', { ctrlKey: true });
      await settle(fixture);
      expect(canvasEl(2)).toBeNull();
    });

    it('leaves Ctrl+Z in a text field to the browser, and makes typing one step', async () => {
      await open({ document: three, revision: 1 });
      canvasEl(1).click();
      await settle(fixture);
      const field = root.querySelector('#studio-text') as HTMLTextAreaElement;
      for (const value of ['A1', 'A12', 'A123']) {
        field.value = value;
        field.dispatchEvent(new Event('input'));
      }
      await settle(fixture);
      const typed = docNow();
      const press = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      field.dispatchEvent(press);
      await settle(fixture);
      expect(press.defaultPrevented).toBe(false);
      expect(docNow()).toBe(typed);
      // Outside the field, one undo takes the whole word back.
      undoButton().click();
      await settle(fixture);
      expect(canvasEl(1).textContent).toBe('A');
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    });

    it('makes a whole drag one step', async () => {
      await open({ document: three, revision: 1 });
      canvas().getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600 }) as DOMRect;
      const el = canvasEl(3);
      const pointer = (type: string, y: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 100, clientY: y }));
      pointer('pointerdown', 100);
      for (const y of [120, 160, 220]) pointer('pointermove', y);
      pointer('pointerup', 220);
      await settle(fixture);
      expect(canvasEl(3).style.top).not.toBe('20%');
      expect(undoButton().title).toBe('Undo Text moved (Ctrl+Z)');
      undoButton().click();
      await settle(fixture);
      expect(canvasEl(3).style.top).toBe('20%');
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    });

    it('offers keep-as-copy on a stale save, and keeps the version as a new tale in the same group', async () => {
      await open({ document: three, revision: 1 });
      const store = TestBed.inject(DashboardStore);
      const refresh = vi.spyOn(store, 'refresh').mockResolvedValue();
      // The router changes the route's tale before navigation resolves.
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(async (commands) => {
        fixture.componentRef.setInput('taleId', (commands as string[])[1]);
        fixture.detectChanges();
        return true;
      });
      key(canvasEl(1), 'ArrowDown');
      const leaving = fixture.componentInstance.canLeave();
      await settle(fixture);
      http
        .expectOne(url)
        .flush({ error: { code: 'stale_revision', message: 'stale' } }, { status: 409, statusText: 'Conflict' });
      // Leaving now asks, since the changes are not saved; the person stays.
      expect(await leaving).toBe(false);
      expect(window.confirm).toHaveBeenCalledTimes(1);
      await settle(fixture);
      expect(alertText()).toContain('Someone saved this tale after you opened it');
      expect(status()).toBe('Not saved: a newer version exists');
      // Edits go on, kept on the page; autosave stays stopped.
      key(canvasEl(1), 'ArrowDown');
      await settle(fixture);
      http.expectNone(url);
      const mine = docNow();

      // A full group refuses; the version stays and the choice is still offered.
      buttonNamed(root, 'Keep my version as a new tale').click();
      await settle(fixture);
      const full = http.expectOne(copyUrl);
      expect(full.request.method).toBe('POST');
      full.flush({ error: { code: 'tale_group_full', message: 'full' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      expect(alertText()).toContain('already holds the most tales it can');
      expect(docNow()).toBe(mine);
      expect(navigate).not.toHaveBeenCalled();

      buttonNamed(root, 'Keep my version as a new tale').click();
      await settle(fixture);
      const keep = http.expectOne(copyUrl);
      expect(JSON.stringify((keep.request.body as { document: TaleDocument }).document)).toBe(mine);
      // While it is kept, editing is held: nothing changes and nothing goes to the original.
      key(canvasEl(1), 'ArrowDown');
      await settle(fixture);
      expect(docNow()).toBe(mine);
      expect(live()).toBe('Wait until your version is kept as a new tale.');
      keep.flush({ ...tale, id: 't2', title: 'Beach (copy)', position: 1, status: 'draft', storedStatus: 'draft' });
      await settle(fixture);
      expect(refresh).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/tales', 't2', 'studio'], { queryParams: { zone: undefined } });
      // The route's tale is the copy now: the studio opens it, and no save ever went to the original.
      http
        .expectOne(`${API_BASE}/tales/t2/document`)
        .flush(draftRead({ document: JSON.parse(mine), revision: 1, published: { document: null, revision: 0 } }));
      await settle(fixture);
      http.expectNone(url);
      expect(docNow()).toBe(mine);
      expect(status()).toBe('All changes saved');
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
      expect(root.querySelector('.studio-notice')?.textContent).toContain('kept as a new draft tale, “Beach (copy)”');
      expect(await fixture.componentInstance.canLeave()).toBe(true);
    });

    it('stays in the stale choice when the kept copy cannot be opened', async () => {
      await open({ document: three, revision: 1 });
      vi.spyOn(TestBed.inject(DashboardStore), 'refresh').mockResolvedValue();
      vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(false);
      key(canvasEl(1), 'ArrowDown');
      void fixture.componentInstance.canLeave();
      await settle(fixture);
      http
        .expectOne(url)
        .flush({ error: { code: 'stale_revision', message: 'stale' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      buttonNamed(root, 'Keep my version as a new tale').click();
      await settle(fixture);
      http.expectOne(copyUrl).flush({ ...tale, id: 't2', title: 'Beach (copy)' });
      await settle(fixture);
      expect(alertText()).toContain('it could not be opened');
      expect(status()).toBe('Not saved: a newer version exists');
      // Editing works again, and still nothing is saved to the original.
      key(canvasEl(1), 'ArrowDown');
      await settle(fixture);
      http.expectNone(url);
    });

    it('reloads the latest version on request, starting the history over', async () => {
      await open({ document: three, revision: 1 });
      key(canvasEl(1), 'ArrowDown');
      void fixture.componentInstance.canLeave();
      await settle(fixture);
      http
        .expectOne(url)
        .flush({ error: { code: 'stale_revision', message: 'stale' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      buttonNamed(root, 'Reload latest version').click();
      await settle(fixture);
      http.expectOne(url).flush(draftRead({ document: three, revision: 5 }));
      await settle(fixture);
      await settle(fixture);
      expect(docNow()).toBe(JSON.stringify(three));
      expect(undoButton().getAttribute('aria-disabled')).toBe('true');
      expect(alertText()).toBe('');
      expect(live()).toBe('Latest version loaded');
      // The stale choice that had focus is gone: focus is on the canvas.
      expect(document.activeElement).toBe(canvas());
      key(canvasEl(1), 'ArrowDown');
      expect((await saveNow(6)).revision).toBe(5);
    });

    it('asks before the tab closes with unsaved changes, and tries to save them', async () => {
      await open({ document: three, revision: 1 });
      const quiet = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(quiet);
      expect(quiet.defaultPrevented).toBe(false);
      key(canvasEl(1), 'ArrowDown');
      const closing = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(closing);
      expect(closing.defaultPrevented).toBe(true);
      await settle(fixture);
      http.expectOne(url).flush({ document: three, revision: 2 });
      await settle(fixture);
      expect(status()).toBe('All changes saved');
    });

    it('leaves at once when everything is saved, and asks when a save fails', async () => {
      await open({ document: three, revision: 1 });
      expect(await fixture.componentInstance.canLeave()).toBe(true);
      key(canvasEl(1), 'ArrowDown');
      vi.mocked(window.confirm).mockReturnValue(true);
      const leaving = fixture.componentInstance.canLeave();
      await settle(fixture);
      http
        .expectOne(url)
        .flush({ error: { code: 'internal_error', message: 'x' } }, { status: 500, statusText: 'Error' });
      expect(await leaving).toBe(true);
      expect(window.confirm).toHaveBeenCalledWith(
        'Your latest changes to this tale are not saved. Leave Tale Studio and lose them?',
      );
    });

    describe('Update tale and the status line (user decision 2026-10-22, epic UX rework R15)', () => {
      const publishState = () => root.querySelector('#studio-update-state')?.textContent?.trim();
      const publishButton = () => root.querySelector('#studio-update') as HTMLButtonElement;
      const discardButton = () => menuItem('studio-discard');
      const VISIBLE = { visible: true, reasons: [] };
      const GROUP_OFF = { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] };
      const NOT_UPDATED = { visible: false, reasons: [{ code: 'not-updated-yet', subject: 'tale' }] };
      // The tale as the store lists it, with its visibility (story 8.2).
      const seeTale = (visibility: unknown, changes: Record<string, unknown> = {}) =>
        TestBed.inject(DashboardStore).taleGroups.set({
          z1: [{ ...group, tales: [{ ...tale, visibility, ...changes }] } as unknown as ZoneTaleGroup],
        });
      const taleRead = `${API_BASE}/tales/t1`;
      // Answers the studio's read of the tale (`GET /tales/{id}`, in any zone) with `visibility`;
      // `all` answers every read waiting, such as the one on opening and the one after an update.
      async function answerRead(visibility: unknown, all = false): Promise<void> {
        const reads = all ? http.match(taleRead) : [http.expectOne(taleRead)];
        expect(reads.length).toBeGreaterThan(0);
        for (const read of reads) read.flush({ ...tale, visibility });
        // Twice: what it says is announced on the next turn.
        await settle(fixture);
        await settle(fixture);
      }
      let refresh: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        seeTale(VISIBLE);
        refresh = vi.spyOn(TestBed.inject(DashboardStore), 'refresh').mockResolvedValue() as never;
      });

      it('labels its buttons Update tale and Discard changes', async () => {
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        expect(publishButton().textContent?.trim()).toBe('Update tale');
        expect(discardButton().textContent?.trim()).toMatch(/^Discard changes\b/);
        expect(publishButton().getAttribute('aria-describedby')).toBe('studio-update-state');
      });

      it('says "Visible on site · up to date" with nothing to update or discard', async () => {
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        expect(publishState()).toBe('Visible on site · up to date');
        expect(root.querySelector('.studio-update__dot.is-visible')).not.toBeNull();
        expect(publishButton().getAttribute('aria-disabled')).toBe('true');
        expect(discardButton().getAttribute('aria-disabled')).toBe('true');
        publishButton().click();
        await settle(fixture);
        http.expectNone(`${url}/publish`);
      });

      it('says "Not visible: not updated yet" with the changes for a tale with nothing on the site', async () => {
        seeTale(NOT_UPDATED);
        await open({ document: three, revision: 1, published: { document: null, revision: 0 } });
        // "Not updated yet" is said once: the changes are only counted.
        expect(publishState()).toBe('Not visible: not updated yet · 3 changes');
        expect(root.querySelector('.studio-update__dot:not(.is-visible)')).not.toBeNull();
        expect(publishButton().hasAttribute('aria-disabled')).toBe(false);
        expect(discardButton().getAttribute('aria-disabled')).toBe('true');
        // A shown tale from media, before documents: visitors see its media.
        seeTale(VISIBLE);
        fixture.detectChanges();
        expect(publishState()).toBe('Visible on site · changes not updated yet');
      });

      it('says "Not visible: group is off" in a group that is off, with the changes not updated yet', async () => {
        seeTale(GROUP_OFF, { status: 'blocked-by-group' });
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        expect(publishState()).toBe('Not visible: group is off');
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        expect(publishState()).toBe('Not visible: group is off · 1 change not updated yet');
        key(canvasEl(2), 'ArrowDown');
        await settle(fixture);
        expect(publishState()).toBe('Not visible: group is off · 2 changes not updated yet');
        publishButton().click();
        await settle(fixture);
        const save = http.expectOne(url);
        const draft = (save.request.body as { document: TaleDocument }).document;
        save.flush({ document: draft, revision: 4, published: { document: three, revision: 2 } });
        await settle(fixture);
        http
          .expectOne(`${url}/publish`)
          .flush({ document: draft, revision: 4, published: { document: draft, revision: 3 } });
        await settle(fixture);
        // Read on opening, then after the update.
        await answerRead(GROUP_OFF, true);
        expect(refresh).toHaveBeenCalled();
        expect(publishState()).toBe('Not visible: group is off');
        expect(live()).toBe('Tale updated. Not visible: group is off.');
      });

      it('has nothing to update while no draft is stored and nothing changed', async () => {
        await open({ document: null, revision: 0, published: { document: null, revision: 0 } });
        expect(publishButton().getAttribute('aria-disabled')).toBe('true');
        publishButton().click();
        await settle(fixture);
        http.expectNone(`${url}/publish`);
        buttonNamed(root, 'Add body text').click();
        await settle(fixture);
        expect(publishButton().hasAttribute('aria-disabled')).toBe(false);
      });

      it('updates the tale once its changes are saved, with both revisions, then reads the indicator again', async () => {
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        expect(publishState()).toBe('Visible on site · changes not updated yet');
        expect(refresh).not.toHaveBeenCalled();
        publishButton().click();
        await settle(fixture);
        const save = http.expectOne(url);
        const draft = (save.request.body as { document: TaleDocument }).document;
        save.flush({ document: draft, revision: 4, published: { document: three, revision: 2 } });
        await settle(fixture);
        const publish = http.expectOne(`${url}/publish`);
        expect(publish.request.method).toBe('POST');
        expect(publish.request.body).toEqual({ revision: 4, publishedRevision: 2 });
        // The server answers JSONB with its own key order: still the same document.
        const reverse = (v: unknown): unknown =>
          Array.isArray(v)
            ? v.map(reverse)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                  Object.entries(v)
                    .reverse()
                    .map(([k, x]) => [k, reverse(x)]),
                )
              : v;
        const reordered = reverse(draft) as TaleDocument;
        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(draft));
        publish.flush({ document: draft, revision: 4, published: { document: reordered, revision: 3 } });
        await settle(fixture);
        // Nothing is said until the tale is read again: the opening read, then the one after.
        expect(live()).not.toContain('Tale updated');
        await answerRead(VISIBLE, true);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(publishState()).toBe('Visible on site · up to date');
        expect(live()).toBe('Tale updated. Visitors now see this version.');
        expect(publishButton().getAttribute('aria-disabled')).toBe('true');
      });

      it('drops "not updated yet" once the tale is updated, and says what the indicator reads after', async () => {
        seeTale(NOT_UPDATED);
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        await answerRead(NOT_UPDATED);
        expect(publishState()).toBe('Not visible: not updated yet · 3 changes');
        publishButton().click();
        await settle(fixture);
        http
          .expectOne(`${url}/publish`)
          .flush({ document: three, revision: 3, published: { document: three, revision: 1 } });
        await settle(fixture);
        // Read again, the tale says its group is off (it was turned off meanwhile).
        await answerRead(GROUP_OFF);
        expect(publishState()).toBe('Not visible: group is off');
        expect(live()).toBe('Tale updated. Not visible: group is off.');
      });

      it('shows "Visible on site" once something is on the site, before the store is read again', async () => {
        seeTale(NOT_UPDATED);
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        publishButton().click();
        await settle(fixture);
        http
          .expectOne(`${url}/publish`)
          .flush({ document: three, revision: 3, published: { document: three, revision: 1 } });
        await settle(fixture);
        await settle(fixture);
        expect(publishState()).toBe('Visible on site · up to date');
      });

      it('never says "Publish": not in its text, labels, tooltips or announcements', async () => {
        const image = {
          ...OWN_MEDIA,
          id: '00000000-0000-4000-8000-0000000000ee',
          a11y: {},
          box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3, rotation: 0 },
          props: { mediaKey: 'tales/0c.png', fit: 'contain' },
        } as unknown as TaleDocument['elements'][number];
        seeTale(NOT_UPDATED);
        await open({ document: { ...three, elements: [...three.elements, image] }, revision: 3 });
        const said: string[] = [];
        const scan = () => {
          said.push(root.textContent ?? '');
          for (const el of [root, ...root.querySelectorAll('*')]) {
            for (const attr of [...el.attributes]) {
              if (!attr.name.startsWith('_ng') && !attr.name.startsWith('ng-')) said.push(`${attr.name}=${attr.value}`);
            }
          }
        };
        scan();
        // The inspector of a selected image without alt text, and of a text.
        canvasEl(1).click();
        await settle(fixture);
        scan();
        (root.querySelector('#studio-el-00000000-0000-4000-8000-0000000000ee') as HTMLElement).click();
        await settle(fixture);
        scan();
        buttonNamed(root, 'Add body text').click();
        await settle(fixture);
        scan();
        // The line with changes, a status, and an update refused by the server.
        seeTale(GROUP_OFF);
        fixture.detectChanges();
        scan();
        publishButton().click();
        await settle(fixture);
        http.expectOne(url).flush({ document: three, revision: 4 });
        await settle(fixture);
        http.expectOne(`${url}/publish`).flush(
          {
            error: {
              code: 'invalid_tale_document',
              message: 'bad',
              pointer: '/elements/0/a11y/label',
            },
          },
          { status: 400, statusText: 'Bad Request' },
        );
        await settle(fixture);
        scan();
        const found = said.filter((text) => /publish/i.test(text));
        expect(found).toEqual([]);
      });

      it('reads the tale itself when the store has not listed it yet, as on opening its URL directly', async () => {
        const store = TestBed.inject(DashboardStore);
        store.taleGroups.set({});
        store.loaded.set(false);
        fixture = TestBed.createComponent(TaleStudioPage);
        fixture.componentRef.setInput('taleId', 't1');
        fixture.detectChanges();
        http.expectOne(url).flush(draftRead({ document: three, revision: 3 }));
        await settle(fixture);
        root = fixture.nativeElement as HTMLElement;
        document.body.appendChild(root);
        // Nothing known yet: the line says only where the draft stands, with no dot.
        expect(publishState()).toBe('Up to date');
        expect(root.querySelector('.studio-update__dot')).toBeNull();
        await answerRead({ visible: false, reasons: [{ code: 'not-in-any-zone', subject: 'group' }] });
        expect(publishState()).toBe('Not visible: group is not in any zone');
      });

      it('keeps the line as it was when the tale cannot be read, and then says only "Tale updated."', async () => {
        const store = TestBed.inject(DashboardStore);
        store.taleGroups.set({});
        fixture = TestBed.createComponent(TaleStudioPage);
        fixture.componentRef.setInput('taleId', 't1');
        fixture.detectChanges();
        http.expectOne(url).flush(draftRead({ document: three, revision: 3, published: { document: null, revision: 0 } }));
        await settle(fixture);
        root = fixture.nativeElement as HTMLElement;
        document.body.appendChild(root);
        http.expectOne(taleRead).flush(null, { status: 500, statusText: 'Down' });
        await settle(fixture);
        expect(publishState()).toBe('Changes not updated yet');
        expect(store.apiDown()).toBe(false);
        publishButton().click();
        await settle(fixture);
        http
          .expectOne(`${url}/publish`)
          .flush({ document: three, revision: 3, published: { document: three, revision: 1 } });
        await settle(fixture);
        http.expectOne(taleRead).flush(null, { status: 500, statusText: 'Down' });
        await settle(fixture);
        await settle(fixture);
        expect(live()).toBe('Tale updated.');
        expect(publishState()).toBe('Up to date');
        expect(store.apiDown()).toBe(false);
      });

      it('reads the tale again after a save while nothing is on the site: a first draft can take it off', async () => {
        // A tale whose media is out of step, composed by the Delivery API: on the site until its
        // first draft is saved (story 8.4 review).
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        await answerRead(VISIBLE);
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        expect(publishState()).toBe('Visible on site · changes not updated yet');
        await saveNow(4);
        await answerRead(NOT_UPDATED);
        expect(publishState()).toBe('Not visible: not updated yet · 3 changes');
      });

      it('does not read the tale again after a save once something is on the site', async () => {
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        await answerRead(VISIBLE);
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        await saveNow(4);
        http.expectNone(taleRead);
      });

      it('in several zones, is visible when one shows it, else gives the first reason in their order', async () => {
        const listed = (visibility: unknown) =>
          ({ ...group, tales: [{ ...tale, visibility }] }) as unknown as ZoneTaleGroup;
        const store = TestBed.inject(DashboardStore);
        store.taleGroups.set({
          z1: [listed({ visible: false, reasons: [{ code: 'zone-not-installed', subject: 'zone' }] })],
          z2: [listed({ visible: false, reasons: [{ code: 'zone-no-display', subject: 'zone' }] })],
        });
        await open({ document: three, revision: 3, published: { document: three, revision: 2 } });
        expect(publishState()).toBe('Not visible: zone has no display');
        store.taleGroups.update((lists) => ({ ...lists, z3: [listed(VISIBLE)] }));
        fixture.detectChanges();
        expect(publishState()).toBe('Visible on site · up to date');
      });

      it('reads again on coming back to the page, once for focus and the tab shown, and at most every 15 s', async () => {
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        await answerRead(VISIBLE);
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        http
          .expectOne(url)
          .flush(draftRead({ document: three, revision: 3, published: { document: three, revision: 1 } }));
        await answerRead(GROUP_OFF);
        expect(publishState()).toBe('Not visible: group is off');
        // No full refresh, so a failure there cannot show the API-down banner.
        expect(refresh).not.toHaveBeenCalled();
        now += BACK_TO_PAGE_INTERVAL_MS - 1;
        window.dispatchEvent(new Event('focus'));
        http.expectNone(url);
        http.expectNone(taleRead);
        now += 1;
        window.dispatchEvent(new Event('focus'));
        http
          .expectOne(url)
          .flush(draftRead({ document: three, revision: 3, published: { document: three, revision: 1 } }));
        await answerRead(VISIBLE);
        expect(publishState()).toBe('Visible on site · up to date');
      });

      it('does not read again on coming back to the page while the tale is being updated', async () => {
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        await answerRead(VISIBLE);
        publishButton().click();
        await settle(fixture);
        const update = http.expectOne(`${url}/publish`);
        window.dispatchEvent(new Event('focus'));
        http.expectNone(url);
        http.expectNone(taleRead);
        update.flush({ document: three, revision: 3, published: { document: three, revision: 1 } });
        await settle(fixture);
        // Editing is free again before the tale is read and the update said.
        expect(root.querySelector('#studio-update')?.getAttribute('aria-disabled')).toBe('true');
        expect(status()).toBe('All changes saved');
        await answerRead(VISIBLE);
        expect(live()).toBe('Tale updated. Visitors now see this version.');
      });

      const stale = { error: { code: 'stale_revision', message: 'stale' } };
      const conflict = { status: 409, statusText: 'Conflict' };

      it('offers reload or keep-as-copy when updating finds a newer draft elsewhere', async () => {
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        publishButton().click();
        await settle(fixture);
        http.expectOne(`${url}/publish`).flush(stale, conflict);
        await settle(fixture);
        // It reads what is there now: the draft moved on, so it is a real conflict.
        http
          .expectOne(url)
          .flush(draftRead({ document: three, revision: 4, published: { document: null, revision: 0 } }));
        await settle(fixture);
        expect(alertText()).toContain('Someone saved this tale after you opened it');
        expect(buttonNamed(root, 'Keep my version as a new tale')).toBeTruthy();
      });

      it('updates again with the fresh site revision when only that moved (shown from the zone page)', async () => {
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        publishButton().click();
        await settle(fixture);
        const save = http.expectOne(url);
        const draft = (save.request.body as { document: TaleDocument }).document;
        save.flush({ document: draft, revision: 4, published: { document: null, revision: 0 } });
        await settle(fixture);
        http.expectOne(`${url}/publish`).flush(stale, conflict);
        await settle(fixture);
        // The tale went live from the zone page, which published the draft at revision 3.
        http
          .expectOne(url)
          .flush(draftRead({ document: draft, revision: 4, published: { document: three, revision: 1 } }));
        await settle(fixture);
        const retry = http.expectOne(`${url}/publish`);
        expect(retry.request.body).toEqual({ revision: 4, publishedRevision: 1 });
        retry.flush({ document: draft, revision: 4, published: { document: draft, revision: 2 } });
        await settle(fixture);
        await settle(fixture);
        expect(alertText()).toBe('');
        expect(publishState()).toBe('Visible on site · up to date');
      });

      it('keeps edits made while updating, saving them after it on the same draft revision', async () => {
        await open({ document: three, revision: 3, published: { document: null, revision: 0 } });
        publishButton().click();
        await settle(fixture);
        const publish = http.expectOne(`${url}/publish`);
        // An edit while the publish is on its way: no save goes out meanwhile.
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        expect(fixture.componentInstance.canLeave).toBeDefined();
        http.expectNone(url);
        publish.flush({ document: three, revision: 3, published: { document: three, revision: 1 } });
        await settle(fixture);
        expect(status()).toBe('Unsaved changes');
        expect(publishState()).toBe('Visible on site · changes not updated yet');
        const after = await saveNow(4);
        expect(after.revision).toBe(3);
      });

      it('discards the changes after asking, back to the version on the site, and undo brings them back', async () => {
        const published = { ...three, canvas: { background: { type: 'color', color: '#ffffff' } } } as TaleDocument;
        await open({ document: three, revision: 5, published: { document: published, revision: 2 } });
        discardButton().click();
        await settle(fixture);
        expect(window.confirm).toHaveBeenCalledWith(
          'Discard your changes and go back to the version on the site? You can undo this until you leave Tale Studio.',
        );
        http.expectNone(`${url}/discard`);

        vi.mocked(window.confirm).mockReturnValue(true);
        discardButton().click();
        await settle(fixture);
        const discard = http.expectOne(`${url}/discard`);
        // Editing is held while the draft is discarded.
        key(canvasEl(1), 'ArrowDown');
        await settle(fixture);
        expect(live()).toBe('Wait until the changes are discarded.');
        expect(docNow()).toBe(JSON.stringify(three));
        expect(discard.request.body).toEqual({ revision: 5, publishedRevision: 2 });
        discard.flush({ document: published, revision: 6, published: { document: published, revision: 2 } });
        await settle(fixture);
        await settle(fixture);
        expect(docNow()).toBe(JSON.stringify(published));
        expect(publishState()).toBe('Visible on site · up to date');
        expect(live()).toBe('Changes discarded: the version on the site is back. Press Ctrl+Z to undo.');
        expect(status()).toBe('All changes saved');

        undoButton().click();
        await settle(fixture);
        expect(docNow()).toBe(JSON.stringify(three));
        expect(status()).toBe('Unsaved changes');
        const restored = await saveNow(7);
        expect(restored.revision).toBe(6);
        expect(JSON.stringify(restored.document)).toBe(JSON.stringify(three));
      });
    });

    it('shows a refused save again when undo brings the refused content back, without sending it', async () => {
      await open({ document: three, revision: 1 });
      key(canvasEl(1), 'ArrowDown');
      void fixture.componentInstance.canLeave();
      await settle(fixture);
      http
        .expectOne(url)
        .flush(
          { error: { code: 'invalid_tale_document', message: 'bad', pointer: '/elements/0/props/text' } },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle(fixture);
      expect(canvasEl(1).getAttribute('aria-invalid')).toBe('true');
      key(canvasEl(1), 'ArrowDown');
      await settle(fixture);
      expect(status()).toBe('Unsaved changes');
      undoButton().click();
      await settle(fixture);
      expect(status()).toBe('Not saved');
      expect(root.querySelector('#studio-save-problem')?.textContent).toContain('A text could not be saved');
      expect(canvasEl(1).getAttribute('aria-invalid')).toBe('true');
      // Leaving treats it as not saved and asks; it is not sent again by itself.
      expect(await fixture.componentInstance.canLeave()).toBe(false);
      expect(window.confirm).toHaveBeenCalled();
      http.expectNone(url);
    });

    it('guards the studio route with the page’s leave check', async () => {
      const studio = appRoutes
        .flatMap((r) => [r, ...(r.children ?? [])])
        .find((r) => r.path === 'tales/:taleId/studio');
      const guard = studio?.canDeactivate?.[0] as (page: { canLeave(): Promise<boolean> }) => Promise<boolean>;
      const page = { canLeave: vi.fn(async () => false) };
      expect(await guard(page)).toBe(false);
      expect(page.canLeave).toHaveBeenCalledTimes(1);
    });

    describe('with autosave timing', () => {
      beforeEach(() => Object.assign(timing, { debounceMs: 20, maxWaitMs: 200, retryDelaysMs: [40] }));
      afterEach(() => {
        vi.useRealTimers();
        Object.assign(timing, WAIT_FOR_TEST);
      });

      // Autosave's timers run on a fake clock here (and Date, for "Trying again in N s"): each step
      // moves it by exactly the time it names. On the real clock a busy machine could let the 20 ms
      // debounce or the 40 ms retry fire between two checks, so "Unsaved changes" or "Not saved" read
      // "Saving…" (the flaky autosave-timing test of the story 7.12 report).
      async function openOnClock(read: Parameters<typeof draftRead>[0]): Promise<void> {
        await open(read);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      }
      // Moves the fake clock by `ms`, running the timers that fall due and the promises after them, then renders.
      async function advance(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
        fixture.detectChanges();
      }

      it('saves by itself after a pause, one save at a time, and shows saving and saved', async () => {
        await openOnClock({ document: three, revision: 1 });
        expect(status()).toBe('All changes saved');
        key(canvasEl(1), 'ArrowDown');
        await advance(0);
        expect(status()).toBe('Unsaved changes');
        // The save starts exactly when the debounce ends, and not a millisecond before.
        await advance(19);
        expect(status()).toBe('Unsaved changes');
        http.expectNone(url);
        await advance(1);
        expect(status()).toBe('Saving…');
        const first = http.expectOne(url);
        expect((first.request.body as { revision: number }).revision).toBe(1);
        key(canvasEl(1), 'ArrowDown');
        await advance(40);
        // No second save while the first is on its way.
        http.expectNone(url);
        first.flush({ document: three, revision: 2 });
        await advance(0);
        const second = http.expectOne(url);
        expect((second.request.body as { revision: number }).revision).toBe(2);
        expect(JSON.stringify((second.request.body as { document: TaleDocument }).document)).toBe(docNow());
        second.flush({ document: three, revision: 3 });
        await advance(0);
        expect(status()).toBe('All changes saved');
      });

      it('shows a failed save, retries it by itself, and says when everything is saved again', async () => {
        await openOnClock({ document: three, revision: 1 });
        key(canvasEl(1), 'ArrowDown');
        await advance(40);
        http.expectOne(url).error(new ProgressEvent('error'));
        await advance(0);
        expect(status()).toBe('Not saved');
        expect(alertText()).toContain('the connection failed. Trying again automatically.');
        expect(buttonNamed(root, 'Retry now')).toBeTruthy();
        // The retry goes out after its 40 ms delay, not before.
        await advance(39);
        http.expectNone(url);
        expect(status()).toBe('Not saved');
        await advance(1);
        http.expectOne(url).flush({ document: three, revision: 2 });
        await advance(0);
        await advance(0);
        expect(status()).toBe('All changes saved');
        expect(alertText()).toBe('');
        expect(live()).toBe('All changes saved');
      });

      it('keeps one failure block and one announcement through the retries, with Retry now staying put', async () => {
        await openOnClock({ document: three, revision: 1 });
        key(canvasEl(1), 'ArrowDown');
        await advance(40);
        http.expectOne(url).error(new ProgressEvent('error'));
        await advance(0);
        const retry = root.querySelector('#studio-retry') as HTMLButtonElement;
        const alertRegion = () => root.querySelector('p.visually-hidden[role=alert]')?.textContent?.trim();
        const first = alertRegion();
        expect(first).toContain('the connection failed');
        expect(root.querySelector('#studio-save-problem')?.hasAttribute('role')).toBe(false);
        expect(root.querySelector('.studio-retry')?.textContent).toMatch(/Trying again (in \d+ s|now)/);
        retry.focus();
        await advance(40);
        // The retry is on its way: the same button, kept focused, and not pressable.
        expect(root.querySelector('#studio-retry')).toBe(retry);
        expect(retry.getAttribute('aria-disabled')).toBe('true');
        expect(document.activeElement).toBe(retry);
        http
          .expectOne(url)
          .flush({ error: { code: 'internal_error', message: 'x' } }, { status: 503, statusText: 'Down' });
        await advance(0);
        expect(root.querySelector('#studio-retry')).toBe(retry);
        expect(alertRegion()).toBe(first);
        await advance(60);
        http.expectOne(url).flush(draftRead({ document: three, revision: 2 }));
        await advance(0);
        await advance(0);
        expect(alertRegion()).toBe('');
        expect(root.querySelector('#studio-retry')).toBeNull();
        expect(live()).toBe('All changes saved');
      });

      it('retries at once when the browser is back online', async () => {
        await openOnClock({ document: three, revision: 1 });
        key(canvasEl(1), 'ArrowDown');
        await advance(40);
        http.expectOne(url).error(new ProgressEvent('error'));
        await advance(0);
        window.dispatchEvent(new Event('online'));
        http.expectOne(url).flush({ document: three, revision: 2 });
        await advance(0);
        expect(status()).toBe('All changes saved');
      });
    });
  });

  describe('text style (story 7.4)', () => {
    const sans = SYSTEM_FONT_STACKS.sans;
    const serif = SYSTEM_FONT_STACKS.serif;
    const live = () => root.querySelector('[aria-live=polite]')?.textContent;
    const field = <T extends HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
    const canvasText = () => elements()[0];
    const glyphs = () => canvasText().querySelector('.el__glyphs') as HTMLElement;
    const contrast = () => root.querySelector('#ts-contrast')?.textContent?.trim();

    // Sets a field's value and fires its change event, as a person picking or typing and leaving it.
    async function set(id: string, value: string): Promise<void> {
      const control = field<HTMLInputElement | HTMLSelectElement>(id);
      control.value = value;
      control.dispatchEvent(new Event('change'));
      await settle(fixture);
    }

    async function openSelected(
      props: Record<string, unknown> = {},
      themeFont: string | null = null,
      fonts: ProjectFont[] = [],
    ): Promise<void> {
      const element = { ...existing.elements[0], props: { text: 'Hi', ...props } };
      await open({ document: { ...existing, elements: [element] } as TaleDocument, revision: 1 }, themeFont, fonts);
      canvasText().click();
      await settle(fixture);
    }

    describe('project fonts (story 7.17)', () => {
      const brand: ProjectFont = {
        id: '0f0e0d0c-0000-4000-8000-00000000000a',
        projectId: 'p1',
        family: 'Brand Sans',
        weight: 600,
        style: 'italic',
        fallback: 'serif',
        sizeBytes: 2048,
        licenceConfirmedBy: { id: 'u1', name: 'Ada' },
        licenceConfirmedAt: '2026-10-22T10:00:00.000Z',
        inUse: false,
      };

      it("offers the project's fonts and sets one as one undoable step, with its fallback, weight and style", async () => {
        await openSelected({}, null, [brand]);
        const select = field<HTMLSelectElement>('ts-font');
        const group = select.querySelector('optgroup') as HTMLOptGroupElement;
        expect(group.label).toBe('Project fonts');
        expect(group.querySelector('option')?.textContent?.trim()).toBe('Brand Sans Semibold italic');
        await set('ts-font', `project:${brand.id}`);
        // Drawn under its alias, never its family name, then the fallback until the face loads.
        expect(canvasText().style.fontFamily).toContain(`taleart-font-${brand.id}`);
        expect(canvasText().style.fontFamily).toContain('Georgia');
        expect(canvasText().style.fontFamily).not.toContain('Brand');
        expect(live()).toBe('Font set to Brand Sans Semibold italic');
        expect(root.querySelector('#ts-project-hint')?.textContent).toContain('3 seconds');
        expect(field<HTMLSelectElement>('ts-fallback').value).toBe('serif');
        expect(root.querySelector('a.text-style__link')?.getAttribute('href')).toBe('/projects/p1/fonts');
        const saved = await saveNow(2);
        expect(saved.document.elements[0].props).toEqual({
          text: 'Hi',
          font: { source: 'project', fontId: brand.id },
          fallback: 'serif',
          weight: 'bold',
          italic: true,
        });
        (root.querySelector('#studio-undo') as HTMLButtonElement).click();
        await settle(fixture);
        expect(canvasText().style.fontFamily).toBe(sans);
        await saveNow(3);
      });

      it('keeps showing a project font the list does not hold', async () => {
        await openSelected({ font: { source: 'project', fontId: brand.id }, fallback: 'rounded' });
        const select = field<HTMLSelectElement>('ts-font');
        expect(select.value).toBe(`project:${brand.id}`);
        expect(select.selectedOptions[0].textContent?.trim()).toBe("Project font (not in this project's list)");
        expect(canvasText().style.fontFamily).toContain(`taleart-font-${brand.id}`);
      });

      it('ties weight and italic to the chosen face, so it is never synthesised, and says so', async () => {
        await openSelected({ font: { source: 'project', fontId: brand.id }, weight: 'bold', italic: true }, null, [
          brand,
        ]);
        const weight = field<HTMLSelectElement>('ts-weight');
        const italic = field<HTMLInputElement>('ts-italic');
        expect(weight.disabled).toBe(true);
        expect(italic.disabled).toBe(true);
        expect(weight.getAttribute('aria-describedby')).toBe('ts-face-hint');
        expect(root.querySelector('#ts-face-hint')?.textContent).toContain('Semibold italic');
        // Back on a system font, both are free again.
        await set('ts-font', 'serif');
        expect(field<HTMLSelectElement>('ts-weight').disabled).toBe(false);
        expect(root.querySelector('#ts-face-hint')).toBeNull();
        await saveNow(2);
      });

      it('fetches a face that failed once per page while it is edited, not on every edit', async () => {
        clearProjectFontLoads();
        const fetchFont = vi.fn(async () => Promise.reject(new Error('offline')));
        vi.stubGlobal('fetch', fetchFont);
        vi.stubGlobal(
          'FontFace',
          class {
            async load() {
              return this;
            }
          },
        );
        Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn() } });
        try {
          await openSelected({ font: { source: 'project', fontId: brand.id } }, null, [brand]);
          await set('ts-size', 'large');
          await set('ts-size', 'small');
          await set('ts-size', 'medium');
          expect(fetchFont).toHaveBeenCalledTimes(1);
          expect(fetchFont).toHaveBeenCalledWith(
            `/api/v1/projects/p1/fonts/${brand.id}/file`,
            expect.objectContaining({ credentials: 'same-origin' }),
          );
          await saveNow(2);
        } finally {
          vi.unstubAllGlobals();
          delete (document as { fonts?: unknown }).fonts;
          clearProjectFontLoads();
        }
      });
    });

    it('shows a text without style as before, and the inspector its defaults', async () => {
      await openSelected();
      const el = canvasText();
      expect(el.style.fontFamily).toBe(sans);
      expect(el.style.fontSize).toBe('4cqh');
      // A text stored before styling keeps its weight of 600; the select says so.
      expect(el.style.fontWeight).toBe('600');
      expect(field<HTMLSelectElement>('ts-weight').selectedOptions[0].textContent?.trim()).toBe('Semibold (as before)');
      expect(el.getAttribute('dir')).toBe('auto');
      expect(field<HTMLSelectElement>('ts-font').value).toBe('sans');
      expect(field<HTMLSelectElement>('ts-size').value).toBe('medium');
      expect(field<HTMLSelectElement>('ts-direction').value).toBe('auto');
      expect(field<HTMLInputElement>('ts-align-center').checked).toBe(true);
    });

    it('names every control and groups them', async () => {
      await openSelected({ font: { source: 'name', family: 'Inter' }, background: 'box', size: 0.05 });
      const inspector = root.querySelector('app-tale-text-style') as HTMLElement;
      const controls = [...inspector.querySelectorAll<HTMLElement>('input, select')];
      expect(controls.length).toBeGreaterThan(12);
      for (const control of controls) {
        const label = control.closest('label') ?? inspector.querySelector(`label[for="${control.id}"]`);
        expect(label?.textContent?.trim(), control.id).toBeTruthy();
      }
      const legends = [...inspector.querySelectorAll('legend')].map((l) => l.textContent?.trim());
      expect(legends).toEqual(['Text style', 'Font and size', 'Colour', 'Alignment and direction', 'Background']);
      // The direction is chosen inside the alignment group.
      expect(field('ts-direction').closest('fieldset')?.querySelector('legend')?.textContent?.trim()).toBe(
        'Alignment and direction',
      );
    });

    it('sets a system font as one undoable step, saved to the draft', async () => {
      await openSelected();
      await set('ts-font', 'serif');
      expect(canvasText().style.fontFamily).toBe(serif);
      expect(live()).toBe('Font set to Serif');
      const saved = await saveNow(2);
      expect(saved.document.elements[0].props).toEqual({ text: 'Hi', font: { source: 'system', stack: 'serif' } });
      (root.querySelector('#studio-undo') as HTMLButtonElement).click();
      await settle(fixture);
      expect(canvasText().style.fontFamily).toBe(sans);
      expect(live()).toBe('Undone: Font changed');
      await saveNow(3);
    });

    it("uses the project theme's font with the fallback, or the fallback when the theme sets none", async () => {
      await openSelected({ font: { source: 'theme' }, fallback: 'serif' }, 'Georgia, serif');
      expect(canvasText().style.fontFamily).toBe(`"Georgia", serif, ${serif}`);
      expect(root.querySelector('#ts-theme-hint')?.textContent).toContain('Georgia, serif');
      fixture.destroy();
      await openSelected({ font: { source: 'theme' } }, null);
      expect(canvasText().style.fontFamily).toBe(sans);
      expect(root.querySelector('#ts-theme-hint')?.textContent).toContain('sets no font');
    });

    it('applies a font name the page loads, and refuses inherit or CSS in it', async () => {
      await openSelected();
      await set('ts-font', 'name');
      // Nothing changes until a valid name is typed; the choice says what to do next.
      expect(canvasText().style.fontFamily).toBe(sans);
      expect(live()).toBe('Type a font name the page loads, then leave the field to apply it.');
      await set('ts-family', 'inherit');
      const family = field<HTMLInputElement>('ts-family');
      expect(family.getAttribute('aria-invalid')).toBe('true');
      expect(root.querySelector('#ts-family-error')?.textContent).toContain('not changed');
      await set('ts-family', 'x;color:red');
      expect(family.getAttribute('aria-invalid')).toBe('true');
      expect(canvasText().style.fontFamily).toBe(sans);
      await set('ts-family', ' Source Sans 3 ');
      expect(family.hasAttribute('aria-invalid')).toBe(false);
      // Quoted, so a name CSS refuses bare still applies.
      expect(canvasText().style.fontFamily).toBe(`"Source Sans 3", ${sans}`);
      await set('ts-fallback', 'serif');
      expect(canvasText().style.fontFamily).toBe(`"Source Sans 3", ${serif}`);
      const saved = await saveNow(2);
      expect(saved.document.elements[0].props).toMatchObject({
        font: { source: 'name', family: 'Source Sans 3' },
        fallback: 'serif',
      });
    });

    it('sets a size preset or a custom size, refusing one out of range', async () => {
      await openSelected();
      await set('ts-size', 'large');
      expect(canvasText().style.fontSize).toBe('6cqh');
      await set('ts-size', 'custom');
      expect(live()).toBe('Type a custom size in % of the canvas height, then leave the field to apply it.');
      await set('ts-size-custom', '25');
      expect(field<HTMLInputElement>('ts-size-custom').getAttribute('aria-invalid')).toBe('true');
      expect(canvasText().style.fontSize).toBe('6cqh');
      await set('ts-size-custom', '0.5');
      expect(canvasText().style.fontSize).toBe('6cqh');
      await set('ts-size-custom', '12');
      expect(canvasText().style.fontSize).toBe('12cqh');
      expect(live()).toBe('Size set to 12 % of the canvas height');
      expect((await saveNow(2)).document.elements[0].props).toMatchObject({ size: 0.12 });
    });

    it('sets the weight, italic, line height and colour, refusing a colour with CSS in it', async () => {
      await openSelected();
      await set('ts-weight', 'regular');
      expect(canvasText().style.fontWeight).toBe('400');
      const italic = field<HTMLInputElement>('ts-italic');
      italic.click();
      await settle(fixture);
      expect(canvasText().style.fontStyle).toBe('italic');
      await set('ts-line-height', '4');
      expect(field<HTMLInputElement>('ts-line-height').getAttribute('aria-invalid')).toBe('true');
      await set('ts-line-height', '1.6');
      expect(canvasText().style.lineHeight).toBe('1.6');
      await set('ts-color-hex', 'red; background:url(x)');
      expect(field<HTMLInputElement>('ts-color-hex').getAttribute('aria-invalid')).toBe('true');
      expect(canvasText().style.color).toBe('rgb(255, 255, 255)');
      await set('ts-color-hex', 'ff0000cc');
      expect(canvasText().style.color).toBe('rgba(255, 0, 0, 0.8)');
      await set('ts-color', '#00ff00');
      // The picker keeps the colour's transparency.
      expect((await saveNow(2)).document.elements[0].props).toMatchObject({
        weight: 'regular',
        italic: true,
        lineHeight: 1.6,
        color: '#00ff00cc',
      });
    });

    it('aligns to the start, which follows the direction, and sets the direction', async () => {
      await openSelected({}, null);
      field<HTMLInputElement>('ts-align-start').click();
      await settle(fixture);
      expect(canvasText().style.textAlign).toBe('start');
      await set('ts-direction', 'rtl');
      expect(canvasText().getAttribute('dir')).toBe('rtl');
      await set('ts-direction', 'ltr');
      expect(canvasText().getAttribute('dir')).toBe('ltr');
      expect((await saveNow(2)).document.elements[0].props).toMatchObject({ align: 'start', direction: 'ltr' });
    });

    it('draws a solid box on the element or a highlight behind each line', async () => {
      await openSelected();
      await set('ts-background', 'box');
      expect(canvasText().style.backgroundColor).toBe('rgb(0, 0, 0)');
      await set('ts-bg-hex', '#ffcc00');
      expect(canvasText().style.backgroundColor).toBe('rgb(255, 204, 0)');
      await set('ts-background', 'highlight');
      expect(canvasText().style.backgroundColor).toBe('');
      expect(glyphs().style.backgroundColor).toBe('rgb(255, 204, 0)');
      expect(glyphs().classList.contains('is-highlight')).toBe(true);
      expect((await saveNow(2)).document.elements[0].props).toMatchObject({
        background: 'highlight',
        backgroundColor: '#ffcc00',
      });
    });

    it('warns about low contrast, and says when it cannot check over media, never blocking a save', async () => {
      // Over the tale's media (R16), its bottom layer.
      const element = { ...existing.elements[0], props: { text: 'Hi' } };
      await open({ document: { ...existing, elements: [OWN_MEDIA, element] } as TaleDocument, revision: 1 });
      (root.querySelector(`#studio-el-${element.id}`) as HTMLElement).click();
      await settle(fixture);
      expect(contrast()).toContain("can't be checked over media");
      await set('ts-background', 'box');
      expect(contrast()).toContain('Contrast 21.0:1');
      await set('ts-bg-hex', '#ffff00');
      // Rounded down (1.07 reads 1.0), so a ratio just under its minimum never reads as the minimum.
      expect(contrast()).toMatch(/^Low contrast: 1\.0:1 against its box/);
      expect(root.querySelector(`#layer-state-${existing.elements[0].id}`)?.textContent).toContain('Low contrast');
      // The contrast line is not live; the change that turned the warning on says so.
      expect(root.querySelector('#ts-contrast')?.hasAttribute('role')).toBe(false);
      expect(live()).toBe('Background colour set to #ffff00 Low contrast: see the warning under the text style.');
      await set('ts-bg-hex', '#000000');
      expect(live()).toBe('Background colour set to #000000 Contrast is enough now.');
      await set('ts-bg-hex', '#ffff00');
      expect((await saveNow(2)).document.elements[1].props).toMatchObject({ backgroundColor: '#ffff00' });
    });

    it('checks against the canvas colour when the tale has no media', async () => {
      const store = TestBed.inject(DashboardStore);
      store.taleGroups.set({ z1: [{ ...group, tales: [{ ...tale, media: null }] } as unknown as ZoneTaleGroup] });
      await openSelected({ color: '#111111' });
      expect(contrast()).toMatch(/^Low contrast: .* against the canvas colour/);
    });

    it('rounds contrast ratios down', () => {
      expect(ratioText(4.4999)).toBe('4.4');
      expect(ratioText(4.5)).toBe('4.5');
      expect(ratioText(21)).toBe('21.0');
    });

    it('announces only a change that made a step', async () => {
      await openSelected({ weight: 'regular' });
      await set('ts-weight', 'bold');
      expect(live()).toBe('Weight set to Bold');
      await set('ts-direction', 'rtl');
      expect(live()).toBe('Direction set to right to left');
      // The same value again is no step and is not announced.
      (fixture.componentInstance as unknown as { announcement: { set(v: string): void } }).announcement.set('');
      await set('ts-direction', 'rtl');
      expect(live()).toBe('');
      expect((root.querySelector('#studio-undo') as HTMLButtonElement).title).toContain('Text direction changed');
      await saveNow(2);
    });

    it('draws the box or highlight and its padding in the in-place editor too, so the text does not move', async () => {
      await openSelected({ background: 'box', backgroundColor: '#112233' });
      expect(canvasText().style.paddingInline).toBe('0.5em');
      key(canvasText(), 'Enter');
      await settle(fixture);
      const editor = root.querySelector('textarea.el-edit') as HTMLTextAreaElement;
      expect(editor.style.backgroundColor).toBe('rgb(17, 34, 51)');
      expect(editor.style.paddingInline).toBe('0.5em');
      fixture.destroy();
      await openSelected({ background: 'highlight', backgroundColor: '#ffcc00' });
      expect(glyphs().style.paddingInline).toBe('0.25em');
      key(canvasText(), 'Enter');
      await settle(fixture);
      const highlighted = root.querySelector('textarea.el-edit') as HTMLTextAreaElement;
      expect(highlighted.style.backgroundColor).toBe('rgb(255, 204, 0)');
      expect(highlighted.style.paddingInline).toBe('0.25em');
    });

    it('rewrites a refused hex field when a colour is picked, even the same colour', async () => {
      await openSelected();
      await set('ts-color-hex', 'nope');
      const hex = field<HTMLInputElement>('ts-color-hex');
      expect(hex.getAttribute('aria-invalid')).toBe('true');
      await set('ts-color', '#ffffff');
      expect(hex.value).toBe('#ffffff');
      expect(hex.hasAttribute('aria-invalid')).toBe(false);
      await set('ts-background', 'box');
      await set('ts-bg-hex', 'red; background:url(x)');
      const bgHex = field<HTMLInputElement>('ts-bg-hex');
      expect(bgHex.getAttribute('aria-invalid')).toBe('true');
      await set('ts-bg-color', '#336699');
      expect(bgHex.value).toBe('#336699');
      expect(bgHex.hasAttribute('aria-invalid')).toBe(false);
      await saveNow(2);
    });

    it('keeps a locked layer’s style as it is', async () => {
      await openSelected();
      const element = { ...existing.elements[0], locked: true, props: { text: 'Hi' } };
      fixture.destroy();
      await open({ document: { ...existing, elements: [element] } as TaleDocument, revision: 1 });
      canvasText().click();
      await settle(fixture);
      expect((root.querySelector('fieldset.text-style') as HTMLFieldSetElement).disabled).toBe(true);
    });
  });

  describe('the five regions (Tale Studio 2, story 11.1)', () => {
    const active = () => document.activeElement as HTMLElement | null;
    const f6 = (back = false) => {
      const event = new KeyboardEvent('keydown', { key: 'F6', shiftKey: back, bubbles: true, cancelable: true });
      (active() ?? document.body).dispatchEvent(event);
      return event;
    };
    const textId = existing.elements[0].id;

    it('lays the studio out in five labelled regions, in focus order, each with a heading', async () => {
      await open({ document: existing, revision: 1 });
      const regions = [...root.querySelectorAll<HTMLElement>('[data-region]')];
      expect(regions.map((r) => r.dataset['region'])).toEqual(['top', 'left', 'canvas', 'inspector', 'strip']);
      expect(regions.map((r) => r.tagName.toLowerCase())).toEqual(['section', 'aside', 'section', 'aside', 'nav']);
      expect(regions[0].getAttribute('aria-labelledby')).toBe('studio-title');
      expect(root.querySelector('#studio-title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Tale 1 · Beach');
      expect(regions[1].getAttribute('aria-label')).toBe('Add and layers');
      expect(regions[3].getAttribute('aria-label')).toBe('Properties');
      expect(root.querySelector('#studio-strip-title')?.textContent).toBe('Tales in Summer');
      expect(regions.map((r) => r.querySelector('h2')?.textContent?.trim().split(/\s+/)[0])).toEqual([
        'Tale',
        'Elements',
        'Canvas',
        'Tale',
        'Tales',
      ]);
    });

    it('moves between the regions with F6 and back with Shift+F6, wrapping, onto a useful control in each', async () => {
      await open({ document: existing, revision: 1 });
      (root.querySelector('#studio-undo') as HTMLElement).focus();
      expect(f6().defaultPrevented).toBe(true);
      expect(active()?.id).toBe('studio-tab-elements');
      f6();
      // Nothing selected: the canvas itself.
      expect(active()?.id).toBe('studio-canvas');
      f6();
      // The inspector's heading, which says what it edits.
      expect(active()?.id).toBe('inspector-title');
      expect(active()?.textContent?.trim()).toBe('Tale');
      f6();
      expect(active()?.getAttribute('aria-current')).toBe('page');
      expect(active()?.getAttribute('href')).toBe('/tales/t1/studio');
      f6();
      expect(active()?.id).toBe('studio-back');
      f6(true);
      expect(active()?.getAttribute('aria-current')).toBe('page');
      // With an element selected, F6 lands on it on the canvas.
      (root.querySelector(`#studio-el-${textId}`) as HTMLElement).click();
      await settle(fixture);
      (root.querySelector('#studio-tab-elements') as HTMLElement).focus();
      f6();
      expect(active()?.id).toBe(`studio-el-${textId}`);
      f6(true);
      expect(active()?.id).toBe('studio-tab-elements');
    });

    it('leaves F6 alone while the tale menu is open: focus stays in it and it stays open', async () => {
      await open({ document: existing, revision: 1 });
      const item = menuItem('studio-discard');
      await settle(fixture);
      item.focus();
      expect(f6().defaultPrevented).toBe(false);
      expect(f6(true).defaultPrevented).toBe(false);
      expect(active()).toBe(item);
      expect(root.querySelector('#studio-menu-list')).not.toBeNull();
    });

    it('leaves F6 to an open menu, and to keys with Ctrl, Alt or Cmd', async () => {
      await open({ document: existing, revision: 1 });
      root.querySelector<HTMLButtonElement>(`#layer-more-${textId}`)?.click();
      await settle(fixture);
      expect(root.querySelector('[role=menu]')).not.toBeNull();
      expect(f6().defaultPrevented).toBe(false);
      const ctrl = new KeyboardEvent('keydown', { key: 'F6', ctrlKey: true, bubbles: true, cancelable: true });
      document.body.dispatchEvent(ctrl);
      expect(ctrl.defaultPrevented).toBe(false);
    });

    it('shows one tab panel at a time; the rail is one tab stop and the arrows, Home and End move and select', async () => {
      await open({ document: existing, revision: 1 });
      const tabs = [...root.querySelectorAll<HTMLElement>('[role=tab]')];
      expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Elements', 'Templates', 'Media', 'Layers']);
      const tablist = root.querySelector('[role=tablist]');
      expect(tablist?.getAttribute('aria-orientation')).toBe('vertical');
      expect(tablist?.getAttribute('aria-label')).toBe('Left panel tabs');
      const shown = () => [...root.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id);
      expect(shown()).toEqual(['studio-panel-elements']);
      expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
      tabs[0].focus();
      key(tabs[0], 'ArrowUp');
      await settle(fixture);
      expect(active()?.id).toBe('studio-tab-layers');
      expect(shown()).toEqual(['studio-panel-layers']);
      expect(tabs[3].getAttribute('aria-selected')).toBe('true');
      expect(root.querySelector('[role=grid]')?.getAttribute('aria-labelledby')).toBe('layers-title');
      key(tabs[3], 'Home');
      await settle(fixture);
      expect(active()?.id).toBe('studio-tab-elements');
      key(tabs[0], 'ArrowDown');
      await settle(fixture);
      expect(shown()).toEqual(['studio-panel-templates']);
      expect(root.querySelector('#studio-panel-templates')?.textContent).toContain('Coming soon');
      tabs[2].click();
      await settle(fixture);
      expect(shown()).toEqual(['studio-panel-media']);
      expect(root.querySelector('#studio-panel-media')?.textContent).toContain('Image, Video and Sticker tiles');
    });

    it('shows the Add entries as tiles named "Add …" that show the type alone', async () => {
      await open({ document: existing, revision: 1 });
      const tile = root.querySelector('#studio-add-swipe-up') as HTMLElement;
      expect(tile.classList.contains('tile')).toBe(true);
      expect(tile.textContent?.trim()).toBe('Add swipe-up link');
      expect(tile.querySelector('.visually-hidden')?.textContent).toBe('Add ');
      expect(tile.querySelector('.tile__word')?.textContent).toBe('swipe-up link');
    });

    it('opens the tale menu with the keyboard, moves in it, and closes it with Escape to its button', async () => {
      await open({ document: existing, revision: 1 });
      const button = root.querySelector('#studio-menu') as HTMLButtonElement;
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      expect(button.getAttribute('aria-label')).toBe('Tale actions');
      button.focus();
      key(button, 'ArrowDown');
      await settle(fixture);
      const items = () => [...root.querySelectorAll<HTMLElement>('#studio-menu-list [role=menuitem]')];
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(items().map((i) => i.id)).toEqual(['studio-discard', 'studio-duplicate', 'studio-help-button']);
      expect(active()?.id).toBe('studio-discard');
      key(items()[0], 'ArrowUp');
      expect(active()?.id).toBe('studio-help-button');
      key(items()[2], 'Home');
      expect(active()?.id).toBe('studio-discard');
      key(items()[0], 'End');
      expect(active()?.id).toBe('studio-help-button');
      key(items()[2], 'Escape');
      await settle(fixture);
      expect(root.querySelector('#studio-menu-list')).toBeNull();
      expect(active()).toBe(button);
      // Up opens it on its last item.
      key(button, 'ArrowUp');
      await settle(fixture);
      expect(active()?.id).toBe('studio-help-button');
    });

    it('keeps Discard changes in the menu when there is nothing to discard, saying why', async () => {
      await open({ document: existing, revision: 1 });
      const discard = menuItem('studio-discard');
      expect(discard.getAttribute('aria-disabled')).toBe('true');
      expect(discard.getAttribute('aria-describedby')).toBe('studio-discard-why');
      expect(root.querySelector('#studio-discard-why')?.textContent).toBe('No changes: the tale matches the site.');
      discard.click();
      await settle(fixture);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(live()).toBe('No changes: the tale matches the site.');
      expect(window.confirm).not.toHaveBeenCalled();
    });

    it("lists the group's tales in order in the strip: the current one marked, a hidden one said so", async () => {
      const tales = [
        { ...tale, id: 't0', title: 'Dawn', position: 0, storedStatus: 'paused', status: 'paused' },
        { ...tale, position: 1 },
        { ...tale, id: 't2', title: 'Dusk', position: 2, media: null },
      ];
      TestBed.inject(DashboardStore).taleGroups.set({ z1: [{ ...group, tales } as unknown as ZoneTaleGroup] });
      await open({ document: existing, revision: 1 });
      const links = [...root.querySelectorAll<HTMLAnchorElement>('.studio-strip a')];
      expect(links.map((a) => a.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['1. Dawn, Hidden', '2. Beach', '3. Dusk']);
      expect(links.map((a) => a.getAttribute('href'))).toEqual(['/tales/t0/studio', '/tales/t1/studio', '/tales/t2/studio']);
      expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
      expect(root.querySelector('#studio-title')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Tale 2 · Beach');
      // The current tale's picture is its media; a tale without media shows a colour.
      expect(links[1].querySelector('img')?.getAttribute('src')).toContain('/api/v1/tales/t1/media');
      expect(links[2].querySelector('img')).toBeNull();
      expect(links[1].querySelector('img')?.getAttribute('loading')).toBe('lazy');
      expect(links[1].querySelector('img')?.getAttribute('decoding')).toBe('async');
      expect(root.querySelector('#studio-strip-title')?.getAttribute('title')).toBe('Tales in Summer');
      expect(root.querySelector('.strip-thumb__changed')).toBeNull();
    });

    it('opens the preview in the inspector’s place, and Close puts focus back on Preview', async () => {
      await open({ document: existing, revision: 1 });
      (root.querySelector('#studio-preview') as HTMLButtonElement).click();
      await settle(fixture);
      const inspector = root.querySelector('#studio-inspector') as HTMLElement;
      expect(inspector.getAttribute('aria-label')).toBe('Preview');
      expect(inspector.querySelector('#studio-preview-pane')).not.toBeNull();
      expect(inspector.querySelector('#studio-bg')).toBeNull();
      (root.querySelector('#studio-preview-close') as HTMLButtonElement).click();
      await settle(fixture);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(root.querySelector('#studio-preview-pane')).toBeNull();
      expect(active()?.id).toBe('studio-preview');
    });
  });

  describe('Duplicate (epic Tale Studio R11)', () => {
    let refresh: ReturnType<typeof vi.fn>;
    const dialog = () => document.querySelector('[role=dialog]') as HTMLElement | null;

    beforeEach(() => {
      const store = TestBed.inject(DashboardStore);
      store.projectTaleGroups.set({
        p1: [
          { id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 1, zoneIds: ['z1'] },
          { id: 'g2', projectId: 'p1', name: 'Winter', taleCount: 100, zoneIds: [] },
        ],
      } as unknown as ReturnType<typeof store.projectTaleGroups>);
      refresh = vi.spyOn(store, 'refresh').mockResolvedValue() as never;
    });

    // Adds a text (an unsaved change), presses Duplicate and answers the save that goes first.
    async function openDrawer(): Promise<HTMLElement> {
      await open({ document: existing, revision: 1 });
      buttonNamed(root, 'Add body text').click();
      await settle(fixture);
      menuItem('studio-duplicate').click();
      await settle(fixture);
      // The copy is made from what is saved: the unsaved change goes first, then the drawer opens.
      expect(dialog()).toBeNull();
      const save = http.expectOne(url);
      expect(save.request.method).toBe('PUT');
      save.flush({ document: save.request.body.document, revision: 2 });
      await settle(fixture);
      return dialog() as HTMLElement;
    }

    it('saves the latest changes first, duplicates into the chosen group, announces it and links to the copy', async () => {
      const drawer = await openDrawer();
      expect(drawer.querySelector('h2')?.textContent).toContain('Duplicate tale');
      expect(drawer.querySelector('select')?.value).toBe('g1');

      buttonNamed(drawer, 'Duplicate').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/duplicate`);
      expect(req.request.body).toEqual({ taleGroupId: 'g1' });
      req.flush({ ...tale, id: 't9', title: 'Beach (copy)', position: 1, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();

      expect(dialog()).toBeNull();
      const said = 'Duplicated as Beach (copy) in Summer. The copy is hidden until you show it.';
      expect(root.querySelector('[aria-live=polite]')?.textContent).toBe(said);
      const notice = root.querySelector('#studio-duplicated');
      expect(notice?.textContent).toContain(said);
      expect(notice?.querySelector('a')?.getAttribute('href')).toBe('/tales/t9/studio');
      expect(root.textContent).not.toContain('Publish');
      // No full reload: only the project's groups are read again, in the background.
      expect(refresh).not.toHaveBeenCalled();
      http.expectOne(`${API_BASE}/projects/p1/tale-groups`).flush([]);
    });

    it('keeps the drawer open on a refusal, never offers a full group, and returns focus to Duplicate', async () => {
      const drawer = await openDrawer();
      const options = [...drawer.querySelectorAll('option')].map((o) => [o.textContent?.trim(), o.disabled]);
      expect(options).toEqual([
        ['Summer (this group): 1 / 100', false],
        ['Winter: 100 / 100, full', true],
      ]);
      buttonNamed(drawer, 'Duplicate').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/duplicate`)
        .flush({ error: { code: 'tale_group_full', message: 'full' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      expect(drawer.querySelector('[role=alert]')?.textContent?.trim()).toBe(
        'Summer already holds 100 tales. Choose another tale group.',
      );
      buttonNamed(drawer, 'Duplicate').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/duplicate`)
        .flush({ error: { code: 'internal', message: 'boom' } }, { status: 500, statusText: 'Error' });
      await settle(fixture);
      expect(drawer.querySelector('[role=alert]')?.textContent?.trim()).toBe('The tale was not duplicated. Try again.');

      buttonNamed(drawer, 'Cancel').click();
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(document.activeElement?.id).toBe('studio-menu');
      expect(root.querySelector('#studio-duplicated')).toBeNull();
    });

    it('leaves undo and redo to the drawer while it is open', async () => {
      const drawer = await openDrawer();
      const before = elements().length;
      key(drawer.querySelector('select') as HTMLElement, 'z', { ctrlKey: true });
      key(drawer.querySelector('#duplicate-submit') as HTMLElement, 'z', { ctrlKey: true, shiftKey: true });
      await settle(fixture);
      expect(elements()).toHaveLength(before);
      http.expectNone(url);
    });

    it('says to wait while Update tale is running instead of doing nothing', async () => {
      await open({ document: existing, revision: 1 });
      buttonNamed(root, 'Add body text').click();
      await settle(fixture);
      (root.querySelector('#studio-update') as HTMLButtonElement).click();
      await settle(fixture);
      const save = http.expectOne(url);
      menuItem('studio-duplicate').click();
      await settle(fixture);
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
      expect(root.querySelector('[aria-live=polite]')?.textContent).toBe(
        'Wait until the tale is updated, then duplicate it.',
      );
      expect(dialog()).toBeNull();
      const draft = save.request.body.document;
      save.flush({ document: draft, revision: 2 });
      await settle(fixture);
      http.expectOne(`${url}/publish`).flush({ document: draft, revision: 2, published: { document: draft, revision: 2 } });
      await settle(fixture);
    });

    it('does not open while the latest changes cannot be saved', async () => {
      await open({ document: existing, revision: 1 });
      buttonNamed(root, 'Add body text').click();
      await settle(fixture);
      menuItem('studio-duplicate').click();
      await settle(fixture);
      http.expectOne(url).flush({ error: { code: 'internal', message: 'down' } }, { status: 500, statusText: 'Error' });
      await settle(fixture);
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(root.textContent).toContain('so the tale was not duplicated');
      http.expectNone(`${API_BASE}/tales/t1/duplicate`);
    });
  });
});
