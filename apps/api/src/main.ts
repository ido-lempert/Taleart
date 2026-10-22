import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assertEmojiCheckSupported, DELIVERY_API_BASE, PUBLIC_MEDIA_BASE, SDK_BUNDLE_PATH } from '@taleart/contract';
import { SimpleWebAuthnVerifier } from '@taleart/server-access';
import {
  DEFAULT_STORYLY_API_URL,
  parseAllowedAddresses,
  parseTokenKey,
  startImportWorker,
  type ImportWorker,
} from '@taleart/server-importer';
import { LocalDiskStorage } from '@taleart/server-storage';
import {
  continueTaleMediaMigration,
  DEFAULT_PROJECT_MEDIA_LIMITS,
  setTestElementTypesEnabled,
} from '@taleart/server-tales';
import { loadFrameTypeRegistry } from '@taleart/server-zones';
import { createApp, MANAGEMENT_API_BASE } from './app';
import { defaultSdkFiles, webSdkFileFromEnv } from './http/sdk.router';
import { relyingPartyFromEnv, secureCookiesFor } from './auth-config';
import { createPool, DATABASE_CONNECTIONS_FOR_REQUESTS, databasePoolMax, migrate } from './db';
import { configureTestElementTypes } from './element-types-config';
import { deliveryRateLimitFromEnv, trustProxyFromEnv } from './http/rate-limit';

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
  // The Delivery API's limit per client and per process: DELIVERY_RATE_LIMIT_BURST (a whole number;
  // 0 turns it off) and DELIVERY_RATE_LIMIT_PER_SECOND.
  const rateLimit = deliveryRateLimitFromEnv(process.env);
  // Behind reverse proxies, TRUST_PROXY makes the limit count the visitor's address rather than the
  // proxy's. Set exactly the proxies in front of the API: their number, or their addresses and ranges.
  const trustProxy = trustProxyFromEnv(process.env['TRUST_PROXY']);
  // The Web SDK bundle served at /sdk/v1/taleart.js: WEB_SDK_FILE, a .js file, else the one the build
  // copied next to main.js.
  const webSdkFile = webSdkFileFromEnv(process.env['WEB_SDK_FILE'], (p) => resolve(p)) ?? defaultSdkFiles(__dirname).bundleFile;
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
  };

  // The importer (AD-8): source tokens are encrypted with IMPORT_TOKEN_KEY while
  // a job runs. Without a valid key the import routes answer 503 and no worker runs.
  const storylyApiUrl = process.env['STORYLY_API_URL'] || DEFAULT_STORYLY_API_URL;
  const tokenKey = parseTokenKey(process.env['IMPORT_TOKEN_KEY']);
  if (tokenKey === null) {
    log(
      'info',
      process.env['IMPORT_TOKEN_KEY']
        ? 'Importer off: IMPORT_TOKEN_KEY is not 32 bytes of base64'
        : 'Importer off: IMPORT_TOKEN_KEY is not set',
    );
  }
  // Imported media comes from URLs the source names, so the importer fetches only
  // public addresses. IMPORT_MEDIA_ALLOWED_ADDRESSES exempts exact address:port
  // endpoints, for local reviews against the fake server; it is empty by default.
  const allowed = parseAllowedAddresses(process.env['IMPORT_MEDIA_ALLOWED_ADDRESSES']);
  if (allowed.invalid.length > 0) {
    log(
      'warn',
      `IMPORT_MEDIA_ALLOWED_ADDRESSES: ${allowed.invalid.length} entry(ies) are not address:port and were ignored`,
    );
  }
  if (allowed.addresses.length > 0) {
    log('warn', `Imported media may be fetched from these non-public endpoints: ${allowed.addresses.join(', ')}`);
  }
  // Per-import media budgets: bytes and time, after which the rest is listed as not imported.
  const positive = (name: string): number | undefined => {
    const value = Number(process.env[name]);
    return process.env[name] && Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const maxSeconds = positive('IMPORT_MEDIA_MAX_SECONDS_PER_JOB');
  const mediaPolicy = {
    allowedAddresses: allowed.addresses,
    maxBytesPerJob: positive('IMPORT_MEDIA_MAX_BYTES_PER_JOB'),
    maxMsPerJob: maxSeconds === undefined ? undefined : maxSeconds * 1000,
  };
  let worker: ImportWorker | null = null;
  if (tokenKey !== null) {
    // The media copies' database work stays below the pool's size, so requests keep their connections.
    const dbConcurrency = Math.max(1, databasePoolMax() - DATABASE_CONNECTIONS_FOR_REQUESTS);
    worker = startImportWorker(pool, { tokenKey, storylyApiUrl, storage, mediaPolicy, dbConcurrency, log });
    log('info', `Import worker started; source ${storylyApiUrl}`);
  }
  const importer = { tokenKey, storylyApiUrl, wake: () => worker?.wake() };

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
      `Delivery API limited to ${rateLimit.burst} requests at once and ${rateLimit.perSecond} per second per address`
    : 'Delivery API rate limit off',
  );
  // The Web SDK bundle host pages load from <PUBLIC_API_URL>/sdk/v1/taleart.js (epic UX rework R13):
  // the build copies dist/libs/web-sdk/index.js next to main.js; WEB_SDK_FILE names another file.
  const sdk = { bundleFile: webSdkFile };
  log(
    'info',
    `Web SDK at ${publicApiUrl}${SDK_BUNDLE_PATH} from ${webSdkFile}${existsSync(webSdkFile) ? '' : ' (missing: answers 404 until it is built)'}`,
  );
  const app = createApp(pool, frameTypes, storage, auth, { publicApiUrl }, importer, media, { rateLimit }, sdk);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
    log('info', `Trusting X-Forwarded-For from ${JSON.stringify(trustProxy)}`);
  }
  const server = app.listen(port, () => {
    log('info', `Listening at http://localhost:${port}${MANAGEMENT_API_BASE}`);
    log('info', `Delivery API at http://localhost:${port}${DELIVERY_API_BASE}`);
  });
  server.on('error', (err) => log('error', 'server error', err));

  // The start-up migration brings tales' media into their documents for at most 10 s (Tale Studio
  // R16); the rest is finished here, beside requests, by one process at a time, retried with backoff
  // while tales remain. Delivery composes any tale not yet done. Off with TALE_MEDIA_MIGRATION=off.
  const continuation = new AbortController();
  process.once('SIGTERM', () => continuation.abort());
  process.once('SIGINT', () => continuation.abort());
  continueTaleMediaMigration(pool, { signal: continuation.signal, log, poolMax: databasePoolMax() }).catch((err) =>
    log('error', 'tale media migration failed', err),
  );

  // On shutdown the API stops taking requests first, then the worker gets up
  // to SHUTDOWN_DEADLINE_MS to finish the job in progress. A job cut off by the
  // deadline stops sending heartbeats, so a later worker recovers it.
  const SHUTDOWN_DEADLINE_MS = 20_000;
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('info', `Stopping on ${signal}`);
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    const deadline = new Promise<'deadline'>((resolve) => setTimeout(() => resolve('deadline'), SHUTDOWN_DEADLINE_MS).unref());
    const outcome = await Promise.race([Promise.all([closed, worker?.stop()]).then(() => 'stopped' as const), deadline]);
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
