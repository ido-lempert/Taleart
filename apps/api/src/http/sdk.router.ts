import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SDK_BUNDLE_PATH, SDK_TEST_PAGE_PATH, type InstallInfo } from '@taleart/contract';
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

/** The API's public origin, without a trailing slash. */
function origin(publicApiUrl: string): string {
  return publicApiUrl.replace(/\/+$/, '');
}

/** The install URLs the dashboard's Install tab shows (`GET /api/v1/install`). */
export function installInfo(publicApiUrl: string): InstallInfo {
  const apiUrl = origin(publicApiUrl);
  return { apiUrl, sdkUrl: `${apiUrl}${SDK_BUNDLE_PATH}`, testPageUrl: `${apiUrl}${SDK_TEST_PAGE_PATH}` };
}

export function installRouter(publicApiUrl: string): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json(installInfo(publicApiUrl));
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

interface Served {
  body: Buffer;
  etag: string;
}

// Each file is read once; a file that is missing is read again on the next request.
function cachedFile(path: string): () => Promise<Served | null> {
  let served: Served | null = null;
  return async () => {
    if (served) return served;
    try {
      const body = await readFile(path);
      served = { body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"` };
      return served;
    } catch {
      return null;
    }
  };
}

function notFound(res: Response): void {
  res.status(404).type('text/plain; charset=utf-8').send('Not found');
}

/**
 * `/sdk/v1`: the Web SDK bundle a host page loads with `<script type="module" src="…/taleart.js">`,
 * and the TaleArt-served test page that renders one zone with it (epic UX rework R13). No session
 * and no key: both are public. The page reads the zone's slug from `?zone=` and a site key from the
 * URL fragment or a field on the page; the server never sees the key, and nothing of the request
 * goes into what it sends.
 */
export function sdkRouter(files: SdkFiles, publicApiUrl: string): Router {
  const router = Router();
  const bundle = cachedFile(files.bundleFile);
  const pages = new Map(
    Object.entries(PAGE_FILES).map(([name, { file, type }]) => [name, { read: cachedFile(join(files.pagesDir, file)), type }]),
  );
  const csp = testPageCsp(publicApiUrl);

  router.get('/taleart.js', async (_req, res, next) => {
    try {
      const file = await bundle();
      if (!file) return notFound(res);
      res.set({
        'Content-Type': 'text/javascript; charset=utf-8',
        // Any page loads it, as a module script, so it is fetched with CORS (open on every API route).
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        // A deploy replaces it at the same URL: pages pick the new one up within five minutes.
        'Cache-Control': 'public, max-age=300',
        ETag: file.etag,
      });
      // send answers 304 to a matching If-None-Match.
      res.send(file.body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:name', async (req, res, next) => {
    try {
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

  return router;
}

/**
 * Where the build puts the bundle and the test page, next to the API's code in `dir`
 * (`dist/apps/api`; under tests, `apps/api/src`, which holds the page but no bundle).
 */
export function defaultSdkFiles(dir: string): SdkFiles {
  return { bundleFile: join(dir, 'web-sdk', 'index.js'), pagesDir: join(dir, 'sdk-pages') };
}
