import type { TransactionalDb } from '@taleart/server-access';
import { TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidTagNameError, TagExistsError, TagNotFoundError } from './errors';
import { migrateTargeting } from './migration';
import {
  addTaleGroupTagsByName,
  copyTaleGroupTags,
  createTag,
  ensureTags,
  listTags,
  setTaleGroupTags,
  tagsForTaleGroups,
} from './tags';

const projectId = '00000000-0000-4000-8000-000000000002';
const groupId = '00000000-0000-4000-8000-000000000003';
const tagA = '00000000-0000-4000-8000-00000000000a';
const tagB = '00000000-0000-4000-8000-00000000000b';

// A fake pool whose connection answers queries in order from `answers`; an
// Error answer is thrown.
function fakeDb(answers: unknown[]) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const answer = answers.shift() ?? { rows: [] };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const db = {
    query,
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, release, statements };
}

describe('migration', () => {
  it('keys tag links to the group and the tag with the same project', async () => {
    const { db, statements } = fakeDb([]);
    await migrateTargeting(db);
    const sql = statements().join('\n');
    expect(sql).toMatch(/project_id uuid NOT NULL REFERENCES projects\(id\)/);
    expect(sql).toMatch(/ON tags \(project_id, lower\(name\)\)/);
    expect(sql).toMatch(/FOREIGN KEY \(tale_group_id, project_id\) REFERENCES tale_groups \(id, project_id\)/);
    expect(sql).toMatch(/FOREIGN KEY \(tag_id, project_id\) REFERENCES tags \(id, project_id\)/);
  });
});

describe('createTag', () => {
  it('stores the trimmed name', async () => {
    const { db, query } = fakeDb([{ rows: [{ id: tagA, projectId, name: 'summer' }] }]);
    expect(await createTag(db, { projectId, name: '  summer  ' })).toEqual({
      id: tagA,
      projectId,
      name: 'summer',
    });
    expect(query.mock.calls[0][1]).toEqual([projectId, 'summer']);
  });

  it('refuses a blank name or one over 40 characters without querying', async () => {
    const { db, query } = fakeDb([]);
    await expect(createTag(db, { projectId, name: '   ' })).rejects.toBeInstanceOf(InvalidTagNameError);
    await expect(createTag(db, { projectId, name: 'x'.repeat(41) })).rejects.toBeInstanceOf(InvalidTagNameError);
    expect(query).not.toHaveBeenCalled();
  });

  it('turns the unique-name violation into TagExistsError', async () => {
    const violation = Object.assign(new Error('duplicate'), {
      code: '23505',
      constraint: 'tags_project_id_lower_name_key',
    });
    const { db } = fakeDb([violation]);
    await expect(createTag(db, { projectId, name: 'Summer' })).rejects.toBeInstanceOf(TagExistsError);
  });
});

describe('listTags', () => {
  it('orders by name ignoring case and never queries for an id that is not a UUID', async () => {
    const { db, query } = fakeDb([{ rows: [] }]);
    expect(await listTags(db, 'nope')).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    await listTags(db, projectId);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY lower\(tags.name\)/);
  });
});

describe('tagsForTaleGroups', () => {
  it('gives every group an entry, in any id case', async () => {
    const other = '00000000-0000-4000-8000-000000000004';
    const { db } = fakeDb([{ rows: [{ taleGroupId: groupId, id: tagA, name: 'a' }] }]);
    const tags = await tagsForTaleGroups(db, [groupId.toUpperCase(), other]);
    expect(tags.get(groupId.toUpperCase())).toEqual([{ id: tagA, name: 'a' }]);
    expect(tags.get(other)).toEqual([]);
  });

  it('does not query without ids', async () => {
    const { db, query } = fakeDb([]);
    expect((await tagsForTaleGroups(db, [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('setTaleGroupTags', () => {
  it('refuses an unknown group', async () => {
    const { db } = fakeDb([{ rows: [] }]);
    await expect(setTaleGroupTags(db, groupId, [])).rejects.toBeInstanceOf(TaleGroupNotFoundError);
  });

  it('refuses a malformed tag id before the transaction', async () => {
    const { db } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    await expect(setTaleGroupTags(db, groupId, ['nope'])).rejects.toBeInstanceOf(TagNotFoundError);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("refuses a tag outside the group's project and rolls back without changing links", async () => {
    const { db, query, statements, release } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: tagA }] },
    ]);
    await expect(setTaleGroupTags(db, groupId, [tagA, tagB])).rejects.toBeInstanceOf(TagNotFoundError);
    const lookup = query.mock.calls.find((c) => /FROM tags WHERE/.test(c[0] as string));
    expect(lookup?.[1]).toEqual([[tagA, tagB], projectId]);
    expect(statements().some((s) => /DELETE|INSERT/.test(s))).toBe(false);
    expect(statements()).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('replaces the full set under the group lock, counting repeats once', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: tagA }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ taleGroupId: groupId, id: tagA, name: 'a' }] },
    ]);
    expect(await setTaleGroupTags(db, groupId.toUpperCase(), [tagA, tagA.toUpperCase()])).toEqual([
      { id: tagA, name: 'a' },
    ]);
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([groupId]);
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[1]).toEqual([groupId, projectId, [tagA]]);
    const order = statements();
    expect(order.findIndex((s) => /DELETE/.test(s))).toBeLessThan(order.findIndex((s) => /INSERT/.test(s)));
    expect(order).toContain('COMMIT');
  });

  it('clears the tags for an empty list', async () => {
    const { db, statements } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    expect(await setTaleGroupTags(db, groupId, [])).toEqual([]);
    expect(statements().some((s) => /DELETE FROM tale_group_tags/.test(s))).toBe(true);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });
});

describe('copyTaleGroupTags', () => {
  const copyId = '00000000-0000-4000-8000-000000000005';
  const target = '00000000-0000-4000-8000-000000000006';

  it("finds or creates the source's tags by name in the copy's project and links them", async () => {
    const { db, query } = fakeDb([
      { rows: [{ name: 'Summer' }, { name: 'sale' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ taleGroupId: copyId, id: tagA, name: 'sale' }, { taleGroupId: copyId, id: tagB, name: 'summer' }] },
    ]);
    expect(await copyTaleGroupTags(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: target })).toEqual([
      { id: tagA, name: 'sale' },
      { id: tagB, name: 'summer' },
    ]);
    const [read, create, link] = query.mock.calls;
    expect(read[1]).toEqual([groupId]);
    expect(create[0]).toMatch(/ON CONFLICT \(project_id, lower\(name\)\) DO NOTHING/);
    expect(create[1]).toEqual([target, ['Summer', 'sale']]);
    expect(link[0]).toMatch(/lower\(tags.name\) IN \(SELECT lower\(name\)/);
    expect(link[1]).toEqual([copyId, target, ['Summer', 'sale']]);
  });

  it('writes nothing when the source has no tags', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rows: [] }]);
    expect(await copyTaleGroupTags(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: target })).toEqual([]);
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });
});

describe('ensureTags', () => {
  it('creates the missing names ignoring case and answers the tag of each trimmed name, reused with its spelling', async () => {
    const { db, query } = fakeDb([
      { rows: [] },
      {
        rows: [
          { requested: 'vip', id: tagA, projectId, name: 'VIP' },
          { requested: 'new', id: tagB, projectId, name: 'new' },
        ],
      },
    ]);
    const tags = await ensureTags(db, projectId, [' vip ', 'new', 'vip']);
    expect([...tags]).toEqual([
      ['vip', { id: tagA, projectId, name: 'VIP' }],
      ['new', { id: tagB, projectId, name: 'new' }],
    ]);
    const [create, read] = query.mock.calls;
    expect(create[0]).toMatch(/ON CONFLICT \(project_id, lower\(name\)\) DO NOTHING/);
    expect(create[1]).toEqual([projectId, ['vip', 'new']]);
    expect(read[0]).toMatch(/lower\(tags.name\) = lower\(requested.name\)/);
  });

  it('refuses an invalid name before writing, and writes nothing for no names', async () => {
    const { db, query } = fakeDb([]);
    await expect(ensureTags(db, projectId, ['ok', ' '])).rejects.toBeInstanceOf(InvalidTagNameError);
    await expect(ensureTags(db, projectId, ['x'.repeat(41)])).rejects.toBeInstanceOf(InvalidTagNameError);
    expect(await ensureTags(db, projectId, [])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});

describe('addTaleGroupTagsByName', () => {
  it("adds the tags under the group lock, keeping the group's other tags", async () => {
    const { db, statements, query } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ requested: 'Summer', id: tagA, projectId, name: 'summer' }] },
      { rows: [] },
    ]);
    const added = await addTaleGroupTagsByName(db, groupId.toUpperCase(), ['Summer']);
    expect([...added]).toEqual([['Summer', { id: tagA, name: 'summer' }]]);
    const sql = statements();
    expect(sql.some((s) => /DELETE/.test(s))).toBe(false);
    const link = query.mock.calls.find((c) => /INSERT INTO tale_group_tags/.test(c[0] as string));
    expect(link?.[0]).toMatch(/ON CONFLICT \(tale_group_id, tag_id\) DO NOTHING/);
    expect(link?.[1]).toEqual([groupId, projectId, [tagA]]);
    expect(sql).toContain('COMMIT');
    expect(sql.find((s) => /pg_advisory_xact_lock/.test(s))).toMatch(/tale_group_tags:/);
  });

  it('refuses an unknown group, also one deleted while the tags are added', async () => {
    await expect(addTaleGroupTagsByName(fakeDb([{ rows: [] }]).db, groupId, ['a'])).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    await expect(addTaleGroupTagsByName(fakeDb([]).db, 'not-a-uuid', ['a'])).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    const fkError = Object.assign(new Error('fk'), { code: '23503' });
    const { db, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ requested: 'a', id: tagA, projectId, name: 'a' }] },
      fkError,
    ]);
    await expect(addTaleGroupTagsByName(db, groupId, ['a'])).rejects.toBeInstanceOf(TaleGroupNotFoundError);
    expect(statements()).toContain('ROLLBACK');
  });

  it('writes nothing for no names', async () => {
    const { db, statements } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    expect(await addTaleGroupTagsByName(db, groupId, [])).toEqual(new Map());
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });
});
