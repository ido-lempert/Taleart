import { normalizeTagName, type Tag, type TaleGroupTag } from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import { taleGroupProjectId, TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidTagNameError, TagExistsError, TagNotFoundError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAG_COLUMNS = 'id, project_id AS "projectId", name';
// Tags read by name ignoring case, then by name and id so the order is stable.
const BY_NAME = 'lower(tags.name), tags.name, tags.id';

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

/**
 * Creates a tag in a project. The name is trimmed and must hold 1 to 40
 * characters ({@link InvalidTagNameError}); a name the project already has,
 * in any case, throws {@link TagExistsError}. The caller checks the project exists.
 */
export async function createTag(db: Db, input: { projectId: string; name: string }): Promise<Tag> {
  const name = normalizeTagName(input.name);
  if (name === null) throw new InvalidTagNameError();
  try {
    const { rows } = await db.query<Tag>(
      `INSERT INTO tags (project_id, name) VALUES ($1, $2) RETURNING ${TAG_COLUMNS}`,
      [input.projectId, name],
    );
    return rows[0];
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'tags_project_id_lower_name_key') {
      throw new TagExistsError(name);
    }
    throw err;
  }
}

/** The project's tags by name, ignoring case. Ids that are not UUIDs have none. */
export async function listTags(db: Db, projectId: string): Promise<Tag[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<Tag>(`SELECT ${TAG_COLUMNS} FROM tags WHERE project_id = $1 ORDER BY ${BY_NAME}`, [
    projectId,
  ]);
  return rows;
}

/**
 * Each tale group's tags by name, keyed by group id. Every id in `taleGroupIds`
 * has an entry, empty when the group has no tags.
 */
export async function tagsForTaleGroups(db: Db, taleGroupIds: readonly string[]): Promise<Map<string, TaleGroupTag[]>> {
  // The database returns ids in lower case; callers may pass any case.
  const byGroup = new Map<string, TaleGroupTag[]>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length > 0) {
    const { rows } = await db.query<TaleGroupTag & { taleGroupId: string }>(
      `SELECT links.tale_group_id AS "taleGroupId", tags.id, tags.name
       FROM tale_group_tags links JOIN tags ON tags.id = links.tag_id
       WHERE links.tale_group_id = ANY($1::uuid[])
       ORDER BY ${BY_NAME}`,
      [ids],
    );
    for (const { taleGroupId, ...tag } of rows) {
      const tags = byGroup.get(taleGroupId) ?? [];
      tags.push(tag);
      byGroup.set(taleGroupId, tags);
    }
  }
  return new Map(taleGroupIds.map((id) => [id, byGroup.get(id.toLowerCase()) ?? []]));
}

/**
 * Replaces a tale group's tags with `tagIds` in one transaction; repeated ids
 * count once and an empty list clears them. Every id must name a tag of the
 * group's project, else {@link TagNotFoundError} and nothing changes. Throws
 * {@link TaleGroupNotFoundError} for an unknown group. Returns the new tags by name.
 */
export async function setTaleGroupTags(
  db: TransactionalDb,
  groupId: string,
  tagIds: readonly string[],
): Promise<TaleGroupTag[]> {
  // One case for the lock key and the rows, so ids differing only in case share a lock.
  const taleGroupId = groupId.toLowerCase();
  // Reads the group's project through the tales module's public interface (AD-1).
  const projectId = await taleGroupProjectId(db, taleGroupId);
  if (projectId === null) throw new TaleGroupNotFoundError(taleGroupId);

  const unique = [...new Set(tagIds.map((id) => id.toLowerCase()))];
  const malformed = unique.find((id) => !UUID.test(id));
  if (malformed !== undefined) throw new TagNotFoundError(malformed);

  return inTransaction(db, async (tx) => {
    // The tale_groups table belongs to the tales module, so concurrent sets on
    // one group are serialized with an advisory lock keyed on its id.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_group_tags:' || $1, 0))", [taleGroupId]);
    const found = await tx.query<{ id: string }>('SELECT id FROM tags WHERE id = ANY($1::uuid[]) AND project_id = $2', [
      unique,
      projectId,
    ]);
    const known = new Set(found.rows.map((r) => r.id));
    const missing = unique.find((id) => !known.has(id));
    if (missing !== undefined) throw new TagNotFoundError(missing);

    await tx.query('DELETE FROM tale_group_tags WHERE tale_group_id = $1', [taleGroupId]);
    if (unique.length > 0) {
      await tx.query(
        `INSERT INTO tale_group_tags (tale_group_id, tag_id, project_id)
         SELECT $1, tag_id, $2 FROM unnest($3::uuid[]) AS tag_id`,
        [taleGroupId, projectId, unique],
      );
    }
    return (await tagsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [];
  });
}

/**
 * Gives a copied tale group its source's tags, in the copy's project (AD-14):
 * for each source tag, the project's tag with the same name, ignoring case, is
 * reused, else created. Runs on the caller's transaction, so the copy and its
 * tags commit together. Both groups must exist; the caller authorized both
 * projects. Returns the copy's tags by name.
 */
export async function copyTaleGroupTags(
  tx: Db,
  input: { sourceTaleGroupId: string; taleGroupId: string; projectId: string },
): Promise<TaleGroupTag[]> {
  const taleGroupId = input.taleGroupId.toLowerCase();
  const source = await tx.query<{ name: string }>(
    `SELECT tags.name FROM tale_group_tags links JOIN tags ON tags.id = links.tag_id
     WHERE links.tale_group_id = $1`,
    [input.sourceTaleGroupId],
  );
  if (source.rows.length > 0) {
    const names = source.rows.map((r) => r.name);
    // A concurrent create of the same name waits on the unique index, then
    // this insert skips it and the select below finds it.
    await tx.query(
      `INSERT INTO tags (project_id, name) SELECT $1, name FROM unnest($2::text[]) AS name
       ON CONFLICT (project_id, lower(name)) DO NOTHING`,
      [input.projectId, names],
    );
    await tx.query(
      `INSERT INTO tale_group_tags (tale_group_id, tag_id, project_id)
       SELECT $1, tags.id, $2 FROM tags
       WHERE tags.project_id = $2 AND lower(tags.name) IN (SELECT lower(name) FROM unnest($3::text[]) AS name)
       ON CONFLICT (tale_group_id, tag_id) DO NOTHING`,
      [taleGroupId, input.projectId, names],
    );
  }
  return (await tagsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [];
}

// Valid tag names, each once as stored (trimmed): an invalid one throws before anything is written.
function tagNames(names: readonly string[]): string[] {
  const valid = names.map((name) => {
    const normalized = normalizeTagName(name);
    if (normalized === null) throw new InvalidTagNameError();
    return normalized;
  });
  return [...new Set(valid)];
}

/**
 * The project's tag for each name, ignoring case, created when the project
 * has none: an existing tag keeps its spelling. Keyed by the name as given.
 * A concurrent create of the same name waits on the unique index, then the
 * insert skips it and the select finds it.
 */
async function findOrCreateTags(tx: Db, projectId: string, names: readonly string[]): Promise<Map<string, Tag>> {
  const byName = new Map<string, Tag>();
  if (names.length === 0) return byName;
  await tx.query(
    `INSERT INTO tags (project_id, name) SELECT $1, name FROM unnest($2::text[]) AS name
     ON CONFLICT (project_id, lower(name)) DO NOTHING`,
    [projectId, names],
  );
  const { rows } = await tx.query<Tag & { requested: string }>(
    `SELECT requested.name AS requested, tags.id, tags.project_id AS "projectId", tags.name
     FROM unnest($2::text[]) AS requested(name)
     JOIN tags ON tags.project_id = $1 AND lower(tags.name) = lower(requested.name)`,
    [projectId, names],
  );
  for (const { requested, ...tag } of rows) byName.set(requested, tag);
  return byName;
}

/**
 * The project's tags with these names, ignoring case: an existing tag is
 * reused with its spelling, a missing one is created. Names are trimmed and
 * must hold 1 to 40 characters, else {@link InvalidTagNameError} and nothing
 * is written. Keyed by each trimmed name. The caller checks the project exists.
 */
export async function ensureTags(db: Db, projectId: string, names: readonly string[]): Promise<Map<string, Tag>> {
  return findOrCreateTags(db, projectId, tagNames(names));
}

/**
 * Adds tags to a tale group by name, in its project, keeping every tag it
 * already carries: each name finds the project's tag ignoring case, or
 * creates it, and a tag the group carries is not added twice. Nothing is ever
 * removed. Names are trimmed and must hold 1 to 40 characters
 * ({@link InvalidTagNameError}). Throws {@link TaleGroupNotFoundError} for an
 * unknown group, also one deleted meanwhile. Returns the tag of each trimmed name.
 */
export async function addTaleGroupTagsByName(
  db: TransactionalDb,
  groupId: string,
  names: readonly string[],
): Promise<Map<string, TaleGroupTag>> {
  // One case for the lock key and the rows, as setTaleGroupTags.
  const taleGroupId = groupId.toLowerCase();
  const wanted = tagNames(names);
  // Reads the group's project through the tales module's public interface (AD-1).
  const projectId = UUID.test(taleGroupId) ? await taleGroupProjectId(db, taleGroupId) : null;
  if (projectId === null) throw new TaleGroupNotFoundError(taleGroupId);
  if (wanted.length === 0) return new Map();
  try {
    return await inTransaction(db, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_group_tags:' || $1, 0))", [taleGroupId]);
      const tags = await findOrCreateTags(tx, projectId, wanted);
      await tx.query(
        `INSERT INTO tale_group_tags (tale_group_id, tag_id, project_id)
         SELECT $1, tag_id, $2 FROM unnest($3::uuid[]) AS tag_id
         ON CONFLICT (tale_group_id, tag_id) DO NOTHING`,
        [taleGroupId, projectId, [...new Set([...tags.values()].map((tag) => tag.id))]],
      );
      return new Map([...tags].map(([name, tag]): [string, TaleGroupTag] => [name, { id: tag.id, name: tag.name }]));
    });
  } catch (err) {
    // The group was deleted after its project was read, so its key no longer matches.
    if ((err as { code?: string }).code === '23503') throw new TaleGroupNotFoundError(taleGroupId);
    throw err;
  }
}
