import { createHash } from 'node:crypto';
import type { TransactionalDb } from './db';
import { ZoneKeyNotFoundError } from './errors';
import { issueZoneKey, revokeZoneKey, zoneForKey, zoneKeyInfo } from './zoneKeys';

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

const zoneId = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-10-20T10:00:00Z');

describe('zone keys', () => {
  it('issues tak_ and 32 random bytes, storing only the hash and the prefix', async () => {
    const db = fakeDb({ 'INSERT INTO zone_keys': { rows: [{ createdAt }] } });
    const issued = await issueZoneKey(db, { zoneId, projectId, createdBy: 'u1' });

    expect(issued.key).toMatch(/^tak_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(issued.key.slice(4), 'base64url')).toHaveLength(32);
    expect(issued.prefix).toBe(issued.key.slice(0, 10));
    expect(issued.createdAt).toBe('2026-10-20T10:00:00.000Z');

    const insert = db.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO zone_keys'));
    expect(insert?.[1]).toEqual([zoneId, projectId, sha256(issued.key), issued.prefix, 'u1']);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(issued.key);
  });

  it('revokes the active key and stores the new one in one transaction (rotation)', async () => {
    const db = fakeDb({ 'INSERT INTO zone_keys': { rows: [{ createdAt }] } });
    await issueZoneKey(db, { zoneId, projectId, createdBy: 'u1' });
    const statements = sql(db);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements[2]).toBe('UPDATE zone_keys SET revoked_at = now() WHERE zone_id = $1 AND revoked_at IS NULL');
    expect(statements[3]).toContain('INSERT INTO zone_keys');
    expect(statements[4]).toBe('COMMIT');
  });

  it('issues a different key every time', async () => {
    const db = fakeDb({ 'INSERT INTO zone_keys': { rows: [{ createdAt }] } });
    const a = await issueZoneKey(db, { zoneId, projectId, createdBy: 'u1' });
    const b = await issueZoneKey(db, { zoneId, projectId, createdBy: 'u1' });
    expect(a.key).not.toBe(b.key);
  });

  it('revokes by setting revoked_at, and refuses a zone without an active key', async () => {
    const db = fakeDb({ 'UPDATE zone_keys': { rowCount: 1 } });
    await revokeZoneKey(db, zoneId);
    const statements = sql(db);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(db.query.mock.calls[1][1]).toEqual([zoneId]);
    expect(statements[2]).toBe('UPDATE zone_keys SET revoked_at = now() WHERE zone_id = $1 AND revoked_at IS NULL');
    expect(statements[3]).toBe('COMMIT');
    await expect(revokeZoneKey(fakeDb({}), zoneId)).rejects.toBeInstanceOf(ZoneKeyNotFoundError);
    await expect(revokeZoneKey(fakeDb({}), 'not-a-uuid')).rejects.toBeInstanceOf(ZoneKeyNotFoundError);
  });

  it('reports the active key as prefix and date only, or null', async () => {
    const db = fakeDb({ 'FROM zone_keys': { rows: [{ prefix: 'tak_abcdef', createdAt }] } });
    expect(await zoneKeyInfo(db, zoneId)).toEqual({ prefix: 'tak_abcdef', createdAt: '2026-10-20T10:00:00.000Z' });
    expect(await zoneKeyInfo(fakeDb({}), zoneId)).toBeNull();
    expect(await zoneKeyInfo(fakeDb({}), 'nope')).toBeNull();
  });

  it('finds the zone of an active key by its hash', async () => {
    const db = fakeDb({ 'FROM zone_keys': { rows: [{ zoneId, projectId }] } });
    expect(await zoneForKey(db, 'tak_secret')).toEqual({ zoneId, projectId });
    expect(db.query.mock.calls[0][1]).toEqual([sha256('tak_secret')]);
    expect(sql(db)[0]).toContain('revoked_at IS NULL');
  });

  it('refuses a missing or malformed key without a query', async () => {
    const db = fakeDb({});
    expect(await zoneForKey(db, undefined)).toBeNull();
    expect(await zoneForKey(db, '')).toBeNull();
    expect(await zoneForKey(db, 'not-a-zone-key')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
});
