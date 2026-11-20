import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../auth';
import { API_BASE } from '../dashboard.store';
import { SignInMethodsPage } from './sign-in-methods';

const AUTH = `${API_BASE}/auth`;
const SECRET = 'TOPSECRET-VALUE-42';
const ORIGIN_CALLBACK = 'https://api.example.com/api/v1/auth/callback';

const ADMIN = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' };
const SETTINGS = { passkeyEnabled: true, passwordEnabled: false, secretKeyConfigured: true };
const GOOGLE = {
  slug: 'google',
  kind: 'google',
  id: 'google',
  displayName: 'Google',
  enabled: true,
  usable: true,
  config: { clientId: 'client-1' },
  hasSecret: true,
  redirectUri: `${ORIGIN_CALLBACK}/google`,
  updatedAt: '2026-10-28T10:00:00.000Z',
};

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('SignInMethodsPage: Settings > Sign-in methods (admins)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SignInMethodsPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  const switchNamed = (name: string) =>
    root().querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${name}"]`);
  const button = (label: string) => root().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const drawer = () => document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  function choose(name: string, value: string): void {
    const radio = root().querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
    radio?.click();
  }

  /** Opens the page as an admin and answers its two reads. */
  function open(settings = SETTINGS, providers: unknown[] = [GOOGLE], role = 'admin'): void {
    TestBed.inject(AuthStore).user.set({ ...ADMIN, role } as never);
    fixture = TestBed.createComponent(SignInMethodsPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    if (role !== 'admin') return;
    http.expectOne(`${AUTH}/settings`).flush(settings);
    http.expectOne(`${AUTH}/providers`).flush(providers);
  }

  async function ready(settings = SETTINGS, providers: unknown[] = [GOOGLE]): Promise<void> {
    open(settings, providers);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignInMethodsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('shows the passkey and password switches with their state', async () => {
    await ready({ ...SETTINGS, passwordEnabled: true });
    expect(switchNamed('Passkey sign-in')?.getAttribute('aria-checked')).toBe('true');
    expect(switchNamed('Username and password sign-in')?.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('refused when it is the last one on');
  });

  it('explains the missing TALEART_SECRET_KEY and what to do about it', async () => {
    await ready({ ...SETTINGS, secretKeyConfigured: false });
    expect(root().querySelector('#secret-key-title')?.textContent).toContain('cannot be saved');
    expect(text()).toContain('TALEART_SECRET_KEY');
    expect(text()).toContain('restart the API');
  });

  it('turns the password method on with the passkey setting unchanged', async () => {
    await ready();
    switchNamed('Username and password sign-in')?.click();
    const req = http.expectOne(`${AUTH}/settings`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ passkeyEnabled: true, passwordEnabled: true });
    req.flush({ ...SETTINGS, passwordEnabled: true });
    await settle(fixture);
    expect(switchNamed('Username and password sign-in')?.getAttribute('aria-checked')).toBe('true');
  });

  it('explains a refused lock-out, and keeps the switch as the server has it', async () => {
    await ready();
    switchNamed('Passkey sign-in')?.click();
    http
      .expectOne(`${AUTH}/settings`)
      .flush({ error: { code: 'sign_in_lockout', message: 'Locked out.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    const alert = root().querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('no way to sign in');
    expect(switchNamed('Passkey sign-in')?.getAttribute('aria-checked')).toBe('true');
  });

  it('explains the last method refusal', async () => {
    await ready();
    switchNamed('Passkey sign-in')?.click();
    http
      .expectOne(`${AUTH}/settings`)
      .flush({ error: { code: 'last_sign_in_method', message: 'Last.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Keep at least one sign-in method on');
  });

  it('lists each provider with its state, and never a secret', async () => {
    await ready(SETTINGS, [
      GOOGLE,
      {
        ...GOOGLE,
        slug: 'corp',
        kind: 'oidc',
        id: 'oidc:corp',
        displayName: 'Corp ID',
        hasSecret: false,
        usable: false,
        enabled: false,
      },
    ]);
    expect(text()).toContain('Secret set');
    expect(text()).toContain('No secret');
    expect(text()).toContain('Not usable');
    expect(root().querySelector('.provider')).not.toBeNull();
    expect(root().innerHTML).not.toContain('clientSecret');
    expect(button('Edit Google')).not.toBeNull();
    expect(button('Delete Corp ID')).not.toBeNull();
  });

  it('adds a generic OpenID Connect provider, and never shows the secret again once saved', async () => {
    await ready(SETTINGS, []);
    root().querySelector<HTMLButtonElement>('#provider-add')?.click();
    await settle(fixture);
    choose('provider-kind', 'oidc');
    await settle(fixture);
    type('provider-name', 'Corp ID');
    type('provider-slug', 'corp');
    type('provider-issuer', 'https://id.example.com');
    type('provider-client-id', 'client-1');
    type('provider-secret', SECRET);
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);

    const req = http.expectOne(`${AUTH}/providers/corp`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      displayName: 'Corp ID',
      enabled: true,
      config: { issuer: 'https://id.example.com', clientId: 'client-1' },
      secret: SECRET,
    });
    req.flush({
      slug: 'corp',
      kind: 'oidc',
      id: 'oidc:corp',
      displayName: 'Corp ID',
      enabled: true,
      usable: true,
      config: { issuer: 'https://id.example.com', clientId: 'client-1' },
      hasSecret: true,
      redirectUri: `${ORIGIN_CALLBACK}/corp`,
      updatedAt: '2026-10-29T10:00:00.000Z',
    });
    await settle(fixture);

    expect(drawer()).toBeNull();
    expect(text()).toContain('Corp ID');
    expect(text()).toContain('Secret set');
    expect(document.body.textContent ?? '').not.toContain(SECRET);
    expect(root().innerHTML).not.toContain(SECRET);
  });

  it('refuses a plain-http issuer inline, without a request', async () => {
    await ready(SETTINGS, []);
    root().querySelector<HTMLButtonElement>('#provider-add')?.click();
    await settle(fixture);
    choose('provider-kind', 'oidc');
    await settle(fixture);
    type('provider-name', 'Corp ID');
    type('provider-slug', 'corp');
    type('provider-issuer', 'http://id.example.com');
    type('provider-client-id', 'client-1');
    type('provider-secret', SECRET);
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);
    expect(root().querySelector('#provider-issuer-error')?.textContent).toContain('https');
    expect(input('provider-issuer').getAttribute('aria-invalid')).toBe('true');
    http.expectNone(`${AUTH}/providers/corp`);
  });

  it('explains a save refused for the missing key, and tells the admin to set TALEART_SECRET_KEY', async () => {
    await ready(SETTINGS, []);
    root().querySelector<HTMLButtonElement>('#provider-add')?.click();
    await settle(fixture);
    type('provider-name', 'Google');
    type('provider-client-id', 'client-1');
    type('provider-secret', SECRET);
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);
    http
      .expectOne(`${AUTH}/providers/google`)
      .flush(
        { error: { code: 'secret_key_missing', message: 'No key.' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    await settle(fixture);
    expect(drawer()?.querySelector('[role="alert"]')?.textContent).toContain('TALEART_SECRET_KEY');
    expect(document.body.textContent ?? '').not.toContain(SECRET);
  });

  it('edits a provider: its secret shows as set, Replace stores a new one, Remove clears it', async () => {
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    expect(drawer()?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(text()).toContain('Secret is set');
    expect(root().querySelector('#provider-secret')).toBeNull();

    const replace = [...root().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Replace',
    );
    replace?.click();
    await settle(fixture);
    type('provider-secret', 'NEW-SECRET-VALUE');
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);
    expect(http.expectOne(`${AUTH}/providers/google`).request.body).toMatchObject({ secret: 'NEW-SECRET-VALUE' });
  });

  it('removes a stored secret when asked, and sends null for it', async () => {
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    const remove = [...root().querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Remove',
    );
    remove?.click();
    await settle(fixture);
    expect(text()).toContain('It will be removed when you save.');
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);
    const req = http.expectOne(`${AUTH}/providers/google`);
    expect(req.request.body).toMatchObject({ secret: null, config: { clientId: 'client-1' } });
  });

  it('keeps the stored secret when the drawer saves without a change', async () => {
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#provider-save')?.click();
    await settle(fixture);
    const body = http.expectOne(`${AUTH}/providers/google`).request.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('secret');
  });

  it('runs the Test button and shows what discovery found, without a secret', async () => {
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#provider-test')?.click();
    http.expectOne(`${AUTH}/providers/google/test`).flush({
      ok: true,
      issuer: 'https://accounts.google.com',
      endpoints: { authorization: 'https://a', token: 'https://t' },
    });
    await settle(fixture);
    const result = root().querySelector('#provider-test-result');
    expect(result?.textContent).toContain('settings work');
    expect(result?.textContent).toContain('https://accounts.google.com');
  });

  it('shows the discovery failure from the test', async () => {
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#provider-test')?.click();
    http.expectOne(`${AUTH}/providers/google/test`).flush({ ok: false, error: 'The discovery issuer does not match.' });
    await settle(fixture);
    expect(root().querySelector('#provider-test-result')?.textContent).toContain('did not pass the check');
  });

  it('copies the redirect URI the provider needs', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await ready();
    button('Edit Google')?.click();
    await settle(fixture);
    expect(input('provider-redirect').value).toBe(`${ORIGIN_CALLBACK}/google`);
    expect(input('provider-redirect').readOnly).toBe(true);
    [...root().querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent?.trim() === 'Copy redirect URI')
      ?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN_CALLBACK}/google`);
    expect(text()).toContain('Redirect URI copied');
  });

  it('deletes a provider after a confirmation, and explains a refused delete', async () => {
    await ready(SETTINGS, [GOOGLE]);
    button('Delete Google')?.click();
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    root().ownerDocument.querySelector<HTMLButtonElement>('#provider-delete')?.click();
    await settle(fixture);
    http
      .expectOne(`${AUTH}/providers/google`)
      .flush({ error: { code: 'sign_in_lockout', message: 'Locked out.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain('no way to sign in');
    root().ownerDocument.querySelector<HTMLButtonElement>('#provider-delete')?.click();
    await settle(fixture);
    http.expectOne(`${AUTH}/providers/google`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    expect(root().querySelector('.provider')).toBeNull();
    expect(root().querySelector('#providers-empty')?.textContent).toContain('No providers yet.');
  });

  it('gives a non-admin only a notice and makes no request', async () => {
    open(SETTINGS, [], 'content_manager');
    await settle(fixture);
    expect(text()).toContain('Only admins can change the sign-in methods.');
    expect(root().querySelector('[role="switch"]')).toBeNull();
  });

  it('offers a retry when the methods cannot be read', async () => {
    TestBed.inject(AuthStore).user.set(ADMIN as never);
    fixture = TestBed.createComponent(SignInMethodsPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(`${AUTH}/settings`).flush({}, { status: 500, statusText: 'Server Error' });
    http.expectOne(`${AUTH}/providers`).flush([]);
    await settle(fixture);
    expect(text()).toContain('could not be read');
  });
});
