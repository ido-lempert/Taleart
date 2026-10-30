import type { Db } from '@taleart/server-access';
import { TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidAudienceRuleError } from './errors';
import { migrateTargeting } from './migration';
import { audienceRulesForTaleGroups, copyTaleGroupAudience, setTaleGroupAudience } from './audience';

const projectId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';
const copyId = '00000000-0000-4000-8000-000000000004';
const rule = { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] };

// A fake database whose queries answer in order from `answers`; an Error answer is thrown.
function fakeDb(answers: unknown[]) {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async () => {
    const answer = answers.shift() ?? { rows: [] };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const db = { query } as unknown as Db;
  const statements = () => query.mock.calls.map((c) => c[0]);
  return { db, query, statements };
}

describe('the audience rule table (epic viewer properties)', () => {
  it('creates the table with the rule as a JSON object, one row per group, cascading with the group', async () => {
    const { db, statements } = fakeDb([]);
    await migrateTargeting(db);
    const table = statements().find((s) => /CREATE TABLE IF NOT EXISTS tale_group_audiences/.test(s)) ?? '';
    expect(table).toMatch(/tale_group_id uuid PRIMARY KEY/);
    expect(table).toMatch(/project_id uuid NOT NULL REFERENCES projects\(id\)/);
    expect(table).toMatch(/rule jsonb NOT NULL CHECK \(jsonb_typeof\(rule\) = 'object'\)/);
    expect(table).toMatch(/FOREIGN KEY \(tale_group_id, project_id\) REFERENCES tale_groups \(id, project_id\) ON DELETE CASCADE/);
  });
});

describe('audienceRulesForTaleGroups', () => {
  it('gives every id its rule or null, with the ids of any case', async () => {
    const { db, query } = fakeDb([{ rows: [{ taleGroupId: groupId, rule }] }]);
    const rules = await audienceRulesForTaleGroups(db, [groupId.toUpperCase(), copyId, 'nope']);
    expect(rules.get(groupId.toUpperCase())).toEqual(rule);
    expect(rules.get(copyId)).toBeNull();
    expect(rules.get('nope')).toBeNull();
    expect(query.mock.calls[0][1]).toEqual([[groupId.toUpperCase(), copyId]]);
  });

  it('asks the database nothing for ids that are not UUIDs', async () => {
    const { db, query } = fakeDb([]);
    const rules = await audienceRulesForTaleGroups(db, ['nope']);
    expect(rules.get('nope')).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('setTaleGroupAudience', () => {
  it('checks the rule first: a broken one throws its reason and the database is not touched', async () => {
    const { db, query } = fakeDb([]);
    await expect(setTaleGroupAudience(db, groupId, { match: 'some', conditions: [] })).rejects.toThrow(
      InvalidAudienceRuleError,
    );
    await expect(setTaleGroupAudience(db, groupId, { match: 'some', conditions: [] })).rejects.toMatchObject({
      code: 'validation_failed',
      message: 'match must be "all" or "any"',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('stores a valid rule as JSON in the group project, and returns it', async () => {
    const { db, query } = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [] }]);
    expect(await setTaleGroupAudience(db, groupId.toUpperCase(), rule)).toEqual(rule);
    const insert = query.mock.calls[1];
    expect(insert[0]).toMatch(/INSERT INTO tale_group_audiences .* VALUES \(\$1, \$2, \$3::jsonb\)/);
    expect(insert[1]).toEqual([groupId, projectId, JSON.stringify(rule)]);
  });

  it('clears a rule with null, and throws not found for an unknown group', async () => {
    const cleared = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [] }]);
    expect(await setTaleGroupAudience(cleared.db, groupId, null)).toBeNull();
    expect(cleared.statements()[1]).toMatch(/^DELETE FROM tale_group_audiences/);

    const unknown = fakeDb([{ rows: [] }]);
    await expect(setTaleGroupAudience(unknown.db, groupId, rule)).rejects.toThrow(TaleGroupNotFoundError);
  });
});

describe('copyTaleGroupAudience', () => {
  it('copies the source rule to the copy, in the copy project, and returns the copy rule', async () => {
    const { db, query } = fakeDb([{ rows: [] }, { rows: [{ taleGroupId: copyId, rule }] }]);
    expect(await copyTaleGroupAudience(db, { sourceTaleGroupId: groupId.toUpperCase(), taleGroupId: copyId, projectId })).toEqual(
      rule,
    );
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO tale_group_audiences[\s\S]*SELECT \$1, \$2, rule FROM tale_group_audiences WHERE tale_group_id = \$3/);
    expect(query.mock.calls[0][1]).toEqual([copyId, projectId, groupId]);
  });

  it('gives a copy of a group without a rule no rule', async () => {
    const { db } = fakeDb([{ rows: [] }, { rows: [] }]);
    expect(await copyTaleGroupAudience(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId })).toBeNull();
  });
});
