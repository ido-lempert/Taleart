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
 * project, else {@link UserListNotFoundError} and nothing changes. A person chose the group's
 * audience, so its `audience-removed` hold ends. Throws {@link TaleGroupNotFoundError} for an
 * unknown group. Returns the group's lists by name.
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
    await tx.query('DELETE FROM tale_group_audience_holds WHERE tale_group_id = $1', [taleGroupId]);
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
 * Ends a group's `audience-removed` hold: a person saved its Audience (its tags, say), so its
 * targeting is what they chose. Nothing happens to a group with no hold.
 */
export async function releaseAudienceHold(db: Db, taleGroupId: string): Promise<void> {
  if (!UUID.test(taleGroupId)) return;
  await db.query('DELETE FROM tale_group_audience_holds WHERE tale_group_id = $1', [taleGroupId.toLowerCase()]);
}

/**
 * Gives a copied tale group its source's user lists when the copy stays in the source's project
 * (lists belong to a project, AD-4). A copy to another project gets none: the lists are left behind,
 * and the copy is held hidden (`audience-removed`) rather than shown to everyone, as is a copy of a
 * group that is held itself. Runs on the caller's transaction, so the copy, its lists and its hold
 * commit together. Returns the copy's lists by name and whether lists were left behind.
 */
export async function copyTaleGroupUserLists(
  tx: Db,
  input: { sourceTaleGroupId: string; taleGroupId: string; projectId: string },
): Promise<{ userLists: TaleGroupUserList[]; listsLeftBehind: boolean }> {
  const taleGroupId = input.taleGroupId.toLowerCase();
  await tx.query(
    `INSERT INTO tale_group_user_lists (tale_group_id, user_list_id, project_id)
     SELECT $1, s.user_list_id, s.project_id FROM tale_group_user_lists s
     WHERE s.tale_group_id = $2 AND s.project_id = $3
     ON CONFLICT DO NOTHING`,
    [taleGroupId, input.sourceTaleGroupId, input.projectId],
  );
  const { rows } = await tx.query<{ leftBehind: boolean; held: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM tale_group_user_lists s WHERE s.tale_group_id = $1 AND s.project_id <> $2) AS "leftBehind",
       EXISTS (SELECT 1 FROM tale_group_audience_holds h WHERE h.tale_group_id = $1) AS held`,
    [input.sourceTaleGroupId, input.projectId],
  );
  const { leftBehind, held } = rows[0] ?? { leftBehind: false, held: false };
  if (leftBehind || held) {
    await tx.query(
      `INSERT INTO tale_group_audience_holds (tale_group_id, project_id) VALUES ($1, $2)
       ON CONFLICT (tale_group_id) DO NOTHING`,
      [taleGroupId, input.projectId],
    );
  }
  return { userLists: (await userListsForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? [], listsLeftBehind: leftBehind };
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

/**
 * The user-list audience of a zone's groups for one viewer (epic targeting R4), by group id in
 * lower case: the groups targeted to user lists, and those of them the viewer is listed for. The
 * Delivery API shows a targeted group only when it is matched (fail closed).
 */
export interface UserListAudiences {
  /** The groups targeted to at least one user list. */
  targeted: ReadonlySet<string>;
  /** The targeted groups the viewer's external user ID is in a list of. */
  matched: ReadonlySet<string>;
}

/** True when the group may be shown to the viewer by its user lists: not targeted, or matched. */
export function passesUserLists(audiences: UserListAudiences, taleGroupId: string): boolean {
  const id = taleGroupId.toLowerCase();
  return !audiences.targeted.has(id) || audiences.matched.has(id);
}

/**
 * Which of these tale groups of the project are targeted to user lists, and which of them the
 * viewer's external user ID (already decoded and trimmed, or null) is in a list of (epic targeting
 * R4), as {@link UserListAudiences}. The ID is hashed with the project's secret and looked up by the
 * hash index; neither the ID nor its hash is kept or returned. Three queries at most, and none for
 * the hash while no group of the zone has a list.
 */
export async function userListAudiences(
  db: Db,
  projectId: string,
  taleGroupIds: readonly string[],
  externalUserId: string | null,
): Promise<UserListAudiences> {
  const targeted = new Set<string>();
  const matched = new Set<string>();
  const ids = taleGroupIds.filter((id) => UUID.test(id)).map((id) => id.toLowerCase());
  if (ids.length === 0 || !UUID.test(projectId)) return { targeted, matched };
  const { rows: links } = await db.query<{ taleGroupId: string; userListId: string }>(
    `SELECT tale_group_id AS "taleGroupId", user_list_id AS "userListId"
     FROM tale_group_user_lists WHERE tale_group_id = ANY($1::uuid[]) AND project_id = $2`,
    [ids, projectId],
  );
  if (links.length === 0) return { targeted, matched };

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
  for (const link of links) {
    targeted.add(link.taleGroupId);
    if (listed.has(link.userListId)) matched.add(link.taleGroupId);
  }
  return { targeted, matched };
}

// The project's hashing secret, or null when it has no list (and so no secret).
async function projectSecret(db: Db, projectId: string): Promise<Buffer | null> {
  const { rows } = await db.query<{ secret: Buffer }>('SELECT secret FROM user_list_secrets WHERE project_id = $1', [
    projectId,
  ]);
  return rows[0]?.secret ?? null;
}
