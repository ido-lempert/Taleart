import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthStore, PasskeyClient } from '../auth';
import { API_BASE } from '../dashboard.store';
import { InvitePage } from './invite';

const PREVIEW = { projectName: 'Acme', expiresAt: '2026-11-05T10:00:00.000Z' };
const STATE = {
  setupRequired: false,
  user: null,
  methods: [
    { id: 'passkey', label: 'Passkey', kind: 'passkey' },
    { id: 'password', label: 'Password', kind: 'password' },
    { id: 'google', label: 'Google', kind: 'google' },
  ],
};
const invitation = `${API_BASE}/auth/invitations/tok`;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('InvitePage: joining by invitation with a passkey, a password or a provider', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<InvitePage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const input = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

  function type(id: string, value: string): void {
    input(id).value = value;
    input(id).dispatchEvent(new Event('input'));
  }

  async function open(methods: readonly unknown[], preview: object = PREVIEW): Promise<void> {
    fixture = TestBed.createComponent(InvitePage);
    TestBed.inject(AuthStore).state.set({ setupRequired: false, user: null, methods: methods as never });
    fixture.componentRef.setInput('token', 'tok');
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(invitation).flush(preview);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvitePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PasskeyClient, useFactory: () => ({ supported: () => true }) },
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

  it('shows every method the state lists on a fresh visit to the link, with no state read before', async () => {
    // Nothing has read /auth/state yet: the page must read it itself.
    fixture = TestBed.createComponent(InvitePage);
    fixture.componentRef.setInput('token', 'tok');
    document.body.appendChild(root());
    fixture.detectChanges();
    for (const req of http.match(`${API_BASE}/auth/state`)) req.flush(STATE);
    for (const req of http.match(invitation)) req.flush(PREVIEW);
    await settle(fixture);
    expect(text()).toContain('Create passkey');
    expect(input('invite-password')).not.toBeNull();
    expect(root().querySelector<HTMLAnchorElement>('a[href*="/providers/google/start"]')?.textContent?.trim()).toBe(
      'Continue with Google',
    );
  });

  it('says it is opening the invitation, then that it could not reach the API when the methods cannot be read', async () => {
    fixture = TestBed.createComponent(InvitePage);
    fixture.componentRef.setInput('token', 'tok');
    document.body.appendChild(root());
    fixture.detectChanges();
    expect(text()).toContain('Opening your invitation');
    for (const req of http.match(`${API_BASE}/auth/state`)) req.flush({}, { status: 500, statusText: 'Server Error' });
    for (const req of http.match(invitation)) req.flush(PREVIEW);
    await settle(fixture);
    expect(root().querySelector('h1')?.textContent).toContain('Join TaleArt');
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Could not reach the API');
    expect(input('invite-password')).toBeNull();
  });

  it('names the project and offers each method that is on', async () => {
    await open([
      { id: 'passkey', label: 'Passkey', kind: 'passkey' },
      { id: 'password', label: 'Password', kind: 'password' },
      { id: 'oidc:corp', label: 'Corp ID', kind: 'oidc' },
    ]);
    expect(root().querySelector('h1')?.textContent).toContain('Join Acme on TaleArt');
    expect(text()).toContain('Create passkey');
    expect(input('invite-password')).not.toBeNull();
    const link = root().querySelector<HTMLAnchorElement>('a.btn');
    expect(link?.textContent?.trim()).toBe('Continue with Corp ID');
    type('invite-email', 'grace@example.com');
    await settle(fixture);
    expect(link?.getAttribute('href')).toBe(
      `${API_BASE}/auth/providers/corp/start?purpose=invitation&token=tok&email=grace%40example.com`,
    );
  });

  it('stops a provider click until the invitation email is filled and well-formed', async () => {
    await open([{ id: 'oidc:corp', label: 'Corp ID', kind: 'oidc' }]);
    const link = root().querySelector<HTMLAnchorElement>('a.btn') as HTMLAnchorElement;
    // Records whether the page refused the click, then cancels the navigation so the test page stays.
    const clicked = (): boolean => {
      let refused = false;
      const probe = (event: Event) => {
        refused = event.defaultPrevented;
        event.preventDefault();
      };
      link.addEventListener('click', probe);
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      link.removeEventListener('click', probe);
      return refused;
    };

    expect(clicked()).toBe(true);
    await settle(fixture);
    expect(root().querySelector('#invite-provider-error')?.textContent).toContain('Enter your email');

    type('invite-email', 'grace@example');
    await settle(fixture);
    expect(clicked()).toBe(true);
    await settle(fixture);
    expect(root().querySelector('#invite-provider-error')?.textContent).toContain('valid email');

    type('invite-email', 'grace@example.com');
    await settle(fixture);
    expect(clicked()).toBe(false);
    await settle(fixture);
    expect(root().querySelector('#invite-provider-error')).toBeNull();
  });

  it('refuses a mismatched confirmation inline, without a request', async () => {
    await open([{ id: 'password', label: 'Password', kind: 'password' }]);
    type('invite-name', 'Grace');
    type('invite-email', 'grace@example.com');
    type('invite-username', 'grace');
    type('invite-password', 'correct horse 1');
    type('invite-confirm', 'correct horse 2');
    root()
      .querySelector('form[aria-labelledby="invite-password-title"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(root().querySelector('#invite-confirm-error')?.textContent).toContain('do not match');
    expect(input('invite-confirm').getAttribute('aria-invalid')).toBe('true');
    http.expectNone(`${API_BASE}/auth/invitations/tok/password`);
  });

  it('joins with a password: the request carries the lower-cased username', async () => {
    await open([{ id: 'password', label: 'Password', kind: 'password' }]);
    type('invite-name', 'Grace');
    type('invite-email', 'grace@example.com');
    type('invite-username', 'Grace');
    type('invite-password', 'correct horse 1');
    type('invite-confirm', 'correct horse 1');
    root()
      .querySelector('form[aria-labelledby="invite-password-title"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    const req = http.expectOne(`${API_BASE}/auth/invitations/tok/password`);
    expect(req.request.body).toEqual({
      name: 'Grace',
      email: 'grace@example.com',
      username: 'grace',
      password: 'correct horse 1',
    });
    req.flush(
      { error: { code: 'username_taken', message: 'That username is taken.' } },
      { status: 409, statusText: 'Conflict' },
    );
    await settle(fixture);
    expect(root().querySelector('#invite-username-error')?.textContent).toContain('taken');
  });

  it('shows the invalid state when the invitation is used up while the password joins', async () => {
    await open([{ id: 'password', label: 'Password', kind: 'password' }]);
    type('invite-name', 'Grace');
    type('invite-email', 'grace@example.com');
    type('invite-username', 'grace');
    type('invite-password', 'correct horse 1');
    type('invite-confirm', 'correct horse 1');
    root()
      .querySelector('form[aria-labelledby="invite-password-title"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http
      .expectOne(`${API_BASE}/auth/invitations/tok/password`)
      .flush({ error: { code: 'invitation_invalid', message: 'Gone.' } }, { status: 410, statusText: 'Gone' });
    await settle(fixture);
    expect(root().querySelector('h1')?.textContent).toContain('no longer valid');
  });

  it('joins with a password and goes to the zones', async () => {
    await open([{ id: 'password', label: 'Password', kind: 'password' }]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('invite-name', 'Grace');
    type('invite-email', 'grace@example.com');
    type('invite-username', 'grace');
    type('invite-password', 'correct horse 1');
    type('invite-confirm', 'correct horse 1');
    root()
      .querySelector('form[aria-labelledby="invite-password-title"]')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http
      .expectOne(`${API_BASE}/auth/invitations/tok/password`)
      .flush(
        { user: { id: 'u2', name: 'Grace', email: 'grace@example.com', role: 'content_manager' } },
        { status: 201, statusText: 'Created' },
      );
    await settle(fixture);
    expect(navigate).toHaveBeenCalledWith('/zones');
  });
});
