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

/**
 * The id of the zone of `projectId` with this slug, or null (epic UX rework R3). One indexed query
 * whatever the input, so a missing project or a slug that is not a slug costs what a miss does.
 */
export async function zoneIdBySlug(db: Db, projectId: string | null, slug: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM zones WHERE project_id = $1::uuid AND slug = $2',
    [projectId !== null && UUID.test(projectId) ? projectId : '00000000-0000-0000-0000-000000000000', slug],
  );
  return rows[0]?.id ?? null;
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

/** Thrown when the display's type changed while a change was being made, twice in a row; it can be tried again. */
export class DisplayConcurrentChangeError extends Error {
  readonly code = ErrorCodes.concurrentChange;

  constructor() {
    super("The zone's display changed meanwhile. Try again.");
    this.name = 'DisplayConcurrentChangeError';
  }
}

/**
 * Changes a zone's display: a new `type` resets the settings to that type's defaults unless
 * `settings` is given too; `settings` replaces them and must match the schema of the display's
 * (new) type (AD-5). Nothing is stored when they do not. The display keeps its id (AD-10).
 *
 * The write holds only while the display still has the type the settings were checked against:
 * when another change switched it meanwhile, the change is checked again against the new type,
 * once, and then refused with {@link DisplayConcurrentChangeError}.
 */
export async function updateDisplay(
  db: Db,
  registry: FrameTypeRegistry,
  input: { zoneId: string; type?: string; settings?: unknown },
): Promise<Frame> {
  if ((await zoneProjectId(db, input.zoneId)) === null) throw new ZoneNotFoundError(input.zoneId);
  if (input.type === undefined && input.settings === undefined) throw new EmptyDisplayChangeError();
  for (let attempt = 1; attempt <= 2; attempt++) {
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
      if (same.rows[0]) return same.rows[0];
      throw new DisplayNotFoundError(input.zoneId);
    }
    registry.validate(type, settings);

    const { rows } = await db.query<Frame>(
      `UPDATE frames SET type = $2, settings = $3 WHERE id = $1 AND type = $4 RETURNING ${FRAME_COLUMNS}`,
      [display.id, type, JSON.stringify(settings), display.type],
    );
    if (rows[0]) return rows[0];
    // Deleted, or its type changed, between the read and the write: read it again.
  }
  throw new DisplayConcurrentChangeError();
}

/**
 * SQL that is true when the zone whose id is the expression `zoneId` has a display: its frame row
 * (AD-17). The zones module owns the `frames` table; other modules build their visibility and
 * Delivery rules with this (epic UX rework R7).
 */
export function zoneHasDisplaySql(zoneId: string): string {
  return `EXISTS (SELECT 1 FROM frames zf WHERE zf.zone_id = ${zoneId})`;
}

/**
 * SQL for the project id of the zone whose id is the expression `zoneId`. The zones module owns the
 * `zones` table; the visibility rule passes this to the access module's `zoneInstalledSql`.
 */
export function zoneProjectIdSql(zoneId: string): string {
  return `(SELECT zpi.project_id FROM zones zpi WHERE zpi.id = ${zoneId})`;
}
