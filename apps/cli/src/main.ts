import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { run } from './cli';
import type { Io } from './command';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const io: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  platform: process.platform,
  home: homedir(),
  cwd: process.cwd(),
  interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  readStdin,
  prompt,
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
