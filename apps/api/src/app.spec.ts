import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addProjectMember,
  createSession,
  createUser,
  PasskeyFailedError,
  type PasskeyVerifier,
} from '@taleart/server-access';
import {
  encryptToken,
  recoverStaleJobs,
  runImportJob,
  startImportWorker,
  type ImportWorker,
} from '@taleart/server-importer';
import { LocalDiskStorage } from '@taleart/server-storage';
import { loadFrameTypeRegistry, type FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { createApp, type ImporterConfig } from './app';
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

// The fake Storyly server (apps/fake-storyly), started in-process on a free
// port. Loaded by path at run time: it is a plain Node module of another app.
const fakeStorylyModule = join(__dirname, '../../fake-storyly/src/fake-storyly.mjs');
const FAKE_STORYLY_TOKEN = 'fake-storyly-token';
interface FakeStoryly {
  url: string;
  control: {
    failInstances: 'status' | 'shape' | null;
    failStoryGroups: 'status' | 'shape' | null;
    failStories: 'status' | 'shape' | null;
    delayMs: number;
    data: {
      storyGroups: Record<string, { data: Record<string, unknown>[] }>;
      stories: Record<string, { data: Record<string, unknown>[] }>;
    };
    reset(): void;
  };
  close(): Promise<void>;
}
interface FakeStorylyModule {
  startFakeStoryly(options?: { port?: number }): Promise<FakeStoryly>;
}

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

// The public origin Delivery media URLs start with (PUBLIC_API_URL).
const publicApiUrl = 'https://api.example.com';

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
    const s = createApp(p, frameTypes, new LocalDiskStorage(mediaDir), { verifier: fakeVerifier }, { publicApiUrl }).listen(0);
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

  // Sets the stored status of a tale group or tale (AD-6), as the dashboard's Publish, Pause, Archive and Restore do.
  function setStatus(kind: 'tale-groups' | 'tales', id: string, status: unknown): Promise<Response> {
    return fetch(`${base}/${kind}/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }

  // Publishes tale groups and tales: only live content is delivered (AD-6).
  async function publish(kind: 'tale-groups' | 'tales', ...ids: string[]): Promise<void> {
    for (const id of ids) expect((await setStatus(kind, id, 'live')).status).toBe(200);
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
      'TRUNCATE import_links, import_jobs, zone_keys, tale_group_tags, tags, tales, zone_tale_groups, tale_groups, frames, zones, invitations, project_members, projects, auth_challenges, sessions, passkeys, users',
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
          { key: 'bar', label: 'Bar', schema: expect.objectContaining({ type: 'object' }) },
          { key: 'banner', label: 'Banner', schema: expect.objectContaining({ type: 'object' }) },
        ]),
      );
      const bar = types.find((t: { key: string }) => t.key === 'bar');
      expect(bar.schema.properties).toEqual({
        shape: expect.objectContaining({ title: 'Shape', enum: ['circle', 'rounded-square'], default: 'circle' }),
        size: expect.objectContaining({ title: 'Size', enum: ['small', 'medium', 'large'], default: 'medium' }),
        showTitles: expect.objectContaining({ title: 'Show titles', type: 'boolean', default: true }),
        alignment: expect.objectContaining({ title: 'Alignment', enum: ['start', 'center'], default: 'start' }),
        gap: expect.objectContaining({ title: 'Gap', type: 'integer', minimum: 4, maximum: 24, default: 12 }),
      });
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
        expect(types).toContainEqual({ key: 'test-strip', label: 'Test strip', schema: expect.objectContaining({ required: ['height'] }) });

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

    describe('frame settings', () => {
      const edited = { shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 };

      function patch(path: string, body: unknown): Promise<Response> {
        return fetch(`${base}${path}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      async function barFrame(): Promise<{ zone: { id: string }; frame: { id: string } }> {
        const zone = await createZone();
        const frame = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
        return { zone, frame };
      }

      it('replaces a bar frame settings and keeps them', async () => {
        const { zone, frame } = await barFrame();

        const res = await patch(`/zones/${zone.id}/frames/${frame.id}`, { settings: edited });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ...frame, settings: edited });
        expect(await (await fetch(`${base}/zones/${zone.id}/frames`)).json()).toEqual([{ ...frame, settings: edited }]);

        // A later save replaces the whole object.
        const again = await patch(`/zones/${zone.id}/frames/${frame.id}`, { settings: { gap: 8 } });
        expect((await again.json()).settings).toEqual({ gap: 8 });
      });

      it.each([
        [{ gap: 40 }, 'settings.gap must be at most 24'],
        [{ gap: 3 }, 'settings.gap must be at least 4'],
        [{ gap: 12.5 }, 'settings.gap must be integer'],
        [{ shape: 'star' }, 'settings.shape must be one of: circle, rounded-square'],
        [{ color: 'red' }, 'settings has unknown property "color"'],
      ])('refuses %j with invalid_frame_settings and stores nothing', async (settings, message) => {
        const { zone, frame } = await barFrame();
        await patch(`/zones/${zone.id}/frames/${frame.id}`, { settings: edited });

        const res = await patch(`/zones/${zone.id}/frames/${frame.id}`, { settings: { ...edited, ...settings } });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: 'invalid_frame_settings', message } });
        const [stored] = await (await fetch(`${base}/zones/${zone.id}/frames`)).json();
        expect(stored.settings).toEqual(edited);
      });

      it('refuses a body without settings', async () => {
        const { zone, frame } = await barFrame();
        const res = await patch(`/zones/${zone.id}/frames/${frame.id}`, {});
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      });

      it('answers 404 for an unknown zone, an unknown frame and a frame of another zone', async () => {
        const { zone, frame } = await barFrame();
        const other = await barFrame();
        const cases: [string, string][] = [
          [`/zones/${unknownZoneId}/frames/${frame.id}`, 'zone_not_found'],
          [`/zones/${zone.id}/frames/${unknownZoneId}`, 'frame_not_found'],
          [`/zones/${zone.id}/frames/not-a-uuid`, 'frame_not_found'],
          [`/zones/${zone.id}/frames/${other.frame.id}`, 'frame_not_found'],
        ];
        for (const [path, code] of cases) {
          const res = await patch(path, { settings: {} });
          expect({ path, status: res.status }).toEqual({ path, status: 404 });
          expect((await res.json()).error.code).toBe(code);
        }
        const [untouched] = await (await fetch(`${base}/zones/${other.zone.id}/frames`)).json();
        expect(untouched.settings).toEqual({});
      });
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
      const group = await res.json();
      expect(group).toEqual({
        id: expect.any(String),
        projectId: zone.projectId,
        name: 'Summer',
        status: 'draft',
        storedStatus: 'draft',
        startsAt: null,
        endsAt: null,
        cover: null,
        position: 0,
        zoneIds: [zone.id],
        tales: [],
        tags: [],
      });
      const { rows } = await pool.query('SELECT project_id FROM tale_groups');
      expect(rows).toEqual([{ project_id: zone.projectId }]);
      const placements = await pool.query('SELECT zone_id, tale_group_id, project_id, position FROM zone_tale_groups');
      expect(placements.rows).toEqual([
        { zone_id: zone.id, tale_group_id: group.id, project_id: zone.projectId, position: 0 },
      ]);
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
        status: 'draft',
        storedStatus: 'draft',
        startsAt: null,
        endsAt: null,
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
        id: first.id,
        projectId: zone.projectId,
        name: 'First',
        status: 'draft',
        storedStatus: 'draft',
        startsAt: null,
        endsAt: null,
        cover: null,
        zoneIds: [zone.id],
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

  describe('zone placements', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';

    interface Listed {
      id: string;
      name: string;
      position: number;
      zoneIds: string[];
      tales: { id: string; title: string }[];
      tags: { name: string }[];
    }

    function send(method: string, path: string, body?: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    async function zoneIn(projectId: string, name: string): Promise<{ id: string; projectId: string }> {
      return (await post('/zones', { name, projectId })).json();
    }

    async function createGroup(zoneId: string, name: string): Promise<Listed & { projectId: string }> {
      return (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
    }

    async function listed(zoneId: string): Promise<Listed[]> {
      const res = await fetch(`${base}/zones/${zoneId}/tale-groups`);
      expect(res.status).toBe(200);
      return res.json();
    }

    const order = async (zoneId: string) => (await listed(zoneId)).map((g) => [g.name, g.position]);

    // Project P with zones Z ("Home page") holding A then B, and Z2 ("Product page") holding C.
    async function setup() {
      const project = await createProject();
      const z = await zoneIn(project.id, 'Home page');
      const z2 = await zoneIn(project.id, 'Product page');
      const a = await createGroup(z.id, 'A');
      const b = await createGroup(z.id, 'B');
      const c = await createGroup(z2.id, 'C');
      return { project, z, z2, a, b, c };
    }

    it('places a group of the same project at the end of another zone: 201, listed last, zoneIds of both', async () => {
      const { z, z2, a } = await setup();
      const res = await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ...a, position: 1, zoneIds: [z.id, z2.id] });
      expect(await order(z2.id)).toEqual([
        ['C', 0],
        ['A', 1],
      ]);
      expect((await listed(z.id)).find((g) => g.id === a.id)?.zoneIds).toEqual([z.id, z2.id]);
    });

    it('answers 200 unchanged when the group is already placed, without a duplicate', async () => {
      const { z, z2, a } = await setup();
      const first = await (await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`)).json();
      const again = await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(first);
      const home = await send('PUT', `/zones/${z.id}/tale-groups/${a.id}`);
      expect(home.status).toBe(200);
      expect((await home.json()).position).toBe(0);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM zone_tale_groups WHERE tale_group_id = $1', [a.id]);
      expect(rows).toEqual([{ n: 2 }]);
    });

    it('refuses a group of another project or an unknown group with 400, and an unknown zone with 404', async () => {
      const { z2 } = await setup();
      const other = await createZone();
      const theirs = await createGroup(other.id, 'Theirs');
      for (const id of [theirs.id, unknownId, 'not-a-uuid']) {
        const res = await send('PUT', `/zones/${z2.id}/tale-groups/${id}`);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: 'tale_group_not_found', message: expect.any(String) } });
      }
      for (const zoneId of [unknownId, 'not-a-uuid']) {
        const res = await send('PUT', `/zones/${zoneId}/tale-groups/${theirs.id}`);
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('zone_not_found');
      }
      expect(await order(z2.id)).toEqual([['C', 0]]);
    });

    it('rejects a placement whose zone and group are in different projects at the database', async () => {
      const { z, project } = await setup();
      const other = await createZone();
      const theirs = await createGroup(other.id, 'Theirs');
      for (const projectId of [project.id, other.projectId]) {
        await expect(
          pool.query('INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position) VALUES ($1, $2, $3, 9)', [
            z.id,
            theirs.id,
            projectId,
          ]),
        ).rejects.toThrow(/foreign key/);
      }
    });

    it('shows a shared edit in every zone and in the Delivery API of each', async () => {
      const { z, z2, a, c } = await setup();
      await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      const tale = await (await post(`/tale-groups/${a.id}/tales`, { title: 'Beach' })).json();
      const tag = await (await post(`/projects/${a.projectId}/tags`, { name: 'summer' })).json();
      expect((await send('PUT', `/tale-groups/${a.id}/tags`, { tagIds: [tag.id] })).status).toBe(200);

      for (const zoneId of [z.id, z2.id]) {
        const shared = (await listed(zoneId)).find((g) => g.id === a.id);
        expect(shared?.tales).toEqual([tale]);
        expect(shared?.tags.map((t) => t.name)).toEqual(['summer']);
      }
      await publish('tale-groups', a.id, c.id);
      await publish('tales', tale.id);
      const { key } = await (await post(`/zones/${z2.id}/key`, {})).json();
      const delivered = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      // C has no live tale, so only A is delivered.
      expect((await delivered.json()).taleGroups).toEqual([
        { id: a.id, name: 'A', cover: null, tales: [{ id: tale.id, title: 'Beach', media: null }] },
      ]);
    });

    it('renames a group in one zone and shows the new name in both zones and in the Delivery API', async () => {
      const { z, z2, a, c } = await setup();
      await publish('tale-groups', a.id, c.id);
      for (const group of [a, c]) {
        await publish('tales', (await (await post(`/tale-groups/${group.id}/tales`, { title: 'T' })).json()).id);
      }
      await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      const res = await send('PATCH', `/tale-groups/${a.id}`, { name: '  Summer sale  ' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: a.id,
        projectId: a.projectId,
        name: 'Summer sale',
        status: 'live',
        storedStatus: 'live',
        startsAt: null,
        endsAt: null,
        cover: null,
        zoneIds: [z.id, z2.id],
        tales: [expect.objectContaining({ title: 'T', status: 'live' })],
        tags: [],
      });
      for (const zoneId of [z.id, z2.id]) {
        expect((await listed(zoneId)).find((g) => g.id === a.id)?.name).toBe('Summer sale');
      }
      const { key } = await (await post(`/zones/${z2.id}/key`, {})).json();
      const delivered = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect((await delivered.json()).taleGroups.map((g: { name: string }) => g.name)).toEqual(['C', 'Summer sale']);
    });

    it('refuses a blank name with 400 and an unknown group with 404', async () => {
      const { z, a } = await setup();
      for (const body of [{}, { name: '   ' }, { name: 42 }]) {
        const res = await send('PATCH', `/tale-groups/${a.id}`, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      for (const id of [unknownId, 'not-a-uuid']) {
        const res = await send('PATCH', `/tale-groups/${id}`, { name: 'X' });
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('tale_group_not_found');
      }
      expect((await listed(z.id)).map((g) => g.name)).toEqual(['A', 'B']);
    });

    it("keeps each zone's own order: reordering one zone leaves the other as it was", async () => {
      const { z, z2, a, b, c } = await setup();
      await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      const res = await send('PUT', `/zones/${z.id}/tale-groups/order`, { taleGroupIds: [b.id, a.id] });
      expect(res.status).toBe(200);
      expect(await order(z.id)).toEqual([
        ['B', 0],
        ['A', 1],
      ]);
      expect(await order(z2.id)).toEqual([
        ['C', 0],
        ['A', 1],
      ]);
      // A zone's order names its own placements: Z's list does not fit Z2.
      const mismatch = await send('PUT', `/zones/${z2.id}/tale-groups/order`, { taleGroupIds: [b.id, a.id] });
      expect(mismatch.status).toBe(409);
      expect((await send('PUT', `/zones/${z2.id}/tale-groups/order`, { taleGroupIds: [a.id, c.id] })).status).toBe(200);
      expect(await order(z.id)).toEqual([
        ['B', 0],
        ['A', 1],
      ]);
    });

    it('removes only that placement: 204, positions stay dense, the other zone and the tales stay', async () => {
      const { z, z2, a, b } = await setup();
      const third = await createGroup(z.id, 'D');
      await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      await post(`/tale-groups/${a.id}/tales`, { title: 'Beach' });

      const res = await send('DELETE', `/zones/${z.id}/tale-groups/${a.id}`);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(await order(z.id)).toEqual([
        ['B', 0],
        ['D', 1],
      ]);
      const elsewhere = (await listed(z2.id)).find((g) => g.id === a.id);
      expect(elsewhere?.zoneIds).toEqual([z2.id]);
      expect(elsewhere?.tales.map((t) => t.title)).toEqual(['Beach']);
      expect((await listed(z.id)).map((g) => g.id)).toEqual([b.id, third.id]);

      for (const [path, code] of [
        [`/zones/${z.id}/tale-groups/${a.id}`, 'tale_group_not_found'],
        [`/zones/${z.id}/tale-groups/${unknownId}`, 'tale_group_not_found'],
        [`/zones/${z.id}/tale-groups/not-a-uuid`, 'tale_group_not_found'],
        [`/zones/${unknownId}/tale-groups/${a.id}`, 'zone_not_found'],
      ]) {
        const missing = await send('DELETE', path);
        expect(missing.status).toBe(404);
        expect((await missing.json()).error.code).toBe(code);
      }
    });

    it('keeps a group removed from every zone in the project list with no zones', async () => {
      const { project, z, z2, a, c } = await setup();
      await post(`/tale-groups/${a.id}/tales`, { title: 'Beach' });
      expect((await send('DELETE', `/zones/${z.id}/tale-groups/${a.id}`)).status).toBe(204);
      expect((await listed(z.id)).map((g) => g.name)).toEqual(['B']);
      expect((await send('PUT', `/tale-groups/${a.id}/tags`, { tagIds: [] })).status).toBe(200);
      await createGroup(z2.id, 'apple');

      const res = await fetch(`${base}/projects/${project.id}/tale-groups`);
      expect(res.status).toBe(200);
      const groups = await res.json();
      expect(groups).toEqual([
        { id: a.id, projectId: project.id, name: 'A', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 1, zoneIds: [] },
        { id: expect.any(String), projectId: project.id, name: 'apple', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id] },
        { id: expect.any(String), projectId: project.id, name: 'B', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z.id] },
        { id: c.id, projectId: project.id, name: 'C', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id] },
      ]);
      // The orphan can be placed again.
      expect((await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`)).status).toBe(201);

      for (const id of [unknownId, 'nope']) {
        const missing = await fetch(`${base}/projects/${id}/tale-groups`);
        expect(missing.status).toBe(404);
        expect((await missing.json()).error.code).toBe('project_not_found');
      }
    });

    it('gives concurrent placements in one zone distinct, dense positions', async () => {
      const { project, z2 } = await setup();
      const z3 = await zoneIn(project.id, 'Elsewhere');
      const groups = await Promise.all(['G1', 'G2', 'G3', 'G4', 'G5'].map((name) => createGroup(z3.id, name)));
      const results = await Promise.all(groups.map((g) => send('PUT', `/zones/${z2.id}/tale-groups/${g.id}`)));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect((await listed(z2.id)).map((g) => g.position)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('moves groups made before placements into their old zone at their old position, once', async () => {
      // Builds the tables as they were before AD-14, with data like stories 1.3 to 1.5 made.
      const project = await createProject();
      const z = await zoneIn(project.id, 'Home page');
      const z2 = await zoneIn(project.id, 'Product page');
      await pool.query('DROP TABLE zone_tale_groups');
      await pool.query(`
        ALTER TABLE tale_groups
          ADD COLUMN zone_id uuid,
          ADD COLUMN position integer CHECK (position >= 0),
          ADD FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id)
      `);
      const insert = async (zoneId: string, name: string, position: number): Promise<string> =>
        (
          await pool.query<{ id: string }>(
            'INSERT INTO tale_groups (zone_id, project_id, name, position) VALUES ($1, $2, $3, $4) RETURNING id',
            [zoneId, project.id, name, position],
          )
        ).rows[0].id;
      const b = await insert(z.id, 'B', 1);
      const a = await insert(z.id, 'A', 0);
      const c = await insert(z2.id, 'C', 0);
      await pool.query('ALTER TABLE tale_groups ALTER COLUMN zone_id SET NOT NULL, ALTER COLUMN position SET NOT NULL');
      await pool.query('CREATE INDEX tale_groups_zone_id_idx ON tale_groups (zone_id, position)');
      await pool.query(
        "INSERT INTO tales (tale_group_id, project_id, title, position) VALUES ($1, $2, 'Beach', 0)",
        [a, project.id],
      );

      const placements = async () =>
        (
          await pool.query(
            'SELECT zone_id, tale_group_id, project_id, position FROM zone_tale_groups ORDER BY zone_id, position',
          )
        ).rows;
      const columns = async () =>
        (
          await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'tale_groups' AND table_schema = current_schema() ORDER BY column_name",
          )
        ).rows.map((r) => r.column_name);

      await restart();
      const expected = [
        { zone_id: z.id, tale_group_id: a, project_id: project.id, position: 0 },
        { zone_id: z.id, tale_group_id: b, project_id: project.id, position: 1 },
        { zone_id: z2.id, tale_group_id: c, project_id: project.id, position: 0 },
      ].sort((x, y) => (x.zone_id < y.zone_id ? -1 : x.zone_id > y.zone_id ? 1 : x.position - y.position));
      expect(await placements()).toEqual(expected);
      expect(await columns()).toEqual([
        'cover_animated',
        'cover_content_type',
        'cover_key',
        'created_at',
        'ends_at',
        'id',
        'name',
        'project_id',
        'starts_at',
        'status',
      ]);
      expect((await pool.query("SELECT 1 FROM pg_indexes WHERE indexname = 'tale_groups_zone_id_idx'")).rowCount).toBe(0);
      expect((await listed(z.id)).map((g) => [g.name, g.position, g.tales.map((t) => t.title)])).toEqual([
        ['A', 0, ['Beach']],
        ['B', 1, []],
      ]);
      expect(await order(z2.id)).toEqual([['C', 0]]);

      // Runs twice without change.
      await restart();
      expect(await placements()).toEqual(expected);
      expect(await columns()).toEqual([
        'cover_animated',
        'cover_content_type',
        'cover_key',
        'created_at',
        'ends_at',
        'id',
        'name',
        'project_id',
        'starts_at',
        'status',
      ]);
    });

    it('makes groups and tales made before statuses live, new ones draft, once (AD-6)', async () => {
      // Builds the tables as they were before statuses, with a group and a tale in them.
      const { z, a } = await setup();
      const tale = await (await post(`/tale-groups/${a.id}/tales`, { title: 'Beach' })).json();
      await pool.query('ALTER TABLE tales DROP COLUMN status');
      await pool.query('ALTER TABLE tale_groups DROP COLUMN status');

      const statuses = async () =>
        (
          await pool.query(
            `SELECT 'group' AS kind, name, status FROM tale_groups
             UNION ALL SELECT 'tale', title, status FROM tales ORDER BY kind, name`,
          )
        ).rows;

      // Two API processes starting at once: the migration lock runs them one after the other.
      await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
      await restart();
      const migrated = [
        { kind: 'group', name: 'A', status: 'live' },
        { kind: 'group', name: 'B', status: 'live' },
        { kind: 'group', name: 'C', status: 'live' },
        { kind: 'tale', name: 'Beach', status: 'live' },
      ];
      expect(await statuses()).toEqual(migrated);
      expect((await listed(z.id))[0]).toMatchObject({ id: a.id, status: 'live', tales: [{ id: tale.id, status: 'live', storedStatus: 'live' }] });

      // New rows start draft; a second run changes nothing.
      const d = await createGroup(z.id, 'D');
      await post(`/tale-groups/${d.id}/tales`, { title: 'Dune' });
      await restart();
      expect(await statuses()).toEqual([
        ...migrated.slice(0, 3),
        { kind: 'group', name: 'D', status: 'draft' },
        { kind: 'tale', name: 'Beach', status: 'live' },
        { kind: 'tale', name: 'Dune', status: 'draft' },
      ]);
      await expect(pool.query("UPDATE tales SET status = 'expired'")).rejects.toThrow(/tales_status_check/);
      await expect(pool.query("UPDATE tale_groups SET status = 'blocked-by-group'")).rejects.toThrow(/tale_groups_status_check/);
    });
  });

  describe('copy to zone', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const gif = Buffer.from('GIF89a-tiny-gif');

    interface Listed {
      id: string;
      projectId: string;
      name: string;
      position: number;
      zoneIds: string[];
      tales: { id: string; title: string; position: number; media: { contentType: string } | null }[];
      tags: { id: string; name: string }[];
    }

    function send(method: string, path: string, body?: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    function upload(taleId: string, contentType: string, body: Uint8Array): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/media`, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
    }

    async function zoneIn(projectId: string, name: string): Promise<{ id: string; projectId: string }> {
      return (await post('/zones', { name, projectId })).json();
    }

    async function listed(zoneId: string): Promise<Listed[]> {
      const res = await fetch(`${base}/zones/${zoneId}/tale-groups`);
      expect(res.status).toBe(200);
      return res.json();
    }

    async function mediaKey(taleId: string): Promise<string | null> {
      return (await pool.query('SELECT media_key FROM tales WHERE id = $1', [taleId])).rows[0].media_key;
    }

    function storedFiles(): string[] {
      const dir = join(mediaDir, 'tales');
      return existsSync(dir) ? readdirSync(dir).sort() : [];
    }

    function copy(groupId: string, zoneId: unknown): Promise<Response> {
      return send('POST', `/tale-groups/${groupId}/copy`, { zoneId });
    }

    // Project P with a staging zone holding G (tales "One" with a PNG, then
    // "Two"; tag "summer") and a production zone Z2 holding H.
    async function setup() {
      const project = await createProject('Acme');
      const staging = await zoneIn(project.id, 'Staging');
      const production = await zoneIn(project.id, 'Production');
      const g: Listed = await (await post(`/zones/${staging.id}/tale-groups`, { name: 'Summer sale' })).json();
      await post(`/zones/${production.id}/tale-groups`, { name: 'H' });
      const one = await (await post(`/tale-groups/${g.id}/tales`, { title: 'One' })).json();
      const two = await (await post(`/tale-groups/${g.id}/tales`, { title: 'Two' })).json();
      expect((await upload(one.id, 'image/png', png)).status).toBe(200);
      const summer = await (await post(`/projects/${project.id}/tags`, { name: 'summer' })).json();
      expect((await send('PUT', `/tale-groups/${g.id}/tags`, { tagIds: [summer.id] })).status).toBe(200);
      return { project, staging, production, g, one, two, summer };
    }

    beforeEach(() => {
      rmSync(join(mediaDir, 'tales'), { recursive: true, force: true });
    });

    it('copies into a zone of the same project: 201, listed last, same tales in order, the same tag row', async () => {
      const { project, staging, production, g, one, summer } = await setup();
      const res = await copy(g.id, production.id);
      expect(res.status).toBe(201);
      const body: Listed = await res.json();
      expect(body).toEqual({
        id: expect.any(String),
        projectId: project.id,
        name: 'Summer sale',
        status: 'draft',
        storedStatus: 'draft',
        startsAt: null,
        endsAt: null,
        cover: null,
        position: 1,
        zoneIds: [production.id],
        tales: [
          expect.objectContaining({ title: 'One', position: 0, media: expect.objectContaining({ contentType: 'image/png' }) }),
          expect.objectContaining({ title: 'Two', position: 1, media: null }),
        ],
        tags: [{ id: summer.id, name: 'summer' }],
      });
      expect(body.id).not.toBe(g.id);
      expect(body.tales.map((t) => t.id)).not.toContain(one.id);
      expect((await listed(production.id)).map((x) => x.name)).toEqual(['H', 'Summer sale']);
      expect((await listed(production.id))[1]).toEqual(body);
      // The source stays only in staging; the media file is shared, not duplicated.
      expect((await listed(staging.id)).map((x) => [x.id, x.zoneIds])).toEqual([[g.id, [staging.id]]]);
      expect(await mediaKey(body.tales[0].id)).toBe(await mediaKey(one.id));
      expect(storedFiles()).toHaveLength(1);
      expect((await pool.query('SELECT 1 FROM tags')).rowCount).toBe(1);
    });

    it('copies into another project: the tag is created there when missing, reused in any case when present', async () => {
      const { g } = await setup();
      const b = await createProject('Beta');
      const bZone = await zoneIn(b.id, 'Beta home');
      const created: Listed = await (await copy(g.id, bZone.id)).json();
      expect(created.projectId).toBe(b.id);
      expect(created.position).toBe(0);
      expect(created.tales.map((t) => t.title)).toEqual(['One', 'Two']);
      const bTags = await (await fetch(`${base}/projects/${b.id}/tags`)).json();
      expect(bTags).toEqual([{ id: created.tags[0].id, projectId: b.id, name: 'summer' }]);
      expect(created.tags).toEqual([{ id: bTags[0].id, name: 'summer' }]);
      const { rows } = await pool.query('SELECT project_id FROM tales WHERE tale_group_id = $1', [created.id]);
      expect(rows.every((r) => r.project_id === b.id)).toBe(true);

      const c = await createProject('Gamma');
      const cZone = await zoneIn(c.id, 'Gamma home');
      const existing = await (await post(`/projects/${c.id}/tags`, { name: 'SUMMER' })).json();
      const reused: Listed = await (await copy(g.id, cZone.id)).json();
      expect(reused.tags).toEqual([{ id: existing.id, name: 'SUMMER' }]);
      expect((await pool.query('SELECT 1 FROM tags WHERE project_id = $1', [c.id])).rowCount).toBe(1);
    });

    it('keeps copy and source independent: renames, tales, order and tags on one leave the other unchanged', async () => {
      const { staging, production, g } = await setup();
      const c: Listed = await (await copy(g.id, production.id)).json();
      const sourceBefore = (await listed(staging.id))[0];

      expect((await send('PATCH', `/tale-groups/${c.id}`, { name: 'Copy' })).status).toBe(200);
      expect((await post(`/tale-groups/${c.id}/tales`, { title: 'Three' })).status).toBe(201);
      const copyTales = (await listed(production.id))[1].tales.map((t) => t.id);
      expect((await send('PUT', `/tale-groups/${c.id}/tales/order`, { taleIds: [...copyTales].reverse() })).status).toBe(200);
      expect((await send('PUT', `/tale-groups/${c.id}/tags`, { tagIds: [] })).status).toBe(200);
      expect((await listed(staging.id))[0]).toEqual(sourceBefore);

      const copyBefore = (await listed(production.id))[1];
      expect((await send('PATCH', `/tale-groups/${g.id}`, { name: 'Source' })).status).toBe(200);
      expect((await post(`/tale-groups/${g.id}/tales`, { title: 'Four' })).status).toBe(201);
      const sourceTales = (await listed(staging.id))[0].tales.map((t) => t.id);
      expect((await send('PUT', `/tale-groups/${g.id}/tales/order`, { taleIds: [...sourceTales].reverse() })).status).toBe(200);
      expect((await listed(production.id))[1]).toEqual(copyBefore);
    });

    it("replacing a shared file on the copy keeps it for the source; the last tale's replace deletes it", async () => {
      const { staging, production, g, one } = await setup();
      await publish('tale-groups', g.id);
      await publish('tales', one.id);
      const c: Listed = await (await copy(g.id, production.id)).json();
      const shared = await mediaKey(one.id);

      expect((await upload(c.tales[0].id, 'image/gif', gif)).status).toBe(200);
      expect(storedFiles()).toHaveLength(2);
      expect(storedFiles()).toContain(shared?.slice('tales/'.length));
      const source = await fetch(`${base}/tales/${one.id}/media`);
      expect(source.status).toBe(200);
      expect(Buffer.from(await source.arrayBuffer())).toEqual(png);
      expect((await globalThis.fetch(`${origin}/media/${shared}`)).status).toBe(200);
      expect((await listed(staging.id))[0].tales[0].media?.contentType).toBe('image/png');

      // The source was the last tale on the shared key: its replace deletes the file.
      expect((await upload(one.id, 'image/gif', gif)).status).toBe(200);
      expect(storedFiles()).not.toContain(shared?.slice('tales/'.length));
      expect(storedFiles()).toHaveLength(2);
      expect((await globalThis.fetch(`${origin}/media/${shared}`)).status).toBe(404);
    });

    it('answers 404 for an unknown group or zone and 400 without a zoneId, copying nothing', async () => {
      const { production, g } = await setup();
      for (const id of [unknownId, 'not-a-uuid']) {
        const res = await copy(id, production.id);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: { code: 'tale_group_not_found', message: expect.any(String) } });
      }
      for (const zoneId of [unknownId, 'not-a-uuid']) {
        const res = await copy(g.id, zoneId);
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('zone_not_found');
      }
      for (const zoneId of [undefined, '', 42]) {
        const res = await copy(g.id, zoneId);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      expect((await pool.query('SELECT 1 FROM tale_groups')).rowCount).toBe(2);
    });

    it('refuses with 403 when the caller cannot access the target zone or the source group, copying nothing', async () => {
      const { project, g } = await setup();
      const other = await createProject('Other');
      const otherZone = await zoneIn(other.id, 'Other home');
      const theirs = await (await post(`/zones/${otherZone.id}/tale-groups`, { name: 'Theirs' })).json();
      const myZone = await zoneIn(project.id, 'Mine');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, project.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;

      for (const [groupId, zoneId] of [
        [g.id, otherZone.id],
        [theirs.id, myZone.id],
      ]) {
        const res = await copy(groupId, zoneId);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: { code: 'forbidden', message: expect.any(String) } });
      }
      expect((await pool.query('SELECT 1 FROM tale_groups')).rowCount).toBe(3);
      // Their own project works.
      expect((await copy(g.id, myZone.id)).status).toBe(201);
    });

    it('gives concurrent copies into one zone distinct, dense positions', async () => {
      const { production, g } = await setup();
      const results = await Promise.all([0, 1, 2, 3].map(() => copy(g.id, production.id)));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect((await listed(production.id)).map((x) => x.position)).toEqual([0, 1, 2, 3, 4]);
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
  describe('tale group covers', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const KB = 1024;

    // A PNG chunk: length, type, data and a (not checked) CRC.
    function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    }
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const png = Buffer.concat([pngSignature, chunk('IHDR', Buffer.alloc(13)), chunk('IDAT', Buffer.from([1, 2, 3]))]);
    const apng = Buffer.concat([pngSignature, chunk('IHDR', Buffer.alloc(13)), chunk('acTL', Buffer.alloc(8)), chunk('IDAT')]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    // A GIF with `images` frames, each a 1x1 image with a control extension, as browsers and tools write them.
    function gifOf(images: number): Buffer {
      const header = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0])]);
      const frame = Buffer.from([
        0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // graphic control extension
        0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, // image descriptor, no local colour table
        0x02, 0x02, 0x44, 0x01, 0x00, // LZW code size, one data sub-block, terminator
      ]);
      return Buffer.concat([header, ...Array.from({ length: images }, () => frame), Buffer.from([0x3b])]);
    }
    const stillGif = gifOf(1);
    const animatedGif = gifOf(3);
    const animatedWebp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0x20, 0, 0, 0]),
      Buffer.from('WEBPVP8X'),
      Buffer.from([0x0a, 0, 0, 0, 0x02, 0, 0, 0]),
      Buffer.alloc(16),
    ]);
    function webmOf(size: number): Buffer {
      return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(size - 4, 7)]);
    }

    function putCover(groupId: string, contentType: string, body: Uint8Array): Promise<Response> {
      return fetch(`${base}/tale-groups/${groupId}/cover`, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
    }

    function removeCover(groupId: string): Promise<Response> {
      return fetch(`${base}/tale-groups/${groupId}/cover`, { method: 'DELETE' });
    }

    async function coverKey(groupId: string): Promise<string | null> {
      const { rows } = await pool.query('SELECT cover_key FROM tale_groups WHERE id = $1', [groupId]);
      return rows[0].cover_key;
    }

    function stored(key: string | null): boolean {
      return key !== null && existsSync(join(mediaDir, key));
    }

    async function createGroup(): Promise<{ id: string; zoneId: string; projectId: string }> {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      return { id: group.id, zoneId: zone.id, projectId: zone.projectId };
    }

    // A live group with a live tale, in a zone with a key: what the Delivery API delivers (AD-6).
    async function liveGroup(): Promise<{ id: string; zoneId: string; taleId: string; key: string }> {
      const group = await createGroup();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      await publish('tale-groups', group.id);
      await publish('tales', tale.id);
      const { key } = await (await post(`/zones/${group.zoneId}/key`, {})).json();
      return { id: group.id, zoneId: group.zoneId, taleId: tale.id, key };
    }

    async function deliveredGroups(key: string): Promise<{ id: string; cover: { url: string } | null }[]> {
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(200);
      return (await res.json()).taleGroups;
    }

    function getPublic(url: string): Promise<Response> {
      return globalThis.fetch(`${origin}${new URL(url).pathname}`);
    }

    beforeEach(() => {
      rmSync(join(mediaDir, 'covers'), { recursive: true, force: true });
    });

    it('stores a still cover, keeping only the key on the group', async () => {
      const group = await createGroup();
      const res = await putCover(group.id, 'image/jpeg', jpeg);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(
        expect.objectContaining({
          id: group.id,
          cover: { kind: 'image', contentType: 'image/jpeg', animated: false, url: `/api/v1/tale-groups/${group.id}/cover` },
          tags: [],
        }),
      );
      const key = await coverKey(group.id);
      expect(key).toMatch(/^covers\/[0-9a-f-]{36}\.jpg$/);
      expect(JSON.stringify(body)).not.toContain(key);
      expect(stored(key)).toBe(true);
      // Every zone list carries the cover.
      const [listed] = await (await fetch(`${base}/zones/${group.zoneId}/tale-groups`)).json();
      expect(listed.cover.contentType).toBe('image/jpeg');
    });

    it('decides from the bytes whether a cover moves', async () => {
      const group = await createGroup();
      for (const [type, body, kind, animated] of [
        ['video/webm', webmOf(2 * KB), 'video', true],
        ['image/gif', animatedGif, 'image', true],
        ['image/gif', stillGif, 'image', false],
        ['image/png', apng, 'image', true],
        ['image/png', png, 'image', false],
        ['image/webp', animatedWebp, 'image', true],
      ] as const) {
        const res = await putCover(group.id, type, body);
        expect(res.status).toBe(200);
        expect((await res.json()).cover).toEqual(expect.objectContaining({ kind, contentType: type, animated }));
      }
    });

    it('refuses an animated cover above 300 KB with 413, keeping the previous cover', async () => {
      const group = await createGroup();
      expect((await putCover(group.id, 'image/jpeg', jpeg)).status).toBe(200);
      const before = await coverKey(group.id);
      for (const [type, body] of [
        ['video/webm', webmOf(300 * KB + 1)],
        ['image/gif', Buffer.concat([animatedGif.subarray(0, -1), Buffer.alloc(300 * KB), Buffer.from([0x3b])])],
      ] as const) {
        const res = await putCover(group.id, type, body);
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: { code: 'media_too_large', message: 'An animated cover is at most 300 KB' } });
      }
      expect(await coverKey(group.id)).toBe(before);
      expect(readdirSync(join(mediaDir, 'covers'))).toHaveLength(1);
      // Exactly 300 KB is accepted.
      expect((await putCover(group.id, 'video/webm', webmOf(300 * KB))).status).toBe(200);
    });

    it('accepts a still image cover far above the animated cap', async () => {
      const group = await createGroup();
      const large = Buffer.concat([png, Buffer.alloc(2 * KB * KB)]);
      const res = await putCover(group.id, 'image/png', large);
      expect(res.status).toBe(200);
      expect((await res.json()).cover.animated).toBe(false);
    });

    it('refuses other or mismatched types with 415, an empty body with 400, and unknown groups with 404', async () => {
      const group = await createGroup();
      for (const [type, body] of [
        ['application/pdf', Buffer.from('%PDF-1.7')],
        ['image/png', jpeg],
      ] as const) {
        const res = await putCover(group.id, type, body);
        expect(res.status).toBe(415);
        expect((await res.json()).error.code).toBe('unsupported_media_type');
      }
      const empty = await putCover(group.id, 'image/png', Buffer.alloc(0));
      expect([empty.status, (await empty.json()).error.code]).toEqual([400, 'validation_failed']);
      for (const id of [unknownId, 'nope']) {
        for (const res of [
          await putCover(id, 'image/jpeg', jpeg),
          await fetch(`${base}/tale-groups/${id}/cover`),
          await removeCover(id),
        ]) {
          expect([res.status, (await res.json()).error.code]).toEqual([404, 'tale_group_not_found']);
        }
      }
      expect(await coverKey(group.id)).toBeNull();
    });

    it('refuses every cover route with 403 to a caller without the project', async () => {
      const group = await createGroup();
      expect((await putCover(group.id, 'image/jpeg', jpeg)).status).toBe(200);
      const mine = await createProject('Mine');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, mine.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      for (const res of [
        await putCover(group.id, 'image/png', png),
        await fetch(`${base}/tale-groups/${group.id}/cover`),
        await removeCover(group.id),
      ]) {
        expect([res.status, (await res.json()).error.code]).toEqual([403, 'forbidden']);
      }
      expect(await coverKey(group.id)).toMatch(/\.jpg$/);
    });

    it('serves the cover with its type and ETag, 304 when current, and 404 media_not_found without one', async () => {
      const group = await createGroup();
      const none = await fetch(`${base}/tale-groups/${group.id}/cover`);
      expect([none.status, (await none.json()).error.code]).toEqual([404, 'media_not_found']);
      await putCover(group.id, 'image/jpeg', jpeg);
      const res = await fetch(`${base}/tale-groups/${group.id}/cover`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg);
      const etag = res.headers.get('etag') ?? '';
      expect(etag).toBe(`"${await coverKey(group.id)}"`);
      expect((await fetch(`${base}/tale-groups/${group.id}/cover`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    });

    it('deletes the replaced cover file, and the removed one, and reads no cover after removal', async () => {
      const group = await createGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const first = await coverKey(group.id);
      await putCover(group.id, 'image/png', png);
      const second = await coverKey(group.id);
      expect(second).not.toBe(first);
      expect([stored(first), stored(second)]).toEqual([false, true]);

      const res = await removeCover(group.id);
      expect(res.status).toBe(200);
      expect((await res.json()).cover).toBeNull();
      expect(stored(second)).toBe(false);
      expect(await coverKey(group.id)).toBeNull();
      // Removing again changes nothing.
      expect((await removeCover(group.id)).status).toBe(200);
    });

    it("keeps a cover file a copy shares when the source's cover is replaced or removed", async () => {
      const group = await createGroup();
      await putCover(group.id, 'image/gif', animatedGif);
      const shared = await coverKey(group.id);
      const copy = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: group.zoneId })).json();
      expect(copy.cover).toEqual(expect.objectContaining({ contentType: 'image/gif', animated: true }));
      expect(await coverKey(copy.id)).toBe(shared);

      await putCover(group.id, 'image/jpeg', jpeg);
      expect(stored(shared)).toBe(true);
      const served = await fetch(`${base}/tale-groups/${copy.id}/cover`);
      expect(Buffer.from(await served.arrayBuffer())).toEqual(animatedGif);
      await removeCover(group.id);
      expect(stored(shared)).toBe(true);

      // The last reference goes: the file goes.
      await removeCover(copy.id);
      expect(stored(shared)).toBe(false);
    });

    it('keeps a file a cover references when a tale replaces media with the same key', async () => {
      const group = await createGroup();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      await fetch(`${base}/tales/${tale.id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
      const { rows } = await pool.query('SELECT media_key FROM tales WHERE id = $1', [tale.id]);
      const key: string = rows[0].media_key;
      // A cover pointing at the tale's file, as a shared key would.
      await pool.query("UPDATE tale_groups SET cover_key = $2, cover_content_type = 'image/png' WHERE id = $1", [group.id, key]);
      const replaced = await fetch(`${base}/tales/${tale.id}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: jpeg,
      });
      expect(replaced.status).toBe(200);
      expect(existsSync(join(mediaDir, key))).toBe(true);
    });

    it('delivers the cover as a public URL with its motion, and null without one', async () => {
      const group = await liveGroup();
      expect((await deliveredGroups(group.key))[0].cover).toBeNull();
      await putCover(group.id, 'video/webm', webmOf(4 * KB));
      const [delivered] = await deliveredGroups(group.key);
      expect(delivered.cover).toEqual({
        kind: 'video',
        contentType: 'video/webm',
        animated: true,
        url: expect.stringMatching(/^https:\/\/api\.example\.com\/media\/covers\/[0-9a-f-]{36}\.webm$/),
      });
      const res = await getPublic(delivered.cover?.url ?? '');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/webm');
      expect(res.headers.get('cache-control')).toBe('public, no-cache');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('serves a cover publicly only while its group is delivered', async () => {
      const group = await liveGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const url = (await deliveredGroups(group.key))[0].cover?.url ?? '';
      expect((await getPublic(url)).status).toBe(200);

      // No published tale: the group is not delivered, so neither is its cover.
      await setStatus('tales', group.taleId, 'paused');
      expect((await getPublic(url)).status).toBe(404);
      await publish('tales', group.taleId);
      expect((await getPublic(url)).status).toBe(200);

      // Paused group.
      await setStatus('tale-groups', group.id, 'paused');
      const paused = await getPublic(url);
      expect([paused.status, (await paused.json()).error.code]).toEqual([404, 'media_not_found']);
      await publish('tale-groups', group.id);

      // Expired group.
      const ended = await fetch(`${base}/tale-groups/${group.id}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: null, endsAt: '2020-01-01T00:00:00Z' }),
      });
      expect(ended.status).toBe(200);
      expect((await getPublic(url)).status).toBe(404);
    });

    it('does not serve the cover of a draft group publicly', async () => {
      const group = await createGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const key = (await coverKey(group.id)) ?? '';
      expect((await globalThis.fetch(`${origin}/media/${key}`)).status).toBe(404);
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
        ['PATCH', `/zones/${b.zone.id}/frames/00000000-0000-4000-8000-000000000000`, { settings: {} }],
        ['GET', `/zones/${b.zone.id}/tale-groups`],
        ['POST', `/zones/${b.zone.id}/tale-groups`, { name: 'Mine' }],
        ['PUT', `/zones/${b.zone.id}/tale-groups/order`, { taleGroupIds: [b.group.id] }],
        ['POST', `/tale-groups/${b.group.id}/tales`, { title: 'Mine' }],
        ['PUT', `/tale-groups/${b.group.id}/tales/order`, { taleIds: [b.tale.id] }],
        ['PUT', `/tale-groups/${b.group.id}/tags`, { tagIds: [] }],
        ['PUT', `/zones/${b.zone.id}/tale-groups/${b.group.id}`],
        ['PUT', `/zones/${b.zone.id}/tale-groups/${a.group.id}`],
        ['DELETE', `/zones/${b.zone.id}/tale-groups/${b.group.id}`],
        ['GET', `/projects/${b.project.id}/tale-groups`],
        ['PATCH', `/tale-groups/${b.group.id}`, { name: 'Mine' }],
        ['PUT', `/tale-groups/${b.group.id}/status`, { status: 'live' }],
        ['PUT', `/tales/${b.tale.id}/status`, { status: 'live' }],
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
      expect((await pool.query('SELECT 1 FROM zone_tale_groups')).rowCount).toBe(2);
      expect((await pool.query("SELECT 1 FROM tale_groups WHERE status <> 'draft'")).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM tales WHERE status <> 'draft'")).rowCount).toBe(0);
      // A zone of their own project cannot place a group of a project they cannot see.
      const across = await send('PUT', `/zones/${a.zone.id}/tale-groups/${b.group.id}`);
      expect(across.status).toBe(400);
      expect((await across.json()).error.code).toBe('tale_group_not_found');
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
      const second = await (await send('POST', '/zones', { name: 'Second', projectId: a.project.id })).json();
      expect((await send('PUT', `/zones/${second.id}/tale-groups/${a.group.id}`)).status).toBe(201);
      expect((await send('DELETE', `/zones/${second.id}/tale-groups/${a.group.id}`)).status).toBe(204);
      expect((await send('GET', `/projects/${a.project.id}/tale-groups`)).status).toBe(200);
      expect((await send('PATCH', `/tale-groups/${a.group.id}`, { name: 'Renamed' })).status).toBe(200);
      expect((await send('PUT', `/tale-groups/${a.group.id}/status`, { status: 'live' })).status).toBe(200);
      expect((await send('PUT', `/tales/${a.tale.id}/status`, { status: 'live' })).status).toBe(200);

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
        // Stored as {}, delivered with every default of the bar schema.
        frames: [
          {
            id: frame.id,
            type: 'bar',
            settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
          },
        ],
        taleGroups: [],
      });
    });

    it('delivers a frame settings with the stored values over the defaults', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
      const banner = await (await post(`/zones/${zone.id}/frames`, { type: 'banner' })).json();
      const saved = await globalThis.fetch(`${base}/zones/${zone.id}/frames/${frame.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ settings: { shape: 'rounded-square', showTitles: false, gap: 20 } }),
      });
      expect(saved.status).toBe(200);
      const { key } = await issue(zone.id);

      const { frames } = await (await deliver(key)).json();
      expect(frames).toEqual([
        {
          id: frame.id,
          type: 'bar',
          settings: { shape: 'rounded-square', size: 'medium', showTitles: false, alignment: 'start', gap: 20 },
        },
        { id: banner.id, type: 'banner', settings: {} },
      ]);
    });

    it('delivers only valid settings when a stored row is invalid, filling defaults', async () => {
      const zone = await createZone();
      const bar = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
      const listed = await (await post(`/zones/${zone.id}/frames`, { type: 'bar' })).json();
      const banner = await (await post(`/zones/${zone.id}/frames`, { type: 'banner' })).json();
      // Written by hand, past the API's validation, as an older schema or a manual edit could leave them.
      await pool.query('UPDATE frames SET settings = $2 WHERE id = $1', [
        bar.id,
        JSON.stringify({ gap: 40, shape: 'star', size: 'large', color: 'red' }),
      ]);
      await pool.query('UPDATE frames SET settings = $2 WHERE id = $1', [listed.id, JSON.stringify(['x'])]);
      await pool.query('UPDATE frames SET settings = $2 WHERE id = $1', [banner.id, JSON.stringify({ stray: 1 })]);
      const { key } = await issue(zone.id);

      const res = await deliver(key);
      expect(res.status).toBe(200);
      const defaults = { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 };
      expect((await res.json()).frames).toEqual([
        { id: bar.id, type: 'bar', settings: { ...defaults, size: 'large' } },
        { id: listed.id, type: 'bar', settings: defaults },
        { id: banner.id, type: 'banner', settings: {} },
      ]);
    });

    describe('tale groups and public media', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
      const gif = Buffer.from('GIF89a-tiny-gif');
      const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom-tiny-mp4-with-some-bytes')]);
      const mediaUrl = /^https:\/\/api\.example\.com\/media\/tales\/[0-9a-f-]{36}\.(png|gif|mp4)$/;

      // Groups and tales here are published unless a test sets another status (AD-6).
      async function addGroup(zoneId: string, name: string): Promise<{ id: string }> {
        const group = await (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
        await publish('tale-groups', group.id);
        return group;
      }

      async function addTale(groupId: string, title: string, media?: [string, Buffer]): Promise<{ id: string }> {
        const tale = await (await post(`/tale-groups/${groupId}/tales`, { title })).json();
        await publish('tales', tale.id);
        if (media) {
          const res = await fetch(`${base}/tales/${tale.id}/media`, {
            method: 'PUT',
            headers: { 'Content-Type': media[0] },
            body: media[1],
          });
          expect(res.status).toBe(200);
        }
        return tale;
      }

      // Fetches a public media URL on the test server, with no cookie and no key.
      function getPublic(url: string, headers: Record<string, string> = {}): Promise<Response> {
        return globalThis.fetch(`${origin}${new URL(url).pathname}`, { headers });
      }

      it('serves the tale groups and tales in dashboard order with absolute public media URLs', async () => {
        const zone = await createZone();
        await post(`/zones/${zone.id}/frames`, { type: 'bar', settings: {} });
        const b = await addGroup(zone.id, 'B');
        const a = await addGroup(zone.id, 'A');
        const ordered = await fetch(`${base}/zones/${zone.id}/tale-groups/order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taleGroupIds: [a.id, b.id] }),
        });
        expect(ordered.status).toBe(200);
        const a1 = await addTale(a.id, 'A1', ['image/png', png]);
        const a2 = await addTale(a.id, 'A2');
        const b1 = await addTale(b.id, 'B1', ['video/mp4', mp4]);
        const { key } = await issue(zone.id);

        const res = await deliver(key);
        expect(res.status).toBe(200);
        const text = await res.text();
        const body = JSON.parse(text);
        expect(body.taleGroups).toEqual([
          {
            id: a.id,
            name: 'A',
            cover: null,
            tales: [
              { id: a1.id, title: 'A1', media: { kind: 'image', contentType: 'image/png', url: expect.stringMatching(mediaUrl) } },
              { id: a2.id, title: 'A2', media: null },
            ],
          },
          {
            id: b.id,
            name: 'B',
            cover: null,
            tales: [{ id: b1.id, title: 'B1', media: { kind: 'video', contentType: 'video/mp4', url: expect.stringMatching(mediaUrl) } }],
          },
        ]);
        // No project id or Management API media path in the Delivery response (AD-13).
        expect(text).not.toContain(zone.projectId);
        expect(text).not.toContain('/api/v1');
      });

      it('answers an empty taleGroups list for a zone without tale groups', async () => {
        const zone = await createZone();
        const { key } = await issue(zone.id);
        expect((await (await deliver(key)).json()).taleGroups).toEqual([]);
      });

      it('serves published media publicly: stored type, revalidated cache, CORS, nosniff, no key or session', async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        await addTale(group.id, 'A1', ['image/png', png]);
        const { key } = await issue(zone.id);
        const url = (await (await deliver(key)).json()).taleGroups[0].tales[0].media.url;

        const res = await getPublic(url);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        expect(res.headers.get('cache-control')).toBe('public, no-cache');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('etag')).toBe(`"${new URL(url).pathname.slice('/media/'.length)}"`);
        expect(Buffer.from(await res.arrayBuffer())).toEqual(png);

        // Still public after the zone key is revoked: media never needs the key.
        await send('DELETE', `/zones/${zone.id}/key`);
        expect((await getPublic(url)).status).toBe(200);
      });

      it('serves a byte range with 206 and an unsatisfiable one with 416', async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        await addTale(group.id, 'A1', ['video/mp4', mp4]);
        const { key } = await issue(zone.id);
        const url = (await (await deliver(key)).json()).taleGroups[0].tales[0].media.url;

        const res = await getPublic(url, { Range: 'bytes=0-9' });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe(`bytes 0-9/${mp4.length}`);
        expect(res.headers.get('content-type')).toBe('video/mp4');
        expect(Buffer.from(await res.arrayBuffer())).toEqual(mp4.subarray(0, 10));

        const outside = await getPublic(url, { Range: `bytes=${mp4.length}-` });
        expect(outside.status).toBe(416);
        expect(outside.headers.get('content-range')).toBe(`bytes */${mp4.length}`);
      });

      it('answers 404 media_not_found for an unknown key and for the key of replaced media', async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        const tale = await addTale(group.id, 'A1', ['image/png', png]);
        const { key } = await issue(zone.id);
        const oldUrl = (await (await deliver(key)).json()).taleGroups[0].tales[0].media.url;

        const replaced = await fetch(`${base}/tales/${tale.id}/media`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/gif' },
          body: gif,
        });
        expect(replaced.status).toBe(200);
        const newUrl = (await (await deliver(key)).json()).taleGroups[0].tales[0].media.url;
        expect(newUrl).not.toBe(oldUrl);
        expect((await getPublic(newUrl)).status).toBe(200);

        for (const res of [
          await getPublic(oldUrl),
          await globalThis.fetch(`${origin}/media/tales/${randomUUID()}.png`),
          await globalThis.fetch(`${origin}/media/tales%2F..%2F..%2Fpackage.json`),
          await globalThis.fetch(`${origin}/media/`),
          await globalThis.fetch(`${origin}/media/tales/%E0%A4%A`),
        ]) {
          expect(res.status).toBe(404);
          expect(await res.json()).toEqual({ error: { code: 'media_not_found', message: expect.any(String) } });
        }
      });

      describe('statuses (AD-6)', () => {
        // A tale group as the Management API returns it, with the status fields this story adds.
        interface Group {
          id: string;
          status: string;
          tales: { id: string; title: string; status: string; storedStatus: string }[];
        }

        async function zoneGroups(zoneId: string): Promise<Group[]> {
          const res = await fetch(`${base}/zones/${zoneId}/tale-groups`);
          expect(res.status).toBe(200);
          return res.json();
        }

        async function delivered(key: string): Promise<{ name: string; tales: { title: string; media: { url: string } | null }[] }[]> {
          const res = await deliver(key);
          expect(res.status).toBe(200);
          return (await res.json()).taleGroups;
        }

        async function expectStatus(kind: 'tale-groups' | 'tales', id: string, status: unknown, expected: number, code?: string) {
          const res = await setStatus(kind, id, status);
          expect({ kind, status, code: res.status }).toEqual({ kind, status, code: expected });
          const body = await res.json();
          if (code) expect(body).toEqual({ error: { code, message: expect.any(String) } });
          return body;
        }

        // A zone with a key and a live group "Live" holding live tales L1 (PNG) and L2 (GIF).
        async function liveZone() {
          const zone = await createZone();
          const group = await addGroup(zone.id, 'Live');
          const l1 = await addTale(group.id, 'L1', ['image/png', png]);
          const l2 = await addTale(group.id, 'L2', ['image/gif', gif]);
          const { key } = await issue(zone.id);
          const urls = (await delivered(key))[0].tales.map((t) => t.media?.url ?? '');
          return { zone, group, l1, l2, key, urls };
        }

        it('starts new groups and tales as draft, delivers neither, and delivers them once published', async () => {
          const zone = await createZone();
          const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'New' })).json();
          expect(group.status).toBe('draft');
          const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'T1' })).json();
          expect(tale).toMatchObject({ status: 'draft', storedStatus: 'draft' });
          const { key } = await issue(zone.id);
          expect(await delivered(key)).toEqual([]);

          expect(await expectStatus('tale-groups', group.id, 'live', 200)).toMatchObject({ id: group.id, status: 'live', tags: [] });
          // A live group with no live tale has nothing to play and is left out.
          expect(await delivered(key)).toEqual([]);
          expect(await expectStatus('tales', tale.id, 'live', 200)).toMatchObject({ id: tale.id, status: 'live', storedStatus: 'live' });
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['T1']);
        });

        it('pauses a group: it leaves the Delivery API, its live tales read blocked-by-group; publishing brings it back', async () => {
          const { zone, group, l1, key } = await liveZone();
          const paused: Group = await expectStatus('tale-groups', group.id, 'paused', 200);
          expect(paused.status).toBe('paused');
          expect(paused.tales.map((t) => [t.title, t.status, t.storedStatus])).toEqual([
            ['L1', 'blocked-by-group', 'live'],
            ['L2', 'blocked-by-group', 'live'],
          ]);
          expect((await zoneGroups(zone.id))[0].tales[0]).toMatchObject({ id: l1.id, status: 'blocked-by-group' });
          expect(await delivered(key)).toEqual([]);

          await expectStatus('tale-groups', group.id, 'live', 200);
          expect((await delivered(key)).map((g) => g.name)).toEqual(['Live']);
          expect((await zoneGroups(zone.id))[0].tales[0]).toMatchObject({ status: 'live', storedStatus: 'live' });
        });

        it("pauses a tale: the group's tales start with its next live tale, and the paused tale's media answers 404", async () => {
          const { zone, group, l1, key, urls } = await liveZone();
          await expectStatus('tales', l1.id, 'paused', 200);
          const [live] = await delivered(key);
          expect(live.tales.map((t) => t.title)).toEqual(['L2']);
          expect((await getPublic(urls[0])).status).toBe(404);
          expect((await getPublic(urls[1])).status).toBe(200);
          // A paused tale of a paused group keeps reading paused.
          await expectStatus('tale-groups', group.id, 'paused', 200);
          expect((await zoneGroups(zone.id))[0].tales.map((t) => t.status)).toEqual(['paused', 'blocked-by-group']);
        });

        it('archives and restores: an archived group returns paused; setting the same status again changes nothing', async () => {
          const { group, l1, key } = await liveZone();
          expect((await expectStatus('tale-groups', group.id, 'archived', 200)).status).toBe('archived');
          expect(await delivered(key)).toEqual([]);
          expect((await expectStatus('tale-groups', group.id, 'paused', 200)).status).toBe('paused');
          expect((await expectStatus('tale-groups', group.id, 'paused', 200)).status).toBe('paused');
          expect((await expectStatus('tales', l1.id, 'archived', 200)).status).toBe('archived');
          expect((await expectStatus('tales', l1.id, 'paused', 200)).status).toBe('paused');
          expect((await expectStatus('tales', l1.id, 'live', 200)).status).toBe('blocked-by-group');
          expect((await expectStatus('tales', l1.id, 'live', 200)).storedStatus).toBe('live');
        });

        it('refuses both status routes with 403 forbidden to a caller without the project, changing nothing', async () => {
          const zone = await createZone();
          const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Theirs' })).json();
          const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'T' })).json();
          const mine = await createProject('Mine');
          await signInAsContentManager(mine.id);
          await expectStatus('tale-groups', group.id, 'live', 403, 'forbidden');
          await expectStatus('tales', tale.id, 'live', 403, 'forbidden');
          const { rows } = await pool.query('SELECT status FROM tale_groups UNION ALL SELECT status FROM tales');
          expect(rows).toEqual([{ status: 'draft' }, { status: 'draft' }]);
        });

        it('refuses a change the transitions do not allow with 409, changing nothing', async () => {
          const zone = await createZone();
          const draft = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Draft' })).json();
          const tale = await (await post(`/tale-groups/${draft.id}/tales`, { title: 'T' })).json();
          await expectStatus('tale-groups', draft.id, 'paused', 409, 'invalid_status_transition');
          await expectStatus('tales', tale.id, 'paused', 409, 'invalid_status_transition');
          await expectStatus('tale-groups', draft.id, 'archived', 200);
          await expectStatus('tale-groups', draft.id, 'live', 409, 'invalid_status_transition');
          await expectStatus('tales', tale.id, 'archived', 200);
          await expectStatus('tales', tale.id, 'live', 409, 'invalid_status_transition');
          const [group] = await zoneGroups(zone.id);
          expect([group.status, group.tales[0].storedStatus]).toEqual(['archived', 'archived']);
        });

        it('refuses a status other than live, paused or archived with 400, and an unknown group or tale with 404', async () => {
          const zone = await createZone();
          const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'G' })).json();
          const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'T' })).json();
          for (const status of ['draft', 'expired', 'blocked-by-group', 'LIVE', 1, null, undefined]) {
            await expectStatus('tale-groups', group.id, status, 400, 'validation_failed');
            await expectStatus('tales', tale.id, status, 400, 'validation_failed');
          }
          const noBody = await fetch(`${base}/tale-groups/${group.id}/status`, { method: 'PUT' });
          expect(noBody.status).toBe(400);
          for (const id of [unknownId, 'not-a-uuid']) {
            await expectStatus('tale-groups', id, 'live', 404, 'tale_group_not_found');
            await expectStatus('tales', id, 'live', 404, 'tale_not_found');
          }
          // An unknown id answers 404 before the body is read.
          await expectStatus('tale-groups', unknownId, 'nope', 404, 'tale_group_not_found');
          expect((await zoneGroups(zone.id))[0].status).toBe('draft');
        });

        it('keeps media of unpublished content off the public URL: draft, paused and archived tales, and non-live groups', async () => {
          const { group, l1, urls } = await liveZone();
          const draftTale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'D' })).json();
          const uploaded = await fetch(`${base}/tales/${draftTale.id}/media`, {
            method: 'PUT',
            headers: { 'Content-Type': 'video/mp4' },
            body: mp4,
          });
          expect(uploaded.status).toBe(200);
          const draftKey = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [draftTale.id])).rows[0].media_key;
          const draftUrl = `${origin}/media/${draftKey}`;
          const status = async (url: string) => (await getPublic(url)).status;

          expect([await status(urls[0]), await status(urls[1]), await status(draftUrl)]).toEqual([200, 200, 404]);
          await expectStatus('tale-groups', group.id, 'paused', 200);
          expect([await status(urls[0]), await status(urls[1])]).toEqual([404, 404]);
          await expectStatus('tale-groups', group.id, 'archived', 200);
          expect(await status(urls[0])).toBe(404);
          await expectStatus('tale-groups', group.id, 'paused', 200);
          await expectStatus('tale-groups', group.id, 'live', 200);
          expect(await status(urls[0])).toBe(200);
          await expectStatus('tales', l1.id, 'archived', 200);
          const archived = await getPublic(urls[0]);
          expect(archived.status).toBe(404);
          expect(await archived.json()).toEqual({ error: { code: 'media_not_found', message: expect.any(String) } });
          await expectStatus('tales', l1.id, 'paused', 200);
          await expectStatus('tales', l1.id, 'live', 200);
          expect(await status(urls[0])).toBe(200);
          // The Management API still serves unpublished media to a signed-in user.
          expect((await fetch(`${base}/tales/${draftTale.id}/media`)).status).toBe(200);
        });

        it('answers 304 to a revalidation of published media, and 404 once it is unpublished', async () => {
          const { l1, urls } = await liveZone();
          const etag = (await getPublic(urls[0])).headers.get('etag') ?? '';
          const read = vi.spyOn(LocalDiskStorage.prototype, 'get');
          const again = await getPublic(urls[0], { 'If-None-Match': etag });
          expect(again.status).toBe(304);
          // A current copy is answered without reading the file.
          expect(read).not.toHaveBeenCalled();
          read.mockRestore();
          expect(again.headers.get('cache-control')).toBe('public, no-cache');
          await expectStatus('tales', l1.id, 'paused', 200);
          expect((await getPublic(urls[0], { 'If-None-Match': etag })).status).toBe(404);
        });

        it('copies a group as a draft with its tales keeping their statuses; a shared key is public while a published tale uses it', async () => {
          const { zone, group, l1, l2, urls } = await liveZone();
          await expectStatus('tales', l2.id, 'paused', 200);
          const target = await (await post('/zones', { name: 'Other', projectId: zone.projectId })).json();
          const res = await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id });
          expect(res.status).toBe(201);
          const copy: Group = await res.json();
          expect(copy.status).toBe('draft');
          expect(copy.tales.map((t) => [t.title, t.storedStatus, t.status])).toEqual([
            ['L1', 'live', 'live'],
            ['L2', 'paused', 'paused'],
          ]);

          // L1's file is shared by the source (live) and the copy (a draft group).
          expect((await getPublic(urls[0])).status).toBe(200);
          await expectStatus('tales', l1.id, 'paused', 200);
          expect((await getPublic(urls[0])).status).toBe(404);
          await expectStatus('tale-groups', copy.id, 'live', 200);
          expect((await getPublic(urls[0])).status).toBe(200);
        });
      });

      describe('schedules (AD-6)', () => {
        const minute = 60 * 1000;
        const at = (offset: number) => new Date(Date.now() + offset).toISOString();

        interface Scheduled {
          id: string;
          status: string;
          storedStatus: string;
          startsAt: string | null;
          endsAt: string | null;
          tales: Scheduled[];
        }

        function setSchedule(kind: 'tale-groups' | 'tales', id: string, body: unknown): Promise<Response> {
          return fetch(`${base}/${kind}/${id}/schedule`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        }

        async function schedule(kind: 'tale-groups' | 'tales', id: string, startsAt: string | null, endsAt: string | null) {
          const res = await setSchedule(kind, id, { startsAt, endsAt });
          expect(res.status).toBe(200);
          return (await res.json()) as Scheduled;
        }

        async function delivered(key: string): Promise<{ name: string; tales: { title: string }[] }[]> {
          const res = await deliver(key);
          expect(res.status).toBe(200);
          return (await res.json()).taleGroups;
        }

        async function zoneGroups(zoneId: string): Promise<Scheduled[]> {
          return (await fetch(`${base}/zones/${zoneId}/tale-groups`)).json();
        }

        // A zone with a key and a live group "Live" holding live tales L1 (PNG) and L2 (GIF).
        async function liveZone() {
          const zone = await createZone();
          const group = await addGroup(zone.id, 'Live');
          const l1 = await addTale(group.id, 'L1', ['image/png', png]);
          const l2 = await addTale(group.id, 'L2', ['image/gif', gif]);
          const { key } = await issue(zone.id);
          const urls = (await (await deliver(key)).json()).taleGroups[0].tales.map(
            (t: { media: { url: string } }) => t.media.url,
          );
          return { zone, group, l1, l2, key, urls };
        }

        afterEach(() => {
          vi.useRealTimers();
        });

        it('sets a window in UTC from any offset and clears it', async () => {
          const { zone, group, l1 } = await liveZone();
          const set = await schedule('tale-groups', group.id, '2030-01-01T12:00:00+02:00', '2030-01-02T00:00:00Z');
          expect(set).toMatchObject({
            startsAt: '2030-01-01T10:00:00.000Z',
            endsAt: '2030-01-02T00:00:00.000Z',
            storedStatus: 'live',
            status: 'scheduled',
            tags: [],
          });
          const cleared = await schedule('tale-groups', group.id, null, null);
          expect(cleared).toMatchObject({ startsAt: null, endsAt: null, status: 'live' });
          expect(await schedule('tales', l1.id, null, '2030-01-01T00:00:00.000Z')).toMatchObject({
            startsAt: null,
            endsAt: '2030-01-01T00:00:00.000Z',
            status: 'live',
          });
          const listed = await (await fetch(`${base}/projects/${zone.projectId}/tale-groups`)).json();
          expect(listed[0]).toMatchObject({ status: 'live', storedStatus: 'live', startsAt: null, endsAt: null });
        });

        it("hides a group whose start is ahead, and shows it once the start passes; its media is public only then", async () => {
          const { zone, group, key, urls } = await liveZone();
          await schedule('tale-groups', group.id, at(minute), null);
          expect(await delivered(key)).toEqual([]);
          expect((await getPublic(urls[0])).status).toBe(404);
          expect((await zoneGroups(zone.id))[0]).toMatchObject({ status: 'scheduled', storedStatus: 'live' });

          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(Date.now() + 2 * minute);
          expect((await delivered(key)).map((g) => g.name)).toEqual(['Live']);
          expect((await getPublic(urls[0])).status).toBe(200);
          expect((await zoneGroups(zone.id))[0].status).toBe('live');
        });

        it("skips a tale past its end: the group starts with its next tale, the tale reads expired and its media answers 404", async () => {
          const { zone, l1, key, urls } = await liveZone();
          await schedule('tales', l1.id, null, at(minute));
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L1', 'L2']);

          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(Date.now() + 2 * minute);
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L2']);
          expect((await getPublic(urls[0])).status).toBe(404);
          expect((await getPublic(urls[1])).status).toBe(200);
          expect((await zoneGroups(zone.id))[0].tales.map((t) => [t.status, t.storedStatus])).toEqual([
            ['expired', 'live'],
            ['live', 'live'],
          ]);
        });

        it("hides every tale of an expired group, even tales inside their own window", async () => {
          const { group, l1, key, urls } = await liveZone();
          await schedule('tales', l1.id, at(-minute), at(60 * minute));
          await schedule('tale-groups', group.id, at(-60 * minute), at(-minute));
          expect(await delivered(key)).toEqual([]);
          expect((await getPublic(urls[0])).status).toBe(404);
          expect((await getPublic(urls[1])).status).toBe(404);
          // Reopening the group's window brings it back.
          await schedule('tale-groups', group.id, at(-60 * minute), null);
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L1', 'L2']);
        });

        it('leaves out a group whose only tales are scheduled', async () => {
          const { l1, l2, key } = await liveZone();
          await schedule('tales', l1.id, at(minute), null);
          await schedule('tales', l2.id, at(minute), null);
          expect(await delivered(key)).toEqual([]);
        });

        it('reads paused over scheduled, draft over expired, and blocked-by-group over a tale window', async () => {
          const { zone, group, l1 } = await liveZone();
          await schedule('tale-groups', group.id, at(minute), null);
          expect((await setStatus('tale-groups', group.id, 'paused')).status).toBe(200);
          await schedule('tales', l1.id, null, at(-minute));
          const [paused] = await zoneGroups(zone.id);
          expect([paused.status, paused.tales[0].status]).toEqual(['paused', 'blocked-by-group']);

          const draft = await (await post(`/tale-groups/${group.id}/tales`, { title: 'D' })).json();
          expect((await schedule('tales', draft.id, null, at(-minute))).status).toBe('draft');
        });

        it('refuses an end not later than the start, and bad bounds, with 400, changing nothing', async () => {
          const { group, l1 } = await liveZone();
          await schedule('tale-groups', group.id, '2030-01-01T00:00:00Z', null);
          const bodies: unknown[] = [
            { startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' },
            { startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' },
            { startsAt: '2030-01-01T02:00:00+02:00', endsAt: '2030-01-01T00:00:00Z' },
            { startsAt: null },
            { endsAt: null },
            {},
            { startsAt: '2030-01-01T00:00:00', endsAt: null },
            { startsAt: '2030-01-01', endsAt: null },
            { startsAt: 'tomorrow', endsAt: null },
            { startsAt: 1893456000000, endsAt: null },
            { startsAt: '2030-02-30T00:00:00Z', endsAt: null },
          ];
          for (const body of bodies) {
            for (const [kind, id] of [
              ['tale-groups', group.id],
              ['tales', l1.id],
            ] as const) {
              const res = await setSchedule(kind, id, body);
              expect({ body, kind, status: res.status }).toEqual({ body, kind, status: 400 });
              expect(await res.json()).toEqual({ error: { code: 'validation_failed', message: expect.any(String) } });
            }
          }
          const noBody = await fetch(`${base}/tales/${l1.id}/schedule`, { method: 'PUT' });
          expect(noBody.status).toBe(400);
          const { rows } = await pool.query('SELECT starts_at, ends_at FROM tale_groups WHERE id = $1', [group.id]);
          expect(rows[0]).toEqual({ starts_at: new Date('2030-01-01T00:00:00Z'), ends_at: null });
          // The database holds the same rule.
          await expect(
            pool.query("UPDATE tales SET starts_at = '2030-01-02', ends_at = '2030-01-01' WHERE id = $1", [l1.id]),
          ).rejects.toThrow(/tales_window_check/);
        });

        it('answers 404 for an unknown group or tale before reading the body, and 403 without the project', async () => {
          for (const id of [unknownId, 'not-a-uuid']) {
            const group = await setSchedule('tale-groups', id, { nope: 1 });
            expect([group.status, (await group.json()).error.code]).toEqual([404, 'tale_group_not_found']);
            const tale = await setSchedule('tales', id, { nope: 1 });
            expect([tale.status, (await tale.json()).error.code]).toEqual([404, 'tale_not_found']);
          }
          const { group, l1 } = await liveZone();
          const mine = await createProject('Mine');
          await signInAsContentManager(mine.id);
          for (const [kind, id] of [
            ['tale-groups', group.id],
            ['tales', l1.id],
          ] as const) {
            const res = await setSchedule(kind, id, { startsAt: null, endsAt: '2020-01-01T00:00:00Z' });
            expect([res.status, (await res.json()).error.code]).toEqual([403, 'forbidden']);
          }
          const { rows } = await pool.query('SELECT ends_at FROM tale_groups UNION ALL SELECT ends_at FROM tales');
          expect(rows.every((r) => r.ends_at === null)).toBe(true);
        });

        it('keeps a key copies share public while one copy is in its window, and 404 once neither is', async () => {
          const { zone, group, l1, urls } = await liveZone();
          const target = await (await post('/zones', { name: 'Other', projectId: zone.projectId })).json();
          const copy: Scheduled = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id })).json();
          await publish('tale-groups', copy.id);
          const copiedL1 = copy.tales[0].id;
          // The source tale's window has ended; the copy's tale is open: the shared file stays public.
          await schedule('tales', l1.id, null, at(-minute));
          expect((await getPublic(urls[0])).status).toBe(200);
          // The copy's group starts later: no published tale uses the key now.
          await schedule('tale-groups', copy.id, at(minute), null);
          expect((await getPublic(urls[0])).status).toBe(404);
          // Its tale's own window reopening does not help while the copy's group is scheduled.
          await schedule('tales', copiedL1, null, null);
          expect((await getPublic(urls[0])).status).toBe(404);
        });

        it('answers 404, not 304, to a revalidation of media that is scheduled or expired', async () => {
          const { group, l1, urls } = await liveZone();
          const etag = (await getPublic(urls[0])).headers.get('etag') ?? '';
          expect(etag).toMatch(/^"tales\//);
          expect((await getPublic(urls[0], { 'If-None-Match': etag })).status).toBe(304);

          await schedule('tales', l1.id, null, at(-minute));
          const expired = await getPublic(urls[0], { 'If-None-Match': etag });
          expect(expired.status).toBe(404);
          expect(await expired.json()).toEqual({ error: { code: 'media_not_found', message: expect.any(String) } });

          await schedule('tales', l1.id, null, null);
          await schedule('tale-groups', group.id, at(minute), null);
          expect((await getPublic(urls[0], { 'If-None-Match': etag })).status).toBe(404);
        });

        it('copies the windows of a group and its tales', async () => {
          const { zone, group, l1 } = await liveZone();
          await schedule('tale-groups', group.id, '2030-01-01T00:00:00.000Z', null);
          await schedule('tales', l1.id, null, '2031-01-01T00:00:00.000Z');
          const target = await (await post('/zones', { name: 'Other', projectId: zone.projectId })).json();
          const copy: Scheduled = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id })).json();
          expect([copy.startsAt, copy.endsAt]).toEqual(['2030-01-01T00:00:00.000Z', null]);
          expect(copy.tales.map((t) => [t.startsAt, t.endsAt])).toEqual([
            [null, '2031-01-01T00:00:00.000Z'],
            [null, null],
          ]);
        });
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

  describe('imports from Storyly', () => {
    const tokenKey = randomBytes(32);
    let fake: FakeStoryly;
    let importServer: Server;
    let importBase: string;
    let workers: ImportWorker[] = [];

    async function listenImporter(config: ImporterConfig): Promise<{ server: Server; base: string }> {
      const s = createApp(
        pool,
        loadFrameTypeRegistry(frameTypesDir),
        new LocalDiskStorage(mediaDir),
        { verifier: fakeVerifier },
        { publicApiUrl },
        config,
      ).listen(0);
      await new Promise<void>((resolve) => s.once('listening', () => resolve()));
      return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1` };
    }

    function send(method: string, path: string, body?: unknown, at = importBase): Promise<Response> {
      return fetch(`${at}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    // Runs the worker as main.ts does, polling fast.
    function startWorker(workerId?: string): void {
      workers.push(startImportWorker(pool, { tokenKey, storylyApiUrl: fake.url, pollIntervalMs: 50, workerId }));
    }

    // Reads the job until it is done or failed.
    async function waitForEnd(projectId: string, importId: string): Promise<Record<string, unknown>> {
      const until = Date.now() + 10_000;
      for (;;) {
        const job = await (await send('GET', `/projects/${projectId}/imports/${importId}`)).json();
        if (job.status === 'done' || job.status === 'failed') return job;
        if (Date.now() > until) throw new Error(`Import still ${job.status}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    // Every value in a response, as text: a source id must not be one of them. A
    // substring check would match the same digits inside a UUID.
    function leafValues(body: unknown): string[] {
      if (body === null || typeof body !== 'object') return [String(body)];
      return Object.values(body).flatMap(leafValues);
    }

    async function storedJob(importId: string): Promise<{ token_ciphertext: string | null; source_app_id: string }> {
      const { rows } = await pool.query('SELECT token_ciphertext, source_app_id FROM import_jobs WHERE id = $1', [importId]);
      return rows[0];
    }

    async function projectZones(projectId: string): Promise<{ id: string; name: string; projectId: string }[]> {
      const zones: { id: string; name: string; projectId: string }[] = await (await fetch(`${base}/zones`)).json();
      return zones.filter((z) => z.projectId === projectId);
    }

    async function start(projectId: string): Promise<{ id: string; status: string }> {
      const res = await send('POST', `/projects/${projectId}/imports`, { token: FAKE_STORYLY_TOKEN, appId: '1001' });
      expect(res.status).toBe(202);
      return res.json();
    }

    beforeAll(async () => {
      const { startFakeStoryly } = (await import(pathToFileURL(fakeStorylyModule).href)) as FakeStorylyModule;
      fake = await startFakeStoryly();
      ({ server: importServer, base: importBase } = await listenImporter({
        tokenKey,
        storylyApiUrl: fake.url,
        wake: () => workers.forEach((w) => w.wake()),
      }));
    });

    beforeEach(() => {
      fake.control.reset();
    });

    afterEach(async () => {
      await Promise.all(workers.map((w) => w.stop()));
      workers = [];
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => importServer.close(() => resolve()));
      await fake.close();
    });

    it('lists the apps a token can read, without storing the token', async () => {
      const project = await createProject();
      const res = await send('POST', `/projects/${project.id}/imports/storyly/apps`, { token: FAKE_STORYLY_TOKEN });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ id: '1001', name: 'Demo shop' }]);
      expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(0);
    });

    it('refuses a token Storyly refuses with storyly_token_invalid and creates no job', async () => {
      const project = await createProject();
      const res = await send('POST', `/projects/${project.id}/imports/storyly/apps`, { token: 'wrong-token' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'storyly_token_invalid', message: expect.any(String) } });
      expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(0);
    });

    it('imports the app as zones with links and a report, then deletes the token', async () => {
      const project = await createProject();
      startWorker();
      const started = await start(project.id);
      expect(started).toEqual({ id: expect.any(String), status: 'queued' });

      const job = await waitForEnd(project.id, started.id);
      expect(job).toEqual({
        id: started.id,
        status: 'done',
        sourceAppName: 'Demo shop',
        report: {
          zones: { source: 3, imported: 3, skipped: 0 },
          taleGroups: { source: 6, imported: 6, skipped: 0 },
          tales: { source: 15, imported: 15, skipped: 0 },
          notes: [
            'Zone "Home page": frame type unknown',
            'Zone "Product page": frame type unknown',
            'Zone "Checkout": frame type unknown',
          ],
        },
        progress: {
          zones: { read: 3, written: 3 },
          taleGroups: { read: 6, written: 6 },
          tales: { read: 15, written: 15 },
        },
        error: null,
        createdAt: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
      });
      const zones = await projectZones(project.id);
      expect(zones.map((z) => z.name)).toEqual(['Home page', 'Product page', 'Checkout']);
      for (const zone of zones) expect(await (await fetch(`${base}/zones/${zone.id}/frames`)).json()).toEqual([]);
      const links = await pool.query(
        'SELECT source_system, source_type, source_id, target_type, target_id FROM import_links WHERE project_id = $1 ORDER BY source_id',
        [project.id],
      );
      expect(links.rows.filter((l) => l.source_type === 'instance')).toEqual(
        ['2001', '2002', '2003'].map((sourceId, i) => ({
          source_system: 'storyly',
          source_type: 'instance',
          source_id: sourceId,
          target_type: 'zone',
          target_id: zones[i].id,
        })),
      );
      expect((await storedJob(started.id)).token_ciphertext).toBeNull();
      // Source ids live only in import_links (AD-7), never on the zones.
      expect(leafValues(zones)).not.toContain('2001');
    });

    it('creates no duplicate zones when the same app is imported again', async () => {
      const project = await createProject();
      startWorker();
      await waitForEnd(project.id, (await start(project.id)).id);
      const again = await waitForEnd(project.id, (await start(project.id)).id);
      expect(again['status']).toBe('done');
      expect((again['report'] as { zones: unknown }).zones).toEqual({ source: 3, imported: 3, skipped: 0 });
      expect(await projectZones(project.id)).toHaveLength(3);
      expect((await pool.query('SELECT 1 FROM import_links WHERE project_id = $1', [project.id])).rowCount).toBe(24);
    });

    // How many tale groups, placements, tales and import links the project holds.
    async function contentCounts(projectId: string): Promise<Record<string, number>> {
      const count = async (table: string) =>
        Number((await pool.query(`SELECT count(*) FROM ${table} WHERE project_id = $1`, [projectId])).rows[0].count);
      return {
        groups: await count('tale_groups'),
        placements: await count('zone_tale_groups'),
        tales: await count('tales'),
        links: await count('import_links'),
      };
    }

    // Each zone of the project, as its page lists it: group names, each with its tale titles.
    async function zonePages(projectId: string): Promise<Record<string, { name: string; tales: string[] }[]>> {
      const pages: Record<string, { name: string; tales: string[] }[]> = {};
      for (const zone of await projectZones(projectId)) {
        const groups: { name: string; position: number; tales: { title: string; position: number }[] }[] = await (
          await fetch(`${base}/zones/${zone.id}/tale-groups`)
        ).json();
        pages[zone.name] = groups.map((g) => ({ name: g.name, tales: g.tales.map((t) => t.title) }));
      }
      return pages;
    }

    const demoShopPages = {
      'Home page': [
        { name: 'New arrivals', tales: ['This week', 'Back in stock', 'Staff picks'] },
        { name: 'Gift ideas', tales: ['For him', 'For her'] },
        { name: 'Summer sale', tales: ['Beach picks', 'Up to 50% off', 'Last call'] },
      ],
      'Product page': [
        { name: 'Reviews', tales: ['Customer photos', 'Sizing tips', 'Top rated'] },
        { name: 'How to wear it', tales: ['Day look', 'Night look'] },
      ],
      Checkout: [{ name: 'Free shipping', tales: ['Express', 'Over 50'] }],
    };

    it("imports each instance's story groups as tale groups of its zone and their stories as tales, in source order", async () => {
      const project = await createProject();
      startWorker();
      const job = await waitForEnd(project.id, (await start(project.id)).id);
      expect(job['status']).toBe('done');
      expect(await zonePages(project.id)).toEqual(demoShopPages);
      // Each group belongs to the project with one placement, in its instance's zone (AD-14).
      const placements = await pool.query(
        `SELECT p.position, l.source_id FROM zone_tale_groups p
         JOIN import_links l ON l.target_id = p.tale_group_id AND l.source_type = 'story_group'
         JOIN import_links z ON z.target_id = p.zone_id AND z.source_type = 'instance'
         WHERE p.project_id = $1 AND z.source_id = '2001' ORDER BY p.position`,
        [project.id],
      );
      expect(placements.rows).toEqual([
        { position: 0, source_id: '3002' },
        { position: 1, source_id: '3003' },
        { position: 2, source_id: '3001' },
      ]);
      const links = await pool.query(
        'SELECT source_type, target_type, count(*)::int AS n FROM import_links WHERE project_id = $1 GROUP BY 1, 2 ORDER BY 1',
        [project.id],
      );
      expect(links.rows).toEqual([
        { source_type: 'instance', target_type: 'zone', n: 3 },
        { source_type: 'story', target_type: 'tale', n: 15 },
        { source_type: 'story_group', target_type: 'tale_group', n: 6 },
      ]);
      // Tales are created without media (a later story); source ids live only in import_links.
      const tales = await pool.query('SELECT media_key FROM tales WHERE project_id = $1', [project.id]);
      expect(tales.rows.every((t) => t.media_key === null)).toBe(true);
      const home = (await projectZones(project.id)).find((z) => z.name === 'Home page');
      const values = leafValues(await (await fetch(`${base}/zones/${home?.id}/tale-groups`)).json());
      for (const sourceId of ['3001', '3002', '3003', '4001', '4005', '4008']) expect(values).not.toContain(sourceId);
    });

    it('creates no tale group, placement, tale or link twice when the app is imported again', async () => {
      const project = await createProject();
      startWorker();
      await waitForEnd(project.id, (await start(project.id)).id);
      const before = await contentCounts(project.id);
      expect(before).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
      const again = await waitForEnd(project.id, (await start(project.id)).id);
      expect(again['report']).toMatchObject({
        taleGroups: { source: 6, imported: 6, skipped: 0 },
        tales: { source: 15, imported: 15, skipped: 0 },
      });
      expect(await contentCounts(project.id)).toEqual(before);
      expect(await zonePages(project.id)).toEqual(demoShopPages);
    });

    it('adds a story new at the source after the tales already imported', async () => {
      const project = await createProject();
      startWorker();
      await waitForEnd(project.id, (await start(project.id)).id);
      // Story group 3002 is "New arrivals" on the Home page.
      fake.control.data.stories['3002'].data.push({ id: 4999, story_group_id: 3002, title: 'Just in', sort_order: -1 });
      const again = await waitForEnd(project.id, (await start(project.id)).id);
      expect((again['report'] as { tales: unknown }).tales).toEqual({ source: 16, imported: 16, skipped: 0 });
      expect((await zonePages(project.id))['Home page'][0]).toEqual({
        name: 'New arrivals',
        tales: ['This week', 'Back in stock', 'Staff picks', 'Just in'],
      });
      expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 16, links: 25 });
    });

    for (const [list, mode, message] of [
      ['failStoryGroups', 'status', /answered 500 when listing story groups/],
      ['failStories', 'shape', /stories response has an unexpected shape/],
    ] as const) {
      it(`fails the job when the ${list === 'failStories' ? 'story' : 'story group'} list fails`, async () => {
        const project = await createProject();
        fake.control[list] = mode;
        startWorker();
        const started = await start(project.id);
        const job = await waitForEnd(project.id, started.id);
        expect(job['status']).toBe('failed');
        expect(job['error']).toMatch(message);
        expect(job['error']).not.toContain(FAKE_STORYLY_TOKEN);
        expect((await storedJob(started.id)).token_ciphertext).toBeNull();
      });
    }

    // Runs one import of Demo shop into the project to its end.
    async function importOnce(projectId: string): Promise<Record<string, unknown>> {
      return waitForEnd(projectId, (await start(projectId)).id);
    }

    // The fixture record with this id, in a list the fake serves.
    function fixture(list: { data: Record<string, unknown>[] }, id: number): Record<string, unknown> {
      const record = list.data.find((r) => r['id'] === id);
      if (!record) throw new Error(`No fixture ${id}`);
      return record;
    }

    it('places a story group without a usable sort_order after the others, noting it only when created', async () => {
      const project = await createProject();
      // 3002 is "New arrivals", first on the Home page.
      fixture(fake.control.data.storyGroups['2001'], 3002)['sort_order'] = null;
      startWorker();
      const first = await importOnce(project.id);
      const note = 'Tale group "New arrivals": no source position, placed after the others';
      expect(first['report']).toMatchObject({ taleGroups: { source: 6, imported: 6, skipped: 0 } });
      expect((first['report'] as { notes: string[] }).notes).toContain(note);
      expect((await zonePages(project.id))['Home page'].map((g) => g.name)).toEqual([
        'Gift ideas',
        'Summer sale',
        'New arrivals',
      ]);
      const again = await importOnce(project.id);
      expect((again['report'] as { notes: string[] }).notes).not.toContain(note);
    });

    it('names a blank story group "Untitled tale group" and a blank story after its group', async () => {
      const project = await createProject();
      fixture(fake.control.data.storyGroups['2003'], 3006)['title'] = '  ';
      fixture(fake.control.data.stories['3006'], 4014)['title'] = '';
      startWorker();
      expect((await importOnce(project.id))['status']).toBe('done');
      expect((await zonePages(project.id))['Checkout']).toEqual([
        { name: 'Untitled tale group', tales: ['Express', 'Untitled tale group'] },
      ]);
    });

    it('imports a repeated story group or story id once and counts the repeat as skipped', async () => {
      const project = await createProject();
      const checkoutGroup = fixture(fake.control.data.storyGroups['2003'], 3006);
      fake.control.data.storyGroups['2002'].data.push({ ...checkoutGroup, instance_id: 2002, sort_order: 9 });
      fake.control.data.stories['3006'].data.push({ ...fixture(fake.control.data.stories['3006'], 4015) });
      startWorker();
      const job = await importOnce(project.id);
      expect(job['report']).toMatchObject({
        taleGroups: { source: 7, imported: 6, skipped: 1 },
        tales: { source: 16, imported: 15, skipped: 1 },
      });
      expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
      // The group is first listed under the Product page, so it is placed there only.
      const pages = await zonePages(project.id);
      expect(pages['Product page']).toEqual([...demoShopPages['Product page'], ...demoShopPages['Checkout']]);
      expect(pages['Checkout']).toEqual([]);
    });

    it('skips with a note the stories a full tale group cannot take', async () => {
      const project = await createProject();
      fake.control.data.stories['3006'].data = Array.from({ length: 101 }, (_, i) => ({
        id: 5000 + i,
        story_group_id: 3006,
        title: `Story ${i}`,
        sort_order: i,
      }));
      startWorker();
      const job = await importOnce(project.id);
      expect(job['report']).toMatchObject({ tales: { source: 114, imported: 113, skipped: 1 } });
      expect((job['report'] as { notes: string[] }).notes).toContain(
        'Tale "Story 100" in "Free shipping": the tale group already holds 100 tales',
      );
      expect((await zonePages(project.id))['Checkout'][0].tales).toHaveLength(100);
    });

    it("skips an instance's story groups and stories when its zone is not imported", async () => {
      const project = await createProject();
      // Checkout (2003) was imported before, and that zone is gone.
      await pool.query(
        `INSERT INTO import_links (project_id, source_system, source_type, source_id, target_type, target_id)
         VALUES ($1, 'storyly', 'instance', '2003', 'zone', gen_random_uuid())`,
        [project.id],
      );
      startWorker();
      const job = await importOnce(project.id);
      expect(job['report']).toMatchObject({
        zones: { source: 3, imported: 2, skipped: 1 },
        taleGroups: { source: 6, imported: 5, skipped: 1 },
        tales: { source: 15, imported: 13, skipped: 2 },
      });
      expect((job['report'] as { notes: string[] }).notes).toContain(
        'Zone "Checkout": its 1 tale group(s) were not imported, since the zone was not',
      );
      expect(await contentCounts(project.id)).toEqual({ groups: 5, placements: 5, tales: 13, links: 21 });
    });

    it('skips with a note a tale group or tale whose earlier import was deleted, keeping its link', async () => {
      const project = await createProject();
      startWorker();
      await importOnce(project.id);
      const target = async (type: string, id: string) =>
        (
          await pool.query(
            'SELECT target_id FROM import_links WHERE project_id = $1 AND source_type = $2 AND source_id = $3',
            [project.id, type, id],
          )
        ).rows[0].target_id as string;
      const groupId = await target('story_group', '3006');
      const taleId = await target('story', '4001');
      await pool.query('DELETE FROM tales WHERE id = $1 OR tale_group_id = $2', [taleId, groupId]);
      await pool.query('DELETE FROM zone_tale_groups WHERE tale_group_id = $1', [groupId]);
      await pool.query('DELETE FROM tale_groups WHERE id = $1', [groupId]);

      const job = await importOnce(project.id);
      expect(job['report']).toMatchObject({
        taleGroups: { source: 6, imported: 5, skipped: 1 },
        tales: { source: 15, imported: 12, skipped: 3 },
      });
      expect((job['report'] as { notes: string[] }).notes).toEqual(
        expect.arrayContaining([
          'Tale group "Free shipping": its earlier import was deleted, so it was not imported again',
          'Tale "Up to 50% off" in "Summer sale": its earlier import was deleted, so it was not imported again',
        ]),
      );
      expect(await contentCounts(project.id)).toEqual({ groups: 5, placements: 5, tales: 12, links: 24 });
      expect(await target('story_group', '3006')).toBe(groupId);
    });

    it('rolls back a tale group another import linked first, and imports its tales into that one', async () => {
      const project = await createProject();
      const otherZone: { id: string } = await (
        await post('/zones', { name: 'Elsewhere', projectId: project.id })
      ).json();
      const linkKey = `${project.id}:storyly:story_group:3002`;
      // This test plays the other import: it holds the link lock of story group 3002 ("New arrivals").
      const other = await pool.connect();
      try {
        await other.query('BEGIN');
        await other.query("SELECT pg_advisory_xact_lock(hashtextextended('import_links:' || $1, 0))", [linkKey]);
        startWorker();
        const started = await start(project.id);
        // Wait until the worker has created its group and waits on the lock to link it.
        const until = Date.now() + 10_000;
        while (
          (await pool.query("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted")).rowCount === 0
        ) {
          if (Date.now() > until) throw new Error('The worker never waited on the link lock');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const winner: { id: string } = await (
          await send('POST', `/zones/${otherZone.id}/tale-groups`, { name: 'New arrivals' })
        ).json();
        await other.query(
          `INSERT INTO import_links (project_id, source_system, source_type, source_id, target_type, target_id)
           VALUES ($1, 'storyly', 'story_group', '3002', 'tale_group', $2)`,
          [project.id, winner.id],
        );
        await other.query('COMMIT');

        const job = await waitForEnd(project.id, started.id);
        expect(job['report']).toMatchObject({
          taleGroups: { source: 6, imported: 6, skipped: 0 },
          tales: { source: 15, imported: 15, skipped: 0 },
        });
        // The worker's own group rolled back: no duplicate group, placement or tale.
        expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
        const pages = await zonePages(project.id);
        expect(pages['Home page'].map((g) => g.name)).toEqual(['Gift ideas', 'Summer sale']);
        expect(pages['Elsewhere']).toEqual([demoShopPages['Home page'][0]]);
      } finally {
        await other.query('ROLLBACK').catch(() => undefined);
        other.release();
      }
    });

    it('stores the token only encrypted while the job waits', async () => {
      const project = await createProject();
      const started = await start(project.id);
      const stored = await storedJob(started.id);
      expect(stored.token_ciphertext).toEqual(expect.any(String));
      expect(stored.token_ciphertext).not.toContain(FAKE_STORYLY_TOKEN);
      const job = await (await send('GET', `/projects/${project.id}/imports/${started.id}`)).json();
      expect(job.status).toBe('queued');
      expect(JSON.stringify(job)).not.toContain('token');
    });

    for (const [mode, message] of [
      ['status', /answered 500/],
      ['shape', /unexpected shape/],
    ] as const) {
      it(`fails the job when the source ${mode === 'status' ? 'answers 500' : 'answers an unexpected shape'}`, async () => {
        const project = await createProject();
        fake.control.failInstances = mode;
        startWorker();
        const started = await start(project.id);
        const job = await waitForEnd(project.id, started.id);
        expect(job['status']).toBe('failed');
        expect(job['error']).toMatch(message);
        expect(job['error']).not.toContain(FAKE_STORYLY_TOKEN);
        expect(job['report']).toBeNull();
        expect((await storedJob(started.id)).token_ciphertext).toBeNull();
        expect(await projectZones(project.id)).toEqual([]);
      });
    }

    // A job another worker claimed: `heartbeat` is an SQL time expression.
    async function runningJob(projectId: string, lockedBy: string, heartbeat: string, attempts = 1): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO import_jobs (project_id, source_app_id, status, token_ciphertext, started_at, locked_by, heartbeat_at, attempts)
         VALUES ($1, '1001', 'running', $2, now(), $3, ${heartbeat}, $4) RETURNING id`,
        [projectId, encryptToken(FAKE_STORYLY_TOKEN, tokenKey), lockedBy, attempts],
      );
      return rows[0].id;
    }

    async function jobRow(importId: string) {
      const { rows } = await pool.query(
        'SELECT status, locked_by, token_ciphertext, report, error FROM import_jobs WHERE id = $1',
        [importId],
      );
      return rows[0];
    }

    it('leaves a job whose runner is alive alone', async () => {
      const project = await createProject();
      const id = await runningJob(project.id, 'live-worker', 'now()');
      startWorker();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const row = await jobRow(id);
      expect(row).toMatchObject({ status: 'running', locked_by: 'live-worker', report: null });
      expect(row.token_ciphertext).toEqual(expect.any(String));
      expect(await projectZones(project.id)).toEqual([]);
    });

    it('re-queues a job whose heartbeat stopped and finishes it', async () => {
      const project = await createProject();
      const id = await runningJob(project.id, 'gone-worker', "now() - interval '10 minutes'");
      startWorker();
      expect((await waitForEnd(project.id, id))['status']).toBe('done');
      expect(await projectZones(project.id)).toHaveLength(3);
    });

    it('fails a job whose runner stopped too many times, deleting its token', async () => {
      const project = await createProject();
      const id = await runningJob(project.id, 'gone-worker', "now() - interval '10 minutes'", 3);
      startWorker();
      const job = await waitForEnd(project.id, id);
      expect(job['status']).toBe('failed');
      expect(job['error']).toMatch(/too many times/);
      expect((await jobRow(id)).token_ciphertext).toBeNull();
      expect(await projectZones(project.id)).toEqual([]);
    });

    it("does not let a stale runner overwrite a job another worker took over", async () => {
      const project = await createProject();
      const id = await runningJob(project.id, 'new-worker', 'now()');
      await runImportJob(
        pool,
        { id, projectId: project.id, sourceAppId: '1001', tokenCiphertext: encryptToken(FAKE_STORYLY_TOKEN, tokenKey), lockedBy: 'stale-worker' },
        { tokenKey, storylyApiUrl: fake.url },
      );
      const row = await jobRow(id);
      expect(row).toMatchObject({ status: 'running', locked_by: 'new-worker', report: null, error: null });
      expect(row.token_ciphertext).toEqual(expect.any(String));
      expect(await projectZones(project.id)).toEqual([]);
    });

    it('creates each zone once when two workers import the same app at the same time', async () => {
      const project = await createProject();
      const first = await start(project.id);
      const second = await start(project.id);
      startWorker('worker-a');
      startWorker('worker-b');
      for (const id of [first.id, second.id]) expect((await waitForEnd(project.id, id))['status']).toBe('done');
      expect(await projectZones(project.id)).toHaveLength(3);
      expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
    });

    it('re-queues a job left running by a stopped process and finishes it', async () => {
      const project = await createProject();
      const { rows } = await pool.query(
        `INSERT INTO import_jobs (project_id, source_app_id, status, token_ciphertext, started_at)
         VALUES ($1, '1001', 'running', $2, now()) RETURNING id`,
        [project.id, encryptToken(FAKE_STORYLY_TOKEN, tokenKey)],
      );
      startWorker();
      const job = await waitForEnd(project.id, rows[0].id);
      expect(job['status']).toBe('done');
      expect(await projectZones(project.id)).toHaveLength(3);
      expect((await storedJob(rows[0].id)).token_ciphertext).toBeNull();
    });

    it('refuses every import route to a content manager with forbidden', async () => {
      const project = await createProject();
      const started = await start(project.id);
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, project.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      for (const [method, path, body] of [
        ['POST', `/projects/${project.id}/imports/storyly/apps`, { token: FAKE_STORYLY_TOKEN }],
        ['POST', `/projects/${project.id}/imports`, { token: FAKE_STORYLY_TOKEN, appId: '1001' }],
        ['GET', `/projects/${project.id}/imports/${started.id}`, undefined],
        ['GET', `/projects/${project.id}/imports`, undefined],
      ] as const) {
        const res = await send(method, path, body);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      }
      expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(1);
    });

    it('answers importer_not_configured without IMPORT_TOKEN_KEY, while the rest of the API works', async () => {
      const project = await createProject();
      for (const [method, path, body] of [
        ['POST', `/projects/${project.id}/imports/storyly/apps`, { token: FAKE_STORYLY_TOKEN }],
        ['POST', `/projects/${project.id}/imports`, { token: FAKE_STORYLY_TOKEN, appId: '1001' }],
        ['GET', `/projects/${project.id}/imports/${randomUUID()}`, undefined],
        ['GET', `/projects/${project.id}/imports`, undefined],
      ] as const) {
        const res = await send(method, path, body, base);
        expect(res.status).toBe(503);
        expect((await res.json()).error.code).toBe('importer_not_configured');
      }
      expect((await fetch(`${base}/health`)).status).toBe(200);
    });

    it('validates the body and answers 404 for an unknown project or import', async () => {
      const project = await createProject();
      const missing = await send('POST', `/projects/${project.id}/imports`, { appId: '1001' });
      expect(missing.status).toBe(400);
      expect((await missing.json()).error.code).toBe('validation_failed');
      const unknownProject = await send('POST', `/projects/${randomUUID()}/imports/storyly/apps`, { token: 'x' });
      expect(unknownProject.status).toBe(404);
      expect((await unknownProject.json()).error.code).toBe('project_not_found');
      const unknownImport = await send('GET', `/projects/${project.id}/imports/${randomUUID()}`);
      expect(unknownImport.status).toBe(404);
      expect((await unknownImport.json()).error.code).toBe('not_found');
    });

    it("does not show one project's import in another project", async () => {
      const project = await createProject();
      const other = await createProject('Beta');
      const started = await start(project.id);
      expect((await send('GET', `/projects/${other.id}/imports/${started.id}`)).status).toBe(404);
    });

    // Progress as the API answers it, read/written per entity.
    const progress = (z: [number, number], g: [number, number], t: [number, number]) => ({
      zones: { read: z[0], written: z[1] },
      taleGroups: { read: g[0], written: g[1] },
      tales: { read: t[0], written: t[1] },
    });

    it('answers a queued job with no start time and no progress', async () => {
      const project = await createProject();
      const started = await start(project.id);
      const job = await (await send('GET', `/projects/${project.id}/imports/${started.id}`)).json();
      expect(job).toMatchObject({ status: 'queued', startedAt: null, progress: null, finishedAt: null });
    });

    it('shows progress rising while a slow import runs, read never behind written, up to the final counts', async () => {
      const project = await createProject();
      fake.control.delayMs = 30;
      startWorker();
      const started = await start(project.id);
      const seen: { status: string; startedAt: string | null; progress: ReturnType<typeof progress> | null }[] = [];
      const until = Date.now() + 15_000;
      for (;;) {
        const job = await (await send('GET', `/projects/${project.id}/imports/${started.id}`)).json();
        seen.push(job);
        if (job.status === 'done' || job.status === 'failed') break;
        if (Date.now() > until) throw new Error(`Import still ${job.status}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const final = seen[seen.length - 1];
      expect(final.status).toBe('done');
      expect(final.startedAt).toEqual(expect.any(String));
      expect(final.progress).toEqual(progress([3, 3], [6, 6], [15, 15]));

      const running = seen.filter((j) => j.status === 'running' && j.progress !== null);
      // Several distinct steps were seen on the way, not only the end.
      const steps = new Set(running.map((j) => JSON.stringify(j.progress)));
      expect(steps.size).toBeGreaterThanOrEqual(3);
      expect(running.some((j) => (j.progress?.tales.written ?? 0) < 15)).toBe(true);
      let last = -1;
      for (const job of running) {
        const p = job.progress as ReturnType<typeof progress>;
        for (const entity of [p.zones, p.taleGroups, p.tales]) expect(entity.read).toBeGreaterThanOrEqual(entity.written);
        const written = p.zones.written + p.taleGroups.written + p.tales.written;
        expect(written).toBeGreaterThanOrEqual(last);
        last = written;
        expect(job.startedAt).toEqual(expect.any(String));
      }
    });

    it('keeps the progress of a failed run with its reason, and lists it as failed', async () => {
      const project = await createProject();
      fake.control.failStories = 'status';
      startWorker();
      const started = await start(project.id);
      const job = await waitForEnd(project.id, started.id);
      expect(job['status']).toBe('failed');
      expect(job['error']).toMatch(/answered 500 when listing stories/);
      // The first zone was written before the stories of its first group failed.
      expect(job['progress']).toEqual(progress([3, 1], [3, 0], [0, 0]));
      expect((await storedJob(started.id)).token_ciphertext).toBeNull();

      const list = await (await send('GET', `/projects/${project.id}/imports`)).json();
      expect(list).toEqual([
        {
          id: started.id,
          status: 'failed',
          sourceAppName: 'Demo shop',
          error: job['error'],
          createdAt: expect.any(String),
          startedAt: expect.any(String),
          finishedAt: expect.any(String),
        },
      ]);
    });

    it("lists the project's imports newest first, without reports or tokens, and none of another project's", async () => {
      const project = await createProject();
      const other = await createProject('Beta');
      expect(await (await send('GET', `/projects/${project.id}/imports`)).json()).toEqual([]);

      startWorker();
      const first = await waitForEnd(project.id, (await start(project.id)).id);
      fake.control.failInstances = 'status';
      const second = await waitForEnd(project.id, (await start(project.id)).id);
      const queued = await start(other.id);
      await waitForEnd(other.id, queued.id);

      const res = await send('GET', `/projects/${project.id}/imports`);
      expect(res.status).toBe(200);
      const body = await res.text();
      const list = JSON.parse(body);
      expect(list.map((j: { id: string; status: string }) => [j.id, j.status])).toEqual([
        [second['id'], 'failed'],
        [first['id'], 'done'],
      ]);
      expect(list[0].error).toMatch(/answered 500 when listing instances/);
      expect(list[1]).toEqual({
        id: first['id'],
        status: 'done',
        sourceAppName: 'Demo shop',
        error: null,
        createdAt: first['createdAt'],
        startedAt: first['startedAt'],
        finishedAt: first['finishedAt'],
      });
      expect(body).not.toContain(FAKE_STORYLY_TOKEN);
      expect(body).not.toContain('report');
      expect(body).not.toContain('v1.');

      const others = await (await send('GET', `/projects/${other.id}/imports`)).json();
      expect(others.map((j: { id: string }) => j.id)).toEqual([queued.id]);
    });

    it('lists at most the newest 50 imports', async () => {
      const project = await createProject();
      await pool.query(
        `INSERT INTO import_jobs (project_id, source_app_id, status, created_at)
         SELECT $1, '1001', 'done', now() - n * interval '1 minute' FROM generate_series(1, 52) AS n`,
        [project.id],
      );
      const list = await (await send('GET', `/projects/${project.id}/imports`)).json();
      expect(list).toHaveLength(50);
      const times = list.map((j: { createdAt: string }) => Date.parse(j.createdAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('clears the progress of a recovered job, which then counts again from the start', async () => {
      const project = await createProject();
      const stale = progress([3, 2], [5, 4], [11, 9]);
      const { rows } = await pool.query(
        `INSERT INTO import_jobs (project_id, source_app_id, status, token_ciphertext, started_at, attempts, progress)
         VALUES ($1, '1001', 'running', $2, now(), 1, $3) RETURNING id`,
        [project.id, encryptToken(FAKE_STORYLY_TOKEN, tokenKey), JSON.stringify(stale)],
      );
      const id = rows[0].id as string;
      expect(await recoverStaleJobs(pool, 0, 3)).toEqual({ requeued: 1, failed: 0 });
      const recovered = await (await send('GET', `/projects/${project.id}/imports/${id}`)).json();
      expect(recovered).toMatchObject({ status: 'queued', startedAt: null, progress: null });

      fake.control.delayMs = 30;
      startWorker();
      const seen: { status: string; progress: ReturnType<typeof progress> | null }[] = [];
      const until = Date.now() + 15_000;
      for (;;) {
        const job = await (await send('GET', `/projects/${project.id}/imports/${id}`)).json();
        seen.push(job);
        if (job.status === 'done' || job.status === 'failed') break;
        if (Date.now() > until) throw new Error(`Import still ${job.status}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(seen[seen.length - 1]).toMatchObject({ status: 'done', progress: progress([3, 3], [6, 6], [15, 15]) });
      const running = seen.filter((j) => j.status === 'running' && j.progress !== null);
      // It counted again from the start, below the stale values.
      expect(running.some((j) => (j.progress?.tales.written ?? 0) < stale.tales.written)).toBe(true);
    });

    it('answers the list of an unknown project with project_not_found', async () => {
      const res = await send('GET', `/projects/${randomUUID()}/imports`);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('project_not_found');
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
      await pool.query('TRUNCATE import_links, import_jobs, zone_keys, invitations, project_members, auth_challenges, sessions, passkeys, users');
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

      const { rows } = await pool.query('SELECT token_hash, EXTRACT(EPOCH FROM expires_at - created_at)::int AS ttl FROM sessions');
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(rows)).not.toContain(token);
      // In seconds: an interval would read 6 days 23 hours across a daylight saving change.
      expect(rows[0].ttl).toBe(7 * 24 * 60 * 60);

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
