import {
  ErrorCodes,
  isMediaContentType,
  MAX_TALES_PER_GROUP,
  mediaKind,
  taleMediaUrl,
  type MediaContentType,
  type ProjectTaleGroup,
  type Tale,
  type TaleGroup,
  type ZoneTaleGroup,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { zoneProjectId, ZoneNotFoundError } from '@taleart/server-zones';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GROUP_COLUMNS = 'tale_groups.id, tale_groups.project_id AS "projectId", tale_groups.name';
// A group as a zone lists it: the group's columns and its placement's position.
const ZONE_GROUP_COLUMNS = `${GROUP_COLUMNS}, zone_tale_groups.position`;
// Qualified, so the media update can join the tale's old row without ambiguity.
const TALE_COLUMNS =
  'tales.id, tales.tale_group_id AS "taleGroupId", tales.project_id AS "projectId", tales.title, tales.position, ' +
  'tales.media_content_type AS "mediaContentType"';

/**
 * A tale group as this module stores it: everything but its tags, which the
 * targeting module owns. The API composes the tags in (AD-1).
 */
export type StoredTaleGroup = Omit<TaleGroup, 'tags'>;

/** A tale group as a zone lists it, with its position in that zone; tags are composed in by the API. */
export type StoredZoneTaleGroup = Omit<ZoneTaleGroup, 'tags'>;

// A tale_groups row as GROUP_COLUMNS reads it, with the placement's position when read through a zone.
type GroupRow = Omit<StoredTaleGroup, 'tales' | 'zoneIds'>;
type ZoneGroupRow = GroupRow & { position: number };

// A tales row as TALE_COLUMNS reads it. The storage key stays inside the module.
type TaleRow = Omit<Tale, 'media'> & { mediaContentType: string | null };

// The API derives the media URL from the tale id; the row holds only the key (AD-11).
function toTale({ mediaContentType, ...tale }: TaleRow): Tale {
  const media =
    mediaContentType !== null && isMediaContentType(mediaContentType)
      ? { kind: mediaKind(mediaContentType), contentType: mediaContentType, url: taleMediaUrl(tale.id) }
      : null;
  return { ...tale, media };
}

/** A tale's stored media: its storage key and content type. */
export interface StoredTaleMedia {
  key: string;
  contentType: MediaContentType;
}

/** A database that can hand out one connection for a transaction, such as a pg Pool. */
export interface TransactionalDb extends Db {
  connect(): Promise<Db & { release(err?: Error | boolean): void }>;
}

/** Thrown when a tale request names a tale group that does not exist. */
export class TaleGroupNotFoundError extends Error {
  readonly code = ErrorCodes.taleGroupNotFound;

  constructor(readonly taleGroupId: string) {
    super('taleGroupId does not match a tale group');
    this.name = 'TaleGroupNotFoundError';
  }
}

/**
 * Thrown when a zone is asked to place a tale group that does not exist or
 * belongs to another project than the zone's (AD-4). The API answers 400, so
 * a group of a project the caller cannot see is not told apart from none.
 */
export class TaleGroupNotInProjectError extends Error {
  readonly code = ErrorCodes.taleGroupNotFound;

  constructor(readonly taleGroupId: string) {
    super("taleGroupId does not match a tale group of the zone's project");
    this.name = 'TaleGroupNotInProjectError';
  }
}

/** Thrown when a request names a tale that does not exist. */
export class TaleNotFoundError extends Error {
  readonly code = ErrorCodes.taleNotFound;

  constructor(readonly taleId: string) {
    super('taleId does not match a tale');
    this.name = 'TaleNotFoundError';
  }
}

/** Thrown when a tale is added to a tale group that already holds the maximum. */
export class TaleGroupFullError extends Error {
  readonly code = ErrorCodes.taleGroupFull;

  constructor(readonly taleGroupId: string) {
    super(`A tale group holds at most ${MAX_TALES_PER_GROUP} tales`);
    this.name = 'TaleGroupFullError';
  }
}

/**
 * Thrown when an order request does not list every child of its parent exactly
 * once: an id is missing, repeated, or belongs to another parent.
 */
export class OrderMismatchError extends Error {
  readonly code = ErrorCodes.orderMismatch;

  constructor(message: string) {
    super(message);
    this.name = 'OrderMismatchError';
  }
}

// True when `ids` names every id in `current` exactly once and nothing else.
function isPermutation(ids: readonly string[], current: readonly string[]): boolean {
  if (ids.length !== current.length) return false;
  const known = new Set(current);
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// Rewrites a group's tales to positions 0..n-1 in the order of `ids`.
const REORDER_TALES_SQL = `UPDATE tales SET position = ordered.idx - 1
   FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, idx)
   WHERE tales.id = ordered.id AND tales.tale_group_id = $1`;

// Rewrites a zone's placements to positions 0..n-1 in the order of `ids`; other zones are untouched.
const REORDER_PLACEMENTS_SQL = `UPDATE zone_tale_groups SET position = ordered.idx - 1
   FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, idx)
   WHERE zone_tale_groups.tale_group_id = ordered.id AND zone_tale_groups.zone_id = $1`;

// Serializes every change to one zone's placements (create, place, remove,
// order). The zones table belongs to the zones module, so the zone is locked
// with a transaction-scoped advisory lock keyed on its id, not a row lock.
async function lockZone(tx: Db, zoneId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_groups:' || $1, 0))", [zoneId]);
}

// Runs `work` in one transaction on one connection; rolls back on any error.
async function inTransaction<T>(db: TransactionalDb, work: (tx: Db) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    tx.release();
    return result;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      // A connection that cannot roll back is not returned to the pool.
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
}

/** The tale groups placed in the zone, by their position there, each with its tales by position. */
export async function listTaleGroups(db: Db, zoneId: string): Promise<StoredZoneTaleGroup[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  return zoneGroups(db, zoneId);
}

// The zone's placed groups by position, with their tales and zones; the zone is known to exist.
async function zoneGroups(db: Db, zoneId: string): Promise<StoredZoneTaleGroup[]> {
  const groups = await db.query<ZoneGroupRow>(
    `SELECT ${ZONE_GROUP_COLUMNS} FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1
     ORDER BY zone_tale_groups.position, tale_groups.id`,
    [zoneId],
  );
  return withTales(db, groups.rows);
}

// One placed group of the zone, or undefined when the group is not placed there.
async function zoneGroup(db: Db, zoneId: string, taleGroupId: string): Promise<StoredZoneTaleGroup | undefined> {
  const { rows } = await db.query<ZoneGroupRow>(
    `SELECT ${ZONE_GROUP_COLUMNS} FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1 AND zone_tale_groups.tale_group_id = $2`,
    [zoneId, taleGroupId],
  );
  const [group] = await withTales(db, rows);
  return group;
}

/** One tale group with its tales by position and its zones. Throws {@link TaleGroupNotFoundError}. */
export async function getTaleGroup(db: Db, taleGroupId: string): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const { rows } = await db.query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM tale_groups WHERE id = $1`, [taleGroupId]);
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const [group] = await withTales(db, rows);
  return group;
}

/**
 * Renames a tale group; every zone it is placed in shows the new name (AD-14).
 * Returns the group with its tales and zones. Throws {@link TaleGroupNotFoundError}.
 */
export async function renameTaleGroup(db: Db, taleGroupId: string, name: string): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const { rows } = await db.query<GroupRow>(
    `UPDATE tale_groups SET name = $2 WHERE id = $1 RETURNING ${GROUP_COLUMNS}`,
    [taleGroupId, name],
  );
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const [group] = await withTales(db, rows);
  return group;
}

// Every zone each group is placed in, in the order it was placed, keyed by group id.
async function zoneIdsOf(db: Db, taleGroupIds: string[]): Promise<Map<string, string[]>> {
  const byGroup = new Map<string, string[]>(taleGroupIds.map((id) => [id, []]));
  if (taleGroupIds.length === 0) return byGroup;
  const { rows } = await db.query<{ taleGroupId: string; zoneId: string }>(
    `SELECT tale_group_id AS "taleGroupId", zone_id AS "zoneId" FROM zone_tale_groups
     WHERE tale_group_id = ANY($1::uuid[]) ORDER BY created_at, zone_id`,
    [taleGroupIds],
  );
  for (const row of rows) byGroup.get(row.taleGroupId)?.push(row.zoneId);
  return byGroup;
}

// Adds each group's tales, by position, and the zones it is placed in.
async function withTales<T extends GroupRow>(db: Db, groups: T[]): Promise<(T & Omit<StoredTaleGroup, keyof GroupRow>)[]> {
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const tales = await db.query<TaleRow>(
    `SELECT ${TALE_COLUMNS} FROM tales WHERE tale_group_id = ANY($1::uuid[]) ORDER BY position, id`,
    [ids],
  );
  const zoneIds = await zoneIdsOf(db, ids);
  return groups.map((group) => ({
    ...group,
    zoneIds: zoneIds.get(group.id) ?? [],
    tales: tales.rows.filter((tale) => tale.taleGroupId === group.id).map(toTale),
  }));
}

/**
 * Every tale group of the project by name, ignoring case, with its tale count
 * and the zones it is placed in; a group placed in no zone is listed too (AD-14).
 */
export async function listProjectTaleGroups(db: Db, projectId: string): Promise<ProjectTaleGroup[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<Omit<ProjectTaleGroup, 'zoneIds'>>(
    `SELECT ${GROUP_COLUMNS},
       (SELECT count(*) FROM tales WHERE tales.tale_group_id = tale_groups.id)::int AS "taleCount"
     FROM tale_groups WHERE project_id = $1
     ORDER BY lower(name), name, id`,
    [projectId],
  );
  const zoneIds = await zoneIdsOf(db, rows.map((g) => g.id));
  return rows.map((group) => ({ ...group, zoneIds: zoneIds.get(group.id) ?? [] }));
}

/**
 * Creates a tale group in the zone's project and places it at the end of the
 * zone (AD-4, AD-14). Changes to one zone's placements are serialized, so
 * concurrent creates get distinct positions.
 */
export async function createTaleGroup(
  db: TransactionalDb,
  input: { zoneId: string; name: string },
): Promise<StoredZoneTaleGroup> {
  // Reads the project through the zones module's public interface (AD-1).
  const projectId = await zoneProjectId(db, input.zoneId);
  if (projectId === null) throw new ZoneNotFoundError(input.zoneId);

  return inTransaction(db, async (tx) => {
    await lockZone(tx, input.zoneId);
    const { rows } = await tx.query<GroupRow>(
      `INSERT INTO tale_groups (project_id, name) VALUES ($1, $2) RETURNING ${GROUP_COLUMNS}`,
      [projectId, input.name],
    );
    const group = rows[0];
    const placed = await tx.query<{ position: number }>(
      `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))
       RETURNING position`,
      [input.zoneId, group.id, projectId],
    );
    return { ...group, position: placed.rows[0].position, zoneIds: [input.zoneId], tales: [] };
  });
}

/**
 * Places an existing tale group at the end of a zone (AD-14). The group must
 * belong to the zone's project ({@link TaleGroupNotInProjectError} otherwise).
 * A group already placed in the zone stays where it is: `placed` is false.
 * Returns the group with its position in this zone.
 */
export async function placeTaleGroup(
  db: TransactionalDb,
  zoneId: string,
  taleGroupId: string,
): Promise<{ group: StoredZoneTaleGroup; placed: boolean }> {
  const projectId = await zoneProjectId(db, zoneId);
  if (projectId === null) throw new ZoneNotFoundError(zoneId);
  if ((await taleGroupProjectId(db, taleGroupId)) !== projectId) throw new TaleGroupNotInProjectError(taleGroupId);

  return inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    // The composite keys refuse a group of another project at the database too (AD-4).
    const inserted = await tx.query(
      `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))
       ON CONFLICT (zone_id, tale_group_id) DO NOTHING`,
      [zoneId, taleGroupId, projectId],
    );
    const group = await zoneGroup(tx, zoneId, taleGroupId);
    // The group was checked above; only a concurrent delete of the group could
    // remove it, and groups are never deleted.
    if (!group) throw new TaleGroupNotInProjectError(taleGroupId);
    return { group, placed: (inserted.rowCount ?? 0) > 0 };
  });
}

/**
 * Removes a tale group from a zone: only that placement goes; the group, its
 * tales and its other placements stay (AD-14). The zone's remaining positions
 * become 0..n-1 again. Throws {@link TaleGroupNotFoundError} when the group is
 * not placed in the zone.
 */
export async function removeTaleGroup(db: TransactionalDb, zoneId: string, taleGroupId: string): Promise<void> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);

  await inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    const removed = await tx.query(
      'DELETE FROM zone_tale_groups WHERE zone_id = $1 AND tale_group_id = $2',
      [zoneId, taleGroupId],
    );
    if ((removed.rowCount ?? 0) === 0) throw new TaleGroupNotFoundError(taleGroupId);
    await tx.query(
      `UPDATE zone_tale_groups SET position = dense.idx - 1
       FROM (
         SELECT tale_group_id, row_number() OVER (ORDER BY position, tale_group_id) AS idx
         FROM zone_tale_groups WHERE zone_id = $1
       ) dense
       WHERE zone_tale_groups.zone_id = $1 AND zone_tale_groups.tale_group_id = dense.tale_group_id
         AND zone_tale_groups.position <> dense.idx - 1`,
      [zoneId],
    );
  });
}

/**
 * Sets the order of the groups placed in a zone. `taleGroupIds` must list
 * every group placed in the zone exactly once ({@link OrderMismatchError}
 * otherwise); positions in this zone become 0..n-1 in that order, and other
 * zones keep theirs (AD-14). Holds the same zone lock as {@link createTaleGroup},
 * {@link placeTaleGroup} and {@link removeTaleGroup}, so they cannot interleave.
 * Returns the zone's groups in the new order.
 */
export async function orderTaleGroups(
  db: TransactionalDb,
  zoneId: string,
  taleGroupIds: readonly string[],
): Promise<StoredZoneTaleGroup[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);

  return inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    const current = await tx.query<{ id: string }>(
      'SELECT tale_group_id AS id FROM zone_tale_groups WHERE zone_id = $1',
      [zoneId],
    );
    const currentIds = current.rows.map((r) => r.id);
    if (!isPermutation(taleGroupIds.map((id) => id.toLowerCase()), currentIds)) {
      throw new OrderMismatchError('taleGroupIds must list every tale group of the zone exactly once');
    }
    if (currentIds.length > 0) await tx.query(REORDER_PLACEMENTS_SQL, [zoneId, taleGroupIds]);
    return zoneGroups(tx, zoneId);
  });
}

/**
 * Sets the order of a tale group's tales. `taleIds` must list every tale of
 * the group exactly once ({@link OrderMismatchError} otherwise); positions
 * become 0..n-1 in that order. Locks the group row, as {@link createTale}
 * does, so an order and an add cannot interleave. Returns the group's tales
 * in the new order.
 */
export async function orderTales(
  db: TransactionalDb,
  taleGroupId: string,
  taleIds: readonly string[],
): Promise<Tale[]> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);

  return inTransaction(db, async (tx) => {
    const group = await tx.query('SELECT 1 FROM tale_groups WHERE id = $1 FOR UPDATE', [taleGroupId]);
    if (group.rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
    const current = await tx.query<{ id: string }>('SELECT id FROM tales WHERE tale_group_id = $1', [taleGroupId]);
    const currentIds = current.rows.map((r) => r.id);
    if (!isPermutation(taleIds.map((id) => id.toLowerCase()), currentIds)) {
      throw new OrderMismatchError('taleIds must list every tale of the tale group exactly once');
    }
    if (currentIds.length > 0) await tx.query(REORDER_TALES_SQL, [taleGroupId, taleIds]);
    const { rows } = await tx.query<TaleRow>(
      `SELECT ${TALE_COLUMNS} FROM tales WHERE tale_group_id = $1 ORDER BY position, id`,
      [taleGroupId],
    );
    return rows.map(toTale);
  });
}

/** The project of a tale group, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleGroupProjectId(db: Db, taleGroupId: string): Promise<string | null> {
  if (!UUID.test(taleGroupId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM tale_groups WHERE id = $1', [
    taleGroupId,
  ]);
  return rows[0]?.project_id ?? null;
}

/** The project of a tale, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleProjectId(db: Db, taleId: string): Promise<string | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM tales WHERE id = $1', [taleId]);
  return rows[0]?.project_id ?? null;
}

/** True when a tale group with this id exists. Ids that are not UUIDs never match. */
export async function taleGroupExists(db: Db, taleGroupId: string): Promise<boolean> {
  if (!UUID.test(taleGroupId)) return false;
  const { rows } = await db.query('SELECT 1 FROM tale_groups WHERE id = $1', [taleGroupId]);
  return rows.length > 0;
}

/**
 * Adds a tale at the end of a tale group. The tale takes its project from the
 * group (AD-4). The group row is locked, so the position and the
 * {@link MAX_TALES_PER_GROUP} check hold under concurrent adds.
 */
export async function createTale(
  db: TransactionalDb,
  input: { taleGroupId: string; title: string },
): Promise<Tale> {
  if (!UUID.test(input.taleGroupId)) throw new TaleGroupNotFoundError(input.taleGroupId);

  return inTransaction(db, async (tx) => {
    const group = await tx.query<{ project_id: string }>(
      'SELECT project_id FROM tale_groups WHERE id = $1 FOR UPDATE',
      [input.taleGroupId],
    );
    const projectId = group.rows[0]?.project_id;
    if (projectId === undefined) throw new TaleGroupNotFoundError(input.taleGroupId);

    const stats = await tx.query<{ count: number; next: number }>(
      `SELECT count(*)::int AS count, COALESCE(MAX(position), -1) + 1 AS next
       FROM tales WHERE tale_group_id = $1`,
      [input.taleGroupId],
    );
    const { count, next } = stats.rows[0];
    if (count >= MAX_TALES_PER_GROUP) throw new TaleGroupFullError(input.taleGroupId);

    const { rows } = await tx.query<TaleRow>(
      `INSERT INTO tales (tale_group_id, project_id, title, position) VALUES ($1, $2, $3, $4)
       RETURNING ${TALE_COLUMNS}`,
      [input.taleGroupId, projectId, input.title, next],
    );
    return toTale(rows[0]);
  });
}

/** True when a tale with this id exists. Ids that are not UUIDs never match. */
export async function taleExists(db: Db, taleId: string): Promise<boolean> {
  if (!UUID.test(taleId)) return false;
  const { rows } = await db.query('SELECT 1 FROM tales WHERE id = $1', [taleId]);
  return rows.length > 0;
}

/** The tale's stored media, or null when it has none. Throws {@link TaleNotFoundError}. */
export async function getTaleMedia(db: Db, taleId: string): Promise<StoredTaleMedia | null> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rows } = await db.query<{ key: string | null; contentType: string | null }>(
    'SELECT media_key AS key, media_content_type AS "contentType" FROM tales WHERE id = $1',
    [taleId],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const { key, contentType } = rows[0];
  return key !== null && isMediaContentType(contentType) ? { key, contentType } : null;
}

/**
 * Points the tale at newly stored media. Returns the updated tale and the key
 * it pointed at before (null when none), so the caller can delete that file.
 * Throws {@link TaleNotFoundError}.
 */
export async function setTaleMedia(
  db: Db,
  taleId: string,
  media: StoredTaleMedia,
): Promise<{ tale: Tale; previousKey: string | null }> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  // The subquery locks the row and reads the old key in the same statement.
  const { rows } = await db.query<TaleRow & { previousKey: string | null }>(
    `UPDATE tales SET media_key = $2, media_content_type = $3
     FROM (SELECT id AS old_id, media_key AS old_key FROM tales WHERE id = $1 FOR UPDATE) old
     WHERE tales.id = old.old_id
     RETURNING ${TALE_COLUMNS}, old.old_key AS "previousKey"`,
    [taleId, media.key, media.contentType],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const { previousKey, ...row } = rows[0];
  return { tale: toTale(row), previousKey };
}

/** A tale as the Delivery API needs it: its stored media key stays for the API to build the public URL. */
export interface DeliveryStoredTale {
  id: string;
  title: string;
  media: StoredTaleMedia | null;
}

/** A tale group as the Delivery API needs it, with its tales by position. */
export interface DeliveryStoredTaleGroup {
  id: string;
  name: string;
  tales: DeliveryStoredTale[];
}

/**
 * The published tale groups placed in the zone, in this zone's order (AD-2,
 * AD-14), each with its published tales by position, for the Delivery API. Until statuses exist every tale group and
 * tale counts as published. Each tale carries its storage key, which the API
 * turns into a public URL (AD-11) and never returns on its own.
 */
export async function listDeliveryTaleGroups(db: Db, zoneId: string): Promise<DeliveryStoredTaleGroup[]> {
  if (!UUID.test(zoneId)) return [];
  const groups = await db.query<{ id: string; name: string }>(
    `SELECT tale_groups.id, tale_groups.name FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1
     ORDER BY zone_tale_groups.position, tale_groups.id`,
    [zoneId],
  );
  if (groups.rows.length === 0) return [];
  const tales = await db.query<{
    id: string;
    taleGroupId: string;
    title: string;
    key: string | null;
    contentType: string | null;
  }>(
    `SELECT id, tale_group_id AS "taleGroupId", title, media_key AS key, media_content_type AS "contentType"
     FROM tales WHERE tale_group_id = ANY($1::uuid[]) ORDER BY position, id`,
    [groups.rows.map((g) => g.id)],
  );
  return groups.rows.map((group) => ({
    id: group.id,
    name: group.name,
    tales: tales.rows
      .filter((tale) => tale.taleGroupId === group.id)
      .map(({ id, title, key, contentType }) => ({
        id,
        title,
        media: key !== null && isMediaContentType(contentType) ? { key, contentType } : null,
      })),
  }));
}

/**
 * The stored media a published tale currently references under `key`, or null
 * when no tale does (an unknown key, or the key of replaced media). Until
 * statuses exist every tale counts as published.
 */
export async function findPublishedMedia(db: Db, key: string): Promise<StoredTaleMedia | null> {
  const { rows } = await db.query<{ contentType: string | null }>(
    'SELECT media_content_type AS "contentType" FROM tales WHERE media_key = $1 LIMIT 1',
    [key],
  );
  const contentType = rows[0]?.contentType;
  return isMediaContentType(contentType) ? { key, contentType } : null;
}
