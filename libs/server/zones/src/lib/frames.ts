import { ErrorCodes, type Frame } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import type { FrameTypeRegistry } from './frame-types';
import { ZONE_COLUMNS, type StoredZone } from './zones';

// A zone has at most one frame, its display (AD-5 amended, AD-17). The API and the code keep the
// name `frame` for the row; the dashboard says Display.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRAME_COLUMNS = 'id, zone_id AS "zoneId", project_id AS "projectId", type, settings';

/** Thrown when a request names a zone that does not exist. */
export class ZoneNotFoundError extends Error {
  readonly code = ErrorCodes.zoneNotFound;

  constructor(readonly zoneId: string) {
    super('zoneId does not match a zone');
    this.name = 'ZoneNotFoundError';
  }
}

/** Thrown when a display is changed on a zone that has none. */
export class DisplayNotFoundError extends Error {
  readonly code = ErrorCodes.displayNotFound;

  constructor(readonly zoneId: string) {
    super('This zone has no display yet');
    this.name = 'DisplayNotFoundError';
  }
}

/** Thrown when a zone that already has a display is given another one: a zone has one display. */
export class DisplayExistsError extends Error {
  readonly code = ErrorCodes.displayExists;

  constructor(readonly zoneId: string) {
    super('This zone already has a display; a zone has one. Change its type or settings instead.');
    this.name = 'DisplayExistsError';
  }
}

/** Thrown when a display change names neither a type nor settings. */
export class EmptyDisplayChangeError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super('type or settings is required');
    this.name = 'EmptyDisplayChangeError';
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

/** The zone with this id, with its display, or null when it does not exist. Ids that are not UUIDs never match. */
export async function findZone(db: Db, zoneId: string): Promise<StoredZone | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<StoredZone>(`SELECT ${ZONE_COLUMNS} FROM zones WHERE id = $1`, [zoneId]);
  return rows[0] ?? null;
}

/** True when a zone with this id exists. Ids that are not UUIDs never match. */
export async function zoneExists(db: Db, zoneId: string): Promise<boolean> {
  return (await zoneProjectId(db, zoneId)) !== null;
}

/**
 * Gives a zone its display: a frame of a registered type whose settings match the type's schema
 * (AD-5). Missing settings are the type's defaults. The frame takes its project from the zone
 * (AD-4). A zone that already has a display is refused ({@link DisplayExistsError}), also when
 * two requests race: the unique index on `frames (zone_id)` keeps one.
 */
export async function setDisplay(
  db: Db,
  registry: FrameTypeRegistry,
  input: { zoneId: string; type: string; settings?: unknown },
): Promise<Frame> {
  const projectId = await zoneProjectId(db, input.zoneId);
  if (projectId === null) throw new ZoneNotFoundError(input.zoneId);

  const settings = input.settings === undefined ? registry.withDefaults(input.type, {}) : input.settings;
  registry.validate(input.type, settings);

  const { rows } = await db.query<Frame>(
    `INSERT INTO frames (zone_id, project_id, type, settings)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM frames WHERE zone_id = $1)
     ON CONFLICT DO NOTHING
     RETURNING ${FRAME_COLUMNS}`,
    [input.zoneId, projectId, input.type, JSON.stringify(settings)],
  );
  if (!rows[0]) throw new DisplayExistsError(input.zoneId);
  return rows[0];
}

/**
 * Changes a zone's display: a new `type` resets the settings to that type's defaults unless
 * `settings` is given too; `settings` replaces them and must match the schema of the display's
 * (new) type (AD-5). Nothing is stored when they do not. The display keeps its id (AD-10).
 */
export async function updateDisplay(
  db: Db,
  registry: FrameTypeRegistry,
  input: { zoneId: string; type?: string; settings?: unknown },
): Promise<Frame> {
  if ((await zoneProjectId(db, input.zoneId)) === null) throw new ZoneNotFoundError(input.zoneId);
  if (input.type === undefined && input.settings === undefined) throw new EmptyDisplayChangeError();
  const found = await db.query<{ id: string; type: string }>(
    'SELECT id, type FROM frames WHERE zone_id = $1 ORDER BY created_at, id LIMIT 1',
    [input.zoneId],
  );
  const display = found.rows[0];
  if (!display) throw new DisplayNotFoundError(input.zoneId);

  const type = input.type ?? display.type;
  const settings =
    input.settings !== undefined
      ? input.settings
      : type !== display.type
        ? registry.withDefaults(type, {})
        : undefined;
  if (settings === undefined) {
    // The same type and no settings: nothing changes.
    const same = await db.query<Frame>(`SELECT ${FRAME_COLUMNS} FROM frames WHERE id = $1`, [display.id]);
    return same.rows[0];
  }
  registry.validate(type, settings);

  const { rows } = await db.query<Frame>(
    `UPDATE frames SET type = $2, settings = $3 WHERE id = $1 RETURNING ${FRAME_COLUMNS}`,
    [display.id, type, JSON.stringify(settings)],
  );
  // Deleted between the read and the write.
  if (!rows[0]) throw new DisplayNotFoundError(input.zoneId);
  return rows[0];
}

/**
 * SQL that is true when the zone whose id is the expression `zoneId` has a display: its frame row
 * (AD-17). The zones module owns the `frames` table; other modules build their visibility and
 * Delivery rules with this (epic UX rework R7).
 */
export function zoneHasDisplaySql(zoneId: string): string {
  return `EXISTS (SELECT 1 FROM frames zf WHERE zf.zone_id = ${zoneId})`;
}
