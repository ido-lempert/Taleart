import type { ApiClient, Fetch } from './client';
import type { Env, ResolvedConfig, StoredConfig } from './config';
import type { Output } from './output';

/** Everything the CLI touches outside itself, so tests run it in process with fakes. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Env;
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  /**
   * True when a person can answer a question: both stdin and stderr are terminals. The CLI also
   * treats CI=true and TALEART_NO_INPUT=1 as no person.
   */
  interactive: boolean;
  /** True when stdin is a terminal (`login --token-stdin` then refuses, as nothing is piped in). */
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  /** Asks a question on stderr and reads one line from stdin; null when stdin ends first. Only called when `interactive`. */
  prompt(question: string): Promise<string | null>;
  fetch: Fetch;
}

export interface OptionSpec {
  type: 'string' | 'boolean';
  short?: string;
  multiple?: boolean;
  description: string;
  /** The value's placeholder in help, such as `<name>`. */
  valueName?: string;
  required?: boolean;
  choices?: readonly string[];
}

export interface ArgSpec {
  name: string;
  description: string;
  required?: boolean;
  /** Takes every remaining positional (the last argument only). */
  variadic?: boolean;
}

export type OptionValue = string | boolean | string[] | undefined;

export interface Context {
  /** Positional arguments by name (a variadic one as an array). */
  args: Record<string, string | string[] | undefined>;
  /** The command's own options, after checks. */
  opts: Record<string, OptionValue>;
  json: boolean;
  yes: boolean;
  io: Io;
  config: ResolvedConfig;
  stored: StoredConfig;
  configDir: string;
  /** The API client; throws exit 3 when there is no URL or token. */
  client(): ApiClient;
  /** The project's id from `--project`, TALEART_PROJECT or the config (by id or name); exit 2 when none. */
  projectId(): Promise<string>;
  /** As {@link projectId}, or null when none is chosen. */
  projectIdOrNull(): Promise<string | null>;
  /** Goes on with `--yes` or a person's "yes"; otherwise stops with exit 10. */
  confirm(message: string): Promise<void>;
  /** A warning: on stderr, or with `--json` in the one JSON document stderr gets. */
  warn(message: string): void;
  /** Progress for people (`Created tale …`): on stderr without `--json`, nothing with it. */
  info(message: string): void;
  /** True for a destructive command: names must match exactly (no case-insensitive match). */
  exact: boolean;
  /** Replaces the stored config (mode 0600). */
  saveConfig(config: StoredConfig): void;
  /** Deletes the stored config. */
  removeConfig(): boolean;
}

export interface CommandSpec {
  name: string;
  summary: string;
  description?: string;
  args?: readonly ArgSpec[];
  options?: Readonly<Record<string, OptionSpec>>;
  /** Whether the command uses `--project`: needs one, may use one, or ignores it. */
  project?: 'required' | 'optional';
  /** False for commands that work without an API URL and token (help, config, logout). */
  auth?: boolean;
  /** Destructive: needs `--yes` (documented in its help). */
  destructive?: boolean;
  /** True when the command changes something on the server or in the config file. */
  mutates: boolean;
  /**
   * What `--json` prints on stdout: an OpenAPI schema name (`Zone`, `TaleGroup[]`, `Frame | null`)
   * or, for the CLI's own results, their shape.
   */
  result: string;
  /** True for commands that still work when the config file cannot be read (login, logout, config path). */
  ignoreBadConfig?: boolean;
  examples: readonly string[];
  run(ctx: Context): Promise<Output>;
}

export interface GroupSpec {
  name: string;
  aliases?: readonly string[];
  summary: string;
  description?: string;
  commands: readonly CommandSpec[];
}
