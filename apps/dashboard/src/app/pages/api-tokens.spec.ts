import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { ApiTokensPage, tokenScope } from './api-tokens';

const url = `${API_BASE}/api-tokens`;
const projects = [
  { id: 'p1', name: 'Acme' },
  { id: 'p2', name: 'Beta' },
];
const listed = {
  id: 't1',
  name: 'Nightly import',
  prefix: 'tat_abcdef',
  projectIds: ['p1'],
  readOnly: true,
  createdAt: '2026-10-24T10:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
};
const SECRET = 'tat_abcdefSECRETSECRETSECRETSECRETSECRETSECRET1';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('tokenScope', () => {
  it('says what a token may do and where', () => {
    expect(tokenScope({ readOnly: true, projectIds: null }, projects)).toBe('Read-only · All your projects');
    expect(tokenScope({ readOnly: false, projectIds: ['p2', 'p1'] }, projects)).toBe('Read and write · Beta, Acme');
    expect(tokenScope({ readOnly: true, projectIds: ['p1', 'gone'] }, projects)).toBe(
      'Read-only · Acme, 1 project you can no longer open',
    );
    expect(tokenScope({ readOnly: true, projectIds: ['x', 'y'] }, projects)).toBe('Read-only · 2 projects you can no longer open');
  });
});

describe('ApiTokensPage: Settings > API tokens (epic developer experience 10.1)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ApiTokensPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

  async function open(tokens: unknown[] = []): Promise<void> {
    fixture = TestBed.createComponent(ApiTokensPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(url).flush(tokens);
    await settle(fixture);
  }

  function type(id: string, value: string): void {
    const el = input(id);
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    root().querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ApiTokensPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(DashboardStore).projects.set(projects);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('says there are no tokens yet', async () => {
    await open();
    expect(text()).toContain('No API tokens yet.');
    expect(root().querySelector('.tokens-list')).toBeNull();
  });

  it('lists each token with its prefix, scope and dates, never a secret', async () => {
    await open([
      listed,
      { ...listed, id: 't2', name: 'Old', projectIds: null, readOnly: false, expiresAt: '2020-01-01T00:00:00.000Z', lastUsedAt: '2026-10-24T11:00:00.000Z' },
    ]);
    const items = [...root().querySelectorAll('.token')].map((li) => (li.textContent ?? '').replace(/\s+/g, ' '));
    expect(items[0]).toContain('Nightly import');
    expect(items[0]).toContain('Read-only · Acme');
    expect(items[0]).toContain('tat_abcdef…');
    expect(items[0]).toContain('Last usedNever');
    expect(items[0]).toContain('ExpiresNever');
    expect(items[1]).toContain('Read and write · All your projects');
    expect(items[1]).toMatch(/Expired /);
    expect(root().querySelector('[aria-label="Revoke Old"]')).not.toBeNull();
  });

  it('refuses an empty name and an empty project pick, tied to their fields', async () => {
    await open();
    await submit();
    expect(input('api-token-name').getAttribute('aria-invalid')).toBe('true');
    expect(input('api-token-name').getAttribute('aria-describedby')).toContain('api-token-name-error');
    expect(document.activeElement?.id).toBe('api-token-name');

    type('api-token-name', 'CI');
    input('api-token-some').click();
    await settle(fixture);
    await submit();
    expect(root().querySelector('#api-token-projects-error')?.textContent).toContain('Pick at least one project');
    http.expectNone(url);
  });

  it('creates a read-only token for the picked projects, shows it once with Copy, and forgets it on Done', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-24T12:00:00Z') });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open();
    type('api-token-name', ' Nightly import ');
    input('api-token-some').click();
    await settle(fixture);
    (root().querySelectorAll<HTMLInputElement>('.tokens-projects input[type=checkbox]')[0]).click();
    await settle(fixture);
    await submit();

    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'Nightly import',
      projectIds: ['p1'],
      readOnly: true,
      expiresAt: '2026-11-23T12:00:00.000Z',
    });
    req.flush({ ...listed, token: SECRET });
    await settle(fixture);

    expect(dialog()?.querySelector<HTMLInputElement>('#api-token-value')?.value).toBe(SECRET);
    expect(dialog()?.textContent).toContain('Shown only now');
    dialog()?.querySelector<HTMLButtonElement>('#api-token-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(dialog()?.textContent).toContain('Token copied');

    // Listed by prefix; the form is ready for another.
    expect(text()).toContain('tat_abcdef…');
    expect(input('api-token-name').value).toBe('');

    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Done')?.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('a token for all projects and read-write that never expires', async () => {
    await open();
    type('api-token-name', 'Deploy');
    input('api-token-read-only').click();
    const expiry = root().querySelector<HTMLSelectElement>('#api-token-expiry') as HTMLSelectElement;
    expiry.value = '0';
    expiry.dispatchEvent(new Event('change'));
    await settle(fixture);
    await submit();
    const req = http.expectOne(url);
    expect(req.request.body).toEqual({ name: 'Deploy', projectIds: null, readOnly: false, expiresAt: null });
    req.flush({ error: { code: 'api_token_limit_reached', message: 'You have 50 active API tokens, the most allowed.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(root().querySelector('[role=alert]')?.textContent).toContain('You have 50 active API tokens');
    expect(dialog()).toBeNull();
  });

  it('revokes a token after asking, and focuses the list when its button is gone', async () => {
    await open([listed]);
    root().querySelector<HTMLButtonElement>('[aria-label="Revoke Nightly import"]')?.click();
    await settle(fixture);
    expect(dialog()?.getAttribute('role')).toBe('alertdialog');
    expect(dialog()?.textContent).toContain('Scripts that use it stop working at once');
    http.expectNone(`${url}/t1`);

    dialog()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    const req = http.expectOne(`${url}/t1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(text()).toContain('No API tokens yet.');
    expect(text()).toContain('Token Nightly import revoked.');
    expect(document.activeElement?.id).toBe('api-tokens-list-title');
  });

  it('keeps the confirmation open with the refusal when a revoke fails', async () => {
    await open([listed]);
    root().querySelector<HTMLButtonElement>('[aria-label="Revoke Nightly import"]')?.click();
    await settle(fixture);
    dialog()?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http.expectOne(`${url}/t1`).flush(null, { status: 0, statusText: 'Unknown Error' });
    await settle(fixture);
    expect(dialog()?.querySelector('[role=alert]')?.textContent).toContain('The token was not revoked. Try again. Check the connection.');
    expect(root().querySelector('.token')).not.toBeNull();
  });
});
