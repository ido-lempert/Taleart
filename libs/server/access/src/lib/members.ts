import type { User } from '@taleart/contract';
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

/**
 * Admins access every project; a content manager only the projects they are a member of (AD-4). An
 * API token's projects narrow either.
 */
export async function accessibleProjectIds(db: Db, caller: Caller): Promise<ProjectScope> {
  const limit = tokenLimit(caller);
  if (caller.role === 'admin') return limit === 'all' ? 'all' : [...limit];
  const { rows } = await db.query<{ project_id: string }>(
    'SELECT project_id FROM project_members WHERE user_id = $1',
    [caller.id],
  );
  const ids = rows.map((row) => row.project_id);
  return limit === 'all' ? ids : ids.filter((id) => limit.has(id.toLowerCase()));
}

/** True when the caller may act on this project. It does not tell whether the project exists. */
export async function canAccessProject(db: Db, caller: Caller, projectId: string): Promise<boolean> {
  const limit = tokenLimit(caller);
  if (limit !== 'all' && !limit.has(projectId.toLowerCase())) return false;
  if (caller.role === 'admin') return true;
  if (!UUID.test(projectId)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [
    projectId,
    caller.id,
  ]);
  return (rowCount ?? 0) > 0;
}

/** Makes the user a member of the project; adding an existing member changes nothing. */
export async function addProjectMember(db: Db, projectId: string, userId: string): Promise<void> {
  await db.query(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [projectId, userId],
  );
}
