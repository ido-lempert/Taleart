import { randomBytes } from 'node:crypto';
import type { PasskeyCreationOptions, PasskeyRequestOptions, User, UserRole } from '@taleart/contract';
import { consumeChallenge, createChallenge } from './challenges';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { PasskeyFailedError, SetupClosedError } from './errors';
import type { PasskeyVerifier, StoredPasskey } from './passkey-verifier';
import { createSession, type NewSession } from './sessions';

// Key of the transaction-scoped advisory lock that serializes setup.
const SETUP_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('access:setup', 0))";

/** True while no user exists: the install still needs its first admin. */
export async function setupRequired(db: Db): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM users LIMIT 1');
  return (rowCount ?? 0) === 0;
}

/** Creates a user without a passkey. Setup and (later) invitations add the passkey. */
export async function createUser(db: Db, input: { name: string; email: string; role: UserRole }): Promise<User> {
  const { rows } = await db.query<User>(
    'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [input.name, input.email, input.role, randomBytes(32).toString('base64url')],
  );
  return rows[0];
}

/** A started passkey ceremony: options for the browser and the challenge id for its cookie. */
export interface StartedCeremony<T> {
  options: T;
  challengeId: string;
  expiresAt: Date;
}

/** A finished sign-in or setup: the user and their new session. */
export interface SignedInUser {
  user: User;
  session: NewSession;
}

/** Starts registering the first admin's passkey. Throws {@link SetupClosedError} once a user exists. */
export async function startSetup(
  db: Db,
  verifier: PasskeyVerifier,
  input: { name: string; email: string },
): Promise<StartedCeremony<PasskeyCreationOptions>> {
  if (!(await setupRequired(db))) throw new SetupClosedError();
  const userHandle = randomBytes(32).toString('base64url');
  const options = await verifier.creationOptions({ userHandle, name: input.name, email: input.email });
  const { id, expiresAt } = await createChallenge(db, 'setup', options.challenge, {
    name: input.name,
    email: input.email,
    userHandle,
  });
  return { options, challengeId: id, expiresAt };
}

/**
 * Checks the first admin's passkey and creates the admin, the passkey and a
 * session. Setup is serialized by an advisory lock, so of two racing setups
 * only one creates a user; the other gets {@link SetupClosedError}.
 */
export async function finishSetup(
  db: TransactionalDb,
  verifier: PasskeyVerifier,
  challengeId: string | undefined,
  response: unknown,
): Promise<SignedInUser> {
  if (!(await setupRequired(db))) throw new SetupClosedError();
  const pending = await consumeChallenge(db, challengeId, 'setup');
  if (!pending) throw new PasskeyFailedError('The setup request expired. Start again.');
  const passkey = await verifier.verifyRegistration(response, pending.challenge);
  const { name, email, userHandle } = pending.data as { name: string; email: string; userHandle: string };

  return inTransaction(db, async (tx) => {
    await tx.query(SETUP_LOCK);
    if (!(await setupRequired(tx))) throw new SetupClosedError();
    const { rows } = await tx.query<User>(
      `INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, 'admin', $3)
       RETURNING id, name, email, role`,
      [name, email, userHandle],
    );
    const user = rows[0];
    await tx.query(
      'INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5)',
      [user.id, passkey.credentialId, Buffer.from(passkey.publicKey), passkey.counter, passkey.transports],
    );
    return { user, session: await createSession(tx, user.id) };
  });
}

/** Starts a passkey sign-in. No email is needed: the passkey is discoverable. */
export async function startSignIn(db: Db, verifier: PasskeyVerifier): Promise<StartedCeremony<PasskeyRequestOptions>> {
  const options = await verifier.requestOptions();
  const { id, expiresAt } = await createChallenge(db, 'sign-in', options.challenge);
  return { options, challengeId: id, expiresAt };
}

interface PasskeyRow {
  id: string;
  user_id: string;
  webauthn_user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string;
  transports: string[];
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Checks a sign-in with a stored passkey, including its signature counter,
 * stores the new counter and starts a session. Any failure throws
 * {@link PasskeyFailedError}.
 */
export async function finishSignIn(
  db: Db,
  verifier: PasskeyVerifier,
  challengeId: string | undefined,
  response: unknown,
): Promise<SignedInUser> {
  const pending = await consumeChallenge(db, challengeId, 'sign-in');
  if (!pending) throw new PasskeyFailedError('The sign-in request expired. Try again.');

  const credentialId = field(response, 'id');
  if (typeof credentialId !== 'string' || !credentialId) throw new PasskeyFailedError();
  const { rows } = await db.query<PasskeyRow>(
    `SELECT p.id, p.user_id, u.webauthn_user_id, p.credential_id, p.public_key, p.counter, p.transports
     FROM passkeys p JOIN users u ON u.id = p.user_id
     WHERE p.credential_id = $1`,
    [credentialId],
  );
  const row = rows[0];
  if (!row) throw new PasskeyFailedError('This passkey is not registered with TaleArt');

  // A discoverable passkey reports the user handle it was created for; it must be this user's.
  const userHandle = field(field(response, 'response'), 'userHandle');
  if (userHandle !== undefined && userHandle !== null && userHandle !== row.webauthn_user_id) {
    throw new PasskeyFailedError();
  }

  const stored: StoredPasskey = {
    credentialId: row.credential_id,
    publicKey: Uint8Array.from(row.public_key),
    counter: Number(row.counter),
    transports: row.transports,
  };
  const newCounter = await verifier.verifyAuthentication(response, pending.challenge, stored);
  // A counter that does not grow means a cloned authenticator; zero on both sides means none is kept.
  if ((newCounter > 0 || stored.counter > 0) && newCounter <= stored.counter) {
    throw new PasskeyFailedError('The passkey signature counter did not increase');
  }
  await db.query('UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [row.id, newCounter]);

  const user = await db.query<User>('SELECT id, name, email, role FROM users WHERE id = $1', [row.user_id]);
  return { user: user.rows[0], session: await createSession(db, row.user_id) };
}
