import type { TransactionalDb } from '@taleart/server-access';
import { TaleGroupNotFoundError } from '@taleart/server-tales';
import { InvalidTagNameError, TagExistsError, TagNotFoundError, TagProjectNotFoundError } from './errors';
import { migrateTargeting } from './migration';
import {
  addTaleGroupTagsByName,
  addTaleGroupTagsByNameIn,
  copyTaleGroupTags,
  createTag,
  ensureTags,
  listTags,
  setTaleGroupTags,
  tagMatchesForTaleGroups,
  tagRulesForTaleGroups,
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

  it('stores a match mode per group, any or all, removed with the group (epic targeting R1)', async () => {
    const { db, statements } = fakeDb([]);
    await migrateTargeting(db);
    const table = statements().find((s) => /CREATE TABLE IF NOT EXISTS tale_group_tag_matches/.test(s)) ?? '';
    expect(table).toMatch(/tale_group_id uuid PRIMARY KEY/);
    expect(table).toMatch(/project_id uuid NOT NULL REFERENCES projects\(id\)/);
    expect(table).toMatch(/CHECK \(tag_match IN \('any', 'all'\)\)/);
    expect(table).toMatch(/REFERENCES tale_groups \(id, project_id\) ON DELETE CASCADE/);
  });
});

describe('tagMatchesForTaleGroups', () => {
  it('reads Any for a group without a stored mode, keyed by the id as given', async () => {
    const other = '00000000-0000-4000-8000-000000000004';
    const { db, query } = fakeDb([{ rows: [{ taleGroupId: groupId, tagMatch: 'all' }] }]);
    const modes = await tagMatchesForTaleGroups(db, [groupId.toUpperCase(), other, 'nope']);
    expect(modes.get(groupId.toUpperCase())).toBe('all');
    expect(modes.get(other)).toBe('any');
    expect(modes.get('nope')).toBe('any');
    expect(query.mock.calls[0][1]).toEqual([[groupId.toUpperCase(), other]]);
  });

  it('asks nothing for no ids', async () => {
    const { db, query } = fakeDb([]);
    expect(await tagMatchesForTaleGroups(db, [])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});

describe('tagRulesForTaleGroups', () => {
  it("returns each group's tag names and mode in one query", async () => {
    const other = '00000000-0000-4000-8000-000000000004';
    const { db, query } = fakeDb([
      {
        rows: [
          { taleGroupId: groupId, tags: ['summer', 'vip'], tagMatch: 'all' },
          { taleGroupId: other, tags: null, tagMatch: null },
        ],
      },
    ]);
    const rules = await tagRulesForTaleGroups(db, [groupId, other]);
    expect(rules.get(groupId)).toEqual({ tags: ['summer', 'vip'], tagMatch: 'all' });
    expect(rules.get(other)).toEqual({ tags: [], tagMatch: 'any' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/array_agg\(tags.name ORDER BY lower\(tags.name\)/);
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
    expect(await setTaleGroupTags(db, groupId.toUpperCase(), [tagA, tagA.toUpperCase()])).toEqual({
      tags: [{ id: tagA, name: 'a' }],
      tagMatch: 'any',
    });
    expect(statements().some((s) => /tale_group_tag_matches \(/.test(s))).toBe(false);
    const lock = query.mock.calls.find((c) => /pg_advisory_xact_lock/.test(c[0] as string));
    expect(lock?.[1]).toEqual([groupId]);
    const insert = query.mock.calls.find((c) => /INSERT/.test(c[0] as string));
    expect(insert?.[1]).toEqual([groupId, projectId, [tagA]]);
    const order = statements();
    expect(order.findIndex((s) => /DELETE/.test(s))).toBeLessThan(order.findIndex((s) => /INSERT/.test(s)));
    expect(order).toContain('COMMIT');
  });

  it('sets the match mode in the same transaction when one is given', async () => {
    const { db, query, statements } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [{}] },
      { rows: [{ id: tagA }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ taleGroupId: groupId, id: tagA, name: 'a' }] },
      { rows: [{ taleGroupId: groupId, tagMatch: 'all' }] },
    ]);
    expect(await setTaleGroupTags(db, groupId, [tagA], 'all')).toEqual({
      tags: [{ id: tagA, name: 'a' }],
      tagMatch: 'all',
    });
    const store = query.mock.calls.find((c) => /INSERT INTO tale_group_tag_matches/.test(c[0] as string));
    expect(store?.[0]).toMatch(/ON CONFLICT \(tale_group_id\) DO UPDATE SET tag_match = EXCLUDED.tag_match/);
    expect(store?.[1]).toEqual([groupId, projectId, 'all']);
    const order = statements();
    expect(order.indexOf(store?.[0] as string)).toBeLessThan(order.indexOf('COMMIT'));
  });

  it('clears the tags for an empty list', async () => {
    const { db, statements } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    expect(await setTaleGroupTags(db, groupId, [])).toEqual({ tags: [], tagMatch: 'any' });
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
    expect(await copyTaleGroupTags(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: target })).toEqual({
      tags: [
        { id: tagA, name: 'sale' },
        { id: tagB, name: 'summer' },
      ],
      tagMatch: 'any',
    });
    const [read, create, link] = query.mock.calls;
    expect(read[1]).toEqual([groupId]);
    expect(create[0]).toMatch(/ON CONFLICT \(project_id, lower\(name\)\) DO NOTHING/);
    expect(create[0]).toMatch(/ORDER BY lower\(name\), name/);
    expect(create[1]).toEqual([target, ['Summer', 'sale']]);
    expect(link[0]).toMatch(/lower\(tags.name\) IN \(SELECT lower\(name\)/);
    expect(link[1]).toEqual([copyId, target, ['Summer', 'sale']]);
  });

  it('writes nothing when the source has no tags', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rows: [] }]);
    expect(await copyTaleGroupTags(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: target })).toEqual({
      tags: [],
      tagMatch: 'any',
    });
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });

  it("keeps the source's All on the copy, in the copy's project", async () => {
    const { db, query } = fakeDb([
      { rows: [{ name: 'summer' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ taleGroupId: copyId, id: tagA, name: 'summer' }] },
      { rows: [{ taleGroupId: groupId, tagMatch: 'all' }] },
    ]);
    expect(await copyTaleGroupTags(db, { sourceTaleGroupId: groupId, taleGroupId: copyId, projectId: target })).toEqual({
      tags: [{ id: tagA, name: 'summer' }],
      tagMatch: 'all',
    });
    const store = query.mock.calls.find((c) => /INSERT INTO tale_group_tag_matches/.test(c[0] as string));
    expect(store?.[1]).toEqual([copyId, target, 'all']);
  });
});

describe('ensureTags', () => {
  it('creates missing names ignoring case and answers the tag of each trimmed name, with its spelling', async () => {
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
    // One insert order for every caller, so concurrent inserts cannot deadlock.
    expect(create[0]).toMatch(/ORDER BY lower\(name\), name/);
    expect(create[1]).toEqual([projectId, ['vip', 'new']]);
    expect(read[0]).toMatch(/lower\(tags.name\) = lower\(requested.name\)/);
  });

  it('refuses an invalid name before writing, and writes nothing for no names', async () => {
    const { db, query } = fakeDb([]);
    await expect(ensureTags(db, projectId, ['ok', ' '])).rejects.toBeInstanceOf(InvalidTagNameError);
    await expect(ensureTags(db, projectId, ['x'.repeat(41)])).rejects.toBeInstanceOf(InvalidTagNameError);
    await expect(ensureTags(db, projectId, ['a\u0000b'])).rejects.toBeInstanceOf(InvalidTagNameError);
    expect(await ensureTags(db, projectId, [])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ensureTags: failures', () => {
  const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

  it('runs again once when PostgreSQL breaks a deadlock, and gives up after the second', async () => {
    const once = fakeDb([deadlock(), { rows: [] }, { rows: [{ requested: 'a', id: tagA, projectId, name: 'a' }] }]);
    expect([...(await ensureTags(once.db, projectId, ['a'])).keys()]).toEqual(['a']);
    const twice = fakeDb([deadlock(), deadlock()]);
    await expect(ensureTags(twice.db, projectId, ['a'])).rejects.toMatchObject({ code: '40P01' });
  });

  it('says the project is gone when its key fails, and passes other errors on', async () => {
    const gone = Object.assign(new Error('fk'), { code: '23503', constraint: 'tags_project_id_fkey' });
    await expect(ensureTags(fakeDb([gone]).db, projectId, ['a'])).rejects.toBeInstanceOf(TagProjectNotFoundError);
    const other = Object.assign(new Error('other'), { code: '23503', constraint: 'something_else' });
    await expect(ensureTags(fakeDb([other]).db, projectId, ['a'])).rejects.toBe(other);
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
    const fkError = Object.assign(new Error('fk'), {
      code: '23503',
      constraint: 'tale_group_tags_tale_group_id_project_id_fkey',
    });
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

  it("tells a deleted project from a deleted group by the key that failed, and retries a deadlock once", async () => {
    const answers = (last: unknown) => [
      { rows: [{ project_id: projectId }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ requested: 'a', id: tagA, projectId, name: 'a' }] },
      last,
    ];
    const project = Object.assign(new Error('fk'), { code: '23503', constraint: 'tale_group_tags_project_id_fkey' });
    await expect(addTaleGroupTagsByName(fakeDb(answers(project)).db, groupId, ['a'])).rejects.toBeInstanceOf(
      TagProjectNotFoundError,
    );
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const retried = fakeDb([...answers(deadlock), { rows: [] }, { rows: [] }, answers(null)[3], { rows: [] }]);
    expect([...(await addTaleGroupTagsByName(retried.db, groupId, ['a'])).keys()]).toEqual(['a']);
    expect(retried.statements().filter((sql) => sql === 'ROLLBACK')).toHaveLength(1);
    expect(retried.statements().filter((sql) => sql === 'COMMIT')).toHaveLength(1);
  });

  it('writes nothing for no names', async () => {
    const { db, statements } = fakeDb([{ rows: [{ project_id: projectId }] }]);
    expect(await addTaleGroupTagsByName(db, groupId, [])).toEqual(new Map());
    expect(statements().some((s) => /INSERT/.test(s))).toBe(false);
  });
});

describe('addTaleGroupTagsByNameIn', () => {
  it("reads the group's tags under its tag lock, adds what decide answers, on the caller's transaction", async () => {
    const { db, statements, query } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [] },
      { rows: [{ taleGroupId: groupId, id: tagB, name: 'vip' }] },
      { rows: [] },
      { rows: [] },
      { rows: [{ requested: 'Summer', id: tagA, projectId, name: 'summer' }] },
      { rows: [] },
    ]);
    const decide = vi.fn(() => ['Summer']);
    const result = await addTaleGroupTagsByNameIn(db, groupId, decide);
    expect(decide).toHaveBeenCalledWith([{ id: tagB, name: 'vip' }]);
    expect(result.current).toEqual([{ id: tagB, name: 'vip' }]);
    expect([...result.added]).toEqual([['Summer', { id: tagA, name: 'summer' }]]);
    const sql = statements();
    expect(sql).not.toContain('BEGIN');
    expect(db.connect).not.toHaveBeenCalled();
    // Compare and set: the lock comes before the read of the current tags.
    expect(sql[1]).toMatch(/pg_advisory_xact_lock\(hashtextextended\('tale_group_tags:'/);
    expect(sql[2]).toMatch(/FROM tale_group_tags links JOIN tags/);
    const link = query.mock.calls.find((c) => /INSERT INTO tale_group_tags/.test(c[0] as string));
    expect(link?.[0]).toMatch(/ON CONFLICT \(tale_group_id, tag_id\) DO NOTHING/);
  });

  it('writes nothing when decide answers no names, refuses an unknown group, and passes a deadlock on', async () => {
    const none = fakeDb([{ rows: [{ project_id: projectId }] }, { rows: [] }, { rows: [] }]);
    expect(await addTaleGroupTagsByNameIn(none.db, groupId, () => [])).toEqual({ current: [], added: new Map() });
    expect(none.statements().some((s) => /INSERT/.test(s))).toBe(false);
    await expect(addTaleGroupTagsByNameIn(fakeDb([{ rows: [] }]).db, groupId, () => ['a'])).rejects.toBeInstanceOf(
      TaleGroupNotFoundError,
    );
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const { db } = fakeDb([
      { rows: [{ project_id: projectId }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ requested: 'a', id: tagA, projectId, name: 'a' }] },
      deadlock,
    ]);
    await expect(addTaleGroupTagsByNameIn(db, groupId, () => ['a'])).rejects.toBe(deadlock);
  });
});

