import type { Appearance, User } from '@taleart/contract';
import type { Db } from './db';

/**
 * Stores the dashboard appearance the user chose (dashboard dark mode): `system` follows the device,
 * `light` and `dark` are explicit. The only writer of `users.appearance`; the value is checked by the
 * caller and again by the table's CHECK. Resolves to the user as now stored, or null when no user has
 * this id.
 */
export async function setAppearance(db: Db, userId: string, appearance: Appearance): Promise<User | null> {
  const { rows } = await db.query<User>(
    `UPDATE users SET appearance = $2 WHERE id = $1
     RETURNING id, name, email, role, appearance`,
    [userId, appearance],
  );
  return rows[0] ?? null;
}
