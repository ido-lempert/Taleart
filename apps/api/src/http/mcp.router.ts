import { ErrorCodes } from '@taleart/contract';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { credential } from './credentials';
import { errorBody } from './errors';

/**
 * The MCP server (Model Context Protocol) over SSE, mounted at `/api/v1/mcp` (the MCP SSE transport):
 *
 * - `GET /api/v1/mcp/sse` opens the event stream; the client then POSTs to the `messages` endpoint the
 *   stream names, `POST /api/v1/mcp/messages?sessionId=…`.
 * - Both need a personal API token (`Authorization: Bearer tat_…`), which the router reads from the
 *   same credential check every Management API route uses. A session cookie is refused here: an MCP
 *   client is a script or an assistant acting as the token's user, never a browser.
 * - Its tools are the Management API's own operations, read from the OpenAPI document: `list_operations`
 *   lists the ones the token may call, and `call_operation` calls one. Each call goes to the API with
 *   the same token, so the token's projects and read-only limit apply exactly as they do over HTTP.
 *
 * The kill switch is `TALEART_MCP=off` (see {@link mcpEnabledFromEnv}); it is on by default. When off,
 * the routes are not mounted at all and answer 404 like any unknown path.
 */

/** The MCP path under the Management API base, for the docs and the router's own tests. */
export const MCP_PATH = '/mcp';

/**
 * The largest body a message may carry: an upload_media call sends its file base64-encoded (a third
 * larger), so this is the largest image (10 MB) and video up to 12 MB; a larger video goes through the
 * API's upload directly.
 */
export const MCP_MESSAGE_BODY_LIMIT = '17mb';
/** The largest file upload_media takes, decoded. */
export const MCP_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

/** The environment variable that turns the MCP server off (`off`) or on (`on`, the default). */
export const MCP_ENV = 'TALEART_MCP';

/** Reads the kill switch: unset or `on` keeps the MCP server, `off` turns it off; any other value stops startup. */
export function mcpEnabledFromEnv(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'on') return true;
  if (value === 'off') return false;
  throw new Error(`${MCP_ENV} must be on or off (got ${JSON.stringify(value)})`);
}

/** How the MCP server is set up by the app. */
export interface McpOptions {
  /** False turns the server off (the kill switch); left out, it is on. */
  enabled?: boolean;
  /**
   * The Management API's base URL as this process reaches it, e.g. `http://127.0.0.1:3333/api/v1`. The
   * tools call the API here with the caller's token. It is never taken from a request, so a request
   * cannot send a token to another host.
   */
  apiBase?: string;
  /** Replaces `fetch` for the tool calls (tests). */
  fetchImpl?: typeof fetch;
}

/** The subset of an OpenAPI operation the tools read. */
interface OperationSpec {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: Array<Record<string, unknown[]>>;
  parameters?: Array<{ name: string; in: string; required?: boolean; description?: string }>;
  requestBody?: { content?: Record<string, unknown> };
}

/** The subset of the OpenAPI document the tools read. */
export interface OpenApiLike {
  security?: Array<Record<string, unknown[]>>;
  paths: Record<string, Record<string, OperationSpec | unknown>>;
}

/** One operation a token may call through the MCP tools. */
export interface McpOperation {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  /** The `{name}` placeholders of the path. */
  pathParams: string[];
  /** Whether the operation takes a JSON body. */
  hasBody: boolean;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * The operations a personal API token may call (the ones whose security allows `token`), with a JSON
 * body or none: uploads (fonts, media, user list files) send a file, which these tools do not carry.
 */
export function tokenOperations(doc: OpenApiLike): Map<string, McpOperation> {
  const operations = new Map<string, McpOperation>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const spec = (item as Record<string, unknown>)[method] as OperationSpec | undefined;
      if (!spec?.operationId) continue;
      const security = spec.security ?? doc.security ?? [];
      if (!security.some((requirement) => 'token' in requirement)) continue;
      const content = spec.requestBody?.content;
      if (content && !('application/json' in content)) continue;
      operations.set(spec.operationId, {
        operationId: spec.operationId,
        method: method.toUpperCase(),
        path,
        summary: spec.summary ?? '',
        tag: spec.tags?.[0] ?? '',
        pathParams: [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string),
        hasBody: content !== undefined,
      });
    }
  }
  return operations;
}

const TOOLS: Tool[] = [
  {
    name: 'list_operations',
    description:
      'List the TaleArt Management API operations this token may call, with their operationId, method, path, tag and summary. ' +
      'Call it first; then call_operation with an operationId from it.',
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Only operations with this tag, such as Zones or Tales.' } },
    },
  },
  {
    name: 'call_operation',
    description:
      'Call one TaleArt Management API operation by its operationId (from list_operations) as the token’s user. ' +
      'Returns the HTTP status and the JSON body. A read-only token may only read (403 otherwise).',
    inputSchema: {
      type: 'object',
      required: ['operationId'],
      properties: {
        operationId: { type: 'string' },
        pathParams: { type: 'object', description: 'Values for the {placeholders} of the path, by name.', additionalProperties: true },
        query: { type: 'object', description: 'Query parameters, by name. An array sends each value.', additionalProperties: true },
        body: { description: 'The JSON body, for operations that take one.' },
      },
    },
  },
  {
    name: 'upload_media',
    description:
      'Upload an image (JPEG, PNG, WebP or GIF) or a video (MP4 or WebM) to a project’s media library as the token’s user. ' +
      'The file is base64 in dataBase64, at most 12 MB decoded (a larger video goes through the API). Returns the HTTP status and ' +
      'the media record; its key is the mediaKey a tale element uses, set with call_operation on the tale’s document. ' +
      'An image or video that is already hosted elsewhere (such as a CDN) needs no upload: set the element’s externalUrl, ' +
      'an https address, instead of mediaKey (not on stickers or image buttons). ' +
      'A read-only token may not upload (403).',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'contentType', 'dataBase64'],
      properties: {
        projectId: { type: 'string', description: 'The project the file goes to (listProjects).' },
        contentType: {
          type: 'string',
          enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'],
          description: 'The file’s type; its bytes must match it.',
        },
        dataBase64: { type: 'string', description: 'The file’s bytes, base64-encoded (no data: prefix).' },
      },
    },
  },
];

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function textResult(value: unknown, isError = false): ToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError };
}

/** The path with its placeholders filled, and the query string; undefined when a placeholder has no value. */
function requestPath(operation: McpOperation, pathParams: Record<string, unknown>, query: Record<string, unknown>): string | undefined {
  let path = operation.path;
  for (const name of operation.pathParams) {
    const value = pathParams[name];
    if (value === undefined || value === null || value === '') return undefined;
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

interface Session {
  transport: SSEServerTransport;
  /** The token's Authorization header, which a message must repeat. */
  authorization: string;
}

/**
 * The MCP router. Mounted under the Management API after the caller check, so `credential(res)` is
 * already the request's token. Each SSE connection is one MCP session with its own server.
 */
export function mcpRouter(doc: OpenApiLike, options: McpOptions = {}): express.Router {
  const router = express.Router();
  const operations = tokenOperations(doc);
  const apiBase = (options.apiBase ?? 'http://127.0.0.1:3333/api/v1').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessions = new Map<string, Session>();

  /** The bearer token of this request, or undefined; only a token may use MCP. */
  const tokenOf = (req: Request, res: Response): string | undefined => {
    if (credential(res).kind !== 'token') return undefined;
    const header = req.headers.authorization;
    return header && /^Bearer\s+\S+\s*$/i.test(header) ? header : undefined;
  };

  const sameToken = (a: string, b: string): boolean => {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
  };

  async function callApi(authorization: string, input: Record<string, unknown>): Promise<ToolResult> {
    const operationId = typeof input['operationId'] === 'string' ? input['operationId'] : '';
    const operation = operations.get(operationId);
    if (!operation) return textResult(`Unknown operationId ${JSON.stringify(operationId)}. Call list_operations for the ones this token may call.`, true);
    const pathParams = (input['pathParams'] ?? {}) as Record<string, unknown>;
    const query = (input['query'] ?? {}) as Record<string, unknown>;
    const path = requestPath(operation, pathParams, query);
    if (path === undefined) return textResult(`${operation.operationId} needs the path values: ${operation.pathParams.join(', ')}.`, true);
    const hasBody = input['body'] !== undefined && input['body'] !== null;
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        method: operation.method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(input['body']) : undefined,
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        // Not JSON: returned as text.
      }
      return textResult({ status: response.status, body }, response.status >= 400);
    } catch (err) {
      return textResult(`The API could not be reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** Uploads a file to a project's media through the API, as the token's user; the API judges its bytes. */
  async function uploadMedia(authorization: string, input: Record<string, unknown>): Promise<ToolResult> {
    const { projectId, contentType, dataBase64 } = input as Record<string, unknown>;
    if (typeof projectId !== 'string' || projectId === '') return textResult('projectId is needed', true);
    if (typeof contentType !== 'string' || contentType === '') return textResult('contentType is needed', true);
    if (typeof dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64) || dataBase64.length % 4 !== 0) {
      return textResult('dataBase64 must be the file’s bytes in base64', true);
    }
    const bytes = Buffer.from(dataBase64, 'base64');
    if (bytes.length === 0) return textResult('The file is empty', true);
    if (bytes.length > MCP_UPLOAD_MAX_BYTES) {
      return textResult(`The file is larger than ${MCP_UPLOAD_MAX_BYTES / (1024 * 1024)} MB: upload it through the API`, true);
    }
    try {
      const response = await fetchImpl(`${apiBase}/projects/${encodeURIComponent(projectId)}/media`, {
        method: 'POST',
        headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': contentType },
        body: bytes,
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        // Not JSON: returned as text.
      }
      return textResult({ status: response.status, body }, response.status >= 400);
    } catch (err) {
      return textResult(`The API could not be reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function serverFor(authorization: string): Server {
    const server = new Server(
      { name: 'taleart', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions:
          'TaleArt: zones, tale groups, tales, targeting and sites. Call list_operations, then call_operation with an operationId. ' +
          'Every call acts as the token’s user, within the token’s projects.',
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      if (request.params?.cursor) return { tools: [] };
      return { tools: TOOLS };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      if (request.params.name === 'list_operations') {
        const tag = typeof args['tag'] === 'string' ? args['tag'] : undefined;
        const listed = [...operations.values()]
          .filter((op) => tag === undefined || op.tag === tag)
          .map(({ operationId, method, path, summary, tag: opTag, hasBody }) => ({ operationId, method, path, tag: opTag, summary, hasBody }));
        return textResult(listed);
      }
      if (request.params.name === 'call_operation') return callApi(authorization, args);
      if (request.params.name === 'upload_media') return uploadMedia(authorization, args);
      return textResult(`Unknown tool ${request.params.name}`, true);
    });
    return server;
  }

  router.get('/sse', async (req, res) => {
    const authorization = tokenOf(req, res);
    if (authorization === undefined) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="TaleArt Management API"');
      res.setHeader('Cache-Control', 'no-store');
      res.status(401).json(errorBody(ErrorCodes.unauthenticated, 'MCP needs an API token: Authorization: Bearer <token>'));
      return;
    }
    const transport = new SSEServerTransport(`${req.baseUrl}/messages`, res);
    const server = serverFor(authorization);
    sessions.set(transport.sessionId, { transport, authorization });
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
  });

  router.post('/messages', async (req, res) => {
    const id = typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : '';
    const session = sessions.get(id);
    if (!session) {
      res.status(404).json(errorBody(ErrorCodes.notFound, 'Unknown or closed MCP session; connect to /sse again'));
      return;
    }
    const authorization = tokenOf(req, res);
    if (authorization === undefined || !sameToken(authorization, session.authorization)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="TaleArt Management API"');
      res.status(401).json(errorBody(ErrorCodes.unauthenticated, 'This MCP session belongs to another token'));
      return;
    }
    // The body is already parsed by express.json(). The SDK's handlePostMessage re-reads the content type
    // through the `content-type` package, which breaks when a deployment installs a different build of it
    // ("Cannot read properties of undefined (reading 'parse')"), so the message goes to the transport directly.
    if (!req.is('application/json') || typeof req.body !== 'object' || req.body === null) {
      res.status(400).json(errorBody(ErrorCodes.validationFailed, 'Send one JSON-RPC message as application/json'));
      return;
    }
    try {
      await session.transport.handleMessage(req.body);
    } catch {
      res.status(400).json(errorBody(ErrorCodes.validationFailed, 'Invalid JSON-RPC message'));
      return;
    }
    res.status(202).send('Accepted');
  });

  return router;
}
