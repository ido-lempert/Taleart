import { ErrorCodes, type Zone } from '@taleart/contract';
import { projectExists, type Db, type ProjectScope } from '@taleart/server-access';

/** The columns of a zone as the API returns it, including the applied playbook's key (R8). */
export const ZONE_COLUMNS = 'id, name, project_id AS "projectId", playbook_key AS "playbookKey"';

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
      `SELECT ${ZONE_COLUMNS} FROM zones WHERE project_id = ANY($1::uuid[]) ORDER BY created_at`,
      [scope],
    );
    return rows;
  }
  const { rows } = await db.query<Zone>(
    `SELECT ${ZONE_COLUMNS} FROM zones ORDER BY created_at`,
  );
  return rows;
}

export async function createZone(db: Db, input: { name: string; projectId: string }): Promise<Zone> {
  if (!(await projectExists(db, input.projectId))) {
    throw new ProjectNotFoundError(input.projectId);
  }
  const { rows } = await db.query<Zone>(
    `INSERT INTO zones (name, project_id) VALUES ($1, $2) RETURNING ${ZONE_COLUMNS}`,
    [input.name, input.projectId],
  );
  return rows[0];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renames a zone when `decide` says so: the zone row is locked, `decide` gets
 * its current name and answers the new one, or null to leave it. Run it on a
 * transaction, so the decision and the write see the same name (the importer
 * keeps names a person changed). Returns the name before and after, or null
 * when the zone does not exist.
 */
export async function renameZoneWhen(
  db: Db,
  zoneId: string,
  decide: (current: string) => string | null,
): Promise<{ before: string; after: string } | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM zones WHERE id = $1 FOR UPDATE', [zoneId]);
  if (rows.length === 0) return null;
  const before = rows[0].name;
  const next = decide(before);
  if (next === null || next === before) return { before, after: before };
  await db.query('UPDATE zones SET name = $2 WHERE id = $1', [zoneId, next]);
  return { before, after: next };
}
