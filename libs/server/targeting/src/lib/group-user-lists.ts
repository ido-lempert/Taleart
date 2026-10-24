import type { TaleGroupUserList } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import { taleGroupProjectId, TaleGroupNotFoundError } from '@taleart/server-tales';
import { UserListNotFoundError } from './errors';
import { hashExternalUserId } from './user-lists';

// The user lists a tale group is targeted to (epic targeting R4), and the Delivery API's match of
// a viewer's external user ID against them. The ID is hashed here with the project's secret and only
// the hash reaches the database, through the `user_list_ids` primary key (an index probe). The ID is
// never stored, logged or put in an error.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lists read by name ignoring case, then by name and id so the order is stable.
const BY_NAME = 'lower(l.name), l.name, l.id';

/**
 * Each tale group's user lists by name, with how many IDs each holds, keyed by group id as given.
 * Every id has an entry, empty when the group is targeted to none.
 */
export async function userListsForTaleGroups(
  db: Db,
  taleGroupIds: readonly string[],
): Promise<Map<string, TaleGroupUserList[]>> {
  const byGroup = new Map<string, TaleGroupUserList[]>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length > 0) {
    const { rows } = await db.query<TaleGroupUserList & { taleGroupId: string }>(
      `SELECT g.tale_group_id AS "taleGroupId", l.id, l.name, l.id_count AS "idCount"
       FROM tale_group_user_lists g JOIN user_lists l ON l.id = g.user_list_id
       WHERE g.tale_group_id = ANY($1::uuid[])
       ORDER BY ${BY_NAME}`,
      [ids],
    );
    for (const { taleGroupId, ...list } of rows) {
      const lists = byGroup.get(taleGroupId) ?? [];
      lists.push(list);
      byGroup.set(taleGroupId, lists);
    }
  }
  return new Map(taleGroupIds.map((id) => [id, byGroup.get(id.toLowerCase()) ?? []]));
}

/**
 * Replaces the user lists a tale group is targeted to with `userListIds`, in one transaction;
 * repeated ids count once and an empty list clears them. Every id must name a list of the group's
 * project, else {@link UserListNotFoundError} and nothing changes. Throws
 * {@link TaleGroupNotFoundError} for an unknown group. Returns the group's lists by name.
 */
export async function setTaleGroupUserLists(
  db: TransactionalDb,
  groupId: string,
  userListIds: readonly string[],
): Promise<TaleGroupUserList[]> {
  const taleGroupId = groupId.toLowerCase();
  // Reads the group's project through the tales module's public interface (AD-1).
  const projectId = UUID.test(taleGroupId) ? await taleGroupProjectId(db, taleGroupId) : null;
  if (projectId === null) throw new TaleGroupNotFoundError(taleGroupId);
  const unique = [...new Set(userListIds.map((id) => id.toLowerCase()))];
  if (unique.some((id) => !UUID.test(id))) throw new UserListNotFoundError();

  return inTransaction(db, async (tx) => {
    // Concurrent sets on one group wait for each other (the group's row is the tales module's).
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_group_user_lists:' || $1, 0))", [taleGroupId]);
    // The lists stay until this commits: a delete of one waits, then removes its link with it.
    const found = await tx.query<{ id: string }>(
      'SELECT id FROM user_lists WHERE id = ANY($1::uuid[]) AND project_id = $2 FOR KEY SHARE',
      [unique, projectId],
    );
    if (found.rows.length !== unique.length) throw new UserListNotFoundError();
    await tx.query('DELETE FROM tale_group_user_lists WHERE tale_group_id = $1', [taleGroupId]);
    if (unique.length > 0) {
      try {
        await tx.query(
          `INSERT INTO tale_group_user_lists (tale_group_id, user_list_id, project_id)
           SELECT $1, list_id, $2 FROM unnest($3::uuid[]) AS list_id`,
          [taleGroupId, projectId, unique],
        );
      } catch (err) {
        // The group (or its project) went after its project was read.
        if ((err as { code?: string }).code === '23503') throw new TaleGroupNotFoundError(taleGroupId);
        throw err;
      }
    }
    return (await userListsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [];
  });
}

/**
 * Gives a copied tale group its source's user lists when the copy stays in the source's project
 * (lists belong to a project, AD-4); a copy to another project gets none. Runs on the caller's
 * transaction, so the copy and its lists commit together. Returns the copy's lists by name.
 */
export async function copyTaleGroupUserLists(
  tx: Db,
  input: { sourceTaleGroupId: string; taleGroupId: string; projectId: string },
): Promise<TaleGroupUserList[]> {
  const taleGroupId = input.taleGroupId.toLowerCase();
  await tx.query(
    `INSERT INTO tale_group_user_lists (tale_group_id, user_list_id, project_id)
     SELECT $1, s.user_list_id, s.project_id FROM tale_group_user_lists s
     WHERE s.tale_group_id = $2 AND s.project_id = $3
     ON CONFLICT DO NOTHING`,
    [taleGroupId, input.sourceTaleGroupId, input.projectId],
  );
  return (await userListsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [];
}

/** The ids of the tale groups each user list of the project targets, keyed by list id. */
export async function taleGroupIdsForUserLists(db: Db, projectId: string): Promise<Map<string, string[]>> {
  const byList = new Map<string, string[]>();
  if (!UUID.test(projectId)) return byList;
  const { rows } = await db.query<{ userListId: string; taleGroupId: string }>(
    `SELECT user_list_id AS "userListId", tale_group_id AS "taleGroupId"
     FROM tale_group_user_lists WHERE project_id = $1`,
    [projectId],
  );
  for (const row of rows) byList.set(row.userListId, [...(byList.get(row.userListId) ?? []), row.taleGroupId]);
  return byList;
}

/** A delivered tale group's user-list audience for one viewer. */
export interface UserListAudience {
  /** True when the viewer's external user ID is in one of the group's lists. */
  matched: boolean;
}

/**
 * Which of these tale groups of the project are targeted to user lists, and whether the viewer's
 * external user ID (already decoded and trimmed, or null) is in one of each group's lists (epic
 * targeting R4). Keyed by group id as given; a group with no list has no entry. The ID is hashed
 * with the project's secret and looked up by the hash index; neither the ID nor its hash is kept
 * or returned. Two queries at most, and none for the hash while no group of the zone has a list.
 */
export async function userListAudiences(
  db: Db,
  projectId: string,
  taleGroupIds: readonly string[],
  externalUserId: string | null,
): Promise<Map<string, UserListAudience>> {
  const audiences = new Map<string, UserListAudience>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length === 0 || !UUID.test(projectId)) return audiences;
  const { rows: links } = await db.query<{ taleGroupId: string; userListId: string }>(
    `SELECT tale_group_id AS "taleGroupId", user_list_id AS "userListId"
     FROM tale_group_user_lists WHERE tale_group_id = ANY($1::uuid[]) AND project_id = $2`,
    [ids, projectId],
  );
  if (links.length === 0) return audiences;

  let listed = new Set<string>();
  if (externalUserId !== null) {
    const listIds = [...new Set(links.map((link) => link.userListId))];
    const secret = await projectSecret(db, projectId);
    if (secret !== null) {
      const hash = hashExternalUserId(secret, externalUserId);
      // One probe of the primary key (user_list_id, id_hash) per list.
      const found = await db.query<{ userListId: string }>(
        `SELECT user_list_id AS "userListId" FROM user_list_ids
         WHERE user_list_id = ANY($1::uuid[]) AND id_hash = $2`,
        [listIds, hash],
      );
      listed = new Set(found.rows.map((row) => row.userListId));
    }
  }
  const byId = new Map(ids.map((id) => [id.toLowerCase(), id]));
  for (const link of links) {
    const id = byId.get(link.taleGroupId) ?? link.taleGroupId;
    const matched = (audiences.get(id)?.matched ?? false) || listed.has(link.userListId);
    audiences.set(id, { matched });
  }
  return audiences;
}

// The project's hashing secret, or null when it has no list (and so no secret).
async function projectSecret(db: Db, projectId: string): Promise<Buffer | null> {
  const { rows } = await db.query<{ secret: Buffer }>('SELECT secret FROM user_list_secrets WHERE project_id = $1', [
    projectId,
  ]);
  return rows[0]?.secret ?? null;
}
