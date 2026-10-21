import { ErrorCodes, type Frame, type Zone } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';
import { ZONE_COLUMNS } from './zones';

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

/** Thrown when a frame id does not match a frame of the zone. */
export class FrameNotFoundError extends Error {
  readonly code = ErrorCodes.frameNotFound;

  constructor(readonly frameId: string) {
    super('frameId does not match a frame of this zone');
    this.name = 'FrameNotFoundError';
  }
}

/**
 * The zone's project, or null when the zone does not exist. Ids that are not
 * UUIDs never match. Other modules read a zone's project only through this.
 */
export async function zoneProjectId(db: Db, zoneId: string): Promise<string | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM zones WHERE id = $1', [zoneId]);
  return rows[0]?.project_id ?? null;
}

/** The zone with this id, or null when it does not exist. Ids that are not UUIDs never match. */
export async function findZone(db: Db, zoneId: string): Promise<Zone | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<Zone>(`SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1`, [zoneId]);
  return rows[0] ?? null;
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

/**
 * Replaces a frame's settings. They must match the schema of the frame's type
 * (AD-5); nothing is stored otherwise. A frame of another zone is not found.
 */
export async function updateFrameSettings(
  db: Db,
  registry: FrameTypeRegistry,
  input: { zoneId: string; frameId: string; settings: unknown },
): Promise<Frame> {
  if ((await zoneProjectId(db, input.zoneId)) === null) throw new ZoneNotFoundError(input.zoneId);
  if (!UUID.test(input.frameId)) throw new FrameNotFoundError(input.frameId);
  const found = await db.query<{ type: string }>('SELECT type FROM frames WHERE id = $1 AND zone_id = $2', [
    input.frameId,
    input.zoneId,
  ]);
  const frame = found.rows[0];
  if (!frame) throw new FrameNotFoundError(input.frameId);

  registry.validate(frame.type, input.settings);

  const { rows } = await db.query<Frame>(
    `UPDATE frames SET settings = $3 WHERE id = $1 AND zone_id = $2 RETURNING ${FRAME_COLUMNS}`,
    [input.frameId, input.zoneId, JSON.stringify(input.settings)],
  );
  // Deleted between the read and the write.
  if (!rows[0]) throw new FrameNotFoundError(input.frameId);
  return rows[0];
}
