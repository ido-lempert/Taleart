import type { CurrentApiToken, Project } from '@taleart/contract/core';
import type { CommandSpec, GroupSpec } from '../command';
import { ApiClient } from '../client';
import { insecureUrlWarning, looksLikeToken, normalizeApiUrl, tokenDisplay } from '../config';
import { CliError, EXIT, usageError } from '../errors';
import { record } from '../output';

export const login: CommandSpec = {
  name: 'login',
  mutates: true,
  result: '{ "apiUrl": string, "tokenPrefix": string, "configFile": string, "projects": number }',
  ignoreBadConfig: true,
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
    if (ctx.opts['token-stdin']) {
      if (ctx.io.stdinIsTTY) {
        throw usageError('--token-stdin reads the token from a pipe or a file, but stdin is a terminal', 'Run: taleart login --url <url> --token-stdin < token.txt');
      }
      token = (await ctx.io.readStdin()).trim();
    } else if (typeof ctx.opts['token'] === 'string') {
      token = ctx.opts['token'].trim();
      ctx.warn('--token leaves the token in your shell history and the process list; --token-stdin avoids it.');
    } else throw usageError('Missing --token <tat_…> or --token-stdin');
    if (!looksLikeToken(token)) {
      throw new CliError('That is not an API token: it must start with tat_', EXIT.usage, 'invalid_token', undefined, 'Create one in the dashboard under Settings > API tokens.');
    }
    const insecure = insecureUrlWarning(apiUrl);
    if (insecure) ctx.warn(insecure);
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
  mutates: true,
  result: '{ "loggedOut": boolean, "configFile": string }',
  ignoreBadConfig: true,
  summary: 'Remove the stored API URL and token from the config file (the token stays valid: revoke it in the dashboard).',
  auth: false,
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
  mutates: false,
  result: '{ "apiUrl", "apiUrlSource", "tokenPrefix", "tokenSource", "tokenId", "name", "readOnly", "allProjects", "projectIds", "expiresAt", "user": User, "projects": Project[], "defaultProject": Project | null }',
  summary: 'Show the token in use: its user and role, prefix, name, scope and expiry, and the projects it reaches.',
  description:
    'Reads GET /api-tokens/current, so it needs an API token (never a session). Never prints the token, only its prefix.',
  project: 'optional',
  examples: ['taleart whoami', 'taleart whoami --json'],
  async run(ctx) {
    const client = ctx.client();
    const [current, list] = await Promise.all([client.get<CurrentApiToken>('/api-tokens/current'), client.get<Project[]>('/projects')]);
    const projectId = await ctx.projectIdOrNull().catch(() => null);
    const defaultProject = list.find((p) => p.id === projectId) ?? null;
    const scope = current.allProjects ? 'all of the user\'s projects' : `${current.projectIds?.length ?? 0} project(s)`;
    return {
      data: {
        apiUrl: ctx.config.apiUrl,
        apiUrlSource: ctx.config.apiUrlSource,
        tokenPrefix: current.prefix,
        tokenSource: ctx.config.tokenSource,
        tokenId: current.id,
        name: current.name,
        readOnly: current.readOnly,
        allProjects: current.allProjects,
        projectIds: current.projectIds,
        expiresAt: current.expiresAt,
        user: current.user,
        projects: list,
        defaultProject,
      },
      text: record([
        ['user', `${current.user.name} <${current.user.email}> (${current.user.role})`],
        ['token', `${current.name}, ${current.prefix}… (from ${ctx.config.tokenSource})`],
        ['access', current.readOnly ? 'read-only' : 'read-write'],
        ['scope', scope],
        ['expires', current.expiresAt ?? 'never'],
        ['api', `${ctx.config.apiUrl} (from ${ctx.config.apiUrlSource})`],
        ['projects', list.map((p) => `${p.name} (${p.id})`).join(', ') || null],
        ['default project', defaultProject ? `${defaultProject.name} (${defaultProject.id})` : null],
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
      mutates: false,
      result: '{ "configFile", "apiUrl", "apiUrlSource", "tokenPrefix", "tokenSource", "project", "projectSource" }',
      summary: 'Show the API URL, token prefix and default project in use, and where each comes from.',
      auth: false,
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
      mutates: false,
      result: '{ "configFile": string }',
      ignoreBadConfig: true,
      summary: 'Print the config file\'s path.',
      auth: false,
      examples: ['taleart config path'],
      async run(ctx) {
        return { data: { configFile: ctx.config.file }, text: ctx.config.file };
      },
    },
  ],
};
