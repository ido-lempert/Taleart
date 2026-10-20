import type { Project } from '@taleart/contract';
import type { Db } from './db';
import type { ProjectScope } from './members';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The projects in `scope` (every project by default), oldest first. */
export async function listProjects(db: Db, scope: ProjectScope = 'all'): Promise<Project[]> {
  if (scope !== 'all') {
    const { rows } = await db.query<Project>(
      'SELECT id, name FROM projects WHERE id = ANY($1::uuid[]) ORDER BY created_at',
      [scope],
    );
    return rows;
  }
  const { rows } = await db.query<Project>('SELECT id, name FROM projects ORDER BY created_at');
  return rows;
}

export async function createProject(db: Db, input: { name: string }): Promise<Project> {
  const { rows } = await db.query<Project>(
    'INSERT INTO projects (name) VALUES ($1) RETURNING id, name',
    [input.name],
  );
  return rows[0];
}

/** True when a project with this id exists. Ids that are not UUIDs never match. */
export async function projectExists(db: Db, projectId: string): Promise<boolean> {
  if (!UUID.test(projectId)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
  return (rowCount ?? 0) > 0;
}
