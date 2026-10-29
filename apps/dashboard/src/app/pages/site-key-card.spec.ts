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

describe('SiteKeyCard: the project site key under Advanced / server-side', () => {
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

  it('shows Issue for an admin when the project has no site key, and no snippet', async () => {
    await open(null);
    expect(root().querySelector('#install-snippet')).toBeNull();
    expect(text()).toContain('No site key yet. Issue one');
    expect(button('site-key-issue')).not.toBeNull();
    expect(button('site-key-rotate')).toBeNull();
  });

  it('shows only the prefix and date, with no actions, to a content manager', async () => {
    await open(info, false);
    expect(text()).toContain('tas_abcdef…');
    expect(root().querySelector('#site-key-issue, #site-key-rotate, #site-key-revoke')).toBeNull();
  });

  it('issues a key at once, shows it once with a Copy button, and reads the dashboard again', async () => {
    await open(null);
    // Issuing opens every zone of the project to anyone who reads the key in the page's HTML: said
    // on the tab, before the one click that issues it.
    const exposure = root().querySelector('#site-key-exposure-tab')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(exposure).toContain('anyone who sees it can read every zone of this project that has a display and visible content');
    expect(exposure).toContain('slugs are often guessable (such as "home")');
    button('site-key-issue')?.click();
    await settle(fixture);
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.textContent).toContain('Issuing a site key…');
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    // Issue never rotates: only when no key is active.
    expect(req.request.body).toEqual({ ifNone: true });
    req.flush(issued);
    await settle(fixture);
    const input = dialog()?.querySelector('#site-key-value') as HTMLInputElement;
    expect(input.value).toBe(issued.key);
    expect(root().querySelector('#site-key-exposure-tab')).toBeNull();
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
    const rotate = http.expectOne((r) => r.url === url && r.method === 'POST');
    expect(rotate.request.body).toEqual({});
    rotate.flush({ ...issued, prefix: 'tas_zzzzzz' });
    await settle(fixture);
    expect((dialog()?.querySelector('#site-key-value') as HTMLInputElement).value).toBe(issued.key);
  });

  describe('when the zone page moves to a zone of another project (its route is reused, as on Back)', () => {
    const otherUrl = `${API_BASE}/projects/p2/site-key`;

    async function moveToOtherProject(): Promise<void> {
      fixture.componentRef.setInput('projectId', 'p2');
      await settle(fixture);
    }

    it("closes an open rotate confirmation, so it cannot rotate the other project's key", async () => {
      await open(info);
      button('site-key-rotate')?.click();
      await settle(fixture);
      expect(dialog()).not.toBeNull();
      await moveToOtherProject();
      http.expectOne(otherUrl).flush({ prefix: 'tas_globex', createdAt: info.createdAt });
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(text()).toContain('tas_globex…');
      // Nothing was rotated, on either project.
      http.expectNone((r) => r.method === 'POST');
    });

    it('drops an issue answered after the move: no key of the first project shows with the other zone', async () => {
      await open(null);
      button('site-key-issue')?.click();
      await settle(fixture);
      const issue = http.expectOne((r) => r.url === url && r.method === 'POST');
      await moveToOtherProject();
      http.expectOne(otherUrl).flush(null);
      await settle(fixture);
      issue.flush(issued);
      await settle(fixture);
      expect(dialog()).toBeNull();
      expect(document.body.textContent).not.toContain(issued.key);
      expect(text()).not.toContain('tas_abcdef');
      expect(text()).toContain('No site key yet');
      // The first project's zones are installed now: the dashboard still reads them again.
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('drops a revocation answered after the move: the other project still shows its key', async () => {
      await open(info);
      button('site-key-revoke')?.click();
      await settle(fixture);
      await submit();
      const revoke = http.expectOne((r) => r.url === url && r.method === 'DELETE');
      await moveToOtherProject();
      http.expectOne(otherUrl).flush({ prefix: 'tas_globex', createdAt: info.createdAt });
      await settle(fixture);
      revoke.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);
      expect(text()).toContain('tas_globex…');
      expect(button('site-key-rotate')).not.toBeNull();
    });
  });

  it('offers Retry, never Issue, when the site key cannot be read', async () => {
    fixture = TestBed.createComponent(SiteKeyCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('admin', true);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(null, { status: 500, statusText: 'Error' });
    await settle(fixture);
    expect(button('site-key-issue')).toBeNull();
    expect(button('site-key-rotate')).toBeNull();
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('The site key could not be read.');
    button('site-key-retry')?.click();
    await settle(fixture);
    http.expectOne(url).flush(info);
    await settle(fixture);
    expect(button('site-key-retry')).toBeNull();
    expect(button('site-key-rotate')).not.toBeNull();
  });

  it('turns Issue into the rotate confirmation when a key was issued meanwhile (409)', async () => {
    await open(null);
    button('site-key-issue')?.click();
    await settle(fixture);
    http
      .expectOne((r) => r.url === url && r.method === 'POST')
      .flush({ error: { code: 'site_key_exists', message: 'This project already has a site key.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    http.expectOne((r) => r.url === url && r.method === 'GET').flush(info);
    await settle(fixture);
    expect(dialog()?.querySelector('h2')?.textContent).toContain('Rotate site key');
    expect(dialog()?.querySelector('#site-key-found')?.textContent).toContain('already has a site key');
    expect(dialog()?.textContent).toContain('This affects every zone of this project');
    expect(dialog()?.querySelector('#site-key-value')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    await submit();
    const rotate = http.expectOne((r) => r.url === url && r.method === 'POST');
    expect(rotate.request.body).toEqual({});
    rotate.flush(issued);
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
