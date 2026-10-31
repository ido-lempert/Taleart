import type { Caller } from './members';
import { accessibleProjectIds } from './members';
import type { Project, ProjectRole } from '@taleart/contract';
import type { Db } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The projects the caller can access, oldest first, each with the caller's effective role: `admin`
 * for a global admin, the active membership's role for a content manager.
 */
export async function listProjects(db: Db, caller: Caller): Promise<Project[]> {
  const scope = await accessibleProjectIds(db, caller);
  const { rows } =
    scope === 'all'
      ? await db.query<{ id: string; name: string; role: ProjectRole | null }>(
          'SELECT id, name, NULL AS role FROM projects ORDER BY created_at',
        )
      : await db.query<{ id: string; name: string; role: ProjectRole | null }>(
          `SELECT p.id, p.name, m.role
             FROM projects p
             LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2
            WHERE p.id = ANY($1::uuid[])
            ORDER BY p.created_at`,
          [scope, caller.id],
        );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: caller.role === 'admin' ? 'admin' : (row.role ?? 'viewer'),
  }));
}

/** Creates a project; its creator is a global admin, who is `admin` in every project. */
export async function createProject(db: Db, input: { name: string }): Promise<Project> {
  const { rows } = await db.query<{ id: string; name: string }>(
    'INSERT INTO projects (name) VALUES ($1) RETURNING id, name',
    [input.name],
  );
  return { ...rows[0], role: 'admin' };
}

/** True when a project with this id exists. Ids that are not UUIDs never match. */
export async function projectExists(db: Db, projectId: string): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
  return (rowCount ?? 0) > 0;
}
