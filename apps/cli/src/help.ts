import { GLOBAL_OPTIONS } from './args';
import type { CommandSpec, GroupSpec, OptionSpec } from './command';
import { GROUPS, TOP_COMMANDS } from './commands';
import { EXIT_CODE_MEANINGS, usageError } from './errors';
import type { Output } from './output';
import { VERSION } from './version';

/** A command as `--help --json` and `taleart help commands --json` describe it. */
export interface CommandDescription {
  command: string;
  summary: string;
  description?: string;
  usage: string;
  arguments: { name: string; description: string; required: boolean; variadic: boolean }[];
  options: { flag: string; description: string; required: boolean; repeatable: boolean; choices?: readonly string[] }[];
  project: 'required' | 'optional' | 'none';
  destructive: boolean;
  json: string;
  examples: readonly string[];
}

function flag(name: string, spec: OptionSpec): string {
  return `${spec.short ? `-${spec.short}, ` : ''}--${name}${spec.type === 'string' ? ` ${spec.valueName ?? '<value>'}` : ''}`;
}

function usageLine(path: string, spec: CommandSpec): string {
  const parts = [`taleart ${path}`];
  for (const arg of spec.args ?? []) {
    const name = `<${arg.name}>${arg.variadic ? '...' : ''}`;
    parts.push(arg.required ? name : `[${name}]`);
  }
  for (const [name, option] of Object.entries(spec.options ?? {})) {
    const text = flag(name, option).replace(/^-., /, '');
    parts.push(option.required ? text : `[${text}]`);
  }
  if (spec.project === 'required') parts.push('[--project <id|name>]');
  if (spec.destructive) parts.push('[--yes]');
  parts.push('[--json]');
  return parts.join(' ');
}

export function describeCommand(path: string, spec: CommandSpec): CommandDescription {
  return {
    command: path,
    summary: spec.summary,
    ...(spec.description && { description: spec.description }),
    usage: usageLine(path, spec),
    arguments: (spec.args ?? []).map((a) => ({ name: a.name, description: a.description, required: Boolean(a.required), variadic: Boolean(a.variadic) })),
    options: Object.entries(spec.options ?? {}).map(([name, o]) => ({
      flag: flag(name, o),
      description: o.description,
      required: Boolean(o.required),
      repeatable: Boolean(o.multiple),
      ...(o.choices && { choices: o.choices }),
    })),
    project: spec.project ?? 'none',
    destructive: Boolean(spec.destructive),
    json: spec.jsonShape ?? 'The API\'s answer.',
    examples: spec.examples,
  };
}

function wrap(text: string, indent = '', width = 96): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width - indent.length) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
}

function optionLines(entries: ReadonlyArray<[string, string]>): string[] {
  const width = Math.max(...entries.map(([f]) => f.length)) + 2;
  return entries.map(([f, d]) => `  ${f.padEnd(width)}${d}`);
}

export function commandHelpText(d: CommandDescription): string {
  const lines = [`Usage: ${d.usage}`, '', wrap(d.summary)];
  if (d.description) lines.push('', wrap(d.description));
  if (d.arguments.length > 0) {
    lines.push('', 'Arguments:', ...optionLines(d.arguments.map((a) => [`<${a.name}>${a.variadic ? '...' : ''}`, a.description])));
  }
  const options: [string, string][] = d.options.map((o) => [
    o.flag,
    `${o.description}${o.required ? ' Required.' : ''}${o.repeatable ? ' Repeatable.' : ''}`,
  ]);
  if (d.project !== 'none') options.push([flag('project', GLOBAL_OPTIONS['project']), `${GLOBAL_OPTIONS['project'].description}${d.project === 'required' ? ' Required.' : ''}`]);
  if (d.destructive) options.push(['-y, --yes', 'Do it without asking. Without a terminal and without --yes the command stops (exit 10).']);
  options.push(['--json', `Print JSON on stdout: ${d.json}`]);
  options.push(['-h, --help', 'Show this help.']);
  lines.push('', 'Options:', ...optionLines(options));
  lines.push('', 'Examples:', ...d.examples.map((e) => `  ${e}`));
  return lines.join('\n');
}

function groupHelpText(group: GroupSpec): string {
  const lines = [`Usage: taleart ${group.name} <command> [options]`, '', wrap(group.summary)];
  if (group.description) lines.push('', wrap(group.description));
  lines.push('', 'Commands:', ...optionLines(group.commands.map((c) => [c.name, c.summary])));
  lines.push('', `Run taleart ${group.name} <command> --help for a command's arguments, options and examples.`);
  return lines.join('\n');
}

function rootHelpText(): string {
  return [
    `taleart ${VERSION}: manage TaleArt zones, tale groups, tales, site keys and user lists through the Management API.`,
    '',
    'Usage: taleart <group> <command> [arguments] [options]',
    '',
    'Commands:',
    ...optionLines([
      ...TOP_COMMANDS.map((c) => [c.name, c.summary] as [string, string]),
      ...GROUPS.map((g) => [g.name, g.summary] as [string, string]),
      ['help <topic>', 'Help on a group, a command or a topic.'],
    ]),
    '',
    'Options for every command:',
    ...optionLines(Object.entries(GLOBAL_OPTIONS).map(([name, spec]) => [flag(name, spec), spec.description])),
    '',
    `Help topics: ${Object.keys(TOPICS).join(', ')}, or any group or command (taleart help zones create).`,
    '',
    'Start: create a token in the dashboard (Settings > API tokens), then',
    '  export TALEART_API_URL=https://api.example.com TALEART_TOKEN=tat_…',
    '  taleart whoami',
    '  taleart projects use "My project"',
  ].join('\n');
}

const TOPICS: Record<string, () => string> = {
  commands: () => {
    const lines: string[] = [];
    for (const c of TOP_COMMANDS) lines.push(`taleart ${c.name}  ${c.summary}`);
    for (const g of GROUPS) for (const c of g.commands) lines.push(`taleart ${g.name} ${c.name}  ${c.summary}`);
    return lines.join('\n');
  },
  config: () =>
    [
      'Configuration, first match wins:',
      '  API URL:  --api-url, TALEART_API_URL, the config file (taleart login --url)',
      '  token:    TALEART_TOKEN, the config file (taleart login --token-stdin)',
      '  project:  --project, TALEART_PROJECT, the config file (taleart projects use)',
      '',
      'The config file is config.json in $TALEART_CONFIG_DIR, else $XDG_CONFIG_HOME/taleart, else',
      '%APPDATA%\\taleart (Windows), ~/Library/Application Support/taleart (macOS), ~/.config/taleart (others).',
      'It is written with mode 0600 in a folder with mode 0700; taleart warns when others can read it.',
      'taleart config path prints where it is; taleart config show shows what is in use.',
      '',
      'The token is never printed: whoami, config show and every --json output show only its prefix',
      '(tat_ and 6 characters), as the dashboard lists it. Revoke a token in the dashboard; taleart logout',
      'only forgets it. Prefer a read-only token for tasks that only read.',
      '',
      'The API URL is the API\'s origin (http://localhost:3333); a URL ending in /api/v1 works too.',
    ].join('\n'),
  output: () =>
    [
      'Without --json, results are tables and label: value lines for people.',
      'With --json, stdout holds exactly one JSON document: the API\'s answer (a Zone, a TaleGroup, a list…),',
      'or for the CLI\'s own commands the shape their --help names. Nothing else is written to stdout.',
      '',
      'Progress, warnings and errors go to stderr. With --json an error is one JSON document on stderr:',
      '  {"error":{"code":"slug_taken","message":"…","status":409,"exitCode":6,"hint":"…"}}',
      'code is the API\'s error code (openapi.yaml ErrorCode) or one of the CLI\'s: usage, not_found, ambiguous,',
      'file_not_found, unsupported_media_type, confirmation_required, api_unreachable, timeout.',
      '',
      'Commands never ask a question unless stdin and stderr are both terminals and --json is off;',
      'destructive commands (site-keys rotate|revoke, tales delete, user-lists delete) need --yes otherwise.',
      '',
      'References: projects by id or exact name; zones by id or slug; tale groups and user lists by id',
      'or name in the project; tales by id. A name matching nothing exits 5, several exit 6.',
    ].join('\n'),
  'exit-codes': () => EXIT_CODE_MEANINGS.map(([code, meaning]) => `${String(code).padStart(2)}  ${meaning}`).join('\n'),
  concepts: () =>
    [
      'project     Holds everything below and one site key. Tokens may be limited to some projects.',
      'zone        A place on the site, named by its slug in <taleart-view zone="…">. It has one display.',
      'display     How a zone shows its tale groups: bar (a row of covers) or banner (rotating slides).',
      'tale group  A set of tales, one cover in a bar. Belongs to the project; placed in zones. Starts Off.',
      'tale        One page of a group: an image or a video. Starts Shown.',
      'On/Off      A group shows only when On (stored live). Shown/Hidden does the same for one tale.',
      'tags        A group\'s targeting tags; --match any (at least one) or all (every one) of the viewer\'s.',
      'user list   External user IDs for targeting, stored only as keyed hashes.',
      'site key    tas_…, shown once: host pages send it to the Delivery API. Rotating it breaks old pages.',
      'API token   tat_…, created in the dashboard; what this CLI uses. Never shown again, never printed.',
      'visible     Whether a zone, group or tale shows on the site now; when not, the reason codes say why.',
      '',
      'A zone shows a group when: the zone has a display, the project has a site key on the page,',
      'the group is placed in the zone and On, and it has at least one Shown tale with media.',
      '',
      'Recipe: a zone with a bar and a group of two image tales, On:',
      '  taleart zones create --name "Home top" --slug home-top',
      '  taleart zones display home-top --type bar',
      '  taleart groups create --name Summer --zone home-top',
      '  taleart tales create --group Summer ./img/one.png ./img/two.png',
      '  taleart groups on Summer',
      '  taleart site-keys issue        # once per project; keep the key',
      '  taleart zones snippet home-top --site-key "$SITE_KEY"',
    ].join('\n'),
};

export const HELP_TOPICS = Object.keys(TOPICS);

/** Help for the words after `taleart help` (or before `--help`): the overview, a topic, a group or a command. */
export function help(words: readonly string[], asJson: boolean): Output {
  if (words.length === 0) return { data: { topic: 'overview', text: rootHelpText() }, text: rootHelpText() };
  const [first, second, ...extra] = words;
  if (extra.length > 0) throw usageError(`Unknown help topic: ${words.join(' ')}`);
  if (first in TOPICS && second === undefined) {
    if (first === 'commands' && asJson) {
      const all = [
        ...TOP_COMMANDS.map((c) => describeCommand(c.name, c)),
        ...GROUPS.flatMap((g) => g.commands.map((c) => describeCommand(`${g.name} ${c.name}`, c))),
      ];
      return { data: all };
    }
    const text = TOPICS[first]();
    return { data: { topic: first, text }, text };
  }
  const top = TOP_COMMANDS.find((c) => c.name === first);
  if (top && second === undefined) {
    const d = describeCommand(top.name, top);
    return { data: d, text: commandHelpText(d) };
  }
  const group = GROUPS.find((g) => g.name === first || g.aliases?.includes(first));
  if (group) {
    if (second === undefined) {
      return {
        data: { group: group.name, summary: group.summary, commands: group.commands.map((c) => describeCommand(`${group.name} ${c.name}`, c)) },
        text: groupHelpText(group),
      };
    }
    const command = group.commands.find((c) => c.name === second);
    if (command) {
      const d = describeCommand(`${group.name} ${command.name}`, command);
      return { data: d, text: commandHelpText(d) };
    }
  }
  throw usageError(
    `Unknown help topic: ${words.join(' ')}`,
    `Topics: ${HELP_TOPICS.join(', ')}; groups: ${GROUPS.map((g) => g.name).join(', ')}; commands: ${TOP_COMMANDS.map((c) => c.name).join(', ')}.`,
  );
}
