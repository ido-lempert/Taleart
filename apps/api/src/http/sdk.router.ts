import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SDK_BASE, SDK_BUNDLE_PATH, SDK_TEST_PAGE_PATH, type InstallInfo } from '@taleart/contract';
import { Router, type Response } from 'express';

/** Where the API finds what it serves under `/sdk/v1` (epic UX rework R13). */
export interface SdkFiles {
  /**
   * The built Web SDK bundle (`dist/libs/web-sdk/index.js`, an ES module). The API build copies it
   * next to `main.js` as `web-sdk/index.js`; WEB_SDK_FILE overrides it. Missing: 404.
   */
  bundleFile: string;
  /** The folder of the test page's own files (`test-page.html`, `.js`, `.css`). */
  pagesDir: string;
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
      const body = await readFile(path);
      const sha256 = createHash('sha256').update(body).digest('base64url');
      const file = {
        body,
        etag: `"${sha256.slice(0, 27)}"`,
        hash: sha256.slice(0, 16),
        integrity: `sha384-${createHash('sha384').update(body).digest('base64')}`,
      };
      served = { file, mtimeMs, size };
      return file;
    } catch {
      served = null;
      return null;
    }
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
export function sdkRouter(files: SdkFiles, publicApiUrl: string, bundle = servedFile(files.bundleFile)): Router {
  const router = Router({ strict: true });
  const pages = new Map(
    Object.entries(PAGE_FILES).map(([name, { file, type }]) => [name, { read: servedFile(join(files.pagesDir, file)), type }]),
  );
  const csp = testPageCsp(publicApiUrl);

  const sendBundle = (res: Response, file: ServedFile, cacheControl: string) => {
    res.set({
      'Content-Type': 'text/javascript; charset=utf-8',
      // Any page loads it, as a module script, so it is fetched with CORS (open on every API route).
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControl,
      ETag: file.etag,
    });
    // send answers 304 to a matching If-None-Match.
    res.send(file.body);
  };

  router.get('/taleart.js', async (_req, res, next) => {
    try {
      const file = await bundle();
      if (!file) return notFound(res);
      // A deploy replaces it at the same URL: pages pick the new one up within five minutes.
      sendBundle(res, file, 'public, max-age=300');
    } catch (err) {
      next(err);
    }
  });

  router.get('/:name', async (req, res, next) => {
    try {
      const pinned = PINNED.exec(req.params.name);
      if (pinned) {
        const file = await bundle();
        // Only the current build: an old hash is gone with its build.
        if (!file || file.hash !== pinned[1]) return notFound(res);
        return sendBundle(res, file, 'public, max-age=31536000, immutable');
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
  return { bundleFile: join(dir, 'web-sdk', 'index.js'), pagesDir: join(dir, 'sdk-pages') };
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
