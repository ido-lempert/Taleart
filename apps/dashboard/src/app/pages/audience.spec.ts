import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import type { UserList, UserListUploadReport } from '@taleart/contract/core';
import { API_BASE, DashboardStore } from '../dashboard.store';
import { AudiencePage, deleteGroupsText, reportLines, targetsText, warningText } from './audience';

const listUrl = `${API_BASE}/projects/p1/user-lists`;

const list = (over: Partial<UserList> = {}): UserList => ({
  id: '0f0e0d0c-0000-4000-8000-00000000000a',
  projectId: 'p1',
  name: 'Loyal customers',
  idCount: 1204,
  taleGroups: [],
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:00.000Z',
  ...over,
});

const report = (over: Partial<UserListUploadReport> = {}): UserListUploadReport => ({
  added: 8,
  alreadyPresent: 1,
  refused: 1,
  refusedRows: [{ line: 10, reason: 'too-long' }],
  emptyRows: 1,
  emailLike: 0,
  phoneLike: 0,
  idCount: 8,
  ...over,
});

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 20));
  fixture.detectChanges();
}

describe('the tale groups a list targets (story 5.4)', () => {
  const groups = (...names: string[]) => names.map((name, i) => ({ id: `g${i}`, name }));

  it('names them on the row, and what deleting the list does to them', () => {
    expect(targetsText({ taleGroups: [] })).toBe('Targets no tale group yet');
    expect(targetsText({ taleGroups: groups('Summer') })).toBe('Targets Summer');
    expect(targetsText({ taleGroups: groups('Summer', 'VIP') })).toBe('Targets Summer and VIP');
    expect(targetsText({ taleGroups: groups('a', 'b', 'c', 'd', 'e') })).toBe('Targets a, b, c and 2 more');
    expect(deleteGroupsText({ taleGroups: [] })).toBe('');
    expect(deleteGroupsText({ taleGroups: groups('Summer') })).toBe(
      'It is removed from the tale group Summer; a group with no other user list then shows to every viewer.',
    );
    expect(deleteGroupsText({ taleGroups: groups('Summer', 'VIP') })).toBe(
      'It is removed from 2 tale groups Summer and VIP; a group with no other user list then shows to every viewer.',
    );
  });
});

describe('reportLines and warningText', () => {
  it('words a report in counts and line numbers only', () => {
    expect(reportLines(report())).toEqual([
      'Added 8 IDs.',
      '1 row already in the list (or earlier in the file).',
      '1 row refused: line 10 (longer than 256 characters).',
      '1 empty row skipped.',
      'The list now holds 8 IDs.',
    ]);
    expect(reportLines(report({ added: 1, alreadyPresent: 0, refused: 12, emptyRows: 0, idCount: 1 }))).toEqual([
      'Added 1 ID.',
      '12 rows refused: line 10 (longer than 256 characters), and 11 more.',
      'The list now holds 1 ID.',
    ]);
  });

  it('warns about emails and phone numbers without refusing', () => {
    expect(warningText('email')).toMatch(/look like email addresses.*You can still upload this file\./);
    expect(warningText('phone')).toMatch(/look like phone numbers/);
  });
});

describe('AudiencePage (epic targeting story 5.3)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AudiencePage>;
  let root: HTMLElement;
  const q = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
  const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name,
    ) as HTMLButtonElement;

  async function open(lists: UserList[]): Promise<void> {
    const store = TestBed.inject(DashboardStore);
    store.projects.set([{ id: 'p1', name: 'Acme' }]);
    store.selectProject('p1');
    fixture = TestBed.createComponent(AudiencePage);
    root = fixture.nativeElement as HTMLElement;
    document.body.appendChild(root);
    fixture.detectChanges();
    http.expectOne(listUrl).flush(lists);
    await settle(fixture);
  }

  async function pick(contents: string, name = 'ids.csv'): Promise<File> {
    const file = new File([contents], name, { type: 'text/csv' });
    const input = q<HTMLInputElement>('#user-list-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    await settle(fixture);
    return file;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AudiencePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    document.body.replaceChildren();
  });

  it('lists each list with its count and actions, never an ID, in a User lists tab', async () => {
    await open([list()]);
    expect(q('[role=tab]').textContent?.trim()).toBe('User lists');
    expect(q('[role=tab]').getAttribute('aria-selected')).toBe('true');
    const row = q('.user-list');
    expect(row.querySelector('h4')?.textContent).toBe('Loyal customers');
    expect(row.textContent).toContain('1,204 IDs');
    for (const name of ['Add IDs to Loyal customers', 'Rename Loyal customers', 'Delete Loyal customers']) {
      expect(button(name), name).toBeTruthy();
    }
  });

  it('says when the project has no list', async () => {
    await open([]);
    expect(root.textContent).toContain('No user lists yet');
  });

  it('creates a list with a CSV of emails: warns before sending, still sends, and shows the report', async () => {
    await open([]);
    button('New user list').click();
    await settle(fixture);
    const name = q<HTMLInputElement>('#user-list-name');
    name.value = 'Newsletter';
    name.dispatchEvent(new Event('input'));
    const file = await pick('email\nana@example.com\nbo@example.com\n');
    expect(document.body.textContent).toContain('Most of these values look like email addresses');
    // The header row is not an email: with it skipped, every value is one; the warning stays.
    q<HTMLInputElement>('#user-list-header').click();
    await settle(fixture);
    expect(document.body.textContent).toContain('You can still upload this file.');

    q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    const create = http.expectOne({ method: 'POST', url: listUrl });
    expect(create.request.body).toEqual({ name: 'Newsletter' });
    create.flush(list({ name: 'Newsletter', idCount: 0 }));
    await settle(fixture);
    http.expectOne(listUrl).flush([list({ name: 'Newsletter', idCount: 0 })]);
    await settle(fixture);
    const upload = http.expectOne((r) => r.url === `${listUrl}/${list().id}/ids`);
    expect(upload.request.body).toBe(file);
    expect(upload.request.headers.get('Content-Type')).toBe('text/csv');
    expect(upload.request.params.get('header')).toBe('true');
    upload.flush(report({ added: 2, alreadyPresent: 0, refused: 0, refusedRows: [], emptyRows: 0, emailLike: 2, idCount: 2 }));
    await settle(fixture);
    http.expectOne(listUrl).flush([list({ name: 'Newsletter', idCount: 2 })]);
    await settle(fixture);
    const drawer = q('[role=dialog]');
    expect(drawer.textContent).toContain('Created Newsletter');
    expect(drawer.textContent).toContain('Added 2 IDs.');
    expect(drawer.textContent).toContain('Most of these values look like email addresses');
    expect(document.body.textContent).toContain('2 IDs');
  });

  it('does not warn about opaque IDs', async () => {
    await open([list()]);
    button('Add IDs to Loyal customers').click();
    await settle(fixture);
    await pick('u-1\nu-2\n123456789\n');
    expect(document.body.textContent).not.toContain('look like');
  });

  it('asks before deleting, naming the list and its count, then deletes it', async () => {
    await open([list()]);
    button('Delete Loyal customers').click();
    await settle(fixture);
    const dialog = q('[role=alertdialog]');
    expect(dialog.textContent).toContain('Delete Loyal customers and the 1,204 IDs it holds?');
    expect(document.activeElement?.id).toBe('user-list-delete-cancel');
    button('Delete user list').click();
    await settle(fixture);
    http.expectOne({ method: 'DELETE', url: `${listUrl}/${list().id}` }).flush(null, { status: 204, statusText: 'No Content' });
    await settle(fixture);
    http.expectOne(listUrl).flush([]);
    await settle(fixture);
    expect(q('[role=alertdialog]')).toBeNull();
    expect(q('[role=status]').textContent).toContain('Loyal customers deleted');
  });

  it('shows a refused rename on its field', async () => {
    await open([list()]);
    button('Rename Loyal customers').click();
    await settle(fixture);
    const name = q<HTMLInputElement>('#user-list-name');
    expect(name.value).toBe('Loyal customers');
    name.value = 'VIP';
    name.dispatchEvent(new Event('input'));
    q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    http
      .expectOne({ method: 'PATCH', url: `${listUrl}/${list().id}` })
      .flush({ error: { code: 'user_list_exists', message: 'This project already has a user list with this name' } }, { status: 409, statusText: 'Conflict' });
    await settle(fixture);
    expect(q('#user-list-name-error').textContent).toContain('already has a user list');
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });
});
