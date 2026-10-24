import { existsSync, unlinkSync } from 'node:fs';
import { commandWords, locate, parseCommand, parseGlobals, type Globals } from './args';
import { ApiClient } from './client';
import type { CommandSpec, Context, Io } from './command';
import { GROUPS, TOP_COMMANDS } from './commands';
import {
  configDir,
  configFile,
  insecureUrlWarning,
  looksLikeToken,
  readConfig,
  resolveConfig,
  writeConfig,
  type StoredConfig,
} from './config';
import { CliError, EXIT, usageError } from './errors';
import { help } from './help';
import { asCliError, errorJson, errorText, json, warningsJson, type Output } from './output';
import { resolveProjectId } from './resolve';
import { VERSION } from './version';

/** What a run says besides its result: warnings, which `--json` gathers into one document on stderr. */
interface Notes {
  json: boolean;
  warnings: string[];
}

function print(io: Io, output: Output, asJson: boolean): void {
  if (asJson || output.text === undefined) io.stdout(json(output.data));
  else io.stdout(`${output.text}\n`);
}

/** A person can answer: the terminals say so, and neither CI=true nor TALEART_NO_INPUT=1 says otherwise. */
function interactive(io: Io): boolean {
  const ci = io.env['CI'];
  return io.interactive && !(ci && ci !== 'false' && ci !== '0') && io.env['TALEART_NO_INPUT'] !== '1';
}

function buildContext(io: Io, command: CommandSpec, globals: Globals, args: Context['args'], opts: Context['opts'], notes: Notes): Context {
  const warn = (message: string) => {
    if (notes.json) notes.warnings.push(message);
    else io.stderr(`warning: ${message}\n`);
  };
  const dir = configDir(io.env, io.platform, io.home);
  const file = configFile(dir);
  let stored: StoredConfig;
  try {
    stored = readConfig(file, warn, io.platform);
  } catch (err) {
    if (!command.ignoreBadConfig || !(err instanceof CliError)) throw err;
    warn(`${err.message}; going on without it.`);
    stored = {};
  }
  const config = resolveConfig(stored, io.env, { apiUrl: globals.apiUrl, project: globals.project }, file);
  const exact = Boolean(command.destructive);
  let client: ApiClient | undefined;
  let project: Promise<string> | undefined;
  const ctx: Context = {
    args,
    opts,
    json: globals.json,
    yes: globals.yes,
    io,
    config,
    stored,
    configDir: dir,
    exact,
    client() {
      if (client) return client;
      if (!config.apiUrl) {
        throw new CliError('No API URL', EXIT.auth, 'no_api_url', undefined, 'Set TALEART_API_URL, pass --api-url, or run taleart login --url <url> --token-stdin.');
      }
      if (!config.token) {
        throw new CliError(
          'No API token',
          EXIT.auth,
          'no_token',
          undefined,
          'Create one in the dashboard (Settings > API tokens), then set TALEART_TOKEN or run taleart login --token-stdin.',
        );
      }
      if (!looksLikeToken(config.token)) {
        throw new CliError(
          `The ${config.tokenSource === 'env' ? 'TALEART_TOKEN' : 'stored'} token is not an API token: it must start with tat_`,
          EXIT.auth,
          'invalid_token',
        );
      }
      const insecure = insecureUrlWarning(config.apiUrl);
      if (insecure) warn(insecure);
      client = new ApiClient(config.apiUrl, config.token, io.fetch);
      return client;
    },
    projectId() {
      if (!config.project) {
        return Promise.reject(
          usageError('No project chosen', 'Pass --project <id|name>, set TALEART_PROJECT, or run taleart projects use <id|name>.'),
        );
      }
      project ??= resolveProjectId(ctx.client(), config.project, exact);
      return project;
    },
    async projectIdOrNull() {
      return config.project ? ctx.projectId() : null;
    },
    async confirm(message) {
      if (globals.yes) return;
      if (interactive(io) && !globals.json) {
        const answer = await io.prompt(`${message} [y/N] `);
        if (answer !== null && ['y', 'yes'].includes(answer.trim().toLowerCase())) return;
        throw new CliError('Not confirmed; nothing was changed', EXIT.confirm, 'not_confirmed');
      }
      throw new CliError(`${message} Nothing was changed.`, EXIT.confirm, 'confirmation_required', undefined, 'Rerun with --yes to confirm.');
    },
    warn,
    info(message) {
      if (!notes.json) io.stderr(`${message}\n`);
    },
    saveConfig(next) {
      writeConfig(file, dir, next);
    },
    removeConfig() {
      if (!existsSync(file)) return false;
      unlinkSync(file);
      return true;
    },
  };
  return ctx;
}

async function runCommand(io: Io, command: CommandSpec, path: string, rest: string[], notes: Notes): Promise<number> {
  const parsed = parseCommand(command, rest);
  if (parsed.globals.version) {
    print(io, { data: { version: VERSION }, text: VERSION }, parsed.globals.json);
    return EXIT.ok;
  }
  if (parsed.globals.help) {
    print(io, help(path.split(' '), parsed.globals.json), parsed.globals.json);
    return EXIT.ok;
  }
  const ctx = buildContext(io, command, parsed.globals, parsed.args, parsed.opts, notes);
  const output = await command.run(ctx);
  print(io, output, parsed.globals.json);
  if (notes.json && notes.warnings.length > 0) io.stderr(warningsJson(notes.warnings));
  return EXIT.ok;
}

/**
 * Runs the CLI on `argv` (without `node` and the script) and answers its exit code. With `--json`,
 * stdout holds one JSON document (the result) and stderr at most one (the error, or the warnings).
 */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  // Read leniently first, so even a usage error is written as JSON when --json was asked for.
  const notes: Notes = { json: false, warnings: [] };
  try {
    const { globals } = parseGlobals(argv);
    notes.json = globals.json;
    const { words } = commandWords(argv);
    if (words[0] === 'help') {
      print(io, help(words.slice(1), notes.json), notes.json);
      return EXIT.ok;
    }
    const located = locate(argv, GROUPS, TOP_COMMANDS);
    if (located.unknown !== undefined) {
      throw usageError(
        located.group ? `Unknown command: taleart ${located.group.name} ${located.unknown}` : `Unknown command: ${located.unknown}`,
        located.group ? `Run taleart ${located.group.name} --help for its commands.` : 'Run taleart --help for the commands.',
      );
    }
    if (located.command) {
      const path = located.group ? `${located.group.name} ${located.command.name}` : located.command.name;
      return await runCommand(io, located.command, path, located.rest, notes);
    }
    if (globals.version && !located.group) {
      print(io, { data: { version: VERSION }, text: VERSION }, notes.json);
      return EXIT.ok;
    }
    const output = help(located.group ? [located.group.name] : [], notes.json);
    if (globals.help) {
      print(io, output, notes.json);
      return EXIT.ok;
    }
    // No command named. With --json: the help as JSON on stdout and the error on stderr; otherwise
    // the help goes to stderr, so stdout stays empty for a script that got it wrong.
    if (notes.json) {
      print(io, output, true);
      throw usageError(
        located.group ? `Missing command: taleart ${located.group.name} <command>` : 'Missing command',
        'The help is on stdout.',
      );
    }
    io.stderr(`${output.text}\n`);
    return EXIT.usage;
  } catch (err) {
    const error = asCliError(err);
    io.stderr(notes.json ? errorJson(error, notes.warnings) : errorText(error));
    return error.exitCode;
  }
}
