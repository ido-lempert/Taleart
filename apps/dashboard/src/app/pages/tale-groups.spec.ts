import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { ProjectTaleGroup, Zone } from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
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
