import { createInterface } from 'node:readline';

/**
 * Asks `question` on `output` and reads one line from `input`; null when the input ends (EOF,
 * Ctrl-D) or closes first, which a confirmation reads as "no".
 */
export function promptLine(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: false });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      resolve(line);
      rl.close();
    });
    rl.once('close', () => {
      if (!answered) resolve(null);
    });
    output.write(question);
  });
}
