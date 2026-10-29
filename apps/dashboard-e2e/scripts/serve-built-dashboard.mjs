// Serves the BUILT dashboard (dist/apps/dashboard/browser, `nx run dashboard:build:development`) for the
// dashboard end-to-end tests, on E2E_DASHBOARD_PORT, with /api proxied to the e2e API on E2E_API_PORT.
// The alternative to serve-dashboard.mjs (the dev server), opt-in with E2E_BUILT_DASHBOARD=1 (see
// playwright.config.mts): it runs without Nx, so it needs no task lock on dashboard:serve:development.
// The origin stays the dashboard's own port, so the passkey RP settings of start-api.mjs still match.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const apiPort = Number(process.env.E2E_API_PORT || 3413);
const port = Number(process.env.E2E_DASHBOARD_PORT || 4313);
const dashboardDir = join(root, 'dist/apps/dashboard/browser');

if (!existsSync(join(dashboardDir, 'index.csr.html'))) {
  console.error(`${dashboardDir} has no index.csr.html: build the dashboard first (pnpm nx run dashboard:build:development).`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  // The API: the same paths and headers (cookies included) as the dev server's proxy sends it.
  if (req.url?.startsWith('/api/')) {
    const proxied = httpRequest({ host: 'localhost', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    proxied.on('error', () => res.writeHead(502).end());
    return req.pipe(proxied);
  }
  // A file of the build by its path; the app's shell for every other path (client-side routes).
  const url = new URL(req.url ?? '/', 'http://localhost');
  const file = normalize(join(dashboardDir, decodeURIComponent(url.pathname)));
  const served = file.startsWith(dashboardDir) && existsSync(file) && statSync(file).isFile() ? file : join(dashboardDir, 'index.csr.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(served)] ?? 'application/octet-stream' });
  createReadStream(served).pipe(res);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
server.listen(port, 'localhost', () => console.log(`built dashboard on http://localhost:${port}, /api to ${apiPort}`));
