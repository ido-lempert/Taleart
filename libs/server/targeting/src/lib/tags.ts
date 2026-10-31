import { DEFAULT_TAG_MATCH, normalizeTagName, type Tag, type TagMatch, type TaleGroupTag } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import { taleGroupProjectId, TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidTagNameError, TagExistsError, TagNotFoundError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAG_COLUMNS = 'id, project_id AS "projectId", name';
// Tags read by name ignoring case, then by name and id so the order is stable.
const BY_NAME = 'lower(tags.name), tags.name, tags.id';

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
 * Each tale group's tag match mode (epic targeting R1), keyed by group id as
 * given. Every id has an entry: {@link DEFAULT_TAG_MATCH} when none is stored.
 */
export async function tagMatchesForTaleGroups(db: Db, taleGroupIds: readonly string[]): Promise<Map<string, TagMatch>> {
  const stored = new Map<string, TagMatch>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length > 0) {
    const { rows } = await db.query<{ taleGroupId: string; tagMatch: TagMatch }>(
      `SELECT tale_group_id AS "taleGroupId", tag_match AS "tagMatch"
       FROM tale_group_tag_matches WHERE tale_group_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) stored.set(row.taleGroupId, row.tagMatch);
  }
  return new Map(taleGroupIds.map((id) => [id, stored.get(id.toLowerCase()) ?? DEFAULT_TAG_MATCH]));
}

/** A tale group's targeting as the Delivery API sends it: its tag names, by name, and how they combine. */
export interface TaleGroupTagRule {
  tags: string[];
  tagMatch: TagMatch;
}

/**
 * Each tale group's tag rule for the Delivery API (epic targeting R2), keyed by
 * group id as given: the names of its tags, by name ignoring case, and its
 * match mode. One query for both; every id has an entry.
 */
export async function tagRulesForTaleGroups(
  db: Db,
  taleGroupIds: readonly string[],
): Promise<Map<string, TaleGroupTagRule>> {
  const byGroup = new Map<string, TaleGroupTagRule>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length > 0) {
    const { rows } = await db.query<{ taleGroupId: string; tags: string[] | null; tagMatch: TagMatch | null }>(
      `SELECT g.id AS "taleGroupId",
         (SELECT array_agg(tags.name ORDER BY ${BY_NAME})
            FROM tale_group_tags links JOIN tags ON tags.id = links.tag_id
            WHERE links.tale_group_id = g.id) AS tags,
         (SELECT tag_match FROM tale_group_tag_matches m WHERE m.tale_group_id = g.id) AS "tagMatch"
       FROM unnest($1::uuid[]) AS g(id)`,
      [ids],
    );
    for (const row of rows) {
      byGroup.set(row.taleGroupId, { tags: row.tags ?? [], tagMatch: row.tagMatch ?? DEFAULT_TAG_MATCH });
    }
  }
  return new Map(
    taleGroupIds.map((id) => [id, byGroup.get(id.toLowerCase()) ?? { tags: [], tagMatch: DEFAULT_TAG_MATCH }]),
  );
}

/**
 * Replaces a tale group's tags with `tagIds` in one transaction; repeated ids
 * count once and an empty list clears them. Every id must name a tag of the
 * group's project, else {@link TagNotFoundError} and nothing changes. With
 * `tagMatch`, the group's match mode is set in the same transaction; without
 * it, the group keeps its mode. Throws {@link TaleGroupNotFoundError} for an
 * unknown group. Returns the new tags by name and the group's match mode.
 */
export async function setTaleGroupTags(
  db: TransactionalDb,
  groupId: string,
  tagIds: readonly string[],
  tagMatch?: TagMatch,
): Promise<{ tags: TaleGroupTag[]; tagMatch: TagMatch }> {
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
    if (tagMatch !== undefined) await storeTagMatch(tx, taleGroupId, projectId, tagMatch);
    return {
      tags: (await tagsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [],
      tagMatch: (await tagMatchesForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? DEFAULT_TAG_MATCH,
    };
  });
}

// Stores a group's match mode, replacing the one it had.
async function storeTagMatch(tx: Db, taleGroupId: string, projectId: string, tagMatch: TagMatch): Promise<void> {
  await tx.query(
    `INSERT INTO tale_group_tag_matches (tale_group_id, project_id, tag_match) VALUES ($1, $2, $3)
     ON CONFLICT (tale_group_id) DO UPDATE SET tag_match = EXCLUDED.tag_match, updated_at = now()`,
    [taleGroupId, projectId, tagMatch],
  );
}

/**
 * Gives a copied tale group its source's tags and match mode, in the copy's
 * project (AD-14, epic targeting R1): for each source tag, the project's tag
 * with the same name, ignoring case, is reused, else created. Runs on the
 * caller's transaction, so the copy and its tags commit together. Both groups
 * must exist; the caller authorized both projects. Returns the copy's tags by
 * name and its match mode.
 */
export async function copyTaleGroupTags(
  tx: Db,
  input: { sourceTaleGroupId: string; taleGroupId: string; projectId: string },
): Promise<{ tags: TaleGroupTag[]; tagMatch: TagMatch }> {
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
    await tx.query(INSERT_TAGS, [input.projectId, names]);
    await tx.query(
      `INSERT INTO tale_group_tags (tale_group_id, tag_id, project_id)
       SELECT $1, tags.id, $2 FROM tags
       WHERE tags.project_id = $2 AND lower(tags.name) IN (SELECT lower(name) FROM unnest($3::text[]) AS name)
       ON CONFLICT (tale_group_id, tag_id) DO NOTHING`,
      [taleGroupId, input.projectId, names],
    );
  }
  const tags = (await tagsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [];
  const tagMatch = (await tagMatchesForTaleGroups(tx, [input.sourceTaleGroupId])).get(input.sourceTaleGroupId);
  // Only a mode other than the default needs a row.
  if (tagMatch !== undefined && tagMatch !== DEFAULT_TAG_MATCH) {
    await storeTagMatch(tx, taleGroupId, input.projectId, tagMatch);
  }
  return { tags, tagMatch: tagMatch ?? DEFAULT_TAG_MATCH };
}

/**
 * Creates the names a project lacks, ignoring case. Rows are inserted in one
 * order, by `lower(name)`, for every caller: two concurrent inserts of
 * overlapping names then wait on each other in the same order and cannot
 * deadlock on the unique index.
 */
const INSERT_TAGS = `INSERT INTO tags (project_id, name)
  SELECT $1, name FROM unnest($2::text[]) AS name ORDER BY lower(name), name
  ON CONFLICT (project_id, lower(name)) DO NOTHING`;
