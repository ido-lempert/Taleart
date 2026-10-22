import { randomBytes } from 'node:crypto';
import { SITE_KEY_PREFIX, siteKeyPrefix, type IssuedSiteKey, type SiteKeyInfo } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { SiteKeyNotFoundError } from './errors';
import { hashToken } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Forward-only migration for the `site_keys` table (AD-9 amended, epic UX rework R3). It references
 * only `projects` and `users`, so it runs with the rest of the access module.
 */
export async function migrateSiteKeys(db: Db): Promise<void> {
  // Only the SHA-256 hash of a key is stored (NFR-003), plus a display prefix.
  await db.query(`
    CREATE TABLE IF NOT EXISTS site_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects (id),
      key_hash text NOT NULL,
      prefix text NOT NULL,
      created_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS site_keys_key_hash_key ON site_keys (key_hash)');
  // At most one active site key per project.
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS site_keys_active_project_key ON site_keys (project_id) WHERE revoked_at IS NULL',
  );
  await dropZoneKeys(db);
}

/** How long the drop of `zone_keys` waits for a lock before it fails, rather than queue every query behind it. */
export const ZONE_KEYS_DROP_LOCK_TIMEOUT = '10s';

/**
 * Zone keys are gone (epic UX rework, owner decision 2026-10-22): the site key and a zone slug are
 * the only way to place a zone, and nothing in `zone_keys` needs keeping. The drop waits at most
 * {@link ZONE_KEYS_DROP_LOCK_TIMEOUT} for its lock. It runs on the migrations' one connection, in its
 * own transaction so `SET LOCAL` ends with it. Every API instance of the release before must be
 * stopped first (it still reads the table): a stop-the-world deploy, as for story 8.5.
 */
async function dropZoneKeys(db: Db): Promise<void> {
  const { rows } = await db.query<{ t: string | null }>("SELECT to_regclass('zone_keys') AS t");
  if (!rows[0]?.t) return;
  await db.query('BEGIN');
  try {
    await db.query(`SET LOCAL lock_timeout = '${ZONE_KEYS_DROP_LOCK_TIMEOUT}'`);
    await db.query('DROP TABLE IF EXISTS zone_keys');
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/** A new site key: `tas_` and 32 random bytes in base64url. */
function newSiteKey(): string {
  return `${SITE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

// Serialises issues and revokes for one project, so two rotations cannot race into two active keys
// and a revoke racing a rotation sees the new key.
async function lockProject(tx: Db, projectId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('site_keys:' || $1))", [projectId]);
}

/**
 * Issues the project's site key. When the project has an active one, this is a rotation: in one
 * transaction the old key is revoked and the new one stored, which affects every zone of the
 * project. The caller checks that the project exists and that the creator is an admin. The key is
 * returned once; only its hash is stored.
 */
export async function issueSiteKey(
  db: TransactionalDb,
  input: { projectId: string; createdBy: string },
): Promise<IssuedSiteKey> {
  const key = newSiteKey();
  const prefix = siteKeyPrefix(key);
  return inTransaction(db, async (tx) => {
    await lockProject(tx, input.projectId);
    await tx.query('UPDATE site_keys SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL', [
      input.projectId,
    ]);
    const { rows } = await tx.query<{ createdAt: Date }>(
      `INSERT INTO site_keys (project_id, key_hash, prefix, created_by) VALUES ($1, $2, $3, $4)
       RETURNING created_at AS "createdAt"`,
      [input.projectId, hashToken(key), prefix, input.createdBy],
    );
    return { key, prefix, createdAt: rows[0].createdAt.toISOString() };
  });
}

/** Revokes the project's active site key. Throws {@link SiteKeyNotFoundError} when it has none. Nothing is deleted. */
export async function revokeSiteKey(db: TransactionalDb, projectId: string): Promise<void> {
  if (!UUID.test(projectId)) throw new SiteKeyNotFoundError();
  await inTransaction(db, async (tx) => {
    await lockProject(tx, projectId);
    const { rowCount } = await tx.query(
      'UPDATE site_keys SET revoked_at = now() WHERE project_id = $1 AND revoked_at IS NULL',
      [projectId],
    );
    if (!rowCount) throw new SiteKeyNotFoundError();
  });
}

/** The project's active site key as the dashboard shows it, never the key or its hash; null when it has none. */
export async function siteKeyInfo(db: Db, projectId: string): Promise<SiteKeyInfo | null> {
  if (!UUID.test(projectId)) return null;
  const { rows } = await db.query<{ prefix: string; createdAt: Date }>(
    'SELECT prefix, created_at AS "createdAt" FROM site_keys WHERE project_id = $1 AND revoked_at IS NULL',
    [projectId],
  );
  return rows[0] ? { prefix: rows[0].prefix, createdAt: rows[0].createdAt.toISOString() } : null;
}

/**
 * The project an active site key reads, looked up by the key's hash; null for a missing, unknown or
 * revoked key. Any text is hashed and looked up, so a key of the wrong form costs the same query.
 */
export async function projectForSiteKey(db: Db, key: string | undefined): Promise<string | null> {
  const { rows } = await db.query<{ projectId: string }>(
    'SELECT project_id AS "projectId" FROM site_keys WHERE key_hash = $1 AND revoked_at IS NULL',
    [hashToken(key ?? '')],
  );
  return key?.startsWith(SITE_KEY_PREFIX) ? (rows[0]?.projectId ?? null) : null;
}

/**
 * SQL that is true when the project whose id is the expression `projectId` has an active site key,
 * which is what makes each of its zones installed (epic UX rework R7 "zone not installed"). The access
 * module owns `site_keys`; other modules build their visibility and Delivery rules with this.
 */
export function zoneInstalledSql(projectId: string): string {
  return `EXISTS (SELECT 1 FROM site_keys isk WHERE isk.project_id = ${projectId} AND isk.revoked_at IS NULL)`;
}
