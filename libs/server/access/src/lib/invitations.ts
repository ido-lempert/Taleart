import { randomBytes } from 'node:crypto';
import { INVITATION_TTL_MS, type InvitationPreview, type PasskeyCreationOptions, type User } from '@taleart/contract';
import type { StartedCeremony, SignedInUser } from './auth';
import { consumeChallenge, createChallenge } from './challenges';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { EmailTakenError, InvitationInvalidError, PasskeyFailedError } from './errors';
import { addProjectMember } from './members';
import type { PasskeyVerifier } from './passkey-verifier';
import { createSession } from './sessions';
import { hashToken, newToken } from './tokens';

/** A new invitation. `token` goes into the link once; only its hash is stored. */
export interface NewInvitation {
  id: string;
  projectId: string;
  token: string;
  expiresAt: Date;
}

/** A signed-in invitee and the project they joined. */
export interface JoinedProject extends SignedInUser {
  projectId: string;
}

export interface ValidInvitation {
  id: string;
  projectId: string;
  projectName: string;
  expiresAt: Date;
}

/**
 * Creates a one-time invitation to a project, valid for
 * {@link INVITATION_TTL_MS}. The caller checks that the project exists and
 * that the creator is an admin.
 */
export async function createInvitation(
  db: Db,
  input: { projectId: string; createdBy: string },
): Promise<NewInvitation> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO invitations (project_id, token_hash, created_by, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.projectId, hashToken(token), input.createdBy, expiresAt],
  );
  return { id: rows[0].id, projectId: input.projectId, token, expiresAt };
}

// The unused, unexpired invitation with this token, or InvitationInvalidError.
export async function validInvitation(db: Db, token: string | undefined): Promise<ValidInvitation> {
  if (!token) throw new InvitationInvalidError();
  const { rows } = await db.query<ValidInvitation>(
    `SELECT i.id, i.project_id AS "projectId", p.name AS "projectName", i.expires_at AS "expiresAt"
     FROM invitations i JOIN projects p ON p.id = i.project_id
     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );
  if (!rows[0]) throw new InvitationInvalidError();
  return rows[0];
}

/** What the invite page shows. Throws {@link InvitationInvalidError} when the link is unknown, used or expired. */
export async function previewInvitation(db: Db, token: string | undefined): Promise<InvitationPreview> {
  const invitation = await validInvitation(db, token);
  return { projectName: invitation.projectName, expiresAt: invitation.expiresAt.toISOString() };
}

export async function emailTaken(db: Db, email: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  return (rowCount ?? 0) > 0;
}

/**
 * Starts registering an invitee's passkey. Throws {@link InvitationInvalidError}
 * for a bad link and {@link EmailTakenError} for an email that has a user.
 */
export async function startInvitation(
  db: Db,
  verifier: PasskeyVerifier,
  token: string | undefined,
  input: { name: string; email: string },
): Promise<StartedCeremony<PasskeyCreationOptions>> {
  const invitation = await validInvitation(db, token);
  if (await emailTaken(db, input.email)) throw new EmailTakenError();
  const userHandle = randomBytes(32).toString('base64url');
  const options = await verifier.creationOptions({ userHandle, name: input.name, email: input.email });
  const { id, expiresAt } = await createChallenge(db, 'invitation', options.challenge, {
    name: input.name,
    email: input.email,
    userHandle,
    invitationId: invitation.id,
  });
  return { options, challengeId: id, expiresAt };
}

/**
 * Checks the invitee's passkey, then in one transaction (the invitation row
 * locked, so two people cannot redeem one link) creates the content manager,
 * their passkey, their membership of the project and a session, and marks the
 * invitation used.
 */
export async function finishInvitation(
  db: TransactionalDb,
  verifier: PasskeyVerifier,
  token: string | undefined,
  challengeId: string | undefined,
  response: unknown,
): Promise<JoinedProject> {
  const invitation = await validInvitation(db, token);
  const pending = await consumeChallenge(db, challengeId, 'invitation');
  if (!pending) throw new PasskeyFailedError('The request expired. Start again.');
  const { name, email, userHandle, invitationId } = pending.data as {
    name: string;
    email: string;
    userHandle: string;
    invitationId: string;
  };
  // A challenge started for another invitation does not redeem this one.
  if (invitationId !== invitation.id) throw new PasskeyFailedError();
  const passkey = await verifier.verifyRegistration(response, pending.challenge);

  try {
    return await inTransaction(db, async (tx) => {
      const locked = await tx.query<{ valid: boolean }>(
        'SELECT used_at IS NULL AND expires_at > now() AS valid FROM invitations WHERE id = $1 FOR UPDATE',
        [invitation.id],
      );
      if (!locked.rows[0]?.valid) throw new InvitationInvalidError();
      if (await emailTaken(tx, email)) throw new EmailTakenError();

      const { rows } = await tx.query<User>(
        `INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, 'content_manager', $3)
         RETURNING id, name, email, role`,
        [name, email, userHandle],
      );
      const user = rows[0];
      await tx.query(
        'INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports) VALUES ($1, $2, $3, $4, $5)',
        [user.id, passkey.credentialId, Buffer.from(passkey.publicKey), passkey.counter, passkey.transports],
      );
      await addProjectMember(tx, invitation.projectId, user.id);
      await tx.query('UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1', [invitation.id, user.id]);
      return { user, projectId: invitation.projectId, session: await createSession(tx, user.id) };
    });
  } catch (err) {
    // Unique violations that slipped past the checks above: the email or the passkey is already registered.
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'users_email_key') throw new EmailTakenError();
    if (pgError.code === '23505' && pgError.constraint === 'passkeys_credential_id_key') {
      throw new PasskeyFailedError('This passkey is already registered with TaleArt');
    }
    throw err;
  }
}
