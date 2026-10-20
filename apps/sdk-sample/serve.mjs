// Serves the SDK sample page and the built SDK (dist/libs/web-sdk under /sdk/).
// Plain Node, no dependencies; run through `nx run sdk-sample:serve` (port 4300).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pageDir = resolve(root, 'apps/sdk-sample');
const sdkDir = resolve(root, 'dist/libs/web-sdk');
const port = Number(process.env.PORT) || 4300;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

// The file under `dir` for `path`, or null when the path would leave it.
function within(dir, path) {
  const file = resolve(dir, normalize(`.${sep}${path}`));
  return file.startsWith(dir + sep) ? file : null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file =
    pathname === '/' || pathname === '/index.html'
      ? join(pageDir, 'index.html')
      : pathname.startsWith('/sdk/')
        ? within(sdkDir, decodeURIComponent(pathname.slice('/sdk/'.length)))
        : null;
  try {
    if (!file) throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch (err) {
    const missing = err.code === 'ENOENT' || err.code === 'EISDIR';
    res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'Not found' : 'Error');
  }
}).listen(port, () => {
  console.log(`SDK sample at http://localhost:${port}/?key=<zone key>&api=http://localhost:3333`);
});
