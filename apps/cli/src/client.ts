import type { ErrorBody } from '@taleart/contract/core';
import { CliError, EXIT, exitCodeForStatus } from './errors';

/** The Management API's base path (`servers` in openapi.yaml). */
export const MANAGEMENT_API_PATH = '/api/v1';

/** How long a request may take before the CLI gives up: 60 s, uploads 300 s (the API's own limit). */
export const REQUEST_TIMEOUT_MS = 60_000;
export const UPLOAD_TIMEOUT_MS = 300_000;

export type Fetch = typeof fetch;

export interface RequestOptions {
  /** A JSON body. */
  json?: unknown;
  /** A raw body (a file), sent with `contentType`. */
  body?: Blob;
  contentType?: string;
  query?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/**
 * The Management API over `fetch`, with the token as `Authorization: Bearer`. A refusal becomes a
 * {@link CliError} with the API's error code and message and the exit code for its status; the token
 * never appears in one.
 */
export class ApiClient {
  constructor(
    readonly apiUrl: string,
    private readonly token: string,
    private readonly fetchImpl: Fetch,
  ) {}

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, json?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, json });
  }
  put<T>(path: string, json?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, json });
  }
  patch<T>(path: string, json?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, json });
  }
  delete<T = null>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  url(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.apiUrl}${MANAGEMENT_API_PATH}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    let body: string | Blob | undefined;
    if (options.body !== undefined) {
      body = options.body;
      headers['Content-Type'] = options.contentType ?? (options.body.type || 'application/octet-stream');
    } else if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers['Content-Type'] = 'application/json';
    }
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw networkError(this.apiUrl, err, timeoutMs);
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      // A refusal is read from its status even when its body breaks off; a success is not known to be one.
      if (!response.ok) throw apiError(response, '');
      const cause = err instanceof Error ? err.message : String(err);
      throw new CliError(
        `The API's answer to ${method} ${path} broke off (${response.status}): ${cause}`,
        EXIT.network,
        'response_interrupted',
        response.status,
        'The change may or may not have been made: read it back before trying again.',
      );
    }
    if (!response.ok) throw apiError(response, text);
    if (response.status === 204 || text === '') return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(`The API answered ${method} ${path} with something other than JSON`, EXIT.unexpected, 'invalid_response', response.status);
    }
  }
}

function networkError(apiUrl: string, err: unknown, timeoutMs: number): CliError {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new CliError(`The API at ${apiUrl} did not answer within ${timeoutMs / 1000} s`, EXIT.network, 'timeout');
  }
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : err instanceof Error ? err.message : String(err);
  return new CliError(
    `Cannot reach the API at ${apiUrl}: ${cause}`,
    EXIT.network,
    'api_unreachable',
    undefined,
    'Check TALEART_API_URL (or taleart login --url) and that the API is running.',
  );
}

const HINTS: Record<number, string> = {
  401: 'The token is missing, unknown, revoked or expired: create one in the dashboard (Settings > API tokens), then set TALEART_TOKEN or run taleart login.',
  403: 'The token\'s user, its project list or read-only access does not allow this; run taleart whoami to see what it can do.',
};

function apiError(response: Response, text: string): CliError {
  let code = `http_${response.status}`;
  let message = `The API answered ${response.status} ${response.statusText}`.trim();
  try {
    const body = JSON.parse(text) as Partial<ErrorBody>;
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Not an ErrorBody (a proxy's page, an empty answer): the status says enough.
  }
  let hint = HINTS[response.status];
  if (response.status === 429) {
    const retry = response.headers.get('Retry-After');
    hint = retry ? `Try again in ${retry} s.` : 'Try again later.';
  }
  return new CliError(message, exitCodeForStatus(response.status), code, response.status, hint);
}
