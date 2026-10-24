import { createHash } from 'node:crypto';
import type { TransactionalDb } from './db';
import { ApiTokenLimitError, ApiTokenNotFoundError } from './errors';
import {
  API_TOKEN_LAST_USED_INTERVAL_MS,
  authenticateApiToken,
  createApiToken,
  listApiTokens,
  migrateApiTokens,
  revokeApiToken,
  revokeUserApiTokens,
  touchApiToken,
} from './apiTokens';
import { accessibleProjectIds, canAccessProject } from './members';

type FakeDb = TransactionalDb & { query: ReturnType<typeof vi.fn> };

// A Db whose answers are picked by the first SQL fragment the query contains.
// connect() hands out the same fake, so transactions run on it too.
function fakeDb(answers: Record<string, { rows?: unknown[]; rowCount?: number }>): FakeDb {
  const query = vi.fn(async (sql: string) => {
    const key = Object.keys(answers).find((k) => sql.includes(k));
    const rows = (key && answers[key].rows) || [];
    return { rows, rowCount: key && answers[key].rowCount !== undefined ? answers[key].rowCount : rows.length };
  });
  const db = { query } as unknown as FakeDb;
  db.connect = async () => ({ query, release: vi.fn() }) as never;
  return db;
}

const sql = (db: FakeDb): string[] => db.query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' ').trim());
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const userId = '00000000-0000-4000-8000-0000000000aa';
const projectA = '00000000-0000-4000-8000-000000000001';
const projectB = '00000000-0000-4000-8000-000000000002';
const tokenId = '00000000-0000-4000-8000-0000000000f1';
const createdAt = new Date('2026-10-24T10:00:00Z');

const created = { 'INSERT INTO api_tokens': { rows: [{ id: tokenId, createdAt }] }, 'count(*)': { rows: [{ n: 0 }] } };

describe('API tokens', () => {
  it('creates tat_ and 32 random bytes, storing only the hash and the prefix', async () => {
    const db = fakeDb(created);
    const issued = await createApiToken(db, { userId, name: 'CI', projectIds: [projectA], readOnly: true, expiresAt: null });

    expect(issued.token).toMatch(/^tat_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.token.slice(4), 'base64url')).toHaveLength(32);
    expect(issued.prefix).toBe(issued.token.slice(0, 10));
    expect(issued).toEqual({
      id: tokenId,
      name: 'CI',
      prefix: issued.prefix,
      projectIds: [projectA],
      readOnly: true,
      createdAt: '2026-10-24T10:00:00.000Z',
      expiresAt: null,
      lastUsedAt: null,
      token: issued.token,
    });
    const insert = db.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO api_tokens'));
    expect(insert?.[1]).toEqual([userId, 'CI', sha256(issued.token), issued.prefix, false, true, null]);
    // The token itself never reaches the database.
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(issued.token);
    const projects = db.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO api_token_projects'));
    expect(projects?.[1]).toEqual([tokenId, [projectA]]);
  });

  it('counts the user\'s active tokens under a per-user lock, in one transaction', async () => {
    const db = fakeDb(created);
    await createApiToken(db, { userId, name: 'CI', projectIds: null, readOnly: false, expiresAt: null });
    const statements = sql(db);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext('api_tokens:' || $1))");
    // Expired tokens do not count toward the limit.
    expect(statements[2]).toContain(
      'FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())',
    );
    expect(statements[3]).toContain('INSERT INTO api_tokens');
    // A token for all of the user's projects lists none.
    expect(statements.some((s) => s.includes('api_token_projects'))).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
    const insert = db.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO api_tokens'));
    expect(insert?.[1]?.[4]).toBe(true);
  });

  it('refuses a 51st active token and rolls back', async () => {
    const db = fakeDb({ ...created, 'count(*)': { rows: [{ n: 50 }] } });
    await expect(
      createApiToken(db, { userId, name: 'CI', projectIds: null, readOnly: true, expiresAt: null }),
    ).rejects.toBeInstanceOf(ApiTokenLimitError);
    expect(sql(db).at(-1)).toBe('ROLLBACK');
    expect(sql(db).some((s) => s.includes('INSERT'))).toBe(false);
  });

  it('two tokens are never the same', async () => {
    const db = fakeDb(created);
    const a = await createApiToken(db, { userId, name: 'a', projectIds: null, readOnly: true, expiresAt: null });
    const b = await createApiToken(db, { userId, name: 'b', projectIds: null, readOnly: true, expiresAt: null });
    expect(a.token).not.toBe(b.token);
  });

  it('lists the user\'s tokens that are not revoked, never their hashes', async () => {
    const db = fakeDb({
      'FROM api_tokens t': {
        rows: [
          {
            id: tokenId,
            name: 'CI',
            prefix: 'tat_abcdef',
            allProjects: false,
            projectIds: [projectB, projectA],
            readOnly: true,
            createdAt,
            expiresAt: null,
            lastUsedAt: createdAt,
          },
        ],
      },
    });
    expect(await listApiTokens(db, userId)).toEqual([
      {
        id: tokenId,
        name: 'CI',
        prefix: 'tat_abcdef',
        projectIds: [projectA, projectB],
        readOnly: true,
        createdAt: createdAt.toISOString(),
        expiresAt: null,
        lastUsedAt: createdAt.toISOString(),
      },
    ]);
    const [text, params] = db.query.mock.calls[0];
    expect(String(text)).toContain('t.user_id = $1 AND t.revoked_at IS NULL');
    expect(String(text)).not.toContain('token_hash');
    expect(params).toEqual([userId]);
  });

  it('revokes only the user\'s own active token, and says not found otherwise', async () => {
    const db = fakeDb({ 'UPDATE api_tokens SET revoked_at': { rowCount: 1 } });
    await revokeApiToken(db, userId, tokenId);
    expect(db.query.mock.calls[0][1]).toEqual([tokenId, userId]);
    expect(String(db.query.mock.calls[0][0])).toContain('user_id = $2 AND revoked_at IS NULL');

    const none = fakeDb({ 'UPDATE api_tokens SET revoked_at': { rowCount: 0 } });
    await expect(revokeApiToken(none, userId, tokenId)).rejects.toBeInstanceOf(ApiTokenNotFoundError);
    // An id that is not a UUID is not looked up.
    const bad = fakeDb({});
    await expect(revokeApiToken(bad, userId, 'nope')).rejects.toBeInstanceOf(ApiTokenNotFoundError);
    expect(bad.query).not.toHaveBeenCalled();
  });

  it("revokes every active token of a user, or says there is no such user", async () => {
    const db = fakeDb({ 'SELECT 1 FROM users': { rowCount: 1 }, 'UPDATE api_tokens SET revoked_at': { rowCount: 3 } });
    expect(await revokeUserApiTokens(db, userId)).toBe(3);
    const update = db.query.mock.calls.find(([text]) => String(text).includes('UPDATE api_tokens'));
    expect(String(update?.[0])).toContain('WHERE user_id = $1 AND revoked_at IS NULL');
    expect(update?.[1]).toEqual([userId]);

    expect(await revokeUserApiTokens(fakeDb({ 'SELECT 1 FROM users': { rowCount: 0 } }), userId)).toBeNull();
    const bad = fakeDb({});
    expect(await revokeUserApiTokens(bad, 'nope')).toBeNull();
    expect(bad.query).not.toHaveBeenCalled();
  });

  describe('authenticate', () => {
    const row = {
      id: tokenId,
      name: 'CI',
      prefix: 'tat_abcdef',
      allProjects: false,
      projectIds: [projectA],
      readOnly: true,
      createdAt,
      expiresAt: null,
      lastUsedAt: null,
      userId,
      userName: 'Ada',
      email: 'ada@example.com',
      role: 'content_manager',
    };

    it('finds an active token by its hash, with its user and scope', async () => {
      const db = fakeDb({ 'FROM api_tokens t': { rows: [row] } });
      const token = `tat_${'x'.repeat(43)}`;
      expect(await authenticateApiToken(db, token)).toEqual({
        tokenId,
        user: { id: userId, name: 'Ada', email: 'ada@example.com', role: 'content_manager' },
        projects: [projectA],
        readOnly: true,
        lastUsedAt: null,
      });
      const [text, params] = db.query.mock.calls[0];
      expect(params).toEqual([sha256(token)]);
      expect(String(text)).toContain('t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())');
      // The role comes from the user row, read now: a demoted admin's token is demoted too.
      expect(String(text)).toContain('JOIN users u ON u.id = t.user_id');
    });

    it('a token for all projects has the scope all', async () => {
      const db = fakeDb({ 'FROM api_tokens t': { rows: [{ ...row, allProjects: true, projectIds: [] }] } });
      expect((await authenticateApiToken(db, `tat_${'y'.repeat(43)}`))?.projects).toBe('all');
    });

    it('refuses a missing, unknown or wrong-form token after the same lookup', async () => {
      for (const token of [undefined, '', 'tas_siteKeyLookingThing', `tat_${'z'.repeat(43)}`]) {
        const db = fakeDb({});
        expect(await authenticateApiToken(db, token)).toBeNull();
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][1]).toEqual([sha256(token ?? '')]);
      }
      // A row found for text without the prefix is still refused.
      const db = fakeDb({ 'FROM api_tokens t': { rows: [row] } });
      expect(await authenticateApiToken(db, 'tas_abc')).toBeNull();
    });
  });

  describe('last used', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');

    it('writes when never used or last written over a minute ago, with a conditional update', async () => {
      const db = fakeDb({ 'UPDATE api_tokens SET last_used_at': { rowCount: 1 } });
      expect(await touchApiToken(db, { tokenId, lastUsedAt: null }, now)).toBe(true);
      expect(await touchApiToken(db, { tokenId, lastUsedAt: new Date(now - API_TOKEN_LAST_USED_INTERVAL_MS) }, now)).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(2);
      const [text, params] = db.query.mock.calls[0];
      expect(String(text)).toContain('last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2)');
      expect(params).toEqual([tokenId, 60]);
    });

    it('writes nothing when written within the minute', async () => {
      const db = fakeDb({});
      expect(await touchApiToken(db, { tokenId, lastUsedAt: new Date(now - 59_000) }, now)).toBe(false);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('migrates both tables with the hash unique and cascades from users and projects', async () => {
    const db = fakeDb({});
    await migrateApiTokens(db);
    const all = sql(db).join('\n');
    expect(all).toContain('user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE');
    expect(all).toContain('CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_key ON api_tokens (token_hash)');
    expect(all).toContain('project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE');
    expect(all).not.toMatch(/\btoken text\b/);
  });
});

describe('a token narrows its user\'s access', () => {
  const member = fakeDb({ 'FROM project_members WHERE user_id': { rows: [{ project_id: projectA }, { project_id: projectB }] } });

  it('an admin with a token reaches only the token\'s projects', async () => {
    const db = fakeDb({});
    const admin = { id: userId, role: 'admin' as const };
    expect(await accessibleProjectIds(db, admin)).toBe('all');
    expect(await accessibleProjectIds(db, { ...admin, tokenProjects: [projectA] })).toEqual([projectA]);
    expect(await accessibleProjectIds(db, { ...admin, tokenProjects: 'all' })).toBe('all');
    expect(await canAccessProject(db, { ...admin, tokenProjects: [projectA] }, projectA.toUpperCase())).toBe(true);
    expect(await canAccessProject(db, { ...admin, tokenProjects: [projectA] }, projectB)).toBe(false);
  });

  it('a content manager with a token reaches the projects both reach, read now', async () => {
    const cm = { id: userId, role: 'content_manager' as const };
    expect(await accessibleProjectIds(member, { ...cm, tokenProjects: [projectB, '00000000-0000-4000-8000-000000000009'] })).toEqual([
      projectB,
    ]);
    expect(await accessibleProjectIds(member, { ...cm, tokenProjects: 'all' })).toEqual([projectA, projectB]);
    // Outside the token's projects nothing is looked up.
    const db = fakeDb({ 'FROM project_members WHERE project_id': { rowCount: 1 } });
    expect(await canAccessProject(db, { ...cm, tokenProjects: [projectA] }, projectB)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
    expect(await canAccessProject(db, { ...cm, tokenProjects: [projectA] }, projectA)).toBe(true);
    // Not a member (any more): refused even inside the token's projects.
    const gone = fakeDb({ 'FROM project_members WHERE project_id': { rowCount: 0 } });
    expect(await canAccessProject(gone, { ...cm, tokenProjects: [projectA] }, projectA)).toBe(false);
  });
});
