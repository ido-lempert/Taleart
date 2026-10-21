import { ErrorCodes, isStageKey, type DeliveryStage, type Stage } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { ZoneNotFoundError, zoneProjectId } from './frames';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAGE_COLUMNS =
  'id, zone_id AS "zoneId", project_id AS "projectId", frame_id AS "frameId", name, key';

// The constraint that keeps a key unique in its zone (see migration.ts).
const UNIQUE_KEY_CONSTRAINT = 'stages_zone_id_key_key';

/** Thrown when a stage id does not match a stage of the zone. */
export class StageNotFoundError extends Error {
  readonly code = ErrorCodes.stageNotFound;

  constructor(readonly stageId: string) {
    super('stageId does not match a stage of this zone');
    this.name = 'StageNotFoundError';
  }
}

/** Thrown when a stage names a frame that is not one of its zone's frames. */
export class StageFrameNotFoundError extends Error {
  readonly code = ErrorCodes.frameNotFound;

  constructor(readonly frameId: string) {
    super('frameId does not match a frame of this zone');
    this.name = 'StageFrameNotFoundError';
  }
}

/** Thrown when another stage of the zone already has the key. */
export class StageKeyTakenError extends Error {
  readonly code = ErrorCodes.stageKeyTaken;

  constructor(readonly key: string) {
    super(`Another stage of this zone already has the key "${key}"`);
    this.name = 'StageKeyTakenError';
  }
}

/** Thrown when a stage's name is blank or its key is not a stage key. */
export class InvalidStageError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidStageError';
  }
}

// The trimmed name, or an error for a blank one.
function stageName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new InvalidStageError('name is required');
  return name;
}

async function requireZoneProject(db: Db, zoneId: string): Promise<string> {
  const projectId = await zoneProjectId(db, zoneId);
  if (projectId === null) throw new ZoneNotFoundError(zoneId);
  return projectId;
}

/** The zone's stages, oldest first (epic web zones R7). */
export async function listStages(db: Db, zoneId: string): Promise<Stage[]> {
  await requireZoneProject(db, zoneId);
  const { rows } = await db.query<Stage>(
    `SELECT ${STAGE_COLUMNS} FROM stages WHERE zone_id = $1 ORDER BY created_at, id`,
    [zoneId],
  );
  return rows;
}

/**
 * Adds a stage that shows one of the zone's frames. The name is trimmed and
 * must not be blank; the key must be a stage key and free in the zone. The
 * stage takes its project from the zone (AD-4).
 */
export async function createStage(
  db: Db,
  input: { zoneId: string; name: unknown; key: unknown; frameId: unknown },
): Promise<Stage> {
  const projectId = await requireZoneProject(db, input.zoneId);
  const name = stageName(input.name);
  if (!isStageKey(input.key)) {
    throw new InvalidStageError(
      'key must be lowercase letters and digits, words joined by single hyphens, at most 64 characters',
    );
  }
  const key = input.key;
  if (typeof input.frameId !== 'string' || !input.frameId) throw new InvalidStageError('frameId is required');
  const frameId = input.frameId;
  if (!UUID.test(frameId)) throw new StageFrameNotFoundError(frameId);
  const frame = await db.query('SELECT 1 FROM frames WHERE id = $1 AND zone_id = $2', [frameId, input.zoneId]);
  if (frame.rows.length === 0) throw new StageFrameNotFoundError(frameId);

  try {
    const { rows } = await db.query<Stage>(
      `INSERT INTO stages (zone_id, project_id, frame_id, name, key) VALUES ($1, $2, $3, $4, $5)
       RETURNING ${STAGE_COLUMNS}`,
      [input.zoneId, projectId, frameId, name, key],
    );
    return rows[0];
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === UNIQUE_KEY_CONSTRAINT) throw new StageKeyTakenError(key);
    // The frame was deleted between the check and the insert.
    if (pgError.code === '23503') throw new StageFrameNotFoundError(frameId);
    throw err;
  }
}

/** Renames a stage of the zone. Its key and frame stay, so pages that name it keep working. */
export async function renameStage(db: Db, input: { zoneId: string; stageId: string; name: unknown }): Promise<Stage> {
  await requireZoneProject(db, input.zoneId);
  const name = stageName(input.name);
  if (!UUID.test(input.stageId)) throw new StageNotFoundError(input.stageId);
  const { rows } = await db.query<Stage>(
    `UPDATE stages SET name = $3 WHERE id = $1 AND zone_id = $2 RETURNING ${STAGE_COLUMNS}`,
    [input.stageId, input.zoneId, name],
  );
  if (!rows[0]) throw new StageNotFoundError(input.stageId);
  return rows[0];
}

/** Deletes a stage of the zone. */
export async function deleteStage(db: Db, input: { zoneId: string; stageId: string }): Promise<void> {
  await requireZoneProject(db, input.zoneId);
  if (!UUID.test(input.stageId)) throw new StageNotFoundError(input.stageId);
  const { rowCount } = await db.query('DELETE FROM stages WHERE id = $1 AND zone_id = $2', [input.stageId, input.zoneId]);
  if (!rowCount) throw new StageNotFoundError(input.stageId);
}

/** The zone's stages as the Delivery API returns them: key and frame only, oldest first. */
export async function listDeliveryStages(db: Db, zoneId: string): Promise<DeliveryStage[]> {
  const { rows } = await db.query<DeliveryStage>(
    'SELECT key, frame_id AS "frameId" FROM stages WHERE zone_id = $1 ORDER BY created_at, id',
    [zoneId],
  );
  return rows;
}
