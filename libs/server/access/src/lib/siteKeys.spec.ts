import { createHash } from 'node:crypto';
import type { TransactionalDb } from './db';
import { SiteKeyExistsError, SiteKeyNotFoundError } from './errors';
import { issueSiteKey, projectForSiteKey, revokeSiteKey, siteKeyInfo } from './siteKeys';

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

const projectId = '00000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-10-22T10:00:00Z');

describe('site keys', () => {
  it('issues tas_ and 32 random bytes, storing only the hash and the prefix', async () => {
    const db = fakeDb({ 'INSERT INTO site_keys': { rows: [{ createdAt }] } });
    const issued = await issueSiteKey(db, { projectId, createdBy: 'u1' });

    expect(issued.key).toMatch(/^tas_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.key.slice(4), 'base64url')).toHaveLength(32);
    expect(issued.prefix).toBe(issued.key.slice(0, 10));
    expect(issued.createdAt).toBe('2026-10-22T10:00:00.000Z');

    const insert = db.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO site_keys'));
    expect(insert?.[1]).toEqual([projectId, sha256(issued.key), issued.prefix, 'u1']);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(issued.key);
  });

  it('revokes the active key and stores the new one under a per-project lock, in one transaction (rotation)', async () => {
    const db = fakeDb({ 'INSERT INTO site_keys': { rows: [{ createdAt }] } });
    const a = await issueSiteKey(db, { projectId, createdBy: 'u1' });
    const statements = sql(db);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain("pg_advisory_xact_lock(hashtext('site_keys:' || $1))");
    expect(db.query.mock.calls[1][1]).toEqual([projectId]);
    expect(statements[2]).toBe('UPDATE site_keys SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL');
    expect(statements[3]).toContain('INSERT INTO site_keys');
    expect(statements[4]).toBe('COMMIT');
    const b = await issueSiteKey(db, { projectId, createdBy: 'u1' });
    expect(a.key).not.toBe(b.key);
  });

  it('a conditional issue (ifNone) checks under the lock and never rotates an active key (story 8.13)', async () => {
    const active = fakeDb({ 'SELECT 1 FROM site_keys': { rows: [{}] }, 'INSERT INTO site_keys': { rows: [{ createdAt }] } });
    await expect(issueSiteKey(active, { projectId, createdBy: 'u1', ifNone: true })).rejects.toBeInstanceOf(SiteKeyExistsError);
    const statements = sql(active);
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements[2]).toBe('SELECT 1 FROM site_keys WHERE project_id = $1 AND revoked_at IS NULL');
    expect(statements.some((s) => s.startsWith('UPDATE site_keys') || s.includes('INSERT INTO site_keys'))).toBe(false);
    expect(statements.at(-1)).toBe('ROLLBACK');

    const none = fakeDb({ 'SELECT 1 FROM site_keys': { rows: [] }, 'INSERT INTO site_keys': { rows: [{ createdAt }] } });
    const issued = await issueSiteKey(none, { projectId, createdBy: 'u1', ifNone: true });
    expect(issued.key).toMatch(/^tas_/);
    expect(sql(none).at(-1)).toBe('COMMIT');
  });

  it('revokes by setting revoked_at, and refuses a project without an active key', async () => {
    const db = fakeDb({ 'UPDATE site_keys': { rowCount: 1 } });
    await revokeSiteKey(db, projectId);
    const statements = sql(db);
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements[2]).toBe('UPDATE site_keys SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL');
    expect(statements[3]).toBe('COMMIT');
    await expect(revokeSiteKey(fakeDb({}), projectId)).rejects.toBeInstanceOf(SiteKeyNotFoundError);
    await expect(revokeSiteKey(fakeDb({}), 'not-a-uuid')).rejects.toBeInstanceOf(SiteKeyNotFoundError);
  });

  it('reports the active key as prefix and date only, or null', async () => {
    const db = fakeDb({ 'FROM site_keys': { rows: [{ prefix: 'tas_abcdef', createdAt }] } });
    expect(await siteKeyInfo(db, projectId)).toEqual({ prefix: 'tas_abcdef', createdAt: '2026-10-22T10:00:00.000Z' });
    expect(await siteKeyInfo(fakeDb({}), projectId)).toBeNull();
    expect(await siteKeyInfo(fakeDb({}), 'nope')).toBeNull();
  });

  it('finds the project of an active key by its hash', async () => {
    const db = fakeDb({ 'FROM site_keys': { rows: [{ projectId }] } });
    expect(await projectForSiteKey(db, 'tas_secret')).toBe(projectId);
    expect(db.query.mock.calls[0][1]).toEqual([sha256('tas_secret')]);
    expect(sql(db)[0]).toContain('revoked_at IS NULL');
  });

  it('costs one lookup for a missing or malformed key too, and never accepts one', async () => {
    // Even a row that matched (it cannot: only tas_ keys are stored) is not taken for another prefix.
    const db = fakeDb({ 'FROM site_keys': { rows: [{ projectId }] } });
    expect(await projectForSiteKey(db, undefined)).toBeNull();
    expect(await projectForSiteKey(db, '')).toBeNull();
    expect(await projectForSiteKey(db, 'tak_zonekey')).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(3);
  });
});
