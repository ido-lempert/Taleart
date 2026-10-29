import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { ZoneKeyCard } from './zone-key-card';

const url = `${API_BASE}/zones/z1/key`;
const info = { prefix: 'tak_abcdef', createdAt: '2026-10-22T10:00:00.000Z' };
const issued = { key: 'tak_abcdefSECRETSECRETSECRETSECRETSECRETSECRET', prefix: 'tak_abcdef', createdAt: '2026-10-22T11:00:00.000Z' };
const install = {
  apiUrl: 'https://api.example.com',
  sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
  testPageUrl: 'https://api.example.com/sdk/v1/test-page',
  sdkPinnedUrl: null,
  sdkIntegrity: null,
  sdkBuildsKept: 5,
};
const placeholderSnippet =
  '<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>\n' +
  '<!-- Optional, once per page: <script>Taleart.init({ locale: "en" })</script> -->\n' +
  '<taleart-view zone-key="YOUR_ZONE_KEY"></taleart-view>';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('ZoneKeyCard: the zone key and the snippet on the Install tab (zone keys)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ZoneKeyCard>;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const button = (id: string) => root().querySelector<HTMLButtonElement>(`#${id}`);
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  async function open(current: typeof info | null, admin = true, answer: object | null = install): Promise<void> {
    fixture = TestBed.createComponent(ZoneKeyCard);
    fixture.componentRef.setInput('zoneId', 'z1');
    fixture.componentRef.setInput('admin', admin);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush(current);
    http.expectOne(`${API_BASE}/install`).flush(answer);
    await settle(fixture);
  }

  async function submit(): Promise<void> {
    dialog()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZoneKeyCard],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    refresh = vi.fn<() => Promise<void>>(async () => undefined);
    vi.spyOn(TestBed.inject(DashboardStore), 'refresh').mockImplementation(refresh);
    writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it('shows the snippet with the placeholder and Issue for an admin when the zone has no key', async () => {
    await open(null);
    expect(root().querySelector('#install-snippet')?.textContent).toBe(placeholderSnippet);
    expect(text()).toContain('No zone key yet. Issue one');
    expect(button('zone-key-issue')).not.toBeNull();
    expect(button('zone-key-rotate')).toBeNull();
  });

  it('shows only the prefix and date to a content manager, with the snippet for everyone', async () => {
    await open(info, false);
    expect(text()).toContain('tak_abcdef…');
    expect(root().querySelector('#zone-key-issue, #zone-key-rotate, #zone-key-revoke')).toBeNull();
    expect(button('snippet-copy')).not.toBeNull();
  });

  it('issues at once, shows the key once with the snippet and the test page link carrying it, then forgets it', async () => {
    await open(null);
    button('zone-key-issue')?.click();
    await settle(fixture);
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    req.flush(issued);
    await settle(fixture);
    const input = dialog()?.querySelector('#zone-key-value') as HTMLInputElement;
    expect(input.value).toBe(issued.key);
    expect(dialog()?.querySelector('#issued-snippet')?.textContent).toContain(`zone-key="${issued.key}"`);
    expect(dialog()?.querySelector<HTMLAnchorElement>('#issued-test-page-link')?.getAttribute('href')).toBe(
      `${install.testPageUrl}#zoneKey=${issued.key}`,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Done')?.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.body.textContent).not.toContain(issued.key);
    expect(text()).toContain('tak_abcdef…');
    expect(button('zone-key-rotate')).not.toBeNull();
  });

  it('rotates after its confirmation, and says that only this zone is affected', async () => {
    await open(info);
    button('zone-key-rotate')?.click();
    await settle(fixture);
    expect(dialog()?.textContent).toContain('This affects this zone only');
    await submit();
    const rotate = http.expectOne((r) => r.url === url && r.method === 'POST');
    rotate.flush({ ...issued, prefix: 'tak_zzzzzz' });
    await settle(fixture);
    expect((dialog()?.querySelector('#zone-key-value') as HTMLInputElement).value).toBe(issued.key);
  });

  it('revokes after the warning, and says why when the API refuses', async () => {
    await open(info);
    button('zone-key-revoke')?.click();
    await settle(fixture);
    await submit();
    http.expectOne(url).flush({ error: { code: 'forbidden', message: 'Only admins can revoke a zone key.' } }, { status: 403, statusText: 'Forbidden' });
    await settle(fixture);
    expect(dialog()?.textContent).toContain('Only admins can revoke a zone key.');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('offers Retry, never Issue, when the zone key cannot be read', async () => {
    fixture = TestBed.createComponent(ZoneKeyCard);
    fixture.componentRef.setInput('zoneId', 'z1');
    fixture.componentRef.setInput('admin', true);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
    http.expectOne(url).flush('boom', { status: 500, statusText: 'Server Error' });
    http.expectOne(`${API_BASE}/install`).flush(install);
    await settle(fixture);
    expect(text()).toContain('The zone key could not be read.');
    expect(button('zone-key-issue')).toBeNull();
    expect(button('zone-key-retry')).not.toBeNull();
  });

  it('copies the snippet and the npm variant, and announces each', async () => {
    await open(info);
    button('snippet-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(placeholderSnippet);
    expect(text()).toContain('Snippet copied');
    root().querySelector<HTMLButtonElement>('#npm-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenLastCalledWith(
      "npm i @lempert/taleart\nimport { init } from '@lempert/taleart';\n// Optional, once per page: init({ locale: \"en\" })\n<taleart-view zone-key=\"YOUR_ZONE_KEY\"></taleart-view>",
    );
  });

  it('links the test page without a key, in a new tab without a referrer', async () => {
    await open(info);
    const link = button('test-page-link') as unknown as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(install.testPageUrl);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('says so when the install URLs cannot be read', async () => {
    await open(info, true, null);
    expect(root().querySelector('#install-snippet')).toBeNull();
    expect(text()).toContain('The snippet could not be loaded.');
  });
});
