import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';

/**
 * Signing in without a passkey, for the specs that do not test sign-up (the first-run and the
 * dashboard scan own the passkey set-up), and emptying the install again afterwards, so the specs
 * that start from a fresh install find one whichever runs first.
 */

// The e2e database, guarded as the API's start script guards it (it must end in _e2e_test).
const databaseUrl = (): string => e2eDatabase(process.env).url;

/**
 * An admin with a session, the token stored only as its SHA-256 hash, as the access module's
 * `hashSessionToken` stores it (this project may not import server modules); the session token,
 * for the `taleart_session` cookie.
 */
export async function signIn(name = 'Studio scan'): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, `studio-${randomBytes(6).toString('hex')}@example.com`, 'admin', randomBytes(32).toString('base64url')],
    );
    const token = randomBytes(32).toString('base64url');
    await client.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '2 hours')",
      [rows[0].id, createHash('sha256').update(token, 'utf8').digest('hex')],
    );
    return token;
  } finally {
    await client.end();
  }
}

/** Back to an empty install: every user and project, and all that hangs on them, goes. */
export async function emptyInstall(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query('TRUNCATE users, projects CASCADE');
  } finally {
    await client.end();
  }
}
