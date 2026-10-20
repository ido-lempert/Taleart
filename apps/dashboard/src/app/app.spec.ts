import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App, API_BASE } from './app';

const frameTypes = [
  { key: 'bar', label: 'Bar' },
  { key: 'banner', label: 'Banner' },
];
const zone = { id: 'z1', name: 'Home bar', projectId: 'p1' };

// Waits for Angular and then one macrotask, so refresh() reaches its next
// request (or its end) after chained awaits that whenStable() does not track.
async function settle(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
}

function buttonNamed(root: HTMLElement, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  if (!button) throw new Error(`No ${name} button`);
  return button;
}

function addFrameButton(root: HTMLElement): HTMLButtonElement {
  return buttonNamed(root, 'Add frame');
}

function type(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error('No input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the projects and zones the API returns', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    http.expectOne(`${API_BASE}/projects`).flush([{ id: 'p1', name: 'Acme' }]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones`).flush([{ id: 'z1', name: 'Home bar', projectId: 'p1' }]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones/z1/frames`).flush([]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones/z1/tale-groups`).flush([]);
    await settle(fixture);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Acme');
    expect(text).toContain('Home bar');
    expect(text).toContain('in Acme');
  });

  it('shows the message from the API error body when a save fails', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    http.expectOne(`${API_BASE}/projects`).flush([]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones`).flush([]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await settle(fixture);

    const button = (fixture.nativeElement as HTMLElement).querySelectorAll('button')[1];
    button.click();
    http
      .expectOne(`${API_BASE}/zones`)
      .flush(
        { error: { code: 'project_not_found', message: 'projectId does not match a project' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'projectId does not match a project',
    );
  });

  // Answers the initial (or a repeated) refresh with one zone, its frames and its tale groups.
  async function flushRefresh(
    fixture: { whenStable(): Promise<unknown> },
    frames: unknown[],
    taleGroups: unknown[] = [],
  ): Promise<void> {
    http.expectOne(`${API_BASE}/projects`).flush([{ id: 'p1', name: 'Acme' }]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones`).flush([zone]);
    await settle(fixture);
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones/z1/frames`).flush(frames);
    await settle(fixture);
    http.expectOne(`${API_BASE}/zones/z1/tale-groups`).flush(taleGroups);
    await settle(fixture);
  }

  it('offers the registry frame types for each zone and adds the picked one', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await flushRefresh(fixture, []);
    fixture.detectChanges();
    await settle(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const select = root.querySelectorAll<HTMLSelectElement>('select')[1];
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Choose a frame type',
      'Bar',
      'Banner',
    ]);
    expect(root.textContent).toContain('No frames yet.');

    select.value = 'bar';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    addFrameButton(root).click();

    const req = http.expectOne(`${API_BASE}/zones/z1/frames`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ type: 'bar', settings: {} });
    req.flush({ id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} });
    await settle(fixture);
    await flushRefresh(fixture, [{ id: 'f1', zoneId: 'z1', projectId: 'p1', type: 'bar', settings: {} }]);
    fixture.detectChanges();

    const list = root.querySelector('[aria-label="Frames in Home bar"]');
    expect(list?.textContent).toContain('Bar');
    expect(list?.textContent).not.toContain('No frames yet.');
  });

  it('shows the API message when a frame is refused', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await flushRefresh(fixture, []);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    addFrameButton(root).click();
    http
      .expectOne(`${API_BASE}/zones/z1/frames`)
      .flush(
        { error: { code: 'validation_failed', message: 'type is required' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    fixture.detectChanges();

    expect(root.querySelector('[role=alert]')?.textContent).toContain('type is required');
  });

  describe('tale groups', () => {
    const group = { id: 'g1', zoneId: 'z1', projectId: 'p1', name: 'Summer', position: 0 };
    const taleA = { id: 't1', taleGroupId: 'g1', projectId: 'p1', title: 'A', position: 0 };
    const taleB = { id: 't2', taleGroupId: 'g1', projectId: 'p1', title: 'B', position: 1 };

    it('creates a tale group in a zone and adds tales A then B, listed in that order', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await flushRefresh(fixture, []);
      fixture.detectChanges();
      await settle(fixture);
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[aria-label="Tale groups in Home bar"]')?.textContent).toContain(
        'No tale groups yet.',
      );

      type(root.querySelector<HTMLInputElement>('[name="taleGroupName-z1"]'), 'Summer');
      buttonNamed(root, 'Add tale group').click();
      const createGroup = http.expectOne(`${API_BASE}/zones/z1/tale-groups`);
      expect(createGroup.request.method).toBe('POST');
      expect(createGroup.request.body).toEqual({ name: 'Summer' });
      createGroup.flush({ ...group, tales: [] });
      await settle(fixture);
      await flushRefresh(fixture, [], [{ ...group, tales: [] }]);
      fixture.detectChanges();
      await settle(fixture);
      expect(root.querySelector('[aria-label="Tales in Summer"]')?.textContent).toContain('No tales yet.');

      for (const [title, tales] of [
        ['A', [taleA]],
        ['B', [taleA, taleB]],
      ] as const) {
        type(root.querySelector<HTMLInputElement>('[name="taleTitle-g1"]'), title);
        buttonNamed(root, 'Add tale').click();
        const createTale = http.expectOne(`${API_BASE}/tale-groups/g1/tales`);
        expect(createTale.request.method).toBe('POST');
        expect(createTale.request.body).toEqual({ title });
        createTale.flush(tales[tales.length - 1]);
        await settle(fixture);
        await flushRefresh(fixture, [], [{ ...group, tales }]);
        fixture.detectChanges();
        await settle(fixture);
      }

      const items = [...root.querySelectorAll('[aria-label="Tales in Summer"] li')].map((li) =>
        li.textContent?.trim(),
      );
      expect(items).toEqual(['A', 'B']);
    });

    it('shows the API message next to the tale group form when a group is refused', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await flushRefresh(fixture, []);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      buttonNamed(root, 'Add tale group').click();
      http
        .expectOne(`${API_BASE}/zones/z1/tale-groups`)
        .flush(
          { error: { code: 'validation_failed', message: 'name is required' } },
          { status: 400, statusText: 'Bad Request' },
        );
      await settle(fixture);
      fixture.detectChanges();

      const form = buttonNamed(root, 'Add tale group').closest('form');
      expect(form?.querySelector('[role=alert]')?.textContent).toContain('name is required');
    });

    it('shows the API message next to the tale form when a tale is refused', async () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      await flushRefresh(fixture, [], [{ ...group, tales: [] }]);
      fixture.detectChanges();
      await settle(fixture);

      const root = fixture.nativeElement as HTMLElement;
      type(root.querySelector<HTMLInputElement>('[name="taleTitle-g1"]'), 'C');
      buttonNamed(root, 'Add tale').click();
      http
        .expectOne(`${API_BASE}/tale-groups/g1/tales`)
        .flush(
          { error: { code: 'tale_group_full', message: 'A tale group holds at most 100 tales' } },
          { status: 409, statusText: 'Conflict' },
        );
      await settle(fixture);
      fixture.detectChanges();

      const form = buttonNamed(root, 'Add tale').closest('form');
      expect(form?.querySelector('[role=alert]')?.textContent).toContain('A tale group holds at most 100 tales');
    });
  });
});
