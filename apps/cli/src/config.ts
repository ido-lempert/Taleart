import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_TOKEN_PREFIX, apiTokenPrefix } from '@taleart/contract/core';
import { CliError, EXIT } from './errors';

/** What `taleart login` and `taleart projects use` store. The token is written only here, mode 0600. */
export interface StoredConfig {
  apiUrl?: string;
  token?: string;
  /** The default project's id, for commands that take `--project`. */
  project?: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

/** Where a setting came from, for `whoami` and `config show`. */
export type Source = 'flag' | 'env' | 'config' | 'none';

export interface ResolvedConfig {
  apiUrl: string | null;
  apiUrlSource: Source;
  token: string | null;
  tokenSource: Source;
  project: string | null;
  projectSource: Source;
  file: string;
}

/**
 * The folder the config file lives in: `$TALEART_CONFIG_DIR`, else `$XDG_CONFIG_HOME/taleart`,
 * else the OS's own place (`%APPDATA%\taleart` on Windows, `~/Library/Application Support/taleart`
 * on macOS, `~/.config/taleart` elsewhere).
 */
export function configDir(env: Env, platform: NodeJS.Platform, home: string): string {
  if (env['TALEART_CONFIG_DIR']) return env['TALEART_CONFIG_DIR'];
  if (env['XDG_CONFIG_HOME']) return join(env['XDG_CONFIG_HOME'], 'taleart');
  if (platform === 'win32') return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'taleart');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'taleart');
  return join(home, '.config', 'taleart');
}

export function configFile(dir: string): string {
  return join(dir, 'config.json');
}

/** Reads the config file; a missing file is an empty config. Warns when others can read it. */
export function readConfig(file: string, warn: (message: string) => void, platform: NodeJS.Platform): StoredConfig {
  if (!existsSync(file)) return {};
  if (platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) {
    warn(`${file} can be read by other users; it holds your API token. Run: chmod 600 "${file}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CliError(`${file} is not valid JSON`, EXIT.usage, 'invalid_config', undefined, 'Fix it, or delete it and run taleart login again.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`${file} does not hold a JSON object`, EXIT.usage, 'invalid_config');
  }
  const out: StoredConfig = {};
  for (const key of ['apiUrl', 'token', 'project'] as const) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) out[key] = value;
  }
  return out;
}

/**
 * Writes the config file with mode 0600 in a folder with mode 0700, both applied again on every
 * write (a file created earlier with looser permissions is tightened). Written to a temporary file
 * first and renamed, so a failed write never leaves half a file.
 */
export function writeConfig(file: string, dir: string, config: StoredConfig): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // A folder the user does not own (such as a shared XDG_CONFIG_HOME): the file's mode still holds.
  }
  const body = `${JSON.stringify(config, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, body, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (err) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw err;
  }
  chmodSync(file, 0o600);
}

/** The API's origin, without a trailing slash or `/api/v1`: `taleart login --url` may be given either. */
export function normalizeApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CliError(`Not a URL: ${value}`, EXIT.usage, 'usage', undefined, 'Give the API\'s address, such as http://localhost:3333.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`The API URL must start with http:// or https://: ${value}`, EXIT.usage, 'usage');
  }
  if (url.search || url.hash) throw new CliError(`The API URL must not have a query or fragment: ${value}`, EXIT.usage, 'usage');
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${url.origin}${path}`;
}

/** Settings in order: flags, then TALEART_API_URL / TALEART_TOKEN / TALEART_PROJECT, then the file. */
export function resolveConfig(
  stored: StoredConfig,
  env: Env,
  flags: { apiUrl?: string; project?: string },
  file: string,
): ResolvedConfig {
  const pick = (flag: string | undefined, envValue: string | undefined, fileValue: string | undefined) =>
    flag ? { value: flag, source: 'flag' as const }
    : envValue ? { value: envValue, source: 'env' as const }
    : fileValue ? { value: fileValue, source: 'config' as const }
    : { value: null, source: 'none' as const };
  const apiUrl = pick(flags.apiUrl, env['TALEART_API_URL'], stored.apiUrl);
  const token = pick(undefined, env['TALEART_TOKEN'], stored.token);
  const project = pick(flags.project, env['TALEART_PROJECT'], stored.project);
  return {
    apiUrl: apiUrl.value === null ? null : normalizeApiUrl(apiUrl.value),
    apiUrlSource: apiUrl.source,
    token: token.value?.trim() || null,
    tokenSource: token.source,
    project: project.value,
    projectSource: project.source,
    file,
  };
}

/** True when the text looks like an API token (`tat_…`); anything else is refused before a request. */
export function looksLikeToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX) && token.length > API_TOKEN_PREFIX.length + 8 && /^[A-Za-z0-9_-]+$/.test(token);
}

/** The only part of a token the CLI ever shows: its display prefix (`tat_` and 6 characters), as the dashboard lists it. */
export function tokenDisplay(token: string | null): string | null {
  return token ? apiTokenPrefix(token) : null;
}
