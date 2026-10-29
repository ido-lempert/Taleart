import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuthStore, PasskeyClient } from '../auth';
import { API_BASE } from '../dashboard.store';
import { SetupPage } from './setup';

const SETUP = `${API_BASE}/auth/setup/password`;
let passkeysSupported = true;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('SetupPage: the first admin chooses a method', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SetupPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  function fill(name = 'Ada Admin', email = 'ada@example.com'): void {
    type('setup-name', name);
    type('setup-email', email);
  }

  async function submit(formSelector: string): Promise<void> {
    root()
      .querySelector(formSelector)
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  }

  function open(methods: readonly unknown[] | null): void {
    fixture = TestBed.createComponent(SetupPage);
    TestBed.inject(AuthStore).state.set(
      methods === null ? null : { setupRequired: true, user: null, methods: methods as never },
    );
    document.body.appendChild(root());
    fixture.detectChanges();
  }

  beforeEach(async () => {
    passkeysSupported = true;
    await TestBed.configureTestingModule({
      imports: [SetupPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { queryParamMap: convertToParamMap({}) } }) },
        { provide: PasskeyClient, useFactory: () => ({ supported: () => passkeysSupported }) },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
  });

  it('offers a passkey, a password and the providers the state lists', () => {
    open([
      { id: 'passkey', label: 'Passkey', kind: 'passkey' },
      { id: 'password', label: 'Password', kind: 'password' },
      { id: 'apple', label: 'Apple', kind: 'apple' },
    ]);
    expect(text()).toContain('Create passkey');
    expect(input('setup-password')).not.toBeNull();
    expect(input('setup-username').getAttribute('autocomplete')).toBe('username');
    expect(input('setup-password').getAttribute('autocomplete')).toBe('new-password');
    expect(input('setup-confirm').getAttribute('autocomplete')).toBe('new-password');
    const apple = root().querySelector<HTMLAnchorElement>('a[href*="/providers/apple/start"]');
    expect(apple?.textContent?.trim()).toBe('Continue with Apple');
    expect(apple?.getAttribute('href')).toBe(`${API_BASE}/auth/providers/apple/start?purpose=setup`);
  });

  it('shows the policy hint of the password, and no password form when the state does not list one', () => {
    open([{ id: 'passkey', label: 'Passkey', kind: 'passkey' }]);
    expect(root().querySelector('#setup-password')).toBeNull();
    open([
      { id: 'passkey', label: 'Passkey', kind: 'passkey' },
      { id: 'password', label: 'Password', kind: 'password' },
    ]);
    expect(text()).toContain('12 to 128 characters');
  });

  it('leaves out the passkey when it is off', () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    expect(text()).not.toContain('Create passkey');
    expect(text()).toContain('Create account with password');
  });

  it('refuses a short password inline, without a request', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    fill();
    type('setup-username', 'ada');
    type('setup-password', 'short');
    type('setup-confirm', 'short');
    await submit('form[aria-labelledby="setup-password-title"]');
    expect(input('setup-password').getAttribute('aria-invalid')).toBe('true');
    expect(root().querySelector('#setup-password-error')?.textContent).toContain('Use at least 12 characters.');
    http.expectNone(SETUP);
  });

  it('refuses mismatched confirmation and a missing name, without a request', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    fill();
    type('setup-username', 'ada');
    type('setup-password', 'correct horse 1');
    type('setup-confirm', 'correct horse 2');
    await submit('form[aria-labelledby="setup-password-title"]');
    expect(root().querySelector('#setup-confirm-error')?.textContent).toContain('do not match');
    expect(document.activeElement?.id).toBe('setup-confirm');
    http.expectNone(SETUP);

    type('setup-confirm', 'correct horse 1');
    type('setup-name', ' ');
    await submit('form[aria-labelledby="setup-password-title"]');
    expect(text()).toContain('Enter your name and email.');
    http.expectNone(SETUP);
  });

  it('sends the username lower-cased with the password, and shows the policy error the API gives', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    fill();
    type('setup-username', 'Ada.L');
    type('setup-password', 'password1234');
    type('setup-confirm', 'password1234');
    await submit('form[aria-labelledby="setup-password-title"]');
    const req = http.expectOne(SETUP);
    expect(req.request.body).toEqual({
      name: 'Ada Admin',
      email: 'ada@example.com',
      username: 'ada.l',
      password: 'password1234',
    });
    req.flush(
      { error: { code: 'password_rejected', message: 'That password is too common.' } },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle(fixture);
    expect(root().querySelector('#setup-password-error')?.textContent).toContain('too common');
  });

  it('shows a taken username on the username field', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    fill();
    type('setup-username', 'ada');
    type('setup-password', 'password1234');
    type('setup-confirm', 'password1234');
    await submit('form[aria-labelledby="setup-password-title"]');
    http
      .expectOne(SETUP)
      .flush(
        { error: { code: 'username_taken', message: 'That username is taken.' } },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(input('setup-username').getAttribute('aria-invalid')).toBe('true');
    expect(root().querySelector('#setup-username-error')?.textContent).toContain('taken');
  });

  it('offers to go to sign-in when someone else finished setup first', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    fill();
    type('setup-username', 'ada');
    type('setup-password', 'password1234');
    type('setup-confirm', 'password1234');
    await submit('form[aria-labelledby="setup-password-title"]');
    http
      .expectOne(SETUP)
      .flush(
        { error: { code: 'setup_closed', message: 'Setup is finished.' } },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(root().querySelector('a[href="/sign-in"]')?.textContent).toContain('Go to sign-in');
  });

  it('signs the admin in with the password, then creates the first project', async () => {
    open([{ id: 'password', label: 'Password', kind: 'password' }]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill();
    type('setup-username', 'ada');
    type('setup-password', 'password1234');
    type('setup-confirm', 'password1234');
    await submit('form[aria-labelledby="setup-password-title"]');
    http
      .expectOne(SETUP)
      .flush(
        { user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' } },
        { status: 201, statusText: 'Created' },
      );
    await settle(fixture);
    // The first project is made next; the navigation follows its answer.
    expect(http.expectOne(`${API_BASE}/projects`).request.body).toEqual({ name: 'My project' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the passkey path: its name and email check still runs first', async () => {
    open([{ id: 'passkey', label: 'Passkey', kind: 'passkey' }]);
    root()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(root().querySelector('#setup-error')?.textContent).toContain('Enter your name and email.');
    http.expectNone(`${API_BASE}/auth/setup/options`);
  });

  it('shows the passkey refusal when browsers cannot do passkeys', () => {
    passkeysSupported = false;
    open([{ id: 'passkey', label: 'Passkey', kind: 'passkey' }]);
    expect(text()).toContain('This browser does not support passkeys');
    expect(text()).not.toContain('Create passkey');
  });
});
