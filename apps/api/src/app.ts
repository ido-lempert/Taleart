import { DELIVERY_API_BASE, MAX_TALE_DOCUMENT_BYTES, PUBLIC_MEDIA_BASE, type Health } from '@taleart/contract';
import { DEFAULT_another tool_API_URL } from '@taleart/server-importer';
import express from 'express';
import type { PasskeyVerifier } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { authRouter, requireSession } from './http/auth.router';
import { coversRouter } from './http/covers.router';
import { deliveryRouter } from './http/delivery.router';
import { projectFontsRouter } from './http/fonts.router';
import { frameTypesRouter } from './http/frame-types.router';
import { importsRouter, type ImporterConfig } from './http/imports.router';
import { errorHandler, notFoundHandler } from './http/errors';
import { projectMediaRouter, type ProjectMediaOptions } from './http/project-media.router';
import { projectsRouter } from './http/projects.router';
import { publicMediaRouter } from './http/public-media.router';
import { projectTaleGroupsRouter, taleGroupsRouter, zoneTaleGroupsRouter } from './http/tale-groups.router';
import { projectTagsRouter } from './http/tags.router';
import { projectThemeRouter } from './http/theme.router';
import { talesRouter } from './http/tales.router';
import type { RateLimitOptions } from './http/rate-limit';
import { siteKeyRouter } from './http/site-key.router';
import { zonesRouter } from './http/zones.router';

/** Management API base path (AD-2, versioned per the spine conventions). */
export const MANAGEMENT_API_BASE = '/api/v1';

// `POST /api/v1/projects/<id>/fonts` and `/media`, in any case and with or without a trailing slash, as routers match.
const UPLOAD_PATH = /^\/api\/v1\/projects\/[^/]+\/(fonts|media)\/?$/i;

/** How the API handles sign-in. */
export interface AppAuth {
  /** Checks passkeys; tests pass a fake. */
  verifier: PasskeyVerifier;
  /** Adds `Secure` to the cookies; true when the dashboard origin (RP_ORIGIN) is https. */
  secureCookies?: boolean;
  /** The dashboard's origin (RP_ORIGIN), where invitation links point. Defaults to http://localhost:4200. */
  dashboardOrigin?: string;
}

/** How the Delivery API is limited. */
export interface AppDelivery {
  /** The per-address request limit of `/delivery/v1`; the default when left out, off when null. */
  rateLimit?: RateLimitOptions | null;
}

/** Where the API is reached from outside. */
export interface AppUrls {
  /** The API's public origin (PUBLIC_API_URL); Delivery media URLs start with it. Defaults to http://localhost:3333. */
  publicApiUrl?: string;
}

export type { ImporterConfig } from './http/imports.router';
export type { ProjectMediaOptions } from './http/project-media.router';

// Builds the API. Takes its pool, frame-type registry, media storage, passkey
// verifier and importer settings so tests can point it at a real database,
// their own frame types, a temporary folder, a fake authenticator and a fake
// import source. Without an importer token key the import routes answer 503.
export function createApp(
  pool: Pool,
  frameTypes: FrameTypeRegistry,
  storage: MediaStorage,
  auth: AppAuth,
  urls: AppUrls = {},
  importer: ImporterConfig = { tokenKey: null, another toolApiUrl: DEFAULT_another tool_API_URL },
  media: ProjectMediaOptions = {},
  delivery: AppDelivery = {},
): express.Express {
  const app = express();
  // A tale document may be up to 128 KB (AD-15), over express.json()'s 100 KB default. Its route
  // reads its body first, with a larger limit, and the parser below then leaves that body as it is.
  // Being a route, it matches as the routers do: in any case, with or without a trailing slash.
  app.put(`${MANAGEMENT_API_BASE}/tales/:taleId/document`, express.json({ limit: MAX_TALE_DOCUMENT_BYTES * 2 }));
  // Keeping a document as a new tale (after a stale save) takes the same body.
  app.post(`${MANAGEMENT_API_BASE}/tales/:taleId/document/copy`, express.json({ limit: MAX_TALE_DOCUMENT_BYTES * 2 }));
  // A font or media upload's body is the file, whatever type it declares (R18, R5): its route reads it raw.
  const json = express.json();
  app.use((req, res, next) => (req.method === 'POST' && UPLOAD_PATH.test(req.path) ? next() : json(req, res, next)));

  // The dashboard reaches the API through its dev proxy, on its own origin, so
  // cookies are same-origin. CORS stays open for other callers, never with credentials.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    next();
  });
  app.options(`${MANAGEMENT_API_BASE}/*`, (_req, res) => res.sendStatus(204));

  const v1 = express.Router();
  v1.get('/health', (_req, res) => {
    const body: Health = { status: 'ok' };
    res.json(body);
  });
  v1.use('/auth', authRouter(pool, { verifier: auth.verifier, secureCookies: auth.secureCookies ?? false }));
  // Every other route, media included, needs a signed-in session (AD-9), and
  // each checks the caller's access to the project it touches (AD-4).
  v1.use(requireSession(pool));
  v1.use('/projects', projectsRouter(pool, { dashboardOrigin: auth.dashboardOrigin ?? 'http://localhost:4200' }));
  v1.use('/projects', projectTagsRouter(pool));
  v1.use('/projects', projectTaleGroupsRouter(pool));
  v1.use('/projects', importsRouter(pool, importer));
  v1.use('/projects', projectThemeRouter(pool));
  v1.use('/projects', siteKeyRouter(pool));
  v1.use('/projects', projectFontsRouter(pool, storage));
  v1.use('/projects', projectMediaRouter(pool, storage, media));
  v1.use('/frame-types', frameTypesRouter(frameTypes));
  v1.use('/zones', zonesRouter(pool, frameTypes));
  v1.use('/zones', zoneTaleGroupsRouter(pool));
  v1.use('/tale-groups', taleGroupsRouter(pool));
  v1.use('/tale-groups', coversRouter(pool, storage));
  v1.use('/tales', talesRouter(pool, storage));
  app.use(MANAGEMENT_API_BASE, v1);

  // The Delivery API serves SDKs with site keys only (AD-2): its own open CORS
  // and key middleware, never the session middleware.
  app.use(DELIVERY_API_BASE, deliveryRouter(pool, {
      publicApiUrl: urls.publicApiUrl ?? 'http://localhost:3333',
      frameTypes,
      rateLimit: delivery.rateLimit,
    }));

  // Published media is public at unguessable URLs (AD-11): no session, no site key.
  app.use(PUBLIC_MEDIA_BASE, publicMediaRouter(pool, storage));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
