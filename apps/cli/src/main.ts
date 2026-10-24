import { homedir } from 'node:os';
import { run } from './cli';
import type { Io } from './command';
import { promptLine } from './prompt';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// A reader that went away (`taleart zones list | head -1`) is not an error: stop quietly.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0);
    throw err;
  });
}

const io: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  platform: process.platform,
  home: homedir(),
  cwd: process.cwd(),
  interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  readStdin,
  prompt: (question) => promptLine(process.stdin, process.stderr, question),
  fetch: (input, init) => fetch(input, init),
};

run(process.argv.slice(2), io).then(
  (code) => {
    // Set, not exit(): stdout is flushed before the process ends, even when piped.
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`taleart: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
