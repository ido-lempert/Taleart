import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PendingInvitation, ProjectAuditEntry, ProjectMember, ProjectRole } from '@taleart/contract/core';
import { CreateDrawer } from '../create-drawer';
import { API_BASE, DashboardStore, type DrawerRequest } from '../dashboard.store';
import { TeamPage } from './team';

const BASE = `${API_BASE}/projects/p1`;

const member = (over: Partial<ProjectMember>): ProjectMember => ({
  userId: 'u1',
  name: 'Dana Levi',
  email: 'dana@example.com',
  role: 'admin',
  globalRole: 'admin',
  expiresAt: null,
  expired: false,
  joinedAt: '2026-09-01T10:00:00.000Z',
  you: true,
  ...over,
});
const MEMBERS: ProjectMember[] = [
  member({}),
  member({
    userId: 'u2',
    name: 'Sam Cohen',
    email: 'sam@example.com',
    role: 'editor',
    globalRole: 'content_manager',
    you: false,
  }),
  member({
    userId: 'u3',
    name: 'Kim Park',
    email: 'kim@example.com',
    role: 'viewer',
    globalRole: 'content_manager',
    you: false,
    expiresAt: '2026-12-12T23:59:59.000Z',
  }),
  member({
    userId: 'u4',
    name: 'Noa Katz',
    email: 'noa@example.com',
    role: 'publisher',
    globalRole: 'content_manager',
    you: false,
    expiresAt: '2026-10-01T23:59:59.000Z',
    expired: true,
  }),
];
const INVITATIONS: PendingInvitation[] = [
  {
    id: 'i1',
    projectId: 'p1',
    role: 'publisher',
    accessExpiresAt: '2026-12-31T23:59:59.000Z',
    createdBy: { id: 'u1', name: 'Dana Levi' },
    createdAt: '2026-10-28T10:00:00.000Z',
    expiresAt: '2026-11-04T10:00:00.000Z',
  },
];
const AUDIT: ProjectAuditEntry[] = [
  {
    id: 'a2',
    action: 'role_changed',
    actorId: 'u1',
    actorName: 'Dana Levi',
    targetUserId: 'u2',
    targetEmail: 'sam@example.com',
    detail: { from: 'viewer', to: 'editor' },
    createdAt: '2026-10-29T10:00:00.000Z',
  },
  {
    id: 'a1',
    action: 'removed',
    actorId: 'u1',
    actorName: 'Dana Levi',
    targetUserId: 'u9',
    targetEmail: 'old@example.com',
    detail: { role: 'viewer' },
    createdAt: '2026-10-28T10:00:00.000Z',
  },
];

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('TeamPage: Settings > Team', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TeamPage>;
  let store: DashboardStore;
  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const row = (name: string) =>
    [...root().querySelectorAll('tbody tr')].find((r) =>
      r.querySelector('th')?.textContent?.includes(name),
    ) as HTMLElement;

  /** Opens the page as `role` in Acme and answers its reads (managers also read invitations and activity). */
  async function open(role: ProjectRole, members: ProjectMember[] = MEMBERS, invitations: PendingInvitation[] = INVITATIONS): Promise<void> {
    store.projects.set([{ id: 'p1', name: 'Spring Campaign', role }]);
    fixture = TestBed.createComponent(TeamPage);
    document.body.appendChild(root());
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush(members);
    if (role === 'admin') {
      await settle(fixture);
      http.expectOne(`${BASE}/invitations`).flush(invitations);
      await settle(fixture);
      http.expectOne(`${BASE}/audit-log`).flush({ entries: AUDIT, nextBefore: 'a1' });
    }
    await settle(fixture);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TeamPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DashboardStore);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('lists the members with role, access, joined date, a You marker and an Expired badge', async () => {
    await open('admin');
    expect(root().querySelector('h2')?.textContent).toBe('Team');
    expect(row('Dana Levi').textContent).toContain('You');
    expect(row('Sam Cohen').querySelector<HTMLSelectElement>('select')?.value).toBe('editor');
    expect(row('Kim Park').textContent).toContain('Until 12 Dec 2026');
    expect(row('Noa Katz').textContent).toContain('Expired');
    expect(row('Noa Katz').textContent).toContain('Ended 1 Oct 2026');
    expect(row('Sam Cohen').textContent).toContain('Permanent');
    expect(row('Sam Cohen').textContent).toContain('1 Sep 2026');
    expect(root().querySelector('#team-your-role')?.textContent).toBe('Admin');
  });

  it('shows the roles matrix with accessible check marks', async () => {
    await open('admin');
    const card = root().querySelector('[aria-labelledby="team-roles-title"]') as HTMLElement;
    const header = [...card.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(header).toEqual(['Can…', 'Viewer', 'Editor', 'Publisher', 'Admin']);
    const publish = card.querySelector('[data-permission="content.publish"]') as HTMLElement;
    const cells = [...publish.querySelectorAll('td')].map((td) => td.querySelector('.visually-hidden')?.textContent);
    expect(cells).toEqual(['Viewer cannot', 'Editor cannot', 'Publisher can', 'Admin can']);
    expect(card.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(card.textContent).toContain(
      'Editor: see everything (analytics included) and edit content and save drafts. Cannot publish',
    );
  });

  it('changes a role with the select and announces it', async () => {
    await open('admin');
    const select = row('Sam Cohen').querySelector('select') as HTMLSelectElement;
    expect(select.id).toBe('role-u2');
    expect(root().querySelector('label[for="role-u2"]')?.textContent).toContain('Role of Sam Cohen');
    select.value = 'publisher';
    select.dispatchEvent(new Event('change'));
    const req = http.expectOne(`${BASE}/members/u2`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'publisher' });
    req.flush({ ...MEMBERS[1], role: 'publisher' });
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: AUDIT, nextBefore: null });
    await settle(fixture);
    expect(text()).toContain('Sam Cohen is now Publisher.');
  });

  it('shows the last-admin refusal by the member and puts the old role back', async () => {
    await open('admin');
    const select = row('Dana Levi').querySelector('select') as HTMLSelectElement;
    select.value = 'viewer';
    select.dispatchEvent(new Event('change'));
    http
      .expectOne(`${BASE}/members/u1`)
      .flush(
        { error: { code: 'last_project_admin', message: 'A project needs at least one admin.' } },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(row('Dana Levi').querySelector('[role=alert]')?.textContent).toContain('needs at least one admin');
    expect(select.value).toBe('admin');
  });

  it('sets the end of access with a date, and makes it permanent again', async () => {
    await open('admin');
    expect(root().querySelector('input[type=date]')).toBeNull();
    (row('Sam Cohen').querySelector('[aria-label="Change access of Sam Cohen"]') as HTMLButtonElement).click();
    await settle(fixture);
    const ends = row('Sam Cohen').querySelector('input[type=date]') as HTMLInputElement;
    expect(document.activeElement).toBe(ends);
    ends.value = '2027-01-31';
    ends.dispatchEvent(new Event('change'));
    const req = http.expectOne(`${BASE}/members/u2`);
    expect(req.request.body).toEqual({ expiresAt: '2027-01-31T23:59:59.000Z' });
    req.flush({ ...MEMBERS[1], expiresAt: '2027-01-31T23:59:59.000Z' });
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: [], nextBefore: null });
    await settle(fixture);
    expect(row('Sam Cohen').textContent).toContain('Until 31 Jan 2027');
    expect(row('Sam Cohen').querySelector('input[type=date]')).toBeNull();

    (row('Sam Cohen').querySelector('[aria-label="Change access of Sam Cohen"]') as HTMLButtonElement).click();
    await settle(fixture);
    (row('Sam Cohen').querySelector('[aria-label="Make access of Sam Cohen permanent"]') as HTMLButtonElement).click();
    const clear = http.expectOne(`${BASE}/members/u2`);
    expect(clear.request.body).toEqual({ expiresAt: null });
    clear.flush({ ...MEMBERS[1], expiresAt: null });
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: [], nextBefore: null });
    await settle(fixture);
    expect(row('Sam Cohen').textContent).toContain('Permanent');
  });

  it('asks before removing a member, then removes them', async () => {
    await open('admin');
    (row('Kim Park').querySelector('[aria-label="Remove Kim Park"]') as HTMLButtonElement).click();
    await settle(fixture);
    const dialog = document.querySelector('[role=alertdialog]') as HTMLElement;
    expect(dialog.textContent).toContain('Remove Kim Park');
    http.expectNone(`${BASE}/members/u3`);
    (dialog.querySelector('#team-remove-confirm') as HTMLButtonElement).click();
    const req = http.expectOne(`${BASE}/members/u3`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: [], nextBefore: null });
    await settle(fixture);
    expect(row('Kim Park')).toBeUndefined();
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(text()).toContain('Kim Park removed from Spring Campaign.');
  });

  it('keeps the confirmation open and shows the API message when a removal is refused', async () => {
    await open('admin');
    (row('Dana Levi').querySelector('[aria-label="Remove Dana Levi"]') as HTMLButtonElement).click();
    await settle(fixture);
    (document.querySelector('#team-remove-confirm') as HTMLButtonElement).click();
    http
      .expectOne(`${BASE}/members/u1`)
      .flush(
        { error: { code: 'last_project_admin', message: 'A project needs at least one admin.' } },
        { status: 409, statusText: 'Conflict' },
      );
    await settle(fixture);
    expect(document.querySelector('[role=alertdialog] [role=alert]')?.textContent).toContain('at least one admin');
    expect(row('Dana Levi')).toBeDefined();
  });

  it('lists pending invitations and revokes one', async () => {
    await open('admin');
    const section = root().querySelector('[aria-labelledby="team-invitations-title"]') as HTMLElement;
    expect(section.textContent).toContain('Publisher');
    expect(section.textContent).toContain('Until 31 Dec 2026');
    expect(section.textContent).toContain('Dana Levi');
    (section.querySelector('button') as HTMLButtonElement).click();
    const req = http.expectOne(`${BASE}/invitations/i1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: [], nextBefore: null });
    await settle(fixture);
    expect(root().querySelector('#team-no-invitations')).not.toBeNull();
  });

  it('shows the activity as sentences, newest first, and loads more with nextBefore', async () => {
    await open('admin');
    const items = () => [...root().querySelectorAll('.team-activity li span')].map((s) => s.textContent);
    expect(items()).toEqual(['Dana Levi changed Sam Cohen from Viewer to Editor', 'Dana Levi removed old@example.com']);
    (root().querySelector('#team-load-more') as HTMLButtonElement).click();
    const req = http.expectOne(`${BASE}/audit-log?before=a1`);
    req.flush({
      entries: [{ ...AUDIT[1], id: 'a0', action: 'member_added', detail: { role: 'editor' }, targetUserId: 'u2' }],
      nextBefore: null,
    });
    await settle(fixture);
    expect(items()).toHaveLength(3);
    expect(items()[2]).toBe('Dana Levi added Sam Cohen as Editor');
    expect(root().querySelector('#team-load-more')).toBeNull();
  });

  it('opens the Add or invite drawer on the add mode', async () => {
    await open('admin');
    (root().querySelector('#team-add') as HTMLButtonElement).click();
    expect(store.drawer()).toEqual({ kind: 'invite', projectId: 'p1', mode: 'add' });
  });

  it('reads again after the drawer changed the team', async () => {
    await open('admin');
    store.teamVersion.update((n) => n + 1);
    fixture.detectChanges();
    http.expectOne(`${BASE}/members`).flush(MEMBERS);
    await settle(fixture);
    http.expectOne(`${BASE}/invitations`).flush([]);
    await settle(fixture);
    http.expectOne(`${BASE}/audit-log`).flush({ entries: [], nextBefore: null });
    await settle(fixture);
    expect(root().querySelector('#team-no-invitations')).not.toBeNull();
  });

  describe('bulk actions', () => {
    const check = (label: string) => root().querySelector<HTMLInputElement>(`[aria-label="${label}"]`) as HTMLInputElement;
    const bar = () => root().querySelector<HTMLElement>('[role="region"][aria-label="Actions on the selection"]');
    const drawer = () => document.querySelector<HTMLElement>('[role=alertdialog]');
    const pick = async (label: string) => {
      check(label).click();
      await settle(fixture);
    };
    const invitationBoxes = () => [...root().querySelectorAll<HTMLInputElement>('[data-invitation] input[type=checkbox]')];
    const TWO_INVITATIONS: PendingInvitation[] = [
      INVITATIONS[0],
      { ...INVITATIONS[0], id: 'i2', role: 'viewer', createdAt: '2026-10-29T10:00:00.000Z' },
    ];

    it('shows the bar with the count; select all leaves out the last admin, whose checkbox is disabled with the reason', async () => {
      await open('admin');
      expect(bar()).toBeNull();
      await pick('Select Sam Cohen');
      await pick('Select Kim Park');
      expect(bar()?.textContent).toContain('2 selected');

      check('Select all members').click();
      await settle(fixture);
      expect(bar()?.textContent).toContain('3 selected');
      expect(check('Select Dana Levi').disabled).toBe(true);
      expect(check('Select Dana Levi').getAttribute('aria-describedby')).toBe('team-locked-u1');
      expect(document.getElementById('team-locked-u1')?.textContent).toContain('The last admin of the project cannot');

      check('Select all members').click();
      await settle(fixture);
      expect(bar()).toBeNull();
    });

    it('changes the role of each selected member after one confirmation, one request each', async () => {
      await open('admin');
      await pick('Select Sam Cohen');
      await pick('Select Kim Park');
      root().querySelector<HTMLButtonElement>('#bulk-role')?.click();
      await settle(fixture);
      expect(drawer()?.getAttribute('role')).toBe('alertdialog');
      expect(drawer()?.textContent).toContain('Change the role of 2 people?');
      http.expectNone(`${BASE}/members/u2`);
      expect(drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.disabled).toBe(true);

      (drawer()?.querySelector('input[name=team-bulk-role][value=publisher]') as HTMLInputElement).click();
      await settle(fixture);
      drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.click();
      const sam = http.expectOne(`${BASE}/members/u2`);
      const kim = http.expectOne(`${BASE}/members/u3`);
      expect(sam.request.method).toBe('PATCH');
      expect(sam.request.body).toEqual({ role: 'publisher' });
      expect(kim.request.body).toEqual({ role: 'publisher' });
      sam.flush({ ...MEMBERS[1], role: 'publisher' });
      kim.flush({ ...MEMBERS[2], role: 'publisher' });
      await settle(fixture);

      expect((row('Sam Cohen').querySelector('select') as HTMLSelectElement).value).toBe('publisher');
      expect((row('Kim Park').querySelector('select') as HTMLSelectElement).value).toBe('publisher');
      expect(drawer()).toBeNull();
      expect(bar()).toBeNull();
      expect(text()).toContain('2 people now Publisher.');
    });

    it('removes the selected members after one confirmation, one request each, and the rest stay', async () => {
      await open('admin');
      await pick('Select Kim Park');
      await pick('Select Noa Katz');
      root().querySelector<HTMLButtonElement>('#bulk-remove')?.click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Remove 2 people from the project?');
      http.expectNone(`${BASE}/members/u3`);

      drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.click();
      const kim = http.expectOne(`${BASE}/members/u3`);
      const noa = http.expectOne(`${BASE}/members/u4`);
      expect(kim.request.method).toBe('DELETE');
      expect(noa.request.method).toBe('DELETE');
      kim.flush(null, { status: 204, statusText: 'No Content' });
      noa.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);

      expect(row('Kim Park')).toBeUndefined();
      expect(row('Noa Katz')).toBeUndefined();
      expect(row('Sam Cohen')).toBeDefined();
      expect(drawer()).toBeNull();
      expect(text()).toContain('2 people removed from Spring Campaign.');
    });

    it('keeps the member whose removal failed selected, names them in the alert', async () => {
      await open('admin');
      await pick('Select Sam Cohen');
      await pick('Select Kim Park');
      root().querySelector<HTMLButtonElement>('#bulk-remove')?.click();
      await settle(fixture);
      drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.click();
      http.expectOne(`${BASE}/members/u2`).flush({ error: { code: 'forbidden', message: 'Not allowed.' } }, { status: 403, statusText: 'Forbidden' });
      http.expectOne(`${BASE}/members/u3`).flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);

      const alert = root().querySelector<HTMLElement>('#bulk-members-failed');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('1 could not be removed: Sam Cohen. They stay selected.');
      expect(row('Sam Cohen')).toBeDefined();
      expect(row('Kim Park')).toBeUndefined();
      expect(check('Select Sam Cohen').checked).toBe(true);
      expect(bar()?.textContent).toContain('1 selected');
    });

    it('revokes the selected invitations after one confirmation, one request each', async () => {
      await open('admin', MEMBERS, TWO_INVITATIONS);
      invitationBoxes()[0].click();
      await settle(fixture);
      invitationBoxes()[1].click();
      await settle(fixture);
      expect(bar()?.textContent).toContain('2 selected');

      root().querySelector<HTMLButtonElement>('#bulk-revoke-invitations')?.click();
      await settle(fixture);
      expect(drawer()?.textContent).toContain('Revoke 2 invitations?');
      drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.click();
      const first = http.expectOne(`${BASE}/invitations/i1`);
      const second = http.expectOne(`${BASE}/invitations/i2`);
      expect(first.request.method).toBe('DELETE');
      first.flush(null, { status: 204, statusText: 'No Content' });
      second.flush(null, { status: 204, statusText: 'No Content' });
      await settle(fixture);

      expect(root().querySelectorAll('[data-invitation]')).toHaveLength(0);
      expect(root().querySelector('#team-no-invitations')).not.toBeNull();
      expect(drawer()).toBeNull();
      expect(bar()).toBeNull();
    });

    it('keeps the invitation whose revoke failed selected and names it', async () => {
      await open('admin', MEMBERS, TWO_INVITATIONS);
      invitationBoxes()[0].click();
      await settle(fixture);
      invitationBoxes()[1].click();
      await settle(fixture);
      root().querySelector<HTMLButtonElement>('#bulk-revoke-invitations')?.click();
      await settle(fixture);
      drawer()?.querySelector<HTMLButtonElement>('#bulk-submit')?.click();
      http.expectOne(`${BASE}/invitations/i1`).flush(null, { status: 204, statusText: 'No Content' });
      http.expectOne(`${BASE}/invitations/i2`).flush(null, { status: 500, statusText: 'Server Error' });
      await settle(fixture);

      const alert = root().querySelector<HTMLElement>('#bulk-invitations-failed');
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toContain('1 could not be revoked: Viewer,');
      expect(root().querySelectorAll('[data-invitation]')).toHaveLength(1);
      expect(invitationBoxes()[0].checked).toBe(true);
      expect(bar()?.textContent).toContain('1 selected');
    });

    it('shows no checkboxes and no bar to a role without members.manage', async () => {
      await open('viewer');
      expect(root().querySelector('input[type=checkbox]')).toBeNull();
      expect(bar()).toBeNull();
    });
  });

  it('is read-only for a viewer: the list and the matrix, no controls, no invitations or activity', async () => {
    await open('viewer');
    expect(row('Sam Cohen').textContent).toContain('Editor');
    expect(root().querySelector('select')).toBeNull();
    expect(root().querySelector('input[type=date]')).toBeNull();
    expect(root().querySelector('#team-add')).toBeNull();
    expect([...root().querySelectorAll('button')].some((b) => b.textContent?.includes('Remove'))).toBe(false);
    expect(root().querySelector('#team-readonly')).not.toBeNull();
    expect(root().querySelector('[aria-labelledby="team-invitations-title"]')).toBeNull();
    expect(root().querySelector('[aria-labelledby="team-activity-title"]')).toBeNull();
    expect(root().querySelector('[aria-labelledby="team-roles-title"]')).not.toBeNull();
    http.expectNone(`${BASE}/invitations`);
    http.expectNone(`${BASE}/audit-log`);
  });

  it('does not show the manager controls to a publisher either', async () => {
    await open('publisher');
    expect(root().querySelector('#team-add')).toBeNull();
    expect(root().querySelector('select')).toBeNull();
  });
});

describe('Add or invite drawer', () => {
  // Types the address the invitation is for, as the invitee's address field requires.
  function typeEmail(value: string): void {
    const input = field<HTMLInputElement>('invite-email');
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  let http: HttpTestingController;
  let fixture: ComponentFixture<CreateDrawer>;
  const root = () => fixture.nativeElement as HTMLElement;
  const field = <T extends HTMLElement>(id: string) => root().querySelector(`#${id}`) as T;

  async function open(request: DrawerRequest): Promise<void> {
    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Spring Campaign', role: 'admin' }]);
    fixture = TestBed.createComponent(CreateDrawer);
    fixture.componentRef.setInput('request', request);
    document.body.appendChild(root());
    fixture.detectChanges();
    await settle(fixture);
  }

  function pick(id: string, value: string): void {
    const el = field<HTMLSelectElement | HTMLInputElement>(id);
    el.value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  const submit = async () => {
    root().querySelector<HTMLButtonElement>('button[type=submit]')?.click();
    await settle(fixture);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateDrawer],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true);
    http.verify();
    document.body.replaceChildren();
  });

  it('describes the chosen role in words next to the chooser', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'add' });
    expect(field('invite-role-hint').textContent).toContain('Editor: see everything');
    expect(field('invite-role-hint').textContent).toContain('Cannot publish');
    pick('invite-role', 'viewer');
    fixture.detectChanges();
    expect(field('invite-role-hint').textContent).toContain('Viewer:');
    expect(field<HTMLSelectElement>('invite-role').value).toBe('viewer');
  });

  it('adds an existing user by email with a role and an end date', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'add' });
    pick('invite-email', 'sam@example.com');
    pick('invite-role', 'publisher');
    pick('invite-ends', '2026-12-31');
    await submit();
    const req = http.expectOne(`${BASE}/members`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'sam@example.com',
      role: 'publisher',
      expiresAt: '2026-12-31T23:59:59.000Z',
    });
    req.flush(
      member({
        userId: 'u2',
        name: 'Sam Cohen',
        email: 'sam@example.com',
        role: 'publisher',
        you: false,
        expiresAt: '2026-12-31T23:59:59.000Z',
      }),
      { status: 201, statusText: 'Created' },
    );
    await settle(fixture);
    expect(field('invite-added').textContent).toContain('Sam Cohen');
    expect(field('invite-added').textContent).toContain('Publisher');
    expect(field('invite-added').textContent).toContain('Until 31 Dec 2026');
    expect(TestBed.inject(DashboardStore).teamVersion()).toBe(1);
  });

  it('shows the API message when the user does not exist', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'add' });
    pick('invite-email', 'nobody@example.com');
    await submit();
    http
      .expectOne(`${BASE}/members`)
      .flush(
        { error: { code: 'user_not_found', message: 'No user has this email. Invite them with a link instead.' } },
        { status: 404, statusText: 'Not Found' },
      );
    await settle(fixture);
    expect(root().querySelector('#create-error')?.textContent).toContain('Invite them with a link instead');
  });

  it('asks for an email before sending anything', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'add' });
    await submit();
    http.expectNone(`${BASE}/members`);
    expect(root().querySelector('#create-error')?.textContent).toContain('Enter the email');
  });

  it('creates an invitation link with a role and shows the role in the result', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'link' });
    typeEmail('cy@example.com');
    pick('invite-role', 'viewer');
    await submit();
    const req = http.expectOne(`${BASE}/invitations`);
    expect(req.request.body).toEqual({ email: 'cy@example.com', role: 'viewer' });
    req.flush(
      {
        id: 'i9',
        projectId: 'p1',
        role: 'viewer',
        accessExpiresAt: null,
        url: 'http://localhost/invite/tok9',
        expiresAt: '2026-11-07T10:00:00.000Z',
      },
      { status: 201, statusText: 'Created' },
    );
    await settle(fixture);
    expect(field<HTMLInputElement>('invite-url').value).toBe('http://localhost/invite/tok9');
    expect(field('invite-result-role').textContent).toContain('Joins as Viewer');
    expect(field('invite-result-role').textContent).toContain('Permanent');
  });

  it('sends the default role, Editor, when none is picked, and switches between the two modes', async () => {
    await open({ kind: 'invite', projectId: 'p1', mode: 'add' });
    expect(field('invite-email')).not.toBeNull();
    root().querySelector<HTMLInputElement>('input[name=invite-mode][value=link]')?.click();
    fixture.detectChanges();
    await settle(fixture);
    expect(root().querySelector('#invite-email')).not.toBeNull();
    typeEmail('cy@example.com');
    await settle(fixture);
    await submit();
    expect(http.expectOne(`${BASE}/invitations`).request.body).toEqual({ email: 'cy@example.com', role: 'editor' });
  });
});
