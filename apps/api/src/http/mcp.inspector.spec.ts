import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The MCP server checked the way an MCP client checks it: the official MCP Inspector's CLI, run against the
// built API (dist/apps/api, which `nx test api` builds first) with a real database. The Inspector is a
// client written apart from the server's own SDK code, so a failure here is one a real client would see.

const REPO = join(__dirname, '../../../..');
const API_MAIN = join(REPO, 'dist/apps/api/main.js');
const INSPECTOR = join(REPO, 'node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js');
// Its own database: the API's spec files clear their shared test database while this one runs in parallel.
const SHARED_TEST_DATABASE = process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
const DATABASE = (() => {
  const url = new URL(SHARED_TEST_DATABASE);
  url.pathname = `/${url.pathname.slice(1).replace(/_test$/, '')}_mcp_inspector_test`;
  return url.toString();
})();
const MCP_PATH = '/api/v1/mcp/sse';

if (!new URL(SHARED_TEST_DATABASE).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
}

// A 1×1 PNG, as base64.
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const pool = new Pool({ connectionString: DATABASE, max: 2 });
const userId = randomUUID();
const email = `mcp-inspector-${userId}@example.com`;
const fullToken = newToken();
const readOnlyToken = newToken();
let server: ChildProcess | undefined;
let baseUrl = '';

function newToken(): string {
  return `tat_${randomBytes(32).toString('base64url')}`;
}

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

/** Starts the built API on a free port and resolves once it logs that it listens (after its migrations). */
function startApi(port: number, cwd: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [API_MAIN], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      PUBLIC_API_URL: `http://127.0.0.1:${port}`,
      DATABASE_URL: DATABASE,
      MEDIA_DIR: join(cwd, 'media'),
      SDK_BUILDS_DIR: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((done, fail) => {
    let log = '';
    const timer = setTimeout(() => fail(new Error(`the API did not start:\n${log}`)), 60_000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes('Listening at')) {
        clearTimeout(timer);
        done(child);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => fail(new Error(`the API exited with ${code}:\n${log}`)));
  });
}

interface Inspected {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** One run of the Inspector CLI against the SSE endpoint, as a CI job would call it. */
function inspect(args: string[], token?: string): Inspected {
  const header = token === undefined ? [] : ['--header', `Authorization: Bearer ${token}`];
  const run = spawnSync(
    process.execPath,
    [INSPECTOR, '--cli', `${baseUrl}${MCP_PATH}`, '--transport', 'sse', '--stored-auth-only', '--format', 'json', ...header, ...args],
    { encoding: 'utf8', timeout: 90_000 },
  );
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** The text a tool returned, parsed: call_operation answers with { status, body }. */
function toolResult(run: Inspected): { status: number; body: unknown } {
  const parsed = JSON.parse(run.stdout) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(parsed.result.content[0]?.text ?? '{}');
}

function callOperation(operationId: string): string[] {
  return ['--method', 'tools/call', '--tool-name', 'call_operation', '--tool-arg', `operationId=${operationId}`];
}

beforeAll(async () => {
  if (!existsSync(API_MAIN)) throw new Error('dist/apps/api/main.js is missing: build the API first (nx build api)');
  const admin = new Pool({ connectionString: SHARED_TEST_DATABASE, max: 1 });
  try {
    const name = new URL(DATABASE).pathname.slice(1);
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const cwd = mkdtempSync(join(tmpdir(), 'taleart-mcp-inspector-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = await startApi(port, cwd);

  // The API migrated its schema before it listened; the user is an admin, so the tokens see every project.
  await pool.query(
    `INSERT INTO users (id, name, email, role, webauthn_user_id, created_at)
     VALUES ($1, 'MCP Inspector check', $2, 'admin', $3, now())`,
    [userId, email, `wa-${userId}`],
  );
  await pool.query(
    `INSERT INTO api_tokens (user_id, name, token_hash, prefix, all_projects, read_only)
     VALUES ($1, 'mcp-inspector full', $2, $3, true, false), ($1, 'mcp-inspector read-only', $4, $5, true, true)`,
    [userId, hash(fullToken), fullToken.slice(0, 10), hash(readOnlyToken), readOnlyToken.slice(0, 10)],
  );
}, 120_000);

afterAll(async () => {
  server?.kill();
  await pool.query('DELETE FROM api_tokens WHERE user_id = $1', [userId]).catch(() => undefined);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
  await pool.end();
});

describe('the MCP server, checked with the MCP Inspector CLI', () => {
  it('lists the three tools to a token that may write', { timeout: 90_000 }, () => {
    const run = inspect(['--method', 'tools/list'], fullToken);
    expect(run.status, run.stderr).toBe(0);
    const names = (JSON.parse(run.stdout) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(names.sort()).toEqual(['call_operation', 'list_operations', 'upload_media']);
  });

  it('calls an operation as the token’s user', { timeout: 90_000 }, () => {
    const run = inspect(callOperation('listProjects'), fullToken);
    expect(run.status, run.stderr).toBe(0);
    const result = toolResult(run);
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it('lets a read-only token connect and read, and refuses its writes', { timeout: 90_000 }, () => {
    const list = inspect(['--method', 'tools/list'], readOnlyToken);
    expect(list.status, list.stderr).toBe(0);

    const read = inspect(callOperation('listProjects'), readOnlyToken);
    expect(read.status, read.stderr).toBe(0);
    expect(toolResult(read).status).toBe(200);

    const write = inspect(callOperation('createProject'), readOnlyToken);
    // A refused write is a tool error (exit 5); the tool's own answer says it was the API's 403.
    expect(write.status, write.stdout).toBe(5);
    expect(JSON.parse(write.stdout).result.content[0].text).toContain('"status": 403');
  });

  it('uploads an image to a project through upload_media, and a read-only token is refused', { timeout: 90_000 }, async () => {
    const { rows } = await pool.query<{ id: string }>(`INSERT INTO projects (name) VALUES ('MCP upload check') RETURNING id`);
    const projectId = rows[0]!.id;
    const upload = (token: string) =>
      inspect(
        [
          '--method', 'tools/call', '--tool-name', 'upload_media',
          '--tool-arg', `projectId=${projectId}`, '--tool-arg', 'contentType=image/png', '--tool-arg', `dataBase64=${PNG_1X1_BASE64}`,
        ],
        token,
      );

    const written = upload(fullToken);
    expect(written.status, written.stderr).toBe(0);
    const result = toolResult(written);
    expect(result.status).toBe(201);
    expect((result.body as { key: string }).key).toMatch(/^media\/[0-9a-f-]+\.png$/);

    const refused = upload(readOnlyToken);
    expect(refused.status).toBe(5);
    expect(JSON.parse(refused.stdout).result.content[0].text).toContain('"status": 403');
  });

  it('saves a tale with an https image and video address, and refuses a plain http one', { timeout: 90_000 }, () => {
    return pool.query<{ id: string }>(`INSERT INTO projects (name) VALUES ('MCP external media') RETURNING id`).then(({ rows: projects }) => {
      const projectId = projects[0]!.id;
      const call = (operationId: string, pathParams: Record<string, string>, body?: unknown): Inspected =>
        inspect([
          '--method', 'tools/call', '--tool-name', 'call_operation', '--tool-arg', `operationId=${operationId}`,
          '--tool-arg', `pathParams=${JSON.stringify(pathParams)}`,
          ...(body === undefined ? [] : ['--tool-arg', `body=${JSON.stringify(body)}`]),
        ], fullToken);
      const outcome = (run: Inspected) => {
        const result = toolResult(run);
        expect(result.status, run.stdout).toBeLessThan(400);
        return result;
      };

      const group = outcome(call('createProjectTaleGroup', { projectId }, { name: 'External media' }));
      expect(group.status).toBe(201);
      const taleGroupId = (group.body as { id: string }).id;
      const tale = outcome(call('createTale', { taleGroupId }, { title: 'External' }));
      expect(tale.status).toBe(201);
      const taleId = (tale.body as { id: string }).id;

      const document = (elements: unknown[]) => ({
        version: 1,
        canvas: { background: { type: 'color', color: '#000000' } },
        elements,
      });
      const element = (id: string, type: 'image' | 'video', props: Record<string, unknown>) => ({
        id,
        type,
        box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: { label: 'A picture from another site' },
        props: { fit: 'cover', ...props },
      });
      const image = 'https://images.example.com/sunny-field.jpg';
      const video = 'https://videos.example.com/clip.mp4';
      // A save names the revision it is based on: the draft's, as a read returns it.
      const revision = (outcome(call('getTaleDocument', { taleId })).body as { revision: number }).revision;
      const saved = outcome(
        call('saveTaleDocument', { taleId }, {
          revision,
          document: document([element(randomUUID(), 'image', { externalUrl: image }), element(randomUUID(), 'video', { externalUrl: video })]),
        }),
      );
      expect(saved.status).toBeGreaterThanOrEqual(200);
      expect(saved.status).toBeLessThan(300);

      const read = outcome(call('getTaleDocument', { taleId }));
      expect(read.status).toBe(200);
      const elements = (read.body as { document: { elements: Array<{ props: { externalUrl?: string; mediaKey?: string } }> } }).document.elements;
      expect(elements.map((e) => e.props.externalUrl)).toEqual([image, video]);
      expect(elements.some((e) => e.props.mediaKey !== undefined)).toBe(false);

      const refused = call('saveTaleDocument', { taleId }, {
        revision: revision + 1,
        document: document([element(randomUUID(), 'image', { externalUrl: 'http://images.example.com/a.jpg' })]),
      });
      expect(toolResult(refused).status).toBe(400);
      expect(refused.stdout).toContain('externalUrl');
    });
  });

  it('refuses a connection without a token', { timeout: 90_000 }, () => {
    const run = inspect(['--method', 'tools/list']);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('auth_required');
  });

  it('refuses a connection with a token it does not know', { timeout: 90_000 }, () => {
    const run = inspect(['--method', 'tools/list'], 'tat_unknown0000000000000000000000000000000000');
    expect(run.status).toBe(3);
  });
});
