import { CliError, EXIT } from './errors';

/**
 * What a command returns: `data` is printed as JSON with `--json` (the API's answer, or the
 * command's own documented shape); `text` is what a person reads otherwise. Without `text`, `data`
 * is printed as JSON in both modes.
 */
export interface Output {
  data: unknown;
  text?: string;
}

export interface Column<T> {
  label: string;
  value: (row: T) => unknown;
}

/** One cell: dates and nulls readable, objects as compact JSON, no line breaks. */
export function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/[\r\n\t]+/g, ' ');
}

/** A table with a header row, columns padded to their widest cell, two spaces apart. */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[], empty: string): string {
  if (rows.length === 0) return empty;
  const cells = rows.map((row) => columns.map((c) => cell(c.value(row))));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((r) => r[i].length)));
  const line = (values: string[]) =>
    values
      .map((v, i) => (i === values.length - 1 ? v : v.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(columns.map((c) => c.label.toUpperCase())), ...cells.map(line)].join('\n');
}

/** Label/value lines, labels padded so the values line up. */
export function record(pairs: ReadonlyArray<[string, unknown]>): string {
  const width = Math.max(...pairs.map(([label]) => label.length)) + 1;
  return pairs.map(([label, value]) => `${`${label}:`.padEnd(width)} ${cell(value)}`).join('\n');
}

/** JSON as `--json` prints it: indented, one document, a final newline. */
export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The error document `--json` writes to stderr, so a script can read why a command failed. */
export function errorJson(err: CliError): string {
  return json({
    error: {
      code: err.code,
      message: err.message,
      ...(err.status !== undefined && { status: err.status }),
      exitCode: err.exitCode,
      ...(err.hint && { hint: err.hint }),
    },
  });
}

/** The error as people read it on stderr: `taleart: <message>` and the hint on its own line. */
export function errorText(err: CliError): string {
  const status = err.status === undefined ? '' : ` (${err.status} ${err.code})`;
  return `taleart: ${err.message}${status}\n${err.hint ? `hint: ${err.hint}\n` : ''}`;
}

/** Any thrown value as a {@link CliError}. */
export function asCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CliError(message, EXIT.unexpected, 'unexpected');
}
