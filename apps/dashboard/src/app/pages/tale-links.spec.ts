import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectMedia, ZoneTaleGroup } from '@taleart/contract/core';
import { SWIPE_UP_BOX, type TaleDocument, type TaleElement } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AUTOSAVE_TIMING } from './tale-autosave';
import { hrefMessage, needsLinkUrl } from './tale-links';
import { linkView } from './tale-canvas-view';
import { TaleStudioPage } from './tale-studio';

// Tale Studio story 7.7 (epic Tale Studio R7, R12, R13, R14): buttons, image buttons and the swipe-up link.
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
const JPG = 'media/0b7c9d4e-1111-4222-8333-944455556668.jpg';
const MP4 = 'media/0b7c9d4e-1111-4222-8333-944455556669.mp4';
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
const WAIT_FOR_TEST = { debounceMs: 3_600_000, maxWaitMs: 3_600_000, retryDelaysMs: [3_600_000] };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('link helpers', () => {
  it('says why an address is refused, with the rule the server applies', () => {
    expect(hrefMessage('https://example.com')).toBeNull();
    expect(hrefMessage('javascript:alert(1)')).toBe(
      'Only web addresses starting with http:// or https:// can be linked.',
    );
    expect(hrefMessage('ftp://example.com')).toBe(
      'Only web addresses starting with http:// or https:// can be linked.',
    );
    expect(hrefMessage('https://a b')).toBe('A web address may not hold spaces or control characters.');
    expect(hrefMessage('https://u:p@example.com')).toBe('A web address may not hold a user name or password.');
    expect(hrefMessage(`https://example.com/${'a'.repeat(2048)}`)).toBe(
      'A web address holds at most 2,048 characters.',
    );
    expect(needsLinkUrl({ props: {} })).toBe(true);
    expect(needsLinkUrl({ props: { href: 'https://example.com' } })).toBe(false);
  });

  it('draws a button and the swipe-up link as the SDK does', () => {
    const view = linkView({
      type: 'button',
      box: { x: 0, y: 0, w: 0.5, h: 0.07, rotation: 0 },
      props: { label: 'Go', variant: 'outline', color: '#ffffff', fill: '#ff0000', radius: 0.03 },
    });
    expect(view).toEqual({
      label: 'Go',
      color: '#ffffff',
      background: null,
      border: '0.4cqh solid #ff0000',
      radius: '3cqh',
      fontSize: '2.8cqh',
    });
    expect(
      linkView({ type: 'swipe-up', box: SWIPE_UP_BOX, props: { label: 'Up', color: '#fff', background: 'x' } }),
    ).toMatchObject({ label: 'Up', color: '#FFFFFF', background: '#000000B3', fontSize: '2.4cqh' });
  });
});

describe('Tale Studio links (epic Tale Studio R7)', () => {
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
  const type = async (selector: string, value: string) => {
    const field = q<HTMLInputElement>(selector);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  const click = async (selector: string) => {
    q<HTMLButtonElement>(selector).click();
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
    for (const read of http.match((r) => r.method === 'GET' && /\/tales\/[^/]+$/.test(r.url))) {
      read.flush({ visibility: { visible: true, reasons: [] } });
    }
    http.verify();
    globalThis.document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('adds a button, gives it an address and a new tab, and styles it, each a step', async () => {
    await open();
    await click('#studio-add-button');
    expect(live()).toBe('Button added. Give it a web address before updating the tale.');
    const id = doc().elements[0].id;
    expect(globalThis.document.activeElement?.id).toBe(`link-href-${id}`);
    expect(q<HTMLButtonElement>('button.el').getAttribute('aria-label')).toBe('Button: Learn more');
    expect(root.querySelector('.layer__state')?.textContent).toContain('Needs a web address');
    expect(q<HTMLInputElement>(`#link-href-${id}`).getAttribute('aria-invalid')).toBe('true');
    // Labelled controls, in a labelled group.
    for (const field of ['href', 'label', 'variant', 'color', 'fill', 'radius']) {
      const control = q<HTMLElement>(`#link-${field}-${id}`);
      expect(root.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()).toBeTruthy();
    }
    await set(`#link-href-${id}`, 'https://example.com/shop');
    expect(live()).toBe('Web address set to https://example.com/shop');
    expect(root.querySelector('.layer__state')?.textContent).not.toContain('Needs a web address');
    const box = q<HTMLInputElement>(`#link-new-tab-${id}`);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(live()).toBe('Opens in a new tab');
    await set(`#link-label-${id}`, 'Shop now');
    await set(`#link-variant-${id}`, 'outline');
    await set(`#link-fill-hex-${id}`, 'ff0000');
    await set(`#link-radius-${id}`, '2');
    const drawn = q<HTMLElement>('.el__link');
    expect(drawn.textContent).toBe('Shop now');
    expect(drawn.style.borderColor).toBe('rgb(255, 0, 0)');
    expect(doc().elements[0].props).toEqual({
      label: 'Shop now',
      variant: 'outline',
      color: '#111827',
      fill: '#ff0000',
      radius: 0.02,
      href: 'https://example.com/shop',
      newTab: true,
    });
    await click('#studio-undo');
    expect(doc().elements[0].props).toMatchObject({ radius: 0.035 });
    await saveNow(1);
  });

  it('refuses javascript:, ftp: and relative addresses inline, as the server would, and keeps the last good one', async () => {
    await open();
    await click('#studio-add-button');
    const id = doc().elements[0].id;
    await set(`#link-href-${id}`, 'https://example.com');
    await type(`#link-href-${id}`, 'javascript:alert(1)');
    const field = q<HTMLInputElement>(`#link-href-${id}`);
    const error = () => root.querySelector(`#link-href-error-${id}`)?.textContent?.trim();
    expect(error()).toBe('Only web addresses starting with http:// or https:// can be linked.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(`link-href-error-${id}`);
    await set(`#link-href-${id}`, 'javascript:alert(1)');
    expect(live()).toBe('Web address not saved: Only web addresses starting with http:// or https:// can be linked.');
    await set(`#link-href-${id}`, 'ftp://example.com/file');
    await set(`#link-href-${id}`, '/shop');
    expect(doc().elements[0].props).toMatchObject({ href: 'https://example.com' });
    await set(`#link-href-${id}`, 'https://example.com/ok');
    expect(error()).toBeUndefined();
    expect(doc().elements[0].props).toMatchObject({ href: 'https://example.com/ok' });
    await saveNow(1);
  });

  it('warns about a low-contrast button label, without blocking', async () => {
    await open();
    await click('#studio-add-button');
    const id = doc().elements[0].id;
    await set(`#link-color-hex-${id}`, '#eeeeee');
    expect(q<HTMLElement>(`#link-contrast-${id}`).textContent).toContain('Low contrast');
    expect(root.querySelector('.layer__state')?.textContent).toContain('Low contrast');
    expect(q<HTMLInputElement>(`#link-color-${id}`).getAttribute('aria-describedby')).toBe(`link-contrast-${id}`);
    await set(`#link-color-hex-${id}`, '#000000');
    expect(q<HTMLElement>(`#link-contrast-${id}`).textContent?.trim()).toBe('');
    await saveNow(1);
  });

  it('adds one swipe-up link, pinned to the bottom safe area; a second cannot be added, moved or duplicated', async () => {
    await open();
    await click('#studio-add-swipe-up');
    const id = doc().elements[0].id;
    expect(doc().elements[0].box).toEqual(SWIPE_UP_BOX);
    expect(q<HTMLElement>('.el__swipe-label').textContent).toBe('See more');
    expect(root.querySelector('.layer__state')?.textContent).not.toContain('Outside safe area');
    expect(q<HTMLButtonElement>('#studio-add-swipe-up').getAttribute('aria-disabled')).toBe('true');
    expect(q<HTMLElement>('#studio-swipe-up-hint').textContent).toContain('one swipe-up link');
    await click('#studio-add-swipe-up');
    expect(live()).toBe('A tale holds one swipe-up link. Delete it to add another.');
    expect(doc().elements.filter((e) => e.type === 'swipe-up')).toHaveLength(1);
    // Arrow keys do not move it.
    const el = q<HTMLButtonElement>('button.el');
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(live()).toBe('The swipe-up link is pinned to the bottom of the tale: it does not move.');
    expect(doc().elements[0].box).toEqual(SWIPE_UP_BOX);
    expect(root.querySelector(`#link-radius-${id}`)).toBeNull();
    // Its place is fixed: no position, size or rotation fields.
    expect(root.querySelector('#studio-x')).toBeNull();
    expect(root.querySelector('#studio-rotation')).toBeNull();
    expect(q<HTMLElement>(`#link-pinned-${id}`).textContent).toContain('swiping up');
    await set(`#link-href-${id}`, 'https://example.com/more');
    const saved = await saveNow(1);
    expect(saved.elements[0]).toMatchObject({ type: 'swipe-up', box: SWIPE_UP_BOX });
  });

  it('adds an image button from the project media, needing alt text that the decorative mark cannot replace', async () => {
    await open();
    await click('#studio-add-image-button');
    http.expectOne(mediaUrl).flush([media(JPG, 'image/jpeg'), media(MP4, 'video/mp4')]);
    await settle(fixture);
    expect(q<HTMLElement>('[role=dialog] h2').textContent).toBe('Add an image button');
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.media-choice')];
    expect(choices).toHaveLength(1);
    choices[0].click();
    await settle(fixture);
    const id = doc().elements[0].id;
    expect(q<HTMLButtonElement>('button.el').getAttribute('aria-label')).toBe('Image button: Image button 1');
    const state = () => root.querySelector('.layer__state')?.textContent ?? '';
    expect(state()).toContain('Needs alt text');
    expect(state()).toContain('Needs a web address');
    expect(root.querySelector(`#link-label-${id}`)).toBeNull();
    expect(root.querySelector('input[type=checkbox][id^=media-decorative]')).toBeNull();
    await set(`#link-alt-${id}`, 'Shop the summer look');
    await set(`#link-href-${id}`, 'https://example.com/look');
    expect(state()).not.toContain('Needs');
    expect(root.querySelector('.layer__name')?.textContent).toBe('Shop the summer look');
    const saved = await saveNow(1);
    expect(saved.elements[0]).toMatchObject({
      type: 'image-button',
      a11y: { label: 'Shop the summer look' },
      props: { mediaKey: JPG, href: 'https://example.com/look' },
    });
  });

  it('shows the length limit on a pasted 2,049-character address, and trims spaces as it checks and applies', async () => {
    await open();
    await click('#studio-add-button');
    const id = doc().elements[0].id;
    const field = q<HTMLInputElement>(`#link-href-${id}`);
    // No maxlength: a longer paste is not cut silently, it is explained.
    expect(field.hasAttribute('maxlength')).toBe(false);
    const long = `https://example.com/${'a'.repeat(2049 - 20)}`;
    expect(long).toHaveLength(2049);
    await type(`#link-href-${id}`, long);
    const error = () => root.querySelector(`#link-href-error-${id}`)?.textContent?.trim();
    expect(error()).toBe('A web address holds at most 2,048 characters.');
    await set(`#link-href-${id}`, long);
    expect(doc().elements[0].props).not.toHaveProperty('href');
    await type(`#link-href-${id}`, '  https://example.com/shop  ');
    expect(error()).toBeUndefined();
    await set(`#link-href-${id}`, '  https://example.com/shop  ');
    expect(doc().elements[0].props).toMatchObject({ href: 'https://example.com/shop' });
    expect(q<HTMLInputElement>(`#link-href-${id}`).value).toBe('https://example.com/shop');
    await saveNow(1);
  });

  it('warns about a button smaller than a 24 px target on the smallest phone, without blocking', async () => {
    await open();
    await click('#studio-add-button');
    const id = doc().elements[0].id;
    expect(root.querySelector(`#link-target-${id}`)).toBeNull();
    await set('#studio-h', '3');
    expect(q<HTMLElement>(`#link-target-${id}`).textContent).toContain('Small target');
    expect(root.querySelector('.layer__state')?.textContent).toContain('Small target');
    await set('#studio-h', '7');
    expect(root.querySelector(`#link-target-${id}`)).toBeNull();
    await saveNow(1);
  });

  it('opens a document with a locked button read-only', async () => {
    const locked: TaleElement = {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'button',
      box: { x: 0.2, y: 0.7, w: 0.6, h: 0.07, rotation: 0 },
      hidden: false,
      locked: true,
      a11y: {},
      props: { label: 'Go', variant: 'filled', color: '#000000', fill: '#ffffff', href: 'https://example.com' },
    };
    await open({ ...empty, elements: [locked] }, 1);
    await click('button.el');
    expect(q<HTMLInputElement>(`#link-href-${locked.id}`).readOnly).toBe(true);
    await set(`#link-href-${locked.id}`, 'https://other.example');
    expect(doc().elements[0].props).toMatchObject({ href: 'https://example.com' });
  });
});
