import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectTaleGroup, Tale, Zone } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { inChosenZones, TaleGroupsPage } from './tale-groups';

const group = (id: string, name: string, zoneIds: string[]) =>
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
    visibility: { shown: false, reasons: [] },
    position: 0,
  }) as unknown as ProjectTaleGroup;

const zone = (id: string, name: string) => ({ id, name, projectId: 'p1' }) as unknown as Zone;

describe('inChosenZones (zone filter)', () => {
  it('shows every group when no zone is chosen, the ones in no zone too', () => {
    expect(inChosenZones({ zoneIds: [] }, [])).toBe(true);
    expect(inChosenZones({ zoneIds: ['z1'] }, [])).toBe(true);
  });

  it('shows a group in any chosen zone, and not one in other zones only', () => {
    expect(inChosenZones({ zoneIds: ['z1', 'z3'] }, ['z3', 'z2'])).toBe(true);
    expect(inChosenZones({ zoneIds: ['z1'] }, ['z2', 'z3'])).toBe(false);
    expect(inChosenZones({ zoneIds: [] }, ['z2'])).toBe(false);
  });
});

describe('TaleGroupsPage zone filter', () => {
  let fixture: ComponentFixture<TaleGroupsPage>;
  let root: HTMLElement;

  const names = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.group-row__open')].map((b) => b.textContent?.trim());
  const toggle = () => root.querySelector<HTMLButtonElement>('#zone-filter-toggle') as HTMLButtonElement;
  const zoneBox = (name: string) =>
    [...root.querySelectorAll<HTMLLabelElement>('#zone-filter-list .checkbox')]
      .find((label) => label.textContent?.trim() === name)
      ?.querySelector('input') as HTMLInputElement;
  const choose = (name: string, checked: boolean) => {
    const input = zoneBox(name);
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleGroupsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'admin' }]);
    store.selectProject('p1');
    store.zones.set([zone('z1', 'Alpha'), zone('z2', 'Beta'), zone('z3', 'Gamma'), zone('z4', 'Delta')]);
    store.projectTaleGroups.set({
      p1: [
        group('g1', 'Only alpha', ['z1']),
        group('g2', 'Only beta', ['z2']),
        group('g3', 'Only gamma', ['z3']),
        group('g4', 'In no zone', []),
        group('g5', 'Alpha and beta', ['z1', 'z2']),
      ],
    });
    store.loaded.set(true);

    fixture = TestBed.createComponent(TaleGroupsPage);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows all groups while no zone is chosen', () => {
    expect(toggle().textContent?.trim()).toBe('Zones: all');
    expect(names()).toEqual(['Only alpha', 'Only beta', 'Only gamma', 'In no zone', 'Alpha and beta']);
  });

  it('lists the groups of two chosen zones and not the others', () => {
    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    choose('Alpha', true);
    choose('Beta', true);
    expect(toggle().textContent?.trim()).toBe('Zones: 2');
    expect(root.querySelector('.zone-filter__active')?.textContent).toContain('Alpha, Beta');
    expect(names()).toEqual(['Only alpha', 'Only beta', 'Alpha and beta']);
  });

  it('shows all groups again once the zones are cleared', () => {
    toggle().click();
    fixture.detectChanges();
    choose('Gamma', true);
    expect(names()).toEqual(['Only gamma']);
    root.querySelector<HTMLButtonElement>('#zone-filter-clear')?.click();
    fixture.detectChanges();
    expect(toggle().textContent?.trim()).toBe('Zones: all');
    expect(names()).toEqual(['Only alpha', 'Only beta', 'Only gamma', 'In no zone', 'Alpha and beta']);
  });

  it('says so when the chosen zones hold no group', () => {
    toggle().click();
    fixture.detectChanges();
    choose('Delta', true);
    expect(names()).toEqual([]);
    expect(root.querySelector('.empty__title')?.textContent).toContain('No tale groups match this filter');
    expect(root.querySelector('.empty__text')?.textContent).toContain('No tale group is in the chosen zones.');
  });
});

describe('TaleGroupsPage pictures (each row shows its picture or the placeholder)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TaleGroupsPage>;
  let root: HTMLElement;
  const COVER = '/api/v1/tale-groups/g1/cover';

  const withMedia = (id: string, taleGroupId: string): Tale =>
    ({
      id,
      projectId: 'p1',
      taleGroupId,
      title: id,
      position: 0,
      media: { kind: 'image', contentType: 'image/jpeg', url: `/api/v1/tales/${id}/media` },
    }) as unknown as Tale;

  const row = (name: string) =>
    [...root.querySelectorAll<HTMLElement>('.group-item')].find(
      (item) => item.querySelector('.group-row__open')?.textContent?.trim() === name,
    ) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleGroupsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'admin' }]);
    store.selectProject('p1');
    store.projectTaleGroups.set({
      p1: [
        { ...group('g1', 'Care tips', []), cover: { kind: 'image', contentType: 'image/jpeg', animated: false, url: COVER } },
        group('g2', 'Living room', []),
        group('g3', 'Gamma', []),
      ],
    });
    store.loaded.set(true);
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(TaleGroupsPage);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  // Lets the reads and the renders they cause run: a tick, then the page's change detection.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
  }

  // Answers the group reads the page makes for its rows: g2 has a tale with a picture, g1 and g3 none.
  // The tale's document is read when its thumbnail renders, and fails here, so its own media shows.
  async function answerGroupReads(): Promise<void> {
    http.expectOne(`${API_BASE}/tale-groups/g1`).flush({ id: 'g1', tales: [] });
    http.expectOne(`${API_BASE}/tale-groups/g2`).flush({ id: 'g2', tales: [withMedia('t9', 'g2')] });
    http.expectOne(`${API_BASE}/tale-groups/g3`).flush({ id: 'g3', tales: [] });
    await settle();
    http.match(`${API_BASE}/tales/t9/document`).forEach((request) => request.flush({}, { status: 500, statusText: 'Server Error' }));
    await settle();
  }

  it("shows a group's cover as its picture", async () => {
    await answerGroupReads();
    const img = row('Care tips').querySelector<HTMLImageElement>('.group-row__cover img');
    expect(img?.getAttribute('src')).toBe(COVER);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it("shows the first tale's picture for a group with no cover", async () => {
    await answerGroupReads();
    const img = row('Living room').querySelector<HTMLImageElement>('.group-row__cover img');
    expect(img?.getAttribute('src')).toBe('/api/v1/tales/t9/media');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('shows the initial as the placeholder of a group with no picture at all', async () => {
    await answerGroupReads();
    const cover = row('Gamma').querySelector<HTMLElement>('.group-row__cover');
    expect(cover?.querySelector('img')).toBeNull();
    expect(cover?.textContent?.trim()).toBe('G');
  });

  it("falls back to the first tale's picture when a group's cover fails to load", async () => {
    http.expectOne(`${API_BASE}/tale-groups/g1`).flush({ id: 'g1', tales: [withMedia('t8', 'g1')] });
    http.expectOne(`${API_BASE}/tale-groups/g2`).flush({ id: 'g2', tales: [] });
    http.expectOne(`${API_BASE}/tale-groups/g3`).flush({ id: 'g3', tales: [] });
    await settle();

    row('Care tips').querySelector('.group-row__cover img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/tales/t8/document`).flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(row('Care tips').querySelector<HTMLImageElement>('.group-row__cover img')?.getAttribute('src')).toBe(
      '/api/v1/tales/t8/media',
    );
  });
});

describe('TaleGroupsPage bulk archive (selection, bar, confirm, failures)', () => {
  let http: HttpTestingController;
  let store: DashboardStore;
  let fixture: ComponentFixture<TaleGroupsPage>;
  let root: HTMLElement;

  const box = (name: string) => root.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`);
  const pick = (name: string, checked = true) => {
    const input = box(name) as HTMLInputElement;
    input.checked = checked;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const bar = () => root.querySelector<HTMLElement>('.bulk-bar');
  const rowNames = () =>
    [...root.querySelectorAll<HTMLButtonElement>('.group-row__open')].map((b) => b.textContent?.trim());
  const dialogSubmit = () => document.querySelector<HTMLButtonElement>('#bulk-archive-submit');
  // Lets the archive requests settle and the page render their answers.
  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
  const archived = (id: string) =>
    ({
      ...group(id, id, []),
      status: 'archived',
      storedStatus: 'archived',
      tales: [],
    }) as unknown as ProjectTaleGroup;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaleGroupsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    store = TestBed.inject(DashboardStore);
    vi.spyOn(store, 'refresh').mockResolvedValue();
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'admin' }]);
    store.selectProject('p1');
    store.projectTaleGroups.set({
      p1: [
        group('g1', 'Only alpha', ['z1']),
        group('g2', 'Only beta', ['z2']),
        group('g3', 'Only gamma', ['z3']),
        group('g4', 'In no zone', []),
        group('g5', 'Alpha and beta', ['z1', 'z2']),
      ],
    });
    store.loaded.set(true);
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(TaleGroupsPage);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('shows a checkbox per row and the select-all, and no bar until a row is picked', () => {
    expect(box('Only alpha')).not.toBeNull();
    expect(box('In no zone')).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Select all tale groups"]')).not.toBeNull();
    expect(bar()).toBeNull();
    pick('Only alpha');
    pick('Only beta');
    expect(bar()?.querySelector('.bulk-bar__count')?.textContent?.trim()).toBe('2 selected');
    expect(root.querySelector('app-bulk-bar [aria-live=polite]')?.textContent?.trim()).toBe('2 selected');
  });

  it('select all picks every row, shows it indeterminate after one, and Clear selection drops it', () => {
    const all = root.querySelector<HTMLInputElement>('input[aria-label="Select all tale groups"]') as HTMLInputElement;
    all.checked = true;
    all.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(bar()?.querySelector('.bulk-bar__count')?.textContent?.trim()).toBe('5 selected');
    expect(box('Only gamma')?.checked).toBe(true);

    root.querySelector<HTMLButtonElement>('.bulk-bar__clear')?.click();
    fixture.detectChanges();
    expect(bar()).toBeNull();
    expect(box('Only gamma')?.checked).toBe(false);

    pick('Only gamma');
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('Escape in the list clears the selection', () => {
    pick('Only alpha');
    box('Only alpha')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(bar()).toBeNull();
  });

  it('a checkbox does not open its group', () => {
    pick('Only alpha');
    expect(root.querySelector('app-group-view')).toBeNull();
    expect(store.drawer()).toBeNull();
  });

  it('archives three groups with one status request each, then the list shows the rest', async () => {
    pick('Only alpha');
    pick('Only beta');
    pick('Only gamma');
    root.querySelector<HTMLButtonElement>('#bulk-archive')?.click();
    fixture.detectChanges();
    expect(dialogSubmit()?.textContent?.trim()).toBe('Archive 3 groups');
    expect(document.body.textContent).toContain('Only alpha');

    dialogSubmit()?.click();
    fixture.detectChanges();
    for (const id of ['g1', 'g2', 'g3']) {
      const request = http.expectOne(`${API_BASE}/tale-groups/${id}/status`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ status: 'archived' });
      request.flush(archived(id));
    }
    await settle();

    expect(store.refresh).toHaveBeenCalledTimes(1);
    expect(rowNames()).toEqual(['In no zone', 'Alpha and beta']);
    expect(bar()).toBeNull();
    expect(document.querySelector('#bulk-failed')).toBeNull();
    expect(document.querySelector('#bulk-archive-submit')).toBeNull();
  });

  it('keeps a group whose archive failed selected and names it', async () => {
    pick('Only alpha');
    pick('Only beta');
    pick('Only gamma');
    root.querySelector<HTMLButtonElement>('#bulk-archive')?.click();
    fixture.detectChanges();
    dialogSubmit()?.click();
    fixture.detectChanges();

    http.expectOne(`${API_BASE}/tale-groups/g1/status`).flush(archived('g1'));
    http.expectOne(`${API_BASE}/tale-groups/g2/status`).flush({}, { status: 500, statusText: 'Server Error' });
    http.expectOne(`${API_BASE}/tale-groups/g3/status`).flush(archived('g3'));
    await settle();

    const alert = root.querySelector<HTMLElement>('#bulk-failed');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('1 could not be archived: Only beta');
    expect(rowNames()).toEqual(['Only beta', 'In no zone', 'Alpha and beta']);
    expect(box('Only beta')?.checked).toBe(true);
    expect(bar()?.querySelector('.bulk-bar__count')?.textContent?.trim()).toBe('1 selected');
  });

  it('shows no checkboxes or bar to a role that cannot archive', () => {
    store.projects.set([{ id: 'p1', name: 'Acme', role: 'viewer' }]);
    fixture.detectChanges();
    expect(rowNames().length).toBe(5);
    expect(root.querySelector('input[type=checkbox]')).toBeNull();
    expect(root.querySelector('input[aria-label="Select all tale groups"]')).toBeNull();
  });
});
