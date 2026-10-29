import type { Db } from './db';

/** How long a WebAuthn challenge can be answered. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChallengePurpose = 'setup' | 'sign-in' | 'invitation' | 'oauth';

/** A pending challenge, with what the flow stored next to it. */
export interface PendingChallenge {
  challenge: string;
  data: Record<string, unknown>;
}

/** Stores a challenge for 5 minutes; resolves to its id, which the browser keeps in an http-only cookie. */
export async function createChallenge(
  db: Db,
  purpose: ChallengePurpose,
  challenge: string,
  data: Record<string, unknown> = {},
): Promise<{ id: string; expiresAt: Date }> {
  await db.query('DELETE FROM auth_challenges WHERE expires_at <= now()');
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO auth_challenges (purpose, challenge, data, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [purpose, challenge, JSON.stringify(data), expiresAt],
  );
  return { id: rows[0].id, expiresAt };
}

/**
 * Takes the challenge with this id and purpose, once: it is deleted whether or
 * not it is still valid. Null when it is unknown, used, of another purpose or expired.
 */
export async function consumeChallenge(
  db: Db,
  id: string | undefined,
  purpose: ChallengePurpose,
): Promise<PendingChallenge | null> {
  if (!id || !UUID.test(id)) return null;
  const { rows } = await db.query<{ purpose: string; challenge: string; data: Record<string, unknown>; valid: boolean }>(
    'DELETE FROM auth_challenges WHERE id = $1 RETURNING purpose, challenge, data, expires_at > now() AS valid',
    [id],
  );
  const row = rows[0];
  if (!row || row.purpose !== purpose || !row.valid) return null;
  return { challenge: row.challenge, data: row.data };
}
