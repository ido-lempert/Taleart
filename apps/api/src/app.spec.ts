import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addProjectMember,
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
    await pool.query(
      'TRUNCATE zone_keys, tale_group_tags, tags, tales, tale_groups, frames, zones, invitations, project_members, projects, auth_challenges, sessions, passkeys, users',
    );
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
        tags: [],
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

  describe('tags', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';

    function put(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    async function createTag(projectId: string, name: string): Promise<{ id: string; projectId: string; name: string }> {
      const res = await post(`/projects/${projectId}/tags`, { name });
      expect(res.status).toBe(201);
      return res.json();
    }

    async function createGroup(zoneId: string, name: string): Promise<{ id: string }> {
      return (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
    }

    // Each listed group's tag names, keyed by group name.
    async function groupTags(zoneId: string): Promise<Record<string, string[]>> {
      const res = await fetch(`${base}/zones/${zoneId}/tale-groups`);
      const groups: { name: string; tags: { name: string }[] }[] = await res.json();
      return Object.fromEntries(groups.map((g) => [g.name, g.tags.map((t) => t.name)]));
    }

    it('creates a trimmed tag and lists the project tags by name, ignoring case', async () => {
      const project = await createProject();
      const other = await createProject('Other');
      const res = await post(`/projects/${project.id}/tags`, { name: '  summer  ' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: expect.any(String), projectId: project.id, name: 'summer' });
      await createTag(project.id, 'Autumn');
      await createTag(project.id, 'beach');
      await createTag(other.id, 'elsewhere');

      const list = await fetch(`${base}/projects/${project.id}/tags`);
      expect(list.status).toBe(200);
      expect((await list.json()).map((t: { name: string }) => t.name)).toEqual(['Autumn', 'beach', 'summer']);
    });

    it('refuses a blank name or one over 40 characters with 400 validation_failed', async () => {
      const project = await createProject();
      for (const name of ['', '   ', 'x'.repeat(41), 42]) {
        const res = await post(`/projects/${project.id}/tags`, { name });
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      await createTag(project.id, 'x'.repeat(40));
      expect((await pool.query('SELECT 1 FROM tags')).rowCount).toBe(1);
    });

    it('refuses a name the project already has, in any case, with 409 tag_exists', async () => {
      const project = await createProject();
      const other = await createProject('Other');
      await createTag(project.id, 'Summer');
      const res = await post(`/projects/${project.id}/tags`, { name: ' SUMMER ' });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('tag_exists');
      await createTag(other.id, 'summer');
    });

    it('answers 404 project_not_found for an unknown project', async () => {
      for (const res of [
        await fetch(`${base}/projects/${unknownId}/tags`),
        await post(`/projects/${unknownId}/tags`, { name: 'summer' }),
        await post('/projects/nope/tags', { name: 'summer' }),
      ]) {
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('project_not_found');
      }
    });

    it('sets, replaces and clears the tags of a tale group, and lists them with every group', async () => {
      const zone = await createZone();
      const summer = await createTag(zone.projectId, 'summer');
      const beach = await createTag(zone.projectId, 'Beach');
      const first = await createGroup(zone.id, 'First');
      await createGroup(zone.id, 'Second');

      const res = await put(`/tale-groups/${first.id}/tags`, { tagIds: [summer.id, beach.id, summer.id] });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ...first,
        position: 0,
        tales: [],
        tags: [
          { id: beach.id, name: 'Beach' },
          { id: summer.id, name: 'summer' },
        ],
      });
      expect(await groupTags(zone.id)).toEqual({ First: ['Beach', 'summer'], Second: [] });

      const replaced = await put(`/tale-groups/${first.id}/tags`, { tagIds: [beach.id] });
      expect((await replaced.json()).tags).toEqual([{ id: beach.id, name: 'Beach' }]);

      const cleared = await put(`/tale-groups/${first.id}/tags`, { tagIds: [] });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).tags).toEqual([]);
      expect(await groupTags(zone.id)).toEqual({ First: [], Second: [] });
    });

    it('carries tags in the order response too', async () => {
      const zone = await createZone();
      const tag = await createTag(zone.projectId, 'summer');
      const a = await createGroup(zone.id, 'A');
      const b = await createGroup(zone.id, 'B');
      await put(`/tale-groups/${a.id}/tags`, { tagIds: [tag.id] });
      const res = await put(`/zones/${zone.id}/tale-groups/order`, { taleGroupIds: [b.id, a.id] });
      const groups: { tags: { name: string }[] }[] = await res.json();
      expect(groups.map((g) => g.tags.map((t) => t.name))).toEqual([[], ['summer']]);
    });

    it('refuses a tag of another project or an unknown tag with 400 tag_not_found and changes nothing', async () => {
      const zone = await createZone();
      const otherZone = await createZone();
      const mine = await createTag(zone.projectId, 'summer');
      const theirs = await createTag(otherZone.projectId, 'summer');
      const group = await createGroup(zone.id, 'First');
      await put(`/tale-groups/${group.id}/tags`, { tagIds: [mine.id] });

      for (const tagIds of [[theirs.id], [mine.id, theirs.id], [unknownId], ['nope']]) {
        const res = await put(`/tale-groups/${group.id}/tags`, { tagIds });
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('tag_not_found');
      }
      expect(await groupTags(zone.id)).toEqual({ First: ['summer'] });
    });

    it('refuses a body without a tagIds array, and an unknown tale group', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id, 'First');
      for (const body of [{}, { tagIds: 'x' }, { tagIds: [1] }]) {
        const res = await put(`/tale-groups/${group.id}/tags`, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      const res = await put(`/tale-groups/${unknownId}/tags`, { tagIds: [] });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('tale_group_not_found');
    });

    it('keeps tags and group tags after the API restarts', async () => {
      const zone = await createZone();
      const tag = await createTag(zone.projectId, 'summer');
      const group = await createGroup(zone.id, 'First');
      await put(`/tale-groups/${group.id}/tags`, { tagIds: [tag.id] });
      await restart();
      expect(await groupTags(zone.id)).toEqual({ First: ['summer'] });
      expect(await (await fetch(`${base}/projects/${zone.projectId}/tags`)).json()).toEqual([tag]);
    });

    it('rejects a link to a tag of another project at the database', async () => {
      const zone = await createZone();
      const otherZone = await createZone();
      const theirs = await createTag(otherZone.projectId, 'summer');
      const group = await createGroup(zone.id, 'First');
      for (const projectId of [zone.projectId, otherZone.projectId]) {
        await expect(
          pool.query('INSERT INTO tale_group_tags (tale_group_id, tag_id, project_id) VALUES ($1, $2, $3)', [
            group.id,
            theirs.id,
            projectId,
          ]),
        ).rejects.toThrow(/foreign key/);
      }
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
  describe('invitations and project access', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    let adminCookie: string;

    function send(method: string, path: string, body?: unknown, cookie = sessionCookie): Promise<Response> {
      const headers: Record<string, string> = { Cookie: cookie };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      return globalThis.fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    function cookieValue(res: Response, name: string): string {
      const line = res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`)) ?? '';
      return line.split(';')[0].slice(name.length + 1);
    }

    async function invite(projectId: string): Promise<{ id: string; url: string; expiresAt: string; token: string }> {
      const res = await send('POST', `/projects/${projectId}/invitations`, undefined, adminCookie);
      expect(res.status).toBe(201);
      const body = await res.json();
      return { ...body, token: decodeURIComponent(new URL(body.url).pathname.split('/').pop() ?? '') };
    }

    // Runs the invitee's side in a fresh browser: options, then verify with the challenge cookie.
    async function redeem(
      token: string,
      { name = 'Cy Content', email = 'cy@example.com', id = 'cred-cy', fail = false } = {},
    ): Promise<Response> {
      const options = await send('POST', `/auth/invitations/${token}/options`, { name, email }, '');
      if (options.status !== 200) return options;
      const { challenge } = await options.json();
      const challengeCookie = `taleart_challenge=${cookieValue(options, 'taleart_challenge')}`;
      return send('POST', `/auth/invitations/${token}/verify`, { id, challenge, fail }, challengeCookie);
    }

    // Signs in a content manager who is a member of `projectIds`; later requests carry their session.
    async function signInAsContentManager(projectIds: string[]): Promise<void> {
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      for (const projectId of projectIds) await addProjectMember(pool, projectId, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
    }

    // Project A and B, each with a zone, a tale group and a tale with media, created by the admin.
    async function twoProjects() {
      const make = async (name: string) => {
        const project = await createProject(name);
        const zone = await (await post('/zones', { name: `${name} bar`, projectId: project.id })).json();
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
        const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
        await fetch(`${base}/tales/${tale.id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
        return { project, zone, group, tale };
      };
      return { a: await make('Alpha'), b: await make('Beta') };
    }

    beforeEach(() => {
      adminCookie = sessionCookie;
    });

    it('lets an admin create an invitation link and stores only the token hash', async () => {
      const project = await createProject();
      const before = Date.now();
      const res = await send('POST', `/projects/${project.id}/invitations`, undefined, adminCookie);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({
        id: expect.any(String),
        projectId: project.id,
        url: expect.stringMatching(/^http:\/\/localhost:4200\/invite\/[A-Za-z0-9_-]{43}$/),
        expiresAt: expect.any(String),
      });
      const token = body.url.split('/').pop();
      const ttl = new Date(body.expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThan(7 * 24 * 3600 * 1000 - 5000);
      expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 5000);

      const { rows } = await pool.query('SELECT * FROM invitations');
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it.each([unknownId, 'not-a-uuid'])('answers 404 project_not_found when inviting to project %s', async (id) => {
      const res = await send('POST', `/projects/${id}/invitations`, undefined, adminCookie);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'project_not_found', message: expect.any(String) } });
    });

    it('shows an invitation without a session, and answers 410 for an unknown or expired one', async () => {
      const project = await createProject('Acme');
      const { token, expiresAt } = await invite(project.id);
      const res = await send('GET', `/auth/invitations/${token}`, undefined, '');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projectName: 'Acme', expiresAt });

      const unknown = await send('GET', '/auth/invitations/nope', undefined, '');
      expect(unknown.status).toBe(410);
      expect(await unknown.json()).toEqual({ error: { code: 'invitation_invalid', message: expect.any(String) } });

      await pool.query("UPDATE invitations SET expires_at = now() - interval '1 second'");
      expect((await send('GET', `/auth/invitations/${token}`, undefined, '')).status).toBe(410);
      expect((await redeem(token)).status).toBe(410);
    });

    it('signs the invitee in as a content manager who sees only the invited project', async () => {
      const { a, b } = await twoProjects();
      const { token } = await invite(a.project.id);

      const options = await send('POST', `/auth/invitations/${token}/options`, { name: 'Cy', email: 'cy@example.com' }, '');
      expect(options.status).toBe(200);
      expect(await options.json()).toMatchObject({ user: { name: 'cy@example.com', displayName: 'Cy' } });
      expect(options.headers.getSetCookie().find((l) => l.startsWith('taleart_challenge='))).toContain('HttpOnly');

      const res = await redeem(token);
      expect(res.status).toBe(201);
      const { user } = await res.json();
      expect(user).toEqual({ id: expect.any(String), name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      sessionCookie = `taleart_session=${cookieValue(res, 'taleart_session')}`;

      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user });
      expect(await (await send('GET', '/projects')).json()).toEqual([a.project]);
      expect(await (await send('GET', '/zones')).json()).toEqual([a.zone]);
      expect((await send('GET', `/zones/${a.zone.id}/tale-groups`)).status).toBe(200);
      expect((await send('GET', `/zones/${b.zone.id}/tale-groups`)).status).toBe(403);

      const { rows } = await pool.query('SELECT used_at, used_by FROM invitations');
      expect(rows[0].used_at).not.toBeNull();
      expect(rows[0].used_by).toBe(user.id);
      const members = await pool.query('SELECT project_id FROM project_members WHERE user_id = $1', [user.id]);
      expect(members.rows).toEqual([{ project_id: a.project.id }]);
    });

    it('answers 410 when the same link is used a second time', async () => {
      const project = await createProject();
      const { token } = await invite(project.id);
      expect((await redeem(token)).status).toBe(201);
      expect((await send('GET', `/auth/invitations/${token}`, undefined, '')).status).toBe(410);
      const again = await redeem(token, { email: 'dee@example.com', id: 'cred-dee' });
      expect(again.status).toBe(410);
      expect((await again.json()).error.code).toBe('invitation_invalid');
    });

    it('answers 410 when the link was used between options and verify', async () => {
      const project = await createProject();
      const { token } = await invite(project.id);
      const slow = await send('POST', `/auth/invitations/${token}/options`, { name: 'Dee', email: 'dee@example.com' }, '');
      const { challenge } = await slow.json();
      expect((await redeem(token)).status).toBe(201);
      const res = await send(
        'POST',
        `/auth/invitations/${token}/verify`,
        { id: 'cred-dee', challenge },
        `taleart_challenge=${cookieValue(slow, 'taleart_challenge')}`,
      );
      expect(res.status).toBe(410);
      expect((await res.json()).error.code).toBe('invitation_invalid');
      expect((await pool.query("SELECT 1 FROM users WHERE email = 'dee@example.com'")).rowCount).toBe(0);
    });

    it('lets only one of two racing redeems of one link create a user', async () => {
      const project = await createProject();
      const { token } = await invite(project.id);
      const start = async (email: string) => {
        const res = await send('POST', `/auth/invitations/${token}/options`, { name: 'X', email }, '');
        return { challenge: (await res.json()).challenge, cookie: `taleart_challenge=${cookieValue(res, 'taleart_challenge')}` };
      };
      const one = await start('one@example.com');
      const two = await start('two@example.com');
      const results = await Promise.all([
        send('POST', `/auth/invitations/${token}/verify`, { id: 'cred-1', challenge: one.challenge }, one.cookie),
        send('POST', `/auth/invitations/${token}/verify`, { id: 'cred-2', challenge: two.challenge }, two.cookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
      expect((await pool.query("SELECT 1 FROM users WHERE role = 'content_manager'")).rowCount).toBe(1);
    });

    it('refuses an email that already belongs to a user with 409 email_taken', async () => {
      const project = await createProject();
      const { token } = await invite(project.id);
      const res = await redeem(token, { email: 'ADMIN@example.com' });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: 'email_taken', message: expect.any(String) } });
    });

    it.each([{ name: ' ', email: 'cy@example.com' }, { name: 'Cy', email: 'nope' }, { name: 'Cy' }])(
      'refuses invitation options %o with 400 validation_failed',
      async (body) => {
        const project = await createProject();
        const { token } = await invite(project.id);
        const res = await send('POST', `/auth/invitations/${token}/options`, body, '');
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      },
    );

    it('refuses a failed passkey with 400 passkey_failed and keeps the link usable', async () => {
      const project = await createProject();
      const { token } = await invite(project.id);
      const res = await redeem(token, { fail: true });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('passkey_failed');
      expect((await pool.query("SELECT 1 FROM users WHERE role = 'content_manager'")).rowCount).toBe(0);
      expect((await redeem(token)).status).toBe(201);
    });

    it('refuses admin-only actions to a content manager with 403 forbidden', async () => {
      const project = await createProject();
      await signInAsContentManager([project.id]);
      for (const res of [
        await send('POST', '/projects', { name: 'Mine' }),
        await send('POST', `/projects/${project.id}/invitations`),
        await send('POST', `/projects/${unknownId}/invitations`),
      ]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
      }
    });

    it('refuses every route on another project with 403 forbidden', async () => {
      const { a, b } = await twoProjects();
      await signInAsContentManager([a.project.id]);
      const requests: [string, string, unknown?][] = [
        ['POST', '/zones', { name: 'Mine', projectId: b.project.id }],
        ['GET', `/zones/${b.zone.id}/frames`],
        ['POST', `/zones/${b.zone.id}/frames`, { type: 'bar' }],
        ['GET', `/zones/${b.zone.id}/tale-groups`],
        ['POST', `/zones/${b.zone.id}/tale-groups`, { name: 'Mine' }],
        ['PUT', `/zones/${b.zone.id}/tale-groups/order`, { taleGroupIds: [b.group.id] }],
        ['POST', `/tale-groups/${b.group.id}/tales`, { title: 'Mine' }],
        ['PUT', `/tale-groups/${b.group.id}/tales/order`, { taleIds: [b.tale.id] }],
        ['PUT', `/tale-groups/${b.group.id}/tags`, { tagIds: [] }],
        ['GET', `/projects/${b.project.id}/tags`],
        ['POST', `/projects/${b.project.id}/tags`, { name: 'Mine' }],
        ['GET', `/tales/${b.tale.id}/media`],
      ];
      for (const [method, path, body] of requests) {
        const res = await send(method, path, body);
        expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
        expect((await res.json()).error.code).toBe('forbidden');
      }
      const upload = await fetch(`${base}/tales/${b.tale.id}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(upload.status).toBe(403);
      expect((await pool.query('SELECT 1 FROM zones WHERE name = $1', ['Mine'])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM tags')).rowCount).toBe(0);
    });

    it('allows a content manager every route on their own project and still answers 404 for unknown ones', async () => {
      const { a } = await twoProjects();
      await signInAsContentManager([a.project.id]);
      expect((await send('POST', '/zones', { name: 'Mine', projectId: a.project.id })).status).toBe(201);
      expect((await send('GET', `/zones/${a.zone.id}/frames`)).status).toBe(200);
      expect((await send('POST', `/zones/${a.zone.id}/frames`, { type: 'bar' })).status).toBe(201);
      expect((await send('POST', `/zones/${a.zone.id}/tale-groups`, { name: 'Mine' })).status).toBe(201);
      expect((await send('POST', `/tale-groups/${a.group.id}/tales`, { title: 'Mine' })).status).toBe(201);
      expect((await send('GET', `/tales/${a.tale.id}/media`)).status).toBe(200);
      const tag = await send('POST', `/projects/${a.project.id}/tags`, { name: 'Mine' });
      expect(tag.status).toBe(201);
      expect((await send('GET', `/projects/${a.project.id}/tags`)).status).toBe(200);
      const tagged = await send('PUT', `/tale-groups/${a.group.id}/tags`, { tagIds: [(await tag.json()).id] });
      expect(tagged.status).toBe(200);

      expect((await send('GET', `/zones/${unknownId}/frames`)).status).toBe(404);
      expect((await send('POST', `/tale-groups/${unknownId}/tales`, { title: 'X' })).status).toBe(404);
      expect((await send('GET', `/tales/${unknownId}/media`)).status).toBe(404);
      expect((await send('PUT', `/tale-groups/${unknownId}/tags`, { tagIds: [] })).status).toBe(404);
      expect((await send('GET', `/projects/${unknownId}/tags`)).status).toBe(404);
      const zone = await send('POST', '/zones', { name: 'X', projectId: unknownId });
      expect(zone.status).toBe(400);
      expect((await zone.json()).error.code).toBe('project_not_found');
    });

    it('lets an admin reach every project', async () => {
      const { a, b } = await twoProjects();
      expect(await (await send('GET', '/projects')).json()).toEqual([a.project, b.project]);
      expect(await (await send('GET', '/zones')).json()).toEqual([a.zone, b.zone]);
      expect((await send('GET', `/zones/${b.zone.id}/tale-groups`)).status).toBe(200);
    });
  });
  describe('zone keys and the Delivery API', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';

    function send(method: string, path: string, cookie = sessionCookie): Promise<Response> {
      return globalThis.fetch(`${base}${path}`, { method, headers: { Cookie: cookie } });
    }

    function deliver(key?: string, headers: Record<string, string> = {}): Promise<Response> {
      const all: Record<string, string> = { ...headers };
      if (key !== undefined) all['Authorization'] = `Bearer ${key}`;
      return globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: all });
    }

    async function issue(zoneId: string): Promise<{ key: string; prefix: string; createdAt: string }> {
      const res = await send('POST', `/zones/${zoneId}/key`);
      expect(res.status).toBe(201);
      return res.json();
    }

    async function signInAsContentManager(projectId: string): Promise<void> {
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, projectId, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
    }

    async function expectInvalidKey(res: Response): Promise<string> {
      expect(res.status).toBe(401);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      const body = await res.json();
      expect(body.error.code).toBe('invalid_zone_key');
      return body.error.message;
    }

    it('answers null while a zone has no key, and 404 for an unknown zone', async () => {
      const zone = await createZone();
      const res = await send('GET', `/zones/${zone.id}/key`);
      expect(res.status).toBe(200);
      expect(await res.json()).toBeNull();

      for (const method of ['GET', 'POST', 'DELETE']) {
        const unknown = await send(method, `/zones/${unknownId}/key`);
        expect(unknown.status).toBe(404);
        expect((await unknown.json()).error.code).toBe('zone_not_found');
      }
    });

    it('issues a key shown once, and then reports only its prefix and date', async () => {
      const zone = await createZone();
      const issued = await issue(zone.id);
      expect(issued.key).toMatch(/^tak_[A-Za-z0-9_-]{43}$/);
      expect(issued.prefix).toBe(issued.key.slice(0, 10));
      expect(Number.isNaN(Date.parse(issued.createdAt))).toBe(false);

      const info = await send('GET', `/zones/${zone.id}/key`);
      expect(info.status).toBe(200);
      const text = await info.text();
      expect(JSON.parse(text)).toEqual({ prefix: issued.prefix, createdAt: issued.createdAt });
      expect(text).not.toContain(issued.key);
      expect(text).not.toContain(createHash('sha256').update(issued.key).digest('hex'));
    });

    it('stores hashes and prefixes, never keys', async () => {
      const zone = await createZone();
      const issued = await issue(zone.id);
      const { rows } = await pool.query('SELECT * FROM zone_keys');
      expect(rows).toHaveLength(1);
      expect(rows[0].key_hash).toBe(createHash('sha256').update(issued.key).digest('hex'));
      expect(rows[0].prefix).toBe(issued.prefix);
      expect(rows[0].zone_id).toBe(zone.id);
      expect(rows[0].project_id).toBe(zone.projectId);
      expect(JSON.stringify(rows)).not.toContain(issued.key);
    });

    it('serves the zone and its frames to a valid key', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frames`, { type: 'bar', settings: {} })).json();
      const { key } = await issue(zone.id);

      const res = await deliver(key);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(await res.json()).toEqual({
        id: zone.id,
        name: zone.name,
        frames: [{ id: frame.id, type: 'bar', settings: {} }],
      });
    });

    it('rotates: the old key is revoked at once and the new key works', async () => {
      const zone = await createZone();
      const first = await issue(zone.id);
      const second = await issue(zone.id);
      expect(second.key).not.toBe(first.key);

      await expectInvalidKey(await deliver(first.key));
      expect((await deliver(second.key)).status).toBe(200);
      expect(await (await send('GET', `/zones/${zone.id}/key`)).json()).toEqual({
        prefix: second.prefix,
        createdAt: second.createdAt,
      });
      const { rows } = await pool.query('SELECT revoked_at FROM zone_keys WHERE zone_id = $1 ORDER BY created_at', [
        zone.id,
      ]);
      expect(rows).toHaveLength(2);
      expect(rows[0].revoked_at).not.toBeNull();
      expect(rows[1].revoked_at).toBeNull();
    });

    it('keeps at most one active key under concurrent rotations', async () => {
      const zone = await createZone();
      const results = await Promise.all([1, 2, 3, 4].map(() => send('POST', `/zones/${zone.id}/key`)));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      const { rows } = await pool.query('SELECT 1 FROM zone_keys WHERE zone_id = $1 AND revoked_at IS NULL', [zone.id]);
      expect(rows).toHaveLength(1);
    });

    it('revokes: 204, info answers null, the key stops working, and nothing is deleted', async () => {
      const zone = await createZone();
      const { key } = await issue(zone.id);
      const res = await send('DELETE', `/zones/${zone.id}/key`);
      expect(res.status).toBe(204);
      expect(await (await send('GET', `/zones/${zone.id}/key`)).json()).toBeNull();
      await expectInvalidKey(await deliver(key));
      expect((await pool.query('SELECT 1 FROM zone_keys WHERE revoked_at IS NOT NULL')).rowCount).toBe(1);

      const again = await send('DELETE', `/zones/${zone.id}/key`);
      expect(again.status).toBe(404);
      expect((await again.json()).error.code).toBe('zone_key_not_found');
    });

    it('revokes the new key after a rotation, also when the two race', async () => {
      const zone = await createZone();
      await issue(zone.id);
      const rotated = await issue(zone.id);
      expect((await send('DELETE', `/zones/${zone.id}/key`)).status).toBe(204);
      await expectInvalidKey(await deliver(rotated.key));

      await issue(zone.id);
      const [rotate, revoke] = await Promise.all([
        send('POST', `/zones/${zone.id}/key`),
        send('DELETE', `/zones/${zone.id}/key`),
      ]);
      expect(rotate.status).toBe(201);
      expect(revoke.status).toBe(204);
      const active = await pool.query('SELECT 1 FROM zone_keys WHERE zone_id = $1 AND revoked_at IS NULL', [zone.id]);
      expect(active.rowCount).toBeLessThanOrEqual(1);
    });

    it('answers 401 invalid_zone_key with one message for a missing, unknown, malformed or session-only caller', async () => {
      const zone = await createZone();
      await issue(zone.id);
      const messages = new Set([
        await expectInvalidKey(await deliver()),
        await expectInvalidKey(await deliver('tak_unknownkeyunknownkeyunknownkeyunknownkey0')),
        await expectInvalidKey(await deliver('not-a-key')),
        await expectInvalidKey(await deliver(undefined, { Authorization: 'Basic abc' })),
        await expectInvalidKey(await deliver(undefined, { Cookie: sessionCookie })),
      ]);
      expect(messages.size).toBe(1);
    });

    it('does not accept a zone key on the Management API', async () => {
      const zone = await createZone();
      const { key } = await issue(zone.id);
      const res = await globalThis.fetch(`${base}/zones`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('unauthenticated');
    });

    it('answers CORS preflight from any origin with Authorization allowed', async () => {
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://shop.example.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('lets a content manager see the key info but not issue, rotate or revoke', async () => {
      const zone = await createZone();
      const issued = await issue(zone.id);
      await signInAsContentManager(zone.projectId);

      const info = await send('GET', `/zones/${zone.id}/key`);
      expect(info.status).toBe(200);
      expect(await info.json()).toEqual({ prefix: issued.prefix, createdAt: issued.createdAt });
      for (const method of ['POST', 'DELETE']) {
        const res = await send(method, `/zones/${zone.id}/key`);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      }
      expect((await deliver(issued.key)).status).toBe(200);
    });

    it("refuses a zone key route in a project the caller cannot access", async () => {
      const zone = await createZone();
      const other = await createProject('Beta');
      await signInAsContentManager(other.id);
      const res = await send('GET', `/zones/${zone.id}/key`);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
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
      await pool.query('TRUNCATE zone_keys, invitations, project_members, auth_challenges, sessions, passkeys, users');
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
