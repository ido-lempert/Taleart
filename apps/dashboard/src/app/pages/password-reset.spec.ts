import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../auth';
import { API_BASE } from '../dashboard.store';
import { PasswordResetPage } from './password-reset';

const TOKEN = 'reset-token';
const link = `${API_BASE}/auth/password-resets/${TOKEN}`;
const PREVIEW = { name: 'Ada Admin', usernameRequired: false, expiresAt: '2026-10-30T10:00:00.000Z' };
// The page reads the sign-in methods with the link; these are the ones the answer lists.
const METHODS = [
  { id: 'passkey', label: 'Passkey', kind: 'passkey' },
  { id: 'password', label: 'Password', kind: 'password' },
];

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('PasswordResetPage: /reset/<token>', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<PasswordResetPage>;

  function answerState(): void {
    for (const req of http.match(`${API_BASE}/auth/state`))
      req.flush({ setupRequired: false, user: null, methods: METHODS });
  }
  const root = () => fixture.nativeElement as HTMLElement;
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  async function open(preview: object = PREVIEW): Promise<void> {
    fixture = TestBed.createComponent(PasswordResetPage);
    fixture.componentRef.setInput('token', TOKEN);
    document.body.appendChild(root());
    fixture.detectChanges();
    answerState();
    http.expectOne(link).flush(preview);
    await settle(fixture);
  }

  function submit(): void {
    root()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
  }


  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordResetPage],
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

  it('keeps the methods list after a reset on a fresh page, which read no state before', async () => {
    const methods = [
      { id: 'passkey', label: 'Passkey', kind: 'passkey' },
      { id: 'password', label: 'Password', kind: 'password' },
    ];
    fixture = TestBed.createComponent(PasswordResetPage);
    fixture.componentRef.setInput('token', TOKEN);
    document.body.appendChild(root());
    fixture.detectChanges();
    for (const req of http.match(`${API_BASE}/auth/state`)) {
      req.flush({ setupRequired: false, user: null, methods });
    }
    answerState();
    http.expectOne(link).flush(PREVIEW);
    await settle(fixture);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('reset-password', 'correct horse 1');
    type('reset-confirm', 'correct horse 1');
    submit();
    await settle(fixture);
    http
      .expectOne(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`)
      .flush(
        { user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' } },
        { status: 200, statusText: 'OK' },
      );
    await settle(fixture);
    expect(TestBed.inject(AuthStore).state()?.methods).toEqual(methods);
  });

  it('previews whose password the link sets, and asks for no username when the user has one', async () => {
    await open();
    expect(root().querySelector('h1')?.textContent).toContain('Set a new password for Ada Admin');
    expect(input('reset-username')).toBeNull();
    expect(input('reset-password').getAttribute('autocomplete')).toBe('new-password');
    expect(root().querySelector('label[for="reset-password"]')?.textContent?.trim()).toBe('Password');
  });

  it('links the Terms of service and the Privacy policy on the docs site', async () => {
    await open();
    const links = [...root().querySelectorAll<HTMLAnchorElement>('.auth-card__legal a')];
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Terms of service', 'https://taleart.lempert.site/legal/terms'],
      ['Privacy policy', 'https://taleart.lempert.site/legal/privacy'],
    ]);
  });

  it('asks for a username when the user has no password yet', async () => {
    await open({ ...PREVIEW, usernameRequired: true });
    expect(input('reset-username').getAttribute('autocomplete')).toBe('username');
  });

  it('shows the no-longer-valid state for an unknown, used or expired link', async () => {
    fixture = TestBed.createComponent(PasswordResetPage);
    fixture.componentRef.setInput('token', TOKEN);
    document.body.appendChild(root());
    fixture.detectChanges();
    answerState();
    http
      .expectOne(link)
      .flush({ error: { code: 'password_reset_invalid', message: 'Gone.' } }, { status: 410, statusText: 'Gone' });
    await settle(fixture);
    expect(root().querySelector('h1')?.textContent).toContain('no longer valid');
    expect(root().querySelector('form')).toBeNull();
  });

  it('refuses a short password inline, without a request', async () => {
    await open();
    type('reset-password', 'short');
    type('reset-confirm', 'short');
    submit();
    await settle(fixture);
    expect(root().querySelector('#reset-password-error')?.textContent).toContain('Use at least 12 characters.');
    http.expectNone(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`);
  });

  it('sends the new password only, and signs in on success', async () => {
    await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('reset-password', 'correct horse 1');
    type('reset-confirm', 'correct horse 1');
    submit();
    await settle(fixture);
    const req = http.expectOne(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`);
    expect(req.request.body).toEqual({ password: 'correct horse 1' });
    req.flush(
      { user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' } },
      { status: 200, statusText: 'OK' },
    );
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/zones');
  });

  it('sends the username with the password when the user has none yet', async () => {
    await open({ ...PREVIEW, usernameRequired: true });
    type('reset-username', 'Ada.L');
    type('reset-password', 'correct horse 1');
    type('reset-confirm', 'correct horse 1');
    submit();
    await settle(fixture);
    expect(http.expectOne(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`).request.body).toEqual({
      username: 'ada.l',
      password: 'correct horse 1',
    });
  });

  it('shows the policy refusal of the API on the password field', async () => {
    await open();
    type('reset-password', 'password1234');
    type('reset-confirm', 'password1234');
    submit();
    await settle(fixture);
    http
      .expectOne(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`)
      .flush(
        { error: { code: 'password_rejected', message: 'Pick a less common password.' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await settle(fixture);
    expect(root().querySelector('#reset-password-error')?.textContent).toContain('less common');
  });

  it('shows the no-longer-valid state when the link is used up while the form is open', async () => {
    await open();
    type('reset-password', 'correct horse 1');
    type('reset-confirm', 'correct horse 1');
    submit();
    await settle(fixture);
    http
      .expectOne(`${API_BASE}/auth/password-resets/${TOKEN}/redeem`)
      .flush({ error: { code: 'password_reset_invalid', message: 'Gone.' } }, { status: 410, statusText: 'Gone' });
    await settle(fixture);
    expect(root().querySelector('h1')?.textContent).toContain('no longer valid');
  });
});
