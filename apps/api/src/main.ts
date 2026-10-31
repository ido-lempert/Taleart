import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertEmojiCheckSupported, DELIVERY_API_BASE, PUBLIC_MEDIA_BASE, SDK_BUNDLE_PATH } from '@taleart/contract';
import { parseSecretKey, SECRET_KEY_ENV, SimpleWebAuthnVerifier } from '@taleart/server-access';
import { purgeAnalyticsEvents } from '@taleart/server-analytics';
import { ANALYTICS_RETENTION_DAYS } from '@taleart/contract';
import { LocalDiskStorage } from '@taleart/server-storage';
import {
  continueTaleMediaMigration,
  DEFAULT_PROJECT_MEDIA_LIMITS,
  setTestElementTypesEnabled,
} from '@taleart/server-tales';
import { loadFrameTypeRegistry } from '@taleart/server-zones';
import { createApp, MANAGEMENT_API_BASE } from './app';
import { seedDemoOnSetup } from './demo-seed';
import { USER_LIST_UPLOAD_DEADLINE_MS } from './http/user-lists.router';
import { defaultSdkFiles, hasKeptBuilds, sdkBuildsFromEnv, webSdkFileFromEnv } from './http/sdk.router';
import { relyingPartyFromEnv, secureCookiesFor } from './auth-config';
import { createPool, databasePoolMax, migrate } from './db';
import { configureTestElementTypes } from './element-types-config';
import { ADDRESS_BACKSTOP_FACTOR, deliveryRateLimitFromEnv, trustProxyFromEnv } from './http/rate-limit';

/** How long a request may take to arrive whole (server.requestTimeout); above every upload deadline. */
const REQUEST_TIMEOUT_MS = 300_000;
if (USER_LIST_UPLOAD_DEADLINE_MS >= REQUEST_TIMEOUT_MS) throw new Error('The user list upload deadline must be under the request timeout');

// Structured JSON to stdout, one line per entry (spine logging convention).
function log(level: 'info' | 'warn' | 'error', msg: string, err?: unknown): void {
  const entry: Record<string, unknown> = { level, msg };
  if (err !== undefined) {
    entry['error'] = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err);
  }
  console.log(JSON.stringify(entry));
}

async function start(): Promise<void> {
  // Emoji elements are checked with the RegExp v flag (Node.js 22 or later); without it the API does not start.
  assertEmojiCheckSupported();
  // Read before anything starts, so a bad value stops the API with a clear error.
  // The Delivery API's limit per visitor (or per address without a visitor id) and per process:
  // DELIVERY_RATE_LIMIT_BURST (a whole number; 0 turns it off) and DELIVERY_RATE_LIMIT_PER_SECOND.
  // Each address also gets ADDRESS_BACKSTOP_FACTOR times that in all.
  const rateLimit = deliveryRateLimitFromEnv(process.env);
  // Behind reverse proxies, TRUST_PROXY makes the limit count the visitor's address rather than the
  // proxy's. Set exactly the proxies in front of the API: their number, or their addresses and ranges.
  // Left unset behind a proxy, every client is counted as the proxy's address and shares one backstop.
  const trustProxy = trustProxyFromEnv(process.env['TRUST_PROXY']);
  // The Web SDK bundle served at /sdk/v1/taleart.js: WEB_SDK_FILE, a .js file, else the one the build
  // copied next to main.js.
  const webSdkFile = webSdkFileFromEnv(process.env['WEB_SDK_FILE'], (p) => resolve(p)) ?? defaultSdkFiles(__dirname).bundleFile;
  // The last SDK_BUILDS_KEPT builds (5) stay at their pinned URLs, in SDK_BUILDS_DIR (default
  // .data/sdk-builds from the folder the API starts in; `off` keeps only the current one).
  const sdkBuildsConfig = sdkBuildsFromEnv(process.env, (p) => resolve(p));
  // The element-type registry's test-only types (Tale Studio R8): accepted only with
  // TALE_TEST_ELEMENT_TYPES=on, which is refused in production.
  configureTestElementTypes(process.env, setTestElementTypesEnabled, (msg) => log('warn', msg));
  const pool = createPool();
  await migrate(pool);
  // The build copies libs/contract/frame-types next to main.js. Read at every
  // start, so a new registry entry and schema need only a restart (AD-5).
  const frameTypes = loadFrameTypeRegistry(join(__dirname, 'frame-types'));

  // Media files live under MEDIA_DIR (default .data/media, from the folder the
  // API starts in: the repo root under nx serve). The database holds only keys (AD-11).
  const storage = new LocalDiskStorage(resolve(process.env['MEDIA_DIR'] || '.data/media'));
  log('info', `Storing media in ${storage.root}`);

  // Passkeys are bound to RP_ID and RP_ORIGIN, the dashboard's domain and origin (AD-9).
  const rp = relyingPartyFromEnv();
  log('info', `Passkeys for ${rp.origin} (RP ID ${rp.id})`);
  const auth = {
    verifier: new SimpleWebAuthnVerifier(rp),
    secureCookies: secureCookiesFor(rp),
    dashboardOrigin: rp.origin,
    // Provider secrets (client secrets, the Apple key) are encrypted with TALEART_SECRET_KEY (32 bytes,
    // base64). Without a valid key the API runs, refuses to save a secret, and offers no provider.
    secretKey: parseSecretKey(process.env[SECRET_KEY_ENV]),
    // TALEART_SETUP_PASSWORD=true lets the first admin set up with a username and password (off by default).
    setupPassword: process.env['TALEART_SETUP_PASSWORD'] === 'true',
    // TALEART_SEED_DEMO=true fills the first admin's install with the demo project once setup is done
    // (only an install with that one user; the API calls itself on its own port). Off by default.
    onSetup:
      process.env['TALEART_SEED_DEMO'] === 'true' ?
        seedDemoOnSetup(pool, `http://127.0.0.1:${process.env['PORT'] || 3333}`, log)
      : undefined,
  };
  if (auth.onSetup) log('info', 'Demo seed on: the first admin gets the Spring Campaign demo project after setup');
  if (auth.secretKey === null) {
    log(
      'info',
      process.env[SECRET_KEY_ENV]
        ? `Provider secrets off: ${SECRET_KEY_ENV} is not 32 bytes of base64`
        : `Provider secrets off: ${SECRET_KEY_ENV} is not set`,
    );
  }

  const positive = (name: string): number | undefined => {
    const value = Number(process.env[name]);
    return process.env[name] && Number.isFinite(value) && value > 0 ? value : undefined;
  };

  const port = process.env['PORT'] || 3333;
  // Delivery media URLs are absolute and start with the API's public origin.
  const publicApiUrl = process.env['PUBLIC_API_URL'] || 'http://localhost:3333';
  log('info', `Public media at ${publicApiUrl}${PUBLIC_MEDIA_BASE}`);
  // A project's media caps (Tale Studio R5): PROJECT_MEDIA_MAX_FILES (500) and PROJECT_MEDIA_MAX_BYTES (2 GB).
  const media = {
    limits: {
      maxFiles: positive('PROJECT_MEDIA_MAX_FILES') ?? DEFAULT_PROJECT_MEDIA_LIMITS.maxFiles,
      maxBytes: positive('PROJECT_MEDIA_MAX_BYTES') ?? DEFAULT_PROJECT_MEDIA_LIMITS.maxBytes,
    },
  };
  log('info', `Project media at most ${media.limits.maxFiles} files and ${media.limits.maxBytes} bytes each`);
  log(
    'info',
    rateLimit ?
      `Delivery API limited to ${rateLimit.burst} requests at once and ${rateLimit.perSecond} per second per visitor ` +
        `(per address without a visitor id), and ${ADDRESS_BACKSTOP_FACTOR} times that per address in all`
    : 'Delivery API rate limit off',
  );
  // The Web SDK bundle host pages load from <PUBLIC_API_URL>/sdk/v1/taleart.js (epic UX rework R13):
  // the build copies dist/libs/web-sdk/index.js next to main.js; WEB_SDK_FILE names another file.
  const sdk = { bundleFile: webSdkFile, ...sdkBuildsConfig, warn: (msg: string, err?: unknown) => log('warn', msg, err) };
  log(
    'info',
    `Web SDK at ${publicApiUrl}${SDK_BUNDLE_PATH} from ${webSdkFile}${existsSync(webSdkFile) ? '' : ' (missing: answers 404 until it is built)'}`,
  );
  log(
    'info',
    sdkBuildsConfig.buildsDir ?
      `Web SDK pinned URLs: the last ${sdkBuildsConfig.buildsKept} builds, kept in ${sdkBuildsConfig.buildsDir}`
    : 'Web SDK pinned URLs: the current build only (SDK_BUILDS_DIR=off)',
  );
  // Read before the app keeps the build it starts with: an empty folder in production means either
  // a first deploy or a folder that does not survive deploys (no volume), where pinned pages break.
  if (process.env['NODE_ENV'] === 'production' && sdkBuildsConfig.buildsDir && !hasKeptBuilds(sdkBuildsConfig.buildsDir)) {
    log(
      'warn',
      `SDK_BUILDS_DIR ${sdkBuildsConfig.buildsDir} holds no earlier Web SDK builds. Unless this is the first deploy, it does not persist across deploys: put it on a volume, or pages pinned to earlier builds answer 404.`,
    );
  }
  const app = createApp(pool, frameTypes, storage, auth, { publicApiUrl }, media, { rateLimit }, sdk);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
    log('info', `Trusting X-Forwarded-For from ${JSON.stringify(trustProxy)}`);
  }
  const server = app.listen(port, () => {
    log('info', `Listening at http://localhost:${port}${MANAGEMENT_API_BASE}`);
    log('info', `Delivery API at http://localhost:${port}${DELIVERY_API_BASE}`);
  });
  server.on('error', (err) => log('error', 'server error', err));
  // A request must arrive whole within 300 s (Node's default, set here so it is not changed by
  // accident): the user list upload's own deadline (USER_LIST_UPLOAD_DEADLINE_MS, 280 s) stays under it.
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  // The start-up migration brings tales' media into their documents for at most 10 s (Tale Studio
  // R16); the rest is finished here, beside requests, by one process at a time, retried with backoff
  // while tales remain. Delivery composes any tale not yet done. Off with TALE_MEDIA_MIGRATION=off.
  const continuation = new AbortController();
  process.once('SIGTERM', () => continuation.abort());
  process.once('SIGINT', () => continuation.abort());
  continueTaleMediaMigration(pool, { signal: continuation.signal, log, poolMax: databasePoolMax() }).catch((err) =>
    log('error', 'tale media migration failed', err),
  );

  // Raw analytics events older than ANALYTICS_RETENTION_DAYS (400) are deleted at start and then
  // once a day (analytics spec, retention). A missed run only keeps events a little longer.
  const purgeAnalytics = () =>
    purgeAnalyticsEvents(pool, ANALYTICS_RETENTION_DAYS)
      .then((deleted) => {
        if (deleted > 0) log('info', `Deleted ${deleted} analytics event(s) older than ${ANALYTICS_RETENTION_DAYS} days`);
      })
      .catch((err) => log('error', 'analytics retention failed', err));
  void purgeAnalytics();
  setInterval(purgeAnalytics, 24 * 60 * 60 * 1000).unref();

  // On shutdown the API stops taking requests first, then has SHUTDOWN_DEADLINE_MS to finish the requests in progress.
  const SHUTDOWN_DEADLINE_MS = 20_000;
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('info', `Stopping on ${signal}`);
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    const deadline = new Promise<'deadline'>((resolve) => setTimeout(() => resolve('deadline'), SHUTDOWN_DEADLINE_MS).unref());
    const outcome = await Promise.race([closed.then(() => 'stopped' as const), deadline]);
    if (outcome === 'deadline') {
      log('error', `Shutdown deadline of ${SHUTDOWN_DEADLINE_MS} ms passed; exiting with work in progress`);
      process.exit(1);
    }
    await pool.end();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      shutdown(signal).catch((err) => {
        log('error', 'shutdown failed', err);
        process.exit(1);
      });
    });
  }
}

start().catch((err) => {
  log('error', 'startup failed', err);
  process.exit(1);
});
