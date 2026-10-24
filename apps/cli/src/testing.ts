// Test helpers (used only by the specs): an in-memory Io and a fake fetch that routes by method and path.
import type { Io } from './command';

export interface Call {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined;

export interface FakeIo extends Io {
  out: string[];
  err: string[];
  calls: Call[];
  readonly stdoutText: string;
  readonly stderrText: string;
}

/** An Io whose fetch answers from `route` (404 `not_found` for anything it does not know). */
export function fakeIo(route: Route = () => undefined, overrides: Partial<Io> = {}): FakeIo {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    let body: unknown = init?.body;
    if (typeof body === 'string' && headers['Content-Type'] === 'application/json') body = JSON.parse(body);
    if (body instanceof Blob) body = { blob: body.type, size: body.size };
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname.replace(/^\/api\/v1/, ''), query: url.search, headers, body };
    calls.push(call);
    const answer = route(call) ?? { status: 404, body: { error: { code: 'not_found', message: `No route ${call.method} ${call.path}` } } };
    const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
    return new Response(answer.status === 204 ? null : text, { status: answer.status, headers: answer.headers });
  };
  const io = {
    stdout: (text: string) => void out.push(text),
    stderr: (text: string) => void err.push(text),
    env: {},
    platform: 'linux' as NodeJS.Platform,
    home: '/home/test',
    cwd: process.cwd(),
    interactive: false,
    stdinIsTTY: false,
    readStdin: async () => '',
    prompt: async (): Promise<string | null> => '',
    fetch: fetchImpl as typeof fetch,
    out,
    err,
    calls,
    get stdoutText() {
      return out.join('');
    },
    get stderrText() {
      return err.join('');
    },
    ...overrides,
  };
  return io as FakeIo;
}

export const TOKEN = 'tat_abcdefSECRETSECRETSECRETSECRETSECRETxyz';
export const PROJECT = { id: '11111111-1111-4111-8111-111111111111', name: 'Shop' };
