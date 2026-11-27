import { randomBytes } from 'node:crypto';
import type { User } from '@taleart/contract';
import type { SignedInUser } from './auth';
import { createChallenge } from './challenges';
import { inTransaction, type Db, type TransactionalDb } from './db';
import {
  SignInThrottledError,
  TwoFactorChallengeInvalidError,
  TwoFactorCodeInvalidError,
  TwoFactorEnrolledError,
  TwoFactorNotStartedError,
  TwoFactorOffError,
  TwoFactorUnavailableError,
} from './errors';
import { consumeRecoveryCode, replaceRecoveryCodes } from './recoveryCodes';
import { decryptSecret, encryptSecret } from './secrets';
import { signInSettings } from './signInMethods';
import { createSession } from './sessions';
import type { PasswordThrottle } from './throttle';
import { base32Encode, matchTotp, newTotpSecret, otpauthUri } from './totp';

/** The name an authenticator app shows beside the account. */
export const TOTP_ISSUER = 'TaleArt';

/** Wrong codes one second step allows before the user must sign in again. */
export const SECOND_STEP_MAX_ATTEMPTS = 5;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a user adds to an authenticator app: the key to type, and the address a QR code carries. */
export interface TotpEnrolment {
  secret: string;
  otpauthUri: string;
}

/** A sign-in that has the right password and now waits for the code; the browser keeps `id` in a cookie. */
export interface SecondStepStarted {
  id: string;
  expiresAt: Date;
}

/** Whether the user has finished setting up an authenticator app. */
export async function totpEnrolled(db: Db, userId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM user_totp WHERE user_id = $1 AND enrolled_at IS NOT NULL', [userId]);
  return (rowCount ?? 0) > 0;
}

/**
 * Starts (or restarts) setting up an authenticator app: a new secret, kept encrypted and not yet in force. The user
 * proves they have it by sending a current code to {@link confirmTotpEnrolment}. Throws {@link TwoFactorOffError} while
 * the install's two-factor mode is off (nobody starts an app then), {@link TwoFactorUnavailableError} without the
 * secret key, and {@link TwoFactorEnrolledError} when an app is already set up.
 */
export async function startTotpEnrolment(
  db: TransactionalDb,
  key: Buffer | null,
  user: Pick<User, 'id' | 'email'>,
): Promise<TotpEnrolment> {
  if ((await signInSettings(db)).twoFactorMode === 'off') throw new TwoFactorOffError();
  if (!key) throw new TwoFactorUnavailableError();
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ enrolledAt: Date | null }>(
      'SELECT enrolled_at AS "enrolledAt" FROM user_totp WHERE user_id = $1 FOR UPDATE',
      [user.id],
    );
    if (rows[0]?.enrolledAt) throw new TwoFactorEnrolledError();
    const secret = newTotpSecret();
    await tx.query(
      `INSERT INTO user_totp (user_id, secret_enc) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, created_at = now()`,
      [user.id, encryptSecret(secret.toString('base64'), key)],
    );
    return { secret: base32Encode(secret), otpauthUri: otpauthUri({ secret, account: user.email, issuer: TOTP_ISSUER }) };
  });
}

type ConfirmOutcome = { kind: 'done'; recoveryCodes: string[] } | { kind: 'not-started' | 'enrolled' | 'wrong' };

/**
 * Finishes setup with a current code from the app, and returns the user's new recovery codes (shown once). Throws
 * {@link TwoFactorNotStartedError} when setup was never started, {@link TwoFactorEnrolledError} when it is already
 * finished, and {@link TwoFactorCodeInvalidError} for a wrong code.
 */
export async function confirmTotpEnrolment(
  db: TransactionalDb,
  key: Buffer | null,
  userId: string,
  code: string,
  nowMs: number = Date.now(),
): Promise<string[]> {
  if (!key) throw new TwoFactorUnavailableError();
  const outcome = await inTransaction<ConfirmOutcome>(db, async (tx) => {
    const { rows } = await tx.query<{ secretEnc: Buffer; enrolledAt: Date | null }>(
      'SELECT secret_enc AS "secretEnc", enrolled_at AS "enrolledAt" FROM user_totp WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    const row = rows[0];
    if (!row) return { kind: 'not-started' as const };
    if (row.enrolledAt) return { kind: 'enrolled' as const };
    const step = matchTotp(Buffer.from(decryptSecret(row.secretEnc, key), 'base64'), code, nowMs);
    if (step === null) return { kind: 'wrong' as const };
    await tx.query('UPDATE user_totp SET enrolled_at = now(), last_step = $2 WHERE user_id = $1', [userId, step]);
    return { kind: 'done' as const, recoveryCodes: await replaceRecoveryCodes(tx, userId) };
  });
  if (outcome.kind === 'done') return outcome.recoveryCodes;
  if (outcome.kind === 'not-started') throw new TwoFactorNotStartedError();
  if (outcome.kind === 'enrolled') throw new TwoFactorEnrolledError();
  throw new TwoFactorCodeInvalidError();
}

/**
 * Makes new recovery codes for a user whose authenticator app is on; the old ones stop working. Throws
 * {@link TwoFactorNotStartedError} when no app is on.
 */
export async function regenerateRecoveryCodes(db: TransactionalDb, userId: string): Promise<string[]> {
  const outcome = await inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ enrolledAt: Date | null }>(
      'SELECT enrolled_at AS "enrolledAt" FROM user_totp WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    if (!rows[0]?.enrolledAt) return null;
    return replaceRecoveryCodes(tx, userId);
  });
  if (!outcome) throw new TwoFactorNotStartedError();
  return outcome;
}

/**
 * Parks a sign-in whose password was right until the user sends a code. `throttleKey` is the username key the
 * password throttle counts under, so wrong codes count against the same username.
 */
export async function beginSecondStep(db: Db, userId: string, throttleKey: string): Promise<SecondStepStarted> {
  const { id, expiresAt } = await createChallenge(db, 'second-step', randomBytes(16).toString('base64url'), {
    userId,
    throttleKey,
    attempts: 0,
  });
  return { id, expiresAt };
}

type Outcome =
  | { kind: 'signed-in'; signedIn: SignedInUser; throttleKey: string }
  | { kind: 'wrong'; throttleKey: string }
  | { kind: 'throttled'; waitMs: number }
  | { kind: 'invalid' };

/**
 * Finishes a sign-in with the code from the authenticator app, or with one of the user's recovery codes (any input
 * that is not six digits). A wrong code counts toward the username's throttle and toward the second step's own
 * {@link SECOND_STEP_MAX_ATTEMPTS}; a code that was accepted once never works again, and a recovery code is spent by
 * its use. The session exists only after a right code.
 */
export async function finishSecondStep(
  db: TransactionalDb,
  key: Buffer | null,
  throttle: PasswordThrottle,
  challengeId: string | undefined,
  code: string,
  nowMs: number = Date.now(),
): Promise<SignedInUser> {
  if (!challengeId || !UUID.test(challengeId)) throw new TwoFactorChallengeInvalidError();
  const outcome = await inTransaction<Outcome>(db, async (tx) => {
    const found = await tx.query<{ data: { userId: string; throttleKey: string; attempts: number }; valid: boolean }>(
      `SELECT data, expires_at > now() AS valid FROM auth_challenges
       WHERE id = $1 AND purpose = 'second-step' FOR UPDATE`,
      [challengeId],
    );
    const challenge = found.rows[0];
    if (!challenge) return { kind: 'invalid' };
    if (!challenge.valid) {
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      return { kind: 'invalid' };
    }
    const { userId, throttleKey, attempts } = challenge.data;
    const wait = throttle.waitMs(throttleKey);
    if (wait > 0) return { kind: 'throttled', waitMs: wait };

    const totp = await tx.query<{ secretEnc: Buffer; lastStep: string | null }>(
      `SELECT secret_enc AS "secretEnc", last_step AS "lastStep" FROM user_totp
       WHERE user_id = $1 AND enrolled_at IS NOT NULL FOR UPDATE`,
      [userId],
    );
    if (!totp.rows[0]) {
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      return { kind: 'invalid' };
    }

    // Six digits are an app code; anything else is tried as a recovery code.
    const isAppCode = /^\d{6}$/.test(code.replace(/\s+/g, ''));
    let step: number | null = null;
    let accepted = false;
    if (isAppCode) {
      if (key) {
        try {
          const secret = Buffer.from(decryptSecret(totp.rows[0].secretEnc, key), 'base64');
          const last = totp.rows[0].lastStep;
          step = matchTotp(secret, code, nowMs, last === null ? null : Number(last));
        } catch {
          // A secret that cannot be read (the key changed) never matches.
          step = null;
        }
      }
      accepted = step !== null;
    } else {
      accepted = await consumeRecoveryCode(tx, userId, code);
    }

    if (accepted) {
      if (step !== null) await tx.query('UPDATE user_totp SET last_step = $2 WHERE user_id = $1', [userId, step]);
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      const users = await tx.query<User>('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
      if (!users.rows[0]) return { kind: 'invalid' };
      return {
        kind: 'signed-in',
        signedIn: { user: users.rows[0], session: await createSession(tx, userId) },
        throttleKey,
      };
    }

    if (attempts + 1 >= SECOND_STEP_MAX_ATTEMPTS) {
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
    } else {
      await tx.query(`UPDATE auth_challenges SET data = jsonb_set(data, '{attempts}', to_jsonb($2::int)) WHERE id = $1`, [
        challengeId,
        attempts + 1,
      ]);
    }
    return { kind: 'wrong', throttleKey };
  });

  if (outcome.kind === 'throttled') throw new SignInThrottledError(Math.ceil(outcome.waitMs / 1000));
  if (outcome.kind === 'invalid') throw new TwoFactorChallengeInvalidError();
  if (outcome.kind === 'wrong') {
    throttle.failed(outcome.throttleKey);
    throw new TwoFactorCodeInvalidError();
  }
  throttle.succeeded(outcome.throttleKey);
  return outcome.signedIn;
}

/**
 * Parks a required sign-in whose password was right, for a user with no authenticator app yet: the browser's challenge
 * cookie leads to the enrolment steps ({@link startEnrolStep}, {@link finishEnrolStep}). No session exists until the
 * app is on.
 */
export async function beginEnrolStep(db: Db, userId: string, throttleKey: string): Promise<SecondStepStarted> {
  const { id, expiresAt } = await createChallenge(db, 'enrol-step', randomBytes(16).toString('base64url'), {
    userId,
    throttleKey,
    attempts: 0,
  });
  return { id, expiresAt };
}

// The user of a live enrolment challenge; a missing, expired or unknown one is the challenge refusal.
async function enrolChallengeUser(db: Db, challengeId: string | undefined): Promise<string> {
  if (!challengeId || !UUID.test(challengeId)) throw new TwoFactorChallengeInvalidError();
  const { rows } = await db.query<{ data: { userId: string }; valid: boolean }>(
    `SELECT data, expires_at > now() AS valid FROM auth_challenges WHERE id = $1 AND purpose = 'enrol-step'`,
    [challengeId],
  );
  if (!rows[0] || !rows[0].valid) throw new TwoFactorChallengeInvalidError();
  return rows[0].data.userId;
}

/**
 * Starts (or restarts) the authenticator app of the user a required sign-in is for, from its enrolment challenge. The
 * secret is not in force until {@link finishEnrolStep} accepts a code.
 */
export async function startEnrolStep(
  db: TransactionalDb,
  key: Buffer | null,
  challengeId: string | undefined,
): Promise<TotpEnrolment> {
  const userId = await enrolChallengeUser(db, challengeId);
  const { rows } = await db.query<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new TwoFactorChallengeInvalidError();
  return startTotpEnrolment(db, key, rows[0]);
}

type EnrolOutcome =
  | { kind: 'signed-in'; signedIn: SignedInUser; recoveryCodes: string[]; throttleKey: string }
  | { kind: 'wrong'; throttleKey: string }
  | { kind: 'throttled'; waitMs: number }
  | { kind: 'not-started' }
  | { kind: 'invalid' };

/**
 * Finishes a required sign-in: a right code from the app being set up turns it on, makes the user's recovery codes,
 * ends the challenge and makes the session. A wrong code counts toward the username's throttle and toward
 * {@link SECOND_STEP_MAX_ATTEMPTS}. Throws {@link TwoFactorNotStartedError} when the app was never started.
 */
export async function finishEnrolStep(
  db: TransactionalDb,
  key: Buffer | null,
  throttle: PasswordThrottle,
  challengeId: string | undefined,
  code: string,
  nowMs: number = Date.now(),
): Promise<{ signedIn: SignedInUser; recoveryCodes: string[] }> {
  if (!challengeId || !UUID.test(challengeId)) throw new TwoFactorChallengeInvalidError();
  if (!key) throw new TwoFactorUnavailableError();
  const outcome = await inTransaction<EnrolOutcome>(db, async (tx) => {
    const found = await tx.query<{ data: { userId: string; throttleKey: string; attempts: number }; valid: boolean }>(
      `SELECT data, expires_at > now() AS valid FROM auth_challenges
       WHERE id = $1 AND purpose = 'enrol-step' FOR UPDATE`,
      [challengeId],
    );
    const challenge = found.rows[0];
    if (!challenge) return { kind: 'invalid' };
    if (!challenge.valid) {
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      return { kind: 'invalid' };
    }
    const { userId, throttleKey, attempts } = challenge.data;
    const wait = throttle.waitMs(throttleKey);
    if (wait > 0) return { kind: 'throttled', waitMs: wait };

    const totp = await tx.query<{ secretEnc: Buffer; enrolledAt: Date | null }>(
      'SELECT secret_enc AS "secretEnc", enrolled_at AS "enrolledAt" FROM user_totp WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    if (!totp.rows[0]) return { kind: 'not-started' };
    if (totp.rows[0].enrolledAt) {
      // Set up in another sign-in meanwhile: this challenge has nothing left to do.
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      return { kind: 'invalid' };
    }

    let step: number | null = null;
    try {
      const secret = Buffer.from(decryptSecret(totp.rows[0].secretEnc, key), 'base64');
      step = matchTotp(secret, code, nowMs);
    } catch {
      // A secret that cannot be read (the key changed) never matches.
      step = null;
    }

    if (step !== null) {
      await tx.query('UPDATE user_totp SET enrolled_at = now(), last_step = $2 WHERE user_id = $1', [userId, step]);
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
      const users = await tx.query<User>('SELECT id, name, email, role FROM users WHERE id = $1', [userId]);
      if (!users.rows[0]) return { kind: 'invalid' };
      const recoveryCodes = await replaceRecoveryCodes(tx, userId);
      return {
        kind: 'signed-in',
        signedIn: { user: users.rows[0], session: await createSession(tx, userId) },
        recoveryCodes,
        throttleKey,
      };
    }

    if (attempts + 1 >= SECOND_STEP_MAX_ATTEMPTS) {
      await tx.query('DELETE FROM auth_challenges WHERE id = $1', [challengeId]);
    } else {
      await tx.query(`UPDATE auth_challenges SET data = jsonb_set(data, '{attempts}', to_jsonb($2::int)) WHERE id = $1`, [
        challengeId,
        attempts + 1,
      ]);
    }
    return { kind: 'wrong', throttleKey };
  });

  if (outcome.kind === 'throttled') throw new SignInThrottledError(Math.ceil(outcome.waitMs / 1000));
  if (outcome.kind === 'not-started') throw new TwoFactorNotStartedError();
  if (outcome.kind === 'invalid') throw new TwoFactorChallengeInvalidError();
  if (outcome.kind === 'wrong') {
    throttle.failed(outcome.throttleKey);
    throw new TwoFactorCodeInvalidError();
  }
  throttle.succeeded(outcome.throttleKey);
  return { signedIn: outcome.signedIn, recoveryCodes: outcome.recoveryCodes };
}
