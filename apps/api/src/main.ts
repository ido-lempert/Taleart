import { join, resolve } from 'node:path';
import { SimpleWebAuthnVerifier } from '@taleart/server-access';
import { LocalDiskStorage } from '@taleart/server-storage';
import { loadFrameTypeRegistry } from '@taleart/server-zones';
import { createApp, MANAGEMENT_API_BASE } from './app';
import { relyingPartyFromEnv, secureCookiesFor } from './auth-config';
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

  // Media files live under MEDIA_DIR (default .data/media, from the folder the
  // API starts in: the repo root under nx serve). The database holds only keys (AD-11).
  const storage = new LocalDiskStorage(resolve(process.env['MEDIA_DIR'] || '.data/media'));
  log('info', `Storing media in ${storage.root}`);

  // Passkeys are bound to RP_ID and RP_ORIGIN, the dashboard's domain and origin (AD-9).
  const rp = relyingPartyFromEnv();
  log('info', `Passkeys for ${rp.origin} (RP ID ${rp.id})`);
  const auth = {
    verifier: new SimpleWebAuthnVerifier(rp),
    secureCookies: secureCookiesFor(rp),
    dashboardOrigin: rp.origin,
  };

  const port = process.env['PORT'] || 3333;
  const server = createApp(pool, frameTypes, storage, auth).listen(port, () => {
    log('info', `Listening at http://localhost:${port}${MANAGEMENT_API_BASE}`);
  });
  server.on('error', (err) => log('error', 'server error', err));
}

start().catch((err) => {
  log('error', 'startup failed', err);
  process.exit(1);
});
