import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectTaleGroup, Zone, ZoneTaleGroup } from '@taleart/contract/core';
import type { TaleDocument } from '@taleart/contract/tale-document';
import { DEFAULT_THEME } from '@taleart/contract/theme';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { TaleGroupsPage } from './tale-groups';
import { ZonesPage } from './zones';
import { settle } from './tale-studio.testing';

// The Preview of a tale group (Tale groups page) and of a zone (Zones page): the Web SDK's rendering, as a full view.

const flag = (visible: boolean) => ({ visible, reasons: [] });
const frame = { id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} };
const DOC = {
  version: 1,
  canvas: { background: { type: 'color', color: '#123456' } },
  durationMs: 7000,
  elements: [
    {
      id: 'txt',
      type: 'text',
      box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
      a11y: {},
      hidden: false,
      locked: false,
      props: { text: 'Hello' },
    },
  ],
} as unknown as TaleDocument;

const tale = (id: string, title: string) => ({ id, title, media: null, position: 0, visibility: flag(true) });
const zoneGroup = (id: string, name: string, tales: unknown[]) =>
  ({
    id,
    name,
    projectId: 'p1',
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    cover: null,
    tags: [],
    tales,
    visibility: flag(true),
  }) as unknown as ZoneTaleGroup;
const projectGroup = (id: string, name: string, zoneIds: string[]) =>
  ({
    id,
    name,
    projectId: 'p1',
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    cover: null,
    zoneIds,
    tales: [],
    tags: [],
    tagMatch: 'any',
    userLists: [],
    audience: null,
    visibility: flag(true),
    position: 0,
  }) as unknown as ProjectTaleGroup;

const zone = (id: string, name: string, withDisplay: boolean) =>
  ({
    id,
    name,
    slug: id,
    projectId: 'p1',
    frame: withDisplay ? { ...frame, zoneId: id } : null,
    visibility: flag(true),
  }) as unknown as Zone;

/** Answers the reads a preview makes: the theme, the fonts and each tale's published document. */
function answerPreviewReads(http: HttpTestingController): void {
  for (const read of http.match((r) => r.method === 'GET')) {
    const url = read.request.url;
    if (url.endsWith('/theme')) read.flush({ projectId: 'p1', theme: {}, resolved: DEFAULT_THEME });
    else if (url.endsWith('/fonts')) read.flush([]);
    else if (/\/tales\/[^/]+\/document$/.test(url))
      read.flush({ document: null, revision: 0, published: { document: DOC, revision: 1 } });
  }
}

const escape = (element: Element) =>
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('Tale groups page: Preview of a group', () => {
  let fixture: ComponentFixture<TaleGroupsPage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  const dialog = () => root.querySelector<HTMLElement>('[role=dialog]');
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#preview-${id}`) as HTMLButtonElement;

  async function openPreview(id: string): Promise<void> {
    button(id).click();
    fixture.detectChanges();
    answerPreviewReads(http);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleGroupsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'admin' }]);
    store.selectProject('p1');
    store.loaded.set(true);
    store.zones.set([zone('z1', 'Home', true)]);
    store.taleGroups.set({
      z1: [zoneGroup('g1', 'Summer', [tale('t1', 'Beach')]), zoneGroup('g2', 'Winter', [tale('t3', 'Snow')])],
    });
    store.projectTaleGroups.set({
      p1: [projectGroup('g1', 'Summer', ['z1']), projectGroup('g2', 'Winter', ['z1']), projectGroup('g3', 'Loose', [])],
    });
    fixture = TestBed.createComponent(TaleGroupsPage);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    globalThis.document.body.replaceChildren();
  });

  it('opens a dialog with the group preview, from a button on its row', async () => {
    expect(button('group-g1').getAttribute('aria-label')).toBe('Preview group Summer');
    await openPreview('group-g1');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.getAttribute('aria-label')).toBe('Preview of Summer');
    expect(root.querySelector('#zone-preview-pane')).not.toBeNull();
    const shadow = root.querySelector<HTMLElement>('#preview-host')?.shadowRoot;
    expect(shadow?.querySelector('.name')?.textContent).toBe('Summer');
  });

  it('closes on Escape and puts focus back on the Preview button', async () => {
    await openPreview('group-g1');
    escape(dialog() as HTMLElement);
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button('group-g1'));
  });

  it('closes on Close and puts focus back on the Preview button', async () => {
    await openPreview('group-g1');
    root.querySelector<HTMLButtonElement>('#zone-preview-close')?.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button('group-g1'));
  });

  it('shows one preview at a time: another group replaces the open one', async () => {
    await openPreview('group-g1');
    await openPreview('group-g2');
    expect(root.querySelectorAll('[role=dialog]')).toHaveLength(1);
    expect(dialog()?.getAttribute('aria-label')).toBe('Preview of Winter');
  });

  it('does not preview a group that no zone with a display shows', async () => {
    expect(button('group-g3').getAttribute('aria-disabled')).toBe('true');
    button('group-g3').click();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });
});

describe('Zones page: Preview of a zone', () => {
  let fixture: ComponentFixture<ZonesPage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  const dialog = () => root.querySelector<HTMLElement>('[role=dialog]');
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`#preview-${id}`) as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZonesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'admin' }]);
    store.selectProject('p1');
    store.loaded.set(true);
    store.zones.set([zone('z1', 'Home', true), zone('z2', 'Footer', false)]);
    store.taleGroups.set({ z1: [zoneGroup('g1', 'Summer', [tale('t1', 'Beach')])], z2: [] });
    fixture = TestBed.createComponent(ZonesPage);
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    globalThis.document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    globalThis.document.body.replaceChildren();
  });

  it('opens a dialog with the zone, with its groups, and closes on Close back to its button', async () => {
    expect(button('zone-z1').getAttribute('aria-label')).toBe('Preview zone Home');
    button('zone-z1').click();
    fixture.detectChanges();
    answerPreviewReads(http);
    await settle(fixture);
    expect(dialog()?.getAttribute('aria-label')).toBe('Preview of Home');
    expect(root.querySelector('#zone-preview-pane')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('#zone-preview-close')?.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button('zone-z1'));
  });

  it('does not preview a zone with no display', async () => {
    expect(button('zone-z2').getAttribute('aria-disabled')).toBe('true');
    button('zone-z2').click();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });
});
