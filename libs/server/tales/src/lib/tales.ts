import {
  ErrorCodes,
  isMediaContentType,
  MAX_TALES_PER_GROUP,
  mediaKind,
  taleMediaUrl,
  type MediaContentType,
  type Tale,
  type TaleGroup,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { zoneProjectId, ZoneNotFoundError } from '@taleart/server-zones';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GROUP_COLUMNS = 'id, zone_id AS "zoneId", project_id AS "projectId", name, position';
// Qualified, so the media update can join the tale's old row without ambiguity.
const TALE_COLUMNS =
  'tales.id, tales.tale_group_id AS "taleGroupId", tales.project_id AS "projectId", tales.title, tales.position, ' +
  'tales.media_content_type AS "mediaContentType"';

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

/** The zone's tale groups by position, each with its tales by position. */
export async function listTaleGroups(db: Db, zoneId: string): Promise<TaleGroup[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  const groups = await db.query<Omit<TaleGroup, 'tales'>>(
    `SELECT ${GROUP_COLUMNS} FROM tale_groups WHERE zone_id = $1 ORDER BY position, id`,
    [zoneId],
  );
  if (groups.rows.length === 0) return [];
  const tales = await db.query<TaleRow>(
    `SELECT ${TALE_COLUMNS} FROM tales WHERE tale_group_id = ANY($1::uuid[]) ORDER BY position, id`,
    [groups.rows.map((g) => g.id)],
  );
  return groups.rows.map((group) => ({
    ...group,
    tales: tales.rows.filter((tale) => tale.taleGroupId === group.id).map(toTale),
  }));
}

/**
 * Creates a tale group at the end of a zone. The group takes its project from
 * the zone (AD-4). Creates in one zone are serialized, so concurrent creates
 * get distinct positions.
 */
export async function createTaleGroup(
  db: TransactionalDb,
  input: { zoneId: string; name: string },
): Promise<TaleGroup> {
  // Reads the project through the zones module's public interface (AD-1).
  const projectId = await zoneProjectId(db, input.zoneId);
  if (projectId === null) throw new ZoneNotFoundError(input.zoneId);

  return inTransaction(db, async (tx) => {
    // The zones table belongs to the zones module, so the zone is locked with
    // a transaction-scoped advisory lock keyed on its id, not a row lock.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_groups:' || $1, 0))", [input.zoneId]);
    const { rows } = await tx.query<Omit<TaleGroup, 'tales'>>(
      `INSERT INTO tale_groups (zone_id, project_id, name, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM tale_groups WHERE zone_id = $1))
       RETURNING ${GROUP_COLUMNS}`,
      [input.zoneId, projectId, input.name],
    );
    return { ...rows[0], tales: [] };
  });
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
