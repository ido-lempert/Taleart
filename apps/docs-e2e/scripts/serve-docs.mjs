// Serves the built docs (dist/apps/docs/browser, `nx run docs:build`) on E2E_DOCS_PORT, as a static
// host would: a file by its path, a folder by its index.html (each page is prerendered there), and
// the prerendered not-found page with 404 for anything else. For the docs end-to-end tests
// (playwright.config.mts); never the development server.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../../../dist/apps/docs/browser');
const port = Number(process.env.E2E_DOCS_PORT);
if (!port) {
  console.error('E2E_DOCS_PORT is required.');
  process.exit(1);
}
if (!existsSync(join(root, 'index.html'))) {
  console.error(`${root} has no index.html: build the docs first (nx run docs:build).`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function fileFor(urlPath) {
  const path = normalize(join(root, decodeURIComponent(urlPath)));
  if (path !== root && !path.startsWith(root + sep)) return null;
  if (existsSync(path) && statSync(path).isFile()) return path;
  const index = join(path, 'index.html');
  return existsSync(index) ? index : null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file = null;
  try {
    file = fileFor(pathname);
  } catch {
    file = null;
  }
  const status = file ? 200 : 404;
  file ??= join(root, 'not-found/index.html');
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}).listen(port, () => console.log(`docs on http://localhost:${port}`));
