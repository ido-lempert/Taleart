import { CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpEventType, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { App, API_BASE, API_ORIGIN } from './app';
import { API_RETRY_TIMING, type ApiRetryTiming } from './api-reconnect';
import { appRoutes } from './app.routes';
import { PasskeyClient, unauthorizedInterceptor } from './auth';
import { CoverCapture } from './cover-capture';
import { DashboardStore, SELECTED_PROJECT_KEY } from './dashboard.store';
import { IMPORT_POLL_INTERVAL_MS } from './import.service';
import { importDurationText } from './pages/import-shared';
import { describeWindow, formatShort } from './schedule';

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
const group = {
  id: 'g1',
  zoneIds: ['z1'],
  projectId: 'p1',
  name: 'Summer',
  status: 'live',
  storedStatus: 'live',
  startsAt: null as string | null,
  endsAt: null as string | null,
  position: 0,
  tags: [] as unknown[],
};
const taleA = { id: 't1', taleGroupId: 'g1', projectId: 'p1', title: 'A', position: 0, status: 'live', storedStatus: 'live', startsAt: null as string | null, endsAt: null as string | null, media: null };
const taleB = { id: 't2', taleGroupId: 'g1', projectId: 'p1', title: 'B', position: 1, status: 'live', storedStatus: 'live', startsAt: null as string | null, endsAt: null as string | null, media: null };
const pngMedia = { kind: 'image', contentType: 'image/png', url: '/api/v1/tales/t1/media' };
const mp4Media = { kind: 'video', contentType: 'video/mp4', url: '/api/v1/tales/t2/media' };
const MEDIA_ORIGIN = API_ORIGIN;
const admin = { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' };
const signedIn = { setupRequired: false, user: admin };
const frameBar = { id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} };

/**
 * A tale group as the project's list sends it (epic UX rework R14): its own fields and its tale
 * counts, not its tales; `tales` Shown tales (or the counts of `fields.tales`), Off (`draft`) in no
 * zone and not visible by default.
 */
function projectGroup(fields: Record<string, unknown> & { id: string; name: string }, tales = 0): Record<string, unknown> {
  const stored = (fields['storedStatus'] as string | undefined) ?? (fields['status'] as string | undefined) ?? 'draft';
  const { tales: given, ...own } = fields as { tales?: { storedStatus: string }[] };
  const total = given ? given.length : tales;
  const shown = given ? given.filter((t) => t.storedStatus === 'live').length : tales;
  return {
    projectId: 'p1',
    status: stored,
    storedStatus: stored,
    startsAt: null,
    endsAt: null,
    cover: null,
    tags: [],
    zoneIds: [],
    visibility: { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] },
    ...own,
    taleCount: total,
    shownTaleCount: shown,
  };
}

interface Data {
  projects?: { id: string }[];
  zones?: ({ id: string } & Record<string, unknown>)[];
  /** Each zone's display (its one frame, AD-17), keyed by zone id; none when missing. */
  displays?: Record<string, unknown>;
  groups?: Record<string, unknown[]>;
  /** Each project's tags, keyed by project id. */
  tags?: Record<string, unknown[]>;
  /** Each project's tale groups (the Tale groups page), keyed by project id. */
  projectGroups?: Record<string, unknown[]>;
  /** Tale groups read on their own with their tales (`GET /tale-groups/{id}`, story 8.19), keyed by id; 404 when missing. */
  readGroups?: Record<string, unknown>;
}

const oneZone: Data = { projects: [acme], zones: [zone] };

// Waits for Angular and then one macrotask, so refresh() reaches its next
// request (or its end) after chained awaits that whenStable() does not track.
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

/**
 * What the zone page's live region says: the group view's own region while it is open (epic UX
 * rework R11), else the page's.
 */
function announced(root: ParentNode): string | undefined {
  const region =
    root.querySelector('app-group-view [aria-live=polite]') ?? root.querySelector('[aria-live=polite]');
  return region?.textContent ?? undefined;
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`No ${name} button`);
  return button;
}

// Opens the ⋯ menu named `menu` and chooses its item `item`.
function pickMenuItem(root: ParentNode, menu: string, item: string): void {
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${menu}"]`);
  if (!trigger) throw new Error(`No ${menu} menu`);
  trigger.click();
  const items = [...document.querySelectorAll<HTMLElement>(`#${trigger.getAttribute('aria-controls')} [role=menuitem]`)];
  const found = items.find((i) => i.firstElementChild?.textContent?.trim() === item);
  if (!found) throw new Error(`No ${item} in ${menu}`);
  found.click();
}

/** A ⋯ menu's items as it shows them, each with its disabled reason; the menu is closed again. */
function menuItems(root: ParentNode, menu: string): { label: string; reason: string; disabled: boolean }[] {
  const trigger = root.querySelector<HTMLButtonElement>(`button[aria-label="${menu}"]`);
  if (!trigger) throw new Error(`No ${menu} menu`);
  trigger.click();
  const items = [...document.querySelectorAll<HTMLElement>(`#${trigger.getAttribute('aria-controls')} [role=menuitem]`)].map(
    (item) => ({
      label: item.firstElementChild?.textContent?.trim() ?? '',
      reason: item.querySelector('.menu-button__reason')?.textContent?.trim() ?? '',
      disabled: item.getAttribute('aria-disabled') === 'true',
    }),
  );
  trigger.click();
  return items;
}

/** Every item of a group row's ⋯ menu, in order (epic UX rework R10). */
const GROUP_MENU = ['Rename', 'Cover', 'Audience', 'Schedule', 'Show in another zone', 'Copy to zone', 'Remove from this zone', 'Archive'];

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

// The open drawer on top, leaving out the group view (epic UX rework R11) under it.
function drawer(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[role=dialog]')].filter((d) => !d.classList.contains('drawer--wide')).at(-1) ?? null;
}

// The open group view (epic UX rework R11), or null.
function groupView(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role=dialog].drawer--wide');
}

// Stands in for drawing and recording video in the browser, which jsdom cannot do.
const capture = {
  canRecord: vi.fn(() => true),
  captureFrame: vi.fn<(video: HTMLVideoElement) => Promise<Blob>>(),
  seekTo: vi.fn<(video: HTMLVideoElement, time: number) => Promise<void>>(),
  recordClip: vi.fn<(video: HTMLVideoElement, start: number, seconds: number, signal?: AbortSignal) => Promise<Blob>>(),
};

// Stands in for the browser's WebAuthn calls.
const passkeys = {
  supported: vi.fn(() => true),
  register: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
  authenticate: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
};

describe('App', () => {
  let http: HttpTestingController;
  let retryTiming: ApiRetryTiming;

  beforeEach(async () => {
    localStorage.clear();
    passkeys.supported.mockReturnValue(true);
    // The banner's retries wait for the test to ask; tests of them retry at once.
    retryTiming = { delaysMs: [3_600_000], tryTimeoutMs: 3_600_000, announceMs: 3_600_000 };
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(withInterceptors([unauthorizedInterceptor])),
        provideHttpClientTesting(),
        { provide: API_RETRY_TIMING, useFactory: () => retryTiming },
        { provide: PasskeyClient, useValue: passkeys },
        { provide: CoverCapture, useValue: capture },
        provideRouter(appRoutes, withComponentInputBinding()),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  // The zone page's Install tab (epic UX rework R3, R13) reads its project's site key and the
  // install URLs on its own.
  function flushSiteKeys(): void {
    for (const req of http.match((r) => r.method === 'GET' && r.url.endsWith('/site-key'))) req.flush(null);
    for (const req of http.match((r) => r.method === 'GET' && r.url.endsWith('/install'))) {
      req.flush({ apiUrl: 'http://api.test', sdkUrl: 'http://api.test/sdk/v1/taleart.js', testPageUrl: 'http://api.test/sdk/v1/test-page' });
    }
  }

  // A project's tale group list is read only where a page needs it (epic UX rework R14), by the
  // refresh or on its own: answers every such read waiting now.
  // The data the last refresh answered with: a page opened later reads its project's list from it.
  let lastData: Data = {};
  function flushProjectGroups(data: Data = lastData): void {
    for (const req of http.match((r) => r.method === 'GET' && /\/projects\/[^/]+\/tale-groups$/.test(r.url))) {
      const projectId = req.request.url.split('/').at(-2) ?? '';
      req.flush(data.projectGroups?.[projectId] ?? []);
    }
  }

  // A tale group read on its own (story 8.19), when a page opens it: answers every such read waiting now.
  function flushReadGroups(data: Data = lastData): void {
    for (const req of http.match((r) => r.method === 'GET' && /\/v1\/tale-groups\/[^/]+$/.test(r.url))) {
      const found = data.readGroups?.[req.request.url.split('/').at(-1) ?? ''];
      if (found) req.flush(found);
      else req.flush({ error: { code: 'tale_group_not_found', message: 'No tale group' } }, { status: 404, statusText: 'Not Found' });
    }
  }

  afterEach(() => {
    flushSiteKeys();
    flushProjectGroups({});
    flushReadGroups({});
    lastData = {};
    http.verify();
  });

  // Answers one full refresh: projects, zones (each with its slug and display), frame types, each zone's tale
  // groups, each project's tags and tale groups, then the site key card's own request.
  // `projectsRead: false` when the test answered the projects read itself.
  async function flushRefresh(fixture: ComponentFixture<unknown>, data: Data, { projectsRead = true } = {}): Promise<void> {
    lastData = data;
    const zones = data.zones ?? [];
    if (projectsRead) {
      http.expectOne(`${API_BASE}/projects`).flush(data.projects ?? []);
      await settle(fixture);
    }
    http.expectOne(`${API_BASE}/zones`).flush(
      zones.map((z) => ({
        slug: z.id,
        ...z,
        frame: data.displays?.[z.id] ?? (z as { frame?: unknown }).frame ?? null,
      })),
    );
    await settle(fixture);
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await settle(fixture);
    for (const z of zones) {
      http.expectOne(`${API_BASE}/zones/${z.id}/tale-groups`).flush(data.groups?.[z.id] ?? []);
    }
    await settle(fixture);
    for (const p of data.projects ?? []) http.expectOne(`${API_BASE}/projects/${p.id}/tags`).flush(data.tags?.[p.id] ?? []);
    await settle(fixture);
    flushProjectGroups(data);
    await settle(fixture);
    flushReadGroups(data);
    await settle(fixture);
    flushSiteKeys();
    flushProjectGroups(data);
    flushReadGroups(data);
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
    flushProjectGroups();
    await settle(fixture);
  }

  // Opens a page with `data`. On a zone page, every group is opened too (`expand`), as a person
  // does to reach its tale strip (epic UX rework R10), unless the test checks the closed rows.
  async function open(
    url: string,
    data: Data,
    expand = url.startsWith('/zones/'),
  ): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    // As the app's first navigation does: Back and Forward (popstate) navigate.
    TestBed.inject(Router).setUpLocationChangeListener();
    await navigate(fixture, url);
    await flushRefresh(fixture, data);
    await settle(fixture);
    const root = fixture.nativeElement as HTMLElement;
    if (expand) await expandGroups(fixture, root);
    return { fixture, root };
  }

  // Opens the zone page's first group in its group view (epic UX rework R11), showing its tales;
  // `name` opens that group instead.
  async function expandGroups(fixture: ComponentFixture<unknown>, root: HTMLElement, name?: string): Promise<void> {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.group-row__open')];
    const button = name === undefined ? buttons[0] : buttons.find((b) => b.textContent?.trim() === name);
    button?.click();
    await settle(fixture);
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

  // A full project's refusal (epic UX rework R14, story 8.22) and the message the drawers show for it.
  const fullCreate =
    'This project already has 500 tale groups that are not archived, the most it can hold. Archive a tale group to make room.';
  const fullCopy =
    'The project of that zone already has 500 tale groups that are not archived, the most it can hold. Archive a tale group there to make room.';
  const groupLimit = (message: string) => ({ error: { code: 'tale_group_limit_reached', message } });

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
      expect(root.querySelector('.banner')?.textContent?.trim()).toBe("We can't reach TaleArt. Retrying…");
      expect(root.querySelector('nav[aria-label=Main]')).not.toBeNull();
    });

    // The retry timing itself is covered in api-reconnect.spec.ts; here each retry runs at once.
    // Runs the reconnect's effect and its 0 ms timer, without whenStable() (which would wait for requests).
    async function retryTick(): Promise<void> {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
      await new Promise((resolve) => setTimeout(resolve));
    }

    it('says the API is unreachable politely, retries, and clears the banner when the API answers', async () => {
      retryTiming.delaysMs = [0];
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones');
      const root = fixture.nativeElement as HTMLElement;
      const focused = document.activeElement;
      http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
      await settle(fixture);

      const region = root.querySelector('.api-status');
      expect(region?.getAttribute('role')).toBe('status');
      expect(region?.querySelector('.banner')?.textContent?.trim()).toBe("We can't reach TaleArt. Retrying…");
      expect(root.querySelector('[role=alert]')).toBeNull();
      expect(root.textContent).not.toContain('3333');
      expect(document.activeElement).toBe(focused);

      // The retry fails too: the banner stays and another retry follows, one at a time.
      await retryTick();
      http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
      await settle(fixture);
      expect(root.querySelector('.banner')).not.toBeNull();

      await retryTick();
      await flushRefresh(fixture, oneZone);
      await settle(fixture);
      expect(root.querySelector('.banner')).toBeNull();
      expect(root.querySelector('.api-status')?.textContent?.trim()).toBe('Connected to TaleArt again.');
      expect(root.textContent).toContain('Home bar');
      // No retry runs once the API answers.
      await settle(fixture);
      http.expectNone(`${API_BASE}/projects`);
    });

    it('retries at once when the browser comes back online', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones');
      http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
      await settle(fixture);

      window.dispatchEvent(new Event('online'));
      await flushRefresh(fixture, oneZone);
      expect((fixture.nativeElement as HTMLElement).querySelector('.banner')).toBeNull();
    });

    it('reads the auth state again when the API was down from the start, and loads the data once', async () => {
      retryTiming.delaysMs = [0];
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const navigation = TestBed.inject(Router).navigateByUrl('/zones');
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne(`${API_BASE}/auth/state`).error(new ProgressEvent('error'));
      await navigation;
      await new Promise((resolve) => setTimeout(resolve));
      const root = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      expect(root.querySelector('.banner')).not.toBeNull();

      await retryTick();
      http.expectOne(`${API_BASE}/auth/state`).flush(signedIn);
      await settle(fixture);
      // flushRefresh expects exactly one request per step: the sign-in effect and the retry share one load.
      await flushRefresh(fixture, oneZone);
      expect(root.querySelector('.banner')).toBeNull();
      expect(root.textContent).toContain('Home bar');
    });

    it('opens sign-in when the API comes back and nobody is signed in', async () => {
      retryTiming.delaysMs = [0];
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const navigation = TestBed.inject(Router).navigateByUrl('/zones');
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne(`${API_BASE}/auth/state`).error(new ProgressEvent('error'));
      await navigation;
      await retryTick();
      http.expectOne(`${API_BASE}/auth/state`).flush({ setupRequired: false, user: null });
      await settle(fixture);
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fzones');
      expect((fixture.nativeElement as HTMLElement).querySelector('.banner')).toBeNull();
    });

    it('goes to sign-in, with no banner and no announcement, when a retry is answered 401', async () => {
      retryTiming.delaysMs = [0];
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones');
      http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
      await settle(fixture);

      await retryTick();
      http
        .expectOne(`${API_BASE}/projects`)
        .flush({ error: { code: 'unauthenticated', message: 'Sign in to continue' } }, { status: 401, statusText: 'Unauthorized' });
      await settle(fixture);
      await settle(fixture);

      const root = fixture.nativeElement as HTMLElement;
      expect(TestBed.inject(Router).url).toBe('/sign-in?returnUrl=%2Fzones');
      expect(root.querySelector('.banner')).toBeNull();
      expect(root.textContent).not.toContain('Connected to TaleArt again.');
      http.expectNone(`${API_BASE}/projects`);
    });

    it('announces nothing when the user signs out while the API is down', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones');
      http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
      await settle(fixture);
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('.banner')).not.toBeNull();

      buttonNamed(root, 'Sign out').click();
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne(`${API_BASE}/auth/sign-out`).flush(null);
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/sign-in');
      expect(root.querySelector('.banner')).toBeNull();
      expect(root.textContent).not.toContain('Connected to TaleArt again.');
    });

    // Report §6 #15: frames were named "Frame 1 · Bar"; a zone now has one display (story 8.5).
    for (const url of ['/zones', '/zones/z1', '/tale-groups', '/projects']) {
      it(`names no frame on ${url}: neither in its text nor in its labels`, async () => {
        const second = { id: 'z3', name: 'Product page', projectId: 'p1' };
        const { root } = await open(url, {
          projects: [acme],
          zones: [zone, second],
          displays: { z1: frameBar, z3: { ...frameBar, id: 'f3', zoneId: 'z3', type: 'banner' } },
          groups: { z1: [{ ...group, tales: [taleA, taleB] }] },
          projectGroups: { p1: [projectGroup({ ...group, zoneIds: ['z1'], tales: [taleA, taleB] })] },
        });
        const labels = [...root.querySelectorAll('*')].flatMap((el) =>
          ['title', 'aria-label', 'placeholder'].map((name) => el.getAttribute(name) ?? ''),
        );
        for (const text of [root.textContent ?? '', ...labels]) {
          expect(text).not.toMatch(/\bframes?\b/i);
          expect(text).not.toMatch(/·\s*(Bar|Banner)\b/);
        }
      });
    }

    for (const url of ['/zones', '/zones/z1', '/projects']) {
      it(`shows only the banner, not an empty or not-found state, on ${url} when the API is down`, async () => {
        const fixture = TestBed.createComponent(App);
        fixture.detectChanges();
        await navigate(fixture, url);
        http.expectOne(`${API_BASE}/projects`).error(new ProgressEvent('error'));
        await settle(fixture);

        const root = fixture.nativeElement as HTMLElement;
        expect(root.querySelector('.banner')?.textContent).toContain("We can't reach TaleArt");
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

    it('shows a card per zone of the selected project with its slug, display type and tale group count', async () => {
      const { root } = await open('/zones', {
        projects: [acme, globex],
        zones: [zone, otherZone],
        displays: { z1: frameBar },
        groups: { z1: [{ ...group, tales: [] }] },
      });

      const cards = root.querySelector('[aria-label=Zones]');
      expect(cards?.textContent).toContain('Home bar');
      expect(cards?.textContent).not.toContain('Checkout');
      expect(cards?.querySelector('.pill')?.textContent).toContain('Display: Bar');
      expect(cards?.querySelector('.zone-card__slug')?.textContent).toContain('z1');
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

    it("creates a zone from the drawer, closes it and opens the new zone's page", async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });

      buttonNamed(root, 'New zone').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Home bar');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await answerCreate(
        fixture,
        `${API_BASE}/zones`,
        { name: 'Home bar', projectId: 'p1', template: 'stories-bar' },
        zone,
        oneZone,
      );
      flushSiteKeys();
      await settle(fixture);

      expect(drawer()).toBeNull();
      // The new zone's page is the next step (story 8.13: the first run in 15 actions).
      expect(TestBed.inject(Router).url).toBe(`/zones/${zone.id}`);
      expect(root.querySelector('#zone-title')?.textContent).toContain(zone.name);
      expect(document.activeElement?.id).toBe('zone-title');
    });

    it('keeps the zone drawer open with the API message when a zone is refused', async () => {
      const { fixture } = await open('/zones', { projects: [acme] });

      buttonNamed(fixture.nativeElement, 'New zone').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
      // A name refusal marks the name, not the slug.
      expect(drawer()?.querySelector('#create-text')?.getAttribute('aria-invalid')).toBe('true');
      expect(drawer()?.querySelector('#create-slug')?.getAttribute('aria-invalid')).toBeNull();
      // Focus goes to the refused field, so the error is read with it (story 8.17).
      expect(document.activeElement?.id).toBe('create-text');
    });

    it('previews the slug made from the name, and requires one when a Hebrew name gives none', async () => {
      const { fixture } = await open('/zones', {
        projects: [acme, globex],
        zones: [
          { ...zone, slug: 'home-page' },
          { ...otherZone, slug: 'home-page-2' },
        ],
      });
      buttonNamed(fixture.nativeElement, 'New zone').click();
      await settle(fixture);
      const name = drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null;
      const slug = drawer()?.querySelector<HTMLInputElement>('#create-slug') ?? null;
      const hint = () => drawer()?.querySelector('#create-slug-hint')?.textContent?.replace(/\s+/g, ' ') ?? '';

      type(name, 'Home page!');
      await settle(fixture);
      // Made unique against the picked project's zones only, as the API does.
      expect(hint()).toContain('Left empty, it is home-page-2.');

      type(name, 'דף הבית');
      await settle(fixture);
      expect(hint()).toContain('This name gives none: enter one.');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      http.expectNone(`${API_BASE}/zones`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('This name gives no slug');
      expect(slug?.getAttribute('aria-invalid')).toBe('true');
      expect(slug?.getAttribute('aria-describedby')).toBe('create-slug-hint create-error');
      expect(name?.getAttribute('aria-invalid')).toBeNull();

      type(slug, 'home');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/zones`);
      expect(req.request.body).toEqual({ name: 'דף הבית', projectId: 'p1', slug: 'home', template: 'stories-bar' });
      req.flush(
        { error: { code: 'slug_taken', message: 'Another zone of this project already has the slug "home"' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('already has the slug "home"');
      expect(slug?.getAttribute('aria-invalid')).toBe('true');
      expect(name?.getAttribute('aria-invalid')).toBeNull();
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
    it('shows the zone header with its slug, its display and a tale group row of tale cards in order', async () => {
      const { root } = await open('/zones/z1', {
        ...oneZone,
        displays: { z1: frameBar },
        groups: { z1: [{ ...group, tales: [taleA, taleB] }] },
      });

      expect(root.querySelector('.page-header')?.textContent).toContain('Home bar');
      expect(root.querySelector('.page-header')?.textContent).toContain('in Acme');
      expect(root.querySelector('.page-header .zone-slug')?.textContent).toContain('z1');
      expect(root.querySelector('#display-type')?.textContent).toContain('Bar');
      const row = root.querySelector('[aria-label="Tale groups in Home bar"] li');
      expect(row?.textContent).toContain('Summer');
      expect(row?.textContent).toContain('2 of 2 shown');
      const cards = [...root.querySelectorAll('[aria-label="Tales in Summer"] .tale-card__title')];
      expect(cards.map((c) => c.textContent?.trim())).toEqual(['A', 'B']);
      expect(root.querySelector('#group-view-add-tale')?.textContent).toContain('Add tale');
    });

    it('shows "Zone not found" with a link back for an unknown zone', async () => {
      const { root } = await open('/zones/nope', oneZone);

      expect(root.textContent).toContain('Zone not found');
      expect(root.querySelector('.empty a[href="/zones"]')?.textContent).toContain('Back to zones');
    });

    it('has a Display card and no Frames or Stages card', async () => {
      const { root } = await open('/zones/z1', { ...oneZone, displays: { z1: frameBar } });
      const titles = [...root.querySelectorAll('.section__title')].map((h) => h.textContent?.trim());
      expect(titles).toContain('Display');
      expect(titles).not.toContain('Frames');
      expect(titles).not.toContain('Stages');
      expect(root.textContent).not.toContain('stage');
      expect([...root.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Add stage');
      expect(root.querySelector('#stages-title, #frames-title')).toBeNull();
    });

    it('renames a zone and changes its slug, marking only the slug when the API refuses it', async () => {
      const store = TestBed.inject(DashboardStore);
      const { fixture, root } = await open('/zones/z1', oneZone);
      buttonNamed(root, 'Edit name and slug').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Name and slug');
      const name = drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null;
      const slug = drawer()?.querySelector<HTMLInputElement>('#create-slug') ?? null;
      expect([name?.value, slug?.value]).toEqual(['Home bar', 'z1']);

      type(name, 'דף הבית');
      type(slug, 'Home Top');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      let req = http.expectOne(`${API_BASE}/zones/z1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'דף הבית', slug: 'Home Top' });
      req.flush(
        {
          error: {
            code: 'validation_failed',
            message: 'slug must be lowercase letters and digits, words joined by single hyphens, at most 64 characters',
          },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('slug must be lowercase');
      expect(slug?.getAttribute('aria-invalid')).toBe('true');
      expect(name?.getAttribute('aria-invalid')).toBeNull();
      expect(document.activeElement).toBe(slug);

      type(slug, 'home-top');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      req = http.expectOne(`${API_BASE}/zones/z1`);
      expect(req.request.body).toEqual({ name: 'דף הבית', slug: 'home-top' });
      req.flush({ ...zone, name: 'דף הבית', slug: 'home-top', frame: null });
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(store.zone('z1')?.slug).toBe('home-top');
      expect(root.querySelector('.page-header__title')?.textContent).toContain('דף הבית');
      expect(root.querySelector('.page-header .zone-slug')?.textContent).toContain('home-top');
    });

    it('sets the display picked in the drawer', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);
      expect(root.textContent).toContain('No display yet');
      expect(root.querySelector('#display-type-select')).toBeNull();

      buttonNamed(root, 'Choose display').click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Choose a display');
      const select = drawer()?.querySelector<HTMLSelectElement>('select') ?? null;
      expect([...(select?.options ?? [])].map((o) => o.textContent?.trim())).toEqual([
        'Choose a display type',
        'Bar',
        'Banner',
      ]);
      // Nothing is sent before a type is picked.
      buttonNamed(drawer() as HTMLElement, 'Set display').click();
      await settle(fixture);
      http.expectNone(`${API_BASE}/zones/z1/frame`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Choose a display type.');

      choose(select, 'bar');
      buttonNamed(drawer() as HTMLElement, 'Set display').click();
      await answerCreate(fixture, `${API_BASE}/zones/z1/frame`, { type: 'bar' }, frameBar, {
        ...oneZone,
        displays: { z1: frameBar },
      });

      expect(drawer()).toBeNull();
      expect(root.querySelector('#display-type')?.textContent).toContain('Bar');
      // A zone has one display: no second one can be added.
      expect([...root.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Choose display');
    });

    it('shows the API message in the display drawer when a display is refused', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);

      buttonNamed(root, 'Choose display').click();
      await settle(fixture);
      choose(drawer()?.querySelector<HTMLSelectElement>('select') ?? null, 'banner');
      buttonNamed(drawer() as HTMLElement, 'Set display').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z1/frame`)
        .flush(
          { error: { code: 'display_exists', message: 'This zone already has a display; a zone has one.' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('already has a display');
    });

    describe('display type', () => {
      const bannerDefaults = { aspectRatio: '16:9', autoplay: true, intervalSeconds: 5, showDots: true, loop: true };
      const barDefaults = { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 };
      const typeSelect = (root: HTMLElement) => root.querySelector<HTMLSelectElement>('#display-type-select');

      it('switches bar to banner and back, resetting the settings, and announces each change', async () => {
        const store = TestBed.inject(DashboardStore);
        const barWithGap = { ...frameBar, settings: { ...barDefaults, gap: 20 } };
        const { fixture, root } = await open('/zones/z1', { ...oneZone, displays: { z1: barWithGap } });
        expect(typeSelect(root)?.value).toBe('bar');
        expect(buttonNamed(root, 'Change type').disabled).toBe(true);
        expect(root.querySelector('[aria-label="Display settings"]')?.textContent).toContain('20');

        for (const [type, label, settings] of [
          ['banner', 'Banner', bannerDefaults],
          ['bar', 'Bar', barDefaults],
        ] as const) {
          choose(typeSelect(root), type);
          await settle(fixture);
          expect(buttonNamed(root, 'Change type').disabled).toBe(false);
          buttonNamed(root, 'Change type').click();
          await settle(fixture);
          const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
          expect(req.request.method).toBe('PATCH');
          expect(req.request.body).toEqual({ type });
          req.flush({ ...frameBar, type, settings });
          await settle(fixture);

          expect(root.querySelector('#display-type')?.textContent).toContain(label);
          expect(store.displayOf('z1')).toEqual({ ...frameBar, type, settings });
          expect(typeSelect(root)?.value).toBe(type);
          expect(buttonNamed(root, 'Change type').disabled).toBe(true);
          expect(announced(root)).toContain(
            `The display is now a ${label.toLowerCase()}, with its default settings.`,
          );
        }
        // The banner's schema here has no fields: no Settings button; the bar's has.
        expect(root.querySelector('.display-row button')).not.toBeNull();
      });

      it("shows the API's message when a type change is refused, and keeps the display", async () => {
        const { fixture, root } = await open('/zones/z1', { ...oneZone, displays: { z1: frameBar } });
        choose(typeSelect(root), 'banner');
        await settle(fixture);
        buttonNamed(root, 'Change type').click();
        await settle(fixture);
        http
          .expectOne(`${API_BASE}/zones/z1/frame`)
          .flush({ error: { code: 'unknown_frame_type', message: '"banner" is not a frame type' } }, { status: 400, statusText: 'Bad Request' });
        await settle(fixture);
        expect(root.querySelector('.display-type [role=alert]')?.textContent).toContain('is not a frame type');
        expect(root.querySelector('#display-type')?.textContent).toContain('Bar');
      });
    });

    describe('display settings', () => {
      const frameBanner = { id: 'f2', zoneId: 'z1', projectId: 'p1', type: 'banner', settings: {} };
      const withDisplay: Data = { ...oneZone, displays: { z1: frameBar } };
      const field = <T extends Element>(id: string) => drawer()?.querySelector<T>(`#frame-settings-${id}`) ?? null;
      const settingsButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.display-row button');

      async function openSettings(data: Data = withDisplay) {
        const opened = await open('/zones/z1', data);
        settingsButton(opened.root)?.click();
        await settle(opened.fixture);
        return opened;
      }

      it('offers settings only for display types whose schema has fields', async () => {
        const bar = await open('/zones/z1', withDisplay);
        expect(settingsButton(bar.root)?.textContent).toContain('Settings');
        expect(settingsButton(bar.root)?.getAttribute('aria-describedby')).toBe('display-title display-type');
        bar.fixture.destroy();
        const banner = await open('/zones/z1', { ...oneZone, displays: { z1: frameBanner } });
        expect(banner.root.querySelector('#display-type')?.textContent).toContain('Banner');
        expect(settingsButton(banner.root)).toBeNull();
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
        const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual({ settings });
        req.flush({ ...frameBar, settings });
        await settle(fixture);

        expect(drawer()).toBeNull();
        expect(root.querySelector('[aria-label="Display settings"]')?.textContent).toContain('Rounded square');
        settingsButton(root)?.click();
        await settle(fixture);
        expect(field<HTMLSelectElement>('shape')?.value).toBe('rounded-square');
        expect(field<HTMLInputElement>('showTitles')?.checked).toBe(false);
        expect(field<HTMLInputElement>('gap')?.value).toBe('20');
      });

      it('keeps the drawer open with the API message and marks the refused field', async () => {
        const { fixture } = await openSettings();

        type(field<HTMLInputElement>('gap'), '40');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
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
        const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
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
        const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
        expect(req.request.body.settings.gap).toBe(20);
        req.flush(frameBar);
        await settle(fixture);
      });

      it('shows and saves defaults for stored values the schema does not allow', async () => {
        const broken = { ...frameBar, settings: { shape: 'star', size: 'large', showTitles: 'no', gap: 40 } };
        const { fixture } = await openSettings({ ...oneZone, displays: { z1: broken } });

        expect(field<HTMLSelectElement>('shape')?.value).toBe('circle');
        expect(field<HTMLSelectElement>('size')?.value).toBe('large');
        expect(field<HTMLInputElement>('showTitles')?.checked).toBe(true);
        expect(field<HTMLInputElement>('gap')?.value).toBe('12');
        buttonNamed(drawer() as HTMLElement, 'Save').click();
        const req = http.expectOne(`${API_BASE}/zones/z1/frame`);
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
            .expectOne(`${API_BASE}/zones/z1/frame`)
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
      expect(root.querySelector('[aria-label="Tale groups in Home bar"]')?.textContent).toContain('No tales yet');
      await expandGroups(fixture, root);

      for (const [title, tales] of [
        ['A', [taleA]],
        ['B', [taleA, taleB]],
      ] as const) {
        (root.querySelector('#group-view-add-tale') as HTMLButtonElement).click();
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

    describe('a new tale group with its tales from files (story 8.13: the first run in 15 actions)', () => {
      const beach = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'beach_day.png', { type: 'image/png' });
      const pool = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'Pool.webp', { type: 'image/webp' });
      const withTales = { ...oneZone, groups: { z1: [{ ...group, tales: [taleA, taleB] }] } };

      function pickAll(input: HTMLInputElement | null, files: File[]): void {
        if (!input) throw new Error('No file input');
        Object.defineProperty(input, 'files', { value: files, configurable: true });
        input.dispatchEvent(new Event('change'));
      }

      async function createSummer(files: File[]) {
        const { fixture, root } = await open('/zones/z1', oneZone);
        buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
        await settle(fixture);
        const input = drawer()?.querySelector<HTMLInputElement>('#create-group-files') ?? null;
        expect(input?.multiple).toBe(true);
        expect(input?.getAttribute('aria-describedby')).toBe('create-group-files-hint');
        type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Summer');
        pickAll(input, files);
        buttonNamed(drawer() as HTMLElement, 'Create').click();
        await answerCreate(fixture, `${API_BASE}/zones/z1/tale-groups`, { name: 'Summer' }, { ...group, tales: [] }, {
          ...oneZone,
          groups: { z1: [{ ...group, tales: [] }] },
        });
        return { fixture, root };
      }

      async function answerTale(fixture: ComponentFixture<unknown>, title: string, id: string, file: File, refused = false) {
        const post = http.expectOne(`${API_BASE}/tale-groups/g1/tales`);
        expect(post.request.body).toEqual({ title });
        post.flush({ ...taleA, id, title });
        await settle(fixture);
        const put = http.expectOne(`${API_BASE}/tales/${id}/media`);
        expect(put.request.method).toBe('PUT');
        expect(put.request.body).toBe(file);
        // The checked type, from the extension when the file has none.
        expect(put.request.headers.get('Content-Type')).toBe(file.type || 'image/webp');
        if (refused) {
          put.flush({ error: { code: 'media_too_large', message: 'The file is over 10 MB' } }, { status: 413, statusText: 'Too Large' });
          await settle(fixture);
          // A tale without its media is hidden, never shown empty.
          const hide = http.expectOne(`${API_BASE}/tales/${id}/status`);
          expect(hide.request.body).toEqual({ status: 'paused' });
          hide.flush({ ...taleA, id, title, status: 'paused', storedStatus: 'paused' });
        } else {
          put.flush({ ...taleA, id, title, media: pngMedia });
        }
        await settle(fixture);
      }

      it('adds one tale per file, in order, titled after the file, and closes', async () => {
        const { fixture, root } = await createSummer([beach, pool]);
        expect(drawer()?.querySelector('[role=status]')?.textContent).toContain('Adding tale 1 of 2');
        await answerTale(fixture, 'beach day', 't1', beach);
        await answerTale(fixture, 'Pool', 't2', pool);
        await flushRefresh(fixture, withTales);
        await settle(fixture);
        expect(drawer()).toBeNull();
        expect(root.querySelector('[aria-label="Tale groups in Home bar"]')?.textContent).toContain('Summer');
      });

      it('keeps the drawer with only Done when a tale is refused, since the group exists', async () => {
        const { fixture } = await createSummer([beach, pool]);
        await answerTale(fixture, 'beach day', 't1', beach, true);
        await flushRefresh(fixture, withTales);
        await settle(fixture);
        const alert = drawer()?.querySelector('[role=alert]')?.textContent ?? '';
        expect(alert).toContain('The tale group was created with 0 of 2 tales.');
        expect(alert).toContain('The tale "beach day" was added hidden, without its media. The file is over 10 MB');
        const buttons = [...(drawer()?.querySelectorAll('.drawer__footer button') ?? [])].map((b) => b.textContent?.trim());
        expect(buttons).toEqual(['Done']);
        // No second group, and no tale for the second file.
        drawer()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
        await settle(fixture);
        http.expectNone(`${API_BASE}/zones/z1/tale-groups`);
        http.expectNone(`${API_BASE}/tale-groups/g1/tales`);
      });

      it('checks every file before creating anything: type (by extension when missing) and size', async () => {
        const { fixture, root } = await open('/zones/z1', oneZone);
        buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
        await settle(fixture);
        type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Summer');
        const input = drawer()?.querySelector<HTMLInputElement>('#create-group-files') ?? null;
        const menu = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
        pickAll(input, [beach, menu]);
        buttonNamed(drawer() as HTMLElement, 'Create').click();
        await settle(fixture);
        http.expectNone(`${API_BASE}/zones/z1/tale-groups`);
        expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('"menu.pdf": Upload a JPEG, PNG, WebP or GIF image');
        const huge = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
        Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });
        pickAll(input, [huge]);
        buttonNamed(drawer() as HTMLElement, 'Create').click();
        await settle(fixture);
        http.expectNone(`${API_BASE}/zones/z1/tale-groups`);
        expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('"huge.png": The file is larger than 10 MB');
      });

      it('sends a file without a type with the type of its extension', async () => {
        const untyped = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'Pool.webp');
        const { fixture } = await createSummer([untyped]);
        await answerTale(fixture, 'Pool', 't1', untyped);
        await flushRefresh(fixture, withTales);
        await settle(fixture);
        expect(drawer()).toBeNull();
      });

      it('shows its progress and stops after the file being added', async () => {
        const { fixture } = await createSummer([beach, pool]);
        const status = () => drawer()?.querySelector('.group-files-progress [role=status]')?.textContent?.trim();
        expect(status()).toBe('Adding tale 1 of 2…');
        const post = http.expectOne(`${API_BASE}/tale-groups/g1/tales`);
        post.flush({ ...taleA, id: 't1', title: 'beach day' });
        await settle(fixture);
        const put = http.expectOne(`${API_BASE}/tales/t1/media`);
        drawer()?.querySelector<HTMLButtonElement>('#create-group-stop')?.click();
        await settle(fixture);
        expect(put.cancelled).toBe(true);
        const hide = http.expectOne(`${API_BASE}/tales/t1/status`);
        expect(hide.request.body).toEqual({ status: 'paused' });
        hide.flush({ ...taleA, status: 'paused', storedStatus: 'paused' });
        await settle(fixture);
        await flushRefresh(fixture, withTales);
        await settle(fixture);
        http.expectNone(`${API_BASE}/tale-groups/g1/tales`);
        expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain(
          'created with 0 of 2 tales. Stopped. The tale "beach day" was added hidden, without its media.',
        );
      });

      it('refuses more files than a group holds, before creating anything', async () => {
        const { fixture, root } = await open('/zones/z1', oneZone);
        buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
        await settle(fixture);
        type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Summer');
        pickAll(drawer()?.querySelector<HTMLInputElement>('#create-group-files') ?? null, Array.from({ length: 101 }, () => beach));
        buttonNamed(drawer() as HTMLElement, 'Create').click();
        await settle(fixture);
        http.expectNone(`${API_BASE}/zones/z1/tale-groups`);
        expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('holds up to 100 tales. Choose fewer files.');
      });
    });

    it('shows the API message in the tale group drawer when a group is refused', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);

      buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones/z1/tale-groups`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });

    it('says plainly that the project is full when a new tale group is refused at the cap', async () => {
      const { fixture, root } = await open('/zones/z1', oneZone);

      buttonNamed(root.querySelector('.topbar') as HTMLElement, 'New tale group').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Summer');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/zones/z1/tale-groups`).flush(groupLimit(fullCreate), { status: 409, statusText: 'Conflict' });
      await settle(fixture);

      // The server's message, as it says it.
      expect(drawer()?.querySelector('[role=alert]')?.textContent?.trim()).toBe(fullCreate);
      expect(buttonNamed(drawer() as HTMLElement, 'Create')).toBeTruthy();
    });

    it('shows the API message in the tale drawer when a tale is refused', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });

      (root.querySelector('#group-view-add-tale') as HTMLButtonElement).click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'C');
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await refuse(fixture, `${API_BASE}/tale-groups/g1/tales`, 'tale_group_full', 'A tale group holds at most 100 tales');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('A tale group holds at most 100 tales');
    });
  });

  describe('zone page header, setup checklist and tabs (epic UX rework R9)', () => {
    const reason = (code: string) => ({ code, subject: 'zone' });
    const notVisible = (...codes: string[]) => ({ visible: false, reasons: codes.map(reason) });
    // A zone just created: no display, no site key, no tale group.
    const newZone = {
      ...zone,
      firstVisibleAt: null,
      visibility: notVisible('zone-no-display', 'zone-not-installed', 'no-tale-groups'),
    };
    const offGroup = { ...group, status: 'draft', storedStatus: 'draft', tales: [taleA] };

    const tabs = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('[role=tablist] [role=tab]')];
    const tab = (root: HTMLElement, name: string) => {
      const found = tabs(root).find((t) => t.textContent?.trim() === name);
      if (!found) throw new Error(`No ${name} tab`);
      return found;
    };
    const selected = (root: HTMLElement) =>
      tabs(root)
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => t.textContent?.trim());
    const panel = (root: HTMLElement, t: HTMLElement) =>
      root.querySelector<HTMLElement>(`#${t.getAttribute('aria-controls')}`) as HTMLElement;
    const shownPanels = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id);
    const url = () => TestBed.inject(Router).url;
    const steps = (root: HTMLElement) =>
      [...root.querySelectorAll('.zone-setup__step')].map((li) => [
        li.querySelector('.zone-setup__link')?.textContent?.trim(),
        li.querySelector('.zone-setup__state')?.textContent?.trim(),
      ]);
    const stepLink = (root: HTMLElement, label: string) => buttonNamed(root, label);
    async function key(fixture: ComponentFixture<unknown>, target: HTMLElement, k: string): Promise<KeyboardEvent> {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      await settle(fixture);
      return event;
    }

    it('shows the header: name, slug, indicator, display type, group count, install state and template note', async () => {
      const { root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...newZone, createdFromTemplate: 'stories-bar', visibility: notVisible('no-visible-groups') }],
        displays: { z1: frameBar },
        groups: { z1: [offGroup] },
      });
      const header = root.querySelector('.zone-header') as HTMLElement;
      expect(header.querySelector('h2')?.textContent).toContain('Home bar');
      expect(header.querySelector('.zone-slug')?.textContent).toContain('z1');
      expect(header.querySelector('app-visibility')?.textContent).toContain('Not visible');
      const summary = [...header.querySelectorAll('[aria-label="Zone summary"] li')].map((li) => li.textContent?.trim());
      expect(summary).toEqual(['Display: Bar', '1 tale group', 'Install: Installed']);
      expect(header.textContent).toContain('Created from template: Stories bar');
      expect(buttonNamed(header, 'Edit name and slug')).toBeTruthy();
    });

    it('says "No display", the plural count and "Not installed" for a new zone', async () => {
      const { root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const summary = [...root.querySelectorAll('[aria-label="Zone summary"] li')].map((li) => li.textContent?.trim());
      expect(summary).toEqual(['Display: No display', '0 tale groups', 'Install: Not installed']);
    });

    it('opens a new zone on Tale groups, with the tab pattern and the other panels hidden', async () => {
      const { root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const list = root.querySelector('[role=tablist]');
      expect(list?.getAttribute('aria-label')).toBe('Zone sections');
      expect(tabs(root).map((t) => t.textContent?.trim())).toEqual(['Tale groups', 'Display', 'Install']);
      expect(selected(root)).toEqual(['Tale groups']);
      expect(tabs(root).map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
      for (const t of tabs(root)) {
        const p = panel(root, t);
        expect(p.getAttribute('role')).toBe('tabpanel');
        expect(p.getAttribute('aria-labelledby')).toBe(t.id);
      }
      expect(shownPanels(root)).toEqual(['zone-panel-groups']);
      expect(url()).toBe('/zones/z1');
    });

    it('puts the selected tab in the URL, keeps it on reload and follows back and forward', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      tab(root, 'Display').click();
      await settle(fixture);
      expect(url()).toBe('/zones/z1?tab=display');
      expect(selected(root)).toEqual(['Display']);
      expect(shownPanels(root)).toEqual(['zone-panel-display']);

      tab(root, 'Install').click();
      await settle(fixture);
      expect(url()).toBe('/zones/z1?tab=install');

      // Back and forward, as the browser's buttons do.
      await navigate(fixture, '/zones/z1?tab=display');
      expect(selected(root)).toEqual(['Display']);
      expect(shownPanels(root)).toEqual(['zone-panel-display']);
      tab(root, 'Tale groups').click();
      await settle(fixture);
      expect(url()).toBe('/zones/z1');
      expect(selected(root)).toEqual(['Tale groups']);
    });

    it('opens the tab named in the URL, and the default for an unknown one', async () => {
      const first = await open('/zones/z1?tab=display', { projects: [acme], zones: [newZone] });
      expect(selected(first.root)).toEqual(['Display']);
      expect(shownPanels(first.root)).toEqual(['zone-panel-display']);
      await navigate(first.fixture, '/zones/z1?tab=nope');
      await settle(first.fixture);
      expect(selected(first.root)).toEqual(['Tale groups']);
      // An unknown or default tab is dropped from the URL in place.
      expect(url()).toBe('/zones/z1');
      await navigate(first.fixture, '/zones/z1?tab=groups');
      await settle(first.fixture);
      expect(url()).toBe('/zones/z1');
    });

    it('replaces the history entry for arrow keys, and pushes one for a click', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const router = TestBed.inject(Router);
      const go = vi.spyOn(router, 'navigate');
      tab(root, 'Tale groups').focus();
      await key(fixture, tab(root, 'Tale groups'), 'ArrowRight');
      expect(go).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: true }));
      tab(root, 'Install').click();
      await settle(fixture);
      expect(go).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: false }));
      expect(url()).toBe('/zones/z1?tab=install');
      go.mockRestore();
    });

    it('names its tabs, steps and summary for screen readers', async () => {
      const { root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      for (const p of root.querySelectorAll('[role=tabpanel]')) expect(p.getAttribute('tabindex')).toBe('-1');
      const display = root.querySelector('[data-summary=display]');
      expect(display?.querySelector('.visually-hidden')?.textContent).toBe('Display: ');
      expect(root.querySelector('[data-summary=install] .visually-hidden')?.textContent).toBe('Install: ');
      const link = stepLink(root, 'Choose a display');
      const state = root.querySelector(`#${link.getAttribute('aria-describedby')}`);
      expect(state?.textContent?.trim()).toBe('To do');
    });

    it('tells a content manager to ask an admin, and focuses the Site key heading', async () => {
      const manager = { id: 'u2', name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' };
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/zones/z1', { setupRequired: false, user: manager });
      await flushRefresh(fixture, { projects: [acme], zones: [newZone] });
      const root = fixture.nativeElement as HTMLElement;
      expect(steps(root)[1]).toEqual(['Ask an admin to issue a site key', 'To do']);
      stepLink(root, 'Ask an admin to issue a site key').click();
      await settle(fixture);
      expect(selected(root)).toEqual(['Install']);
      expect(document.activeElement?.id).toBe('site-key-title');
    });

    it('says why the group step is open when every group is On, and focuses the first group', async () => {
      const at = '2026-12-01T09:00:00.000Z';
      const scheduled = {
        ...group,
        status: 'scheduled',
        startsAt: at,
        visibility: { visible: false, reasons: [{ code: 'starts-at', subject: 'group', at }, reason('zone-not-installed')] },
        tales: [taleA],
      };
      const { fixture, root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('zone-not-installed', 'no-visible-groups') }],
        displays: { z1: frameBar },
        groups: { z1: [scheduled] },
      });
      const hint = root.querySelector('[data-step=group] .zone-setup__hint')?.textContent?.trim() ?? '';
      expect(hint).toMatch(/^Summer: starts /);
      expect(hint).not.toContain('not installed');
      stepLink(root, 'Turn a tale group On with a shown tale').click();
      await settle(fixture);
      expect(document.activeElement?.id).toBe('group-name-g1');
    });

    it('opens Tale groups when a group is created while another tab shows', async () => {
      const { fixture, root } = await open('/zones/z1?tab=display', { projects: [acme], zones: [newZone] });
      expect(selected(root)).toEqual(['Display']);
      // The top bar's "New tale group" creates it; the store reads everything again.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, { projects: [acme], zones: [newZone], groups: { z1: [offGroup] } });
      await settle(fixture);
      expect(selected(root)).toEqual(['Tale groups']);
      expect(url()).toBe('/zones/z1');
    });

    it('announces steps as they get done and when the zone becomes visible', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const live = () => root.querySelector('app-zone-detail-page [aria-live=polite]')?.textContent?.trim();
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('zone-not-installed', 'no-tale-groups') }],
        displays: { z1: frameBar },
      });
      expect(live()).toBe('Step done: Choose a display');
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        projects: [acme],
        zones: [{ ...newZone, visibility: { visible: true, reasons: [] }, firstVisibleAt: '2026-10-22T10:00:00.000Z' }],
        displays: { z1: frameBar },
        groups: { z1: [{ ...group, tales: [taleA] }] },
      });
      expect(live()).toBe('This zone is now visible on your site');
    });

    it('moves between tabs with the arrow keys, Home and End, selecting as focus moves', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const groupsTab = tab(root, 'Tale groups');
      groupsTab.focus();

      const right = await key(fixture, groupsTab, 'ArrowRight');
      expect(right.defaultPrevented).toBe(true);
      expect(selected(root)).toEqual(['Display']);
      expect(document.activeElement).toBe(tab(root, 'Display'));
      expect(tabs(root).map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
      expect(url()).toBe('/zones/z1?tab=display');

      await key(fixture, tab(root, 'Display'), 'End');
      expect(selected(root)).toEqual(['Install']);
      expect(document.activeElement).toBe(tab(root, 'Install'));

      // Wraps around at either end.
      await key(fixture, tab(root, 'Install'), 'ArrowRight');
      expect(selected(root)).toEqual(['Tale groups']);
      await key(fixture, tab(root, 'Tale groups'), 'ArrowLeft');
      expect(selected(root)).toEqual(['Install']);
      expect(document.activeElement).toBe(tab(root, 'Install'));

      await key(fixture, tab(root, 'Install'), 'Home');
      expect(selected(root)).toEqual(['Tale groups']);
      expect(document.activeElement).toBe(tab(root, 'Tale groups'));

      // Other keys are left alone.
      const other = await key(fixture, tab(root, 'Tale groups'), 'ArrowDown');
      expect(other.defaultPrevented).toBe(false);
      expect(selected(root)).toEqual(['Tale groups']);
    });

    it('shows three open steps for a new zone, each opening its tab and focusing its control', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      const setup = root.querySelector('[aria-labelledby=setup-title]') as HTMLElement;
      expect(setup.querySelector('h3')?.textContent).toContain('Set up this zone');
      expect(setup.textContent).toContain('0 of 3 done');
      expect(steps(root)).toEqual([
        ['Choose a display', 'To do'],
        ['Install (issue a site key)', 'To do'],
        ['Turn a tale group On with a shown tale', 'To do'],
      ]);

      stepLink(setup, 'Choose a display').click();
      await settle(fixture);
      expect(selected(root)).toEqual(['Display']);
      expect(url()).toBe('/zones/z1?tab=display');
      expect(document.activeElement?.id).toBe('display-choose');

      stepLink(setup, 'Install (issue a site key)').click();
      await settle(fixture);
      expect(selected(root)).toEqual(['Install']);
      expect(document.activeElement?.id).toBe('site-key-issue');

      stepLink(setup, 'Turn a tale group On with a shown tale').click();
      await settle(fixture);
      expect(selected(root)).toEqual(['Tale groups']);
      // The page's own "New tale group" below the list, not the top bar's.
      expect(document.activeElement?.id).toBe('new-tale-group');
    });

    it('focuses an Off group switch for the group step, and the step link works on its own tab too', async () => {
      const { fixture, root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('no-visible-groups') }],
        displays: { z1: frameBar },
        groups: { z1: [offGroup] },
      });
      stepLink(root, 'Turn a tale group On with a shown tale').click();
      await settle(fixture);
      expect(document.activeElement?.getAttribute('role')).toBe('switch');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Summer on site');

      // With a display, the display step focuses its type picker.
      stepLink(root, 'Choose a display').click();
      await settle(fixture);
      expect(document.activeElement?.id).toBe('display-type-select');
    });

    it('opens a group that is On with every tale Hidden at its first Hidden tale switch for the group step', async () => {
      const hiddenA = { ...taleA, status: 'paused', storedStatus: 'paused' };
      const hiddenB = { ...taleB, status: 'paused', storedStatus: 'paused' };
      const shownWinter = { ...group, id: 'g2', name: 'Winter', position: 0, tales: [{ ...taleA, id: 't9', taleGroupId: 'g2' }] };
      const allHidden = { ...group, position: 1, tales: [hiddenA, hiddenB] };
      const { fixture, root } = await open(
        '/zones/z1?tab=display',
        {
          projects: [acme],
          zones: [{ ...newZone, visibility: notVisible('no-visible-groups') }],
          displays: { z1: frameBar },
          groups: { z1: [shownWinter, allHidden] },
        },
        false,
      );
      expect(groupView()).toBeNull();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      stepLink(root, 'Turn a tale group On with a shown tale').click();
      await settle(fixture);
      // One navigation sets the tab and the group together.
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).url).toBe('/zones/z1?group=g1');
      navigate.mockRestore();
      expect(selected(root)).toEqual(['Tale groups']);
      // Its group view opens (epic UX rework R11), at the first Hidden tale's switch.
      expect(root.querySelector('#group-name-g1')?.getAttribute('aria-expanded')).toBe('true');
      expect(groupView()?.querySelector('h2')?.textContent?.trim()).toBe('Summer');
      expect(document.activeElement?.getAttribute('role')).toBe('switch');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Show A');
      expect(root.querySelector('#group-name-g2')?.getAttribute('aria-expanded')).toBe('false');
      // Opened again by hand, it focuses its heading: the step's focus is not kept.
      (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
      await settle(fixture);
      for (let i = 0; i < 20 && TestBed.inject(Router).url !== '/zones/z1'; i++) await settle(fixture);
      (root.querySelector('#group-name-g1') as HTMLButtonElement).click();
      await settle(fixture);
      expect(document.activeElement?.classList).toContain('drawer__title');
    });

    it('ticks each step as the zone is set up', async () => {
      const { fixture, root } = await open('/zones/z1', { projects: [acme], zones: [newZone] });
      expect(steps(root).map(([, state]) => state)).toEqual(['To do', 'To do', 'To do']);

      // A display set: the refresh reads the zone's reasons again.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('zone-not-installed', 'no-tale-groups') }],
        displays: { z1: frameBar },
      });
      expect(steps(root).map(([, state]) => state)).toEqual(['Done', 'To do', 'To do']);
      expect(root.querySelector('[data-step=display]')?.classList).toContain('zone-setup__step--done');

      // Installed with the project's site key.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('no-visible-groups') }],
        displays: { z1: frameBar },
        groups: { z1: [offGroup] },
      });
      expect(steps(root).map(([, state]) => state)).toEqual(['Done', 'Done', 'To do']);
      expect(root.textContent).toContain('2 of 3 done');
    });

    it('hides the checklist once the zone is visible, and keeps it hidden when it stops being visible', async () => {
      const { fixture, root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...newZone, visibility: { visible: true, reasons: [] }, firstVisibleAt: '2026-10-22T10:00:00.000Z' }],
        displays: { z1: frameBar },
        groups: { z1: [{ ...group, tales: [taleA] }] },
      });
      expect(root.querySelector('[aria-labelledby=setup-title]')).toBeNull();

      // The group is turned Off: not visible, but the zone was visible once (the API keeps firstVisibleAt).
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, {
        projects: [acme],
        zones: [{ ...newZone, visibility: notVisible('no-visible-groups'), firstVisibleAt: '2026-10-22T10:00:00.000Z' }],
        displays: { z1: frameBar },
        groups: { z1: [offGroup] },
      });
      expect(root.querySelector('[aria-labelledby=setup-title]')).toBeNull();
      expect(root.querySelector('.zone-header app-visibility')?.textContent).toContain('Not visible');
    });

    it('hides the checklist as soon as the zone reads visible, before the API answers firstVisibleAt', async () => {
      const { root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...newZone, visibility: { visible: true, reasons: [] } }],
        displays: { z1: frameBar },
      });
      expect(root.querySelector('[aria-labelledby=setup-title]')).toBeNull();
    });

    it('links the Display tab to the project theme and keeps the Site key card on the Install tab', async () => {
      const { root } = await open('/zones/z1?tab=display', {
        projects: [acme],
        zones: [newZone],
        displays: { z1: frameBar },
      });
      const display = root.querySelector('#zone-panel-display') as HTMLElement;
      const link = [...display.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Style: project theme');
      expect(link?.getAttribute('href')).toBe('/projects/p1/theme');
      expect(display.querySelector('#display-title')).not.toBeNull();
      const install = root.querySelector('#zone-panel-install') as HTMLElement;
      expect(install.querySelector('app-site-key-card #site-key-title')?.textContent).toContain('Site key');
      expect(root.querySelector('#zone-panel-groups #groups-title')).not.toBeNull();
    });
  });

  describe('zone templates (epic UX rework R5)', () => {
    const radios = () => [...(drawer()?.querySelectorAll<HTMLInputElement>('input[name=template]') ?? [])];

    async function openNewZone(fixture: ComponentFixture<App>, root: HTMLElement): Promise<void> {
      buttonNamed(root, 'New zone').click();
      await settle(fixture);
    }

    it('offers the templates as a radio group, each with a description and a sketch of its display', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      const fieldset = drawer()?.querySelector<HTMLFieldSetElement>('fieldset.template-options');
      expect(fieldset?.querySelector('legend')?.textContent?.trim()).toBe('Template');
      expect(radios().map((r) => [r.value, r.checked])).toEqual([
        ['stories-bar', true],
        ['promo-banner', false],
        ['blank', false],
      ]);
      // Each radio is named by its label and described by its one-line description.
      expect(radios().map((r) => r.closest('label')?.textContent?.trim())).toEqual(['Stories bar', 'Promo banner', 'Blank']);
      const described = radios().map((r) => drawer()?.querySelector(`#${r.getAttribute('aria-describedby')}`)?.textContent);
      expect(described[0]).toContain('row of circles');
      expect(described[1]).toContain('wide banner');
      expect(described[2]).toContain('No display yet');
      // The sketches are decoration: hidden from assistive technology.
      const sketches = [...(fieldset?.querySelectorAll<HTMLElement>('.template-sketch') ?? [])];
      expect(sketches.map((s) => [s.dataset['kind'], s.getAttribute('aria-hidden')])).toEqual([
        ['bar', 'true'],
        ['banner', 'true'],
        ['blank', 'true'],
      ]);
      expect(sketches.map((s) => s.querySelectorAll('i').length)).toEqual([4, 1, 0]);
    });

    it('creates the zone with the picked template in the same request', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Promo');
      radios()[1].click();
      await settle(fixture);
      expect(radios().map((r) => r.checked)).toEqual([false, true, false]);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      const created = { ...zone, name: 'Promo', createdFromTemplate: 'promo-banner' };
      await answerCreate(
        fixture,
        `${API_BASE}/zones`,
        { name: 'Promo', projectId: 'p1', template: 'promo-banner' },
        created,
        { projects: [acme], zones: [created] },
      );
      expect(drawer()).toBeNull();
      http.expectNone(`${API_BASE}/zones/z1/playbook`);
    });

    it('sends Blank too, so the zone records it', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Later');
      radios()[2].click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/zones`);
      expect(req.request.body).toEqual({ name: 'Later', projectId: 'p1', template: 'blank' });
    });

    it('preselects the only project and hides the project picker', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      expect(drawer()?.querySelector('#create-project')).toBeNull();
      expect(drawer()?.textContent).not.toContain('Choose a project');
      expect(drawer()?.textContent).toContain('In project Acme');
    });

    it('shows the project picker when the user can access several projects', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme, globex] });
      await openNewZone(fixture, root);
      const picker = drawer()?.querySelector<HTMLSelectElement>('#create-project');
      expect([...(picker?.options ?? [])].map((o) => o.textContent?.trim())).toEqual(['Choose a project', 'Acme', 'Globex']);
      expect(drawer()?.textContent).not.toContain('In project');
    });

    it('reads the project when Create is pressed: projects that load or change after the drawer opens', async () => {
      const store = TestBed.inject(DashboardStore);
      const { fixture } = await open('/zones', { projects: [acme, globex] });
      store.projects.set([]);
      store.openDrawer({ kind: 'zone' });
      await settle(fixture);
      // The only project arrives after the drawer opened: the picker hides and that project is used.
      store.projects.set([globex]);
      await settle(fixture);
      expect(drawer()?.querySelector('#create-project')).toBeNull();
      expect(drawer()?.textContent).toContain('In project Globex');
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Shop');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      expect(http.expectOne(`${API_BASE}/zones`).request.body).toEqual({ name: 'Shop', projectId: 'p2', template: 'stories-bar' });
    });

    it('hides the picker and uses the remaining project when two projects become one', async () => {
      const store = TestBed.inject(DashboardStore);
      const { fixture, root } = await open('/zones', { projects: [acme, globex] });
      await openNewZone(fixture, root);
      expect(drawer()?.querySelector('#create-project')).not.toBeNull();
      store.projects.set([globex]);
      await settle(fixture);
      expect(drawer()?.querySelector('#create-project')).toBeNull();
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Shop');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      expect(http.expectOne(`${API_BASE}/zones`).request.body.projectId).toBe('p2');
    });

    it('marks the template group, not the name, when the API refuses the template', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Home');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones`, 'unknown_template', 'template must be one of: stories-bar, promo-banner, blank');
      expect(drawer()?.querySelector('fieldset.template-options')?.getAttribute('aria-describedby')).toBe('template-hint create-error');
      expect(drawer()?.querySelector('#create-text')?.getAttribute('aria-invalid')).toBeNull();
      expect(drawer()?.querySelector('#create-slug')?.getAttribute('aria-invalid')).toBeNull();
    });

    it('marks the project picker, not the name, when the API refuses the project', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme, globex] });
      await openNewZone(fixture, root);
      const picker = drawer()?.querySelector<HTMLSelectElement>('#create-project') ?? null;
      expect(picker?.getAttribute('aria-describedby')).toBeNull();
      choose(picker, '');
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'Home');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await refuse(fixture, `${API_BASE}/zones`, 'validation_failed', 'projectId is required');
      expect(picker?.getAttribute('aria-invalid')).toBe('true');
      expect(picker?.getAttribute('aria-describedby')).toBe('create-error');
      expect(drawer()?.querySelector('#create-text')?.getAttribute('aria-invalid')).toBeNull();
      expect(drawer()?.querySelector('fieldset.template-options')?.getAttribute('aria-describedby')).toBe('template-hint');
    });

    it('does not ask to choose a project when there is only one', async () => {
      const { fixture, root } = await open('/zones', { projects: [acme] });
      await openNewZone(fixture, root);
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/zones`).flush('down', { status: 502, statusText: 'Bad Gateway' });
      await settle(fixture);
      const alert = drawer()?.querySelector('[role=alert]')?.textContent ?? '';
      expect(alert).toContain('Zone was not saved. Enter a name.');
      expect(alert).not.toContain('Choose a project');
    });

    it('has no Playbook card or Apply playbook action on the zone page', async () => {
      const { root } = await open('/zones/z1', oneZone);
      const titles = [...root.querySelectorAll('.section__title')].map((h) => h.textContent?.trim());
      expect(titles).not.toContain('Playbook');
      expect(root.querySelector('#playbook-title')).toBeNull();
      expect([...root.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Apply playbook');
      expect(root.textContent?.toLowerCase()).not.toContain('playbook');
      expect(root.querySelector('.zone-template')).toBeNull();
    });

    it('notes the template the zone was created from in the header', async () => {
      const { root } = await open('/zones/z1', {
        projects: [acme],
        zones: [{ ...zone, createdFromTemplate: 'stories-bar' }],
        displays: { z1: frameBar },
      });
      expect(root.querySelector('.page-header .zone-template')?.textContent?.trim()).toBe('Created from template: Stories bar');
    });
  });

  describe('zone keys (removed, UX rework story 8.7)', () => {
    it('shows no Zone key card and never asks for a zone key', async () => {
      const { root } = await open('/zones/z1', oneZone);
      expect(root.querySelector('section[aria-labelledby="key-title"]')).toBeNull();
      expect(root.textContent).not.toContain('Zone key');
      expect(root.textContent).not.toContain('Issue zone key');
      http.expectNone(`${API_BASE}/zones/z1/key`);
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
      return announced(root)?.trim();
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

    for (const outcome of ['saved', 'refused'] as const) {
      it(`keeps a switch turned while a group reorder is pending once the order is ${outcome}`, async () => {
        const winter = { ...groupB, status: 'live', storedStatus: 'live', startsAt: null, endsAt: null, tales: [] };
        const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }, winter] } });
        const summerSwitch = () =>
          root.querySelector<HTMLButtonElement>('[role=switch][aria-label="Summer on site"]')?.getAttribute('aria-checked');

        drop(fixture, 'Tale groups in Home bar', 1, 0);
        await settle(fixture);
        const order = http.expectOne(`${API_BASE}/zones/z1/tale-groups/order`);

        root.querySelector<HTMLButtonElement>('[role=switch][aria-label="Summer on site"]')?.click();
        await settle(fixture);
        http
          .expectOne(`${API_BASE}/tale-groups/g1/status`)
          .flush({ ...group, status: 'paused', storedStatus: 'paused', tales: [] });
        await settle(fixture);
        expect(summerSwitch()).toBe('false');

        if (outcome === 'saved') {
          order.flush([
            { ...winter, position: 0 },
            { ...group, position: 1, tales: [] },
          ]);
        } else {
          order.flush(
            { error: { code: 'validation_failed', message: 'The order is out of date' } },
            { status: 409, statusText: 'Conflict' },
          );
        }
        await settle(fixture);
        expect(groupNames(root)).toEqual(outcome === 'saved' ? ['Winter', 'Summer'] : ['Summer', 'Winter']);
        expect(summerSwitch()).toBe('false');

        const paused = { ...group, status: 'paused', storedStatus: 'paused', tales: [] };
        const groups = outcome === 'saved' ? [{ ...winter, position: 0 }, { ...paused, position: 1 }] : [paused, winter];
        await flushRefresh(fixture, { ...oneZone, groups: { z1: groups } });
        await settle(fixture);
        expect(summerSwitch()).toBe('false');
      });
    }
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
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [shared, winter], z3: [{ ...shared, position: 0 }] } });

      // "Also in" is in the group's view (epic UX rework R11), which `open` opened for Summer.
      const alsoIn = groupView()?.querySelector('.group__zones');
      expect(alsoIn?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Also in: Product page');
      expect(alsoIn?.querySelector('a')?.getAttribute('href')).toBe('/zones/z3');
      expect(groupRow(root, 'Winter').querySelector('.group__zones')).toBeNull();
      // Summer is in every zone of its project: "Show in another zone" stays in its ⋯ menu, disabled,
      // with its reason (epic UX rework R10, report §6 #13).
      const summer = menuItems(groupRow(root, 'Summer'), 'More for Summer');
      expect(summer.map((item) => item.label)).toEqual(GROUP_MENU);
      expect(summer.filter((item) => item.disabled)).toEqual([
        { label: 'Show in another zone', reason: 'Already in every zone', disabled: true },
      ]);
      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Show in another zone');
      await settle(fixture);
      expect(drawer()).toBeNull();
      const winterMenu = menuItems(groupRow(root, 'Winter'), 'More for Winter');
      expect(winterMenu.find((item) => item.label === 'Show in another zone')).toEqual({
        label: 'Show in another zone',
        reason: '',
        disabled: false,
      });
      // No action button outside the menu besides the switch, the move buttons and the name.
      const buttons = [...groupRow(root, 'Summer').querySelectorAll('.group-row button:not([role=menuitem])')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
      );
      expect(buttons.filter((name) => GROUP_MENU.some((item) => name?.startsWith(item)))).toEqual([]);
    });

    it('adds a group to another zone of its project from the drawer, then shows it there and "Also in"', async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...twoZones,
        groups: { z1: [{ ...group, tales: [] }] },
        projectGroups: { p1: [{ id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 0, zoneIds: ['z1'] }] },
      });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Show in another zone');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Show in another zone');
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
      expect(groupView()?.querySelector('.group__zones')?.textContent).toContain('Product page');
    });

    it("shows the API's message in the Show in another zone drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Show in another zone');
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

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Remove from this zone');
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

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Rename');
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

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Rename');
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, '  ');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await refuse(fixture, `${API_BASE}/tale-groups/g1`, 'validation_failed', 'name is required');

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });

    it("shows the API's message in the Remove drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Remove from this zone');
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
            projectGroup({ id: 'g9', name: 'Autumn', zoneIds: [] }, 3),
            projectGroup({ id: 'g1', name: 'Summer', zoneIds: ['z1', 'z3'] }),
          ],
          p2: [projectGroup({ id: 'g8', projectId: 'p2', name: 'Elsewhere', zoneIds: ['z2'] })],
        },
      });

      const link = root.querySelector<HTMLAnchorElement>('.rail a[href="/tale-groups"]');
      expect(link?.textContent).toContain('Tale groups');
      await navigate(fixture, '/tale-groups');
      expect(root.querySelector('.topbar__title')?.textContent).toBe('Tale groups');
      expect(link?.getAttribute('aria-current')).toBe('page');

      const rows = [...root.querySelectorAll<HTMLElement>('[aria-label="Tale groups in Acme"] > li')];
      expect(rows.map((r) => r.querySelector('h3')?.textContent?.trim())).toEqual(['Autumn', 'Summer']);
      expect(rows[0].textContent).toContain('3 of 3 shown · max 100');
      expect(rows[0].querySelector('.group-row__zones')?.textContent?.trim()).toBe('Not in a zone');
      expect(rows[1].querySelector('.group-row__zones')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('In: Home bar, Product page');
      expect([...rows[1].querySelectorAll('.group-row__zones a')].map((a) => a.getAttribute('href'))).toEqual(['/zones/z1', '/zones/z3']);
      expect(menuItems(rows[1], 'More for Summer').find((i) => i.label === 'Show in another zone')).toEqual({
        label: 'Show in another zone',
        reason: 'Already in every zone',
        disabled: true,
      });
      expect(root.textContent).not.toContain('Elsewhere');

      pickMenuItem(rows[0], 'More for Autumn', 'Show in another zone');
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
            projectGroup({ id: 'g9', name: 'Autumn', zoneIds: ['z3'] }, 3),
            projectGroup({ id: 'g1', name: 'Summer', zoneIds: ['z1', 'z3'] }),
          ],
        },
      });
      await settle(fixture);
      expect(root.querySelector('[aria-label="Tale groups in Acme"] li')?.textContent).toContain('In: Product page');
    });

    it('copies a group to a zone of another project from the drawer and links to the target zone', async () => {
      const { fixture, root } = await open('/zones/z1', { ...twoZones, groups: { z1: [{ ...group, tales: [] }] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Copy to zone');
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

      pickMenuItem(groupRow(root, 'Elsewhere'), 'More for Elsewhere', 'Copy to zone');
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

    it("shows the server's message when a copy is refused at the cap", async () => {
      const theirs = { id: 'g8', projectId: 'p2', name: 'Elsewhere', position: 0, zoneIds: ['z2'], tales: [], tags: [] };
      const { fixture, root } = await open('/zones/z2', { ...twoZones, groups: { z2: [theirs] } });

      pickMenuItem(groupRow(root, 'Elsewhere'), 'More for Elsewhere', 'Copy to zone');
      await settle(fixture);
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=copyProject]') ?? null, 'p1');
      await settle(fixture);
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=copyZone]') ?? null, 'z3');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Copy').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g8/copy`).flush(groupLimit(fullCopy), { status: 409, statusText: 'Conflict' });
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent?.trim()).toBe(fullCopy);
    });

    it('offers "Copy to zone" on the Tale groups page, also for a group in no zone', async () => {
      const { fixture, root } = await open('/tale-groups', {
        ...twoZones,
        projectGroups: { p1: [projectGroup({ id: 'g9', name: 'Autumn' }, 3)] },
      });

      const row = root.querySelector<HTMLElement>('[aria-label="Tale groups in Acme"] > li') as HTMLElement;
      pickMenuItem(row, 'More for Autumn', 'Copy to zone');
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

    it("shows the saved tale order in the group's other zone too", async () => {
      const store = TestBed.inject(DashboardStore);
      const withTales = { ...shared, tales: [taleA, taleB] };
      const { fixture } = await open('/zones/z1', { ...twoZones, groups: { z1: [withTales], z3: [{ ...withTales, position: 0 }] } });

      const saving = store.orderTales('g1', ['t2', 't1']);
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

  describe('tale groups as a list (epic UX rework R10)', () => {
    const VISIBLE = { visible: true, reasons: [] };
    const OFF = { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] };
    const hidden = { ...taleB, status: 'paused', storedStatus: 'paused' };
    const summer = { ...group, visibility: VISIBLE, tales: [taleA, hidden] };
    const winter = {
      ...group,
      id: 'g2',
      name: 'Winter sale for the whole family',
      status: 'draft',
      storedStatus: 'draft',
      position: 1,
      visibility: OFF,
      tales: [],
    };
    const spring = {
      ...group,
      id: 'g3',
      name: 'Spring',
      status: 'scheduled',
      startsAt: '2099-12-01T09:00:00.000Z',
      position: 2,
      tales: [{ ...taleA, id: 't3', taleGroupId: 'g3' }],
    };
    const three: Data = { ...oneZone, displays: { z1: frameBar }, groups: { z1: [summer, winter, spring] } };
    const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    function row(root: HTMLElement, name: string): HTMLElement {
      const found = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => text(li.querySelector('h4')) === name);
      if (!found) throw new Error(`No ${name} row`);
      return found;
    }

    function opener(root: HTMLElement, name: string): HTMLButtonElement {
      return row(root, name).querySelector('.group-row__open') as HTMLButtonElement;
    }

    it('lists each group as one row: name, "n of m shown", switch, indicator, chip only with a window, and ⋯', async () => {
      const { root } = await open('/zones/z1', three, false);

      const list = root.querySelector('ul[aria-label="Tale groups in Home bar"]');
      expect(list?.children).toHaveLength(3);
      expect([...(list?.children ?? [])].every((li) => li.tagName === 'LI')).toBe(true);
      expect(text(row(root, 'Summer').querySelector('.group-row__count'))).toBe('1 of 2 shown · max 100');
      expect(text(row(root, 'Winter sale for the whole family').querySelector('.group-row__count'))).toBe('No tales yet · max 100');
      expect(text(row(root, 'Spring').querySelector('.group-row__count'))).toBe('1 of 1 shown · max 100');
      expect(text(row(root, 'Summer').querySelector('.group-row__status app-visibility'))).toBe('Visible on site');
      expect(text(row(root, 'Winter sale for the whole family').querySelector('.group-row__status app-visibility button'))).toBe(
        'Not visible: group is off',
      );
      // The switch is named per group, its state in aria-checked.
      const winterSwitch = row(root, 'Winter sale for the whole family').querySelector('[role=switch]');
      expect(winterSwitch?.getAttribute('aria-label')).toBe('Winter sale for the whole family on site');
      expect(winterSwitch?.getAttribute('aria-checked')).toBe('false');
      // A schedule chip only where a window exists; no capacity or schedule words otherwise.
      expect(row(root, 'Summer').querySelector('.window-chip')).toBeNull();
      expect(text(row(root, 'Spring').querySelector('.group-row .window-chip'))).toContain('Starts');
      expect(text(row(root, 'Summer').querySelector('.group-row'))).not.toContain('/ 100');
      for (const name of ['Summer', 'Spring']) {
        expect(row(root, name).querySelector(`button[aria-label="More for ${name}"]`)?.getAttribute('aria-haspopup')).toBe('menu');
      }
      // Below the list: New tale group and Add existing group.
      const actions = root.querySelector('#zone-panel-groups .groups-actions');
      expect([...(actions?.querySelectorAll('button') ?? [])].map((b) => text(b))).toEqual(['New tale group', 'Add existing group']);
    });

    it('opens a group from its name or a click on the row, but not from its switch, ⋯ or move buttons', async () => {
      const { fixture, root } = await open('/zones/z1', three, false);
      const name = opener(root, 'Summer');
      const close = async () => {
        (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
        await settle(fixture);
      };

      // Closed by default; the name is the group view's trigger (epic UX rework R11).
      expect(name.getAttribute('aria-haspopup')).toBe('dialog');
      expect(name.getAttribute('aria-expanded')).toBe('false');
      expect(name.getAttribute('aria-controls')).toBeNull();
      expect(groupView()).toBeNull();

      name.click();
      await settle(fixture);
      expect(name.getAttribute('aria-expanded')).toBe('true');
      expect(name.getAttribute('aria-controls')).toBe('group-view-g1');
      expect(groupView()?.id).toBe('group-view-g1');
      expect(groupView()?.querySelector('[aria-label="Tales in Summer"]')).not.toBeNull();
      // No tale strip under the row any more.
      expect(row(root, 'Summer').querySelector('.tale-card')).toBeNull();
      await close();
      expect(groupView()).toBeNull();

      // The cover and the row's blank space open it.
      (row(root, 'Summer').querySelector('.group-row__cover') as HTMLElement).click();
      await settle(fixture);
      expect(groupView()).not.toBeNull();
      await close();
      (row(root, 'Summer').querySelector('.group-row') as HTMLElement).click();
      await settle(fixture);
      expect(groupView()).not.toBeNull();
      await close();

      // Its own controls do their own thing and leave it closed.
      menuItems(row(root, 'Summer'), 'More for Summer');
      (row(root, 'Summer').querySelector('[aria-label="Move Summer later"]') as HTMLButtonElement).click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z1/tale-groups/order`)
        .flush([
          { ...winter, position: 0 },
          { ...summer, position: 1 },
          spring,
        ]);
      await settle(fixture);
      row(root, 'Summer').querySelector<HTMLButtonElement>('[role=switch]')?.click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g1/status`).flush({ ...summer, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, three);
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(opener(root, 'Summer').getAttribute('aria-expanded')).toBe('false');
    });

    it('archives a group from its ⋯ menu at once and announces it', async () => {
      const { fixture, root } = await open('/zones/z1', three, false);

      pickMenuItem(row(root, 'Summer'), 'More for Summer', 'Archive');
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'archived' });
      const archived = { ...summer, status: 'archived', storedStatus: 'archived' };
      req.flush(archived);
      await settle(fixture);
      await flushRefresh(fixture, { ...three, groups: { z1: [archived, winter, spring] } });
      await settle(fixture);

      expect(row(root, 'Summer').querySelector('.group-row [role=switch]')).toBeNull();
      expect(text(row(root, 'Summer').querySelector('.group-row .status-badge'))).toBe('Status: Archived');
      expect(menuItems(row(root, 'Summer'), 'More for Summer').map((item) => item.label).at(-1)).toBe('Restore');
      expect(announced(root)).toBe('Summer archived. Undo is above the list.');
    });

    it('adds an existing group of the project from "Add existing group", leaving out archived ones', async () => {
      const autumn = { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: [], storedStatus: 'paused' };
      const old = { id: 'g8', projectId: 'p1', name: 'Old', taleCount: 1, zoneIds: [], storedStatus: 'archived' };
      const here = { id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 2, zoneIds: ['z1'], storedStatus: 'live' };
      const { fixture, root } = await open('/zones/z1', { ...three, projectGroups: { p1: [autumn, old, here] } }, false);

      const add = root.querySelector<HTMLButtonElement>('#add-existing-group') as HTMLButtonElement;
      expect(add.hasAttribute('aria-disabled')).toBe(false);
      add.click();
      await settle(fixture);
      const panel = drawer() as HTMLElement;
      expect(panel.querySelector('h2')?.textContent).toContain('Add existing group');
      const options = [...panel.querySelectorAll<HTMLInputElement>('input[type=radio]')];
      expect(options.map((o) => text(o.closest('label')))).toEqual(['Autumn 3 tales · Not in a zone']);
      expect(options[0].checked).toBe(true);

      buttonNamed(panel, 'Add').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/zones/z1/tale-groups/g9`);
      expect(req.request.method).toBe('PUT');
      req.flush({ id: 'g9', projectId: 'p1', name: 'Autumn', position: 3, zoneIds: ['z1'], tales: [], tags: [] });
      await settle(fixture);
      const autumnGroup = { ...group, id: 'g9', name: 'Autumn', status: 'paused', storedStatus: 'paused', position: 3, tales: [] };
      await flushRefresh(fixture, {
        ...three,
        groups: { z1: [summer, winter, spring, autumnGroup] },
        projectGroups: { p1: [{ ...autumn, zoneIds: ['z1'] }, old, here] },
      });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(row(root, 'Autumn')).toBeTruthy();
      expect(announced(root)).toBe('Autumn added to Home bar');
      // Nothing left to add: the button stays, disabled, with its reason.
      const after = root.querySelector<HTMLButtonElement>('#add-existing-group') as HTMLButtonElement;
      expect(after.getAttribute('aria-disabled')).toBe('true');
      // The only group left out is archived, and the reason says so.
      expect(text(root.querySelector(`#${after.getAttribute('aria-describedby')}`))).toBe(
        'The other tale groups of this project are archived. Restore one to add it.',
      );
      after.click();
      await settle(fixture);
      expect(drawer()).toBeNull();
    });

    it("shows the API's message in the Add existing group drawer", async () => {
      const autumn = { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 0, zoneIds: [], storedStatus: 'paused' };
      const { fixture, root } = await open('/zones/z1', { ...three, projectGroups: { p1: [autumn] } }, false);

      root.querySelector<HTMLButtonElement>('#add-existing-group')?.click();
      await settle(fixture);
      expect(text(drawer()?.querySelector('label'))).toBe('Autumn 0 tales · Not in a zone');
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones/z1/tale-groups/g9`)
        .flush({ error: { code: 'tale_group_not_found', message: 'taleGroupId does not match' } }, { status: 400, statusText: 'Bad Request' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('taleGroupId does not match');
    });

    it('shows the tags on the closed row, and the name is a plain button (Enter and Space open it natively)', async () => {
      const tagged = { ...summer, tags: [{ id: 'tag1', name: 'beach' }] };
      const { root } = await open('/zones/z1', { ...three, groups: { z1: [tagged, winter, spring] } }, false);
      const tags = [...row(root, 'Summer').querySelectorAll('.group-row [aria-label="Tags of Summer"] li')];
      expect(tags.map((li) => text(li))).toEqual(['beach']);
      const name = opener(root, 'Summer');
      expect(name.tagName).toBe('BUTTON');
      expect(name.type).toBe('button');
      expect(row(root, 'Summer').querySelector('[role=region]')).toBeNull();
    });

    it('does not open a group from its reorder cell, badge or indicator', async () => {
      const { fixture, root } = await open('/zones/z1', three, false);
      const isOpen = (name: string) => opener(root, name).getAttribute('aria-expanded') === 'true';
      for (const selector of ['.group-row__reorder', '.drag-handle']) {
        (row(root, 'Summer').querySelector(selector) as HTMLElement).click();
        await settle(fixture);
        expect(isOpen('Summer')).toBe(false);
      }
      (row(root, 'Spring').querySelector('.group-row .status-badge') as HTMLElement).click();
      await settle(fixture);
      expect(isOpen('Spring')).toBe(false);
      (row(root, 'Summer').querySelector('.group-row app-visibility') as HTMLElement).click();
      await settle(fixture);
      expect(isOpen('Summer')).toBe(false);
    });

    it('moves a group by keyboard: focus stays on the move button, and the move is announced', async () => {
      const { fixture, root } = await open('/zones/z1', three, false);
      const later = row(root, 'Summer').querySelector<HTMLButtonElement>('[aria-label="Move Summer later"]') as HTMLButtonElement;
      later.focus();
      later.click();
      await settle(fixture);
      expect(announced(root)).toBe('Summer moved to position 2 of 3');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Move Summer later');
      http
        .expectOne(`${API_BASE}/zones/z1/tale-groups/order`)
        .flush([
          { ...winter, position: 0 },
          { ...summer, position: 1 },
          spring,
        ]);
      await settle(fixture);
      expect([...root.querySelectorAll('.group-row__open')].map((b) => text(b))).toEqual([
        'Winter sale for the whole family',
        'Summer',
        'Spring',
      ]);
    });

    it('opens the drawer of each ⋯ item for that group, and focus returns to its ⋯', async () => {
      const store = TestBed.inject(DashboardStore);
      const twoZones: Data = { ...three, zones: [zone, { id: 'z3', name: 'Product page', projectId: 'p1' }] };
      const { fixture, root } = await open('/zones/z1', twoZones, false);
      const name = 'Winter sale for the whole family';
      const expected: [string, unknown][] = [
        ['Rename', { kind: 'renameTaleGroup', taleGroupId: 'g2' }],
        ['Cover', { kind: 'cover', taleGroupId: 'g2' }],
        ['Audience', { kind: 'tags', taleGroupId: 'g2' }],
        ['Schedule', { kind: 'schedule', target: 'taleGroup', id: 'g2' }],
        ['Show in another zone', { kind: 'placeTaleGroup', taleGroupId: 'g2' }],
        ['Copy to zone', { kind: 'copyTaleGroup', taleGroupId: 'g2' }],
        ['Remove from this zone', { kind: 'removeTaleGroup', zoneId: 'z1', taleGroupId: 'g2' }],
      ];
      for (const [item, request] of expected) {
        pickMenuItem(row(root, name), `More for ${name}`, item);
        await settle(fixture);
        expect(store.drawer()).toEqual(request);
        expect(store.drawerOpener?.getAttribute('aria-label')).toBe(`More for ${name}`);
        store.closeDrawer();
        await settle(fixture);
      }
    });

    it('offers Undo after Archive, which restores the group On, and disables Archive while it saves', async () => {
      const { fixture, root } = await open('/zones/z1', three, false);

      pickMenuItem(row(root, 'Summer'), 'More for Summer', 'Archive');
      await settle(fixture);
      expect(menuItems(row(root, 'Summer'), 'More for Summer').at(-1)).toEqual({
        label: 'Archive',
        reason: 'Saving…',
        disabled: true,
      });
      const archived = { ...summer, status: 'archived', storedStatus: 'archived' };
      http.expectOne(`${API_BASE}/tale-groups/g1/status`).flush(archived);
      await settle(fixture);
      await flushRefresh(fixture, { ...three, groups: { z1: [archived, winter, spring] } });
      await settle(fixture);
      expect(text(root.querySelector('.undo-bar'))).toBe('Summer archived. Undo');

      (root.querySelector('#undo-archive') as HTMLButtonElement).click();
      await settle(fixture);
      let req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...summer, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, { ...three, groups: { z1: [{ ...summer, status: 'paused', storedStatus: 'paused' }, winter, spring] } });
      await settle(fixture);
      req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.body).toEqual({ status: 'live' });
      req.flush(summer);
      await settle(fixture);
      await flushRefresh(fixture, three);
      await settle(fixture);

      expect(root.querySelector('.undo-bar')).toBeNull();
      expect(row(root, 'Summer').querySelector('.group-row [role=switch]')?.getAttribute('aria-checked')).toBe('true');
      expect(announced(root)).toBe('Summer restored, on. Visible on site');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for Summer');
    });

    it('keeps the group picked in "Add existing group" when the list is read again', async () => {
      const autumn = { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: [], storedStatus: 'paused' };
      const fall = { id: 'g8', projectId: 'p1', name: 'Fall', taleCount: 1, zoneIds: [], storedStatus: 'paused' };
      const data = { ...three, projectGroups: { p1: [autumn, fall] } };
      const { fixture, root } = await open('/zones/z1', data, false);
      root.querySelector<HTMLButtonElement>('#add-existing-group')?.click();
      await settle(fixture);
      const radios = () => [...(drawer()?.querySelectorAll<HTMLInputElement>('input[type=radio]') ?? [])];
      radios()[1].click();
      await settle(fixture);
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, { ...data, projectGroups: { p1: [{ ...autumn, taleCount: 4 }, fall] } });
      await settle(fixture);
      expect(radios().map((r) => r.checked)).toEqual([false, true]);
      expect(text(drawer()?.querySelector('label'))).toBe('Autumn 4 tales · Not in a zone');
    });

    it('offers New tale group and Add existing group in an empty zone too', async () => {
      const { root } = await open('/zones/z1', oneZone, false);
      expect(root.textContent).toContain('No tale groups yet');
      expect(root.querySelector('#new-tale-group')?.classList).toContain('btn--primary');
      expect(root.querySelector('#add-existing-group')).not.toBeNull();
    });

    it('stacks rows in two lines on a narrow list and wraps names between words (390 px)', async () => {
      // jsdom does no layout: this checks the rules the page applies, which the browser run
      // screenshots at 390x844.
      await open('/zones/z1', three, false);
      const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
      const at = css.indexOf('@container group-list (max-width: 40rem)');
      expect(at).toBeGreaterThan(-1);
      expect(css.slice(at)).toMatch(
        /grid-template-areas:\s*["']reorder cover main menu["']\s*["']reorder cover status status["']/,
      );
      expect(css).toMatch(/container:\s*group-list\s*\/\s*inline-size/);
      expect(css).toMatch(/\.group-row__name[^{]*\{[^}]*overflow-wrap:\s*break-word/);
      expect(css).toMatch(/\.visibility__text[^{]*\{[^}]*overflow-wrap:\s*break-word/);
    });
  });

  describe('group view (epic UX rework R11)', () => {
    const VISIBLE = { visible: true, reasons: [] };
    const HIDDEN = { visible: false, reasons: [{ code: 'tale-hidden', subject: 'tale' }] };
    const four = ['A', 'B', 'C', 'D'].map((title, i) => ({
      ...taleA,
      id: `t${i + 1}`,
      title,
      position: i,
      visibility: VISIBLE,
    }));
    const summer = { ...group, visibility: VISIBLE, tales: four };
    const winter = { ...group, id: 'g2', name: 'Winter', position: 1, visibility: VISIBLE, tales: [] };
    const data: Data = { ...oneZone, displays: { z1: frameBar }, groups: { z1: [summer, winter] } };
    const url = () => TestBed.inject(Router).url;

    function nameButton(root: HTMLElement, name: string): HTMLButtonElement {
      const found = [...root.querySelectorAll<HTMLButtonElement>('.group-row__open')].find((b) => b.textContent?.trim() === name);
      if (!found) throw new Error(`No ${name} name`);
      return found;
    }

    function cardOf(title: string): HTMLElement {
      const card = groupView()?.querySelector(`[aria-label="More for ${title}"]`)?.closest<HTMLElement>('.tale-card');
      if (!card) throw new Error(`No ${title} card`);
      return card;
    }

    it('opens from the name as a modal dialog named by the group, in the URL, and closes back to the name', async () => {
      const { fixture, root } = await open('/zones/z1', data, false);
      const name = nameButton(root, 'Summer');
      name.focus();
      name.click();
      await settle(fixture);

      const view = groupView() as HTMLElement;
      expect(view.getAttribute('aria-modal')).toBe('true');
      expect(view.getAttribute('role')).toBe('dialog');
      const title = view.querySelector(`#${view.getAttribute('aria-labelledby')}`);
      expect(title?.textContent?.trim()).toBe('Summer');
      // Focus moves to its heading; the URL names the group.
      expect(document.activeElement).toBe(title);
      expect(url()).toBe('/zones/z1?group=g1');
      expect(name.getAttribute('aria-expanded')).toBe('true');
      expect(name.getAttribute('aria-controls')).toBe(view.id);

      // The head: switch, indicator, the group's ⋯ menu with the row's items, and the count.
      expect(view.querySelector('[role=switch][aria-label="Summer on site"]')?.getAttribute('aria-checked')).toBe('true');
      expect(view.querySelector('.group-view__head app-visibility')?.textContent?.trim()).toBe('Visible on site');
      expect(menuItems(view, 'More for Summer').map((item) => item.label)).toEqual(GROUP_MENU);
      expect(view.querySelector('.group-view__count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('4 of 4 shown · max 100');

      // Escape closes it; focus is back on the name; the URL drops the group.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(document.activeElement).toBe(nameButton(root, 'Summer'));
      for (let i = 0; i < 20 && url() !== '/zones/z1'; i++) await settle(fixture);
      expect(url()).toBe('/zones/z1');
      expect(name.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps Tab inside the view', async () => {
      const { fixture } = await open('/zones/z1', data);
      const view = groupView() as HTMLElement;
      const focusables = [...view.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const last = focusables.at(-1) as HTMLElement;
      last.focus();
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      await settle(fixture);
      expect(document.activeElement).toBe(focusables[0]);
      expect(focusables[0].getAttribute('aria-label')).toBe('Close');
    });

    it('wraps Shift+Tab from the heading it opens on to the last control', async () => {
      const { fixture } = await open('/zones/z1', data);
      const view = groupView() as HTMLElement;
      const heading = view.querySelector<HTMLElement>('.drawer__title') as HTMLElement;
      expect(document.activeElement).toBe(heading);
      const focusables = [...view.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      heading.dispatchEvent(event);
      await settle(fixture);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(focusables.at(-1));
    });

    it('makes the page behind it inert and stops it scrolling, and keeps drawers opened from it usable', async () => {
      const { fixture } = await open('/zones/z1', data);
      const shell = document.querySelector('.shell') as HTMLElement;
      expect(shell.hasAttribute('inert')).toBe(true);
      expect(document.querySelector('.skip-link')?.hasAttribute('inert')).toBe(true);
      expect(document.documentElement.style.overflow).toBe('hidden');
      // The view itself is out of the inert shell, beside it.
      expect(shell.contains(groupView())).toBe(false);
      expect(groupView()?.closest('[inert]')).toBeNull();
      pickMenuItem(groupView() as HTMLElement, 'More for A', 'Schedule');
      await settle(fixture);
      expect(drawer()?.closest('[inert]')).toBeNull();
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);

      (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
      await settle(fixture);
      expect(shell.hasAttribute('inert')).toBe(false);
      expect(document.documentElement.style.overflow).toBe('');
    });

    it('leaves nothing behind when the page is left with the view open', async () => {
      const { fixture } = await open('/zones/z1', data);
      expect(groupView()).not.toBeNull();
      await TestBed.inject(Router).navigateByUrl('/zones');
      await settle(fixture);
      expect(document.querySelector('app-group-view')).toBeNull();
      expect(document.querySelector('.shell')?.hasAttribute('inert')).toBe(false);
      expect(document.documentElement.style.overflow).toBe('');
    });

    it('goes back in history when it closes after opening from the page, so Back does not reopen it', async () => {
      const { fixture, root } = await open('/zones/z1', data, false);
      const loc = TestBed.inject(Location);
      const back = vi.spyOn(loc, 'back');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      nameButton(root, 'Summer').click();
      await settle(fixture);
      expect(url()).toBe('/zones/z1?group=g1');
      // The entry is marked as the page's own.
      expect((loc.getState() as Record<string, unknown>)['taleartGroupView']).toBe('g1');

      navigate.mockClear();
      (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
      await settle(fixture);
      expect(groupView()).toBeNull();
      // Location.back(): the popstate brings the router back to the entry before, with no
      // navigation of its own (which would leave that entry behind).
      expect(back).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
      for (let i = 0; i < 20 && url() !== '/zones/z1'; i++) await settle(fixture);
      expect(url()).toBe('/zones/z1');
      expect(groupView()).toBeNull();
      expect(document.activeElement).toBe(nameButton(root, 'Summer'));

      // A deep link has no entry of ours to go back to: it closes in place.
      await TestBed.inject(Router).navigateByUrl('/zones/z1?group=g2');
      await settle(fixture);
      (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
      await settle(fixture);
      expect(back).toHaveBeenCalledTimes(1);
      expect(url()).toBe('/zones/z1');
      back.mockRestore();
      navigate.mockRestore();
    });

    it('opens from a deep link, and closing it focuses the group name it belongs to', async () => {
      const { fixture, root } = await open('/zones/z1?group=g2', data, false);
      expect(groupView()?.querySelector('h2')?.textContent?.trim()).toBe('Winter');
      expect(groupView()?.textContent).toContain('No tales yet.');
      (groupView()?.querySelector('.drawer__close') as HTMLButtonElement).click();
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(document.activeElement).toBe(nameButton(root, 'Winter'));
      expect(url()).toBe('/zones/z1');
    });

    it('drops a ?group= that names no group of the zone', async () => {
      await open('/zones/z1?group=nope', data, false);
      expect(groupView()).toBeNull();
      expect(url()).toBe('/zones/z1');
    });

    it('drops ?group= on a zone that does not exist', async () => {
      const { root } = await open('/zones/nope?group=g1', data, false);
      expect(root.textContent).toContain('Zone not found');
      expect(url()).toBe('/zones/nope');
    });

    it('closes with the browser Back, as a page does', async () => {
      const { fixture, root } = await open('/zones/z1', data, false);
      nameButton(root, 'Summer').click();
      await settle(fixture);
      expect(groupView()).not.toBeNull();
      await TestBed.inject(Router).navigateByUrl('/zones/z1');
      await settle(fixture);
      expect(groupView()).toBeNull();
    });

    it('hides a tale from its card in one action, saved at once, then shows it again; every card has a dot', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      expect([...(groupView()?.querySelectorAll('.tale-card') ?? [])].map((card) => card.querySelector('app-visibility button')?.getAttribute('aria-label'))).toEqual(
        ['Visible on site', 'Visible on site', 'Visible on site', 'Visible on site'],
      );

      // One press: the request goes at once, with no save button.
      const toggle = () => cardOf('B').querySelector<HTMLButtonElement>('[role=switch]') as HTMLButtonElement;
      expect(toggle().getAttribute('aria-label')).toBe('Show B');
      toggle().click();
      await settle(fixture);
      expect(toggle().getAttribute('aria-disabled')).toBe('true');
      const req = http.expectOne(`${API_BASE}/tales/t2/status`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...four[1], status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      const hidden = { ...four[1], status: 'paused', storedStatus: 'paused', visibility: HIDDEN };
      await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: [four[0], hidden, four[2], four[3]] }, winter] } });
      await settle(fixture);

      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(cardOf('B').querySelector('.show-switch__state')?.textContent?.trim()).toBe('Hidden');
      expect(cardOf('B').querySelector('app-visibility button')?.getAttribute('aria-label')).toBe('Not visible: tale is hidden');
      expect(groupView()?.querySelector('.group-view__count')?.textContent).toContain('3 of 4 shown');
      // Said in the view's own live region, inside the dialog; the page's region stays quiet.
      expect(announced(root)).toBe('B is now hidden. Not visible: tale is hidden');
      expect(root.querySelector('app-zone-detail-page > .page > [aria-live=polite]')?.textContent).toBe('');

      toggle().click();
      await settle(fixture);
      const back = http.expectOne(`${API_BASE}/tales/t2/status`);
      expect(back.request.body).toEqual({ status: 'live' });
      back.flush({ ...four[1] });
      await settle(fixture);
      await flushRefresh(fixture, data);
      await settle(fixture);
      expect(toggle().getAttribute('aria-checked')).toBe('true');
      expect(groupView()?.querySelector('.group-view__count')?.textContent).toContain('4 of 4 shown');
      expect(announced(root)).toBe('B is now shown. Visible on site');
    });

    it("shows the API's refusal in the view and keeps the tale's state", async () => {
      const { fixture } = await open('/zones/z1', data);
      cardOf('A').querySelector<HTMLButtonElement>('[role=switch]')?.click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/status`)
        .flush({ error: { code: 'invalid_status_transition', message: 'A cannot be hidden' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      // Named by its tale, as the view shows many.
      expect(groupView()?.querySelector('[role=alert]')?.textContent).toContain('A: A cannot be hidden');
      expect(cardOf('A').querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true');
    });

    it("offers every tale ⋯ item: Edit in Tale Studio, Replace media, Schedule, Duplicate, Archive, Delete", async () => {
      const { fixture } = await open('/zones/z1', data);
      const view = () => groupView() as HTMLElement;
      expect(menuItems(view(), 'More for A').map((item) => item.label)).toEqual([
        'Edit in Tale Studio',
        'Replace media',
        'Schedule',
        'Duplicate',
        'Archive',
        'Delete',
      ]);

      // Edit in Tale Studio: the studio, which links back to this zone.
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      pickMenuItem(view(), 'More for A', 'Edit in Tale Studio');
      expect(navigate).toHaveBeenCalledWith(['/tales', 't1', 'studio'], { queryParams: { zone: 'z1' } });
      navigate.mockRestore();
      await settle(fixture);

      // Replace media: the tale drawer, at its Replace media action (story 8.12); it opens over the view.
      pickMenuItem(view(), 'More for A', 'Replace media');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Tale');
      expect(document.activeElement?.id).toBe('tale-replace-media');
      // Escape closes only the drawer on top; focus goes back to the card's ⋯.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(groupView()).not.toBeNull();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for A');

      // Schedule.
      pickMenuItem(view(), 'More for A', 'Schedule');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Schedule');
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      expect(groupView()).not.toBeNull();

      // Duplicate.
      pickMenuItem(view(), 'More for A', 'Duplicate');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Duplicate tale');
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for A');

      // Archive: at once, announced; the card then offers Restore and has no switch.
      pickMenuItem(view(), 'More for A', 'Archive');
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/status`);
      expect(req.request.body).toEqual({ status: 'archived' });
      const archived = { ...four[0], status: 'archived', storedStatus: 'archived' };
      req.flush(archived);
      await settle(fixture);
      await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: [archived, ...four.slice(1)] }, winter] } });
      await settle(fixture);
      expect(cardOf('A').querySelector('[role=switch]')).toBeNull();
      expect(cardOf('A').querySelector('.status-badge')?.textContent).toContain('Archived');
      expect(menuItems(view(), 'More for A').at(-2)?.label).toBe('Restore');
      expect(announced(groupView() as HTMLElement)).toContain('A is now archived');
    });

    describe('delete a tale (story 8.20)', () => {
      const confirmation = () => document.querySelector<HTMLElement>('[role=alertdialog]');
      const deleteRequest = (taleId: string) =>
        http.expectOne((req) => req.method === 'DELETE' && req.url === `${API_BASE}/tales/${taleId}`);

      it('asks first, naming the tale, with focus on Cancel; Cancel deletes nothing and returns focus', async () => {
        const { fixture } = await open('/zones/z1', data);
        pickMenuItem(groupView() as HTMLElement, 'More for B', 'Delete');
        await settle(fixture);
        const dialog = confirmation() as HTMLElement;
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe('Delete tale');
        const text = dialog.querySelector(`#${dialog.getAttribute('aria-describedby')}`)?.textContent?.replace(/\s+/g, ' ');
        expect(text).toContain('Delete B from Summer?');
        expect(text).toContain('This cannot be undone.');
        expect(document.activeElement?.id).toBe('delete-tale-cancel');

        buttonNamed(dialog, 'Cancel').click();
        await settle(fixture);
        expect(confirmation()).toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('More for B');
        http.expectNone((req) => req.method === 'DELETE');
        expect(groupView()).not.toBeNull();
      });

      it('deletes it at once from every list, announces it with the new count and moves focus to the next card', async () => {
        const projectGroups = { p1: [{ ...summer, zoneIds: ['z1'], taleCount: 4, shownTaleCount: 4 }] };
        const { fixture } = await open('/zones/z1', { ...data, projectGroups });
        const store = TestBed.inject(DashboardStore);
        store.ensureProjectTaleGroups('p1');
        await settle(fixture);
        pickMenuItem(groupView() as HTMLElement, 'More for B', 'Delete');
        await settle(fixture);
        buttonNamed(confirmation() as HTMLElement, 'Delete tale').click();
        await settle(fixture);
        expect(buttonNamed(confirmation() as HTMLElement, 'Deleting…').disabled).toBe(true);
        deleteRequest('t2').flush(null, { status: 204, statusText: 'No Content' });
        await settle(fixture);
        // Gone at once, the others closing up; the project list counts one fewer.
        expect([...(groupView() as HTMLElement).querySelectorAll('.tale-card__name')].map((n) => n.textContent)).toEqual(['A', 'C', 'D']);
        expect(store.taleGroup('g1')?.tales.map((t) => t.position)).toEqual([0, 1, 2]);
        expect(store.projectTaleGroup('g1')).toMatchObject({ taleCount: 3, shownTaleCount: 3 });
        const rest = four.filter((t) => t.id !== 't2').map((t, position) => ({ ...t, position }));
        await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: rest }, winter] }, projectGroups });
        await settle(fixture);
        expect(confirmation()).toBeNull();
        expect(groupView()?.querySelector('.group-view__count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('3 of 3 shown · max 100');
        expect(announced(groupView() as HTMLElement)).toBe('B deleted from Summer. 3 of 3 shown.');
        expect(document.activeElement?.getAttribute('aria-label')).toBe('More for C');
      });

      it('moves focus to Add tale once the last tale is deleted, and to the card before when the last card goes', async () => {
        const two = four.slice(0, 2);
        const { fixture } = await open('/zones/z1', { ...data, groups: { z1: [{ ...summer, tales: two }, winter] } });
        pickMenuItem(groupView() as HTMLElement, 'More for B', 'Delete');
        await settle(fixture);
        buttonNamed(confirmation() as HTMLElement, 'Delete tale').click();
        await settle(fixture);
        deleteRequest('t2').flush(null, { status: 204, statusText: 'No Content' });
        await settle(fixture);
        await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: [two[0]] }, winter] } });
        await settle(fixture);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('More for A');

        pickMenuItem(groupView() as HTMLElement, 'More for A', 'Delete');
        await settle(fixture);
        buttonNamed(confirmation() as HTMLElement, 'Delete tale').click();
        await settle(fixture);
        deleteRequest('t1').flush(null, { status: 204, statusText: 'No Content' });
        await settle(fixture);
        await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: [] }, winter] } });
        await settle(fixture);
        expect(document.activeElement?.id).toBe('group-view-add-tale');
        expect(announced(groupView() as HTMLElement)).toBe('A deleted from Summer. No tales yet.');
      });

      it('shows a refusal in the confirmation, announced, and keeps the tale', async () => {
        const { fixture } = await open('/zones/z1', data);
        pickMenuItem(groupView() as HTMLElement, 'More for C', 'Delete');
        await settle(fixture);
        buttonNamed(confirmation() as HTMLElement, 'Delete tale').click();
        await settle(fixture);
        deleteRequest('t3').flush(
          { error: { code: 'forbidden', message: 'You do not have access to this project' } },
          { status: 403, statusText: 'Forbidden' },
        );
        await settle(fixture);
        const alert = confirmation()?.querySelector('[role=alert]');
        expect(alert?.textContent?.trim()).toBe('You do not have access to this project');
        expect(cardOf('C')).toBeTruthy();
        expect(buttonNamed(confirmation() as HTMLElement, 'Delete tale').disabled).toBe(false);
      });

      it('drops a deletion request for a tale the group no longer holds, opening nothing', async () => {
        const { fixture } = await open('/zones/z1', data);
        const store = TestBed.inject(DashboardStore);
        expect(store.requestTaleDeletion('gone', 'g1')).toBe(true);
        await settle(fixture);
        expect(store.taleDeletionRequest()).toBeNull();
        expect(confirmation()).toBeNull();
        // No view shows Winter: a request for it is refused at once.
        expect(store.requestTaleDeletion('t1', 'g2')).toBe(false);
        expect(store.taleDeletionRequest()).toBeNull();
      });

      it('"Delete tale…" in the tale drawer closes it and asks in the group view; Escape returns to the card', async () => {
        const { fixture } = await open('/zones/z1', data);
        (groupView() as HTMLElement).querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
        await settle(fixture);
        buttonNamed(drawer() as HTMLElement, 'Delete tale…').click();
        await settle(fixture);
        expect(drawer()).toBeNull();
        expect(confirmation()?.textContent).toContain('Delete A from Summer?');
        expect(document.activeElement?.id).toBe('delete-tale-cancel');
        expect(TestBed.inject(DashboardStore).taleDeletionRequest()).toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await settle(fixture);
        expect(confirmation()).toBeNull();
        expect(groupView()).not.toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Open tale A');
      });
    });

    it('moves a tale by keyboard inside the view, keeping focus and announcing it', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      const later = cardOf('A').querySelector<HTMLButtonElement>('[aria-label="Move A later"]') as HTMLButtonElement;
      later.focus();
      later.click();
      await settle(fixture);
      expect(announced(root)).toBe('A moved to position 2 of 4');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Move A later');
      expect(groupView()?.contains(document.activeElement)).toBe(true);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      expect(req.request.body).toEqual({ taleIds: ['t2', 't1', 't3', 't4'] });
      req.flush([four[1], four[0], four[2], four[3]].map((tale, position) => ({ ...tale, position })));
      await settle(fixture);
    });

    it('adds a tale from the view, into the open group', async () => {
      const { fixture } = await open('/zones/z1', data);
      const add = groupView()?.querySelector<HTMLButtonElement>('#group-view-add-tale') as HTMLButtonElement;
      expect(add.getAttribute('aria-label')).toBe('Add tale to Summer');
      add.click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('tale');
      expect(drawer()?.textContent).toContain('Summer');
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      expect(document.activeElement).toBe(add);
    });

    it('turns the group Off from its head and closes when the group leaves the zone', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      groupView()?.querySelector<HTMLButtonElement>('[role=switch][aria-label="Summer on site"]')?.click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...summer, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      const off = { ...summer, status: 'paused', storedStatus: 'paused', visibility: { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] } };
      await flushRefresh(fixture, { ...data, groups: { z1: [off, winter] } });
      await settle(fixture);
      expect(groupView()?.querySelector('[role=switch][aria-label="Summer on site"]')?.getAttribute('aria-checked')).toBe('false');
      expect(announced(root)).toBe('Summer is now off. Not visible: group is off');

      // Removed from this zone elsewhere: the view closes and the URL drops it; focus goes to the
      // row now in its place.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, { ...data, groups: { z1: [winter] } });
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(url()).toBe('/zones/z1');
      expect(document.activeElement).toBe(nameButton(root, 'Winter'));
    });

    it('archives the group from its view: the view closes and focus goes to Undo', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      pickMenuItem(groupView() as HTMLElement, 'More for Summer', 'Archive');
      await settle(fixture);
      const archived = { ...summer, status: 'archived', storedStatus: 'archived' };
      http.expectOne(`${API_BASE}/tale-groups/g1/status`).flush(archived);
      await settle(fixture);
      await flushRefresh(fixture, { ...data, groups: { z1: [archived, winter] } });
      await settle(fixture);
      for (let i = 0; i < 20 && url() !== '/zones/z1'; i++) await settle(fixture);
      expect(groupView()).toBeNull();
      expect(document.activeElement?.id).toBe('undo-archive');
      expect(announced(root)).toBe('Summer archived. Undo is above the list.');
    });

    it('closes Duplicate on Escape and leaves the view open; a second Escape closes the view', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      pickMenuItem(groupView() as HTMLElement, 'More for A', 'Duplicate');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Duplicate tale');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(groupView()).not.toBeNull();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for A');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(document.activeElement).toBe(nameButton(root, 'Summer'));
    });

    it("closes an open indicator tip on Escape without closing the view", async () => {
      const { fixture } = await open('/zones/z1', data);
      const dot = cardOf('A').querySelector<HTMLButtonElement>('app-visibility button') as HTMLButtonElement;
      const tipOpen = () => !!dot.closest('app-visibility')?.classList.contains('visibility--open');
      dot.click();
      await settle(fixture);
      expect(tipOpen()).toBe(true);
      dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle(fixture);
      expect(tipOpen()).toBe(false);
      expect(groupView()).not.toBeNull();
      // With no tip open, Escape closes the view.
      dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle(fixture);
      expect(groupView()).toBeNull();
    });

    it('rolls back a refused tale reorder in the view and says why', async () => {
      const { fixture } = await open('/zones/z1', data);
      const names = () => [...(groupView()?.querySelectorAll('.tale-card__name') ?? [])].map((n) => n.textContent);
      (cardOf('A').querySelector('[aria-label="Move A later"]') as HTMLButtonElement).click();
      await settle(fixture);
      expect(names()).toEqual(['B', 'A', 'C', 'D']);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/tales/order`)
        .flush({ error: { code: 'order_mismatch', message: 'The order changed elsewhere' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      expect(names()).toEqual(['A', 'B', 'C', 'D']);
      expect(groupView()?.querySelector('[role=alert]')?.textContent).toContain('The order changed elsewhere');
    });

    it('keeps a pending tale order through a refresh, then reads the zone again once it is saved', async () => {
      const { fixture } = await open('/zones/z1', data);
      const names = () => [...(groupView()?.querySelectorAll('.tale-card__name') ?? [])].map((n) => n.textContent);
      (cardOf('A').querySelector('[aria-label="Move A later"]') as HTMLButtonElement).click();
      await settle(fixture);
      const order = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      // A refresh that read the old order while the write was pending does not undo the move.
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, data);
      await settle(fixture);
      expect(names()).toEqual(['B', 'A', 'C', 'D']);
      const moved = [four[1], four[0], four[2], four[3]].map((tale, position) => ({ ...tale, position }));
      order.flush(moved);
      await settle(fixture);
      // The zone is read again now that its order is settled.
      await flushRefresh(fixture, { ...data, groups: { z1: [{ ...summer, tales: moved }, winter] } });
      await settle(fixture);
      expect(names()).toEqual(['B', 'A', 'C', 'D']);
    });

    it("is a wide drawer on desktop and the whole page on phones (below 640 px, the dashboard's phone breakpoint)", async () => {
      // jsdom does no layout: this checks the rules the view applies, which the browser run
      // screenshots at 390x844.
      await open('/zones/z1', data);
      expect(groupView()?.classList).toContain('drawer--wide');
      const css = [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
      expect(css).toMatch(/app-group-view \.drawer--wide\s*\{[^}]*width:\s*min\(960px,\s*100%\)/);
      const phone = css.slice(css.indexOf('@media (max-width: 639.98px)', css.indexOf('app-group-view .drawer--wide')));
      expect(phone).toMatch(/app-group-view \.drawer--wide\s*\{[^}]*inset:\s*0;[^}]*width:\s*100%/);
      expect(phone).toMatch(/app-group-view \.drawer-host--wide > \.drawer-backdrop\s*\{[^}]*display:\s*none/);
      // Under the drawers opened from it.
      expect(css).toMatch(/app-group-view \.drawer--wide\s*\{[^}]*z-index:\s*39/);
    });
  });

  describe('duplicate a tale (epic Tale Studio R11)', () => {
    const autumn = { ...group, id: 'g9', name: 'Autumn', position: 1, tales: [] };
    const projectGroups = {
      p1: [
        { id: 'g9', projectId: 'p1', name: 'Autumn', taleCount: 3, zoneIds: ['z1'] },
        { id: 'g1', projectId: 'p1', name: 'Summer', taleCount: 2, zoneIds: ['z1'] },
        { id: 'g5', projectId: 'p1', name: 'Winter', taleCount: 100, zoneIds: [] },
      ],
    };
    const data: Data = { ...oneZone, groups: { z1: [{ ...group, tales: [taleA, taleB] }, autumn] }, projectGroups };

    function options(): { label: string; disabled: boolean; selected: boolean }[] {
      return [...(drawer()?.querySelectorAll<HTMLOptionElement>('select[name=taleGroupId] option') ?? [])].map((o) => ({
        label: o.textContent?.trim() ?? '',
        disabled: o.disabled,
        selected: o.selected,
      }));
    }

    it('duplicates a tale from its card into another group, announces it, and the new card shows Hidden', async () => {
      const { fixture, root } = await open('/zones/z1', data);

      // Duplicate is in the tale card's ⋯ menu (epic UX rework R8, R11).
      pickMenuItem(root, 'More for A', 'Duplicate');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Duplicate tale');
      expect(drawer()?.textContent).toContain('A copy of A with its content and media. The copy is hidden until you show it.');
      // The tale's own group first and chosen, each with its room; a full group cannot be chosen.
      expect(options()).toEqual([
        { label: 'Summer (this group): 2 / 100', disabled: false, selected: true },
        { label: 'Autumn: 3 / 100', disabled: false, selected: false },
        { label: 'Winter: 100 / 100, full', disabled: true, selected: false },
      ]);
      expect(drawer()?.querySelector('#duplicate-hint')?.textContent).toBe('The copy goes right after the original.');
      choose(drawer()?.querySelector<HTMLSelectElement>('select[name=taleGroupId]') ?? null, 'g9');
      await settle(fixture);
      expect(drawer()?.querySelector('#duplicate-hint')?.textContent).toBe('The copy goes last in Autumn.');

      buttonNamed(drawer() as HTMLElement, 'Duplicate').click();
      await settle(fixture);
      const copy = { ...taleA, id: 't9', taleGroupId: 'g9', title: 'A (copy)', position: 0, status: 'paused', storedStatus: 'paused' };
      const req = http.expectOne(`${API_BASE}/tales/t1/duplicate`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ taleGroupId: 'g9' });
      req.flush(copy, { status: 201, statusText: 'Created' });
      await settle(fixture);
      // Closed and said at once, before the groups are read again.
      expect(drawer()).toBeNull();
      expect(announced(root)).toBe(
        'Duplicated as A (copy) in Autumn. The copy is hidden until you show it.',
      );
      // Only the project's groups are read again, not everything.
      http.expectNone(`${API_BASE}/projects`);
      http.expectOne(`${API_BASE}/projects/p1/tale-groups`).flush([
        { ...projectGroups.p1[0], taleCount: 4 },
        ...projectGroups.p1.slice(1),
      ]);
      http.expectOne(`${API_BASE}/zones/z1/tale-groups`).flush([{ ...group, tales: [taleA, taleB] }, { ...autumn, tales: [copy] }]);
      await settle(fixture);

      // The copy is in Autumn: its group view shows it.
      await expandGroups(fixture, root, 'Autumn');
      const card = root.querySelector('[aria-label="More for A (copy)"]')?.closest('.tale-card');
      expect(card?.querySelector('.show-switch__state')?.textContent?.trim()).toBe('Hidden');
      expect(card?.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false');
    });

    it("keeps the drawer open with the API's message when the group is full, and refuses a full group at once", async () => {
      const { fixture, root } = await open('/zones/z1', data);
      pickMenuItem(root, 'More for B', 'Duplicate');
      await settle(fixture);
      const select = drawer()?.querySelector<HTMLSelectElement>('select[name=taleGroupId]') ?? null;
      choose(select, 'g5');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Duplicate').click();
      await settle(fixture);
      http.expectNone(`${API_BASE}/tales/t2/duplicate`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Winter already holds 100 tales');

      choose(select, 'g1');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Duplicate').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t2/duplicate`)
        .flush(
          { error: { code: 'tale_group_full', message: 'A tale group holds at most 100 tales' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent?.trim()).toBe(
        'Summer already holds 100 tales. Choose another tale group.',
      );
      expect(select?.getAttribute('aria-invalid')).toBe('true');

      // A group gone meanwhile, and a lost connection, in plain words.
      buttonNamed(drawer() as HTMLElement, 'Duplicate').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t2/duplicate`)
        .flush(
          { error: { code: 'tale_group_not_found', message: 'taleGroupId does not match a tale group' } },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent?.trim()).toBe(
        'That tale group is no longer available. Choose another.',
      );
      buttonNamed(drawer() as HTMLElement, 'Duplicate').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t2/duplicate`).error(new ProgressEvent('error'), { status: 0 });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Check the connection');

      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for B');
    });

    it('chooses the first group with room, and says so when no group has room', async () => {
      const fullSummer = { ...group, tales: [taleA, taleB] };
      const { fixture, root } = await open('/zones/z1', {
        ...data,
        groups: { z1: [fullSummer, autumn] },
        projectGroups: { p1: [{ ...projectGroups.p1[1], taleCount: 100 }, projectGroups.p1[0], projectGroups.p1[2]] },
      });
      pickMenuItem(root, 'More for A', 'Duplicate');
      await settle(fixture);
      expect(options().map((o) => [o.label, o.selected])).toEqual([
        ['Summer (this group): 100 / 100, full', false],
        ['Autumn: 3 / 100', true],
        ['Winter: 100 / 100, full', false],
      ]);
      expect(drawer()?.querySelector('#duplicate-hint')?.textContent).toBe('The copy goes last in Autumn.');
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);

      const store = TestBed.inject(DashboardStore);
      store.projectTaleGroups.set({ p1: [{ ...projectGroups.p1[1], taleCount: 100 }] } as never);
      await settle(fixture);
      pickMenuItem(root, 'More for A', 'Duplicate');
      await settle(fixture);
      expect(drawer()?.querySelector('#duplicate-hint')?.textContent).toContain(
        'Every tale group of this project already holds 100 tales',
      );
      expect((drawer()?.querySelector('#duplicate-submit') as HTMLButtonElement).disabled).toBe(true);
    });

    it("offers the tale's own group when the project's groups have not been read", async () => {
      const { fixture, root } = await open('/zones/z1', { ...data, projectGroups: {} });
      pickMenuItem(root, 'More for A', 'Duplicate');
      await settle(fixture);
      expect(options()).toEqual([{ label: 'Summer (this group): 2 / 100', disabled: false, selected: true }]);
      expect(drawer()?.querySelector('#duplicate-hint')?.textContent).toBe('The copy goes right after the original.');
    });
  });

  describe('statuses', () => {
    const draft ={ ...group, id: 'g2', name: 'Draft one', status: 'draft', storedStatus: 'draft', position: 1, tales: [] };
    const paused = { ...group, id: 'g3', name: 'Paused one', status: 'paused', storedStatus: 'paused', position: 2, tales: [] };
    const archived = { ...group, id: 'g4', name: 'Archived one', status: 'archived', storedStatus: 'archived', position: 3, tales: [] };
    const hiddenTale = { ...taleB, status: 'paused', storedStatus: 'paused' };
    const live = { ...group, tales: [taleA, hiddenTale] };

    function groupRow(root: HTMLElement, name: string): HTMLElement {
      const row = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => li.querySelector('h4')?.textContent?.trim() === name);
      if (!row) throw new Error(`No ${name} row`);
      return row;
    }

    function badge(root: Element): string {
      return root.querySelector('.status-badge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    function switchNamed(root: ParentNode, name: string): HTMLButtonElement {
      const button = root.querySelector<HTMLButtonElement>(`[role=switch][aria-label="${name}"]`);
      if (!button) throw new Error(`No ${name} switch`);
      return button;
    }

    // The visible On/Off or Shown/Hidden text beside a switch, and whether the switch is checked.
    function switchState(root: ParentNode, name: string): [string, string | null] {
      const button = switchNamed(root, name);
      return [
        button.closest('.show-switch')?.querySelector('.show-switch__state')?.textContent?.trim() ?? '',
        button.getAttribute('aria-checked'),
      ];
    }

    // The status items of a group row's ⋯ menu: Archive or Restore (epic UX rework R10).
    function statusButtons(root: HTMLElement, name: string): string[] {
      return menuItems(groupRow(root, name), `More for ${name}`)
        .map((item) => item.label)
        .filter((label) => label === 'Archive' || label === 'Restore');
    }

    it('gives each group an On/Off switch and each tale card a Shown/Hidden switch, with Archive or Restore beside', async () => {
      const { root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live, draft, paused, archived] } });

      expect(switchState(groupRow(root, 'Summer'), 'Summer on site')).toEqual(['On', 'true']);
      expect(switchState(groupRow(root, 'Draft one'), 'Draft one on site')).toEqual(['Off', 'false']);
      expect(switchState(groupRow(root, 'Paused one'), 'Paused one on site')).toEqual(['Off', 'false']);
      expect(groupRow(root, 'Archived one').querySelector('[role=switch]')).toBeNull();
      expect(badge(groupRow(root, 'Archived one'))).toBe('Status: Archived');
      for (const name of ['Summer', 'Draft one', 'Paused one']) {
        expect(groupRow(root, name).querySelector('.group-row .status-badge')).toBeNull();
        expect(statusButtons(root, name)).toEqual(['Archive']);
      }
      expect(statusButtons(root, 'Archived one')).toEqual(['Restore']);

      const summer = groupView() as HTMLElement;
      expect(switchState(summer, 'Show A')).toEqual(['Shown', 'true']);
      expect(switchState(summer, 'Show B')).toEqual(['Hidden', 'false']);
      expect(summer.querySelector('.tale-card .status-badge')).toBeNull();
    });

    it('shows the tales of a group that is off as blocked by group, keeping their own switch', async () => {
      const blocked = { ...live, status: 'paused', storedStatus: 'paused', tales: [{ ...taleA, status: 'blocked-by-group' }, hiddenTale] };
      await open('/zones/z1', { ...oneZone, groups: { z1: [blocked] } });

      const cards = [...(groupView() as HTMLElement).querySelectorAll('.tale-card')];
      expect(cards.map((c) => badge(c))).toEqual(['Status: Blocked by group', '']);
      expect(switchState(cards[0], 'Show A')).toEqual(['Shown', 'true']);
    });

    it('turns a group on with its switch at once, and announces it', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [draft] } });

      switchNamed(groupRow(root, 'Draft one'), 'Draft one on site').click();
      await settle(fixture);
      expect(switchNamed(groupRow(root, 'Draft one'), 'Draft one on site').getAttribute('aria-disabled')).toBe('true');
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/status`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'live' });
      req.flush({ ...draft, status: 'live', storedStatus: 'live' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...draft, status: 'live', storedStatus: 'live' }] } });
      await settle(fixture);

      expect(switchState(groupRow(root, 'Draft one'), 'Draft one on site')).toEqual(['On', 'true']);
      expect(announced(root)).toBe('Draft one is now on');
    });

    it('turns a group off by storing paused', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      switchNamed(groupRow(root, 'Summer'), 'Summer on site').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...live, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...live, status: 'paused', storedStatus: 'paused' }] } });
      await settle(fixture);

      expect(switchState(groupRow(root, 'Summer'), 'Summer on site')).toEqual(['Off', 'false']);
      expect(announced(root)).toBe('Summer is now off');
    });

    it('restores an archived group as off', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [archived] } });

      pickMenuItem(groupRow(root, 'Archived one'), 'More for Archived one', 'Restore');
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g4/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...archived, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...archived, status: 'paused', storedStatus: 'paused' }] } });
      await settle(fixture);

      expect(switchState(groupRow(root, 'Archived one'), 'Archived one on site')).toEqual(['Off', 'false']);
      expect(statusButtons(root, 'Archived one')).toEqual(['Archive']);
    });

    it("shows the API's message when a switch is refused, and keeps its state", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      switchNamed(groupRow(root, 'Summer'), 'Summer on site').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/status`)
        .flush(
          { error: { code: 'invalid_status_transition', message: 'The status cannot change from archived to paused' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);

      expect(root.querySelector('[role=alert]')?.textContent).toContain('The status cannot change from archived to paused');
      expect(switchState(groupRow(root, 'Summer'), 'Summer on site')).toEqual(['On', 'true']);
      expect(switchNamed(groupRow(root, 'Summer'), 'Summer on site').getAttribute('aria-disabled')).toBeNull();
    });

    it('shows the newer of two quick toggles: a refresh started before it never brings back the old state', async () => {
      const { fixture } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });
      const hiddenA = { ...taleA, status: 'paused', storedStatus: 'paused' };

      switchNamed(groupView() as HTMLElement, 'Show A').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/status`).flush(hiddenA);
      await settle(fixture);
      // The PUT's answer shows at once.
      expect(switchState(groupView() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);
      // The refresh after it gets as far as the tale groups.
      http.expectOne(`${API_BASE}/projects`).flush([acme]);
      await settle(fixture);
      http.expectOne(`${API_BASE}/zones`).flush([zone]);
      await settle(fixture);
      http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
      await settle(fixture);
      const olderGroups = http.expectOne(`${API_BASE}/zones/z1/tale-groups`);

      switchNamed(groupView() as HTMLElement, 'Show B').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t2/status`).flush(taleB);
      await settle(fixture);
      expect(switchState(groupView() as HTMLElement, 'Show B')).toEqual(['Shown', 'true']);
      // The older refresh read the groups before B was shown: its answer is dropped.
      olderGroups.flush([{ ...live, tales: [hiddenA, hiddenTale] }]);
      await settle(fixture);
      expect(switchState(groupView() as HTMLElement, 'Show B')).toEqual(['Shown', 'true']);

      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...live, tales: [hiddenA, taleB] }] } });
      await settle(fixture);
      expect(switchState(groupView() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);
      expect(switchState(groupView() as HTMLElement, 'Show B')).toEqual(['Shown', 'true']);
    });

    it('hides and shows a tale from its card', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });
      const hiddenA = { ...taleA, status: 'paused', storedStatus: 'paused' };

      switchNamed(groupView() as HTMLElement, 'Show A').click();
      await settle(fixture);
      expect(switchNamed(groupView() as HTMLElement, 'Show A').getAttribute('aria-disabled')).toBe('true');
      const hide = http.expectOne(`${API_BASE}/tales/t1/status`);
      expect(hide.request.method).toBe('PUT');
      expect(hide.request.body).toEqual({ status: 'paused' });
      hide.flush(hiddenA);
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...live, tales: [hiddenA, hiddenTale] }] } });
      await settle(fixture);
      expect(switchState(groupView() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);
      expect(announced(root)).toBe('A is now hidden');

      switchNamed(groupView() as HTMLElement, 'Show B').click();
      await settle(fixture);
      const show = http.expectOne(`${API_BASE}/tales/t2/status`);
      expect(show.request.body).toEqual({ status: 'live' });
      show.flush(taleB);
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...live, tales: [hiddenA, taleB] }] } });
      await settle(fixture);
      expect(switchState(groupView() as HTMLElement, 'Show B')).toEqual(['Shown', 'true']);
      expect(announced(root)).toBe('B is now shown');
    });

    it('hides a tale from its drawer, which stays open and shows the new state', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(switchState(drawer() as HTMLElement, 'Show A')).toEqual(['Shown', 'true']);
      expect(badge(drawer() as HTMLElement)).toBe('');
      expect(buttonNamed(drawer() as HTMLElement, 'Archive').type).toBe('button');
      switchNamed(drawer() as HTMLElement, 'Show A').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...taleA, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      const after = { ...live, tales: [{ ...taleA, status: 'paused', storedStatus: 'paused' }, hiddenTale] };
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [after] } });
      await settle(fixture);

      expect(drawer()).not.toBeNull();
      expect(switchState(drawer() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);
      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toBe('Status: Hidden');
      expect(switchState(groupView() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);

      // The footer has one way out, Done, which sends nothing and keeps the saved status (story 8.12).
      const footer = drawer()?.querySelector('.drawer__footer') as HTMLElement;
      expect([...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Done']);
      expect(drawer()?.textContent).not.toContain('Cancel');
      expect(drawer()?.textContent).toContain('Changes save as you make them.');
      buttonNamed(footer, 'Done').click();
      await settle(fixture);
      http.expectNone(() => true);
      expect(drawer()).toBeNull();
      expect(switchState(groupView() as HTMLElement, 'Show A')).toEqual(['Hidden', 'false']);
      // Focus goes back to the card that opened the drawer, inside the group view.
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Open tale A');
    });

    it('puts the status first in the tale drawer, and focus on its switch when opened from a card', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      const body = drawer()?.querySelector('.drawer__body') as HTMLElement;
      const controls = [...body.querySelectorAll<HTMLElement>('button, a[href]')].map(
        (c) => c.getAttribute('aria-label') ?? c.textContent?.trim(),
      );
      expect(controls).toEqual(['Show A', 'Archive', 'Delete tale…', 'Edit in Tale Studio', 'Add media']);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Show A');
      // No title field: titles change in Tale Studio, so Done has no typed edit to lose.
      expect(body.querySelector('input:not([type=file]), textarea')).toBeNull();
    });

    it('says in the drawer when showing a tale could not publish its studio draft', async () => {
      const hidden = { ...live, tales: [{ ...taleA, status: 'paused', storedStatus: 'paused' }] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [hidden] } });
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      switchNamed(drawer() as HTMLElement, 'Show A').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/status`).flush({ ...taleA, draftNotPublished: true });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [live] } });
      await settle(fixture);
      const warning = "Tale is shown; its studio draft has problems and wasn't put on the site.";
      // Announced once, by its alert, not again by the status announcement.
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain(warning);
      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toBe('Status: Shown');
    });

    it('says in the drawer that a shown tale of a group that is off does not show, and shows a refusal there', async () => {
      const blocked = { ...live, status: 'paused', storedStatus: 'paused', tales: [{ ...taleA, status: 'blocked-by-group' }] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [blocked] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(badge(drawer() as HTMLElement)).toBe('Status: Blocked by group');
      expect(switchState(drawer() as HTMLElement, 'Show A')).toEqual(['Shown', 'true']);
      expect(drawer()?.textContent).toContain('its tale group is off');
      buttonNamed(drawer() as HTMLElement, 'Archive').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/status`)
        .flush({ error: { code: 'tale_not_found', message: 'taleId does not match a tale' } }, { status: 404, statusText: 'Not Found' });
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('taleId does not match a tale');
    });

    it('keeps overlapping switches on two groups apart: each waits for its own answer and shows its own message', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [live, draft] } }, false);

      switchNamed(groupRow(root, 'Summer'), 'Summer on site').click();
      switchNamed(groupRow(root, 'Draft one'), 'Draft one on site').click();
      await settle(fixture);
      const [off, on] = [`${API_BASE}/tale-groups/g1/status`, `${API_BASE}/tale-groups/g2/status`].map((url) => http.expectOne(url));
      off.flush(
        { error: { code: 'invalid_status_transition', message: 'Summer cannot be turned off' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);

      expect(switchNamed(groupRow(root, 'Summer'), 'Summer on site').getAttribute('aria-disabled')).toBeNull();
      expect(switchNamed(groupRow(root, 'Draft one'), 'Draft one on site').getAttribute('aria-disabled')).toBe('true');
      expect(groupRow(root, 'Summer').querySelector('[role=alert]')?.textContent).toContain('Summer cannot be turned off');
      expect(groupRow(root, 'Draft one').querySelector('[role=alert]')).toBeNull();

      on.flush(
        { error: { code: 'invalid_status_transition', message: 'Draft one cannot be turned on' } },
        { status: 409, statusText: 'Conflict' },
      );
      await settle(fixture);
      expect(groupRow(root, 'Summer').querySelector('[role=alert]')?.textContent).toContain('Summer cannot be turned off');
      expect(groupRow(root, 'Draft one').querySelector('[role=alert]')?.textContent).toContain('Draft one cannot be turned on');
      expect(switchNamed(groupRow(root, 'Draft one'), 'Draft one on site').getAttribute('aria-disabled')).toBeNull();
    });

    it("announces the tale's status from the API's answer, not the list", async () => {
      const offGroup = { ...live, status: 'paused', storedStatus: 'paused', tales: [hiddenTale] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [offGroup] } });

      root.querySelector<HTMLButtonElement>('[aria-label="Open tale B"]')?.click();
      await settle(fixture);
      switchNamed(drawer() as HTMLElement, 'Show B').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t2/status`).flush({ ...taleB, status: 'blocked-by-group', storedStatus: 'live' });
      await settle(fixture);
      // The refresh still lists the old status.
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [offGroup] } });
      await settle(fixture);

      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toBe('Status: Blocked by group');
    });

    it('shows each group as On or Off on the Tale groups page', async () => {
      const { fixture, root } = await open('/zones', {
        ...oneZone,
        projectGroups: {
          p1: [
            projectGroup({ id: 'g9', name: 'Autumn', status: 'draft' }),
            projectGroup({ id: 'g8', name: 'Winter', status: 'paused' }),
            projectGroup({ id: 'g1', name: 'Summer', status: 'live', zoneIds: ['z1'] }, 2),
          ],
        },
      });
      await navigate(fixture, '/tale-groups');

      // The zone page's row (R10): the switch says On or Off; no badge for a status the switch says.
      const rows = [...root.querySelectorAll<HTMLElement>('[aria-label="Tale groups in Acme"] > li')];
      expect(rows.map((r) => r.querySelector('[role=switch]')?.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      expect(rows.map((r) => r.querySelector('[role=switch]')?.getAttribute('aria-label'))).toEqual([
        'Autumn on site',
        'Winter on site',
        'Summer on site',
      ]);
      expect(rows.map((r) => badge(r))).toEqual(['', '', '']);
    });
  });

  describe('schedules', () => {
    // Times the browser shows and the API stores: the field holds local time, the API UTC.
    const localStart = '2030-01-01T10:00';
    const localEnd = '2030-01-02T18:30';
    const utc = (local: string) => new Date(local).toISOString();
    const scheduled = { ...group, status: 'scheduled', startsAt: utc(localStart), endsAt: null, tales: [taleA] };

    function groupRow(root: HTMLElement, name: string): HTMLElement {
      const row = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => li.querySelector('h4')?.textContent?.trim() === name);
      if (!row) throw new Error(`No ${name} row`);
      return row;
    }

    function badge(root: Element): string {
      return root.querySelector('.status-badge')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    function field(id: string): HTMLInputElement {
      const input = drawer()?.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) throw new Error(`No ${id}`);
      return input;
    }

    it('shows a scheduled group its badge and window, with the buttons of its stored status', async () => {
      const { root } = await open('/zones/z1', { ...oneZone, groups: { z1: [scheduled] } });
      const row = groupRow(root, 'Summer');

      expect(badge(row)).toBe('Status: Scheduled');
      // A chip shows the window, with the whole of it on hover.
      const chip = row.querySelector('.window-chip');
      expect(chip?.textContent?.trim()).toBe(`Schedule: Starts ${formatShort(utc(localStart))}`);
      expect(chip?.getAttribute('title')).toBe(
        `From ${new Date(utc(localStart)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      );
      expect(row.querySelector('[role=switch][aria-label="Summer on site"]')?.getAttribute('aria-checked')).toBe('true');
      // Schedule is only in the ⋯ menu.
      expect(() => buttonNamed(row, 'Schedule')).toThrow();
      const more = row.querySelector('button[aria-label="More for Summer"]');
      expect(more?.getAttribute('aria-haspopup')).toBe('menu');
      expect(more?.getAttribute('aria-expanded')).toBe('false');
    });

    it("sets a group's window in local time and sends it in UTC", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [scheduled] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Schedule');
      expect(field('schedule-start').type).toBe('datetime-local');
      expect(field('schedule-start').value).toBe(localStart);
      expect(field('schedule-end').value).toBe('');
      // A group with a window can have it removed.
      expect(buttonNamed(drawer() as HTMLElement, 'Remove schedule')).toBeTruthy();
      type(field('schedule-end'), localEnd);
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/schedule`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ startsAt: utc(localStart), endsAt: utc(localEnd) });
      req.flush({ ...scheduled, endsAt: utc(localEnd) });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...scheduled, endsAt: utc(localEnd) }] } });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(groupRow(root, 'Summer').querySelector('.window-chip')?.textContent?.trim()).toBe(
        `Schedule: ${formatShort(utc(localStart))} – ${formatShort(utc(localEnd))}`,
      );
      // Focus is back on the group's ⋯ button, which opened the drawer.
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for Summer');
    });

    it('refuses an end before the start in the form, without a request', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [scheduled] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      type(field('schedule-end'), '2029-12-31T09:00');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);

      http.expectNone(`${API_BASE}/tale-groups/g1/schedule`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The end time must be later than the start time');
      expect(field('schedule-end').getAttribute('aria-invalid')).toBe('true');
    });

    it("shows the API's refusal in the drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [scheduled] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/schedule`)
        .flush(
          { error: { code: 'validation_failed', message: 'The end time must be later than the start time' } },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The end time must be later than the start time');
    });

    it("shows an expired tale's badge and window in its drawer, and clears the window from there", async () => {
      const expiredTale = { ...taleA, status: 'expired', endsAt: utc(localStart) };
      const withExpired = { ...group, tales: [expiredTale, taleB] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [withExpired] } });

      expect(badge((groupView() as HTMLElement).querySelector('.tale-card') as HTMLElement)).toBe('Status: Expired');
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(badge(drawer() as HTMLElement)).toBe('Status: Expired');
      // The drawer says the whole window in words, for touch and keyboard.
      expect(drawer()?.querySelector('.schedule-summary .window-chip')?.textContent?.trim()).toBe(
        `Schedule: Until ${new Date(utc(localStart)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      );
      buttonNamed(drawer() as HTMLElement, 'Edit schedule…').click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Tale A');
      expect(field('schedule-end').value).toBe(localStart);
      // "Remove schedule" saves no window at once, without Save.
      buttonNamed(drawer() as HTMLElement, 'Remove schedule').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/schedule`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ startsAt: null, endsAt: null });
      req.flush({ ...taleA });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [taleA, taleB] }] } });
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(groupRow(root, 'Summer').querySelector('.window-chip')).toBeNull();
    });

    it('shows no schedule text or button for a group and a tale without a window (epic UX rework R8)', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } });

      const row = groupRow(root, 'Summer');
      expect(root.textContent).not.toMatch(/schedule/i);
      expect(row.querySelector('.window-chip')).toBeNull();
      expect([...row.querySelectorAll('button')].some((b) => /schedule/i.test(b.textContent ?? ''))).toBe(false);
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(drawer()?.textContent).not.toMatch(/schedule/i);
      buttonNamed(drawer() as HTMLElement, 'Done').click();
      await settle(fixture);

      // The tale's ⋯ menu schedules it; with no window there is nothing to remove.
      pickMenuItem(groupView() as HTMLElement, 'More for A', 'Schedule');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Schedule');
      expect(field('schedule-start').value).toBe('');
      expect(() => buttonNamed(drawer() as HTMLElement, 'Remove schedule')).toThrow();
      buttonNamed(drawer() as HTMLElement, 'Cancel').click();
      await settle(fixture);
      // Focus is back on the menu's button.
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for A');
    });

    it('shows a tale card one bound of its window, and the tale drawer the whole window', async () => {
      const startsTale = { ...taleA, status: 'scheduled', startsAt: utc(localStart), endsAt: utc(localEnd) };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [startsTale, taleB] }] } });

      const cards = [...(groupView() as HTMLElement).querySelectorAll('.tale-card')];
      const chip = cards[0].querySelector('.window-chip');
      expect(chip?.textContent?.trim()).toBe(`Schedule: Starts ${formatShort(utc(localStart))}`);
      // Nothing only on hover.
      expect(chip?.hasAttribute('title')).toBe(false);
      expect(cards[0].querySelector('.tale-card__name')?.textContent).toBe('A');
      expect(cards[1].querySelector('.window-chip')).toBeNull();
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      expect(drawer()?.querySelector('.schedule-summary .window-chip')?.textContent?.trim()).toBe(
        `Schedule: ${describeWindow(startsTale)}`,
      );
    });

    it('updates the indicator right after a start is set and after it is removed', async () => {
      const VISIBLE = { visible: true, reasons: [] };
      const later = { visible: false, reasons: [{ code: 'starts-at', subject: 'group', at: utc(localStart) }] };
      const plain = { ...group, visibility: VISIBLE, tales: [taleA] };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [plain] } });
      const line = () => groupRow(root, 'Summer').querySelector('.visibility__text')?.textContent?.trim();
      expect(line()).toBe('Visible on site');

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      type(field('schedule-start'), localStart);
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      const withStart = { ...plain, status: 'scheduled', startsAt: utc(localStart), visibility: later };
      http.expectOne(`${API_BASE}/tale-groups/g1/schedule`).flush(withStart);
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [withStart] } });
      await settle(fixture);
      expect(line()).toBe(
        `Not visible: starts ${new Date(utc(localStart)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      );
      expect(groupRow(root, 'Summer').querySelector('.window-chip')?.textContent).toContain('Starts');

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Remove schedule').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/schedule`);
      expect(req.request.body).toEqual({ startsAt: null, endsAt: null });
      req.flush(plain);
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [plain] } });
      await settle(fixture);
      expect(line()).toBe('Visible on site');
      expect(groupRow(root, 'Summer').querySelector('.window-chip')).toBeNull();
    });

    it('refuses a half-typed date and time instead of clearing the bound', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [scheduled] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      // A partly filled datetime-local field reports '' as its value and badInput in its validity.
      const end = field('schedule-end');
      Object.defineProperty(end, 'validity', { value: { badInput: true }, configurable: true });
      type(end, '');
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);

      http.expectNone(`${API_BASE}/tale-groups/g1/schedule`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain(
        'Enter a complete date and time, or leave it empty.',
      );
    });

    it('sends an untouched bound as stored, seconds included, so an unchanged sub-minute window saves', async () => {
      const startsAt = '2030-01-01T10:00:15.000Z';
      const endsAt = '2030-01-01T10:00:45.000Z';
      const tight = { ...scheduled, startsAt, endsAt };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [tight] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      // Both fields show the same minute; unchanged, they still send the stored times.
      expect(field('schedule-start').value).toBe(field('schedule-end').value);
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/schedule`);
      expect(req.request.body).toEqual({ startsAt, endsAt });
      req.flush(tight);
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [tight] } });
      await settle(fixture);
    });

    it('sends the edited bound from its field and keeps the untouched one as stored', async () => {
      const startsAt = '2030-01-01T10:00:15.000Z';
      const tight = { ...scheduled, startsAt, endsAt: null };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [tight] } });

      pickMenuItem(groupRow(root, 'Summer'), 'More for Summer', 'Schedule');
      await settle(fixture);
      type(field('schedule-end'), localEnd);
      buttonNamed(drawer() as HTMLElement, 'Save').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/schedule`);
      expect(req.request.body).toEqual({ startsAt, endsAt: utc(localEnd) });
      req.flush({ ...tight, endsAt: utc(localEnd) });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...tight, endsAt: utc(localEnd) }] } });
      await settle(fixture);
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
      }, false);

      const chips = [...root.querySelectorAll('[aria-label="Tags of Summer"] li')].map((li) => li.textContent?.trim());
      expect(chips).toEqual(['Beach', 'summer']);
      expect(root.querySelector('[aria-label="Tags of Winter"] li')).toBeNull();
      // Audience (formerly Tags) is an item of every group's ⋯ menu (epic UX rework R10, epic targeting R1).
      expect(root.querySelectorAll('button[aria-label^="More for "]').length).toBe(2);
      expect(menuItems(root, 'More for Winter').map((item) => item.label)).toContain('Audience');
    });

    it("opens the Audience drawer with the project's tags as checkboxes, creates a tag and saves the set", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [], tags: [ref(beach)] }] },
        tags: { p1: [beach] },
      });

      pickMenuItem(root, 'More for Summer', 'Audience');
      await settle(fixture);
      const panel = drawer() as HTMLElement;
      expect(panel.querySelector('h2')?.textContent).toContain('Audience');
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
      expect(save.request.body).toEqual({ tagIds: ['tag1'], tagMatch: 'any' });
      save.flush({ ...group, tales: [], tags: [ref(summer)] });
      await settle(fixture);

      expect(drawer()).toBeNull();
      expect(root.querySelector('[aria-label="Tags of Summer"] li')?.textContent?.trim()).toBe('summer');
    });

    it('picks All or Any for the tags in the Audience drawer and saves it with them (epic targeting R1)', async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [], tags: [ref(beach), ref(summer)], tagMatch: 'any' }] },
        tags: { p1: [beach, summer] },
      });
      pickMenuItem(root, 'More for Summer', 'Audience');
      await settle(fixture);
      const panel = drawer() as HTMLElement;
      const radios = () =>
        [...panel.querySelectorAll<HTMLInputElement>('input[type=radio][name=tagMatch]')].map((radio) => [
          radio.closest('label')?.textContent?.trim(),
          radio.checked,
        ]);
      expect(radios()).toEqual([
        ['Any of these tags', true],
        ['All of these tags', false],
      ]);
      const hint = () => panel.querySelector('#tag-match-hint')?.textContent?.trim();
      expect(hint()).toBe('Shows to viewers tagged Beach or summer, and on pages that pass no tags.');
      const legend = panel.querySelector('input[name=tagMatch]')?.closest('fieldset')?.querySelector('legend');
      expect(legend?.textContent?.trim()).toBe('Show to viewers tagged with');

      panel.querySelectorAll<HTMLInputElement>('input[name=tagMatch]')[1].click();
      await settle(fixture);
      expect(radios().map(([, checked]) => checked)).toEqual([false, true]);
      expect(hint()).toBe('Shows to viewers tagged Beach and summer, and on pages that pass no tags.');

      buttonNamed(panel, 'Save').click();
      const save = http.expectOne(`${API_BASE}/tale-groups/g1/tags`);
      expect(save.request.body).toEqual({ tagIds: ['tag2', 'tag1'], tagMatch: 'all' });
      save.flush({ ...group, tales: [], tags: [ref(beach), ref(summer)], tagMatch: 'all' });
      await settle(fixture);
      expect(drawer()).toBeNull();

      pickMenuItem(root, 'More for Summer', 'Audience');
      await settle(fixture);
      const reopened = drawer() as HTMLElement;
      expect(reopened.querySelector('h2')?.textContent).toContain('Audience');
      expect(reopened.querySelectorAll<HTMLInputElement>('input[name=tagMatch]')[1].checked).toBe(true);
    });

    it("shows the API's message in the Audience drawer when a tag or the set is refused", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, tales: [] }] },
        tags: { p1: [summer] },
      });
      pickMenuItem(root, 'More for Summer', 'Audience');
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
      expect(announced(root)).toContain('Showing 2 of 3 tale groups, tagged summer');

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
        pickMenuItem(root, `More for ${name}`, 'Audience');
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
        expect(save.request.body).toEqual({ tagIds: ['tag1'], tagMatch: 'any' });
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

    it("opens a tale's Tale Studio from its drawer", async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } });
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
      const links = [...(drawer()?.querySelectorAll('a') ?? [])];
      const link = links.find((a) => a.textContent?.trim() === 'Edit in Tale Studio');
      // It carries the zone page it was opened on, where the studio's back link returns.
      expect(link?.getAttribute('href')).toBe('/tales/t1/studio?zone=z1');
      link?.click();
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/tales/t1/studio?zone=z1');
      expect(drawer()).toBeNull();
      http
        .expectOne(`${API_BASE}/tales/t1/document`)
        .flush({ document: null, revision: 0, published: { document: null, revision: 0 } });
      // The studio reads the project theme's font, for texts in the theme font (story 7.4).
      http
        .expectOne(`${API_BASE}/projects/p1/theme`)
        .flush({ error: { code: 'internal_error', message: 'x' } }, { status: 500, statusText: 'Down' });
      // ...and the project's fonts, for the font select (story 7.17); a failure leaves the list out.
      http
        .expectOne(`${API_BASE}/projects/p1/fonts`)
        .flush({ error: { code: 'internal_error', message: 'x' } }, { status: 500, statusText: 'Down' });
      // ...and the tale's visibility in any zone, for its status line (story 8.4).
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1`).flush({ ...taleA, visibility: { visible: true, reasons: [] } });
      await settle(fixture);
      expect(root.querySelector('h2.page-header__title')?.textContent).toContain('Tale Studio');
      // Nothing stored or on the site yet: an empty tale, not updated.
      expect(root.querySelector('#studio-update-state')?.textContent?.trim()).toBe(
        'Visible on site · changes not updated yet',
      );
      expect(root.querySelector('.canvas')).not.toBeNull();
    });

    const withTale = () => ({ ...oneZone, groups: { z1: [{ ...group, tales: [taleA] }] } });
    const withMedia = () => ({ ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }] }] } });
    const footer = () => drawer()?.querySelector('.drawer__footer') as HTMLElement;
    const fileInput = () => drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null;
    const live = () => drawer()?.querySelector('[aria-live=polite]')?.textContent;
    const replaceButton = () => drawer()?.querySelector<HTMLButtonElement>('#tale-replace-media') as HTMLButtonElement;
    async function openTaleA(fixture: ComponentFixture<unknown>, root: HTMLElement): Promise<void> {
      root.querySelector<HTMLButtonElement>('[aria-label="Open tale A"]')?.click();
      await settle(fixture);
    }

    it('opens a tale and replaces its media at once with Add media, showing progress, then the card', async () => {
      const { fixture, root } = await open('/zones/z1', withTale());
      expect(root.querySelector('.tale-card__media')).toBeNull();

      await openTaleA(fixture, root);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Tale');
      expect(drawer()?.textContent).toContain('No media yet');
      const input = fileInput();
      expect(input?.accept).toBe('image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm');
      // The button is the control: it opens the hidden picker.
      expect(input?.hidden).toBe(true);
      const opened = vi.spyOn(input as HTMLInputElement, 'click').mockImplementation(() => undefined);
      replaceButton().focus();
      buttonNamed(drawer() as HTMLElement, 'Add media').click();
      expect(opened).toHaveBeenCalled();
      pick(input, png);
      await settle(fixture);

      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('Content-Type')).toBe('image/png');
      expect(req.request.body).toBe(png);
      expect(req.request.reportProgress).toBe(true);
      expect(live()).toBe('Uploading…');
      req.event({ type: HttpEventType.UploadProgress, loaded: 2, total: 4 });
      await settle(fixture);
      expect(drawer()?.querySelector('progress')?.value).toBe(50);
      expect(drawer()?.textContent).toContain('Uploading… 50%');
      // Announced once: the percentage is not read out.
      expect(live()).toBe('Uploading…');
      // The button that started it stays focusable, marked busy, and opens no second picker.
      expect(replaceButton().disabled).toBe(false);
      expect(replaceButton().getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(replaceButton());
      opened.mockClear();
      replaceButton().click();
      expect(opened).not.toHaveBeenCalled();
      // Done stays available: closing cancels the upload (tested below).
      expect(buttonNamed(footer(), 'Done').disabled).toBe(false);
      req.event({ type: HttpEventType.UploadProgress, loaded: 4, total: 4 });
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Saving…');
      expect(() => buttonNamed(drawer() as HTMLElement, 'Cancel upload')).toThrow();
      req.flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia }] }] } });
      await settle(fixture);

      // The drawer stays open on the new media, says so, and the card shows it.
      expect(drawer()?.querySelector('progress')).toBeNull();
      expect(live()).toBe('Media replaced.');
      expect(drawer()?.querySelector('img.media-preview__media')?.getAttribute('src')).toBe(
        `${MEDIA_ORIGIN}/api/v1/tales/t1/media?v=1`,
      );
      expect(replaceButton().textContent?.trim()).toBe('Replace media');
      expect(replaceButton().getAttribute('aria-disabled')).toBeNull();
      expect(document.activeElement).toBe(replaceButton());
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(
        `${MEDIA_ORIGIN}/api/v1/tales/t1/media?v=1`,
      );
      buttonNamed(footer(), 'Done').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
    });

    it('cancels an upload with Cancel upload: the request is aborted, the media kept, focus on Replace media', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      req.event({ type: HttpEventType.UploadProgress, loaded: 1, total: 4 });
      await settle(fixture);
      const cancel = buttonNamed(drawer() as HTMLElement, 'Cancel upload');
      cancel.focus();
      cancel.click();
      await settle(fixture);

      expect(req.cancelled).toBe(true);
      expect(drawer()?.querySelector('progress')).toBeNull();
      expect(drawer()?.querySelector('[role=alert]')).toBeNull();
      expect(live()).toBe('Upload cancelled.');
      expect(document.activeElement).toBe(replaceButton());
      // Nothing was saved, so nothing is read again.
      http.expectNone(`${API_BASE}/zones`);
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t1/media`);
    });

    it('closes during an upload with Done or Escape, which cancels the upload', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      const first = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(drawer()?.textContent).toContain('Closing the drawer cancels the upload.');
      buttonNamed(footer(), 'Done').click();
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(first.cancelled).toBe(true);

      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      const second = http.expectOne(`${API_BASE}/tales/t1/media`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(second.cancelled).toBe(true);
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t1/media`);
    });

    it('shows an indeterminate bar when the upload has no known size', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      req.event({ type: HttpEventType.UploadProgress, loaded: 3 });
      await settle(fixture);
      const bar = drawer()?.querySelector('progress') as HTMLProgressElement;
      expect(bar.hasAttribute('value')).toBe(false);
      expect(drawer()?.querySelector('label[for=tale-media-progress]')?.textContent?.trim()).toBe('Uploading…');
      req.flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, withMedia());
      await settle(fixture);
      expect(live()).toBe('Media replaced.');
    });

    it('keeps Tab in the drawer during an upload and never on the hidden file input', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/media`);
      const panel = drawer() as HTMLElement;
      const tab = (shiftKey: boolean) => {
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        (document.activeElement as HTMLElement).dispatchEvent(event);
        return event.defaultPrevented;
      };
      // From Replace media (busy, still focusable), Tab is the browser's: on to Cancel upload.
      replaceButton().focus();
      expect(tab(false)).toBe(false);
      // From Done, the last control (the hidden file input is not one), Tab wraps to the first.
      buttonNamed(footer(), 'Done').focus();
      expect(tab(false)).toBe(true);
      const first = document.activeElement as HTMLElement;
      expect(panel.contains(first)).toBe(true);
      expect(first.tagName).not.toBe('INPUT');
      // Shift+Tab from the first goes back to Done.
      expect(tab(true)).toBe(true);
      expect(document.activeElement?.textContent?.trim()).toBe('Done');
    });

    it('refuses a PDF or a file over the limit before sending it, and keeps the previous media', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      expect(drawer()?.querySelector('img.media-preview__media')).not.toBeNull();
      pick(fileInput(), pdf);
      await settle(fixture);
      http.expectNone(`${API_BASE}/tales/t1/media`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Upload a JPEG, PNG, WebP or GIF image');

      const big = new File([new Uint8Array(1)], 'huge.png', { type: 'image/png' });
      Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
      pick(fileInput(), big);
      await settle(fixture);
      http.expectNone(`${API_BASE}/tales/t1/media`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The file is larger than 10 MB');
      expect(replaceButton().getAttribute('aria-describedby')).toContain('create-error');
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t1/media`);
    });

    it('sends a file the browser gave no type with the type its extension names', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'clip.WEBM', { type: '' }));
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/t1/media`);
      expect(req.request.headers.get('Content-Type')).toBe('video/webm');
      req.flush({ ...taleA, media: mp4Media });
      await settle(fixture);
      await flushRefresh(fixture, withMedia());
      await settle(fixture);
      // No type and no known extension is refused before sending.
      pick(fileInput(), new File(['x'], 'notes', { type: '' }));
      await settle(fixture);
      http.expectNone(`${API_BASE}/tales/t1/media`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Upload a JPEG, PNG, WebP or GIF image');
    });

    it("shows the API's message when it refuses the media, keeps the previous media, and takes the same file again", async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      replaceButton().focus();
      pick(fileInput(), png);
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tales/t1/media`)
        .flush(
          { error: { code: 'unsupported_media_type', message: 'The file is not a valid image/png file' } },
          { status: 415, statusText: 'Unsupported Media Type' },
        );
      await settle(fixture);

      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The file is not a valid image/png file');
      expect(drawer()?.querySelector('progress')).toBeNull();
      expect(live()).toBe('');
      expect(replaceButton().getAttribute('aria-disabled')).toBeNull();
      expect(document.activeElement).toBe(replaceButton());
      expect(root.querySelector('.tale-card__media')?.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t1/media`);
      // The input was cleared, so picking the same file again sends it again.
      expect(fileInput()?.value).toBe('');
      pick(fileInput(), png);
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/media`).flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, withMedia());
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')).toBeNull();
      expect(live()).toBe('Media replaced.');
    });

    it('says the media was not saved when the network fails', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      pick(fileInput(), png);
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/media`).error(new ProgressEvent('error'), { status: 0, statusText: '' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Media was not saved. Try again.');
      expect(drawer()?.querySelector('progress')).toBeNull();
    });

    it('asks to wait when a file is picked while a status change is saved', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      drawer()?.querySelector<HTMLButtonElement>('[role=switch][aria-label="Show A"]')?.click();
      await settle(fixture);
      const status = http.expectOne(`${API_BASE}/tales/t1/status`);
      pick(fileInput(), png);
      await settle(fixture);
      http.expectNone(`${API_BASE}/tales/t1/media`);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Wait until the change is saved');
      status.flush({ ...taleA, status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, status: 'paused', storedStatus: 'paused', media: pngMedia }] }] } });
      await settle(fixture);
    });

    it('clears the studio-draft warning once media is replaced', async () => {
      const hidden = { ...taleA, status: 'paused', storedStatus: 'paused', media: pngMedia };
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [hidden] }] } });
      await openTaleA(fixture, root);
      drawer()?.querySelector<HTMLButtonElement>('[role=switch][aria-label="Show A"]')?.click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/status`).flush({ ...taleA, media: pngMedia, draftNotPublished: true });
      await settle(fixture);
      await flushRefresh(fixture, withMedia());
      await settle(fixture);
      expect(drawer()?.textContent).toContain("its studio draft has problems");
      pick(fileInput(), png);
      await settle(fixture);
      expect(drawer()?.textContent).not.toContain("its studio draft has problems");
      http.expectOne(`${API_BASE}/tales/t1/media`).flush({ ...taleA, media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, withMedia());
      await settle(fixture);
    });

    it('keeps focus on Archive when it is refused, and moves it to Restore when it is done', async () => {
      const { fixture, root } = await open('/zones/z1', withMedia());
      await openTaleA(fixture, root);
      const archive = buttonNamed(drawer() as HTMLElement, 'Archive');
      archive.focus();
      archive.click();
      await settle(fixture);
      // Busy, but still focusable and focused; a second press sends nothing.
      expect(archive.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(archive);
      archive.click();
      const refused = http.expectOne(`${API_BASE}/tales/t1/status`);
      refused.flush({ error: { code: 'internal_error', message: 'Try again' } }, { status: 500, statusText: 'x' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Try again');
      expect(document.activeElement).toBe(archive);

      archive.click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tales/t1/status`).flush({ ...taleA, media: pngMedia, status: 'archived', storedStatus: 'archived' });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, tales: [{ ...taleA, media: pngMedia, status: 'archived', storedStatus: 'archived' }] }] } });
      await settle(fixture);
      expect(document.activeElement?.textContent?.trim()).toBe('Restore');
    });

    it('uploads the optional file after adding a tale', async () => {
      const { fixture, root } = await open('/zones/z1', { ...oneZone, groups: { z1: [{ ...group, tales: [] }] } });

      (root.querySelector('#group-view-add-tale') as HTMLButtonElement).click();
      await settle(fixture);
      // Creating keeps its own primary action, Add, and Cancel (story 8.12 changes only the edit drawer).
      const footer = drawer()?.querySelector('.drawer__footer') as HTMLElement;
      expect([...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Cancel', 'Add']);
      type(drawer()?.querySelector<HTMLInputElement>('input[name=text]') ?? null, 'A');
      pick(drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null, png);
      http.expectNone(`${API_BASE}/tales/t1/media`);
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

      (root.querySelector('#group-view-add-tale') as HTMLButtonElement).click();
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
      // It is now the tale's edit drawer: retry with Add media (focused), leave with Done.
      expect(buttonNamed(drawer() as HTMLElement, 'Add media').disabled).toBe(false);
      expect(document.activeElement?.id).toBe('tale-replace-media');
      const footer = drawer()?.querySelector('.drawer__footer') as HTMLElement;
      expect([...footer.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Done']);
    });
  });

  describe('tale group cover', () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'cover.png', { type: 'image/png' });
    const stillCover = { kind: 'image', contentType: 'image/png', animated: false, url: '/api/v1/tale-groups/g1/cover' };
    const videoTale = { ...taleB, media: mp4Media };
    const withVideo: Data = { ...oneZone, groups: { z1: [{ ...group, cover: null, tales: [taleA, videoTale] }] } };

    async function openCover(data: Data) {
      const opened = await open('/zones/z1', data);
      pickMenuItem(opened.root, 'More for Summer', 'Cover');
      await settle(opened.fixture);
      return opened;
    }

    function radio(name: string): HTMLInputElement {
      const label = [...(drawer()?.querySelectorAll('label.checkbox') ?? [])].find((l) => l.textContent?.trim() === name);
      const input = label?.querySelector<HTMLInputElement>('input[type=radio]');
      if (!input) throw new Error(`No ${name} option`);
      return input;
    }

    async function chooseSource(fixture: ComponentFixture<unknown>, name: string): Promise<void> {
      const input = radio(name);
      input.checked = true;
      input.dispatchEvent(new Event('change'));
      await settle(fixture);
    }

    // Gives the drawer's source video a length, as the browser does once its metadata loads.
    async function loadVideo(fixture: ComponentFixture<unknown>, seconds: number): Promise<HTMLVideoElement> {
      const video = drawer()?.querySelector<HTMLVideoElement>('video.cover-source');
      if (!video) throw new Error('No source video');
      Object.defineProperty(video, 'duration', { value: seconds, configurable: true });
      Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
      video.dispatchEvent(new Event('loadedmetadata'));
      await settle(fixture);
      return video;
    }

    async function moveKnob(fixture: ComponentFixture<unknown>, value: string): Promise<HTMLInputElement> {
      const knob = drawer()?.querySelector<HTMLInputElement>('input[type=range]') ?? null;
      type(knob, value);
      await settle(fixture);
      return knob as HTMLInputElement;
    }

    // Answers the cover PUT and the refresh after it.
    async function answerCover(fixture: ComponentFixture<unknown>, contentType: string, after: Data) {
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/cover`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.headers.get('Content-Type')).toBe(contentType);
      const body = req.request.body as Blob;
      req.flush({ ...group, cover: stillCover, tales: [] });
      await settle(fixture);
      await flushRefresh(fixture, after);
      await settle(fixture);
      return body;
    }

    // Object URLs of made frames and clips; the runtime's own refuse jsdom's Blobs.
    const urls = URL as unknown as Record<'createObjectURL' | 'revokeObjectURL', unknown>;
    const originalUrls = { createObjectURL: urls.createObjectURL, revokeObjectURL: urls.revokeObjectURL };
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:made');

    afterEach(() => Object.assign(URL, originalUrls));

    beforeEach(() => {
      createObjectURL.mockClear();
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
      capture.canRecord.mockReturnValue(true);
      capture.captureFrame.mockReset();
      capture.recordClip.mockReset();
      capture.seekTo.mockReset();
      capture.seekTo.mockResolvedValue(undefined);
    });

    it("shows the group's cover in its ring, and the default when it has none", async () => {
      const { fixture, root } = await open('/zones/z1', {
        ...oneZone,
        groups: { z1: [{ ...group, cover: stillCover, tales: [] }] },
      });
      expect(root.querySelector('.group .ring img.ring__cover')?.getAttribute('src')).toBe('/api/v1/tale-groups/g1/cover');

      pickMenuItem(root, 'More for Summer', 'Cover');
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('Cover');
      expect(drawer()?.textContent).toContain('Still cover');
      expect(drawer()?.textContent).toContain('Tale group Summer');
    });

    it('uploads a picked image as the cover and shows it in the ring', async () => {
      const { fixture, root } = await openCover({ ...oneZone, groups: { z1: [{ ...group, cover: null, tales: [] }] } });
      expect(drawer()?.textContent).toContain("First tale's image (default)");
      // Without a video tale, only an upload is offered.
      expect(radio('Frame of a video tale').disabled).toBe(true);
      expect(radio('Animated, from a video tale').disabled).toBe(true);
      expect(drawer()?.textContent).toContain('Add a video tale to this group');

      const input = drawer()?.querySelector<HTMLInputElement>('input[type=file]') ?? null;
      expect(input?.accept).toBe('image/jpeg,image/png,image/webp,image/gif');
      pick(input, png);
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      const body = await answerCover(fixture, 'image/png', {
        ...oneZone,
        groups: { z1: [{ ...group, cover: stillCover, tales: [] }] },
      });

      expect(body).toBe(png);
      expect(drawer()).toBeNull();
      expect(root.querySelector('.group .ring img.ring__cover')?.getAttribute('src')).toBe(
        '/api/v1/tale-groups/g1/cover?v=1',
      );
    });

    it('asks for an image when Save is pressed without one', async () => {
      const { fixture } = await openCover({ ...oneZone, groups: { z1: [{ ...group, cover: null, tales: [] }] } });
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Choose an image to upload.');
    });

    it('picks a video frame with the timeline knob and uploads it as a still JPEG', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Frame of a video tale');
      const video = await loadVideo(fixture, 8);
      expect(video.getAttribute('src')).toBe(`${MEDIA_ORIGIN}/api/v1/tales/t2/media`);
      expect(video.muted).toBe(true);
      const knob = await moveKnob(fixture, '2.5');
      expect(drawer()?.querySelector('label[for=cover-time]')?.textContent).toContain('Frame time');
      expect(knob.max).toBe('8');
      expect(video.currentTime).toBe(2.5);
      expect(knob.getAttribute('aria-valuetext')).toBe('2.5 s of 8.0 s');

      const frame = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
      capture.captureFrame.mockResolvedValue(frame);
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      // The video is moved to the knob's time before the frame is taken.
      expect(capture.seekTo).toHaveBeenCalledWith(video, 2.5);
      expect(capture.captureFrame).toHaveBeenCalledWith(video);
      expect(capture.seekTo.mock.invocationCallOrder[0]).toBeLessThan(capture.captureFrame.mock.invocationCallOrder[0]);
      const body = await answerCover(fixture, 'image/jpeg', withVideo);
      expect(body).toBe(frame);
      expect(drawer()).toBeNull();
    });

    it("shows the default cover, the first tale's image, when the group has none", async () => {
      const { root } = await openCover({
        ...oneZone,
        groups: { z1: [{ ...group, cover: null, tales: [{ ...taleA, media: pngMedia }] }] },
      });
      expect(drawer()?.querySelector('.cover-current img.ring__cover')?.getAttribute('src')).toBe(
        `${MEDIA_ORIGIN}/api/v1/tales/t1/media`,
      );
      expect(drawer()?.textContent).toContain("First tale's image (default)");
      expect(root.querySelector('.group .ring')?.classList.contains('ring--cover')).toBe(false);
    });

    it('takes the frame with "Use this frame" into the preview, and Save uploads that frame', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Frame of a video tale');
      const video = await loadVideo(fixture, 8);
      await moveKnob(fixture, '4');
      const frame = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
      capture.captureFrame.mockResolvedValue(frame);
      buttonNamed(drawer() as HTMLElement, 'Use this frame').click();
      await settle(fixture);
      expect(capture.seekTo).toHaveBeenCalledWith(video, 4);
      expect(drawer()?.querySelector('img.cover-preview')?.getAttribute('src')).toBe('blob:made');
      expect(drawer()?.textContent).toContain('Frame at 4.0 s');

      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(capture.captureFrame).toHaveBeenCalledTimes(1);
      expect(await answerCover(fixture, 'image/jpeg', withVideo)).toBe(frame);
    });

    it('saves the frame at the knob time even after a clip recording moved the video', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      const video = await loadVideo(fixture, 8);
      await moveKnob(fixture, '1');
      capture.recordClip.mockImplementation(async (v) => {
        v.currentTime = 3; // recording plays the video on
        return new Blob([new Uint8Array(10)], { type: 'video/webm' });
      });
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      await chooseSource(fixture, 'Frame of a video tale');
      capture.captureFrame.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(capture.seekTo).toHaveBeenLastCalledWith(video, 1);
      await answerCover(fixture, 'image/jpeg', withVideo);
    });

    it('locks the knob, length, tale and source controls while recording, then unlocks them', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      let finish: (blob: Blob) => void = () => undefined;
      capture.recordClip.mockImplementation(() => new Promise<Blob>((resolve) => (finish = resolve)));
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector<HTMLInputElement>('input[type=range]')?.disabled).toBe(true);
      expect(drawer()?.querySelector<HTMLSelectElement>('#cover-length')?.disabled).toBe(true);
      expect(drawer()?.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(true);
      expect(buttonNamed(drawer() as HTMLElement, 'Recording…').disabled).toBe(true);

      finish(new Blob([new Uint8Array(84 * 1024)], { type: 'video/webm' }));
      await settle(fixture);
      expect(drawer()?.querySelector<HTMLInputElement>('input[type=range]')?.disabled).toBe(false);
      expect(drawer()?.querySelector<HTMLFieldSetElement>('fieldset')?.disabled).toBe(false);
      // The size shows next to the preview.
      expect(drawer()?.querySelector('.cover-size')?.textContent?.trim()).toBe('84 KB of 300 KB');
    });

    it('unlocks the controls when a recording fails', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      capture.recordClip.mockRejectedValue(new Error('The video could not be read.'));
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The video could not be read.');
      expect(drawer()?.querySelector<HTMLInputElement>('input[type=range]')?.disabled).toBe(false);
    });

    it('cancels a recording when the drawer closes, keeping nothing from it', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      let finish: (blob: Blob) => void = () => undefined;
      let signal: AbortSignal | undefined;
      capture.recordClip.mockImplementation((_v, _s, _l, abort) => {
        signal = abort;
        return new Promise<Blob>((resolve) => (finish = resolve));
      });
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      expect(signal?.aborted).toBe(false);
      TestBed.inject(DashboardStore).closeDrawer();
      await settle(fixture);
      expect(signal?.aborted).toBe(true);
      finish(new Blob([new Uint8Array(10)], { type: 'video/webm' }));
      await settle(fixture);
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('cancels a recording when the source changes, showing nothing from it', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      let finish: (blob: Blob) => void = () => undefined;
      let signal: AbortSignal | undefined;
      capture.recordClip.mockImplementation((_v, _s, _l, abort) => {
        signal = abort;
        return new Promise<Blob>((resolve) => (finish = resolve));
      });
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      // The controls are locked while recording, so the change comes from code, as a route change or reload would.
      const fieldset = drawer()?.querySelector<HTMLFieldSetElement>('fieldset');
      if (fieldset) fieldset.disabled = false;
      await chooseSource(fixture, 'Frame of a video tale');
      expect(signal?.aborted).toBe(true);
      finish(new Blob([new Uint8Array(10)], { type: 'video/webm' }));
      await settle(fixture);
      await chooseSource(fixture, 'Animated, from a video tale');
      expect(drawer()?.querySelector('video.cover-preview')).toBeNull();
      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).not.toContain('ready');
      expect(drawer()?.querySelector('[role=alert]')).toBeNull();
    });

    it('shows why a frame could not be captured', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Frame of a video tale');
      await loadVideo(fixture, 8);
      capture.captureFrame.mockRejectedValue(new Error('The video has not loaded yet.'));
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('The video has not loaded yet.');
    });

    it('makes an animated cover from the knob time and length, previews it and uploads it', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      const video = await loadVideo(fixture, 8);
      await moveKnob(fixture, '1.5');
      expect(drawer()?.querySelector('label[for=cover-time]')?.textContent).toContain('Start time');
      choose(drawer()?.querySelector<HTMLSelectElement>('#cover-length') ?? null, '3');
      await settle(fixture);

      const clip = new Blob([new Uint8Array(200 * 1024)], { type: 'video/webm' });
      capture.recordClip.mockResolvedValue(clip);
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      expect(capture.recordClip).toHaveBeenCalledWith(video, 1.5, 3, expect.any(AbortSignal));
      expect(drawer()?.querySelector('[aria-live=polite]')?.textContent).toContain('Animated cover ready, 200 KB');
      expect(drawer()?.querySelector('video.cover-preview')).not.toBeNull();

      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(await answerCover(fixture, 'video/webm', withVideo)).toBe(clip);
      expect(drawer()).toBeNull();
    });

    it('refuses an animated cover above 300 KB before uploading it', async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      capture.recordClip.mockResolvedValue(new Blob([new Uint8Array(400 * 1024)], { type: 'video/webm' }));
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain(
        'This animated cover is 400 KB, above the 300 KB limit. Choose a shorter length.',
      );
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('above the 300 KB limit');
      http.expectNone(`${API_BASE}/tale-groups/g1/cover`);
    });

    it("asks for the clip first, and shows the API's refusal", async () => {
      const { fixture } = await openCover(withVideo);
      await chooseSource(fixture, 'Animated, from a video tale');
      await loadVideo(fixture, 8);
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('Make the animated cover first.');

      capture.recordClip.mockResolvedValue(new Blob([new Uint8Array(10)], { type: 'video/webm' }));
      buttonNamed(drawer() as HTMLElement, 'Make animated cover').click();
      await settle(fixture);
      buttonNamed(drawer() as HTMLElement, 'Save cover').click();
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/tale-groups/g1/cover`)
        .flush(
          { error: { code: 'media_too_large', message: 'An animated cover is at most 300 KB' } },
          { status: 413, statusText: 'Payload Too Large' },
        );
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent).toContain('An animated cover is at most 300 KB');
    });

    it('offers no animated cover where the browser cannot record one', async () => {
      capture.canRecord.mockReturnValue(false);
      await openCover(withVideo);
      expect(radio('Frame of a video tale').disabled).toBe(false);
      expect(radio('Animated, from a video tale').disabled).toBe(true);
      expect(drawer()?.textContent).toContain('This browser cannot record an animated cover.');
    });

    it('removes the cover at once and closes the drawer', async () => {
      const { fixture, root } = await openCover({
        ...oneZone,
        groups: { z1: [{ ...group, cover: stillCover, tales: [] }] },
      });
      buttonNamed(drawer() as HTMLElement, 'Remove cover').click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/cover`);
      expect(req.request.method).toBe('DELETE');
      req.flush({ ...group, cover: null, tales: [] });
      await settle(fixture);
      await flushRefresh(fixture, { ...oneZone, groups: { z1: [{ ...group, cover: null, tales: [] }] } });
      await settle(fixture);
      expect(drawer()).toBeNull();
      expect(root.querySelector('.group .ring img')).toBeNull();
      expect(root.querySelector('.group .ring')?.textContent?.trim()).toBe('S');
    });
  });

  describe('visible on site (epic UX rework R7)', () => {
    const VISIBLE = { visible: true, reasons: [] };
    const off = { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] };
    const noDisplay = {
      visible: false,
      reasons: [
        { code: 'zone-no-display', subject: 'zone' },
        { code: 'zone-not-installed', subject: 'zone' },
      ],
    };
    const shownTale = { ...taleA, visibility: VISIBLE };
    const hiddenTale = {
      ...taleB,
      status: 'paused',
      storedStatus: 'paused',
      visibility: { visible: false, reasons: [{ code: 'tale-hidden', subject: 'tale' }] },
    };
    const onGroup = { ...group, visibility: VISIBLE, tales: [shownTale, hiddenTale] };
    const offGroup = {
      ...group,
      id: 'g2',
      name: 'Winter',
      status: 'draft',
      storedStatus: 'draft',
      position: 1,
      visibility: off,
      tales: [{ ...taleA, id: 't3', taleGroupId: 'g2', status: 'blocked-by-group', visibility: off }],
    };
    const visibleZone = { ...zone, visibility: VISIBLE };
    const bareZone = { ...zone, visibility: noDisplay };
    const productZone = { ...visibleZone, id: 'z3', name: 'Product page' };
    const data: Data = {
      projects: [acme],
      zones: [visibleZone],
      displays: { z1: frameBar },
      groups: { z1: [onGroup, offGroup] },
    };

    const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    function row(root: HTMLElement, name: string): HTMLElement {
      const found = [...root.querySelectorAll<HTMLElement>('.group')].find((li) => text(li.querySelector('h4')) === name);
      if (!found) throw new Error(`No ${name} row`);
      return found;
    }

    it('says on the zone page whether the zone, each group and every tale card is visible, and why not', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      expect(text(root.querySelector('.page-header app-visibility'))).toBe('Visible on site');

      const summer = row(root, 'Summer');
      expect(text(summer.querySelector('.group-row__status app-visibility'))).toBe('Visible on site');
      const winter = row(root, 'Winter');
      const line = winter.querySelector<HTMLButtonElement>('.group-row__status app-visibility button');
      expect(text(line)).toBe('Not visible: group is off');
      expect(text(root.querySelector(`#${line?.getAttribute('aria-describedby')}`))).toContain('group is off');

      // Every tale card has a dot, shown tales included, named by its line (in the group view, R11).
      const dots = [...(groupView()?.querySelectorAll('.tale-card app-visibility button') ?? [])].map((b) =>
        b.getAttribute('aria-label'),
      );
      expect(dots).toEqual(['Visible on site', 'Not visible: tale is hidden']);
      await expandGroups(fixture, root, 'Winter');
      expect(groupView()?.querySelector('.tale-card app-visibility button')?.getAttribute('aria-label')).toBe(
        'Not visible: group is off',
      );
    });

    it('says on each zone card whether the zone is visible', async () => {
      const { root } = await open('/zones', {
        ...data,
        zones: [bareZone, productZone],
      });
      const cards = [...root.querySelectorAll('.zone-card')];
      expect(cards.map((c) => text(c.querySelector('app-visibility .visibility__line')))).toEqual([
        'Not visible: zone has no display',
        'Visible on site',
      ]);
      // The indicator is not inside the card's link, so its button is a control of its own.
      expect(cards[0].querySelector('a app-visibility')).toBeNull();
      expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/zones/z1');
    });

    it('announces what the indicator says after a group is turned on', async () => {
      const { fixture, root } = await open('/zones/z1', data);
      row(root, 'Winter').querySelector<HTMLButtonElement>('[role=switch]')?.click();
      await settle(fixture);
      const on = { ...offGroup, status: 'live', storedStatus: 'live', visibility: noDisplay };
      http.expectOne(`${API_BASE}/tale-groups/g2/status`).flush(on);
      await settle(fixture);
      await flushRefresh(fixture, { ...data, groups: { z1: [onGroup, on] } });
      await settle(fixture);
      expect(announced(root)).toBe(
        'Winter is now on. Not visible: zone has no display',
      );
      expect(text(row(root, 'Winter').querySelector('.group-row__status app-visibility button'))).toBe(
        'Not visible: zone has no display',
      );
    });

    it('says on the Tale groups page whether each group is visible', async () => {
      const notInZone = { visible: false, reasons: [{ code: 'not-in-any-zone', subject: 'group' }] };
      const { fixture, root } = await open('/zones', {
        ...data,
        projectGroups: {
          p1: [
            projectGroup({ id: 'g9', name: 'Autumn', visibility: notInZone }),
            projectGroup({ id: 'g1', name: 'Summer', status: 'live', zoneIds: ['z1'], visibility: VISIBLE }, 2),
          ],
        },
      });
      await navigate(fixture, '/tale-groups');
      const rows = [...root.querySelectorAll<HTMLElement>('[aria-label="Tale groups in Acme"] > li')];
      expect(rows.map((r) => text(r.querySelector('app-visibility .visibility__line')))).toEqual([
        'Not visible: not in any zone',
        'Visible on site in at least one zone',
      ]);
    });
  });

  describe('Tale groups page and zones list show status (epic UX rework R14)', () => {
    const VISIBLE = { visible: true, reasons: [] };
    const why = (code: string, subject = 'group') => ({ visible: false, reasons: [{ code, subject }] });
    const future = '2031-01-01T09:00:00.000Z';
    // One group in every state the filters tell apart; names in the API's order (by name).
    const states = [
      projectGroup({ id: 'g1', name: 'Archived one', status: 'archived', zoneIds: ['z1'], startsAt: future, visibility: why('archived') }, 1),
      projectGroup({ id: 'g2', name: 'Draft loose', status: 'draft', visibility: why('not-in-any-zone') }),
      projectGroup({ id: 'g3', name: 'Ends later', status: 'live', zoneIds: ['z1'], endsAt: future, visibility: VISIBLE }, 2),
      projectGroup({ id: 'g4', name: 'On, nothing shown', status: 'live', zoneIds: ['z1'], visibility: why('no-shown-tales') }),
      projectGroup({ id: 'g5', name: 'Paused here', status: 'paused', zoneIds: ['z1'], visibility: why('group-off') }, 1),
      projectGroup(
        { id: 'g6', name: 'Starts later', status: 'scheduled', storedStatus: 'live', zoneIds: ['z1'], startsAt: future, visibility: why('starts-at') },
        1,
      ),
      projectGroup({ id: 'g7', name: 'Visible now', status: 'live', zoneIds: ['z1'], visibility: VISIBLE }, 3),
    ];
    const data: Data = { projects: [acme], zones: [zone, { id: 'z3', name: 'Product page', projectId: 'p1' }], projectGroups: { p1: states } };
    const expected: Record<string, string[]> = {
      all: ['Draft loose', 'Ends later', 'On, nothing shown', 'Paused here', 'Starts later', 'Visible now'],
      visible: ['Ends later', 'Visible now'],
      off: ['Draft loose', 'Paused here'],
      scheduled: ['Ends later', 'Starts later'],
      unplaced: ['Draft loose'],
      archived: ['Archived one'],
    };

    // A group as the status route answers it: the whole group, read in any zone.
    const saved = (listed: Record<string, unknown>, status: string, visibility: unknown) => ({
      ...listed,
      status,
      storedStatus: status,
      visibility,
      tales: Array.from({ length: listed['taleCount'] as number }, (_, i) => ({ ...taleA, id: `${listed['id']}-t${i}` })),
    });
    // The data with one group's status and visibility changed, as the refresh after a change reads it.
    const changed = (index: number, status: string, visibility: unknown): Data => ({
      ...data,
      projectGroups: { p1: states.map((g, i) => (i === index ? { ...g, status, storedStatus: status, visibility } : g)) },
    });
    const names = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('.group-items > li h3')].map((h) => h.textContent?.trim());
    const radio = (root: HTMLElement, id: string) =>
      root.querySelector<HTMLInputElement>(`[data-filter="${id}"] input[type=radio]`) as HTMLInputElement;
    const live = (root: HTMLElement) => root.querySelector('.page > [aria-live=polite]')?.textContent;
    const url = () => TestBed.inject(Router).url;
    const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    it('lists exactly the matching groups under each filter, with a count per filter, and keeps it in the URL', async () => {
      const { fixture, root } = await open('/tale-groups', data);

      const fieldset = root.querySelector('fieldset.group-filter');
      expect(fieldset?.querySelector('legend')?.textContent?.trim()).toBe('Show');
      const labels = [...(fieldset?.querySelectorAll('label') ?? [])].map((l) => l.textContent?.replace(/\s+/g, ' ').trim());
      expect(labels).toEqual(['All , 6', 'Visible , 2', 'Off , 2', 'Scheduled , 2', 'Not in a zone , 1', 'Archived , 1']);
      expect(radio(root, 'all').checked).toBe(true);
      expect(names(root)).toEqual(expected['all']);

      for (const id of ['visible', 'off', 'scheduled', 'unplaced', 'archived', 'all']) {
        radio(root, id).click();
        await settle(fixture);
        expect(radio(root, id).checked).toBe(true);
        expect(names(root)).toEqual(expected[id]);
        expect(url()).toBe(id === 'all' ? '/tale-groups' : `/tale-groups?filter=${id}`);
        // The radio reads its own count: nothing is announced on a change of filter.
        expect(live(root)).toBe('');
      }
      // The list is named by its filter.
      radio(root, 'off').click();
      await settle(fixture);
      expect(root.querySelector('.group-items')?.getAttribute('aria-label')).toBe('Tale groups in Acme: Off');
    });

    it('opens on the filter the URL names, and on All for an unknown one, dropping it from the URL', async () => {
      const { root } = await open('/tale-groups?filter=scheduled', data);
      expect(radio(root, 'scheduled').checked).toBe(true);
      expect(names(root)).toEqual(expected['scheduled']);

      const other = await open('/tale-groups?filter=nope', data);
      expect(radio(other.root, 'all').checked).toBe(true);
      expect(names(other.root)).toEqual(expected['all']);
      await settle(other.fixture);
      expect(url()).toBe('/tale-groups');
    });

    it('says when no group matches, with a way back to all of them', async () => {
      const { fixture, root } = await open('/tale-groups?filter=visible', {
        ...data,
        projectGroups: { p1: [states[1], states[4]] },
      });
      expect(names(root)).toEqual([]);
      expect(root.querySelector('.empty__title')?.textContent).toContain('No tale groups match this filter');
      buttonNamed(root, 'Show all tale groups').click();
      await settle(fixture);
      expect(names(root)).toEqual(['Draft loose', 'Paused here']);
      expect(url()).toBe('/tale-groups');
      expect(document.activeElement).toBe(radio(root, 'all'));
    });

    it("shows the zone page's row with the zones each group is in, and a menu without Remove from this zone", async () => {
      const { root } = await open('/tale-groups', data);
      const row = (name: string) =>
        [...root.querySelectorAll<HTMLElement>('.group-items > li')].find((li) => li.querySelector('h3')?.textContent?.trim() === name) as HTMLElement;

      const visible = row('Visible now');
      expect(visible.querySelector('app-group-row')).not.toBeNull();
      expect(visible.querySelector('.group-row__count')?.textContent?.trim()).toBe('3 of 3 shown · max 100');
      expect(visible.querySelector('.group-row__zones')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('In: Home bar');
      expect(visible.querySelector('[role=switch]')?.getAttribute('aria-label')).toBe('Visible now on site');
      expect(text(visible.querySelector('app-visibility .visibility__line'))).toBe('Visible on site in at least one zone');
      expect(visible.querySelector('.group-row__reorder')).toBeNull();
      expect(menuItems(visible, 'More for Visible now')).toEqual([
        { label: 'Rename', reason: '', disabled: false },
        { label: 'Cover', reason: '', disabled: false },
        { label: 'Audience', reason: '', disabled: false },
        { label: 'Schedule', reason: '', disabled: false },
        { label: 'Show in another zone', reason: '', disabled: false },
        { label: 'Copy to zone', reason: '', disabled: false },
        { label: 'Archive', reason: '', disabled: false },
      ]);
      expect(row('Ends later').querySelector('.window-chip')?.textContent).toContain('Ends');
      expect(row('Draft loose').querySelector('.group-row__count')?.textContent).toContain('No tales yet');
      // The name opens the group view on this page (story 8.19), placed in a zone or not.
      for (const name of ['Visible now', 'Draft loose']) {
        const button = row(name).querySelector('h3 button.group-row__open');
        expect(button?.textContent?.trim()).toBe(name);
        expect(button?.getAttribute('aria-haspopup')).toBe('dialog');
        expect(button?.getAttribute('aria-expanded')).toBe('false');
        expect(row(name).querySelector('h3 a')).toBeNull();
      }
    });

    it('keeps "Show in another zone" for an archived group, disabled with its reason, and offers Restore', async () => {
      const { fixture, root } = await open('/tale-groups?filter=archived', data);
      const row = root.querySelector<HTMLElement>('.group-items > li') as HTMLElement;
      expect(row.querySelector('[role=switch]')).toBeNull();
      expect(row.querySelector('.status-badge')?.textContent).toContain('Archived');
      const items = menuItems(row, 'More for Archived one');
      expect(items.find((i) => i.label === 'Show in another zone')).toEqual({
        label: 'Show in another zone',
        reason: 'Archived. Restore it to show it in a zone',
        disabled: true,
      });
      expect(items.map((i) => i.label)).toContain('Restore');
      expect(items.map((i) => i.label)).not.toContain('Remove from this zone');

      // Restore: the group leaves Archived. The page says, from the API's answer, which filter lists it
      // now; no row is left, so focus goes to the list's heading, not to a radio that is not checked.
      pickMenuItem(row, 'More for Archived one', 'Restore');
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g1/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush(saved(states[0], 'paused', why('group-off')));
      await settle(fixture);
      await flushRefresh(fixture, changed(0, 'paused', why('group-off')));
      await settle(fixture);
      expect(live(root)).toBe('Archived one is now off. Not visible: group is off. It is listed under Off.');
      expect(document.activeElement).toBe(root.querySelector('#tale-groups-title'));
      expect(radio(root, 'archived').checked).toBe(true);
    });

    it('turns a Visible group Off: says it is listed under Off and focuses the next row', async () => {
      const { fixture, root } = await open('/tale-groups?filter=visible', data);
      expect(names(root)).toEqual(['Ends later', 'Visible now']);
      const first = root.querySelector<HTMLElement>('.group-items > li') as HTMLElement;
      (first.querySelector('[role=switch]') as HTMLButtonElement).click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g3/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush(saved(states[2], 'paused', why('group-off')));
      await settle(fixture);
      // Patched from the answer before the refresh answers: the row has left Visible.
      expect(names(root)).toEqual(['Visible now']);
      await flushRefresh(fixture, changed(2, 'paused', why('group-off')));
      await settle(fixture);
      expect(live(root)).toBe('Ends later is now off. Not visible: group is off. It is listed under Off.');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Visible now on site');
    });

    it('turns a group On from its switch and announces what the indicator says', async () => {
      const { fixture, root } = await open('/tale-groups?filter=off', data);
      const row = [...root.querySelectorAll<HTMLElement>('.group-items > li')][1];
      (row.querySelector('[role=switch]') as HTMLButtonElement).click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g5/status`);
      expect(req.request.body).toEqual({ status: 'live' });
      req.flush(saved(states[4], 'live', VISIBLE));
      await settle(fixture);
      await flushRefresh(fixture, changed(4, 'live', VISIBLE));
      await settle(fixture);
      expect(live(root)).toBe('Paused here is now on. Visible on site. It is listed under Visible.');
      // It was the last row: focus goes to the row before it.
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Draft loose on site');
      expect(names(root)).toEqual(['Draft loose']);
    });

    it('creates a tale group in no zone from "New tale group", and shows it when the filter hid it', async () => {
      const { fixture, root } = await open('/tale-groups?filter=visible', data);
      const button = buttonNamed(root, 'New tale group');
      button.click();
      await settle(fixture);
      expect(drawer()?.querySelector('h2')?.textContent).toContain('New tale group');
      expect(drawer()?.textContent).toContain('In project Acme');
      const select = drawer()?.querySelector<HTMLSelectElement>('#create-group-zone') as HTMLSelectElement;
      expect(drawer()?.querySelector('label[for=create-group-zone]')?.textContent?.trim()).toBe('Zone');
      expect([...select.options].map((o) => [o.value, o.textContent?.trim()])).toEqual([
        ['', 'Not in a zone'],
        ['z1', 'Home bar'],
        ['z3', 'Product page'],
      ]);
      expect(select.value).toBe('');
      type(drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null, 'Loose ends');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      const created = projectGroup({ id: 'g8', name: 'Loose ends', visibility: why('not-in-any-zone') });
      await answerCreate(fixture, `${API_BASE}/projects/p1/tale-groups`, { name: 'Loose ends' }, created, {
        ...data,
        projectGroups: { p1: [...states, created] },
      });
      expect(drawer()).toBeNull();
      expect(radio(root, 'all').checked).toBe(true);
      expect(url()).toBe('/tale-groups');
      expect(names(root)).toContain('Loose ends');
      expect(live(root)).toBe('Loose ends created. Showing all tale groups.');
    });

    it('says plainly that the project is full when a group in no zone is refused at the cap', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      buttonNamed(root, 'New tale group').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null, 'Loose ends');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      // Without the server's message, the client's own wording.
      http.expectOne(`${API_BASE}/projects/p1/tale-groups`).flush(groupLimit(''), { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      expect(drawer()?.querySelector('[role=alert]')?.textContent?.trim()).toBe(fullCreate);
    });

    it('creates a tale group in no zone with its tales from files (story 8.13)', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      buttonNamed(root, 'New tale group').click();
      await settle(fixture);
      type(drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null, 'Loose ends');
      const shot = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });
      const input = drawer()?.querySelector<HTMLInputElement>('#create-group-files') ?? null;
      if (!input) throw new Error('No files input');
      Object.defineProperty(input, 'files', { value: [shot], configurable: true });
      input.dispatchEvent(new Event('change'));
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      const created = projectGroup({ id: 'g8', name: 'Loose ends', visibility: why('not-in-any-zone') });
      await answerCreate(fixture, `${API_BASE}/projects/p1/tale-groups`, { name: 'Loose ends' }, created, {
        ...data,
        projectGroups: { p1: [...states, created] },
      });
      const post = http.expectOne(`${API_BASE}/tale-groups/g8/tales`);
      expect(post.request.body).toEqual({ title: 'shot' });
      post.flush({ ...taleA, id: 't9', taleGroupId: 'g8', title: 'shot' });
      await settle(fixture);
      const put = http.expectOne(`${API_BASE}/tales/t9/media`);
      expect(put.request.headers.get('Content-Type')).toBe('image/png');
      put.flush({ ...taleA, id: 't9', media: pngMedia });
      await settle(fixture);
      await flushRefresh(fixture, { ...data, projectGroups: { p1: [...states, created] } });
      await settle(fixture);
      expect(drawer()).toBeNull();
    });

    it('creates a tale group in the zone picked in the drawer', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      buttonNamed(root, 'New tale group').click();
      await settle(fixture);
      choose(drawer()?.querySelector<HTMLSelectElement>('#create-group-zone') ?? null, 'z3');
      await settle(fixture);
      expect(drawer()?.textContent).toContain('In zone Product page');
      type(drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null, 'Placed');
      buttonNamed(drawer() as HTMLElement, 'Create').click();
      await settle(fixture);
      const created = projectGroup({ id: 'g8', name: 'Placed', zoneIds: ['z3'] });
      await answerCreate(fixture, `${API_BASE}/zones/z3/tale-groups`, { name: 'Placed' }, { ...created, position: 0 }, {
        ...data,
        groups: { z3: [{ ...created, position: 0 }] },
        projectGroups: { p1: [...states, created] },
      });
      expect(names(root)).toContain('Placed');
      expect(live(root)).toBe('Placed created');
    });

    it('shows a group in no zone in the Tags and Cover drawers from its menu', async () => {
      const tagged = projectGroup({ id: 'g2', name: 'Draft loose', tags: [{ id: 'tag1', name: 'Promo' }] });
      const { fixture, root } = await open('/tale-groups', {
        ...data,
        tags: { p1: [{ id: 'tag1', projectId: 'p1', name: 'Promo' }] },
        projectGroups: { p1: [tagged] },
      });
      const row = root.querySelector<HTMLElement>('.group-items > li') as HTMLElement;
      expect(row.querySelector('.group-row__tags')?.textContent).toContain('Promo');
      pickMenuItem(row, 'More for Draft loose', 'Audience');
      await settle(fixture);
      expect(drawer()?.textContent).toContain('For tale group Draft loose');
      const checked = drawer()?.querySelector<HTMLInputElement>('input[type=checkbox]');
      expect(checked?.checked).toBe(true);
    });

    it('shows each zone card with its indicator, display type, tale group count and install state', async () => {
      const notInstalled = { visible: false, reasons: [{ code: 'zone-not-installed', subject: 'zone' }, { code: 'no-tale-groups', subject: 'zone' }] };
      const { root } = await open('/zones', {
        projects: [acme],
        zones: [
          { ...zone, visibility: VISIBLE },
          { id: 'z3', name: 'Product page', projectId: 'p1', visibility: notInstalled },
          { id: 'z4', name: 'Unknown yet', projectId: 'p1' },
        ],
        displays: { z1: frameBar, z3: { ...frameBar, id: 'f3', zoneId: 'z3', type: 'banner' } },
        groups: { z1: [{ ...group, tales: [taleA] }, { ...group, id: 'g2', name: 'Two', tales: [] }] },
      });
      const cards = [...root.querySelectorAll<HTMLElement>('.zone-card')];
      const summary = (card: HTMLElement) =>
        [...card.querySelectorAll('.zone-card__summary li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
      expect(summary(cards[0])).toEqual(['Display: Bar', '2 tale groups', 'Install: Installed']);
      expect(summary(cards[1])).toEqual(['Display: Banner', '0 tale groups', 'Install: Not installed']);
      expect(summary(cards[2])).toEqual(['Display: No display yet', '0 tale groups']);
      expect(cards[0].querySelector('.zone-card__summary')?.getAttribute('aria-label')).toBe('Summary of Home bar');
      expect(text(cards[0].querySelector('app-visibility .visibility__line'))).toBe('Visible on site');
      expect(text(cards[1].querySelector('app-visibility .visibility__line'))).toBe('Not visible: zone not installed');
    });
  });

  describe('a tale group in no zone can get tales (story 8.19)', () => {
    const notInZone = (subject = 'group') => ({ visible: false, reasons: [{ code: 'not-in-any-zone', subject }] });
    const VISIBLE = { visible: true, reasons: [] };
    const looseTales = ['Beach', 'Pool'].map((title, i) => ({
      ...taleA,
      id: `l${i + 1}`,
      taleGroupId: 'g2',
      title,
      position: i,
      visibility: notInZone(),
    }));
    // The group as GET /tale-groups/{id} sends it: with its tales, read in any zone.
    const loose = {
      id: 'g2',
      projectId: 'p1',
      name: 'Loose',
      status: 'draft',
      storedStatus: 'draft',
      startsAt: null,
      endsAt: null,
      cover: null,
      tags: [],
      zoneIds: [] as string[],
      visibility: notInZone(),
      tales: looseTales,
    };
    const placed = { ...group, cover: null, visibility: VISIBLE, tales: [{ ...taleA, visibility: VISIBLE }] };
    const data: Data = {
      ...oneZone,
      displays: { z1: frameBar },
      groups: { z1: [placed] },
      projectGroups: {
        p1: [
          projectGroup({ id: 'g2', name: 'Loose', tales: looseTales, visibility: notInZone() }),
          projectGroup({ id: 'g1', name: 'Summer', status: 'live', zoneIds: ['z1'], visibility: VISIBLE }, 1),
        ],
      },
      readGroups: { g2: loose, g1: { ...placed, position: undefined } },
    };
    const url = () => TestBed.inject(Router).url;
    const nameButton = (root: HTMLElement, name: string) =>
      [...root.querySelectorAll<HTMLButtonElement>('.group-items .group-row__open')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement;
    const cards = () => [...(groupView()?.querySelectorAll('.tale-card__name') ?? [])].map((n) => n.textContent);
    const cardOf = (title: string) =>
      groupView()?.querySelector(`[aria-label="More for ${title}"]`)?.closest<HTMLElement>('.tale-card') as HTMLElement;

    // Opens the Tale groups page and the group `name` in its view, answering the group's read.
    async function openLoose(name = 'Loose', given: Data = data) {
      const opened = await open('/tale-groups', given);
      const button = nameButton(opened.root, name);
      button.focus();
      button.click();
      await settle(opened.fixture);
      flushReadGroups(given);
      await settle(opened.fixture);
      return { ...opened, button };
    }

    it('opens a group in no zone in the group view, read with its tales, and closes back to its name', async () => {
      const { fixture, root, button } = await openLoose();
      const view = groupView() as HTMLElement;
      expect(view.querySelector(`#${view.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe('Loose');
      expect(url()).toBe('/tale-groups?group=g2');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.getAttribute('aria-controls')).toBe(view.id);
      expect(cards()).toEqual(['Beach', 'Pool']);
      expect(view.querySelector('.group__zones')?.textContent?.trim()).toBe(
        'Not in a zone. Show it in a zone from the ⋯ menu to put it on the site.',
      );
      // The head's ⋯ is the Tale groups page's: no "Remove from this zone".
      expect(menuItems(view, 'More for Loose').map((item) => item.label)).toEqual([
        'Rename', 'Cover', 'Audience', 'Schedule', 'Show in another zone', 'Copy to zone', 'Archive',
      ]);
      expect(view.querySelector('.group-view__count')?.textContent).toContain('2 of 2 shown');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(document.activeElement).toBe(nameButton(root, 'Loose'));
      for (let i = 0; i < 20 && url() !== '/tale-groups'; i++) await settle(fixture);
      expect(url()).toBe('/tale-groups');
      // Closed, the group is no longer kept: a refresh does not read it.
      expect(TestBed.inject(DashboardStore).readGroups()).toEqual({});
    });

    it('opens a placed group here too, saying the zones it is in, and a row click opens it', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      const row = nameButton(root, 'Summer').closest('app-group-row') as HTMLElement;
      (row.querySelector('.group-row__count') as HTMLElement).click();
      await settle(fixture);
      flushReadGroups(data);
      await settle(fixture);
      expect(url()).toBe('/tale-groups?group=g1');
      expect(groupView()?.querySelector('.group__zones')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('In: Home bar');
      // The view holds the group's tales, read on their own.
      expect(cards()).toEqual(['A']);
    });

    it('adds a tale to the group in no zone; the new tale shows in the view', async () => {
      const { fixture } = await openLoose();
      const add = groupView()?.querySelector<HTMLButtonElement>('#group-view-add-tale') as HTMLButtonElement;
      add.click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('In tale group Loose');
      type(drawer()?.querySelector<HTMLInputElement>('#create-text') ?? null, 'Dunes');
      buttonNamed(drawer() as HTMLElement, 'Add').click();
      await settle(fixture);
      const dunes = { ...looseTales[0], id: 'l3', title: 'Dunes', position: 2 };
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/tales`);
      expect(req.request.body).toEqual({ title: 'Dunes' });
      req.flush(dunes);
      await settle(fixture);
      await flushRefresh(fixture, { ...data, readGroups: { g2: { ...loose, tales: [...looseTales, dunes] } } });
      await settle(fixture);
      expect(cards()).toEqual(['Beach', 'Pool', 'Dunes']);
    });

    it('hides a tale of the group in no zone from its card, at once, and opens the tale drawer for it', async () => {
      const { fixture, root } = await openLoose();
      const toggle = () => cardOf('Pool').querySelector<HTMLButtonElement>('[role=switch]') as HTMLButtonElement;
      toggle().click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tales/l2/status`);
      expect(req.request.body).toEqual({ status: 'paused' });
      req.flush({ ...looseTales[1], status: 'paused', storedStatus: 'paused' });
      await settle(fixture);
      // Shown at once from the answer, before the refresh.
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(groupView()?.querySelector('.group-view__count')?.textContent).toContain('1 of 2 shown');
      const hidden = { ...looseTales[1], status: 'paused', storedStatus: 'paused' };
      await flushRefresh(fixture, { ...data, readGroups: { g2: { ...loose, tales: [looseTales[0], hidden] } } });
      await settle(fixture);
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(announced(root)).toContain('Pool is now hidden');

      // The tale drawer finds the tale, though no zone lists it.
      cardOf('Beach').querySelector<HTMLButtonElement>('.tale-card__open')?.click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Beach');
      expect(drawer()?.textContent).toContain('In tale group Loose');
      expect(drawer()?.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true');
    });

    it('reorders the tales of a group in no zone through the group, and rolls a refusal back', async () => {
      const { fixture, root } = await openLoose();
      const later = cardOf('Beach').querySelector<HTMLButtonElement>('[aria-label="Move Beach later"]') as HTMLButtonElement;
      later.focus();
      later.click();
      await settle(fixture);
      expect(cards()).toEqual(['Pool', 'Beach']);
      expect(announced(root)).toBe('Beach moved to position 2 of 2');
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/tales/order`);
      expect(req.request.body).toEqual({ taleIds: ['l2', 'l1'] });
      req.flush([looseTales[1], looseTales[0]].map((tale, position) => ({ ...tale, position })));
      await settle(fixture);
      expect(cards()).toEqual(['Pool', 'Beach']);
      expect(groupView()?.querySelector('.tale-card__badge')?.textContent).toBe('1');

      (cardOf('Pool').querySelector('[aria-label="Move Pool later"]') as HTMLButtonElement).click();
      await settle(fixture);
      expect(cards()).toEqual(['Beach', 'Pool']);
      http
        .expectOne(`${API_BASE}/tale-groups/g2/tales/order`)
        .flush({ error: { code: 'order_mismatch', message: 'The order changed elsewhere' } }, { status: 409, statusText: 'Conflict' });
      await settle(fixture);
      expect(cards()).toEqual(['Pool', 'Beach']);
      expect(groupView()?.querySelector('[role=alert]')?.textContent).toContain('The order changed elsewhere');
    });

    it('keeps a pending tale order through a refresh, then reads the group again once it is saved', async () => {
      const { fixture } = await openLoose();
      (cardOf('Beach').querySelector('[aria-label="Move Beach later"]') as HTMLButtonElement).click();
      await settle(fixture);
      const order = http.expectOne(`${API_BASE}/tale-groups/g2/tales/order`);
      void TestBed.inject(DashboardStore).refresh();
      await flushRefresh(fixture, data);
      await settle(fixture);
      expect(cards()).toEqual(['Pool', 'Beach']);
      const moved = [looseTales[1], looseTales[0]].map((tale, position) => ({ ...tale, position }));
      order.flush(moved);
      await settle(fixture);
      await flushRefresh(fixture, { ...data, readGroups: { g2: { ...loose, tales: moved } } });
      await settle(fixture);
      expect(cards()).toEqual(['Pool', 'Beach']);
    });

    it('opens from a deep link, and drops a ?group= that names no group of the project', async () => {
      const { fixture } = await open('/tale-groups?group=g2', data);
      flushReadGroups(data);
      await settle(fixture);
      expect(cards()).toEqual(['Beach', 'Pool']);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      expect(url()).toBe('/tale-groups');

      await TestBed.inject(Router).navigateByUrl('/tale-groups?group=nope&filter=off');
      await settle(fixture);
      flushReadGroups(data);
      await settle(fixture);
      expect(groupView()).toBeNull();
      expect(url()).toBe('/tale-groups?filter=off');
    });

    it('opens Edit in Tale Studio from a card with the way back to the Tale groups page', async () => {
      const { fixture } = await openLoose();
      pickMenuItem(groupView() as HTMLElement, 'More for Beach', 'Edit in Tale Studio');
      await settle(fixture);
      expect(url()).toBe('/tales/l1/studio?from=tale-groups');
      // The studio's own reads; not what this checks.
      for (const req of http.match((r) => r.method === 'GET' && /\/tales\/l1(\/document)?$/.test(r.url))) {
        req.flush({ error: { code: 'tale_not_found', message: 'gone' } }, { status: 404, statusText: 'Not Found' });
      }
      await settle(fixture);
      for (const req of http.match((r) => r.method === 'GET' && /\/projects\/p1\/(theme|fonts)$/.test(r.url))) req.flush(null);
    });

    it('turns the group in no zone On from its view, which stays open', async () => {
      const { fixture } = await openLoose();
      groupView()?.querySelector<HTMLButtonElement>('[role=switch][aria-label="Loose on site"]')?.click();
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/status`);
      expect(req.request.body).toEqual({ status: 'live' });
      req.flush({ ...loose, status: 'live', storedStatus: 'live' });
      await settle(fixture);
      const on = { ...loose, status: 'live', storedStatus: 'live' };
      await flushRefresh(fixture, {
        ...data,
        projectGroups: { p1: [projectGroup({ ...on, tales: looseTales }), ...(data.projectGroups?.['p1'] ?? []).slice(1)] },
        readGroups: { g2: on },
      });
      await settle(fixture);
      expect(groupView()?.querySelector('[role=switch][aria-label="Loose on site"]')?.getAttribute('aria-checked')).toBe('true');
      expect(announced(fixture.nativeElement as HTMLElement)).toContain('Loose is now');
    });

    // Review fixes (story 8.19).
    const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const pageLive = (root: HTMLElement) => root.querySelector('app-tale-groups-page .page > [aria-live=polite]')?.textContent ?? '';

    // Answers a refresh up to its last stage (the project lists and the groups read on their own),
    // which the test answers itself.
    async function refreshToLastStage(fixture: ComponentFixture<unknown>, given: Data): Promise<void> {
      lastData = given;
      http.expectOne(`${API_BASE}/projects`).flush(given.projects ?? []);
      await settle(fixture);
      http
        .expectOne(`${API_BASE}/zones`)
        .flush((given.zones ?? []).map((z) => ({ slug: z.id, ...z, frame: given.displays?.[z.id] ?? null })));
      await settle(fixture);
      http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
      await settle(fixture);
      for (const z of given.zones ?? []) http.expectOne(`${API_BASE}/zones/${z.id}/tale-groups`).flush(given.groups?.[z.id] ?? []);
      await settle(fixture);
      for (const p of given.projects ?? []) http.expectOne(`${API_BASE}/projects/${p.id}/tags`).flush(given.tags?.[p.id] ?? []);
      await settle(fixture);
    }

    it('keeps a group opened while a refresh runs, though that refresh did not read it', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      const store = TestBed.inject(DashboardStore);
      const refreshing = store.refresh();
      await refreshToLastStage(fixture, data);
      // The refresh is past the point where it chose the groups to read: Loose was not wanted then.
      nameButton(root, 'Loose').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g2`).flush(loose);
      await settle(fixture);
      flushProjectGroups(data);
      await refreshing;
      await settle(fixture);
      expect(Object.keys(store.readGroups())).toEqual(['g2']);
      expect(cards()).toEqual(['Beach', 'Pool']);
    });

    it('drops a group released while a refresh that read it runs', async () => {
      const { fixture } = await openLoose();
      const store = TestBed.inject(DashboardStore);
      const refreshing = store.refresh();
      await refreshToLastStage(fixture, data);
      const read = http.expectOne(`${API_BASE}/tale-groups/g2`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle(fixture);
      read.flush(loose);
      flushProjectGroups(data);
      await refreshing;
      await settle(fixture);
      expect(store.readGroups()).toEqual({});
      expect(groupView()).toBeNull();
    });

    it('says the group is being opened, then why it could not be, and opens it on Try again', async () => {
      const { fixture, root } = await open('/tale-groups', data);
      nameButton(root, 'Loose').click();
      await settle(fixture);
      expect(text(root.querySelector('.group-opening[role=status]'))).toBe('Opening Loose…');
      expect(nameButton(root, 'Loose').getAttribute('aria-busy')).toBe('true');
      http.expectOne(`${API_BASE}/tale-groups/g2`).flush(null, { status: 500, statusText: 'Server Error' });
      await settle(fixture);
      const alert = root.querySelector('.group-opening[role=alert]') as HTMLElement;
      expect(text(alert.querySelector('span'))).toBe('Loose could not be opened. Check the connection and try again.');
      expect(TestBed.inject(DashboardStore).apiDown()).toBe(true);
      expect(groupView()).toBeNull();
      expect(nameButton(root, 'Loose').getAttribute('aria-busy')).toBeNull();
      expect(url()).toBe('/tale-groups?group=g2');

      buttonNamed(alert, 'Try again').click();
      await settle(fixture);
      http.expectOne(`${API_BASE}/tale-groups/g2`).flush(loose);
      await settle(fixture);
      expect(cards()).toEqual(['Beach', 'Pool']);
      expect(root.querySelector('.group-opening')).toBeNull();
    });

    it('drops ?group= and says so when the group is gone (403 or 404)', async () => {
      for (const status of [404, 403]) {
        const { fixture, root } = await open('/tale-groups', data);
        nameButton(root, 'Loose').click();
        await settle(fixture);
        http
          .expectOne(`${API_BASE}/tale-groups/g2`)
          .flush({ error: { code: status === 404 ? 'tale_group_not_found' : 'forbidden', message: 'No' } }, { status, statusText: 'No' });
        for (let i = 0; i < 20 && url() !== '/tale-groups'; i++) await settle(fixture);
        expect(url()).toBe('/tale-groups');
        expect(text(root.querySelector('.group-opening[role=alert]'))).toBe(
          'Loose could not be opened: it no longer exists, or you no longer have access to it.',
        );
        expect(TestBed.inject(DashboardStore).apiDown()).toBe(false);
        expect(TestBed.inject(DashboardStore).readGroups()).toEqual({});
        fixture.destroy();
      }
    });

    it('keeps the open group as it was when a refresh cannot read it, with the API-down banner', async () => {
      const { fixture } = await openLoose();
      const store = TestBed.inject(DashboardStore);
      const refreshing = store.refresh();
      await refreshToLastStage(fixture, data);
      http.expectOne(`${API_BASE}/tale-groups/g2`).flush(null, { status: 502, statusText: 'Bad Gateway' });
      flushProjectGroups(data);
      await refreshing;
      await settle(fixture);
      expect(store.apiDown()).toBe(true);
      expect(cards()).toEqual(['Beach', 'Pool']);
    });

    it('orders tales through one queue per group, apart from the zone order; a refused zone order keeps the saved tale order', async () => {
      const twoGroups: Data = {
        ...data,
        groups: { z1: [{ ...placed, tales: [taleA, taleB] }, { ...placed, id: 'g3', name: 'Other', position: 1, tales: [] }] },
      };
      const { fixture } = await open('/tale-groups', twoGroups);
      const store = TestBed.inject(DashboardStore);
      const groupOrder = store.orderTaleGroups('z1', ['g3', 'g1']);
      const taleOrder = store.orderTales('g1', ['t2', 't1']);
      await settle(fixture);
      // Both are in flight at once: the tale order does not wait behind the zone's group order.
      const groupsReq = http.expectOne(`${API_BASE}/zones/z1/tale-groups/order`);
      const talesReq = http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`);
      expect(store.taleGroupsOf('z1')[1].tales.map((t) => t.id)).toEqual(['t2', 't1']);
      talesReq.flush([{ ...taleB, position: 0 }, { ...taleA, position: 1 }]);
      expect(await taleOrder).toBe('');
      groupsReq.flush({ error: { code: 'order_mismatch', message: 'Changed elsewhere' } }, { status: 409, statusText: 'Conflict' });
      expect(await groupOrder).toBe('Changed elsewhere');
      await settle(fixture);
      expect(store.taleGroupsOf('z1').map((g) => g.id)).toEqual(['g1', 'g3']);
      expect(store.taleGroupsOf('z1')[0].tales.map((t) => t.id)).toEqual(['t2', 't1']);
      // Nothing pending: the group's tale order bookkeeping is gone.
      const internals = store as unknown as { pendingOrders: Map<string, number>; confirmedTales: Map<string, unknown> };
      expect(internals.pendingOrders.has('tales:g1')).toBe(false);
      expect(internals.confirmedTales.size).toBe(0);
    });

    it('shows a tale order from the Tale groups view in the zone lists too, and a hidden tale\'s visibility from the answer', async () => {
      const placedRead = { ...placed, position: undefined, tales: [{ ...taleA, visibility: VISIBLE }, { ...taleB, visibility: VISIBLE }] };
      const given: Data = { ...data, groups: { z1: [{ ...placed, tales: [taleA, taleB] }] }, readGroups: { ...data.readGroups, g1: placedRead } };
      const { fixture, root } = await open('/tale-groups', given);
      nameButton(root, 'Summer').click();
      await settle(fixture);
      flushReadGroups(given);
      await settle(fixture);
      (cardOf('A').querySelector('[aria-label="Move A later"]') as HTMLButtonElement).click();
      await settle(fixture);
      const store = TestBed.inject(DashboardStore);
      expect(store.taleGroupsOf('z1')[0].tales.map((t) => t.id)).toEqual(['t2', 't1']);
      http.expectOne(`${API_BASE}/tale-groups/g1/tales/order`).flush([{ ...taleB, position: 0 }, { ...taleA, position: 1 }]);
      await settle(fixture);
      expect(cards()).toEqual(['B', 'A']);

      cardOf('A').querySelector<HTMLButtonElement>('[role=switch]')?.click();
      await settle(fixture);
      const hiddenWhy = { visible: false, reasons: [{ code: 'tale-hidden', subject: 'tale' }] };
      http.expectOne(`${API_BASE}/tales/t1/status`).flush({ ...taleA, status: 'paused', storedStatus: 'paused', visibility: hiddenWhy });
      await settle(fixture);
      expect(store.readGroups()['g1'].tales.find((t) => t.id === 't1')?.visibility).toEqual(hiddenWhy);
      await flushRefresh(fixture, given);
    });

    it('archives the group from its view: the view closes, Undo shows above the list with focus, and restores it', async () => {
      const { fixture, root } = await openLoose();
      pickMenuItem(groupView() as HTMLElement, 'More for Loose', 'Archive');
      await settle(fixture);
      const req = http.expectOne(`${API_BASE}/tale-groups/g2/status`);
      expect(req.request.body).toEqual({ status: 'archived' });
      const archived = { ...loose, status: 'archived', storedStatus: 'archived', visibility: { visible: false, reasons: [{ code: 'archived', subject: 'group' }] } };
      req.flush(archived);
      await settle(fixture);
      const archivedData: Data = {
        ...data,
        projectGroups: { p1: [projectGroup({ ...archived, tales: looseTales }), ...(data.projectGroups?.['p1'] ?? []).slice(1)] },
        readGroups: { g2: archived },
      };
      await flushRefresh(fixture, archivedData);
      for (let i = 0; i < 20 && url() !== '/tale-groups'; i++) await settle(fixture);
      expect(url()).toBe('/tale-groups');
      expect(groupView()).toBeNull();
      expect(text(root.querySelector('.undo-bar'))).toBe('Loose archived. Undo');
      expect(document.activeElement?.id).toBe('undo-archive');
      expect(pageLive(root)).toContain('Undo is above the list.');

      (root.querySelector('#undo-archive') as HTMLButtonElement).click();
      await settle(fixture);
      const undo = http.expectOne(`${API_BASE}/tale-groups/g2/status`);
      // It was Off (draft) before: Undo brings it back Off.
      expect(undo.request.body).toEqual({ status: 'paused' });
      const paused = { ...loose, status: 'paused', storedStatus: 'paused' };
      undo.flush(paused);
      await settle(fixture);
      await flushRefresh(fixture, {
        ...data,
        projectGroups: { p1: [projectGroup({ ...paused, tales: looseTales }), ...(data.projectGroups?.['p1'] ?? []).slice(1)] },
      });
      await settle(fixture);
      expect(root.querySelector('.undo-bar')).toBeNull();
      expect(pageLive(root)).toContain('Loose restored, off');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('More for Loose');
    });
  });

  describe('project theme (R9)', () => {
    const themeUrl = `${API_BASE}/projects/p1/theme`;
    const defaults = {
      ringStyle: 'gradient',
      ringColors: ['#ea580c', '#db2777', '#7c3aed'],
      seenRingColor: '#6b7280',
      ringWidth: 2,
      cornerRadius: null,
      fontFamily: null,
      titleColor: null,
      backgroundColor: 'transparent',
      accentColor: '#ffffff',
    };
    const projectTheme = (theme: object) => ({ projectId: 'p1', theme, resolved: { ...defaults, ...theme } });

    async function openTheme(theme: object = {}): Promise<{ fixture: ComponentFixture<App>; root: HTMLElement }> {
      const opened = await open('/projects/p1/theme', oneZone);
      http.expectOne(themeUrl).flush(projectTheme(theme));
      await settle(opened.fixture);
      return opened;
    }

    const input = (root: HTMLElement, id: string) => root.querySelector<HTMLInputElement>(`#theme-${id}`);
    const warning = (root: HTMLElement) => root.querySelector('.contrast:not(.contrast--note)')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const note = (root: HTMLElement) => root.querySelector('.contrast--note')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    function toggle(box: HTMLInputElement | null, checked: boolean): void {
      if (!box) throw new Error('No checkbox');
      box.checked = checked;
      box.dispatchEvent(new Event('change'));
    }

    async function expectSave(fixture: ComponentFixture<unknown>, root: HTMLElement, body: object): Promise<void> {
      buttonNamed(root, 'Save theme').click();
      const req = http.expectOne(themeUrl);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(body);
      req.flush(projectTheme(body));
      await settle(fixture);
    }

    it('links each project card to its theme, for content managers too', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await navigate(fixture, '/projects', { setupRequired: false, user: { ...admin, role: 'content_manager' } });
      await flushRefresh(fixture, oneZone);
      const root = fixture.nativeElement as HTMLElement;
      const link = root.querySelector<HTMLAnchorElement>('a[aria-label="Theme of Acme"]');
      expect(link?.getAttribute('href')).toBe('/projects/p1/theme');
    });

    it("shows the default theme: host page's title colour, font and background, the frame's radius", async () => {
      const { root } = await openTheme();
      expect(root.querySelector('h2')?.textContent).toContain('Theme');
      expect(root.querySelector<HTMLSelectElement>('#theme-ringStyle')?.value).toBe('gradient');
      expect([0, 1, 2].map((i) => input(root, `ringColors-${i}`)?.value)).toEqual(defaults.ringColors);
      expect(input(root, 'ringWidth')?.value).toBe('2');
      for (const id of ['titleColor', 'backgroundColor', 'fontFamily', 'cornerRadius']) {
        expect(input(root, `${id}-host`)?.checked).toBe(true);
        expect(input(root, id)).toBeNull();
      }
      expect(input(root, 'seenRingColor')?.value).toBe('#6b7280');
      expect(warning(root)).toBe('');
      // Pairs whose colour comes from the host page are not checked, and the page says so.
      expect(note(root)).toContain('Title on background: both come from the host page');
      expect(note(root)).toContain('Rings on background: the background is transparent');
    });

    it('shows explicit values with their fields', async () => {
      const { root } = await openTheme({ cornerRadius: 0, titleColor: '#000000', fontFamily: 'Georgia, serif', backgroundColor: '#fafafa' });
      expect(input(root, 'cornerRadius')?.value).toBe('0');
      expect(input(root, 'titleColor')?.value).toBe('#000000');
      expect(input(root, 'fontFamily')?.value).toBe('Georgia, serif');
      expect(input(root, 'backgroundColor')?.value).toBe('#fafafa');
      expect(root.querySelector<HTMLInputElement>('input[type=color][aria-label="Title colour picker"]')?.value).toBe('#000000');
      expect(note(root)).toBe('');
    });

    it('stores only the field that changed', async () => {
      const { fixture, root } = await openTheme();
      type(input(root, 'seenRingColor'), '#333333');
      await settle(fixture);
      await expectSave(fixture, root, { seenRingColor: '#333333' });
    });

    it('keeps the stored fields and drops a field changed back to its default', async () => {
      const { fixture, root } = await openTheme({ seenRingColor: '#333333', cornerRadius: 0 });
      type(input(root, 'seenRingColor'), '#6B7280');
      toggle(input(root, 'cornerRadius-host'), true);
      type(input(root, 'accentColor'), '#ffcc00');
      await settle(fixture);
      await expectSave(fixture, root, { accentColor: '#ffcc00' });
    });

    it('saves a solid ring in one colour, corner radius 0 and a serif font', async () => {
      const { fixture, root } = await openTheme();
      choose(root.querySelector<HTMLSelectElement>('#theme-ringStyle'), 'solid');
      await settle(fixture);
      for (let i = 0; i < 2; i++) {
        buttonNamed(root, 'Remove').click();
        await settle(fixture);
      }
      expect(root.querySelector('#theme-ringColors-1')).toBeNull();
      type(root.querySelector<HTMLInputElement>('input[type=color][aria-label="Ring colour 1 picker"]'), '#0055ff');
      toggle(input(root, 'cornerRadius-host'), false);
      toggle(input(root, 'fontFamily-host'), false);
      await settle(fixture);
      type(input(root, 'cornerRadius'), '0');
      type(input(root, 'fontFamily'), 'Georgia, serif');
      await settle(fixture);
      expect(input(root, 'ringColors-0')?.value).toBe('#0055ff');

      await expectSave(fixture, root, { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' });
      expect(root.textContent).toContain('Theme saved.');
    });

    it('sets and clears an explicit title colour and background', async () => {
      const { fixture, root } = await openTheme({ titleColor: '#000000' });
      toggle(input(root, 'titleColor-host'), true);
      toggle(input(root, 'backgroundColor-host'), false);
      await settle(fixture);
      expect(input(root, 'titleColor')).toBeNull();
      expect(input(root, 'backgroundColor')?.value).toBe('#ffffff');
      await expectSave(fixture, root, { backgroundColor: '#ffffff' });
    });

    it('keeps the typed text of a number field and restores the last valid number on blur', async () => {
      const { fixture, root } = await openTheme({ ringWidth: 3 });
      const width = input(root, 'ringWidth') as HTMLInputElement;
      type(width, '');
      await settle(fixture);
      expect(width.value).toBe('');
      type(width, '9');
      await settle(fixture);
      expect(width.value).toBe('9');
      width.dispatchEvent(new Event('blur'));
      await settle(fixture);
      expect(width.value).toBe('3');
      type(width, '4');
      width.dispatchEvent(new Event('blur'));
      await settle(fixture);
      expect(width.value).toBe('4');
      await expectSave(fixture, root, { ringWidth: 4 });
    });

    it('refuses an invalid colour in the form, naming and marking the field, without sending', async () => {
      const { fixture, root } = await openTheme();
      toggle(input(root, 'titleColor-host'), false);
      await settle(fixture);
      type(input(root, 'titleColor'), 'red');
      await settle(fixture);
      buttonNamed(root, 'Save theme').click();
      await settle(fixture);
      http.expectNone(themeUrl);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('theme.titleColor must be a colour as #rrggbb');
      expect(input(root, 'titleColor')?.getAttribute('aria-invalid')).toBe('true');
      expect(input(root, 'titleColor')?.getAttribute('aria-describedby')).toContain('theme-error');
      // Changing the field clears the mark.
      type(input(root, 'titleColor'), '#000000');
      await settle(fixture);
      expect(input(root, 'titleColor')?.getAttribute('aria-invalid')).toBeNull();
    });

    it("shows the API's refusal and marks the field it names", async () => {
      const { fixture, root } = await openTheme();
      buttonNamed(root, 'Save theme').click();
      http
        .expectOne(themeUrl)
        .flush({ error: { code: 'invalid_theme', message: 'theme.ringWidth must be at most 4' } }, { status: 400, statusText: 'Bad Request' });
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('theme.ringWidth must be at most 4');
      expect(input(root, 'ringWidth')?.getAttribute('aria-invalid')).toBe('true');
    });

    it('warns when a colour pair fails WCAG contrast, and still saves', async () => {
      const { fixture, root } = await openTheme({ titleColor: '#000000', backgroundColor: '#ffffff' });
      type(input(root, 'titleColor'), '#cccccc');
      type(input(root, 'accentColor'), '#808080');
      await settle(fixture);
      expect(warning(root)).toContain('Title on background: 1.61:1, needs 4.5:1');
      expect(warning(root)).toContain("Accent on the viewer's progress track");
      expect(warning(root)).toContain("Accent on the viewer's buttons over light media");
      expect(root.querySelector('.contrast')?.closest('[role=status]')).not.toBeNull();
      await expectSave(fixture, root, { titleColor: '#cccccc', backgroundColor: '#ffffff', accentColor: '#808080' });
    });

    it("resets the theme to TaleArt's default", async () => {
      const { fixture, root } = await openTheme({ cornerRadius: 0, titleColor: '#000000' });
      buttonNamed(root, 'Reset to TaleArt default').click();
      const req = http.expectOne(themeUrl);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({});
      req.flush(projectTheme({}));
      await settle(fixture);
      expect(input(root, 'cornerRadius-host')?.checked).toBe(true);
      expect(input(root, 'titleColor-host')?.checked).toBe(true);
      expect(root.textContent).toContain("Theme reset to TaleArt's default.");
    });

    it('adds ring colours up to three', async () => {
      const { fixture, root } = await openTheme({ ringColors: ['#000000'] });
      expect(root.querySelector('#theme-ringColors-1')).toBeNull();
      buttonNamed(root, 'Add colour').click();
      await settle(fixture);
      buttonNamed(root, 'Add colour').click();
      await settle(fixture);
      expect([0, 1, 2].map((i) => input(root, `ringColors-${i}`)?.value)).toEqual(['#000000', '#db2777', '#7c3aed']);
      expect([...root.querySelectorAll('button')].some((b) => b.textContent?.includes('Add colour'))).toBe(false);
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
      // The first project is named "My project" unless the admin types another name.
      expect(root.querySelector<HTMLInputElement>('#setup-project')?.value).toBe('My project');
      type(root.querySelector<HTMLInputElement>('#setup-project'), '  Acme shop ');
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
      // Then the first project, so the first run goes straight to a zone.
      const created = http.expectOne((r) => r.method === 'POST' && r.url === `${API_BASE}/projects`);
      expect(created.request.body).toEqual({ name: 'Acme shop' });
      created.flush({ id: 'p1', name: 'Acme shop' }, { status: 201, statusText: 'Created' });
      await signedInTick(fixture);
      // The sign-in's load read the projects before the POST: it answers with none, and the store
      // reads them again before the zones page opens (the first run's race, after story 8.13).
      const reads = http.match(`${API_BASE}/projects`);
      expect(reads.length).toBe(2);
      reads[0].flush([]);
      await signedInTick(fixture);
      expect(router.url).toBe('/setup?returnUrl=%2Fzones');
      reads[1].flush([acme]);
      await settle(fixture);
      await flushRefresh(fixture, oneZone, { projectsRead: false });

      expect(router.url).toBe('/zones');
      expect(root.querySelector('#empty-projects')).toBeNull();
      expect(root.querySelector('h1')?.textContent).toContain('Zones');
      expect(root.querySelector('.user-menu')?.textContent).toContain('Ada Admin');
    });

    it('lands on Zones even when the first project is refused, with its "Create your first project"', async () => {
      const { fixture, root } = await visit('/setup', setupState);
      type(root.querySelector<HTMLInputElement>('#setup-name'), 'Ada Admin');
      type(root.querySelector<HTMLInputElement>('#setup-email'), 'ada@example.com');
      type(root.querySelector<HTMLInputElement>('#setup-project'), '   ');
      buttonNamed(root, 'Create passkey').click();
      http.expectOne(`${API_BASE}/auth/setup/options`).flush(creationOptions);
      await tick();
      http.expectOne(`${API_BASE}/auth/setup/verify`).flush({ user: admin }, { status: 201, statusText: 'Created' });
      await signedInTick(fixture);
      const created = http.expectOne((r) => r.method === 'POST' && r.url === `${API_BASE}/projects`);
      // A blank name falls back to "My project".
      expect(created.request.body).toEqual({ name: 'My project' });
      created.flush({ error: { code: 'validation_failed', message: 'name is too long' } }, { status: 400, statusText: 'Bad Request' });
      await signedInTick(fixture);
      await flushRefresh(fixture, { projects: [] });
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/zones');
      // The API's reason reaches the zones page.
      expect(root.querySelector('[aria-labelledby=empty-projects] [role=alert]')?.textContent).toContain(
        'Your first project was not created: name is too long',
      );
    });

    it('limits the first project name to 100 characters', async () => {
      const { fixture, root } = await visit('/setup', setupState);
      const field = root.querySelector<HTMLInputElement>('#setup-project');
      expect(field?.getAttribute('maxlength')).toBe('100');
      type(root.querySelector<HTMLInputElement>('#setup-name'), 'Ada Admin');
      type(root.querySelector<HTMLInputElement>('#setup-email'), 'ada@example.com');
      type(field, 'x'.repeat(101));
      buttonNamed(root, 'Create passkey').click();
      await settle(fixture);
      http.expectNone(`${API_BASE}/auth/setup/options`);
      expect(root.querySelector('.form-error')?.textContent).toContain('longer than 100 characters');
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

    // What Demo shop holds, as the preview answers it.
    const demoPreview = (extra: object = {}) => ({
      appId: '1001',
      appName: 'Demo shop',
      zones: [
        { id: '2001', name: 'Home page', taleGroups: 3, tales: 8 },
        { id: '2002', name: 'Product page', taleGroups: 2, tales: 5 },
        { id: '2003', name: 'Checkout', taleGroups: 1, tales: null },
      ],
      zonesBeyond: 0,
      countsComplete: true,
      selectionKey: 'v1.key.mac',
      expiresAt: '2026-10-20T12:30:00.000Z',
      ...extra,
    });

    // Pastes the token, finds the apps and chooses Demo shop, which shows what it holds.
    async function chooseApp(
      fixture: ComponentFixture<unknown>,
      root: HTMLElement,
      preview = demoPreview(),
    ): Promise<void> {
      type(root.querySelector<HTMLInputElement>('#import-token'), 'fake-storyly-token');
      buttonNamed(root, 'Find apps').click();
      const find = http.expectOne(`${importsUrl}/storyly/apps`);
      expect(find.request.method).toBe('POST');
      expect(find.request.body).toEqual({ token: 'fake-storyly-token' });
      find.flush([{ id: '1001', name: 'Demo shop' }]);
      await settle(fixture);

      const options = [...(root.querySelector<HTMLSelectElement>('#import-app')?.options ?? [])];
      expect(options.map((o) => o.textContent?.trim())).toEqual(['Demo shop']);
      expect(root.textContent).not.toContain('Start import');
      buttonNamed(root, 'Choose what to import').click();
      const read = http.expectOne(`${importsUrl}/storyly/preview`);
      expect(read.request.method).toBe('POST');
      expect(read.request.body).toEqual({ token: 'fake-storyly-token', appId: '1001' });
      read.flush(preview);
      await settle(fixture);
    }

    // Pastes the token, finds the apps and starts importing all of Demo shop, which opens the job's page.
    async function startImport(fixture: ComponentFixture<unknown>, root: HTMLElement): Promise<void> {
      await chooseApp(fixture, root);
      buttonNamed(root, 'Start import').click();
      const start = http.expectOne((r) => r.method === 'POST' && r.url === importsUrl);
      expect(start.request.body).toEqual({
        token: 'fake-storyly-token',
        appId: '1001',
        selection: {
          selectionKey: 'v1.key.mac',
          zones: ['2001', '2002', '2003'],
          taleGroups: true,
          media: true,
          tags: true,
        },
      });
      start.flush({ id: 'j1', status: 'queued' }, { status: 202, statusText: 'Accepted' });
      await settle(fixture);
    }

    const checkbox = (root: HTMLElement, name: string) => {
      const label = [...root.querySelectorAll('label.checkbox')].find((l) => l.textContent?.trim() === name);
      const input = label?.querySelector<HTMLInputElement>('input[type=checkbox]');
      if (!input) throw new Error(`No checkbox named ${name}`);
      return input;
    };
    const click = (fixture: ComponentFixture<unknown>, input: HTMLInputElement) => {
      input.click();
      fixture.detectChanges();
    };

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

    it('starts the import, opens its own page and shows its progress rising, then the report', async () => {
      const { fixture, root } = await openForm();
      await startImport(fixture, root);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import/j1');
      expect(root.querySelector('#import-token')).toBeNull();

      await answerPoll(fixture, job('queued', { sourceAppName: null }));
      expect(root.querySelector('main [role=status]')?.textContent).toContain('Queued');
      expect(root.textContent).toContain('Waiting to start.');
      expect(root.querySelector('[aria-label=Progress]')).toBeNull();

      await answerPoll(fixture, job('running', { progress: progress([3, 1], [3, 0], [0, 0]) }));
      expect(root.querySelector('main [role=status]')?.textContent).toContain('Running');
      expect(root.textContent).toContain('From the app Demo shop');
      expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-20T12:00:01.000Z');
      expect(rows(root, 'Progress')).toEqual(['Zones: 3 read / 1 written', 'Tale groups: 3 read / 0 written', 'Tales: 0 read / 0 written']);

      await answerPoll(fixture, job('running', { progress: progress([3, 2], [5, 4], [11, 9]) }));
      expect(rows(root, 'Progress')).toEqual(['Zones: 3 read / 2 written', 'Tale groups: 5 read / 4 written', 'Tales: 11 read / 9 written']);

      await answerPoll(
        fixture,
        job('done', { report, progress: progress([3, 3], [6, 6], [15, 14]), finishedAt: '2026-10-20T12:00:09.000Z' }),
      );
      expect(root.querySelector('main [role=status]')?.textContent).toContain('Done');
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

    it('keeps following a running import after a reload of its page', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(fixture, job('running', { progress: progress([3, 2], [4, 3], [8, 6]) }));
      expect(root.querySelector('main [role=status]')?.textContent).toContain('Running');
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
      // Stored before records were checked: no differences section and no by-design line.
      expect(root.textContent).not.toContain('Differences');
      expect(root.textContent).not.toContain('Not imported by design');
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    // A report difference; the parent's source id defaults to its name, for brevity.
    const difference = (
      entity: string,
      record: {
        sourceId: string | null;
        name: string | null;
        within: string | null;
        withinSourceId?: string | null;
        position: number | null;
      },
      kind: string,
      field: string | null,
      sourceField: string | null = null,
    ) => ({ entity, record: { ...record, withinSourceId: record.withinSourceId ?? record.within }, kind, field, sourceField });

    it('lists the differences by entity and record, and what is not imported by design', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const deal = { sourceId: '4101', name: 'Deal of the day', within: 'Odd group', position: 1 };
      const odd = { sourceId: '4102', name: 'Odd order', within: 'Odd group', position: 2 };
      const differences = [
        difference('zone', { sourceId: '2101', name: 'Odd home', within: null, position: 1 }, 'renamed', 'title', 'name'),
        difference('zone', { sourceId: null, name: null, within: null, position: 2 }, 'invalidRecord', null),
        difference('taleGroup', { sourceId: '3102', name: null, within: 'Odd home', position: 2 }, 'wrongType', 'title'),
        difference('tale', deal, 'notHeld', 'deep_link'),
        difference('tale', deal, 'notHeld', 'button_text'),
        difference('tale', odd, 'unexpected', 'cta_macro'),
        difference('tale', { ...deal, sourceId: '4105', name: 'No media', within: 'Untitled tale group' }, 'missing', 'media'),
      ];
      await answerPoll(
        fixture,
        job('done', {
          report: { ...report, differences, notImportedByDesign: ['Conversion records', 'Stats'] },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      const section = root.querySelector('[aria-labelledby=import-differences-title]') as HTMLElement;
      expect(section.querySelector('h4')?.textContent?.trim()).toBe('Differences (7)');
      const summaries = [...section.querySelectorAll('summary')].map((s) => s.textContent?.replace(/\s+/g, ' ').trim());
      expect(summaries).toEqual([
        'Zones: 2 differences in 2 records',
        'Tale groups: 1 difference in 1 record',
        'Tales: 4 differences in 3 records',
      ]);
      // Each record with its lines, as "record | line | line".
      const records = (label: string) =>
        [...section.querySelectorAll(`[aria-label="${label}"] > li`)].map((li) =>
          [li.querySelector('.import-difference-record'), ...li.querySelectorAll('.import-difference-lines > li')]
            .map((node) => node?.textContent?.trim())
            .join(' | '),
        );
      expect(records('Zones differences')).toEqual([
        '"Odd home" (id 2101) | title: came as "name"',
        'Record 2 | could not be read, so it was skipped',
      ]);
      expect(records('Tale groups differences')).toEqual(['Record 2 (id 3102) in "Odd home" | title: empty or of the wrong type']);
      expect(records('Tales differences')).toEqual([
        '"Deal of the day" (id 4101) in "Odd group" | deep_link: not held in TaleArt | button_text: not held in TaleArt',
        '"Odd order" (id 4102) in "Odd group" | cta_macro: unexpected field',
        '"No media" (id 4105) in "Untitled tale group" | media: missing',
      ]);
      expect([...section.querySelectorAll('details')].every((d) => d.open)).toBe(true);
      expect(root.textContent).toContain('Not imported by design: Conversion records, Stats.');
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('shows the media row and why a tale has no media', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const big = { sourceId: '4305', name: 'Too big', within: 'Every kind of media', position: 5 };
      const meta = { sourceId: '4308', name: 'Metadata', within: 'Every kind of media', position: 8 };
      const differences = [
        { ...difference('tale', big, 'mediaNotImported', 'media'), reason: 'tooLarge' },
        { ...difference('tale', meta, 'mediaNotImported', 'media'), reason: 'blockedAddress' },
      ];
      await answerPoll(
        fixture,
        job('done', {
          report: { ...report, media: { source: 14, imported: 12, skipped: 2 }, differences },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      expect(rows(root, 'Report')).toEqual([
        'Zones: 3 source / 3 imported',
        'Tale groups: 6 source / 6 imported',
        'Tales: 15 source / 14 imported / 1 skipped',
        'Media: 14 source / 12 imported / 2 skipped',
      ]);
      const lines = [...root.querySelectorAll('[aria-label="Tales differences"] .import-difference-lines > li')].map(
        (li) => li.textContent?.trim(),
      );
      expect(lines).toEqual([
        'media: not imported (larger than a tale accepts), so the tale has no media',
        'media: not imported (its link leads to a private address), so the tale has no media',
      ]);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('shows how long a finished import took, and nothing for a report without it', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('done', { report: { ...report, elapsedSeconds: 252 }, finishedAt: '2026-10-20T12:04:13.000Z' }),
      );
      const took = () =>
        [...root.querySelectorAll('dt')].find((dt) => dt.textContent?.trim() === 'Took')?.nextElementSibling
          ?.textContent;
      expect(took()?.trim()).toBe('4 min 12 s');
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('writes durations in seconds, minutes and hours', () => {
      expect([0, 42, 60, 252, 3600, 3780].map(importDurationText)).toEqual([
        '0 s',
        '42 s',
        '1 min',
        '4 min 12 s',
        '1 h',
        '1 h 3 min',
      ]);
    });

    it('shows the tags row and why a label did not become a tag, after the other entities', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const blank = { sourceId: null, name: null, within: 'Odd labels', withinSourceId: '3402', position: 1 };
      const long = {
        sourceId: null,
        name: 'A label far too long',
        within: 'Odd labels',
        withinSourceId: '3402',
        position: 3,
      };
      const group = {
        sourceId: '3404',
        name: 'Bad segments',
        within: 'Label wall',
        withinSourceId: '2401',
        position: 4,
      };
      const differences = [
        { ...difference('tag', blank, 'tagNotImported', 'segments'), reason: 'blank' },
        { ...difference('tag', long, 'tagNotImported', 'segments'), reason: 'tooLong' },
        { ...difference('tag', { ...blank, position: 4 }, 'tagNotImported', 'segments'), reason: 'notText' },
        { ...difference('tag', { ...blank, position: 9 }, 'tagNotImported', 'segments'), reason: 'invalidCharacters' },
        difference('taleGroup', group, 'wrongType', 'segments'),
      ];
      await answerPoll(
        fixture,
        job('done', {
          report: { ...report, tags: { source: 16, imported: 8, skipped: 8 }, differences },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      expect(rows(root, 'Report')).toEqual([
        'Zones: 3 source / 3 imported',
        'Tale groups: 6 source / 6 imported',
        'Tales: 15 source / 14 imported / 1 skipped',
        'Tags: 16 source / 8 imported / 8 skipped',
      ]);
      const section = root.querySelector('.import-differences') as HTMLElement;
      expect([...section.querySelectorAll('details summary')].map((s) => s.textContent?.trim())).toEqual([
        expect.stringContaining('Tale groups'),
        expect.stringContaining('Tags'),
      ]);
      const records = [...section.querySelectorAll('[aria-label="Tags differences"] > li')].map((li) =>
        [li.querySelector('.import-difference-record'), ...li.querySelectorAll('.import-difference-lines > li')]
          .map((node) => node?.textContent?.trim())
          .join(' | '),
      );
      expect(records).toEqual([
        'Record 1 in "Odd labels" | segments: label not imported (blank)',
        '"A label far too long" in "Odd labels" | segments: label not imported (longer than 40 characters)',
        'Record 4 in "Odd labels" | segments: label not imported (not text)',
        'Record 9 in "Odd labels" | segments: label not imported (holds control characters)',
      ]);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('shows what a re-import changed per row, and the edits it kept and the records the source dropped', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const count = (counts: Record<string, number>) => ({
        created: 0,
        updated: 0,
        unchanged: 0,
        keptLocalEdit: 0,
        removedAtSource: 0,
        ...counts,
      });
      const tale = {
        sourceId: '4001',
        name: 'Up to 70% off',
        within: 'Summer sale',
        withinSourceId: '3001',
        position: 1,
      };
      const gone = { sourceId: '2003', name: 'Checkout', within: null, withinSourceId: null, position: null };
      const label = { sourceId: null, name: 'summer', within: 'Summer sale', withinSourceId: '3001', position: null };
      const differences = [
        difference('tale', tale, 'keptLocalEdit', 'title'),
        difference('zone', gone, 'removedAtSource', null),
        difference('tag', label, 'removedAtSource', 'segments'),
        difference('zone', { ...gone, sourceId: '2004', name: null }, 'removedAtSource', null),
      ];
      await answerPoll(
        fixture,
        job('done', {
          report: {
            ...report,
            differences,
            changes: {
              zones: count({ unchanged: 2, removedAtSource: 1 }),
              taleGroups: count({ updated: 1, unchanged: 5 }),
              tales: count({ created: 1, unchanged: 13, keptLocalEdit: 1 }),
            },
          },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      expect(rows(root, 'Report')).toEqual([
        'Zones: 3 source / 3 imported · 2 unchanged, 1 no longer at the source',
        'Tale groups: 6 source / 6 imported · 1 updated, 5 unchanged',
        'Tales: 15 source / 14 imported / 1 skipped · 1 created, 13 unchanged, 1 kept as changed in TaleArt',
      ]);
      const lines = [...root.querySelectorAll('.import-difference-records > li')].map((li) =>
        [li.querySelector('.import-difference-record'), ...li.querySelectorAll('.import-difference-lines > li')]
          .map((node) => node?.textContent?.trim())
          .join(' | '),
      );
      expect(lines).toEqual([
        '"Checkout" (id 2003) | no longer at the source; kept in TaleArt',
        'A record (id 2004) | no longer at the source; kept in TaleArt',
        '"Up to 70% off" (id 4001) in "Summer sale" | title: changed at the source, kept as changed in TaleArt',
        '"summer" in "Summer sale" | segments: label no longer at the source; the tag stays',
      ]);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it("counts the tales' unreadable layers, lists links not imported and its button's re-import rows (Tale Studio R17)", async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const tale = (sourceId: string, name: string, position: number) => ({
        sourceId,
        name,
        within: 'Calls to action',
        withinSourceId: '3501',
        position,
      });
      const differences = [
        { ...difference('tale', tale('4503', 'App only', 3), 'linkNotImported', 'deep_link'), reason: 'scheme' },
        { ...difference('tale', tale('4505', 'Long link', 5), 'linkNotImported', 'outlink'), reason: 'tooLong' },
        difference('tale', tale('4501', 'Shop the sale', 1), 'keptLocalEdit', 'button_text'),
        difference('tale', tale('4506', 'Both links', 6), 'keptLocalEdit', 'button'),
        difference('tale', tale('4502', 'New in', 2), 'removedAtSource', 'button_text'),
      ];
      await answerPoll(
        fixture,
        job('done', { report: { ...report, differences, unreadableLayers: 7 }, finishedAt: '2026-10-20T12:00:09.000Z' }),
      );
      expect(root.querySelector('.import-unreadable')?.textContent?.trim()).toBe(
        'Text, stickers and components of 7 tales: not readable through the API, so not imported.',
      );
      const lines = [...root.querySelectorAll('.import-difference-records > li')].map((li) =>
        [li.querySelector('.import-difference-record'), ...li.querySelectorAll('.import-difference-lines > li')]
          .map((node) => node?.textContent?.trim())
          .join(' | '),
      );
      expect(lines).toEqual([
        '"App only" (id 4503) in "Calls to action" | deep_link: link not imported (not an http or https link)',
        '"Long link" (id 4505) in "Calls to action" | outlink: link not imported (longer than 2,048 characters)',
        '"Shop the sale" (id 4501) in "Calls to action" | button_text: changed at the source, kept as changed in TaleArt',
        '"Both links" (id 4506) in "Calls to action" | You removed the button; the source\'s change was not added',
        '"New in" (id 4502) in "Calls to action" | button_text: no longer at the source; the button stays in TaleArt',
      ]);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('says when there are no differences, and keeps a long list closed with the omitted count', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('done', {
          report: { ...report, differences: [], notImportedByDesign: ['Conversion records', 'Stats'] },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      expect(root.querySelector('#import-differences-title')?.textContent?.trim()).toBe('Differences (0)');
      expect(root.textContent).toContain('No differences: every record matched the shape the import expects.');
      expect(root.querySelector('details')).toBeNull();
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('renders a closed group empty, and an open one 100 records at a time with "Show more"', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const many = Array.from({ length: 250 }, (_, i) =>
        difference('tale', { sourceId: String(5000 + i), name: `Tale ${i}`, within: 'Big group', position: i + 1 }, 'notHeld', 'outlink'),
      );
      await answerPoll(
        fixture,
        job('done', { report: { ...report, differences: many, differencesOmitted: 3 }, finishedAt: '2026-10-20T12:00:09.000Z' }),
      );
      expect(root.querySelector('#import-differences-title')?.textContent?.trim()).toBe('Differences (253)');
      expect(root.textContent).toContain('3 more differences were found and are not listed.');
      const details = root.querySelector('details') as HTMLDetailsElement;
      expect(details.open).toBe(false);
      // Closed: not one record is rendered.
      expect(details.querySelectorAll('.import-difference-records > li')).toHaveLength(0);

      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();
      const shown = () => details.querySelectorAll('.import-difference-records > li').length;
      expect(shown()).toBe(100);
      buttonNamed(root, 'Show more (150 more records)').click();
      fixture.detectChanges();
      expect(shown()).toBe(200);
      buttonNamed(root, 'Show more (50 more records)').click();
      fixture.detectChanges();
      expect(shown()).toBe(250);
      expect(details.querySelector('.import-difference-more')).toBeNull();

      // Closing it renders nothing again.
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();
      expect(shown()).toBe(0);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('keeps apart records whose names or ids could be confused', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      const differences = [
        // Two groups both called "Sale": the same story id under each is two records.
        difference('tale', { sourceId: '7', name: 'A', within: 'Sale', withinSourceId: '31', position: 1 }, 'notHeld', 'outlink'),
        difference('tale', { sourceId: '7', name: 'A', within: 'Sale', withinSourceId: '32', position: 1 }, 'notHeld', 'outlink'),
        // A record whose id reads "#3" and an unreadable record at place 3.
        difference('tale', { sourceId: '#3', name: 'B', within: 'Sale', withinSourceId: '31', position: 2 }, 'unexpected', 'x'),
        difference('tale', { sourceId: null, name: null, within: 'Sale', withinSourceId: '31', position: 3 }, 'invalidRecord', null),
      ];
      await answerPoll(fixture, job('done', { report: { ...report, differences }, finishedAt: '2026-10-20T12:00:09.000Z' }));
      expect(root.querySelector('summary')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Tales: 4 differences in 4 records');
      expect(root.querySelectorAll('.import-difference-records > li')).toHaveLength(4);
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
      expect(root.querySelector('main [role=status]')?.textContent).toContain('Failed');
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

    it('shows each zone of the app with its counts, all picked, and picks all or none with one box', async () => {
      const { fixture, root } = await openForm();
      await chooseApp(fixture, root);
      expect(root.textContent).toContain('What to import from Demo shop');
      const zones = root.querySelector('#import-zone-list');
      expect(zones?.closest('fieldset')?.querySelector('legend')?.textContent?.trim()).toBe('Zones');
      expect(rows(root, 'Zones of the app')).toEqual([
        'Home page 3 tale groups, 8 tales',
        'Product page 2 tale groups, 5 tales',
        'Checkout 1 tale group, tales not counted',
      ]);
      // Each zone's counts describe its checkbox.
      const home = checkbox(root, 'Home page');
      const homeCounts = root.querySelector(`#${home.getAttribute('aria-describedby')}`);
      expect(homeCounts?.textContent).toBe('3 tale groups, 8 tales');
      const all = checkbox(root, 'All zones');
      expect(all.getAttribute('aria-controls')).toBe('import-zone-list');
      const count = () => root.querySelector('.import-pick__count')?.textContent?.replace(/\s+/g, ' ').trim();
      expect(all.checked).toBe(true);
      expect(all.indeterminate).toBe(false);
      expect(count()).toBe('3 of 3 zones selected');
      expect(root.querySelector('.import-pick__count')?.getAttribute('role')).toBe('status');

      click(fixture, checkbox(root, 'Checkout'));
      expect(all.checked).toBe(false);
      expect(all.indeterminate).toBe(true);
      expect(count()).toBe('2 of 3 zones selected');

      // The mixed box picks all, then none.
      click(fixture, all);
      expect(count()).toBe('3 of 3 zones selected');
      expect(checkbox(root, 'Checkout').checked).toBe(true);
      click(fixture, all);
      expect(count()).toBe('0 of 3 zones selected');
      expect(all.indeterminate).toBe(false);
      const startButton = buttonNamed(root, 'Start import');
      expect(startButton.disabled).toBe(true);
      expect(root.querySelector(`#${startButton.getAttribute('aria-describedby')}`)?.textContent).toContain(
        'Pick at least one zone',
      );
      click(fixture, checkbox(root, 'Product page'));
      expect(buttonNamed(root, 'Start import').disabled).toBe(false);
    });

    it('starts with only the ticked zones and content, and leaves media and tags out without tale groups', async () => {
      const { fixture, root } = await openForm();
      await chooseApp(fixture, root);
      click(fixture, checkbox(root, 'Checkout'));
      click(fixture, checkbox(root, 'Tags'));
      buttonNamed(root, 'Start import').click();
      const start = http.expectOne((r) => r.method === 'POST' && r.url === importsUrl);
      expect(start.request.body.selection).toEqual({
        selectionKey: 'v1.key.mac',
        zones: ['2001', '2002'],
        taleGroups: true,
        media: true,
        tags: false,
      });
      start.flush(
        { error: { code: 'import_selection_invalid', message: 'The selection has expired. Choose again.' } },
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('The selection has expired');

      // Without tale groups, media and tags are off and say why.
      click(fixture, checkbox(root, 'Tale groups and tales'));
      const media = checkbox(root, 'Media');
      expect(media.disabled).toBe(true);
      expect(media.checked).toBe(false);
      expect(checkbox(root, 'Tags').disabled).toBe(true);
      expect(root.querySelector(`#${media.getAttribute('aria-describedby')}`)?.textContent).toContain(
        'Media and tags need tale groups and tales',
      );
      buttonNamed(root, 'Start import').click();
      const zonesOnly = http.expectOne((r) => r.method === 'POST' && r.url === importsUrl);
      expect(zonesOnly.request.body.selection).toEqual({
        selectionKey: 'v1.key.mac',
        zones: ['2001', '2002'],
        taleGroups: false,
        media: false,
        tags: false,
      });
      zonesOnly.flush({ id: 'j1', status: 'queued' }, { status: 202, statusText: 'Accepted' });
      await settle(fixture);
      expect(TestBed.inject(Router).url).toBe('/projects/p1/import/j1');
      await answerPoll(fixture, job('queued', { sourceAppName: null }));
    });

    it('says when zones were not listed or counts not read, and forgets the preview for another token', async () => {
      const { fixture, root } = await openForm();
      await chooseApp(fixture, root, demoPreview({ zonesBeyond: 2, countsComplete: false }));
      expect(root.textContent).toContain('This app has 2 more zones than can be listed here');
      expect(root.textContent).toContain('Some counts were not read');
      type(root.querySelector<HTMLInputElement>('#import-token'), 'another-token');
      await settle(fixture);
      expect(root.querySelector('#import-zone-list')).toBeNull();
      expect(root.textContent).not.toContain('Start import');
    });

    it("shows the preview's error and no picker when the app cannot be read", async () => {
      const { fixture, root } = await openForm();
      type(root.querySelector<HTMLInputElement>('#import-token'), 'fake-storyly-token');
      buttonNamed(root, 'Find apps').click();
      http.expectOne(`${importsUrl}/storyly/apps`).flush([{ id: '1001', name: 'Demo shop' }]);
      await settle(fixture);
      buttonNamed(root, 'Choose what to import').click();
      const read = http.expectOne(`${importsUrl}/storyly/preview`);
      read.flush(
        { error: { code: 'storyly_unavailable', message: 'Storyly answered 500 when listing instances' } },
        { status: 502, statusText: 'Bad Gateway' },
      );
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Storyly answered 500 when listing instances');
      expect(root.querySelector('#import-zone-list')).toBeNull();
    });

    it('reports the zones and content not selected as skipped, not missing', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('done', {
          report: {
            ...report,
            zones: { source: 3, imported: 2, skipped: 1, notSelected: 1 },
            notSelected: { zones: [{ sourceId: '2003', name: 'Checkout' }], entities: ['tags'] },
          },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      expect(rows(root, 'Report')).toEqual([
        'Zones: 3 source / 2 imported / 1 skipped (1 not selected)',
        'Tale groups: 6 source / 6 imported',
        'Tales: 15 source / 14 imported / 1 skipped',
        'Tags: not selected, skipped',
      ]);
      expect(rows(root, 'Zones not selected')).toEqual(['Zone "Checkout": not selected, skipped']);
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('says how many more zones were not selected than the report names', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('done', {
          report: {
            ...report,
            zones: { source: 503, imported: 1, skipped: 502, notSelected: 502 },
            notSelected: {
              zones: Array.from({ length: 500 }, (_, i) => ({ sourceId: String(i), name: `Zone ${i}` })),
              entities: [],
            },
          },
          finishedAt: '2026-10-20T12:00:09.000Z',
        }),
      );
      const listed = rows(root, 'Zones not selected');
      expect(listed).toHaveLength(501);
      expect(listed[500]).toBe('and 2 more zones not selected');
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('shows tale groups and tales as not selected while a zones-only import runs', async () => {
      const { fixture, root } = await open('/projects/p1/import/j1', oneZone);
      await answerPoll(
        fixture,
        job('running', {
          progress: { ...progress([3, 2], [0, 0], [0, 0]), notSelected: ['taleGroups', 'media', 'tags'] },
        }),
      );
      expect(rows(root, 'Progress')).toEqual([
        'Zones: 3 read / 2 written',
        'Tale groups: not selected',
        'Tales: not selected',
      ]);
      await answerPoll(fixture, job('running', { progress: progress([3, 3], [1, 0], [0, 0]) }));
      expect(rows(root, 'Progress')[1]).toBe('Tale groups: 1 read / 0 written');
      await answerPoll(fixture, job('done', { report, finishedAt: '2026-10-20T12:00:09.000Z' }));
      await flushRefresh(fixture, { projects: [acme], zones: [zone] });
    });

    it('asks for a token before finding apps', async () => {
      const { fixture, root } = await openForm();
      buttonNamed(root, 'Find apps').click();
      await settle(fixture);
      expect(root.querySelector('[role=alert]')?.textContent).toContain('Paste a Storyly API token');
    });
  });
});
