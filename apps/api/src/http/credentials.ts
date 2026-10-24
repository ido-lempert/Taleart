import { API_TOKEN_PREFIX, ErrorCodes, SESSION_COOKIE, SITE_KEY_PREFIX } from '@taleart/contract';
import {
  API_TOKEN_LAST_USED_INTERVAL_MS,
  authenticateApiToken,
  findSessionUser,
  touchApiToken,
  type AuthenticatedApiToken,
  type ProjectScope,
} from '@taleart/server-access';
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
 * /48): 10 at once, refilled at 10 a minute. Every bearer request takes one from the bucket before
 * its lookup and gives it back when the token is valid, so requests at once cannot fail more than
 * the burst between them. With the bucket empty, a valid token still works and a failed attempt
 * answers 429 instead of 401: a stuck script or a flood of guesses never locks valid tokens out,
 * and a guesser learns nothing new (a 429 means only "not a valid token"). A token is 256 random
 * bits, so this is defence in depth, not what keeps tokens safe.
 */
export const DEFAULT_TOKEN_GUESS_LIMIT: RateLimitOptions = { burst: 10, perSecond: 10 / 60 };

/** The most tokens whose last touch this process remembers; beyond it, stale entries are dropped. */
const MAX_TOUCHED_TOKENS = 10_000;

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
 *   bucket empty a failed attempt answers 429 `rate_limited`, while a valid token still works.
 * - `last_used_at` is written at most once a minute per token and process, and not on a refusal.
 * - Any other request needs a valid session cookie, as before (401 `unauthenticated`). The cookie
 *   keeps its CSRF protections: it is `HttpOnly; SameSite=Strict` and CORS never allows credentials.
 *   A bearer token is never sent by a browser on its own, so the token path needs none.
 */
export function requireCaller(pool: Pool, options: CallerOptions = {}): RequestHandler {
  const now = options.now ?? Date.now;
  const limit = options.tokenGuessLimit === undefined ? DEFAULT_TOKEN_GUESS_LIMIT : options.tokenGuessLimit;
  const failures = limit ? new Buckets(checkRateLimit(limit), RATE_LIMIT_MAX_CLIENTS, now()) : null;
  // When this process last started a `last_used_at` write per token (in flight or done), so requests
  // at once start at most one write per token per interval.
  const touched = new Map<string, number>();

  const touch = (found: AuthenticatedApiToken, t: number): void => {
    const last = Math.max(touched.get(found.tokenId) ?? 0, found.lastUsedAt?.getTime() ?? 0);
    if (t - last < API_TOKEN_LAST_USED_INTERVAL_MS) return;
    if (touched.size >= MAX_TOUCHED_TOKENS) {
      for (const [id, at] of touched) if (t - at >= API_TOKEN_LAST_USED_INTERVAL_MS) touched.delete(id);
      if (touched.size >= MAX_TOUCHED_TOKENS) touched.clear();
    }
    touched.set(found.tokenId, t);
    // Best effort: the request does not wait for it.
    void touchApiToken(pool, { tokenId: found.tokenId, lastUsedAt: null }, t).catch((err: unknown) => {
      touched.delete(found.tokenId);
      console.warn(JSON.stringify({ level: 'warn', msg: 'Could not record an API token as used', error: String(err) }));
    });
  };

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
      // Reserved before the lookup, so concurrent failures cannot exceed the burst; given back below
      // when the token is valid.
      const reserved = !!bucket && bucket.tokens >= 1;
      if (bucket && reserved) bucket.tokens -= 1;
      const raw = bearerToken(header);
      // Always looked up: a valid token works whatever the address's failures.
      const found = await authenticateApiToken(pool, raw);
      if (found && bucket && reserved) bucket.tokens += 1;
      if (!found && failures && bucket && !reserved) {
        res.setHeader('Retry-After', String(failures.wait(bucket)));
        res.setHeader('Cache-Control', 'no-store');
        res.status(429).json(errorBody(ErrorCodes.rateLimited, 'Too many failed API token attempts. Try again later.'));
        return;
      }
      if (!found) {
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
      if (found.readOnly && !READ_METHODS.has(req.method)) {
        // Refused before any body is read (an upload's included), so the connection is not reused.
        res.setHeader('Connection', 'close');
        throw new HttpError(403, ErrorCodes.forbidden, 'This API token is read-only');
      }
      // Not counted as a use when refused above.
      touch(found, t);
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
