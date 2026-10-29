import type { AuthProviderConfig, ProviderAuthErrorCode, User } from '@taleart/contract';
import { consumeChallenge } from './challenges';
import { createUser, setupRequired, SETUP_LOCK, type SignedInUser } from './auth';
import { inTransaction, type Db, type TransactionalDb } from './db';
import { emailTaken } from './invitations';
import { addProjectMember } from './members';
import { InputInvalidError, ProviderAuthError, ProviderNotFoundError } from './errors';
import {
  appleClientSecret,
  authorizationUrl,
  discover,
  exchangeCode,
  pkceChallenge,
  providerJwks,
  randomValue,
  sameSecret,
  verifyIdToken,
  type VerifiedIdentity,
} from './oidc';
import type { ProviderContext } from './providers';
import { decryptSecret } from './secrets';
import { providerMethodId, type ProviderKind } from './signInMethods';
import { createSession } from './sessions';
import { hashToken } from './tokens';

/** How long a provider sign-in may take from start to callback (spec: 10 min). */
export const OAUTH_TTL_MS = 10 * 60 * 1000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What a provider sign-in is for (spec: sign-in, setup, invitation:<token>, link:<userId>). The
 * invitation's email is the address the invitee gives when starting: the invitation stores none,
 * and the verified email must equal it.
 */
export type ProviderFlow =
  | { purpose: 'sign-in' }
  | { purpose: 'setup' }
  | { purpose: 'invitation'; token: string; email: string }
  | { purpose: 'link'; userId: string; sessionHash: string };

/** What a finished callback did: a session for the user, or a link attached to the signed-in user. */
export type ProviderLoginResult = { kind: 'signed-in'; signedIn: SignedInUser } | { kind: 'linked'; userId: string };

/** The result of the admin's Test button: discovery worked (its issuer and endpoints), or a short code. */
export type ProviderTestResult =
  | { ok: true; issuer: string; endpoints: { authorization: string; token: string; jwks: string } }
  | { ok: false; code: ProviderAuthErrorCode };

/** The state kept per sign-in in auth_challenges.data (the state itself is the row's challenge column). */
interface OAuthData {
  slug: string;
  flow: ProviderFlow['purpose'];
  issuer: string;
  tokenEndpoint: string;
  jwksUri: string;
  nonce: string;
  codeVerifier: string;
  email?: string;
  tokenHash?: string;
  userId?: string;
  /** The hash of the session the link was started from; the callback checks it still lives. */
  sessionHash?: string;
  /** The code a form_post callback (Apple) stored, taken once by the resumed GET. */
  pendingCode?: string;
}

interface ProviderRow {
  slug: string;
  kind: ProviderKind;
  enabled: boolean;
  config: AuthProviderConfig;
  secret_enc: Buffer | null;
}

const SELECT_PROVIDER = 'SELECT slug, kind, enabled, config, secret_enc FROM auth_providers WHERE slug = $1';

async function loadProvider(db: Db, slug: string): Promise<ProviderRow | null> {
  const { rows } = await db.query<ProviderRow>(SELECT_PROVIDER, [slug]);
  return rows[0] ?? null;
}

/** The issuer a provider is discovered from: the preset's, or the configured one. */
function issuerOf(row: ProviderRow, ctx: ProviderContext): string {
  if (row.kind === 'google') return ctx.presetIssuers?.google ?? 'https://accounts.google.com';
  if (row.kind === 'apple') return ctx.presetIssuers?.apple ?? 'https://appleid.apple.com';
  return row.config.issuer ?? '';
}

/** The redirect URI the provider sends the browser back to: `<PUBLIC_API_URL>/api/v1/auth/callback/<slug>`. */
export function redirectUriFor(ctx: ProviderContext, slug: string): string {
  return `${ctx.publicApiUrl.replace(/\/+$/, '')}/api/v1/auth/callback/${slug}`;
}

/**
 * The provider with its secret decrypted, when it is enabled, its secret is stored and the server
 * has the key. Anything else is the one generic refusal, so a caller learns nothing about the provider.
 */
async function usableProvider(db: Db, ctx: ProviderContext, slug: string): Promise<{ row: ProviderRow; secret: string }> {
  const row = await loadProvider(db, slug);
  if (!row || !row.enabled || row.secret_enc === null || ctx.secretKey === null) throw new ProviderAuthError('sign_in_failed');
  let secret: string;
  try {
    secret = decryptSecret(row.secret_enc, ctx.secretKey);
  } catch {
    throw new ProviderAuthError('sign_in_failed');
  }
  return { row, secret };
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Starts a provider sign-in: checks the provider and the flow, runs discovery, and stores the state,
 * nonce, PKCE verifier and flow for 10 minutes. Returns the URL the browser goes to and the challenge
 * id that the route sets in the `taleart_oauth` cookie.
 */
export async function startProviderLogin(
  db: Db,
  ctx: ProviderContext,
  slug: string,
  flow: ProviderFlow,
): Promise<{ authorizationUrl: string; challengeId: string; expiresAt: Date }> {
  const { row } = await usableProvider(db, ctx, slug);
  const endpoints = await discover(issuerOf(row, ctx), ctx.allowHttpIssuer);

  const data: OAuthData = {
    slug,
    flow: flow.purpose,
    issuer: endpoints.issuer,
    tokenEndpoint: endpoints.tokenEndpoint,
    jwksUri: endpoints.jwksUri,
    nonce: randomValue(),
    codeVerifier: randomValue(32),
  };
  if (flow.purpose === 'setup' && !(await setupRequired(db))) throw new ProviderAuthError('setup_closed');
  if (flow.purpose === 'invitation') {
    const { rowCount } = await db.query(
      'SELECT 1 FROM invitations WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()',
      [hashToken(flow.token)],
    );
    if (!rowCount) throw new ProviderAuthError('invitation_invalid');
    if (typeof flow.email !== 'string' || !EMAIL.test(flow.email)) throw new InputInvalidError('email is not valid');
    data.email = flow.email;
    data.tokenHash = hashToken(flow.token);
  }
  if (flow.purpose === 'link') {
    // The link is bound to the session the browser holds at the start; the callback does not read it.
    const { rowCount } = await db.query(
      'SELECT 1 FROM sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > now()',
      [flow.sessionHash, flow.userId],
    );
    if (!rowCount) throw new ProviderAuthError('session_required');
    data.userId = flow.userId;
    data.sessionHash = flow.sessionHash;
  }

  const state = randomValue();
  const scope = row.kind === 'apple' ? 'name email' : (row.config.scopes ?? 'openid email profile');
  const url = authorizationUrl({
    endpoint: endpoints.authorizationEndpoint,
    clientId: row.config.clientId ?? '',
    redirectUri: redirectUriFor(ctx, slug),
    scope,
    state,
    nonce: data.nonce,
    codeChallenge: pkceChallenge(data.codeVerifier),
    formPost: row.kind === 'apple',
  });

  await db.query('DELETE FROM auth_challenges WHERE expires_at <= now()');
  const expiresAt = new Date(Date.now() + OAUTH_TTL_MS);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO auth_challenges (kind, purpose, challenge, data, expires_at) VALUES ('oauth', 'oauth', $1, $2, $3) RETURNING id",
    [state, JSON.stringify(data), expiresAt],
  );
  return { authorizationUrl: url, challengeId: rows[0].id, expiresAt };
}

/**
 * Stores the code of a form_post callback (Apple) on the open challenge of its state, once. Nothing
 * else happens here: the GET that resumes the flow needs the `taleart_oauth` cookie, so a POST alone
 * never completes a login. False when no open challenge of this provider has that state, or it has a code.
 */
export async function recordProviderCallback(db: Db, input: { slug: string; state: string; code: string }): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE auth_challenges SET data = data || jsonb_build_object('pendingCode', $2::text)
     WHERE kind = 'oauth' AND purpose = 'oauth' AND challenge = $1 AND expires_at > now()
       AND data->>'slug' = $3 AND NOT (data ? 'pendingCode')`,
    [input.state, input.code, input.slug],
  );
  return (rowCount ?? 0) > 0;
}

async function identityExists(db: Db, provider: string, subject: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM user_identities WHERE provider = $1 AND subject = $2', [provider, subject]);
  return (rowCount ?? 0) > 0;
}

/** Attaches a provider identity to a user. A (provider, subject) already attached to anyone is refused. */
async function attachIdentity(db: Db, userId: string, provider: string, identity: VerifiedIdentity): Promise<void> {
  try {
    await db.query('INSERT INTO user_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)', [
      userId,
      provider,
      identity.subject,
      identity.emailVerified ? identity.email : null,
    ]);
  } catch (err) {
    const pgError = err as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'user_identities_provider_subject_key') {
      throw new ProviderAuthError('identity_in_use');
    }
    throw err;
  }
}

/** The name a new user gets from the provider: its name claim, else the verified email. */
const nameFor = (identity: VerifiedIdentity): string => identity.name ?? identity.email ?? identity.subject;

/**
 * Finishes a provider sign-in. The challenge is taken once (whatever happens); the cookie's
 * challenge and the state must match, the provider must still be usable, the code is exchanged and
 * the ID token verified. Then the flow decides:
 * - `sign-in`: the (provider, subject) identity must already exist; then a session for its user.
 * - `setup`: no user may exist (the setup lock), the email must be verified; creates the first admin.
 * - `invitation`: the invitation must be valid (locked), the verified email must equal the invitation's
 *   email, the email and the identity must be new; creates the content manager and the membership.
 * - `link`: the signed-in user (the session) must be the one who started it; the identity is attached.
 * Every refusal is a {@link ProviderAuthError} with a short code.
 */
export async function completeProviderLogin(
  db: TransactionalDb,
  ctx: ProviderContext,
  input: { slug: string; cookieId: string | undefined; code: unknown; state: unknown; resume: boolean },
): Promise<ProviderLoginResult> {
  const pending = await consumeChallenge(db, input.cookieId, 'oauth');
  if (!pending) throw new ProviderAuthError('sign_in_failed');
  const data = pending.data as unknown as OAuthData;
  if (data.slug !== input.slug) throw new ProviderAuthError('sign_in_failed');
  if (typeof input.state !== 'string' || !sameSecret(pending.challenge, input.state)) throw new ProviderAuthError('sign_in_failed');
  // A resumed callback takes the code its form POST stored; a code in the query is never read then.
  const code = input.resume ? data.pendingCode : input.code;
  if (typeof code !== 'string' || code.length === 0 || code.length > 2048) throw new ProviderAuthError('sign_in_failed');

  const { row, secret } = await usableProvider(db, ctx, input.slug);
  if (data.flow === 'link') {
    // The session the link was started from must still be live, and belong to the same user.
    const { rowCount } = await db.query(
      'SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.user_id = $2 AND s.expires_at > now()',
      [data.sessionHash ?? '', data.userId ?? ''],
    );
    if (!rowCount) throw new ProviderAuthError('session_required');
  }

  let clientSecret = secret;
  if (row.kind === 'apple') {
    try {
      clientSecret = await appleClientSecret({
        teamId: row.config.teamId ?? '',
        keyId: row.config.keyId ?? '',
        clientId: row.config.clientId ?? '',
        privateKeyPem: secret,
      });
    } catch {
      throw new ProviderAuthError('sign_in_failed');
    }
  }
  const idToken = await exchangeCode({
    tokenEndpoint: data.tokenEndpoint,
    code,
    redirectUri: redirectUriFor(ctx, input.slug),
    clientId: row.config.clientId ?? '',
    clientSecret,
    codeVerifier: data.codeVerifier,
    allowHttp: ctx.allowHttpIssuer,
  });
  const identity = await verifyIdToken(idToken, {
    jwks: providerJwks(data.jwksUri, ctx.allowHttpIssuer),
    issuer: data.issuer,
    clientId: row.config.clientId ?? '',
    nonce: data.nonce,
  });
  const provider = providerMethodId(input.slug);

  if (data.flow === 'sign-in') {
    const { rows } = await db.query<User>(
      `SELECT u.id, u.name, u.email, u.role FROM user_identities i JOIN users u ON u.id = i.user_id
       WHERE i.provider = $1 AND i.subject = $2`,
      [provider, identity.subject],
    );
    const user = rows[0];
    if (!user) throw new ProviderAuthError('sign_in_failed');
    await db.query('UPDATE user_identities SET last_used_at = now() WHERE provider = $1 AND subject = $2', [provider, identity.subject]);
    return { kind: 'signed-in', signedIn: { user, session: await createSession(db, user.id) } };
  }

  if (data.flow === 'link') {
    const userId = data.userId as string;
    await inTransaction(db, async (tx) => {
      await attachIdentity(tx, userId, provider, identity);
    });
    return { kind: 'linked', userId };
  }

  if (!identity.emailVerified || identity.email === null) throw new ProviderAuthError('email_not_verified');

  if (data.flow === 'setup') {
    const signedIn = await inTransaction(db, async (tx) => {
      await tx.query(SETUP_LOCK);
      if (!(await setupRequired(tx))) throw new ProviderAuthError('setup_closed');
      const user = await createUser(tx, { name: nameFor(identity), email: identity.email as string, role: 'admin' });
      await attachIdentity(tx, user.id, provider, identity);
      return { user, session: await createSession(tx, user.id) };
    });
    return { kind: 'signed-in', signedIn };
  }

  // invitation: the verified email must be the invitation's, and the link must still be good.
  if (data.email === undefined || data.tokenHash === undefined || !sameEmail(identity.email, data.email)) {
    throw new ProviderAuthError('email_mismatch');
  }
  const tokenHash = data.tokenHash;
  const signedIn = await inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; projectId: string }>(
      `SELECT id, project_id AS "projectId" FROM invitations
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenHash],
    );
    const invitation = rows[0];
    if (!invitation) throw new ProviderAuthError('invitation_invalid');
    if (await emailTaken(tx, identity.email as string)) throw new ProviderAuthError('email_taken');
    if (await identityExists(tx, provider, identity.subject)) throw new ProviderAuthError('identity_in_use');
    const user = await createUser(tx, { name: nameFor(identity), email: identity.email as string, role: 'content_manager' });
    await attachIdentity(tx, user.id, provider, identity);
    await addProjectMember(tx, invitation.projectId, user.id);
    await tx.query('UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1', [invitation.id, user.id]);
    return { user, session: await createSession(tx, user.id) };
  });
  return { kind: 'signed-in', signedIn };
}

/**
 * The admin's Test button: discovery for the provider's issuer, with the issuer and endpoints it
 * gives, or the short code of the failure. The secret is not needed, and not read.
 */
export async function testProvider(db: Db, ctx: ProviderContext, slug: string): Promise<ProviderTestResult> {
  const row = await loadProvider(db, slug);
  if (!row) throw new ProviderNotFoundError();
  try {
    const endpoints = await discover(issuerOf(row, ctx), ctx.allowHttpIssuer);
    return {
      ok: true,
      issuer: endpoints.issuer,
      endpoints: { authorization: endpoints.authorizationEndpoint, token: endpoints.tokenEndpoint, jwks: endpoints.jwksUri },
    };
  } catch (err) {
    return { ok: false, code: err instanceof ProviderAuthError ? err.authCode : 'discovery_failed' };
  }
}
