import type { User } from '@taleart/contract';
import { createUser, SETUP_LOCK, setupRequired, type SignedInUser } from './auth';
import { inTransaction, type Db, type TransactionalDb } from './db';
import {
  EmailTakenError,
  InputInvalidError,
  InvitationInvalidError,
  PasswordIncorrectError,
  SetupClosedError,
  SignInFailedError,
  SignInItemNotFoundError,
  SignInMethodDisabledError,
  SignInThrottledError,
  UsernameTakenError,
} from './errors';
import { addProjectMember } from './members';
import { checkPassword, hashPassword, normalizeUsername, verifyAgainstDummyHash, verifyPassword } from './passwords';
import { emailTaken, validInvitation, type JoinedProject } from './invitations';
import { createSession, hashSessionToken } from './sessions';
import { assertUserKeepsSignIn, signInSettings, SIGN_IN_LOCK } from './signInMethods';
import type { PasswordThrottle } from './throttle';

/** The fields a password registration (setup or an invitation) carries after the name and email. */
export interface PasswordCredentials {
  username: unknown;
  password: unknown;
}

// The `user_passwords` row of a user, with the username unique as the index enforces it.
export async function insertPassword(db: Db, userId: string, username: string, passwordHash: string): Promise<void> {
  try {
    await db.query('INSERT INTO user_passwords (user_id, username, password_hash) VALUES ($1, $2, $3)', [
      userId,
      username,
      passwordHash,
    ]);
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'user_passwords_username_key') throw new UsernameTakenError();
    throw err;
  }
}

/**
 * Creates the first admin with a username and password, and signs them in (the password variant of
 * setup). Throws {@link SetupClosedError} once a user exists, and {@link SignInMethodDisabledError}
 * unless `setupAllowed` (the server runs with TALEART_SETUP_PASSWORD=true). In the same transaction
 * the password method is turned on, so the new admin can sign in with it. Setup is serialized by the
 * setup lock, as the passkey setup is.
 */
export async function setupWithPassword(
  db: TransactionalDb,
  input: { name: string; email: string } & PasswordCredentials,
  setupAllowed: boolean,
): Promise<SignedInUser> {
  if (!(await setupRequired(db))) throw new SetupClosedError();
  if (!setupAllowed) throw new SignInMethodDisabledError();
  const username = normalizeUsername(input.username);
  const password = checkPassword(input.password, { username, email: input.email });
  const passwordHash = await hashPassword(password);

  return inTransaction(db, async (tx) => {
    await tx.query(SETUP_LOCK);
    if (!(await setupRequired(tx))) throw new SetupClosedError();
    const user = await createUser(tx, { name: input.name, email: input.email, role: 'admin' });
    await insertPassword(tx, user.id, username, passwordHash);
    await tx.query(
      `INSERT INTO auth_settings (id, password_enabled, updated_at, updated_by) VALUES (1, true, now(), $1)
       ON CONFLICT (id) DO UPDATE SET password_enabled = true, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [user.id],
    );
    return { user, session: await createSession(tx, user.id) };
  });
}

/**
 * Joins through an invitation with a username and password, as {@link finishInvitation} does with a
 * passkey: the content manager, their password, their project membership, the invitation used and a
 * session, in one transaction.
 */
export async function redeemInvitationWithPassword(
  db: TransactionalDb,
  token: string | undefined,
  input: { name: string; email: string } & PasswordCredentials,
): Promise<JoinedProject> {
  const invitation = await validInvitation(db, token);
  if (!(await signInSettings(db)).passwordEnabled) throw new SignInMethodDisabledError();
  if (await emailTaken(db, input.email)) throw new EmailTakenError();
  const username = normalizeUsername(input.username);
  const password = checkPassword(input.password, { username, email: input.email });
  const passwordHash = await hashPassword(password);

  try {
    return await inTransaction(db, async (tx) => {
      const locked = await tx.query<{ valid: boolean }>(
        'SELECT used_at IS NULL AND expires_at > now() AS valid FROM invitations WHERE id = $1 FOR UPDATE',
        [invitation.id],
      );
      if (!locked.rows[0]?.valid) throw new InvitationInvalidError();
      if (await emailTaken(tx, input.email)) throw new EmailTakenError();
      const user = await createUser(tx, { name: input.name, email: input.email, role: 'content_manager' });
      await insertPassword(tx, user.id, username, passwordHash);
      await addProjectMember(tx, invitation.projectId, user.id);
      await tx.query('UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1', [invitation.id, user.id]);
      return { user, projectId: invitation.projectId, session: await createSession(tx, user.id) };
    });
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'users_email_key') throw new EmailTakenError();
    throw err;
  }
}

/**
 * Signs in with a username and password. Every refusal is the same {@link SignInFailedError}: an
 * unknown username, a wrong password, and the password method being off (the last one still runs a
 * check, so the time does not tell them apart). A username is throttled whether or not it exists
 * (see {@link PasswordThrottle}); while it waits, {@link SignInThrottledError} says how long.
 */
export async function signInWithPassword(
  db: Db,
  throttle: PasswordThrottle,
  input: { username: string; password: string },
): Promise<SignedInUser> {
  const key = input.username.trim().toLowerCase();
  const wait = throttle.waitMs(key);
  if (wait > 0) throw new SignInThrottledError(Math.ceil(wait / 1000));

  const refuse = (): never => {
    throttle.failed(key);
    throw new SignInFailedError();
  };
  let username: string;
  try {
    username = normalizeUsername(key);
  } catch {
    await verifyAgainstDummyHash(input.password);
    return refuse();
  }
  if (!(await signInSettings(db)).passwordEnabled) {
    await verifyAgainstDummyHash(input.password);
    return refuse();
  }
  const { rows } = await db.query<User & { passwordHash: string }>(
    `SELECT u.id, u.name, u.email, u.role, w.password_hash AS "passwordHash"
     FROM user_passwords w JOIN users u ON u.id = w.user_id WHERE w.username = $1`,
    [username],
  );
  const row = rows[0];
  if (!row) {
    await verifyAgainstDummyHash(input.password);
    return refuse();
  }
  if (!(await verifyPassword(input.password, row.passwordHash))) return refuse();

  throttle.succeeded(key);
  const user: User = { id: row.id, name: row.name, email: row.email, role: row.role };
  return { user, session: await createSession(db, user.id) };
}

/**
 * Sets the signed-in user's password, or changes it (spec, self-service). A user with a password
 * proves it with `currentPassword` (a wrong one is {@link PasswordIncorrectError}, counted against
 * the username's throttle) and cannot change the username here. A user without one needs a
 * `username`. The policy applies to the new password. A change ends the user's other sessions; the
 * session making the request stays. The first password does not end any session.
 */
export async function setOwnPassword(
  db: TransactionalDb,
  throttle: PasswordThrottle,
  user: User,
  sessionToken: string | undefined,
  input: { username?: unknown; currentPassword?: unknown; password: unknown },
): Promise<void> {
  const { rows } = await db.query<{ username: string; passwordHash: string }>(
    'SELECT username, password_hash AS "passwordHash" FROM user_passwords WHERE user_id = $1',
    [user.id],
  );
  const current = rows[0];
  let username: string;
  if (current) {
    if (typeof input.currentPassword !== 'string') throw new InputInvalidError('currentPassword is required to change the password');
    if (input.username !== undefined && normalizeUsername(input.username) !== current.username) {
      throw new InputInvalidError('The username cannot be changed here');
    }
    username = current.username;
    const wait = throttle.waitMs(username);
    if (wait > 0) throw new SignInThrottledError(Math.ceil(wait / 1000));
    if (!(await verifyPassword(input.currentPassword, current.passwordHash))) {
      throttle.failed(username);
      throw new PasswordIncorrectError();
    }
    throttle.succeeded(username);
  } else {
    username = normalizeUsername(input.username);
  }
  const password = checkPassword(input.password, { username, email: user.email });
  const passwordHash = await hashPassword(password);

  await inTransaction(db, async (tx) => {
    if (current) {
      await tx.query('UPDATE user_passwords SET password_hash = $2, updated_at = now() WHERE user_id = $1', [user.id, passwordHash]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
        user.id,
        sessionToken ? hashSessionToken(sessionToken) : '',
      ]);
    } else {
      await insertPassword(tx, user.id, username, passwordHash);
    }
  });
}

/**
 * Removes the signed-in user's password, when another method they hold stays usable (spec). Without
 * a password: {@link SignInItemNotFoundError}.
 */
export async function removeOwnPassword(db: TransactionalDb, userId: string, secretsAvailable: boolean): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rowCount } = await tx.query('DELETE FROM user_passwords WHERE user_id = $1', [userId]);
    if (!rowCount) throw new SignInItemNotFoundError('You have no password to remove');
    await assertUserKeepsSignIn(tx, userId, secretsAvailable);
  });
}
