import { API_TOKEN_PREFIX, ErrorCodes, SESSION_COOKIE, SITE_KEY_PREFIX } from '@taleart/contract';
import { authenticateApiToken, findSessionUser, touchApiToken, type ProjectScope } from '@taleart/server-access';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { readCookie } from './cookies';
import { errorBody, HttpError } from './errors';
import { Buckets, checkRateLimit, RATE_LIMIT_MAX_CLIENTS, rateLimitClient, type RateLimitOptions } from './rate-limit';

/**
 * How a Management API request authenticated (epic developer experience 10.1): a passkey session
 * cookie, or a personal API token in `Authorization: Bearer tat_…`.
 */
export type Credential =
  | { kind: 'session' }
  | { kind: 'token'; tokenId: string; projects: ProjectScope; readOnly: boolean };

/**
 * The default allowance of failed bearer authentications per address (an IPv4 address or an IPv6
 * /48): 10 at once, refilled at 10 a minute. Past it every bearer request from the address answers
 * 429 until the bucket refills, valid tokens included, so a lock-out tells a guesser nothing. A
 * token is 256 random bits, so this is defence in depth, not what keeps tokens safe.
 */
export const DEFAULT_TOKEN_GUESS_LIMIT: RateLimitOptions = { burst: 10, perSecond: 10 / 60 };

/** Methods a read-only token may use. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The credential {@link requireCaller} put on the response. */
export function credential(res: Response): Credential {
  return (res.locals['credential'] as Credential | undefined) ?? { kind: 'session' };
}

// The token of `Authorization: Bearer <token>`; undefined for any other header.
function bearerToken(header: string): string | undefined {
  return /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1];
}

// A refused credential: 401 `unauthenticated`, never kept by a cache.
function unauthenticated(res: Response, message: string): void {
  res.setHeader('WWW-Authenticate', 'Bearer realm="TaleArt Management API"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(401).json(errorBody(ErrorCodes.unauthenticated, message));
}

export interface CallerOptions {
  /** The allowance of failed bearer authentications per address; null turns the lock-out off. */
  tokenGuessLimit?: RateLimitOptions | null;
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * Authenticates a Management API request (AD-9, epic developer experience 10.1) and puts the user on
 * `res.locals.user` and how they authenticated on `res.locals.credential`.
 *
 * - A request with an `Authorization` header is a token request: only the header is read and the
 *   session cookie is ignored, even when the header is refused, so a request carrying both is always
 *   judged by its token. A missing, unknown, revoked or expired token, a `tas_` site key, or any
 *   other header answers 401 `unauthenticated`. The token acts as its user, whose role and projects
 *   are read now, narrowed to the token's projects; a read-only token may only read (403 otherwise).
 * - Failed bearer attempts count against the address ({@link DEFAULT_TOKEN_GUESS_LIMIT}); with the
 *   bucket empty every bearer request answers 429 `rate_limited` before any lookup.
 * - Any other request needs a valid session cookie, as before (401 `unauthenticated`). The cookie
 *   keeps its CSRF protections: it is `HttpOnly; SameSite=Strict` and CORS never allows credentials.
 *   A bearer token is never sent by a browser on its own, so the token path needs none.
 */
export function requireCaller(pool: Pool, options: CallerOptions = {}): RequestHandler {
  const now = options.now ?? Date.now;
  const limit = options.tokenGuessLimit === undefined ? DEFAULT_TOKEN_GUESS_LIMIT : options.tokenGuessLimit;
  const failures = limit ? new Buckets(checkRateLimit(limit), RATE_LIMIT_MAX_CLIENTS, now()) : null;

  return async (req, res, next) => {
    try {
      const header = req.headers.authorization;
      if (header === undefined) {
        const user = await findSessionUser(pool, readCookie(req, SESSION_COOKIE));
        if (!user) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
        res.locals['user'] = user;
        res.locals['credential'] = { kind: 'session' } satisfies Credential;
        next();
        return;
      }

      const t = now();
      const bucket = failures?.get(rateLimitClient(req.ip ?? req.socket.remoteAddress), t);
      if (failures && bucket && bucket.tokens < 1) {
        res.setHeader('Retry-After', String(failures.wait(bucket)));
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json(errorBody(ErrorCodes.rateLimited, 'Too many failed API token attempts. Try again later.'));
        return;
      }
      const raw = bearerToken(header);
      const found = await authenticateApiToken(pool, raw);
      if (!found) {
        if (bucket) bucket.tokens -= 1;
        unauthenticated(
          res,
          raw?.startsWith(SITE_KEY_PREFIX)
            ? 'A site key works only on the Delivery API. Use an API token (tat_…) here.'
            : raw?.startsWith(API_TOKEN_PREFIX)
              ? 'This API token is unknown, revoked or expired'
              : 'Send an API token as Authorization: Bearer tat_…, or sign in',
        );
        return;
      }
      res.locals['user'] = found.user;
      res.locals['credential'] = {
        kind: 'token',
        tokenId: found.tokenId,
        projects: found.projects,
        readOnly: found.readOnly,
      } satisfies Credential;
      // Best effort and at most once a minute: the request does not wait for it.
      void touchApiToken(pool, found).catch((err: unknown) =>
        console.warn(JSON.stringify({ level: 'warn', msg: 'Could not record an API token as used', error: String(err) })),
      );
      if (found.readOnly && !READ_METHODS.has(req.method)) {
        throw new HttpError(403, ErrorCodes.forbidden, 'This API token is read-only');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Refuses API tokens with 403 `forbidden`: what only a passkey session may do. A token can never
 * create, list or revoke tokens, manage passkeys or sessions, or create invitations, so a leaked
 * token cannot make itself permanent or let someone else in.
 */
export const sessionOnly: RequestHandler = (_req, res, next) => {
  if (credential(res).kind === 'token') {
    next(new HttpError(403, ErrorCodes.forbidden, 'API tokens cannot do this. Sign in to the dashboard with your passkey.'));
    return;
  }
  next();
};

/** Refuses a token limited to some projects with 403 `forbidden` (creating a project reaches beyond them). */
export const requireAllProjects: RequestHandler = (_req, res, next) => {
  const used = credential(res);
  if (used.kind === 'token' && used.projects !== 'all') {
    next(new HttpError(403, ErrorCodes.forbidden, 'This API token is limited to some projects, so it cannot create one'));
    return;
  }
  next();
};

/**
 * In front of `/auth/*` (sign-in, sign-out, setup, invitations): a request with an `Authorization`
 * header answers 403 `forbidden`. Those routes read only cookies, and a token must never start,
 * end or stand in for a session.
 */
export const refuseAuthorizationHeader: RequestHandler = (req, _res, next) => {
  if (req.headers.authorization !== undefined) {
    next(new HttpError(403, ErrorCodes.forbidden, 'API tokens cannot sign in, sign out or manage passkeys'));
    return;
  }
  next();
};
