import { randomBytes } from 'node:crypto';
import { ZONE_KEY_PREFIX, zoneKeyPrefix, type IssuedZoneKey, type ZoneKeyInfo } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { ZoneKeyNotFoundError } from './errors';
import { hashToken } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The zone a valid zone key reads, and its project (AD-4). */
export interface KeyZone {
  zoneId: string;
  projectId: string;
}

/**
 * Forward-only migration for the `zone_keys` table. It references
 * `zones (id, project_id)`, so it runs after the zones migration.
 */
export async function migrateZoneKeys(db: Db): Promise<void> {
  // Only the SHA-256 hash of a key is stored (NFR-003), plus a display prefix.
  // The composite foreign key keeps a key's project its zone's project (AD-4).
  await db.query(`
    CREATE TABLE IF NOT EXISTS zone_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      zone_id uuid NOT NULL,
      project_id uuid NOT NULL REFERENCES projects (id),
      key_hash text NOT NULL,
      prefix text NOT NULL,
      created_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id)
    );
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS zone_keys_key_hash_key ON zone_keys (key_hash)');
  // At most one active key per zone.
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS zone_keys_active_zone_key ON zone_keys (zone_id) WHERE revoked_at IS NULL',
  );
}

/** A new zone key: `tak_` and 32 random bytes in base64url. */
function newZoneKey(): string {
  return `${ZONE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * Issues a key for the zone. When the zone has an active key, this is a
 * rotation: in one transaction the old key is revoked and the new one stored.
 * The caller checks that the zone exists in `projectId` and that the creator
 * is an admin. The key is returned once; only its hash is stored.
 */
export async function issueZoneKey(
  db: TransactionalDb,
  input: { zoneId: string; projectId: string; createdBy: string },
): Promise<IssuedZoneKey> {
  const key = newZoneKey();
  const prefix = zoneKeyPrefix(key);
  return inTransaction(db, async (tx) => {
    // Serialises issues for one zone, so two rotations cannot race into two active keys.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('zone_keys:' || $1))", [input.zoneId]);
    await tx.query('UPDATE zone_keys SET revoked_at = now() WHERE zone_id = $1 AND revoked_at IS NULL', [
      input.zoneId,
    ]);
    const { rows } = await tx.query<{ createdAt: Date }>(
      `INSERT INTO zone_keys (zone_id, project_id, key_hash, prefix, created_by) VALUES ($1, $2, $3, $4, $5)
       RETURNING created_at AS "createdAt"`,
      [input.zoneId, input.projectId, hashToken(key), prefix, input.createdBy],
    );
    return { key, prefix, createdAt: rows[0].createdAt.toISOString() };
  });
}

/** Revokes the zone's active key. Throws {@link ZoneKeyNotFoundError} when it has none. Nothing is deleted. */
export async function revokeZoneKey(db: TransactionalDb, zoneId: string): Promise<void> {
  if (!UUID.test(zoneId)) throw new ZoneKeyNotFoundError();
  await inTransaction(db, async (tx) => {
    // The same per-zone lock as issueZoneKey, so a revoke racing a rotation sees the new key.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('zone_keys:' || $1))", [zoneId]);
    const { rowCount } = await tx.query(
      'UPDATE zone_keys SET revoked_at = now() WHERE zone_id = $1 AND revoked_at IS NULL',
      [zoneId],
    );
    if (!rowCount) throw new ZoneKeyNotFoundError();
  });
}

/** The zone's active key as the dashboard shows it, never the key or its hash; null when it has none. */
export async function zoneKeyInfo(db: Db, zoneId: string): Promise<ZoneKeyInfo | null> {
  if (!UUID.test(zoneId)) return null;
  const { rows } = await db.query<{ prefix: string; createdAt: Date }>(
    'SELECT prefix, created_at AS "createdAt" FROM zone_keys WHERE zone_id = $1 AND revoked_at IS NULL',
    [zoneId],
  );
  return rows[0] ? { prefix: rows[0].prefix, createdAt: rows[0].createdAt.toISOString() } : null;
}

/** The zone an active key reads, looked up by the key's hash; null for a missing, unknown or revoked key. */
export async function zoneForKey(db: Db, key: string | undefined): Promise<KeyZone | null> {
  if (!key || !key.startsWith(ZONE_KEY_PREFIX)) return null;
  const { rows } = await db.query<KeyZone>(
    'SELECT zone_id AS "zoneId", project_id AS "projectId" FROM zone_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hashToken(key)],
  );
  return rows[0] ?? null;
}

/**
 * The zones among `zoneIds` that have an active key: installed, until the site key of epic UX
 * rework story 6 (R7 "zone not installed").
 */
export async function zoneIdsWithActiveKey(db: Db, zoneIds: readonly string[]): Promise<Set<string>> {
  const ids = zoneIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return new Set();
  const { rows } = await db.query<{ zoneId: string }>(
    'SELECT DISTINCT zone_id AS "zoneId" FROM zone_keys WHERE zone_id = ANY($1::uuid[]) AND revoked_at IS NULL',
    [ids],
  );
  return new Set(rows.map((row) => row.zoneId));
}

/**
 * SQL that is true when the zone whose id is the expression `zoneId` is installed: it has an
 * active key (until the site key of epic UX rework story 6). The access module owns `zone_keys`;
 * other modules build their visibility and Delivery rules with this (R7).
 */
export function zoneInstalledSql(zoneId: string): string {
  return `EXISTS (SELECT 1 FROM zone_keys zk WHERE zk.zone_id = ${zoneId} AND zk.revoked_at IS NULL)`;
}
