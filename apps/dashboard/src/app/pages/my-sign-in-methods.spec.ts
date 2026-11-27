import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthStore } from '../auth';
import { API_BASE } from '../dashboard.store';
import { MySignInMethodsPage } from './my-sign-in-methods';

const ACCOUNT = `${API_BASE}/auth/account`;
const PASSKEY = { id: 'p1', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null };
const IDENTITY = {
  id: 'i1',
  provider: 'google',
  email: 'ada@example.com',
  createdAt: '2026-10-02T10:00:00.000Z',
  lastUsedAt: null,
};
const METHODS = [
  { id: 'passkey', label: 'Passkey', kind: 'passkey' },
  { id: 'password', label: 'Password', kind: 'password' },
  { id: 'google', label: 'Google', kind: 'google' },
  { id: 'oidc:corp', label: 'Corp ID', kind: 'oidc' },
];

// The query of the page's route, set per test before the page is created.
let routeQuery: Record<string, string> = {};

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('MySignInMethodsPage: Settings > My sign-in methods', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<MySignInMethodsPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  const doc = () => document;

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  function clickById(id: string, scope: ParentNode = doc()): void {
    scope.querySelector<HTMLButtonElement>(`#${id}`)?.click();
  }

  function submitDrawer(): void {
    document.querySelector('.drawer form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  async function open(
    account: object = { passkeys: [PASSKEY], password: null, identities: [IDENTITY] },
  ): Promise<void> {
    TestBed.inject(AuthStore).state.set({ setupRequired: false, user: null, methods: METHODS as never });
    fixture = TestBed.createComponent(MySignInMethodsPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(`${ACCOUNT}/methods`).flush(account);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MySignInMethodsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { queryParamMap: convertToParamMap(routeQuery) } }) },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
    routeQuery = {};
    vi.restoreAllMocks();
  });

  it('lists the passkeys, the password and the linked providers', async () => {
    await open();
    expect(text()).toContain('Passkey added');
    expect(text()).toContain('Not used yet');
    expect(text()).toContain('You have no password.');
    expect(text()).toContain('Google');
    expect(text()).toContain('ada@example.com');
  });

  it('offers to link only the providers the account has not linked yet, through the link purpose', async () => {
    await open();
    const links = [...root().querySelectorAll<HTMLAnchorElement>('a.btn')];
    expect(links.map((a) => a.textContent?.trim())).toEqual(['Continue with Corp ID']);
    expect(links[0]?.getAttribute('href')).toBe(`${API_BASE}/auth/providers/corp/start?purpose=link`);
  });

  it('shows the password with its username, and offers to change or remove it', async () => {
    await open({ passkeys: [], password: { username: 'ada', updatedAt: '2026-10-03T10:00:00.000Z' }, identities: [] });
    expect(text()).toContain('Username ada');
    expect(root().querySelector('#password-change')?.textContent).toContain('Change password');
    expect(root().querySelector('#password-remove')?.textContent).toContain('Remove password');
  });

  it('explains a refused removal of the last method, and keeps the confirmation open', async () => {
    await open({ passkeys: [PASSKEY], password: null, identities: [] });
    root().querySelector<HTMLButtonElement>('[aria-label^="Remove passkey"]')?.click();
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    clickById('my-removal-confirm');
    http
      .expectOne(`${ACCOUNT}/passkeys/p1`)
      .flush({ error: { code: 'last_sign_in_method', message: 'Last.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain(
      'Keep at least one sign-in method',
    );
  });

  it('removes a passkey after a confirmation, then reads the methods again', async () => {
    await open({ passkeys: [PASSKEY, { ...PASSKEY, id: 'p2' }], password: null, identities: [] });
    root().querySelector<HTMLButtonElement>('[aria-label^="Remove passkey"]')?.click();
    await settle(fixture);
    clickById('my-removal-confirm');
    http.expectOne(`${ACCOUNT}/passkeys/p1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http
      .expectOne(`${ACCOUNT}/methods`)
      .flush({ passkeys: [{ ...PASSKEY, id: 'p2' }], password: null, identities: [] });
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(root().querySelectorAll('[aria-label^="Remove passkey"]').length).toBe(1);
  });

  it('unlinks a provider and explains it from the removal text', async () => {
    await open();
    root().querySelector<HTMLButtonElement>('[aria-label="Unlink Google"]')?.click();
    await settle(fixture);
    expect(text()).toContain('Unlink Google? You will no longer sign in with it.');
    clickById('my-removal-confirm');
    http.expectOne(`${ACCOUNT}/identities/i1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http.expectOne(`${ACCOUNT}/methods`).flush({ passkeys: [PASSKEY], password: null, identities: [] });
    await settle(fixture);
    expect(text()).toContain('No provider is linked to your account.');
  });

  it('sets a password with a username when the account has none, and refuses an empty form', async () => {
    await open();
    clickById('password-set');
    await settle(fixture);
    submitDrawer();
    await settle(fixture);
    expect(input('my-password-username').getAttribute('autocomplete')).toBe('username');
    expect(root().querySelector('#my-password-username-error')?.textContent).toContain('Enter a username.');
    expect(document.querySelector('#my-password-current')).toBeNull();
    http.expectNone(`${ACCOUNT}/password`);
  });

  it('sets the password: the body carries the lower-cased username and the new password', async () => {
    await open();
    clickById('password-set');
    await settle(fixture);
    type('my-password-username', 'Ada');
    type('my-password-password', 'correct horse 1');
    type('my-password-confirm', 'correct horse 1');
    submitDrawer();
    await settle(fixture);
    const req = http.expectOne(`${ACCOUNT}/password`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ username: 'ada', password: 'correct horse 1' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http.expectOne(`${ACCOUNT}/methods`).flush({ passkeys: [PASSKEY], password: null, identities: [IDENTITY] });
    await settle(fixture);
    expect(document.querySelector('.drawer')).toBeNull();
  });

  it('changes the password: it asks for the current one first, and says when it is wrong', async () => {
    await open({ passkeys: [], password: { username: 'ada', updatedAt: '2026-10-03T10:00:00.000Z' }, identities: [] });
    clickById('password-change');
    await settle(fixture);
    expect(root().querySelector('#my-password-username')).toBeNull();
    type('my-password-password', 'correct horse 2');
    type('my-password-confirm', 'correct horse 2');
    submitDrawer();
    await settle(fixture);
    expect(root().querySelector('#my-password-current-error')?.textContent).toContain('Enter your current password.');
    type('my-password-current', 'old password here');
    submitDrawer();
    await settle(fixture);
    const req = http.expectOne(`${ACCOUNT}/password`);
    expect(req.request.body).toEqual({ currentPassword: 'old password here', password: 'correct horse 2' });
    req.flush({ error: { code: 'password_incorrect', message: 'Wrong.' } }, { status: 403, statusText: 'Forbidden' });
    await settle(fixture);
    expect(root().querySelector('#my-password-current-error')?.textContent).toContain('not your current password');
    expect(root().querySelector('#my-password-current')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the policy refusal on the password field', async () => {
    await open({ passkeys: [], password: { username: 'ada', updatedAt: '2026-10-03T10:00:00.000Z' }, identities: [] });
    clickById('password-change');
    await settle(fixture);
    type('my-password-current', 'old password here');
    type('my-password-password', 'password1234');
    type('my-password-confirm', 'password1234');
    submitDrawer();
    await settle(fixture);
    http
      .expectOne(`${ACCOUNT}/password`)
      .flush(
        { error: { code: 'password_rejected', message: 'Too common.' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    expect(root().querySelector('#my-password-password-error')?.textContent).toContain('Too common.');
  });

  it('explains a refused password removal as the last method', async () => {
    await open({ passkeys: [], password: { username: 'ada', updatedAt: '2026-10-03T10:00:00.000Z' }, identities: [] });
    clickById('password-remove');
    await settle(fixture);
    clickById('my-removal-confirm');
    http
      .expectOne(`${ACCOUNT}/password`)
      .flush({ error: { code: 'last_sign_in_method', message: 'Last.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain(
      'Keep at least one sign-in method',
    );
  });

  it('shows the friendly message of a failed provider link', async () => {
    routeQuery = { auth_error: 'email_taken' };
    await open();
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('already exists');
  });

  it('offers a retry when the methods cannot be read', async () => {
    TestBed.inject(AuthStore).state.set({ setupRequired: false, user: null, methods: [] });
    fixture = TestBed.createComponent(MySignInMethodsPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(`${ACCOUNT}/methods`).flush({}, { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    expect(text()).toContain('could not be read');
    expect(root().querySelector('button')?.textContent).toContain('Retry');
  });
});

describe('MySignInMethodsPage: the authenticator app section', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<MySignInMethodsPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const TWO_FACTOR = `${ACCOUNT}/two-factor`;
  const ENROLMENT = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/TaleArt:ada?secret=JBSWY3DPEHPK3PXP' };
  const CODES = [
    'a2b3c-d4e5f',
    'g6h7j-k8m9n',
    'p2q3r-s4t5u',
    'v6w7x-y8z2a',
    'b3c4d-e5f6g',
    'h7j8k-m9n2p',
    'q3r4s-t5u6v',
    'w7x8y-z2a3b',
    'c4d5e-f6g7h',
    'j8k9m-n2p3q',
  ];

  async function openAccount(enrolled: boolean, recoveryCodesLeft = enrolled ? 10 : 0): Promise<void> {
    TestBed.inject(AuthStore).state.set({ setupRequired: false, user: null, methods: METHODS as never });
    fixture = TestBed.createComponent(MySignInMethodsPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(`${ACCOUNT}/methods`).flush({ passkeys: [PASSKEY], password: null, identities: [IDENTITY] });
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'GET' }).flush({ enrolled, recoveryCodesLeft });
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MySignInMethodsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { queryParamMap: convertToParamMap({}) } }) },
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

  it('shows Not set up with a Set up button when no authenticator app is on', async () => {
    await openAccount(false);
    expect(root().querySelector('#two-factor-state')?.textContent).toBe('Not set up');
    expect(root().querySelector('#two-factor-set-up')?.textContent).toContain('Set up');
  });

  it('shows On when the authenticator app is on', async () => {
    await openAccount(true);
    expect(root().querySelector('#two-factor-state')?.textContent).toBe('On');
    expect(root().querySelector('#two-factor-set-up')).toBeNull();
  });

  it('starts the set-up and shows the secret key in groups of four and the address', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'POST' }).flush(ENROLMENT);
    await settle(fixture);
    expect(root().querySelector('#two-factor-secret')?.textContent).toBe('JBSW Y3DP EHPK 3PXP');
    expect(root().querySelector('#two-factor-uri')?.textContent).toBe(ENROLMENT.otpauthUri);
    expect(root().querySelector('#two-factor-copy')?.textContent).toContain('Copy key');
  });

  it('explains that the server has no secret key when the set-up is refused with 503', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http
      .expectOne({ url: TWO_FACTOR, method: 'POST' })
      .flush({ error: { code: 'secret_key_missing', message: 'No key.' } }, { status: 503, statusText: 'Service Unavailable' });
    await settle(fixture);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain(
      "Two-factor sign-in needs the server's secret key (TALEART_SECRET_KEY) to be set.",
    );
  });

  it('turns the authenticator app on with a code from it, and shows On', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'POST' }).flush(ENROLMENT);
    await settle(fixture);
    const code = root().querySelector<HTMLInputElement>('#two-factor-code') as HTMLInputElement;
    code.value = '123 456';
    code.dispatchEvent(new Event('input'));
    root()
      .querySelector('#two-factor-form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    const req = http.expectOne(`${ACCOUNT}/two-factor/confirm`);
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush({ recoveryCodes: CODES }, { status: 200, statusText: 'OK' });
    await settle(fixture);
    expect(root().querySelector('#two-factor-state')?.textContent).toBe('On');
    expect(root().querySelector('#two-factor-form')).toBeNull();
  });

  it('shows the ten recovery codes once the app is on, with the warning, until the user says they saved them', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'POST' }).flush(ENROLMENT);
    await settle(fixture);
    root().querySelector<HTMLInputElement>('#two-factor-code')!.value = '123456';
    root().querySelector<HTMLInputElement>('#two-factor-code')!.dispatchEvent(new Event('input'));
    root().querySelector('#two-factor-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http.expectOne(`${ACCOUNT}/two-factor/confirm`).flush({ recoveryCodes: CODES }, { status: 200, statusText: 'OK' });
    await settle(fixture);

    const items = [...root().querySelectorAll('#recovery-codes-list li')].map((li) => li.textContent);
    expect(items).toEqual(CODES);
    expect(text()).toContain('Save these codes now. Each works once if you lose your phone. They are not shown again.');
    expect(root().querySelector('#two-factor-left')?.textContent).toBe('10 recovery codes left');

    root().querySelector<HTMLButtonElement>('#recovery-codes-saved')?.click();
    await settle(fixture);
    expect(root().querySelector('#recovery-codes')).toBeNull();
    expect(root().querySelector('#two-factor-state')?.textContent).toBe('On');
  });

  it('copies all the recovery codes, one to a line', async () => {
    await openAccount(true);
    const enrolledStatus = root().querySelector('#two-factor-left');
    expect(enrolledStatus?.textContent).toBe('10 recovery codes left');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    root().querySelector<HTMLButtonElement>('#two-factor-regenerate-start')?.click();
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#two-factor-regenerate')?.click();
    await settle(fixture);
    http.expectOne({ url: `${ACCOUNT}/two-factor/recovery-codes`, method: 'POST' }).flush({ recoveryCodes: CODES });
    await settle(fixture);

    root().querySelector<HTMLButtonElement>('#recovery-codes-copy')?.click();
    await settle(fixture);
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
  });

  it('downloads the recovery codes as a text file', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'POST' }).flush(ENROLMENT);
    await settle(fixture);
    root().querySelector<HTMLInputElement>('#two-factor-code')!.value = '123456';
    root().querySelector<HTMLInputElement>('#two-factor-code')!.dispatchEvent(new Event('input'));
    root().querySelector('#two-factor-form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http.expectOne(`${ACCOUNT}/two-factor/confirm`).flush({ recoveryCodes: CODES }, { status: 200, statusText: 'OK' });
    await settle(fixture);

    URL.createObjectURL = vi.fn(() => 'blob:recovery-codes');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    root().querySelector<HTMLButtonElement>('#recovery-codes-download')?.click();
    await settle(fixture);

    expect(click).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/plain');
    const body = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(body).toBe(`${CODES.join('\n')}\n`);
  });

  it('says how many recovery codes are left when the app is on', async () => {
    await openAccount(true, 1);
    expect(root().querySelector('#two-factor-left')?.textContent).toBe('1 recovery code left');
  });

  it('asks for a second click before making new codes, then shows the new codes and the count of ten', async () => {
    await openAccount(true, 3);
    expect(root().querySelector('#two-factor-left')?.textContent).toBe('3 recovery codes left');

    root().querySelector<HTMLButtonElement>('#two-factor-regenerate-start')?.click();
    await settle(fixture);
    expect(root().querySelector('#two-factor-regenerate')?.textContent).toContain(
      'Really make new codes? The old ones stop working',
    );
    http.expectNone(`${ACCOUNT}/two-factor/recovery-codes`);

    root().querySelector<HTMLButtonElement>('#two-factor-regenerate')?.click();
    await settle(fixture);
    http.expectOne({ url: `${ACCOUNT}/two-factor/recovery-codes`, method: 'POST' }).flush({ recoveryCodes: CODES });
    await settle(fixture);

    expect([...root().querySelectorAll('#recovery-codes-list li')].map((li) => li.textContent)).toEqual(CODES);
    expect(root().querySelector('#two-factor-left')?.textContent).toBe('10 recovery codes left');
    expect(root().querySelector('#two-factor-regenerate-start')).not.toBeNull();
  });

  it('reads the status again when new codes are refused because no app is on', async () => {
    await openAccount(true, 3);
    root().querySelector<HTMLButtonElement>('#two-factor-regenerate-start')?.click();
    await settle(fixture);
    root().querySelector<HTMLButtonElement>('#two-factor-regenerate')?.click();
    await settle(fixture);
    http
      .expectOne({ url: `${ACCOUNT}/two-factor/recovery-codes`, method: 'POST' })
      .flush({ error: { code: 'two_factor_not_started', message: 'Not started.' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'GET' }).flush({ enrolled: false, recoveryCodesLeft: 0 });
    await settle(fixture);
    expect(root().querySelector('#two-factor-state')?.textContent).toBe('Not set up');
    expect(root().querySelector('#recovery-codes')).toBeNull();
  });

  it('says a wrong code is not right and keeps the set-up open', async () => {
    await openAccount(false);
    root().querySelector<HTMLButtonElement>('#two-factor-set-up')?.click();
    await settle(fixture);
    http.expectOne({ url: TWO_FACTOR, method: 'POST' }).flush(ENROLMENT);
    await settle(fixture);
    const code = root().querySelector<HTMLInputElement>('#two-factor-code') as HTMLInputElement;
    code.value = '000000';
    code.dispatchEvent(new Event('input'));
    root()
      .querySelector('#two-factor-form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http
      .expectOne(`${ACCOUNT}/two-factor/confirm`)
      .flush({ error: { code: 'two_factor_code_invalid', message: 'Wrong.' } }, { status: 401, statusText: 'Unauthorized' });
    await settle(fixture);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('That code is not right.');
    expect(root().querySelector('#two-factor-form')).not.toBeNull();
  });
});
