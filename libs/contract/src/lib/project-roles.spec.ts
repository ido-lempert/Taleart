import {
  DEFAULT_INVITATION_ROLE,
  isProjectRole,
  lowestRoleWith,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  PROJECT_ROLE_PERMISSIONS,
  roleHasPermission,
} from './project-roles';

describe('project roles', () => {
  it('lists the roles lowest to highest, each holding the permissions of the one below', () => {
    expect(PROJECT_ROLES).toEqual(['viewer', 'editor', 'publisher', 'admin']);
    for (let i = 1; i < PROJECT_ROLES.length; i++) {
      const below = PROJECT_ROLE_PERMISSIONS[PROJECT_ROLES[i - 1]];
      const role = PROJECT_ROLE_PERMISSIONS[PROJECT_ROLES[i]];
      expect(below.every((permission) => role.includes(permission))).toBe(true);
      expect(role.length).toBeGreaterThan(below.length);
    }
  });

  it('gives admin every permission', () => {
    expect([...PROJECT_ROLE_PERMISSIONS.admin].sort()).toEqual([...PROJECT_PERMISSIONS].sort());
  });

  it.each([
    ['viewer', 'project.view', true],
    ['viewer', 'analytics.view', true],
    ['viewer', 'content.edit', false],
    ['editor', 'content.edit', true],
    ['editor', 'content.publish', false],
    ['editor', 'zones.manage', false],
    ['publisher', 'content.publish', true],
    ['publisher', 'zones.manage', true],
    ['publisher', 'keys.manage', false],
    ['publisher', 'members.manage', false],
    ['admin', 'keys.manage', true],
    ['admin', 'members.manage', true],
  ] as const)('%s / %s -> %s', (role, permission, expected) => {
    expect(roleHasPermission(role, permission)).toBe(expected);
  });

  it('grants nothing without a role', () => {
    expect(roleHasPermission(null, 'project.view')).toBe(false);
    expect(roleHasPermission(undefined, 'project.view')).toBe(false);
  });

  it('knows the lowest role for a permission and the roles by name', () => {
    expect(lowestRoleWith('project.view')).toBe('viewer');
    expect(lowestRoleWith('content.publish')).toBe('publisher');
    expect(lowestRoleWith('members.manage')).toBe('admin');
    expect(isProjectRole('editor')).toBe(true);
    expect(isProjectRole('owner')).toBe(false);
    expect(DEFAULT_INVITATION_ROLE).toBe('editor');
  });
});
