// Runs the built CLI (dist/apps/cli/taleart.js) against the built API (dist/apps/api/main.js) on a
// fresh test database, with tokens made in that database as the access module makes them (only their
// SHA-256 hash is stored). `nx run cli:test` builds both first.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

const root = join(__dirname, '../../..');
const cliPath = join(root, 'dist/apps/cli/taleart.js');
const apiPath = join(root, 'dist/apps/api/main.js');

// The API's own tests empty TEST_DATABASE_URL's tables, and may run at the same time: this test uses
// its own database next to it, `<name>_cli_test`, dropped and created again on each run.
const testDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
const base = parseConnectionString(testDatabaseUrl);
if (!base.database?.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
const databaseName = base.database.replace(/_test$/, '_cli_test');
const databaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

/** A real PNG of one colour (the API checks only its first bytes; the SDK draws it). */
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

let api: ChildProcess | undefined;
let apiLog = '';
let apiUrl = '';
let work = '';
let mediaDir = '';
let readWrite = '';
let readOnly = '';
let revoked = '';

function token(): string {
  return `tat_${randomBytes(32).toString('base64url')}`;
}

async function insertTokens(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['CLI admin', 'cli-admin@example.com', 'admin', randomBytes(32).toString('base64url')],
    );
    readWrite = token();
    readOnly = token();
    revoked = token();
    for (const [name, value, ro, revokedAt] of [
      ['cli read-write', readWrite, false, null],
      ['cli read-only', readOnly, true, null],
      ['cli revoked', revoked, false, new Date()],
    ] as const) {
      await client.query(
        `INSERT INTO api_tokens (user_id, name, token_hash, prefix, all_projects, read_only, revoked_at)
         VALUES ($1, $2, $3, $4, true, $5, $6)`,
        [rows[0].id, name, createHash('sha256').update(value, 'utf8').digest('hex'), value.slice(0, 10), ro, revokedAt],
      );
    }
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  for (const file of [cliPath, apiPath]) {
    if (!existsSync(file)) throw new Error(`${file} is missing: run nx run cli:test, which builds the CLI and the API first`);
  }
  const admin = new pg.Client({ connectionString: testDatabaseUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
  work = mkdtempSync(join(tmpdir(), 'taleart-cli-it-'));
  mediaDir = mkdtempSync(join(tmpdir(), 'taleart-cli-media-'));
  const port = await freePort();
  apiUrl = `http://localhost:${port}`;
  api = spawn(process.execPath, [apiPath], {
    cwd: root,
    env: {
      PATH: process.env['PATH'] ?? '',
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      PUBLIC_API_URL: apiUrl,
      MEDIA_DIR: mediaDir,
      SDK_BUILDS_DIR: 'off',
      RP_ORIGIN: 'http://localhost:4999',
      RP_ID: 'localhost',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout?.on('data', (d) => (apiLog += d));
  api.stderr?.on('data', (d) => (apiLog += d));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (api.exitCode !== null) throw new Error(`The API exited:\n${apiLog}`);
    const up = await fetch(`${apiUrl}/api/v1/health`).then((r) => r.ok, () => false);
    if (up) break;
    if (Date.now() > deadline) throw new Error(`The API did not start:\n${apiLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  await insertTokens();
  writeFileSync(join(work, 'one.png'), png(8, 8, [220, 40, 40]));
  writeFileSync(join(work, 'two.png'), png(8, 8, [40, 40, 220]));
  writeFileSync(join(work, 'ids.csv'), 'user_id\nu-1\nu-2\nu-2\n\ntwo,columns\n');
});

afterAll(async () => {
  if (api && api.exitCode === null) {
    const exited = new Promise((r) => api?.once('exit', r));
    api.kill('SIGTERM');
    await exited;
  }
  for (const folder of [work, mediaDir]) if (folder) rmSync(folder, { recursive: true, force: true });
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  json: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  error: () => { code: string; message: string; status?: number; exitCode: number };
}

/** Runs the built CLI as a script would: no terminal, its own config folder. */
function cli(args: string[], options: { token?: string | null; env?: Record<string, string>; input?: string; configDir?: string } = {}): Result {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: work,
    TALEART_CONFIG_DIR: options.configDir ?? join(work, 'config-none'),
    TALEART_API_URL: apiUrl,
    ...(options.token !== null && { TALEART_TOKEN: options.token ?? readWrite }),
    ...options.env,
  };
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: work, env, input: options.input ?? '', encoding: 'utf8' });
  for (const secret of [readWrite, readOnly, revoked]) {
    if (result.stdout.includes(secret) || result.stderr.includes(secret)) throw new Error(`taleart ${args.join(' ')} printed a token`);
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout),
    error: () => JSON.parse(result.stderr).error,
  };
}

function ok(result: Result): Result {
  if (result.code !== 0) throw new Error(`exit ${result.code}\n${result.stderr}`);
  return result;
}

describe('taleart against a test API', () => {
  let projectId = '';
  const inProject = () => ({ env: { TALEART_PROJECT: projectId } });

  it('is one runnable file with a shebang, executable', () => {
    expect(readFileSync(cliPath, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(statSync(cliPath).mode & 0o111).not.toBe(0);
    const direct = spawnSync(cliPath, ['--version'], { encoding: 'utf8' });
    expect(direct.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('creates a zone with a bar, a group with two image tales from files, turns it On, and Delivery shows it', async () => {
    projectId = ok(cli(['projects', 'create', '--name', 'CLI test', '--json'])).json().id;
    const zone = ok(cli(['zones', 'create', '--name', 'Home top', '--slug', 'home-top', '--json'], inProject())).json();
    expect(zone).toMatchObject({ slug: 'home-top', frame: null, projectId });

    const frame = ok(cli(['zones', 'display', 'home-top', '--type', 'bar', '--set', 'gap=8', '--set', 'shape=rounded-square', '--json'], inProject())).json();
    expect(frame).toMatchObject({ type: 'bar', zoneId: zone.id, settings: { gap: 8, shape: 'rounded-square' } });
    // The same type again keeps the other settings.
    const changed = ok(cli(['zones', 'display', 'home-top', '--set', 'size=large', '--json'], inProject())).json();
    expect(changed.settings).toMatchObject({ gap: 8, shape: 'rounded-square', size: 'large' });

    const group = ok(cli(['groups', 'create', '--name', 'Summer', '--zone', 'home-top', '--json'], inProject())).json();
    expect(group).toMatchObject({ name: 'Summer', storedStatus: 'draft', position: 0 });
    const tales = ok(cli(['tales', 'create', '--group', 'Summer', 'one.png', 'two.png', '--json'], inProject())).json();
    expect(tales.map((t: { title: string }) => t.title)).toEqual(['one', 'two']);
    expect(tales.every((t: { media: { contentType: string } }) => t.media.contentType === 'image/png')).toBe(true);
    const on = ok(cli(['groups', 'on', 'Summer', '--json'], inProject())).json();
    expect(on.storedStatus).toBe('live');

    const issued = ok(cli(['site-keys', 'issue', '--json'], inProject())).json();
    expect(issued.key).toMatch(/^tas_/);
    const again = cli(['site-keys', 'issue', '--json'], inProject());
    expect(again.code).toBe(6);
    expect(again.error().code).toBe('site_key_exists');

    const delivery = await fetch(`${apiUrl}/delivery/v1/zone?zone=home-top`, { headers: { Authorization: `Bearer ${issued.key}` } });
    expect(delivery.status).toBe(200);
    const delivered = (await delivery.json()) as { frame: { type: string }; taleGroups: { name: string; tales: unknown[] }[] };
    expect(delivered.frame.type).toBe('bar');
    expect(delivered.taleGroups.map((g) => g.name)).toEqual(['Summer']);
    expect(delivered.taleGroups[0].tales).toHaveLength(2);

    const listed = ok(cli(['zones', 'get', 'home-top', '--json'], inProject())).json();
    expect(listed.visibility.visible).toBe(true);
    const zoneKey = ok(cli(['zone-keys', 'issue', 'home-top', '--json'], inProject())).json();
    expect(zoneKey.key).toMatch(/^tak_/);
    const snippet = ok(cli(['zones', 'snippet', 'home-top', '--zone-key', zoneKey.key, '--json'], inProject())).json();
    expect(snippet.snippet).toContain(`zone-key="${zoneKey.key}"`);
    expect(snippet.snippet).not.toContain('site-key');
    expect(snippet.testPageUrl).toBe(`${apiUrl}/sdk/v1/test-page#zoneKey=${encodeURIComponent(zoneKey.key)}`);
    const twice = cli(['zone-keys', 'issue', 'home-top', '--json'], inProject());
    expect(twice.error().code).toBe('zone_key_exists');
    ok(cli(['zone-keys', 'revoke', 'home-top', '--yes', '--json'], inProject()));
    expect(ok(cli(['zone-keys', 'info', 'home-top', '--json'], inProject())).json()).toBeNull();
    const page = await fetch(snippet.testPageUrl.split('#')[0]);
    expect(page.status).toBe(200);
  });

  it('reads as tables for people', () => {
    const text = ok(cli(['groups', 'list'], inProject())).stdout;
    expect(text).toMatch(/^ID\s+NAME\s+STATUS/);
    expect(text).toMatch(/Summer\s+On\s+2/);
    expect(ok(cli(['groups', 'list', '--zone', 'home-top'], inProject())).stdout).toMatch(/0\s+\S+\s+Summer\s+On\s+2\s+yes/);
  });

  it('sets tags and match mode, copies a group and places it', () => {
    const tagged = ok(cli(['groups', 'tags', 'Summer', '--tag', 'vip', '--tag', 'beta', '--match', 'all', '--json'], inProject())).json();
    expect(tagged.tags.map((t: { name: string }) => t.name).sort()).toEqual(['beta', 'vip']);
    expect(tagged.tagMatch).toBe('all');
    const matchOnly = ok(cli(['groups', 'tags', 'Summer', '--match', 'any', '--json'], inProject())).json();
    expect(matchOnly.tags).toHaveLength(2);

    ok(cli(['zones', 'create', '--name', 'Footer', '--template', 'promo-banner', '--json'], inProject()));
    const copy = ok(cli(['groups', 'copy', 'Summer', '--zone', 'footer', '--json'], inProject())).json();
    expect(copy.name).toBe('Summer');
    expect(copy.tales).toHaveLength(2);
    // Two groups are now named Summer: a name is ambiguous, the id is not.
    const ambiguous = cli(['groups', 'get', 'Summer', '--json'], inProject());
    expect(ambiguous.code).toBe(6);
    expect(ambiguous.error().code).toBe('ambiguous');
    const placed = ok(cli(['groups', 'place', copy.id, '--zone', 'home-top', '--json'], inProject())).json();
    expect(placed.position).toBe(1);
    ok(cli(['groups', 'unplace', copy.id, '--zone', 'home-top', '--json'], inProject()));
    expect(ok(cli(['groups', 'list', '--zone', 'home-top', '--json'], inProject())).json()).toHaveLength(1);
  });

  it('hides, shows and deletes a tale, deleting only with --yes', () => {
    const [group] = ok(cli(['groups', 'list', '--zone', 'home-top', '--json'], inProject())).json();
    const [first] = group.tales;
    expect(ok(cli(['tales', 'hide', first.id, '--json'])).json().storedStatus).toBe('paused');
    expect(ok(cli(['tales', 'show', first.id, '--json'])).json().storedStatus).toBe('live');
    const refused = cli(['tales', 'delete', first.id, '--json']);
    expect(refused.code).toBe(10);
    expect(refused.error().code).toBe('confirmation_required');
    expect(ok(cli(['tales', 'list', '--group', group.id, '--json'])).json()).toHaveLength(2);
    expect(ok(cli(['tales', 'delete', first.id, '--yes', '--json'])).json()).toEqual({ deleted: true, id: first.id });
    expect(ok(cli(['tales', 'list', '--group', group.id, '--json'])).json()).toHaveLength(1);
    const gone = cli(['tales', 'get', first.id, '--json']);
    expect(gone.code).toBe(5);
    expect(gone.error().code).toBe('tale_not_found');
  });

  it('creates a user list, uploads a CSV and deletes it', () => {
    const list = ok(cli(['user-lists', 'create', '--name', 'VIPs', '--json'], inProject())).json();
    expect(list.idCount).toBe(0);
    const report = ok(cli(['user-lists', 'upload', 'VIPs', 'ids.csv', '--header', '--json'], inProject())).json();
    expect(report).toMatchObject({ added: 2, alreadyPresent: 1, refused: 1, idCount: 2 });
    expect(ok(cli(['user-lists', 'get', 'VIPs', '--json'], inProject())).json().idCount).toBe(2);
    expect(cli(['user-lists', 'delete', 'VIPs'], inProject()).code).toBe(10);
    ok(cli(['user-lists', 'delete', 'VIPs', '--yes'], inProject()));
    expect(ok(cli(['user-lists', 'list', '--json'], inProject())).json()).toEqual([]);
  });

  it('rotates and revokes the site key only with --yes', () => {
    expect(cli(['site-keys', 'rotate'], inProject()).code).toBe(10);
    const rotated = ok(cli(['site-keys', 'rotate', '--yes', '--json'], inProject())).json();
    expect(rotated.key).toMatch(/^tas_/);
    expect(ok(cli(['site-keys', 'get', '--json'], inProject())).json().prefix).toBe(rotated.prefix);
    ok(cli(['site-keys', 'revoke', '--yes', '--json'], inProject()));
    expect(ok(cli(['site-keys', 'get', '--json'], inProject())).json()).toBeNull();
  });

  it('a read-only token reads but cannot change anything (exit 4); whoami says so', () => {
    expect(ok(cli(['zones', 'list', '--json'], { token: readOnly, ...inProject() })).json().length).toBe(2);
    const refused = cli(['zones', 'create', '--name', 'Nope', '--json'], { token: readOnly, ...inProject() });
    expect(refused.code).toBe(4);
    expect(refused.error()).toMatchObject({ code: 'forbidden', status: 403 });
    // whoami reads GET /api-tokens/current.
    expect(ok(cli(['whoami', '--json'], { token: readOnly })).json()).toMatchObject({
      name: 'cli read-only',
      readOnly: true,
      allProjects: true,
      projectIds: null,
      expiresAt: null,
      tokenPrefix: readOnly.slice(0, 10),
      tokenSource: 'env',
      user: { name: 'CLI admin', email: 'cli-admin@example.com', role: 'admin' },
    });
    const writer = ok(cli(['whoami']));
    expect(writer.stdout).toMatch(/user:\s+CLI admin <cli-admin@example.com> \(admin\)/);
    expect(writer.stdout).toMatch(/access:\s+read-write/);
    expect(writer.stderr).toBe('');
  });

  it('a revoked or unknown token is exit 3; no token at all is exit 3 before any request', () => {
    for (const bad of [revoked, token()]) {
      const result = cli(['projects', 'list', '--json'], { token: bad });
      expect(result.code).toBe(3);
      expect(result.error()).toMatchObject({ code: 'unauthenticated', status: 401 });
    }
    expect(cli(['projects', 'list', '--json'], { token: null }).error().code).toBe('no_token');
  });

  it('login stores the URL and token 0600, and later commands use them', () => {
    const configDir = join(work, 'config-login');
    const login = ok(cli(['login', '--url', `${apiUrl}/api/v1`, '--token-stdin', '--json'], { token: null, env: { TALEART_API_URL: '' }, input: readWrite, configDir }));
    expect(login.json()).toMatchObject({ apiUrl, tokenPrefix: readWrite.slice(0, 10) });
    const file = join(configDir, 'config.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    ok(cli(['projects', 'use', 'CLI test'], { token: null, env: { TALEART_API_URL: '' }, configDir }));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ apiUrl, token: readWrite, project: projectId });
    const zones = ok(cli(['zones', 'list', '--json'], { token: null, env: { TALEART_API_URL: '' }, configDir })).json();
    expect(zones.map((z: { slug: string }) => z.slug).sort()).toEqual(['footer', 'home-top']);
    const shown = ok(cli(['config', 'show', '--json'], { token: null, env: { TALEART_API_URL: '' }, configDir })).json();
    expect(shown).toMatchObject({ tokenSource: 'config', apiUrlSource: 'config', project: projectId, projectSource: 'config' });
    ok(cli(['logout'], { token: null, configDir }));
    expect(cli(['zones', 'list'], { token: null, env: { TALEART_API_URL: '' }, configDir }).code).toBe(3);
  });

  it('zones display with a new type merges --set into that type\'s defaults', () => {
    const frame = ok(cli(['zones', 'display', 'footer', '--type', 'bar', '--set', 'gap=20', '--json'], inProject())).json();
    expect(frame).toMatchObject({ type: 'bar', settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 20 } });
    const back = ok(cli(['zones', 'display', 'footer', '--type', 'banner', '--set', 'intervalSeconds=7', '--json'], inProject())).json();
    expect(back).toMatchObject({ type: 'banner', settings: { aspectRatio: '16:9', autoplay: true, intervalSeconds: 7, showDots: true, loop: true } });
  });

  it('a failed upload deletes the tale it made, and the error names what was created', async () => {
    // A proxy in front of the API that refuses the second media upload, as a full disk would.
    let uploads = 0;
    const proxy = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', async () => {
        if (req.method === 'PUT' && req.url?.endsWith('/media') && ++uploads === 2) {
          res.writeHead(507, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ error: { code: 'internal', message: 'Insufficient storage' } }));
          return;
        }
        const headers = Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k)),
        ) as Record<string, string>;
        const answer = await fetch(`${apiUrl}${req.url}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        });
        const body = Buffer.from(await answer.arrayBuffer());
        res.writeHead(answer.status, { 'Content-Type': answer.headers.get('content-type') ?? 'application/json' });
        res.end(body);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    try {
      const group = ok(cli(['groups', 'create', '--name', 'Partial', '--json'], inProject())).json();
      const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [cliPath, 'tales', 'create', '--group', group.id, 'one.png', 'two.png', '--json'], {
          cwd: work,
          env: { PATH: process.env['PATH'] ?? '', TALEART_CONFIG_DIR: join(work, 'config-none'), TALEART_API_URL: proxyUrl, TALEART_TOKEN: readWrite },
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => (stdout += d));
        child.stderr?.on('data', (d) => (stderr += d));
        child.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      });
      expect(result.code, result.stderr).toBe(8);
      expect(result.stdout).toBe('');
      const error = JSON.parse(result.stderr);
      expect(error.error).toMatchObject({ code: 'internal', status: 507, file: 'two.png' });
      expect(error.error.created.map((t: { title: string }) => t.title)).toEqual(['one']);
      expect(error.error.leftWithoutMedia).toBeUndefined();
      // Only the tale whose media arrived is left.
      expect(ok(cli(['tales', 'list', '--group', group.id, '--json'])).json().map((t: { title: string }) => t.title)).toEqual(['one']);
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  });

  it('stops quietly when its reader goes away (EPIPE)', async () => {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [cliPath, 'help', 'commands'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => (stderr += d));
      child.stdout?.destroy();
      child.on('exit', (code) => resolve({ code, stderr }));
    });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('every command answers --help with exit 0 and no request', () => {
    const { commands } = ok(cli(['help', 'commands', '--json'], { token: null })).json() as { commands: { command: string }[] };
    expect(commands.length).toBeGreaterThan(30);
    for (const { command } of commands) {
      const result = cli([...command.split(' '), '--help'], { token: null, env: { TALEART_API_URL: 'http://127.0.0.1:9' } });
      expect(result.code, command).toBe(0);
      expect(result.stdout).toContain(`Usage: taleart ${command}`);
    }
  });

  it('seed-demo refuses an install that has projects, dry-runs, and with --force makes the demo project once', () => {
    const refused = cli(['seed-demo', '--json']);
    expect(refused.code).toBe(6);
    expect(refused.error().code).toBe('seed_refused');

    const dry = ok(cli(['seed-demo', '--dry-run', '--force', '--json'])).json();
    expect(dry).toMatchObject({ status: 'dry-run', project: { name: 'Spring Campaign' }, counts: { zones: 3, taleGroups: 5, tales: 13 } });

    const readOnlyRun = cli(['seed-demo', '--force', '--json'], { token: readOnly });
    expect(readOnlyRun.code).toBe(4);

    const made = ok(cli(['seed-demo', '--force', '--json'])).json();
    expect(made).toMatchObject({ status: 'created', project: { name: 'Spring Campaign' }, counts: { zones: 3, taleGroups: 5, tales: 13 } });
    const zones = ok(cli(['zones', 'list', '--project', made.project.id, '--json'])).json();
    expect(zones.map((z: { name: string }) => z.name).sort()).toEqual(['Collection posters', 'Home stories', 'Sale banner']);
    const groups = ok(cli(['groups', 'list', '--project', made.project.id, '--json'])).json();
    expect(groups).toHaveLength(5);

    // The marker is the project's name: a second run changes nothing.
    const again = ok(cli(['seed-demo', '--json'])).json();
    expect(again).toMatchObject({ status: 'exists', project: { id: made.project.id } });
  });
});
