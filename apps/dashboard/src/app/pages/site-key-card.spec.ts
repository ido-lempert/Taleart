import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { SiteKeyCard } from './site-key-card';

const url = `${API_BASE}/projects/p1/site-key`;
const info = { prefix: 'tas_abcdef', createdAt: '2026-10-22T10:00:00.000Z' };
const issued = { key: 'tas_abcdefSECRETSECRETSECRETSECRETSECRETSECRET', prefix: 'tas_abcdef', createdAt: '2026-10-22T11:00:00.000Z' };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('SiteKeyCard (epic UX rework R3, story 8.6)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SiteKeyCard>;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const button = (id: string) => root().querySelector<HTMLButtonElement>(`#${id}`);
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  async function open(current: typeof info | null, admin = true): Promise<void> {
    fixture = TestBed.createComponent(SiteKeyCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('zoneSlug', 'home-top');
    fixture.componentRef.setInput('admin', admin);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(current);
    await settle(fixture);
  }

  async function submit(): Promise<void> {
    dialog()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteKeyCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    refresh = vi.fn<() => Promise<void>>(async () => undefined);
    vi.spyOn(TestBed.inject(DashboardStore), 'refresh').mockImplementation(refresh);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it("shows the snippet with this zone's slug, and Issue for an admin when the project has no site key", async () => {
    await open(null);
    expect(text()).toContain('<taleart-view site-key="…" zone="home-top">');
    expect(text()).toContain('No site key yet. Issue one');
    expect(button('site-key-issue')).not.toBeNull();
    expect(button('site-key-rotate')).toBeNull();
  });

  it('shows only the prefix and date, with no actions, to a content manager', async () => {
    await open(info, false);
    expect(text()).toContain('tas_abcdef…');
    expect(root().querySelector('button')).toBeNull();
  });

  it('issues a key, shows it once with a Copy button, and reads the dashboard again', async () => {
    await open(null);
    button('site-key-issue')?.click();
    await settle(fixture);
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    // Issuing opens every zone of the project to anyone who reads the key in the page's HTML.
    expect(dialog()?.querySelector('#site-key-exposure')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'anyone who sees it can read every zone of this project that has a display and visible content',
    );
    await submit();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    req.flush(issued);
    await settle(fixture);
    const input = dialog()?.querySelector('#site-key-value') as HTMLInputElement;
    expect(input.value).toBe(issued.key);
    expect(input.readOnly).toBe(true);
    expect(dialog()?.textContent).toContain('Shown only now');
    expect(refresh).toHaveBeenCalledTimes(1);
    // Enter again issues nothing more.
    await submit();
    // Done closes it; the key is gone from the page, the prefix stays.
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Done')?.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain(issued.key);
    expect(text()).toContain('tas_abcdef…');
    expect(button('site-key-rotate')).not.toBeNull();
  });

  it('warns that rotating affects every zone of the project before rotating', async () => {
    await open(info);
    button('site-key-rotate')?.click();
    await settle(fixture);
    expect(dialog()?.textContent).toContain('This affects every zone of this project');
    await submit();
    http.expectOne((r) => r.url === url && r.method === 'POST').flush({ ...issued, prefix: 'tas_zzzzzz' });
    await settle(fixture);
    expect((dialog()?.querySelector('#site-key-value') as HTMLInputElement).value).toBe(issued.key);
  });

  it('revokes after the warning, and says why when the API refuses', async () => {
    await open(info);
    button('site-key-revoke')?.click();
    await settle(fixture);
    expect(dialog()?.textContent).toContain('This affects every zone of this project');
    await submit();
    http
      .expectOne((r) => r.url === url && r.method === 'DELETE')
      .flush({ error: { code: 'forbidden', message: 'Only admins can do this' } }, { status: 403, statusText: 'Forbidden' });
    await settle(fixture);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Only admins can do this');
    expect(refresh).not.toHaveBeenCalled();
    await submit();
    http.expectOne((r) => r.url === url && r.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(text()).toContain('No site key yet');
    expect(root().querySelector('[role="status"]')?.textContent).toContain('Site key revoked.');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
