import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';
import { base32Encode } from './totp';

/** Recovery codes a user gets when an authenticator app is turned on, or made anew. */
export const RECOVERY_CODE_COUNT = 10;

/** Characters in one recovery code, before the dash that splits it in two. */
const RECOVERY_CODE_LENGTH = 10;

/**
 * Ten new recovery codes, each shown as `xxxxx-xxxxx` in lowercase. A code is 50 random bits from the base32 alphabet,
 * so the stored hash needs no slow hash to resist guessing.
 */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, RECOVERY_CODE_LENGTH).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** What the user typed, reduced to the form that is hashed: no spaces or dashes, lowercase. */
function normaliseRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toLowerCase();
}

function hashRecoveryCode(input: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(input)).digest('hex');
}

/**
 * Replaces the user's recovery codes with ten new ones and returns them in plain form, the only time they exist
 * unhashed. Run it inside the transaction that changes the authenticator app, so the old codes go with the change.
 */
export async function replaceRecoveryCodes(tx: Db, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
  await tx.query('INSERT INTO user_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])', [
    userId,
    codes.map(hashRecoveryCode),
  ]);
  return codes;
}

/**
 * Spends a recovery code: true when it was unused and belonged to the user, and it is now used. A used or unknown
 * code gives false and changes nothing.
 */
export async function consumeRecoveryCode(tx: Db, userId: string, input: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    'UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
    [userId, hashRecoveryCode(input)],
  );
  return (rowCount ?? 0) > 0;
}

/** How many of the user's recovery codes are still unused. */
export async function recoveryCodesLeft(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query<{ left: number }>(
    'SELECT count(*)::int AS left FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  return rows[0]?.left ?? 0;
}
