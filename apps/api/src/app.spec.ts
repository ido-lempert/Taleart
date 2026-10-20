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

describe('story 1: create and list a project and a zone', () => {
  let pool: Pool;
  let server: Server;
  let base: string;

  async function listen(p: Pool): Promise<Server> {
    const s = createApp(p).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api`;
    return s;
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

  it('creates a project and lists it', async () => {
    const created = await fetch(`${base}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project.name).toBe('Acme');

    const list = await (await fetch(`${base}/projects`)).json();
    expect(list).toEqual([{ id: project.id, name: 'Acme' }]);
  });

  it('creates a zone in a project and lists it', async () => {
    const project = await (
      await fetch(`${base}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme' }),
      })
    ).json();

    const created = await fetch(`${base}/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Home page bar', projectId: project.id }),
    });
    expect(created.status).toBe(201);

    const list = await (await fetch(`${base}/zones`)).json();
    expect(list).toEqual([
      { id: expect.any(String), name: 'Home page bar', projectId: project.id },
    ]);
  });

  it('refuses a zone without a project', async () => {
    const res = await fetch(`${base}/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Orphan' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('projectId is required');
  });

  it('keeps projects and zones after the API restarts', async () => {
    const project = await (
      await fetch(`${base}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme' }),
      })
    ).json();
    await fetch(`${base}/zones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Home page bar', projectId: project.id }),
    });

    // Simulate a restart: close the server and pool, then start again on a new pool.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    pool = createPool(testDatabaseUrl);
    server = await listen(pool);

    const projects = await (await fetch(`${base}/projects`)).json();
    const zones = await (await fetch(`${base}/zones`)).json();
    expect(projects).toEqual([{ id: project.id, name: 'Acme' }]);
    expect(zones).toEqual([
      { id: expect.any(String), name: 'Home page bar', projectId: project.id },
    ]);
  });
});
