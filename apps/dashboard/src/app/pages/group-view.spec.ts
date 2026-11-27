import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import type { Tale, TaleGroup } from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
import { GroupView } from './group-view';

const tale = (id: string, title: string, storedStatus: Tale['storedStatus'] = 'live') =>
  ({
    id,
    title,
    taleGroupId: 'g1',
    projectId: 'p1',
    storedStatus,
    status: storedStatus,
    visibility: { shown: storedStatus === 'live', reasons: [] },
    position: 0,
  }) as unknown as Tale;

const group = (tales: Tale[]) =>
  ({
    id: 'g1',
    name: 'Summer',
    projectId: 'p1',
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    cover: null,
    zoneIds: [],
    tales,
    tags: [],
    tagMatch: 'any',
    userLists: [],
    audience: null,
    visibility: { shown: false, reasons: [] },
    position: 0,
  }) as unknown as TaleGroup;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('GroupView bulk actions on its tales', () => {
  let fixture: ComponentFixture<GroupView>;
  let root: HTMLElement;
  let store: DashboardStore;
  let router: Router;

  const bar = () => root.querySelector<HTMLElement>('[role=region][aria-label="Actions on the selection"]');
  const cardBoxes = () => [...root.querySelectorAll<HTMLInputElement>('.tale-card__select input')];
  const selectAll = () => (root.querySelector('input[aria-label="Select all tales"]') as HTMLInputElement).click();
  const drawer = () => document.querySelector<HTMLElement>('[role=alertdialog]');

  async function open(role: 'viewer' | 'editor' | 'publisher', tales: Tale[]): Promise<void> {
    store.projects.set([{ id: 'p1', name: 'Acme', role }]);
    fixture = TestBed.createComponent(GroupView);
    fixture.componentRef.setInput('group', group(tales));
    fixture.componentRef.setInput('zoneId', '');
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupView],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    store = TestBed.inject(DashboardStore);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('dims a tale that is not Shown, and draws no Shown or Hidden text over any card', async () => {
    await open('editor', [tale('t1', 'One', 'live'), tale('t2', 'Two', 'draft'), tale('t3', 'Three', 'archived')]);
    const cards = [...root.querySelectorAll<HTMLElement>('.tale-card')];
    expect(cards.map((card) => card.classList.contains('tale-card--dimmed'))).toEqual([false, true, true]);
    // No visible label over the picture: the status is visually hidden, and the open button describes it.
    expect(root.querySelector('.tale-card__switch')).toBeNull();
    const states = cards.map((card) => card.querySelector('.visually-hidden')?.textContent?.trim());
    expect(states).toEqual(['Shown', 'Hidden', 'Archived']);
    const opens = cards.map((card) => card.querySelector('.tale-card__open'));
    opens.forEach((open, i) => {
      const id = cards[i].querySelector('.visually-hidden')?.id;
      expect(id).toBeTruthy();
      expect(open?.getAttribute('aria-describedby')).toBe(id);
    });
    // An archived tale has no visible badge over its picture either; its dim and its text say it.
    expect(root.querySelector('.tale-card__status')).toBeNull();
  });

  it('gives each card a checkbox to an editor, and none to a viewer', async () => {
    await open('editor', [tale('t1', 'One'), tale('t2', 'Two')]);
    expect(cardBoxes().map((box) => box.getAttribute('aria-label'))).toEqual(['Select One', 'Select Two']);
    fixture.destroy();
    document.body.replaceChildren();
    await open('viewer', [tale('t1', 'One')]);
    expect(root.querySelector('.tale-card__select')).toBeNull();
    expect(root.querySelector('input[aria-label="Select all tales"]')).toBeNull();
  });

  it('shows a bar with the count, selects all and clears the selection', async () => {
    await open('editor', [tale('t1', 'One'), tale('t2', 'Two')]);
    expect(bar()).toBeNull();
    selectAll();
    await settle(fixture);
    expect(bar()?.textContent).toContain('2 selected');
    (bar()?.querySelector('.bulk-bar__clear') as HTMLButtonElement).click();
    await settle(fixture);
    expect(bar()).toBeNull();
    expect(cardBoxes().some((box) => box.checked)).toBe(false);
  });

  it('a card checkbox picks its tale without opening it, and sits outside the drag handle', async () => {
    await open('editor', [tale('t1', 'One'), tale('t2', 'Two')]);
    cardBoxes()[0].click();
    await settle(fixture);
    expect(cardBoxes()[0].checked).toBe(true);
    expect(bar()?.textContent).toContain('1 selected');
    expect(router.navigate).not.toHaveBeenCalled();
    expect(root.querySelector('.drag-handle input')).toBeNull();
    expect(root.querySelector('.tale-card__open')?.contains(cardBoxes()[0])).toBe(false);
  });

  it('deletes each picked tale through the store, keeps a failed one selected and names it', async () => {
    const deleteTale = vi.spyOn(store, 'deleteTale').mockImplementation(async (id) => (id === 't2' ? 'Still in use.' : ''));
    await open('editor', [tale('t1', 'One'), tale('t2', 'Two'), tale('t3', 'Three')]);
    selectAll();
    await settle(fixture);
    (root.querySelector('#group-view-bulk-delete') as HTMLButtonElement).click();
    await settle(fixture);
    expect(drawer()?.textContent).toContain('Delete 3 tales?');
    (document.querySelector('#group-view-bulk-submit') as HTMLButtonElement).click();
    await settle(fixture);
    await settle(fixture);
    expect(deleteTale.mock.calls.map((call) => call[0]).sort()).toEqual(['t1', 't2', 't3']);
    expect(root.querySelector('#group-view-bulk-failed')?.textContent).toContain('1 could not be changed: Two');
    expect(bar()?.textContent).toContain('1 selected');
  });

  it('archives the picked tales that offer Archive, and restores the archived ones', async () => {
    const setTaleStatus = vi.spyOn(store, 'setTaleStatus').mockResolvedValue({ tale: null, message: '', warning: '' });
    await open('publisher', [tale('t1', 'One'), tale('t2', 'Two', 'archived')]);
    selectAll();
    await settle(fixture);
    expect(root.querySelector('#group-view-bulk-archive')).not.toBeNull();
    expect(root.querySelector('#group-view-bulk-restore')).not.toBeNull();
    (root.querySelector('#group-view-bulk-archive') as HTMLButtonElement).click();
    await settle(fixture);
    await settle(fixture);
    expect(setTaleStatus).toHaveBeenCalledTimes(1);
    expect(setTaleStatus).toHaveBeenCalledWith('t1', 'archived');
    // The ones that succeeded leave the selection; picking the rest again offers Restore.
    expect(bar()).toBeNull();
    selectAll();
    await settle(fixture);
    (root.querySelector('#group-view-bulk-restore') as HTMLButtonElement).click();
    await settle(fixture);
    await settle(fixture);
    expect(setTaleStatus).toHaveBeenLastCalledWith('t2', 'paused');
  });

  it('offers no Archive or Restore to a role that cannot publish', async () => {
    await open('editor', [tale('t1', 'One')]);
    selectAll();
    await settle(fixture);
    expect(root.querySelector('#group-view-bulk-archive')).toBeNull();
    expect(root.querySelector('#group-view-bulk-delete')).not.toBeNull();
  });
});
