import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { Pool } from 'pg';
import { vi } from 'vitest';
import { errorHandler } from './errors';
import { meRouter } from './me.router';

// The router alone, over a fake pool: the signed-in user is put on res.locals as requireCaller does.
const USER = { id: '00000000-0000-4000-8000-0000000000aa', name: 'Ada', email: 'ada@example.com', role: 'admin' };

function appWith(pool: Pool, credential: { kind: 'session' } | { kind: 'token'; tokenId: string; projects: 'all'; readOnly: false }) {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals['user'] = USER;
    res.locals['credential'] = credential;
    next();
  });
  app.use('/me', meRouter(pool));
  app.use(errorHandler);
  return app;
}

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/me/preferences` };
}

describe('PUT /me/preferences', () => {
  const session = { kind: 'session' as const };
  let servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
    servers = [];
  });

  async function put(app: express.Express, body: unknown): Promise<Response> {
    const { server, base } = await listen(app);
    servers.push(server);
    return fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('stores the appearance of the signed-in user and answers the user as now stored', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...USER, appearance: 'dark' }], rowCount: 1 }));
    const res = await put(appWith({ query } as unknown as Pool, session), { appearance: 'dark' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...USER, appearance: 'dark' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET appearance'), [USER.id, 'dark']);
  });

  it.each(['system', 'light', 'dark'])('accepts %s', async (appearance) => {
    const query = vi.fn(async () => ({ rows: [{ ...USER, appearance }], rowCount: 1 }));
    const res = await put(appWith({ query } as unknown as Pool, session), { appearance });
    expect(res.status).toBe(200);
  });

  it.each([{ appearance: 'purple' }, { appearance: null }, {}, { appearance: 1 }])(
    'answers 400 validation_failed for %j and does not write',
    async (body) => {
      const query = vi.fn();
      const res = await put(appWith({ query } as unknown as Pool, session), body);

      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('validation_failed');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('refuses an API token with 403 and does not write', async () => {
    const query = vi.fn();
    const res = await put(appWith({ query } as unknown as Pool, { kind: 'token', tokenId: 't', projects: 'all', readOnly: false }), {
      appearance: 'dark',
    });

    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('answers 401 when the user no longer exists', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const res = await put(appWith({ query } as unknown as Pool, session), { appearance: 'light' });
    expect(res.status).toBe(401);
  });
});
