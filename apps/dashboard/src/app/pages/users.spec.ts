import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStore } from '../auth';
import { API_BASE } from '../dashboard.store';
import { UsersPage } from './users';

const USERS = `${API_BASE}/users`;
const SETTINGS = `${API_BASE}/auth/settings`;
const ADMIN_ROW = {
  id: 'u1',
  name: 'Ada Admin',
  email: 'ada@example.com',
  role: 'admin',
  createdAt: '2026-10-01T10:00:00.000Z',
  methods: { passkey: true, password: false, identities: [] },
  projects: 3,
  projectRoles: [],
};
const MANAGER_ROW = {
  id: 'u2',
  name: 'Grace Manager',
  email: 'grace@example.com',
  role: 'content_manager',
  createdAt: '2026-10-02T10:00:00.000Z',
  methods: { passkey: false, password: true, identities: ['google', 'oidc:corp'] },
  projects: 2,
  projectRoles: [
    { projectId: 'p1', projectName: 'Acme', role: 'publisher', expiresAt: null, expired: false },
    { projectId: 'p2', projectName: 'Globex', role: 'viewer', expiresAt: '2026-12-12T23:59:59.000Z', expired: false },
  ],
};
const METHODS = [
  { id: 'passkey', label: 'Passkey', kind: 'passkey' },
  { id: 'password', label: 'Password', kind: 'password' },
  { id: 'google', label: 'Google', kind: 'google' },
  { id: 'oidc:corp', label: 'Corp ID', kind: 'oidc' },
];
const SETTINGS_ON = { passkeyEnabled: true, passwordEnabled: true, secretKeyConfigured: true };
const SETTINGS_OFF = { passkeyEnabled: true, passwordEnabled: false, secretKeyConfigured: true };

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('UsersPage: Settings > Users (admins)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<UsersPage>;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const row = (name: string) =>
    [...root().querySelectorAll('tbody tr')].find((r) => r.textContent?.includes(name)) as HTMLElement;
  const resetButton = (name: string) => row(name)?.querySelector<HTMLButtonElement>('button') ?? null;

  /** Opens the page as an admin (or another role) and answers its reads. */
  function open(
    list: object | null = { users: [ADMIN_ROW, MANAGER_ROW], truncated: false },
    settings: object = SETTINGS_ON,
    role = 'admin',
  ): void {
    const auth = TestBed.inject(AuthStore);
    auth.user.set({ id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role } as never);
    auth.state.set({ setupRequired: false, user: null, methods: METHODS as never });
    fixture = TestBed.createComponent(UsersPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    if (role !== 'admin') return;
    if (list === null) http.expectOne(USERS).flush({}, { status: 500, statusText: 'Server Error' });
    else http.expectOne(USERS).flush(list);
    http.expectOne(SETTINGS).flush(settings);
  }

  async function ready(list?: object, settings?: object): Promise<void> {
    open(list, settings);
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UsersPage],
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

  it('lists each user with role, sign-in methods and projects; an admin reaches all projects', async () => {
    await ready();
    // The cells after the name: email, role, sign-in methods, projects, actions.
    const cells = (name: string) => [...row(name).querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells('Ada Admin')).toEqual(['ada@example.com', 'Admin', 'Passkey', 'All projects', 'Issue reset link']);
    expect(cells('Grace Manager')).toEqual([
      'grace@example.com',
      'Content manager',
      'Password, Google, Corp ID',
      expect.stringContaining('Acme: Publisher'),
      'Issue reset link',
    ]);
    // Each project with the user's role in it, and when the access ends.
    const projects = [...row('Grace Manager').querySelectorAll('.users-projects li')].map((li) => li.textContent);
    expect(projects).toEqual(['Acme: Publisher', 'Globex: Viewer (until 12 Dec 2026)']);
  });

  it('has a named table with column headers, and names every reset button after its user', async () => {
    await ready();
    const table = root().querySelector('table');
    expect(table?.querySelector('caption')?.textContent).toContain('Users of this install');
    expect([...(table?.querySelectorAll('thead th') ?? [])].every((th) => th.getAttribute('scope') === 'col')).toBe(
      true,
    );
    expect(root().querySelector('[aria-label="Issue reset link for Grace Manager"]')).not.toBeNull();
  });

  it('issues a reset link from a row, once the password method is on', async () => {
    await ready();
    expect(resetButton('Grace Manager')?.disabled).toBe(false);
    resetButton('Grace Manager')?.click();
    await settle(fixture);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Reset link for Grace Manager');
    expect(dialog?.textContent).toContain('Create a one-time link for Grace Manager');
  });

  it('disables the reset buttons with a note when the password method is off', async () => {
    await ready(undefined, SETTINGS_OFF);
    const button = resetButton('Grace Manager');
    expect(button?.disabled).toBe(true);
    const note = root().querySelector('#users-password-off');
    expect(note?.textContent).toContain('Turn it on under Sign-in methods');
    expect(button?.getAttribute('aria-describedby')).toBe('users-password-off');
  });

  it('says when the list is truncated', async () => {
    await ready({ users: [ADMIN_ROW], truncated: true });
    expect(text()).toContain('Only the first 500 users are listed.');
  });

  it('shows an empty state with no users', async () => {
    await ready({ users: [], truncated: false });
    expect(root().querySelector('#users-empty')?.textContent).toContain('No users yet.');
    expect(root().querySelector('table')).toBeNull();
  });

  it('offers a retry when the users cannot be read, and reads them again', async () => {
    open(null);
    await settle(fixture);
    expect(root().querySelector('[role="alert"]')?.textContent).toContain('could not be read');
    root().querySelector<HTMLButtonElement>('[role="alert"] ~ *, button')?.focus();
    [...root().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Retry')?.click();
    http.expectOne(USERS).flush({ users: [ADMIN_ROW], truncated: false });
    http.expectOne(SETTINGS).flush(SETTINGS_ON);
    await settle(fixture);
    expect(row('Ada Admin')).toBeTruthy();
  });

  it('tells a content manager they cannot see the users, and makes no request', async () => {
    open(null, SETTINGS_ON, 'content_manager');
    await settle(fixture);
    expect(text()).toContain('Only admins can see the users of this install.');
    expect(root().querySelector('table')).toBeNull();
  });
});
