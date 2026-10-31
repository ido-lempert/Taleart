import type { Db } from './db';
import { accessibleProjectIds, canAccessProject, hasProjectPermission, projectRole } from './members';

const projectA = '00000000-0000-4000-8000-0000000000a1';
const projectB = '00000000-0000-4000-8000-0000000000b1';

// A Db that answers every query with these rows and remembers the statements.
function fakeDb(rows: unknown[]): Db & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { query } as unknown as Db & { query: ReturnType<typeof vi.fn> };
}

const manager = { id: 'u2', role: 'content_manager' as const };
const admin = { id: 'u1', role: 'admin' as const };

describe('project roles of a caller', () => {
  it('makes a global admin admin everywhere without a query', async () => {
    const db = fakeDb([]);
    expect(await projectRole(db, admin, projectA)).toBe('admin');
    expect(await hasProjectPermission(db, admin, projectA, 'members.manage')).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('gives a content manager the role of their membership', async () => {
    const db = fakeDb([{ role: 'viewer' }]);
    expect(await projectRole(db, manager, projectA)).toBe('viewer');
    expect(await hasProjectPermission(db, manager, projectA, 'project.view')).toBe(true);
    expect(await hasProjectPermission(db, manager, projectA, 'content.edit')).toBe(false);
    expect(await canAccessProject(db, manager, projectA)).toBe(true);
  });

  it('counts only memberships that have not expired, here and in the project list', async () => {
    const db = fakeDb([]);
    expect(await projectRole(db, manager, projectA)).toBeNull();
    expect(await canAccessProject(db, manager, projectA)).toBe(false);
    await accessibleProjectIds(db, manager);
    for (const [text] of db.query.mock.calls) expect(String(text)).toContain('expires_at IS NULL OR expires_at > now()');
  });

  it('never looks a non-UUID project up, and a token narrows even a global admin', async () => {
    const db = fakeDb([{ role: 'admin' }]);
    expect(await projectRole(db, manager, 'nope')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(await projectRole(db, { ...admin, tokenProjects: [projectA] }, projectB)).toBeNull();
    expect(await projectRole(db, { ...admin, tokenProjects: [projectA] }, projectA.toUpperCase())).toBe('admin');
    // A token acts with its user's role, not more: the manager's viewer role stays viewer.
    const viewer = fakeDb([{ role: 'viewer' }]);
    expect(await projectRole(viewer, { ...manager, tokenProjects: [projectA] }, projectA)).toBe('viewer');
    expect(await projectRole(viewer, { ...manager, tokenProjects: [projectB] }, projectA)).toBeNull();
  });
});
