import type { AuthProvider, AuthProviderConfig, SaveAuthProviderRequest } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { InputInvalidError, ProviderNotFoundError, SecretKeyMissingError } from './errors';
import { encryptSecret } from './secrets';
import { assertSignInMethodsWork, providerKindFor, providerMethodId, providerUsable, SIGN_IN_LOCK, type ProviderKind } from './signInMethods';

/** The most bytes a provider secret may be (the Apple `.p8` file is far smaller). */
export const PROVIDER_SECRET_MAX_BYTES = 8192;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DISPLAY_NAME_MAX = 80;
const CLIENT_ID_MAX = 255;
const SCOPES_MAX = 200;
const APPLE_ID = /^[A-Z0-9]{10}$/;
const SCOPE_TOKEN = /^[A-Za-z0-9._:/-]+$/;

// The settings each kind takes (spec: issuer, clientId, scopes override, teamId, keyId).
const CONFIG_FIELDS: Record<ProviderKind, readonly string[]> = {
  oidc: ['issuer', 'clientId', 'scopes'],
  google: ['clientId', 'scopes'],
  apple: ['clientId', 'teamId', 'keyId'],
};

/** What the API knows about providers: the server's key and public origin, and whether http issuers may be local. */
export interface ProviderContext {
  /** The key that encrypts secrets, or null when TALEART_SECRET_KEY is missing or invalid. */
  secretKey: Buffer | null;
  /** The API's public origin (PUBLIC_API_URL), which the redirect URI starts with. */
  publicApiUrl: string;
  /** True outside production: an issuer may then be http on localhost (spec). */
  allowHttpIssuer: boolean;
  /**
   * Issuers of the presets, for tests only: a fake provider on localhost stands in for Google or Apple.
   * Never set from the environment; the defaults are the real issuers.
   */
  presetIssuers?: Partial<Record<'google' | 'apple', string>>;
}

interface ProviderRow {
  slug: string;
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  config: AuthProviderConfig;
  hasSecret: boolean;
  updatedAt: Date;
}

/** The slug of a provider, checked. */
export function checkProviderSlug(slug: unknown): string {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new InputInvalidError('A provider slug is lower case letters, digits and hyphens, starting with a letter or digit, at most 40 characters');
  }
  return slug;
}

function invalid(message: string): InputInvalidError {
  return new InputInvalidError(message);
}

function issuer(value: unknown, allowHttp: boolean): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('config.issuer is the provider\'s issuer URL');
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid('config.issuer is not a URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw invalid('config.issuer is a plain URL: no user name, query or fragment');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'https:' || (url.protocol === 'http:' && allowHttp && local)) return text;
  throw invalid('config.issuer must be an https URL (http is allowed only for localhost outside production)');
}

function clientId(value: unknown): string {
  if (typeof value !== 'string') throw invalid('config.clientId is required');
  const text = value.trim();
  if (text.length === 0 || text.length > CLIENT_ID_MAX || /\s/.test(text)) {
    throw invalid(`config.clientId is one word of at most ${CLIENT_ID_MAX} characters`);
  }
  return text;
}

function scopes(value: unknown): string {
  if (typeof value !== 'string') throw invalid('config.scopes is a space-separated list of scopes');
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || !tokens.every((token) => SCOPE_TOKEN.test(token))) {
    throw invalid('config.scopes is a space-separated list of scopes');
  }
  if (!tokens.includes('openid')) throw invalid('config.scopes must include openid');
  const text = tokens.join(' ');
  if (text.length > SCOPES_MAX) throw invalid(`config.scopes is at most ${SCOPES_MAX} characters`);
  return text;
}

function appleId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !APPLE_ID.test(value)) throw invalid(`config.${field} is 10 capital letters and digits`);
  return value;
}

/**
 * Checks a provider's settings for its kind and returns them as stored: only the fields of the kind,
 * each valid (spec). Unknown fields are refused.
 */
export function checkProviderConfig(kind: ProviderKind, raw: unknown, allowHttpIssuer: boolean): AuthProviderConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('config must be an object');
  const fields = raw as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!CONFIG_FIELDS[kind].includes(key)) throw invalid(`config.${key} is not a setting of a ${kind} provider`);
  }
  const config: AuthProviderConfig = { clientId: clientId(fields['clientId']) };
  if (kind === 'oidc') config.issuer = issuer(fields['issuer'], allowHttpIssuer);
  if (kind === 'apple') {
    config.teamId = appleId(fields['teamId'], 'teamId');
    config.keyId = appleId(fields['keyId'], 'keyId');
  }
  if (kind !== 'apple' && fields['scopes'] !== undefined) config.scopes = scopes(fields['scopes']);
  return config;
}

/**
 * Checks a secret for its kind: a client secret for OpenID Connect and Google, the `.p8` private
 * key as PEM for Apple. The message never includes the secret.
 */
export function checkProviderSecret(kind: ProviderKind, secret: unknown): string {
  if (typeof secret !== 'string' || secret.trim() === '') throw invalid('secret is a non-empty string, or null to remove it');
  if (Buffer.byteLength(secret, 'utf8') > PROVIDER_SECRET_MAX_BYTES) {
    throw invalid(`secret is at most ${PROVIDER_SECRET_MAX_BYTES} bytes`);
  }
  if (kind === 'apple' && !(secret.includes('-----BEGIN PRIVATE KEY-----') && secret.includes('-----END PRIVATE KEY-----'))) {
    throw invalid('secret is the Apple .p8 private key, as PEM text');
  }
  return secret;
}

function checkDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw invalid('displayName is required');
  const text = value.trim();
  if (text.length === 0 || [...text].length > DISPLAY_NAME_MAX) {
    throw invalid(`displayName is 1 to ${DISPLAY_NAME_MAX} characters`);
  }
  return text;
}

function toView(row: ProviderRow, ctx: ProviderContext): AuthProvider {
  return {
    slug: row.slug,
    kind: row.kind,
    id: providerMethodId(row.slug),
    displayName: row.displayName,
    enabled: row.enabled,
    usable: providerUsable({ slug: row.slug, enabled: row.enabled, hasSecret: row.hasSecret }, ctx.secretKey !== null),
    config: row.config,
    hasSecret: row.hasSecret,
    redirectUri: `${ctx.publicApiUrl.replace(/\/+$/, '')}/api/v1/auth/callback/${row.slug}`,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const SELECT_PROVIDER = `SELECT slug, kind, display_name AS "displayName", enabled, config,
  secret_enc IS NOT NULL AS "hasSecret", updated_at AS "updatedAt" FROM auth_providers`;

/** Every provider, by slug. Never a secret: only whether one is stored. */
export async function listProviders(db: Db, ctx: ProviderContext): Promise<AuthProvider[]> {
  const { rows } = await db.query<ProviderRow>(`${SELECT_PROVIDER} ORDER BY slug`);
  return rows.map((row) => toView(row, ctx));
}

/**
 * Adds a provider or replaces its settings, in one transaction under the sign-in lock, with the
 * lock-out guard after the write. The secret is write-only: a string replaces it (encrypted, and
 * refused with {@link SecretKeyMissingError} when the server has no key), null removes it, and an
 * absent field keeps the stored one.
 */
export async function saveProvider(
  db: TransactionalDb,
  ctx: ProviderContext,
  slugInput: string,
  input: unknown,
  actorId: string,
): Promise<AuthProvider> {
  const slug = checkProviderSlug(slugInput);
  const kind = providerKindFor(slug);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalid('The body must be an object');
  const body = input as Partial<Record<keyof SaveAuthProviderRequest, unknown>>;
  const displayName = checkDisplayName(body.displayName);
  if (typeof body.enabled !== 'boolean') throw invalid('enabled is true or false');
  const config = checkProviderConfig(kind, body.config, ctx.allowHttpIssuer);
  const secret = body.secret === undefined ? undefined : body.secret === null ? null : checkProviderSecret(kind, body.secret);

  return inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rows: existing } = await tx.query<{ secret_enc: Buffer | null }>(
      'SELECT secret_enc FROM auth_providers WHERE slug = $1 FOR UPDATE',
      [slug],
    );
    let secretEnc: Buffer | null = existing[0]?.secret_enc ?? null;
    if (secret === null) secretEnc = null;
    else if (typeof secret === 'string') {
      if (ctx.secretKey === null) throw new SecretKeyMissingError();
      secretEnc = encryptSecret(secret, ctx.secretKey);
    }
    const { rows } = await tx.query<ProviderRow>(
      `INSERT INTO auth_providers (slug, kind, display_name, enabled, config, secret_enc, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
       ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, enabled = EXCLUDED.enabled,
         config = EXCLUDED.config, secret_enc = EXCLUDED.secret_enc, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING slug, kind, display_name AS "displayName", enabled, config,
         secret_enc IS NOT NULL AS "hasSecret", updated_at AS "updatedAt"`,
      [slug, kind, displayName, body.enabled, JSON.stringify(config), secretEnc, actorId],
    );
    await assertSignInMethodsWork(tx, ctx.secretKey !== null);
    return toView(rows[0], ctx);
  });
}

/** Removes a provider and its secret. Its linked identities stay, but cannot sign in while it is gone. */
export async function deleteProvider(db: TransactionalDb, ctx: ProviderContext, slugInput: string): Promise<void> {
  const slug = checkProviderSlug(slugInput);
  await inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rowCount } = await tx.query('DELETE FROM auth_providers WHERE slug = $1', [slug]);
    if (!rowCount) throw new ProviderNotFoundError();
    await assertSignInMethodsWork(tx, ctx.secretKey !== null);
  });
}
