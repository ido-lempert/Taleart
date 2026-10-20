import type { User } from '@taleart/contract';
import type { Db } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in user, as far as access checks need them. */
export type Caller = Pick<User, 'id' | 'role'>;

/** The projects a caller can access: every project, or the listed ids. */
export type ProjectScope = 'all' | string[];

/** Admins access every project; a content manager only the projects they are a member of (AD-4). */
export async function accessibleProjectIds(db: Db, caller: Caller): Promise<ProjectScope> {
  if (caller.role === 'admin') return 'all';
  const { rows } = await db.query<{ project_id: string }>(
    'SELECT project_id FROM project_members WHERE user_id = $1',
    [caller.id],
  );
  return rows.map((row) => row.project_id);
}

/** True when the caller may act on this project. It does not tell whether the project exists. */
export async function canAccessProject(db: Db, caller: Caller, projectId: string): Promise<boolean> {
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
