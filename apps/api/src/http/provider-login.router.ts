import { ErrorCodes, OAUTH_COOKIE, SESSION_COOKIE, type ProviderAuthErrorCode } from '@taleart/contract';
import {
  checkProviderSlug,
  completeProviderLogin,
  findSessionUser,
  hashSessionToken,
  InputInvalidError,
  ProviderAuthError,
  recordProviderCallback,
  startProviderLogin,
  testProvider,
  OAUTH_TTL_MS,
  type ProviderFlow,
  type ProviderContext,
} from '@taleart/server-access';
import express, { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { readCookie, setCookie } from './cookies';
import { HttpError, errorBody } from './errors';
import { Buckets, RATE_LIMIT_MAX_CLIENTS, rateLimitClient, type RateLimitOptions } from './rate-limit';

/** Provider starts and callbacks per address (spec: rate limit per IP): a burst of 20, then 20 a minute. */
export const PROVIDER_FLOW_ADDRESS_LIMIT: RateLimitOptions = { burst: 20, perSecond: 20 / 60 };

/** The most bytes a form-posted callback may be (Apple's form_post carries the code, state and ID token). */
export const CALLBACK_FORM_LIMIT = '16kb';

/** How the provider routes are set up. */
export interface ProviderLoginOptions {
  /** Adds `Secure` to the cookies; true when the dashboard origin is https. */
  secureCookies: boolean;
  /** The dashboard's origin: every provider flow ends with a redirect there. */
  dashboardOrigin: string;
  /** The key that encrypts provider secrets, or null. */
  secretKey: Buffer | null;
  /** The API's public origin, the redirect URI's base. */
  publicApiUrl: string;
  /** True outside production: an issuer may then be http on localhost. */
  allowHttpIssuer: boolean;
  /** Test-only issuers for the Google and Apple presets (see ProviderContext). */
  presetIssuers?: ProviderContext['presetIssuers'];
  /** Provider starts and callbacks per address; null turns the limit off. */
  flowAddressLimit?: RateLimitOptions | null;
}

// The redirect a flow ends with: the dashboard, with the short code of a refusal when there is one.
function dashboardUrl(dashboardOrigin: string, code?: ProviderAuthErrorCode): string {
  const base = `${dashboardOrigin.replace(/\/+$/, '')}/`;
  return code ? `${base}?auth_error=${encodeURIComponent(code)}` : base;
}

// The code a refusal is shown as in the redirect: a provider refusal's own code, or the generic one.
// Anything else is not a refusal and goes to the error handler.
function redirectCode(err: unknown): ProviderAuthErrorCode | null {
  if (err instanceof ProviderAuthError) return err.authCode;
  if (err instanceof InputInvalidError) return 'sign_in_failed';
  return null;
}

// Answers are never cached: they carry session tokens or redirects to sign-in results.
function noStoreHeader(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

// Provider form fields and query values as text; anything else is absent.
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Provider sign-in (sign-in methods spec, "Provider flow"): the start of a flow for the sign-in,
 * setup, invitation or link purposes, the callback the provider returns to, and the admin's Test
 * button. Apple's form POST only records the code and sends the browser on to the GET callback,
 * which is the one place a login completes (it needs the Lax `taleart_oauth` cookie). Mounted under
 * `/auth` behind the refusal of API tokens.
 */
export function providerLoginRouter(pool: Pool, options: ProviderLoginOptions): Router {
  const router = Router();
  const ctx: ProviderContext = {
    secretKey: options.secretKey,
    publicApiUrl: options.publicApiUrl,
    allowHttpIssuer: options.allowHttpIssuer,
    presetIssuers: options.presetIssuers,
  };
  const limit = options.flowAddressLimit === null ? null : new Buckets(
    options.flowAddressLimit ?? PROVIDER_FLOW_ADDRESS_LIMIT,
    RATE_LIMIT_MAX_CLIENTS,
    Date.now(),
  );
  const oauthPath = '/api/v1/auth';
  const setOauthCookie = (res: Response, id: string) =>
    setCookie(res, OAUTH_COOKIE, id, { maxAge: OAUTH_TTL_MS / 1000, path: oauthPath, secure: options.secureCookies, sameSite: 'Lax' });
  const clearOauthCookie = (res: Response) =>
    setCookie(res, OAUTH_COOKIE, '', { maxAge: 0, path: oauthPath, secure: options.secureCookies, sameSite: 'Lax' });

  // One request from this address, or a 429 answered here (and false).
  const admit = (req: Request, res: Response): boolean => {
    if (!limit) return true;
    const bucket = limit.get(rateLimitClient(req.ip ?? req.socket.remoteAddress), Date.now());
    if (bucket.tokens < 1) {
      res.setHeader('Retry-After', String(limit.wait(bucket)));
      noStoreHeader(res);
      res.status(429).json(errorBody(ErrorCodes.rateLimited, 'Too many sign-in attempts. Try again later.'));
      return false;
    }
    bucket.tokens -= 1;
    return true;
  };

  const setSession = (res: Response, token: string, expiresAt: Date) =>
    setCookie(res, SESSION_COOKIE, token, {
      maxAge: (expiresAt.getTime() - Date.now()) / 1000,
      path: '/',
      secure: options.secureCookies,
    });

  // The purpose of a start, from its query. A link is bound to the session the browser holds now (a
  // same-site start, where the Strict session cookie is sent): only its hash is kept with the flow.
  // An invitation needs its token and email.
  const flowFrom = async (req: Request): Promise<ProviderFlow> => {
    const purpose = text(req.query['purpose']);
    if (purpose === 'sign-in') return { purpose: 'sign-in' };
    if (purpose === 'setup') return { purpose: 'setup' };
    if (purpose === 'invitation') {
      const token = text(req.query['token']) ?? '';
      const email = text(req.query['email']) ?? '';
      if (token.length === 0 || token.length > 200) throw new ProviderAuthError('invitation_invalid');
      return { purpose: 'invitation', token, email };
    }
    if (purpose === 'link') {
      const token = readCookie(req, SESSION_COOKIE);
      const user = await findSessionUser(pool, token);
      if (!user || token === undefined) throw new ProviderAuthError('session_required');
      return { purpose: 'link', userId: user.id, sessionHash: hashSessionToken(token) };
    }
    throw new InputInvalidError('purpose is sign-in, setup, invitation or link');
  };

  router.get('/providers/:slug/start', async (req, res, next) => {
    const wantsJson = req.query['format'] === 'json';
    noStoreHeader(res);
    if (!admit(req, res)) return;
    try {
      const slug = checkProviderSlug(req.params['slug']);
      const flow = await flowFrom(req);
      const started = await startProviderLogin(pool, ctx, slug, flow);
      setOauthCookie(res, started.challengeId);
      if (wantsJson) res.json({ authorizationUrl: started.authorizationUrl });
      else res.redirect(302, started.authorizationUrl);
    } catch (err) {
      if (wantsJson) {
        next(err);
        return;
      }
      const code = redirectCode(err);
      if (code === null) {
        next(err);
        return;
      }
      clearOauthCookie(res);
      res.redirect(302, dashboardUrl(options.dashboardOrigin, code));
    }
  });

  // The provider's redirect back, as a GET: the only place a flow is completed. The `taleart_oauth`
  // cookie must match the state. With `resume=1` (after Apple's form POST) the code is the one the
  // POST stored, and a `code` in this query is never read. Nothing here reads the session: a link
  // was bound to it at the start.
  router.get('/callback/:slug', async (req, res, next) => {
    noStoreHeader(res);
    clearOauthCookie(res);
    if (!admit(req, res)) return;
    const query = req.query as Record<string, unknown>;
    const resume = text(query['resume']) === '1';
    try {
      const slug = checkProviderSlug(req.params['slug']);
      if (text(query['error']) !== undefined) throw new ProviderAuthError('sign_in_failed');
      const result = await completeProviderLogin(pool, ctx, {
        slug,
        cookieId: readCookie(req, OAUTH_COOKIE),
        code: resume ? undefined : query['code'],
        state: query['state'],
        resume,
      });
      if (result.kind === 'signed-in') {
        setSession(res, result.signedIn.session.token, result.signedIn.session.expiresAt);
      }
      res.redirect(302, dashboardUrl(options.dashboardOrigin));
    } catch (err) {
      const code = redirectCode(err);
      if (code === null) {
        next(err);
        return;
      }
      res.redirect(302, dashboardUrl(options.dashboardOrigin, code));
    }
  });

  // Apple posts the callback as a form, from another site, so no cookie comes with it. Only that
  // content type, and only up to CALLBACK_FORM_LIMIT, is read. The POST stores the code on the open
  // challenge of its state (once), and sends the browser on to the GET that resumes the flow.
  const formBody = express.urlencoded({ extended: false, limit: CALLBACK_FORM_LIMIT });
  router.post(
    '/callback/:slug',
    (req, res, next) => {
      const refuse = () => {
        noStoreHeader(res);
        res.redirect(303, dashboardUrl(options.dashboardOrigin, 'sign_in_failed'));
      };
      if (!req.is('application/x-www-form-urlencoded')) {
        refuse();
        return;
      }
      formBody(req, res, (err?: unknown) => {
        if (err) refuse();
        else next();
      });
    },
    async (req, res, next) => {
      noStoreHeader(res);
      if (!admit(req, res)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const slug = checkProviderSlug(req.params['slug']);
        const state = text(body['state']);
        const code = text(body['code']);
        if (
          state === undefined || state.length === 0 || state.length > 512 ||
          code === undefined || code.length === 0 || code.length > 2048 ||
          text(body['error']) !== undefined
        ) {
          throw new ProviderAuthError('sign_in_failed');
        }
        if (!(await recordProviderCallback(pool, { slug, state, code }))) throw new ProviderAuthError('sign_in_failed');
        res.redirect(303, `/api/v1/auth/callback/${slug}?${new URLSearchParams({ state, resume: '1' }).toString()}`);
      } catch (err) {
        const refusal = redirectCode(err);
        if (refusal === null) {
          next(err);
          return;
        }
        res.redirect(303, dashboardUrl(options.dashboardOrigin, refusal));
      }
    },
  );

  // Admin: the Test button. Discovery only; the answer is the issuer and endpoints, or a short code.
  router.post('/providers/:slug/test', async (req, res, next) => {
    noStoreHeader(res);
    try {
      const user = await findSessionUser(pool, readCookie(req, SESSION_COOKIE));
      if (!user) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
      if (user.role !== 'admin') throw new HttpError(403, ErrorCodes.forbidden, 'Only admins can do this');
      const result = await testProvider(pool, ctx, checkProviderSlug(req.params['slug']));
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
