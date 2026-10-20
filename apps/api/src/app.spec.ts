import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { createApp } from './app';
import { createPool, migrate } from './db';

// Runs against a separate test database. It clears tables, so it must never
// point at the development database.
const testDatabaseUrl =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
if (!new URL(testDatabaseUrl).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
}

describe('Management API v1: projects and zones', () => {
  let pool: Pool;
  let server: Server;
  let origin: string;
  let base: string;

  async function listen(p: Pool): Promise<Server> {
    const s = createApp(p).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    origin = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    base = `${origin}/api/v1`;
    return s;
  }

  function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function createProject(name = 'Acme'): Promise<{ id: string; name: string }> {
    return (await post('/projects', { name })).json();
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    server = await listen(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE zones, projects');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('reports health', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('creates a project and lists it', async () => {
    const created = await post('/projects', { name: 'Acme' });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project).toEqual({ id: expect.any(String), name: 'Acme' });

    const list = await (await fetch(`${base}/projects`)).json();
    expect(list).toEqual([{ id: project.id, name: 'Acme' }]);
  });

  it('creates a zone in an existing project and lists it', async () => {
    const project = await createProject();

    const created = await post('/zones', { name: 'Home page bar', projectId: project.id });
    expect(created.status).toBe(201);
    const zone = await created.json();
    expect(zone).toEqual({ id: expect.any(String), name: 'Home page bar', projectId: project.id });

    const list = await (await fetch(`${base}/zones`)).json();
    expect(list).toEqual([zone]);
  });

  it('refuses a zone without a project', async () => {
    const res = await post('/zones', { name: 'Orphan' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', message: expect.any(String) },
    });
  });

  it('refuses a zone whose project does not exist', async () => {
    const res = await post('/zones', {
      name: 'Orphan',
      projectId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'project_not_found', message: expect.any(String) },
    });
    expect(await (await fetch(`${base}/zones`)).json()).toEqual([]);
  });

  it('treats a projectId that is not a UUID as an unknown project', async () => {
    const res = await post('/zones', { name: 'Orphan', projectId: 'nope' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('project_not_found');
  });

  it('refuses a project without a name', async () => {
    const res = await post('/projects', {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', message: expect.any(String) },
    });
  });

  it('refuses a zone without a name', async () => {
    const project = await createProject();
    const res = await post('/zones', { name: '  ', projectId: project.id });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'validation_failed', message: expect.any(String) },
    });
  });

  it('refuses a body that is not JSON with the standard error body', async () => {
    const res = await fetch(`${base}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_failed');
  });

  it('answers the old unversioned path with 404 and the standard error body', async () => {
    const res = await fetch(`${origin}/api/projects`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    });
  });

  it('keeps projects and zones after the API restarts', async () => {
    const project = await createProject();
    await post('/zones', { name: 'Home page bar', projectId: project.id });

    // Simulate a restart: close the server and pool, then start again on a new
    // pool and run the migration runner again, as main.ts does.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    server = await listen(pool);

    const projects = await (await fetch(`${base}/projects`)).json();
    const zones = await (await fetch(`${base}/zones`)).json();
    expect(projects).toEqual([{ id: project.id, name: 'Acme' }]);
    expect(zones).toEqual([
      { id: expect.any(String), name: 'Home page bar', projectId: project.id },
    ]);
  });
});
