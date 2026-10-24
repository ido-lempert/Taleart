import { randomBytes } from 'node:crypto';
import {
  API_TOKEN_PREFIX,
  apiTokenPrefix,
  MAX_API_TOKENS_PER_USER,
  type ApiToken,
  type IssuedApiToken,
  type User,
} from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { ApiTokenLimitError, ApiTokenNotFoundError } from './errors';
import type { ProjectScope } from './members';
import { hashToken } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `last_used_at` is written at most this often per token, so a busy script does not write a row on
 * every request; the dashboard shows it to within a minute.
 */
export const API_TOKEN_LAST_USED_INTERVAL_MS = 60_000;

/**
 * Forward-only migration for `api_tokens` and `api_token_projects` (epic developer experience 10.1).
 * They reference only `users` and `projects`, so they run with the rest of the access module.
 */
export async function migrateApiTokens(db: Db): Promise<void> {
  // Only the SHA-256 hash of a token is stored (NFR-003), plus a display prefix. A revoked token
  // keeps its row (`revoked_at`), as site keys do.
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name text NOT NULL,
      token_hash text NOT NULL,
      prefix text NOT NULL,
      all_projects boolean NOT NULL,
      read_only boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz,
      last_used_at timestamptz,
      revoked_at timestamptz
    );
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_key ON api_tokens (token_hash)');
  await db.query('CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON api_tokens (user_id) WHERE revoked_at IS NULL');
  // The projects a token is limited to, when it is not for all of its user's projects.
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_token_projects (
      token_id uuid NOT NULL REFERENCES api_tokens (id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      PRIMARY KEY (token_id, project_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS api_token_projects_project_id_idx ON api_token_projects (project_id)');
}

/** A new API token: `tat_` and 32 random bytes in base64url. */
function newApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** What a new token is: its name and scope. The caller has checked every project against the user. */
export interface NewApiToken {
  userId: string;
  name: string;
  /** The projects the token is limited to, or null for every project the user can access. */
  projectIds: string[] | null;
  readOnly: boolean;
  expiresAt: Date | null;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  allProjects: boolean;
  projectIds: string[];
  readOnly: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toApiToken(row: TokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    projectIds: row.allProjects ? null : [...row.projectIds].sort(),
    readOnly: row.readOnly,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
  };
}

/**
 * Creates an API token for the user. The token is returned once; only its hash is stored. A user
 * holds at most {@link MAX_API_TOKENS_PER_USER} active tokens ({@link ApiTokenLimitError}): not
 * revoked and not expired, counted under a per-user lock so two creates at once cannot both pass.
 */
export async function createApiToken(db: TransactionalDb, input: NewApiToken): Promise<IssuedApiToken> {
  const token = newApiToken();
  const prefix = apiTokenPrefix(token);
  return inTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('api_tokens:' || $1))", [input.userId]);
    const { rows: counted } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM api_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [input.userId],
    );
    if ((counted[0]?.n ?? 0) >= MAX_API_TOKENS_PER_USER) throw new ApiTokenLimitError();
    const { rows } = await tx.query<{ id: string; createdAt: Date }>(
      `INSERT INTO api_tokens (user_id, name, token_hash, prefix, all_projects, read_only, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at AS "createdAt"`,
      [input.userId, input.name, hashToken(token), prefix, input.projectIds === null, input.readOnly, input.expiresAt],
    );
    const { id, createdAt } = rows[0];
    if (input.projectIds !== null) {
      await tx.query(
        'INSERT INTO api_token_projects (token_id, project_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING',
        [id, input.projectIds],
      );
    }
    return {
      ...toApiToken({
        id,
        name: input.name,
        prefix,
        allProjects: input.projectIds === null,
        projectIds: input.projectIds ?? [],
        readOnly: input.readOnly,
        createdAt,
        expiresAt: input.expiresAt,
        lastUsedAt: null,
      }),
      token,
    };
  });
}

const TOKEN_COLUMNS = `
  t.id, t.name, t.prefix, t.all_projects AS "allProjects", t.read_only AS "readOnly",
  t.created_at AS "createdAt", t.expires_at AS "expiresAt", t.last_used_at AS "lastUsedAt",
  COALESCE(array_agg(p.project_id) FILTER (WHERE p.project_id IS NOT NULL), '{}')::text[] AS "projectIds"`;

/** The user's tokens that are not revoked (expired ones too), newest first; never a token or its hash. */
export async function listApiTokens(db: Db, userId: string): Promise<ApiToken[]> {
  const { rows } = await db.query<TokenRow>(
    `SELECT ${TOKEN_COLUMNS}
     FROM api_tokens t LEFT JOIN api_token_projects p ON p.token_id = t.id
     WHERE t.user_id = $1 AND t.revoked_at IS NULL
     GROUP BY t.id
     ORDER BY t.created_at DESC, t.id`,
    [userId],
  );
  return rows.map(toApiToken);
}

/**
 * Revokes one of the user's tokens. Another user's token, an unknown or an already revoked one
 * throws {@link ApiTokenNotFoundError}, so no user learns of another's tokens. Nothing is deleted.
 */
export async function revokeApiToken(db: Db, userId: string, tokenId: string): Promise<void> {
  if (!UUID.test(tokenId)) throw new ApiTokenNotFoundError();
  const { rowCount } = await db.query(
    'UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
    [tokenId, userId],
  );
  if (!rowCount) throw new ApiTokenNotFoundError();
}

/**
 * Revokes every active token of a user (an admin's action, for a lost laptop or a person leaving):
 * the number revoked, or null when no user has this id. Nothing is deleted.
 */
export async function revokeUserApiTokens(db: Db, userId: string): Promise<number | null> {
  if (!UUID.test(userId)) return null;
  const { rowCount: exists } = await db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (!exists) return null;
  const { rowCount } = await db.query(
    'UPDATE api_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount ?? 0;
}

/** A token that authenticated: its user (read now, with their current role) and its scope. */
export interface AuthenticatedApiToken {
  tokenId: string;
  user: User;
  /** The projects the token is limited to, or 'all' for every project its user can access. */
  projects: ProjectScope;
  readOnly: boolean;
  /** When `last_used_at` was last written, for {@link touchApiToken}. */
  lastUsedAt: Date | null;
}

/**
 * The token and its user for an active (not revoked, not expired) API token, looked up by the
 * token's hash; null for a missing, unknown, revoked, expired or wrong-form token. Any text is hashed
 * and looked up, so a token of the wrong form (a site key, say) costs the same query, as site keys do.
 */
export async function authenticateApiToken(db: Db, token: string | undefined): Promise<AuthenticatedApiToken | null> {
  const { rows } = await db.query<TokenRow & { userId: string; userName: string; email: string; role: User['role'] }>(
    `SELECT ${TOKEN_COLUMNS}, u.id AS "userId", u.name AS "userName", u.email, u.role
     FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN api_token_projects p ON p.token_id = t.id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
     GROUP BY t.id, u.id`,
    [hashToken(token ?? '')],
  );
  const row = rows[0];
  if (!row || !token?.startsWith(API_TOKEN_PREFIX)) return null;
  return {
    tokenId: row.id,
    user: { id: row.userId, name: row.userName, email: row.email, role: row.role },
    projects: row.allProjects ? 'all' : row.projectIds,
    readOnly: row.readOnly,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Records that the token was used, at most once per {@link API_TOKEN_LAST_USED_INTERVAL_MS}: nothing
 * is written when the value read at authentication is recent, and the update itself is conditional,
 * so many requests at once write one row. Returns whether it wrote.
 */
export async function touchApiToken(
  db: Db,
  token: Pick<AuthenticatedApiToken, 'tokenId' | 'lastUsedAt'>,
  now: number = Date.now(),
): Promise<boolean> {
  if (token.lastUsedAt && now - token.lastUsedAt.getTime() < API_TOKEN_LAST_USED_INTERVAL_MS) return false;
  const { rowCount } = await db.query(
    `UPDATE api_tokens SET last_used_at = now()
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2))`,
    [token.tokenId, API_TOKEN_LAST_USED_INTERVAL_MS / 1000],
  );
  return (rowCount ?? 0) > 0;
}
