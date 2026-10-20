import {
  CHALLENGE_COOKIE,
  ErrorCodes,
  SESSION_COOKIE,
  type AuthState,
  type InvitationPreview,
  type RedeemInvitationRequest,
  type SetupRequest,
  type SignedIn,
} from '@taleart/contract';
import {
  CHALLENGE_TTL_MS,
  deleteSession,
  finishInvitation,
  finishSetup,
  finishSignIn,
  findSessionUser,
  PasskeyFailedError,
  previewInvitation,
  setupRequired,
  startInvitation,
  startSetup,
  startSignIn,
  type NewSession,
  type PasskeyVerifier,
} from '@taleart/server-access';
import { Router, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { readCookie, setCookie } from './cookies';
import { HttpError } from './errors';
import { requiredString } from './validation';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The name and email of a setup or invitation form; 400 validation_failed when either is missing or bad.
function nameAndEmail(body: unknown): SetupRequest & RedeemInvitationRequest {
  const input = { name: requiredString(body, 'name'), email: requiredString(body, 'email') };
  if (!EMAIL.test(input.email)) throw new HttpError(400, ErrorCodes.validationFailed, 'email is not valid');
  return input;
}

/** The challenge cookie is only sent to the auth routes. */
const CHALLENGE_PATH = '/api/v1/auth';

export interface AuthOptions {
  verifier: PasskeyVerifier;
  /** Adds `Secure` to the cookies; true when the dashboard origin is https. */
  secureCookies: boolean;
}

/**
 * Answers 401 `unauthenticated` unless the request carries the cookie of a
 * valid session. Puts the user on `res.locals.user`.
 */
export function requireSession(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    try {
      const user = await findSessionUser(pool, readCookie(req, SESSION_COOKIE));
      if (!user) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
      res.locals['user'] = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Setup of the first admin, joining by invitation, passkey sign-in and sign-out (AD-9). */
export function authRouter(pool: Pool, { verifier, secureCookies }: AuthOptions): Router {
  const router = Router();

  const setChallenge = (res: Response, id: string) =>
    setCookie(res, CHALLENGE_COOKIE, id, { maxAge: CHALLENGE_TTL_MS / 1000, path: CHALLENGE_PATH, secure: secureCookies });
  const clearChallenge = (res: Response) =>
    setCookie(res, CHALLENGE_COOKIE, '', { maxAge: 0, path: CHALLENGE_PATH, secure: secureCookies });
  const setSession = (res: Response, session: NewSession) =>
    setCookie(res, SESSION_COOKIE, session.token, {
      maxAge: (session.expiresAt.getTime() - Date.now()) / 1000,
      path: '/',
      secure: secureCookies,
    });

  router.get('/state', async (req, res, next) => {
    try {
      const body: AuthState = {
        setupRequired: await setupRequired(pool),
        user: await findSessionUser(pool, readCookie(req, SESSION_COOKIE)),
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/setup/options', async (req, res, next) => {
    try {
      const started = await startSetup(pool, verifier, nameAndEmail(req.body));
      setChallenge(res, started.challengeId);
      res.json(started.options);
    } catch (err) {
      next(err);
    }
  });

  router.post('/setup/verify', async (req, res, next) => {
    try {
      const signedIn = await finishSetup(pool, verifier, readCookie(req, CHALLENGE_COOKIE), req.body);
      clearChallenge(res);
      setSession(res, signedIn.session);
      const body: SignedIn = { user: signedIn.user };
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof PasskeyFailedError) clearChallenge(res);
      next(err);
    }
  });

  router.post('/sign-in/options', async (_req, res, next) => {
    try {
      const started = await startSignIn(pool, verifier);
      setChallenge(res, started.challengeId);
      res.json(started.options);
    } catch (err) {
      next(err);
    }
  });

  router.post('/sign-in/verify', async (req, res, next) => {
    try {
      const signedIn = await finishSignIn(pool, verifier, readCookie(req, CHALLENGE_COOKIE), req.body);
      clearChallenge(res);
      setSession(res, signedIn.session);
      const body: SignedIn = { user: signedIn.user };
      res.json(body);
    } catch (err) {
      if (err instanceof PasskeyFailedError) {
        clearChallenge(res);
        next(new HttpError(401, err.code, err.message));
        return;
      }
      next(err);
    }
  });

  // Joining through an invitation link (AD-9): no session needed.
  router.get('/invitations/:token', async (req, res, next) => {
    try {
      const body: InvitationPreview = await previewInvitation(pool, req.params.token);
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/invitations/:token/options', async (req, res, next) => {
    try {
      const started = await startInvitation(pool, verifier, req.params.token, nameAndEmail(req.body));
      setChallenge(res, started.challengeId);
      res.json(started.options);
    } catch (err) {
      next(err);
    }
  });

  router.post('/invitations/:token/verify', async (req, res, next) => {
    try {
      const joined = await finishInvitation(pool, verifier, req.params.token, readCookie(req, CHALLENGE_COOKIE), req.body);
      clearChallenge(res);
      setSession(res, joined.session);
      const body: SignedIn = { user: joined.user };
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof PasskeyFailedError) clearChallenge(res);
      next(err);
    }
  });

  router.post('/sign-out', async (req, res, next) => {
    try {
      await deleteSession(pool, readCookie(req, SESSION_COOKIE));
      setCookie(res, SESSION_COOKIE, '', { maxAge: 0, path: '/', secure: secureCookies });
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
