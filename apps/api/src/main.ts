import { join } from 'node:path';
import { loadFrameTypeRegistry } from '@taleart/server-zones';
import { createApp, MANAGEMENT_API_BASE } from './app';
import { createPool, migrate } from './db';

// Structured JSON to stdout, one line per entry (spine logging convention).
function log(level: 'info' | 'error', msg: string, err?: unknown): void {
  const entry: Record<string, unknown> = { level, msg };
  if (err !== undefined) {
    entry['error'] = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err);
  }
  console.log(JSON.stringify(entry));
}

async function start(): Promise<void> {
  const pool = createPool();
  await migrate(pool);
  // The build copies libs/contract/frame-types next to main.js. Read at every
  // start, so a new registry entry and schema need only a restart (AD-5).
  const frameTypes = loadFrameTypeRegistry(join(__dirname, 'frame-types'));

  const port = process.env['PORT'] || 3333;
  const server = createApp(pool, frameTypes).listen(port, () => {
    log('info', `Listening at http://localhost:${port}${MANAGEMENT_API_BASE}`);
  });
  server.on('error', (err) => log('error', 'server error', err));
}

start().catch((err) => {
  log('error', 'startup failed', err);
  process.exit(1);
});
