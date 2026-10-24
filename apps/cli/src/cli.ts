import { existsSync, unlinkSync } from 'node:fs';
import { commandWords, locate, parseCommand, parseGlobals, type Globals } from './args';
import { ApiClient } from './client';
import type { CommandSpec, Context, Io } from './command';
import { GROUPS, TOP_COMMANDS } from './commands';
import { configDir, configFile, looksLikeToken, readConfig, resolveConfig, writeConfig, type StoredConfig } from './config';
import { CliError, EXIT, usageError } from './errors';
import { help } from './help';
import { asCliError, errorJson, errorText, json, type Output } from './output';
import { resolveProjectId } from './resolve';
import { VERSION } from './version';

function print(io: Io, output: Output, asJson: boolean): void {
  if (asJson || output.text === undefined) io.stdout(json(output.data));
  else io.stdout(`${output.text}\n`);
}

function buildContext(io: Io, globals: Globals, args: Context['args'], opts: Context['opts']): Context {
  const warn = (message: string) => io.stderr(`warning: ${message}\n`);
  const dir = configDir(io.env, io.platform, io.home);
  const file = configFile(dir);
  const stored: StoredConfig = readConfig(file, warn, io.platform);
  const config = resolveConfig(stored, io.env, { apiUrl: globals.apiUrl, project: globals.project }, file);
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
      client = new ApiClient(config.apiUrl, config.token, io.fetch);
      return client;
    },
    projectId() {
      if (!config.project) {
        return Promise.reject(
          usageError('No project chosen', 'Pass --project <id|name>, set TALEART_PROJECT, or run taleart projects use <id|name>.'),
        );
      }
      project ??= resolveProjectId(ctx.client(), config.project);
      return project;
    },
    async projectIdOrNull() {
      return config.project ? ctx.projectId() : null;
    },
    async confirm(message) {
      if (globals.yes) return;
      if (io.interactive && !globals.json) {
        const answer = (await io.prompt(`${message} [y/N] `)).trim().toLowerCase();
        if (answer === 'y' || answer === 'yes') return;
        throw new CliError('Not confirmed; nothing was changed', EXIT.confirm, 'not_confirmed');
      }
      throw new CliError(`${message} Nothing was changed.`, EXIT.confirm, 'confirmation_required', undefined, 'Rerun with --yes to confirm.');
    },
    warn,
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

async function runCommand(io: Io, command: CommandSpec, path: string, rest: string[]): Promise<number> {
  const parsed = parseCommand(command, rest);
  if (parsed.globals.version) {
    print(io, { data: { version: VERSION }, text: VERSION }, parsed.globals.json);
    return EXIT.ok;
  }
  if (parsed.globals.help) {
    print(io, help(path.split(' '), parsed.globals.json), parsed.globals.json);
    return EXIT.ok;
  }
  const ctx = buildContext(io, parsed.globals, parsed.args, parsed.opts);
  const output = await command.run(ctx);
  print(io, output, parsed.globals.json);
  return EXIT.ok;
}

/** Runs the CLI on `argv` (without `node` and the script) and answers its exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  // Read leniently first, so even a usage error is written as JSON when --json was asked for.
  let asJson = false;
  try {
    const { globals } = parseGlobals(argv);
    asJson = globals.json;
    const { words } = commandWords(argv);
    if (words[0] === 'help') {
      print(io, help(words.slice(1), asJson), asJson);
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
      return await runCommand(io, located.command, path, located.rest);
    }
    if (globals.version && !located.group) {
      print(io, { data: { version: VERSION }, text: VERSION }, asJson);
      return EXIT.ok;
    }
    const output = help(located.group ? [located.group.name] : [], asJson);
    if (globals.help) {
      print(io, output, asJson);
      return EXIT.ok;
    }
    // No command named: the help goes to stderr, so stdout stays empty for a script that got it wrong.
    io.stderr(`${output.text}\n`);
    return EXIT.usage;
  } catch (err) {
    const error = asCliError(err);
    io.stderr(asJson ? errorJson(error) : errorText(error));
    return error.exitCode;
  }
}
