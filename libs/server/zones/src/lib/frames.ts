import { ErrorCodes, type Frame } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRAME_COLUMNS =
  'id, zone_id AS "zoneId", project_id AS "projectId", type, settings';

/** Thrown when a frame request names a zone that does not exist. */
export class ZoneNotFoundError extends Error {
  readonly code = ErrorCodes.zoneNotFound;

  constructor(readonly zoneId: string) {
    super('zoneId does not match a zone');
    this.name = 'ZoneNotFoundError';
  }
}

// The zone's project, or null when the zone does not exist. Ids that are not
// UUIDs never match.
async function zoneProjectId(db: Db, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM zones WHERE id = $1', [zoneId]);
  return rows[0]?.project_id ?? null;
}

/** True when a zone with this id exists. Ids that are not UUIDs never match. */
export async function zoneExists(db: Db, zoneId: string): Promise<boolean> {
  return (await zoneProjectId(db, zoneId)) !== null;
}

/** The zone's frames, oldest first. */
export async function listFrames(db: Db, zoneId: string): Promise<Frame[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  const { rows } = await db.query<Frame>(
    `SELECT ${FRAME_COLUMNS} FROM frames WHERE zone_id = $1 ORDER BY created_at, id`,
    [zoneId],
  );
  return rows;
}

/**
 * Adds a frame to a zone. The frame takes its project from the zone (AD-4),
 * and its settings must match the type's schema (AD-5). Missing settings are `{}`.
 */
export async function createFrame(
  db: Db,
  registry: FrameTypeRegistry,
  input: { zoneId: string; type: string; settings?: unknown },
): Promise<Frame> {
  const projectId = await zoneProjectId(db, input.zoneId);
  if (projectId === null) throw new ZoneNotFoundError(input.zoneId);

  const settings = input.settings === undefined ? {} : input.settings;
  registry.validate(input.type, settings);

  const { rows } = await db.query<Frame>(
    `INSERT INTO frames (zone_id, project_id, type, settings) VALUES ($1, $2, $3, $4)
     RETURNING ${FRAME_COLUMNS}`,
    [input.zoneId, projectId, input.type, JSON.stringify(settings)],
  );
  return rows[0];
}
