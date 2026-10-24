/**
 * What the API reference page (epic developer experience 10.2) does to the OpenAPI document before
 * Swagger UI shows it, and where it keeps the API URL. Pure functions, so the unit tests read them
 * without a browser.
 */

/** The API the reference calls until the reader sets another: the local API (`nx run api:serve`). */
export const DEFAULT_API_URL = 'http://localhost:3333';

/** The localStorage key of the API URL field. Only the URL is stored, never a credential. */
export const API_URL_STORAGE_KEY = 'taleart-docs:api-reference:api-url';

/** The OpenAPI document the docs build copies from `libs/contract/src/generated/openapi.json`. */
export const OPENAPI_ASSET = 'api-reference/openapi.json';

/**
 * swagger-ui-dist 5.33.1, vendored in `apps/docs/public/swagger-ui` (see its README), loaded only
 * by the API reference page. The SHA-384 hashes are the files' Subresource Integrity values; the
 * docs tests check them against the files.
 */
export const SWAGGER_UI = {
  version: '5.33.1',
  script: 'swagger-ui/swagger-ui-bundle.js',
  scriptIntegrity: 'sha384-ZPehFMQommnnuaZ4rpxgkgTT2DKFVp4hZC/7pLit+9Lek9T1YGSo23eHFbvNkXkw',
  style: 'swagger-ui/swagger-ui.css',
  styleIntegrity: 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW',
  /** The docs' own styles over Swagger UI: its colours, fonts and contrast fixes. */
  theme: 'api-reference/theme.css',
} as const;

/** The security scheme only a passkey sign-in in the dashboard sets: a cookie the docs cannot send. */
export const SESSION_SCHEME = 'session';

/** Added to an operation that only a passkey session may call (API tokens, invitations). */
export const SESSION_ONLY_NOTE =
  '**Dashboard only.** This needs a passkey session in the dashboard; the docs cannot send its cookie, and an API token is refused here (403 `forbidden`).';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

type Security = readonly Record<string, readonly string[]>[];
interface Server {
  url: string;
  [key: string]: unknown;
}
interface Operation {
  security?: Security;
  servers?: Server[];
  description?: string;
  tags?: string[];
  [key: string]: unknown;
}
type PathItem = { servers?: Server[]; [key: string]: unknown };

/** The parts of an OpenAPI 3.1 document this page reads or changes. */
export interface OpenApiDocument {
  security?: Security;
  servers?: Server[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, PathItem>;
  components?: { securitySchemes?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

/** Every operation of a document as `METHOD /path`, in document order. */
export function operationList(document: OpenApiDocument): string[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
  );
}

/**
 * The API URL as the page uses it: an http or https URL without credentials, query or fragment, and
 * without a trailing slash (`https://api.example.com`, or a base path behind a proxy such as
 * `https://example.com/taleart`). Anything else is null.
 */
export function normalizeApiUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

/** The stored API URL, or the default when none is stored, it is not valid or storage is unavailable. */
export function readApiUrl(storage: () => Storage | null): string {
  try {
    const stored = storage()?.getItem(API_URL_STORAGE_KEY);
    return (stored && normalizeApiUrl(stored)) || DEFAULT_API_URL;
  } catch {
    return DEFAULT_API_URL;
  }
}

/** Keeps the API URL for the next visit; best effort (private windows and blocked storage throw). */
export function storeApiUrl(storage: () => Storage | null, url: string): void {
  try {
    if (url === DEFAULT_API_URL) storage()?.removeItem(API_URL_STORAGE_KEY);
    else storage()?.setItem(API_URL_STORAGE_KEY, url);
  } catch {
    // Not kept: the page still uses it until it is closed.
  }
}

function absolute(servers: Server[] | undefined, apiUrl: string): Server[] | undefined {
  return servers?.map((server) =>
    server.url.startsWith('/') ? { ...server, url: apiUrl + (server.url === '/' ? '' : server.url) } : server,
  );
}

function withoutSession(security: Security | undefined): Security | undefined {
  return security?.filter((requirement) => !(SESSION_SCHEME in requirement));
}

/**
 * The document as the reference shows it, for requests to `apiUrl`:
 * - every server (the document's, a path's and an operation's) is absolute against `apiUrl`, so
 *   Try it out calls that API whatever the docs' own origin is;
 * - the cookie `session` scheme is gone, from the Authorize dialog and from every requirement, since
 *   a browser on the docs' origin cannot send that cookie; an operation that accepted only a
 *   session says so in its description ({@link SESSION_ONLY_NOTE});
 * - nothing else changes: every path, operation, schema and example is the API's.
 * The input is not changed.
 */
export function prepareSpec(source: OpenApiDocument, apiUrl: string): OpenApiDocument {
  const document = structuredClone(source) as OpenApiDocument;
  document.servers = absolute(document.servers, apiUrl);
  document.security = withoutSession(document.security);
  const schemes = document.components?.securitySchemes;
  if (schemes) delete schemes[SESSION_SCHEME];
  for (const item of Object.values(document.paths)) {
    item.servers = absolute(item.servers, apiUrl);
    if (!item.servers) delete item.servers;
    for (const method of METHODS) {
      const operation = item[method] as Operation | undefined;
      if (!operation) continue;
      if (operation.servers) operation.servers = absolute(operation.servers, apiUrl);
      if (!operation.security) continue;
      const kept = withoutSession(operation.security) ?? [];
      if (kept.length === 0 && operation.security.length > 0) {
        operation.description = operation.description
          ? `${SESSION_ONLY_NOTE}\n\n${operation.description}`
          : SESSION_ONLY_NOTE;
      }
      operation.security = kept;
    }
  }
  if (!document.servers) delete document.servers;
  return document;
}
