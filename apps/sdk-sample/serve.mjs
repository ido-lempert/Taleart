// Serves the SDK sample page and the built SDK (dist/libs/web-sdk under /sdk/).
// Plain Node, no dependencies; run through `nx run sdk-sample:serve` (port 4300).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '../..');
const pageDir = resolve(root, 'apps/sdk-sample');
const sdkDir = resolve(root, 'dist/libs/web-sdk');
const port = Number(process.env.PORT) || 4300;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

// The page's icons, served from the page folder by name.
const ICONS = new Set(['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png']);

// The file under `dir` for `path`, or null when the path would leave it.
function within(dir, path) {
  const file = resolve(dir, normalize(`.${sep}${path}`));
  return file.startsWith(dir + sep) ? file : null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let sdkPath = null;
  if (pathname.startsWith('/sdk/')) {
    try {
      sdkPath = decodeURIComponent(pathname.slice('/sdk/'.length));
    } catch {
      // A malformed escape names no file.
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
  }
  const file =
    pathname === '/' || pathname === '/index.html'
      ? join(pageDir, 'index.html')
      : ICONS.has(pathname)
        ? join(pageDir, pathname.slice(1))
        : sdkPath !== null
        ? within(sdkDir, sdkPath)
        : null;
  try {
    if (!file) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const data = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    // Compressed, as a host's CDN serves the SDK, so the perf measurement sees realistic transfer sizes.
    if (type.startsWith('text/') && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
      res.end(gzipSync(data));
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
    res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'Not found' : 'Error');
  }
}).listen(port, () => {
  console.log(`SDK sample at http://localhost:${port}/?api=http://localhost:3333#zoneKeys=<key>,<key>`);
});
