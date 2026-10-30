// A tale group's audience rule (epic viewer properties): the rule the Delivery API hands each viewer's
// SDK, which decides on the client whether the group shows. The rule is stored as JSONB on the
// group's row in `tale_group_audiences` (no row: no rule, every viewer's properties pass it).
import { validateAudienceRule, type AudienceRule } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { taleGroupProjectId, TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidAudienceRuleError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each tale group's audience rule, keyed by group id as given. Every id has an entry: null when the
 * group has no rule. One query.
 */
export async function audienceRulesForTaleGroups(db: Db, taleGroupIds: readonly string[]): Promise<Map<string, AudienceRule | null>> {
  const stored = new Map<string, AudienceRule>();
  const ids = taleGroupIds.filter((id) => UUID.test(id));
  if (ids.length > 0) {
    // The database returns ids in lower case; callers may pass any case.
    const { rows } = await db.query<{ taleGroupId: string; rule: AudienceRule }>(
      `SELECT tale_group_id AS "taleGroupId", rule FROM tale_group_audiences WHERE tale_group_id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) stored.set(row.taleGroupId, row.rule);
  }
  return new Map(taleGroupIds.map((id) => [id, stored.get(id.toLowerCase()) ?? null]));
}

/**
 * Sets a tale group's audience rule, or clears it with null. The rule is checked with
 * `validateAudienceRule` first: a rule that breaks it throws {@link InvalidAudienceRuleError}
 * (its message is the reason) and nothing changes. Throws {@link TaleGroupNotFoundError} for an
 * unknown group. Returns the rule as stored (null when cleared).
 */
export async function setTaleGroupAudience(db: Db, groupId: string, input: unknown): Promise<AudienceRule | null> {
  const taleGroupId = groupId.toLowerCase();
  let rule: AudienceRule | null = null;
  if (input !== null) {
    const checked = validateAudienceRule(input);
    if (checked.ok === false) throw new InvalidAudienceRuleError(checked.reason);
    rule = checked.rule;
  }
  const projectId = UUID.test(taleGroupId) ? await taleGroupProjectId(db, taleGroupId) : null;
  if (projectId === null) throw new TaleGroupNotFoundError(taleGroupId);
  try {
    if (rule === null) {
      await db.query('DELETE FROM tale_group_audiences WHERE tale_group_id = $1', [taleGroupId]);
    } else {
      await db.query(
        `INSERT INTO tale_group_audiences (tale_group_id, project_id, rule) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (tale_group_id) DO UPDATE SET rule = EXCLUDED.rule, updated_at = now()`,
        [taleGroupId, projectId, JSON.stringify(rule)],
      );
    }
  } catch (err) {
    // The group was deleted after its project was read: its key no longer matches.
    if ((err as { code?: string }).code === '23503') throw new TaleGroupNotFoundError(taleGroupId);
    throw err;
  }
  return rule;
}

/**
 * Gives a copied tale group its source's audience rule (epic viewer properties), on the caller's
 * transaction, so the copy and its rule commit together. A rule holds no project data (its values
 * are plain), so it is copied as it is into any project. Returns the copy's rule (null when none).
 */
export async function copyTaleGroupAudience(
  tx: Db,
  input: { sourceTaleGroupId: string; taleGroupId: string; projectId: string },
): Promise<AudienceRule | null> {
  const taleGroupId = input.taleGroupId.toLowerCase();
  await tx.query(
    `INSERT INTO tale_group_audiences (tale_group_id, project_id, rule)
     SELECT $1, $2, rule FROM tale_group_audiences WHERE tale_group_id = $3`,
    [taleGroupId, input.projectId, input.sourceTaleGroupId.toLowerCase()],
  );
  return (await audienceRulesForTaleGroups(tx, [taleGroupId])).get(taleGroupId) ?? null;
}
