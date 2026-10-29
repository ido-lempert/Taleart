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
