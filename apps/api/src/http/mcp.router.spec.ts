import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import express from 'express';
import { mcpEnabledFromEnv, mcpRouter, MCP_PATH, tokenOperations, type OpenApiLike } from './mcp.router';
import { errorBody } from './errors';
import type { Credential } from './credentials';

// A small document: one operation a token may call, one a session only may, and an upload a token may not.
const DOC: OpenApiLike = {
  security: [{ session: [] }, { token: [] }],
  paths: {
    '/projects/{projectId}': {
      get: { operationId: 'getProject', summary: 'Get a project', tags: ['Projects'] },
    },
    '/projects/{projectId}/fonts': {
      post: {
        operationId: 'uploadFont',
        summary: 'Upload a font',
        tags: ['Fonts'],
        requestBody: { content: { 'font/woff2': {} } },
      },
    },
    '/api-tokens': {
      get: { operationId: 'listApiTokens', summary: 'List tokens', tags: ['API tokens'], security: [{ session: [] }] },
    },
    '/zones/{zoneId}': {
      put: {
        operationId: 'updateZone',
        summary: 'Update a zone',
        tags: ['Zones'],
        requestBody: { content: { 'application/json': {} } },
      },
    },
  },
};

const TOKEN = 'Bearer tat_testtoken0000000000000000000000000000';

/** Serves an express app on a free loopback port; resolves once it listens. */
async function listen(app: express.Express): Promise<Server> {
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return server;
}

/** Records what the fake API received and answers from a fixed table. */
async function fakeApi(): Promise<{ server: Server; base: string; seen: Array<{ method: string; url: string; auth?: string; body: string }> }> {
  const seen: Array<{ method: string; url: string; auth?: string; body: string }> = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.url?.startsWith('/api/v1/projects/')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ id: decodeURIComponent(req.url.split('/')[4] ?? ''), name: 'Shop' }));
        return;
      }
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(errorBody('forbidden', 'nope')));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}/api/v1`, seen };
}

/** An app that stands in for the API's caller check: a bearer header is a token credential, anything else a session. */
function appWith(apiBase: string) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const credential: Credential =
      req.headers.authorization ?
        { kind: 'token', tokenId: 'tok', projects: { kind: 'all' } as never, readOnly: false }
      : { kind: 'session' };
    res.locals['credential'] = credential;
    next();
  });
  app.use(`/api/v1${MCP_PATH}`, mcpRouter(DOC, { apiBase }));
  return app;
}

describe('the MCP server (TALEART_MCP)', () => {
  it('is on unless TALEART_MCP is off, and an unknown value stops the API', () => {
    expect(mcpEnabledFromEnv(undefined)).toBe(true);
    expect(mcpEnabledFromEnv('on')).toBe(true);
    expect(mcpEnabledFromEnv('off')).toBe(false);
    expect(() => mcpEnabledFromEnv('no')).toThrow('TALEART_MCP must be on or off');
  });

  it('offers only the operations a token may call, without uploads or session-only ones', () => {
    const ops = [...tokenOperations(DOC).keys()].sort();
    expect(ops).toEqual(['getProject', 'updateZone']);
    expect(tokenOperations(DOC).get('getProject')?.pathParams).toEqual(['projectId']);
  });

  it('connects over SSE with a token, lists its operations and calls one as the token', async () => {
    const api = await fakeApi();
    const app = appWith(api.base);
    const web = await listen(app);
    const port = (web.address() as AddressInfo).port;
    const client = new Client({ name: 'test', version: '1.0.0' });
    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${port}/api/v1${MCP_PATH}/sse`), {
      requestInit: { headers: { Authorization: TOKEN } },
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual(['call_operation', 'list_operations']);

      const listed = await client.callTool({ name: 'list_operations', arguments: {} });
      const text = (listed.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(text).toContain('getProject');
      expect(text).not.toContain('uploadFont');

      const called = await client.callTool({
        name: 'call_operation',
        arguments: { operationId: 'getProject', pathParams: { projectId: 'p 1' } },
      });
      expect(called.isError).toBeFalsy();
      const body = JSON.parse((called.content as Array<{ text: string }>)[0]?.text ?? '{}');
      expect(body).toEqual({ status: 200, body: { id: 'p 1', name: 'Shop' } });
      expect(api.seen).toEqual([{ method: 'GET', url: '/api/v1/projects/p%201', auth: TOKEN, body: '' }]);

      const missing = await client.callTool({ name: 'call_operation', arguments: { operationId: 'getProject' } });
      expect(missing.isError).toBe(true);
      const unknown = await client.callTool({ name: 'call_operation', arguments: { operationId: 'uploadFont' } });
      expect(unknown.isError).toBe(true);
    } finally {
      await transport.close();
      web.close();
      api.server.close();
    }
  });

  it('refuses a connection without a token, with 401', async () => {
    const session = express();
    session.use((_req, res, next) => {
      res.locals['credential'] = { kind: 'session' } satisfies Credential;
      next();
    });
    session.use(`/api/v1${MCP_PATH}`, mcpRouter(DOC, { apiBase: 'http://127.0.0.1:9' }));
    const web = await listen(session);
    const port = (web.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1${MCP_PATH}/sse`);
      expect(res.status).toBe(401);
    } finally {
      web.close();
    }
  });
});
