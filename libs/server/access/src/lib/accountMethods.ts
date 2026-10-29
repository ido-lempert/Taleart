import type { AccountMethods } from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { SignInItemNotFoundError } from './errors';
import { assertUserKeepsSignIn, SIGN_IN_LOCK } from './signInMethods';

/** The signed-in user's passkeys, password (its username, never the password) and linked identities. */
export async function accountMethods(db: Db, userId: string): Promise<AccountMethods> {
  const [passkeys, password, identities] = await Promise.all([
    db.query<{ id: string; createdAt: Date; lastUsedAt: Date | null }>(
      'SELECT id, created_at AS "createdAt", last_used_at AS "lastUsedAt" FROM passkeys WHERE user_id = $1 ORDER BY created_at',
      [userId],
    ),
    db.query<{ username: string; updatedAt: Date }>(
      'SELECT username, updated_at AS "updatedAt" FROM user_passwords WHERE user_id = $1',
      [userId],
    ),
    db.query<{ id: string; provider: string; email: string | null; createdAt: Date; lastUsedAt: Date | null }>(
      `SELECT id, provider, email, created_at AS "createdAt", last_used_at AS "lastUsedAt"
       FROM user_identities WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
  ]);
  const iso = (value: Date | null) => (value === null ? null : value.toISOString());
  const first = password.rows[0];
  return {
    passkeys: passkeys.rows.map((row) => ({ id: row.id, createdAt: iso(row.createdAt) ?? '', lastUsedAt: iso(row.lastUsedAt) })),
    password: first ? { username: first.username, updatedAt: first.updatedAt.toISOString() } : null,
    identities: identities.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      email: row.email,
      createdAt: iso(row.createdAt) ?? '',
      lastUsedAt: iso(row.lastUsedAt),
    })),
  };
}

/**
 * Removes one of the user's passkeys when another method they hold stays usable (spec). Another
 * user's passkey, or an unknown id, is {@link SignInItemNotFoundError}.
 */
export async function removeOwnPasskey(db: TransactionalDb, userId: string, passkeyId: string, secretsAvailable: boolean): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rowCount } = await tx.query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2', [passkeyId, userId]);
    if (!rowCount) throw new SignInItemNotFoundError('You have no passkey with this id');
    await assertUserKeepsSignIn(tx, userId, secretsAvailable);
  });
}

/**
 * Unlinks one of the user's provider identities when another method they hold stays usable (spec).
 * Another user's identity, or an unknown id, is {@link SignInItemNotFoundError}.
 */
export async function removeOwnIdentity(db: TransactionalDb, userId: string, identityId: string, secretsAvailable: boolean): Promise<void> {
  await inTransaction(db, async (tx) => {
    await tx.query(SIGN_IN_LOCK);
    const { rowCount } = await tx.query('DELETE FROM user_identities WHERE id = $1 AND user_id = $2', [identityId, userId]);
    if (!rowCount) throw new SignInItemNotFoundError('You have no linked sign-in method with this id');
    await assertUserKeepsSignIn(tx, userId, secretsAvailable);
  });
}
