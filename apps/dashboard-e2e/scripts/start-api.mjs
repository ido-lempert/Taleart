// Starts the built API (dist/apps/api) for the dashboard end-to-end tests, on a fresh database.
//
// E2E_DATABASE_URL names the database. Its name must end in `_test`: it is dropped and created again
// first, so the run starts on an empty install (the first admin's setup). Media go to a new
// temporary folder. Playwright starts this as a web server (see playwright.config.mts).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const root = resolve(import.meta.dirname, '../../..');
const url = process.env.E2E_DATABASE_URL ?? '';
let name = '';
try {
  name = decodeURIComponent(new URL(url).pathname.slice(1));
} catch {
  // Said below.
}
if (!/^[a-z0-9_]+_test$/.test(name)) {
  console.error('E2E_DATABASE_URL must name a database whose name ends in _test (it is dropped and created again).');
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.href });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
} finally {
  await client.end();
}

process.env.DATABASE_URL = url;
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'taleart-e2e-media-'));
await import(pathToFileURL(join(root, 'dist/apps/api/main.js')).href);
