import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthStore, PasskeyClient } from '../auth';
import { API_BASE } from '../dashboard.store';
import { SignInPage } from './sign-in';

const METHODS = [
  { id: 'passkey', label: 'Passkey', kind: 'passkey' },
  { id: 'password', label: 'Password', kind: 'password' },
  { id: 'google', label: 'Google', kind: 'google' },
  { id: 'oidc:corp', label: 'Corp ID', kind: 'oidc' },
] as const;

// What the page under test reads from the route and the browser, set per test before the page is created.
let queryParams: Record<string, string> = {};
let passkeysSupported = true;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('SignInPage: the sign-in methods on (/auth/state.methods)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SignInPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const field = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

  function setUp(methods: readonly unknown[], query: Record<string, string> = {}, supported = true): void {
    queryParams = query;
    passkeysSupported = supported;
    fixture = TestBed.createComponent(SignInPage);
    TestBed.inject(AuthStore).state.set({ setupRequired: false, user: null, methods: methods as never });
    document.body.appendChild(root());
    fixture.detectChanges();
  }

  async function submitPassword(username: string, password: string): Promise<void> {
    // The form's controls register with ngModel a microtask after the page is drawn; type after that.
    await settle(fixture);
    field('sign-in-username').value = username;
    field('sign-in-username').dispatchEvent(new Event('input'));
    field('sign-in-password').value = password;
    field('sign-in-password').dispatchEvent(new Event('input'));
    root()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useFactory: () => ({ snapshot: { queryParamMap: convertToParamMap(queryParams) } }),
        },
        { provide: PasskeyClient, useFactory: () => ({ supported: () => passkeysSupported }) },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('offers a passkey, a password form and one button per provider, as the state lists them', () => {
    setUp(METHODS);
    expect(text()).toContain('Sign in with a passkey');
    expect(root().querySelector('#sign-in-password')).not.toBeNull();
    const links = [...root().querySelectorAll<HTMLAnchorElement>('a.btn')];
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Continue with Google', 'Continue with Corp ID']);
    expect(links[0]?.getAttribute('href')).toBe(`${API_BASE}/auth/providers/google/start?purpose=sign-in`);
    expect(links[1]?.getAttribute('href')).toBe(`${API_BASE}/auth/providers/corp/start?purpose=sign-in`);
  });

  it('leaves out what is not on: no passkey, no password form', () => {
    setUp([{ id: 'google', label: 'Google', kind: 'google' }]);
    expect(text()).not.toContain('Sign in with a passkey');
    expect(root().querySelector('#sign-in-username')).toBeNull();
    expect(root().querySelectorAll('a.btn').length).toBe(1);
  });

  it('says so when no method is on', () => {
    setUp([]);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('No sign-in method is turned on');
  });

  it('offers a passkey while the state is not known yet', () => {
    fixture = TestBed.createComponent(SignInPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    expect(text()).toContain('Sign in with a passkey');
    expect(root().querySelector('#sign-in-password')).toBeNull();
  });

  it('gives the username and password inputs their autocomplete values and labels', () => {
    setUp(METHODS);
    expect(field('sign-in-username').getAttribute('autocomplete')).toBe('username');
    expect(field('sign-in-username').getAttribute('autocapitalize')).toBe('none');
    expect(field('sign-in-password').getAttribute('autocomplete')).toBe('current-password');
    expect(field('sign-in-password').type).toBe('password');
    expect(root().querySelector('label[for="sign-in-username"]')?.textContent?.trim()).toBe('Username');
    expect(root().querySelector('label[for="sign-in-password"]')?.textContent?.trim()).toBe('Password');
  });

  it('refuses an empty form without a request', async () => {
    setUp(METHODS);
    await submitPassword('', '');
    expect(root().querySelector('#sign-in-password-error')?.textContent).toContain('Enter your username and password.');
    http.expectNone(`${API_BASE}/auth/password/sign-in`);
  });

  it('shows one generic line for a wrong password, and clears the password', async () => {
    setUp(METHODS);
    await submitPassword('Ada', 'wrong password');
    http
      .expectOne(`${API_BASE}/auth/password/sign-in`)
      .flush(
        { error: { code: 'sign_in_failed', message: 'Sign-in failed.' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await settle(fixture);
    const alert = root().querySelector('#sign-in-password-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('The username or password is not right.');
    expect(field('sign-in-password').getAttribute('aria-describedby')).toBe('sign-in-password-error');
    expect(field('sign-in-password').value).toBe('');
  });

  it('sends the username lower-cased with the password, and returns to the return URL on success', async () => {
    setUp(METHODS, { returnUrl: '/projects' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await submitPassword('  Ada.L ', 'correct horse 1');
    const req = http.expectOne(`${API_BASE}/auth/password/sign-in`);
    expect(req.request.body).toEqual({ username: 'ada.l', password: 'correct horse 1' });
    req.flush(
      { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'admin' } },
      { status: 200, statusText: 'OK' },
    );
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/projects');
  });

  it('explains a throttled attempt with the wait Retry-After gives', async () => {
    setUp(METHODS);
    await submitPassword('ada', 'correct horse 1');
    http
      .expectOne(`${API_BASE}/auth/password/sign-in`)
      .flush(
        { error: { code: 'rate_limited', message: 'Too many attempts.' } },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '45' } },
      );
    await settle(fixture);
    expect(root().querySelector('#sign-in-password-error')?.textContent).toContain('Wait 45 seconds');
  });

  it('explains a throttled attempt without a Retry-After too', async () => {
    setUp(METHODS);
    await submitPassword('ada', 'correct horse 1');
    http
      .expectOne(`${API_BASE}/auth/password/sign-in`)
      .flush(
        { error: { code: 'rate_limited', message: 'Too many attempts.' } },
        { status: 429, statusText: 'Too Many Requests' },
      );
    await settle(fixture);
    expect(root().querySelector('#sign-in-password-error')?.textContent).toContain('Wait a few minutes');
  });

  it('maps a provider callback error to a friendly message', () => {
    setUp(METHODS, { auth_error: 'invitation_invalid' });
    expect(root().querySelector('#sign-in-auth-error')?.textContent).toContain('no longer valid');
  });

  it('gives a callback error code it does not know the generic line', () => {
    setUp(METHODS, { auth_error: 'brand_new_code' });
    expect(root().querySelector('#sign-in-auth-error')?.textContent).toContain('did not finish. Try again.');
  });

  it('shows the passkey refusal when browsers cannot do passkeys', () => {
    setUp(METHODS, {}, false);
    expect(text()).toContain('This browser does not support passkeys');
    expect(root().querySelector('#sign-in-password')).not.toBeNull();
  });
});
