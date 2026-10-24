import { UserListFileNotUtf8Error, UserListFileTooLargeError } from './errors';
import { readUserListCsv, type NumberedUserListRow, type UserListCsvOptions } from './user-list-csv';

const enc = new TextEncoder();

// The text as a stream of chunks of `size` bytes, so lines and characters are cut at every place.
async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size);
}

async function read(text: string | Uint8Array, size = 1024, options?: UserListCsvOptions): Promise<NumberedUserListRow[]> {
  const out: NumberedUserListRow[] = [];
  for await (const row of readUserListCsv(chunked(typeof text === 'string' ? enc.encode(text) : text, size), options)) {
    out.push(row);
  }
  return out;
}

describe('readUserListCsv', () => {
  const text = '\uFEFFu-1\r\nu-2\n\n"u,3"\ra,b\nü-5';
  const expected: NumberedUserListRow[] = [
    { kind: 'id', id: 'u-1', line: 1 },
    { kind: 'id', id: 'u-2', line: 2 },
    { kind: 'empty', line: 3 },
    { kind: 'id', id: 'u,3', line: 4 },
    { kind: 'refused', reason: 'not-one-column', line: 5 },
    { kind: 'refused', reason: 'not-ascii', line: 6 },
  ];

  it.each([1, 2, 3, 7, 1024])('reads LF, CRLF and CR lines in chunks of %i bytes', async (size) => {
    expect(await read(text, size)).toEqual(expected);
  });

  it('does not count a CRLF cut between chunks as two line breaks', async () => {
    const rows = await read('a\r\nb\r\n', 2);
    expect(rows).toEqual([
      { kind: 'id', id: 'a', line: 1 },
      { kind: 'id', id: 'b', line: 2 },
    ]);
  });

  it('skips the header row when asked', async () => {
    expect(await read('\nuser_id\nu-1\n', 4, { header: true })).toEqual([
      { kind: 'empty', line: 1 },
      { kind: 'id', id: 'u-1', line: 3 },
    ]);
  });

  it('refuses a huge line as too long without keeping it, and goes on', async () => {
    const rows = await read(`${'x'.repeat(200_000)}\nu-2\n${'y'.repeat(5000)}`, 1000);
    expect(rows).toEqual([
      { kind: 'refused', reason: 'too-long', line: 1 },
      { kind: 'id', id: 'u-2', line: 2 },
      { kind: 'refused', reason: 'too-long', line: 3 },
    ]);
  });

  it('refuses a 300-character value', async () => {
    expect(await read(`${'z'.repeat(300)}\n`)).toEqual([{ kind: 'refused', reason: 'too-long', line: 1 }]);
  });

  it('throws past the row cap, counting neither blank rows nor the header', async () => {
    await expect(read('h\na\n\nb\n', 1024, { header: true, maxRows: 2 })).resolves.toHaveLength(3);
    await expect(read('a\nb\nc\n', 1024, { maxRows: 2 })).rejects.toBeInstanceOf(UserListFileTooLargeError);
  });

  it('throws on bytes that are not UTF-8, naming no value', async () => {
    const bytes = new Uint8Array([...enc.encode('secret-1\nsecret-2\n'), 0xff, 0x0a]);
    const err = await read(bytes).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserListFileNotUtf8Error);
    expect((err as Error).message).not.toMatch(/secret/);
  });
});
