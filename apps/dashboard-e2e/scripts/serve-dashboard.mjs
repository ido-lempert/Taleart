// Serves the dashboard for the end-to-end tests on E2E_DASHBOARD_PORT, its /api proxied to the API
// the tests started on E2E_API_PORT. Only the dashboard: `--excludeTaskDependencies` keeps
// `dashboard:serve` from starting an API of its own on the development database.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const apiPort = Number(process.env.E2E_API_PORT);
const port = Number(process.env.E2E_DASHBOARD_PORT);
if (!apiPort || !port) {
  console.error('E2E_API_PORT and E2E_DASHBOARD_PORT are required.');
  process.exit(1);
}

const proxy = join(mkdtempSync(join(tmpdir(), 'taleart-e2e-proxy-')), 'proxy.json');
writeFileSync(proxy, JSON.stringify({ '/api': { target: `http://localhost:${apiPort}`, secure: false } }));

const child = spawn(
  join(root, 'node_modules/.bin/nx'),
  ['run', 'dashboard:serve:development', '--excludeTaskDependencies', `--port=${port}`, `--proxy-config=${proxy}`],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NX_DAEMON: 'false' } },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
