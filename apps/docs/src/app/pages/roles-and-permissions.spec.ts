import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PROJECT_PERMISSIONS, PROJECT_ROLE_PERMISSIONS, PROJECT_ROLES } from '@taleart/contract/core';
import { appRoutes } from '../app.routes';

describe('Roles and permissions page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/roles-and-permissions');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('shows the role table of the contract: every permission row, every role cell', () => {
    const rows = [...page.querySelectorAll('tr[data-permission]')];
    expect(rows.map((row) => row.getAttribute('data-permission'))).toEqual([...PROJECT_PERMISSIONS]);
    for (const row of rows) {
      const permission = row.getAttribute('data-permission') as (typeof PROJECT_PERMISSIONS)[number];
      for (const role of PROJECT_ROLES) {
        const cell = row.querySelector(`td[data-role="${role}"]`);
        expect(cell, `${permission} ${role}`).not.toBeNull();
        const expected = PROJECT_ROLE_PERMISSIONS[role].includes(permission) ? 'Yes' : 'No';
        expect(cell?.textContent?.trim(), `${permission} for ${role}`).toBe(expected);
      }
    }
  });

  it('names the four roles and the new error codes', () => {
    const text = page.textContent ?? '';
    for (const word of ['Viewer', 'Editor', 'Publisher', 'Admin']) expect(text).toContain(word);
    for (const code of ['user_not_found', 'member_exists', 'member_not_found', 'invitation_not_found', 'last_project_admin']) {
      expect(text).toContain(code);
    }
  });

  it('has the steps of the guide', () => {
    const headings = [...page.querySelectorAll('ol.steps > li > h3')].map((h) => h.textContent?.trim());
    expect(headings).toEqual([
      'Open Settings > Team.',
      'Invite someone with a role.',
      'Add an existing user.',
      'Change a role.',
      'Set an end date.',
      'Revoke an invitation.',
      'Remove a member.',
      'Read the activity.',
    ]);
  });
});
