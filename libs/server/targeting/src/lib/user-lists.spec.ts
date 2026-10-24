import { createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { TransactionalDb } from '@taleart/server-access';
import { InvalidUserListNameError, UserListExistsError, UserListLimitError, UserListNotFoundError } from './errors';
import { migrateTargeting } from './migration';
import {
  addUserListIds,
  createUserList,
  deleteUserList,
  hashExternalUserId,
  renameUserList,
  USER_LIST_INSERT_BATCH,
} from './user-lists';

const projectId = '00000000-0000-4000-8000-000000000002';
const listId = '00000000-0000-4000-8000-000000000005';
const secret = Buffer.alloc(32, 7);

// A fake pool whose connection answers queries in order from `answers`; an Error answer is thrown.
function fakeDb(answers: unknown[]) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const answer = answers.shift() ?? { rows: [] };
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionalDb;
  const statements = () => query.mock.calls.map((c) => c[0] as string);
  return { db, query, statements };
}

describe('migration', () => {
  it('stores lists and their hashes per project, removed with the list and the project', async () => {
    const { db, statements } = fakeDb([]);
    await migrateTargeting(db);
    const sql = statements().join('\n');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS user_list_secrets[\s\S]*REFERENCES projects\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/secret bytea NOT NULL CHECK \(octet_length\(secret\) = 32\)/);
    expect(sql).toMatch(/ON user_lists \(project_id, lower\(name\)\)/);
    const ids = statements().find((s) => /CREATE TABLE IF NOT EXISTS user_list_ids/.test(s)) ?? '';
    expect(ids).toMatch(/id_hash bytea NOT NULL CHECK \(octet_length\(id_hash\) = 32\)/);
    expect(ids).toMatch(/PRIMARY KEY \(user_list_id, id_hash\)/);
    expect(ids).toMatch(/REFERENCES user_lists \(id, project_id\) ON DELETE CASCADE/);
    expect(ids).toMatch(/REFERENCES projects\(id\) ON DELETE CASCADE/);
    // No column could hold an ID in clear.
    expect(ids).not.toMatch(/\btext\b/);
  });
});

describe('hashing', () => {
  it('is HMAC-SHA-256 of the ID under the secret, 32 bytes', () => {
    const hash = hashExternalUserId(secret, 'User-42');
    expect(hash).toHaveLength(32);
    expect(hash.equals(createHmac('sha256', secret).update('User-42', 'utf8').digest())).toBe(true);
    // Exact match: case counts, and another secret gives another hash.
    expect(hash.equals(hashExternalUserId(secret, 'user-42'))).toBe(false);
    expect(hash.equals(hashExternalUserId(Buffer.alloc(32, 8), 'User-42'))).toBe(false);
  });
});

describe('createUserList', () => {
  it('refuses a blank name before any query', async () => {
    const { db, query } = fakeDb([]);
    await expect(createUserList(db, { projectId, name: '  ' })).rejects.toBeInstanceOf(InvalidUserListNameError);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses the 101st list of a project, under the project lock', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rows: [{ n: 100 }] }]);
    await expect(createUserList(db, { projectId, name: 'Loyal' })).rejects.toBeInstanceOf(UserListLimitError);
    expect(statements()[1]).toMatch(/pg_advisory_xact_lock\(/);
    expect(statements()).toContain('ROLLBACK');
  });

  it('creates the secret with the first list and names a taken name', async () => {
    const taken = Object.assign(new Error('dup'), { code: '23505', constraint: 'user_lists_project_id_lower_name_key' });
    const { db, query } = fakeDb([{ rows: [] }, { rows: [{ n: 0 }] }, { rows: [] }, taken]);
    await expect(createUserList(db, { projectId, name: 'Loyal' })).rejects.toBeInstanceOf(UserListExistsError);
    const secretInsert = query.mock.calls.find((c) => /INSERT INTO user_list_secrets/.test(c[0] as string));
    expect((secretInsert?.[1] as unknown[])[1]).toHaveLength(32);
  });
});

describe('renameUserList and deleteUserList', () => {
  it('answers not found for another project or no list', async () => {
    await expect(renameUserList(fakeDb([{ rows: [] }]).db, { projectId, userListId: listId, name: 'X' })).rejects.toBeInstanceOf(
      UserListNotFoundError,
    );
    await expect(deleteUserList(fakeDb([]).db, { projectId, userListId: 'nope' })).rejects.toBeInstanceOf(UserListNotFoundError);
    await expect(deleteUserList(fakeDb([{ rows: [] }, { rowCount: 0 }]).db, { projectId, userListId: listId })).rejects.toBeInstanceOf(
      UserListNotFoundError,
    );
  });

  it('deletes the list and, with the last list, the secret, in one transaction', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rowCount: 1 }, { rowCount: 1 }]);
    await deleteUserList(db, { projectId, userListId: listId });
    const sql = statements();
    expect(sql[0]).toBe('BEGIN');
    expect(sql[2]).toMatch(/^DELETE FROM user_lists WHERE id = \$1 AND project_id = \$2/);
    expect(sql[3]).toMatch(/DELETE FROM user_list_secrets[\s\S]*NOT EXISTS/);
    expect(sql.at(-1)).toBe('COMMIT');
  });
});

describe('addUserListIds', () => {
  it('sends only hashes, in batches, and counts what it did', async () => {
    const ids = Array.from({ length: USER_LIST_INSERT_BATCH + 2 }, (_, i) => `person-${i}`);
    const { db, query } = fakeDb([
      { rows: [] }, // SET LOCAL
      { rows: [] }, // lock
      { rows: [{ secret }] },
      { rowCount: USER_LIST_INSERT_BATCH - 1 },
      { rowCount: 2 },
      { rows: [{ idCount: USER_LIST_INSERT_BATCH + 1 }] },
    ]);
    const report = await addUserListIds(db, { projectId, userListId: listId }, [...ids, ' ', 'x'.repeat(257), 'ana@example.com']);
    expect(report).toEqual({
      added: USER_LIST_INSERT_BATCH + 1,
      alreadyPresent: 2,
      refused: 1,
      refusedRows: [{ line: USER_LIST_INSERT_BATCH + 4, reason: 'too-long' }],
      emptyRows: 1,
      emailLike: 1,
      phoneLike: 0,
      idCount: USER_LIST_INSERT_BATCH + 1,
    });
    // No parameter of any query holds an ID in clear.
    const sent = JSON.stringify(query.mock.calls.map((c) => c[1] ?? null));
    expect(sent).not.toMatch(/person-|ana@example/);
    const first = query.mock.calls.find((c) => /INSERT INTO user_list_ids/.test(c[0] as string));
    expect((first?.[1] as unknown[])[2]).toEqual(ids.slice(0, USER_LIST_INSERT_BATCH).map((id) => hashExternalUserId(secret, id).toString('hex')));
  });

  it('rolls back and adds nothing when the rows fail midway', async () => {
    const { db, statements } = fakeDb([{ rows: [] }, { rows: [] }, { rows: [{ secret }] }]);
    async function* rows() {
      yield 'a';
      throw new Error('cut');
    }
    await expect(addUserListIds(db, { projectId, userListId: listId }, rows())).rejects.toThrow('cut');
    expect(statements()).toContain('ROLLBACK');
    expect(statements()).not.toContain('COMMIT');
  });

  it('keeps an error the client emits while it waits, rolls back and discards the client', async () => {
    const client = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
    const answers: unknown[] = [{ rows: [] }, { rows: [] }, { rows: [{ secret }] }];
    client.query = vi.fn(async (sql: string) => (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? { rows: [] } : (answers.shift() ?? { rows: [] })));
    client.release = vi.fn();
    const db = { query: client.query, connect: async () => client } as unknown as TransactionalDb;
    const fatal = Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), { code: '25P03' });
    async function* stalls() {
      yield 'a';
      // The database ends the session while the upload waits for bytes.
      client.emit('error', fatal);
      yield 'b';
    }
    await expect(
      addUserListIds(db, { projectId, userListId: listId }, stalls(), { databaseIdleTimeout: '5s' }),
    ).rejects.toBe(fatal);
    expect(client.release).toHaveBeenCalledWith(fatal);
    expect(client.listenerCount('error')).toBe(0);
    expect(client.query.mock.calls.map((c) => c[0])).not.toContain('COMMIT');
    expect(client.query.mock.calls[1][0]).toBe("SET LOCAL idle_in_transaction_session_timeout = '5s'");
  });

  it('answers not found for a list of another project', async () => {
    const { db } = fakeDb([{ rows: [] }, { rows: [] }, { rows: [] }]);
    await expect(addUserListIds(db, { projectId, userListId: listId }, ['a'])).rejects.toBeInstanceOf(UserListNotFoundError);
  });
});
