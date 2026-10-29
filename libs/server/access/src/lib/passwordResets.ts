import { PASSWORD_RESET_TTL_MS, type PasswordResetPreview, type User } from '@taleart/contract';
import type { SignedInUser } from './auth';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { InputInvalidError, PasswordResetInvalidError, SignInItemNotFoundError } from './errors';
import { insertPassword, type PasswordCredentials } from './passwordSignIn';
import { checkPassword, hashPassword, normalizeUsername } from './passwords';
import { signInSettings, SIGN_IN_LOCK } from './signInMethods';
import { createSession } from './sessions';
import { hashToken, newToken } from './tokens';

/** A new reset link. `token` goes into the link once; only its hash is stored. */
export interface NewPasswordReset {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

interface ValidReset {
  id: string;
  userId: string;
  name: string;
  email: string;
  expiresAt: Date;
  hasPassword: boolean;
  username: string | null;
}

/**
 * Issues a one-time password reset link for a user (spec, admin only; the caller checks the admin).
 * It works once, for {@link PASSWORD_RESET_TTL_MS}. The user's earlier unused links are replaced, so
 * one link is live at a time. Only the hash of the token is stored. An unknown user is
 * {@link SignInItemNotFoundError}.
 */
export async function issuePasswordReset(db: TransactionalDb, userId: string, createdBy: string): Promise<NewPasswordReset> {
  return inTransaction(db, async (tx) => {
    const { rowCount } = await tx.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    if (!rowCount) throw new SignInItemNotFoundError('No user has this id');
    await tx.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [userId]);
    const token = newToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const { rows } = await tx.query<{ id: string }>(
      'INSERT INTO password_resets (user_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, hashToken(token), createdBy, expiresAt],
    );
    return { id: rows[0].id, userId, token, expiresAt };
  });
}

// The unused, unexpired reset with this token. Refused (410) while the password method is off too:
// a password set now could not be used to sign in.
async function validReset(db: Db, token: string | undefined): Promise<ValidReset> {
  if (!token) throw new PasswordResetInvalidError();
  const { rows } = await db.query<ValidReset>(
    `SELECT r.id, r.user_id AS "userId", u.name, u.email, r.expires_at AS "expiresAt",
       EXISTS (SELECT 1 FROM user_passwords w WHERE w.user_id = r.user_id) AS "hasPassword",
       (SELECT w.username FROM user_passwords w WHERE w.user_id = r.user_id) AS username
     FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
    [hashToken(token)],
  );
  const reset = rows[0];
  if (!reset || !(await signInSettings(db)).passwordEnabled) throw new PasswordResetInvalidError();
  return reset;
}

/** What the reset page shows: whose password the link sets, and whether it must ask for a username. */
export async function previewPasswordReset(db: Db, token: string | undefined): Promise<PasswordResetPreview> {
  const reset = await validReset(db, token);
  return { name: reset.name, usernameRequired: !reset.hasPassword, expiresAt: reset.expiresAt.toISOString() };
}

/**
 * Sets the password through a reset link and signs the user in (spec). The user's username is
 * kept when they have one (a `username` sent must match it); a user without one must send it. The
 * policy applies. In one transaction, under the sign-in lock with the link row locked: the password
 * is stored, every session of the user ends, the link is marked used and a new session starts.
 */
export async function redeemPasswordReset(
  db: TransactionalDb,
  token: string | undefined,
  input: PasswordCredentials,
): Promise<SignedInUser> {
  const reset = await validReset(db, token);
  let username: string;
  if (reset.hasPassword && reset.username !== null) {
    if (input.username !== undefined && normalizeUsername(input.username) !== reset.username) {
      throw new InputInvalidError('The username cannot be changed here');
    }
    username = reset.username;
  } else {
    username = normalizeUsername(input.username);
  }
  const password = checkPassword(input.password, { username, email: reset.email });
  const passwordHash = await hashPassword(password);

  return inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rows } = await tx.query<{ valid: boolean }>(
      'SELECT used_at IS NULL AND expires_at > now() AS valid FROM password_resets WHERE id = $1 FOR UPDATE',
      [reset.id],
    );
    if (!rows[0]?.valid || !(await signInSettings(tx)).passwordEnabled) throw new PasswordResetInvalidError();

    const { rowCount } = await tx.query('UPDATE user_passwords SET password_hash = $2, updated_at = now() WHERE user_id = $1', [
      reset.userId,
      passwordHash,
    ]);
    if (!rowCount) await insertPassword(tx, reset.userId, username, passwordHash);
    await tx.query('UPDATE password_resets SET used_at = now(), used_by = $2 WHERE id = $1', [reset.id, reset.userId]);
    await tx.query('DELETE FROM sessions WHERE user_id = $1', [reset.userId]);

    const user = (await tx.query<User>('SELECT id, name, email, role FROM users WHERE id = $1', [reset.userId])).rows[0];
    return { user, session: await createSession(tx, reset.userId) };
  });
}
