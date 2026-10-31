import { roleHasPermission, type ProjectPermission, type ProjectRole, type User } from '@taleart/contract';
import type { Db } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The projects a caller can access: every project, or the listed ids. */
export type ProjectScope = 'all' | string[];

/**
 * The signed-in user, as far as access checks need them. A caller using an API token (epic developer
 * experience 10.1) also carries the token's projects: the caller then reaches only the projects both
 * the user and the token reach, so a token never widens its user's access, and a project the user
 * loses is lost to the token at once.
 */
export type Caller = Pick<User, 'id' | 'role'> & { tokenProjects?: ProjectScope };

// The token's limit on a caller, lowercased so ids compare as UUIDs do; 'all' when there is none.
function tokenLimit(caller: Caller): 'all' | Set<string> {
  const limit = caller.tokenProjects ?? 'all';
  return limit === 'all' ? 'all' : new Set(limit.map((id) => id.toLowerCase()));
}

// A membership that has not ended.
const ACTIVE_MEMBERSHIP = '(expires_at IS NULL OR expires_at > now())';

/**
 * Admins access every project; a content manager only the projects they are an active member of
 * (AD-4; an expired membership counts as none). An API token's projects narrow either.
 */
export async function accessibleProjectIds(db: Db, caller: Caller): Promise<ProjectScope> {
  const limit = tokenLimit(caller);
  if (caller.role === 'admin') return limit === 'all' ? 'all' : [...limit];
  const { rows } = await db.query<{ project_id: string }>(
    `SELECT project_id FROM project_members WHERE user_id = $1 AND ${ACTIVE_MEMBERSHIP}`,
    [caller.id],
  );
  const ids = rows.map((row) => row.project_id);
  return limit === 'all' ? ids : ids.filter((id) => limit.has(id.toLowerCase()));
}

/**
 * The caller's effective role in the project, or null without access. A global admin is `admin` in
 * every project; a content manager has the role of their active membership. An API token's projects
 * narrow the result, so a token never has more than its user.
 */
export async function projectRole(db: Db, caller: Caller, projectId: string): Promise<ProjectRole | null> {
  const limit = tokenLimit(caller);
  if (limit !== 'all' && !limit.has(projectId.toLowerCase())) return null;
  if (caller.role === 'admin') return 'admin';
  if (!UUID.test(projectId)) return null;
  const { rows } = await db.query<{ role: ProjectRole }>(
    `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 AND ${ACTIVE_MEMBERSHIP}`,
    [projectId, caller.id],
  );
  return rows[0]?.role ?? null;
}

/** True when the caller's role in the project grants the permission. It does not tell whether the project exists. */
export async function hasProjectPermission(
  db: Db,
  caller: Caller,
  projectId: string,
  permission: ProjectPermission,
): Promise<boolean> {
  return roleHasPermission(await projectRole(db, caller, projectId), permission);
}

/** True when the caller may act on this project (any role). It does not tell whether the project exists. */
export async function canAccessProject(db: Db, caller: Caller, projectId: string): Promise<boolean> {
  return (await projectRole(db, caller, projectId)) !== null;
}

/**
 * Makes the user a member of the project with this role (`publisher`, what every membership could do
 * before roles, by default), until `expiresAt` when given. A user who is already a member keeps their
 * membership unchanged.
 */
export async function addProjectMember(
  db: Db,
  projectId: string,
  userId: string,
  options: { role?: ProjectRole; expiresAt?: Date | null } = {},
): Promise<void> {
  await db.query(
    'INSERT INTO project_members (project_id, user_id, role, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [projectId, userId, options.role ?? 'publisher', options.expiresAt ?? null],
  );
}
