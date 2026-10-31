import { DELIVERY_API_BASE, MAX_TALE_DOCUMENT_BYTES, PUBLIC_MEDIA_BASE, SDK_BASE, type Health, type User } from '@taleart/contract';
import openapiDocument from '@taleart/contract/openapi.json';
import express from 'express';
import type { PasskeyVerifier } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { authRouter } from './http/auth.router';
import { providerLoginRouter } from './http/provider-login.router';
import { signInMethodsRouter } from './http/sign-in-methods.router';
import { listUsersRoute } from './http/users.router';
import { apiTokensRouter, userApiTokensRouter } from './http/api-tokens.router';
import { refuseAuthorizationHeader, requireCaller } from './http/credentials';
import { coversRouter } from './http/covers.router';
import { deliveryRouter } from './http/delivery.router';
import { projectFontsRouter } from './http/fonts.router';
import { frameTypesRouter } from './http/frame-types.router';
import { OPENAPI_DOCUMENT_PATH, openapiRouter } from './http/openapi.router';
import { errorHandler, notFoundHandler } from './http/errors';
import { projectMediaRouter, type ProjectMediaOptions } from './http/project-media.router';
import { projectsRouter, rolesRouter } from './http/projects.router';
import { publicMediaRouter } from './http/public-media.router';
import { projectTaleGroupsRouter, taleGroupsRouter, zoneTaleGroupsRouter } from './http/tale-groups.router';
import { projectTagsRouter } from './http/tags.router';
import { projectThemeRouter } from './http/theme.router';
import { talesRouter } from './http/tales.router';
import { zoneKeysRouter } from './http/zone-keys.router';
import { taleResponsesRouter } from './http/responses.router';
import { zoneAnalyticsRouter } from './http/analytics.router';
import type { RateLimitOptions } from './http/rate-limit';
import {
  defaultSdkFiles,
  installRouter,
  MIN_SDK_BUILDS_KEPT_WITH_FOLDER,
  sdkBuilds,
  sdkRouter,
  sdkSource,
  type SdkFiles,
} from './http/sdk.router';
import { siteKeyRouter } from './http/site-key.router';
import { userListsRouter, type UserListOptions } from './http/user-lists.router';
import { zonesRouter } from './http/zones.router';

/** Management API base path (AD-2, versioned per the spine conventions). */
export const MANAGEMENT_API_BASE = '/api/v1';

// `POST /api/v1/projects/<id>/fonts`, `/media` and `/user-lists/<id>/ids`, in any case and with or
// without a trailing slash, as routers match.
const UPLOAD_PATH = /^\/api\/v1\/projects\/[^/]+\/(fonts|media|user-lists\/[^/]+\/ids)\/?$/i;

/** How the API handles sign-in. */
export interface AppAuth {
  /** Checks passkeys; tests pass a fake. */
  verifier: PasskeyVerifier;
  /** Adds `Secure` to the cookies; true when the dashboard origin (RP_ORIGIN) is https. */
  secureCookies?: boolean;
  /** The dashboard's origin (RP_ORIGIN), where invitation links point. Defaults to http://localhost:4200. */
  dashboardOrigin?: string;
  /** Failed API token attempts allowed per address; the default when left out, off when null. */
  tokenGuessLimit?: RateLimitOptions | null;
  /** The key that encrypts provider secrets (TALEART_SECRET_KEY), or null when missing or invalid. */
  secretKey?: Buffer | null;
  /** Whether an OpenID Connect issuer may be http on localhost. Defaults to true unless NODE_ENV is production. */
  allowHttpIssuer?: boolean;
  /** Password sign-in attempts allowed per address; the default when left out, off when null. */
  passwordAddressLimit?: RateLimitOptions | null;
  /** Provider sign-in starts and callbacks allowed per address; the default when left out, off when null. */
  providerFlowLimit?: RateLimitOptions | null;
  /** TALEART_SETUP_PASSWORD=true: the first admin may set up with a username and password. Off by default. */
  setupPassword?: boolean;
  /**
   * Called once with the first admin right after setup has created them (not for later users). The demo
   * seed uses it (TALEART_SEED_DEMO=true); it runs beside the request, so it must handle its own errors.
   */
  onSetup?: (user: User) => void;
  /**
   * Tests only: the issuers the Google and Apple presets are discovered from, so a fake provider on
   * localhost stands in for them. Never set from the environment; left out, the real issuers are used.
   */
  presetIssuers?: Partial<Record<'google' | 'apple', string>>;
}

/** How the Delivery API is limited. */
export interface AppDelivery {
  /** The per-visitor request limit of `/delivery/v1` (with a per-address backstop); the default when left out, off when null. */
  rateLimit?: RateLimitOptions | null;
  /** The stricter per-visitor limit of `POST /delivery/v1/responses`; its default when left out, off when null. */
  responseRateLimit?: RateLimitOptions | null;
  /** The stricter per-visitor limit of `POST /delivery/v1/events` (analytics); its default when left out, off when null. */
  eventRateLimit?: RateLimitOptions | null;
}

/** Where the API is reached from outside. */
export interface AppUrls {
  /** The API's public origin (PUBLIC_API_URL); Delivery media URLs start with it. Defaults to http://localhost:3333. */
  publicApiUrl?: string;
}

export type { SdkFiles } from './http/sdk.router';
export type { ProjectMediaOptions } from './http/project-media.router';
export type { UserListOptions } from './http/user-lists.router';

// Builds the API. Takes its pool, frame-type registry, media storage, passkey
// verifier so tests can point it at a real database, their own frame types, a
// temporary folder and a fake authenticator.
export function createApp(
  pool: Pool,
  frameTypes: FrameTypeRegistry,
  storage: MediaStorage,
  auth: AppAuth,
  urls: AppUrls = {},
  media: ProjectMediaOptions = {},
  delivery: AppDelivery = {},
  sdk: Partial<SdkFiles> = {},
  userLists: UserListOptions = {},
): express.Express {
  const publicApiUrl = urls.publicApiUrl ?? 'http://localhost:3333';
  const sdkFiles = { ...defaultSdkFiles(__dirname), ...sdk };
  // The current SDK build and the last ones it served, kept for pinned URLs (story 8.21). Read once
  // now, so the build this API starts with is kept even if no page asks for it before the next one.
  const sdkBuildsKept = sdkFiles.buildsDir ? Math.max(MIN_SDK_BUILDS_KEPT_WITH_FOLDER, sdkFiles.buildsKept) : 1;
  const sdkServed = sdkSource(
    sdkFiles.bundleFile,
    sdkBuilds(sdkFiles.buildsDir, sdkBuildsKept, sdkFiles.warn),
    sdkFiles.stableMs,
  );
  void sdkServed.current().catch(() => undefined);
  const app = express();
  // A tale document may be up to 128 KB (AD-15), over express.json()'s 100 KB default. Its route
  // reads its body first, with a larger limit, and the parser below then leaves that body as it is.
  // Being a route, it matches as the routers do: in any case, with or without a trailing slash.
  app.put(`${MANAGEMENT_API_BASE}/tales/:taleId/document`, express.json({ limit: MAX_TALE_DOCUMENT_BYTES * 2 }));
  // Keeping a document as a new tale (after a stale save) takes the same body.
  app.post(`${MANAGEMENT_API_BASE}/tales/:taleId/document/copy`, express.json({ limit: MAX_TALE_DOCUMENT_BYTES * 2 }));
  // A font, media or user list upload's body is the file, whatever type it declares (R18, R5, epic
  // targeting R3): its route reads it as a stream.
  const json = express.json();
  // The Delivery API reads its own small bodies, after its CORS headers, so a refused body still
  // reaches the browser as the API's error (epic interactive components R9).
  app.use((req, res, next) =>
    (req.method === 'POST' && UPLOAD_PATH.test(req.path)) || req.path.startsWith(`${DELIVERY_API_BASE}/`)
      ? next()
      : json(req, res, next),
  );

  // The dashboard reaches the API through its dev proxy, on its own origin, so
  // cookies are same-origin. CORS stays open for other callers, never with credentials.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Authorization carries an API token (epic developer experience 10.1), for scripts and the docs'
    // API reference. Credentials stay disallowed, so no other origin's request carries the cookie.
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    next();
  });
  app.options(`${MANAGEMENT_API_BASE}/*`, (_req, res) => res.sendStatus(204));

  // The OpenAPI document, public and cacheable, for the docs' API reference and client generators
  // (epic developer experience 10.2). No credential is read.
  app.use(OPENAPI_DOCUMENT_PATH, openapiRouter(openapiDocument));

  const v1 = express.Router();
  v1.get('/health', (_req, res) => {
    const body: Health = { status: 'ok' };
    res.json(body);
  });
  // Sign-in, sign-out, setup and invitations read cookies only: a request with an Authorization header
  // (an API token) is refused there, so a token never starts, ends or stands in for a session.
  // The sign-in method routes (password sign-in, reset links, the account's and the admins' methods)
  // sit behind the same refusal, so a token reaches none of them, the admin routes included.
  v1.use(
    '/auth',
    refuseAuthorizationHeader,
    authRouter(pool, {
      verifier: auth.verifier,
      secureCookies: auth.secureCookies ?? false,
      secretsAvailable: (auth.secretKey ?? null) !== null,
      setupPasswordAllowed: auth.setupPassword === true,
      onSetup: auth.onSetup,
    }),
  );
  v1.use(
    '/auth',
    refuseAuthorizationHeader,
    signInMethodsRouter(pool, {
      secureCookies: auth.secureCookies ?? false,
      publicApiUrl,
      dashboardOrigin: auth.dashboardOrigin ?? 'http://localhost:4200',
      secretKey: auth.secretKey ?? null,
      allowHttpIssuer: auth.allowHttpIssuer ?? process.env['NODE_ENV'] !== 'production',
      passwordAddressLimit: auth.passwordAddressLimit,
      setupPasswordAllowed: auth.setupPassword === true,
      onSetup: auth.onSetup,
    }),
  );
  // Provider sign-in (OpenID Connect, Google, Apple): the start, the callbacks and the admin's test.
  v1.use(
    '/auth',
    refuseAuthorizationHeader,
    providerLoginRouter(pool, {
      secureCookies: auth.secureCookies ?? false,
      dashboardOrigin: auth.dashboardOrigin ?? 'http://localhost:4200',
      secretKey: auth.secretKey ?? null,
      publicApiUrl,
      allowHttpIssuer: auth.allowHttpIssuer ?? process.env['NODE_ENV'] !== 'production',
      presetIssuers: auth.presetIssuers,
      flowAddressLimit: auth.providerFlowLimit,
    }),
  );
  // The users of the install for the Users page: an admin's session only. Ahead of the caller check, so a
  // request with an Authorization header is refused as on /auth, before any token is read.
  v1.get('/users', refuseAuthorizationHeader, ...listUsersRoute(pool));
  // Every other route, media included, needs a signed-in session or an API token acting as its user
  // (AD-9, epic developer experience 10.1), and each checks the caller's access to the project it
  // touches (AD-4), narrowed to the token's projects.
  v1.use(requireCaller(pool, { tokenGuessLimit: auth.tokenGuessLimit }));
  // Personal API tokens: a passkey session only.
  v1.use('/api-tokens', apiTokensRouter(pool));
  v1.use('/users', userApiTokensRouter(pool));
  v1.use('/roles', rolesRouter());
  v1.use('/projects', projectsRouter(pool, { dashboardOrigin: auth.dashboardOrigin ?? 'http://localhost:4200' }));
  v1.use('/projects', projectTagsRouter(pool));
  v1.use('/projects', userListsRouter(pool, userLists));
  v1.use('/projects', projectTaleGroupsRouter(pool));
  v1.use('/projects', projectThemeRouter(pool));
  v1.use('/projects', siteKeyRouter(pool));
  v1.use('/projects', projectFontsRouter(pool, storage));
  v1.use('/projects', projectMediaRouter(pool, storage, media));
  v1.use('/install', installRouter(publicApiUrl, sdkServed.current, sdkBuildsKept));
  v1.use('/frame-types', frameTypesRouter(frameTypes));
  v1.use('/zones', zonesRouter(pool, frameTypes));
  v1.use('/zones', zoneTaleGroupsRouter(pool));
  v1.use('/zones', zoneKeysRouter(pool));
  v1.use('/zones', zoneAnalyticsRouter(pool));
  v1.use('/tale-groups', taleGroupsRouter(pool));
  v1.use('/tale-groups', coversRouter(pool, storage));
  v1.use('/tales', talesRouter(pool, storage));
  v1.use('/tales', taleResponsesRouter(pool));
  app.use(MANAGEMENT_API_BASE, v1);

  // The Delivery API serves SDKs with zone keys and site keys only (AD-2): its own open CORS
  // and key middleware, never the session middleware.
  app.use(DELIVERY_API_BASE, deliveryRouter(pool, {
      publicApiUrl,
      frameTypes,
      rateLimit: delivery.rateLimit,
      responseRateLimit: delivery.responseRateLimit,
      eventRateLimit: delivery.eventRateLimit,
    }));

  // Published media is public at unguessable URLs (AD-11): no session, no zone or site key.
  app.use(PUBLIC_MEDIA_BASE, publicMediaRouter(pool, storage));

  // The Web SDK bundle for host pages and the test page that renders one zone with it (epic UX
  // rework R13): public, no session and no key.
  app.use(SDK_BASE, sdkRouter(sdkFiles, publicApiUrl, sdkServed));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
