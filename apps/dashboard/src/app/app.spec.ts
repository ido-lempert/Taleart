import { CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { App, API_BASE, API_ORIGIN } from './app';
import { appRoutes } from './app.routes';
import { PasskeyClient, unauthorizedInterceptor } from './auth';
import { DashboardStore, SELECTED_PROJECT_KEY } from './dashboard.store';
import { IMPORT_POLL_INTERVAL_MS } from './import.service';

// The shape of the shipped bar schema (libs/contract/frame-types/bar.schema.json) as GET /frame-types sends it.
const barSchema = {
  type: 'object',
  properties: {
    shape: { title: 'Shape', type: 'string', enum: ['circle', 'rounded-square'], default: 'circle' },
    size: { title: 'Size', type: 'string', enum: ['small', 'medium', 'large'], default: 'medium' },
    showTitles: { title: 'Show titles', type: 'boolean', default: true },
    alignment: { title: 'Alignment', type: 'string', enum: ['start', 'center'], default: 'start' },
    gap: {
      title: 'Gap',
      description: 'Space between items, in pixels, from 4 to 24.',
      type: 'integer',
      minimum: 4,
      maximum: 24,
      default: 12,
    },
  },
  additionalProperties: false,
};
const frameTypes = [
  { key: 'bar', label: 'Bar', schema: barSchema },
  { key: 'banner', label: 'Banner', schema: { type: 'object', properties: {}, additionalProperties: false } },
];
const acme = { id: 'p1', name: 'Acme' };
const globex = { id: 'p2', name: 'Globex' };
const zone = { id: 'z1', name: 'Home bar', projectId: 'p1' };
const otherZone = { id: 'z2', name: 'Checkout', projectId: 'p2' };
const group = { id: 'g1', zoneIds: ['z1'], projectId: 'p1', name: 'Summer', status: 'live', position: 0, tags: [] as unknown[] };
const taleA = { id: 't1', taleGroupId: 'g1', projectId: 'p1', title: 'A', position: 0, status: 'live', storedStatus: 'live', media: null };
const taleB = { id: 't2', taleGroupId: 'g1', projectId: 'p1', title: 'B', position: 1, status: 'live', storedStatus: 'live', media: null };
const pngMedia = { kind: 'image', contentType: 'image/png', url: '/api/v1/tales/t1/media' };
const mp4Media = { kind: 'video', contentType: 'video/mp4', url: '/api/v1/tales/t2/media' };
const MEDIA_ORIGIN = API_ORIGIN;
const admin = { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' };
const signedIn = { setupRequired: false, user: admin };
const frameBar = { id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} };

interface Data {
  projects?: { id: string }[];
  zones?: { id: string }[];
  frames?: Record<string, unknown[]>;
  groups?: Record<string, unknown[]>;
  /** Each project's tags, keyed by project id. */
  tags?: Record<string, unknown[]>;
  /** Each zone's active key info, keyed by zone id; null when missing. */
  keys?: Record<string, unknown>;
  /** Each project's tale groups (the Tale groups page), keyed by project id. */
  projectGroups?: Record<string, unknown[]>;
}

const oneZone: Data = { projects: [acme], zones: [zone] };

// Waits for Angular and then one macrotask, so refresh() reaches its next
// request (or its end) after chained awaits that whenStable() does not track.
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`No ${name} button`);
  return button;
}

function type(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error('No input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function choose(select: HTMLSelectElement | null, value: string): void {
  if (!select) throw new Error('No select');
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

// Picks `file` in a file input, as the browser does.
function pick(input: HTMLInputElement | null, file: File): void {
  if (!input) throw new Error('No file input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function drawer(): HTMLElement | null {
  return document.querySelector('[role=dialog]');
}

// Stands in for the browser's WebAuthn calls.
const passkeys = {
  supported: vi.fn(() => true),
  register: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
  authenticate: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
};

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    localStorage.clear();
    passkeys.supported.mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withInterceptors([unauthorizedInterceptor])),
        provideHttpClientTesting(),
        { provide: PasskeyClient, useValue: passkeys },
        provideRouter(appRoutes, withComponentInputBinding()),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // Answers one full refresh: projects, zones, frame types, each zone's frames and tale groups, each project's
  // tags and tale groups, then each zone's key info.
  async function flushRefresh(fixture: ComponentFixture<unknown>, data: Data): Promise<void> {
    const zones = data.zones ?? [];
    http.expectOne(`${API_BASE}/projects`).flush(data.projects ?? []);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones`).flush(zones);
    await settle(fixture);
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await settle(fixture);
    for (const z of zones) http.expectOne(`${API_BASE}/zones/${z.id}/frames`).flush(data.frames?.[z.id] ?? []);
    await settle(fixture);
    for (const z of zones) {
      http.expectOne(`${API_BASE}/zones/${z.id}/tale-groups`).flush(data.groups?.[z.id] ?? []);
    }
    await settle(fixture);
    for (const p of data.projects ?? []) http.expectOne(`${API_BASE}/projects/${p.id}/tags`).flush(data.tags?.[p.id] ?? []);
    await settle(fixture);
    for (const p of data.projects ?? []) {
      http.expectOne(`${API_BASE}/projects/${p.id}/tale-groups`).flush(data.projectGroups?.[p.id] ?? []);
    }
    await settle(fixture);
    for (const z of zones) http.expectOne(`${API_BASE}/zones/${z.id}/key`).flush(data.keys?.[z.id] ?? null);
    await settle(fixture);
  }

  // Navigates to `url`, answering the auth state request when the app asks for it.
  async function navigate(fixture: ComponentFixture<unknown>, url: string, state: object = signedIn): Promise<void> {
    const navigation = TestBed.inject(Router).navigateByUrl(url);
    // Not settle(): whenStable() would wait for the pending auth state request.
    await new Promise((resolve) => setTimeout(resolve));
    for (const req of http.match(`${API_BASE}/auth/state`)) req.flush(state);
    await navigation;
    await settle(fixture);
  }

  async function open(url: string, data: Data): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await navigate(fixture, url);
    await flushRefresh(fixture, data);
    await settle(fixture);
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  // Answers a create request, then the refresh that follows it.
  async function answerCreate(
    fixture: ComponentFixture<unknown>,
    url: string,
    body: unknown,
    created: object,
    after: Data,
  ): Promise<void> {
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush(created);
    await settle(fixture);
    await flushRefresh(fixture, after);
    await settle(fixture);
  }

  async function refuse(fixture: ComponentFixture<unknown>, url: string, code: string, message: string) {
    http.expectOne(url).flush({ error: { code, message } }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
  }

  describe('shell', () => {
    it('redirects / to the zones page and shows the rail, top bar and project switcher', async () => {
      const { root } = await open('/', oneZone);

      expect(TestBed.inject(Router).url).toBe('/zones');
      expect(root.querySelector('nav[aria-label=Main]')?.textContent).toContain('Projects');
      expect(root.querySelector('h1')?.textContent).toContain('Zones');
      expect(root.querySelector<HTMLSelectElement>('#project-switcher')?.selectedOptions[0].textContent).toContain(
        'Acme',
      );
    });

    it('shows a non-blocking banner when the API cannot be reached', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const navigation = TestBed.inject(Router).navigateByUrl('/');
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne(`${API_BASE}/auth/state`).error(new ProgressEvent('error'));
      await navigation;
      await settle(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.banner')?.textContent).toContain('Could not reach the API');
      expect(root.querySelector('nav[aria-label=Main]')).not.toBeNull();
    });

    for (const url of ['/zones', '/zones/z1', '/projects']) {
      it(`shows only the banner, not an empty or not-found state, on ${url} when the API is down`, async () => {
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        await navigate(fixture, url);
        http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
        await settle(fixture);

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('.banner')?.textContent).toContain('Could not reach the API');
        expect(root.textContent).not.toContain('Create your first project');
        expect(root.textContent).not.toContain('Zone not found');
        expect(root.querySelector('.empty')).toBeNull();
      });
    }
  });

  describe('zones page', () => {
    it('offers to create the first project when there are none', async () => {
      const { fixture, root } = await open('/zones', {});

      expect(root.textContent).toContain('Create your first project');
      buttonNamed(root, 'New project').click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Project name');
    });

    it('shows a card per zone of the selected project with frame type pills and tale group count', async () => {
      const { root } = await open('/zones', {
        projects: [acme, globex],
        zones: [zone, otherZone],
        frames: { z1: [frameBar] },
        groups: { z1: [{ ...group, tales: [] }] },
      });

      const cards = root.querySelector('[aria-label=Zones]');
      expect(cards?.textContent).toContain('Home bar');
      expect(cards?.textContent).not.toContain('Checkout');
      expect(cards?.querySelector('.pill')?.textContent).toContain('Bar');
      expect(cards?.textContent).toContain('1 tale group');
    });

    it('shows only the picked project zones and remembers the pick', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme, globex], zones: [zone, otherZone] });

      choose(root.querySelector<HTMLSelectElement>('#project-switcher'), 'p2');
      await settle(fixture);

      expect(root.querySelector('[aria-label=Zones]')?.textContent).toContain('Checkout');
      expect(root.querySelector('[aria-label=Zones]')?.textContent).not.toContain('Home bar');
      expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('p2');
    });

    it('starts on the remembered project after a reload', async () => {
      localStorage.setItem(SELECTED_PROJECT_KEY, 'p2');
      const { root } = await open('/zones', { projects: [acme, globex], zones: [zone, otherZone] });

      expect(root.querySelector('[aria-label=Zones]')?.textContent).toContain('Checkout');
    });

    it('creates a zone from the drawer, closes it and shows the new card', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });

      buttonNamed(root, 'New zone').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Home bar');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await answerCreate(fixture, `${API_BASE}/zones`, { name: 'Home bar', projectId: 'p1' }, zone, oneZone);

      expect(drawer()).toBeNull();
      expect(root.querySelector('[aria-label=Zones]')?.textContent).toContain('Home bar');
    });

    it('keeps the zone drawer open with the API message when a zone is refused', async () => {
      const { fixture } = await open('/zones', { projects: [acme] });

      buttonNamed(fixture.nativeElement, 'New zone').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });
  });

  describe('drawer', () => {
    it('moves focus inside, closes on Escape and returns focus to the opener', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });

      const opener = buttonNamed(root, 'New zone');
      opener.focus();
      opener.click();
      await settle(fixture);
      expect(drawer()?.contains(document.activeElement)).toBe(true);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('zone page', () => {
    it('shows the zone header, its frames and a tale group row of tale cards in order', async () => {
      const { root } = await open('/zones/z1', {
        ...oneZone,
        frames: { z1: [frameBar] },
        groups: { z1: [{ ...group, tales: [taleA, taleB] }] },
      });

      expect(root.querySelector('.page-header')?.textContent).toContain('Home bar');
      expect(root.querySelector('.page-header')?.textContent).toContain('in Acme');
      expect(root.querySelector('[aria-label="Frames in Home bar"]')?.textContent).toContain('Bar');
      const row = root.querySelector('[aria-label="Tale groups in Home bar"] li');
      expect(row?.textContent).toContain('Summer');
      expect(row?.textContent).toContain('2 / 100');
      const cards = [...root.querySelectorAll('[aria-label="Tales in Summer"] .tale-card__title')];
      expect(cards.map((c) => c.textContent?.trim())).toEqual(['A', 'B']);
      expect(row?.querySelector('.tale-add')?.textContent).toContain('Add tale');
    });

    it('shows "Zone not found" with a link back for an unknown zone', async () => {
      const { root } = await open('/zones/nope', oneZone);

      expect(root.textContent).toContain('Zone not found');
      expect(root.querySelector('.empty a[href="/zones"]')?.textContent).toContain('Back to zones');
    });

    it('adds the frame type picked in the drawer', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);
      expect(root.textContent).toContain('No frames yet');

      buttonNamed(root, 'Add frame').click();
      await settle(fixture);
      const select = drawer()?.querySelector<HTMLSelectElement>('select') ?? null;
      expect([...(select?.options ?? [])].map((o) => o.textContent?.trim())).toEqual([
        'Choose a frame type',
        'Bar',
        'Banner',
      ]);
      choose(select, 'bar');
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await answerCreate(fixture, `${API_BASE}/zones/z1/frames`, { type: 'bar', settings: {} }, frameBar, {
        ...oneZone,
        frames: { z1: [frameBar] },
      });

      expect(drawer()).toBeNull();
      expect(root.querySelector('[aria-label="Frames in Home bar"]')?.textContent).toContain('Bar');
    });

    it('shows the API message in the frame drawer when a frame is refused', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);

      buttonNamed(root, 'Add frame').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await refuse(fixture, `${API_BASE}/zones/z1/frames`, 'validation_failed', 'type is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('type is required');
    });

    describe('frame settings', () => {
      const frameBanner = { id: 'f2', zoneId: 'z1', projectId: 'p1', type: 'banner', settings: {} };
      const withFrames: Data = { ...oneZone, frames: { z1: [frameBar, frameBanner] } };
      const field = <T extends Element>(id: string) => drawer()?.querySelector<T>(`#frame-settings-${id}`) ?? null;

      async function openSettings(data: Data = withFrames) {
        const opened = await open('/zones/z1', data);
        opened.root.querySelector<HTMLButtonElement>('[aria-label="Settings of frame 1, Bar"]')?.click();
        await settle(opened.fixture);
        return opened;
      }

      it('offers settings only for frame types whose schema has fields', async () => {
        const { root } = await open('/zones/z1', withFrames);
        const rows = [...root.querySelectorAll('[aria-label="Frames in Home bar"] li')];
        expect(rows.map((r) => r.querySelector('.pill')?.textContent?.trim())).toEqual(['Bar', 'Banner']);
        expect(rows.map((r) => r.querySelector('button')?.getAttribute('aria-label') ?? null)).toEqual([
          'Settings of frame 1, Bar',
          null,
        ]);
      });

      it('builds the form from the schema, showing defaults for unset fields', async () => {
        await openSettings();

        expect(drawer()?.querySelector('h2')?.textContent).toContain('Bar settings');
        expect(drawer()?.textContent).toContain('In zone Home bar');
        const labels = [...(drawer()?.querySelectorAll('.field__label, .checkbox') ?? [])].map((l) =>
          l.textContent?.trim(),
        );
        expect(labels).toEqual(['Shape', 'Size', 'Show titles', 'Alignment', 'Gap']);
        const shape = field<HTMLSelectElement>('shape');
        expect([...(shape?.options ?? [])].map((o) => o.textContent?.trim())).toEqual(['Circle', 'Rounded square']);
        expect(shape?.value).toBe('circle');
        expect(field<HTMLSelectElement>('size')?.value).toBe('medium');
        expect(field<HTMLInputElement>('showTitles')?.checked).toBe(true);
        expect(field<HTMLSelectElement>('alignment')?.value).toBe('start');
        const gap = field<HTMLInputElement>('gap');
        expect(gap?.value).toBe('12');
        expect(gap?.min).toBe('4');
        expect(gap?.max).toBe('24');
        expect(gap?.getAttribute('aria-describedby')).toBe('frame-settings-gap-hint');
        expect(drawer()?.querySelector('#frame-settings-gap-hint')?.textContent).toContain('from 4 to 24');
      });

      it('saves every field and shows the saved values when opened again', async () => {
        const { fixture, root } = await openSettings();
        const settings = { shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 };

        choose(field<HTMLSelectElement>('shape'), 'rounded-square');
        choose(field<HTMLSelectElement>('size'), 'large');
        field<HTMLInputElement>('showTitles')?.click();
        choose(field<HTMLSelectElement>('alignment'), 'center');
        type(field<HTMLInputElement>('gap'), '20');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frames/f1`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual({ settings });
        req.flush({ ...frameBar, settings });
        await settle(fixture);

        expect(drawer()).toBeNull();
        root.querySelector<HTMLButtonElement>('[aria-label="Settings of frame 1, Bar"]')?.click();
        await settle(fixture);
        expect(field<HTMLSelectElement>('shape')?.value).toBe('rounded-square');
        expect(field<HTMLInputElement>('showTitles')?.checked).toBe(false);
        expect(field<HTMLInputElement>('gap')?.value).toBe('20');
      });

      it('keeps the drawer open with the API message and marks the refused field', async () => {
        const { fixture } = await openSettings();

        type(field<HTMLInputElement>('gap'), '40');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frames/f1`);
        expect(req.request.body.settings.gap).toBe(40);
        req.flush(
          { error: { code: 'invalid_frame_settings', message: 'settings.gap must be at most 24' } },
          { status: 400, statusText: 'Bad Request' },
        );
        await settle(fixture);

        expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('settings.gap must be at most 24');
        const gap = field<HTMLInputElement>('gap');
        expect(gap?.getAttribute('aria-invalid')).toBe('true');
        expect(gap?.getAttribute('aria-describedby')).toBe('frame-settings-gap-hint create-error');
        expect(field<HTMLSelectElement>('shape')?.getAttribute('aria-invalid')).toBeNull();
      });

      it('keeps the last number while a number field is empty, and puts the default back when it is left empty', async () => {
        const { fixture } = await openSettings();
        const gap = field<HTMLInputElement>('gap') as HTMLInputElement;

        type(gap, '20');
        // Each input event is followed by change detection, as in the browser.
        await settle(fixture);
        type(gap, '');
        await settle(fixture);
        // Not rebound while typing.
        expect(gap.value).toBe('');
        gap.dispatchEvent(new Event('blur'));
        await settle(fixture);
        expect(gap.value).toBe('12');

        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frames/f1`);
        expect(req.request.body.settings).toEqual({
          shape: 'circle',
          size: 'medium',
          showTitles: true,
          alignment: 'start',
          gap: 12,
        });
        req.flush(frameBar);
        await settle(fixture);
      });

      it('saves the last typed number when the field is emptied but not left', async () => {
        const { fixture } = await openSettings();
        const gap = field<HTMLInputElement>('gap') as HTMLInputElement;

        type(gap, '20');
        type(gap, '');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frames/f1`);
        expect(req.request.body.settings.gap).toBe(20);
        req.flush(frameBar);
        await settle(fixture);
      });

      it('shows and saves defaults for stored values the schema does not allow', async () => {
        const broken = { ...frameBar, settings: { shape: 'star', size: 'large', showTitles: 'no', gap: 40 } };
        const { fixture } = await openSettings({ ...oneZone, frames: { z1: [broken] } });

        expect(field<HTMLSelectElement>('shape')?.value).toBe('circle');
        expect(field<HTMLSelectElement>('size')?.value).toBe('large');
        expect(field<HTMLInputElement>('showTitles')?.checked).toBe(true);
        expect(field<HTMLInputElement>('gap')?.value).toBe('12');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frames/f1`);
        expect(req.request.body.settings).toEqual({
          shape: 'circle',
          size: 'large',
          showTitles: true,
          alignment: 'start',
          gap: 12,
        });
        req.flush(frameBar);
        await settle(fixture);
      });

      it('clears the refused field mark when that field changes, and sets it again on the next refusal', async () => {
        const { fixture } = await openSettings();
        const refuseGap = async () => {
          buttonNamed(drawer() as HTMLElement, 'Save').click();
          http
            .expectOne(`${API_BASE}/zones/z1/frames/f1`)
            .flush(
              { error: { code: 'invalid_frame_settings', message: 'settings.gap must be at most 24' } },
              { status: 400, statusText: 'Bad Request' },
            );
          await settle(fixture);
        };

        type(field<HTMLInputElement>('gap'), '40');
        await refuseGap();
        const gap = field<HTMLInputElement>('gap') as HTMLInputElement;
        expect(gap.getAttribute('aria-invalid')).toBe('true');

        // Another field changing leaves the mark.
        choose(field<HTMLSelectElement>('shape'), 'rounded-square');
        await settle(fixture);
        expect(gap.getAttribute('aria-invalid')).toBe('true');

        type(gap, '30');
        await settle(fixture);
        expect(gap.getAttribute('aria-invalid')).toBeNull();
        expect(gap.getAttribute('aria-describedby')).toBe('frame-settings-gap-hint');

        await refuseGap();
        expect(gap.getAttribute('aria-invalid')).toBe('true');
      });
    });

    it('creates a tale group, then adds tales A then B, shown in that order', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);
      expect(root.textContent).toContain('No tale groups yet');

      buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Summer');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await answerCreate(fixture, `${API_BASE}/zones/z1/tale-groups`, { name: 'Summer' }, { ...group, tales: [] }, {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [] }] },
      });
      expect(root.querySelector('[aria-label="Tale groups in Home bar"]')?.textContent).toContain('0 / 100');

      for (const [title, tales] of [
        ['A', [taleA]],
        ['B', [taleA, taleB]],
      ] as const) {
        (root.querySelector('.tale-add') as HTMLButtonElement).click();
        await settle(fixture);
        type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, title);
        buttonNamed(drawer() as HTMLElement, 'Add').click();
        await answerCreate(fixture, `${API_BASE}/tale-groups/g1/tales`, { title }, tales[tales.length - 1], {
          ...oneZone,
          groups: { z1: [{ ...group, tales }] },
        });
      }

      const cards = [...root.querySelectorAll('[aria-label="Tales in Summer"] li')].map((li) =>
        li.querySelector('.tale-card__title')?.textContent?.trim(),
      );
      expect(cards).toEqual(['A', 'B']);
    });

    it('shows the API message in the tale group drawer when a group is refused', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);

      buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones/z1/tale-groups`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });

    it('shows the API message in the tale drawer when a tale is refused', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });

      (root.querySelector('.tale-add') as HTMLButtonElement).click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'C');
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await refuse(fixture, `${API_BASE}/tale-groups/g1/tales`, 'tale_group_full', 'A tale group holds at most 100 tales');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('A tale group holds at most 100 tales');
    });
  });

  describe('zone key', () => {
    const activeKey = { prefix: 'tak_AbCdEf', createdAt: '2026-10-20T10:00:00.000Z' };
    const issued = { key: 'tak_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcd', ...activeKey };
    const rotated = {
      key: 'tak_ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-zyxw',
      prefix: 'tak_ZyXwVu',
      createdAt: '2026-10-21T09:00:00.000Z',
    };

    function keySection(root: HTMLElement): HTMLElement {
      const section = root.querySelector<HTMLElement>('section[aria-labelledby="key-title"]');
      if (!section) throw new Error('No Zone key section');
      return section;
    }

    it('issues a key and shows it once in a drawer with "Copy key", then only its prefix and date', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { fixture, root } = await open('/zones/z1', oneZone);
      expect(keySection(root).textContent).toContain('No key yet');

      buttonNamed(keySection(root), 'Issue key').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Issue zone key');
      expect(drawer()?.textContent).toContain('For zone Home bar');
      buttonNamed(drawer() as HTMLElement, 'Issue key').click();
      const req = http.expectOne(`${API_BASE}/zones/z1/key`);
      expect(req.request.method).toBe('POST');
      req.flush(issued, { status: 201, statusText: 'Created' });
      await settle(fixture);

      expect(drawer()?.querySelector<HTMLInputElement>('#zone-key')?.value).toBe(issued.key);
      expect(drawer()?.textContent).toContain('Shown only now');
      buttonNamed(drawer() as HTMLElement, 'Copy key').click();
      await settle(fixture);
      expect(writeText).toHaveBeenCalledWith(issued.key);
      expect(drawer()?.querySelector('[role=status]')?.textContent).toContain('Key copied');

      buttonNamed(drawer() as HTMLElement, 'Done').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
      const section = keySection(root);
      expect(section.textContent).toContain('tak_AbCdEf');
      expect(section.textContent).toContain('Issued');
      expect(section.textContent).not.toContain(issued.key);
      expect(buttonNamed(section, 'Rotate')).toBeTruthy();
      expect(buttonNamed(section, 'Revoke')).toBeTruthy();
    });

    it('rotates after confirming in a drawer and shows the new key once', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, keys: { z1: activeKey } });
      buttonNamed(keySection(root), 'Rotate').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Rotate zone key');
      expect(drawer()?.textContent).toContain('tak_AbCdEf');
      expect(drawer()?.textContent).toContain('stops working at once');

      buttonNamed(drawer() as HTMLElement, 'Rotate key').click();
      const req = http.expectOne(`${API_BASE}/zones/z1/key`);
      expect(req.request.method).toBe('POST');
      req.flush(rotated, { status: 201, statusText: 'Created' });
      await settle(fixture);
      expect(drawer()?.querySelector<HTMLInputElement>('#zone-key')?.value).toBe(rotated.key);

      buttonNamed(drawer() as HTMLElement, 'Done').click();
      await settle(fixture);
      expect(keySection(root).textContent).toContain('tak_ZyXwVu');
      expect(keySection(root).textContent).not.toContain('tak_AbCdEf');
    });

    it('revokes after confirming in a drawer, and Cancel changes nothing', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, keys: { z1: activeKey } });
      buttonNamed(keySection(root), 'Revoke').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Revoke zone key');
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(keySection(root).textContent).toContain('tak_AbCdEf');

      buttonNamed(keySection(root), 'Revoke').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Revoke key').click();
      const req = http.expectOne(`${API_BASE}/zones/z1/key`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(keySection(root).textContent).toContain('No key yet');
      expect(buttonNamed(keySection(root), 'Issue key')).toBeTruthy();
    });

    it("shows the API's message in the zone key drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, keys: { z1: activeKey } });
      buttonNamed(keySection(root), 'Revoke').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Revoke key').click();
      http
        .expectOne(`${API_BASE}/zones/z1/key`)
        .flush(
          { error: { code: 'zone_key_not_found', message: 'This zone has no active key' } },
          { status: 404, statusText: 'Not Found' },
        );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('This zone has no active key');

      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      buttonNamed(keySection(root), 'Rotate').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Rotate key').click();
      http
        .expectOne(`${API_BASE}/zones/z1/key`)
        .flush({ error: { code: 'forbidden', message: 'Only admins can do this' } }, { status: 403, statusText: 'Forbidden' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Only admins can do this');
      expect(drawer()?.querySelector('#zone-key')).toBeNull();
    });

    it('shows a content manager the key info only, without Issue, Rotate or Revoke', async () => {
      const manager = { id: 'u2', name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' };
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones/z1', { setupRequired: false, user: manager });
      await flushRefresh(fixture, { ...oneZone, keys: { z1: activeKey } });
      const section = keySection(fixture.nativeElement as HTMLElement);
      expect(section.textContent).toContain('tak_AbCdEf');
      expect(section.textContent).toContain('Issued');
      expect(section.querySelector('button')).toBeNull();
    });

    it('tells a content manager to ask an admin when the zone has no key', async () => {
      const manager = { id: 'u2', name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' };
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones/z1', { setupRequired: false, user: manager });
      await flushRefresh(fixture, oneZone);
      const section = keySection(fixture.nativeElement as HTMLElement);
      expect(section.textContent).toContain('Ask an admin');
      expect(section.querySelector('button')).toBeNull();
    });
  });

  describe('reordering', () => {
    const groupB = { id: 'g2', zoneIds: ['z1'], projectId: 'p1', name: 'Winter', position: 1, tags: [] };
    const twoTales: Data = { ...oneZone, groups: { z1: [{ ...group, tales: [taleA, taleB] }] } };

    function titles(root: HTMLElement): (string | undefined)[] {
      return [...root.querySelectorAll('[aria-label="Tales in Summer"] .tale-card__title')].map((c) =>
        c.textContent?.trim(),
      );
    }

    function badges(root: HTMLElement): (string | undefined)[] {
      return [...root.querySelectorAll('[aria-label="Tales in Summer"] .tale-card__badge')].map((c) =>
        c.textContent?.trim(),
      );
    }

    function groupNames(root: HTMLElement): (string | undefined)[] {
      return [...root.querySelectorAll('.group h4')].map((h) => h.textContent?.trim());
    }

    function liveRegion(root: HTMLElement): string | undefined {
      return root.querySelector('[aria-live=polite]')?.textContent?.trim();
    }

    function moveButton(root: HTMLElement, label: string): HTMLButtonElement {
      const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) throw new Error(`No ${label} button`);
      return button;
    }

    // Emits a drop on the drop list with this aria-label, as the CDK does at the end of a drag.
    function drop(fixture: ComponentFixture<unknown>, label: string, previousIndex: number, currentIndex: number) {
      const list = fixture.debugElement
        .queryAll(By.directive(CdkDropList))
        .find((de) => (de.nativeElement as HTMLElement).getAttribute('aria-label') === label);
      if (!list) throw new Error(`No ${label} drop list`);
      list.injector.get(CdkDropList).dropped.emit({ previousIndex, currentIndex } as CdkDragDrop<unknown>);
    }

    it('swaps tales at once when one is dragged before another and saves the order', async () => {
      const { fixture, root } = await open('/zones/z1', twoTales);

      drop(fixture, 'Tales in Summer', 1, 0);
      await settle(fixture);
      expect(titles(root)).toEqual(['B', 'A']);
      expect(badges(root)).toEqual(['1', '2']);

      const req = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ taleIds: ['t2', 't1'] });
      req.flush([
        { ...taleB, position: 0 },
        { ...taleA, position: 1 },
      ]);
      await settle(fixture);
      expect(titles(root)).toEqual(['B', 'A']);
      expect(root.querySelector('.banner')).toBeNull();
    });

    it("restores the previous order and shows the API's message when the order is refused", async () => {
      const { fixture, root } = await open('/zones/z1', twoTales);

      drop(fixture, 'Tales in Summer', 1, 0);
      await settle(fixture);
      expect(titles(root)).toEqual(['B', 'A']);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/tales/order`)
        .flush(
          { error: { code: 'order_mismatch', message: 'taleIds must list every tale of the tale group exactly once' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      expect(titles(root)).toEqual(['A', 'B']);
      expect(badges(root)).toEqual(['1', '2']);
      expect(root.querySelector('.banner[role=alert]')?.textContent).toContain(
        'taleIds must list every tale of the tale group exactly once',
      );
    });

    it('moves a tale with its keyboard buttons, keeps focus on it and announces the move', async () => {
      const { fixture, root } = await open('/zones/z1', twoTales);
      expect(moveButton(root, 'Move A earlier').disabled).toBe(true);
      expect(moveButton(root, 'Move B later').disabled).toBe(true);

      const later = moveButton(root, 'Move A later');
      later.focus();
      later.click();
      await settle(fixture);

      expect(titles(root)).toEqual(['B', 'A']);
      expect(liveRegion(root)).toBe('A moved to position 2 of 2');
      // A is now last, so focus moves to its other button.
      expect(document.activeElement).toBe(moveButton(root, 'Move A earlier'));
      const first = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      expect(first.request.body).toEqual({ taleIds: ['t2', 't1'] });
      first.flush([
        { ...taleB, position: 0 },
        { ...taleA, position: 1 },
      ]);
      await settle(fixture);

      moveButton(root, 'Move A earlier').click();
      await settle(fixture);
      expect(titles(root)).toEqual(['A', 'B']);
      expect(liveRegion(root)).toBe('A moved to position 1 of 2');
      expect(document.activeElement).toBe(moveButton(root, 'Move A later'));
      http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`).flush([taleA, taleB]);
      await settle(fixture);
    });

    it('sends quick moves one at a time and, when the first is refused, shows the confirmed order and drops the rest', async () => {
      const taleC = { id: 't3', taleGroupId: 'g1', projectId: 'p1', title: 'C', position: 2, media: null };
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [taleA, taleB, taleC] }] },
      });

      drop(fixture, 'Tales in Summer', 2, 0);
      await settle(fixture);
      moveButton(root, 'Move B earlier').click();
      await settle(fixture);
      expect(titles(root)).toEqual(['C', 'B', 'A']);

      // Only the first move is sent while it is pending.
      const first = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      expect(first.request.body).toEqual({ taleIds: ['t3', 't1', 't2'] });
      first.flush(
        { error: { code: 'order_mismatch', message: 'Refused first move' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);
      await settle(fixture);

      expect(titles(root)).toEqual(['A', 'B', 'C']);
      expect(root.querySelector('.banner[role=alert]')?.textContent).toContain('Refused first move');
      http.expectNone(`${API_BASE}/tale-groups/g1/tales/order`);
    });

    it('reorders tale groups by drag and by their move buttons', async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [] }, { ...groupB, tales: [] }] },
      });
      expect(groupNames(root)).toEqual(['Summer', 'Winter']);

      drop(fixture, 'Tale groups in Home bar', 1, 0);
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Winter', 'Summer']);
      const req = http.expectOne(`${API_BASE}/zones/z1/tale-groups/order`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ taleGroupIds: ['g2', 'g1'] });
      req.flush([
        { ...groupB, position: 0, tales: [] },
        { ...group, position: 1, tales: [] },
      ]);
      await settle(fixture);

      moveButton(root, 'Move Winter later').click();
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Winter']);
      expect(liveRegion(root)).toBe('Winter moved to position 2 of 2');
      expect(http.expectOne(`${API_BASE}/zones/z1/tale-groups/order`).request.body).toEqual({
        taleGroupIds: ['g1', 'g2'],
      });
    });
  });

  describe('zone placements', () => {
    const productZone = { id: 'z3', name: 'Product page', projectId: 'p1' };
    const shared = { ...group, zoneIds: ['z1', 'z3'], tales: [] };
    const twoZones: Data = { projects: [acme, globex], zones: [zone, productZone, otherZone] };

    function groupRow(root: HTMLElement, name: string): HTMLElement {
      const row = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => li.querySelector('h4')?.textContent?.trim() === name);
      if (!row) throw new Error(`No ${name} row`);
      return row;
    }

    it('says where else a group shows, with links to those zones', async () => {
      const winter = { id: 'g2', zoneIds: ['z1'], projectId: 'p1', name: 'Winter', position: 1, tags: [], tales: [] };
      const { root } = await open('/zones/z1', { ...twoZones, groups: { z1: [shared, winter], z3: [{ ...shared, position: 0 }] } });

      const alsoIn = groupRow(root, 'Summer').querySelector('.group__zones');
      expect(alsoIn?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Also in: Product page');
      expect(alsoIn?.querySelector('a')?.getAttribute('href')).toBe('/zones/z3');
      expect(groupRow(root, 'Winter').querySelector('.group__zones')).toBeNull();
      // Summer is in every zone of its project, so it offers no "Add to zone…".
      expect(() => buttonNamed(groupRow(root, 'Summer'), 'Add to zone…')).toThrow();
      expect(groupRow(root, 'Summer').querySelector('.group__actions')?.textContent).toContain('In every zone');
      const add = buttonNamed(groupRow(root, 'Winter'), 'Add to zone…');
      expect(add.getAttribute('aria-describedby')).toBe('group-name-g2');
      expect(groupRow(root, 'Winter').querySelector('.group__actions')?.textContent).not.toContain('In every zone');
      expect(buttonNamed(groupRow(root, 'Summer'), 'Remove from this zone')).toBeTruthy();
      expect(buttonNamed(groupRow(root, 'Summer'), 'Rename')).toBeTruthy();
    });

    it("adds a group to another zone of its project from the drawer, then shows it there and \"Also in\"", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...twoZones,
        groups: { z1: [{ ...group, tales: [] }] },
        projectGroups: { p1: [{ id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 0, zoneIds: ['z1'] }] },
      });

      buttonNamed(groupRow(root, 'Summer'), 'Add to zone…').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Add to zone');
      expect(drawer()?.textContent).toContain('Tale group Summer');
      const options = [...(drawer()?.querySelectorAll<HTMLInputElement>('input[type=radio]') ?? [])];
      // Only the project's zones that do not hold the group yet.
      expect(options.map((o) => o.closest('label')?.textContent?.trim())).toEqual(['Product page']);

      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Choose a zone.');

      options[0].click();
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/zones/z3/tale-groups/g1`);
      expect(req.request.method).toBe('PUT');
      req.flush({ ...shared, position: 0 }, { status: 201, statusText: 'Created' });
      await settle(fixture);
      await flushRefresh(fixture, { ...twoZones, groups: { z1: [shared], z3: [{ ...shared, position: 0 }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(groupRow(root, 'Summer').querySelector('.group__zones')?.textContent).toContain('Product page');
    });

    it("shows the API's message in the Add to zone drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      buttonNamed(groupRow(root, 'Summer'), 'Add to zone…').click();
      await settle(fixture);
      drawer()?.querySelector<HTMLInputElement>('input[type=radio]')?.click();
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z3/tale-groups/g1`)
        .flush(
          { error: { code: 'tale_group_not_found', message: "taleGroupId does not match a tale group of the zone's project" } },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('does not match a tale group');
    });

    it('removes a group from this zone after confirming that it stays in the project', async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [shared], z3: [{ ...shared, position: 0 }] } });

      buttonNamed(groupRow(root, 'Summer'), 'Remove from this zone').click();
      await settle(fixture);
      const text = drawer()?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(text).toContain('Remove Summer from Home bar?');
      expect(text).toContain('The tale group stays in the project with its tales, and still shows in Product page.');
      const remove = buttonNamed(drawer() as HTMLElement, 'Remove');
      expect(remove.classList).toContain('btn--danger');

      remove.click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/zones/z1/tale-groups/g1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);
      await flushRefresh(fixture, { ...twoZones, groups: { z3: [{ ...shared, zoneIds: ['z3'], position: 0 }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(root.textContent).toContain('No tale groups yet');
    });

    it('renames a group from the drawer; the new name shows in this zone and its other zone', async () => {
      const store = TestBed.inject(DashboardStore);
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [shared], z3: [{ ...shared, position: 0 }] } });

      buttonNamed(groupRow(root, 'Summer'), 'Rename').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Rename tale group');
      const input = drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null;
      expect(input?.value).toBe('Summer');
      type(input, 'Summer sale');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Summer sale' });
      const renamed = { ...shared, name: 'Summer sale' };
      req.flush(renamed);
      await settle(fixture);
      await flushRefresh(fixture, { ...twoZones, groups: { z1: [renamed], z3: [{ ...renamed, position: 0 }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(groupRow(root, 'Summer sale')).toBeTruthy();
      expect(store.taleGroupsOf('z3')[0].name).toBe('Summer sale');
    });

    it("shows the API's message in the Rename drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      buttonNamed(groupRow(root, 'Summer'), 'Rename').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, '  ');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await refuse(fixture, `${API_BASE}/tale-groups/g1`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });

    it("shows the API's message in the Remove drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      buttonNamed(groupRow(root, 'Summer'), 'Remove from this zone').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Remove').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z1/tale-groups/g1`)
        .flush(
          { error: { code: 'tale_group_not_found', message: 'taleGroupId does not match a tale group' } },
          { status: 404, statusText: 'Not Found' },
        );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('taleGroupId does not match a tale group');
    });

    it("shows the tale groups page from the rail: the project's groups with their zones, also those in no zone", async () => {
      const { fixture, root } = await open('/zones', {
        ...twoZones,
        projectGroups: {
          p1: [
            { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: [] },
            { id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 0, zoneIds: ['z1', 'z3'] },
          ],
          p2: [{ id: 'g8', projectId: 'p2', name: 'Elsewhere', taleCount: 0, zoneIds: ['z2'] }],
        },
      });

      const link = root.querySelector<HTMLAnchorElement>('.rail a[href="/tale-groups"]');
      expect(link?.textContent).toContain('Tale groups');
      await navigate(fixture, '/tale-groups');
      expect(root.querySelector('.topbar__title')?.textContent).toBe('Tale groups');
      expect(link?.getAttribute('aria-current')).toBe('page');

      const rows = [...root.querySelectorAll<HTMLElement>('[aria-label="Tale groups in Acme"] li')];
      expect(rows.map((r) => r.querySelector('h3')?.textContent?.trim())).toEqual(['Autumn', 'Summer']);
      expect(rows[0].textContent).toContain('3 / 100');
      expect(rows[0].textContent).toContain('Not in any zone');
      expect(rows[1].querySelector('.group-row__zones')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('In: Home bar, Product page');
      expect([...rows[1].querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/zones/z1', '/zones/z3']);
      expect(rows[1].textContent).toContain('In every zone');
      expect(root.textContent).not.toContain('Elsewhere');

      buttonNamed(rows[0], 'Add to zone…').click();
      await settle(fixture);
      const options = [...(drawer()?.querySelectorAll<HTMLInputElement>('input[type=radio]') ?? [])];
      expect(options.map((o) => o.closest('label')?.textContent?.trim())).toEqual(['Home bar', 'Product page']);
      options[1].click();
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z3/tale-groups/g9`)
        .flush({ id: 'g9', projectId: 'p1', name: 'Autumn', position: 1, zoneIds: ['z3'], tales: [], tags: [] }, { status: 201, statusText: 'Created' });
      await settle(fixture);
      await flushRefresh(fixture, {
        ...twoZones,
        projectGroups: {
          p1: [
            { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: ['z3'] },
            { id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 0, zoneIds: ['z1', 'z3'] },
          ],
        },
      });
      await settle(fixture);
      expect(root.querySelector('[aria-label="Tale groups in Acme"] li')?.textContent).toContain('In: Product page');
    });

    it('copies a group to a zone of another project from the drawer and links to the target zone', async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      const copyButton = buttonNamed(groupRow(root, 'Summer'), 'Copy to zone…');
      expect(copyButton.getAttribute('aria-describedby')).toBe('group-name-g1');
      copyButton.click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Copy to zone');
      expect(drawer()?.textContent).toContain('Tale group Summer');
      const projectSelect = drawer()?.querySelector<HTMLSelectElement>('select[name=copyProject]') ?? null;
      const zoneOptions = () =>
        [...(drawer()?.querySelectorAll<HTMLOptionElement>('select[name=copyZone] option') ?? [])].map((o) => o.textContent?.trim());
      // Every project the user can access, the group's own first, and that project's zones.
      expect([...(projectSelect?.options ?? [])].map((o) => o.textContent?.trim())).toEqual(['Acme', 'Globex']);
      expect(projectSelect?.value).toBe('p1');
      expect(zoneOptions()).toEqual(['Choose a zone', 'Home bar', 'Product page']);

      buttonNamed(drawer() as HTMLElement, 'Copy').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Choose a zone.');

      choose(projectSelect, 'p2');
      await settle(fixture);
      expect(zoneOptions()).toEqual(['Choose a zone', 'Checkout']);
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=copyZone]') ?? null, 'z2');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Copy').click();
      await settle(fixture);
      const copy = { id: 'g7', projectId: 'p2', name: 'Summer', position: 0, zoneIds: ['z2'], tales: [], tags: [] };
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/copy`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ zoneId: 'z2' });
      req.flush(copy, { status: 201, statusText: 'Created' });
      await settle(fixture);
      await flushRefresh(fixture, { ...twoZones, groups: { z1: [{ ...group, tales: [] }], z2: [copy] } });
      await settle(fixture);

      const status = drawer()?.querySelector('[role=status]');
      expect(status?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Copied Summer to Checkout in Globex.');
      const link = status?.querySelector<HTMLAnchorElement>('a');
      expect(link?.getAttribute('href')).toBe('/zones/z2');
      expect(buttonNamed(drawer() as HTMLElement, 'Done')).toBeTruthy();
      expect(() => buttonNamed(drawer() as HTMLElement, 'Copy')).toThrow();

      link?.click();
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(TestBed.inject(Router).url).toBe('/zones/z2');
      expect(groupRow(root, 'Summer')).toBeTruthy();
    });

    it("shows the API's message in the Copy to zone drawer, with the group's own project first", async () => {
      const theirs = { id: 'g8', projectId: 'p2', name: 'Elsewhere', position: 0, zoneIds: ['z2'], tales: [], tags: [] };
      const { fixture, root } = await open('/zones/z2', { ...twoZones, groups: { z2: [theirs] } });

      buttonNamed(groupRow(root, 'Elsewhere'), 'Copy to zone…').click();
      await settle(fixture);
      const projectSelect = drawer()?.querySelector<HTMLSelectElement>('select[name=copyProject]') ?? null;
      expect([...(projectSelect?.options ?? [])].map((o) => o.textContent?.trim())).toEqual(['Globex', 'Acme']);
      choose(projectSelect, 'p1');
      await settle(fixture);
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=copyZone]') ?? null, 'z3');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Copy').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g8/copy`)
        .flush({ error: { code: 'forbidden', message: 'You do not have access to this project' } }, { status: 403, statusText: 'Forbidden' });
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('You do not have access to this project');
      expect(buttonNamed(drawer() as HTMLElement, 'Copy')).toBeTruthy();
    });

    it('offers "Copy to zone…" on the Tale groups page, also for a group in no zone', async () => {
      const { fixture, root } = await open('/tale-groups', {
        ...twoZones,
        projectGroups: { p1: [{ id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: [] }] },
      });

      const row = root.querySelector<HTMLElement>('[aria-label="Tale groups in Acme"] li') as HTMLElement;
      const copyButton = buttonNamed(row, 'Copy to zone…');
      expect(copyButton.getAttribute('aria-describedby')).toBe('project-group-g9');
      copyButton.click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Tale group Autumn');
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=copyZone]') ?? null, 'z1');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Copy').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g9/copy`);
      expect(req.request.body).toEqual({ zoneId: 'z1' });
      req.flush({ id: 'g10', projectId: 'p1', name: 'Autumn', position: 0, zoneIds: ['z1'], tales: [], tags: [] }, { status: 201, statusText: 'Created' });
      await settle(fixture);
      await flushRefresh(fixture, twoZones);
      await settle(fixture);
      expect(drawer()?.querySelector('[role=status]')?.textContent).toContain('Copied Autumn to');
      expect(drawer()?.querySelector('[role=status] a')?.textContent?.trim()).toBe('Home bar');
    });

    it('shows the saved tale order in the group\'s other zone too', async () => {
      const store = TestBed.inject(DashboardStore);
      const withTales = { ...shared, tales: [taleA, taleB] };
      const { fixture } = await open('/zones/z1', { ...twoZones, groups: { z1: [withTales], z3: [{ ...withTales, position: 0 }] } });

      const saving = store.orderTales('z1', 'g1', ['t2', 't1']);
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`).flush([
        { ...taleB, position: 0 },
        { ...taleA, position: 1 },
      ]);
      expect(await saving).toBe('');
      await settle(fixture);
      expect(store.taleGroupsOf('z3')[0].tales.map((t) => t.id)).toEqual(['t2', 't1']);
    });
  });

  describe('statuses', () => {
    const draft = { ...group, id: 'g2', name: 'Draft one', status: 'draft', position: 1, tales: [] };
    const paused = { ...group, id: 'g3', name: 'Paused one', status: 'paused', position: 2, tales: [] };
    const archived = { ...group, id: 'g4', name: 'Archived one', status: 'archived', position: 3, tales: [] };
    const pausedTale = { ...taleB, status: 'paused', storedStatus: 'paused' };
    const live = { ...group, tales: [taleA, pausedTale] };

    function groupRow(root: HTMLElement, name: string): HTMLElement {
      const row = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => li.querySelector('h4')?.textContent?.trim() === name);
      if (!row) throw new Error(`No ${name} row`);
      return row;
    }

    function badge(root: Element): string {
      return root.querySelector('.status-badge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    // The status buttons of a group row: those before Tags.
    function statusButtons(row: HTMLElement): string[] {
      const names = [...row.querySelectorAll<HTMLButtonElement>('.group__actions button')].map((b) => b.textContent?.trim() ?? '');
      return names.slice(0, names.indexOf('Tags'));
    }

    it('shows each group its status badge and only the buttons its status allows, and tale cards that are not live', async () => {
      const { root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live, draft, paused, archived] } });

      expect(badge(groupRow(root, 'Summer'))).toBe('Status: Live');
      expect(statusButtons(groupRow(root, 'Summer'))).toEqual(['Pause', 'Archive']);
      expect(badge(groupRow(root, 'Draft one'))).toBe('Status: Draft');
      expect(statusButtons(groupRow(root, 'Draft one'))).toEqual(['Publish', 'Archive']);
      expect(badge(groupRow(root, 'Paused one'))).toBe('Status: Paused');
      expect(statusButtons(groupRow(root, 'Paused one'))).toEqual(['Publish', 'Archive']);
      expect(badge(groupRow(root, 'Archived one'))).toBe('Status: Archived');
      expect(statusButtons(groupRow(root, 'Archived one'))).toEqual(['Restore']);
      expect(buttonNamed(groupRow(root, 'Draft one'), 'Publish').getAttribute('aria-describedby')).toBe('group-name-g2');

      const cards = [...groupRow(root, 'Summer').querySelectorAll('.tale-card')];
      expect(cards[0].querySelector('.status-badge')).toBeNull();
      expect(badge(cards[1])).toBe('Status: Paused');
    });

    it('shows the tales of a paused group as blocked by group', async () => {
      const blocked = { ...live, status: 'paused', tales: [{ ...taleA, status: 'blocked-by-group' }, pausedTale] };
      const { root } = await open('/zones/z1', { ...oneZone, groups: { z1: [blocked] } });

      const cards = [...groupRow(root, 'Summer').querySelectorAll('.tale-card')];
      expect(cards.map((c) => badge(c))).toEqual(['Status: Blocked by group', 'Status: Paused']);
    });

    it('publishes a draft group, shows its new badge and announces it', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [draft] } });

      buttonNamed(groupRow(root, 'Draft one'), 'Publish').click();
      await settle(fixture);
      expect(buttonNamed(groupRow(root, 'Draft one'), 'Publish').disabled).toBe(true);
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/status`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'live' });
      req.flush({ ...draft, status: 'live' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...draft, status: 'live' }] } });
      await settle(fixture);

      expect(badge(groupRow(root, 'Draft one'))).toBe('Status: Live');
      expect(statusButtons(groupRow(root, 'Draft one'))).toEqual(['Pause', 'Archive']);
      expect(root.querySelector('[aria-live=polite]')?.textContent).toBe('Draft one is now live');
    });

    it('restores an archived group as paused', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [archived] } });

      buttonNamed(groupRow(root, 'Archived one'), 'Restore').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g4/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...archived, status: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...archived, status: 'paused' }] } });
      await settle(fixture);

      expect(badge(groupRow(root, 'Archived one'))).toBe('Status: Paused');
      expect(statusButtons(groupRow(root, 'Archived one'))).toEqual(['Publish', 'Archive']);
    });

    it("shows the API's message when a status change is refused, and keeps the status", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      buttonNamed(groupRow(root, 'Summer'), 'Pause').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/status`)
        .flush(
          { error: { code: 'invalid_status_transition', message: 'The status cannot change from archived to paused' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      expect(root.querySelector('[role=alert]')?.textContent).toContain('The status cannot change from archived to paused');
      expect(badge(groupRow(root, 'Summer'))).toBe('Status: Live');
      expect(buttonNamed(groupRow(root, 'Summer'), 'Pause').disabled).toBe(false);
    });

    it('pauses a tale from its drawer, which stays open and shows the new status', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(badge(drawer() as HTMLElement)).toBe('Status: Live');
      expect(['Pause', 'Archive'].map((name) => buttonNamed(drawer() as HTMLElement, name).type)).toEqual(['button', 'button']);
      buttonNamed(drawer() as HTMLElement, 'Pause').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/status`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...taleA, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      const after = { ...live, tales: [{ ...taleA, status: 'paused', storedStatus: 'paused' }, pausedTale] };
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [after] } });
      await settle(fixture);

      expect(drawer()).not.toBeNull();
      expect(badge(drawer() as HTMLElement)).toBe('Status: Paused');
      expect(buttonNamed(drawer() as HTMLElement, 'Publish')).toBeTruthy();
      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toBe('Status: Paused');
      expect(badge(groupRow(root, 'Summer').querySelector('.tale-card') as HTMLElement)).toBe('Status: Paused');
    });

    it("offers the stored status's buttons for a tale blocked by its group, and shows a refusal in the drawer", async () => {
      const blocked = { ...live, status: 'paused', tales: [{ ...taleA, status: 'blocked-by-group' }] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [blocked] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(badge(drawer() as HTMLElement)).toBe('Status: Blocked by group');
      expect(drawer()?.textContent).toContain('its tale group is paused');
      buttonNamed(drawer() as HTMLElement, 'Archive').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/status`)
        .flush({ error: { code: 'tale_not_found', message: 'taleId does not match a tale' } }, { status: 404, statusText: 'Not Found' });
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('taleId does not match a tale');
    });

    it('keeps overlapping status changes on two groups apart: each waits for its own answer and shows its own message', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live, draft] } });

      buttonNamed(groupRow(root, 'Summer'), 'Pause').click();
      buttonNamed(groupRow(root, 'Draft one'), 'Publish').click();
      await settle(fixture);
      const [pause, publish] = [`${API_BASE}/tale-groups/g1/status`, `${API_BASE}/tale-groups/g2/status`].map((url) =>
        http.expectOne(url),
      );
      pause.flush(
        { error: { code: 'invalid_status_transition', message: 'Summer cannot be paused' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);

      expect(buttonNamed(groupRow(root, 'Summer'), 'Pause').disabled).toBe(false);
      expect(buttonNamed(groupRow(root, 'Draft one'), 'Publish').disabled).toBe(true);
      expect(groupRow(root, 'Summer').querySelector('[role=alert]')?.textContent).toContain('Summer cannot be paused');
      expect(groupRow(root, 'Draft one').querySelector('[role=alert]')).toBeNull();

      publish.flush(
        { error: { code: 'invalid_status_transition', message: 'Draft one cannot be published' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);
      expect(groupRow(root, 'Summer').querySelector('[role=alert]')?.textContent).toContain('Summer cannot be paused');
      expect(groupRow(root, 'Draft one').querySelector('[role=alert]')?.textContent).toContain('Draft one cannot be published');
      expect(buttonNamed(groupRow(root, 'Draft one'), 'Publish').disabled).toBe(false);
    });

    it("announces the tale's status from the API's answer, not the list", async () => {
      const blockedGroup = { ...live, status: 'paused', tales: [pausedTale] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [blockedGroup] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale B"]')?.click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Publish').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t2/status`).flush({ ...taleB, status: 'blocked-by-group', storedStatus: 'live' });
      await settle(fixture);
      // The refresh still lists the old status.
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [blockedGroup] } });
      await settle(fixture);

      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toBe('Status: Blocked by group');
    });

    it('shows each group status on the Tale groups page', async () => {
      const { fixture, root } = await open('/zones', {
        ...oneZone,
        projectGroups: {
          p1: [
            { id: 'g9', projectId: 'p1', name: 'Autumn', status: 'draft', taleCount: 0, zoneIds: [] },
            { id: 'g1', projectId: 'p1', name: 'Summer', status: 'live', taleCount: 2, zoneIds: ['z1'] },
          ],
        },
      });
      await navigate(fixture, '/tale-groups');

      const rows = [...root.querySelectorAll<HTMLElement>('[aria-label="Tale groups in Acme"] li')];
      expect(rows.map((r) => badge(r))).toEqual(['Status: Draft', 'Status: Live']);
    });
  });

  describe('tags', () => {
    const summer = { id: 'tag1', projectId: 'p1', name: 'summer' };
    const beach = { id: 'tag2', projectId: 'p1', name: 'Beach' };
    const ref = ({ id, name }: { id: string; name: string }) => ({ id, name });
    const winter = { id: 'g2', zoneIds: ['z1'], projectId: 'p1', name: 'Winter', position: 1, tags: [] as unknown[] };
    const spring = { id: 'g3', zoneIds: ['z1'], projectId: 'p1', name: 'Spring', position: 2, tags: [] as unknown[] };

    function groupNames(root: HTMLElement): string[] {
      return [...root.querySelectorAll('[aria-label="Tale groups in Home bar"] h4')].map((h) => h.textContent?.trim() ?? '');
    }

    function chip(root: HTMLElement, name: string): HTMLButtonElement {
      const filters = root.querySelector('[aria-label="Filter tale groups by tag"]') as HTMLElement;
      return buttonNamed(filters, name);
    }

    it('shows tag chips after the group name and a Tags button on every group', async () => {
      const { root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [], tags: [ref(beach), ref(summer)] }, { ...winter, tales: [] }] },
        tags: { p1: [beach, summer] },
      });

      const chips = [...root.querySelectorAll('[aria-label="Tags of Summer"] li')].map((li) => li.textContent?.trim());
      expect(chips).toEqual(['Beach', 'summer']);
      expect(root.querySelector('[aria-label="Tags of Winter"] li')).toBeNull();
      expect(root.querySelectorAll('button[aria-label^="Tags of "]').length).toBe(2);
    });

    it("opens the Tags drawer with the project's tags as checkboxes, creates a tag and saves the set", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [], tags: [ref(beach)] }] },
        tags: { p1: [beach] },
      });

      (root.querySelector('button[aria-label="Tags of Summer"]') as HTMLButtonElement).click();
      await settle(fixture);
      const panel = drawer() as HTMLElement;
      expect(panel.querySelector('h2')?.textContent).toContain('Tags');
      expect(panel.textContent).toContain('For tale group Summer');
      const boxes = () =>
        [...panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((box) => [
          box.closest('label')?.textContent?.trim(),
          box.checked,
        ]);
      expect(boxes()).toEqual([['Beach', true]]);

      type(panel.querySelector<HTMLInputElement>('#new-tag'), 'summer');
      await settle(fixture);
      buttonNamed(panel, 'Add tag').click();
      const create = http.expectOne(`${API_BASE}/projects/p1/tags`);
      expect(create.request.method).toBe('POST');
      expect(create.request.body).toEqual({ name: 'summer' });
      create.flush(summer);
      await settle(fixture);
      // ngModel writes the cleared field after the change detection that saw it.
      await settle(fixture);
      expect(boxes()).toEqual([
        ['Beach', true],
        ['summer', true],
      ]);
      expect(panel.querySelector<HTMLInputElement>('#new-tag')?.value).toBe('');

      (panel.querySelector('input[type=checkbox]') as HTMLInputElement).click();
      await settle(fixture);
      buttonNamed(panel, 'Save').click();
      const save = http.expectOne(`${API_BASE}/tale-groups/g1/tags`);
      expect(save.request.method).toBe('PUT');
      expect(save.request.body).toEqual({ tagIds: ['tag1'] });
      save.flush({ ...group, tales: [], tags: [ref(summer)] });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(root.querySelector('[aria-label="Tags of Summer"] li')?.textContent?.trim()).toBe('summer');
    });

    it("shows the API's message in the Tags drawer when a tag or the set is refused", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [] }] },
        tags: { p1: [summer] },
      });
      (root.querySelector('button[aria-label="Tags of Summer"]') as HTMLButtonElement).click();
      await settle(fixture);
      const panel = drawer() as HTMLElement;
      expect(panel.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);

      type(panel.querySelector<HTMLInputElement>('#new-tag'), 'SUMMER');
      buttonNamed(panel, 'Add tag').click();
      http
        .expectOne(`${API_BASE}/projects/p1/tags`)
        .flush(
          { error: { code: 'tag_exists', message: 'This project already has a tag named "SUMMER"' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);
      expect(panel.querySelector('[role=alert]')?.textContent).toContain('already has a tag named');

      buttonNamed(panel, 'Save').click();
      await refuse(fixture, `${API_BASE}/tale-groups/g1/tags`, 'tag_not_found', 'A tag id does not match a tag of this project');
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('does not match a tag');
    });

    it('filters the groups by a tag chip, hides reordering while filtered, and shows all again', async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: {
          z1: [
            { ...group, tales: [], tags: [ref(summer)] },
            { ...winter, tales: [], tags: [ref(beach)] },
            { ...spring, tales: [], tags: [ref(beach), ref(summer)] },
          ],
        },
        tags: { p1: [beach, summer] },
      });

      const filters = root.querySelector('[aria-label="Filter tale groups by tag"]') as HTMLElement;
      expect([...filters.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['All', 'Beach', 'summer']);
      expect(chip(root, 'All').getAttribute('aria-pressed')).toBe('true');

      chip(root, 'summer').click();
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Spring']);
      expect(chip(root, 'summer').getAttribute('aria-pressed')).toBe('true');
      expect(root.querySelector('[data-move^="group:"]')).toBeNull();
      expect(root.querySelector('[aria-live=polite]')?.textContent).toContain('Showing 2 of 3 tale groups, tagged summer');

      chip(root, 'All').click();
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Winter', 'Spring']);
      expect(root.querySelector('[data-move^="group:"]')).not.toBeNull();
    });

    it('drops the filter when no group carries its tag any more, and does not bring it back', async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [], tags: [ref(summer)] }, { ...winter, tales: [] }] },
        tags: { p1: [summer] },
      });
      chip(root, 'summer').click();
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer']);

      const store = TestBed.inject(DashboardStore);
      const setGroups = (tags: unknown[]) =>
        store.taleGroups.set({ z1: [{ ...group, tales: [], tags }, { ...winter, tales: [] }] as never });
      setGroups([]);
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Winter']);
      setGroups([ref(summer)]);
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Winter']);
      expect(chip(root, 'All').getAttribute('aria-pressed')).toBe('true');
    });

    it('shows no filter chips when no group has tags', async () => {
      const { root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });
      expect(root.querySelector('[aria-label="Filter tale groups by tag"]')).toBeNull();
    });

    it('tags two groups with a new tag "summer", filters by it, and they still carry it after a reload', async () => {
      const groups = [
        { ...group, tales: [] },
        { ...winter, tales: [] },
        { ...spring, tales: [] },
      ];
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: groups } });

      for (const [name, id, created] of [
        ['Summer', 'g1', true],
        ['Spring', 'g3', false],
      ] as const) {
        (root.querySelector(`button[aria-label="Tags of ${name}"]`) as HTMLButtonElement).click();
        await settle(fixture);
        const panel = drawer() as HTMLElement;
        if (created) {
          type(panel.querySelector<HTMLInputElement>('#new-tag'), 'summer');
          buttonNamed(panel, 'Add tag').click();
          http.expectOne(`${API_BASE}/projects/p1/tags`).flush(summer);
          await settle(fixture);
        } else {
          (panel.querySelector('input[type=checkbox]') as HTMLInputElement).click();
          await settle(fixture);
        }
        buttonNamed(panel, 'Save').click();
        const save = http.expectOne(`${API_BASE}/tale-groups/${id}/tags`);
        expect(save.request.body).toEqual({ tagIds: ['tag1'] });
        save.flush({ ...groups.find((g) => g.id === id), tags: [ref(summer)] });
        await settle(fixture);
      }

      chip(root, 'summer').click();
      await settle(fixture);
      expect(groupNames(root)).toEqual(['Summer', 'Spring']);

      // A reload loads the same tags from the API.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        ...oneZone,
        groups: {
          z1: [
            { ...group, tales: [], tags: [ref(summer)] },
            { ...winter, tales: [] },
            { ...spring, tales: [], tags: [ref(summer)] },
          ],
        },
        tags: { p1: [summer] },
      });
      expect(groupNames(root)).toEqual(['Summer', 'Spring']);
      expect(root.querySelector('[aria-label="Tags of Spring"] li')?.textContent?.trim()).toBe('summer');
    });
  });

  describe('tale media', () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'beach.png', { type: 'image/png' });
    const pdf = new File(['%PDF-1.7'], 'menu.pdf', { type: 'application/pdf' });

    it('shows the image or a muted looping video on tale cards that have media', async () => {
      const { root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }, { ...taleB, media: mp4Media }] }] },
      });

      const [first, second] = [...root.querySelectorAll('[aria-label="Tales in Summer"] li')];
      expect(first.querySelector('img.tale-card__media')?.getAttribute('src')).toBe(
        `${MEDIA_ORIGIN}/api/v1/tales/t1/media`,
      );
      const video = second.querySelector<HTMLVideoElement>('video.tale-card__media');
      expect(video?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t2/media`);
      expect(video?.muted).toBe(true);
      expect(video?.loop).toBe(true);
    });

    it('opens a tale, uploads a PNG and shows it on the card', async () => {
      const withTale = { ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } };
      const { fixture, root } = await open('/zones/z1', withTale);
      expect(root.querySelector('.tale-card__media')).toBeNull();

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Tale');
      expect(drawer()?.textContent).toContain('No media yet');
      const input = drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null;
      expect(input?.accept).toBe('image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm');
      pick(input, png);
      buttonNamed(drawer() as HTMLElement, 'Upload').click();
      await settle(fixture);

      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('Content-Type')).toBe('image/png');
      expect(req.request.body).toBe(png);
      req.flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }] }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(
        `${MEDIA_ORIGIN}/api/v1/tales/t1/media?v=1`,
      );
    });

    it("shows the API's unsupported message for a PDF and keeps the previous media", async () => {
      const withMedia = { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }] }] } };
      const { fixture, root } = await open('/zones/z1', withMedia);

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(drawer()?.querySelector('img.media-preview__media')).not.toBeNull();
      pick(drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null, pdf);
      buttonNamed(drawer() as HTMLElement, 'Upload').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(req.request.headers.get('Content-Type')).toBe('application/pdf');
      req.flush(
        { error: { code: 'unsupported_media_type', message: 'Upload a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video' } },
        { status: 415, statusText: 'Unsupported Media Type' },
      );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Upload a JPEG, PNG, WebP or GIF image');
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t1/media`);
    });

    it('asks for a file when Upload is pressed without one', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Upload').click();
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Choose an image or video');
    });

    it('uploads the optional file after adding a tale', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });

      (root.querySelector('.tale-add') as HTMLButtonElement).click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'A');
      pick(drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null, png);
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);

      const create = http.expectOne(`${API_BASE}/tale-groups/g1/tales`);
      expect(create.request.body).toEqual({ title: 'A' });
      create.flush(taleA);
      await settle(fixture);
      const upload = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(upload.request.method).toBe('PUT');
      expect(upload.request.body).toBe(png);
      upload.flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }] }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(root.querySelector('img.tale-card__media')).not.toBeNull();
    });

    it('switches to the new tale with the message when its file is refused', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });

      (root.querySelector('.tale-add') as HTMLButtonElement).click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'A');
      pick(drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null, pdf);
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g1/tales`).flush(taleA);
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/media`)
        .flush({ error: { code: 'unsupported_media_type', message: 'Unsupported' } }, { status: 415, statusText: 'x' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } });
      await settle(fixture);

      expect(drawer()?.querySelector('h2')?.textContent).toContain('Tale');
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Unsupported');
      expect(root.querySelectorAll('[aria-label="Tales in Summer"] li')).toHaveLength(1);
    });
  });

  describe('projects page', () => {
    it('lists project cards and creates a project from the drawer', async () => {
      const { fixture, root } = await open('/projects', { projects: [acme], zones: [zone] });
      expect(root.querySelector('[aria-label=Projects]')?.textContent).toContain('Acme');
      expect(root.querySelector('[aria-label=Projects]')?.textContent).toContain('1 zone');

      buttonNamed(root, 'New project').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Globex');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await answerCreate(fixture, `${API_BASE}/projects`, { name: 'Globex' }, globex, {
        projects: [acme, globex],
        zones: [zone],
      });

      expect(drawer()).toBeNull();
      expect(root.querySelector('[aria-label=Projects]')?.textContent).toContain('Globex');
      expect(localStorage.getItem(SELECTED_PROJECT_KEY)).toBe('p2');
    });

    it('keeps the project drawer open with the API message when a project is refused', async () => {
      const { fixture, root } = await open('/projects', { projects: [acme] });

      buttonNamed(root, 'New project').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/projects`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });
  });
  describe('auth', () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve));
    const setupState = { setupRequired: true, user: null };
    const signedOut = { setupRequired: false, user: null };
    const creationOptions = { challenge: 'c1', rp: { name: 'TaleArt', id: 'localhost' } };
    const requestOptions = { challenge: 'c2', rpId: 'localhost' };

    // Lets the sign-in finish and the effect that loads data run. Not settle():
    // whenStable() would wait for the pending data requests.
    async function signedInTick(fixture: ComponentFixture<unknown>): Promise<void> {
      await tick();
      fixture.detectChanges();
      await tick();
    }

    async function visit(url: string, state: object): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, url, state);
      return { fixture, root: fixture.nativeElement as HTMLElement };
    }

    it('shows the setup screen on an empty install, registers a passkey and lands on Zones as admin', async () => {
      const { fixture, root } = await visit('/', setupState);
      const router = TestBed.inject(Router);
      expect(router.url).toBe('/setup?returnUrl=%2Fzones');
      expect(root.querySelector('h1')?.textContent).toContain('Set up TaleArt');
      expect(root.querySelector('nav[aria-label=Main]')).toBeNull();

      type(root.querySelector<HTMLInputElement>('#setup-name'), 'Ada Admin');
      type(root.querySelector<HTMLInputElement>('#setup-email'), 'ada@example.com');
      buttonNamed(root, 'Create passkey').click();
      const options = http.expectOne(`${API_BASE}/auth/setup/options`);
      expect(options.request.body).toEqual({ name: 'Ada Admin', email: 'ada@example.com' });
      options.flush(creationOptions);
      await tick();
      expect(passkeys.register).toHaveBeenCalledWith(creationOptions);
      const verify = http.expectOne(`${API_BASE}/auth/setup/verify`);
      expect(verify.request.body).toEqual({ id: 'cred-1', type: 'public-key' });
      verify.flush({ user: admin }, { status: 201, statusText: 'Created' });
      await signedInTick(fixture);
      await flushRefresh(fixture, oneZone);

      expect(router.url).toBe('/zones');
      expect(root.querySelector('h1')?.textContent).toContain('Zones');
      expect(root.querySelector('.user-menu')?.textContent).toContain('Ada Admin');
    });

    it("shows the API's message in the setup card", async () => {
      const { fixture, root } = await visit('/setup', setupState);
      type(root.querySelector<HTMLInputElement>('#setup-name'), 'Ada');
      type(root.querySelector<HTMLInputElement>('#setup-email'), 'nope');
      buttonNamed(root, 'Create passkey').click();
      await refuse(fixture, `${API_BASE}/auth/setup/options`, 'validation_failed', 'email is not valid');
      expect(root.querySelector('.form-error')?.textContent).toContain('email is not valid');
    });

    it('sends to sign-in when an admin exists, and setup is no longer reachable', async () => {
      const { fixture, root } = await visit('/zones', signedOut);
      const router = TestBed.inject(Router);
      expect(router.url).toBe('/sign-in?returnUrl=%2Fzones');
      expect(root.querySelector('h1')?.textContent).toContain('Sign in');
      expect(buttonNamed(root, 'Sign in with a passkey')).toBeTruthy();

      await navigate(fixture, '/setup');
      expect(router.url).toBe('/sign-in');
    });

    it('signs in with a passkey and goes back to the page asked for', async () => {
      const { fixture, root } = await visit('/projects', signedOut);
      buttonNamed(root, 'Sign in with a passkey').click();
      http.expectOne(`${API_BASE}/auth/sign-in/options`).flush(requestOptions);
      await tick();
      expect(passkeys.authenticate).toHaveBeenCalledWith(requestOptions);
      const verify = http.expectOne(`${API_BASE}/auth/sign-in/verify`);
      expect(verify.request.body).toEqual({ id: 'cred-1', type: 'public-key' });
      verify.flush({ user: admin });
      await signedInTick(fixture);
      await flushRefresh(fixture, oneZone);

      expect(TestBed.inject(Router).url).toBe('/projects');
      expect(root.querySelector('h1')?.textContent).toContain('Projects');
    });

    it("shows the API's message when the passkey is refused", async () => {
      const { fixture, root } = await visit('/sign-in', signedOut);
      buttonNamed(root, 'Sign in with a passkey').click();
      http.expectOne(`${API_BASE}/auth/sign-in/options`).flush(requestOptions);
      await tick();
      http
        .expectOne(`${API_BASE}/auth/sign-in/verify`)
        .flush(
          { error: { code: 'passkey_failed', message: 'This passkey is not registered with TaleArt' } },
          { status: 401, statusText: 'Unauthorized' },
        );
      await settle(fixture);
      expect(root.querySelector('.form-error')?.textContent).toContain('This passkey is not registered with TaleArt');
      expect(TestBed.inject(Router).url).toBe('/sign-in');
    });

    it('explains when the browser has no passkey support', async () => {
      passkeys.supported.mockReturnValue(false);
      const { root } = await visit('/sign-in', signedOut);
      expect(root.querySelector('.form-error')?.textContent).toContain('does not support passkeys');
      expect(root.querySelector('button')).toBeNull();
    });

    it('signs out from the top bar', async () => {
      const { fixture, root } = await open('/zones', oneZone);
      buttonNamed(root, 'Sign out').click();
      const req = http.expectOne(`${API_BASE}/auth/sign-out`);
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);

      expect(TestBed.inject(Router).url).toBe('/sign-in');
      expect(root.querySelector('h1')?.textContent).toContain('Sign in');
      expect(root.querySelector('nav[aria-label=Main]')).toBeNull();
    });

    it('drops a refresh cut short by a 401 and loads cleanly after the next sign-in', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones');
      const store = TestBed.inject(DashboardStore);
      http.expectOne(`${API_BASE}/projects`).flush([acme]);
      await tick();
      http
        .expectOne(`${API_BASE}/zones`)
        .flush({ error: { code: 'unauthenticated', message: 'Sign in to continue' } }, { status: 401, statusText: 'Unauthorized' });
      await settle(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fzones');
      expect(store.projects()).toEqual([]);
      expect(store.loaded()).toBe(false);
      expect(store.apiDown()).toBe(false);

      buttonNamed(root, 'Sign in with a passkey').click();
      http.expectOne(`${API_BASE}/auth/sign-in/options`).flush(requestOptions);
      await tick();
      http.expectOne(`${API_BASE}/auth/sign-in/verify`).flush({ user: admin });
      await signedInTick(fixture);
      // The new refresh has not answered yet: no empty state flashes.
      expect(store.loaded()).toBe(false);
      expect(root.textContent).not.toContain('Create your first project');
      await flushRefresh(fixture, oneZone);

      expect(TestBed.inject(Router).url).toBe('/zones');
      expect(root.textContent).toContain('Home bar');
      expect(root.querySelector('.banner')).toBeNull();
    });

    it('goes to sign-in when the API answers 401, then back to the page', async () => {
      const { fixture, root } = await open('/projects', { projects: [acme] });
      buttonNamed(root, 'New project').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Globex');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      http
        .expectOne(`${API_BASE}/projects`)
        .flush({ error: { code: 'unauthenticated', message: 'Sign in to continue' } }, { status: 401, statusText: 'Unauthorized' });
      await settle(fixture);

      expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fprojects');
      expect(root.querySelector('h1')?.textContent).toContain('Sign in');
    });
  });

  describe('invitations and roles', () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve));
    const manager = { id: 'u2', name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' };
    const invitation = {
      id: 'i1',
      projectId: 'p1',
      url: 'http://localhost:4200/invite/tok123',
      expiresAt: '2026-10-27T12:00:00.000Z',
    };

    // Opens the invite page for `token`, answering its invitation request with `answer`.
    async function openInvite(
      answer: (req: ReturnType<HttpTestingController['expectOne']>) => void,
    ): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const navigation = TestBed.inject(Router).navigateByUrl('/invite/tok123');
      await tick();
      await navigation;
      await tick();
      answer(http.expectOne(`${API_BASE}/auth/invitations/tok123`));
      await settle(fixture);
      return { fixture, root: fixture.nativeElement as HTMLElement };
    }

    const gone = { error: { code: 'invitation_invalid', message: 'This invitation is no longer valid.' } };

    it('gives each project card "Invite"; the drawer creates the link and copies it', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { fixture, root } = await open('/projects', { projects: [acme, globex], zones: [zone] });
      expect(root.querySelectorAll('[aria-label^="Invite to"]')).toHaveLength(2);

      root.querySelector<HTMLButtonElement>('[aria-label="Invite to Acme"]')?.click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Invite to project');
      expect(drawer()?.textContent).toContain('To project Acme');
      buttonNamed(drawer() as HTMLElement, 'Create link').click();
      const req = http.expectOne(`${API_BASE}/projects/p1/invitations`);
      expect(req.request.method).toBe('POST');
      req.flush(invitation, { status: 201, statusText: 'Created' });
      await settle(fixture);

      expect(drawer()?.querySelector<HTMLInputElement>('#invite-url')?.value).toBe(invitation.url);
      expect(drawer()?.textContent).toContain('2026');
      buttonNamed(drawer() as HTMLElement, 'Copy link').click();
      await settle(fixture);
      expect(writeText).toHaveBeenCalledWith(invitation.url);
      expect(drawer()?.querySelector('[role=status]')?.textContent).toContain('Link copied');

      buttonNamed(drawer() as HTMLElement, 'Done').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
    });

    it('offers "Share link" through the Web Share API where it exists', async () => {
      const share = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'share', { value: share, configurable: true });
      try {
        const { fixture, root } = await open('/projects', { projects: [acme] });
        root.querySelector<HTMLButtonElement>('[aria-label="Invite to Acme"]')?.click();
        await settle(fixture);
        buttonNamed(drawer() as HTMLElement, 'Create link').click();
        http.expectOne(`${API_BASE}/projects/p1/invitations`).flush(invitation, { status: 201, statusText: 'Created' });
        await settle(fixture);

        buttonNamed(drawer() as HTMLElement, 'Share link').click();
        await settle(fixture);
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: invitation.url, title: 'Join Acme on TaleArt' }));
        expect(drawer()?.querySelector('[role=status]')?.textContent).toContain('Link shared');
      } finally {
        delete (navigator as { share?: unknown }).share;
      }
    });

    it('hides "Share link" where the Web Share API is missing', async () => {
      const { fixture, root } = await open('/projects', { projects: [acme] });
      root.querySelector<HTMLButtonElement>('[aria-label="Invite to Acme"]')?.click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create link').click();
      http.expectOne(`${API_BASE}/projects/p1/invitations`).flush(invitation, { status: 201, statusText: 'Created' });
      await settle(fixture);
      expect([...(drawer() as HTMLElement).querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain(
        'Share link',
      );
    });

    it("shows the API's message in the invite drawer", async () => {
      const { fixture, root } = await open('/projects', { projects: [acme] });
      root.querySelector<HTMLButtonElement>('[aria-label="Invite to Acme"]')?.click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create link').click();
      http
        .expectOne(`${API_BASE}/projects/p1/invitations`)
        .flush({ error: { code: 'forbidden', message: 'Only admins can do this' } }, { status: 403, statusText: 'Forbidden' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Only admins can do this');
    });

    it('hides "New project" and "Invite" from a content manager and lists only their projects', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/projects', { setupRequired: false, user: manager });
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
      const root = fixture.nativeElement as HTMLElement;

      expect(root.textContent).not.toContain('New project');
      expect(root.querySelector('[aria-label^="Invite to"]')).toBeNull();
      const options = [...(root.querySelector<HTMLSelectElement>('#project-switcher')?.options ?? [])];
      expect(options.map((o) => o.textContent?.trim())).toEqual(['Acme']);
    });

    it('tells a content manager without projects to ask for an invitation', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones', { setupRequired: false, user: manager });
      await flushRefresh(fixture, {});
      const root = fixture.nativeElement as HTMLElement;
      expect(root.textContent).toContain('Ask an admin to invite you');
      expect(root.textContent).not.toContain('New project');
    });

    it('joins through an invitation link with a passkey and lands on Zones of that project', async () => {
      const { fixture, root } = await openInvite((req) => req.flush({ projectName: 'Acme', expiresAt: invitation.expiresAt }));
      expect(root.querySelector('h1')?.textContent).toContain('Join Acme on TaleArt');
      expect(root.querySelector('nav[aria-label=Main]')).toBeNull();

      type(root.querySelector<HTMLInputElement>('#invite-name'), 'Cy Content');
      type(root.querySelector<HTMLInputElement>('#invite-email'), 'cy@example.com');
      buttonNamed(root, 'Create passkey').click();
      const options = http.expectOne(`${API_BASE}/auth/invitations/tok123/options`);
      expect(options.request.body).toEqual({ name: 'Cy Content', email: 'cy@example.com' });
      options.flush({ challenge: 'c1' });
      await tick();
      expect(passkeys.register).toHaveBeenCalledWith({ challenge: 'c1' });
      const verify = http.expectOne(`${API_BASE}/auth/invitations/tok123/verify`);
      expect(verify.request.body).toEqual({ id: 'cred-1', type: 'public-key' });
      verify.flush({ user: manager }, { status: 201, statusText: 'Created' });
      await tick();
      fixture.detectChanges();
      await tick();
      await flushRefresh(fixture, oneZone);

      expect(TestBed.inject(Router).url).toBe('/zones');
      expect(root.querySelector('h1')?.textContent).toContain('Zones');
      expect(root.textContent).toContain('Home bar');
      expect(root.querySelector('.user-menu')?.textContent).toContain('Cy Content');
    });

    it('says a used or expired link is no longer valid', async () => {
      const { root } = await openInvite((req) => req.flush(gone, { status: 410, statusText: 'Gone' }));
      expect(root.querySelector('h1')?.textContent).toContain('This invitation is no longer valid');
      expect(root.querySelector('form')).toBeNull();
    });

    it('says the link is no longer valid when it was used while the passkey was being created', async () => {
      const { fixture, root } = await openInvite((req) => req.flush({ projectName: 'Acme', expiresAt: invitation.expiresAt }));
      type(root.querySelector<HTMLInputElement>('#invite-name'), 'Cy');
      type(root.querySelector<HTMLInputElement>('#invite-email'), 'cy@example.com');
      buttonNamed(root, 'Create passkey').click();
      http.expectOne(`${API_BASE}/auth/invitations/tok123/options`).flush({ challenge: 'c1' });
      await tick();
      http.expectOne(`${API_BASE}/auth/invitations/tok123/verify`).flush(gone, { status: 410, statusText: 'Gone' });
      await settle(fixture);
      expect(root.querySelector('h1')?.textContent).toContain('This invitation is no longer valid');
    });

    it("shows the API's message when the email is taken", async () => {
      const { fixture, root } = await openInvite((req) => req.flush({ projectName: 'Acme', expiresAt: invitation.expiresAt }));
      type(root.querySelector<HTMLInputElement>('#invite-name'), 'Ada');
      type(root.querySelector<HTMLInputElement>('#invite-email'), 'ada@example.com');
      buttonNamed(root, 'Create passkey').click();
      http
        .expectOne(`${API_BASE}/auth/invitations/tok123/options`)
        .flush(
          { error: { code: 'email_taken', message: 'A user with this email already exists. Sign in instead.' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);
      expect(root.querySelector('.form-error')?.textContent).toContain('already exists');
      expect(root.querySelector('h1')?.textContent).toContain('Join Acme');
    });
  });

  describe('import from Storyly', () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve));
    const importsUrl = `${API_BASE}/projects/p1/imports`;
    const report = {
      zones: { source: 3, imported: 3, skipped: 0 },
      taleGroups: { source: 6, imported: 6, skipped: 0 },
      tales: { source: 15, imported: 14, skipped: 1 },
      notes: [
        'Zone "Home page": frame type unknown',
        'Zone "Product page": frame type unknown',
        'Zone "Checkout": frame type unknown',
      ],
    };
    const progress = (z: [number, number], g: [number, number], t: [number, number]) => ({
      zones: { read: z[0], written: z[1] },
      taleGroups: { read: g[0], written: g[1] },
      tales: { read: t[0], written: t[1] },
    });
    const job = (status: string, extra: object = {}) => ({
      id: 'j1',
      status,
      sourceAppName: 'Demo shop',
      report: null,
      progress: null,
      error: null,
      createdAt: '2026-10-20T12:00:00.000Z',
      startedAt: status === 'queued' ? null : '2026-10-20T12:00:01.000Z',
      finishedAt: null,
      ...extra,
    });
    const run = (id: string, status: string, extra: object = {}) => ({
      id,
      status,
      sourceAppName: 'Demo shop',
      error: null,
      createdAt: '2026-10-20T12:00:00.000Z',
      startedAt: '2026-10-20T12:00:01.000Z',
      finishedAt: status === 'done' || status === 'failed' ? '2026-10-20T12:00:09.000Z' : null,
      ...extra,
    });
    const imported = [
      { id: 'z11', name: 'Home page', projectId: 'p1' },
      { id: 'z12', name: 'Product page', projectId: 'p1' },
      { id: 'z13', name: 'Checkout', projectId: 'p1' },
    ];
    const rows = (root: HTMLElement, label: string) =>
      [...root.querySelectorAll(`[aria-label="${label}"] > li`)].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());

    // The status page polls without waiting, so the tests need not wait 2 s.
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideHttpClient(withInterceptors([unauthorizedInterceptor])),
          provideHttpClientTesting(),
          { provide: PasskeyClient, useValue: passkeys },
          provideRouter(appRoutes, withComponentInputBinding()),
          { provide: IMPORT_POLL_INTERVAL_MS, useValue: 0 },
        ],
      }).compileComponents();
      http = TestBed.inject(HttpTestingController);
    });

    // Answers the past imports list of the form page.
    async function answerHistory(fixture: ComponentFixture<unknown>, body: object, status = 200): Promise<void> {
      await tick();
      const req = http.expectOne((r) => r.method === 'GET' && r.url === importsUrl);
      if (status === 200) req.flush(body);
      else req.flush(body, { status, statusText: 'Error' });
      await settle(fixture);
    }

    // Opens the form page of p1 and answers its past imports.
    async function openForm(history: unknown[] = []): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
      const opened = await open('/projects/p1/import', oneZone);
      await answerHistory(opened.fixture, history);
      return opened;
    }

    // Answers the next read of job j1.
    async function answerPoll(fixture: ComponentFixture<unknown>, body: object, status = 200): Promise<void> {
      await tick();
      const req = http.expectOne(`${importsUrl}/j1`);
      if (status === 200) req.flush(body);
      else req.flush(body, { status, statusText: 'Error' });
      await tick();
      fixture.detectChanges();
    }

    // Pastes the token, finds the apps and starts importing Demo shop, which opens the job's page.
    async function startImport(fixture: ComponentFixture<unknown>, root: HTMLElement): Promise<void> {
      type(root.querySelector<HTMLInputElement>('#import-token'), 'fake-storyly-token');
      buttonNamed(root, 'Find apps').click();
      const find = http.expectOne(`${importsUrl}/storyly/apps`);
      expect(find.request.method).toBe('POST');
      expect(find.request.body).toEqual({ token: 'fake-storyly-token' });
      find.flush([{ id: '1001', name: 'Demo shop' }]);
      await settle(fixture);

      const options = [...(root.querySelector<HTMLSelectElement>('#import-app')?.options ?? [])];
      expect(options.map((o) => o.textContent?.trim())).toEqual(['Demo shop']);
      buttonNamed(root, 'Start import').click();
      const start = http.expectOne((r) => r.method === 'POST' && r.url === importsUrl);
      expect(start.request.body).toEqual({ token: 'fake-storyly-token', appId: '1001' });
      start.flush({ id: 'j1', status: 'queued' }, { status: 202, statusText: 'Accepted' });
      await settle(fixture);
    }

    it('gives admins "Import from Storyly" on each project card, opening the import page', async () => {
      const { fixture, root } = await open('/projects', { projects: [acme, globex], zones: [zone] });
      const links = root.querySelectorAll<HTMLAnchorElement>('[aria-label^="Import from Storyly into"]');
      expect(links).toHaveLength(2);
      expect(links[0].getAttribute('href')).toBe('/projects/p1/import');

      links[0].click();
      await settle(fixture);
      await answerHistory(fixture, []);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import');
      expect(root.querySelector('h2')?.textContent).toContain('Import from Storyly');
      expect(root.textContent).toContain('into Acme');
      expect(root.querySelector<HTMLInputElement>('#import-token')?.type).toBe('password');
    });

    it('hides "Import from Storyly" from a content manager', async () => {
      const manager = { id: 'u2', name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' };
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/projects', { setupRequired: false, user: manager });
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[aria-label^="Import from Storyly"]')).toBeNull();
    });

    it("starts the import, opens its own page and shows its progress rising, then the report", async () => {
      const { fixture, root } = await openForm();
      await startImport(fixture, root);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import/j1');
      expect(root.querySelector('#import-token')).toBeNull();

      await answerPoll(fixture, job('queued', { sourceAppName: null }));
      expect(root.querySelector('[role=status]')?.textContent).toContain('Queued');
      expect(root.textContent).toContain('Waiting to start.');
      expect(root.querySelector('[aria-label=Progress]')).toBeNull();

      await answerPoll(fixture, job('running', { progress: progress([3, 1], [3, 0], [0, 0]) }));
      expect(root.querySelector('[role=status]')?.textContent).toContain('Running');
      expect(root.textContent).toContain('From the app Demo shop');
      expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-20T12:00:01.000Z');
      expect(rows(root, 'Progress')).toEqual(['Zones: 3 read / 1 written', 'Tale groups: 3 read / 0 written', 'Tales: 0 read / 0 written']);

      await answerPoll(fixture, job('running', { progress: progress([3, 2], [5, 4], [11, 9]) }));
      expect(rows(root, 'Progress')).toEqual(['Zones: 3 read / 2 written', 'Tale groups: 5 read / 4 written', 'Tales: 11 read / 9 written']);

      await answerPoll(
        fixture,
        job('done', { report, progress: progress([3, 3], [6, 6], [15, 14]), finishedAt: '2026-10-20T12:00:09.000Z' }),
      );
      expect(root.querySelector('[role=status]')?.textContent).toContain('Done');
      expect(root.querySelector('[aria-label=Progress]')).toBeNull();
      expect(rows(root, 'Report')).toEqual([
        'Zones: 3 source / 3 imported',
        'Tale groups: 6 source / 6 imported',
        'Tales: 15 source / 14 imported / 1 skipped',
      ]);
      expect(rows(root, 'Notes')).toEqual(report.notes);

      // The new zones load, and the Zones page of the project lists them.
      await flushRefresh(fixture, { projects: [acme], zones: [zone, ...imported] });
      [...root.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'See zones')?.click();
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/zones');
      for (const z of imported) expect(root.textContent).toContain(z.name);
    });

    it("keeps following a running import after a reload of its page", async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, job('running', { progress: progress([3, 2], [4, 3], [8, 6]) }));
      expect(root.querySelector('[role=status]')?.textContent).toContain('Running');
      expect(rows(root, 'Progress')).toEqual(['Zones: 3 read / 2 written', 'Tale groups: 4 read / 3 written', 'Tales: 8 read / 6 written']);

      // A failed read while it runs shows the message and tries again at the next poll.
      await answerPoll(fixture, { error: { code: 'internal', message: 'Something went wrong' } }, 500);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');

      await answerPoll(fixture, job('done', { report, progress: progress([3, 3], [6, 6], [15, 14]), finishedAt: '2026-10-20T12:00:09.000Z' }));
      expect(root.querySelector('[role=alert]')).toBeNull();
      expect(rows(root, 'Report')[0]).toBe('Zones: 3 source / 3 imported');
      await flushRefresh(fixture, { projects: [acme], zones: [zone, ...imported] });
    });

    it('shows only the zones row for a report stored before tale groups were imported', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const zonesOnly = { zones: report.zones, notes: report.notes };
      await answerPoll(fixture, job('done', { report: zonesOnly, finishedAt: '2026-10-20T12:00:05.000Z' }));
      expect(rows(root, 'Report')).toEqual(['Zones: 3 source / 3 imported']);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it("shows the API's message for a refused token and starts nothing", async () => {
      const { fixture, root } = await openForm();
      type(root.querySelector<HTMLInputElement>('#import-token'), 'wrong');
      buttonNamed(root, 'Find apps').click();
      http.expectOne(`${importsUrl}/storyly/apps`).flush(
        { error: { code: 'storyly_token_invalid', message: 'Storyly refused this API token. Check the token and try again.' } },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Storyly refused this API token');
      expect(root.querySelector('#import-app')).toBeNull();
      expect(root.textContent).not.toContain('Start import');
    });

    it("shows a failed job's reason and how far it got, and leads back to the form", async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('failed', {
          error: 'Storyly answered 500 when listing stories',
          progress: progress([3, 1], [3, 0], [0, 0]),
          finishedAt: '2026-10-20T12:00:03.000Z',
        }),
      );
      expect(root.querySelector('[role=status]')?.textContent).toContain('Failed');
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Storyly answered 500 when listing stories');
      expect(rows(root, 'Progress')[0]).toBe('Zones: 3 read / 1 written');
      expect(root.textContent).not.toContain('See zones');

      [...root.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Start another import')?.click();
      await settle(fixture);
      await answerHistory(fixture, [run('j1', 'failed', { error: 'Storyly answered 500 when listing stories' })]);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import');
      expect(root.querySelector('#import-token')).not.toBeNull();
    });

    it("lists the project's past imports with state, times and failure reason, each opening its report", async () => {
      const { fixture, root } = await openForm([
        run('j3', 'running'),
        run('j2', 'failed', { error: 'Storyly answered 500 when listing instances', sourceAppName: null }),
        run('j1', 'done'),
      ]);
      const items = [...root.querySelectorAll<HTMLElement>('[aria-label="Past imports"] > li')];
      expect(items).toHaveLength(3);
      expect(items.map((li) => li.querySelector('.pill')?.textContent?.trim())).toEqual(['Running', 'Failed', 'Done']);
      expect(items[0].textContent).toContain('Demo shop');
      expect(items[1].textContent).toContain('App not read yet');
      expect(items[1].textContent).toContain('Storyly answered 500 when listing instances');
      expect(items[0].textContent).not.toContain('Storyly answered');
      expect([...items[2].querySelectorAll('time')].map((t) => t.getAttribute('datetime'))).toEqual([
        '2026-10-20T12:00:01.000Z',
        '2026-10-20T12:00:09.000Z',
      ]);
      expect(items[0].textContent?.replace(/\s+/g, ' ')).toContain('Finished not yet');
      const links = items.map((li) => li.querySelector<HTMLAnchorElement>('a'));
      expect(links.map((a) => a?.textContent?.trim())).toEqual(['View progress', 'View report', 'View report']);
      expect(links.map((a) => a?.getAttribute('href'))).toEqual([
        '/projects/p1/import/j3',
        '/projects/p1/import/j2',
        '/projects/p1/import/j1',
      ]);

      links[2]?.click();
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import/j1');
      await answerPoll(fixture, job('done', { report, progress: progress([3, 3], [6, 6], [15, 14]), finishedAt: '2026-10-20T12:00:09.000Z' }));
      expect(rows(root, 'Report')).toHaveLength(3);
      await flushRefresh(fixture, { projects: [acme], zones: [zone, ...imported] });
    });

    it('says so when the project has no imports yet', async () => {
      const { root } = await openForm([]);
      expect(root.textContent).toContain('No imports into this project yet.');
    });

    it('shows a message when the past imports cannot be read', async () => {
      const { fixture, root } = await open('/projects/p1/import', oneZone);
      await answerHistory(fixture, { error: { code: 'internal', message: 'Something went wrong' } }, 500);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');
      expect(root.querySelector('#import-token')).not.toBeNull();
    });

    it('tries a first read that failed on a server error again at the next poll', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, { error: { code: 'internal', message: 'Something went wrong' } }, 500);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');
      await answerPoll(fixture, job('running', { progress: progress([3, 1], [3, 0], [0, 0]) }));
      expect(root.querySelector('[role=alert]')).toBeNull();
      expect(rows(root, 'Progress')[0]).toBe('Zones: 3 read / 1 written');
      await answerPoll(fixture, job('failed', { error: 'Stopped', finishedAt: '2026-10-20T12:00:03.000Z' }));
    });

    it('follows another import when only the import id in the URL changes', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, job('running', { progress: progress([3, 2], [4, 3], [8, 6]) }));
      expect(rows(root, 'Progress')[0]).toBe('Zones: 3 read / 2 written');

      const page = fixture.debugElement.query(By.css('app-import-job-page')).componentInstance;
      await TestBed.inject(Router).navigateByUrl('/projects/p1/import/j2');
      await tick();
      // The same page, now following j2; a read of j1 still in flight is ignored.
      expect(fixture.debugElement.query(By.css('app-import-job-page')).componentInstance).toBe(page);
      for (const req of http.match(`${importsUrl}/j1`)) req.flush(job('running', { progress: progress([3, 3], [5, 5], [9, 9]) }));
      await tick();
      fixture.detectChanges();
      expect(root.querySelector('[aria-label=Progress]')).toBeNull();
      expect(root.textContent).toContain('Loading the import');

      http.expectOne(`${importsUrl}/j2`).flush({ ...job('failed', { error: 'Storyly answered 500 when listing apps' }), id: 'j2' });
      await tick();
      fixture.detectChanges();
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Storyly answered 500 when listing apps');
      await tick();
      http.expectNone(`${importsUrl}/j1`);
      http.expectNone(`${importsUrl}/j2`);
    });

    it('shows the message of an import it cannot read, without polling again', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, { error: { code: 'not_found', message: 'This project has no import with this id' } }, 404);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('This project has no import with this id');
      await tick();
      http.expectNone(`${importsUrl}/j1`);
    });

    it('does not read again an import it may not read', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, { error: { code: 'forbidden', message: 'Only admins can do this' } }, 403);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Only admins can do this');
      await tick();
      http.expectNone(`${importsUrl}/j1`);
    });

    it('asks for a token before finding apps', async () => {
      const { fixture, root } = await openForm();
      buttonNamed(root, 'Find apps').click();
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Paste a Storyly API token');
    });
  });
});
