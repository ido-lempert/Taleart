/**
 * The CLI's exit codes (documented in `taleart help exit-codes`). Scripts and agents branch on
 * these, so they never change meaning.
 */
export const EXIT = {
  ok: 0,
  /** Anything unexpected: a bug, an answer the CLI cannot read. */
  unexpected: 1,
  /** Unknown command or flag, a missing argument, a bad value, no project chosen. */
  usage: 2,
  /** No API URL or token, or the API answered 401. */
  auth: 3,
  /** The API answered 403: the token's user, project scope or read-only access does not allow it. */
  forbidden: 4,
  /** The API answered 404, or a name or slug matched nothing. */
  notFound: 5,
  /** The API answered 409, or a name matched several things. */
  conflict: 6,
  /** The API refused the input (400, 408, 411, 413, 415, 422), or a local file is missing or unusable. */
  invalid: 7,
  /** The API answered 429 or 5xx. */
  server: 8,
  /** The API could not be reached, or did not answer in time. */
  network: 9,
  /** A destructive command needs `--yes` and there is no terminal to ask at. */
  confirm: 10,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Every exit code with its name and what it means, for `taleart help exit-codes`. */
export const EXIT_CODE_MEANINGS: ReadonlyArray<[ExitCode, keyof typeof EXIT, string]> = [
  [EXIT.ok, 'ok', 'Success.'],
  [EXIT.unexpected, 'unexpected', 'Unexpected error (a bug, or an answer the CLI cannot read).'],
  [EXIT.usage, 'usage', 'Usage error: unknown command or flag, missing argument, bad value, no project chosen.'],
  [EXIT.auth, 'auth', 'Not authenticated: no API URL or token, or the token is unknown, revoked or expired (401).'],
  [EXIT.forbidden, 'forbidden', 'Forbidden (403): the user, the token\'s projects or a read-only token do not allow it.'],
  [EXIT.notFound, 'notFound', 'Not found (404), or a name or slug that matches nothing.'],
  [EXIT.conflict, 'conflict', 'Conflict (409), or a name that matches more than one thing.'],
  [EXIT.invalid, 'invalid', 'Refused input (400, 408, 411, 413, 415, 422), or a local file that is missing or unusable.'],
  [EXIT.server, 'server', 'Rate limited (429) or a server error (5xx), including a feature the server has turned off.'],
  [EXIT.network, 'network', 'The API cannot be reached, did not answer in time, or its answer broke off.'],
  [EXIT.confirm, 'confirm', 'Confirmation needed or refused: rerun a destructive command with --yes.'],
];

/** An error the CLI reports and exits with: a message for people, a code and exit code for scripts. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    /** A stable machine code: the API's error code, or one of the CLI's own (`usage`, `not_found`…). */
    readonly code: string,
    /** The HTTP status when the API answered. */
    readonly status?: number,
    /** What to do about it, shown on its own line. */
    readonly hint?: string,
    /** More for scripts, merged into the `--json` error document (such as `created` after a partial failure). */
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, EXIT.usage, 'usage', undefined, hint);
}

/** The exit code for an HTTP status the API answered with (not 2xx). */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return EXIT.auth;
  if (status === 403) return EXIT.forbidden;
  if (status === 404) return EXIT.notFound;
  if (status === 409) return EXIT.conflict;
  if (status === 429 || status >= 500) return EXIT.server;
  if (status >= 400) return EXIT.invalid;
  return EXIT.unexpected;
}
