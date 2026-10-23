import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import {
  DEFAULT_SDK_BUILDS_KEPT,
  SDK_BASE,
  SDK_BUNDLE_PATH,
  SDK_CACHE_SECONDS,
  SDK_PINNED_CACHE_SECONDS,
  SDK_TEST_PAGE_PATH,
  type InstallInfo,
} from '@taleart/contract';
import { Router, type Request, type Response } from 'express';

/** Where the API finds what it serves under `/sdk/v1` (epic UX rework R13). */
export interface SdkFiles {
  /**
   * The built Web SDK bundle (`dist/libs/web-sdk/index.js`, an ES module). The API build copies it
   * next to `main.js` as `web-sdk/index.js`; WEB_SDK_FILE overrides it. Missing: 404.
   */
  bundleFile: string;
  /** The folder of the test page's own files (`test-page.html`, `.js`, `.css`). */
  pagesDir: string;
  /**
   * Where the API keeps the builds it served, as `taleart.<hash>.js`, so a pinned URL keeps working
   * after a release (story 8.21); null keeps only the current build.
   */
  buildsDir: string | null;
  /** How many builds the folder keeps, the current one included (the newest by modification time). */
  buildsKept: number;
  /** Told when the builds folder cannot be written or pruned; the current build is served anyway. */
  warn?: (msg: string, err?: unknown) => void;
}

/** A file as served: its bytes, ETag, content hash for a pinned URL, and SRI integrity. */
export interface ServedFile {
  body: Buffer;
  etag: string;
  /** 16 base64url characters of its SHA-256: the `<hash>` of `taleart.<hash>.js`. */
  hash: string;
  /** `sha384-…`, for a script tag's `integrity` attribute. */
  integrity: string;
}

/**
 * Reads a file and keeps it, reading it again when its size or modification time changes (a deploy
 * or a rebuild replaced it), so a running API never serves a stale SDK. A missing file reads as null
 * and is looked for again on the next request.
 */
export function servedFile(path: string): () => Promise<ServedFile | null> {
  let served: { file: ServedFile; mtimeMs: number; size: number } | null = null;
  return async () => {
    try {
      const { mtimeMs, size } = await stat(path);
      if (served && served.mtimeMs === mtimeMs && served.size === size) return served.file;
      const file = toServedFile(await readFile(path));
      served = { file, mtimeMs, size };
      return file;
    } catch {
      served = null;
      return null;
    }
  };
}

/** A file's bytes as served: ETag, content hash and SRI integrity, all from the bytes. */
export function toServedFile(body: Buffer): ServedFile {
  const sha256 = createHash('sha256').update(body).digest('base64url');
  return {
    body,
    etag: `"${sha256.slice(0, 27)}"`,
    hash: sha256.slice(0, 16),
    integrity: `sha384-${createHash('sha384').update(body).digest('base64')}`,
  };
}

// The `<hash>` of a pinned URL: 16 base64url characters.
const HASH = /^[A-Za-z0-9_-]{16}$/;
// A kept build in the builds folder, and a temporary file being written there.
const BUILD_FILE = /^taleart\.[A-Za-z0-9_-]{16}\.js$/;
const TEMP_FILE = /^\.taleart\.[A-Za-z0-9_-]{16}\..+\.tmp$/;
// A temporary file older than this was left by a process that stopped while writing it.
const STALE_TEMP_MS = 10 * 60 * 1000;

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/** The builds folder: what {@link sdkBuilds} gives. */
export interface SdkBuilds {
  /**
   * Keeps a build the API serves: written as `taleart.<hash>.js` (whole, by a rename) and made the
   * newest, then the folder is cut to the newest `keep` builds, never removing this one. Never
   * rejects: a failure is told to `warn`.
   */
  record(file: ServedFile): Promise<void>;
  /** A kept build by its hash, or null: not kept, evicted, or its bytes no longer match the hash. */
  read(hash: string): Promise<ServedFile | null>;
}

/**
 * The last `keep` SDK builds the API served, in `dir` (story 8.21), so a page pinned to a build with
 * Subresource Integrity keeps loading it after the next releases. Newest is by modification time,
 * which recording a build sets: a restart or a redeploy of an older build makes it the newest again.
 * Several API processes may share the folder: files appear whole, and a pruned file reads as gone.
 * With no `dir`, nothing is kept.
 */
export function sdkBuilds(
  dir: string | null,
  keep: number,
  warn: (msg: string, err?: unknown) => void = () => undefined,
): SdkBuilds {
  // One reader per kept build that was asked for, dropped when it reads as gone: probing hashes adds nothing.
  const readers = new Map<string, () => Promise<ServedFile | null>>();
  // One write at a time, in order; and modification times that only grow, within this process.
  let queue: Promise<void> = Promise.resolve();
  let lastTime = 0;

  async function write(folder: string, file: ServedFile): Promise<void> {
    await mkdir(folder, { recursive: true });
    const name = `taleart.${file.hash}.js`;
    const temp = join(folder, `.taleart.${file.hash}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temp, file.body, { flag: 'wx' });
      lastTime = Math.max(Date.now(), lastTime + 1);
      const at = new Date(lastTime);
      await utimes(temp, at, at);
      await rename(temp, join(folder, name));
    } catch (err) {
      await unlink(temp).catch(() => undefined);
      throw err;
    }
    await prune(folder, name);
  }

  async function prune(folder: string, current: string): Promise<void> {
    const builds: { name: string; mtimeMs: number }[] = [];
    for (const name of await readdir(folder)) {
      const temp = TEMP_FILE.test(name);
      if (!temp && !BUILD_FILE.test(name)) continue;
      try {
        const { mtimeMs } = await stat(join(folder, name));
        if (temp) {
          if (Date.now() - mtimeMs > STALE_TEMP_MS) await unlink(join(folder, name));
        } else if (name !== current) {
          builds.push({ name, mtimeMs });
        }
      } catch (err) {
        if (!isMissing(err)) throw err;
      }
    }
    // The current build is one of the `keep`: the newest others fill the rest.
    builds.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1));
    for (const { name } of builds.slice(Math.max(0, keep - 1))) {
      await unlink(join(folder, name)).catch((err) => {
        if (!isMissing(err)) throw err;
      });
      readers.delete(name.slice('taleart.'.length, -'.js'.length));
    }
  }

  return {
    record(file) {
      if (!dir) return Promise.resolve();
      const folder = dir;
      const done = queue
        .then(() => write(folder, file))
        .catch((err) => warn(`Web SDK builds in ${folder}: build ${file.hash} was not kept`, err));
      queue = done;
      return done;
    },
    async read(hash) {
      if (!dir || !HASH.test(hash)) return null;
      const reader = readers.get(hash) ?? servedFile(join(dir, `taleart.${hash}.js`));
      const file = await reader();
      // Only bytes that are that build: a renamed or damaged file would fail the page's integrity check.
      if (!file || file.hash !== hash) {
        readers.delete(hash);
        return null;
      }
      readers.set(hash, reader);
      return file;
    },
  };
}

/** The SDK the API serves: the current build, and any kept build by its hash. */
export interface SdkSource {
  /** The current build (WEB_SDK_FILE or the API build's copy), or null when it is missing. */
  current(): Promise<ServedFile | null>;
  /** The current build when the hash is its own, else a kept one, else null. */
  pinned(hash: string): Promise<ServedFile | null>;
}

/**
 * The current bundle, read again when it changes, with each build it holds recorded in `builds` the
 * first time it is read (at start and after each rebuild or deploy).
 */
export function sdkSource(bundleFile: string, builds: SdkBuilds = sdkBuilds(null, 1)): SdkSource {
  const read = servedFile(bundleFile);
  let recorded: ServedFile | null = null;
  const current = async () => {
    const file = await read();
    if (file && file !== recorded) {
      recorded = file;
      await builds.record(file);
    }
    return file;
  };
  return {
    current,
    async pinned(hash) {
      const file = await current();
      return file && file.hash === hash ? file : builds.read(hash);
    },
  };
}

const gzipAsync = promisify(gzipCallback);

/**
 * The gzipped body of a served file (level 9), made on the first request that asks for it and kept
 * with that file: requests at the same time share one compression, and a rebuilt file (a new
 * ServedFile) gets its own.
 */
export function gzipCache(): (file: ServedFile) => Promise<Buffer> {
  const zipped = new WeakMap<ServedFile, Promise<Buffer>>();
  return (file) => {
    let done = zipped.get(file);
    if (!done) {
      done = gzipAsync(file.body, { level: 9 });
      // A failure is not kept: the next request tries again.
      done.catch(() => zipped.delete(file));
      zipped.set(file, done);
    }
    return done;
  };
}

/** The API's public origin, without a trailing slash. */
function origin(publicApiUrl: string): string {
  return publicApiUrl.replace(/\/+$/, '');
}

/**
 * The install URLs the dashboard's Install tab shows (`GET /api/v1/install`): with the bundle, its
 * pinned URL (`taleart.<hash>.js`, cached for a year) and SRI integrity; null without it.
 */
export function installInfo(publicApiUrl: string, bundle: ServedFile | null): InstallInfo {
  const apiUrl = origin(publicApiUrl);
  return {
    apiUrl,
    sdkUrl: `${apiUrl}${SDK_BUNDLE_PATH}`,
    sdkPinnedUrl: bundle ? `${apiUrl}${SDK_BASE}/taleart.${bundle.hash}.js` : null,
    sdkIntegrity: bundle ? bundle.integrity : null,
    testPageUrl: `${apiUrl}${SDK_TEST_PAGE_PATH}`,
  };
}

export function installRouter(publicApiUrl: string, bundle: () => Promise<ServedFile | null>): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => {
    try {
      res.json(installInfo(publicApiUrl, await bundle()));
    } catch (err) {
      next(err);
    }
  });
  return router;
}

/**
 * The test page's Content Security Policy. Its scripts and styles come only from this API: the
 * page has no inline script. The SDK writes its styles into its Shadow DOM as a `<style>` element,
 * hence `'unsafe-inline'` for styles only. It reads the Delivery API on this origin, and media,
 * covers and fonts at the public API URL, which can be another origin behind a proxy.
 */
export function testPageCsp(publicApiUrl: string): string {
  let media = "'self'";
  try {
    const { origin: o, protocol } = new URL(publicApiUrl);
    if (protocol === 'https:' || protocol === 'http:') media = `'self' ${o}`;
  } catch {
    // A public API URL that is not a URL adds nothing.
  }
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${media}`,
    `img-src ${media} data: blob:`,
    `media-src ${media} blob:`,
    `font-src ${media} data:`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// The test page's files: the only paths served besides the bundle. Nothing in them comes from the request.
const PAGE_FILES: Record<string, { file: string; type: string }> = {
  'test-page': { file: 'test-page.html', type: 'text/html; charset=utf-8' },
  'test-page.js': { file: 'test-page.js', type: 'text/javascript; charset=utf-8' },
  'test-page.css': { file: 'test-page.css', type: 'text/css; charset=utf-8' },
};

// `taleart.<16 base64url characters>.js`: the bundle pinned to its content.
const PINNED = /^taleart\.([A-Za-z0-9_-]{16})\.js$/;

function notFound(res: Response): void {
  res.status(404).type('text/plain; charset=utf-8').send('Not found');
}

/**
 * `/sdk/v1`: the Web SDK bundle a host page loads with `<script type="module" src="…/taleart.js">`
 * (or pinned to its content, `taleart.<hash>.js`), and the TaleArt-served test page that renders
 * one zone with it (epic UX rework R13). No session and no key: both are public. The page reads the
 * zone's slug from `?zone=` and a site key from the URL fragment or a field on the page; the server
 * never sees the key, and nothing of the request goes into what it sends.
 */
export function sdkRouter(files: SdkFiles, publicApiUrl: string, sdk: SdkSource = sdkSource(files.bundleFile)): Router {
  const router = Router({ strict: true });
  const pages = new Map(
    Object.entries(PAGE_FILES).map(([name, { file, type }]) => [name, { read: servedFile(join(files.pagesDir, file)), type }]),
  );
  const csp = testPageCsp(publicApiUrl);

  const gzipped = gzipCache();
  const sendBundle = async (req: Request, res: Response, file: ServedFile, cacheControl: string) => {
    // Compressed for a client that accepts gzip, as a CDN serves it: the 50 KB budget is gzipped
    // (epic Tale Studio R15). Only the bundle: the test page's files go as they are. The ETag
    // differs per encoding, so a cache never mixes the two.
    const gzip = req.acceptsEncodings('gzip') === 'gzip';
    res.vary('Accept-Encoding');
    res.set({
      'Content-Type': 'text/javascript; charset=utf-8',
      // Any page loads it, as a module script, so it is fetched with CORS (open on every API route).
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControl,
      ETag: gzip ? `${file.etag.slice(0, -1)}-gz"` : file.etag,
    });
    // A matching If-None-Match: 304, with no body and no Content-Encoding.
    if (req.fresh) {
      res.status(304).end();
      return;
    }
    if (!gzip) {
      res.send(file.body);
      return;
    }
    const body = await gzipped(file);
    res.set('Content-Encoding', 'gzip');
    res.send(body);
  };

  router.get('/taleart.js', async (req, res, next) => {
    try {
      const file = await sdk.current();
      if (!file) return notFound(res);
      // A deploy replaces it at the same URL: pages pick the new one up within five minutes.
      await sendBundle(req, res, file, `public, max-age=${SDK_CACHE_SECONDS}`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:name', async (req, res, next) => {
    try {
      const pinned = PINNED.exec(req.params.name);
      if (pinned) {
        // The current build or one of the last ones kept (story 8.21); any other hash is unknown.
        const file = await sdk.pinned(pinned[1]);
        if (!file) return notFound(res);
        return await sendBundle(req, res, file, `public, max-age=${SDK_PINNED_CACHE_SECONDS}, immutable`);
      }
      const page = Object.prototype.hasOwnProperty.call(PAGE_FILES, req.params.name) ? pages.get(req.params.name) : undefined;
      const file = page && (await page.read());
      if (!page || !file) return notFound(res);
      res.set({
        'Content-Type': page.type,
        'Content-Security-Policy': csp,
        'X-Robots-Tag': 'noindex, nofollow',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cache-Control': 'no-store',
      });
      res.send(file.body);
    } catch (err) {
      next(err);
    }
  });

  // `/sdk/v1/test-page/` would resolve the page's relative script URLs one level too deep: it goes
  // to the URL without the slash (relative, so a path prefix in front of the API stays).
  router.get('/:name/', (req, res) => {
    if (!Object.prototype.hasOwnProperty.call(PAGE_FILES, req.params.name)) return notFound(res);
    const at = req.originalUrl.indexOf('?');
    res.redirect(301, `../${req.params.name}${at === -1 ? '' : req.originalUrl.slice(at)}`);
  });

  return router;
}

/**
 * Where the build puts the bundle and the test page, next to the API's code in `dir`
 * (`dist/apps/api`; under tests, `apps/api/src`, which holds the page but no bundle).
 */
export function defaultSdkFiles(dir: string): SdkFiles {
  return {
    bundleFile: join(dir, 'web-sdk', 'index.js'),
    pagesDir: join(dir, 'sdk-pages'),
    buildsDir: null,
    buildsKept: DEFAULT_SDK_BUILDS_KEPT,
  };
}

/** The most builds SDK_BUILDS_KEPT may keep. */
export const MAX_SDK_BUILDS_KEPT = 100;

/**
 * The builds folder and how many builds it keeps (story 8.21): SDK_BUILDS_DIR (default
 * `.data/sdk-builds`, resolved by `resolvePath`; `off` keeps only the current build) and
 * SDK_BUILDS_KEPT (a whole number from 1 to {@link MAX_SDK_BUILDS_KEPT}, default
 * {@link DEFAULT_SDK_BUILDS_KEPT}). A bad number stops the API at start.
 */
export function sdkBuildsFromEnv(
  env: Record<string, string | undefined>,
  resolvePath: (p: string) => string,
): Pick<SdkFiles, 'buildsDir' | 'buildsKept'> {
  const dir = env['SDK_BUILDS_DIR'] || '.data/sdk-builds';
  const kept = env['SDK_BUILDS_KEPT'] || String(DEFAULT_SDK_BUILDS_KEPT);
  if (!/^\d+$/.test(kept) || Number(kept) < 1 || Number(kept) > MAX_SDK_BUILDS_KEPT) {
    throw new Error(`SDK_BUILDS_KEPT must be a whole number from 1 to ${MAX_SDK_BUILDS_KEPT}, not ${JSON.stringify(kept)}`);
  }
  return { buildsDir: dir === 'off' ? null : resolvePath(dir), buildsKept: Number(kept) };
}

/**
 * The SDK bundle file WEB_SDK_FILE names, resolved by `resolvePath`, or undefined when it is not
 * set. It must be a `.js` file: anything else stops the API at start.
 */
export function webSdkFileFromEnv(value: string | undefined, resolvePath: (p: string) => string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/\.m?js$/.test(value)) throw new Error(`WEB_SDK_FILE must name a .js file (the Web SDK's ES build), not ${JSON.stringify(value)}`);
  return resolvePath(value);
}
