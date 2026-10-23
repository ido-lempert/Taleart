import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE, DashboardStore, taleTitleFromFile } from './dashboard.store';

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
    // Only the projects a page asked for (epic UX rework R14).
    for (const req of http.match((r) => /\/projects\/[^/]+\/tale-groups$/.test(r.url))) req.flush([]);
    await tick();
  }

  it('answers a tale deletion request only while a view shows its group, and drops it when the last one closes (story 8.20)', () => {
    expect(store.requestTaleDeletion('t1', 'g1')).toBe(false);
    expect(store.taleDeletionRequest()).toBeNull();
    store.groupViewOpened('g1');
    store.groupViewOpened('g1');
    expect(store.requestTaleDeletion('t1', 'g1')).toBe(true);
    expect(store.taleDeletionRequest()).toEqual({ taleId: 't1', taleGroupId: 'g1' });
    // Another group's view closing leaves it; one of the two views of g1 closing leaves it too.
    store.groupViewOpened('g2');
    store.groupViewClosed('g2');
    store.groupViewClosed('g1');
    expect(store.taleDeletionRequest()).not.toBeNull();
    store.groupViewClosed('g1');
    expect(store.taleDeletionRequest()).toBeNull();
    expect(store.groupViewOpen('g1')).toBe(false);
  });

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
    // No page asked for a project's tale group list, so none is read (epic UX rework R14).
    http.expectNone(`${API_BASE}/projects/p2/tale-groups`);
    await Promise.all([older, newer]);
    expect(olderDone && newerDone).toBe(true);
    expect(store.projects().map((p) => p.name)).toEqual(['New']);
  });

  describe("projects' tale group lists (epic UX rework R14)", () => {
    const vis = (visible: boolean) => ({ visible, reasons: visible ? [] : [{ code: 'group-off', subject: 'group' }] });
    const tale = (id: string, storedStatus: string) => ({ id, taleGroupId: 'g1', projectId: 'p1', title: id, storedStatus, status: storedStatus });
    const listed = {
      id: 'g1', projectId: 'p1', name: 'Summer', status: 'paused', storedStatus: 'paused', startsAt: null, endsAt: null,
      cover: null, tags: [], zoneIds: ['z1'], visibility: vis(false), taleCount: 2, shownTaleCount: 1,
    };

    // Answers one refresh: project p1 with zone z1 listing g1 with `tales`, and the p1 list when asked.
    async function answerWith(tales: unknown[]): Promise<void> {
      http.expectOne(`${API_BASE}/projects`).flush([{ id: 'p1', name: 'Acme' }]);
      await tick();
      http.expectOne(`${API_BASE}/zones`).flush([{ id: 'z1', projectId: 'p1', name: 'Home', slug: 'home', frame: null }]);
      await tick();
      http.expectOne(`${API_BASE}/frame-types`).flush([]);
      await tick();
      http.expectOne(`${API_BASE}/zones/z1/tale-groups`).flush([{ ...listed, position: 0, tales }]);
      await tick();
      http.expectOne(`${API_BASE}/projects/p1/tags`).flush([]);
      await tick();
      for (const req of http.match(`${API_BASE}/projects/p1/tale-groups`)) req.flush([listed]);
      await tick();
    }

    it('reads a list only once a page asks for it, then keeps it fresh with every refresh', async () => {
      let done = store.refresh();
      await answerWith([tale('t1', 'live'), tale('t2', 'paused')]);
      await done;
      expect(store.projectTaleGroupsOf('p1')).toEqual([]);

      store.ensureProjectTaleGroups('p1');
      store.ensureProjectTaleGroups('p1');
      http.expectOne(`${API_BASE}/projects/p1/tale-groups`).flush([listed]);
      await tick();
      expect(store.projectTaleGroupsOf('p1').map((g) => g.id)).toEqual(['g1']);
      store.ensureProjectTaleGroups('p1');
      http.expectNone(`${API_BASE}/projects/p1/tale-groups`);

      done = store.refresh();
      await answerWith([tale('t1', 'live'), tale('t2', 'paused')]);
      await done;
      // One lookup for a group's own fields: the project's list first.
      expect(store.groupSummary('g1')).toBe(store.projectTaleGroupsOf('p1')[0]);
    });

    it("patches a group's status, visibility and counts, and a tale's Shown count, from the API's answers", async () => {
      store.ensureProjectTaleGroups('p1');
      http.expectOne(`${API_BASE}/projects/p1/tale-groups`).flush([listed]);
      const done = store.refresh();
      await answerWith([tale('t1', 'live'), tale('t2', 'paused')]);
      await done;

      const changing = store.changeTaleGroupStatus('g1', 'live');
      const saved = { ...listed, status: 'live', storedStatus: 'live', visibility: vis(true), tales: [tale('t1', 'live'), tale('t2', 'live')] };
      http.expectOne(`${API_BASE}/tale-groups/g1/status`).flush(saved);
      await tick();
      // Before the refresh that follows answers: from the PUT's answer.
      expect(store.projectTaleGroupsOf('p1')[0]).toMatchObject({ storedStatus: 'live', visibility: vis(true), taleCount: 2, shownTaleCount: 2 });
      await answerWith([tale('t1', 'live'), tale('t2', 'live')]);
      expect((await changing).group?.id).toBe('g1');

      const hiding = store.setTaleStatus('t2', 'paused');
      http.expectOne(`${API_BASE}/tales/t2/status`).flush({ ...tale('t2', 'paused'), visibility: vis(false) });
      await tick();
      expect(store.projectTaleGroupsOf('p1')[0].shownTaleCount).toBe(1);
      await answerWith([tale('t1', 'live'), tale('t2', 'paused')]);
      expect((await hiding).message).toBe('');
    });
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

describe('taleTitleFromFile (story 8.13)', () => {
  it('reads a tale title from a media file name', () => {
    expect(taleTitleFromFile('beach_day.png')).toBe('beach day');
    expect(taleTitleFromFile('summer--sale  promo.final.mp4')).toBe('summer sale promo.final');
    expect(taleTitleFromFile('.png')).toBe('Tale');
    expect(taleTitleFromFile('___.gif')).toBe('Tale');
    expect(taleTitleFromFile('noextension')).toBe('noextension');
    expect([...taleTitleFromFile(`${'é'.repeat(150)}.png`)]).toHaveLength(100);
  });
});
