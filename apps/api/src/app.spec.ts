import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSession,
  createUser,
  PasskeyFailedError,
  type PasskeyVerifier,
} from '@taleart/server-access';
import { LocalDiskStorage } from '@taleart/server-storage';
import { loadFrameTypeRegistry, type FrameTypeRegistry } from '@taleart/server-zones';
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

// The shipped registry, read from the contract as the built API reads its copy.
const frameTypesDir = join(__dirname, '../../../libs/contract/frame-types');

// Media goes to a temporary MEDIA_DIR, never the development folder.
const mediaDir = mkdtempSync(join(tmpdir(), 'taleart-media-'));
afterAll(() => rmSync(mediaDir, { recursive: true, force: true }));

// Stands in for the authenticator and @simplewebauthn/server. A fake response
// is `{ id, challenge, counter?, fail? }`: it passes when it names the expected
// challenge and does not ask to fail.
interface FakeResponse {
  id: string;
  challenge: string;
  counter?: number;
  fail?: boolean;
}
const fakeVerifier: PasskeyVerifier = {
  async creationOptions(user) {
    return {
      challenge: randomUUID(),
      rp: { name: 'TaleArt', id: 'localhost' },
      user: { id: user.userHandle, name: user.email, displayName: user.name },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    };
  },
  async verifyRegistration(response, expectedChallenge) {
    const r = response as FakeResponse;
    if (r.fail || r.challenge !== expectedChallenge) throw new PasskeyFailedError();
    return { credentialId: r.id, publicKey: new Uint8Array([1, 2, 3]), counter: r.counter ?? 0, transports: ['internal'] };
  },
  async requestOptions() {
    return { challenge: randomUUID(), rpId: 'localhost', userVerification: 'required' };
  },
  async verifyAuthentication(response, expectedChallenge) {
    const r = response as FakeResponse;
    if (r.fail || r.challenge !== expectedChallenge) throw new PasskeyFailedError();
    return r.counter ?? 0;
  },
};

// The session cookie the content tests send; set before each test.
let sessionCookie = '';

// Every request of these tests carries the signed-in session unless it sets its own Cookie header.
function fetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (sessionCookie && !headers.has('cookie')) headers.set('Cookie', sessionCookie);
  return globalThis.fetch(input, { ...init, headers });
}

describe('Management API v1: projects and zones', () => {
  let pool: Pool;
  let server: Server;
  let origin: string;
  let base: string;

  async function listen(p: Pool, frameTypes: FrameTypeRegistry = loadFrameTypeRegistry(frameTypesDir)): Promise<Server> {
    const s = createApp(p, frameTypes, new LocalDiskStorage(mediaDir), { verifier: fakeVerifier }).listen(0);
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

  async function createZone(): Promise<{ id: string; name: string; projectId: string }> {
    const project = await createProject();
    return (await post('/zones', { name: 'Home page bar', projectId: project.id })).json();
  }

  // Stops the server and pool and starts again, running the migrations as
  // main.ts does, optionally with another frame-type registry.
  async function restart(frameTypes?: FrameTypeRegistry): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    server = await listen(pool, frameTypes);
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    server = await listen(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE tales, tale_groups, frames, zones, projects, auth_challenges, sessions, passkeys, users');
    // Content routes need a session: sign a user in directly through the access module.
    const user = await createUser(pool, { name: 'Test Admin', email: 'admin@example.com', role: 'admin' });
    const { token } = await createSession(pool, user.id);
    sessionCookie = `taleart_session=${token}`;
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

    await restart();

    const projects = await (await fetch(`${base}/projects`)).json();
    const zones = await (await fetch(`${base}/zones`)).json();
    expect(projects).toEqual([{ id: project.id, name: 'Acme' }]);
    expect(zones).toEqual([
      { id: expect.any(String), name: 'Home page bar', projectId: project.id },
    ]);
  });

  describe('frames', () => {
    const unknownZoneId = '00000000-0000-4000-8000-000000000000';

    it('lists the registered frame types, including bar and banner', async () => {
      const res = await fetch(`${base}/frame-types`);
      expect(res.status).toBe(200);
      const types = await res.json();
      expect(types).toEqual(
        expect.arrayContaining([
          { key: 'bar', label: 'Bar' },
          { key: 'banner', label: 'Banner' },
        ]),
      );
    });

    it('adds a bar frame to a zone, copying the zone project', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { type: 'bar', settings: {} });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        zoneId: zone.id,
        projectId: zone.projectId,
        type: 'bar',
        settings: {},
      });
      const { rows } = await pool.query('SELECT project_id FROM frames');
      expect(rows).toEqual([{ project_id: zone.projectId }]);
    });

    it("lists a zone's frames oldest first, and only that zone's", async () => {
      const zone = await createZone();
      const other = await createZone();
      const first = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
      const second = await (await post(`/zones/${zone.id}/frames`, { type: 'banner' })).json();
      await post(`/zones/${other.id}/frames`, { type: 'bar' });

      const res = await fetch(`${base}/zones/${zone.id}/frames`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([first, second]);
    });

    it('refuses a type that is not in the registry', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { type: 'carousel', settings: {} });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: 'unknown_frame_type', message: expect.any(String) },
      });
      expect(await (await fetch(`${base}/zones/${zone.id}/frames`)).json()).toEqual([]);
    });

    it('refuses settings the type schema does not allow, naming the property', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { type: 'bar', settings: { color: 'red' } });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: { code: 'invalid_frame_settings', message: expect.any(String) } });
      expect(body.error.message).toContain('color');
      expect(await (await fetch(`${base}/zones/${zone.id}/frames`)).json()).toEqual([]);
    });

    it('refuses settings that are not an object', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { type: 'bar', settings: ['x'] });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('invalid_frame_settings');
    });

    it('treats missing settings as {}', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { type: 'banner' });
      expect(res.status).toBe(201);
      expect((await res.json()).settings).toEqual({});
    });

    it('refuses a frame without a type', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/frames`, { settings: {} });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('validation_failed');
    });

    it.each([unknownZoneId, 'not-a-uuid'])('answers 404 zone_not_found for zone %s', async (zoneId) => {
      for (const res of [
        await fetch(`${base}/zones/${zoneId}/frames`),
        await post(`/zones/${zoneId}/frames`, { type: 'bar', settings: {} }),
      ]) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: { code: 'zone_not_found', message: expect.any(String) },
        });
      }
    });

    it('answers 404 zone_not_found for an unknown zone even without a type', async () => {
      const res = await post(`/zones/${unknownZoneId}/frames`, {});
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: 'zone_not_found', message: expect.any(String) },
      });
    });

    it('accepts a new type added to the registry by configuration only', async () => {
      // A copy of the shipped registry plus a test type, so the shipped files
      // stay untouched. No migration or code change is involved.
      const dir = mkdtempSync(join(tmpdir(), 'taleart-frame-types-'));
      try {
        cpSync(frameTypesDir, dir, { recursive: true });
        const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
        registry.types.push({ key: 'test-strip', label: 'Test strip', schema: 'test-strip.schema.json' });
        writeFileSync(join(dir, 'registry.json'), JSON.stringify(registry));
        writeFileSync(
          join(dir, 'test-strip.schema.json'),
          JSON.stringify({
            type: 'object',
            required: ['height'],
            properties: { height: { type: 'integer' } },
            additionalProperties: false,
          }),
        );

        await restart(loadFrameTypeRegistry(dir));

        const types = await (await fetch(`${base}/frame-types`)).json();
        expect(types).toContainEqual({ key: 'test-strip', label: 'Test strip' });

        const zone = await createZone();
        const missing = await post(`/zones/${zone.id}/frames`, { type: 'test-strip', settings: {} });
        expect(missing.status).toBe(400);
        const body = await missing.json();
        expect(body.error.code).toBe('invalid_frame_settings');
        expect(body.error.message).toContain('height');

        const saved = await post(`/zones/${zone.id}/frames`, { type: 'test-strip', settings: { height: 40 } });
        expect(saved.status).toBe(201);
        expect((await saved.json()).settings).toEqual({ height: 40 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
        await restart();
      }
    });

    it('keeps frames after the API restarts', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
      await restart();
      expect(await (await fetch(`${base}/zones/${zone.id}/frames`)).json()).toEqual([frame]);
    });
  });

  describe('tale groups and tales', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';

    async function createGroup(zoneId: string, name = 'Summer'): Promise<{ id: string; projectId: string }> {
      return (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
    }

    it('creates a tale group in a zone, copying the zone project', async () => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        zoneId: zone.id,
        projectId: zone.projectId,
        name: 'Summer',
        position: 0,
        tales: [],
      });
      const { rows } = await pool.query('SELECT project_id FROM tale_groups');
      expect(rows).toEqual([{ project_id: zone.projectId }]);
    });

    it("lists a zone's groups by position, each with its tales by position, and only that zone's", async () => {
      const zone = await createZone();
      const other = await createZone();
      const first = await createGroup(zone.id, 'First');
      const second = await createGroup(zone.id, 'Second');
      await createGroup(other.id, 'Elsewhere');
      const tale = await (await post(`/tale-groups/${second.id}/tales`, { title: 'A' })).json();

      const res = await fetch(`${base}/zones/${zone.id}/tale-groups`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { ...first, position: 0, tales: [] },
        { ...second, position: 1, tales: [tale] },
      ]);
    });

    it('adds a tale to a tale group, copying the group project', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      const res = await post(`/tale-groups/${group.id}/tales`, { title: 'Beach day' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: expect.any(String),
        taleGroupId: group.id,
        projectId: zone.projectId,
        title: 'Beach day',
        position: 0,
        media: null,
      });
      const { rows } = await pool.query('SELECT project_id FROM tales');
      expect(rows).toEqual([{ project_id: zone.projectId }]);
    });

    it('keeps tales in the order they were added, also after the API restarts', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      await post(`/tale-groups/${group.id}/tales`, { title: 'A' });
      await post(`/tale-groups/${group.id}/tales`, { title: 'B' });

      const titles = async () =>
        ((await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json())[0].tales as { title: string }[]).map(
          (t) => t.title,
        );
      expect(await titles()).toEqual(['A', 'B']);
      await restart();
      expect(await titles()).toEqual(['A', 'B']);
    });

    it.each([unknownId, 'not-a-uuid'])('answers 404 zone_not_found for zone %s', async (zoneId) => {
      for (const res of [
        await fetch(`${base}/zones/${zoneId}/tale-groups`),
        await post(`/zones/${zoneId}/tale-groups`, { name: 'Summer' }),
        await post(`/zones/${zoneId}/tale-groups`, {}),
      ]) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: { code: 'zone_not_found', message: expect.any(String) } });
      }
    });

    it.each([unknownId, 'not-a-uuid'])('answers 404 tale_group_not_found for tale group %s', async (id) => {
      for (const res of [
        await post(`/tale-groups/${id}/tales`, { title: 'A' }),
        await post(`/tale-groups/${id}/tales`, {}),
      ]) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
          error: { code: 'tale_group_not_found', message: expect.any(String) },
        });
      }
    });

    it.each([{}, { name: '   ' }])('refuses a tale group with a blank name: %j', async (body) => {
      const zone = await createZone();
      const res = await post(`/zones/${zone.id}/tale-groups`, body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
      expect(json.error.message).toContain('name');
      expect(await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json()).toEqual([]);
    });

    it.each([{}, { title: '   ' }])('refuses a tale with a blank title: %j', async (body) => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      const res = await post(`/tale-groups/${group.id}/tales`, body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
      expect(json.error.message).toContain('title');
    });

    it('refuses a 101st tale with 409 tale_group_full', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position)
         SELECT $1, $2, 'Tale ' || n, n FROM generate_series(0, 99) AS n`,
        [group.id, group.projectId],
      );
      const res = await post(`/tale-groups/${group.id}/tales`, { title: 'One too many' });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: 'tale_group_full', message: expect.any(String) } });
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM tales');
      expect(rows).toEqual([{ n: 100 }]);
    });

    it('gives concurrent adds distinct positions and never exceeds 100 tales', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position)
         SELECT $1, $2, 'Tale ' || n, n FROM generate_series(0, 94) AS n`,
        [group.id, group.projectId],
      );
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => post(`/tale-groups/${group.id}/tales`, { title: `C${i}` })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const { rows } = await pool.query(
        'SELECT count(*)::int AS n, count(DISTINCT position)::int AS d FROM tales WHERE tale_group_id = $1',
        [group.id],
      );
      expect(rows).toEqual([{ n: 100, d: 100 }]);
    });

    describe('order', () => {
      function put(path: string, body: unknown): Promise<Response> {
        return fetch(`${base}${path}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      async function addTale(groupId: string, title: string): Promise<{ id: string }> {
        return (await post(`/tale-groups/${groupId}/tales`, { title })).json();
      }

      async function listed(zoneId: string): Promise<{ id: string; position: number; tales: { id: string; position: number }[] }[]> {
        return (await fetch(`${base}/zones/${zoneId}/tale-groups`)).json();
      }

      it('reorders a zone\'s tale groups to positions 0..n-1', async () => {
        const zone = await createZone();
        const a = await createGroup(zone.id, 'A');
        const b = await createGroup(zone.id, 'B');
        const res = await put(`/zones/${zone.id}/tale-groups/order`, { taleGroupIds: [b.id, a.id] });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.map((g: { id: string; position: number }) => [g.id, g.position])).toEqual([
          [b.id, 0],
          [a.id, 1],
        ]);
        expect(body[0]).toEqual({ ...b, position: 0, tales: [] });
      });

      it('reorders a tale group\'s tales', async () => {
        const zone = await createZone();
        const group = await createGroup(zone.id);
        const x = await addTale(group.id, 'X');
        const y = await addTale(group.id, 'Y');
        const res = await put(`/tale-groups/${group.id}/tales/order`, { taleIds: [y.id, x.id] });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([
          { ...y, position: 0 },
          { ...x, position: 1 },
        ]);
      });

      it('keeps the new order in lists, also after the API restarts', async () => {
        const zone = await createZone();
        const a = await createGroup(zone.id, 'A');
        const b = await createGroup(zone.id, 'B');
        const x = await addTale(a.id, 'X');
        const y = await addTale(a.id, 'Y');
        expect((await put(`/zones/${zone.id}/tale-groups/order`, { taleGroupIds: [b.id, a.id] })).status).toBe(200);
        expect((await put(`/tale-groups/${a.id}/tales/order`, { taleIds: [y.id, x.id] })).status).toBe(200);

        const order = async () =>
          (await listed(zone.id)).map((g) => [g.id, g.position, g.tales.map((t) => [t.id, t.position])]);
        const expected = [
          [b.id, 0, []],
          [a.id, 1, [[y.id, 0], [x.id, 1]]],
        ];
        expect(await order()).toEqual(expected);
        await restart();
        expect(await order()).toEqual(expected);
      });

      it('refuses group lists that omit, repeat or add a group with 409 order_mismatch and changes nothing', async () => {
        const zone = await createZone();
        const other = await createZone();
        const a = await createGroup(zone.id, 'A');
        const b = await createGroup(zone.id, 'B');
        const elsewhere = await createGroup(other.id, 'Elsewhere');
        for (const ids of [[a.id], [a.id, a.id], [b.id, elsewhere.id], [b.id, a.id, elsewhere.id], [b.id, 'nope']]) {
          const res = await put(`/zones/${zone.id}/tale-groups/order`, { taleGroupIds: ids });
          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: { code: 'order_mismatch', message: expect.any(String) } });
        }
        expect((await listed(zone.id)).map((g) => g.id)).toEqual([a.id, b.id]);
        expect((await listed(other.id)).map((g) => g.position)).toEqual([0]);
      });

      it('refuses tale lists that omit, repeat or add a tale with 409 order_mismatch', async () => {
        const zone = await createZone();
        const group = await createGroup(zone.id);
        const otherGroup = await createGroup(zone.id, 'Other');
        const x = await addTale(group.id, 'X');
        const y = await addTale(group.id, 'Y');
        const z = await addTale(otherGroup.id, 'Z');
        for (const ids of [[x.id], [x.id, x.id], [y.id, z.id], [y.id, x.id, z.id], [y.id, 'not-a-uuid']]) {
          const res = await put(`/tale-groups/${group.id}/tales/order`, { taleIds: ids });
          expect(res.status).toBe(409);
          expect(await res.json()).toEqual({ error: { code: 'order_mismatch', message: expect.any(String) } });
        }
        expect((await listed(zone.id))[0].tales.map((t) => t.id)).toEqual([x.id, y.id]);
      });

      it.each([{}, { taleGroupIds: 'a' }, { taleGroupIds: [1] }, { taleGroupIds: [null] }])(
        'refuses a group order body that is not a list of ids: %j',
        async (body) => {
          const zone = await createZone();
          const res = await put(`/zones/${zone.id}/tale-groups/order`, body);
          expect(res.status).toBe(400);
          expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
        },
      );

      it.each([{}, { taleIds: {} }, { taleIds: [42] }])('refuses a tale order body that is not a list of ids: %j', async (body) => {
        const zone = await createZone();
        const group = await createGroup(zone.id);
        const res = await put(`/tale-groups/${group.id}/tales/order`, body);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
      });

      it.each([unknownId, 'not-a-uuid'])('answers 404 for an unknown parent %s, before reading the body', async (id) => {
        for (const body of [{ taleGroupIds: [] }, {}]) {
          const res = await put(`/zones/${id}/tale-groups/order`, body);
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: { code: 'zone_not_found', message: expect.any(String) } });
        }
        for (const body of [{ taleIds: [] }, {}]) {
          const res = await put(`/tale-groups/${id}/tales/order`, body);
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: { code: 'tale_group_not_found', message: expect.any(String) } });
        }
      });

      it('accepts an empty list for a parent with no children', async () => {
        const zone = await createZone();
        const res = await put(`/zones/${zone.id}/tale-groups/order`, { taleGroupIds: [] });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
      });
    });

    it('rejects a tale whose project differs from its group project at the database', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id);
      const otherProject = await createProject('Other');
      await expect(
        pool.query(`INSERT INTO tales (tale_group_id, project_id, title, position) VALUES ($1, $2, 'X', 0)`, [
          group.id,
          otherProject.id,
        ]),
      ).rejects.toThrow(/foreign key/);
    });
  });

  describe('tale media', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const MB = 1024 * 1024;

    // Smallest byte runs that pass the magic-number check for each type.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const gif = Buffer.from('GIF89a-tiny-gif');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom-tiny-mp4')]);

    async function createTale(): Promise<{ id: string; zoneId: string }> {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      return { id: tale.id, zoneId: zone.id };
    }

    function upload(taleId: string, contentType: string, body: Uint8Array): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      });
    }

    function storedFiles(): string[] {
      const dir = join(mediaDir, 'tales');
      return existsSync(dir) ? readdirSync(dir) : [];
    }

    async function storedRow(taleId: string): Promise<{ media_key: string | null; media_content_type: string | null }> {
      const { rows } = await pool.query('SELECT media_key, media_content_type FROM tales WHERE id = $1', [taleId]);
      return rows[0];
    }

    beforeEach(() => {
      rmSync(join(mediaDir, 'tales'), { recursive: true, force: true });
    });

    it('uploads an image and stores only the key on the tale', async () => {
      const tale = await createTale();
      const res = await upload(tale.id, 'image/png', png);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(
        expect.objectContaining({
          id: tale.id,
          media: { kind: 'image', contentType: 'image/png', url: `/api/v1/tales/${tale.id}/media` },
        }),
      );
      const row = await storedRow(tale.id);
      expect(row.media_key).toMatch(/^tales\/[0-9a-f-]{36}\.png$/);
      expect(row.media_key).not.toContain(mediaDir);
      expect(row.media_content_type).toBe('image/png');
      expect(storedFiles()).toEqual([row.media_key?.slice('tales/'.length)]);
    });

    it('uploads a GIF as an image and an MP4 as a video', async () => {
      const tale = await createTale();
      expect((await (await upload(tale.id, 'image/gif', gif)).json()).media.kind).toBe('image');
      const res = await upload(tale.id, 'video/mp4', mp4);
      expect(res.status).toBe(200);
      expect((await res.json()).media).toEqual({
        kind: 'video',
        contentType: 'video/mp4',
        url: `/api/v1/tales/${tale.id}/media`,
      });
    });

    it('serves the stored bytes with the stored content type', async () => {
      const tale = await createTale();
      await upload(tale.id, 'image/png', png);
      const res = await fetch(`${origin}/api/v1/tales/${tale.id}/media`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
    });

    it('serves a byte range with 206 and Content-Range', async () => {
      const tale = await createTale();
      await upload(tale.id, 'video/mp4', mp4);
      const whole = await fetch(`${base}/tales/${tale.id}/media`);
      expect(whole.status).toBe(200);
      expect(whole.headers.get('accept-ranges')).toBe('bytes');

      for (const [range, start, end] of [
        ['bytes=0-3', 0, 3],
        ['bytes=4-', 4, mp4.length - 1],
      ] as const) {
        const res = await fetch(`${base}/tales/${tale.id}/media`, { headers: { Range: range } });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe(`bytes ${start}-${end}/${mp4.length}`);
        expect(res.headers.get('content-type')).toBe('video/mp4');
        expect(Buffer.from(await res.arrayBuffer())).toEqual(mp4.subarray(start, end + 1));
      }
    });

    it('serves a suffix range with 206', async () => {
      const tale = await createTale();
      await upload(tale.id, 'video/mp4', mp4);
      const res = await fetch(`${base}/tales/${tale.id}/media`, { headers: { Range: 'bytes=-5' } });
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(`bytes ${mp4.length - 5}-${mp4.length - 1}/${mp4.length}`);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(mp4.subarray(mp4.length - 5));
    });

    it('answers 416 with the size for an unsatisfiable range', async () => {
      const tale = await createTale();
      await upload(tale.id, 'video/mp4', mp4);
      const res = await fetch(`${base}/tales/${tale.id}/media`, { headers: { Range: `bytes=${mp4.length}-` } });
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe(`bytes */${mp4.length}`);
    });

    it('answers 404 media_not_found for a tale without media', async () => {
      const tale = await createTale();
      const res = await fetch(`${base}/tales/${tale.id}/media`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'media_not_found', message: expect.any(String) } });
    });

    it('lists each tale with its media or null', async () => {
      const tale = await createTale();
      const group = (await (await fetch(`${base}/zones/${tale.zoneId}/tale-groups`)).json())[0];
      await post(`/tale-groups/${group.id}/tales`, { title: 'No media' });
      await upload(tale.id, 'image/png', png);

      const [listed] = await (await fetch(`${base}/zones/${tale.zoneId}/tale-groups`)).json();
      expect(listed.tales.map((t: { media: unknown }) => t.media)).toEqual([
        { kind: 'image', contentType: 'image/png', url: `/api/v1/tales/${tale.id}/media` },
        null,
      ]);
    });

    it('replaces media: serves the new file and removes the old one', async () => {
      const tale = await createTale();
      await upload(tale.id, 'image/png', png);
      const oldKey = (await storedRow(tale.id)).media_key;

      expect((await upload(tale.id, 'image/gif', gif)).status).toBe(200);
      const newKey = (await storedRow(tale.id)).media_key;
      expect(newKey).not.toBe(oldKey);
      expect(storedFiles()).toEqual([newKey?.slice('tales/'.length)]);
      const res = await fetch(`${base}/tales/${tale.id}/media`);
      expect(res.headers.get('content-type')).toBe('image/gif');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(gif);
    });

    it.each([
      ['application/pdf', Buffer.from('%PDF-1.7')],
      ['image/png', Buffer.from('not a png at all')],
      ['video/mp4', png],
    ])('refuses %s with mismatched or unsupported bytes with 415 and keeps the old media', async (type, body) => {
      const tale = await createTale();
      await upload(tale.id, 'image/png', png);
      const before = await storedRow(tale.id);

      const res = await upload(tale.id, type, body);
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: { code: 'unsupported_media_type', message: expect.any(String) } });
      expect(await storedRow(tale.id)).toEqual(before);
      expect(storedFiles()).toHaveLength(1);
    });

    it('refuses an image over 10 MB with 413 media_too_large', async () => {
      const tale = await createTale();
      const big = Buffer.alloc(10 * MB + 1);
      png.copy(big);
      const res = await upload(tale.id, 'image/png', big);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: { code: 'media_too_large', message: expect.any(String) } });
      expect((await storedRow(tale.id)).media_key).toBeNull();
      expect(storedFiles()).toEqual([]);
    });

    it('refuses a video over 100 MB with 413 media_too_large, never 500', async () => {
      const tale = await createTale();
      const big = Buffer.alloc(100 * MB + 1);
      mp4.copy(big);
      const res = await upload(tale.id, 'video/mp4', big);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: { code: 'media_too_large', message: expect.any(String) } });
      expect((await storedRow(tale.id)).media_key).toBeNull();
    });

    it('accepts a video over 10 MB', async () => {
      const tale = await createTale();
      const video = Buffer.alloc(11 * MB);
      mp4.copy(video);
      expect((await upload(tale.id, 'video/mp4', video)).status).toBe(200);
    });

    it('refuses an empty body with 400 validation_failed', async () => {
      const tale = await createTale();
      const res = await upload(tale.id, 'image/png', new Uint8Array());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
    });

    it.each([unknownId, 'not-a-uuid'])('answers 404 tale_not_found for tale %s', async (taleId) => {
      for (const res of [await upload(taleId, 'image/png', png), await fetch(`${base}/tales/${taleId}/media`)]) {
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: { code: 'tale_not_found', message: expect.any(String) } });
      }
      expect(storedFiles()).toEqual([]);
    });

    it('allows PUT from the dashboard origin', async () => {
      const res = await fetch(`${base}/tales/${unknownId}/media`, { method: 'OPTIONS' });
      expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    });

    it('keeps serving media after the API restarts', async () => {
      const tale = await createTale();
      await upload(tale.id, 'image/png', png);
      await restart();
      const res = await fetch(`${base}/tales/${tale.id}/media`);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
    });
  });
  describe('auth', () => {
    // A minimal cookie jar: the cookies the API set, sent back as the browser would.
    let jar: Record<string, string>;

    function keep(res: Response): Response {
      for (const line of res.headers.getSetCookie()) {
        const [pair] = line.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (/Max-Age=0/i.test(line)) delete jar[name];
        else jar[name] = value;
      }
      return res;
    }

    function cookieHeader(): string {
      return Object.entries(jar)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    }

    async function send(method: string, path: string, body?: unknown): Promise<Response> {
      const headers: Record<string, string> = { Cookie: cookieHeader() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return keep(
        await globalThis.fetch(`${base}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    }

    function setCookieLine(res: Response, name: string): string {
      return res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`)) ?? '';
    }

    async function setupOptions(name = 'Ada Admin', email = 'ada@example.com'): Promise<{ challenge: string }> {
      const res = await send('POST', '/auth/setup/options', { name, email });
      expect(res.status).toBe(200);
      return res.json();
    }

    // Runs setup with credential `cred-1`; the admin ends up signed in.
    async function setUp(): Promise<{ id: string }> {
      const { challenge } = await setupOptions();
      const res = await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge });
      expect(res.status).toBe(201);
      return (await res.json()).user;
    }

    async function signIn(response: Partial<FakeResponse>): Promise<Response> {
      const { challenge } = await (await send('POST', '/auth/sign-in/options')).json();
      return send('POST', '/auth/sign-in/verify', { id: 'cred-1', challenge, ...response });
    }

    beforeEach(async () => {
      jar = {};
      // Auth tests start from an empty install.
      await pool.query('TRUNCATE auth_challenges, sessions, passkeys, users');
    });

    it('reports that setup is required on an empty install', async () => {
      const res = await send('GET', '/auth/state');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ setupRequired: true, user: null });
    });

    it('answers setup options with creation options and an http-only challenge cookie', async () => {
      const res = await send('POST', '/auth/setup/options', { name: 'Ada Admin', email: 'ada@example.com' });
      expect(res.status).toBe(200);
      const options = await res.json();
      expect(options).toMatchObject({
        challenge: expect.any(String),
        user: { name: 'ada@example.com', displayName: 'Ada Admin' },
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      });
      const cookie = setCookieLine(res, 'taleart_challenge');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Max-Age=300');
      expect(cookie).not.toContain('Secure');
      expect(cookie).not.toContain(options.challenge);
    });

    it.each([
      { name: '  ', email: 'ada@example.com' },
      { name: 'Ada', email: 'not-an-email' },
      { name: 'Ada' },
    ])('refuses setup options %o with 400 validation_failed', async (body) => {
      const res = await send('POST', '/auth/setup/options', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
    });

    it('creates the admin, signs them in and stores only the token hash', async () => {
      const { challenge } = await setupOptions();
      const res = await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge });
      expect(res.status).toBe(201);
      const { user } = await res.json();
      expect(user).toEqual({ id: expect.any(String), name: 'Ada Admin', email: 'ada@example.com', role: 'admin' });

      const cookie = setCookieLine(res, 'taleart_session');
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=60479\d/);
      const token = decodeURIComponent(jar['taleart_session']);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);

      const { rows } = await pool.query('SELECT token_hash, expires_at - created_at AS ttl FROM sessions');
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(rows[0].ttl).toMatchObject({ days: 7 });

      const passkeys = await pool.query('SELECT credential_id, counter FROM passkeys');
      expect(passkeys.rows).toEqual([{ credential_id: 'cred-1', counter: '0' }]);

      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user });
      expect((await send('GET', '/projects')).status).toBe(200);
    });

    it('refuses a setup response to another challenge with 400 passkey_failed', async () => {
      await setupOptions();
      const res = await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge: 'other' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'passkey_failed', message: expect.any(String) } });
      expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(0);
    });

    it('refuses setup without a challenge cookie, with a used one and with an expired one', async () => {
      const first = await setupOptions();
      const challengeCookie = jar['taleart_challenge'];
      delete jar['taleart_challenge'];
      expect((await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge: first.challenge })).status).toBe(400);

      // The challenge travels only in the cookie; a used one does not work twice.
      jar['taleart_challenge'] = challengeCookie;
      await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge: 'wrong' });
      jar['taleart_challenge'] = challengeCookie;
      const reused = await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge: first.challenge });
      expect(reused.status).toBe(400);
      expect((await reused.json()).error.code).toBe('passkey_failed');

      const second = await setupOptions();
      await pool.query("UPDATE auth_challenges SET expires_at = now() - interval '1 second'");
      const expired = await send('POST', '/auth/setup/verify', { id: 'cred-1', challenge: second.challenge });
      expect(expired.status).toBe(400);
      expect((await expired.json()).error.code).toBe('passkey_failed');
    });

    it('closes setup with 409 setup_closed once an admin exists', async () => {
      const { challenge } = await setupOptions();
      await setUp();
      const options = await send('POST', '/auth/setup/options', { name: 'Eve', email: 'eve@example.com' });
      expect(options.status).toBe(409);
      expect(await options.json()).toEqual({ error: { code: 'setup_closed', message: expect.any(String) } });
      const verify = await send('POST', '/auth/setup/verify', { id: 'cred-2', challenge });
      expect(verify.status).toBe(409);
      expect((await verify.json()).error.code).toBe('setup_closed');
      expect(await (await send('GET', '/auth/state')).json()).toMatchObject({ setupRequired: false });
    });

    it('lets only one of two racing setups become admin', async () => {
      const a = await setupOptions('Ada', 'ada@example.com');
      const cookieA = jar['taleart_challenge'];
      const b = await setupOptions('Bob', 'bob@example.com');
      const cookieB = jar['taleart_challenge'];
      const verify = (cookie: string, id: string, challenge: string) =>
        globalThis.fetch(`${base}/auth/setup/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `taleart_challenge=${cookie}` },
          body: JSON.stringify({ id, challenge }),
        });
      const results = await Promise.all([verify(cookieA, 'cred-a', a.challenge), verify(cookieB, 'cred-b', b.challenge)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(1);
    });

    it('answers sign-in options without allowCredentials and with a challenge cookie', async () => {
      await setUp();
      jar = {};
      const res = await send('POST', '/auth/sign-in/options');
      expect(res.status).toBe(200);
      const options = await res.json();
      expect(options.challenge).toEqual(expect.any(String));
      expect(options.allowCredentials).toBeUndefined();
      expect(setCookieLine(res, 'taleart_challenge')).toContain('HttpOnly');
    });

    it('signs in with the stored passkey, updates its counter and starts a session', async () => {
      const admin = await setUp();
      jar = {};
      const res = await signIn({ counter: 3 });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: { ...admin, name: 'Ada Admin', email: 'ada@example.com', role: 'admin' } });
      expect(setCookieLine(res, 'taleart_session')).toContain('HttpOnly');
      expect((await pool.query('SELECT counter FROM passkeys')).rows).toEqual([{ counter: '3' }]);
      expect((await send('GET', '/zones')).status).toBe(200);
    });

    it.each([
      ['an unknown passkey', { id: 'cred-unknown' }],
      ['a failed verification', { fail: true }],
      ['a response to another challenge', { challenge: 'other' }],
    ])('refuses %s with 401 passkey_failed', async (_label, response) => {
      await setUp();
      jar = {};
      const res = await signIn(response);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: 'passkey_failed', message: expect.any(String) } });
      expect(jar['taleart_session']).toBeUndefined();
    });

    it('refuses a signature counter that did not increase', async () => {
      await setUp();
      jar = {};
      expect((await signIn({ counter: 5 })).status).toBe(200);
      jar = {};
      expect((await signIn({ counter: 5 })).status).toBe(401);
    });

    it.each(['/projects', '/zones', '/frame-types', `/tales/${randomUUID()}/media`, '/no-such-route'])(
      'answers %s with 401 unauthenticated without a session',
      async (path) => {
        await setUp();
        jar = {};
        const res = await send('GET', path);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: { code: 'unauthenticated', message: expect.any(String) } });
      },
    );

    it('keeps health and auth state open without a session', async () => {
      expect((await send('GET', '/health')).status).toBe(200);
      expect((await send('GET', '/auth/state')).status).toBe(200);
    });

    it('refuses an expired session', async () => {
      await setUp();
      await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
      const res = await send('GET', '/projects');
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('unauthenticated');
      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user: null });
    });

    it('signs out: deletes the session, clears the cookie and refuses the old cookie', async () => {
      await setUp();
      const oldCookie = jar['taleart_session'];
      const res = await send('POST', '/auth/sign-out');
      expect(res.status).toBe(204);
      expect(setCookieLine(res, 'taleart_session')).toMatch(/^taleart_session=;.*Max-Age=0/);
      expect((await pool.query('SELECT 1 FROM sessions')).rowCount).toBe(0);

      jar['taleart_session'] = oldCookie;
      const after = await send('GET', '/projects');
      expect(after.status).toBe(401);
      expect((await after.json()).error.code).toBe('unauthenticated');
    });

    it('marks cookies Secure when the dashboard origin is https', async () => {
      const secure = createApp(pool, loadFrameTypeRegistry(frameTypesDir), new LocalDiskStorage(mediaDir), {
        verifier: fakeVerifier,
        secureCookies: true,
      }).listen(0);
      await new Promise<void>((resolve) => secure.once('listening', () => resolve()));
      try {
        const port = (secure.address() as AddressInfo).port;
        const res = await globalThis.fetch(`http://127.0.0.1:${port}/api/v1/auth/sign-in/options`, { method: 'POST' });
        expect(setCookieLine(res, 'taleart_challenge')).toContain('Secure');
      } finally {
        await new Promise<void>((resolve) => secure.close(() => resolve()));
      }
    });
  });
});
