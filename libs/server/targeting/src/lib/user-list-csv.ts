import {
  MAX_EXTERNAL_USER_ID_LENGTH,
  MAX_USER_LIST_CSV_ROWS,
  parseUserListCsvLine,
  type UserListCsvRow,
} from '@taleart/contract';
import { UserListFileNotUtf8Error, UserListFileTooLargeError } from './errors';

/** A row of a CSV with its line number in the file, from 1. */
export type NumberedUserListRow = UserListCsvRow & { line: number };

/** How a CSV is read. */
export interface UserListCsvOptions {
  /** True when the first non-empty row is a header, which is skipped. */
  header?: boolean;
  /** The most rows (non-empty, the header left out); more throws {@link UserListFileTooLargeError}. */
  maxRows?: number;
}

// A line this long cannot hold an ID of at most 256 code points once trimmed, unless it is mostly
// spaces; it is refused as too long without being kept, so one huge line costs no memory.
const MAX_LINE_CHARS = MAX_EXTERNAL_USER_ID_LENGTH * 4 + 64;
const TOO_LONG: UserListCsvRow = { kind: 'refused', reason: 'too-long' };
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Reads a single-column CSV from a stream of bytes, one row at a time, without holding the file: the
 * bytes are decoded as UTF-8 (fatal on a byte that is not; a byte order mark is skipped), cut at LF,
 * CRLF or CR, and each line read by {@link parseUserListCsvLine}. Errors never name a value.
 */
export async function* readUserListCsv(
  chunks: AsyncIterable<Uint8Array>,
  options: UserListCsvOptions = {},
): AsyncGenerator<NumberedUserListRow> {
  const maxRows = options.maxRows ?? MAX_USER_LIST_CSV_ROWS;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let skipHeader = options.header === true;
  let rows = 0;
  let line = 0;
  // The text after the last line break so far; while `overlong`, the line is being skipped.
  let rest = '';
  let overlong = false;

  function* emit(text: string, tooLong: boolean): Generator<NumberedUserListRow> {
    line++;
    const row = tooLong ? TOO_LONG : parseUserListCsvLine(text);
    if (row.kind === 'empty') {
      yield { ...row, line };
      return;
    }
    if (skipHeader) {
      skipHeader = false;
      return;
    }
    if (++rows > maxRows) throw new UserListFileTooLargeError();
    yield { ...row, line };
  }

  function* take(text: string, final: boolean): Generator<NumberedUserListRow> {
    let buffer = rest + text;
    rest = '';
    // A CR at the very end may be the first half of a CRLF: wait for the next chunk.
    let keepCr = false;
    if (!final && buffer.endsWith('\r')) {
      buffer = buffer.slice(0, -1);
      keepCr = true;
    }
    const lines = buffer.split(LINE_BREAK);
    const last = lines.pop() ?? '';
    for (const text of lines) {
      yield* emit(overlong ? '' : text, overlong || text.length > MAX_LINE_CHARS);
      overlong = false;
    }
    if (final) {
      if (overlong || last.length > 0) yield* emit(overlong ? '' : last, overlong || last.length > MAX_LINE_CHARS);
      overlong = false;
      return;
    }
    if (overlong || last.length > MAX_LINE_CHARS) {
      overlong = true;
      rest = keepCr ? '\r' : '';
    } else {
      rest = keepCr ? `${last}\r` : last;
    }
  }

  const decode = (bytes?: Uint8Array): string => {
    try {
      return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    } catch {
      throw new UserListFileNotUtf8Error();
    }
  };

  for await (const chunk of chunks) yield* take(decode(chunk), false);
  yield* take(decode(), true);
}
