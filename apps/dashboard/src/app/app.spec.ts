import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App, API_BASE } from './app';

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
});
