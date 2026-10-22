import {
  ErrorCodes,
  isZoneSlug,
  uniqueZoneSlug,
  zoneSlugFromName,
  type AppliedPlaybook,
  type Zone,
} from '@taleart/contract';
import { projectExists, type Db, type ProjectScope } from '@taleart/server-access';

/** A zone as this module stores it: its visibility (epic UX rework R7) is composed in by the API. */
export type StoredZone = Omit<Zone, 'visibility'>;

/** The outcome of applying a playbook, with the zone as stored. */
export type StoredAppliedPlaybook = Omit<AppliedPlaybook, 'zone'> & { zone: StoredZone };

/**
 * The columns of a zone as the API returns it: its slug, the applied playbook's key (R8) and its
 * display, the zone's one frame or null (AD-17). Reads the table as `zones`, so it also serves
 * `INSERT … RETURNING` and `UPDATE … RETURNING`.
 */
export const ZONE_COLUMNS = `zones.id, zones.name, zones.slug, zones.project_id AS "projectId",
  zones.playbook_key AS "playbookKey",
  (SELECT json_build_object('id', f.id, 'zoneId', f.zone_id, 'projectId', f.project_id, 'type', f.type, 'settings', f.settings)
   FROM frames f WHERE f.zone_id = zones.id ORDER BY f.created_at, f.id LIMIT 1) AS frame`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The unique index that keeps a slug unique in its project (see migration.ts).
const UNIQUE_SLUG_INDEX = 'zones_project_id_slug_key';

/** Thrown when a zone names a project that does not exist. */
export class ProjectNotFoundError extends Error {
  readonly code = ErrorCodes.projectNotFound;

  constructor(readonly projectId: string) {
    super('projectId does not match a project');
    this.name = 'ProjectNotFoundError';
  }
}

/** Thrown when a zone's name is blank or its slug is not a slug. */
export class InvalidZoneError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidZoneError';
  }
}

/** Thrown when another zone of the project already has the slug. */
export class SlugTakenError extends Error {
  readonly code = ErrorCodes.slugTaken;

  constructor(readonly slug: string) {
    super(`Another zone of this project already has the slug "${slug}"`);
    this.name = 'SlugTakenError';
  }
}

// The slug as given, or an error when it is not one.
function checkedSlug(value: unknown): string {
  if (!isZoneSlug(value)) {
    throw new InvalidZoneError(
      'slug must be lowercase letters and digits, words joined by single hyphens, at most 64 characters',
    );
  }
  return value;
}

/** The zones of the projects in `scope` (every project by default), oldest first. */
export async function listZones(db: Db, scope: ProjectScope = 'all'): Promise<StoredZone[]> {
  if (scope !== 'all') {
    const { rows } = await db.query<StoredZone>(
      `SELECT ${ZONE_COLUMNS} FROM zones WHERE project_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [scope],
    );
    return rows;
  }
  const { rows } = await db.query<StoredZone>(`SELECT ${ZONE_COLUMNS} FROM zones ORDER BY created_at, id`);
  return rows;
}

/**
 * Creates a zone in a project, without a display. A given slug must be a slug ({@link InvalidZoneError})
 * and free in the project ({@link SlugTakenError}). Without one, the slug is made from the name and
 * made unique in the project with `-2`, `-3`, … (epic UX rework R1).
 */
export async function createZone(
  db: Db,
  input: { name: string; projectId: string; slug?: unknown },
): Promise<StoredZone> {
  const given = input.slug === undefined ? null : checkedSlug(input.slug);
  if (!(await projectExists(db, input.projectId))) {
    throw new ProjectNotFoundError(input.projectId);
  }
  // A clash writes no row (ON CONFLICT DO NOTHING keeps a caller's transaction usable): a given
  // slug is refused, a made one is picked again from the slugs taken by then.
  for (let attempt = 1; ; attempt++) {
    const slug = given ?? (await freeSlug(db, input.projectId, zoneSlugFromName(input.name)));
    const { rows } = await db.query<StoredZone>(
      `INSERT INTO zones (name, project_id, slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING ${ZONE_COLUMNS}`,
      [input.name, input.projectId, slug],
    );
    if (rows[0]) return rows[0];
    if (given !== null || attempt >= 5) throw new SlugTakenError(slug);
  }
}

// `base`, or the first of `base-2`, `base-3`, … that no zone of the project has.
async function freeSlug(db: Db, projectId: string, base: string): Promise<string> {
  const root = base || 'zone';
  const { rows } = await db.query<{ slug: string }>(
    'SELECT slug FROM zones WHERE project_id = $1 AND left(slug, $3) = left($2, $3)',
    [projectId, root, Math.min(root.length, 50)],
  );
  const taken = new Set((rows ?? []).map((row) => row.slug));
  return uniqueZoneSlug(root, (slug) => taken.has(slug));
}

/**
 * Renames a zone or changes its slug (epic UX rework R1). The name is trimmed and must not be
 * blank; the slug must be a slug and free in the project. Null when the zone does not exist.
 */
export async function updateZone(
  db: Db,
  zoneId: string,
  input: { name?: unknown; slug?: unknown },
): Promise<StoredZone | null> {
  if (input.name === undefined && input.slug === undefined) throw new InvalidZoneError('name or slug is required');
  const name = input.name === undefined ? null : typeof input.name === 'string' ? input.name.trim() : '';
  if (name === '') throw new InvalidZoneError('name must not be blank');
  const slug = input.slug === undefined ? null : checkedSlug(input.slug);
  if (!UUID.test(zoneId)) return null;
  try {
    const { rows } = await db.query<StoredZone>(
      `UPDATE zones SET name = COALESCE($2, name), slug = COALESCE($3, slug) WHERE id = $1 RETURNING ${ZONE_COLUMNS}`,
      [zoneId, name, slug],
    );
    return rows[0] ?? null;
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === UNIQUE_SLUG_INDEX && slug !== null) {
      throw new SlugTakenError(slug);
    }
    throw err;
  }
}

/**
 * Renames a zone when `decide` says so: the zone row is locked, `decide` gets
 * its current name and answers the new one, or null to leave it. Run it on a
 * transaction, so the decision and the write see the same name (the importer
 * keeps names a person changed). Returns the name before and after, or null
 * when the zone does not exist. The slug stays.
 */
export async function renameZoneWhen(
  db: Db,
  zoneId: string,
  decide: (current: string) => string | null,
): Promise<{ before: string; after: string } | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM zones WHERE id = $1 FOR NO KEY UPDATE', [zoneId]);
  if (rows.length === 0) return null;
  const before = rows[0].name;
  const next = decide(before);
  if (next === null || next === before) return { before, after: before };
  await db.query('UPDATE zones SET name = $2 WHERE id = $1', [zoneId, next]);
  return { before, after: next };
}
