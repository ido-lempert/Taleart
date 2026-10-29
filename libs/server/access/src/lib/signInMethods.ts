import type { AuthMethod } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { LastSignInMethodError, SignInLockoutError } from './errors';

/**
 * Forward-only migration for the sign-in method tables (sign-in methods epic): identities of
 * external providers, username and password, the method settings (one row), the providers and
 * admin-issued password reset links. Safe to run on every start. Existing installs keep passkeys
 * on and get nothing else (the settings row defaults to that).
 */
export async function migrateSignInMethods(db: Db): Promise<void> {
  // A provider identity: (provider, subject) is the key; an email is shown, never used to sign in.
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      provider text NOT NULL CHECK (provider ~ '^(google|apple|oidc:[a-z0-9][a-z0-9-]{0,39})$'),
      subject text NOT NULL,
      email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS user_identities_user_id_idx ON user_identities (user_id)');

  // A username and password. The hash is the self-describing scrypt string (passwords.ts).
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_passwords (
      user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      username text NOT NULL CHECK (username = lower(username)),
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Named by the spec's table of user_passwords. Nothing sets or reads it yet.
      must_change boolean NOT NULL DEFAULT false
    );
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS user_passwords_username_key ON user_passwords (lower(username))');

  // The passkey and password methods on or off: one row, kept by id.
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      passkey_enabled boolean NOT NULL DEFAULT true,
      password_enabled boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  await db.query('INSERT INTO auth_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');

  // The external providers. `secret_enc` is AES-256-GCM encrypted (secrets.ts); never plain.
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_providers (
      slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
      kind text NOT NULL CHECK (kind IN ('oidc', 'google', 'apple')),
      display_name text NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      config jsonb NOT NULL DEFAULT '{}',
      secret_enc bytea,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
      CHECK (
        (kind = 'google' AND slug = 'google') OR
        (kind = 'apple' AND slug = 'apple') OR
        (kind = 'oidc' AND slug NOT IN ('google', 'apple'))
      )
    );
  `);

  // One-time password reset links, as invitations are: only the SHA-256 hash of the token is stored.
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      created_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      used_by uuid REFERENCES users (id) ON DELETE SET NULL
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id)');
}

/** Transaction lock that serializes every change to the sign-in methods and to the admins' credentials. */
export const SIGN_IN_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('access:sign-in-methods', 0))";

/** The kind of a provider, from its slug: `google` and `apple` are presets, any other slug is OpenID Connect. */
export type ProviderKind = 'oidc' | 'google' | 'apple';

export function providerKindFor(slug: string): ProviderKind {
  return slug === 'google' || slug === 'apple' ? slug : 'oidc';
}

/** The sign-in method id of a provider: `google`, `apple` or `oidc:<slug>`. */
export function providerMethodId(slug: string): string {
  const kind = providerKindFor(slug);
  return kind === 'oidc' ? `oidc:${slug}` : kind;
}

/** The passkey and password switches. */
export interface SignInSettings {
  passkeyEnabled: boolean;
  passwordEnabled: boolean;
}

/** The settings as they are now. The migration always makes the row. */
export async function signInSettings(db: Db): Promise<SignInSettings> {
  const { rows } = await db.query<{ passkeyEnabled: boolean; passwordEnabled: boolean }>(
    'SELECT passkey_enabled AS "passkeyEnabled", password_enabled AS "passwordEnabled" FROM auth_settings WHERE id = 1',
  );
  return rows[0] ?? { passkeyEnabled: true, passwordEnabled: false };
}

/** A provider as the sign-in rules read it: its slug, whether it is on, and whether its secret is stored. */
export interface ProviderState {
  slug: string;
  enabled: boolean;
  hasSecret: boolean;
}

/** The providers as stored, by slug. */
export async function providerStates(db: Db): Promise<ProviderState[]> {
  const { rows } = await db.query<ProviderState>(
    'SELECT slug, enabled, secret_enc IS NOT NULL AS "hasSecret" FROM auth_providers ORDER BY slug',
  );
  return rows;
}

/**
 * A provider is usable when it is on, its secret is stored, and the server has the key that
 * decrypts that secret. Only usable methods are offered to sign in.
 */
export function providerUsable(provider: ProviderState, secretsAvailable: boolean): boolean {
  return provider.enabled && provider.hasSecret && secretsAvailable;
}

/** The password method as the sign-in page shows it. */
export const PASSWORD_METHOD: AuthMethod = { id: 'password', label: 'Username and password', kind: 'password' };

/** The methods a sign-in page offers now: the passkey, the password and the usable providers. */
export async function enabledMethods(db: Db, secretsAvailable: boolean): Promise<AuthMethod[]> {
  const settings = await signInSettings(db);
  const methods: AuthMethod[] = [];
  if (settings.passkeyEnabled) methods.push({ id: 'passkey', label: 'Passkey', kind: 'passkey' });
  if (settings.passwordEnabled) methods.push({ ...PASSWORD_METHOD });
  const { rows } = await db.query<{ slug: string; kind: ProviderKind; displayName: string; enabled: boolean; hasSecret: boolean }>(
    `SELECT slug, kind, display_name AS "displayName", enabled, secret_enc IS NOT NULL AS "hasSecret"
     FROM auth_providers ORDER BY slug`,
  );
  for (const row of rows) {
    if (!providerUsable(row, secretsAvailable)) continue;
    const id = providerMethodId(row.slug);
    methods.push({ id, label: row.displayName, kind: row.kind });
  }
  return methods;
}

// The sign-in method keys a credential can match: `passkey`, `password`, or `provider:<method id>`.
function usableKeys(settings: SignInSettings, providers: ProviderState[], secretsAvailable: boolean): string[] {
  const keys: string[] = [];
  if (settings.passkeyEnabled) keys.push('passkey');
  if (settings.passwordEnabled) keys.push('password');
  for (const provider of providers) {
    if (providerUsable(provider, secretsAvailable)) keys.push(`provider:${providerMethodId(provider.slug)}`);
  }
  return keys;
}

/**
 * The lock-out guard (spec): after a change, at least one method must be on, and at least one
 * method that is usable must be one every admin holds a credential for (a passkey, a password, or
 * an identity of that provider). Otherwise {@link LastSignInMethodError} or {@link SignInLockoutError},
 * and the caller's transaction rolls back. Run it inside the transaction holding {@link SIGN_IN_LOCK}.
 */
export async function assertSignInMethodsWork(db: Db, secretsAvailable: boolean): Promise<void> {
  const settings = await signInSettings(db);
  const providers = await providerStates(db);
  const onCount = (settings.passkeyEnabled ? 1 : 0) + (settings.passwordEnabled ? 1 : 0) + providers.filter((p) => p.enabled).length;
  if (onCount === 0) throw new LastSignInMethodError('At least one sign-in method must stay on');

  const { rows: admins } = await db.query<{ passkey: boolean; password: boolean; providers: string[] }>(
    `SELECT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id) AS passkey,
            EXISTS (SELECT 1 FROM user_passwords w WHERE w.user_id = u.id) AS password,
            ARRAY(SELECT i.provider FROM user_identities i WHERE i.user_id = u.id) AS providers
     FROM users u WHERE u.role = 'admin'`,
  );
  const everyAdmin = (has: (admin: (typeof admins)[number]) => boolean) => admins.every(has);
  const works = usableKeys(settings, providers, secretsAvailable).some((key) => {
    if (key === 'passkey') return everyAdmin((a) => a.passkey);
    if (key === 'password') return everyAdmin((a) => a.password);
    const id = key.slice('provider:'.length);
    return everyAdmin((a) => a.providers.includes(id));
  });
  if (!works) throw new SignInLockoutError();
}

/**
 * The per-user rule of removing a method (spec: a user can remove a method only if another remains):
 * after the removal the user must still hold a method that is on and usable. Run it inside the
 * transaction that removes the method, holding {@link SIGN_IN_LOCK}.
 */
export async function assertUserKeepsSignIn(db: Db, userId: string, secretsAvailable: boolean): Promise<void> {
  const settings = await signInSettings(db);
  const providers = await providerStates(db);
  const { rows } = await db.query<{ passkeys: string; password: boolean; identities: string[] }>(
    `SELECT (SELECT count(*) FROM passkeys WHERE user_id = $1)::text AS passkeys,
            EXISTS (SELECT 1 FROM user_passwords WHERE user_id = $1) AS password,
            ARRAY(SELECT provider FROM user_identities WHERE user_id = $1) AS identities`,
    [userId],
  );
  const row = rows[0];
  const usable = new Set(usableKeys(settings, providers, secretsAvailable));
  const keeps =
    (Number(row.passkeys) > 0 && usable.has('passkey')) ||
    (row.password && usable.has('password')) ||
    row.identities.some((provider) => usable.has(`provider:${provider}`));
  if (!keeps) throw new LastSignInMethodError('Keep another sign-in method that is on before removing this one');
}

/** Writes the passkey and password switches, then runs the lock-out guard; a refusal changes nothing. */
export async function setSignInSettings(
  db: TransactionalDb,
  update: { passkeyEnabled: boolean; passwordEnabled: boolean },
  actorId: string,
  secretsAvailable: boolean,
): Promise<SignInSettings> {
  return inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    await tx.query(
      `INSERT INTO auth_settings (id, passkey_enabled, password_enabled, updated_at, updated_by)
       VALUES (1, $1, $2, now(), $3)
       ON CONFLICT (id) DO UPDATE SET passkey_enabled = EXCLUDED.passkey_enabled,
         password_enabled = EXCLUDED.password_enabled, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [update.passkeyEnabled, update.passwordEnabled, actorId],
    );
    await assertSignInMethodsWork(tx, secretsAvailable);
    return signInSettings(tx);
  });
}
