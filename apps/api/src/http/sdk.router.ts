import { createHash, randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  /** How long the bundle must hold still before its build is kept ({@link SDK_STABLE_MS}; tests set 0). */
  stableMs?: number;
}

/** A file as served: its bytes, ETag, content hash for a pinned URL, and SRI integrity. */
export interface ServedFile {
  body: Buffer;
  etag: string;
  /** 16 base64url characters of its SHA-256: the `<hash>` of `taleart.<hash>.js`. */
  hash: string;
  /** `sha384-…`, for a script tag's `integrity` attribute. */
  integrity: string;
  /** When its file last changed (ms since the epoch), when it was read from a file. */
  mtimeMs?: number;
}

/** How {@link servedFile} reads: the file system, or a stand-in under test. */
export interface FileReads {
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
  readFile(path: string): Promise<Buffer>;
}

const FILE_SYSTEM: FileReads = { stat, readFile };

// Reads of a file that keeps changing while it is read, before the last whole read is served instead.
const READ_ATTEMPTS = 3;
const READ_RETRY_MS = 25;

/**
 * Reads a file and keeps it, reading it again when its size or modification time changes (a deploy
 * or a rebuild replaced it), so a running API never serves a stale SDK. A read is kept only when the
 * file held still while it was read (same size and modification time before and after, and all its
 * bytes): a file being written in place is read again, and while it keeps changing the last whole
 * read is served (null if there is none). Deploys should still write the new file elsewhere and
 * rename it into place. A missing file reads as null and is looked for again on the next request.
 */
export function servedFile(path: string, fs: FileReads = FILE_SYSTEM): () => Promise<ServedFile | null> {
  let served: { file: ServedFile; mtimeMs: number; size: number } | null = null;
  return async () => {
    try {
      for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
        const before = await fs.stat(path);
        if (served && served.mtimeMs === before.mtimeMs && served.size === before.size) return served.file;
        const body = await fs.readFile(path);
        const after = await fs.stat(path);
        if (body.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) continue;
        const file = { ...toServedFile(body), mtimeMs: before.mtimeMs };
        served = { file, mtimeMs: before.mtimeMs, size: before.size };
        return file;
      }
      return served?.file ?? null;
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
// A chunk of the bundle, split off the entry by the build (`core-<hash>.js`, `viewer-<hash>.js`): the
// entry imports it by that name, so it is served by that name, from the current build or a kept one.
const CHUNK = /^[a-z][a-z0-9]*-[A-Za-z0-9_-]+\.js$/;
// A chunk kept with its build in the builds folder: `taleart.<hash>.<chunk>`.
const BUILD_CHUNK = /^taleart\.([A-Za-z0-9_-]{16})\.([a-z][a-z0-9]*-[A-Za-z0-9_-]+\.js)$/;
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
  record(file: ServedFile, chunks?: ServedChunk[]): Promise<void>;
  /** A kept build by its hash, or null: not kept, evicted, or its bytes no longer match the hash. */
  read(hash: string): Promise<ServedFile | null>;
  /** A chunk of a kept build by its name, or null when no kept build has it. */
  readChunk(name: string): Promise<ServedFile | null>;
}

/** A chunk of the bundle, by its name in the bundle's folder (`core-<hash>.js`). */
export interface ServedChunk {
  name: string;
  file: ServedFile;
}

/**
 * The fewest builds a builds folder keeps: during a rolling deploy an old and a new API process both
 * serve and both record, and each must keep the other's current build.
 */
export const MIN_SDK_BUILDS_KEPT_WITH_FOLDER = 2;

/**
 * The last `keep` SDK builds the API served, in `dir` (story 8.21), so a page pinned to a build with
 * Subresource Integrity keeps loading it after the next SDK builds. Newest is by modification time,
 * which recording a build sets: a restart or a redeploy of an older build makes it the newest again.
 * Several API processes may share the folder (their clocks in sync, as the times come from each):
 * files appear whole, and a pruned file reads as gone. With no `dir`, nothing is kept.
 */
export function sdkBuilds(
  dir: string | null,
  keepAsked: number,
  warn: (msg: string, err?: unknown) => void = () => undefined,
): SdkBuilds {
  const keep = Math.max(MIN_SDK_BUILDS_KEPT_WITH_FOLDER, keepAsked);
  // One reader per kept build that was asked for, at most `keep`, dropped when it reads as gone:
  // probing hashes adds nothing.
  const readers = new Map<string, () => Promise<ServedFile | null>>();
  // One reader per chunk file of a kept build, read again only when the file changes.
  const chunkReaders = new Map<string, () => Promise<ServedFile | null>>();
  // One write at a time, in order; and modification times that only grow, within this process.
  let queue: Promise<void> = Promise.resolve();
  let lastTime = 0;

  // Writes `body` to `folder` as `name`, whole (a temporary file, then a rename), made the newest.
  async function place(folder: string, name: string, hash: string, body: Buffer): Promise<void> {
    const temp = join(folder, `.taleart.${hash}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(temp, body, { flag: 'wx' });
      lastTime = Math.max(Date.now(), lastTime + 1);
      const at = new Date(lastTime);
      await utimes(temp, at, at);
      await rename(temp, join(folder, name));
    } catch (err) {
      await unlink(temp).catch(() => undefined);
      throw err;
    }
  }

  async function write(folder: string, file: ServedFile, chunks: ServedChunk[]): Promise<void> {
    await mkdir(folder, { recursive: true });
    const name = `taleart.${file.hash}.js`;
    await place(folder, name, file.hash, file.body);
    // The chunks go in after the entry: a build is whole once its entry is there. Their names are
    // content-hashed, and each is kept under the build's hash, so a pinned page loads its own chunks.
    for (const chunk of chunks) await place(folder, `taleart.${file.hash}.${chunk.name}`, file.hash, chunk.file.body);
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
    const evicted = builds.slice(Math.max(0, keep - 1));
    for (const { name } of evicted) {
      await unlink(join(folder, name)).catch((err) => {
        if (!isMissing(err)) throw err;
      });
      readers.delete(name.slice('taleart.'.length, -'.js'.length));
    }
    // A chunk goes with its build: the chunks of a build no longer kept are removed.
    const kept = new Set(
      [current, ...builds.slice(0, Math.max(0, keep - 1)).map((b) => b.name)].map((n) =>
        n.slice('taleart.'.length, 'taleart.'.length + 16),
      ),
    );
    for (const name of await readdir(folder)) {
      const chunk = BUILD_CHUNK.exec(name);
      if (chunk && !kept.has(chunk[1] ?? '')) await unlink(join(folder, name)).catch(() => undefined);
    }
  }

  return {
    record(file, chunks = []) {
      if (!dir) return Promise.resolve();
      const folder = dir;
      const done = queue
        .then(() => write(folder, file, chunks))
        .catch((err) => warn(`Web SDK builds in ${folder}: build ${file.hash} was not kept`, err));
      queue = done;
      return done;
    },
    async readChunk(name) {
      if (!dir || !CHUNK.test(name)) return null;
      // A chunk of the build kept under the same name: the newest such, as the builds' own order.
      const entries = (await readdir(dir).catch(() => [] as string[])).filter(
        (entry) => BUILD_CHUNK.exec(entry)?.[2] === name,
      );
      const entry = entries.sort((a, b) => a.localeCompare(b))[0];
      if (!entry) return null;
      let reader = chunkReaders.get(entry);
      if (!reader) {
        reader = servedFile(join(dir, entry));
        chunkReaders.set(entry, reader);
      }
      const file = await reader();
      if (!file) chunkReaders.delete(entry);
      return file;
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
      readers.delete(hash);
      readers.set(hash, reader);
      // The least recently read goes first.
      while (readers.size > keep) readers.delete(readers.keys().next().value as string);
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
  /** A chunk of the bundle by its name: from the current build's folder, else from a kept build; else null. */
  chunk(name: string): Promise<ServedFile | null>;
}

/** How long the bundle file must stay unchanged before its build is kept for pinned URLs. */
export const SDK_STABLE_MS = 1000;

/**
 * The current bundle, read again when it changes, with each build it holds recorded in `builds`
 * once its file has held still for `stableMs` (at start and after each rebuild or deploy); a build
 * read sooner is recorded by a timer when it has. Recording runs beside the request: `builds` tells
 * its failures.
 */
export function sdkSource(
  bundleFile: string,
  builds: SdkBuilds = sdkBuilds(null, 1),
  stableMs = SDK_STABLE_MS,
): SdkSource {
  const read = servedFile(bundleFile);
  // The bundle's folder holds its chunks, which the build serves by name.
  const folder = dirname(bundleFile);
  const chunkReaders = new Map<string, () => Promise<ServedFile | null>>();
  let recorded: ServedFile | null = null;
  let waiting: ReturnType<typeof setTimeout> | null = null;
  const current = async (): Promise<ServedFile | null> => {
    const file = await read();
    if (file && file !== recorded) {
      const age = Date.now() - (file.mtimeMs ?? 0);
      if (age >= stableMs) {
        recorded = file;
        void siblingChunks(folder).then((chunks) => builds.record(file, chunks));
      } else if (!waiting) {
        waiting = setTimeout(() => {
          waiting = null;
          void current();
        }, stableMs - age + 10);
        waiting.unref();
      }
    }
    return file;
  };
  return {
    current,
    async pinned(hash) {
      const file = await current();
      return file && file.hash === hash ? file : builds.read(hash);
    },
    async chunk(name) {
      if (!CHUNK.test(name)) return null;
      let reader = chunkReaders.get(name);
      if (!reader) {
        reader = servedFile(join(folder, name));
        chunkReaders.set(name, reader);
      }
      const file = await reader();
      if (file) return file;
      chunkReaders.delete(name);
      return builds.readChunk(name);
    },
  };
}

/** The chunks of the bundle's folder, as the build keeps them (each read whole), by name. */
async function siblingChunks(folder: string): Promise<ServedChunk[]> {
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => CHUNK.test(name));
  const chunks = await Promise.all(
    names.map(async (name) => {
      const file = await servedFile(join(folder, name))();
      return file ? { name, file } : null;
    }),
  );
  return chunks.filter((chunk): chunk is ServedChunk => chunk !== null);
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
export function installInfo(publicApiUrl: string, bundle: ServedFile | null, buildsKept = 1): InstallInfo {
  const apiUrl = origin(publicApiUrl);
  return {
    apiUrl,
    sdkUrl: `${apiUrl}${SDK_BUNDLE_PATH}`,
    sdkPinnedUrl: bundle ? `${apiUrl}${SDK_BASE}/taleart.${bundle.hash}.js` : null,
    sdkIntegrity: bundle ? bundle.integrity : null,
    sdkBuildsKept: buildsKept,
    testPageUrl: `${apiUrl}${SDK_TEST_PAGE_PATH}`,
  };
}

export function installRouter(publicApiUrl: string, bundle: () => Promise<ServedFile | null>, buildsKept = 1): Router {
  const router = Router();
  router.get('/', async (_req, res, next) => {
    try {
      res.json(installInfo(publicApiUrl, await bundle(), buildsKept));
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
 * one zone with it (epic UX rework R13). No session and no key: both are public. The page reads a
 * zone key (`tak_…`, which names the zone) from the URL fragment `#zoneKey=` or a field on the page; the server
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
      if (CHUNK.test(req.params.name) && !Object.prototype.hasOwnProperty.call(PAGE_FILES, req.params.name)) {
        // A chunk of the bundle, named by its content: the current build's, or a kept build's.
        const file = await sdk.chunk(req.params.name);
        if (!file) {
          res.set('Cache-Control', 'no-store');
          return notFound(res);
        }
        return await sendBundle(req, res, file, `public, max-age=${SDK_PINNED_CACHE_SECONDS}, immutable`);
      }
      const pinned = PINNED.exec(req.params.name);
      if (pinned) {
        // The current build or one of the last ones kept (story 8.21); any other hash is unknown.
        const file = await sdk.pinned(pinned[1]);
        if (!file) {
          // Not kept here (yet, or any more): a cache must ask again, not remember the 404.
          res.set('Cache-Control', 'no-store');
          return notFound(res);
        }
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
 * The builds folder and how many builds it keeps (story 8.21): SDK_BUILDS_DIR (unset or empty:
 * `.data/sdk-builds`, resolved by `resolvePath`; `off`, `false`, `none`, `no` or `0`, in any case,
 * keep only the current build, which counts as keeping 1) and SDK_BUILDS_KEPT (a whole number from
 * {@link MIN_SDK_BUILDS_KEPT_WITH_FOLDER} to {@link MAX_SDK_BUILDS_KEPT}, default
 * {@link DEFAULT_SDK_BUILDS_KEPT}). A bad number stops the API at start.
 */
export function sdkBuildsFromEnv(
  env: Record<string, string | undefined>,
  resolvePath: (p: string) => string,
): Pick<SdkFiles, 'buildsDir' | 'buildsKept'> {
  const dir = env['SDK_BUILDS_DIR'] || '.data/sdk-builds';
  if (OFF.has(dir.trim().toLowerCase())) return { buildsDir: null, buildsKept: 1 };
  const kept = env['SDK_BUILDS_KEPT'] || String(DEFAULT_SDK_BUILDS_KEPT);
  if (!/^\d+$/.test(kept) || Number(kept) < MIN_SDK_BUILDS_KEPT_WITH_FOLDER || Number(kept) > MAX_SDK_BUILDS_KEPT) {
    throw new Error(
      `SDK_BUILDS_KEPT must be a whole number from ${MIN_SDK_BUILDS_KEPT_WITH_FOLDER} to ${MAX_SDK_BUILDS_KEPT}, not ${JSON.stringify(kept)} ` +
        '(an old and a new API process both keep their build during a deploy; SDK_BUILDS_DIR=off keeps only the current one)',
    );
  }
  return { buildsDir: resolvePath(dir), buildsKept: Number(kept) };
}

// SDK_BUILDS_DIR values that keep no earlier builds, in any case.
const OFF = new Set(['off', 'false', 'none', '0', 'no']);

/**
 * True when the builds folder holds at least one kept build. The API warns at start in production
 * when it does not: after a first deploy, an empty folder means it does not persist across deploys
 * (a container without a volume), and every earlier pinned URL answers 404.
 */
export function hasKeptBuilds(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => BUILD_FILE.test(name));
  } catch {
    return false;
  }
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
