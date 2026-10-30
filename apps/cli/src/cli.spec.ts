import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandWords, locate, parseCommand } from './args';
import { run } from './cli';
import type { CommandSpec } from './command';
import { GROUPS, TOP_COMMANDS } from './commands';
import { parseSettings } from './commands/zones';
import { configDir, normalizeApiUrl, readConfig, resolveConfig, writeConfig } from './config';
import { EXIT, exitCodeForStatus } from './errors';
import { errorJson, record, table } from './output';
import { CliError } from './errors';
import { fakeIo, PROJECT, TOKEN, type Call } from './testing';
import { VERSION } from './version';

// A PNG's first bytes, which is all the CLI and the API check.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'taleart-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** An Io with a token in the environment and the config in the test's folder. */
function env(extra: Record<string, string> = {}) {
  return { TALEART_API_URL: 'http://localhost:9999', TALEART_TOKEN: TOKEN, TALEART_CONFIG_DIR: dir, ...extra };
}

/** A group's command, by name. */
function spec(group: string, name: string): CommandSpec {
  const found = GROUPS.find((g) => g.name === group)?.commands.find((c) => c.name === name);
  if (!found) throw new Error(`No command ${group} ${name}`);
  return found;
}

const allCommands = [
  ...TOP_COMMANDS.map((c) => ({ path: [c.name], spec: c })),
  ...GROUPS.flatMap((g) => g.commands.map((c) => ({ path: [g.name, c.name], spec: c }))),
];

describe('argument parsing', () => {
  it('finds the command words, skipping the values of global flags', () => {
    expect(commandWords(['--project', 'Shop', 'zones', '-p', 'x', 'list', '--json']).words).toEqual(['zones', 'list']);
    expect(commandWords(['zones', 'create', '--', 'tail']).words).toEqual(['zones', 'create']);
  });

  it('locates top-level commands, groups (and aliases) and their commands', () => {
    expect(locate(['whoami', '--json'], GROUPS, TOP_COMMANDS).command?.name).toBe('whoami');
    const located = locate(['--json', 'tale-groups', 'on', 'Summer'], GROUPS, TOP_COMMANDS);
    expect(located.group?.name).toBe('groups');
    expect(located.command?.name).toBe('on');
    expect(located.rest).toEqual(['--json', 'Summer']);
    expect(locate(['zonez'], GROUPS, TOP_COMMANDS).unknown).toBe('zonez');
    expect(locate(['zones', 'nope'], GROUPS, TOP_COMMANDS).unknown).toBe('nope');
  });

  it('parses a command strictly: unknown flags, missing values and arguments are usage errors', () => {
    const create = spec('zones', 'create');
    const parsed = parseCommand(create, ['--name', 'Home top', '--slug=home-top', '--json', '-p', 'Shop']);
    expect(parsed.opts).toMatchObject({ name: 'Home top', slug: 'home-top' });
    expect(parsed.globals).toMatchObject({ json: true, project: 'Shop' });
    expect(() => parseCommand(create, ['--nam', 'x'])).toThrow(/Unknown option '--nam'/);
    expect(() => parseCommand(create, [])).toThrow(/Missing --name/);
    expect(() => parseCommand(create, ['--name', 'x', 'extra'])).toThrow(/Unexpected argument: extra/);
    expect(() => parseCommand(create, ['--name', 'x', '--template', 'carousel'])).toThrow(/--template must be one of stories-bar, promo-banner, blank/);
    expect(() => parseCommand(create, ['--name'])).toThrow(/argument missing/);
  });

  it('collects repeatable flags and variadic arguments', () => {
    const tales = spec('tales', 'create');
    expect(parseCommand(tales, ['--group', 'G', 'a.png', 'b.png']).args['files']).toEqual(['a.png', 'b.png']);
    expect(() => parseCommand(tales, ['--group', 'G'])).toThrow(/Missing <files>/);
    const tags = spec('groups', 'tags');
    expect(parseCommand(tags, ['G', '--tag', 'a', '--tag', 'b']).opts['tag']).toEqual(['a', 'b']);
    const rule = spec('groups', 'rule');
    expect(parseCommand(rule, ['G', '--audience-json', '{"match":"any","conditions":[]}']).opts['audience-json']).toBe(
      '{"match":"any","conditions":[]}',
    );
    expect(parseCommand(rule, ['G', '--clear']).opts['clear']).toBe(true);
    expect(() => parseCommand(rule, ['G', '--audience', '{}'])).toThrow(/Unknown option/);
  });

  it('reads display settings: booleans, numbers, JSON and text', () => {
    expect(parseSettings(['gap=8', 'showTitles=false', 'shape=rounded-square', 'aspectRatio=3:1'], undefined)).toEqual({
      gap: 8,
      showTitles: false,
      shape: 'rounded-square',
      aspectRatio: '3:1',
    });
    expect(parseSettings(['gap=4'], '{"gap":12,"size":"large"}')).toEqual({ gap: 4, size: 'large' });
    expect(() => parseSettings(['gap'], undefined)).toThrow(/key=value/);
    expect(() => parseSettings([], '[1]')).toThrow(/JSON object/);
  });
});

describe('help, version and usage errors', () => {
  it.each(allCommands.map((c) => [c.path.join(' '), c]))('taleart %s --help answers 0 with its usage and examples', async (_, c) => {
    const io = fakeIo();
    expect(await run([...c.path, '--help'], io)).toBe(EXIT.ok);
    expect(io.stdoutText).toContain(`Usage: taleart ${c.path.join(' ')}`);
    expect(io.stdoutText).toContain('--json');
    expect(io.stdoutText).toContain('Examples:');
    expect(c.spec.examples.length).toBeGreaterThan(0);
    expect(io.calls).toHaveLength(0);
    const asJson = fakeIo();
    expect(await run([...c.path, '--help', '--json'], asJson)).toBe(EXIT.ok);
    expect(JSON.parse(asJson.stdoutText)).toMatchObject({ command: c.path.join(' '), destructive: Boolean(c.spec.destructive) });
  });

  it.each(allCommands.map((c) => [c.path.join(' '), c]))('taleart help %s is the same help', async (_, c) => {
    const io = fakeIo();
    expect(await run(['help', ...c.path], io)).toBe(EXIT.ok);
    expect(io.stdoutText).toContain(`Usage: taleart ${c.path.join(' ')}`);
  });

  it('documents --yes on exactly the destructive commands', () => {
    const destructive = allCommands.filter((c) => c.spec.destructive).map((c) => c.path.join(' '));
    expect(destructive.sort()).toEqual(['site-keys revoke', 'site-keys rotate', 'tales delete', 'user-lists delete', 'zone-keys revoke', 'zone-keys rotate', 'zones update']);
  });

  it('has group help, topics and the whole command list as JSON', async () => {
    for (const group of GROUPS) {
      const io = fakeIo();
      expect(await run([group.name, '--help'], io)).toBe(EXIT.ok);
      for (const c of group.commands) expect(io.stdoutText).toContain(c.name);
    }
    for (const topic of ['config', 'output', 'exit-codes', 'concepts', 'commands']) {
      const io = fakeIo();
      expect(await run(['help', topic], io)).toBe(EXIT.ok);
      expect(io.stdoutText.length).toBeGreaterThan(50);
    }
    const io = fakeIo();
    await run(['help', 'commands', '--json'], io);
    expect(JSON.parse(io.stdoutText).commands).toHaveLength(allCommands.length);
    const unknown = fakeIo();
    expect(await run(['help', 'nonsense'], unknown)).toBe(EXIT.usage);
  });

  it('prints its version, the same as its package.json', async () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    const io = fakeIo();
    expect(await run(['--version'], io)).toBe(EXIT.ok);
    expect(io.stdoutText).toBe(`${VERSION}\n`);
    const asJson = fakeIo();
    await run(['--version', '--json'], asJson);
    expect(JSON.parse(asJson.stdoutText)).toEqual({ version: VERSION });
  });

  it('without a command: help on stderr, nothing on stdout, exit 2', async () => {
    for (const argv of [[], ['zones']]) {
      const io = fakeIo();
      expect(await run(argv, io)).toBe(EXIT.usage);
      expect(io.stdoutText).toBe('');
      expect(io.stderrText).toContain('Usage: taleart');
    }
  });

  it('writes errors to stderr, as JSON with --json', async () => {
    const io = fakeIo();
    expect(await run(['zones', 'create', '--nme', 'x', '--json'], io)).toBe(EXIT.usage);
    expect(io.stdoutText).toBe('');
    expect(JSON.parse(io.stderrText)).toMatchObject({ error: { code: 'usage', exitCode: 2 } });
    const text = fakeIo();
    expect(await run(['zones', 'create'], text)).toBe(EXIT.usage);
    expect(text.stderrText).toBe('taleart: Missing --name <name>\n');
  });
});

describe('output', () => {
  it('pads tables and records', () => {
    expect(table([{ a: 'x', b: null }, { a: 'longer', b: true }], [{ label: 'a', value: (r) => r.a }, { label: 'b', value: (r) => r.b }], 'none')).toBe(
      'A       B\nx       -\nlonger  yes',
    );
    expect(table([], [{ label: 'a', value: () => 1 }], 'No rows.')).toBe('No rows.');
    expect(record([['id', 1], ['long label', { x: 1 }]])).toBe('id:         1\nlong label: {"x":1}');
  });

  it('maps statuses to exit codes and writes the error document', () => {
    expect([401, 403, 404, 409, 400, 413, 415, 429, 503].map(exitCodeForStatus)).toEqual([3, 4, 5, 6, 7, 7, 7, 8, 8]);
    expect(JSON.parse(errorJson(new CliError('Taken', EXIT.conflict, 'slug_taken', 409, 'Pick another')))).toEqual({
      error: { code: 'slug_taken', message: 'Taken', status: 409, exitCode: 6, hint: 'Pick another' },
    });
  });
});

describe('configuration', () => {
  it('lives in TALEART_CONFIG_DIR, XDG_CONFIG_HOME or the OS folder', () => {
    expect(configDir({ TALEART_CONFIG_DIR: '/c' }, 'linux', '/h')).toBe('/c');
    expect(configDir({ XDG_CONFIG_HOME: '/x' }, 'darwin', '/h')).toBe('/x/taleart');
    expect(configDir({}, 'linux', '/h')).toBe('/h/.config/taleart');
    expect(configDir({}, 'darwin', '/h')).toBe('/h/Library/Application Support/taleart');
    expect(configDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toContain('taleart');
  });

  it('is written 0600 in a 0700 folder, tightened on every write, and warns when others can read it', () => {
    const folder = join(dir, 'nested');
    const file = join(folder, 'config.json');
    writeConfig(file, folder, { apiUrl: 'http://a', token: TOKEN });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    chmodSync(file, 0o644);
    const warnings: string[] = [];
    expect(readConfig(file, (w) => warnings.push(w), 'linux')).toEqual({ apiUrl: 'http://a', token: TOKEN });
    expect(warnings[0]).toMatch(/can be read by other users/);
    expect(warnings[0]).not.toContain(TOKEN);
    writeConfig(file, folder, { apiUrl: 'http://a', token: TOKEN });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('takes flags, then the environment, then the file; the URL with or without /api/v1', () => {
    const stored = { apiUrl: 'http://file', token: 'tat_file', project: 'p-file' };
    expect(resolveConfig(stored, {}, {}, 'f')).toMatchObject({ apiUrl: 'http://file', tokenSource: 'config', project: 'p-file' });
    expect(resolveConfig(stored, { TALEART_API_URL: 'http://env/api/v1/', TALEART_TOKEN: 'tat_env', TALEART_PROJECT: 'p-env' }, {}, 'f')).toMatchObject({
      apiUrl: 'http://env',
      token: 'tat_env',
      tokenSource: 'env',
      project: 'p-env',
    });
    expect(resolveConfig(stored, { TALEART_PROJECT: 'p-env' }, { apiUrl: 'https://flag:8443', project: 'p-flag' }, 'f')).toMatchObject({
      apiUrl: 'https://flag:8443',
      apiUrlSource: 'flag',
      project: 'p-flag',
      projectSource: 'flag',
    });
    expect(normalizeApiUrl('http://localhost:3333/api/v1')).toBe('http://localhost:3333');
    expect(() => normalizeApiUrl('localhost:3333')).toThrow(/http:\/\//);
  });
});

/** A small fake API: one project, and whatever the test adds. */
function api(extra: (call: Call) => ReturnType<Parameters<typeof fakeIo>[0]> = () => undefined) {
  return (call: Call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.method === 'GET' && call.path === '/projects') return { status: 200, body: [PROJECT] };
    return undefined;
  };
}

describe('the token', () => {
  it('login checks it, stores it 0600 and never prints it', async () => {
    const io = fakeIo(api(), { env: { TALEART_CONFIG_DIR: dir }, readStdin: async () => `${TOKEN}\n` });
    expect(await run(['login', '--url', 'http://api.test/api/v1', '--token-stdin', '--json'], io)).toBe(EXIT.ok);
    const file = join(dir, 'config.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ apiUrl: 'http://api.test', token: TOKEN });
    expect(io.calls[0].headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(io.stdoutText)).toEqual({ apiUrl: 'http://api.test', tokenPrefix: 'tat_abcdef', configFile: file, projects: 1 });
    expect(io.stdoutText + io.stderrText).not.toContain('SECRET');
  });

  it('login refuses something that is not a token, and a token the API refuses, storing nothing', async () => {
    const io = fakeIo(api(), { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['login', '--url', 'http://api.test', '--token', 'tas_sitekey123456789'], io)).toBe(EXIT.usage);
    expect(io.calls).toHaveLength(0);
    const refused = fakeIo(() => ({ status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in first' } } }), {
      env: { TALEART_CONFIG_DIR: dir },
    });
    expect(await run(['login', '--url', 'http://api.test', '--token', TOKEN, '--json'], refused)).toBe(EXIT.auth);
    expect(JSON.parse(refused.stderrText).error).toMatchObject({ code: 'unauthenticated', status: 401, exitCode: 3 });
    expect(() => statSync(join(dir, 'config.json'))).toThrow();
    expect(refused.stderrText).not.toContain('SECRET');
  });

  it('whoami reads GET /api-tokens/current: the user, prefix and scope, never the token, and changes nothing', async () => {
    const current = (readOnly: boolean) =>
      api((c) =>
        c.method === 'GET' && c.path === '/api-tokens/current' ?
          {
            status: 200,
            body: {
              id: 't1',
              name: 'CI reader',
              prefix: 'tat_abcdef',
              projectIds: readOnly ? [PROJECT.id] : null,
              allProjects: !readOnly,
              readOnly,
              createdAt: '2026-10-24T00:00:00Z',
              expiresAt: null,
              lastUsedAt: null,
              user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com', role: 'admin' },
            },
          }
        : undefined,
      );
    const io = fakeIo(current(true), { env: env() });
    expect(await run(['whoami', '--json'], io)).toBe(EXIT.ok);
    expect(JSON.parse(io.stdoutText)).toMatchObject({
      tokenPrefix: 'tat_abcdef',
      tokenSource: 'env',
      name: 'CI reader',
      readOnly: true,
      allProjects: false,
      projectIds: [PROJECT.id],
      expiresAt: null,
      user: { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' },
      projects: [PROJECT],
    });
    expect(io.calls.every((c) => c.method === 'GET')).toBe(true);
    const text = fakeIo(current(false), { env: env() });
    expect(await run(['whoami'], text)).toBe(EXIT.ok);
    expect(text.stdoutText).toMatch(/user:\s+Ada Admin <ada@example.com> \(admin\)/);
    expect(text.stdoutText).toMatch(/access:\s+read-write/);
    expect(text.stdoutText).toMatch(/scope:\s+all of the user's projects/);
    for (const out of [io.stdoutText, io.stderrText, text.stdoutText, text.stderrText]) expect(out).not.toContain('SECRET');
  });

  it('config show and logout never print it; logout keeps the default project', async () => {
    writeConfig(join(dir, 'config.json'), dir, { apiUrl: 'http://api.test', token: TOKEN, project: PROJECT.id });
    const show = fakeIo(undefined, { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['config', 'show', '--json'], show)).toBe(EXIT.ok);
    expect(JSON.parse(show.stdoutText)).toMatchObject({ tokenPrefix: 'tat_abcdef', tokenSource: 'config', project: PROJECT.id });
    expect(show.stdoutText).not.toContain('SECRET');
    const out = fakeIo(undefined, { env: { TALEART_CONFIG_DIR: dir } });
    expect(await run(['logout', '--json'], out)).toBe(EXIT.ok);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual({ project: PROJECT.id });
  });

  it('without a URL or token: exit 3 before any request', async () => {
    const io = fakeIo(api(), { env: { TALEART_CONFIG_DIR: dir, TALEART_API_URL: 'http://api.test' } });
    expect(await run(['projects', 'list', '--json'], io)).toBe(EXIT.auth);
    expect(JSON.parse(io.stderrText).error.code).toBe('no_token');
    expect(io.calls).toHaveLength(0);
  });
});

describe('API errors', () => {
  it('maps the API\'s error body and status, with a hint', async () => {
    const io = fakeIo(api((c) => (c.method === 'POST' && c.path === '/zones' ? { status: 409, body: { error: { code: 'slug_taken', message: 'That slug is taken' } } } : undefined)), {
      env: env({ TALEART_PROJECT: PROJECT.id }),
    });
    expect(await run(['zones', 'create', '--name', 'Home', '--slug', 'home', '--json'], io)).toBe(EXIT.conflict);
    expect(JSON.parse(io.stderrText)).toEqual({ error: { code: 'slug_taken', message: 'That slug is taken', status: 409, exitCode: 6 } });
    expect(io.stdoutText).toBe('');
    expect(io.calls.at(-1)?.body).toEqual({ name: 'Home', slug: 'home', projectId: PROJECT.id });
  });

  it('a 429 says when to try again; an unreachable API is exit 9', async () => {
    const limited = fakeIo(() => ({ status: 429, body: { error: { code: 'rate_limited', message: 'Slow down' } }, headers: { 'Retry-After': '7' } }), { env: env() });
    expect(await run(['projects', 'list'], limited)).toBe(EXIT.server);
    expect(limited.stderrText).toContain('hint: Try again in 7 s.');
    const down = fakeIo(undefined, {
      env: env(),
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
      },
    });
    expect(await run(['projects', 'list', '--json'], down)).toBe(EXIT.network);
    expect(JSON.parse(down.stderrText).error).toMatchObject({ code: 'api_unreachable', exitCode: 9 });
  });

  it('a name that matches nothing is exit 5, several exit 6', async () => {
    const two = [
      { ...PROJECT, id: '22222222-2222-4222-8222-222222222222', name: 'Dup' },
      { ...PROJECT, id: '33333333-3333-4333-8333-333333333333', name: 'Dup' },
    ];
    const route = () => ({ status: 200, body: two });
    const none = fakeIo(route, { env: env() });
    expect(await run(['projects', 'get', 'Nope'], none)).toBe(EXIT.notFound);
    const dup = fakeIo(route, { env: env() });
    expect(await run(['projects', 'get', 'Dup'], dup)).toBe(EXIT.conflict);
    expect(dup.stderrText).toContain('Give the id instead');
  });

  it('a command that needs a project without one is exit 2 with a hint', async () => {
    const io = fakeIo(api(), { env: env() });
    expect(await run(['user-lists', 'list'], io)).toBe(EXIT.usage);
    expect(io.stderrText).toContain('taleart projects use');
  });
});

const TALE = {
  id: '44444444-4444-4444-8444-444444444444',
  taleGroupId: '55555555-5555-4555-8555-555555555555',
  projectId: PROJECT.id,
  title: 'one',
  position: 0,
  status: 'live',
  storedStatus: 'live',
  startsAt: null,
  endsAt: null,
  media: null,
  visibility: { visible: false, reasons: [{ code: 'group-off', subject: 'group' }] },
};

describe('confirmations', () => {
  const route = api((c) => {
    if (c.path === `/tales/${TALE.id}` && c.method === 'GET') return { status: 200, body: TALE };
    if (c.path === `/tales/${TALE.id}` && c.method === 'DELETE') return { status: 204 };
    return undefined;
  });

  it('a destructive command without --yes and no terminal stops with exit 10 and changes nothing', async () => {
    const io = fakeIo(route, { env: env() });
    expect(await run(['tales', 'delete', TALE.id, '--json'], io)).toBe(EXIT.confirm);
    expect(JSON.parse(io.stderrText).error).toMatchObject({ code: 'confirmation_required', exitCode: 10 });
    expect(io.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('--yes goes ahead; at a terminal a person is asked', async () => {
    const yes = fakeIo(route, { env: env() });
    expect(await run(['tales', 'delete', TALE.id, '--yes', '--json'], yes)).toBe(EXIT.ok);
    expect(JSON.parse(yes.stdoutText)).toEqual({ deleted: true, id: TALE.id });
    const questions: string[] = [];
    const asked = fakeIo(route, { env: env(), interactive: true, prompt: async (q) => (questions.push(q), 'y') });
    expect(await run(['tales', 'delete', TALE.id], asked)).toBe(EXIT.ok);
    expect(questions[0]).toMatch(/Delete tale "one".*\[y\/N\]/);
    const declined = fakeIo(route, { env: env(), interactive: true, prompt: async () => 'n' });
    expect(await run(['tales', 'delete', TALE.id], declined)).toBe(EXIT.confirm);
    expect(declined.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

const ZONE = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Home top',
  slug: 'home-top',
  projectId: PROJECT.id,
  createdFromTemplate: null,
  firstVisibleAt: null,
  visibility: { visible: false, reasons: [] },
  frame: null as null | { id: string; type: string; settings: Record<string, unknown> },
};

describe('zones display', () => {
  function zoneApi(frame: typeof ZONE.frame) {
    return api((c) => {
      if (c.method === 'GET' && c.path === '/zones') return { status: 200, body: [{ ...ZONE, frame }] };
      if (c.path === `/zones/${ZONE.id}/frame`) return { status: c.method === 'POST' ? 201 : 200, body: { id: 'f', zoneId: ZONE.id, projectId: PROJECT.id, ...(c.body as object) } };
      return undefined;
    });
  }

  it('gives a zone without a display one (POST), a type needed', async () => {
    const io = fakeIo(zoneApi(null), { env: env({ TALEART_PROJECT: PROJECT.id }) });
    expect(await run(['zones', 'display', 'home-top', '--type', 'bar', '--set', 'gap=8', '--json'], io)).toBe(EXIT.ok);
    expect(io.calls.at(-1)).toMatchObject({ method: 'POST', body: { type: 'bar', settings: { gap: 8 } } });
    const none = fakeIo(zoneApi(null), { env: env({ TALEART_PROJECT: PROJECT.id }) });
    expect(await run(['zones', 'display', 'home-top', '--set', 'gap=8'], none)).toBe(EXIT.usage);
  });

  it('keeps the settings not named for the same type, and starts over for a new type (PATCH)', async () => {
    const frame = { id: 'f', type: 'bar', settings: { shape: 'circle', gap: 12 } };
    const same = fakeIo(zoneApi(frame), { env: env() });
    expect(await run(['zones', 'display', ZONE.id, '--set', 'gap=4'], same)).toBe(EXIT.ok);
    expect(same.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { settings: { shape: 'circle', gap: 4 } } });
    const other = fakeIo(zoneApi(frame), { env: env() });
    expect(await run(['zones', 'display', ZONE.id, '--type', 'banner'], other)).toBe(EXIT.ok);
    expect(other.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { type: 'banner' } });
  });
});

describe('tales create', () => {
  it('checks every file before any request', async () => {
    writeFileSync(join(dir, 'one.png'), PNG);
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    const io = fakeIo(api(), { env: env(), cwd: dir });
    expect(await run(['tales', 'create', '--group', TALE.taleGroupId, 'one.png', 'notes.txt', '--json'], io)).toBe(EXIT.invalid);
    expect(JSON.parse(io.stderrText).error.code).toBe('unsupported_media_type');
    const missing = fakeIo(api(), { env: env(), cwd: dir });
    expect(await run(['tales', 'create', '--group', TALE.taleGroupId, 'gone.png'], missing)).toBe(EXIT.invalid);
    expect([...io.calls, ...missing.calls]).toHaveLength(0);
  });

  it('creates a tale per file and uploads it with its type; a failed upload deletes its tale', async () => {
    writeFileSync(join(dir, 'one.png'), PNG);
    writeFileSync(join(dir, 'two.jpg'), PNG); // A PNG named .jpg: the bytes decide.
    let uploads = 0;
    const route = api((c) => {
      if (c.method === 'POST' && c.path === `/tale-groups/${TALE.taleGroupId}/tales`) return { status: 201, body: { ...TALE, title: (c.body as { title: string }).title } };
      if (c.method === 'PUT' && c.path === `/tales/${TALE.id}/media`) {
        uploads++;
        return uploads === 1 ? { status: 200, body: TALE } : { status: 413, body: { error: { code: 'media_too_large', message: 'Too large' } } };
      }
      if (c.method === 'DELETE') return { status: 204 };
      return undefined;
    });
    const io = fakeIo(route, { env: env(), cwd: dir });
    expect(await run(['tales', 'create', '--group', TALE.taleGroupId, 'one.png', 'two.jpg', '--json'], io)).toBe(EXIT.invalid);
    const methods = io.calls.map((c) => `${c.method} ${c.path}`);
    expect(methods).toEqual([
      `POST /tale-groups/${TALE.taleGroupId}/tales`,
      `PUT /tales/${TALE.id}/media`,
      `POST /tale-groups/${TALE.taleGroupId}/tales`,
      `PUT /tales/${TALE.id}/media`,
      `DELETE /tales/${TALE.id}`,
    ]);
    expect(io.calls[0].body).toEqual({ title: 'one' });
    expect(io.calls[1].headers['Content-Type']).toBe('image/png');
    expect(io.calls[3].headers['Content-Type']).toBe('image/png');
    // With --json, stderr is one document: the error, what was made before it, and the warnings.
    const error = JSON.parse(io.stderrText);
    expect(error.error).toMatchObject({ code: 'media_too_large', status: 413, exitCode: 7, file: 'two.jpg' });
    expect(error.error.created).toHaveLength(1);
    expect(error.warnings).toEqual([`Created 1 tale(s) before the failure: ${TALE.id}`]);
    expect(io.stdoutText).toBe('');
  });
});

describe('groups on and off', () => {
  const GROUP = { ...TALE, id: TALE.taleGroupId, name: 'Summer', zoneIds: [ZONE.id], tales: [TALE], tags: [], tagMatch: 'any', cover: null };
  function groupApi(storedStatus: string) {
    return api((c) => {
      if (c.method === 'GET' && c.path === `/tale-groups/${GROUP.id}`) return { status: 200, body: { ...GROUP, storedStatus, status: storedStatus } };
      if (c.method === 'PUT' && c.path === `/tale-groups/${GROUP.id}/status`) {
        const status = (c.body as { status: string }).status;
        return { status: 200, body: { ...GROUP, storedStatus: status, status } };
      }
      return undefined;
    });
  }

  it('turns a draft On (live), and an On group Off (paused)', async () => {
    const on = fakeIo(groupApi('draft'), { env: env() });
    expect(await run(['groups', 'on', GROUP.id, '--json'], on)).toBe(EXIT.ok);
    expect(on.calls.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'live' } });
    const off = fakeIo(groupApi('live'), { env: env() });
    expect(await run(['groups', 'off', GROUP.id], off)).toBe(EXIT.ok);
    expect(off.calls.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'paused' } });
    expect(off.stdoutText).toContain('Summer: Off');
  });

  it('leaves a group already there alone and refuses an archived one', async () => {
    const already = fakeIo(groupApi('live'), { env: env() });
    expect(await run(['groups', 'on', GROUP.id], already)).toBe(EXIT.ok);
    expect(already.calls.some((c) => c.method === 'PUT')).toBe(false);
    const archived = fakeIo(groupApi('archived'), { env: env() });
    expect(await run(['groups', 'on', GROUP.id], archived)).toBe(EXIT.conflict);
  });
});

describe('groups audience (user lists, story 5.4)', () => {
  const GROUP = { ...TALE, id: TALE.taleGroupId, projectId: PROJECT.id, name: 'Summer', zoneIds: [ZONE.id], tales: [TALE], tags: [], tagMatch: 'any', userLists: [] };
  const LISTS = [
    { id: '77777777-7777-4777-8777-777777777777', projectId: PROJECT.id, name: 'VIPs', idCount: 3 },
    { id: '88888888-8888-4888-8888-888888888888', projectId: PROJECT.id, name: 'Beta', idCount: 0 },
  ];
  const audienceApi = api((c) => {
    if (c.method === 'GET' && c.path === `/tale-groups/${GROUP.id}`) return { status: 200, body: GROUP };
    if (c.method === 'GET' && c.path === `/projects/${PROJECT.id}/user-lists`) return { status: 200, body: LISTS };
    if (c.method === 'PUT' && c.path === `/tale-groups/${GROUP.id}/user-lists`) {
      const ids = (c.body as { userListIds: string[] }).userListIds;
      return { status: 200, body: { ...GROUP, userLists: LISTS.filter((l) => ids.includes(l.id)) } };
    }
    return undefined;
  });

  it('sets the group\'s user lists by name, in the group\'s project', async () => {
    const io = fakeIo(audienceApi, { env: env() });
    expect(await run(['groups', 'audience', GROUP.id, '--list', 'VIPs', '--list', 'beta', '--json'], io)).toBe(EXIT.ok);
    expect(io.calls.at(-1)).toMatchObject({ method: 'PUT', path: `/tale-groups/${GROUP.id}/user-lists`, body: { userListIds: LISTS.map((l) => l.id) } });
    expect(JSON.parse(io.stdoutText).userLists).toHaveLength(2);
    const text = fakeIo(audienceApi, { env: env() });
    await run(['groups', 'audience', GROUP.id, '--list', 'VIPs'], text);
    expect(text.stdoutText).toContain('user lists VIPs (3 IDs)');
  });

  it('clears them with --clear, and needs --list or --clear (not both)', async () => {
    const io = fakeIo(audienceApi, { env: env() });
    expect(await run(['groups', 'audience', GROUP.id, '--clear'], io)).toBe(EXIT.ok);
    expect(io.calls.map((c) => c.method)).toEqual(['PUT']);
    expect(io.calls[0].body).toEqual({ userListIds: [] });
    expect(io.stdoutText).toContain('(none: every viewer)');
    for (const argv of [[], ['--list', 'VIPs', '--clear']]) {
      const bad = fakeIo(audienceApi, { env: env() });
      expect(await run(['groups', 'audience', GROUP.id, ...argv], bad)).toBe(EXIT.usage);
      expect(bad.calls).toEqual([]);
    }
  });

  it('answers exit 5 for a list that does not exist, and changes nothing', async () => {
    const io = fakeIo(audienceApi, { env: env() });
    expect(await run(['groups', 'audience', GROUP.id, '--list', 'Nope', '--json'], io)).toBe(EXIT.notFound);
    expect(io.calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});
