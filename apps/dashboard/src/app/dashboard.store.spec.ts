import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE, DashboardStore } from './dashboard.store';

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('DashboardStore', () => {
  let http: HttpTestingController;
  let store: DashboardStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DashboardStore);
  });

  afterEach(() => http.verify());

  // Answers one refresh's reads with no zones, and `projects`.
  async function answer(projects: { id: string; name: string }[], which: 0 | 1 = 0): Promise<void> {
    http.match(`${API_BASE}/projects`)[which]?.flush(projects);
    await tick();
    http.expectOne(`${API_BASE}/zones`).flush([]);
    await tick();
    http.expectOne(`${API_BASE}/frame-types`).flush([]);
    await tick();
    for (const p of projects) http.expectOne(`${API_BASE}/projects/${p.id}/tags`).flush([]);
    await tick();
    for (const p of projects) http.expectOne(`${API_BASE}/projects/${p.id}/tale-groups`).flush([]);
    await tick();
  }

  it('resolves a superseded refresh only once the newest one is done, with its answers (story 8.4)', async () => {
    let olderDone = false;
    const older = store.refresh().then(() => (olderDone = true));
    let newerDone = false;
    const newer = store.refresh().then(() => (newerDone = true));
    const [first, second] = http.match(`${API_BASE}/projects`);
    first.flush([{ id: 'p1', name: 'Old' }]);
    await tick();
    // The older one's answers are dropped; it waits for the newer one.
    await tick();
    expect(olderDone).toBe(false);
    second.flush([{ id: 'p2', name: 'New' }]);
    await tick();
    http.expectOne(`${API_BASE}/zones`).flush([]);
    await tick();
    http.expectOne(`${API_BASE}/frame-types`).flush([]);
    await tick();
    http.expectOne(`${API_BASE}/projects/p2/tags`).flush([]);
    await tick();
    http.expectOne(`${API_BASE}/projects/p2/tale-groups`).flush([]);
    await Promise.all([older, newer]);
    expect(olderDone && newerDone).toBe(true);
    expect(store.projects().map((p) => p.name)).toEqual(['New']);
  });

  it('resolves a refresh at once when none started after it', async () => {
    const done = store.refresh();
    await answer([]);
    await done;
    expect(store.loaded()).toBe(true);
  });

  it('reads one tale, and answers null without the API-down banner when it cannot', async () => {
    const read = store.readTale('t1');
    http.expectOne(`${API_BASE}/tales/t1`).flush({ id: 't1', visibility: { visible: true, reasons: [] } });
    expect((await read)?.id).toBe('t1');
    const failed = store.readTale('t1');
    http.expectOne(`${API_BASE}/tales/t1`).flush(null, { status: 500, statusText: 'Error' });
    expect(await failed).toBeNull();
    expect(store.apiDown()).toBe(false);
  });
});
