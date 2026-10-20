import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App, API_BASE } from './app';

const frameTypes = [
  { key: 'bar', label: 'Bar' },
  { key: 'banner', label: 'Banner' },
];
const zone = { id: 'z1', name: 'Home bar', projectId: 'p1' };

function addFrameButton(root: HTMLElement): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Add frame'));
  if (!button) throw new Error('No Add frame button');
  return button;
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
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/zones`).flush([{ id: 'z1', name: 'Home bar', projectId: 'p1' }]);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/zones/z1/frames`).flush([]);
    await fixture.whenStable();
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
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/zones`).flush([]);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelectorAll('button')[1];
    button.click();
    http
      .expectOne(`${API_BASE}/zones`)
      .flush(
        { error: { code: 'project_not_found', message: 'projectId does not match a project' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')?.textContent).toContain(
      'projectId does not match a project',
    );
  });

  // Answers the initial (or a repeated) refresh with one zone and its frames.
  async function flushRefresh(fixture: { whenStable(): Promise<unknown> }, frames: unknown[]): Promise<void> {
    http.expectOne(`${API_BASE}/projects`).flush([{ id: 'p1', name: 'Acme' }]);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/zones`).flush([zone]);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/frame-types`).flush(frameTypes);
    await fixture.whenStable();
    http.expectOne(`${API_BASE}/zones/z1/frames`).flush(frames);
    await fixture.whenStable();
  }

  it('offers the registry frame types for each zone and adds the picked one', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await flushRefresh(fixture, []);
    fixture.detectChanges();
    await fixture.whenStable();

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
    await fixture.whenStable();
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
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[role=alert]')?.textContent).toContain('type is required');
  });
});
