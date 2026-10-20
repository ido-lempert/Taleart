import type { Db } from './db';

/**
 * Forward-only migration for the tables the access module owns.
 * Safe to run on every start.
 */
export async function migrateAccess(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Dashboard users sign in with passkeys only (AD-9). webauthn_user_id is the
  // random user handle the authenticator stores with a discoverable passkey.
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      email text NOT NULL,
      role text NOT NULL CHECK (role IN ('admin', 'content_manager')),
      webauthn_user_id text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email))');

  await db.query(`
    CREATE TABLE IF NOT EXISTS passkeys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      credential_id text NOT NULL UNIQUE,
      public_key bytea NOT NULL,
      counter bigint NOT NULL DEFAULT 0,
      transports text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz
    );
  `);

  // Only the SHA-256 hash of a session token is stored (NFR-003).
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `);

  // Pending WebAuthn challenges, found through an http-only cookie holding the id.
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      purpose text NOT NULL CHECK (purpose IN ('setup', 'sign-in')),
      challenge text NOT NULL,
      data jsonb NOT NULL DEFAULT '{}',
      expires_at timestamptz NOT NULL
    );
  `);
}
