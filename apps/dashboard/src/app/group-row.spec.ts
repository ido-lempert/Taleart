import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Tale } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from './dashboard.store';
import { GroupRow, type GroupRowData } from './group-row';
import { FIRST_FRAME } from './tale-thumbnail';

const COVER = '/api/v1/tale-groups/g1/cover';

const withMedia = (id: string): Tale =>
  ({
    id,
    projectId: 'p1',
    taleGroupId: 'g1',
    title: id,
    media: { kind: 'image', contentType: 'image/jpeg', url: `/api/v1/tales/${id}/media` },
  }) as unknown as Tale;

function group(cover: boolean, tales: Tale[] = []): GroupRowData {
  return {
    id: 'g1',
    name: 'Care tips',
    projectId: 'p1',
    status: 'live',
    storedStatus: 'live',
    startsAt: null,
    endsAt: null,
    cover: cover ? { kind: 'image', contentType: 'image/jpeg', animated: false, url: COVER } : null,
    visibility: { visible: true, reasons: [] },
    zoneIds: [],
    tags: [],
    tales,
  } as unknown as GroupRowData;
}

@Component({
  imports: [GroupRow],
  template: `<app-group-row [group]="group()" [items]="[]" [thumbnailTales]="thumbnailTales()" />`,
})
class RowHost {
  readonly group = signal<GroupRowData>(group(false));
  readonly thumbnailTales = signal<readonly Tale[] | null>(null);
}

describe('GroupRow cover (the picture of a group in a list)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<RowHost>;
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: DashboardStore,
          useValue: { coverSrc: (g: { cover: { url: string } | null }) => g.cover?.url ?? '', can: () => true, roleNeeded: () => '' },
        },
        { provide: FIRST_FRAME, useValue: vi.fn(async () => 'blob:frame') },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RowHost);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const cover = () => root.querySelector<HTMLElement>('.group-row__cover');

  it('shows the cover as a decorative, lazily loaded image', () => {
    fixture.componentInstance.group.set(group(true));
    fixture.detectChanges();
    const img = cover()?.querySelector('img');
    expect(img?.getAttribute('src')).toBe(COVER);
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('loading')).toBe('lazy');
  });

  it("falls back to the first tale's picture when the cover fails to load", async () => {
    fixture.componentInstance.group.set(group(true, [withMedia('t1')]));
    fixture.detectChanges();
    cover()?.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/tales/t1/document`).flush({}, { status: 500, statusText: 'Server Error' });
    await settle();

    expect(cover()?.querySelector('img')?.getAttribute('src')).toBe('/api/v1/tales/t1/media');
  });

  it('shows the initial when the cover fails and no tale has a picture to show', () => {
    fixture.componentInstance.group.set(group(true));
    fixture.detectChanges();
    cover()?.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(cover()?.querySelector('img')).toBeNull();
    expect(cover()?.textContent?.trim()).toBe('C');
  });

  it("shows the first tale's picture for a group with no cover, from the tales it is given", async () => {
    fixture.componentInstance.thumbnailTales.set([withMedia('t1')]);
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/tales/t1/document`).flush({}, { status: 500, statusText: 'Server Error' });
    await settle();

    expect(cover()?.querySelector('img')?.getAttribute('src')).toBe('/api/v1/tales/t1/media');
  });

  it('shows the initial as the placeholder of a group with no picture', () => {
    fixture.detectChanges();
    expect(cover()?.querySelector('img')).toBeNull();
    expect(cover()?.textContent?.trim()).toBe('C');
    expect(cover()?.classList.contains('ring--cover')).toBe(false);
  });
});

describe('GroupRow schedule pill (the word Scheduled only beside a date)', () => {
  let fixture: ComponentFixture<RowHost>;
  let root: HTMLElement;

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const scheduled = (window: { startsAt: string | null; endsAt: string | null }): GroupRowData =>
    ({ ...group(false), status: 'scheduled', storedStatus: 'live', ...window }) as unknown as GroupRowData;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: DashboardStore,
          useValue: { coverSrc: () => '', can: () => true, roleNeeded: () => '' },
        },
        { provide: FIRST_FRAME, useValue: vi.fn(async () => 'blob:frame') },
      ],
    });
    fixture = TestBed.createComponent(RowHost);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  const pills = () => Array.from(root.querySelectorAll<HTMLElement>('.status-badge[data-status="scheduled"]'));
  const meta = () => root.querySelector<HTMLElement>('.group-row__meta');
  const controls = () => root.querySelector<HTMLElement>('.group-row__status');

  it('shows Scheduled in the meta line, beside the date chip, when the window has a start ahead', () => {
    fixture.componentInstance.group.set(scheduled({ startsAt: inDays(3), endsAt: null }));
    fixture.detectChanges();

    expect(pills()).toHaveLength(1);
    expect(meta()?.contains(pills()[0])).toBe(true);
    expect(meta()?.querySelector('.window-chip')?.textContent).toContain('Starts');
    expect(controls()?.textContent).not.toContain('Scheduled');
  });

  it('shows Scheduled beside the chip for a window with both dates', () => {
    fixture.componentInstance.group.set(scheduled({ startsAt: inDays(3), endsAt: inDays(10) }));
    fixture.detectChanges();

    expect(pills()).toHaveLength(1);
    expect(meta()?.querySelector('.window-chip')).not.toBeNull();
    expect(controls()?.textContent).not.toContain('Scheduled');
  });

  it('shows no Scheduled word for a group with no window', () => {
    fixture.componentInstance.group.set(group(false));
    fixture.detectChanges();

    expect(pills()).toHaveLength(0);
    expect(root.querySelector('.window-chip')).toBeNull();
    expect(root.textContent).not.toContain('Scheduled');
  });

  it('keeps the switch in the same slot whether or not the row has a schedule', () => {
    fixture.componentInstance.group.set(group(false));
    fixture.detectChanges();
    const plainSwitch = root.querySelector('.group-row__switch-slot');
    expect(plainSwitch?.querySelector('app-show-switch')).not.toBeNull();

    fixture.componentInstance.group.set(scheduled({ startsAt: inDays(3), endsAt: null }));
    fixture.detectChanges();
    const scheduledSwitch = root.querySelector('.group-row__switch-slot');
    expect(scheduledSwitch?.querySelector('app-show-switch')).not.toBeNull();
    expect(scheduledSwitch?.textContent).not.toContain('Scheduled');
  });
});
