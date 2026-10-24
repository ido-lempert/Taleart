import { parseArgs } from 'node:util';
import type { CommandSpec, GroupSpec, OptionSpec, OptionValue } from './command';
import { usageError } from './errors';

/** Flags every command takes. */
export const GLOBAL_OPTIONS: Readonly<Record<string, OptionSpec>> = {
  json: { type: 'boolean', description: 'Print the result as one JSON document on stdout; errors as JSON on stderr.' },
  yes: { type: 'boolean', short: 'y', description: 'Do a destructive command without asking.' },
  project: {
    type: 'string',
    short: 'p',
    valueName: '<id|name>',
    description: 'The project (default: TALEART_PROJECT, then the one chosen with taleart projects use).',
  },
  'api-url': { type: 'string', valueName: '<url>', description: 'The API URL (default: TALEART_API_URL, then the one taleart login stored).' },
  help: { type: 'boolean', short: 'h', description: 'Show help for the command.' },
  version: { type: 'boolean', short: 'v', description: 'Print the CLI\'s version.' },
};

export interface Globals {
  json: boolean;
  yes: boolean;
  project?: string;
  apiUrl?: string;
  help: boolean;
  version: boolean;
}

/** Where the command words are: the positionals before the first `--`, skipping global flags' values. */
export function commandWords(argv: readonly string[]): { words: string[]; indexes: number[] } {
  const words: string[] = [];
  const indexes: number[] = [];
  const takesValue = new Set<string>();
  for (const [name, spec] of Object.entries(GLOBAL_OPTIONS)) {
    if (spec.type !== 'string') continue;
    takesValue.add(`--${name}`);
    if (spec.short) takesValue.add(`-${spec.short}`);
  }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') break;
    if (token.startsWith('-') && token !== '-') {
      if (takesValue.has(token)) i++;
      continue;
    }
    words.push(token);
    indexes.push(i);
  }
  return { words, indexes };
}

export interface Located {
  group?: GroupSpec;
  command?: CommandSpec;
  /** The argv without the words that named the group and command. */
  rest: string[];
  /** A first word that names nothing. */
  unknown?: string;
}

/** Finds the command the words name: a top-level command, or a group and its command. */
export function locate(
  argv: readonly string[],
  groups: readonly GroupSpec[],
  topCommands: readonly CommandSpec[],
): Located {
  const { words, indexes } = commandWords(argv);
  const without = (count: number) => argv.filter((_, i) => !indexes.slice(0, count).includes(i));
  if (words.length === 0) return { rest: [...argv] };
  const top = topCommands.find((c) => c.name === words[0]);
  if (top) return { command: top, rest: without(1) };
  const group = groups.find((g) => g.name === words[0] || g.aliases?.includes(words[0]));
  if (!group) return { rest: without(1), unknown: words[0] };
  if (words.length < 2) return { group, rest: without(1) };
  const command = group.commands.find((c) => c.name === words[1]);
  if (!command) return { group, rest: without(2), unknown: words[1] };
  return { group, command, rest: without(2) };
}

export interface ParsedCommand {
  globals: Globals;
  args: Record<string, string | string[] | undefined>;
  opts: Record<string, OptionValue>;
}

function parseOptionsFor(specs: Readonly<Record<string, OptionSpec>>) {
  const options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};
  for (const [name, spec] of Object.entries(specs)) {
    options[name] = { type: spec.type, ...(spec.short && { short: spec.short }), ...(spec.multiple && { multiple: true }) };
  }
  return options;
}

/** Only the global flags, for when no command is named (`taleart --version`, `taleart zones --help`). */
export function parseGlobals(argv: readonly string[]): { globals: Globals; positionals: string[] } {
  const parsed = safeParse(() =>
    parseArgs({ args: [...argv], options: parseOptionsFor(GLOBAL_OPTIONS), allowPositionals: true, strict: false }),
  );
  return { globals: globalsFrom(parsed.values as Record<string, OptionValue>), positionals: parsed.positionals };
}

function globalsFrom(values: Record<string, OptionValue>): Globals {
  const text = (v: OptionValue) => (typeof v === 'string' ? v : undefined);
  return {
    json: values['json'] === true,
    yes: values['yes'] === true,
    project: text(values['project']),
    apiUrl: text(values['api-url']),
    help: values['help'] === true,
    version: values['version'] === true,
  };
}

function safeParse<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    // util.parseArgs throws TypeErrors such as "Unknown option '--nam'" or "Option '--name <value>' argument missing".
    throw usageError(err instanceof Error ? err.message.replace(/\. To specify a positional argument.*$/s, '') : String(err));
  }
}

/** Parses a command's argv strictly: unknown flags, missing values and wrong counts are usage errors (exit 2). */
export function parseCommand(command: CommandSpec, argv: readonly string[]): ParsedCommand {
  const specs = { ...GLOBAL_OPTIONS, ...command.options };
  const parsed = safeParse(() =>
    parseArgs({ args: [...argv], options: parseOptionsFor(specs), allowPositionals: true, strict: true }),
  );
  const values = parsed.values as Record<string, OptionValue>;
  const globals = globalsFrom(values);
  if (globals.help || globals.version) return { globals, args: {}, opts: {} };

  const opts: Record<string, OptionValue> = {};
  for (const [name, spec] of Object.entries(command.options ?? {})) {
    let value = values[name];
    if (typeof value === 'string') value = value.trim() === '' && spec.required ? undefined : value;
    if (spec.required && (value === undefined || (Array.isArray(value) && value.length === 0))) {
      throw usageError(`Missing --${name}${spec.valueName ? ` ${spec.valueName}` : ''}`);
    }
    if (spec.choices && value !== undefined) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (typeof one === 'string' && !spec.choices.includes(one)) {
          throw usageError(`--${name} must be one of ${spec.choices.join(', ')} (got ${one})`);
        }
      }
    }
    opts[name] = value;
  }

  const args: Record<string, string | string[] | undefined> = {};
  const positionals = [...parsed.positionals];
  const specsArgs = command.args ?? [];
  for (const arg of specsArgs) {
    if (arg.variadic) {
      args[arg.name] = positionals.splice(0);
      if (arg.required && (args[arg.name] as string[]).length === 0) throw usageError(`Missing <${arg.name}>`);
    } else {
      const value = positionals.shift();
      if (value === undefined && arg.required) throw usageError(`Missing <${arg.name}>`);
      args[arg.name] = value;
    }
  }
  if (positionals.length > 0) throw usageError(`Unexpected argument: ${positionals[0]}`);
  return { globals, args, opts };
}
