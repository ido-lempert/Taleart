import {
  CHALLENGE_COOKIE,
  ErrorCodes,
  passwordResetPath,
  SESSION_COOKIE,
  type AccountMethods,
  type AuthProvider,
  type AuthSettings,
  type EnrolConfirmResponse,
  type EnrolmentRequired,
  type PasswordResetLink,
  type PasswordResetPreview,
  type RecoveryCodes,
  type SaveAuthProviderRequest,
  type SecondStepRequired,
  type ConfirmTwoFactorResponse,
  type TwoFactorMode,
  type SignedIn,
  type TwoFactorEnrolment,
  type TwoFactorStatus,
  type UpdateAuthSettingsRequest,
  type User,
} from '@taleart/contract';
import {
  accountMethods,
  CHALLENGE_TTL_MS,
  confirmTotpEnrolment,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  deleteProvider,
  finishEnrolStep,
  finishSecondStep,
  findSessionUser,
  issuePasswordReset,
  listProviders,
  PasswordThrottle,
  previewPasswordReset,
  redeemInvitationWithPassword,
  redeemPasswordReset,
  removeOwnIdentity,
  removeOwnPasskey,
  removeOwnPassword,
  saveProvider,
  setOwnPassword,
  setSignInSettings,
  setupWithPassword,
  signInSettings,
  signInWithPassword,
  startEnrolStep,
  startTotpEnrolment,
  SignInThrottledError,
  totpEnrolled,
  turnOffTotp,
  type NewSession,
  type ProviderContext,
} from '@taleart/server-access';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from './authorize';
import { readCookie, setCookie } from './cookies';
import { HttpError, errorBody } from './errors';
import { Buckets, RATE_LIMIT_MAX_CLIENTS, rateLimitClient, type RateLimitOptions } from './rate-limit';
import { requiredString } from './validation';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The path the challenge cookie of a sign-in that waits for its code is sent on. */
const CHALLENGE_PATH = '/api/v1/auth';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Password sign-in per address (spec: rate limit per IP, reusing the existing limiter): a burst of 10
 * attempts, then 10 a minute. Every attempt takes one, whether or not it succeeds.
 */
export const PASSWORD_SIGN_IN_ADDRESS_LIMIT: RateLimitOptions = { burst: 10, perSecond: 10 / 60 };

/** How the sign-in methods router is set up. */
export interface SignInMethodsOptions {
  /** Adds `Secure` to the session cookie; true when the dashboard origin is https. */
  secureCookies: boolean;
  /** The API's public origin, which provider redirect URIs start with. */
  publicApiUrl: string;
  /** The dashboard's origin, where password reset links point. */
  dashboardOrigin: string;
  /** The key that encrypts provider secrets, or null. */
  secretKey: Buffer | null;
  /** True outside production: an OpenID Connect issuer may then be http on localhost. */
  allowHttpIssuer: boolean;
  /** Password sign-in attempts per address; null turns that limit off. */
  passwordAddressLimit?: RateLimitOptions | null;
  /** True when the server runs with TALEART_SETUP_PASSWORD=true: the first admin may set up with a password. */
  setupPasswordAllowed: boolean;
  /** Called with the first admin once password setup has created them; see the auth router. */
  onSetup?: (user: User) => void;
}

const invalid = (message: string) => new HttpError(400, ErrorCodes.validationFailed, message);

// A JSON body as an object; anything else is a validation error.
function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('The body must be an object');
  return body as Record<string, unknown>;
}

// A string field that is sent whole (a password is never trimmed); required when `required`.
function textField(body: Record<string, unknown>, field: string, required: boolean): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && value.length === 0)) throw invalid(`${field} is required`);
  return value;
}

// The name and email of a password registration (setup or an invitation), checked as the passkey forms are.
function nameAndEmail(body: Record<string, unknown>): { name: string; email: string } {
  const name = requiredString(body, 'name');
  const email = requiredString(body, 'email');
  if (!EMAIL.test(email)) throw invalid('email is not valid');
  return { name, email };
}

// The shape of a boolean switch in a settings body.
function switchField(body: Record<string, unknown>, field: string): boolean {
  if (typeof body[field] !== 'boolean') throw invalid(`${field} is true or false`);
  return body[field] as boolean;
}

const TWO_FACTOR_MODES: readonly string[] = ['off', 'optional', 'required'];

// The two-factor mode of a settings body, when it is sent; left out, undefined.
function twoFactorModeField(body: Record<string, unknown>): TwoFactorMode | undefined {
  const value = body['twoFactorMode'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TWO_FACTOR_MODES.includes(value)) throw invalid('twoFactorMode is off, optional or required');
  return value as TwoFactorMode;
}

/** Answers with the cookie that carries the new session, as the passkey routes do. */
function setSession(res: Response, session: NewSession, secure: boolean): void {
  setCookie(res, SESSION_COOKIE, session.token, {
    maxAge: (session.expiresAt.getTime() - Date.now()) / 1000,
    path: '/',
    secure,
  });
}

// Tokens of a reset link, or of a session, never kept by a cache.
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * Username and password sign-in and the other sign-in methods (sign-in methods epic): password setup,
 * invitations with a password, password reset links, the signed-in user's own methods and the admin
 * settings, providers and reset-link issuing. Mounted under `/auth`, which refuses any request with an
 * `Authorization` header, so no API token reaches it (the admin routes also need the session).
 */
export function signInMethodsRouter(pool: Pool, options: SignInMethodsOptions): Router {
  const router = Router();
  const throttle = new PasswordThrottle();
  const addressLimit = options.passwordAddressLimit === null ? null : new Buckets(
    options.passwordAddressLimit ?? PASSWORD_SIGN_IN_ADDRESS_LIMIT,
    RATE_LIMIT_MAX_CLIENTS,
    Date.now(),
  );
  const providerContext: ProviderContext = {
    secretKey: options.secretKey,
    publicApiUrl: options.publicApiUrl,
    allowHttpIssuer: options.allowHttpIssuer,
  };
  const secretsAvailable = options.secretKey !== null;

  // The signed-in user, from the session cookie alone (no API token, see the mount).
  const sessionUser: RequestHandler = async (req, res, next) => {
    try {
      const user = await findSessionUser(pool, readCookie(req, SESSION_COOKIE));
      if (!user) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
      res.locals['user'] = user;
      next();
    } catch (err) {
      next(err);
    }
  };
  const admin: RequestHandler[] = [sessionUser, requireAdmin];
  const userOf = (res: Response): User => res.locals['user'] as User;

  // Takes one of the address's sign-in attempts; answers 429 and returns false once they are spent. Password sign-in and
  // the code step share it, so guessing codes across many sign-ins is bounded too.
  const takeAddressAttempt = (req: Request, res: Response): boolean => {
    if (!addressLimit) return true;
    const bucket = addressLimit.get(rateLimitClient(req.ip ?? req.socket.remoteAddress), Date.now());
    if (bucket.tokens < 1) {
      res.setHeader('Retry-After', String(addressLimit.wait(bucket)));
      noStore(res);
      res.status(429).json(errorBody(ErrorCodes.rateLimited, 'Too many sign-in attempts. Try again later.'));
      return false;
    }
    bucket.tokens -= 1;
    return true;
  };

  // Username and password sign-in, after the address's allowance (429 once it is spent). A user with an authenticator app
  // gets no session yet: the answer is SecondStepRequired and the code step finishes the sign-in.
  router.post('/password/sign-in', async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      const username = textField(body, 'username', true) as string;
      const password = textField(body, 'password', true) as string;
      if (!takeAddressAttempt(req, res)) return;
      const result = await signInWithPassword(pool, throttle, { username, password });
      if ('secondStep' in result) {
        setCookie(res, CHALLENGE_COOKIE, result.secondStep.id, {
          maxAge: CHALLENGE_TTL_MS / 1000,
          path: CHALLENGE_PATH,
          secure: options.secureCookies,
        });
        noStore(res);
        const required: SecondStepRequired = { secondStepRequired: true };
        res.json(required);
        return;
      }
      if ('enrolment' in result) {
        // Required two-factor mode and no app yet: the challenge cookie leads to the enrolment steps.
        setCookie(res, CHALLENGE_COOKIE, result.enrolment.id, {
          maxAge: CHALLENGE_TTL_MS / 1000,
          path: CHALLENGE_PATH,
          secure: options.secureCookies,
        });
        noStore(res);
        const required: EnrolmentRequired = { enrolmentRequired: true };
        res.json(required);
        return;
      }
      setSession(res, result.session, options.secureCookies);
      const payload: SignedIn = { user: result.user };
      res.json(payload);
    } catch (err) {
      if (err instanceof SignInThrottledError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      next(err);
    }
  });

  // The code step of a sign-in: the challenge cookie from the password step and a current code from the authenticator app
  // (or a recovery code) make the session. Five wrong codes end the challenge; they also count toward the username's wait.
  router.post('/second-step', async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      const code = textField(body, 'code', true) as string;
      if (code.length > 64) throw invalid('code is not valid');
      if (!takeAddressAttempt(req, res)) return;
      const signedIn = await finishSecondStep(pool, options.secretKey, throttle, readCookie(req, CHALLENGE_COOKIE), code);
      setCookie(res, CHALLENGE_COOKIE, '', { maxAge: 0, path: CHALLENGE_PATH, secure: options.secureCookies });
      setSession(res, signedIn.session, options.secureCookies);
      noStore(res);
      const payload: SignedIn = { user: signedIn.user };
      res.json(payload);
    } catch (err) {
      if (err instanceof SignInThrottledError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      next(err);
    }
  });

  // The enrolment of a required sign-in (two-factor mode required): the challenge cookie from the password step leads to a
  // new authenticator app. Start it, then confirm with a current code; the right code makes the session and the recovery
  // codes. No session is needed; a wrong code counts toward the same five attempts as the second step.
  router.post('/enrol/start', async (req, res, next) => {
    try {
      if (!takeAddressAttempt(req, res)) return;
      const started = await startEnrolStep(pool, options.secretKey, readCookie(req, CHALLENGE_COOKIE));
      noStore(res);
      const payload: TwoFactorEnrolment = { secret: started.secret, otpauthUri: started.otpauthUri };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  router.post('/enrol/confirm', async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      const code = textField(body, 'code', true) as string;
      if (code.length > 64) throw invalid('code is not valid');
      if (!takeAddressAttempt(req, res)) return;
      const done = await finishEnrolStep(pool, options.secretKey, throttle, readCookie(req, CHALLENGE_COOKIE), code);
      setCookie(res, CHALLENGE_COOKIE, '', { maxAge: 0, path: CHALLENGE_PATH, secure: options.secureCookies });
      setSession(res, done.signedIn.session, options.secureCookies);
      noStore(res);
      const payload: EnrolConfirmResponse = { user: done.signedIn.user, recoveryCodes: done.recoveryCodes };
      res.json(payload);
    } catch (err) {
      if (err instanceof SignInThrottledError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      next(err);
    }
  });

  // The password variant of setup: the first admin, while no user exists and the password method is on.
  router.post('/setup/password', async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      const signedIn = await setupWithPassword(
        pool,
        { ...nameAndEmail(body), username: body['username'], password: body['password'] },
        options.setupPasswordAllowed,
      );
      setSession(res, signedIn.session, options.secureCookies);
      const payload: SignedIn = { user: signedIn.user };
      res.status(201).json(payload);
      options.onSetup?.(signedIn.user);
    } catch (err) {
      next(err);
    }
  });

  // The password variant of joining through an invitation.
  router.post('/invitations/:token/password', async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      const joined = await redeemInvitationWithPassword(pool, req.params['token'], {
        ...nameAndEmail(body),
        username: body['username'],
        password: body['password'],
      });
      setSession(res, joined.session, options.secureCookies);
      const payload: SignedIn = { user: joined.user };
      res.status(201).json(payload);
    } catch (err) {
      next(err);
    }
  });

  // Reset links: what the link sets, then the redemption.
  router.get('/password-resets/:token', async (req, res, next) => {
    try {
      noStore(res);
      const body: PasswordResetPreview = await previewPasswordReset(pool, req.params['token']);
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/password-resets/:token/redeem', async (req, res, next) => {
    try {
      noStore(res);
      const body = bodyObject(req.body);
      const signedIn = await redeemPasswordReset(pool, req.params['token'], {
        username: textField(body, 'username', false),
        password: textField(body, 'password', true) as string,
      });
      setSession(res, signedIn.session, options.secureCookies);
      const payload: SignedIn = { user: signedIn.user };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // The signed-in user's own sign-in methods (Settings > My sign-in methods).
  router.get('/account/methods', sessionUser, async (_req, res, next) => {
    try {
      noStore(res);
      const body: AccountMethods = await accountMethods(pool, userOf(res).id);
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  // The signed-in user's authenticator app: whether it is set up, start setting it up (a key and a QR code address),
  // and finish with a current code. All need the session, so no API token reaches them.
  router.get('/account/two-factor', sessionUser, async (_req, res, next) => {
    try {
      noStore(res);
      const userId = userOf(res).id;
      const payload: TwoFactorStatus = {
        enrolled: await totpEnrolled(pool, userId),
        recoveryCodesLeft: await recoveryCodesLeft(pool, userId),
        twoFactorMode: (await signInSettings(pool)).twoFactorMode,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  router.post('/account/two-factor', sessionUser, async (_req, res, next) => {
    try {
      const started = await startTotpEnrolment(pool, options.secretKey, userOf(res));
      noStore(res);
      const payload: TwoFactorEnrolment = { secret: started.secret, otpauthUri: started.otpauthUri };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  router.post('/account/two-factor/confirm', sessionUser, async (req, res, next) => {
    try {
      const code = textField(bodyObject(req.body), 'code', true) as string;
      if (code.length > 64) throw invalid('code is not valid');
      const recoveryCodes = await confirmTotpEnrolment(pool, options.secretKey, userOf(res).id, code);
      noStore(res);
      const payload: ConfirmTwoFactorResponse = { recoveryCodes };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // New recovery codes for the signed-in user's authenticator app; the old codes stop working. Shown once.
  router.post('/account/two-factor/recovery-codes', sessionUser, async (_req, res, next) => {
    try {
      const recoveryCodes = await regenerateRecoveryCodes(pool, userOf(res).id);
      noStore(res);
      const payload: RecoveryCodes = { recoveryCodes };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // Turns the signed-in user's authenticator app off: a current code or an unused recovery code, then the app's secret and
  // every recovery code are deleted. Wrong codes count per user and per address; the session is needed.
  router.delete('/account/two-factor', sessionUser, async (req, res, next) => {
    try {
      const code = textField(bodyObject(req.body), 'code', true) as string;
      if (code.length > 64) throw invalid('code is not valid');
      if (!takeAddressAttempt(req, res)) return;
      await turnOffTotp(pool, options.secretKey, throttle, userOf(res).id, code);
      noStore(res);
      res.status(204).end();
    } catch (err) {
      if (err instanceof SignInThrottledError) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      next(err);
    }
  });

  router.put('/account/password', sessionUser, async (req, res, next) => {
    try {
      const body = bodyObject(req.body);
      await setOwnPassword(pool, throttle, userOf(res), readCookie(req, SESSION_COOKIE), {
        username: body['username'],
        currentPassword: textField(body, 'currentPassword', false),
        password: textField(body, 'password', true),
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete('/account/password', sessionUser, async (_req, res, next) => {
    try {
      await removeOwnPassword(pool, userOf(res).id, secretsAvailable);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // An id that is not a UUID cannot be anyone's, so it is the same 404 as an unknown one.
  const uuidParam = (value: string | undefined): string => {
    if (!value || !UUID.test(value)) throw new HttpError(404, ErrorCodes.notFound, 'Not found');
    return value;
  };

  router.delete('/account/passkeys/:passkeyId', sessionUser, async (req, res, next) => {
    try {
      await removeOwnPasskey(pool, userOf(res).id, uuidParam(req.params['passkeyId']), secretsAvailable);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.delete('/account/identities/:identityId', sessionUser, async (req, res, next) => {
    try {
      await removeOwnIdentity(pool, userOf(res).id, uuidParam(req.params['identityId']), secretsAvailable);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Admin: the method settings.
  router.get('/settings', ...admin, async (_req, res, next) => {
    try {
      noStore(res);
      const settings = await signInSettings(pool);
      const body: AuthSettings = {
        passkeyEnabled: settings.passkeyEnabled,
        passwordEnabled: settings.passwordEnabled,
        twoFactorMode: settings.twoFactorMode,
        secretKeyConfigured: secretsAvailable,
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings', ...admin, async (req, res, next) => {
    try {
      const fields = bodyObject(req.body);
      const twoFactorMode = twoFactorModeField(fields);
      const body: UpdateAuthSettingsRequest = {
        passkeyEnabled: switchField(fields, 'passkeyEnabled'),
        passwordEnabled: switchField(fields, 'passwordEnabled'),
        ...(twoFactorMode === undefined ? {} : { twoFactorMode }),
      };
      await setSignInSettings(
        pool,
        body,
        userOf(res).id,
        secretsAvailable,
      );
      const settings = await signInSettings(pool);
      const payload: AuthSettings = {
        passkeyEnabled: settings.passkeyEnabled,
        passwordEnabled: settings.passwordEnabled,
        twoFactorMode: settings.twoFactorMode,
        secretKeyConfigured: secretsAvailable,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  // Admin: the providers. Secrets are never returned: only whether one is stored.
  router.get('/providers', ...admin, async (_req, res, next) => {
    try {
      noStore(res);
      const providers: AuthProvider[] = await listProviders(pool, providerContext);
      res.json(providers);
    } catch (err) {
      next(err);
    }
  });

  router.put('/providers/:slug', ...admin, async (req, res, next) => {
    try {
      noStore(res);
      const saved: AuthProvider = await saveProvider(
        pool,
        providerContext,
        String(req.params['slug'] ?? ''),
        req.body as SaveAuthProviderRequest,
        userOf(res).id,
      );
      res.json(saved);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/providers/:slug', ...admin, async (req, res, next) => {
    try {
      await deleteProvider(pool, providerContext, String(req.params['slug'] ?? ''));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Admin: a one-time reset link, shown once. Only its hash is stored.
  router.post('/users/:userId/password-reset', ...admin, async (req, res, next) => {
    try {
      noStore(res);
      const userId = uuidParam(req.params['userId']);
      const issued = await issuePasswordReset(pool, userId, userOf(res).id);
      const body: PasswordResetLink = {
        id: issued.id,
        userId: issued.userId,
        url: `${options.dashboardOrigin.replace(/\/+$/, '')}${passwordResetPath(issued.token)}`,
        expiresAt: issued.expiresAt.toISOString(),
      };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
