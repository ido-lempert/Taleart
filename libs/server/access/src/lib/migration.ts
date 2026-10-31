import type { Db } from './db';
import { migrateApiTokens } from './apiTokens';
import { migrateSiteKeys } from './siteKeys';
import { migrateSignInMethods } from './signInMethods';

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
  // Invitations add their own challenge purpose (story 13). Replacing the check is idempotent.
  await db.query(`
    ALTER TABLE auth_challenges
      DROP CONSTRAINT IF EXISTS auth_challenges_purpose_check,
      ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN ('setup', 'sign-in', 'invitation', 'oauth'))
  `);

  // External provider sign-ins (sign-in methods, spec) keep their state in this table too, as kind
  // 'oauth'; passkey challenges are 'webauthn'. Both steps are idempotent.
  await db.query(`ALTER TABLE auth_challenges ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'webauthn'`);
  await db.query(`
    ALTER TABLE auth_challenges
      DROP CONSTRAINT IF EXISTS auth_challenges_kind_check,
      ADD CONSTRAINT auth_challenges_kind_check CHECK (kind IN ('webauthn', 'oauth'))
  `);

  // Content managers reach only the projects they are members of; admins reach all (AD-4).
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, user_id)
    );
  `);
  await db.query('CREATE INDEX IF NOT EXISTS project_members_user_id_idx ON project_members (user_id)');

  // Project roles (epic project access): a membership has a role and may end. Memberships that
  // existed before roles can do nearly everything inside a project, so they become 'publisher';
  // the column default is set after the backfill and stays 'publisher'. Every step is idempotent.
  await db.query(`ALTER TABLE project_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'publisher'`);
  await db.query('ALTER TABLE project_members ADD COLUMN IF NOT EXISTS expires_at timestamptz');
  await db.query(`
    ALTER TABLE project_members
      DROP CONSTRAINT IF EXISTS project_members_role_check,
      ADD CONSTRAINT project_members_role_check CHECK (role IN ('admin', 'publisher', 'editor', 'viewer'))
  `);

  // One-time invitations to a project (AD-9). Only the SHA-256 hash of the token is stored.
  await db.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      created_by uuid REFERENCES users (id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      used_by uuid REFERENCES users (id) ON DELETE SET NULL
    );
  `);

  // An invitation carries the role the invitee gets and when their access ends. Invitations made
  // before roles keep the power they had ('publisher'); new ones default to 'editor'.
  await db.query(`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'publisher'`);
  await db.query(`ALTER TABLE invitations ALTER COLUMN role SET DEFAULT 'editor'`);
  await db.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS access_expires_at timestamptz');
  await db.query(`
    ALTER TABLE invitations
      DROP CONSTRAINT IF EXISTS invitations_role_check,
      ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'publisher', 'editor', 'viewer'))
  `);

  // Who changed who may enter a project, written in the transaction of the change itself.
  await db.query(`
    CREATE TABLE IF NOT EXISTS project_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
      actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
      actor_name text NOT NULL,
      action text NOT NULL CHECK (action IN
        ('invited', 'invitation_revoked', 'joined', 'member_added', 'role_changed', 'expiry_changed', 'removed')),
      target_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
      target_email text,
      detail jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.query(
    'CREATE INDEX IF NOT EXISTS project_audit_log_project_idx ON project_audit_log (project_id, created_at DESC, id DESC)',
  );

  // A project's site key (AD-9 amended, epic UX rework R3).
  await migrateSiteKeys(db);

  // Personal API tokens for scripts (epic developer experience 10.1).
  await migrateApiTokens(db);

  // Sign-in methods: passwords, provider identities, the method settings, providers and reset links.
  await migrateSignInMethods(db);
}
