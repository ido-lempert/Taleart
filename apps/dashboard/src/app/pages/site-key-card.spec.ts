import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { SiteKeyCard } from './site-key-card';

const url = `${API_BASE}/projects/p1/site-key`;
const info = { prefix: 'tas_abcdef', createdAt: '2026-10-22T10:00:00.000Z' };
const issued = { key: 'tas_abcdefSECRETSECRETSECRETSECRETSECRETSECRET', prefix: 'tas_abcdef', createdAt: '2026-10-22T11:00:00.000Z' };
const install = {
  apiUrl: 'https://api.example.com',
  sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
  testPageUrl: 'https://api.example.com/sdk/v1/test-page',
};
const placeholderSnippet =
  '<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>\n' +
  '<taleart-view api-url="https://api.example.com" site-key="YOUR_SITE_KEY" zone="home-top"></taleart-view>';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('SiteKeyCard: the Install tab (epic UX rework R3, R13; stories 8.6, 8.13)', () => {
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
    http.expectOne(`${API_BASE}/install`).flush(install);
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
    expect(root().querySelector('#install-snippet')?.textContent).toBe(placeholderSnippet);
    expect(text()).toContain('Replace YOUR_SITE_KEY with your project');
    expect(text()).toContain('No site key yet. Issue one');
    expect(button('site-key-issue')).not.toBeNull();
    expect(button('site-key-rotate')).toBeNull();
  });

  it('shows only the prefix and date, with no actions, to a content manager', async () => {
    await open(info, false);
    expect(text()).toContain('tas_abcdef…');
    expect(root().querySelector('#site-key-issue, #site-key-rotate, #site-key-revoke')).toBeNull();
    // The snippet and the test page are for everyone.
    expect(root().querySelector('#snippet-copy')).not.toBeNull();
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

  it('offers Retry, never Issue, when the site key cannot be read', async () => {
    fixture = TestBed.createComponent(SiteKeyCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('zoneSlug', 'home-top');
    fixture.componentRef.setInput('admin', true);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(null, { status: 500, statusText: 'Error' });
    http.expectOne(`${API_BASE}/install`).flush(install);
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

describe('SiteKeyCard: snippet, copy and test page (story 8.13)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SiteKeyCard>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  const root = () => fixture.nativeElement as HTMLElement;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
  const statuses = () => [...root().querySelectorAll('[role="status"]')].map((s) => s.textContent?.trim());

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteKeyCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(DashboardStore), 'refresh').mockImplementation(async () => undefined);
    writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fixture = TestBed.createComponent(SiteKeyCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('zoneSlug', 'home-top');
    fixture.componentRef.setInput('admin', true);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(null);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it('copies the snippet and announces it, and says so when copying fails', async () => {
    http.expectOne(`${API_BASE}/install`).flush(install);
    await settle(fixture);
    const copy = root().querySelector<HTMLButtonElement>('#snippet-copy');
    copy?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(placeholderSnippet);
    expect(statuses()).toContain('Snippet copied');
    writeText.mockRejectedValueOnce(new Error('denied'));
    copy?.click();
    await settle(fixture);
    expect(statuses()).toContain('Could not copy. Select the snippet and copy it.');
  });

  it('links the test page with the zone and no key, in a new tab without a referrer', async () => {
    http.expectOne(`${API_BASE}/install`).flush(install);
    await settle(fixture);
    const link = root().querySelector<HTMLAnchorElement>('#test-page-link');
    expect(link?.getAttribute('href')).toBe('https://api.example.com/sdk/v1/test-page?zone=home-top');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(link?.textContent).toContain('(opens in a new tab)');
  });

  it("puts the key just issued in the drawer's snippet and test page link (fragment only), and nowhere after Done", async () => {
    http.expectOne(`${API_BASE}/install`).flush(install);
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#site-key-issue')?.click();
    await settle(fixture);
    http.expectOne((r) => r.url === url && r.method === 'POST').flush(issued);
    await settle(fixture);
    const snippet = dialog()?.querySelector('#issued-snippet')?.textContent ?? '';
    expect(snippet).toBe(placeholderSnippet.replace('YOUR_SITE_KEY', issued.key));
    const link = dialog()?.querySelector<HTMLAnchorElement>('#issued-test-page-link');
    expect(link?.getAttribute('href')).toBe(`https://api.example.com/sdk/v1/test-page?zone=home-top#siteKey=${issued.key}`);
    expect(link?.rel).toBe('noopener noreferrer');
    dialog()?.querySelector<HTMLButtonElement>('#issued-snippet-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenLastCalledWith(snippet);
    expect(dialog()?.textContent).toContain('Snippet with the key copied');
    // The tab's own snippet keeps the placeholder.
    expect(root().querySelector('#install-snippet')?.textContent).toBe(placeholderSnippet);
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Done')?.click();
    await settle(fixture);
    expect(document.body.innerHTML).not.toContain(issued.key);
  });

  it('shows a refused issue in the drawer, with the warning and Issue key to try again', async () => {
    http.expectOne(`${API_BASE}/install`).flush(install);
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#site-key-issue')?.click();
    await settle(fixture);
    http
      .expectOne((r) => r.url === url && r.method === 'POST')
      .flush({ error: { code: 'forbidden', message: 'Only admins can do this' } }, { status: 403, statusText: 'Forbidden' });
    await settle(fixture);
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('Only admins can do this');
    expect(dialog()?.querySelector('#site-key-exposure')).not.toBeNull();
    dialog()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http.expectOne((r) => r.url === url && r.method === 'POST').flush(issued);
    await settle(fixture);
    expect((dialog()?.querySelector('#site-key-value') as HTMLInputElement).value).toBe(issued.key);
  });

  it('says so when the install URLs cannot be read', async () => {
    http.expectOne(`${API_BASE}/install`).flush(null, { status: 500, statusText: 'Error' });
    await settle(fixture);
    expect(root().querySelector('#install-snippet')).toBeNull();
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('The snippet could not be loaded');
    // Nor is there a pinned version to show.
    expect(root().querySelector('app-pinned-sdk')).toBeNull();
  });
});

describe('SiteKeyCard: the pinned SDK version (story 8.21)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SiteKeyCard>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  const root = () => fixture.nativeElement as HTMLElement;
  const statuses = () => [...root().querySelectorAll('[role="status"]')].map((s) => s.textContent?.trim());
  const pinnedUrl = 'https://api.example.com/sdk/v1/taleart.abcdefghijklmn-_.js';
  const integrity = 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC';
  const pinnedTag = `<script type="module" src="${pinnedUrl}" integrity="${integrity}" crossorigin="anonymous"></script>`;

  async function open(answer: object): Promise<void> {
    fixture = TestBed.createComponent(SiteKeyCard);
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.componentRef.setInput('zoneSlug', 'home-top');
    fixture.componentRef.setInput('admin', false);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(info);
    http.expectOne(`${API_BASE}/install`).flush(answer);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteKeyCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it('shows the pinned URL and its integrity, to everyone, with how many releases it keeps working', async () => {
    await open({ ...install, sdkPinnedUrl: pinnedUrl, sdkIntegrity: integrity });
    expect(root().querySelector<HTMLInputElement>('#pinned-sdk-url')?.value).toBe(pinnedUrl);
    expect(root().querySelector<HTMLInputElement>('#pinned-sdk-integrity')?.value).toBe(integrity);
    expect(root().querySelector('label[for="pinned-sdk-url"]')?.textContent?.trim()).toBe('Pinned URL');
    expect(root().querySelector('label[for="pinned-sdk-integrity"]')?.textContent?.trim()).toBe('Integrity');
    expect(root().querySelector<HTMLInputElement>('#pinned-sdk-url')?.readOnly).toBe(true);
    const hint = root().querySelector('#pinned-sdk-hint')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(hint).toContain('TaleArt keeps the last 5 builds at their pinned URLs');
    expect(hint).toContain('keeps working through the next 4 releases');
    // The snippet keeps the stable URL.
    expect(root().querySelector('#install-snippet')?.textContent).toBe(placeholderSnippet);
  });

  it('copies the URL, the integrity and the pinned script tag, and says so when copying fails', async () => {
    await open({ ...install, sdkPinnedUrl: pinnedUrl, sdkIntegrity: integrity });
    const click = async (id: string) => {
      root().querySelector<HTMLButtonElement>(`#${id}`)?.click();
      await settle(fixture);
    };
    await click('pinned-sdk-copy-url');
    expect(writeText).toHaveBeenLastCalledWith(pinnedUrl);
    expect(statuses()).toContain('Pinned URL copied');
    await click('pinned-sdk-copy-integrity');
    expect(writeText).toHaveBeenLastCalledWith(integrity);
    expect(statuses()).toContain('Integrity copied');
    await click('pinned-sdk-copy-tag');
    expect(writeText).toHaveBeenLastCalledWith(pinnedTag);
    expect(statuses()).toContain('Pinned script tag copied');
    writeText.mockRejectedValueOnce(new Error('denied'));
    await click('pinned-sdk-copy-url');
    expect(statuses()).toContain('Could not copy. Select the text and copy it.');
  });

  it('says there is no pinned URL when the server has no SDK build', async () => {
    await open({ ...install, sdkPinnedUrl: null, sdkIntegrity: null });
    expect(root().querySelector('#pinned-sdk-url')).toBeNull();
    expect(root().textContent).toContain('This server has no Web SDK build, so there is no pinned URL.');
    // The snippet still shows: the stable URL answers once the SDK is built.
    expect(root().querySelector('#install-snippet')).not.toBeNull();
  });
});
