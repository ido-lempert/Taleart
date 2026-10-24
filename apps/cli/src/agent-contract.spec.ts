// What scripts and agents (story 10.4's skill) rely on: one JSON document per stream, no prompts
// without a person, exact names for destructive commands, structured help, safe config handling.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { run } from './cli';
import { insecureUrlWarning, writeConfig } from './config';
import { EXIT } from './errors';
import { promptLine } from './prompt';
import { fakeIo, PROJECT, TOKEN, type Call } from './testing';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'taleart-cli-agent-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function env(extra: Record<string, string> = {}) {
  return { TALEART_API_URL: 'http://localhost:9999', TALEART_TOKEN: TOKEN, TALEART_CONFIG_DIR: dir, ...extra };
}

function api(extra: (call: Call) => { status: number; body?: unknown } | undefined = () => undefined) {
  return (call: Call) => extra(call) ?? (call.method === 'GET' && call.path === '/projects' ? { status: 200, body: [PROJECT] } : undefined);
}

/** True when the text is exactly one JSON document. */
function oneJson(text: string): unknown {
  return JSON.parse(text);
}

const ZONE = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Home top',
  slug: 'home-top',
  projectId: PROJECT.id,
  createdFromTemplate: null,
  firstVisibleAt: null,
  visibility: { visible: false, reasons: [] },
  frame: { id: 'f', zoneId: '66666666-6666-4666-8666-666666666666', projectId: PROJECT.id, type: 'bar', settings: { gap: 12 } },
};

const FRAME_TYPES = [
  { key: 'bar', label: 'Bar', schema: { properties: { gap: { type: 'integer', default: 12 }, shape: { enum: ['circle'], default: 'circle' } } } },
  {
    key: 'banner',
    label: 'Banner',
    schema: { properties: { aspectRatio: { enum: ['16:9', '3:1'], default: '16:9' }, autoplay: { type: 'boolean', default: true }, intervalSeconds: { type: 'integer', default: 5 } } },
  },
];

describe('--json: one document on stdout, at most one on stderr', () => {
  it('a success with warnings writes them as one JSON document on stderr; the result stays as it is', async () => {
    const io = fakeIo(api(), { env: env({ TALEART_API_URL: 'http://api.example.com' }) });
    expect(await run(['projects', 'list', '--json'], io)).toBe(EXIT.ok);
    expect(oneJson(io.stdoutText)).toEqual([PROJECT]);
    expect(oneJson(io.stderrText)).toEqual({ warnings: [expect.stringContaining('plain http')] });
    const quiet = fakeIo(api(), { env: env() });
    await run(['projects', 'list', '--json'], quiet);
    expect(quiet.stderrText).toBe('');
  });

  it('a failure folds the warnings into the error document', async () => {
    const io = fakeIo(() => ({ status: 500, body: { error: { code: 'internal', message: 'Boom' } } }), {
      env: env({ TALEART_API_URL: 'http://api.example.com' }),
    });
    expect(await run(['projects', 'list', '--json'], io)).toBe(EXIT.server);
    expect(oneJson(io.stderrText)).toMatchObject({ error: { code: 'internal', exitCode: 8 }, warnings: [expect.stringContaining('plain http')] });
  });

  it('groups tags says "Created tag" to people only', async () => {
    const GROUP = { id: '55555555-5555-4555-8555-555555555555', projectId: PROJECT.id, name: 'Summer', tags: [], tagMatch: 'any' };
    const route = api((c) => {
      if (c.method === 'GET' && c.path === `/tale-groups/${GROUP.id}`) return { status: 200, body: GROUP };
      if (c.method === 'GET' && c.path === `/projects/${PROJECT.id}/tags`) return { status: 200, body: [] };
      if (c.method === 'POST' && c.path === `/projects/${PROJECT.id}/tags`) return { status: 201, body: { id: 'tag1', projectId: PROJECT.id, name: 'vip' } };
      if (c.method === 'PUT') return { status: 200, body: { ...GROUP, tags: [{ id: 'tag1', name: 'vip' }] } };
      return undefined;
    });
    const asJson = fakeIo(route, { env: env() });
    expect(await run(['groups', 'tags', GROUP.id, '--tag', 'vip', '--json'], asJson)).toBe(EXIT.ok);
    expect(asJson.stderrText).toBe('');
    const text = fakeIo(route, { env: env() });
    expect(await run(['groups', 'tags', GROUP.id, '--tag', 'vip'], text)).toBe(EXIT.ok);
    expect(text.stderrText).toBe('Created tag vip\n');
  });

  it('a group without a command: JSON help on stdout, the error on stderr, exit 2', async () => {
    const io = fakeIo();
    expect(await run(['zones', '--json'], io)).toBe(EXIT.usage);
    expect(oneJson(io.stdoutText)).toMatchObject({ group: 'zones', commands: expect.any(Array) });
    expect(oneJson(io.stderrText)).toMatchObject({ error: { code: 'usage', exitCode: 2 } });
  });
});

describe('structured help', () => {
  it('help commands --json describes every command for an agent', async () => {
    const io = fakeIo();
    expect(await run(['help', 'commands', '--json'], io)).toBe(EXIT.ok);
    const help = JSON.parse(io.stdoutText) as {
      version: string;
      globalOptions: { name: string; type: string }[];
      commands: { command: string; mutates: boolean; auth: boolean; destructive: boolean; result: string; globalFlags: string[]; options: { name: string; type: string; valueName?: string; required: boolean; repeatable: boolean }[] }[];
    };
    expect(help.globalOptions.map((o) => o.name)).toEqual(['json', 'yes', 'project', 'api-url', 'help', 'version']);
    for (const c of help.commands) {
      expect(typeof c.mutates, c.command).toBe('boolean');
      expect(typeof c.auth).toBe('boolean');
      expect(c.result.length).toBeGreaterThan(0);
      expect(c.globalFlags).toContain('--json');
      if (c.destructive) expect(c.globalFlags).toContain('--yes');
    }
    const byName = Object.fromEntries(help.commands.map((c) => [c.command, c]));
    expect(byName['zones list']).toMatchObject({ mutates: false, auth: true, destructive: false, result: 'Zone[]' });
    expect(byName['groups on']).toMatchObject({ mutates: true, result: 'TaleGroup' });
    expect(byName['tales delete']).toMatchObject({ mutates: true, destructive: true });
    expect(byName['config path']).toMatchObject({ mutates: false, auth: false });
    expect(byName['zones display'].options.find((o) => o.name === 'set')).toEqual(
      expect.objectContaining({ name: 'set', type: 'string', valueName: '<key=value>', required: false, repeatable: true }),
    );
  });

  it('help exit-codes and help output answer structured JSON', async () => {
    const codes = fakeIo();
    await run(['help', 'exit-codes', '--json'], codes);
    const list = JSON.parse(codes.stdoutText) as { code: number; name: string }[];
    expect(list.map((c) => c.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(list[10]).toMatchObject({ name: 'confirm' });
    const output = fakeIo();
    await run(['help', 'output', '--json'], output);
    expect(JSON.parse(output.stdoutText)).toMatchObject({ errorDocument: expect.any(Object), cliErrorCodes: expect.arrayContaining(['ambiguous', 'not_confirmed']) });
  });
});

describe('confirmations', () => {
  const TALE = { id: '44444444-4444-4444-8444-444444444444', title: 'one', storedStatus: 'live', status: 'live' };
  const route = api((c) => {
    if (c.method === 'GET' && c.path === `/tales/${TALE.id}`) return { status: 200, body: TALE };
    if (c.method === 'DELETE') return { status: 204 };
    return undefined;
  });

  it('the end of input at a question is "Not confirmed" (exit 10), nothing deleted', async () => {
    const io = fakeIo(route, { env: env(), interactive: true, prompt: async () => null });
    expect(await run(['tales', 'delete', TALE.id], io)).toBe(EXIT.confirm);
    expect(io.stderrText).toContain('Not confirmed');
    expect(io.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('reads one line, or null when the input ends first', async () => {
    const ended = new PassThrough();
    const out = new PassThrough();
    const pending = promptLine(ended, out, 'Sure? ');
    ended.end();
    expect(await pending).toBeNull();
    const answered = new PassThrough();
    const reply = promptLine(answered, new PassThrough(), 'Sure? ');
    answered.write('yes\n');
    expect(await reply).toBe('yes');
  });

  it('CI=true and TALEART_NO_INPUT=1 never ask, even at a terminal', async () => {
    for (const extra of [{ CI: 'true' }, { TALEART_NO_INPUT: '1' }]) {
      const asked: string[] = [];
      const io = fakeIo(route, { env: env(extra), interactive: true, prompt: async (q) => (asked.push(q), 'y') });
      expect(await run(['tales', 'delete', TALE.id], io)).toBe(EXIT.confirm);
      expect(asked).toEqual([]);
    }
  });

  it('zones update --slug needs --yes; a rename does not; the zone must be named exactly', async () => {
    const zoneRoute = api((c) => {
      if (c.method === 'GET' && c.path === '/zones') return { status: 200, body: [ZONE] };
      if (c.method === 'PATCH') return { status: 200, body: { ...ZONE, ...(c.body as object) } };
      return undefined;
    });
    const refused = fakeIo(zoneRoute, { env: env() });
    expect(await run(['zones', 'update', 'home-top', '--slug', 'top', '--json'], refused)).toBe(EXIT.confirm);
    expect(refused.calls.some((c) => c.method === 'PATCH')).toBe(false);
    const renamed = fakeIo(zoneRoute, { env: env() });
    expect(await run(['zones', 'update', 'home-top', '--name', 'Top'], renamed)).toBe(EXIT.ok);
    const sloppy = fakeIo(zoneRoute, { env: env() });
    expect(await run(['zones', 'update', 'HOME-TOP', '--slug', 'top', '--yes'], sloppy)).toBe(EXIT.notFound);
    const exact = fakeIo(zoneRoute, { env: env() });
    expect(await run(['zones', 'update', 'home-top', '--slug', 'top', '--yes', '--json'], exact)).toBe(EXIT.ok);
    expect(exact.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { slug: 'top' } });
  });

  it('destructive commands take exact names: a list called VIPs is not "vips"', async () => {
    const LIST = { id: '77777777-7777-4777-8777-777777777777', projectId: PROJECT.id, name: 'VIPs', idCount: 3 };
    const listRoute = api((c) => (c.method === 'GET' && c.path === `/projects/${PROJECT.id}/user-lists` ? { status: 200, body: [LIST] } : c.method === 'DELETE' ? { status: 204 } : undefined));
    const loose = fakeIo(listRoute, { env: env({ TALEART_PROJECT: PROJECT.id }) });
    expect(await run(['user-lists', 'get', 'vips', '--json'], loose)).toBe(EXIT.ok);
    const del = fakeIo(listRoute, { env: env({ TALEART_PROJECT: PROJECT.id }) });
    expect(await run(['user-lists', 'delete', 'vips', '--yes'], del)).toBe(EXIT.notFound);
    expect(del.calls.some((c) => c.method === 'DELETE')).toBe(false);
    const project = fakeIo(api((c) => (c.method === 'DELETE' ? { status: 204 } : undefined)), { env: env({ TALEART_PROJECT: 'shop' }) });
    expect(await run(['site-keys', 'revoke', '--yes'], project)).toBe(EXIT.notFound);
  });

  it('the site key confirmation names the project', async () => {
    const asked: string[] = [];
    const io = fakeIo(api((c) => (c.method === 'POST' ? { status: 201, body: { key: 'tas_x', prefix: 'tas_x', createdAt: 'now' } } : undefined)), {
      env: env({ TALEART_PROJECT: PROJECT.id }),
      interactive: true,
      prompt: async (q) => (asked.push(q), 'y'),
    });
    expect(await run(['site-keys', 'rotate'], io)).toBe(EXIT.ok);
    expect(asked[0]).toContain(`"Shop" (${PROJECT.id})`);
  });
});

describe('tokens never echoed, and handled with care', () => {
  it('a token in the wrong place is redacted from usage errors', async () => {
    for (const asJson of [false, true]) {
      const io = fakeIo(undefined, { env: env() });
      expect(await run(['zones', 'list', TOKEN, ...(asJson ? ['--json'] : [])], io)).toBe(EXIT.usage);
      expect(io.stderrText).toContain('tat_[REDACTED]');
      expect(io.stderrText).not.toContain('SECRET');
    }
  });

  it('login --token always warns; --token-stdin refuses a terminal', async () => {
    const io = fakeIo(api(), { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['login', '--url', 'http://localhost:3333', '--token', TOKEN], io)).toBe(EXIT.ok);
    expect(io.stderrText).toContain('warning: --token leaves the token in your shell history');
    const tty = fakeIo(api(), { env: { TALEART_CONFIG_DIR: dir }, stdinIsTTY: true, readStdin: async () => TOKEN });
    expect(await run(['login', '--url', 'http://localhost:3333', '--token-stdin'], tty)).toBe(EXIT.usage);
    expect(tty.stderrText).toContain('stdin is a terminal');
    expect(tty.calls).toHaveLength(0);
  });

  it('warns before sending a token over plain http to another machine', () => {
    expect(insecureUrlWarning('http://localhost:3333')).toBeNull();
    expect(insecureUrlWarning('http://127.0.0.1:3333')).toBeNull();
    expect(insecureUrlWarning('http://[::1]:3333')).toBeNull();
    expect(insecureUrlWarning('https://api.example.com')).toBeNull();
    expect(insecureUrlWarning('http://api.example.com')).toMatch(/plain http/);
  });
});

describe('the config file', () => {
  it('leaves the mode of a folder it did not create, and leaves no temporary file', () => {
    const shared = join(dir, 'shared');
    mkdirSync(shared, { mode: 0o755 });
    chmodSync(shared, 0o755);
    writeConfig(join(shared, 'config.json'), shared, { token: TOKEN });
    writeConfig(join(shared, 'config.json'), shared, { token: TOKEN, project: 'p' });
    expect(statSync(shared).mode & 0o777).toBe(0o755);
    expect(statSync(join(shared, 'config.json')).mode & 0o777).toBe(0o600);
    expect(readdirSync(shared)).toEqual(['config.json']);
  });

  it('logout and config path work with a corrupt file; other commands stop on it', async () => {
    writeFileSync(join(dir, 'config.json'), '{ not json', { mode: 0o600 });
    const path = fakeIo(undefined, { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['config', 'path', '--json'], path)).toBe(EXIT.ok);
    expect(JSON.parse(path.stdoutText)).toEqual({ configFile: join(dir, 'config.json') });
    const show = fakeIo(undefined, { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['config', 'show'], show)).toBe(EXIT.usage);
    const out = fakeIo(undefined, { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['logout'], out)).toBe(EXIT.ok);
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
  });
});

describe('answers that break off', () => {
  it('a 2xx whose body cannot be read is exit 9: the change may or may not have been made', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
        controller.error(new Error('socket hang up'));
      },
    });
    const io = fakeIo(undefined, { env: env(), fetch: async () => new Response(broken, { status: 201 }) });
    expect(await run(['projects', 'create', '--name', 'X', '--json'], io)).toBe(EXIT.network);
    expect(JSON.parse(io.stderrText).error).toMatchObject({ code: 'response_interrupted', status: 201, exitCode: 9 });
  });
});

describe('zones display with a new type', () => {
  it('merges --set into the new type\'s defaults from /frame-types', async () => {
    const route = api((c) => {
      if (c.method === 'GET' && c.path === '/zones') return { status: 200, body: [ZONE] };
      if (c.method === 'GET' && c.path === '/frame-types') return { status: 200, body: FRAME_TYPES };
      if (c.method === 'PATCH') return { status: 200, body: { ...ZONE.frame, ...(c.body as object) } };
      return undefined;
    });
    const io = fakeIo(route, { env: env() });
    expect(await run(['zones', 'display', ZONE.id, '--type', 'banner', '--set', 'intervalSeconds=7', '--json'], io)).toBe(EXIT.ok);
    expect(io.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      body: { type: 'banner', settings: { aspectRatio: '16:9', autoplay: true, intervalSeconds: 7 } },
    });
  });
});
