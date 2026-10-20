import { ErrorCodes, type Zone } from '@taleart/contract';
import { projectExists, type Db, type ProjectScope } from '@taleart/server-access';

/** Thrown when a zone names a project that does not exist. */
export class ProjectNotFoundError extends Error {
  readonly code = ErrorCodes.projectNotFound;

  constructor(readonly projectId: string) {
    super('projectId does not match a project');
    this.name = 'ProjectNotFoundError';
  }
}

/** The zones of the projects in `scope` (every project by default), oldest first. */
export async function listZones(db: Db, scope: ProjectScope = 'all'): Promise<Zone[]> {
  if (scope !== 'all') {
    const { rows } = await db.query<Zone>(
      'SELECT id, name, project_id AS "projectId" FROM zones WHERE project_id = ANY($1::uuid[]) ORDER BY created_at',
      [scope],
    );
    return rows;
  }
  const { rows } = await db.query<Zone>(
    'SELECT id, name, project_id AS "projectId" FROM zones ORDER BY created_at',
  );
  return rows;
}

export async function createZone(db: Db, input: { name: string; projectId: string }): Promise<Zone> {
  if (!(await projectExists(db, input.projectId))) {
    throw new ProjectNotFoundError(input.projectId);
  }
  const { rows } = await db.query<Zone>(
    'INSERT INTO zones (name, project_id) VALUES ($1, $2) RETURNING id, name, project_id AS "projectId"',
    [input.name, input.projectId],
  );
  return rows[0];
}
