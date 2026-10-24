import { createHmac } from 'node:crypto';
import type { TransactionalDb } from '@taleart/server-access';
import { GROUP_OWN_REASON_CLAUSES } from '@taleart/server-tales';
import { UserListNotFoundError } from './errors';
import { setTaleGroupUserLists, userListAudiences } from './group-user-lists';
import { migrateTargeting } from './migration';

const projectId = '00000000-0000-4000-8000-000000000002';
const groupA = '00000000-0000-4000-8000-00000000000a';
const groupB = '00000000-0000-4000-8000-00000000000b';
const listA = '00000000-0000-4000-8000-0000000000a1';
const listB = '00000000-0000-4000-8000-0000000000b1';
const secret = Buffer.alloc(32, 7);

// A fake pool answering queries in order from `answers`, recording each statement and its values.
function fakeDb(answers: unknown[]) {
  const query = vi.fn(async (...args: unknown[]) => {
    const sql = args[0] as string;
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    return answers.shift() ?? { rows: [] };
  });
  const db = { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as unknown as TransactionalDb;
  const calls = () => query.mock.calls.map((c) => ({ sql: c[0] as string, values: (c[1] ?? []) as unknown[] }));
  return { db, query, calls };
}

describe('the group-to-list table', () => {
  it('keys a group and its lists by one project, removed with either', async () => {
    const { db, calls } = fakeDb([]);
    await migrateTargeting(db);
    const table = calls().find((c) => /CREATE TABLE IF NOT EXISTS tale_group_user_lists/.test(c.sql))?.sql ?? '';
    expect(table).toMatch(/PRIMARY KEY \(tale_group_id, user_list_id\)/);
    expect(table).toMatch(/FOREIGN KEY \(tale_group_id, project_id\) REFERENCES tale_groups \(id, project_id\) ON DELETE CASCADE/);
    expect(table).toMatch(/FOREIGN KEY \(user_list_id, project_id\) REFERENCES user_lists \(id, project_id\) ON DELETE CASCADE/);
  });

  it('has the table and column names the audience-empty clause of delivery-rule.ts reads', async () => {
    const clause = GROUP_OWN_REASON_CLAUSES.find((c) => c.code === 'audience-empty');
    const sql = clause?.when('g', '$1') ?? '';
    expect(sql).toContain('tale_group_user_lists');
    expect(sql).toContain('ae.tale_group_id = g.id');
    expect(sql).toContain('al.id_count > 0');
    const { db, calls } = fakeDb([]);
    await migrateTargeting(db);
    const all = calls().map((c) => c.sql).join('\n');
    expect(all).toMatch(/CREATE TABLE IF NOT EXISTS tale_group_user_lists \(\s*tale_group_id uuid NOT NULL,\s*user_list_id uuid NOT NULL/);
    expect(all).toMatch(/id_count integer NOT NULL/);
  });
});

describe('setTaleGroupUserLists', () => {
  it('refuses an id that is not a UUID before opening a transaction', async () => {
    const { db, calls } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    await expect(setTaleGroupUserLists(db, groupA, ['nope'])).rejects.toBeInstanceOf(UserListNotFoundError);
    expect(calls().some((c) => c.sql === 'BEGIN')).toBe(false);
  });

  it("refuses a list of another project: nothing is deleted or inserted", async () => {
    const { db, calls } = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [] }, { rows: [{ id: listA }] }]);
    await expect(setTaleGroupUserLists(db, groupA, [listA, listB])).rejects.toBeInstanceOf(UserListNotFoundError);
    expect(calls().some((c) => /DELETE FROM tale_group_user_lists|INSERT INTO tale_group_user_lists/.test(c.sql))).toBe(false);
  });
});

describe('userListAudiences', () => {
  const links = { rows: [{ taleGroupId: groupA, userListId: listA }, { taleGroupId: groupA, userListId: listB }] };

  it('reads no secret and no hash while no group of the zone has a list', async () => {
    const { db, calls } = fakeDb([{ rows: [] }]);
    expect(await userListAudiences(db, projectId, [groupA, groupB], 'cust-1')).toEqual(new Map());
    expect(calls()).toHaveLength(1);
  });

  it('marks every listed group unmatched without an ID, and never reads the secret', async () => {
    const { db, calls } = fakeDb([links]);
    expect(await userListAudiences(db, projectId, [groupA, groupB], null)).toEqual(new Map([[groupA, { matched: false }]]));
    expect(calls()).toHaveLength(1);
  });

  it('probes the hash index with the keyed hash only: the ID never reaches the database', async () => {
    const id = 'm\u00FCller-7';
    const { db, calls } = fakeDb([links, { rows: [{ secret }] }, { rows: [{ userListId: listB }] }]);
    const audiences = await userListAudiences(db, projectId, [groupA.toUpperCase(), groupB], id);
    expect(audiences).toEqual(new Map([[groupA.toUpperCase(), { matched: true }]]));
    const probe = calls()[2];
    expect(probe.sql).toMatch(/FROM user_list_ids\s+WHERE user_list_id = ANY\(\$1::uuid\[\]\) AND id_hash = \$2/);
    expect(probe.values[0]).toEqual([listA, listB]);
    expect((probe.values[1] as Buffer).equals(createHmac('sha256', secret).update(id, 'utf8').digest())).toBe(true);
    for (const call of calls()) {
      expect(call.sql).not.toContain(id);
      expect(JSON.stringify(call.values)).not.toContain(id);
    }
  });

  it('matches nothing for a project with lists but no secret', async () => {
    const { db } = fakeDb([links, { rows: [] }]);
    expect(await userListAudiences(db, projectId, [groupA], 'cust-1')).toEqual(new Map([[groupA, { matched: false }]]));
  });
});
