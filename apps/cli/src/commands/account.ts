import type { Project } from '@taleart/contract/core';
import type { CommandSpec, GroupSpec } from '../command';
import { ApiClient } from '../client';
import { looksLikeToken, normalizeApiUrl, tokenDisplay } from '../config';
import { CliError, EXIT, usageError } from '../errors';
import { record } from '../output';

/** The token's access, found by a request the API refuses either way: 403 for a read-only token, 400 otherwise. */
async function probeAccess(client: ApiClient): Promise<'read-only' | 'read-write' | 'unknown'> {
  try {
    await client.post('/zones', {});
    return 'unknown';
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    if (err.status === 403) return 'read-only';
    if (err.status === 400) return 'read-write';
    if (err.exitCode === EXIT.auth || err.exitCode === EXIT.network) throw err;
    return 'unknown';
  }
}

export const login: CommandSpec = {
  name: 'login',
  summary: 'Check an API URL and token against the API and store them in the config file (mode 0600).',
  description:
    'Create the token in the dashboard (Settings > API tokens). --token-stdin reads it from stdin, which keeps it out of ' +
    'your shell history and the process list. The token is never printed: only its prefix (tat_ and 6 characters). ' +
    'TALEART_API_URL and TALEART_TOKEN, when set, still win over what is stored.',
  auth: false,
  options: {
    url: { type: 'string', valueName: '<url>', description: 'The API URL, such as https://api.example.com (default: TALEART_API_URL).' },
    token: { type: 'string', valueName: '<tat_…>', description: 'The API token (visible in shell history: prefer --token-stdin).' },
    'token-stdin': { type: 'boolean', description: 'Read the token from stdin.' },
  },
  jsonShape: '{ "apiUrl", "tokenPrefix", "configFile", "projects": number }',
  examples: [
    'taleart login --url http://localhost:3333 --token-stdin < token.txt',
    'printf %s "$TOKEN" | taleart login --url https://api.example.com --token-stdin --json',
  ],
  async run(ctx) {
    const urlText = (ctx.opts['url'] as string | undefined) ?? ctx.io.env['TALEART_API_URL'];
    if (!urlText) throw usageError('Missing --url <url>');
    const apiUrl = normalizeApiUrl(urlText);
    if (ctx.opts['token'] !== undefined && ctx.opts['token-stdin']) throw usageError('Give --token or --token-stdin, not both');
    let token: string;
    if (ctx.opts['token-stdin']) token = (await ctx.io.readStdin()).trim();
    else if (typeof ctx.opts['token'] === 'string') {
      token = ctx.opts['token'].trim();
      if (ctx.io.interactive) ctx.warn('--token stays in your shell history; --token-stdin avoids it.');
    } else throw usageError('Missing --token <tat_…> or --token-stdin');
    if (!looksLikeToken(token)) {
      throw new CliError('That is not an API token: it must start with tat_', EXIT.usage, 'invalid_token', undefined, 'Create one in the dashboard under Settings > API tokens.');
    }
    const client = new ApiClient(apiUrl, token, ctx.io.fetch);
    const list = await client.get<Project[]>('/projects');
    const keepProject = ctx.stored.apiUrl === apiUrl ? ctx.stored.project : undefined;
    ctx.saveConfig({ apiUrl, token, ...(keepProject && { project: keepProject }) });
    if (ctx.io.env['TALEART_TOKEN']) ctx.warn('TALEART_TOKEN is set and wins over the stored token.');
    const tokenPrefix = tokenDisplay(token);
    return {
      data: { apiUrl, tokenPrefix, configFile: ctx.config.file, projects: list.length },
      text: `Logged in to ${apiUrl} with ${tokenPrefix}… (${list.length} project${list.length === 1 ? '' : 's'}). Saved to ${ctx.config.file}`,
    };
  },
};

export const logout: CommandSpec = {
  name: 'logout',
  summary: 'Remove the stored API URL and token from the config file (the token stays valid: revoke it in the dashboard).',
  auth: false,
  jsonShape: '{ "loggedOut": boolean, "configFile": string }',
  examples: ['taleart logout'],
  async run(ctx) {
    const had = Boolean(ctx.stored.token || ctx.stored.apiUrl);
    const { project } = ctx.stored;
    if (project) ctx.saveConfig({ project });
    else ctx.removeConfig();
    if (ctx.io.env['TALEART_TOKEN']) ctx.warn('TALEART_TOKEN is still set in your environment.');
    return {
      data: { loggedOut: had, configFile: ctx.config.file },
      text: had ? `Removed the stored token from ${ctx.config.file}.` : 'No token was stored.',
    };
  },
};

export const whoami: CommandSpec = {
  name: 'whoami',
  summary: 'Show the API URL, the token\'s prefix and where it came from, its access and the projects it reaches.',
  description:
    'Never prints the token. The access (read-only or read-write) is found with a request the API refuses either way, so ' +
    'nothing changes. The API does not yet tell a token its user\'s name or role, so `user` is null.',
  project: 'optional',
  jsonShape:
    '{ "apiUrl", "apiUrlSource", "tokenPrefix", "tokenSource", "access": "read-only"|"read-write"|"unknown", "projects": Project[], "defaultProject": Project|null, "user": null }',
  examples: ['taleart whoami', 'taleart whoami --json'],
  async run(ctx) {
    const client = ctx.client();
    const list = await client.get<Project[]>('/projects');
    const access = await probeAccess(client);
    const projectId = await ctx.projectIdOrNull().catch(() => null);
    const defaultProject = list.find((p) => p.id === projectId) ?? null;
    const tokenPrefix = tokenDisplay(ctx.config.token);
    return {
      data: {
        apiUrl: ctx.config.apiUrl,
        apiUrlSource: ctx.config.apiUrlSource,
        tokenPrefix,
        tokenSource: ctx.config.tokenSource,
        access,
        projects: list,
        defaultProject,
        user: null,
      },
      text: record([
        ['api', `${ctx.config.apiUrl} (from ${ctx.config.apiUrlSource})`],
        ['token', `${tokenPrefix}… (from ${ctx.config.tokenSource})`],
        ['access', access],
        ['projects', list.map((p) => `${p.name} (${p.id})`).join(', ') || null],
        ['default project', defaultProject ? `${defaultProject.name} (${defaultProject.id})` : null],
        ['user', 'not shown: the API does not tell a token its user yet'],
      ]),
    };
  },
};

export const config: GroupSpec = {
  name: 'config',
  summary: 'Show the settings in use and where they come from (the token only by its prefix).',
  commands: [
    {
      name: 'show',
      summary: 'Show the API URL, token prefix and default project in use, and where each comes from.',
      auth: false,
      jsonShape: '{ "configFile", "apiUrl", "apiUrlSource", "tokenPrefix", "tokenSource", "project", "projectSource" }',
      examples: ['taleart config show', 'taleart config show --json'],
      async run(ctx) {
        const c = ctx.config;
        const data = {
          configFile: c.file,
          apiUrl: c.apiUrl,
          apiUrlSource: c.apiUrlSource,
          tokenPrefix: tokenDisplay(c.token),
          tokenSource: c.tokenSource,
          project: c.project,
          projectSource: c.projectSource,
        };
        return {
          data,
          text: record([
            ['config file', c.file],
            ['api url', c.apiUrl ? `${c.apiUrl} (from ${c.apiUrlSource})` : null],
            ['token', c.token ? `${data.tokenPrefix}… (from ${c.tokenSource})` : null],
            ['project', c.project ? `${c.project} (from ${c.projectSource})` : null],
          ]),
        };
      },
    },
    {
      name: 'path',
      summary: 'Print the config file\'s path.',
      auth: false,
      jsonShape: '{ "configFile": string }',
      examples: ['taleart config path'],
      async run(ctx) {
        return { data: { configFile: ctx.config.file }, text: ctx.config.file };
      },
    },
  ],
};
