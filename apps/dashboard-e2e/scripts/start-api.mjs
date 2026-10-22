// Starts the built API (dist/apps/api) for the dashboard end-to-end tests, on a fresh database.
//
// E2E_DATABASE_URL names the database (see e2e-database.mjs for what it must be): it is dropped and
// created again first, so the run starts on an empty install (the first admin's setup). The API runs
// as a child with only the settings below, never the caller's (WEB_SDK_FILE, IMPORT_TOKEN_KEY,
// TRUST_PROXY…). Media go to a new temporary folder. Playwright starts this as a web server (see
// playwright.config.mts).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { e2eDatabase } from './e2e-database.mjs';

const root = resolve(import.meta.dirname, '../../..');
let database;
try {
  database = e2eDatabase(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const admin = new pg.Client({ ...database.config, database: 'postgres' });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${database.name}"`);
} finally {
  await admin.end();
}

const env = {
  PATH: process.env.PATH ?? '',
  DATABASE_URL: database.url,
  PORT: process.env.PORT ?? '',
  PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? '',
  RP_ORIGIN: process.env.RP_ORIGIN ?? '',
  RP_ID: process.env.RP_ID ?? '',
  MEDIA_DIR: mkdtempSync(join(tmpdir(), 'taleart-e2e-media-')),
};
const child = spawn(process.execPath, [join(root, 'dist/apps/api/main.js')], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
