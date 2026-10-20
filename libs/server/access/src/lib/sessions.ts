import type { User } from '@taleart/contract';
import type { Db } from './db';
import { hashToken, newToken } from './tokens';

/** How long a session lasts after it is created. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The SHA-256 hash of a session token, hex. Only this is stored (NFR-003). */
export function hashSessionToken(token: string): string {
  return hashToken(token);
}

/** A new session: the token goes to the browser once, in a cookie. */
export interface NewSession {
  token: string;
  expiresAt: Date;
}

/** Starts a session for the user: 32 random bytes, stored only as their hash. */
export async function createSession(db: Db, userId: string): Promise<NewSession> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  // The user's expired sessions are no longer of use.
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()', [userId]);
  await db.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hashSessionToken(token),
    expiresAt,
  ]);
  return { token, expiresAt };
}

/** The user of a valid, unexpired session, or null. */
export async function findSessionUser(db: Db, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const { rows } = await db.query<User>(
    `SELECT u.id, u.name, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  return rows[0] ?? null;
}

/** Ends the session with this token, if there is one. */
export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}
