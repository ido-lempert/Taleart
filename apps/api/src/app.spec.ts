import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
  importTaleMedia,
  IMPORTED_MEDIA_PREFIX,
  MEDIA_SWEEP_MIN_AGE_MS,
  sweepImportedMedia,
  claimNextJob,
  recoverStaleJobs,
  runImportJob,
  signSelectionKey,
  startImportWorker,
  type ImportWorker,
} from '@taleart/server-importer';
import { DEFAULT_THEME, VISIBILITY_REASON_CODES, type ImportReport } from '@taleart/contract';
import { LocalDiskStorage } from '@taleart/server-storage';
import {
  clearDeliveryCache,
  clearPublicFontCache,
  deliveredGroup,
  deliveredPlacement,
  deliveredTale,
  groupReasonsSql,
  isMediaKeyInUse,
  taleReasonsSql,
  zoneDelivers,
  zoneReasonsSql,
  continueTaleMediaMigration,
  copyZonePlacements,
  migrateTaleMediaDocuments,
  sweepUnusedProjectMediaFiles,
} from '@taleart/server-tales';
import { ensureTags } from '@taleart/server-targeting';
import {
  createZoneFromTemplate,
  foldStagesIntoZones,
  InvalidFrameSettingsError,
  loadFrameTypeRegistry,
  type FrameTypeRegistry,
} from '@taleart/server-zones';
import type { Pool, PoolClient } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { createApp, type ImporterConfig, type ProjectMediaOptions } from './app';
import { createPool, databasePoolMax, migrate } from './db';

// Runs against a separate test database. It clears tables, so it must never
// point at the development database.
const testDatabaseUrl =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
// Parsed as pg parses it, so `?db=` and socket forms are judged by the database they reach.
const parsedTestDatabase = parseConnectionString(testDatabaseUrl);
if (
  !parsedTestDatabase.database?.endsWith('_test') ||
  (parsedTestDatabase['db'] !== undefined && !String(parsedTestDatabase['db']).endsWith('_test'))
) {
  throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
}

// The shipped registry, read from the contract as the built API reads its copy.
const frameTypesDir = join(__dirname, '../../../libs/contract/frame-types');

// The fake Storyly server (apps/fake-storyly), started in-process on a free
// port. Loaded by path at run time: it is a plain Node module of another app.
const fakeStorylyModule = join(__dirname, '../../fake-storyly/src/fake-storyly.mjs');
// The media files the fake serves for the fixtures' stories.
const fixturesMediaDir = join(__dirname, '../../fake-storyly/src/fixtures/media');
const FAKE_STORYLY_TOKEN = 'fake-storyly-token';
interface FakeStoryly {
  url: string;
  mediaUrl: string;
  port: number;
  control: {
    requests: { method: string; path: string }[];
    failInstances: 'status' | 'shape' | null;
    failStoryGroups: 'status' | 'shape' | null;
    failStories: 'status' | 'shape' | null;
    failSegments: 'status' | 'shape' | null;
    delayMs: number;
    useScale(options: Record<string, unknown>): { appId: string; tales: number };
    hold: { matches(url: URL): boolean; until: Promise<void> } | null;
    stats: { mediaRequests: number; injected: Record<string, number>; maxMediaOpen: number };
    data: {
      instances: Record<string, { data: Record<string, unknown>[] }>;
      storyGroups: Record<string, { data: Record<string, unknown>[] }>;
      stories: Record<string, { data: Record<string, unknown>[] }>;
      segments: Record<string, { data: unknown[] }>;
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

// What the Delivery API sends for a tale with neither media nor a document (Tale Studio R16).
const NO_MEDIA_DOCUMENT = {
  version: 1,
  canvas: { background: { type: 'color', color: '#1f2937' } },
  durationMs: 5000,
  placeholder: true,
  elements: [],
};

// A delivered document of only the tale's media (R16): its `taleMedia` element, full canvas, 5 s.
function mediaDocument(kind: 'image' | 'video', url: unknown, id: unknown = expect.any(String)) {
  return {
    version: 1,
    canvas: { background: { type: 'color', color: '#000000' } },
    durationMs: 5000,
    elements: [
      {
        id,
        type: kind,
        box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        a11y: { decorative: true },
        props: { url, fit: 'contain', taleMedia: true },
      },
    ],
  };
}

// A visibility reason and a visibility (epic UX rework R7), as the Management API returns them.
function why(code: string, subject: 'zone' | 'group' | 'tale', at?: string) {
  return at === undefined ? { code, subject } : { code, subject, at };
}
function notVisible(...reasons: ReturnType<typeof why>[]) {
  return { visible: false, reasons };
}
const VISIBLE = { visible: true, reasons: [] };
// Any visibility, where a test is about something else.
const SOME_VISIBILITY = expect.objectContaining({ visible: expect.any(Boolean), reasons: expect.any(Array) });
// A new zone: no display, no key, nothing placed (R7).
const NEW_ZONE_VISIBILITY = notVisible(why('zone-no-display', 'zone'), why('zone-not-installed', 'zone'), why('no-tale-groups', 'zone'));

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
    // The Delivery API's rate limit is off here; its own test turns it on.
    const s = createApp(
      p,
      frameTypes,
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier },
      { publicApiUrl },
      undefined,
      undefined,
      { rateLimit: null },
    ).listen(0);
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

  // Gives the zone a display (a bar frame) when it has none: a zone without a display delivers no
  // tale group (epic UX rework R7), so a key alone would deliver nothing.
  async function withDisplay(zoneId: string): Promise<void> {
    const res = await post(`/zones/${zoneId}/frame`, { type: 'bar', settings: {} });
    // 409: the zone already has its display (AD-17).
    expect([201, 409]).toContain(res.status);
  }

  // Installs the zone as a host page needs it: a display, then a key (R7).
  async function postKey(zoneId: string): Promise<Response> {
    await withDisplay(zoneId);
    return post(`/zones/${zoneId}/key`, {});
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

  // Makes tales with neither media nor a document tales from before the UX rework, which keep the
  // legacy placeholder on the site (hasPublishedDocument); a tale created since is delivered only
  // once it has a published document (AD-6 amended, AD-15). For tests about something else that
  // deliver tales without media.
  async function asLegacy(...taleIds: string[]): Promise<void> {
    await pool.query(`UPDATE tales SET created_at = '2020-01-01T00:00:00Z' WHERE id = ANY($1::uuid[])`, [taleIds]);
  }

  async function createProject(name = 'Acme'): Promise<{ id: string; name: string }> {
    return (await post('/projects', { name })).json();
  }

  async function createZone(): Promise<{
    id: string;
    name: string;
    slug: string;
    projectId: string;
    createdFromTemplate: string | null;
    frame: { id: string; type: string; settings: unknown } | null;
  }> {
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
      'TRUNCATE import_records, import_media, import_links, import_jobs, site_keys, zone_keys, tale_group_tags, tags, tale_fonts, project_fonts, tale_media, project_media, tales, zone_tale_groups, tale_groups, frames, project_themes, zones, invitations, project_members, projects, auth_challenges, sessions, passkeys, users',
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
    expect(zone).toEqual({
      id: expect.any(String),
      name: 'Home page bar',
      slug: 'home-page-bar',
      projectId: project.id,
      createdFromTemplate: null,
      firstVisibleAt: null,
      frame: null,
      visibility: NEW_ZONE_VISIBILITY,
    });

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
      {
        id: expect.any(String),
        name: 'Home page bar',
        slug: 'home-page-bar',
        projectId: project.id,
        createdFromTemplate: null,
        firstVisibleAt: null,
        frame: null,
        visibility: NEW_ZONE_VISIBILITY,
      },
    ]);
  });

  describe('zone slugs (epic UX rework R1)', () => {
    const unknownZoneId = '00000000-0000-4000-8000-000000000000';

    function patchZone(zoneId: string, body: unknown): Promise<Response> {
      return fetch(`${base}/zones/${zoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('makes a slug from the name, unique in the project with a numeric suffix', async () => {
      const project = await createProject();
      const slugs: string[] = [];
      for (const name of ['Home page', 'Home  Page!', 'Héro bänner', '***', 'דף הבית']) {
        const res = await post('/zones', { name, projectId: project.id });
        expect(res.status).toBe(201);
        slugs.push((await res.json()).slug);
      }
      // A Hebrew name has no Latin letter or digit: its slug is `zone`, made unique like any other.
      expect(slugs).toEqual(['home-page', 'home-page-2', 'hero-banner', 'zone', 'zone-2']);
      // Another project may use the same slug.
      const other = await createProject('Other');
      expect((await (await post('/zones', { name: 'Home page', projectId: other.id })).json()).slug).toBe('home-page');
    });

    it('takes a given slug, and refuses one another zone of the project has', async () => {
      const project = await createProject();
      const created = await post('/zones', { name: 'Top', projectId: project.id, slug: 'home-top' });
      expect(created.status).toBe(201);
      expect((await created.json()).slug).toBe('home-top');
      const taken = await post('/zones', { name: 'Other', projectId: project.id, slug: 'home-top' });
      expect(taken.status).toBe(409);
      expect(await taken.json()).toEqual({ error: { code: 'slug_taken', message: expect.stringContaining('home-top') } });
      expect(await (await fetch(`${base}/zones`)).json()).toHaveLength(1);
    });

    it.each([['Home Top'], ['HOME'], ['home top'], ['home_top'], ['-home'], ['home--top'], [''], ['a'.repeat(65)], [7]])(
      'refuses the slug %j with validation_failed',
      async (slug) => {
        const project = await createProject();
        const res = await post('/zones', { name: 'Top', projectId: project.id, slug });
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
        const zone = await createZone();
        const changed = await patchZone(zone.id, { slug });
        expect(changed.status).toBe(400);
        expect((await changed.json()).error.code).toBe('validation_failed');
      },
    );

    it('renames a zone and changes its slug; a taken slug is refused', async () => {
      const project = await createProject();
      const zone = await (await post('/zones', { name: 'Home', projectId: project.id })).json();
      await post('/zones', { name: 'Shop', projectId: project.id });
      const res = await patchZone(zone.id, { name: ' Landing ', slug: 'landing-top' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ...zone, name: 'Landing', slug: 'landing-top' });
      const taken = await patchZone(zone.id, { slug: 'shop' });
      expect(taken.status).toBe(409);
      expect((await taken.json()).error.code).toBe('slug_taken');
      for (const body of [{}, { name: '  ' }]) {
        const bad = await patchZone(zone.id, body);
        expect(bad.status).toBe(400);
        expect((await bad.json()).error.code).toBe('validation_failed');
      }
      const unknown = await patchZone(unknownZoneId, { name: 'X' });
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).error.code).toBe('zone_not_found');
    });
  });

  describe('display (one frame per zone, AD-17)', () => {
    const unknownZoneId = '00000000-0000-4000-8000-000000000000';
    const barDefaults = { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 };
    const bannerDefaults = { aspectRatio: '16:9', autoplay: true, intervalSeconds: 5, showDots: true, loop: true };

    function patch(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    async function zoneListed(zoneId: string): Promise<{ frame: unknown }> {
      const zones: { id: string; frame: unknown }[] = await (await fetch(`${base}/zones`)).json();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) throw new Error('zone not listed');
      return zone;
    }

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
      const banner = types.find((t: { key: string }) => t.key === 'banner');
      expect(banner.schema.additionalProperties).toBe(false);
      expect(banner.schema.properties).toEqual({
        aspectRatio: expect.objectContaining({ title: 'Aspect ratio', enum: ['16:9', '3:1', '1:1'], default: '16:9' }),
        autoplay: expect.objectContaining({ title: 'Autoplay', type: 'boolean', default: true }),
        intervalSeconds: expect.objectContaining({ title: 'Interval', type: 'integer', minimum: 3, maximum: 15, default: 5 }),
        showDots: expect.objectContaining({ title: 'Show dots', type: 'boolean', default: true }),
        loop: expect.objectContaining({ title: 'Loop', type: 'boolean', default: true }),
      });
    });

    it("gives a zone its display with the type's defaults, copying the zone project, and lists it on the zone", async () => {
      const zone = await createZone();
      expect(zone.frame).toBeNull();
      const res = await post(`/zones/${zone.id}/frame`, { type: 'bar' });
      expect(res.status).toBe(201);
      const frame = await res.json();
      expect(frame).toEqual({ id: expect.any(String), zoneId: zone.id, projectId: zone.projectId, type: 'bar', settings: barDefaults });
      expect((await zoneListed(zone.id)).frame).toEqual(frame);
      const { rows } = await pool.query('SELECT project_id FROM frames');
      expect(rows).toEqual([{ project_id: zone.projectId }]);
    });

    it('refuses a second display, also when two arrive at once', async () => {
      const zone = await createZone();
      const first = await (await post(`/zones/${zone.id}/frame`, { type: 'bar' })).json();
      const second = await post(`/zones/${zone.id}/frame`, { type: 'banner' });
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: { code: 'display_exists', message: expect.any(String) } });
      expect((await zoneListed(zone.id)).frame).toEqual(first);

      const racing = await createZone();
      const results = await Promise.all([
        post(`/zones/${racing.id}/frame`, { type: 'bar' }),
        post(`/zones/${racing.id}/frame`, { type: 'banner' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const { rows } = await pool.query('SELECT 1 FROM frames WHERE zone_id = $1', [racing.id]);
      expect(rows).toHaveLength(1);
      // The database holds one display per zone too.
      await expect(
        pool.query("INSERT INTO frames (zone_id, project_id, type) VALUES ($1, $2, 'bar')", [zone.id, zone.projectId]),
      ).rejects.toThrow(/frames_zone_id_key/);
    });

    it('switches bar to banner and back, resetting the settings to each type\'s defaults and keeping the id', async () => {
      const zone = await createZone();
      const bar = await (await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: { gap: 20, shape: 'rounded-square' } })).json();
      expect(bar.settings).toEqual({ gap: 20, shape: 'rounded-square' });
      const banner = await patch(`/zones/${zone.id}/frame`, { type: 'banner' });
      expect(banner.status).toBe(200);
      expect(await banner.json()).toEqual({ ...bar, type: 'banner', settings: bannerDefaults });
      const back = await (await patch(`/zones/${zone.id}/frame`, { type: 'bar' })).json();
      expect(back).toEqual({ ...bar, settings: barDefaults });
      // The same type again changes nothing; a type with settings takes them.
      expect(await (await patch(`/zones/${zone.id}/frame`, { type: 'bar' })).json()).toEqual(back);
      const withSettings = await (await patch(`/zones/${zone.id}/frame`, { type: 'banner', settings: { loop: false } })).json();
      expect(withSettings).toEqual({ ...bar, type: 'banner', settings: { loop: false } });
      expect((await zoneListed(zone.id)).frame).toEqual(withSettings);
    });

    it('replaces the settings, validated against the type, and stores nothing invalid', async () => {
      const zone = await createZone();
      await post(`/zones/${zone.id}/frame`, { type: 'bar' });
      const edited = { shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 };
      const saved = await patch(`/zones/${zone.id}/frame`, { settings: edited });
      expect(saved.status).toBe(200);
      expect((await saved.json()).settings).toEqual(edited);
      const cases: [unknown, string][] = [
        [{ gap: 40 }, 'settings.gap must be at most 24'],
        [{ shape: 'star' }, 'settings.shape must be one of: circle, rounded-square'],
        [{ color: 'red' }, 'settings has unknown property "color"'],
      ];
      for (const [settings, message] of cases) {
        const res = await patch(`/zones/${zone.id}/frame`, { settings: { ...edited, ...(settings as object) } });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: 'invalid_frame_settings', message } });
      }
      // Banner settings on a bar, and an unknown type, are refused too.
      expect((await (await patch(`/zones/${zone.id}/frame`, { settings: { loop: false } })).json()).error.code).toBe(
        'invalid_frame_settings',
      );
      const unknownType = await patch(`/zones/${zone.id}/frame`, { type: 'carousel' });
      expect(unknownType.status).toBe(400);
      expect((await unknownType.json()).error.code).toBe('unknown_frame_type');
      expect(((await zoneListed(zone.id)).frame as { settings: unknown }).settings).toEqual(edited);
      for (const body of [{}, { type: '' }, { type: 3 }]) {
        const res = await patch(`/zones/${zone.id}/frame`, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
    });

    it('refuses an unknown type, invalid settings or no type when setting a display, creating nothing', async () => {
      const zone = await createZone();
      const cases: [unknown, string][] = [
        [{ type: 'carousel' }, 'unknown_frame_type'],
        [{ type: 'bar', settings: { color: 'red' } }, 'invalid_frame_settings'],
        [{ type: 'bar', settings: ['x'] }, 'invalid_frame_settings'],
        [{ settings: {} }, 'validation_failed'],
      ];
      for (const [body, code] of cases) {
        const res = await post(`/zones/${zone.id}/frame`, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe(code);
      }
      expect((await zoneListed(zone.id)).frame).toBeNull();
    });

    it('answers 404 for an unknown zone, and display_not_found for a zone without one', async () => {
      for (const res of [
        await post(`/zones/${unknownZoneId}/frame`, { type: 'bar' }),
        await patch(`/zones/${unknownZoneId}/frame`, { type: 'bar' }),
        await post('/zones/not-a-uuid/frame', { type: 'bar' }),
      ]) {
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('zone_not_found');
      }
      const zone = await createZone();
      const res = await patch(`/zones/${zone.id}/frame`, { type: 'bar' });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('display_not_found');
    });

    it('has no frames or stages endpoint any more', async () => {
      const zone = await createZone();
      for (const [method, path] of [
        ['GET', `/zones/${zone.id}/frames`],
        ['POST', `/zones/${zone.id}/frames`],
        ['GET', `/zones/${zone.id}/stages`],
        ['POST', `/zones/${zone.id}/stages`],
      ]) {
        const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
        expect({ path, status: res.status }).toEqual({ path, status: 404 });
        expect((await res.json()).error.code).toBe('not_found');
      }
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
        const missing = await post(`/zones/${zone.id}/frame`, { type: 'test-strip', settings: {} });
        expect(missing.status).toBe(400);
        const body = await missing.json();
        expect(body.error.code).toBe('invalid_frame_settings');
        expect(body.error.message).toContain('height');

        const saved = await post(`/zones/${zone.id}/frame`, { type: 'test-strip', settings: { height: 40 } });
        expect(saved.status).toBe(201);
        expect((await saved.json()).settings).toEqual({ height: 40 });
      } finally {
        rmSync(dir, { recursive: true, force: true });
        await restart();
      }
    });

    it('keeps the display after the API restarts', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frame`, { type: 'bar' })).json();
      await restart();
      expect((await zoneListed(zone.id)).frame).toEqual(frame);
    });
  });

  describe('stages and frames fold into zones (epic UX rework R2)', () => {
    // Puts the schema back as it was before the rework: no slug required, several frames per zone,
    // and the stages table as the zones module created it (epic web zones R7).
    async function legacySchema(): Promise<void> {
      await pool.query('ALTER TABLE zones ALTER COLUMN slug DROP NOT NULL');
      await pool.query('DROP INDEX frames_zone_id_key');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS frames_id_zone_id_key ON frames (id, zone_id)');
      await pool.query(`
        CREATE TABLE stages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          zone_id uuid NOT NULL,
          project_id uuid NOT NULL REFERENCES projects(id),
          frame_id uuid NOT NULL,
          name text NOT NULL,
          key text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id),
          FOREIGN KEY (frame_id, zone_id) REFERENCES frames (id, zone_id) ON DELETE CASCADE,
          CONSTRAINT stages_zone_id_key_key UNIQUE (zone_id, key)
        )`);
    }

    async function legacyFrame(zone: { id: string; projectId: string }, type: string, settings: object = {}): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO frames (zone_id, project_id, type, settings) VALUES ($1, $2, $3, $4) RETURNING id',
        [zone.id, zone.projectId, type, JSON.stringify(settings)],
      );
      return rows[0].id;
    }

    async function legacyStage(zone: { id: string; projectId: string }, name: string, key: string, frameId: string): Promise<void> {
      await pool.query('INSERT INTO stages (zone_id, project_id, frame_id, name, key) VALUES ($1, $2, $3, $4, $5)', [
        zone.id,
        zone.projectId,
        frameId,
        name,
        key,
      ]);
    }

    async function snapshot(): Promise<unknown> {
      const [zones, frames, placements, keys] = await Promise.all([
        pool.query('SELECT id, project_id, name, slug, playbook_key, created_at FROM zones ORDER BY id'),
        pool.query('SELECT id, zone_id, project_id, type, settings, created_at FROM frames ORDER BY id'),
        pool.query('SELECT zone_id, tale_group_id, position FROM zone_tale_groups ORDER BY zone_id, tale_group_id'),
        pool.query('SELECT id, zone_id, revoked_at FROM zone_keys ORDER BY id'),
      ]);
      return { zones: zones.rows, frames: frames.rows, placements: placements.rows, keys: keys.rows };
    }

    async function groupIds(zoneId: string): Promise<string[]> {
      const groups: { id: string }[] = await (await fetch(`${base}/zones/${zoneId}/tale-groups`)).json();
      return groups.map((g) => g.id);
    }

    // A live group with one live tale, delivered as a tale from before the rework.
    async function liveGroup(zoneId: string, name: string): Promise<string> {
      const group = await (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: `${name} 1` })).json();
      await publish('tale-groups', group.id);
      await asLegacy(tale.id);
      return group.id;
    }

    it('turns a zone of two stages and an unstaged frame, and a zone of two frames, into five zones of one display', async () => {
      const project = await createProject();
      const zoneOf = async (name: string) => (await post('/zones', { name, projectId: project.id })).json();
      const home = await zoneOf('Home');
      const shop = await zoneOf('Shop');
      const empty = await zoneOf('Empty');
      await pool.query("UPDATE zones SET playbook_key = 'home-stories-bar' WHERE id = $1", [home.id]);
      const homeGroups = [await liveGroup(home.id, 'G1'), await liveGroup(home.id, 'G2')];
      const shopGroups = [await liveGroup(shop.id, 'G3')];
      // The original zone's key stays its own (owner decision 2026-10-22: no legacy resolution).
      const top = await (await post(`/zones/${home.id}/frame`, { type: 'bar', settings: { gap: 20 } })).json();
      const { key: homeKey } = await (await postKey(home.id)).json();

      try {
        await legacySchema();
        await pool.query('UPDATE zones SET slug = NULL WHERE project_id = $1', [project.id]);
        const promo = await legacyFrame(home, 'banner', { loop: false });
        const unstaged = await legacyFrame(home, 'bar');
        await legacyStage(home, 'Top bar', 'top-bar', top.id);
        await legacyStage(home, 'Promo', 'promo', promo);
        const shopBar = await legacyFrame(shop, 'bar');
        const shopBanner = await legacyFrame(shop, 'banner');

        await migrate(pool);

        const zones: { id: string; name: string; slug: string; createdFromTemplate: string | null; frame: { id: string; type: string } | null }[] =
          await (await fetch(`${base}/zones`)).json();
        expect(zones.map((z) => [z.name, z.slug, z.frame?.id ?? null, z.frame?.type ?? null])).toEqual([
          ['Top bar', 'top-bar', top.id, 'bar'],
          ['Promo', 'promo', promo, 'banner'],
          ['Home – Bar 2', 'top-bar-bar-2', unstaged, 'bar'],
          ['Shop', 'shop', shopBar, 'bar'],
          ['Shop – Banner 1', 'shop-banner-1', shopBanner, 'banner'],
          ['Empty', 'empty', null, null],
        ]);
        // The original zones keep their ids; the new ones keep the template note, renamed from the playbook key (R5).
        expect([zones[0].id, zones[3].id, zones[5].id]).toEqual([home.id, shop.id, empty.id]);
        expect(zones.slice(0, 3).map((z) => z.createdFromTemplate)).toEqual(['stories-bar', 'stories-bar', 'stories-bar']);
        // Every zone of a staged or framed zone lists the same tale groups in the same order (AD-14).
        for (const zone of zones.slice(0, 3)) expect(await groupIds(zone.id)).toEqual(homeGroups);
        for (const zone of zones.slice(3, 5)) expect(await groupIds(zone.id)).toEqual(shopGroups);
        expect(await groupIds(empty.id)).toEqual([]);
        // The settings moved with each frame.
        expect((zones[1].frame as unknown as { settings: unknown }).settings).toEqual({ loop: false });
        expect((await pool.query("SELECT to_regclass('stages') AS t")).rows[0].t).toBeNull();

        // The Delivery API serves each zone with its own display and its groups.
        const deliver = async (key: string) =>
          (await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } })).json();
        const homeBody = await deliver(homeKey);
        expect([homeBody.id, homeBody.slug, homeBody.frame.id, homeBody.frame.settings.gap]).toEqual([home.id, 'top-bar', top.id, 20]);
        expect(homeBody.taleGroups.map((g: { id: string }) => g.id)).toEqual(homeGroups);
        for (const zone of zones.slice(1, 5)) {
          // New zones get no key until one is issued (owner decision 2026-10-22).
          expect(await (await fetch(`${base}/zones/${zone.id}/key`)).json()).toBeNull();
          const { key } = await (await post(`/zones/${zone.id}/key`, {})).json();
          const body = await deliver(key);
          expect([body.id, body.name, body.slug, body.frame.id, body.frame.type]).toEqual([
            zone.id,
            zone.name,
            zone.slug,
            zone.frame?.id,
            zone.frame?.type,
          ]);
          expect(body.taleGroups.map((g: { id: string }) => g.id)).toEqual(zone.name.startsWith('Shop') ? shopGroups : homeGroups);
        }
        // A later change to one zone's list changes only that zone (AD-14).
        await fetch(`${base}/zones/${zones[1].id}/tale-groups/${homeGroups[0]}`, { method: 'DELETE' });
        expect(await groupIds(zones[1].id)).toEqual([homeGroups[1]]);
        expect(await groupIds(home.id)).toEqual(homeGroups);

        // A second run changes nothing.
        const before = await snapshot();
        await migrate(pool);
        expect(await snapshot()).toEqual(before);
      } finally {
        await migrate(pool);
      }
    });

    it('copies a frame two stages show, and makes clashing slugs unique, oldest zone first', async () => {
      const project = await createProject();
      const landing = await (await post('/zones', { name: 'Landing', projectId: project.id })).json();
      const home = await (await post('/zones', { name: 'Home', projectId: project.id })).json();
      try {
        await legacySchema();
        await pool.query('UPDATE zones SET slug = NULL WHERE project_id = $1', [project.id]);
        const bar = await legacyFrame(landing, 'bar', { gap: 8 });
        await legacyStage(landing, 'Main', 'home', bar);
        await legacyStage(landing, 'Footer', 'footer', bar);

        await migrate(pool);

        const zones: { id: string; name: string; slug: string; frame: { id: string; settings: unknown } | null }[] = await (
          await fetch(`${base}/zones`)
        ).json();
        expect(zones.map((z) => [z.name, z.slug])).toEqual([
          ['Main', 'home'],
          ['Footer', 'footer'],
          ['Home', 'home-2'],
        ]);
        expect(zones[0].frame?.id).toBe(bar);
        expect(zones[1].frame?.id).not.toBe(bar);
        expect(zones[1].frame?.settings).toEqual({ gap: 8 });
        expect(zones[2].id).toBe(home.id);
      } finally {
        await migrate(pool);
      }
    });
  });

  describe('stages and frames fold into zones: edge cases', () => {
    // As in the describe above: the schema as it was before the rework.
    async function legacySchema(...projectIds: string[]): Promise<void> {
      await pool.query('ALTER TABLE zones ALTER COLUMN slug DROP NOT NULL');
      await pool.query('DROP INDEX frames_zone_id_key');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS frames_id_zone_id_key ON frames (id, zone_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS frames_zone_id_idx ON frames (zone_id, created_at)');
      await pool.query(`
        CREATE TABLE stages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          zone_id uuid NOT NULL,
          project_id uuid NOT NULL REFERENCES projects(id),
          frame_id uuid NOT NULL,
          name text NOT NULL,
          key text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          FOREIGN KEY (zone_id, project_id) REFERENCES zones (id, project_id),
          FOREIGN KEY (frame_id, zone_id) REFERENCES frames (id, zone_id) ON DELETE CASCADE,
          CONSTRAINT stages_zone_id_key_key UNIQUE (zone_id, key)
        )`);
      await pool.query('UPDATE zones SET slug = NULL WHERE project_id = ANY($1::uuid[])', [projectIds]);
    }

    async function frameOf(zone: { id: string; projectId: string }, type: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        'INSERT INTO frames (zone_id, project_id, type) VALUES ($1, $2, $3) RETURNING id',
        [zone.id, zone.projectId, type],
      );
      return rows[0].id;
    }

    async function stageOf(zone: { id: string; projectId: string }, name: string, key: string, frameId: string): Promise<void> {
      await pool.query('INSERT INTO stages (zone_id, project_id, frame_id, name, key) VALUES ($1, $2, $3, $4, $5)', [
        zone.id,
        zone.projectId,
        frameId,
        name,
        key,
      ]);
    }

    async function zonesListed(): Promise<{ id: string; name: string; slug: string; projectId: string; frame: { id: string } | null }[]> {
      return (await fetch(`${base}/zones`)).json();
    }

    it('slugs Hebrew names from the original zone, falls back for a stage key that is not a slug, and keeps a lone stage zone', async () => {
      const project = await createProject();
      const zoneOf = async (name: string) => (await post('/zones', { name, projectId: project.id })).json();
      const home = await zoneOf('דף הבית');
      const shop = await zoneOf('חנות');
      const lone = await zoneOf('Lone');
      try {
        await legacySchema(project.id);
        await frameOf(home, 'bar');
        await frameOf(home, 'banner');
        const top = await frameOf(shop, 'bar');
        const hero = await frameOf(shop, 'banner');
        await stageOf(shop, 'למעלה', 'Bad Key', top);
        await stageOf(shop, 'גיבור', 'also bad', hero);
        await stageOf(lone, 'Only stage', 'only-stage', await frameOf(lone, 'bar'));

        await migrate(pool);

        const zones = await zonesListed();
        expect(zones.map((z) => [z.name, z.slug])).toEqual([
          ['דף הבית', 'zone'],
          ['דף הבית – Banner 1', 'zone-banner-1'],
          // Stage keys that are not slugs: the names give none either, so `zone` and the original's slug.
          ['למעלה', 'zone-2'],
          ['גיבור', 'zone-2-banner'],
          ['Only stage', 'only-stage'],
        ]);
        expect(zones[4].id).toBe(lone.id);
        expect(zones.every((z) => z.frame !== null)).toBe(true);
      } finally {
        await migrate(pool);
      }
    });

    it('gives two projects the same stage key as their slug, and reserves stage keys before names', async () => {
      const a = await createProject('A');
      const b = await createProject('B');
      // In A, an older zone named "Home top" would take `home-top` from its name; the stage key wins.
      const named = await (await post('/zones', { name: 'Home top', projectId: a.id })).json();
      const staged = await (await post('/zones', { name: 'Home', projectId: a.id })).json();
      const other = await (await post('/zones', { name: 'Home', projectId: b.id })).json();
      try {
        await legacySchema(a.id, b.id);
        await stageOf(staged, 'Top', 'home-top', await frameOf(staged, 'bar'));
        await stageOf(other, 'Top', 'home-top', await frameOf(other, 'bar'));

        await migrate(pool);

        const slugOf = new Map((await zonesListed()).map((z) => [z.id, z.slug]));
        expect([slugOf.get(named.id), slugOf.get(staged.id), slugOf.get(other.id)]).toEqual(['home-top-2', 'home-top', 'home-top']);
      } finally {
        await migrate(pool);
      }
    });

    it('reports a stage key another zone of the project had, with the slug its zone got instead', async () => {
      const project = await createProject();
      const first = await (await post('/zones', { name: 'Home', projectId: project.id })).json();
      const second = await (await post('/zones', { name: 'Shop', projectId: project.id })).json();
      try {
        await legacySchema(project.id);
        await stageOf(first, 'Top', 'top', await frameOf(first, 'bar'));
        await stageOf(second, 'Top', 'top', await frameOf(second, 'bar'));
        await stageOf(second, 'Hero', 'top-2', await frameOf(second, 'banner'));

        const logged: Record<string, unknown>[] = [];
        const client = await pool.connect();
        let report;
        try {
          report = await foldStagesIntoZones(client, {
            copyPlacements: copyZonePlacements,
            log: (_msg, fields) => logged.push(fields),
          });
        } finally {
          client.release();
        }
        const hero = (await zonesListed()).find((z) => z.name === 'Hero');
        // Shop's "top" is taken by Home: it becomes top-3, since Shop's other stage key top-2 is reserved too.
        expect(report.renamedStageKeys).toEqual([{ zoneId: second.id, key: 'top', slug: 'top-3' }]);
        expect(hero?.slug).toBe('top-2');
        expect(logged).toEqual([{ zonesCreated: 1, slugsFilled: 2, renamedStageKeys: report.renamedStageKeys }]);
      } finally {
        await migrate(pool);
      }
    });

    it('rolls everything back when copying placements fails: stages, frames and zones stay as they were', async () => {
      const project = await createProject();
      const home = await (await post('/zones', { name: 'Home', projectId: project.id })).json();
      await post(`/zones/${home.id}/tale-groups`, { name: 'Summer' });
      try {
        await legacySchema(project.id);
        const top = await frameOf(home, 'bar');
        await stageOf(home, 'Top', 'top', top);
        await stageOf(home, 'Hero', 'hero', await frameOf(home, 'banner'));
        const before = await pool.query('SELECT id, name, slug FROM zones ORDER BY id');
        const frames = await pool.query('SELECT id, zone_id FROM frames ORDER BY id');

        const client = await pool.connect();
        try {
          await expect(
            foldStagesIntoZones(client, {
              copyPlacements: async () => {
                throw new Error('copy failed');
              },
            }),
          ).rejects.toThrow('copy failed');
        } finally {
          client.release();
        }

        expect((await pool.query('SELECT id, name, slug FROM zones ORDER BY id')).rows).toEqual(before.rows);
        expect((await pool.query('SELECT id, zone_id FROM frames ORDER BY id')).rows).toEqual(frames.rows);
        expect((await pool.query('SELECT key FROM stages ORDER BY created_at')).rows).toEqual([{ key: 'top' }, { key: 'hero' }]);
        const slug = await pool.query(
          "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'zones' AND column_name = 'slug'",
        );
        expect(slug.rows[0].is_nullable).toBe('YES');

        // The real copy then folds it.
        const again = await pool.connect();
        try {
          expect(await foldStagesIntoZones(again, { copyPlacements: copyZonePlacements, log: () => undefined })).toEqual({
            zonesCreated: 1,
            slugsFilled: 1,
            renamedStageKeys: [],
          });
        } finally {
          again.release();
        }
      } finally {
        await migrate(pool);
      }
    });

    it('folds once when several API instances migrate at the same time', async () => {
      const project = await createProject();
      const home = await (await post('/zones', { name: 'Home', projectId: project.id })).json();
      try {
        await legacySchema(project.id);
        await stageOf(home, 'Top', 'top', await frameOf(home, 'bar'));
        await stageOf(home, 'Hero', 'hero', await frameOf(home, 'banner'));
        await frameOf(home, 'bar');

        await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);

        expect((await zonesListed()).map((z) => z.slug)).toEqual(['top', 'hero', 'top-bar-2']);
        const indexes = await pool.query(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'frames' ORDER BY indexname",
        );
        // One display per zone; the indexes only the stages needed are gone.
        expect(indexes.rows.map((r) => r.indexname)).toEqual(['frames_pkey', 'frames_zone_id_key']);
      } finally {
        await migrate(pool);
      }
    });
  });

  describe('zone templates (epic UX rework R5)', () => {
    const barSettings = { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 };
    const bannerSettings = { aspectRatio: '3:1', autoplay: true, intervalSeconds: 5, showDots: true, loop: true };

    async function frameCount(zoneId: string): Promise<number> {
      return (await pool.query('SELECT 1 FROM frames WHERE zone_id = $1', [zoneId])).rowCount ?? 0;
    }

    async function zoneCount(): Promise<number> {
      return Number((await pool.query('SELECT count(*) AS n FROM zones')).rows[0].n);
    }

    it('lists a zone created without a template with no note', async () => {
      const zone = await createZone();
      expect(zone.createdFromTemplate).toBeNull();
      expect(await (await fetch(`${base}/zones`)).json()).toEqual([zone]);
    });

    it('creates a zone from "Stories bar": a bar display with the preset settings, and the note', async () => {
      const project = await createProject();
      const res = await post('/zones', { name: 'Home', projectId: project.id, template: 'stories-bar' });
      expect(res.status).toBe(201);
      const zone = await res.json();
      expect(zone).toEqual({
        id: expect.any(String),
        name: 'Home',
        slug: 'home',
        projectId: project.id,
        createdFromTemplate: 'stories-bar',
        firstVisibleAt: null,
        // Its display is set; it still has no key and nothing placed (R7).
        frame: { id: expect.any(String), zoneId: zone.id, projectId: project.id, type: 'bar', settings: barSettings },
        visibility: notVisible(why('zone-not-installed', 'zone'), why('no-tale-groups', 'zone')),
      });
      expect(await (await fetch(`${base}/zones`)).json()).toEqual([zone]);
    });

    it('creates a zone from "Promo banner", and the Delivery API returns its display', async () => {
      const project = await createProject();
      const zone = await (await post('/zones', { name: 'Promo', projectId: project.id, template: 'promo-banner' })).json();
      expect([zone.createdFromTemplate, zone.frame.type, zone.frame.settings]).toEqual(['promo-banner', 'banner', bannerSettings]);
      const { key } = await (await postKey(zone.id)).json();
      const delivered = await (
        await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } })
      ).json();
      expect(delivered.frame).toEqual({ id: zone.frame.id, type: 'banner', settings: bannerSettings });
    });

    it('creates a zone from "Blank" with the note and no display', async () => {
      const project = await createProject();
      const res = await post('/zones', { name: 'Later', projectId: project.id, template: 'blank' });
      expect(res.status).toBe(201);
      const zone = await res.json();
      expect([zone.createdFromTemplate, zone.frame]).toEqual(['blank', null]);
      expect(zone.visibility.reasons.map((r: { code: string }) => r.code)).toContain('zone-no-display');
      expect(await frameCount(zone.id)).toBe(0);
    });

    it('leaves the display the zone own: editing it does not touch the note, and nothing links them', async () => {
      const project = await createProject();
      const zone = await (await post('/zones', { name: 'Home', projectId: project.id, template: 'stories-bar' })).json();
      const edited = await fetch(`${base}/zones/${zone.id}/frame`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'banner' }),
      });
      expect(edited.status).toBe(200);
      const [listed] = await (await fetch(`${base}/zones`)).json();
      expect([listed.createdFromTemplate, listed.frame.type, listed.frame.id]).toEqual(['stories-bar', 'banner', zone.frame.id]);
    });

    it('refuses a template not in the registry with 400 unknown_template, creating nothing', async () => {
      const project = await createProject();
      for (const template of ['nope', 'home-stories-bar', '', 3, null]) {
        const res = await post('/zones', { name: 'Home', projectId: project.id, template });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: 'unknown_template', message: expect.any(String) } });
      }
      expect(await zoneCount()).toBe(0);
    });

    it('creates nothing when the slug is taken, even with a template', async () => {
      const project = await createProject();
      await post('/zones', { name: 'Home', projectId: project.id, slug: 'home' });
      const res = await post('/zones', { name: 'Home', projectId: project.id, slug: 'home', template: 'promo-banner' });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('slug_taken');
      expect(await zoneCount()).toBe(1);
      expect(Number((await pool.query('SELECT count(*) AS n FROM frames')).rows[0].n)).toBe(0);
    });

    it('makes the slug unique on the template path too, each zone with its own display', async () => {
      const project = await createProject();
      const created = await Promise.all(
        [0, 1, 2].map(() => post('/zones', { name: 'Home', projectId: project.id, template: 'stories-bar' })),
      );
      expect(created.map((r) => r.status)).toEqual([201, 201, 201]);
      const zones = await Promise.all(created.map((r) => r.json()));
      expect(zones.map((z) => z.slug).sort()).toEqual(['home', 'home-2', 'home-3']);
      for (const zone of zones) {
        expect([zone.createdFromTemplate, zone.frame.type, zone.frame.settings]).toEqual(['stories-bar', 'bar', barSettings]);
        expect(await frameCount(zone.id)).toBe(1);
      }
    });

    it('rolls the zone back when the frame-type registry refuses the preset', async () => {
      // A registry that refuses every bar refuses the Stories bar preset after the zone row is written.
      const project = await createProject();
      const strict = loadFrameTypeRegistry(frameTypesDir);
      const validate = strict.validate.bind(strict);
      strict.validate = (type: string, settings: unknown) => {
        if (type === 'bar') throw new InvalidFrameSettingsError('gap is not allowed');
        return validate(type, settings);
      };
      await expect(
        createZoneFromTemplate(pool, strict, { name: 'Home', projectId: project.id, template: 'stories-bar' }),
      ).rejects.toBeInstanceOf(InvalidFrameSettingsError);
      expect(await zoneCount()).toBe(0);
    });

    it('refuses with 403 in a project the caller cannot access, creating nothing', async () => {
      const project = await createProject();
      const own = await createProject('Own');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, own.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      const res = await post('/zones', { name: 'Home', projectId: project.id, template: 'promo-banner' });
      expect(res.status).toBe(403);
      expect(await zoneCount()).toBe(0);
    });

    it('has no apply-playbook route any more', async () => {
      const zone = await createZone();
      const res = await fetch(`${base}/zones/${zone.id}/playbook`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'promo-banner' }),
      });
      expect(res.status).toBe(404);
      expect(await frameCount(zone.id)).toBe(0);
    });

    it('renames the stored playbook note "home-stories-bar" to "stories-bar", and keeps notes when the migration runs again', async () => {
      const zone = await createZone();
      const project = await createProject();
      const banner = await (await post('/zones', { name: 'Promo', projectId: project.id, template: 'promo-banner' })).json();
      await pool.query("UPDATE zones SET playbook_key = 'home-stories-bar' WHERE id = $1", [zone.id]);
      await restart();
      await restart();
      const zones: { id: string; createdFromTemplate: string | null }[] = await (await fetch(`${base}/zones`)).json();
      expect(zones.map((z) => [z.id, z.createdFromTemplate])).toEqual([
        [zone.id, 'stories-bar'],
        [banner.id, 'promo-banner'],
      ]);
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
        // Off, in a zone that is not set up, with no tale (R7).
        visibility: notVisible(
          why('group-off', 'group'),
          why('zone-no-display', 'zone'),
          why('zone-not-installed', 'zone'),
          why('no-shown-tales', 'group'),
        ),
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
        // Stored live (Shown, AD-6 amended); its group is Off (draft), so it reads blocked by group.
        status: 'blocked-by-group',
        storedStatus: 'live',
        startsAt: null,
        endsAt: null,
        media: null,
        // Nothing published yet, in a group that is Off, in a zone not set up (R7).
        visibility: notVisible(
          why('group-off', 'group'),
          why('not-updated-yet', 'tale'),
          why('zone-no-display', 'zone'),
          why('zone-not-installed', 'zone'),
        ),
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

      async function listed(zoneId: string): Promise<
        {
          id: string;
          position: number;
          tales: { id: string; position: number }[];
        }[]
      > {
        return (await fetch(`${base}/zones/${zoneId}/tale-groups`)).json();
      }

      it("reorders a zone's tale groups to positions 0..n-1", async () => {
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

      it("reorders a tale group's tales", async () => {
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
        visibility: SOME_VISIBILITY,
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
      await asLegacy(tale.id);
      const { key } = await (await postKey(z2.id)).json();
      const delivered = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      // C has no live tale, so only A is delivered.
      expect((await delivered.json()).taleGroups).toEqual([
        {
          id: a.id,
          name: 'A',
          cover: null,
          tales: [{ id: tale.id, title: 'Beach', media: null, document: NO_MEDIA_DOCUMENT }],
        },
      ]);
    });

    it('renames a group in one zone and shows the new name in both zones and in the Delivery API', async () => {
      const { z, z2, a, c } = await setup();
      await publish('tale-groups', a.id, c.id);
      for (const group of [a, c]) {
        const tale = (await (await post(`/tale-groups/${group.id}/tales`, { title: 'T' })).json()).id;
        await publish('tales', tale);
        await asLegacy(tale);
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
        // On, with a tale to show, in two zones neither of which is set up yet: each zone reason once (R7).
        visibility: notVisible(why('zone-no-display', 'zone'), why('zone-not-installed', 'zone')),
      });
      for (const zoneId of [z.id, z2.id]) {
        expect((await listed(zoneId)).find((g) => g.id === a.id)?.name).toBe('Summer sale');
      }
      const { key } = await (await postKey(z2.id)).json();
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
        {
          id: a.id, projectId: project.id, name: 'A', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 1, zoneIds: [],
          // In no zone (R7); its one tale has nothing published either.
          visibility: notVisible(why('group-off', 'group'), why('not-in-any-zone', 'group'), why('no-shown-tales', 'group')),
        },
        { id: expect.any(String), projectId: project.id, name: 'apple', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id], visibility: SOME_VISIBILITY },
        { id: expect.any(String), projectId: project.id, name: 'B', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z.id], visibility: SOME_VISIBILITY },
        { id: c.id, projectId: project.id, name: 'C', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id], visibility: SOME_VISIBILITY },
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

    it('makes groups and tales made before statuses live, new groups draft and new tales live, once (AD-6)', async () => {
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

      // New groups start draft (Off), new tales live (Shown, AD-6 amended); a second run changes nothing.
      const d = await createGroup(z.id, 'D');
      await post(`/tale-groups/${d.id}/tales`, { title: 'Dune' });
      await restart();
      expect(await statuses()).toEqual([
        ...migrated.slice(0, 3),
        { kind: 'group', name: 'D', status: 'draft' },
        { kind: 'tale', name: 'Beach', status: 'live' },
        { kind: 'tale', name: 'Dune', status: 'live' },
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
        visibility: SOME_VISIBILITY,
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
      // Installed, so its delivered media is public (R7).
      await postKey(staging.id);
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

  describe('tale documents (AD-15)', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const elementId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    function text(n: number, value = 'Hello', extra: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: elementId(n),
        type: 'text',
        box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: value },
        ...extra,
      };
    }

    function doc(elements: unknown[] = [text(1)], extra: Record<string, unknown> = {}): Record<string, unknown> {
      return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements, ...extra };
    }

    async function createTale(): Promise<{ id: string; projectId: string }> {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      return { id: tale.id, projectId: zone.projectId };
    }

    function read(taleId: string): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`);
    }

    // The draft document and its revision, as the studio edits it.
    async function readDraft(taleId: string): Promise<{ document: unknown; revision: number }> {
      const { document, revision } = await (await read(taleId)).json();
      return { document, revision };
    }

    function save(taleId: string, body: unknown): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    }

    // Saves `document` at revision 0 and expects the refusal, naming `pointer`; nothing is stored.
    async function expectRefused(document: unknown, pointer: string): Promise<void> {
      const tale = await createTale();
      const res = await save(tale.id, { document, revision: 0 });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toEqual({ code: 'invalid_tale_document', message: expect.any(String), pointer });
      expect(await readDraft(tale.id)).toEqual({ document: null, revision: 0 });
    }

    it('reads a tale without a document as null at revision 0', async () => {
      const tale = await createTale();
      const res = await read(tale.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ document: null, revision: 0, published: { document: null, revision: 0 } });
    });

    it('saves a document and reads it back unchanged, raising the revision', async () => {
      const tale = await createTale();
      const document = doc([text(1, '<b>x</b>\nsecond line', { a11y: { label: 'Greeting' } }), text(2, 'Two')], {
        durationMs: 7000,
      });
      const saved = await save(tale.id, { document, revision: 0 });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ document, revision: 1, published: { document: null, revision: 0 } });
      expect(await readDraft(tale.id)).toEqual({ document, revision: 1 });

      const next = doc([text(2, 'Two')]);
      expect(await (await save(tale.id, { document: next, revision: 1 })).json()).toMatchObject({
        document: next,
        revision: 2,
      });
    });

    it('refuses a write based on an older revision with 409, changing nothing', async () => {
      const tale = await createTale();
      expect((await save(tale.id, { document: doc([text(1, 'First')]), revision: 0 })).status).toBe(200);
      const stale = await save(tale.id, { document: doc([text(1, 'Second')]), revision: 0 });
      expect(stale.status).toBe(409);
      expect((await stale.json()).error.code).toBe('stale_revision');
      expect(await readDraft(tale.id)).toEqual({ document: doc([text(1, 'First')]), revision: 1 });
      // A revision from the future is just as stale.
      expect((await save(tale.id, { document: doc(), revision: 7 })).status).toBe(409);
    });

    it('refuses an unknown element type', async () => {
      await expectRefused(doc([text(1), { ...text(2), type: 'poll' }]), '/elements/1/type');
    });

    it('refuses out-of-range boxes', async () => {
      await expectRefused(
        doc([text(1, 'x', { box: { x: 1.5, y: 0, w: 0.5, h: 0.5, rotation: 0 } })]),
        '/elements/0/box/x',
      );
      await expectRefused(doc([text(1, 'x', { box: { x: 0, y: 0, w: 0, h: 0.5, rotation: 0 } })]), '/elements/0/box/w');
      await expectRefused(
        doc([text(1, 'x', { box: { x: 0, y: 0, w: 0.5, h: 0.5, rotation: 400 } })]),
        '/elements/0/box/rotation',
      );
    });

    it('refuses an unknown property and a style string', async () => {
      await expectRefused(doc([text(1, 'x', { style: 'color:red' })]), '/elements/0/style');
      await expectRefused(doc([{ ...text(1), props: { text: 'x', html: '<b>x</b>' } }]), '/elements/0/props/html');
      await expectRefused(doc(undefined, { css: 'body{}' }), '/css');
    });

    it('saves a styled text and reads it back unchanged (story 7.4)', async () => {
      const tale = await createTale();
      const props = {
        text: 'שלום world',
        font: { source: 'name', family: 'Inter' },
        fallback: 'serif',
        size: 0.06,
        weight: 'medium',
        italic: true,
        color: '#ffcc00',
        align: 'start',
        direction: 'auto',
        lineHeight: 1.4,
        background: 'box',
        backgroundColor: '#000000cc',
      };
      const document = doc([{ ...text(1), props }]);
      expect((await save(tale.id, { document, revision: 0 })).status).toBe(200);
      expect(await readDraft(tale.id)).toEqual({ document, revision: 1 });
    });

    // Every refusal of a text style (story 7.4), over HTTP: 400 naming the field, nothing stored.
    it.each([
      ['font', { source: 'name', family: 'inherit' }, 'font/family'],
      ['font', { source: 'name', family: 'Inter, initial' }, 'font/family'],
      ['font', { source: 'name', family: 'x;color:red' }, 'font/family'],
      ['font', { source: 'name', family: 'url(x)' }, 'font/family'],
      ['font', { source: 'name', family: 'a'.repeat(201) }, 'font/family'],
      ['font', { source: 'name' }, 'font/family'],
      ['font', { source: 'system', stack: 'fantasy' }, 'font/stack'],
      ['font', { source: 'system', stack: 'serif', family: 'Inter' }, 'font/family'],
      ['font', { source: 'theme', stack: 'serif' }, 'font/stack'],
      ['font', { source: 'cloud' }, 'font/source'],
      ['font', { source: 'name', family: '"TaleArt-Font-x"' }, 'font/family'],
      ['font', { source: 'project' }, 'font/fontId'],
      ['font', { source: 'project', fontId: 'brand' }, 'font/fontId'],
      ['font', { source: 'theme', url: 'x' }, 'font/url'],
      ['color', 'red; background:url(x)', 'color'],
      ['color', 'red', 'color'],
      ['color', '#12345', 'color'],
      ['color', '<b>x</b>', 'color'],
      ['backgroundColor', 'red; background:url(x)', 'backgroundColor'],
      ['size', 0, 'size'],
      ['size', 0.005, 'size'],
      ['size', 0.5, 'size'],
      ['size', 'big', 'size'],
      ['lineHeight', 0.5, 'lineHeight'],
      ['lineHeight', 4, 'lineHeight'],
      ['weight', 'heavy', 'weight'],
      ['italic', 'yes', 'italic'],
      ['align', 'left', 'align'],
      ['direction', 'up', 'direction'],
      ['background', 'gradient', 'background'],
      ['fallback', 'inherit', 'fallback'],
      ['shadow', '0 0 2px red', 'shadow'],
    ])('refuses a text style %s of %j (story 7.4)', async (field, value, at) => {
      await expectRefused(doc([{ ...text(1), props: { text: 'x', [field]: value } }]), `/elements/0/props/${at}`);
    });

    it('refuses more than 60 elements', async () => {
      await expectRefused(doc(Array.from({ length: 61 }, (_, i) => text(i + 1))), '/elements');
    });

    it('refuses a text over 1,000 characters', async () => {
      await expectRefused(doc([text(1, 'a'.repeat(1001))]), '/elements/0/props/text');
    });

    it('refuses control characters in text other than a line feed', async () => {
      await expectRefused(doc([text(1, 'bell\u0007')]), '/elements/0/props/text');
      await expectRefused(doc([text(1, 'nul\u0000')]), '/elements/0/props/text');
    });

    it('refuses duplicate element ids, a wrong version and a colour that is not hex', async () => {
      await expectRefused(doc([text(1), text(1, 'again')]), '/elements/1/id');
      await expectRefused(doc(undefined, { version: 2 }), '/version');
      await expectRefused(
        doc(undefined, { canvas: { background: { type: 'color', color: 'red' } } }),
        '/canvas/background/color',
      );
    });

    it('refuses a non-finite number', async () => {
      const tale = await createTale();
      const body = JSON.stringify({ document: doc(), revision: 0 }).replace('"x":0.1', '"x":1e999');
      const res = await save(tale.id, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.pointer).toBe('/elements/0/box/x');
    });

    it('refuses a document over 128 KB with 413, and a larger body too', async () => {
      const tale = await createTale();
      const big = doc(Array.from({ length: 60 }, (_, i) => text(i + 1, '€'.repeat(1000))));
      const res = await save(tale.id, { document: big, revision: 0 });
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe('tale_document_too_large');
      const huge = await save(tale.id, { document: doc([text(1, 'x'.repeat(400 * 1024))]), revision: 0 });
      expect(huge.status).toBe(413);
      expect((await huge.json()).error.code).toBe('tale_document_too_large');
      expect(await readDraft(tale.id)).toEqual({ document: null, revision: 0 });
    });

    it('accepts a document between 100 KB and 128 KB, over the default body limit', async () => {
      const tale = await createTale();
      // 55 texts of 1,000 two-byte characters: about 112 KB.
      const document = doc(Array.from({ length: 55 }, (_, i) => text(i + 1, 'é'.repeat(1000))));
      expect((await save(tale.id, { document, revision: 0 })).status).toBe(200);
    });

    it('reads the larger body however the path is written: any case, with a trailing slash', async () => {
      const tale = await createTale();
      const document = doc(Array.from({ length: 55 }, (_, i) => text(i + 1, 'é'.repeat(1000))));
      const put = (path: string, body: unknown) =>
        fetch(`${origin}${path}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const res = await put(`/API/V1/Tales/${tale.id}/Document/`, { document, revision: 0 });
      expect(res.status).toBe(200);
      expect((await res.json()).revision).toBe(1);
      // A body over the route's own limit maps to the document's 413 on that spelling too.
      const huge = await put(`/api/v1/TALES/${tale.id}/DOCUMENT/`, {
        document: doc([text(1, 'x'.repeat(400 * 1024))]),
        revision: 1,
      });
      expect(huge.status).toBe(413);
      expect((await huge.json()).error.code).toBe('tale_document_too_large');
      // Other routes keep the 100 KB default.
      const other = await fetch(`${base}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(110 * 1024) }),
      });
      expect(other.status).toBe(413);
      expect((await other.json()).error.code).toBe('validation_failed');
    });

    it('keeps right-to-left text and emoji sequences, stores NFC, and refuses bidi overrides', async () => {
      const tale = await createTale();
      const hebrew = 'שלום \u2067עולם\u2069 \u200f👩‍👩‍👧‍👦 👍🏽';
      const saved = await save(tale.id, {
        document: doc([text(1, hebrew, { a11y: { label: 'Cafe\u0301' } })]),
        revision: 0,
      });
      expect(saved.status).toBe(200);
      const read1 = await (await read(tale.id)).json();
      expect(read1.document.elements[0].props.text).toBe(hebrew);
      expect(read1.document.elements[0].a11y.label).toBe('Caf\u00e9');
      await expectRefused(doc([text(1, 'pay \u202egnp.exe')]), '/elements/0/props/text');
      await expectRefused(doc([text(1, 'x', { a11y: { label: 'a\u0085b' } })]), '/elements/0/a11y/label');
      await expectRefused(doc(undefined, { 'a/b': 1 }), '/a~1b');
    });

    it('refuses a body without a document or a valid revision', async () => {
      const tale = await createTale();
      const bodies = [
        { revision: 0 },
        { document: doc() },
        { document: doc(), revision: -1 },
        { document: doc(), revision: '0' },
        { document: doc(), revision: 1.5 },
        // Past the stored integer column: refused, never a database error.
        { document: doc(), revision: 2147483648 },
        { document: doc(), revision: 1e300 },
      ];
      for (const body of bodies) {
        const res = await save(tale.id, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      const malformed = await save(tale.id, '{"document":');
      expect(malformed.status).toBe(400);
    });

    it('answers 404 for an unknown tale and 403 for a tale of another project', async () => {
      expect((await read(unknownId)).status).toBe(404);
      expect((await save(unknownId, { document: doc(), revision: 0 })).status).toBe(404);
      const tale = await createTale();
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      expect((await read(tale.id)).status).toBe(403);
      expect((await save(tale.id, { document: doc(), revision: 0 })).status).toBe(403);
    });

    it('copies a tale group with its tales’ documents', async () => {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      expect((await save(tale.id, { document: doc(), revision: 0 })).status).toBe(200);
      const copy = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: zone.id })).json();
      expect(await readDraft(copy.tales[0].id)).toEqual({ document: doc(), revision: 0 });
    });

    describe('draft and published documents (story 7.3, user decision 2026-10-22)', () => {
      function action(taleId: string, name: 'publish' | 'discard', body: unknown): Promise<Response> {
        return fetch(`${base}/tales/${taleId}/document/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      async function state(taleId: string) {
        return (await read(taleId)).json();
      }

      it('saves only the draft; publishing copies it with compare-and-set on both revisions', async () => {
        const tale = await createTale();
        expect((await save(tale.id, { document: doc([text(1, 'One')]), revision: 0 })).status).toBe(200);
        expect((await state(tale.id)).published).toEqual({ document: null, revision: 0 });

        // Based on a stale draft revision, or a stale published one: refused, nothing changes.
        for (const body of [
          { revision: 0, publishedRevision: 0 },
          { revision: 1, publishedRevision: 3 },
        ]) {
          const res = await action(tale.id, 'publish', body);
          expect([res.status, (await res.json()).error.code]).toEqual([409, 'stale_revision']);
        }
        expect((await state(tale.id)).published).toEqual({ document: null, revision: 0 });

        const res = await action(tale.id, 'publish', { revision: 1, publishedRevision: 0 });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          document: doc([text(1, 'One')]),
          revision: 1,
          published: { document: doc([text(1, 'One')]), revision: 1 },
        });

        // The next save changes the draft only; publishing again raises the published revision.
        expect((await save(tale.id, { document: doc([text(1, 'Two')]), revision: 1 })).status).toBe(200);
        expect((await state(tale.id)).published).toEqual({ document: doc([text(1, 'One')]), revision: 1 });
        const again = await action(tale.id, 'publish', { revision: 2, publishedRevision: 1 });
        expect((await again.json()).published).toEqual({ document: doc([text(1, 'Two')]), revision: 2 });
      });

      it('discards the draft back to the published document, with compare-and-set on both revisions', async () => {
        const tale = await createTale();
        await save(tale.id, { document: doc([text(1, 'Live')]), revision: 0 });
        await action(tale.id, 'publish', { revision: 1, publishedRevision: 0 });
        await save(tale.id, { document: doc([text(1, 'Draft')]), revision: 1 });
        const stale = await action(tale.id, 'discard', { revision: 1, publishedRevision: 1 });
        expect([stale.status, (await stale.json()).error.code]).toEqual([409, 'stale_revision']);
        expect(await readDraft(tale.id)).toEqual({ document: doc([text(1, 'Draft')]), revision: 2 });

        const res = await action(tale.id, 'discard', { revision: 2, publishedRevision: 1 });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
          document: doc([text(1, 'Live')]),
          revision: 3,
          published: { document: doc([text(1, 'Live')]), revision: 1 },
        });
      });

      it('publishes the draft when a tale with nothing published goes live, and not on a later resume', async () => {
        const tale = await createTale();
        // New tales are stored live with nothing published (AD-6 amended): saving keeps it that way.
        await save(tale.id, { document: doc([text(1, 'First')]), revision: 0 });
        expect((await state(tale.id)).published).toEqual({ document: null, revision: 0 });
        expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
        await publish('tales', tale.id);
        expect((await state(tale.id)).published).toEqual({ document: doc([text(1, 'First')]), revision: 1 });

        expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
        await save(tale.id, { document: doc([text(1, 'Later')]), revision: 1 });
        await publish('tales', tale.id);
        expect((await state(tale.id)).published).toEqual({ document: doc([text(1, 'First')]), revision: 1 });
      });

      it('publishes the draft of a never-published tale going archived, paused, then live', async () => {
        const tale = await createTale();
        await save(tale.id, { document: doc([text(1, 'Kept')]), revision: 0 });
        expect((await setStatus('tales', tale.id, 'archived')).status).toBe(200);
        expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
        expect((await state(tale.id)).published).toEqual({ document: null, revision: 0 });
        const live = await setStatus('tales', tale.id, 'live');
        expect(live.status).toBe(200);
        expect(await live.json()).not.toHaveProperty('draftNotPublished');
        expect((await state(tale.id)).published).toEqual({ document: doc([text(1, 'Kept')]), revision: 1 });
      });

      it('goes live without publishing a draft that no longer passes, and says so', async () => {
        const tale = await createTale();
        await pool.query(
          `UPDATE tales SET draft_document = '{"version": 1}'::jsonb, draft_revision = 1 WHERE id = $1`,
          [tale.id],
        );
        expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
        const res = await setStatus('tales', tale.id, 'live');
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ storedStatus: 'live', draftNotPublished: true });
        expect((await state(tale.id)).published).toEqual({ document: null, revision: 0 });
      });

      it('refuses to publish a tale with no draft, never emptying the published document', async () => {
        const tale = await createTale();
        const res = await action(tale.id, 'publish', { revision: 0, publishedRevision: 0 });
        expect([res.status, (await res.json()).error.code]).toEqual([409, 'nothing_to_publish']);
        await save(tale.id, { document: doc([text(1, 'Live')]), revision: 0 });
        await action(tale.id, 'publish', { revision: 1, publishedRevision: 0 });
        await pool.query('UPDATE tales SET draft_document = NULL WHERE id = $1', [tale.id]);
        const again = await action(tale.id, 'publish', { revision: 1, publishedRevision: 1 });
        expect([again.status, (await again.json()).error.code]).toEqual([409, 'nothing_to_publish']);
        expect((await state(tale.id)).published).toEqual({ document: doc([text(1, 'Live')]), revision: 1 });
      });

      it('refuses publish and discard without integer revisions, for an unknown tale, and for another project', async () => {
        const tale = await createTale();
        const bodies = [
          {},
          { revision: 0 },
          { revision: 0, publishedRevision: '0' },
          { revision: -1, publishedRevision: 0 },
        ];
        for (const body of bodies) {
          for (const name of ['publish', 'discard'] as const) {
            const res = await action(tale.id, name, body);
            expect([res.status, (await res.json()).error.code]).toEqual([400, 'validation_failed']);
          }
        }
        expect((await action(unknownId, 'publish', { revision: 0, publishedRevision: 0 })).status).toBe(404);
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        expect((await action(tale.id, 'publish', { revision: 0, publishedRevision: 0 })).status).toBe(403);
        expect((await action(tale.id, 'discard', { revision: 0, publishedRevision: 0 })).status).toBe(403);
      });

      it('gives a document written before drafts existed the same draft, at the same revision', async () => {
        const tale = await createTale();
        await pool.query(
          `UPDATE tales SET document = $2::jsonb, document_revision = 4, draft_document = NULL, draft_revision = 0
           WHERE id = $1`,
          [tale.id, JSON.stringify(doc([text(1, 'Old')]))],
        );
        await migrate(pool);
        expect(await state(tale.id)).toEqual({
          document: doc([text(1, 'Old')]),
          revision: 4,
          published: { document: doc([text(1, 'Old')]), revision: 4 },
        });
      });
    });

    describe('keep a document as a new tale (story 7.3)', () => {
      function keep(taleId: string, body: unknown): Promise<Response> {
        return fetch(`${base}/tales/${taleId}/document/copy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        });
      }

      async function groupOf(taleId: string): Promise<{ groupId: string; projectId: string }> {
        const { rows } = await pool.query(
          'SELECT tale_group_id AS "groupId", project_id AS "projectId" FROM tales WHERE id = $1',
          [taleId],
        );
        return rows[0];
      }

      it('keeps the second tab’s version as a new draft tale in the same group, sharing the media', async () => {
        const tale = await createTale();
        // In step with its documents, which a person keeps without the media (R16).
        await pool.query(
          `UPDATE tales SET media_key = 'tales/a.png', media_content_type = 'image/png', document_media_key = 'tales/a.png'
           WHERE id = $1`,
          [tale.id],
        );
        await publish('tales', tale.id);
        // Two tabs read revision 0; the first saves, the second is refused.
        expect((await save(tale.id, { document: doc([text(1, 'Tab one')]), revision: 0 })).status).toBe(200);
        const mine = doc([text(1, 'Tab two')]);
        expect((await save(tale.id, { document: mine, revision: 0 })).status).toBe(409);

        const res = await keep(tale.id, { document: mine });
        expect(res.status).toBe(201);
        const copy = await res.json();
        const { groupId, projectId } = await groupOf(tale.id);
        expect(copy).toMatchObject({
          taleGroupId: groupId,
          projectId,
          title: 'Beach (copy)',
          position: 1,
          storedStatus: 'draft',
          startsAt: null,
          endsAt: null,
          media: { kind: 'image', contentType: 'image/png', url: `/api/v1/tales/${copy.id}/media` },
        });
        // The copy holds the draft; nothing of it is published until the copy is. The kept version holds
        // no media element, so the copy is out of step and reads with its media composed in (R16).
        expect(await (await read(copy.id)).json()).toEqual({
          document: {
            ...mine,
            durationMs: 5000,
            elements: [
              {
                id: copy.id,
                type: 'image',
                box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
                hidden: false,
                locked: false,
                a11y: { decorative: true },
                props: { mediaKey: 'tales/a.png', fit: 'contain', taleMedia: true },
              },
              ...mine.elements,
            ],
          },
          revision: 1,
          published: { document: null, revision: 0 },
        });
        expect((await pool.query('SELECT document_media_key FROM tales WHERE id = $1', [copy.id])).rows).toEqual([
          { document_media_key: null },
        ]);
        // The original keeps the first tab's save, and both tales share the media file (AD-14).
        expect(await readDraft(tale.id)).toEqual({ document: doc([text(1, 'Tab one')]), revision: 1 });
        const { rows } = await pool.query('SELECT media_key FROM tales WHERE tale_group_id = $1 ORDER BY position', [
          groupId,
        ]);
        expect(rows).toEqual([{ media_key: 'tales/a.png' }, { media_key: 'tales/a.png' }]);
        // The copy saves on from revision 1.
        expect((await save(copy.id, { document: doc([text(1, 'More')]), revision: 1 })).status).toBe(200);
      });

      it('refuses a full group with 409 tale_group_full, creating nothing', async () => {
        const tale = await createTale();
        const { groupId, projectId } = await groupOf(tale.id);
        await pool.query(
          `INSERT INTO tales (tale_group_id, project_id, title, position)
           SELECT $1, $2, 'Tale ' || n, n FROM generate_series(1, 99) AS n`,
          [groupId, projectId],
        );
        const res = await keep(tale.id, { document: doc() });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: { code: 'tale_group_full', message: expect.any(String) } });
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM tales WHERE tale_group_id = $1', [groupId]);
        expect(rows).toEqual([{ n: 100 }]);
      });

      it('never passes 100 tales when keeps race', async () => {
        const tale = await createTale();
        const { groupId, projectId } = await groupOf(tale.id);
        await pool.query(
          `INSERT INTO tales (tale_group_id, project_id, title, position)
           SELECT $1, $2, 'Tale ' || n, n FROM generate_series(1, 97) AS n`,
          [groupId, projectId],
        );
        const statuses = await Promise.all(
          [1, 2, 3, 4].map(() => keep(tale.id, { document: doc() }).then((r) => r.status)),
        );
        expect(statuses.sort()).toEqual([201, 201, 409, 409]);
        const { rows } = await pool.query(
          'SELECT count(*)::int AS n, count(DISTINCT position)::int AS positions FROM tales WHERE tale_group_id = $1',
          [groupId],
        );
        expect(rows).toEqual([{ n: 100, positions: 100 }]);
      });

      it('checks the document as a save does, and needs one', async () => {
        const tale = await createTale();
        const refused = await keep(tale.id, { document: doc([text(1), { ...text(2), type: 'poll' }]) });
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toEqual({
          code: 'invalid_tale_document',
          message: expect.any(String),
          pointer: '/elements/1/type',
        });
        expect((await keep(tale.id, {})).status).toBe(400);
        expect((await keep(tale.id, '{"document":')).status).toBe(400);
        const huge = await keep(tale.id, { document: doc([text(1, 'x'.repeat(300 * 1024))]) });
        expect([huge.status, (await huge.json()).error.code]).toEqual([413, 'tale_document_too_large']);
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM tales');
        expect(rows).toEqual([{ n: 1 }]);
      });

      it('answers 404 for an unknown tale and 403 for a tale of another project', async () => {
        expect((await keep(unknownId, { document: doc() })).status).toBe(404);
        const tale = await createTale();
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        const res = await keep(tale.id, { document: doc() });
        expect([res.status, (await res.json()).error.code]).toEqual([403, 'forbidden']);
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM tales');
        expect(rows).toEqual([{ n: 1 }]);
      });
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

    async function storedRow(taleId: string): Promise<{
      media_key: string | null;
      media_content_type: string | null;
    }> {
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
      await asLegacy(tale.id);
      const { key } = await (await postKey(group.zoneId)).json();
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
      // A list, weak tags and * match too; another tag does not.
      for (const header of [`"other", ${etag}`, `W/${etag}`, '*']) {
        expect((await fetch(`${base}/tale-groups/${group.id}/cover`, { headers: { 'If-None-Match': header } })).status).toBe(304);
      }
      expect((await fetch(`${base}/tale-groups/${group.id}/cover`, { headers: { 'If-None-Match': '"other"' } })).status).toBe(200);
    });

    it('answers 304 from the key alone, without reading the stored file', async () => {
      const group = await createGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const key = (await coverKey(group.id)) ?? '';
      rmSync(join(mediaDir, key));
      const res = await fetch(`${base}/tale-groups/${group.id}/cover`, { headers: { 'If-None-Match': `"${key}"` } });
      expect(res.status).toBe(304);
      expect((await fetch(`${base}/tale-groups/${group.id}/cover`)).status).toBe(404);
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

    it('refuses a video cover above 300 KB while reading it, and one above 10 MB from its length', async () => {
      const group = await createGroup();
      for (const size of [300 * KB + 1, 10 * KB * KB + 1]) {
        const res = await putCover(group.id, 'video/webm', webmOf(size));
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({ error: { code: 'media_too_large', message: 'An animated cover is at most 300 KB' } });
      }
      expect(await coverKey(group.id)).toBeNull();
      expect(existsSync(join(mediaDir, 'covers')) ? readdirSync(join(mediaDir, 'covers')) : []).toEqual([]);
    });

    it('serves a cover publicly only while its group is placed in a zone, as the Delivery API delivers it', async () => {
      const group = await liveGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const url = (await deliveredGroups(group.key))[0].cover?.url ?? '';
      const ok = await getPublic(url);
      expect(ok.status).toBe(200);
      const etag = ok.headers.get('etag') ?? '';

      // Removed from its last zone: live, in its window, with a live tale, but not delivered anywhere.
      expect((await fetch(`${base}/zones/${group.zoneId}/tale-groups/${group.id}`, { method: 'DELETE' })).status).toBe(204);
      expect(await deliveredGroups(group.key)).toEqual([]);
      const gone = await getPublic(url);
      expect([gone.status, (await gone.json()).error.code]).toEqual([404, 'media_not_found']);
      const revalidated = await globalThis.fetch(`${origin}${new URL(url).pathname}`, { headers: { 'If-None-Match': etag } });
      expect(revalidated.status).toBe(404);

      // Placed again: public again.
      expect((await fetch(`${base}/zones/${group.zoneId}/tale-groups/${group.id}`, { method: 'PUT' })).status).toBe(201);
      expect((await getPublic(url)).status).toBe(200);
    });

    it('does not serve the cover of a live group with a live tale that was never placed', async () => {
      const group = await liveGroup();
      await putCover(group.id, 'image/jpeg', jpeg);
      const key = (await coverKey(group.id)) ?? '';
      await pool.query('DELETE FROM zone_tale_groups WHERE tale_group_id = $1', [group.id]);
      const res = await globalThis.fetch(`${origin}/media/${key}`, { headers: { 'If-None-Match': `"${key}"` } });
      expect(res.status).toBe(404);
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
      expect(await (await send('GET', '/zones')).json()).toEqual([{ ...a.zone, visibility: SOME_VISIBILITY }]);
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
        ['PATCH', `/zones/${b.zone.id}`, { name: 'Mine' }],
        ['POST', `/zones/${b.zone.id}/frame`, { type: 'bar' }],
        ['PATCH', `/zones/${b.zone.id}/frame`, { settings: {} }],
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
        ['PUT', `/tales/${b.tale.id}/status`, { status: 'paused' }],
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
      // New tales are stored live (AD-6 amended); hiding theirs was refused.
      expect((await pool.query("SELECT 1 FROM tales WHERE status <> 'live'")).rowCount).toBe(0);
      // A zone of their own project cannot place a group of a project they cannot see.
      const across = await send('PUT', `/zones/${a.zone.id}/tale-groups/${b.group.id}`);
      expect(across.status).toBe(400);
      expect((await across.json()).error.code).toBe('tale_group_not_found');
    });

    it('allows a content manager every route on their own project and still answers 404 for unknown ones', async () => {
      const { a } = await twoProjects();
      await signInAsContentManager([a.project.id]);
      expect((await send('POST', '/zones', { name: 'Mine', projectId: a.project.id })).status).toBe(201);
      expect((await send('PATCH', `/zones/${a.zone.id}`, { slug: 'mine-too' })).status).toBe(200);
      expect((await send('POST', `/zones/${a.zone.id}/frame`, { type: 'bar' })).status).toBe(201);
      expect((await send('PATCH', `/zones/${a.zone.id}/frame`, { type: 'banner' })).status).toBe(200);
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

      expect((await send('POST', `/zones/${unknownId}/frame`, { type: 'bar' })).status).toBe(404);
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
      expect(await (await send('GET', '/zones')).json()).toEqual([
        { ...a.zone, visibility: SOME_VISIBILITY },
        { ...b.zone, visibility: SOME_VISIBILITY },
      ]);
      expect((await send('GET', `/zones/${b.zone.id}/tale-groups`)).status).toBe(200);
    });
  });
  describe('project theme (R9)', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';

    function getTheme(projectId: string): Promise<Response> {
      return globalThis.fetch(`${base}/projects/${projectId}/theme`, { headers: { Cookie: sessionCookie } });
    }

    function putTheme(projectId: string, body: unknown): Promise<Response> {
      return globalThis.fetch(`${base}/projects/${projectId}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify(body),
      });
    }

    it('reads a project with no theme as the default theme', async () => {
      const project = await createProject();
      const res = await getTheme(project.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projectId: project.id, theme: {}, resolved: DEFAULT_THEME });
    });

    it('stores a theme, answers it resolved, and resets it with {}', async () => {
      const project = await createProject();
      const settings = { ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' };
      const saved = await putTheme(project.id, settings);
      expect(saved.status).toBe(200);
      const expected = { projectId: project.id, theme: settings, resolved: { ...DEFAULT_THEME, ...settings } };
      expect(await saved.json()).toEqual(expected);
      expect(await (await getTheme(project.id)).json()).toEqual(expected);
      const { rows } = await pool.query('SELECT project_id, theme FROM project_themes');
      expect(rows).toEqual([{ project_id: project.id, theme: settings }]);

      // A save replaces the theme: fields left out return to the default.
      expect((await (await putTheme(project.id, { titleColor: '#000000' })).json()).theme).toEqual({ titleColor: '#000000' });
      const reset = await putTheme(project.id, {});
      expect(await reset.json()).toEqual({ projectId: project.id, theme: {}, resolved: DEFAULT_THEME });
    });

    it.each([
      [{ titleColor: 'red' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
      [{ titleColor: '#12345' }, "theme.titleColor must be a colour as #rrggbb, or null for the host page's"],
      [{ backgroundColor: '#123456;x' }, 'theme.backgroundColor must be a colour as #rrggbb, or transparent'],
      [{ backgroundColor: null }, 'theme.backgroundColor must be a colour as #rrggbb, or transparent'],
      [{ accentColor: 'transparent' }, 'theme.accentColor must be a colour as #rrggbb'],
      [{ fontFamily: 'inherit' }, expect.stringMatching(/^theme\.fontFamily /)],
      [{ fontFamily: 'Georgia, revert-layer' }, expect.stringMatching(/^theme\.fontFamily /)],
      [{ fontFamily: '-apple-system' }, expect.stringMatching(/^theme\.fontFamily /)],
      [{ fontFamily: 'Georgia, taleart-font-x' }, expect.stringMatching(/^theme\.fontFamily .*taleart-font-/)],
      [{ ringColors: [] }, 'theme.ringColors must hold 1 to 3 colours'],
      [{ ringColors: ['#000000', '#000000', '#000000', '#000000'] }, 'theme.ringColors must hold 1 to 3 colours'],
      [{ ringWidth: 5 }, 'theme.ringWidth must be at most 4'],
      [{ cornerRadius: -1 }, 'theme.cornerRadius must be at least 0'],
      [{ ringWidth: 2.5 }, 'theme.ringWidth must be a whole number'],
      [{ ringStyle: 'dots' }, 'theme.ringStyle must be one of: gradient, solid, none'],
      [{ fontFamily: 'a;}b{' }, expect.stringMatching(/^theme\.fontFamily must be a list of font names/)],
      [{ fontFamily: 'url(x)' }, expect.stringMatching(/^theme\.fontFamily /)],
      [{ size: 1 }, 'theme has unknown field "size"'],
      [['#000000'], 'theme must be an object'],
    ])('refuses %j with invalid_theme and keeps the stored theme', async (body, message) => {
      const project = await createProject();
      await putTheme(project.id, { titleColor: '#000000' });
      const res = await putTheme(project.id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'invalid_theme', message } });
      expect((await (await getTheme(project.id)).json()).theme).toEqual({ titleColor: '#000000' });
    });

    it('answers 404 for an unknown project', async () => {
      for (const id of [unknownId, 'nope']) {
        for (const res of [await getTheme(id), await putTheme(id, {})]) {
          expect(res.status).toBe(404);
          expect((await res.json()).error.code).toBe('project_not_found');
        }
      }
    });

    it("lets a content manager edit their project's theme, and no other", async () => {
      const own = await createProject('Acme');
      const other = await createProject('Globex');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, own.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;

      expect((await putTheme(own.id, { accentColor: '#ffcc00' })).status).toBe(200);
      for (const res of [await getTheme(other.id), await putTheme(other.id, { accentColor: '#ffcc00' })]) {
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      }
      expect(await pool.query('SELECT 1 FROM project_themes WHERE project_id = $1', [other.id])).toMatchObject({ rowCount: 0 });
    });

    it('keeps the theme table through a second migration', async () => {
      const project = await createProject();
      await putTheme(project.id, { cornerRadius: 0 });
      await restart();
      expect((await (await getTheme(project.id)).json()).theme).toEqual({ cornerRadius: 0 });
    });
  });

  describe('zone keys and the Delivery API', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const bannerDefaults = { aspectRatio: '16:9', autoplay: true, intervalSeconds: 5, showDots: true, loop: true };

    function send(method: string, path: string, cookie = sessionCookie): Promise<Response> {
      return globalThis.fetch(`${base}${path}`, { method, headers: { Cookie: cookie } });
    }

    function patch(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    function deliver(key?: string, headers: Record<string, string> = {}): Promise<Response> {
      const all: Record<string, string> = { ...headers };
      if (key !== undefined) all['Authorization'] = `Bearer ${key}`;
      return globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: all });
    }

    async function issue(zoneId: string): Promise<{ key: string; prefix: string; createdAt: string }> {
      await withDisplay(zoneId);
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
      expect(res.headers.get('cache-control')).toBe('no-store');
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

    it('lets a browser revalidate the zone: private, no-cache, by key, 304 while unchanged', async () => {
      const zone = await createZone();
      await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
      const { key } = await issue(zone.id);

      const first = await deliver(key);
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('private, no-cache');
      expect(first.headers.get('vary')).toContain('Authorization');
      const etag = first.headers.get('etag');
      expect(etag).toBeTruthy();

      // As a browser revalidates from its cache. (fetch adds `Cache-Control: no-cache` to a request with
      // its own If-None-Match unless one is set, and Express never answers 304 to that.)
      const revalidate = { 'If-None-Match': etag as string, 'Cache-Control': 'max-age=0' };
      const same = await deliver(key, revalidate);
      expect(same.status).toBe(304);
      expect(same.headers.get('access-control-allow-origin')).toBe('*');
      expect(await same.text()).toBe('');

      // A change answers the new zone at once.
      await patch(`/zones/${zone.id}/frame`, { type: 'banner' });
      const changed = await deliver(key, revalidate);
      expect(changed.status).toBe(200);
      expect((await changed.json()).frame.type).toBe('banner');

      // A refused key never gets a 304, whatever ETag it sends.
      await send('DELETE', `/zones/${zone.id}/key`);
      await expectInvalidKey(await deliver(key, revalidate));
    });

    it('serves the zone, its slug and its display to a valid key', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: {} })).json();
      const { key } = await issue(zone.id);

      const res = await deliver(key);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(await res.json()).toEqual({
        id: zone.id,
        name: zone.name,
        slug: zone.slug,
        // The project sets no theme: TaleArt's default (R9).
        theme: DEFAULT_THEME,
        // Stored as {}, delivered with every default of the bar schema.
        frame: {
          id: frame.id,
          type: 'bar',
          settings: { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
        },
        taleGroups: [],
      });
    });

    it('delivers a bar display with the stored values over the defaults', async () => {
      const zone = await createZone();
      const frame = await (await post(`/zones/${zone.id}/frame`, { type: 'bar' })).json();
      const saved = await patch(`/zones/${zone.id}/frame`, { settings: { shape: 'rounded-square', showTitles: false, gap: 20 } });
      expect(saved.status).toBe(200);
      const { key } = await issue(zone.id);

      expect((await (await deliver(key)).json()).frame).toEqual({
        id: frame.id,
        type: 'bar',
        settings: { shape: 'rounded-square', size: 'medium', showTitles: false, alignment: 'start', gap: 20 },
      });
    });

    it('delivers a banner display with its saved settings over the defaults, and its new type at once', async () => {
      const zone = await createZone();
      const bar = await (await post(`/zones/${zone.id}/frame`, { type: 'bar' })).json();
      const { key } = await issue(zone.id);
      const saved = await patch(`/zones/${zone.id}/frame`, {
        type: 'banner',
        settings: { aspectRatio: '3:1', intervalSeconds: 3, showDots: false },
      });
      expect(saved.status).toBe(200);

      expect((await (await deliver(key)).json()).frame).toEqual({
        id: bar.id,
        type: 'banner',
        settings: { ...bannerDefaults, aspectRatio: '3:1', intervalSeconds: 3, showDots: false },
      });
    });

    it('delivers only valid settings when a stored row is invalid, filling defaults', async () => {
      const defaults = { shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 };
      const cases: [string, unknown, object][] = [
        ['bar', { gap: 40, shape: 'star', size: 'large', color: 'red' }, { ...defaults, size: 'large' }],
        ['bar', ['x'], defaults],
        ['banner', { stray: 1, intervalSeconds: 40, aspectRatio: '</style>', loop: false }, { ...bannerDefaults, loop: false }],
      ];
      for (const [type, stored, delivered] of cases) {
        const zone = await createZone();
        const frame = await (await post(`/zones/${zone.id}/frame`, { type })).json();
        // Written by hand, past the API's validation, as an older schema or a manual edit could leave them.
        await pool.query('UPDATE frames SET settings = $2 WHERE id = $1', [frame.id, JSON.stringify(stored)]);
        const { key } = await issue(zone.id);
        const res = await deliver(key);
        expect(res.status).toBe(200);
        expect((await res.json()).frame).toEqual({ id: frame.id, type, settings: delivered });
      }
    });

    it("delivers the zone's project theme with defaults filled in (R9)", async () => {
      const zone = await createZone();
      const { key } = await issue(zone.id);
      const saved = await globalThis.fetch(`${base}/projects/${zone.projectId}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ ringStyle: 'solid', ringColors: ['#0055ff'], cornerRadius: 0, fontFamily: 'Georgia, serif' }),
      });
      expect(saved.status).toBe(200);

      expect((await (await deliver(key)).json()).theme).toEqual({
        ...DEFAULT_THEME,
        ringStyle: 'solid',
        ringColors: ['#0055ff'],
        cornerRadius: 0,
        fontFamily: 'Georgia, serif',
      });

      // Another project's theme never reaches this zone.
      const other = await createProject('Globex');
      await globalThis.fetch(`${base}/projects/${other.id}/theme`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
        body: JSON.stringify({ titleColor: '#000000' }),
      });
      expect((await (await deliver(key)).json()).theme.titleColor).toBeNull();
    });

    it('saves a theme with PUT and delivers it resolved: explicit values, host-page nulls and transparent', async () => {
      const zone = await createZone();
      const { key } = await issue(zone.id);
      const put = (body: unknown) =>
        globalThis.fetch(`${base}/projects/${zone.projectId}/theme`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
          body: JSON.stringify(body),
        });

      // Nothing set: the look before themes.
      const before = (await (await deliver(key)).json()).theme;
      expect(before).toEqual(DEFAULT_THEME);
      expect(before).toMatchObject({ titleColor: null, fontFamily: null, cornerRadius: null, backgroundColor: 'transparent' });

      const explicit = { titleColor: '#000000', backgroundColor: '#fafafa', fontFamily: 'Georgia, serif', cornerRadius: 4 };
      expect((await put(explicit)).status).toBe(200);
      expect((await (await deliver(key)).json()).theme).toEqual({ ...DEFAULT_THEME, ...explicit });

      // Back to the host page's values, explicitly.
      const host = { titleColor: null, backgroundColor: 'transparent', fontFamily: null, cornerRadius: null };
      const saved = await put(host);
      expect(saved.status).toBe(200);
      expect((await saved.json()).theme).toEqual(host);
      expect((await (await deliver(key)).json()).theme).toEqual(DEFAULT_THEME);
    });

    it('delivers only valid theme fields when the stored row is invalid', async () => {
      const zone = await createZone();
      const { key } = await issue(zone.id);
      // Written by hand, past the API's validation.
      await pool.query('INSERT INTO project_themes (project_id, theme) VALUES ($1, $2)', [
        zone.projectId,
        JSON.stringify({ titleColor: 'red;}</style>', ringWidth: 9, fontFamily: 'a{b}', cornerRadius: 4, stray: 1 }),
      ]);
      const { theme } = await (await deliver(key)).json();
      expect(theme).toEqual({ ...DEFAULT_THEME, cornerRadius: 4 });
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
        } else {
          // Without media it has nothing published: delivered as a tale from before the UX rework.
          await asLegacy(tale.id);
        }
        return tale;
      }

      // Fetches a public media URL on the test server, with no cookie and no key.
      function getPublic(url: string, headers: Record<string, string> = {}): Promise<Response> {
        return globalThis.fetch(`${origin}${new URL(url).pathname}`, { headers });
      }

      describe('site keys: a zone placed by site key and slug (epic UX rework R3, story 8.6)', () => {
        type Issued = { key: string; prefix: string; createdAt: string };

        function siteKeyPath(projectId: string): string {
          return `/projects/${projectId}/site-key`;
        }

        async function issueSite(projectId: string): Promise<Issued> {
          const res = await send('POST', siteKeyPath(projectId));
          expect(res.status).toBe(201);
          return res.json();
        }

        function deliverQuery(key: string, query: string): Promise<Response> {
          return globalThis.fetch(`${origin}/delivery/v1/zone?${query}`, { headers: { Authorization: `Bearer ${key}` } });
        }

        function deliverSlug(key: string | undefined, slug: string | string[] | undefined): Promise<Response> {
          const headers: Record<string, string> = {};
          if (key !== undefined) headers['Authorization'] = `Bearer ${key}`;
          const query =
            slug === undefined ? ''
            : Array.isArray(slug) ? `?${slug.map((s) => `zone=${encodeURIComponent(s)}`).join('&')}`
            : `?zone=${encodeURIComponent(slug)}`;
          return globalThis.fetch(`${origin}/delivery/v1/zone${query}`, { headers });
        }

        // A refusal on the site key path: 401 with exactly this body, whatever was wrong.
        const REFUSED = { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } };

        async function expectRefused(res: Response): Promise<void> {
          expect(res.status).toBe(401);
          expect(res.headers.get('access-control-allow-origin')).toBe('*');
          expect(res.headers.get('www-authenticate')).toBe('Bearer');
          // Never kept by a browser or a shared cache.
          expect(res.headers.get('cache-control')).toBe('no-store');
          expect(await res.json()).toEqual(REFUSED);
        }

        // A zone of `projectId` with a display and one live group with one tale from media.
        async function placedZone(
          projectId: string,
          name: string,
          type: 'bar' | 'banner' = 'bar',
        ): Promise<{ id: string; slug: string; groupId: string; taleId: string }> {
          const zone = await (await post('/zones', { name, projectId })).json();
          expect((await post(`/zones/${zone.id}/frame`, { type })).status).toBe(201);
          const group = await addGroup(zone.id, `${name} group`);
          const tale = await addTale(group.id, `${name} tale`, ['image/png', png]);
          return { id: zone.id, slug: zone.slug, groupId: group.id, taleId: tale.id };
        }

        async function zoneVisibility(zoneId: string): Promise<{ visible: boolean; reasons: { code: string }[] }> {
          const zones: { id: string; visibility: { visible: boolean; reasons: { code: string }[] } }[] = await (
            await send('GET', '/zones')
          ).json();
          const found = zones.find((z) => z.id === zoneId);
          if (!found) throw new Error(`No zone ${zoneId}`);
          return found.visibility;
        }

        it('issues a site key shown once, stores only its hash, and reports its prefix and date', async () => {
          const project = await createProject();
          const none = await send('GET', siteKeyPath(project.id));
          expect(none.status).toBe(200);
          expect(await none.json()).toBeNull();

          const res = await send('POST', siteKeyPath(project.id));
          expect(res.status).toBe(201);
          // The secret is in this response only: no cache keeps it.
          expect(res.headers.get('cache-control')).toBe('no-store');
          const issued: Issued = await res.json();
          expect(issued.key).toMatch(/^tas_[A-Za-z0-9_-]{43}$/);
          expect(issued.prefix).toBe(issued.key.slice(0, 10));

          const info = await send('GET', siteKeyPath(project.id));
          const text = await info.text();
          expect(JSON.parse(text)).toEqual({ prefix: issued.prefix, createdAt: issued.createdAt });
          expect(text).not.toContain(issued.key);

          const { rows } = await pool.query('SELECT * FROM site_keys');
          expect(rows).toHaveLength(1);
          expect(rows[0].key_hash).toBe(createHash('sha256').update(issued.key).digest('hex'));
          expect(rows[0].prefix).toBe(issued.prefix);
          expect(rows[0].project_id).toBe(project.id);
          expect(JSON.stringify(rows)).not.toContain(issued.key);
        });

        it('rotates: the new key works, the old one is refused, and one key stays active', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Home top');
          const first = await issueSite(project.id);
          expect((await deliverSlug(first.key, zone.slug)).status).toBe(200);

          const second = await issueSite(project.id);
          expect(second.key).not.toBe(first.key);
          await expectRefused(await deliverSlug(first.key, zone.slug));
          expect((await deliverSlug(second.key, zone.slug)).status).toBe(200);
          const { rows } = await pool.query('SELECT count(*)::int AS n FROM site_keys WHERE revoked_at IS NULL');
          expect(rows[0].n).toBe(1);
        });

        it('keeps one active site key per project when issues race', async () => {
          const project = await createProject();
          const results = await Promise.all(Array.from({ length: 6 }, () => send('POST', siteKeyPath(project.id))));
          expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
          const keys: Issued[] = await Promise.all(results.map((r) => r.json()));
          const { rows } = await pool.query('SELECT key_hash FROM site_keys WHERE project_id = $1 AND revoked_at IS NULL', [
            project.id,
          ]);
          expect(rows).toHaveLength(1);
          const zone = await placedZone(project.id, 'Race');
          const working = [];
          for (const issued of keys) if ((await deliverSlug(issued.key, zone.slug)).status === 200) working.push(issued);
          expect(working).toHaveLength(1);
          expect(rows[0].key_hash).toBe(createHash('sha256').update(working[0].key).digest('hex'));
        });

        it('revokes: the key is refused at once, and a second revoke answers site_key_not_found', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Home top');
          const { key } = await issueSite(project.id);
          expect((await send('DELETE', siteKeyPath(project.id))).status).toBe(204);
          await expectRefused(await deliverSlug(key, zone.slug));
          expect(await (await send('GET', siteKeyPath(project.id))).json()).toBeNull();
          const again = await send('DELETE', siteKeyPath(project.id));
          expect(again.status).toBe(404);
          expect((await again.json()).error.code).toBe('site_key_not_found');
        });

        it('keeps one consistent key when a revoke races a rotation', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Race');
          for (let round = 0; round < 8; round++) {
            const old = await issueSite(project.id);
            const [rotated, revoked] = await Promise.all([
              send('POST', siteKeyPath(project.id)),
              send('DELETE', siteKeyPath(project.id)),
            ]);
            expect(rotated.status).toBe(201);
            // The revoke takes the old key or the new one; there is always one to take.
            expect(revoked.status).toBe(204);
            const fresh: Issued = await rotated.json();
            const { rows } = await pool.query('SELECT key_hash FROM site_keys WHERE project_id = $1 AND revoked_at IS NULL', [
              project.id,
            ]);
            await expectRefused(await deliverSlug(old.key, zone.slug));
            if (rows.length === 1) {
              // The revoke ran first: the rotated key is the active one and works.
              expect(rows[0].key_hash).toBe(createHash('sha256').update(fresh.key).digest('hex'));
              expect((await deliverSlug(fresh.key, zone.slug)).status).toBe(200);
              expect((await send('DELETE', siteKeyPath(project.id))).status).toBe(204);
            } else {
              // The rotation ran first, then the revoke took its key: nothing is active.
              expect(rows).toHaveLength(0);
              await expectRefused(await deliverSlug(fresh.key, zone.slug));
            }
          }
        });

        it('limits each address on both key paths with 429 and Retry-After, when the limit is on', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Limited');
          const { key } = await issueSite(project.id);
          const zoneKey = (await (await send('POST', `/zones/${zone.id}/key`)).json()).key;
          const limited = createApp(
            pool,
            loadFrameTypeRegistry(frameTypesDir),
            new LocalDiskStorage(mediaDir),
            { verifier: fakeVerifier },
            { publicApiUrl },
            undefined,
            undefined,
            { rateLimit: { burst: 3, perSecond: 0.5 } },
          ).listen(0);
          await new Promise<void>((resolve) => limited.once('listening', () => resolve()));
          const at = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/delivery/v1/zone`;
          const get = (bearer: string, query = '') =>
            globalThis.fetch(`${at}${query}`, { headers: { Authorization: `Bearer ${bearer}` } });
          try {
            // A preflight is not counted.
            expect((await globalThis.fetch(at, { method: 'OPTIONS' })).status).toBe(204);
            expect((await get(key, `?zone=${zone.slug}`)).status).toBe(200);
            expect((await get(zoneKey)).status).toBe(200);
            // A refusal counts too, so guessing keys or slugs is limited.
            expect((await get(key, '?zone=nope')).status).toBe(401);
            for (const res of [await get(key, `?zone=${zone.slug}`), await get(zoneKey)]) {
              expect(res.status).toBe(429);
              expect(res.headers.get('retry-after')).toBe('2');
              expect(res.headers.get('cache-control')).toBe('no-store');
              expect(res.headers.get('access-control-allow-origin')).toBe('*');
              // A page's script may read it across origins.
              expect(res.headers.get('access-control-expose-headers')).toBe('Retry-After');
              expect((await res.json()).error.code).toBe('rate_limited');
            }
          } finally {
            await new Promise<void>((resolve) => limited.close(() => resolve()));
          }
        });

        it('answers 404 project_not_found for an unknown project, and 403 to a content manager issuing or revoking', async () => {
          for (const method of ['GET', 'POST', 'DELETE']) {
            const res = await send(method, siteKeyPath(unknownId));
            expect(res.status).toBe(404);
            expect((await res.json()).error.code).toBe('project_not_found');
          }
          const project = await createProject();
          const other = await createProject('Globex');
          const issued = await issueSite(project.id);
          await signInAsContentManager(project.id);
          const info = await send('GET', siteKeyPath(project.id));
          expect(info.status).toBe(200);
          expect((await info.json()).prefix).toBe(issued.prefix);
          for (const method of ['POST', 'DELETE']) {
            const res = await send(method, siteKeyPath(project.id));
            expect(res.status).toBe(403);
            expect((await res.json()).error.code).toBe('forbidden');
          }
          // Another project's key is not even readable.
          expect((await send('GET', siteKeyPath(other.id))).status).toBe(403);
          const { rows } = await pool.query('SELECT count(*)::int AS n FROM site_keys WHERE revoked_at IS NULL');
          expect(rows[0].n).toBe(1);
        });

        it("serves each zone of the project by its slug with that zone's own display and groups, as a zone key does", async () => {
          const project = await createProject();
          const top = await placedZone(project.id, 'Home top', 'bar');
          const promo = await placedZone(project.id, 'Home promo', 'banner');
          const { key } = await issueSite(project.id);

          const topRes = await deliverSlug(key, top.slug);
          expect(topRes.status).toBe(200);
          expect(topRes.headers.get('cache-control')).toBe('private, no-cache');
          const topBody = await topRes.json();
          expect(topBody).toMatchObject({ id: top.id, slug: top.slug, frame: { type: 'bar' } });
          expect(topBody.taleGroups.map((g: { id: string }) => g.id)).toEqual([top.groupId]);

          const promoBody = await (await deliverSlug(key, promo.slug)).json();
          expect(promoBody).toMatchObject({ id: promo.id, slug: promo.slug, frame: { type: 'banner' } });
          expect(promoBody.taleGroups.map((g: { id: string }) => g.id)).toEqual([promo.groupId]);

          // The same body a legacy zone key gets for the zone.
          const zoneKey = (await (await send('POST', `/zones/${top.id}/key`)).json()).key;
          expect(await (await deliver(zoneKey)).json()).toEqual(topBody);
        });

        it('refuses an unknown slug exactly like a refused key, and a slug of another project too', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Home top');
          const otherProject = await createProject('Globex');
          const otherZone = await placedZone(otherProject.id, 'Globex only');
          const { key } = await issueSite(project.id);
          const otherKey = (await issueSite(otherProject.id)).key;
          const zoneKey = (await send('POST', `/zones/${zone.id}/key`).then((r) => r.json())).key;

          await expectRefused(await deliverSlug(key, 'nope'));
          await expectRefused(await deliverSlug(key, otherZone.slug));
          await expectRefused(await deliverSlug(key, ''));
          await expectRefused(await deliverSlug(key, [zone.slug, zone.slug]));
          await expectRefused(await deliverSlug(key, 'Home Top'));
          // A bracketed parameter reads as an object, which is no slug.
          await expectRefused(await deliverQuery(key, `zone[${zone.slug}]=${zone.slug}`));
          await expectRefused(await deliverQuery(key, `zone[x]=y`));
          await expectRefused(await deliverSlug(undefined, zone.slug));
          await expectRefused(await deliverSlug(`tas_${randomBytes(32).toString('base64url')}`, zone.slug));
          await expectRefused(await deliverSlug(key.toUpperCase(), zone.slug));
          // A zone key is no site key, even for its own zone's slug.
          await expectRefused(await deliverSlug(zoneKey, zone.slug));
          // Each key reads its own project only.
          expect((await deliverSlug(otherKey, otherZone.slug)).status).toBe(200);
          await expectRefused(await deliverSlug(otherKey, zone.slug));

          // Without a slug, the legacy zone key path answers as before.
          expect((await deliver(zoneKey)).status).toBe(200);
          expect(await expectInvalidKey(await deliver(key))).toBe('A valid zone key is required');
        });

        it('counts a zone as installed while its project has a site key, with the same rule for public media', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Home top');
          const other = await createProject('Globex');
          const otherZone = await placedZone(other.id, 'Globex top');
          const reasons = async (id: string) => (await zoneVisibility(id)).reasons.map((r) => r.code);
          expect(await reasons(zone.id)).toEqual(['zone-not-installed']);

          const { key } = await issueSite(project.id);
          expect(await zoneVisibility(zone.id)).toEqual(VISIBLE);
          // Isolation: another project's zone is not installed by this key.
          expect(await reasons(otherZone.id)).toEqual(['zone-not-installed']);
          const delivered = await (await deliverSlug(key, zone.slug)).json();
          const mediaUrl = delivered.taleGroups[0].tales[0].media.url;
          expect((await getPublic(mediaUrl)).status).toBe(200);

          // The tale and its group read visible too, by the same rule.
          const groups = await (await send('GET', `/zones/${zone.id}/tale-groups`)).json();
          expect(groups[0].visibility).toEqual(VISIBLE);
          expect(groups[0].tales[0].visibility).toEqual(VISIBLE);

          expect((await send('DELETE', siteKeyPath(project.id))).status).toBe(204);
          expect(await reasons(zone.id)).toEqual(['zone-not-installed']);
          expect((await getPublic(mediaUrl)).status).toBe(404);

          // A legacy zone key still installs its own zone alone.
          await send('POST', `/zones/${zone.id}/key`);
          expect(await zoneVisibility(zone.id)).toEqual(VISIBLE);
          expect((await getPublic(mediaUrl)).status).toBe(200);
        });
      });

      it('serves the tale groups and tales in dashboard order with absolute public media URLs', async () => {
        const zone = await createZone();
        await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
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
              {
                id: a1.id,
                title: 'A1',
                media: { kind: 'image', contentType: 'image/png', url: expect.stringMatching(mediaUrl) },
                // Every tale is delivered as a document (R16): its media is its document's `taleMedia` element.
                document: mediaDocument('image', expect.stringMatching(mediaUrl)),
              },
              { id: a2.id, title: 'A2', media: null, document: NO_MEDIA_DOCUMENT },
            ],
          },
          {
            id: b.id,
            name: 'B',
            cover: null,
            tales: [
              {
                id: b1.id,
                title: 'B1',
                media: { kind: 'video', contentType: 'video/mp4', url: expect.stringMatching(mediaUrl) },
                document: mediaDocument('video', expect.stringMatching(mediaUrl)),
              },
            ],
          },
        ]);
        const [a1Media] = body.taleGroups[0].tales;
        expect(a1Media.document.elements[0].props.url).toBe(a1Media.media.url);
        // No project id or Management API media path in the Delivery response (AD-13).
        expect(text).not.toContain(zone.projectId);
        expect(text).not.toContain('/api/v1');
      });

      it('answers an empty taleGroups list for a zone without tale groups', async () => {
        const zone = await createZone();
        const { key } = await issue(zone.id);
        expect((await (await deliver(key)).json()).taleGroups).toEqual([]);
      });

      it("delivers a tale's document without hidden elements or editor-only fields (AD-15)", async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        const tale = await addTale(group.id, 'A1', ['image/png', png]);
        const shown = '00000000-0000-4000-8000-0000000000a1';
        const hidden = '00000000-0000-4000-8000-0000000000a2';
        const element = (id: string, text: string, extra: object) => ({
          id,
          type: 'text',
          box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
          a11y: {},
          props: { text },
          ...extra,
        });
        const document = {
          version: 1,
          canvas: { background: { type: 'color', color: '#000000' } },
          elements: [
            element(shown, '<b>x</b>', { hidden: false, locked: true }),
            element(hidden, 'Secret', { hidden: true, locked: false }),
          ],
        };
        // The media upload made the tale's draft and published documents (R16): revision 1 each.
        const saved = await fetch(`${base}/tales/${tale.id}/document`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document, revision: 1 }),
        });
        expect(saved.status).toBe(200);
        const { key } = await issue(zone.id);
        // Saved as the draft only: visitors see nothing of it until it is published.
        expect((await (await deliver(key)).json()).taleGroups[0].tales[0].document).toEqual(
          mediaDocument('image', expect.stringMatching(mediaUrl)),
        );
        const published = await fetch(`${base}/tales/${tale.id}/document/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: 2, publishedRevision: 1 }),
        });
        expect(published.status).toBe(200);
        const text = await (await deliver(key)).text();
        expect(JSON.parse(text).taleGroups[0].tales[0].document).toEqual({
          version: 1,
          canvas: { background: { type: 'color', color: '#000000' } },
          elements: [element(shown, '<b>x</b>', {})],
        });
        expect(text).not.toContain('Secret');
        expect(text).not.toContain('"locked"');
        expect(text).not.toContain('"hidden"');

        // A stored document that no longer validates is not delivered: the tale shows its media only.
        await pool.query(`UPDATE tales SET document = '{"version": 9}'::jsonb WHERE id = $1`, [tale.id]);
        const media = (await (await deliver(key)).json()).taleGroups[0].tales[0];
        expect(media.document).toEqual(mediaDocument('image', media.media.url, tale.id));
        expect(media.media.url).toMatch(mediaUrl);
      });

      it('delivers the arranged order, the background colour and only the shown layers (Tale Studio story 2)', async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        const tale = await addTale(group.id, 'A1', ['image/png', png]);
        const id = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;
        const element = (n: number, hidden: boolean, locked: boolean) => ({
          id: id(n),
          type: 'text',
          box: { x: 0.1, y: 0.4 + n / 100, w: 0.8, h: 0.1, rotation: 0 },
          hidden,
          locked,
          a11y: {},
          props: { text: `T${n}` },
        });
        const put = (elements: object[], revision: number, color = '#112233') =>
          fetch(`${base}/tales/${tale.id}/document`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document: { version: 1, canvas: { background: { type: 'color', color } }, elements },
              revision,
            }),
          });
        // Revision 1 of each is the media upload's (R16).
        expect(
          (await put([element(1, false, false), element(2, false, false), element(3, false, false)], 1)).status,
        ).toBe(200);
        // Reordered (2 to the front), 1 hidden, 3 locked: saved as the next revision.
        expect(
          (await put([element(3, false, true), element(1, true, false), element(2, false, false)], 2)).status,
        ).toBe(200);
        const publish = await fetch(`${base}/tales/${tale.id}/document/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: 3, publishedRevision: 1 }),
        });
        expect(publish.status).toBe(200);
        const { key } = await issue(zone.id);
        const delivered = (await (await deliver(key)).json()).taleGroups[0].tales[0].document;
        expect(delivered.canvas).toEqual({ background: { type: 'color', color: '#112233' } });
        expect(delivered.elements.map((e: { id: string }) => e.id)).toEqual([id(3), id(2)]);
        expect(delivered.elements[0]).not.toHaveProperty('locked');
        // A colour that is not hex is refused, naming its pointer.
        const bad = await put([], 3, 'red; background:url(x)');
        expect(bad.status).toBe(400);
        expect((await bad.json()).error.pointer).toBe('/canvas/background/color');
      });

      it('never changes what visitors see on a save: only publishing does (story 7.3)', async () => {
        const zone = await createZone();
        const group = await addGroup(zone.id, 'A');
        const tale = await addTale(group.id, 'A1', ['image/png', png]);
        const document = (text: string) => ({
          version: 1,
          canvas: { background: { type: 'color', color: '#000000' } },
          elements: [
            {
              id: '00000000-0000-4000-8000-0000000000c1',
              type: 'text',
              box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
              hidden: false,
              locked: false,
              a11y: {},
              props: { text },
            },
          ],
        });
        const call = (path: string, method: string, body: unknown) =>
          fetch(`${base}/tales/${tale.id}/document${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        const { key } = await issue(zone.id);
        const deliveredText = async () =>
          (await (await deliver(key)).json()).taleGroups[0].tales[0].document?.elements[0]?.props.text ?? null;

        // Revision 1 of each is the media upload's (R16).
        expect((await call('', 'PUT', { document: document('Live'), revision: 1 })).status).toBe(200);
        expect((await call('/publish', 'POST', { revision: 2, publishedRevision: 1 })).status).toBe(200);
        expect(await deliveredText()).toBe('Live');
        // Autosaves of a live tale: the visitor still sees the published version.
        for (let revision = 2; revision <= 4; revision++) {
          expect((await call('', 'PUT', { document: document(`Draft ${revision - 1}`), revision })).status).toBe(200);
          expect(await deliveredText()).toBe('Live');
        }
        // Discarding the draft does not change it either; publishing does.
        expect((await call('/publish', 'POST', { revision: 5, publishedRevision: 2 })).status).toBe(200);
        expect(await deliveredText()).toBe('Draft 3');
        expect((await call('', 'PUT', { document: document('Oops'), revision: 5 })).status).toBe(200);
        expect((await call('/discard', 'POST', { revision: 6, publishedRevision: 3 })).status).toBe(200);
        expect(await deliveredText()).toBe('Draft 3');
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

        // Media never needs the key, but a zone whose key is revoked is not installed, so nothing
        // shows in it and its media is private until it has a key again (epic UX rework R7).
        await send('DELETE', `/zones/${zone.id}/key`);
        expect((await getPublic(url)).status).toBe(404);
        await issue(zone.id);
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

        async function delivered(key: string): Promise<
          {
            name: string;
            tales: { title: string; media: { url: string } | null }[];
          }[]
        > {
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

        it('starts new groups Off (draft) and new tales Shown (live): turning the group On delivers its tales', async () => {
          const zone = await createZone();
          const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'New' })).json();
          expect([group.status, group.storedStatus]).toEqual(['draft', 'draft']);
          const t1 = await addTale(group.id, 'T1', ['image/png', png]);
          const t2 = await addTale(group.id, 'T2', ['image/gif', gif]);
          // Stored live, so Shown; the group is Off (draft), so each reads blocked by group (AD-6 amended).
          expect((await zoneGroups(zone.id))[0].tales.map((t) => [t.title, t.storedStatus, t.status])).toEqual([
            ['T1', 'live', 'blocked-by-group'],
            ['T2', 'live', 'blocked-by-group'],
          ]);
          const { key } = await issue(zone.id);
          expect(await delivered(key)).toEqual([]);

          const on: Group = await expectStatus('tale-groups', group.id, 'live', 200);
          expect(on.tales.map((t) => [t.id, t.status])).toEqual([
            [t1.id, 'live'],
            [t2.id, 'live'],
          ]);
          // No tale was published by hand: uploading its media published its document.
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['T1', 'T2']);
        });

        it('hides a tale and turns a group Off by storing paused; showing and turning On store live', async () => {
          const { zone, group, l1, l2, key } = await liveZone();
          const hidden = await expectStatus('tales', l1.id, 'paused', 200);
          expect([hidden.storedStatus, hidden.status]).toEqual(['paused', 'paused']);
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L2']);

          const off: Group = await expectStatus('tale-groups', group.id, 'paused', 200);
          // The hidden tale stays Hidden; the shown one reads blocked by group.
          expect(off.tales.map((t) => [t.title, t.storedStatus, t.status])).toEqual([
            ['L1', 'paused', 'paused'],
            ['L2', 'live', 'blocked-by-group'],
          ]);
          expect(await delivered(key)).toEqual([]);

          await expectStatus('tale-groups', group.id, 'live', 200);
          await expectStatus('tales', l1.id, 'live', 200);
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L1', 'L2']);
          expect((await zoneGroups(zone.id))[0].tales.map((t) => [t.id, t.storedStatus, t.status])).toEqual([
            [l1.id, 'live', 'live'],
            [l2.id, 'live', 'live'],
          ]);
        });

        it('reads the live tales of a draft group and of a paused group as blocked by group', async () => {
          const zone = await createZone();
          const draft = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Draft' })).json();
          const paused = await addGroup(zone.id, 'Paused');
          const a = await addTale(draft.id, 'A', ['image/png', png]);
          const b = await addTale(paused.id, 'B', ['image/png', png]);
          await expectStatus('tale-groups', paused.id, 'paused', 200);
          const groups = await zoneGroups(zone.id);
          expect(groups.map((g) => [g.status, g.tales.map((t) => [t.id, t.status])])).toEqual([
            ['draft', [[a.id, 'blocked-by-group']]],
            ['paused', [[b.id, 'blocked-by-group']]],
          ]);
        });

        it('does not deliver a Shown tale with nothing published (AD-15) until its document is updated', async () => {
          const { group, key } = await liveZone();
          const studio = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Studio' })).json();
          expect(studio.storedStatus).toBe('live');
          const document = {
            version: 1,
            canvas: { background: { type: 'color', color: '#112233' } },
            elements: [
              {
                id: '00000000-0000-4000-8000-0000000000a1',
                type: 'text',
                box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
                hidden: false,
                locked: false,
                a11y: {},
                props: { text: 'Hello' },
              },
            ],
          };
          const put = (path: string, method: string, body: unknown) =>
            fetch(`${base}/tales/${studio.id}/document${path}`, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
          expect((await put('', 'PUT', { document, revision: 0 })).status).toBe(200);
          // Live and in a live group, but only a draft: not delivered, and neither is a title-only tale.
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L1', 'L2']);

          expect((await put('/publish', 'POST', { revision: 1, publishedRevision: 0 })).status).toBe(200);
          expect((await delivered(key))[0].tales.map((t) => t.title)).toEqual(['L1', 'L2', 'Studio']);
        });

        it('leaves out a group whose only Shown tale has nothing published', async () => {
          const zone = await createZone();
          const group = await addGroup(zone.id, 'Empty');
          await post(`/tale-groups/${group.id}/tales`, { title: 'Nothing yet' });
          const { key } = await issue(zone.id);
          expect(await delivered(key)).toEqual([]);
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
          await expectStatus('tales', tale.id, 'paused', 403, 'forbidden');
          const { rows } = await pool.query('SELECT status FROM tale_groups UNION ALL SELECT status FROM tales');
          expect(rows).toEqual([{ status: 'draft' }, { status: 'live' }]);
        });

        it('refuses a change the transitions do not allow with 409, changing nothing', async () => {
          const zone = await createZone();
          const draft = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Draft' })).json();
          const tale = await (await post(`/tale-groups/${draft.id}/tales`, { title: 'T' })).json();
          // A draft tale, as from before the UX rework or a kept copy: already Hidden, so it cannot be paused.
          await pool.query("UPDATE tales SET status = 'draft' WHERE id = $1", [tale.id]);
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
          // Hidden before its media is uploaded, so it never shows.
          await expectStatus('tales', draftTale.id, 'paused', 200);
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
          await postKey(target.id);
          const res = await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id });
          expect(res.status).toBe(201);
          const copy: Group = await res.json();
          expect(copy.status).toBe('draft');
          expect(copy.tales.map((t) => [t.title, t.storedStatus, t.status])).toEqual([
            ['L1', 'live', 'blocked-by-group'],
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

        it('hides a group whose start is ahead, and shows it once the start passes; its media is public only then', async () => {
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

        it('skips a tale past its end: the group starts with its next tale, the tale reads expired and its media answers 404', async () => {
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

        it('hides every tale of an expired group, even tales inside their own window', async () => {
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
          // A draft tale (from before the UX rework, or a kept copy) reads draft whatever its window.
          await pool.query("UPDATE tales SET status = 'draft' WHERE id = $1", [draft.id]);
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
          await postKey(target.id);
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

    it('refuses a zone key route in a project the caller cannot access', async () => {
      const zone = await createZone();
      const other = await createProject('Beta');
      await signInAsContentManager(other.id);
      const res = await send('GET', `/zones/${zone.id}/key`);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    });
  });

  describe('project fonts (epic Tale Studio R18, story 7.17)', () => {
    const FACE = { family: 'Brand Sans', weight: '700', style: 'italic', fallback: 'serif', licence: 'confirmed' };
    const unknownId = '00000000-0000-4000-8000-000000000000';

    // A structurally sound WOFF2 file: TrueType flavour, one untransformed table, compressed data after.
    function woff2(size = 2048): Buffer {
      const data = Buffer.alloc(size, 7);
      data.fill(0, 0, 50);
      data.write('wOF2', 0, 'latin1');
      data.writeUInt32BE(0x00010000, 4);
      data.writeUInt32BE(size, 8);
      data.writeUInt16BE(1, 12);
      data.writeUInt32BE(1024, 16);
      data.writeUInt32BE(size - 50, 20);
      data[49] = 0x10;
      return data;
    }

    function upload(
      projectId: string,
      query: Record<string, string> = FACE,
      body: Uint8Array = woff2(),
      contentType = 'font/woff2',
    ): Promise<Response> {
      return fetch(`${base}/projects/${projectId}/fonts?${new URLSearchParams(query)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
    }

    async function uploaded(projectId: string, query: Record<string, string> = FACE): Promise<{ id: string }> {
      const res = await upload(projectId, query);
      expect(res.status).toBe(201);
      return res.json();
    }

    function list(projectId: string): Promise<Response> {
      return fetch(`${base}/projects/${projectId}/fonts`);
    }

    function remove(projectId: string, fontId: string): Promise<Response> {
      return fetch(`${base}/projects/${projectId}/fonts/${fontId}`, { method: 'DELETE' });
    }

    function storedFonts(): string[] {
      const dir = join(mediaDir, 'fonts');
      return existsSync(dir) ? readdirSync(dir) : [];
    }

    function text(n: number, font: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        type: 'text',
        box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: 'Sale', font, fallback: 'serif' },
        ...extra,
      };
    }

    function doc(elements: unknown[]): Record<string, unknown> {
      return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements };
    }

    async function draftOf(
      taleId: string,
    ): Promise<{ document: unknown; revision: number; published: { revision: number } }> {
      return (await fetch(`${base}/tales/${taleId}/document`)).json();
    }

    function save(taleId: string, document: unknown, revision: number): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, revision }),
      });
    }

    async function publishDraft(taleId: string): Promise<void> {
      const state = await draftOf(taleId);
      const res = await post(`/tales/${taleId}/document/publish`, {
        revision: state.revision,
        publishedRevision: state.published.revision,
      });
      expect(res.status).toBe(200);
    }

    // A zone with a key, holding a live group with one live tale whose draft uses `elements`.
    async function liveTale(elements: (fontId: string) => unknown[]) {
      const zone = await createZone();
      const font = await uploaded(zone.projectId);
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      // Hidden, so showing it later publishes its draft, as going live does (AD-15).
      expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
      expect((await save(tale.id, doc(elements(font.id)), 0)).status).toBe(200);
      const { key } = await (await postKey(zone.id)).json();
      return { zone, font, group, tale, key: key as string };
    }

    async function delivered(key: string) {
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(200);
      return (await res.json()).taleGroups as { tales: { id: string; fonts?: { id: string; url: string }[] }[] }[];
    }

    function getPublic(url: string, headers: Record<string, string> = {}): Promise<Response> {
      return globalThis.fetch(`${origin}${new URL(url).pathname}`, { headers });
    }

    async function signInAsContentManager(projectId: string): Promise<void> {
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, projectId, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
    }

    beforeEach(() => rmSync(join(mediaDir, 'fonts'), { recursive: true, force: true }));

    it('uploads a WOFF2 face with the licence confirmed, and lists it with the uploader and time', async () => {
      const project = await createProject();
      const res = await upload(project.id);
      expect(res.status).toBe(201);
      const font = await res.json();
      expect(font).toEqual({
        id: expect.any(String),
        projectId: project.id,
        family: 'Brand Sans',
        weight: 700,
        style: 'italic',
        fallback: 'serif',
        sizeBytes: 2048,
        licenceConfirmedBy: { id: expect.any(String), name: 'Test Admin' },
        licenceConfirmedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        inUse: false,
      });
      expect(await (await list(project.id)).json()).toEqual([font]);
      expect(storedFonts()).toHaveLength(1);

      const file = await fetch(`${base}/projects/${project.id}/fonts/${font.id}/file`);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('font/woff2');
      expect(file.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await file.arrayBuffer()).equals(woff2())).toBe(true);
      // The ETag is opaque: it does not tell the storage key.
      expect(file.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
      expect(file.headers.get('etag')).not.toContain('fonts');
      const again = await fetch(`${base}/projects/${project.id}/fonts/${font.id}/file`, {
        headers: { 'If-None-Match': file.headers.get('etag') ?? '' },
      });
      expect(again.status).toBe(304);
    });

    it('takes font/woff2 or application/octet-stream only, types a form cannot send without preflight', async () => {
      const project = await createProject();
      expect((await upload(project.id, FACE, woff2(), 'application/octet-stream')).status).toBe(201);
      for (const type of ['application/json', 'text/plain', 'multipart/form-data; boundary=x', 'font/ttf', '']) {
        const res = await upload(project.id, { ...FACE, weight: '400' }, woff2(), type);
        expect(res.status, type).toBe(415);
        expect((await res.json()).error.code).toBe('unsupported_media_type');
      }
      expect(storedFonts()).toHaveLength(1);
    });

    it('refuses a compressed body and closes the connection on an early refusal', async () => {
      const project = await createProject();
      const gzip = await fetch(`${base}/projects/${project.id}/fonts?${new URLSearchParams(FACE)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'font/woff2', 'Content-Encoding': 'gzip' },
        body: woff2(),
      });
      expect(gzip.status).toBe(415);
      const early = await upload(project.id, { ...FACE, family: 'inherit' });
      expect(early.status).toBe(400);
      expect(early.headers.get('connection')).toBe('close');
      expect(storedFonts()).toEqual([]);
    });

    it('collapses spaces in a family before comparing, and caps a project at 50 faces and 10 MB', async () => {
      const project = await createProject();
      const first = await (await upload(project.id, { ...FACE, family: '  Brand   Sans ' })).json();
      expect(first.family).toBe('Brand Sans');
      const same = await upload(project.id, { ...FACE, family: 'brand  sans' });
      expect((await same.json()).error.code).toBe('font_exists');

      const add = (count: number, bytes: number) =>
        pool.query(
          `INSERT INTO project_fonts (project_id, family, weight, style, fallback, storage_key, size_bytes, uploaded_by_name)
           SELECT $1::uuid, 'Filler ' || n, 400, 'normal', 'sans', 'fonts/filler-' || $1::text || '-' || n || '.woff2', $3, 'x'
           FROM generate_series(1, $2) AS n`,
          [project.id, count, bytes],
        );
      await add(48, 1024);
      expect((await upload(project.id, { ...FACE, family: 'Second' })).status).toBe(201);
      const full = await upload(project.id, { ...FACE, family: 'Third' });
      expect(full.status).toBe(409);
      expect((await full.json()).error.code).toBe('font_limit_reached');

      const other = await createProject('Beta');
      await pool.query(
        `INSERT INTO project_fonts (project_id, family, weight, style, fallback, storage_key, size_bytes, uploaded_by_name)
         VALUES ($1, 'Big', 400, 'normal', 'sans', 'fonts/big.woff2', $2, 'x')`,
        [other.id, 10 * 1024 * 1024 - 1024],
      );
      const heavy = await upload(other.id);
      expect(heavy.status).toBe(413);
      expect((await heavy.json()).error.code).toBe('font_storage_full');
      expect(storedFonts()).toHaveLength(2);
    });

    it('refuses a TrueType file renamed to .woff2, a WOFF 1 file, an SVG and HTML, storing nothing', async () => {
      const project = await createProject();
      const ttf = Buffer.alloc(2048);
      ttf.writeUInt32BE(0x00010000, 0);
      const woff1 = woff2();
      woff1.write('wOFF', 0, 'latin1');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'.padEnd(64));
      const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64));
      for (const body of [ttf, woff1, svg, html]) {
        const res = await upload(project.id, FACE, body);
        expect(res.status).toBe(415);
        expect((await res.json()).error.code).toBe('unsupported_media_type');
      }
      expect(await (await list(project.id)).json()).toEqual([]);
      expect(storedFonts()).toEqual([]);
    });

    it('refuses a file over 500 KB, and an empty one', async () => {
      const project = await createProject();
      const res = await upload(project.id, FACE, woff2(600 * 1024));
      expect(res.status).toBe(413);
      expect((await res.json()).error.code).toBe('media_too_large');
      expect((await upload(project.id, FACE, woff2(500 * 1024))).status).toBe(201);
      const empty = await upload(project.id, { ...FACE, weight: '400' }, new Uint8Array(0));
      expect(empty.status).toBe(400);
      expect(storedFonts()).toHaveLength(1);
    });

    it('refuses a family, weight, style or fallback outside the rules, naming the field', async () => {
      const project = await createProject();
      const cases: [Record<string, string>, RegExp][] = [
        [{ ...FACE, family: 'inherit' }, /family/],
        [{ ...FACE, family: 'Brand, Arial' }, /family/],
        [{ ...FACE, family: '"Brand"' }, /family/],
        [{ ...FACE, family: 'x;color:red' }, /family/],
        [{ ...FACE, family: 'a'.repeat(101) }, /family/],
        [{ ...FACE, family: '' }, /family/],
        [{ ...FACE, weight: '950' }, /weight/],
        [{ ...FACE, weight: '150' }, /weight/],
        [{ ...FACE, weight: 'bold' }, /weight/],
        [{ ...FACE, style: 'oblique' }, /style/],
        [{ ...FACE, fallback: 'cursive' }, /fallback/],
      ];
      for (const [query, field] of cases) {
        const res = await upload(project.id, query);
        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(error.code).toBe('validation_failed');
        expect(error.message).toMatch(field);
      }
      const unconfirmed = Object.fromEntries(Object.entries(FACE).filter(([name]) => name !== 'licence'));
      for (const query of [unconfirmed, { ...FACE, licence: 'yes' }]) {
        const res = await upload(project.id, query);
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toMatch(/distribute/);
      }
      expect(storedFonts()).toEqual([]);
    });

    it('refuses a second face with the same family (in any case), weight and style', async () => {
      const project = await createProject();
      await uploaded(project.id);
      const res = await upload(project.id, { ...FACE, family: 'brand sans' });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('font_exists');
      expect(storedFonts()).toHaveLength(1);
      expect((await upload(project.id, { ...FACE, style: 'normal' })).status).toBe(201);
    });

    it('answers 404 for an unknown project and 403 for a project the caller cannot access', async () => {
      expect((await upload(unknownId)).status).toBe(404);
      expect((await list(unknownId)).status).toBe(404);
      const project = await createProject();
      const font = await uploaded(project.id);
      const other = await createProject('Beta');
      await signInAsContentManager(other.id);
      expect((await list(project.id)).status).toBe(403);
      expect((await upload(project.id)).status).toBe(403);
      expect((await remove(project.id, font.id)).status).toBe(403);
      expect((await fetch(`${base}/projects/${project.id}/fonts/${font.id}/file`)).status).toBe(403);
      // A font is reached only through its own project.
      expect((await remove(other.id, font.id)).status).toBe(404);
      expect((await fetch(`${base}/projects/${other.id}/fonts/${font.id}/file`)).status).toBe(404);
    });

    it("saves a document that uses the project's font, and refuses another project's or an unknown one", async () => {
      const zone = await createZone();
      const font = await uploaded(zone.projectId);
      const otherProject = await createProject('Beta');
      const foreign = await uploaded(otherProject.id);
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();

      for (const id of [foreign.id, unknownId]) {
        const res = await save(
          tale.id,
          doc([text(1, { source: 'system', stack: 'sans' }), text(2, { source: 'project', fontId: id })]),
          0,
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({
          code: 'invalid_tale_document',
          pointer: '/elements/1/props/font/fontId',
        });
      }
      const mixed = await save(tale.id, doc([text(1, { source: 'project', fontId: font.id, family: 'Brand' })]), 0);
      expect((await mixed.json()).error.pointer).toBe('/elements/0/props/font/family');
      const bad = await save(tale.id, doc([text(1, { source: 'project', fontId: 'brand' })]), 0);
      expect((await bad.json()).error.pointer).toBe('/elements/0/props/font/fontId');

      const ok = await save(tale.id, doc([text(1, { source: 'project', fontId: font.id.toUpperCase() })]), 0);
      expect(ok.status).toBe(200);
      expect((await ok.json()).document.elements[0].props.font).toEqual({ source: 'project', fontId: font.id });
      // Keeping a refused version as a new tale checks its fonts the same way.
      const copy = await fetch(`${base}/tales/${tale.id}/document/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc([text(1, { source: 'project', fontId: foreign.id })]) }),
      });
      expect(copy.status).toBe(400);
    });

    it('refuses deleting a font a draft or a published document uses, and deletes it with its file after', async () => {
      const { zone, font, tale } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      expect((await (await list(zone.projectId)).json())[0].inUse).toBe(true);
      const inDraft = await remove(zone.projectId, font.id);
      expect(inDraft.status).toBe(409);
      expect((await inDraft.json()).error).toEqual({ code: 'font_in_use', message: expect.stringContaining('Beach') });

      await publishDraft(tale.id);
      expect((await save(tale.id, doc([text(1, { source: 'system', stack: 'sans' })]), 1)).status).toBe(200);
      // The published document still uses it.
      expect((await remove(zone.projectId, font.id)).status).toBe(409);
      await publishDraft(tale.id);
      expect((await (await list(zone.projectId)).json())[0].inUse).toBe(false);

      expect((await remove(zone.projectId, font.id)).status).toBe(204);
      expect(await (await list(zone.projectId)).json()).toEqual([]);
      expect(storedFonts()).toEqual([]);
      expect((await remove(zone.projectId, font.id)).status).toBe(404);
    });

    it('serves the font publicly only while a delivered tale’s published document uses it', async () => {
      const { group, font, tale, key } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts WHERE id = $1', [font.id])).rows[0]
        .storage_key as string;
      const url = `${publicApiUrl}/media/${fontKey}`;
      // A draft only: nothing is public, and the zone is not delivered yet.
      expect((await getPublic(url)).status).toBe(404);
      await publish('tale-groups', group.id);
      await publish('tales', tale.id); // Going live publishes the draft (AD-15).

      const [{ tales }] = await delivered(key);
      expect(tales[0].fonts).toEqual([{ id: font.id, url, weight: 700, style: 'italic' }]);
      const res = await getPublic(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('font/woff2');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await res.arrayBuffer()).equals(woff2())).toBe(true);
      expect((await getPublic(url, { 'If-None-Match': `"${fontKey}"` })).status).toBe(304);

      // Pausing the tale makes it private again, and the 304 is not given either.
      expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
      expect((await getPublic(url)).status).toBe(404);
      expect((await getPublic(url, { 'If-None-Match': `"${fontKey}"` })).status).toBe(404);
    });

    it('backfills tale_fonts for documents written before it, and serves a font only with a deliverable document', async () => {
      const { zone, group, font, tale, key } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      await publish('tale-groups', group.id);
      await publish('tales', tale.id);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts WHERE id = $1', [font.id])).rows[0]
        .storage_key as string;
      const url = `${publicApiUrl}/media/${fontKey}`;
      expect((await getPublic(url)).status).toBe(200);

      // As before tale_fonts: the rows are gone; the migration writes them again.
      await pool.query('DELETE FROM tale_fonts');
      await migrate(pool);
      const rows = await pool.query('SELECT document, delivered FROM tale_fonts WHERE font_id = $1 ORDER BY document', [
        font.id,
      ]);
      expect(rows.rows).toEqual([
        { document: 'draft', delivered: false },
        { document: 'published', delivered: true },
      ]);
      expect((await (await list(zone.projectId)).json())[0].inUse).toBe(true);

      // A published document that no longer passes the document check is not delivered, so its
      // font is not public either: the two agree.
      await pool.query(
        `UPDATE tales SET document = jsonb_set(document, '{canvas,background,color}', '"red"') WHERE id = $1`,
        [tale.id],
      );
      clearDeliveryCache();
      await pool.query('DELETE FROM tale_fonts');
      await migrate(pool);
      clearPublicFontCache();
      const [{ tales }] = await delivered(key);
      expect(tales[0].fonts).toBeUndefined();
      expect((await getPublic(url)).status).toBe(404);
    });

    it('keeps a font private while the only shown tale using it has nothing published (AD-6 amended)', async () => {
      const { group, tale } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      // Shown without going live, so nothing is published: "not updated yet".
      await pool.query("UPDATE tales SET status = 'live' WHERE id = $1", [tale.id]);
      await publish('tale-groups', group.id);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts')).rows[0].storage_key as string;
      clearPublicFontCache();
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(404);

      await publishDraft(tale.id);
      clearPublicFontCache();
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(200);
    });

    it('keeps a font private when only a hidden element or an unplaced group uses it', async () => {
      const hidden = await liveTale((id) => [text(1, { source: 'project', fontId: id }, { hidden: true })]);
      await publish('tale-groups', hidden.group.id);
      await publish('tales', hidden.tale.id);
      const [{ tales }] = await delivered(hidden.key);
      expect(tales[0].fonts).toBeUndefined();
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts')).rows[0].storage_key as string;
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(404);

      // Shown, but its group placed in no zone: not delivered, so not public.
      expect(
        (await save(hidden.tale.id, doc([text(1, { source: 'project', fontId: hidden.font.id })]), 1)).status,
      ).toBe(200);
      await publishDraft(hidden.tale.id);
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(200);
      const placed = await fetch(`${base}/zones/${hidden.zone.id}/tale-groups/${hidden.group.id}`, {
        method: 'DELETE',
      });
      expect(placed.status).toBe(204);
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(404);
    });

    it('keeps a font private while its group is placed only in a zone without a display (R7)', async () => {
      const shown = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      await publish('tale-groups', shown.group.id);
      await publish('tales', shown.tale.id);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts')).rows[0].storage_key as string;
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(200);
      const bare = await (await post('/zones', { name: 'Bare', projectId: shown.zone.projectId })).json();
      expect((await fetch(`${base}/zones/${bare.id}/tale-groups/${shown.group.id}`, { method: 'PUT' })).status).toBe(201);
      expect((await fetch(`${base}/zones/${shown.zone.id}/tale-groups/${shown.group.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await getPublic(`${publicApiUrl}/media/${fontKey}`)).status).toBe(404);
    });

    it('draws project-font texts in their fallback stack in a copy in another project', async () => {
      const { zone, group, font } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      const fontOf = async (copy: { tales: { id: string }[] }) =>
        ((await draftOf(copy.tales[0].id)).document as { elements: { props: { font: unknown } }[] }).elements[0].props
          .font;
      const same = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: zone.id })).json();
      expect(await fontOf(same)).toEqual({ source: 'project', fontId: font.id });
      const target = await createZone();
      const other = await (await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id })).json();
      expect(await fontOf(other)).toEqual({ source: 'system', stack: 'serif' });
    });
  });

  describe('images and video in tale documents (epic Tale Studio R5, story 7.5)', () => {
    const MB = 1024 * 1024;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const gif = Buffer.from('GIF89a-tiny-gif');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 1, 2]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom-tiny-mp4')]);

    function upload(projectId: string, contentType: string, body: Uint8Array, headers: Record<string, string> = {}) {
      return fetch(`${base}/projects/${projectId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, ...headers },
        body,
      });
    }

    async function uploaded(projectId: string, contentType = 'image/png', body: Uint8Array = png): Promise<string> {
      const res = await upload(projectId, contentType, body);
      expect(res.status).toBe(201);
      return (await res.json()).key;
    }

    function element(n: number, type: 'image' | 'video', mediaKey: string, extra: Record<string, unknown> = {}) {
      return {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        type,
        box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, rotation: 20 },
        hidden: false,
        locked: false,
        a11y: { label: `Element ${n}` },
        props: { mediaKey, fit: 'cover', radius: 0.04, opacity: 0.9 },
        ...extra,
      };
    }

    function doc(elements: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
      return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements, ...extra };
    }

    async function state(taleId: string): Promise<{ revision: number; published: { revision: number } }> {
      return (await fetch(`${base}/tales/${taleId}/document`)).json();
    }

    function save(taleId: string, document: unknown, revision: number): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, revision }),
      });
    }

    async function publishDraft(taleId: string): Promise<Response> {
      const s = await state(taleId);
      return post(`/tales/${taleId}/document/publish`, {
        revision: s.revision,
        publishedRevision: s.published.revision,
      });
    }

    function putTaleMedia(taleId: string, contentType: string, body: Uint8Array): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/media`, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
    }

    async function setup() {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      // Hidden, so showing it later publishes its draft, as going live does (AD-15).
      expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
      return { zone, group, tale };
    }

    async function delivered(zoneId: string) {
      const { key } = await (await postKey(zoneId)).json();
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(200);
      return (await res.json()).taleGroups as { tales: { id: string; document: Record<string, unknown> | null }[] }[];
    }

    function getPublic(key: string, headers: Record<string, string> = {}): Promise<Response> {
      return globalThis.fetch(`${origin}/media/${key}`, { headers });
    }

    beforeEach(() => rmSync(join(mediaDir, 'media'), { recursive: true, force: true }));

    it("uploads media to the project, lists it with the tales' media, and serves it with a session", async () => {
      const { zone, tale } = await setup();
      const res = await upload(zone.projectId, 'image/png', png);
      expect(res.status).toBe(201);
      const image = await res.json();
      expect(image).toEqual({
        key: expect.stringMatching(/^media\/[0-9a-f-]{36}\.png$/),
        kind: 'image',
        contentType: 'image/png',
        url: `/api/v1/projects/${zone.projectId}/media/file?key=${encodeURIComponent(image.key)}`,
        source: 'upload',
        sizeBytes: png.length,
        createdAt: expect.any(String),
      });
      expect(readFileSync(join(mediaDir, image.key))).toEqual(png);
      const video = await uploaded(zone.projectId, 'video/mp4', mp4);
      expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
      const list = await (await fetch(`${base}/projects/${zone.projectId}/media`)).json();
      expect(list.map((m: { source: string; kind: string }) => [m.source, m.kind])).toEqual([
        ['upload', 'video'],
        ['upload', 'image'],
        ['tale', 'image'],
      ]);
      expect(list[0].key).toBe(video);
      expect(list[2].taleTitle).toBe('Beach');

      const file = await fetch(`${origin}${image.url}`);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-type')).toBe('image/png');
      expect(file.headers.get('x-content-type-options')).toBe('nosniff');
      expect(file.headers.get('etag')).not.toContain(image.key);
      expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
      const videoUrl = `${base}/projects/${zone.projectId}/media/file?key=${encodeURIComponent(video)}`;
      expect((await fetch(videoUrl, { headers: { Range: 'bytes=0-3' } })).status).toBe(206);
      const etag = file.headers.get('etag') as string;
      expect((await fetch(`${origin}${image.url}`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
      // Another project's key, or no key, is no media of this project.
      const other = await createProject('Other');
      const foreign = await fetch(`${base}/projects/${other.id}/media/file?key=${encodeURIComponent(image.key)}`);
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).error.code).toBe('media_not_found');
      expect((await fetch(`${base}/projects/${zone.projectId}/media/file`)).status).toBe(404);
    });

    it('refuses another type, a mismatched file, an empty or too large one, and an unknown project', async () => {
      const project = await createProject();
      const refuse = async (res: Response, status: number, code: string) => {
        expect(res.status).toBe(status);
        expect((await res.json()).error.code).toBe(code);
      };
      const early = await upload(project.id, 'text/plain', png);
      expect(early.headers.get('connection')).toBe('close');
      await refuse(early, 415, 'unsupported_media_type');
      await refuse(await upload(project.id, 'image/svg+xml', Buffer.from('<svg/>')), 415, 'unsupported_media_type');
      await refuse(await upload(project.id, 'application/json', Buffer.from('{}')), 415, 'unsupported_media_type');
      await refuse(await upload(project.id, 'image/png', gif), 415, 'unsupported_media_type');
      await refuse(await upload(project.id, 'video/mp4', png), 415, 'unsupported_media_type');
      await refuse(await upload(project.id, 'image/png', Buffer.alloc(0)), 400, 'validation_failed');
      await refuse(
        await upload(project.id, 'image/png', Buffer.concat([png, Buffer.alloc(10 * MB)])),
        413,
        'media_too_large',
      );
      await refuse(
        await upload(project.id, 'image/png', png, { 'Content-Encoding': 'gzip' }),
        415,
        'unsupported_media_type',
      );
      await refuse(await upload('00000000-0000-4000-8000-000000000000', 'image/png', png), 404, 'project_not_found');
      expect(await (await fetch(`${base}/projects/${project.id}/media`)).json()).toEqual([]);
      expect(existsSync(join(mediaDir, 'media')) ? readdirSync(join(mediaDir, 'media')).length : 0).toBe(0);
    });

    it('saves resized, rotated and rounded images and video, a duration and a media background', async () => {
      const { zone, tale } = await setup();
      const image = await uploaded(zone.projectId);
      const video = await uploaded(zone.projectId, 'video/mp4', mp4);
      const background = await uploaded(zone.projectId, 'image/gif', gif);
      const value = doc([element(1, 'image', image), element(2, 'video', video)], {
        durationMs: 5000,
        canvas: { background: { type: 'media', mediaKey: background, fit: 'contain', color: '#112233' } },
      });
      const res = await save(tale.id, value, 0);
      expect(res.status).toBe(200);
      expect((await res.json()).document).toEqual(value);
      const rows = await pool.query('SELECT storage_key, document, content_type, delivered FROM tale_media');
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          { storage_key: image, document: 'draft', content_type: 'image/png', delivered: false },
          { storage_key: video, document: 'draft', content_type: 'video/mp4', delivered: false },
          { storage_key: background, document: 'draft', content_type: 'image/gif', delivered: false },
        ]),
      );
      expect(rows.rows).toHaveLength(3);
    });

    it("refuses another project's key, an unknown key, the wrong kind, two videos, a bad fit or duration", async () => {
      const { zone, tale } = await setup();
      const other = await createProject('Other');
      const foreign = await uploaded(other.id);
      const image = await uploaded(zone.projectId);
      const video = await uploaded(zone.projectId, 'video/mp4', mp4);
      const refused = async (value: unknown, pointer: string) => {
        const res = await save(tale.id, value, 0);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer });
      };
      await refused(doc([element(1, 'image', foreign)]), '/elements/0/props/mediaKey');
      await refused(
        doc([element(1, 'image', 'media/00000000-0000-4000-8000-000000000000.png')]),
        '/elements/0/props/mediaKey',
      );
      await refused(doc([element(1, 'image', video)]), '/elements/0/props/mediaKey');
      await refused(doc([element(1, 'video', image)]), '/elements/0/props/mediaKey');
      await refused(
        doc([], { canvas: { background: { type: 'media', mediaKey: foreign, fit: 'cover', color: '#000000' } } }),
        '/canvas/background/mediaKey',
      );
      await refused(doc([element(1, 'video', video), element(2, 'video', video)]), '/elements/1/type');
      await refused(
        doc([element(1, 'image', image, { props: { mediaKey: image, fit: 'fill' } })]),
        '/elements/0/props/fit',
      );
      await refused(doc([element(1, 'image', image)], { durationMs: 2000 }), '/durationMs');
      await refused(doc([element(1, 'image', image)], { durationMs: 16000 }), '/durationMs');
      await refused(doc([element(1, 'image', 'https://evil.example/x.png')]), '/elements/0/props/mediaKey');
      expect((await state(tale.id)).revision).toBe(0);
      // The tale's own media is media of its project too.
      expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
      const { media_key: taleKey } = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [tale.id])).rows[0];
      expect((await save(tale.id, doc([element(1, 'image', taleKey)]), 1)).status).toBe(200);
    });

    it('lets a draft lack alt text, refuses to publish it naming the element, goes live unpublished', async () => {
      const { zone, group, tale } = await setup();
      const image = await uploaded(zone.projectId);
      const value = doc([
        element(1, 'image', image, { a11y: { label: 'Cat' } }),
        element(2, 'image', image, { a11y: {} }),
      ]);
      expect((await save(tale.id, value, 0)).status).toBe(200);
      const message = '"Image 2" needs alt text, or must be marked decorative, before the tale can be updated.';
      const res = await publishDraft(tale.id);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toEqual({
        code: 'invalid_tale_document',
        message,
        pointer: '/elements/1/a11y/label',
      });
      await publish('tale-groups', group.id);
      const live = await setStatus('tales', tale.id, 'live');
      expect(live.status).toBe(200);
      expect(await live.json()).toMatchObject({
        status: 'live',
        draftNotPublished: true,
        draftNotPublishedReason: message,
      });
      expect((await state(tale.id)).published.revision).toBe(0);
      // Marked decorative, it publishes.
      const fixed = doc([element(1, 'image', image), element(2, 'image', image, { a11y: { decorative: true } })]);
      expect((await save(tale.id, fixed, 1)).status).toBe(200);
      expect((await publishDraft(tale.id)).status).toBe(200);
    });

    it('keeps document media and the cover private while the only shown tale has nothing published (AD-6 amended)', async () => {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      // Shown from the start, with only a studio draft: "not updated yet".
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      const image = await uploaded(zone.projectId);
      expect((await save(tale.id, doc([element(1, 'image', image)]), 0)).status).toBe(200);
      const cover = await fetch(`${base}/tale-groups/${group.id}/cover`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(cover.status).toBe(200);
      const coverKey = (await pool.query('SELECT cover_key FROM tale_groups WHERE id = $1', [group.id])).rows[0]
        .cover_key as string;
      await publish('tale-groups', group.id);

      expect(await delivered(zone.id)).toEqual([]);
      expect((await getPublic(image)).status).toBe(404);
      expect((await getPublic(coverKey)).status).toBe(404);

      expect((await publishDraft(tale.id)).status).toBe(200);
      expect((await delivered(zone.id)).length).toBe(1);
      expect((await getPublic(image)).status).toBe(200);
      expect((await getPublic(coverKey)).status).toBe(200);
    });

    it("delivers public URLs for a published tale's media and serves them only while it is delivered", async () => {
      const { zone, group, tale } = await setup();
      await postKey(zone.id);
      const image = await uploaded(zone.projectId);
      const hidden = await uploaded(zone.projectId, 'image/gif', gif);
      const video = await uploaded(zone.projectId, 'video/mp4', mp4);
      const background = await uploaded(zone.projectId, 'image/png', png);
      const value = doc(
        [element(1, 'image', image), element(2, 'image', hidden, { hidden: true }), element(3, 'video', video)],
        { canvas: { background: { type: 'media', mediaKey: background, fit: 'cover', color: '#112233' } } },
      );
      expect((await save(tale.id, value, 0)).status).toBe(200);
      // Not yet published: nothing is public.
      expect((await getPublic(image)).status).toBe(404);
      await publish('tale-groups', group.id);
      await publish('tales', tale.id);
      // Going live published the draft: everything visible is public now, the hidden image is not.
      for (const key of [image, video, background]) expect((await getPublic(key)).status).toBe(200);
      expect((await getPublic(hidden)).status).toBe(404);
      const etag = (await getPublic(image)).headers.get('etag') as string;
      expect((await getPublic(image, { 'If-None-Match': etag })).status).toBe(304);
      expect((await getPublic(video, { Range: 'bytes=0-3' })).status).toBe(206);

      const [deliveredGroup] = await delivered(zone.id);
      const document = deliveredGroup.tales[0].document as {
        canvas: { background: unknown };
        elements: { type: string; props: unknown; box: { rotation: number } }[];
      };
      expect(document.canvas.background).toEqual({
        type: 'media',
        url: `${publicApiUrl}/media/${background}`,
        fit: 'cover',
        color: '#112233',
      });
      expect(document.elements.map((e) => e.type)).toEqual(['image', 'video']);
      expect(document.elements[0].props).toEqual({
        url: `${publicApiUrl}/media/${image}`,
        fit: 'cover',
        radius: 0.04,
        opacity: 0.9,
      });
      expect(document.elements[0].box.rotation).toBe(20);
      expect(JSON.stringify(document)).not.toContain('mediaKey');

      // A draft-only key is not public; pausing the tale makes everything private at once.
      const draftOnly = await uploaded(zone.projectId, 'image/jpeg', jpeg);
      expect((await save(tale.id, doc([element(1, 'image', draftOnly)]), 1)).status).toBe(200);
      expect((await getPublic(draftOnly)).status).toBe(404);
      expect((await getPublic(image)).status).toBe(200);
      await setStatus('tales', tale.id, 'paused');
      expect((await getPublic(image)).status).toBe(404);
      expect((await getPublic(image, { 'If-None-Match': etag })).status).toBe(404);
    });

    it('keeps a replaced tale media file while a document references it', async () => {
      const { tale } = await setup();
      expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
      const { media_key: oldKey } = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [tale.id])).rows[0];
      expect((await save(tale.id, doc([element(1, 'image', oldKey)]), 1)).status).toBe(200);
      expect((await putTaleMedia(tale.id, 'image/png', png)).status).toBe(200);
      expect(existsSync(join(mediaDir, oldKey))).toBe(true);
    });

    it("keeps the media keys in copies, recorded for the copy's project, here and in another project", async () => {
      const { zone, group, tale } = await setup();
      const image = await uploaded(zone.projectId);
      expect((await save(tale.id, doc([element(1, 'image', image)]), 0)).status).toBe(200);
      expect((await publishDraft(tale.id)).status).toBe(200);
      const target = await createZone();
      const res = await post(`/tale-groups/${group.id}/copy`, { zoneId: target.id });
      expect(res.status).toBe(201);
      const copiedTale = (await res.json()).tales[0].id as string;
      const rows = await pool.query(
        'SELECT project_id, document, delivered FROM tale_media WHERE tale_id = $1 ORDER BY document',
        [copiedTale],
      );
      expect(rows.rows).toEqual([
        { project_id: target.projectId, document: 'draft', delivered: false },
        { project_id: target.projectId, document: 'published', delivered: true },
      ]);
      // The key is now media of the target project, so its tales may use it; files are not copied.
      const targetList = await (await fetch(`${base}/projects/${target.projectId}/media`)).json();
      expect(targetList).toEqual([expect.objectContaining({ key: image, source: 'document' })]);
      const s = await state(copiedTale);
      expect((await save(copiedTale, doc([element(1, 'image', image)]), s.revision)).status).toBe(200);
      // Keeping a version as a new tale checks its media too.
      const other = await createProject('Third');
      const foreign = await uploaded(other.id);
      const kept = await post(`/tales/${tale.id}/document/copy`, { document: doc([element(1, 'image', foreign)]) });
      expect(kept.status).toBe(400);
      expect((await kept.json()).error.pointer).toBe('/elements/0/props/mediaKey');
      expect(
        (await post(`/tales/${tale.id}/document/copy`, { document: doc([element(1, 'image', image)]) })).status,
      ).toBe(201);
    });

    it('lets a content manager upload only to a project they belong to', async () => {
      const mine = await createProject('Mine');
      const theirs = await createProject('Theirs');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, mine.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      expect((await upload(mine.id, 'image/png', png)).status).toBe(201);
      expect((await upload(theirs.id, 'image/png', png)).status).toBe(403);
      expect((await fetch(`${base}/projects/${theirs.id}/media`)).status).toBe(403);
    });

    // A raw upload, for what fetch cannot send: no Content-Length, or a body that stops short.
    function rawUpload(
      target: string,
      headers: Record<string, string>,
    ): { req: ReturnType<typeof httpRequest>; answer: Promise<{ status: number; body: string }> } {
      const url = new URL(target);
      let req!: ReturnType<typeof httpRequest>;
      const answer = new Promise<{ status: number; body: string }>((resolve, reject) => {
        req = httpRequest(
          {
            method: 'POST',
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { Cookie: sessionCookie, ...headers },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on('error', reject);
      });
      return { req, answer };
    }

    async function withServer<T>(media: ProjectMediaOptions, run: (base: string) => Promise<T>): Promise<T> {
      const app = createApp(
        pool,
        loadFrameTypeRegistry(frameTypesDir),
        new LocalDiskStorage(mediaDir),
        {
          verifier: fakeVerifier,
        },
        { publicApiUrl },
        undefined,
        media,
      );
      const s = app.listen(0);
      await new Promise<void>((resolve) => s.once('listening', () => resolve()));
      try {
        return await run(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1`);
      } finally {
        s.closeAllConnections();
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }

    const storedUploads = () => (existsSync(join(mediaDir, 'media')) ? readdirSync(join(mediaDir, 'media')) : []);

    it('refuses an upload without a Content-Length (411), and stores nothing of a body that stops short', async () => {
      const project = await createProject();
      const chunked = rawUpload(`${base}/projects/${project.id}/media`, {
        'Content-Type': 'image/png',
        'Transfer-Encoding': 'chunked',
      });
      chunked.req.end(png);
      const refused = await chunked.answer;
      expect(refused.status).toBe(411);
      expect(JSON.parse(refused.body).error.code).toBe('length_required');

      const short = rawUpload(`${base}/projects/${project.id}/media`, {
        'Content-Type': 'image/png',
        'Content-Length': '4096',
      });
      short.answer.catch(() => undefined);
      short.req.write(png);
      await new Promise((resolve) => setTimeout(resolve, 150));
      short.req.destroy();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(storedUploads()).toEqual([]);
      expect(await (await fetch(`${base}/projects/${project.id}/media`)).json()).toEqual([]);
    });

    it('caps a project at its files and bytes, with clear codes, and leaves no file behind', async () => {
      const project = await createProject();
      await withServer({ limits: { maxFiles: 2, maxBytes: 25 } }, async (b) => {
        const send = (body: Uint8Array) =>
          fetch(`${b}/projects/${project.id}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/png' },
            body,
          });
        expect((await send(png)).status).toBe(201);
        expect((await send(png)).status).toBe(201);
        const third = await send(png);
        expect(third.status).toBe(409);
        expect((await third.json()).error.code).toBe('media_limit_reached');
        const other = await createProject('Other');
        const heavy = await fetch(`${b}/projects/${other.id}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: Buffer.concat([png, Buffer.alloc(20)]),
        });
        expect(heavy.status).toBe(413);
        expect((await heavy.json()).error.code).toBe('media_storage_full');
      });
      expect(storedUploads()).toHaveLength(2);
    });

    it('answers 429 upload_busy while the process streams its most uploads at once', async () => {
      const project = await createProject();
      await withServer({ maxConcurrentUploads: 1 }, async (b) => {
        const slow = rawUpload(`${b}/projects/${project.id}/media`, {
          'Content-Type': 'image/png',
          'Content-Length': '64',
        });
        slow.answer.catch(() => undefined);
        slow.req.write(png);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const busy = await fetch(`${b}/projects/${project.id}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(busy.status).toBe(429);
        expect((await busy.json()).error.code).toBe('upload_busy');
        slow.req.end(Buffer.alloc(64 - png.length));
        expect((await slow.answer).status).toBe(201);
        const after = await fetch(`${b}/projects/${project.id}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(after.status).toBe(201);
      });
    });

    it('never deletes a replaced file a document write in flight is about to reference', async () => {
      // 1. A tale holds media K. 2. A document save has checked K (holding its share lock) and not
      // committed. 3. The tale's media is replaced: its row no longer names K, and the delete
      // decision waits for the lock. 4. The save records its reference to K and commits. 5. The
      // decision, made under the lock, sees the reference: K's file stays.
      const { tale } = await setup();
      expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
      const { media_key: key, project_id: projectId } = (
        await pool.query('SELECT media_key, project_id FROM tales WHERE id = $1', [tale.id])
      ).rows[0];
      const save = await pool.connect();
      try {
        await save.query('BEGIN');
        await save.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('media:' || $1, 0))", [key]);
        let replaced = false;
        const replacing = putTaleMedia(tale.id, 'image/png', png).then((res) => {
          replaced = true;
          return res;
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(replaced).toBe(false);
        await save.query(
          `INSERT INTO tale_media (tale_id, storage_key, document, project_id, content_type, delivered)
           VALUES ($1, $2, 'draft', $3, 'image/gif', false)`,
          [tale.id, key, projectId],
        );
        await save.query('COMMIT');
        expect((await replacing).status).toBe(200);
      } finally {
        save.release();
      }
      expect(existsSync(join(mediaDir, key))).toBe(true);
      // With no reference left, the next replace deletes the file it leaves.
      await pool.query('DELETE FROM tale_media WHERE tale_id = $1', [tale.id]);
      const { media_key: second } = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [tale.id])).rows[0];
      expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
      expect(existsSync(join(mediaDir, second))).toBe(false);
    });

    it('sweeps upload files older than an hour that no row names', async () => {
      const project = await createProject();
      const kept = await uploaded(project.id);
      writeFileSync(join(mediaDir, 'media', 'orphan.png'), png);
      const old = new Date(Date.now() - 2 * 60 * 60_000);
      utimesSync(join(mediaDir, kept), old, old);
      utimesSync(join(mediaDir, 'media', 'orphan.png'), old, old);
      expect(await sweepUnusedProjectMediaFiles(pool, new LocalDiskStorage(mediaDir))).toBe(1);
      expect(storedUploads()).toEqual([kept.slice('media/'.length)]);
    });

    describe('shapes, emoji and image stickers (epic Tale Studio R6, story 7.6)', () => {
      function item(n: number, type: string, props: unknown, extra: Record<string, unknown> = {}) {
        return {
          id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          type,
          box: { x: 0.1, y: 0.2 + n * 0.05, w: 0.4, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props,
          ...extra,
        };
      }
      const rounded = { shape: 'rectangle', fill: '#ff0000', stroke: '#000000', strokeWidth: 0.01, radius: 0.04 };
      const line = { shape: 'line', stroke: '#ffffff', strokeWidth: 0.004 };

      it('saves shapes, emoji and a sticker, recording the sticker as media of the tale', async () => {
        const { zone, tale } = await setup();
        const sticker = await uploaded(zone.projectId, 'image/gif', gif);
        const value = doc([
          item(1, 'shape', rounded, { a11y: { decorative: true } }),
          item(2, 'shape', { shape: 'ellipse', fill: '#00ff0080', opacity: 0.5 }),
          item(3, 'shape', line, { a11y: { label: 'Divider' } }),
          item(4, 'emoji', { emoji: '👩🏽‍💻' }, { a11y: { label: 'woman technologist' } }),
          item(5, 'sticker', { mediaKey: sticker, opacity: 0.8 }, { a11y: { label: 'A party hat' } }),
        ]);
        const res = await save(tale.id, value, 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document).toEqual(value);
        const rows = await pool.query('SELECT storage_key, document, content_type FROM tale_media WHERE tale_id = $1', [
          tale.id,
        ]);
        expect(rows.rows).toEqual([{ storage_key: sticker, document: 'draft', content_type: 'image/gif' }]);
      });

      it('refuses bad shapes, anything but one emoji, and a sticker key of the wrong kind or project', async () => {
        const { zone, tale } = await setup();
        const other = await createProject('Other');
        const foreign = await uploaded(other.id);
        const photo = await uploaded(zone.projectId, 'image/jpeg', jpeg);
        const video = await uploaded(zone.projectId, 'video/mp4', mp4);
        const refused = async (value: unknown, pointer: string) => {
          const res = await save(tale.id, value, 0);
          expect(res.status).toBe(400);
          expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer });
        };
        await refused(doc([item(1, 'shape', { shape: 'star' })]), '/elements/0/props/shape');
        await refused(doc([item(1, 'shape', { shape: 'rectangle', fill: 'red' })]), '/elements/0/props/fill');
        const css = { shape: 'rectangle', fill: '#fff;background:url(x)' };
        await refused(doc([item(1, 'shape', css)]), '/elements/0/props/fill');
        await refused(doc([item(1, 'shape', { shape: 'rectangle', svg: '<svg onload=x>' })]), '/elements/0/props/svg');
        await refused(doc([item(1, 'shape', { ...rounded, strokeWidth: 0.5 })]), '/elements/0/props/strokeWidth');
        expect((await save(tale.id, doc([item(1, 'shape', { shape: 'ellipse', radius: 0.1 })]), 0)).status).toBe(400);
        expect((await save(tale.id, doc([item(1, 'shape', { ...line, fill: '#000000' })]), 0)).status).toBe(400);
        for (const emoji of ['abc', '😀😀', '<img src=x onerror=alert(1)>', '😀‮', '']) {
          await refused(doc([item(1, 'emoji', { emoji })]), '/elements/0/props/emoji');
        }
        const image = { emoji: '😀', url: 'https://cdn.example/1f600.png' };
        await refused(doc([item(1, 'emoji', image)]), '/elements/0/props/url');
        await refused(doc([item(1, 'sticker', { mediaKey: photo })]), '/elements/0/props/mediaKey');
        await refused(doc([item(1, 'sticker', { mediaKey: video })]), '/elements/0/props/mediaKey');
        await refused(doc([item(1, 'sticker', { mediaKey: foreign })]), '/elements/0/props/mediaKey');
        const unknown = 'media/00000000-0000-4000-8000-000000000000.png';
        await refused(doc([item(1, 'sticker', { mediaKey: unknown })]), '/elements/0/props/mediaKey');
        expect((await state(tale.id)).revision).toBe(0);
      });

      it('refuses to publish a sticker without alt text, then delivers each new element with URLs', async () => {
        const { zone, group, tale } = await setup();
        await postKey(zone.id);
        const sticker = await uploaded(zone.projectId);
        const elements = [
          item(1, 'shape', rounded, { a11y: { decorative: true } }),
          item(2, 'shape', { shape: 'ellipse', fill: '#00ff00' }, { a11y: { decorative: true } }),
          item(3, 'shape', line, { a11y: { decorative: true } }),
          item(4, 'emoji', { emoji: '🎉' }, { a11y: { label: 'party popper' } }),
          item(5, 'sticker', { mediaKey: sticker }),
        ];
        expect((await save(tale.id, doc(elements), 0)).status).toBe(200);
        const refused = await publishDraft(tale.id);
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toEqual({
          code: 'invalid_tale_document',
          message: '"Sticker 1" needs alt text, or must be marked decorative, before the tale can be updated.',
          pointer: '/elements/4/a11y/label',
        });
        elements[4] = item(5, 'sticker', { mediaKey: sticker }, { a11y: { decorative: true } });
        expect((await save(tale.id, doc(elements), 1)).status).toBe(200);
        expect((await publishDraft(tale.id)).status).toBe(200);
        expect((await getPublic(sticker)).status).toBe(404);
        await publish('tale-groups', group.id);
        await publish('tales', tale.id);
        expect((await getPublic(sticker)).status).toBe(200);
        const [deliveredGroup] = await delivered(zone.id);
        const document = deliveredGroup.tales[0].document as { elements: { type: string; props: unknown }[] };
        expect(document.elements.map((e) => e.type)).toEqual(['shape', 'shape', 'shape', 'emoji', 'sticker']);
        expect(document.elements[3]).toMatchObject({ a11y: { label: 'party popper' }, props: { emoji: '🎉' } });
        expect(document.elements[4].props).toEqual({ url: `${publicApiUrl}/media/${sticker}` });
        expect(JSON.stringify(document)).not.toContain('mediaKey');
      });

      it('keeps a sticker file while a document uses it', async () => {
        const { tale } = await setup();
        expect((await putTaleMedia(tale.id, 'image/gif', gif)).status).toBe(200);
        const { media_key: oldKey } = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [tale.id]))
          .rows[0];
        const value = doc([item(1, 'sticker', { mediaKey: oldKey }, { a11y: { decorative: true } })]);
        expect((await save(tale.id, value, 1)).status).toBe(200);
        expect((await putTaleMedia(tale.id, 'image/png', png)).status).toBe(200);
        expect(existsSync(join(mediaDir, oldKey))).toBe(true);
      });
    });
  });

  describe('existing tales become documents (epic Tale Studio R16, story 7.11)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom-tiny-mp4')]);
    const TEXT_ID = '00000000-0000-4000-8000-0000000000e1';
    const text = (value: string) => ({
      id: TEXT_ID,
      type: 'text',
      box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: value },
    });
    const overlay = (value: string, extra: Record<string, unknown> = {}) => ({
      version: 1,
      canvas: { background: { type: 'color', color: '#112233' } },
      elements: [text(value)],
      ...extra,
    });

    interface Row {
      document: { durationMs?: number; elements: Record<string, unknown>[] } | null;
      draft: { durationMs?: number; elements: Record<string, unknown>[] } | null;
      revision: number;
      draftRevision: number;
      inStep: string | null;
      key: string | null;
    }
    async function row(taleId: string): Promise<Row> {
      const { rows } = await pool.query(
        `SELECT document, draft_document AS draft, document_revision AS revision, draft_revision AS "draftRevision",
           document_media_key AS "inStep", media_key AS key FROM tales WHERE id = $1`,
        [taleId],
      );
      return rows[0];
    }

    async function zoneWithGroup() {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      await publish('tale-groups', group.id);
      return { zone, group };
    }

    // A tale as it was before this story: its media in `media_key` (a real file), no document unless
    // given, and never in step. `status` is stored as given.
    async function legacyTale(
      groupId: string,
      title: string,
      options: { kind?: 'image' | 'video'; status?: string; document?: unknown; key?: string } = {},
    ): Promise<{ id: string; key: string }> {
      const tale = await (await post(`/tale-groups/${groupId}/tales`, { title })).json();
      const kind = options.kind ?? 'image';
      const key = options.key ?? `tales/${randomUUID()}.${kind === 'image' ? 'png' : 'mp4'}`;
      await new LocalDiskStorage(mediaDir).put(key, kind === 'image' ? png : mp4);
      const doc = options.document === undefined ? null : JSON.stringify(options.document);
      await pool.query(
        `UPDATE tales SET media_key = $2, media_content_type = $3, status = $4, document = $5::jsonb,
           draft_document = $5::jsonb, document_revision = CASE WHEN $5::jsonb IS NULL THEN 0 ELSE 3 END,
           draft_revision = CASE WHEN $5::jsonb IS NULL THEN 0 ELSE 3 END, document_media_key = NULL
         WHERE id = $1`,
        [tale.id, key, kind === 'image' ? 'image/png' : 'video/mp4', options.status ?? 'live', doc],
      );
      await pool.query('DELETE FROM tale_media WHERE tale_id = $1', [tale.id]);
      return { id: tale.id, key };
    }

    async function delivered(zoneId: string) {
      const { key } = await (await postKey(zoneId)).json();
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(200);
      return (await res.json()).taleGroups as {
        id: string;
        tales: { id: string; title: string; document: { elements: { id: string }[] } & Record<string, unknown> }[];
      }[];
    }

    // Element ids aside (a composed document names its media element after the tale), what visitors get.
    const looks = (groups: Awaited<ReturnType<typeof delivered>>) =>
      JSON.parse(JSON.stringify(groups).replace(/"id":"[0-9a-f-]{36}"/g, '"id":"…"'));

    function save(taleId: string, document: unknown, revision: number): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, revision }),
      });
    }

    const ownElement = (kind: string, mediaKey: string) => ({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: kind,
      box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: { decorative: true },
      props: { mediaKey, fit: 'contain', taleMedia: true },
    });

    it('migrates every legacy tale at start, renders it as before, and changes nothing on a second run', async () => {
      const { zone, group } = await zoneWithGroup();
      const image = await legacyTale(group.id, 'Image');
      const video = await legacyTale(group.id, 'Video', { kind: 'video' });
      const studio = await legacyTale(group.id, 'Studio', { document: overlay('Over the media') });
      const timed = await legacyTale(group.id, 'Timed', { document: overlay('Nine seconds', { durationMs: 9000 }) });
      const draft = await legacyTale(group.id, 'Draft', { status: 'draft' });
      // Before the migration the Delivery API already composes each tale's media in: nothing waits on it.
      const before = await delivered(zone.id);
      expect(before[0].tales.map((t) => t.title)).toEqual(['Image', 'Video', 'Studio', 'Timed']);

      await migrate(pool);

      // A tale with no document: its media as the only element of both documents, 5 s, revision 1.
      const imageRow = await row(image.id);
      expect(imageRow.document).toEqual({
        version: 1,
        canvas: { background: { type: 'color', color: '#000000' } },
        durationMs: 5000,
        elements: [ownElement('image', image.key)],
      });
      expect(imageRow.draft).toEqual(imageRow.document);
      expect([imageRow.revision, imageRow.draftRevision, imageRow.inStep]).toEqual([1, 1, image.key]);
      expect((await row(video.id)).document?.elements[0]).toEqual(ownElement('video', video.key));
      // A studio document over the media: the media goes in at the bottom, legacy timing unless one was set.
      const studioRow = await row(studio.id);
      expect(studioRow.document).toEqual({
        ...overlay('Over the media'),
        durationMs: 5000,
        elements: [ownElement('image', studio.key), text('Over the media')],
      });
      expect(studioRow.draft).toEqual(studioRow.document);
      expect([studioRow.revision, studioRow.draftRevision]).toEqual([4, 4]);
      expect((await row(timed.id)).document?.durationMs).toBe(9000);
      // A draft tale gets a draft only: going live publishes it (7.3).
      const draftRow = await row(draft.id);
      expect(draftRow.document).toBeNull();
      expect(draftRow.draft?.elements).toEqual([ownElement('image', draft.key)]);
      // The references are recorded: published ones delivered, so the public route serves them (AD-11).
      const refs = await pool.query(
        `SELECT tale_id, document, delivered, content_type FROM tale_media WHERE tale_id = ANY($1::uuid[])
         ORDER BY tale_id, document`,
        [[image.id, draft.id]],
      );
      expect(refs.rows).toEqual(
        expect.arrayContaining([
          { tale_id: image.id, document: 'draft', delivered: false, content_type: 'image/png' },
          { tale_id: image.id, document: 'published', delivered: true, content_type: 'image/png' },
          { tale_id: draft.id, document: 'draft', delivered: false, content_type: 'image/png' },
        ]),
      );
      expect(refs.rows).toHaveLength(3);

      // Visitors get the same: same media, fit, timing and order, before and after.
      const after = await delivered(zone.id);
      expect(looks(after)).toEqual(looks(before));
      const imageTale = after[0].tales[0];
      expect(imageTale.document).toEqual({
        version: 1,
        canvas: { background: { type: 'color', color: '#000000' } },
        durationMs: 5000,
        elements: [
          {
            id: expect.any(String),
            type: 'image',
            box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
            a11y: { decorative: true },
            props: { url: `${publicApiUrl}/media/${image.key}`, fit: 'contain', taleMedia: true },
          },
        ],
      });
      expect((await globalThis.fetch(`${origin}/media/${image.key}`)).status).toBe(200);

      // Idempotent: a second start changes nothing, and an element a person removed stays removed.
      expect((await save(image.id, overlay('No media now'), 1)).status).toBe(200);
      const once = await pool.query(
        'SELECT id, document, draft_document, document_revision, draft_revision FROM tales',
      );
      await migrate(pool);
      expect(
        (await pool.query('SELECT id, document, draft_document, document_revision, draft_revision FROM tales')).rows,
      ).toEqual(once.rows);
      expect((await row(image.id)).draft?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
    });

    it('migrates in batches within its start-up budget and finishes in the background, skipping held rows', async () => {
      const { group } = await zoneWithGroup();
      // Many legacy tales, written straight to the table (a group's tale limit is the API's).
      const many = 1200;
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position, status, media_key, media_content_type)
         SELECT $1, project_id, 'T' || n, n, 'live', 'tales/' || gen_random_uuid() || '.png', 'image/png'
         FROM tale_groups, generate_series(1, $2) AS n WHERE tale_groups.id = $1`,
        [group.id, many],
      );
      const outOfStep = async () =>
        (
          await pool.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM tales WHERE media_key IS NOT NULL AND document_media_key IS DISTINCT FROM media_key',
          )
        ).rows[0].n;
      // A start-up run out of budget stops after a batch: those tales are done, the rest wait.
      const client = await pool.connect();
      try {
        expect(await migrateTaleMediaDocuments(client, { batchSize: 500, budgetMs: 0 })).toEqual({
          merged: 500,
          skipped: 0,
          done: false,
        });
      } finally {
        client.release();
      }
      expect(await outOfStep()).toBe(many - 500);

      // A save in flight holds one tale: the background run skips it, and a later run takes it.
      const held = (await pool.query('SELECT id FROM tales WHERE document_media_key IS NULL ORDER BY id LIMIT 1'))
        .rows[0].id as string;
      const saving = await pool.connect();
      try {
        await saving.query('BEGIN');
        await saving.query('SELECT 1 FROM tales WHERE id = $1 FOR UPDATE', [held]);
        const result = await continueTaleMediaMigration(pool, { batchSize: 500, attempts: 1 });
        expect(result.done).toBe(false);
        expect(await outOfStep()).toBe(1);
        await saving.query('COMMIT');
      } finally {
        saving.release();
      }
      expect(await continueTaleMediaMigration(pool, { attempts: 1 })).toEqual({ merged: 1, skipped: 0, done: true });
      expect(await outOfStep()).toBe(0);
      const published = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM tale_media WHERE document = 'published' AND delivered",
      );
      expect(published.rows[0].n).toBe(many);
    });

    it('leaves out of step, and composed on delivery, what a document cannot take', async () => {
      const { zone, group } = await zoneWithGroup();
      const full = overlay('x', {
        elements: Array.from({ length: 60 }, (_, i) => ({
          ...text(`T${i}`),
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
      });
      const crowded = await legacyTale(group.id, 'Crowded', { document: full });
      const odd = await legacyTale(group.id, 'Odd', { key: 'uploads/Legacy.PNG' });
      await migrate(pool);
      expect((await row(crowded.id)).inStep).toBeNull();
      expect((await row(crowded.id)).document?.elements).toHaveLength(60);
      expect((await row(odd.id)).document).toBeNull();
      const [g] = await delivered(zone.id);
      // Delivered with the media composed in, at the bottom: visitors still see it.
      expect(g.tales[0].document.elements).toHaveLength(61);
      expect(g.tales[0].document.elements[0]).toMatchObject({ id: crowded.id, props: { taleMedia: true } });
      expect(g.tales[1].document.elements[0]).toMatchObject({
        type: 'image',
        props: { url: `${publicApiUrl}/media/uploads/Legacy.PNG`, taleMedia: true },
      });
    });

    it('refuses an editor whose draft the migration changed (409), so no save is lost', async () => {
      const { group } = await zoneWithGroup();
      const studio = await legacyTale(group.id, 'Studio', { document: overlay('Before') });
      await migrate(pool);
      // The editor had revision 3 open; the migration made it 4.
      const stale = await save(studio.id, overlay('My edit'), 3);
      expect(stale.status).toBe(409);
      expect((await row(studio.id)).draft?.elements).toHaveLength(2);
      expect((await save(studio.id, overlay('My edit'), 4)).status).toBe(200);
    });

    it('shows an out-of-step tale in Tale Studio with its media, as visitors see it, unless a document cannot take it', async () => {
      const { group } = await zoneWithGroup();
      const studio = await legacyTale(group.id, 'Studio', { document: overlay('Over the media') });
      const full = overlay('x', {
        elements: Array.from({ length: 60 }, (_, i) => ({
          ...text(`T${i}`),
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        })),
      });
      const crowded = await legacyTale(group.id, 'Crowded', { document: full });
      // Before the migration ran: the read composes the media in, at the bottom, with legacy timing.
      const read = await (await fetch(`${base}/tales/${studio.id}/document`)).json();
      expect(read.revision).toBe(3);
      expect(read.document.durationMs).toBe(5000);
      expect(read.document.elements.map((e: { id: string }) => e.id)).toEqual([studio.id, TEXT_ID]);
      expect(read.published.document.elements[0]).toMatchObject({ props: { mediaKey: studio.key, taleMedia: true } });
      // Saving what was read writes it, and the tale is then delivered from what was saved.
      expect((await save(studio.id, read.document, 3)).status).toBe(200);
      expect((await row(studio.id)).draft?.elements).toHaveLength(2);
      const crowdedRead = await (await fetch(`${base}/tales/${crowded.id}/document`)).json();
      expect(crowdedRead.document.elements).toHaveLength(60);
    });

    it('gives legacy timing to a tale never in step on its first media upload, and none afterwards (R16)', async () => {
      const { group } = await zoneWithGroup();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Studio first' })).json();
      expect((await save(tale.id, overlay('Words first'), 0)).status).toBe(200);
      const put = (body: Buffer) =>
        fetch(`${base}/tales/${tale.id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body });
      expect((await put(png)).status).toBe(200);
      const first = await row(tale.id);
      expect(first.draft?.durationMs).toBe(5000);
      expect(first.draft?.elements.map((e) => e['type'])).toEqual(['image', 'text']);
      // A later duration a person sets stays through the next upload.
      expect((await save(tale.id, { ...first.draft, durationMs: 9000 }, first.draftRevision)).status).toBe(200);
      expect((await put(Buffer.concat([png, Buffer.from([9])]))).status).toBe(200);
      expect((await row(tale.id)).draft?.durationMs).toBe(9000);
    });

    it("refuses taleMedia on anything but the tale's own media (400, naming the element)", async () => {
      const { group } = await zoneWithGroup();
      const tale = await legacyTale(group.id, 'Own', { status: 'draft' });
      await migrate(pool);
      const own = (await row(tale.id)).draft as { elements: Record<string, unknown>[] };
      const refused = async (document: unknown) => {
        const res = await save(tale.id, document, 1);
        expect(res.status).toBe(400);
        expect((await res.json()).error.pointer).toBe('/elements/0/props/taleMedia');
      };
      const element = own.elements[0] as { props: Record<string, unknown> };
      // Other media of the project marked as the tale's own (the wrong kind is refused at its key already).
      const other = await legacyTale(group.id, 'Other', { status: 'draft' });
      await refused({ ...own, elements: [{ ...element, props: { ...element.props, mediaKey: other.key } }] });
      expect((await save(tale.id, own, 1)).status).toBe(200);
    });

    it('builds a missing draft from the published document and the media (R16)', async () => {
      const { group } = await zoneWithGroup();
      const tale = await legacyTale(group.id, 'Published only', { document: overlay('Live words') });
      await pool.query('UPDATE tales SET draft_document = NULL WHERE id = $1', [tale.id]);
      await migrate(pool);
      const stored = await row(tale.id);
      expect(stored.draft).toEqual(stored.document);
      expect(stored.draft?.elements.map((e) => e['type'])).toEqual(['image', 'text']);
    });

    it('marks a malformed document skipped without failing its batch, and does not take it up again', async () => {
      const { group } = await zoneWithGroup();
      const broken = await legacyTale(group.id, 'Broken', { document: { version: 1, elements: 'nope' } });
      const fine = await legacyTale(group.id, 'Fine');
      await migrate(pool);
      const marks = await pool.query(
        'SELECT id, document_media_skip_key AS key, document_media_skip_reason AS reason FROM tales WHERE id = ANY($1::uuid[])',
        [[broken.id, fine.id]],
      );
      expect(marks.rows).toEqual(
        expect.arrayContaining([
          { id: broken.id, key: broken.key, reason: 'malformed' },
          { id: fine.id, key: null, reason: null },
        ]),
      );
      expect((await row(fine.id)).inStep).toBe(fine.key);
      // The background run counts it as skipped, not as work left, and finishes.
      const log = vi.fn();
      expect(await continueTaleMediaMigration(pool, { attempts: 3, baseDelayMs: 1, log })).toEqual({
        merged: 0,
        skipped: 1,
        done: true,
      });
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('lets one process at a time finish the migration in the background', async () => {
      const holder = await pool.connect();
      try {
        await holder.query("SELECT pg_advisory_lock(hashtextextended('taleart:tale-media-migration', 0))");
        const log = vi.fn();
        expect(await continueTaleMediaMigration(pool, { log })).toEqual({ merged: 0, skipped: 0, done: false });
        expect(log).toHaveBeenCalledWith('info', expect.stringContaining('another process'));
      } finally {
        await holder.query("SELECT pg_advisory_unlock(hashtextextended('taleart:tale-media-migration', 0))");
        holder.release();
      }
    });

    it('writes no taleMedia while TALE_MEDIA_MIGRATION is off, delivering the media composed in', async () => {
      const { zone, group } = await zoneWithGroup();
      const legacy = await legacyTale(group.id, 'Legacy');
      const previous = process.env['TALE_MEDIA_MIGRATION'];
      process.env['TALE_MEDIA_MIGRATION'] = 'off';
      try {
        await migrate(pool);
        expect((await row(legacy.id)).draft).toBeNull();
        const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Uploaded' })).json();
        await publish('tales', tale.id);
        const put = await fetch(`${base}/tales/${tale.id}/media`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(put.status).toBe(200);
        expect((await row(tale.id)).draft).toBeNull();
        expect((await (await fetch(`${base}/tales/${tale.id}/document`)).json()).document).toBeNull();
        const [g] = await delivered(zone.id);
        expect(
          g.tales.map((t) => (t.document.elements[0] as { props?: { taleMedia?: boolean } }).props?.taleMedia),
        ).toEqual([true, true]);
      } finally {
        if (previous === undefined) delete process.env['TALE_MEDIA_MIGRATION'];
        else process.env['TALE_MEDIA_MIGRATION'] = previous;
        await migrate(pool);
      }
      expect((await row(legacy.id)).inStep).toBe(legacy.key);
    });

    it('rolls the documents back for the previous release, after a dry run that changes nothing', async () => {
      const { group } = await zoneWithGroup();
      const image = await legacyTale(group.id, 'Image');
      const studio = await legacyTale(group.id, 'Studio', { document: overlay('Stays') });
      await migrate(pool);
      const script = join(__dirname, '../scripts/tale-media-rollback.mjs');
      const run = (...args: string[]) =>
        execFileSync(process.execPath, [script, ...args], {
          env: { ...process.env, DATABASE_URL: testDatabaseUrl },
          encoding: 'utf8',
        });
      const before = await pool.query('SELECT id, document, draft_document, media_key FROM tales ORDER BY id');
      expect(run()).toContain('Would roll back (dry run; add --apply): 2 tale(s)');
      expect((await pool.query('SELECT id, document, draft_document, media_key FROM tales ORDER BY id')).rows).toEqual(
        before.rows,
      );
      expect(run('--apply')).toContain('Rolled back: 2 tale(s)');
      const imageRow = await row(image.id);
      expect([imageRow.document, imageRow.draft, imageRow.inStep, imageRow.key]).toEqual([null, null, null, image.key]);
      const studioRow = await row(studio.id);
      expect(studioRow.document?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
      expect(studioRow.draft?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
      const refs = await pool.query('SELECT 1 FROM tale_media WHERE tale_id = ANY($1::uuid[])', [
        [image.id, studio.id],
      ]);
      expect(refs.rowCount).toBe(0);
      // Nothing holds taleMedia any more: the previous release accepts every document.
      const flagged = await pool.query(
        `SELECT 1 FROM tales WHERE document::text LIKE '%taleMedia%' OR draft_document::text LIKE '%taleMedia%'`,
      );
      expect(flagged.rowCount).toBe(0);
    });

    it("keeps a copy in step only when the kept document holds the tale's media (R16)", async () => {
      const { group } = await zoneWithGroup();
      const tale = await legacyTale(group.id, 'Source', { status: 'draft' });
      await migrate(pool);
      const draft = (await row(tale.id)).draft;
      const res = await post(`/tales/${tale.id}/document/copy`, { document: draft });
      expect(res.status).toBe(201);
      const copy = await res.json();
      expect((await row(copy.id)).inStep).toBe(tale.key);
    });

    it('serves the migrated tales the sample-page review compares with the release before (fixture)', async () => {
      const { zone, group } = await zoneWithGroup();
      // Fixed keys and texts, so the fixture names them; the files are whatever the review serves.
      const words = {
        ...text('Summer sale'),
        box: { x: 0.1, y: 0.3, w: 0.8, h: 0.12, rotation: 0 },
        props: { text: 'Summer sale' },
      };
      // A media background over the tale's media (Tale Studio R2), contained, on a band colour.
      const backdropDocument = {
        version: 1,
        canvas: { background: { type: 'media', mediaKey: 'tales/r16-bg.png', fit: 'contain', color: '#334455' } },
        elements: [],
      };
      const seeds = [
        { name: 'image', options: { key: 'tales/r16-image.png' } },
        { name: 'video', options: { kind: 'video' as const, key: 'tales/r16-video.mp4' } },
        { name: 'gif', options: { key: 'tales/r16-gif.gif' } },
        { name: 'overlay', options: { key: 'tales/r16-overlay.png', document: overlay('x', { elements: [words] }) } },
        { name: 'background-image', options: { key: 'tales/r16-bg-image.png', document: backdropDocument } },
        {
          name: 'background-video',
          options: { kind: 'video' as const, key: 'tales/r16-bg-video.mp4', document: backdropDocument },
        },
      ];
      const ids: Record<string, string> = {};
      for (const { name, options } of seeds) ids[(await legacyTale(group.id, name, options)).id] = name;
      const empty = await (await post(`/tale-groups/${group.id}/tales`, { title: 'empty' })).json();
      await publish('tales', empty.id);
      await asLegacy(empty.id);
      ids[empty.id] = 'empty';
      // What the release before served: each tale's media, and its stored document as delivered, which is
      // the migrated one without the tale's media element and without the duration the migration added.
      type Delivered = { durationMs?: number; elements: { props?: { taleMedia?: boolean } }[] };
      const before = (doc: Delivered, seeded: { durationMs?: number } | undefined) => {
        if (!seeded) return null;
        const { durationMs, ...rest } = doc;
        const elements = doc.elements.filter((e) => e.props?.taleMedia !== true);
        return seeded.durationMs === undefined ? { ...rest, elements } : { ...rest, durationMs, elements };
      };
      await migrate(pool);
      const [delivered0] = await delivered(zone.id);
      const tales = delivered0.tales.map((tale) => {
        const name = ids[tale.id];
        const seed = seeds.find((s) => s.name === name);
        return {
          name,
          before: {
            media: (tale as unknown as { media: unknown }).media,
            document: before(
              tale.document as unknown as Delivered,
              (seed?.options as { document?: { durationMs?: number } } | undefined)?.document,
            ),
          },
          after: tale.document,
        };
      });
      const fixture = JSON.parse(
        JSON.stringify({ tales })
          .replaceAll(`${publicApiUrl}/media/`, '{API}/media/')
          .replace(/"id":"[0-9a-f-]{36}"/g, '"id":"00000000-0000-4000-8000-0000000000ee"'),
      );
      const file = join(__dirname, '../../sdk-sample/fixtures/r16-migration.json');
      if (process.env['UPDATE_R16_FIXTURE'] === '1') writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
      expect(fixture).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    });

    describe('follow-up review (R16)', () => {
      const saveSeen = (taleId: string, document: unknown, revision: number, sawTaleMedia: boolean) =>
        fetch(`${base}/tales/${taleId}/document`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document, revision, sawTaleMedia }),
        });

      it("keeps a person's removal of the tale's media when the editor saw it, after the next start too", async () => {
        const { zone, group } = await zoneWithGroup();
        // Out of step: a studio document from before the migration, which has not run yet.
        const tale = await legacyTale(group.id, 'Seen', { document: overlay('Words') });
        const read = await (await fetch(`${base}/tales/${tale.id}/document`)).json();
        expect(read.document.elements[0].props.taleMedia).toBe(true);
        const withoutMedia = { ...read.document, elements: read.document.elements.slice(1) };
        expect((await saveSeen(tale.id, withoutMedia, read.revision, true)).status).toBe(200);
        const stored = await row(tale.id);
        expect(stored.inStep).toBe(tale.key);
        expect(stored.draft?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
        // Visitors still see the media, now written into the published document: nothing changed for them.
        expect(stored.document?.elements[0]).toMatchObject({
          id: tale.id,
          props: { mediaKey: tale.key, taleMedia: true },
        });
        const [g] = await delivered(zone.id);
        expect(g.tales[0].document.elements[0]).toMatchObject({ props: { taleMedia: true } });
        await migrate(pool);
        expect((await row(tale.id)).draft?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
        expect((await (await fetch(`${base}/tales/${tale.id}/document`)).json()).document.elements).toHaveLength(1);
      });

      it('leaves the media composed in when the editor never saw it (opened before the migration)', async () => {
        const { group } = await zoneWithGroup();
        const tale = await legacyTale(group.id, 'Unseen', { document: overlay('Words') });
        expect((await saveSeen(tale.id, overlay('Edited before'), 3, false)).status).toBe(200);
        expect((await row(tale.id)).inStep).toBeNull();
        await migrate(pool);
        expect((await row(tale.id)).draft?.elements.map((e) => e['type'])).toEqual(['image', 'text']);
      });

      it('keeps a copy in step when the editor saw the media, even without it in the kept version', async () => {
        const { group } = await zoneWithGroup();
        const tale = await legacyTale(group.id, 'Copied', { document: overlay('Words') });
        const res = await post(`/tales/${tale.id}/document/copy`, { document: overlay('Mine'), sawTaleMedia: true });
        expect(res.status).toBe(201);
        const copy = await res.json();
        expect((await row(copy.id)).inStep).toBe(tale.key);
        expect((await (await fetch(`${base}/tales/${copy.id}/document`)).json()).document.elements).toHaveLength(1);
        expect(
          (await post(`/tales/${tale.id}/document/copy`, { document: overlay('x'), sawTaleMedia: 'yes' })).status,
        ).toBe(400);
      });

      it('takes a stale taleMedia mark off on save while TALE_MEDIA_MIGRATION is off, instead of refusing it', async () => {
        const { group } = await zoneWithGroup();
        const tale = await legacyTale(group.id, 'Stale', { status: 'draft' });
        await migrate(pool);
        const draft = (await row(tale.id)).draft as { elements: { props: Record<string, unknown> }[] };
        // An older instance replaced the media: the documents still show the key before.
        await pool.query(`UPDATE tales SET media_key = 'tales/0f.png' WHERE id = $1`, [tale.id]);
        await new LocalDiskStorage(mediaDir).put('tales/0f.png', png);
        const previous = process.env['TALE_MEDIA_MIGRATION'];
        process.env['TALE_MEDIA_MIGRATION'] = 'off';
        try {
          await migrate(pool);
          expect((await saveSeen(tale.id, draft, 1, false)).status).toBe(200);
          const saved = (await row(tale.id)).draft as { elements: { props: Record<string, unknown> }[] };
          expect(saved.elements[0].props).toEqual({ mediaKey: tale.key, fit: 'contain' });
        } finally {
          if (previous === undefined) delete process.env['TALE_MEDIA_MIGRATION'];
          else process.env['TALE_MEDIA_MIGRATION'] = previous;
          await migrate(pool);
        }
      });

      it('tries skipped tales again at start, the longest-skipped first, a bounded number', async () => {
        const { group } = await zoneWithGroup();
        const a = await legacyTale(group.id, 'A');
        const b = await legacyTale(group.id, 'B');
        // Both skipped before (their cause since gone); B for longer.
        await pool.query(
          `UPDATE tales SET document_media_skip_key = media_key, document_media_skip_reason = 'limits',
             document_media_skip_at = now() - CASE WHEN id = $2 THEN interval '2 days' ELSE interval '1 day' END
           WHERE id = ANY($1::uuid[])`,
          [[a.id, b.id], b.id],
        );
        const client = await pool.connect();
        try {
          await migrateTaleMediaDocuments(client, { batchSize: 1, budgetMs: 0 });
        } finally {
          client.release();
        }
        expect([(await row(a.id)).inStep, (await row(b.id)).inStep]).toEqual([null, b.key]);
      });

      it('finishes in the background only with room in the pool, retries a failed pass, and stops cleanly', async () => {
        const { group } = await zoneWithGroup();
        const tale = await legacyTale(group.id, 'Later');
        const log = vi.fn();
        expect(await continueTaleMediaMigration(pool, { poolMax: 2, log })).toEqual({
          merged: 0,
          skipped: 0,
          done: false,
        });
        expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('at least 3 needed'));
        // The first connection fails: the pass is tried again after the backoff, and finishes.
        let failures = 1;
        const flaky = {
          query: pool.query.bind(pool),
          connect: () => (failures-- > 0 ? Promise.reject(new Error('connection refused')) : pool.connect()),
        } as unknown as Pool;
        const retried = vi.fn();
        expect(await continueTaleMediaMigration(flaky, { baseDelayMs: 1, log: retried })).toEqual({
          merged: 1,
          skipped: 0,
          done: true,
        });
        expect(retried).toHaveBeenCalledWith('warn', expect.stringContaining('tried again'));
        expect((await row(tale.id)).inStep).toBe(tale.key);
        // An ended pool is a clean stop, with nothing logged as a failure.
        const ended = createPool(testDatabaseUrl, 3);
        await ended.end();
        const quiet = vi.fn();
        await expect(continueTaleMediaMigration(ended, { baseDelayMs: 1, log: quiet })).resolves.toMatchObject({
          done: false,
        });
        expect(quiet).not.toHaveBeenCalledWith('warn', expect.stringContaining('tried again'));
        // An aborted signal does not start a pass.
        const stop = new AbortController();
        stop.abort();
        expect(await continueTaleMediaMigration(pool, { signal: stop.signal })).toEqual({
          merged: 0,
          skipped: 0,
          done: false,
        });
      });

      it('rolls back an out-of-step tale keeping its media key, and keeps a person-edited migration document', async () => {
        const { group } = await zoneWithGroup();
        const older = await legacyTale(group.id, 'Older');
        const edited = await legacyTale(group.id, 'Edited', { status: 'draft' });
        await migrate(pool);
        // An older instance replaced Older's media; a person added text to Edited's migration-made draft.
        await pool.query(
          `UPDATE tales SET media_key = 'tales/0e.png', media_content_type = 'image/png' WHERE id = $1`,
          [older.id],
        );
        const draft = (await row(edited.id)).draft as { elements: unknown[] };
        expect((await save(edited.id, { ...draft, elements: [...draft.elements, text('Kept')] }, 1)).status).toBe(200);
        const script = join(__dirname, '../scripts/tale-media-rollback.mjs');
        const output = execFileSync(process.execPath, [script, '--apply'], {
          env: { ...process.env, DATABASE_URL: testDatabaseUrl },
          encoding: 'utf8',
        });
        expect(output).toContain('document(s) the migration created set back to null');
        const olderRow = await pool.query('SELECT media_key, media_content_type FROM tales WHERE id = $1', [older.id]);
        expect(olderRow.rows).toEqual([{ media_key: 'tales/0e.png', media_content_type: 'image/png' }]);
        expect((await row(older.id)).document).toBeNull();
        expect((await row(edited.id)).draft?.elements.map((e) => e['id'])).toEqual([TEXT_ID]);
        const flags = await pool.query('SELECT count(*)::int AS n FROM tales WHERE document_created_by_migration');
        expect(flags.rows[0].n).toBe(0);
      });
    });

    it('gives a new tale from uploaded media a draft and a published document of it at once, and keeps it in step on replace', async () => {
      const { zone, group } = await zoneWithGroup();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'New' })).json();
      const put = (contentType: string, body: Buffer) =>
        fetch(`${base}/tales/${tale.id}/media`, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
      expect((await put('image/png', png)).status).toBe(200);
      const first = await row(tale.id);
      expect(first.draft?.elements).toEqual([ownElement('image', first.key as string)]);
      // New tales are stored live (AD-6 amended), so the media document is published at creation.
      expect(first.document).toEqual(first.draft);
      expect([first.revision, first.inStep]).toEqual([1, first.key]);
      expect((await delivered(zone.id))[0].tales.map((t) => t.id)).toEqual([tale.id]);
      // A person adds text over it and updates the tale (7.3).
      const withText = { ...first.draft, elements: [...(first.draft?.elements ?? []), text('Hello')] };
      expect((await save(tale.id, withText, 1)).status).toBe(200);
      expect((await post(`/tales/${tale.id}/document/publish`, { revision: 2, publishedRevision: 1 })).status).toBe(200);
      const [g] = await delivered(zone.id);
      expect(g.tales[0].document.elements.map((e) => (e as { type?: string }).type)).toEqual(['image', 'text']);
      // Replacing the media changes the media element of both documents, keeping the text.
      expect((await put('video/mp4', mp4)).status).toBe(200);
      const replaced = await row(tale.id);
      expect(replaced.document?.elements[0]).toMatchObject({ type: 'video', props: { mediaKey: replaced.key } });
      expect(replaced.draft?.elements.map((e) => e['type'])).toEqual(['video', 'text']);
      expect(existsSync(join(mediaDir, first.key as string))).toBe(false);
    });
  });

  describe('On/Off and Shown/Hidden: the shown-status migration (epic UX rework R6, story 8.1)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const textDocument = (value: string) => ({
      version: 1,
      canvas: { background: { type: 'color', color: '#112233' } },
      elements: [
        {
          id: '00000000-0000-4000-8000-0000000000f1',
          type: 'text',
          box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { text: value },
        },
      ],
    });

    // A tale as the release before the UX rework stored it: `status` as given, from media, a studio
    // draft, or neither. Media uploaded to a tale that was not live gave it a draft document only (7.11).
    async function tale(groupId: string, title: string, status: string, from: 'media' | 'studio' | 'none') {
      const created = await (await post(`/tale-groups/${groupId}/tales`, { title })).json();
      if (status !== 'live') await pool.query("UPDATE tales SET status = 'draft' WHERE id = $1", [created.id]);
      if (from === 'media') {
        const res = await fetch(`${base}/tales/${created.id}/media`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(res.status).toBe(200);
      }
      if (from === 'studio') {
        const res = await fetch(`${base}/tales/${created.id}/document`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: textDocument(title), revision: 0 }),
        });
        expect(res.status).toBe(200);
      }
      await pool.query('UPDATE tales SET status = $2 WHERE id = $1', [created.id, status]);
      return created.id as string;
    }

    async function group(zoneId: string, name: string, status: string): Promise<string> {
      const created = await (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
      await pool.query('UPDATE tale_groups SET status = $2 WHERE id = $1', [created.id, status]);
      return created.id;
    }

    // Every zone's Delivery answer, as the bytes a visitor's SDK receives.
    async function deliveries(keys: string[]): Promise<string[]> {
      clearDeliveryCache();
      const bodies: string[] = [];
      for (const key of keys) {
        const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
        expect(res.status).toBe(200);
        bodies.push(await res.text());
      }
      return bodies;
    }

    interface Snapshot {
      title: string;
      status: string;
      document: unknown;
      revision: number;
      draft: unknown;
    }
    async function snapshot(): Promise<Snapshot[]> {
      return (
        await pool.query(
          `SELECT t.title, t.status, t.document, t.document_revision AS revision, t.draft_document AS draft,
             t.draft_revision AS "draftRevision", t.media_key AS key, g.status AS "groupStatus"
           FROM tales t JOIN tale_groups g ON g.id = t.tale_group_id ORDER BY t.title`,
        )
      ).rows;
    }

    // A database as the release before left it: (a) a group never live with draft tales, (b) a live
    // group with draft tales, (c) a paused group, placed in two zones with keys.
    async function preRework() {
      const zone = await createZone();
      const second = await (await post('/zones', { name: 'Checkout', projectId: zone.projectId })).json();
      const never = await group(zone.id, 'Never live', 'draft');
      const live = await group(zone.id, 'Live', 'live');
      const paused = await group(zone.id, 'Paused', 'paused');
      for (const id of [live, paused]) {
        expect((await fetch(`${base}/zones/${second.id}/tale-groups/${id}`, { method: 'PUT' })).status).toBe(201);
      }
      const ids = {
        a1: await tale(never, 'a1 media', 'draft', 'media'),
        a2: await tale(never, 'a2 studio', 'draft', 'studio'),
        a3: await tale(never, 'a3 paused', 'paused', 'media'),
        a4: await tale(never, 'a4 empty', 'draft', 'none'),
        b1: await tale(live, 'b1 live', 'live', 'media'),
        b2: await tale(live, 'b2 draft', 'draft', 'media'),
        b3: await tale(live, 'b3 placeholder', 'live', 'none'),
        b4: await tale(live, 'b4 studio draft', 'draft', 'studio'),
        b5: await tale(live, 'b5 seen', 'live', 'media'),
        c1: await tale(paused, 'c1 draft', 'draft', 'media'),
        c2: await tale(paused, 'c2 live', 'live', 'media'),
      };
      // (b5) A live tale whose media a studio save marked in step (markTaleMediaSeen) with nothing
      // published, as a tale made while TALE_MEDIA_MIGRATION was off and then edited: the Delivery
      // API composes its media.
      await pool.query('UPDATE tales SET document = NULL, document_media_key = media_key WHERE id = $1', [ids.b5]);
      await pool.query("DELETE FROM tale_media WHERE tale_id = $1 AND document = 'published'", [ids.b5]);
      const keys: string[] = [];
      for (const z of [zone, second]) keys.push((await (await postKey(z.id)).json()).key);
      // As before the step: it has not run.
      await pool.query('DELETE FROM tales_migrations');
      return { never, ids, keys };
    }

    const shape = (body: string) =>
      (JSON.parse(body).taleGroups as { name: string; tales: { title: string }[] }[]).map((g) => [
        g.name,
        g.tales.map((t) => t.title),
      ]);

    it('makes the draft tales of never-live groups live, keeps the others, and changes no Delivery answer', async () => {
      const { never, keys } = await preRework();
      const before = await deliveries(keys);
      const liveGroup = ['Live', ['b1 live', 'b3 placeholder', 'b5 seen']];
      expect(before.map(shape)).toEqual([[liveGroup], [liveGroup]]);
      const rowsBefore = await snapshot();

      await migrate(pool);

      expect(await deliveries(keys)).toEqual(before);
      const after = await snapshot();
      expect(after.map((r) => [r.title, r.status])).toEqual([
        ['a1 media', 'live'],
        ['a2 studio', 'live'],
        ['a3 paused', 'paused'],
        ['a4 empty', 'live'],
        ['b1 live', 'live'],
        ['b2 draft', 'draft'],
        ['b3 placeholder', 'live'],
        ['b4 studio draft', 'draft'],
        ['b5 seen', 'live'],
        ['c1 draft', 'draft'],
        ['c2 live', 'live'],
      ]);
      // Made live, their drafts are published, as going live always did (AD-15); a tale with neither
      // stays without one. Nothing else changed.
      const byTitle = (rows: Snapshot[], title: string) => rows.find((r) => r.title === title);
      for (const title of ['a1 media', 'a2 studio']) {
        expect(byTitle(after, title)?.document).toEqual(byTitle(rowsBefore, title)?.draft);
        expect(byTitle(after, title)?.revision).toBe(1);
      }
      expect(byTitle(after, 'a4 empty')?.document).toBeNull();
      const changed = ['a1 media', 'a2 studio', 'a4 empty'];
      const untouched = (rows: Snapshot[]) => rows.filter((r) => !changed.includes(r.title));
      expect(untouched(after)).toEqual(untouched(rowsBefore));

      // Turning the never-live group On shows its tales, except the one hidden before. The empty one,
      // created before the step, keeps the placeholder it would always have shown.
      await publish('tale-groups', never);
      const [on] = await deliveries([keys[0]]);
      expect(shape(on)).toEqual([
        ['Never live', ['a1 media', 'a2 studio', 'a4 empty']],
        liveGroup,
      ]);
    });

    it('runs once: a second start changes nothing, not even a draft tale stored since', async () => {
      const { ids, keys } = await preRework();
      await migrate(pool);
      const once = await snapshot();
      const delivered = await deliveries(keys);
      // A kept copy is stored draft (Hidden), in a group that was never live.
      const copy = await post(`/tales/${ids.a2}/document/copy`, { document: textDocument('Kept') });
      expect(copy.status).toBe(201);
      const copyId = (await copy.json()).id;
      const steps = (await pool.query('SELECT step, applied_at FROM tales_migrations')).rows;
      expect(steps.map((s) => s.step)).toEqual(['shown-status']);

      await migrate(pool);
      await restart();

      expect((await snapshot()).filter((r) => r.title !== 'a2 studio (copy)')).toEqual(once);
      expect((await pool.query('SELECT status FROM tales WHERE id = $1', [copyId])).rows[0].status).toBe('draft');
      expect((await pool.query('SELECT step, applied_at FROM tales_migrations')).rows).toEqual(steps);
      expect(await deliveries(keys)).toEqual(delivered);
    });

    it('runs once when two starts migrate at the same time', async () => {
      const { keys } = await preRework();
      const before = await deliveries(keys);

      await Promise.all([migrate(pool), migrate(pool)]);

      expect((await pool.query('SELECT step FROM tales_migrations')).rows).toEqual([{ step: 'shown-status' }]);
      const after = await snapshot();
      expect(after.filter((r) => r.status === 'live').map((r) => r.title)).toEqual([
        'a1 media',
        'a2 studio',
        'a4 empty',
        'b1 live',
        'b3 placeholder',
        'b5 seen',
        'c2 live',
      ]);
      // Each made-live draft is published once.
      expect(after.find((r) => r.title === 'a2 studio')?.revision).toBe(1);
      expect(await deliveries(keys)).toEqual(before);
    });

    it("keeps a tale's status change when publishing its draft fails, and logs it", async () => {
      const { ids } = await preRework();
      // Publishing a2's draft fails as an unexpected database error would.
      await pool.query(`
        CREATE FUNCTION fail_a2_publish() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN
          IF NEW.title = 'a2 studio' AND NEW.document IS NOT NULL THEN RAISE EXCEPTION 'disk full'; END IF;
          RETURN NEW;
        END $fn$;
        CREATE TRIGGER fail_a2_publish BEFORE UPDATE ON tales FOR EACH ROW EXECUTE FUNCTION fail_a2_publish();
      `);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      let logged = '';
      try {
        await migrate(pool);
        logged = warn.mock.calls.flat().join('\n');
      } finally {
        warn.mockRestore();
        await pool.query('DROP TRIGGER fail_a2_publish ON tales; DROP FUNCTION fail_a2_publish();');
      }
      const after = await snapshot();
      const a2 = after.find((r) => r.title === 'a2 studio');
      expect([a2?.status, a2?.document]).toEqual(['live', null]);
      // The others went on: a1's draft is published.
      expect(after.find((r) => r.title === 'a1 media')?.revision).toBe(1);
      expect(logged).toContain(`Tale ${ids.a2}: made live, but its draft could not be published`);
    });

    it('runs the step while TALE_MEDIA_MIGRATION is off, with no Delivery answer changed', async () => {
      const { keys } = await preRework();
      const before = await deliveries(keys);
      const previous = process.env['TALE_MEDIA_MIGRATION'];
      process.env['TALE_MEDIA_MIGRATION'] = 'off';
      try {
        await migrate(pool);
        const after = await snapshot();
        expect(after.filter((r) => r.status === 'live').map((r) => r.title)).toContain('a1 media');
        expect(after.find((r) => r.title === 'a2 studio')?.revision).toBe(1);
        expect(await deliveries(keys)).toEqual(before);
      } finally {
        if (previous === undefined) delete process.env['TALE_MEDIA_MIGRATION'];
        else process.env['TALE_MEDIA_MIGRATION'] = previous;
      }
      await migrate(pool);
      expect(await deliveries(keys)).toEqual(before);
    });

    it('does not deliver a title-only tale created after the step', async () => {
      const zone = await createZone();
      const g = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Fresh' })).json();
      await publish('tale-groups', g.id);
      await post(`/tale-groups/${g.id}/tales`, { title: 'Title only' });
      const { key } = await (await postKey(zone.id)).json();
      expect((await deliveries([key])).map(shape)).toEqual([[]]);
    });

    it('publishes nothing when media is uploaded to a shown tale with only a studio draft; a tale from media alone is published', async () => {
      const zone = await createZone();
      const g = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Fresh' })).json();
      await publish('tale-groups', g.id);
      const drafted = await (await post(`/tale-groups/${g.id}/tales`, { title: 'Drafted' })).json();
      const saved = await fetch(`${base}/tales/${drafted.id}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: textDocument('Drafted'), revision: 0 }),
      });
      expect(saved.status).toBe(200);
      const fromMedia = await (await post(`/tale-groups/${g.id}/tales`, { title: 'From media' })).json();
      for (const id of [drafted.id, fromMedia.id]) {
        const res = await fetch(`${base}/tales/${id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
        expect(res.status).toBe(200);
      }
      const state = async (id: string) => (await (await fetch(`${base}/tales/${id}/document`)).json()).published.document;
      // Not updated yet: the draft (now with the media) waits for the person to publish it.
      expect(await state(drafted.id)).toBeNull();
      expect(await state(fromMedia.id)).not.toBeNull();
      const { key } = await (await postKey(zone.id)).json();
      expect((await deliveries([key])).map(shape)).toEqual([[['Fresh', ['From media']]]]);
    });

    it('does not show the media alone of a shown tale with only a studio draft while its media is out of step', async () => {
      const zone = await createZone();
      const g = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Fresh' })).json();
      await publish('tale-groups', g.id);
      const drafted = await (await post(`/tale-groups/${g.id}/tales`, { title: 'Drafted' })).json();
      const saved = await fetch(`${base}/tales/${drafted.id}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: textDocument('Drafted'), revision: 0 }),
      });
      expect(saved.status).toBe(200);
      const fromMedia = await (await post(`/tale-groups/${g.id}/tales`, { title: 'From media' })).json();
      const { key } = await (await postKey(zone.id)).json();
      const previous = process.env['TALE_MEDIA_MIGRATION'];
      process.env['TALE_MEDIA_MIGRATION'] = 'off';
      try {
        await migrate(pool);
        // Media written while the media documents are off: both tales are out of step.
        for (const id of [drafted.id, fromMedia.id]) {
          const res = await fetch(`${base}/tales/${id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
          expect(res.status).toBe(200);
        }
        // The drafted tale waits for its draft to be published; the tale of media alone shows it.
        expect((await deliveries([key])).map(shape)).toEqual([[['Fresh', ['From media']]]]);

        // A tale from before the step, in the same state, shows its media composed in, as it did.
        await asLegacy(drafted.id);
        expect((await deliveries([key])).map(shape)).toEqual([[['Fresh', ['Drafted', 'From media']]]]);
      } finally {
        if (previous === undefined) delete process.env['TALE_MEDIA_MIGRATION'];
        else process.env['TALE_MEDIA_MIGRATION'] = previous;
        await migrate(pool);
      }
    });

    it('still delivers a tale from before the step with its media in step and only a studio draft', async () => {
      const zone = await createZone();
      const g = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Old' })).json();
      await publish('tale-groups', g.id);
      const t = await (await post(`/tale-groups/${g.id}/tales`, { title: 'Seen' })).json();
      const res = await fetch(`${base}/tales/${t.id}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
      expect(res.status).toBe(200);
      // As markTaleMediaSeen leaves it: in step, a draft, nothing published.
      await pool.query('UPDATE tales SET document = NULL, document_media_key = media_key WHERE id = $1', [t.id]);
      await asLegacy(t.id);
      const { key } = await (await postKey(zone.id)).json();
      const [body] = await deliveries([key]);
      const tales = JSON.parse(body).taleGroups[0].tales as { title: string; document: { elements: { props: { taleMedia?: boolean } }[] } }[];
      expect(tales.map((tale) => tale.title)).toEqual(['Seen']);
      expect(tales[0].document.elements[0].props.taleMedia).toBe(true);
    });

    it('delivers a copy of a group from before the step as the source: its title-only tales keep the placeholder', async () => {
      const zone = await createZone();
      const g = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Old' })).json();
      await publish('tale-groups', g.id);
      const t = await (await post(`/tale-groups/${g.id}/tales`, { title: 'Title only' })).json();
      await asLegacy(t.id);
      const copy = await post(`/tale-groups/${g.id}/copy`, { zoneId: zone.id });
      expect(copy.status).toBe(201);
      const copied = await copy.json();
      await publish('tale-groups', copied.id);
      const { key } = await (await postKey(zone.id)).json();
      const [body] = await deliveries([key]);
      const groups = JSON.parse(body).taleGroups as { id: string; tales: { title: string; document: unknown }[] }[];
      expect(groups.map((group) => group.tales.map((tale) => tale.title))).toEqual([['Title only'], ['Title only']]);
      expect(groups[1].tales[0].document).toEqual(groups[0].tales[0].document);
    });
  });

  describe('"Visible on site / Not visible because…" (epic UX rework R7, story 8.2)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const HOUR = 60 * 60 * 1000;

    interface Visibility {
      visible: boolean;
      reasons: { code: string; subject: string; at?: string }[];
    }
    interface ListedTale {
      id: string;
      visibility: Visibility;
    }
    interface ListedGroup {
      id: string;
      visibility: Visibility;
      tales: ListedTale[];
    }
    // A zone with a display and a key, and a group that is On with two tales from media: all visible.
    interface Fixture {
      projectId: string;
      zoneId: string;
      key: string | null;
      groupId: string;
      taleId: string;
      otherId: string;
    }

    function send(method: string, path: string, body?: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    async function upload(taleId: string): Promise<void> {
      const res = await fetch(`${base}/tales/${taleId}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(res.status).toBe(200);
    }

    // A tale from uploaded media: Shown, with its media document published at creation (AD-15).
    async function taleFromMedia(groupId: string, title: string): Promise<string> {
      const { id } = await (await post(`/tale-groups/${groupId}/tales`, { title })).json();
      await upload(id);
      return id;
    }

    async function fixture(): Promise<Fixture> {
      const zone = await createZone();
      const { key } = await (await postKey(zone.id)).json();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      await publish('tale-groups', group.id);
      const taleId = await taleFromMedia(group.id, 'Target');
      const otherId = await taleFromMedia(group.id, 'Other');
      return { projectId: zone.projectId, zoneId: zone.id, key, groupId: group.id, taleId, otherId };
    }

    // What the site shows for the zone: the groups and tales its key delivers; nothing without a key.
    async function delivered(key: string | null): Promise<{ groups: string[]; tales: string[] }> {
      if (key === null) return { groups: [], tales: [] };
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      expect(res.status).toBe(200);
      const body: { taleGroups: { id: string; tales: { id: string }[] }[] } = await res.json();
      return {
        groups: body.taleGroups.map((g) => g.id),
        tales: body.taleGroups.flatMap((g) => g.tales.map((t) => t.id)),
      };
    }

    async function listed(zoneId: string): Promise<ListedGroup[]> {
      return (await send('GET', `/zones/${zoneId}/tale-groups`)).json();
    }

    async function zoneVisibility(zoneId: string): Promise<Visibility> {
      const zones: { id: string; visibility: Visibility }[] = await (await send('GET', '/zones')).json();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) throw new Error('zone not listed');
      return zone.visibility;
    }

    async function projectGroup(f: Fixture): Promise<{ visibility: Visibility; zoneIds: string[] }> {
      const groups: { id: string; visibility: Visibility; zoneIds: string[] }[] = await (
        await send('GET', `/projects/${f.projectId}/tale-groups`)
      ).json();
      const group = groups.find((g) => g.id === f.groupId);
      if (!group) throw new Error('group not listed');
      return group;
    }

    // The indicator and the Delivery API agree on every placement and tale of the zone, the zone
    // itself, and, row by row in SQL, the Delivery filter and the reasons on every tale and group.
    async function expectAgreement(f: Fixture): Promise<void> {
      const site = await delivered(f.key);
      const groups = await listed(f.zoneId);
      for (const group of groups) {
        expect({ group: group.id, visible: group.visibility.visible }).toEqual({
          group: group.id,
          visible: site.groups.includes(group.id),
        });
        expect(group.visibility.visible).toBe(group.visibility.reasons.length === 0);
        for (const tale of group.tales) {
          expect({ tale: tale.id, visible: tale.visibility.visible }).toEqual({
            tale: tale.id,
            visible: site.tales.includes(tale.id),
          });
          expect(tale.visibility.visible).toBe(tale.visibility.reasons.length === 0);
        }
      }
      expect((await zoneVisibility(f.zoneId)).visible).toBe(site.groups.length > 0);
      const tales = await pool.query<{ delivered: boolean; reasons: unknown[] }>(
        `SELECT ${deliveredTale('t', 'now()')} AS delivered, ${taleReasonsSql('t', 'now()')} AS reasons FROM tales t`,
      );
      const groupRows = await pool.query<{ delivered: boolean; reasons: unknown[] }>(
        `SELECT ${deliveredGroup('g', 'now()')} AS delivered, ${groupReasonsSql('g', 'now()')} AS reasons FROM tale_groups g`,
      );
      const placementRows = await pool.query<{ delivered: boolean; reasons: unknown[] }>(
        `SELECT ${deliveredPlacement('g', 'z.zone_id', 'now()')} AS delivered,
           ${groupReasonsSql('g', 'now()', 'z.zone_id')} AS reasons
         FROM zone_tale_groups z JOIN tale_groups g ON g.id = z.tale_group_id`,
      );
      const zoneRows = await pool.query<{ delivered: boolean; reasons: unknown[] }>(
        `SELECT ${zoneDelivers('z.id', 'now()')} AS delivered, ${zoneReasonsSql('z.id', 'now()')} AS reasons FROM zones z`,
      );
      for (const row of [...tales.rows, ...groupRows.rows, ...placementRows.rows, ...zoneRows.rows]) {
        expect(row.delivered).toBe(row.reasons.length === 0);
      }
    }

    async function taleIn(f: Fixture, taleId: string): Promise<ListedTale | undefined> {
      return (await listed(f.zoneId)).flatMap((g) => g.tales).find((t) => t.id === taleId);
    }

    async function placement(f: Fixture): Promise<ListedGroup | undefined> {
      return (await listed(f.zoneId)).find((g) => g.id === f.groupId);
    }

    async function schedule(kind: 'tale-groups' | 'tales', id: string, startsAt: string | null, endsAt: string | null) {
      expect((await send('PUT', `/${kind}/${id}/schedule`, { startsAt, endsAt })).status).toBe(200);
    }

    const future = () => new Date(Date.now() + HOUR).toISOString();
    const past = () => new Date(Date.now() - HOUR).toISOString();

    interface Case {
      name: string;
      // What the indicator names it on: the tale (in the zone), the placement, the zone, or the project's group.
      on: 'tale' | 'placement' | 'zone' | 'project-group';
      reason: () => ReturnType<typeof why>;
      // What the Delivery API leaves out while it holds.
      omits: 'tale' | 'group' | 'everything';
      breakIt: (f: Fixture) => Promise<void>;
      fix: (f: Fixture) => Promise<void>;
    }

    let window = '';
    const cases: Case[] = [
      {
        name: 'group off',
        on: 'tale',
        reason: () => why('group-off', 'group'),
        omits: 'group',
        breakIt: async (f) => expect((await setStatus('tale-groups', f.groupId, 'paused')).status).toBe(200),
        fix: (f) => publish('tale-groups', f.groupId),
      },
      {
        name: 'tale hidden',
        on: 'tale',
        reason: () => why('tale-hidden', 'tale'),
        omits: 'tale',
        breakIt: async (f) => expect((await setStatus('tales', f.taleId, 'paused')).status).toBe(200),
        fix: (f) => publish('tales', f.taleId),
      },
      {
        name: 'group blocked',
        on: 'placement',
        reason: () => why('group-blocked', 'group'),
        omits: 'group',
        breakIt: async (f) => {
          await pool.query("UPDATE tale_groups SET status = 'quota-reached' WHERE id = $1", [f.groupId]);
        },
        fix: async (f) => {
          await pool.query("UPDATE tale_groups SET status = 'live' WHERE id = $1", [f.groupId]);
        },
      },
      {
        name: 'tale archived',
        on: 'tale',
        reason: () => why('archived', 'tale'),
        omits: 'tale',
        breakIt: async (f) => expect((await setStatus('tales', f.taleId, 'archived')).status).toBe(200),
        fix: async (f) => {
          expect((await setStatus('tales', f.taleId, 'paused')).status).toBe(200);
          await publish('tales', f.taleId);
        },
      },
      {
        name: 'group archived',
        on: 'placement',
        reason: () => why('archived', 'group'),
        omits: 'group',
        breakIt: async (f) => expect((await setStatus('tale-groups', f.groupId, 'archived')).status).toBe(200),
        fix: async (f) => {
          expect((await setStatus('tale-groups', f.groupId, 'paused')).status).toBe(200);
          await publish('tale-groups', f.groupId);
        },
      },
      {
        name: 'no shown tales',
        on: 'placement',
        reason: () => why('no-shown-tales', 'group'),
        omits: 'group',
        breakIt: async (f) => {
          for (const id of [f.taleId, f.otherId]) expect((await setStatus('tales', id, 'paused')).status).toBe(200);
        },
        fix: (f) => publish('tales', f.taleId, f.otherId),
      },
      {
        name: 'not in any zone',
        on: 'project-group',
        reason: () => why('not-in-any-zone', 'group'),
        omits: 'group',
        breakIt: async (f) => expect((await send('DELETE', `/zones/${f.zoneId}/tale-groups/${f.groupId}`)).status).toBe(204),
        fix: async (f) => expect((await send('PUT', `/zones/${f.zoneId}/tale-groups/${f.groupId}`)).status).toBe(201),
      },
      {
        name: 'tale starts later',
        on: 'tale',
        reason: () => why('starts-at', 'tale', window),
        omits: 'tale',
        breakIt: async (f) => {
          window = future();
          await schedule('tales', f.taleId, window, null);
        },
        fix: (f) => schedule('tales', f.taleId, null, null),
      },
      {
        name: 'tale ended',
        on: 'tale',
        reason: () => why('ended-at', 'tale', window),
        omits: 'tale',
        breakIt: async (f) => {
          window = past();
          await schedule('tales', f.taleId, null, window);
        },
        fix: (f) => schedule('tales', f.taleId, null, null),
      },
      {
        name: 'group starts later',
        on: 'tale',
        reason: () => why('starts-at', 'group', window),
        omits: 'group',
        breakIt: async (f) => {
          window = future();
          await schedule('tale-groups', f.groupId, window, null);
        },
        fix: (f) => schedule('tale-groups', f.groupId, null, null),
      },
      {
        name: 'group ended',
        on: 'placement',
        reason: () => why('ended-at', 'group', window),
        omits: 'group',
        breakIt: async (f) => {
          window = past();
          await schedule('tale-groups', f.groupId, null, window);
        },
        fix: (f) => schedule('tale-groups', f.groupId, null, null),
      },
      {
        name: 'zone has no visible group',
        on: 'zone',
        reason: () => why('no-visible-groups', 'zone'),
        omits: 'everything',
        breakIt: async (f) => expect((await setStatus('tale-groups', f.groupId, 'paused')).status).toBe(200),
        fix: (f) => publish('tale-groups', f.groupId),
      },
      {
        name: 'zone has no display',
        on: 'zone',
        reason: () => why('zone-no-display', 'zone'),
        omits: 'everything',
        // No route removes a display; the fixture removes the frame row as such a route would.
        breakIt: async (f) => {
          await pool.query('DELETE FROM frames WHERE zone_id = $1', [f.zoneId]);
        },
        fix: async (f) =>
          expect((await post(`/zones/${f.zoneId}/frame`, { type: 'banner', settings: {} })).status).toBe(201),
      },
      {
        name: 'zone not installed',
        on: 'zone',
        reason: () => why('zone-not-installed', 'zone'),
        omits: 'everything',
        breakIt: async (f) => {
          expect((await send('DELETE', `/zones/${f.zoneId}/key`)).status).toBe(204);
          // The revoked key is refused: the site shows nothing.
          const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, {
            headers: { Authorization: `Bearer ${f.key}` },
          });
          expect(res.status).toBe(401);
          f.key = null;
        },
        fix: async (f) => {
          f.key = (await (await postKey(f.zoneId)).json()).key;
        },
      },
      {
        name: 'media still processing',
        on: 'tale',
        reason: () => why('media-processing', 'tale'),
        omits: 'tale',
        breakIt: async (f) => {
          await pool.query("UPDATE tales SET status = 'processing' WHERE id = $1", [f.taleId]);
        },
        fix: async (f) => {
          await pool.query("UPDATE tales SET status = 'live' WHERE id = $1", [f.taleId]);
        },
      },
      {
        name: 'media problem',
        on: 'tale',
        reason: () => why('media-problem', 'tale'),
        omits: 'tale',
        breakIt: async (f) => {
          await pool.query("UPDATE tales SET status = 'invalid-media' WHERE id = $1", [f.taleId]);
        },
        fix: async (f) => {
          await pool.query("UPDATE tales SET status = 'live' WHERE id = $1", [f.taleId]);
        },
      },
      {
        name: 'not updated yet',
        on: 'tale',
        reason: () => why('not-updated-yet', 'tale'),
        omits: 'tale',
        // A new Shown tale with nothing published (AD-15): media gives it a published document.
        breakIt: async (f) => {
          f.taleId = (await (await post(`/tale-groups/${f.groupId}/tales`, { title: 'Fresh' })).json()).id;
        },
        fix: (f) => upload(f.taleId),
      },
    ];

    it('says "Visible on site" for a set-up zone, its group that is On and its tales, as the Delivery API delivers them', async () => {
      const f = await fixture();
      expect(await zoneVisibility(f.zoneId)).toEqual(VISIBLE);
      const [group] = await listed(f.zoneId);
      expect(group.visibility).toEqual(VISIBLE);
      expect(group.tales.map((t) => t.visibility)).toEqual([VISIBLE, VISIBLE]);
      expect(await delivered(f.key)).toEqual({ groups: [f.groupId], tales: [f.taleId, f.otherId] });
      expect((await projectGroup(f)).visibility).toEqual(VISIBLE);
      await expectAgreement(f);
    });

    it('covers every reason code with a fixture', () => {
      // `no-tale-groups` has its own test: a zone with no placement has no group to fix.
      const codes = new Set([...cases.map((c) => c.reason().code), 'no-tale-groups']);
      expect([...codes].sort()).toEqual([...VISIBILITY_REASON_CODES].sort());
    });

    it.each(cases.map((c) => [c.name, c] as const))(
      '%s: the indicator names it while the Delivery API leaves the content out; fixed, both show it',
      async (_name, c) => {
        const f = await fixture();
        await c.breakIt(f);
        const expected = c.reason();
        const read =
          c.on === 'zone'
            ? await zoneVisibility(f.zoneId)
            : c.on === 'placement'
              ? (await placement(f))?.visibility
              : c.on === 'project-group'
                ? (await projectGroup(f)).visibility
                : (await taleIn(f, f.taleId))?.visibility;
        expect(read?.visible).toBe(false);
        expect(read?.reasons[0]).toEqual(expected);
        const site = await delivered(f.key);
        if (c.omits === 'everything') expect(site).toEqual({ groups: [], tales: [] });
        if (c.omits === 'group') expect(site.groups).not.toContain(f.groupId);
        expect(site.tales).not.toContain(f.taleId);
        // The zone's placement and its tales say it too.
        if (c.on === 'zone' && expected.code.startsWith('zone-')) {
          expect((await placement(f))?.visibility.reasons).toContainEqual(expected);
          expect((await taleIn(f, f.taleId))?.visibility.reasons).toContainEqual(expected);
        }
        await expectAgreement(f);

        await c.fix(f);
        expect((await taleIn(f, f.taleId))?.visibility).toEqual(VISIBLE);
        expect((await placement(f))?.visibility).toEqual(VISIBLE);
        expect(await zoneVisibility(f.zoneId)).toEqual(VISIBLE);
        expect((await delivered(f.key)).tales).toContain(f.taleId);
        await expectAgreement(f);
      },
    );

    it('reads a placement in its zone, and a group or tale in any zone it is placed in', async () => {
      const f = await fixture();
      const bare = await (await post('/zones', { name: 'Bare', projectId: f.projectId })).json();
      expect((await send('PUT', `/zones/${bare.id}/tale-groups/${f.groupId}`)).status).toBe(201);
      // In the bare zone the placement is not visible, for the bare zone's reasons...
      const there = (await listed(bare.id)).find((g) => g.id === f.groupId);
      expect(there?.visibility).toEqual(notVisible(why('zone-no-display', 'zone'), why('zone-not-installed', 'zone')));
      expect(there?.tales[0].visibility.visible).toBe(false);
      // ...while the group and its tale, read for every zone, are visible through the set-up one.
      expect((await projectGroup(f)).visibility).toEqual(VISIBLE);
      expect((await (await setStatus('tales', f.taleId, 'live')).json()).visibility).toEqual(VISIBLE);
    });

    it('words a zone with no tale group apart from one whose groups are not visible', async () => {
      const f = await fixture();
      const empty = await (await post('/zones', { name: 'Empty', projectId: f.projectId })).json();
      await postKey(empty.id);
      expect(await zoneVisibility(empty.id)).toEqual(notVisible(why('no-tale-groups', 'zone')));
      expect((await setStatus('tale-groups', f.groupId, 'paused')).status).toBe(200);
      expect(await zoneVisibility(f.zoneId)).toEqual(notVisible(why('no-visible-groups', 'zone')));
      await expectAgreement(f);
    });

    it('agrees on a legacy tale with nothing published and an out-of-step tale with only a draft', async () => {
      const f = await fixture();
      // From before the shown-status step, with neither media nor a document: the legacy placeholder.
      const legacy = (await (await post(`/tale-groups/${f.groupId}/tales`, { title: 'Legacy' })).json()).id;
      await asLegacy(legacy);
      // Media out of step with only a studio draft: its media alone is not what its person saw.
      const drafted = (await (await post(`/tale-groups/${f.groupId}/tales`, { title: 'Drafted' })).json()).id;
      await pool.query(
        `UPDATE tales SET media_key = 'tales/x.png', media_content_type = 'image/png', document = NULL,
           document_media_key = NULL, draft_document = '{"version":1}'::jsonb WHERE id = $1`,
        [drafted],
      );
      expect((await taleIn(f, legacy))?.visibility).toEqual(VISIBLE);
      expect((await taleIn(f, drafted))?.visibility).toEqual(notVisible(why('not-updated-yet', 'tale')));
      const site = await delivered(f.key);
      expect(site.tales).toContain(legacy);
      expect(site.tales).not.toContain(drafted);
      await expectAgreement(f);
    });

    // Story 8.4 review: which tales does a first studio save take off the site? A tale from media
    // has its media document published at creation, so saving its draft changes nothing; a tale
    // whose media is out of step with nothing published (composed by the Delivery API) is taken off
    // the site by its first draft, until Update tale.
    it('keeps a tale from media on the site through a first draft, but not an out-of-step one', async () => {
      const f = await fixture();
      const outOfStep = (await (await post(`/tale-groups/${f.groupId}/tales`, { title: 'Out of step' })).json()).id;
      await upload(outOfStep);
      await pool.query(
        `UPDATE tales SET document = NULL, document_revision = 0, document_media_key = NULL,
           draft_document = NULL, draft_revision = 0 WHERE id = $1`,
        [outOfStep],
      );
      expect((await taleIn(f, outOfStep))?.visibility).toEqual(VISIBLE);
      expect((await delivered(f.key)).tales).toContain(outOfStep);
      const saveFirstDraft = async (taleId: string, sawTaleMedia: boolean) => {
        const read = await (await send('GET', `/tales/${taleId}/document`)).json();
        const res = await send('PUT', `/tales/${taleId}/document`, {
          document: read.document,
          revision: read.revision,
          sawTaleMedia,
        });
        expect(res.status).toBe(200);
      };
      await saveFirstDraft(f.taleId, true);
      expect((await taleIn(f, f.taleId))?.visibility).toEqual(VISIBLE);
      await saveFirstDraft(outOfStep, true);
      expect((await taleIn(f, outOfStep))?.visibility).toEqual(notVisible(why('not-updated-yet', 'tale')));
      const site = await delivered(f.key);
      expect(site.tales).toContain(f.taleId);
      expect(site.tales).not.toContain(outOfStep);
      await expectAgreement(f);
      // Tale Studio reads it again with GET /tales/{id}: in any zone.
      const read = async (taleId: string): Promise<ListedTale> => (await send('GET', `/tales/${taleId}`)).json();
      expect((await read(f.taleId)).visibility).toEqual(VISIBLE);
      expect((await read(outOfStep)).visibility).toEqual(notVisible(why('not-updated-yet', 'tale')));
    });

    it('reads one tale with GET, in any zone: in a group in no zone, or Off, it says so', async () => {
      const f = await fixture();
      const read = async (taleId: string): Promise<ListedTale & { taleGroupId: string; title: string }> =>
        (await send('GET', `/tales/${taleId}`)).json();
      expect(await read(f.taleId)).toMatchObject({ id: f.taleId, taleGroupId: f.groupId, title: 'Target' });
      expect((await setStatus('tale-groups', f.groupId, 'paused')).status).toBe(200);
      expect((await read(f.taleId)).visibility).toEqual(notVisible(why('group-off', 'group')));
      expect((await setStatus('tale-groups', f.groupId, 'live')).status).toBe(200);
      expect((await send('DELETE', `/zones/${f.zoneId}/tale-groups/${f.groupId}`)).status).toBe(204);
      expect((await read(f.taleId)).visibility).toEqual(notVisible(why('not-in-any-zone', 'group')));
      expect((await send('GET', '/tales/00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await send('GET', '/tales/not-a-uuid')).status).toBe(404);
    });

    it('serves a cover and tale media publicly only while the group is placed in a set-up zone', async () => {
      const f = await fixture();
      const cover = await fetch(`${base}/tale-groups/${f.groupId}/cover`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(cover.status).toBe(200);
      const keys = async () => {
        const { rows } = await pool.query<{ cover: string; media: string }>(
          `SELECT g.cover_key AS cover, t.media_key AS media FROM tale_groups g JOIN tales t ON t.tale_group_id = g.id
           WHERE t.id = $1`,
          [f.taleId],
        );
        return rows[0];
      };
      const { cover: coverKey, media: mediaKey } = await keys();
      const status = async (key: string) => (await globalThis.fetch(`${origin}/media/${key}`)).status;
      expect([await status(coverKey), await status(mediaKey)]).toEqual([200, 200]);
      // Placed only in a zone without a display (or key): nothing of it is public.
      const bare = await (await post('/zones', { name: 'Bare', projectId: f.projectId })).json();
      expect((await send('PUT', `/zones/${bare.id}/tale-groups/${f.groupId}`)).status).toBe(201);
      expect((await send('DELETE', `/zones/${f.zoneId}/tale-groups/${f.groupId}`)).status).toBe(204);
      expect([await status(coverKey), await status(mediaKey)]).toEqual([404, 404]);
      expect((await projectGroup(f)).visibility).toEqual(
        notVisible(why('zone-no-display', 'zone'), why('zone-not-installed', 'zone')),
      );
      // Its zone gets a display and a key: public again.
      await postKey(bare.id);
      expect([await status(coverKey), await status(mediaKey)]).toEqual([200, 200]);
      expect((await projectGroup(f)).visibility).toEqual(VISIBLE);
    });

    // The Delivery filter before story 8.2, kept as text: the new clause-built predicates must answer
    // exactly as it does (tales), or as it does plus "placed in a zone with a frame and an active key"
    // (groups and placements, R7), row by row over every combination.
    describe('oracle: the clause-built Delivery filter against the rule before story 8.2', () => {
      const oldLiveNow = (t: string, p: string) =>
        `${t}.status = 'live' AND (${t}.starts_at IS NULL OR ${t}.starts_at <= ${p}) ` +
        `AND (${t}.ends_at IS NULL OR ${t}.ends_at > ${p})`;
      const oldHasPublished = (t: string) =>
        `(${t}.document IS NOT NULL ` +
        `OR (${t}.media_key IS NOT NULL AND ${t}.document_media_key IS DISTINCT FROM ${t}.media_key ` +
        `AND (${t}.document IS NOT NULL OR ${t}.draft_document IS NULL)) ` +
        `OR (${t}.created_at < COALESCE((SELECT applied_at FROM tales_migrations WHERE step = 'shown-status'), ` +
        `'infinity'::timestamptz)))`;
      const oldTale = (t: string, p: string) => `${oldLiveNow(t, p)} AND ${oldHasPublished(t)}`;
      const oldGroup = (g: string, p: string) =>
        `${oldLiveNow(g, p)} ` +
        `AND EXISTS (SELECT 1 FROM tales ot WHERE ot.tale_group_id = ${g}.id AND ${oldTale('ot', p)}) ` +
        `AND EXISTS (SELECT 1 FROM zone_tale_groups oz WHERE oz.tale_group_id = ${g}.id)`;
      const setUp = (zone: string) =>
        `EXISTS (SELECT 1 FROM frames of WHERE of.zone_id = ${zone}) ` +
        `AND EXISTS (SELECT 1 FROM zone_keys ok WHERE ok.zone_id = ${zone} AND ok.revoked_at IS NULL)`;
      const setUpPlacement = (g: string) =>
        `EXISTS (SELECT 1 FROM zone_tale_groups sp WHERE sp.tale_group_id = ${g}.id AND ${setUp('sp.zone_id')})`;
      const STATUSES = ['draft', 'live', 'paused', 'archived', 'processing', 'invalid-media', 'quota-reached'];

      async function compare(db: Pool | PoolClient, now: Date): Promise<number> {
        const p = '$1::timestamptz';
        const tales = await db.query<{ rows: number; differ: number; reasonsDiffer: number }>(
          `SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE (${deliveredTale('t', p)}) IS DISTINCT FROM COALESCE(${oldTale('t', p)}, false))::int AS differ,
             count(*) FILTER (WHERE (${deliveredTale('t', p)}) <> (jsonb_array_length(${taleReasonsSql('t', p)}) = 0))::int
               AS "reasonsDiffer"
           FROM tales t`,
          [now],
        );
        const groups = await db.query<{ rows: number; differ: number; reasonsDiffer: number }>(
          `SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE (${deliveredGroup('g', p)})
               IS DISTINCT FROM COALESCE(${oldGroup('g', p)} AND ${setUpPlacement('g')}, false))::int AS differ,
             count(*) FILTER (WHERE (${deliveredGroup('g', p)}) <> (jsonb_array_length(${groupReasonsSql('g', p)}) = 0))::int
               AS "reasonsDiffer"
           FROM tale_groups g`,
          [now],
        );
        const placements = await db.query<{ rows: number; differ: number; reasonsDiffer: number }>(
          `SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE (${deliveredPlacement('g', 'z.zone_id', p)})
               IS DISTINCT FROM COALESCE(${oldGroup('g', p)} AND ${setUp('z.zone_id')}, false))::int AS differ,
             count(*) FILTER (WHERE (${deliveredPlacement('g', 'z.zone_id', p)})
               <> (jsonb_array_length(${groupReasonsSql('g', p, 'z.zone_id')}) = 0))::int AS "reasonsDiffer"
           FROM zone_tale_groups z JOIN tale_groups g ON g.id = z.tale_group_id`,
          [now],
        );
        const zones = await db.query<{ rows: number; differ: number }>(
          `SELECT count(*)::int AS rows,
             count(*) FILTER (WHERE (${zoneDelivers('z.id', p)}) IS DISTINCT FROM (${setUp('z.id')} AND EXISTS (
               SELECT 1 FROM zone_tale_groups zz JOIN tale_groups g ON g.id = zz.tale_group_id
               WHERE zz.zone_id = z.id AND ${oldGroup('g', p)})))::int AS differ,
             count(*) FILTER (WHERE (${zoneDelivers('z.id', p)}) <> (jsonb_array_length(${zoneReasonsSql('z.id', p)}) = 0))::int
               AS "reasonsDiffer"
           FROM zones z`,
          [now],
        );
        for (const result of [tales, groups, placements, zones]) {
          expect(result.rows[0]).toEqual(expect.objectContaining({ differ: 0 }));
          expect(result.rows[0]).toEqual(expect.objectContaining({ reasonsDiffer: 0 }));
        }
        return tales.rows[0].rows + groups.rows[0].rows;
      }

      it('answers as before for every status, window, document and age, with and without the step recorded', async () => {
        const now = new Date('2026-10-22T12:00:00.000Z');
        const hour = 60 * 60 * 1000;
        const bounds = [null, new Date(now.getTime() - hour), new Date(now.getTime() + hour), now];
        const project = await createProject();
        const ready = await (await post('/zones', { name: 'Ready', projectId: project.id })).json();
        await postKey(ready.id);
        const bare = await (await post('/zones', { name: 'Bare', projectId: project.id })).json();
        const keyless = await (await post('/zones', { name: 'Keyless', projectId: project.id })).json();
        expect((await post(`/zones/${keyless.id}/frame`, { type: 'bar', settings: {} })).status).toBe(201);
        const { rows: step } = await pool.query<{ appliedAt: Date }>(
          "SELECT applied_at AS \"appliedAt\" FROM tales_migrations WHERE step = 'shown-status'",
        );
        const applied = step[0].appliedAt;
        const created = [new Date(applied.getTime() - 24 * hour), new Date(applied.getTime() + 24 * hour)];

        // Tales: every stored key x window x document state x age, in one live group of the ready zone.
        const host = await (await post(`/zones/${ready.id}/tale-groups`, { name: 'Host' })).json();
        await pool.query("UPDATE tale_groups SET status = 'live' WHERE id = $1", [host.id]);
        await pool.query(
          `INSERT INTO tales (tale_group_id, project_id, title, position, status, starts_at, ends_at, document,
             draft_document, media_key, media_content_type, document_media_key, created_at)
           SELECT $1, $2, 'm', (row_number() OVER ())::int - 1, s, st, en, doc, draft, mk,
             CASE WHEN mk IS NULL THEN NULL ELSE 'image/png' END, dmk, ca
           FROM unnest($3::text[]) s
           CROSS JOIN unnest($4::timestamptz[]) st
           CROSS JOIN unnest($4::timestamptz[]) en
           CROSS JOIN (VALUES (NULL::jsonb), ('{"version":1}'::jsonb)) d(doc)
           CROSS JOIN (VALUES (NULL::jsonb), ('{"version":1}'::jsonb)) dr(draft)
           CROSS JOIN (VALUES (NULL::text), ('tales/k1.png')) m(mk)
           CROSS JOIN (VALUES (NULL::text), ('tales/k1.png'), ('tales/k2.png')) dm(dmk)
           CROSS JOIN unnest($5::timestamptz[]) ca
           WHERE st IS NULL OR en IS NULL OR en > st`,
          [host.id, project.id, STATUSES, bounds, created],
        );

        // Groups: every stored key x window x (a delivered tale or not) x placement (none, ready, bare,
        // keyless, ready and bare).
        const placements = [[], [ready.id], [bare.id], [keyless.id], [ready.id, bare.id]];
        const { rows: groups } = await pool.query<{ id: string; name: string }>(
          `INSERT INTO tale_groups (project_id, name, status, starts_at, ends_at)
           SELECT $1, shown || ':' || placed, s, st, en
           FROM unnest($2::text[]) s CROSS JOIN unnest($3::timestamptz[]) st CROSS JOIN unnest($3::timestamptz[]) en
           CROSS JOIN generate_series(0, 1) shown CROSS JOIN generate_series(0, 4) placed
           WHERE st IS NULL OR en IS NULL OR en > st
           RETURNING id, name`,
          [project.id, STATUSES, bounds],
        );
        for (const group of groups) {
          const [shownFlag, placed] = group.name.split(':').map(Number);
          const shown = shownFlag === 1;
          await pool.query(
            `INSERT INTO tales (tale_group_id, project_id, title, position, status, document)
             VALUES ($1, $2, 't', 0, $3, '{"version":1}'::jsonb)`,
            [group.id, project.id, shown ? 'live' : 'paused'],
          );
          for (const zoneId of placements[placed]) {
            await pool.query(
              `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
               VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))`,
              [zoneId, group.id, project.id],
            );
          }
        }

        expect(await compare(pool, now)).toBeGreaterThan(3000);
        // Without the step recorded, every tale counts as from before it.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("DELETE FROM tales_migrations WHERE step = 'shown-status'");
          await compare(client, now);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      });

      it('shows content from its start, inclusive, until its end, exclusive', async () => {
        const f = await fixture();
        const at = new Date('2026-10-22T12:00:00.000Z');
        const read = async () =>
          (
            await pool.query<{ reasons: { code: string }[]; delivered: boolean }>(
              `SELECT ${taleReasonsSql('t', '$2::timestamptz')} AS reasons, ${deliveredTale('t', '$2::timestamptz')} AS delivered
               FROM tales t WHERE t.id = $1`,
              [f.taleId, at],
            )
          ).rows[0];
        await pool.query('UPDATE tales SET starts_at = $2, ends_at = NULL WHERE id = $1', [f.taleId, at]);
        expect(await read()).toEqual({ reasons: [], delivered: true });
        await pool.query('UPDATE tales SET starts_at = NULL, ends_at = $2 WHERE id = $1', [f.taleId, at]);
        expect(await read()).toEqual({
          reasons: [{ code: 'ended-at', subject: 'tale', at: expect.any(String) }],
          delivered: false,
        });
      });
    });

    it('returns the visibility on status and schedule answers', async () => {
      const f = await fixture();
      const hidden = await (await setStatus('tales', f.taleId, 'paused')).json();
      expect(hidden.visibility).toEqual(notVisible(why('tale-hidden', 'tale')));
      const off = await (await setStatus('tale-groups', f.groupId, 'paused')).json();
      expect(off.visibility).toEqual(notVisible(why('group-off', 'group')));
      expect(off.tales.map((t: ListedTale) => t.visibility.reasons[0].code)).toEqual(['group-off', 'group-off']);
      const at = future();
      const res = await send('PUT', `/tales/${f.otherId}/schedule`, { startsAt: at, endsAt: null });
      expect((await res.json()).visibility).toEqual(notVisible(why('group-off', 'group'), why('starts-at', 'tale', at)));
    });
  });

  describe('a zone remembers when it was first visible (epic UX rework R9, story 8.9)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    interface ListedZone {
      id: string;
      visibility: { visible: boolean; reasons: { code: string }[] };
      firstVisibleAt: string | null;
    }

    async function listedZone(zoneId: string): Promise<ListedZone> {
      const zones: ListedZone[] = await (await fetch(`${base}/zones`)).json();
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) throw new Error('zone not listed');
      return zone;
    }

    async function stored(zoneId: string): Promise<Date | null> {
      const { rows } = await pool.query<{ at: Date | null }>('SELECT first_visible_at AS at FROM zones WHERE id = $1', [
        zoneId,
      ]);
      return rows[0].at;
    }

    // Installs the zone with the project's site key and a display, and places a group that is Off
    // with one tale from media: everything but the group's switch.
    async function almostVisible(): Promise<{ zoneId: string; groupId: string }> {
      const zone = await createZone();
      await withDisplay(zone.id);
      expect((await post(`/projects/${zone.projectId}/site-key`, {})).status).toBe(201);
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'One' })).json();
      const res = await fetch(`${base}/tales/${tale.id}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(res.status).toBe(200);
      return { zoneId: zone.id, groupId: group.id };
    }

    it('is null for a new zone, in the create answer and the list', async () => {
      const res = await post('/zones', { name: 'Home', projectId: (await createProject()).id });
      expect(res.status).toBe(201);
      const created: ListedZone = await res.json();
      expect(created.firstVisibleAt).toBeNull();
      expect((await listedZone(created.id)).firstVisibleAt).toBeNull();
      expect(await stored(created.id)).toBeNull();
    });

    it('stays null while the zone is not visible', async () => {
      const { zoneId } = await almostVisible();
      const zone = await listedZone(zoneId);
      expect(zone.visibility.visible).toBe(false);
      expect(zone.firstVisibleAt).toBeNull();
      expect(await stored(zoneId)).toBeNull();
    });

    it('is set the first time the zone is read as visible, and kept when it stops being visible', async () => {
      const { zoneId, groupId } = await almostVisible();
      await publish('tale-groups', groupId);

      const first = await listedZone(zoneId);
      expect(first.visibility.visible).toBe(true);
      expect(first.firstVisibleAt).toMatch(ISO);
      expect((await stored(zoneId))?.toISOString()).toBe(first.firstVisibleAt);

      // A later read does not move it.
      expect((await listedZone(zoneId)).firstVisibleAt).toBe(first.firstVisibleAt);

      // Turned Off: not visible any more, but the zone was visible once.
      expect((await setStatus('tale-groups', groupId, 'paused')).status).toBe(200);
      const off = await listedZone(zoneId);
      expect(off.visibility.visible).toBe(false);
      expect(off.firstVisibleAt).toBe(first.firstVisibleAt);

      // On again: still the first time.
      await publish('tale-groups', groupId);
      expect((await listedZone(zoneId)).firstVisibleAt).toBe(first.firstVisibleAt);
    });

    it('answers it on a rename too, and the same value from concurrent first reads', async () => {
      const { zoneId, groupId } = await almostVisible();
      await publish('tale-groups', groupId);
      const reads = await Promise.all([listedZone(zoneId), listedZone(zoneId), listedZone(zoneId)]);
      expect(new Set(reads.map((r) => r.firstVisibleAt)).size).toBe(1);
      expect(reads[0].firstVisibleAt).toMatch(ISO);

      const res = await fetch(`${base}/zones/${zoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).firstVisibleAt).toBe(reads[0].firstVisibleAt);
    });

    it('marks an unmarked visible zone when it is renamed', async () => {
      const { zoneId, groupId } = await almostVisible();
      await publish('tale-groups', groupId);
      expect(await stored(zoneId)).toBeNull();
      const res = await fetch(`${base}/zones/${zoneId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      });
      expect(res.status).toBe(200);
      const renamed: ListedZone = await res.json();
      expect(renamed.visibility.visible).toBe(true);
      expect(renamed.firstVisibleAt).toMatch(ISO);
      expect((await stored(zoneId))?.toISOString()).toBe(renamed.firstVisibleAt);
    });

    it('still lists the zones when marking fails, and marks the zone on a later read', async () => {
      const { zoneId, groupId } = await almostVisible();
      await publish('tale-groups', groupId);
      // Another transaction holds the zone's row past the mark's lock timeout.
      const holder = await pool.connect();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM zones WHERE id = $1 FOR UPDATE', [zoneId]);
        const res = await fetch(`${base}/zones`);
        expect(res.status).toBe(200);
        const zone = ((await res.json()) as ListedZone[]).find((z) => z.id === zoneId);
        expect(zone?.visibility.visible).toBe(true);
        expect(zone?.firstVisibleAt).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not record zones as first visible'));
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        warn.mockRestore();
      }
      expect((await listedZone(zoneId)).firstVisibleAt).toMatch(ISO);
    });

    it('keeps the column when the migrations run again', async () => {
      const { zoneId, groupId } = await almostVisible();
      await publish('tale-groups', groupId);
      const at = (await listedZone(zoneId)).firstVisibleAt;
      await restart();
      expect((await listedZone(zoneId)).firstVisibleAt).toBe(at);
    });
  });

  describe('duplicate a tale with its document (epic Tale Studio R11, story 7.12)', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const gif = Buffer.from('GIF89a-tiny-gif');
    const ID_TEXT = '00000000-0000-4000-8000-0000000000a1';
    const ID_IMAGE = '00000000-0000-4000-8000-0000000000a2';

    // A styled document: the tale's own media element (`base`), a project image and a text over a colour.
    function styled(text: string, mediaKey: string, base: { id: string; type: string; props: object }[] = []) {
      return {
        version: 1,
        canvas: { background: { type: 'color', color: '#112233' } },
        durationMs: 6000,
        elements: [
          ...base,
          {
            id: ID_IMAGE,
            type: 'image',
            box: { x: 0.1, y: 0.1, w: 0.5, h: 0.3, rotation: 0 },
            hidden: false,
            locked: false,
            a11y: { label: 'Sunset' },
            props: { mediaKey, fit: 'cover' },
          },
          {
            id: ID_TEXT,
            type: 'text',
            box: { x: 0.1, y: 0.5, w: 0.8, h: 0.1, rotation: 0 },
            hidden: false,
            locked: false,
            a11y: {},
            props: { text, color: '#ffeeaa', align: 'center' },
          },
        ],
      };
    }

    type Doc = ReturnType<typeof styled>;
    interface DocState {
      document: Doc | null;
      revision: number;
      published: { document: Doc | null; revision: number };
    }

    async function state(taleId: string): Promise<DocState> {
      return (await fetch(`${base}/tales/${taleId}/document`)).json();
    }

    async function save(taleId: string, document: unknown): Promise<void> {
      const { revision } = await state(taleId);
      const res = await fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, revision }),
      });
      expect(res.status).toBe(200);
    }

    async function update(taleId: string): Promise<void> {
      const s = await state(taleId);
      const res = await post(`/tales/${taleId}/document/publish`, {
        revision: s.revision,
        publishedRevision: s.published.revision,
      });
      expect(res.status).toBe(200);
    }

    function duplicate(taleId: string, body: unknown = {}): Promise<Response> {
      return post(`/tales/${taleId}/duplicate`, body);
    }

    async function titles(groupId: string): Promise<string[]> {
      const { rows } = await pool.query<{ title: string; position: number }>(
        'SELECT title, position FROM tales WHERE tale_group_id = $1 ORDER BY position, id',
        [groupId],
      );
      expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
      return rows.map((r) => r.title);
    }

    async function uploadMedia(projectId: string): Promise<string> {
      const res = await fetch(`${base}/projects/${projectId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      });
      expect(res.status).toBe(201);
      return (await res.json()).key;
    }

    async function putTaleMedia(taleId: string, contentType: string, body: Uint8Array): Promise<void> {
      const res = await fetch(`${base}/tales/${taleId}/media`, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      });
      expect(res.status).toBe(200);
    }

    // A zone with two groups (On) and a Shown tale "Beach" in the first, with media, a published
    // styled document and a pending draft change.
    async function setup() {
      const zone = await createZone();
      const first = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const second = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Winter' })).json();
      await publish('tale-groups', first.id, second.id);
      const make = async (groupId: string, title: string) =>
        (await (await post(`/tale-groups/${groupId}/tales`, { title })).json()) as { id: string };
      const a = await make(first.id, 'Arrival');
      const beach = await make(first.id, 'Beach');
      const c = await make(first.id, 'Cliffs');
      await putTaleMedia(beach.id, 'image/png', png);
      const mediaKey = await uploadMedia(zone.projectId);
      const own = (await state(beach.id)).document?.elements ?? [];
      expect(own).toHaveLength(1);
      await save(beach.id, styled('Hello', mediaKey, own));
      await update(beach.id);
      await save(beach.id, styled('Hello again', mediaKey, own));
      const { rows } = await pool.query<{ key: string }>('SELECT media_key AS key FROM tales WHERE id = $1', [beach.id]);
      return { zone, first, second, a, beach, c, mediaKey, taleMediaKey: rows[0].key };
    }

    beforeEach(() => rmSync(join(mediaDir, 'media'), { recursive: true, force: true }));

    it('places a Hidden copy right after the original, with both documents under new element ids', async () => {
      const { first, beach, mediaKey, taleMediaKey } = await setup();
      const before = await state(beach.id);
      const res = await duplicate(beach.id);
      expect(res.status).toBe(201);
      const copy = await res.json();
      expect(copy).toMatchObject({
        taleGroupId: first.id,
        title: 'Beach (copy)',
        position: 2,
        storedStatus: 'paused',
        media: { kind: 'image' },
      });
      expect(copy.visibility.visible).toBe(false);
      expect(await titles(first.id)).toEqual(['Arrival', 'Beach', 'Beach (copy)', 'Cliffs']);

      const copied = await state(copy.id);
      expect([copied.revision, copied.published.revision]).toEqual([1, 1]);
      const ids = (d: Doc | null) => d?.elements.map((e) => e.id) ?? [];
      const strip = (d: Doc | null) => d && { ...d, elements: d.elements.map((e) => ({ ...e, id: 'x' })) };
      // Published stays published and the pending change stays pending ("Update tale" carries over).
      expect(strip(copied.published.document)).toEqual(strip(before.published.document));
      expect(strip(copied.document)).toEqual(strip(before.document));
      expect(copied.published.document?.elements.find((e) => e.type === 'text')?.props).toMatchObject({ text: 'Hello' });
      expect(copied.document?.elements.find((e) => e.type === 'text')?.props).toMatchObject({ text: 'Hello again' });
      // New ids, the same new id for an element in both documents.
      const newIds = ids(copied.document);
      expect(new Set(newIds).size).toBe(newIds.length);
      for (const id of newIds) expect(ids(before.document)).not.toContain(id);
      expect(ids(copied.published.document)).toEqual(newIds);
      // The same storage keys, not copies of the files.
      const keys = await pool.query<{ key: string; document: string }>(
        'SELECT storage_key AS key, document FROM tale_media WHERE tale_id = $1 ORDER BY document, storage_key',
        [copy.id],
      );
      expect(keys.rows.map((r) => r.key)).toContain(mediaKey);
      expect(new Set(keys.rows.map((r) => r.document))).toEqual(new Set(['draft', 'published']));
      const row = await pool.query('SELECT media_key FROM tales WHERE id = $1', [copy.id]);
      expect(row.rows[0].media_key).toBe(taleMediaKey);
      expect(readdirSync(join(mediaDir, 'media'))).toHaveLength(1);

      // The copy is its own tale: editing it leaves the original as it was.
      await save(copy.id, styled('Only the copy', mediaKey));
      const original = await state(beach.id);
      expect(original).toEqual(before);
    });

    it('puts the copy last in another group of the project, and leaves the source group alone', async () => {
      const { first, second, beach } = await setup();
      await post(`/tale-groups/${second.id}/tales`, { title: 'Snow' });
      const res = await duplicate(beach.id, { taleGroupId: second.id.toUpperCase() });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ taleGroupId: second.id, position: 1, storedStatus: 'paused' });
      expect(await titles(second.id)).toEqual(['Snow', 'Beach (copy)']);
      expect(await titles(first.id)).toEqual(['Arrival', 'Beach', 'Cliffs']);
    });

    it('refuses a group of another project, an unknown group or tale, a bad body and a caller without access', async () => {
      const { zone, beach } = await setup();
      const refuse = async (res: Response, status: number, code: string) => {
        expect([res.status, (await res.json()).error.code]).toEqual([status, code]);
      };
      const other = await createZone();
      const foreign = await (await post(`/zones/${other.id}/tale-groups`, { name: 'Elsewhere' })).json();
      await refuse(await duplicate(beach.id, { taleGroupId: foreign.id }), 400, 'tale_group_not_found');
      await refuse(await duplicate(beach.id, { taleGroupId: randomUUID() }), 400, 'tale_group_not_found');
      await refuse(await duplicate(beach.id, { taleGroupId: 'nope' }), 400, 'tale_group_not_found');
      await refuse(await duplicate(beach.id, { taleGroupId: 7 }), 400, 'validation_failed');
      await refuse(await duplicate(randomUUID()), 404, 'tale_not_found');
      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, other.projectId, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      await refuse(await duplicate(beach.id), 403, 'forbidden');
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM tales WHERE project_id = $1', [zone.projectId]);
      expect(rows[0].n).toBe(3);
      expect((await pool.query('SELECT 1 FROM tales WHERE tale_group_id = $1', [foreign.id])).rows).toHaveLength(0);
    });

    it('refuses a full target group with 409 tale_group_full, creating nothing', async () => {
      const { zone, first, second, beach } = await setup();
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position)
         SELECT $1, $2, 'Filler ' || n, n FROM generate_series(0, 99) AS n`,
        [second.id, zone.projectId],
      );
      const res = await duplicate(beach.id, { taleGroupId: second.id });
      expect([res.status, (await res.json()).error.code]).toEqual([409, 'tale_group_full']);
      expect((await titles(second.id)).length).toBe(100);
      // Its own group has room: 3 / 100.
      expect((await duplicate(beach.id)).status).toBe(201);
      expect((await titles(first.id)).length).toBe(4);
    });

    it("keeps the copy's media when the original's media is replaced or the original archived", async () => {
      const { zone, first, beach, mediaKey, taleMediaKey } = await setup();
      const copy = await (await duplicate(beach.id)).json();
      // Shown and updated, both are delivered with their media.
      await publish('tales', beach.id, copy.id);
      await update(beach.id);
      await update(copy.id);
      const { key } = await (await postKey(zone.id)).json();
      const deliver = async () => {
        clearDeliveryCache();
        const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
        expect(res.status).toBe(200);
        const body = await res.json();
        return body.taleGroups.find((g: { id: string }) => g.id === first.id).tales as {
          id: string;
          document: { elements: { type: string; props: { url?: string } }[] };
        }[];
      };
      const urlsOf = (tale: { document: { elements: { props: { url?: string } }[] } }) =>
        tale.document.elements.map((e) => e.props.url).filter((u): u is string => typeof u === 'string');
      const served = async (url: string) => (await globalThis.fetch(`${origin}${new URL(url).pathname}`)).status;
      let tales = await deliver();
      expect(tales.map((t) => t.id)).toEqual(expect.arrayContaining([beach.id, copy.id]));
      const copyUrls = urlsOf(tales.find((t) => t.id === copy.id) as (typeof tales)[number]);
      expect(copyUrls.some((u) => u.includes(mediaKey))).toBe(true);
      expect(copyUrls.some((u) => u.includes(taleMediaKey))).toBe(true);
      for (const url of copyUrls) expect(await served(url)).toBe(200);

      // Replacing the original's media keeps the file the copy still uses.
      await putTaleMedia(beach.id, 'image/gif', gif);
      expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);
      // Archiving the original: the copy's media is still served.
      expect((await setStatus('tales', beach.id, 'archived')).status).toBe(200);
      tales = await deliver();
      expect(tales.map((t) => t.id)).not.toContain(beach.id);
      for (const url of urlsOf(tales.find((t) => t.id === copy.id) as (typeof tales)[number])) {
        expect(await served(url)).toBe(200);
      }
      expect(existsSync(join(mediaDir, mediaKey))).toBe(true);
      // There is no route that deletes a tale; were the row gone, the copy's references still hold
      // the files (the deletion guard's check), and its media is still served.
      await pool.query('DELETE FROM tales WHERE id = $1', [beach.id]);
      expect(await isMediaKeyInUse(pool, taleMediaKey)).toBe(true);
      expect(await isMediaKeyInUse(pool, mediaKey)).toBe(true);
      for (const url of urlsOf((await deliver()).find((t) => t.id === copy.id) as (typeof tales)[number])) {
        expect(await served(url)).toBe(200);
      }
    });

    it('keeps one consistent order under concurrent duplicates', async () => {
      const { first, a, beach } = await setup();
      const results = await Promise.all([
        duplicate(beach.id),
        duplicate(a.id),
        duplicate(beach.id),
        duplicate(beach.id),
        duplicate(a.id),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      const order = await titles(first.id);
      expect(order).toHaveLength(8);
      expect(order[0]).toBe('Arrival');
      expect(order.slice(1, 3)).toEqual(['Arrival (copy)', 'Arrival (copy)']);
      expect(order.slice(3)).toEqual(['Beach', 'Beach (copy)', 'Beach (copy)', 'Beach (copy)', 'Cliffs']);
    });

    it('keeps positions and the cap under duplicates racing reorders, adds, status changes and saves', async () => {
      const { zone, first, second, a, beach, c, mediaKey } = await setup();
      // The target group has room for two more.
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position)
         SELECT $1, $2, 'Filler ' || n, n FROM generate_series(0, 97) AS n`,
        [second.id, zone.projectId],
      );
      const { revision } = await state(beach.id);
      const results = await Promise.all([
        duplicate(beach.id),
        duplicate(beach.id, { taleGroupId: second.id }),
        fetch(`${base}/tale-groups/${first.id}/tales/order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taleIds: [c.id, beach.id, a.id] }),
        }),
        duplicate(a.id, { taleGroupId: second.id }),
        post(`/tale-groups/${second.id}/tales`, { title: 'Added' }),
        setStatus('tales', beach.id, 'paused'),
        fetch(`${base}/tales/${beach.id}/document`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: styled('Racing', mediaKey), revision }),
        }),
        duplicate(beach.id),
      ]);
      const statuses = results.map((r) => r.status);
      // Nothing fails for another reason: an order that lost the race to an add is refused (409),
      // and the target group's two places go to two of the three adds.
      expect(statuses.filter((s) => s >= 500)).toEqual([]);
      expect([200, 409]).toContain(statuses[2]);
      const intoSecond = [statuses[1], statuses[3], statuses[4]];
      expect(intoSecond.filter((s) => s === 201)).toHaveLength(2);
      expect(intoSecond.filter((s) => s === 409)).toHaveLength(1);
      expect([statuses[0], statuses[5], statuses[6], statuses[7]]).toEqual([201, 200, 200, 201]);
      expect(await titles(second.id)).toHaveLength(100);
      const order = await titles(first.id);
      expect(order).toHaveLength(5);
      expect(order.filter((t) => t === 'Beach (copy)')).toHaveLength(2);
      // Each copy sits right after its original whatever order the requests took.
      expect(order[order.indexOf('Beach') + 1]).toBe('Beach (copy)');
    });

    it('carries the media state over: an out-of-step original gives a copy composed on delivery and merged later', async () => {
      const { zone, first, beach, c, mediaKey } = await setup();
      const { rows: before } = await pool.query(
        'SELECT document_media_key, document_created_by_migration FROM tales WHERE id = $1',
        [beach.id],
      );
      await pool.query('UPDATE tales SET document_created_by_migration = true WHERE id = $1', [beach.id]);
      const kept = await (await duplicate(beach.id)).json();
      const { rows: copied } = await pool.query(
        'SELECT document_media_key, document_created_by_migration FROM tales WHERE id = $1',
        [kept.id],
      );
      expect(copied[0]).toEqual({ ...before[0], document_created_by_migration: true });

      // "Cliffs": a published text document, and media its documents are not in step with (R16).
      await save(c.id, styled('Cliffs', mediaKey));
      await update(c.id);
      const { rows: media } = await pool.query<{ key: string }>('SELECT media_key AS key FROM tales WHERE id = $1', [beach.id]);
      await pool.query(
        "UPDATE tales SET media_key = $2, media_content_type = 'image/png', document_media_key = NULL WHERE id = $1",
        [c.id, media[0].key],
      );
      const copy = await (await duplicate(c.id)).json();
      const row = async (id: string) =>
        (
          await pool.query<{ key: string | null; inStep: string | null; document: Doc; draft: Doc }>(
            'SELECT media_key AS key, document_media_key AS "inStep", document, draft_document AS draft FROM tales WHERE id = $1',
            [id],
          )
        ).rows[0];
      expect(await row(copy.id)).toMatchObject({ key: media[0].key, inStep: null });
      await publish('tales', copy.id);
      const { key } = await (await postKey(zone.id)).json();
      clearDeliveryCache();
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      const tales = (await res.json()).taleGroups.find((g: { id: string }) => g.id === first.id).tales as {
        id: string;
        document: { elements: { id: string; props: { taleMedia?: boolean; url?: string } }[] };
      }[];
      const delivered = tales.find((t) => t.id === copy.id);
      // Composed under the copy's own id, with the shared file.
      expect(delivered?.document.elements[0]).toMatchObject({ id: copy.id, props: { taleMedia: true } });
      expect(delivered?.document.elements[0].props.url).toContain(media[0].key);

      const client = await pool.connect();
      try {
        await migrateTaleMediaDocuments(client, { batchSize: 500, budgetMs: 0 });
      } finally {
        client.release();
      }
      const merged = await row(copy.id);
      expect(merged.inStep).toBe(media[0].key);
      expect(merged.document.elements[0].props).toMatchObject({ mediaKey: media[0].key, taleMedia: true });
      expect(merged.draft.elements[0].props).toMatchObject({ mediaKey: media[0].key, taleMedia: true });
    });

    it('makes the copy a new tale: a pre-step original without a published document gives a copy "not updated yet"', async () => {
      const { zone, first } = await setup();
      await postKey(zone.id);
      const make = async (title: string) =>
        (await (await post(`/tale-groups/${first.id}/tales`, { title })).json()) as { id: string };
      // From before the shown-status step: one with nothing published (shown as a placeholder), one
      // with a published document.
      const bare = await make('Bare');
      const studio = await make('Studio');
      await save(studio.id, styled('Old', await uploadMedia(zone.projectId)));
      await update(studio.id);
      await asLegacy(bare.id, studio.id);
      const visibility = async (id: string) => (await (await fetch(`${base}/tales/${id}`)).json()).visibility;
      expect((await visibility(bare.id)).visible).toBe(true);

      const bareCopy = await (await duplicate(bare.id)).json();
      const studioCopy = await (await duplicate(studio.id)).json();
      const { rows } = await pool.query<{ fresh: boolean }>(
        "SELECT created_at > now() - interval '1 minute' AS fresh FROM tales WHERE id = ANY($1::uuid[])",
        [[bareCopy.id, studioCopy.id]],
      );
      expect(rows.map((r) => r.fresh)).toEqual([true, true]);
      await publish('tales', bareCopy.id, studioCopy.id);
      const bareSeen = await visibility(bareCopy.id);
      expect(bareSeen.visible).toBe(false);
      expect(bareSeen.reasons.map((r: { code: string }) => r.code)).toContain('not-updated-yet');
      expect((await visibility(studioCopy.id)).visible).toBe(true);
    });

    it('gives a Hidden copy of an archived tale', async () => {
      const { beach } = await setup();
      expect((await setStatus('tales', beach.id, 'archived')).status).toBe(200);
      const res = await duplicate(beach.id);
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ storedStatus: 'paused', status: 'paused' });
    });

    it("records the copy's project fonts, so a font only the copy still uses cannot be deleted", async () => {
      const { zone, beach, mediaKey } = await setup();
      const data = Buffer.alloc(2048, 7);
      data.fill(0, 0, 50);
      data.write('wOF2', 0, 'latin1');
      data.writeUInt32BE(0x00010000, 4);
      data.writeUInt32BE(2048, 8);
      data.writeUInt16BE(1, 12);
      data.writeUInt32BE(1024, 16);
      data.writeUInt32BE(2048 - 50, 20);
      data[49] = 0x10;
      const query = new URLSearchParams({ family: 'Brand Sans', weight: '700', style: 'normal', fallback: 'serif', licence: 'confirmed' });
      const uploadRes = await fetch(`${base}/projects/${zone.projectId}/fonts?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'font/woff2' },
        body: data,
      });
      expect(uploadRes.status).toBe(201);
      const font = await uploadRes.json();
      const withFont = (text: string) => {
        const d = styled(text, mediaKey);
        const t = d.elements.find((e) => e.type === 'text') as { props: Record<string, unknown> };
        t.props = { ...t.props, font: { source: 'project', fontId: font.id }, fallback: 'serif' };
        return d;
      };
      await save(beach.id, withFont('Brand'));
      await update(beach.id);
      const copy = await (await duplicate(beach.id)).json();
      const { rows } = await pool.query<{ document: string }>(
        'SELECT document FROM tale_fonts WHERE tale_id = $1 AND font_id = $2 ORDER BY document',
        [copy.id, font.id],
      );
      expect(rows.map((r) => r.document)).toEqual(['draft', 'published']);
      // The original stops using it; the copy still does.
      await save(beach.id, styled('Plain', mediaKey));
      await update(beach.id);
      const removed = await fetch(`${base}/projects/${zone.projectId}/fonts/${font.id}`, { method: 'DELETE' });
      expect(removed.status).toBe(409);
      expect((await removed.json()).error.code).toBe('font_in_use');
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

    // Media goes to the test MEDIA_DIR. The fake serves media on 127.0.0.1, so
    // exactly its endpoint is exempted, as IMPORT_MEDIA_ALLOWED_ADDRESSES would.
    function workerMedia() {
      return {
        storage: new LocalDiskStorage(mediaDir),
        mediaPolicy: { allowedAddresses: [`127.0.0.1:${fake.port}`], retry: { baseDelayMs: 1 } },
        // Replies 429 and 5xx are tried again quickly in these tests.
        retry: { baseDelayMs: 1 },
      };
    }

    // Runs the worker as main.ts does, polling fast.
    function startWorker(workerId?: string): void {
      workers.push(
        startImportWorker(pool, {
          ...workerMedia(),
          tokenKey,
          storylyApiUrl: fake.url,
          pollIntervalMs: 50,
          workerId,
        }),
      );
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

    // A field TaleArt does not hold, as a report difference.
    function notHeld(
      entity: string,
      sourceId: string,
      name: string,
      parent: [string, string] | null,
      position: number,
      field: string,
    ) {
      const [within, withinSourceId] = parent ?? [null, null];
      return { entity, record: { sourceId, name, within, withinSourceId, position }, kind: 'notHeld', field, sourceField: null };
    }

    // A report's change counts for one entity type: what a first import does, `n` records created.
    const created = (n: number) => ({ created: n, updated: 0, unchanged: 0, keptLocalEdit: 0, removedAtSource: 0 });

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
      expect(await res.json()).toEqual([
        { id: '1001', name: 'Demo shop' },
        { id: '1002', name: 'Odd shop' },
        { id: '1003', name: 'Clean shop' },
        { id: '1004', name: 'Media shop' },
        { id: '1005', name: 'Label shop' },
      ]);
      expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(0);
    });

    it('refuses a token Storyly refuses with storyly_token_invalid and creates no job', async () => {
      const project = await createProject();
      const res = await send('POST', `/projects/${project.id}/imports/storyly/apps`, { token: 'wrong-token' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'storyly_token_invalid', message: expect.any(String) } });
      expect((await pool.query('SELECT 1 FROM import_jobs')).rowCount).toBe(0);
    });

    describe('picking what to import', () => {
      function preview(
        projectId: string,
        body: unknown = { token: FAKE_STORYLY_TOKEN, appId: '1001' },
        at = importBase,
      ): Promise<Response> {
        return send('POST', `/projects/${projectId}/imports/storyly/preview`, body, at);
      }

      // Starts an import of Demo shop with a selection; all zones and types unless told otherwise.
      async function pick(
        projectId: string,
        choice: { zones?: string[]; taleGroups?: boolean; media?: boolean; tags?: boolean; selectionKey?: string },
      ): Promise<Response> {
        const key = choice.selectionKey ?? (await (await preview(projectId)).json()).selectionKey;
        return send('POST', `/projects/${projectId}/imports`, {
          token: FAKE_STORYLY_TOKEN,
          appId: '1001',
          selection: {
            selectionKey: key,
            zones: choice.zones ?? ['2001', '2002', '2003'],
            taleGroups: choice.taleGroups ?? true,
            media: choice.media ?? true,
            tags: choice.tags ?? true,
          },
        });
      }

      const adminId = async (): Promise<string> =>
        (await pool.query("SELECT id FROM users WHERE email = 'admin@example.com'")).rows[0].id;
      const requestsTo = (path: string) => fake.control.requests.filter((r) => r.path === `/external${path}`).length;
      const jobCount = async () => (await pool.query('SELECT 1 FROM import_jobs')).rowCount;
      const expectInvalid = async (res: Response) => {
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('import_selection_invalid');
      };

      it('re-imports only what is picked: a zone not picked is neither updated nor taken for removed', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // The source renames the Home page (2001) and a story of the Product page (2002).
        fixture(fake.control.data.instances['1001'], 2001)['title'] = 'Start page';
        fixture(fake.control.data.stories['3005'], 4012)['title'] = 'Customer videos';
        const res = await pick(project.id, { zones: ['2002'] });
        expect(res.status).toBe(202);
        const job = await waitForEnd(project.id, ((await res.json()) as { id: string }).id);
        expect(job['status']).toBe('done');
        const report = job['report'] as ImportReport;
        const pages = await zonePages(project.id);
        expect(Object.keys(pages)).toEqual(['Home page', 'Product page', 'Checkout']);
        expect(pages['Product page'][0].tales).toContain('Customer videos');
        expect(report.changes?.zones).toEqual({
          created: 0,
          updated: 0,
          unchanged: 1,
          keptLocalEdit: 0,
          removedAtSource: 0,
        });
        expect(report.changes?.tales).toMatchObject({ updated: 1, removedAtSource: 0 });
        expect((report.differences ?? []).filter((d) => d.kind === 'removedAtSource')).toEqual([]);

        // Zones only: names follow the source; tale groups and tales are neither read nor taken for removed.
        const zonesOnly = await pick(project.id, { taleGroups: false, media: false, tags: false });
        const second = await waitForEnd(project.id, ((await zonesOnly.json()) as { id: string }).id);
        const secondReport = second['report'] as ImportReport;
        expect(Object.keys(await zonePages(project.id))).toEqual(['Start page', 'Product page', 'Checkout']);
        expect(secondReport.changes?.zones).toMatchObject({ updated: 1, unchanged: 2, removedAtSource: 0 });
        expect((secondReport.differences ?? []).filter((d) => d.kind === 'removedAtSource')).toEqual([]);
        expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
      });

      it("previews the app's zones with their counts, storing neither the token nor a job", async () => {
        const project = await createProject();
        fake.control.requests.length = 0;
        const res = await preview(project.id);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
          appId: '1001',
          appName: 'Demo shop',
          zones: [
            { id: '2001', name: 'Home page', taleGroups: 3, tales: 8 },
            { id: '2002', name: 'Product page', taleGroups: 2, tales: 5 },
            { id: '2003', name: 'Checkout', taleGroups: 1, tales: 2 },
          ],
          zonesBeyond: 0,
          countsComplete: true,
          selectionKey: expect.stringMatching(/^v1\./),
          expiresAt: expect.any(String),
        });
        expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(25 * 60_000);
        expect(JSON.stringify(body)).not.toContain(FAKE_STORYLY_TOKEN);
        expect(Buffer.from(body.selectionKey.split('.')[1], 'base64url').toString()).not.toContain(FAKE_STORYLY_TOKEN);
        expect(await jobCount()).toBe(0);
        // Counting reads no media and no labels.
        expect(requestsTo('/segment')).toBe(0);
        expect(fake.control.requests.some((r) => r.path.startsWith('/media/'))).toBe(false);
      });

      it('refuses a refused token, an app the token cannot read, and a failing instance list', async () => {
        const project = await createProject();
        const badToken = await preview(project.id, { token: 'wrong-token', appId: '1001' });
        expect(badToken.status).toBe(400);
        expect((await badToken.json()).error.code).toBe('storyly_token_invalid');
        await expectInvalid(await preview(project.id, { token: FAKE_STORYLY_TOKEN, appId: '9999' }));
        const missing = await preview(project.id, { token: FAKE_STORYLY_TOKEN });
        expect((await missing.json()).error.code).toBe('validation_failed');
        fake.control.failInstances = 'status';
        const failing = await preview(project.id);
        expect(failing.status).toBe(502);
        expect((await failing.json()).error.code).toBe('storyly_unavailable');
        expect(await jobCount()).toBe(0);
      });

      it('leaves counts unknown when a story list fails, and bounds what it lists and reads', async () => {
        const project = await createProject();
        fake.control.failStories = 'status';
        const body = await (await preview(project.id)).json();
        type Counted = { taleGroups: number | null; tales: number | null };
        const counts = body.zones.map((z: Counted) => [z.taleGroups, z.tales]);
        expect(counts).toEqual([
          [3, null],
          [2, null],
          [1, null],
        ]);
        expect(body.countsComplete).toBe(false);

        fake.control.reset();
        const bounded = await listenImporter({
          tokenKey,
          storylyApiUrl: fake.url,
          previewLimits: { maxZones: 2, maxCountRequests: 3 },
        });
        try {
          fake.control.requests.length = 0;
          const small = await (await preview(project.id, undefined, bounded.base)).json();
          expect(small.zones).toEqual([
            { id: '2001', name: 'Home page', taleGroups: 3, tales: null },
            { id: '2002', name: 'Product page', taleGroups: null, tales: null },
          ]);
          expect(small.zonesBeyond).toBe(1);
          expect(small.countsComplete).toBe(false);
          expect(requestsTo('/story-group') + requestsTo('/story')).toBe(3);
        } finally {
          await new Promise<void>((resolve) => bounded.server.close(() => resolve()));
        }
      });

      it('imports only the ticked zones without tags, and reports the rest as not selected', async () => {
        const project = await createProject();
        const res = await pick(project.id, { zones: ['2001', '2002'], tags: false });
        expect(res.status).toBe(202);
        const started = await res.json();
        fake.control.requests.length = 0;
        startWorker();
        const job = await waitForEnd(project.id, started.id);
        expect(job['status']).toBe('done');
        const report = job['report'] as Record<string, unknown>;
        expect(report['zones']).toEqual({ source: 3, imported: 2, skipped: 1, notSelected: 1 });
        expect(report['taleGroups']).toEqual({ source: 5, imported: 5, skipped: 0 });
        expect(report['tales']).toEqual({ source: 13, imported: 13, skipped: 0 });
        expect(report['media']).toEqual({ source: 13, imported: 13, skipped: 0 });
        expect(report['tags']).toBeUndefined();
        expect(report['notSelected']).toEqual({ zones: [{ sourceId: '2003', name: 'Checkout' }], entities: ['tags'] });
        // Not selected is not missing: no difference names the zone left out.
        expect(JSON.stringify(report['differences'])).not.toContain('"2003"');
        expect((await projectZones(project.id)).map((z) => z.name).sort()).toEqual(['Home page', 'Product page']);
        expect(await contentCounts(project.id)).toEqual({ groups: 5, placements: 5, tales: 13, links: 20 });
        const tags = await pool.query('SELECT count(*) FROM tags WHERE project_id = $1', [project.id]);
        expect(Number(tags.rows[0].count)).toBe(0);
        // Nothing of the zone left out, and no labels, were read.
        expect(requestsTo('/story-group')).toBe(2);
        expect(requestsTo('/story')).toBe(5);
        expect(requestsTo('/segment')).toBe(0);
        expect((await storedJob(started.id)).token_ciphertext).toBeNull();
      });

      it('imports zones only when tale groups are not picked, and tales without media when media is not', async () => {
        const project = await createProject();
        const zonesOnly = await (await pick(project.id, { taleGroups: false, media: false, tags: false })).json();
        fake.control.requests.length = 0;
        startWorker();
        const zonesOnlyJob = await waitForEnd(project.id, zonesOnly.id);
        // Progress names what was left out, so the job page shows it as not selected.
        expect((zonesOnlyJob['progress'] as Record<string, unknown>)['notSelected']).toEqual([
          'taleGroups',
          'media',
          'tags',
        ]);
        const report = zonesOnlyJob['report'] as Record<string, unknown>;
        expect(report['zones']).toEqual({ source: 3, imported: 3, skipped: 0 });
        expect(report['taleGroups']).toBeUndefined();
        expect(report['tales']).toBeUndefined();
        expect(report['notSelected']).toEqual({ zones: [], entities: ['taleGroups', 'media', 'tags'] });
        expect(requestsTo('/story-group')).toBe(0);
        expect(await contentCounts(project.id)).toEqual({ groups: 0, placements: 0, tales: 0, links: 3 });

        const other = await createProject('Beta');
        const noMedia = await (await pick(other.id, { media: false })).json();
        fake.control.requests.length = 0;
        const done = (await waitForEnd(other.id, noMedia.id))['report'] as Record<string, unknown>;
        expect(done['tales']).toEqual({ source: 15, imported: 15, skipped: 0 });
        expect(done['media']).toBeUndefined();
        expect(done['notSelected']).toEqual({ zones: [], entities: ['media'] });
        expect(fake.control.requests.some((r) => r.path.startsWith('/media/'))).toBe(false);
        const withMedia = await pool.query(
          'SELECT count(*) FROM tales WHERE project_id = $1 AND media_key IS NOT NULL',
          [other.id],
        );
        expect(Number(withMedia.rows[0].count)).toBe(0);
      });

      it('refuses a zone the preview did not list, and a key that is changed, expired or for someone else', async () => {
        const project = await createProject();
        const other = await createProject('Beta');
        const { selectionKey } = await (await preview(project.id)).json();
        await expectInvalid(await pick(project.id, { selectionKey, zones: ['2001', '9999'] }));
        await expectInvalid(await pick(other.id, { selectionKey }));
        const [version, payload, mac] = selectionKey.split('.');
        const changed = JSON.parse(Buffer.from(payload, 'base64url').toString());
        changed.z.push('9999');
        const forged = `${version}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${mac}`;
        await expectInvalid(await pick(project.id, { selectionKey: forged, zones: ['9999'] }));
        const scope = { projectId: project.id, appId: '1001', userId: await adminId() };
        const soon = Date.now() + 60_000;
        for (const key of [
          signSelectionKey(tokenKey, scope, ['2001'], Date.now() - 1),
          signSelectionKey(tokenKey, { ...scope, userId: randomUUID() }, ['2001'], soon),
          signSelectionKey(tokenKey, { ...scope, appId: '1002' }, ['2001'], soon),
          signSelectionKey(randomBytes(32), scope, ['2001'], soon),
        ]) {
          await expectInvalid(await pick(project.id, { selectionKey: key, zones: ['2001'] }));
        }
        // A genuine key for this scope is accepted.
        const genuine = signSelectionKey(tokenKey, scope, ['2001'], soon);
        expect((await pick(project.id, { selectionKey: genuine, zones: ['2001'] })).status).toBe(202);
        await pool.query('DELETE FROM import_jobs');
        // Media and tags need tale groups.
        await expectInvalid(await pick(project.id, { selectionKey, taleGroups: false, media: true, tags: false }));
        await expectInvalid(await pick(project.id, { selectionKey, taleGroups: false, media: false, tags: true }));
        expect(await jobCount()).toBe(0);
      });

      it('refuses a malformed selection with validation_failed', async () => {
        const project = await createProject();
        const { selectionKey } = await (await preview(project.id)).json();
        const all = { taleGroups: true, media: true, tags: true };
        const tooMany = Array.from({ length: 501 }, (_, i) => `z${i}`);
        for (const selection of [
          'all',
          null,
          [],
          { zones: ['2001'], ...all },
          { selectionKey, zones: [], ...all },
          { selectionKey, zones: ['2001', '2001'], ...all },
          { selectionKey, zones: tooMany, ...all },
          { selectionKey, zones: [2001], ...all },
          { selectionKey, zones: ['2001'], ...all, taleGroups: 'yes' },
          { selectionKey, zones: ['2001'], taleGroups: true, media: true },
        ]) {
          const res = await send('POST', `/projects/${project.id}/imports`, {
            token: FAKE_STORYLY_TOKEN,
            appId: '1001',
            selection,
          });
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
        expect(await jobCount()).toBe(0);
      });

      it('notes a picked zone that left the app before the import ran', async () => {
        const project = await createProject();
        const started = await (await pick(project.id, { zones: ['2001', '2003'] })).json();
        const demo = fake.control.data.instances['1001'];
        demo.data = demo.data.filter((instance) => instance['id'] !== 2003);
        startWorker();
        const job = await waitForEnd(project.id, started.id);
        expect(job['status']).toBe('done');
        const report = job['report'] as { notes: string[]; zones: unknown; notSelected: unknown };
        expect(report.notes).toContain('Zones: 1 picked zone(s) are no longer in the app, so they were not imported');
        expect(report.zones).toEqual({ source: 2, imported: 1, skipped: 1, notSelected: 1 });
        expect(report.notSelected).toEqual({ zones: [{ sourceId: '2002', name: 'Product page' }], entities: [] });
      });

      it('runs one preview per person and a few per server at a time, answering preview_busy', async () => {
        const project = await createProject();
        // Each of the preview's eleven reads waits a little, so two previews overlap.
        fake.control.delayMs = 60;
        const [first, second] = await Promise.all([preview(project.id), preview(project.id)]);
        expect([first.status, second.status].sort()).toEqual([200, 429]);
        const busy = first.status === 429 ? first : second;
        expect((await busy.json()).error.code).toBe('preview_busy');
        // The slot is free again once the preview ends.
        expect((await preview(project.id)).status).toBe(200);

        // Process-wide: another person is refused while the server is at its limit.
        const bounded = await listenImporter({
          tokenKey,
          storylyApiUrl: fake.url,
          previewConcurrency: { perUser: 1, total: 1 },
        });
        try {
          const admin = sessionCookie;
          const other = await createUser(pool, { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' });
          const otherCookie = `taleart_session=${(await createSession(pool, other.id)).token}`;
          const running = preview(project.id, undefined, bounded.base);
          await new Promise((resolve) => setTimeout(resolve, 100));
          sessionCookie = otherCookie;
          const refused = await preview(project.id, undefined, bounded.base);
          sessionCookie = admin;
          expect(refused.status).toBe(429);
          expect((await refused.json()).error.code).toBe('preview_busy');
          expect((await running).status).toBe(200);
        } finally {
          await new Promise<void>((resolve) => bounded.server.close(() => resolve()));
        }
      });

      it('aborts its Storyly reads when the caller goes away, freeing its slot at once', async () => {
        const project = await createProject();
        fake.control.delayMs = 3000;
        const caller = new AbortController();
        const gone = fetch(`${importBase}/projects/${project.id}/imports/storyly/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: FAKE_STORYLY_TOKEN, appId: '1001' }),
          signal: caller.signal,
        }).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 100));
        caller.abort();
        await gone;
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Had the read gone on, the person's one slot would still be taken for about 3 s.
        fake.control.delayMs = 0;
        const started = Date.now();
        const next = await preview(project.id);
        expect(next.status).toBe(200);
        expect(Date.now() - started).toBeLessThan(2000);
      });

      it('refuses the preview to a content manager', async () => {
        const project = await createProject();
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        await addProjectMember(pool, project.id, user.id);
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        const res = await preview(project.id);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      });
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
          media: { source: 15, imported: 15, skipped: 0 },
          // How long it took, from the first claim to its end (story 10).
          elapsedSeconds: expect.any(Number),
          // Four labels in the app's list and five on story groups, counted per occurrence.
          tags: { source: 9, imported: 9, skipped: 0 },
          notes: [
            'Zone "Home page": frame type unknown',
            'Zone "Product page": frame type unknown',
            'Zone "Checkout": frame type unknown',
            'Tags: whether labels combine with AND or OR is not imported',
          ],
          // Each instance's per-platform token and each story group's cover are not held in TaleArt.
          // In reading order: the instance list, then each instance's story groups as read.
          differences: [
            notHeld('zone', '2001', 'Home page', null, 1, 'token'),
            notHeld('zone', '2002', 'Product page', null, 2, 'token'),
            notHeld('zone', '2003', 'Checkout', null, 3, 'token'),
            notHeld('taleGroup', '3001', 'Summer sale', ['Home page', '2001'], 1, 'media'),
            notHeld('taleGroup', '3002', 'New arrivals', ['Home page', '2001'], 2, 'media'),
            notHeld('taleGroup', '3003', 'Gift ideas', ['Home page', '2001'], 3, 'media'),
            notHeld('taleGroup', '3004', 'How to wear it', ['Product page', '2002'], 1, 'media'),
            notHeld('taleGroup', '3005', 'Reviews', ['Product page', '2002'], 2, 'media'),
            notHeld('taleGroup', '3006', 'Free shipping', ['Checkout', '2003'], 1, 'media'),
          ],
          notImportedByDesign: ['Conversion records', 'Stats'],
          changes: {
            zones: created(3),
            taleGroups: created(6),
            tales: created(15),
            media: created(15),
          },
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
      // A Storyly zone imports as one TaleArt zone without a display (epic UX rework, importer touch point).
      for (const zone of zones) expect((zone as { frame?: unknown }).frame).toBeNull();
      expect(zones.map((z) => (z as { slug?: string }).slug)).toEqual(['home-page', 'product-page', 'checkout']);
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

    // Each report difference as one line: entity, record (source id or position), within, kind and field.
    function differenceLines(report: unknown): string[] {
      const { differences } = report as {
        differences: {
          entity: string;
          record: {
            sourceId: string | null;
            name: string | null;
            within: string | null;
            withinSourceId: string | null;
            position: number;
          };
          kind: string;
          field: string | null;
          sourceField: string | null;
        }[];
      };
      return differences.map((d) =>
        [
          d.entity,
          d.record.sourceId ?? `#${d.record.position}`,
          d.record.within ? `in ${d.record.within} (${d.record.withinSourceId})` : null,
          d.kind,
          d.field,
          d.sourceField ? `<- ${d.sourceField}` : null,
        ]
          .filter((part) => part !== null)
          .join(' '),
      );
    }

    it('imports a source of malformed and unmappable records, listing every difference against its record', async () => {
      const project = await createProject();
      startWorker();
      const started = await send('POST', `/projects/${project.id}/imports`, { token: FAKE_STORYLY_TOKEN, appId: '1002' });
      expect(started.status).toBe(202);
      const job = await waitForEnd(project.id, ((await started.json()) as { id: string }).id);
      expect(job['status']).toBe('done');
      const report = job['report'] as Record<string, unknown>;
      expect(report).toMatchObject({
        zones: { source: 3, imported: 1, skipped: 2 },
        taleGroups: { source: 2, imported: 2, skipped: 0 },
        tales: { source: 6, imported: 3, skipped: 3 },
        notImportedByDesign: ['Conversion records', 'Stats'],
      });
      expect(differenceLines(report)).toEqual([
        // In reading order: apps, instances, then each list as it is read, records in response order.
        'app 1002 notHeld settings',
        'zone 2101 renamed title <- name',
        'zone 2101 notHeld token',
        'zone #2 invalidRecord',
        'zone #3 invalidRecord',
        'taleGroup 3101 in Odd home (2101) renamed clicked_target_cap <- click_target_cap',
        'taleGroup 3101 in Odd home (2101) notHeld media',
        'taleGroup 3101 in Odd home (2101) notHeld pinned',
        'taleGroup 3101 in Odd home (2101) notHeld settings',
        'taleGroup 3101 in Odd home (2101) notHeld clicked_target_cap',
        'taleGroup 3101 in Odd home (2101) unexpected theme',
        'taleGroup 3102 in Odd home (2101) wrongType title',
        'taleGroup 3102 in Odd home (2101) wrongType sort_order',
        'taleGroup 3102 in Odd home (2101) missing status',
        'tale 4101 in Odd group (3101) notHeld deep_link',
        'tale 4101 in Odd group (3101) notHeld button_text',
        'tale 4102 in Odd group (3101) renamed sort_order <- sortOrder',
        'tale 4102 in Odd group (3101) notHeld name',
        'tale 4102 in Odd group (3101) unexpected cta_macro',
        'tale #3 in Odd group (3101) invalidRecord',
        'tale #4 in Odd group (3101) invalidRecord',
        'tale 4105 in Untitled tale group (3102) missing media',
      ]);
      // A renamed title names the zone, a renamed sort_order places the tale; a wrong title takes the fallback.
      expect(await zonePages(project.id)).toEqual({
        'Odd home': [
          { name: 'Odd group', tales: ['Deal of the day', 'Odd order'] },
          { name: 'Untitled tale group', tales: ['No media'] },
        ],
      });
      // Field names only: no source value and no token in the report.
      const text = JSON.stringify(job);
      for (const value of ['https://shop.example/deal', 'Shop now', 'fake-instance-token-2101', '{{coupon}}', 'Internal 4102']) {
        expect(text).not.toContain(value);
      }
      expect(text).not.toContain(FAKE_STORYLY_TOKEN);
      expect((await storedJob(job['id'] as string)).token_ciphertext).toBeNull();
    });

    it('lists no differences for a source whose records match the expected shape', async () => {
      const project = await createProject();
      startWorker();
      const started = await send('POST', `/projects/${project.id}/imports`, { token: FAKE_STORYLY_TOKEN, appId: '1003' });
      const job = await waitForEnd(project.id, ((await started.json()) as { id: string }).id);
      expect(job['status']).toBe('done');
      expect(job['report']).toEqual({
        zones: { source: 1, imported: 1, skipped: 0 },
        taleGroups: { source: 1, imported: 1, skipped: 0 },
        tales: { source: 2, imported: 2, skipped: 0 },
        elapsedSeconds: expect.any(Number),
        media: { source: 2, imported: 2, skipped: 0 },
        tags: { source: 0, imported: 0, skipped: 0 },
        notes: ['Zone "Clean home": frame type unknown'],
        differences: [],
        notImportedByDesign: ['Conversion records', 'Stats'],
        changes: { zones: created(1), taleGroups: created(1), tales: created(2), media: created(2) },
      });
    });

    it('lists a repeated record once, and a record with an unexpected field without failing the job', async () => {
      const project = await createProject();
      // 3002 is "New arrivals" on the Home page; its first story is repeated, with an unexpected field.
      const stories = fake.control.data.stories['3002'].data;
      stories[0] = { ...stories[0], layout: 'wide' };
      stories.push(stories[0]);
      startWorker();
      const job = await importOnce(project.id);
      expect(job['status']).toBe('done');
      expect((job['report'] as { tales: unknown }).tales).toEqual({ source: 16, imported: 15, skipped: 1 });
      expect(differenceLines(job['report']).filter((line) => line.startsWith('tale '))).toEqual([
        `tale ${stories[0]['id']} in New arrivals (3002) unexpected layout`,
      ]);
    });

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
      // Each tale holds its copied media's storage key (AD-11); source ids live only in import_links.
      const tales = await pool.query('SELECT media_key FROM tales WHERE project_id = $1', [project.id]);
      expect(tales.rows.every((t) => /^tales\/imported-[0-9a-f-]{36}\.jpg$/.test(t.media_key))).toBe(true);
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

    it('adds a story new at the source in its source place among the tales already imported', async () => {
      const project = await createProject();
      startWorker();
      await waitForEnd(project.id, (await start(project.id)).id);
      // Story group 3002 is "New arrivals" on the Home page.
      fake.control.data.stories['3002'].data.push({ id: 4999, story_group_id: 3002, title: 'Just in', sort_order: -1 });
      const again = await waitForEnd(project.id, (await start(project.id)).id);
      expect((again['report'] as { tales: unknown }).tales).toEqual({ source: 16, imported: 16, skipped: 0 });
      // Nobody re-ordered the group in TaleArt, so the new tale takes its source place (importer story 7).
      expect((await zonePages(project.id))['Home page'][0]).toEqual({
        name: 'New arrivals',
        tales: ['Just in', 'This week', 'Back in stock', 'Staff picks'],
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

    it('imports an active story Shown and any other Hidden, also a new one re-imported into a group that is On', async () => {
      const project = await createProject();
      const stories = fake.control.data.stories['3001'] as { data: Record<string, unknown>[] };
      fixture(stories, 4002)['status'] = 2; // PASSIVE at the source
      startWorker();
      expect((await importOnce(project.id))['status']).toBe('done');
      const statusOf = async (title: string) =>
        (await pool.query('SELECT status FROM tales WHERE project_id = $1 AND title = $2', [project.id, title])).rows[0]
          ?.status;
      const first = fixture(stories, 4001);
      expect(await statusOf(first['title'] as string)).toBe('live');
      expect(await statusOf(fixture(stories, 4002)['title'] as string)).toBe('paused');

      // The group is turned On; the source then adds a passive and an active story to it.
      const groupId = (
        await pool.query('SELECT tale_group_id AS id FROM tales WHERE project_id = $1 AND title = $2', [
          project.id,
          first['title'],
        ])
      ).rows[0].id as string;
      await publish('tale-groups', groupId);
      stories.data.push(
        { ...first, id: 4901, title: 'New passive', name: 'New passive', status: 2, sort_order: 8 },
        { ...first, id: 4902, title: 'New active', name: 'New active', status: 1, sort_order: 9 },
      );
      expect((await importOnce(project.id))['status']).toBe('done');
      expect(await statusOf('New passive')).toBe('paused');
      expect(await statusOf('New active')).toBe('live');

      const zoneId = (await pool.query('SELECT zone_id FROM zone_tale_groups WHERE tale_group_id = $1', [groupId])).rows[0]
        .zone_id as string;
      const { key } = await (await postKey(zoneId)).json();
      clearDeliveryCache();
      const res = await globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: { Authorization: `Bearer ${key}` } });
      const delivered = ((await res.json()).taleGroups as { id: string; tales: { title: string }[] }[]).find(
        (g) => g.id === groupId,
      );
      const titles = delivered?.tales.map((t) => t.title) ?? [];
      expect(titles).toContain('New active');
      expect(titles).toContain(first['title']);
      expect(titles).not.toContain('New passive');
      expect(titles).not.toContain(fixture(stories, 4002)['title']);
    });

    // The media files stored so far in the test MEDIA_DIR.
    function storedMediaFiles(): string[] {
      const dir = join(mediaDir, 'tales');
      return existsSync(dir) ? readdirSync(dir) : [];
    }

    type ListedTale = {
      id: string;
      title: string;
      media: { kind: string; contentType: string; url: string } | null;
    };

    // Each tale of the project with its media, as the zone pages list them.
    async function projectTales(projectId: string): Promise<ListedTale[]> {
      const tales: ListedTale[] = [];
      for (const zone of await projectZones(projectId)) {
        const groups: { tales: ListedTale[] }[] = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
        tales.push(...groups.flatMap((g) => g.tales));
      }
      return tales;
    }

    async function importApp(projectId: string, appId: string): Promise<Record<string, unknown>> {
      const res = await send('POST', `/projects/${projectId}/imports`, {
        token: FAKE_STORYLY_TOKEN,
        appId,
      });
      expect(res.status).toBe(202);
      return waitForEnd(projectId, ((await res.json()) as { id: string }).id);
    }

    const mediaRequests = () => fake.control.requests.filter((r) => r.path.startsWith('/media/'));

    describe('re-import updates (AD-7)', () => {
      const reportOf = (job: Record<string, unknown>) => job['report'] as ImportReport;
      // The change counts of one entity type, every field given.
      const changeCount = (
        counts: Partial<Record<'created' | 'updated' | 'unchanged' | 'keptLocalEdit' | 'removedAtSource', number>>,
      ) => ({
        created: 0,
        updated: 0,
        unchanged: 0,
        keptLocalEdit: 0,
        removedAtSource: 0,
        ...counts,
      });
      const differencesOf = (job: Record<string, unknown>, kind: string) =>
        (reportOf(job).differences ?? []).filter((d) => d.kind === kind);
      async function taleId(projectId: string, title: string): Promise<string> {
        const { rows } = await pool.query('SELECT id FROM tales WHERE project_id = $1 AND title = $2', [
          projectId,
          title,
        ]);
        expect(rows).toHaveLength(1);
        return rows[0].id;
      }
      async function groupId(projectId: string, name: string): Promise<string> {
        const { rows } = await pool.query('SELECT id FROM tale_groups WHERE project_id = $1 AND name = $2', [
          projectId,
          name,
        ]);
        expect(rows).toHaveLength(1);
        return rows[0].id;
      }
      async function tagNamesOf(taleGroupId: string): Promise<string[]> {
        const { rows } = await pool.query(
          `SELECT tags.name FROM tale_group_tags links JOIN tags ON tags.id = links.tag_id
           WHERE links.tale_group_id = $1 ORDER BY tags.name`,
          [taleGroupId],
        );
        return rows.map((r) => r.name);
      }
      const summerStories = () => fake.control.data.stories['3001'].data;

      it('changes nothing in TaleArt when the same app is imported again, and counts every record unchanged', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const before = await contentCounts(project.id);
        const files = storedMediaFiles().length;
        fake.control.requests = [];
        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');
        expect(await contentCounts(project.id)).toEqual(before);
        expect(await zonePages(project.id)).toEqual(demoShopPages);
        expect(reportOf(again).changes).toEqual({
          zones: changeCount({ unchanged: 3 }),
          taleGroups: changeCount({ unchanged: 6 }),
          tales: changeCount({ unchanged: 15 }),
          media: changeCount({ unchanged: 15 }),
        });
        // The source names the same media, so none is downloaded again.
        expect(mediaRequests()).toEqual([]);
        expect(storedMediaFiles()).toHaveLength(files);
        expect(differencesOf(again, 'keptLocalEdit')).toEqual([]);
        expect(differencesOf(again, 'removedAtSource')).toEqual([]);
        expect(JSON.stringify(again)).not.toContain(FAKE_STORYLY_TOKEN);
      });

      it('updates a title, a group name and a zone name changed at the source', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        fixture(fake.control.data.stories['3001'], 4001)['title'] = 'Up to 70% off';
        fixture(fake.control.data.storyGroups['2001'], 3001)['title'] = 'Summer sale ends';
        fixture(fake.control.data.instances['1001'], 2001)['title'] = 'Start page';
        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');
        const pages = await zonePages(project.id);
        expect(Object.keys(pages)).toEqual(['Start page', 'Product page', 'Checkout']);
        expect(pages['Start page'][2]).toEqual({
          name: 'Summer sale ends',
          tales: ['Beach picks', 'Up to 70% off', 'Last call'],
        });
        expect(reportOf(again).changes).toMatchObject({
          zones: changeCount({ updated: 1, unchanged: 2 }),
          taleGroups: changeCount({ updated: 1, unchanged: 5 }),
          tales: changeCount({ updated: 1, unchanged: 14 }),
        });
        expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
      });

      it('keeps what a person changed in TaleArt, and lists it when the source changed it too', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // A person retitles two tales and renames a group (the API has no tale title route, so the row is changed).
        await pool.query('UPDATE tales SET title = $2 WHERE id = $1', [
          await taleId(project.id, 'Up to 50% off'),
          'Half off',
        ]);
        await pool.query('UPDATE tales SET title = $2 WHERE id = $1', [
          await taleId(project.id, 'Last call'),
          'Final call',
        ]);
        const renamed = await fetch(`${base}/tale-groups/${await groupId(project.id, 'Gift ideas')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Gifts' }),
        });
        expect(renamed.status).toBe(200);
        // The source changes one of those tales and that group; the other tale it leaves alone.
        fixture(fake.control.data.stories['3001'], 4001)['title'] = 'Up to 70% off';
        fixture(fake.control.data.storyGroups['2001'], 3003)['title'] = 'Gift guide';
        const again = await importOnce(project.id);
        const home = (await zonePages(project.id))['Home page'];
        expect(home.map((g) => g.name)).toEqual(['New arrivals', 'Gifts', 'Summer sale']);
        expect(home[2].tales).toEqual(['Beach picks', 'Half off', 'Final call']);
        expect(reportOf(again).changes).toMatchObject({
          taleGroups: changeCount({ unchanged: 6, keptLocalEdit: 1 }),
          tales: changeCount({ unchanged: 15, keptLocalEdit: 1 }),
        });
        // In the order the groups are imported: "Gift guide" (sort order 1) before "Summer sale" (2).
        expect(differencesOf(again, 'keptLocalEdit')).toEqual([
          {
            entity: 'taleGroup',
            record: { sourceId: '3003', name: 'Gift guide', within: 'Home page', withinSourceId: '2001', position: 3 },
            kind: 'keptLocalEdit',
            field: 'title',
            sourceField: null,
          },
          {
            entity: 'tale',
            record: {
              sourceId: '4001',
              name: 'Up to 70% off',
              within: 'Summer sale',
              withinSourceId: '3001',
              position: 1,
            },
            kind: 'keptLocalEdit',
            field: 'title',
            sourceField: null,
          },
        ]);
      });

      it("follows the source's order, and keeps an order a person changed", async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // The source moves "Last call" (4003) first in "Summer sale".
        fixture(fake.control.data.stories['3001'], 4003)['sort_order'] = -1;
        const moved = await importOnce(project.id);
        expect((await zonePages(project.id))['Home page'][2].tales).toEqual([
          'Last call',
          'Beach picks',
          'Up to 50% off',
        ]);
        expect(reportOf(moved).changes?.taleGroups).toEqual(changeCount({ updated: 1, unchanged: 5 }));

        // A person puts "Up to 50% off" first; the source then moves "Beach picks" last: the person's order stays.
        const summer = await groupId(project.id, 'Summer sale');
        const order = [
          await taleId(project.id, 'Up to 50% off'),
          await taleId(project.id, 'Last call'),
          await taleId(project.id, 'Beach picks'),
        ];
        const put = await fetch(`${base}/tale-groups/${summer}/tales/order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taleIds: order }),
        });
        expect(put.status).toBe(200);
        fixture(fake.control.data.stories['3001'], 4002)['sort_order'] = 9;
        const kept = await importOnce(project.id);
        expect((await zonePages(project.id))['Home page'][2].tales).toEqual([
          'Up to 50% off',
          'Last call',
          'Beach picks',
        ]);
        expect(differencesOf(kept, 'keptLocalEdit').map((d) => [d.entity, d.record.sourceId, d.field])).toEqual([
          ['taleGroup', '3001', 'sort_order'],
        ]);
      });

      it('adds labels new at the source, never re-adds a tag a person removed, and lists labels the source dropped', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const summer = await groupId(project.id, 'Summer sale');
        expect(await tagNamesOf(summer)).toEqual(['summer', 'vip']);
        // A person removes "vip" from the group.
        const tags: { id: string; name: string }[] = await (await fetch(`${base}/projects/${project.id}/tags`)).json();
        const summerTag = tags.find((t) => t.name === 'summer')?.id;
        const set = await fetch(`${base}/tale-groups/${summer}/tags`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagIds: [summerTag] }),
        });
        expect(set.status).toBe(200);
        // The source drops "summer" and adds "beach"; it still has "vip".
        fixture(fake.control.data.storyGroups['2001'], 3001)['segments'] = ['vip', 'beach'];
        const again = await importOnce(project.id);
        expect(await tagNamesOf(summer)).toEqual(['beach', 'summer']);
        expect(reportOf(again).changes?.taleGroups).toMatchObject({ updated: 1 });
        expect(differencesOf(again, 'removedAtSource')).toEqual([
          {
            entity: 'tag',
            record: { sourceId: null, name: 'summer', within: 'Summer sale', withinSourceId: '3001', position: null },
            kind: 'removedAtSource',
            field: 'segments',
            sourceField: null,
          },
        ]);
        // Listed again on the next run while the group carries it, as other records removed at the source are.
        const third = await importOnce(project.id);
        expect(differencesOf(third, 'removedAtSource').map((d) => [d.entity, d.record.name])).toEqual([
          ['tag', 'summer'],
        ]);
        expect(await tagNamesOf(summer)).toEqual(['beach', 'summer']);
      });

      it("replaces media the source changed, and keeps media a person set, listing it when the source's changed", async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const halfOff = await taleId(project.id, 'Up to 50% off');
        const beach = await taleId(project.id, 'Beach picks');
        const keyOf = async (id: string) =>
          (await pool.query('SELECT media_key FROM tales WHERE id = $1', [id])).rows[0].media_key as string;
        const earlier = await keyOf(halfOff);
        // A person uploads their own image to "Beach picks".
        const png = readFileSync(join(fixturesMediaDir, 'story.png'));
        const upload = await fetch(`${base}/tales/${beach}/media`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(upload.status).toBe(200);
        const uploaded = await keyOf(beach);
        // The source points both stories at other images.
        summerStories().forEach((story) => {
          if (story['id'] === 4001) story['media'] = 'https://media.example/fake/story-4002.jpg';
          if (story['id'] === 4002) story['media'] = 'https://media.example/fake/story-4003.jpg';
        });
        fake.control.requests = [];
        const again = await importOnce(project.id);
        expect(await keyOf(halfOff)).not.toBe(earlier);
        expect(await keyOf(beach)).toBe(uploaded);
        expect(mediaRequests().map((r) => r.path)).toEqual(['/media/story-4002.jpg']);
        expect(reportOf(again).changes?.media).toEqual(changeCount({ updated: 1, unchanged: 13, keptLocalEdit: 1 }));
        expect(reportOf(again).media).toEqual({ source: 15, imported: 14, skipped: 1 });
        expect(differencesOf(again, 'keptLocalEdit').map((d) => [d.entity, d.record.sourceId, d.field])).toEqual([
          ['tale', '4002', 'media'],
        ]);
        // The tale serves the new image; the earlier copy is left to the sweep, nothing else is deleted.
        const served = await fetch(`${base}/tales/${halfOff}/media`);
        expect(Buffer.from(await served.arrayBuffer())).toEqual(readFileSync(join(fixturesMediaDir, 'story-2.jpg')));
        expect(storedMediaFiles()).toContain(earlier.slice('tales/'.length));
      });

      it('keeps records the source no longer lists, and lists them with their TaleArt names', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        fake.control.data.instances['1001'].data.pop(); // Checkout (2003), with "Free shipping" and its two stories
        summerStories().pop(); // "Last call" (4003)
        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');
        expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
        expect(reportOf(again).changes).toMatchObject({
          zones: changeCount({ unchanged: 2, removedAtSource: 1 }),
          taleGroups: changeCount({ unchanged: 5, removedAtSource: 1 }),
          tales: changeCount({ unchanged: 12, removedAtSource: 3 }),
        });
        const removed = differencesOf(again, 'removedAtSource').map((d) => [
          d.entity,
          d.record.sourceId,
          d.record.name,
        ]);
        expect(removed).toEqual(
          expect.arrayContaining([
            ['zone', '2003', 'Checkout'],
            ['taleGroup', '3006', 'Free shipping'],
            ['tale', '4003', 'Last call'],
          ]),
        );
        expect(removed).toHaveLength(5);
        // An import never deletes: the zone and its content stay, and a tale stays in its place.
        expect((await zonePages(project.id))['Checkout']).toEqual(demoShopPages['Checkout']);
        expect((await zonePages(project.id))['Home page'][2].tales).toEqual([
          'Beach picks',
          'Up to 50% off',
          'Last call',
        ]);
      });

      it('keeps a differing title of a record imported before re-imports kept baselines, and lists it', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // As if imported before this story: no baselines, and links without their app.
        await pool.query('DELETE FROM import_records WHERE project_id = $1', [project.id]);
        await pool.query('UPDATE import_links SET source_app_id = NULL WHERE project_id = $1', [project.id]);
        fixture(fake.control.data.stories['3001'], 4001)['title'] = 'Up to 70% off';
        const again = await importOnce(project.id);
        expect((await zonePages(project.id))['Home page'][2].tales).toContain('Up to 50% off');
        expect(differencesOf(again, 'keptLocalEdit').map((d) => [d.entity, d.record.sourceId, d.field])).toEqual([
          ['tale', '4001', 'title'],
        ]);
        expect(reportOf(again).changes?.tales).toEqual(changeCount({ unchanged: 15, keptLocalEdit: 1 }));
        // The links know their app again, so a later run can list what the source drops.
        const unscoped = await pool.query(
          'SELECT 1 FROM import_links WHERE project_id = $1 AND source_app_id IS NULL',
          [project.id],
        );
        expect(unscoped.rowCount).toBe(0);
      });

      it('updates each record once when two workers re-import the same app at the same time', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        await Promise.all(workers.map((w) => w.stop()));
        workers = [];
        fixture(fake.control.data.stories['3001'], 4001)['title'] = 'Up to 70% off';
        fixture(fake.control.data.stories['3001'], 4003)['sort_order'] = -1;
        const first = await start(project.id);
        const second = await start(project.id);
        startWorker('worker-a');
        startWorker('worker-b');
        const jobs = [await waitForEnd(project.id, first.id), await waitForEnd(project.id, second.id)];
        expect(jobs.map((j) => j['status'])).toEqual(['done', 'done']);
        expect(await contentCounts(project.id)).toEqual({ groups: 6, placements: 6, tales: 15, links: 24 });
        expect((await zonePages(project.id))['Home page'][2].tales).toEqual([
          'Last call',
          'Beach picks',
          'Up to 70% off',
        ]);
        // One run wrote the change; the other found it written.
        const updated = jobs.map((j) => reportOf(j).changes?.tales.updated ?? 0);
        expect(updated.reduce((a, b) => a + b, 0)).toBe(1);
        expect(jobs.flatMap((j) => differencesOf(j, 'keptLocalEdit'))).toEqual([]);
        const baselines = await pool.query('SELECT count(*)::int AS n FROM import_records WHERE project_id = $1', [
          project.id,
        ]);
        expect(baselines.rows[0].n).toBe(24);
      });

      it('never fails while people create, place, copy, re-order and re-tag in the zones it updates', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const home = (await projectZones(project.id)).find((z) => z.name === 'Home page')?.id as string;
        const product = (await projectZones(project.id)).find((z) => z.name === 'Product page')?.id as string;
        const summer = await groupId(project.id, 'Summer sale');
        const tags: { id: string; name: string }[] = await (await fetch(`${base}/projects/${project.id}/tags`)).json();
        // Every run updates every zone, group and tale: names and orders change at the source each time.
        const statuses: number[] = [];
        const json = (method: string, path: string, body: unknown) =>
          fetch(`${base}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then((res) => statuses.push(res.status));
        for (let round = 0; round < 3; round++) {
          for (const list of Object.values(fake.control.data.storyGroups)) {
            for (const group of list.data.filter((g) => g !== null && typeof g === 'object')) {
              group['title'] = `${String(group['title']).replace(/ #\d+$/, '')} #${round}`;
              group['sort_order'] = -Number(group['sort_order']);
              group['segments'] = [`round-${round}`];
            }
          }
          for (const list of Object.values(fake.control.data.stories)) {
            for (const story of list.data.filter((s) => s !== null && typeof s === 'object')) {
              story['sort_order'] = -Number(story['sort_order']);
            }
          }
          const started = await start(project.id);
          const people = Promise.all([
            json('POST', `/zones/${home}/tale-groups`, { name: `Manual ${round}` }),
            json('POST', `/tale-groups/${summer}/copy`, { zoneId: home }),
            json('PUT', `/zones/${product}/tale-groups/${summer}`, {}),
            json('PUT', `/tale-groups/${summer}/tags`, { tagIds: tags.slice(0, 2).map((t) => t.id) }),
            json('POST', `/zones/${home}/tale-groups`, { name: `Another ${round}` }),
            json('PUT', `/tale-groups/${summer}/tags`, { tagIds: tags.slice(1, 3).map((t) => t.id) }),
          ]);
          const job = await waitForEnd(project.id, started.id);
          await people;
          expect(job['status']).toBe('done');
        }
        expect(statuses.filter((s) => s >= 500)).toEqual([]);
      });

      it('looks for no removal among records of a list that held unreadable records, and says so', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // "Last call" (4003) leaves the source, and the story list gains a record without an id.
        summerStories().pop();
        summerStories().push({ title: 'No id' } as Record<string, unknown>);
        const stories = await importOnce(project.id);
        expect(stories['status']).toBe('done');
        expect(differencesOf(stories, 'removedAtSource')).toEqual([]);
        expect(reportOf(stories).notes).toContain(
          'Tales: the source listed records that could not be read, so none was looked for as removed at the source',
        );
        // An instance list with an unreadable entry: neither zones nor their content are looked for as removed.
        fake.control.reset();
        fake.control.data.instances['1001'].data.pop();
        fake.control.data.instances['1001'].data.push('oops' as unknown as Record<string, unknown>);
        const zones = await importOnce(project.id);
        expect(differencesOf(zones, 'removedAtSource')).toEqual([]);
        expect(reportOf(zones).notes).toEqual(
          expect.arrayContaining([
            'Zones: the source listed records that could not be read, so none was looked for as removed at the source',
            'Tale groups: the source listed records that could not be read, so none was looked for as removed at the source',
          ]),
        );
      });

      it('lists a record removed at the source by its current TaleArt name, a renamed and a legacy one alike', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        // A person renames "Free shipping" (3006); "Gift ideas" (3003) loses its baseline, as if imported earlier.
        const renamed = await fetch(`${base}/tale-groups/${await groupId(project.id, 'Free shipping')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Shipping perks' }),
        });
        expect(renamed.status).toBe(200);
        const gifts = await groupId(project.id, 'Gift ideas');
        await pool.query("DELETE FROM import_records WHERE target_type = 'taleGroup' AND target_id = $1", [gifts]);
        await pool.query("UPDATE tale_groups SET name = 'Gift guide' WHERE id = $1", [gifts]);
        const homeGroups = fake.control.data.storyGroups['2001'].data;
        homeGroups.splice(
          homeGroups.findIndex((g) => g['id'] === 3003),
          1,
        );
        fake.control.data.storyGroups['2003'].data.length = 0;
        const again = await importOnce(project.id);
        const removed = differencesOf(again, 'removedAtSource').filter((d) => d.entity === 'taleGroup');
        expect(removed.map((d) => [d.record.sourceId, d.record.name])).toEqual(
          expect.arrayContaining([
            ['3003', 'Gift guide'],
            ['3006', 'Shipping perks'],
          ]),
        );
        expect(removed).toHaveLength(2);
      });

      it('leaves no baseline behind for a record deleted in TaleArt: the worker sweeps it when it starts', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const tale = await taleId(project.id, 'Last call');
        // Deleted outside the import (no API deletes a tale yet), so its baseline is orphaned.
        await pool.query('DELETE FROM import_media WHERE tale_id = $1', [tale]);
        await pool.query('DELETE FROM tales WHERE id = $1', [tale]);
        expect((await pool.query('SELECT 1 FROM import_records WHERE target_id = $1', [tale])).rowCount).toBe(1);
        await Promise.all(workers.map((w) => w.stop()));
        workers = [];
        startWorker();
        // The sweep runs before the first poll, so it is done once a job has run.
        await importOnce(project.id);
        expect((await pool.query('SELECT 1 FROM import_records WHERE target_id = $1', [tale])).rowCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM import_records WHERE project_id = $1', [project.id])).rowCount).toBe(
          23,
        );
      });
    });

    describe('labels as tags', () => {
      // Each tale group of the project with its tags' names, as the zone pages list them.
      async function groupTags(projectId: string): Promise<Record<string, string[]>> {
        const tags: Record<string, string[]> = {};
        for (const zone of await projectZones(projectId)) {
          const groups: { id: string; name: string; tags: { name: string }[] }[] = await (
            await fetch(`${base}/zones/${zone.id}/tale-groups`)
          ).json();
          for (const g of groups) tags[g.name] = g.tags.map((t) => t.name);
        }
        return tags;
      }

      // The project's tags by name, as its tag list answers them.
      async function projectTagNames(projectId: string): Promise<string[]> {
        const tags: { name: string }[] = await (await fetch(`${base}/projects/${projectId}/tags`)).json();
        return tags.map((t) => t.name);
      }

      // How many tags and tale-group tags the project holds.
      async function tagCounts(projectId: string): Promise<{ tags: number; links: number }> {
        const count = async (table: string) =>
          Number((await pool.query(`SELECT count(*) FROM ${table} WHERE project_id = $1`, [projectId])).rows[0].count);
        return { tags: await count('tags'), links: await count('tale_group_tags') };
      }

      const demoShopTags = {
        'New arrivals': ['new'],
        'Gift ideas': [],
        'Summer sale': ['summer', 'vip'],
        Reviews: [],
        'How to wear it': ['vip'],
        'Free shipping': ['summer'],
      };

      it("makes the app's labels tags of the project and gives each tale group its source group's tags", async () => {
        const project = await createProject();
        startWorker();
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        // Per occurrence: four labels in the list, five on the story groups.
        expect((job['report'] as { tags: unknown }).tags).toEqual({ source: 9, imported: 9, skipped: 0 });
        expect(await projectTagNames(project.id)).toEqual(['new', 'returning', 'summer', 'vip']);
        expect(await groupTags(project.id)).toEqual(demoShopTags);
        // Tags carry no import links: source ids live only in import_links, for zones, groups and stories (AD-7).
        const types = await pool.query(
          'SELECT DISTINCT source_type FROM import_links WHERE project_id = $1 ORDER BY 1',
          [project.id],
        );
        expect(types.rows.map((r) => r.source_type)).toEqual(['instance', 'story', 'story_group']);
      });

      it('reuses a tag the project already has under the same name in another case', async () => {
        const project = await createProject();
        const created = await post(`/projects/${project.id}/tags`, { name: 'VIP' });
        expect(created.status).toBe(201);
        const vip: { id: string } = await created.json();
        startWorker();
        const job = await importOnce(project.id);
        expect((job['report'] as { tags: unknown }).tags).toEqual({ source: 9, imported: 9, skipped: 0 });
        expect(await projectTagNames(project.id)).toEqual(['new', 'returning', 'summer', 'VIP']);
        const tags = await groupTags(project.id);
        expect(tags['Summer sale']).toEqual(['summer', 'VIP']);
        expect(tags['How to wear it']).toEqual(['VIP']);
        const vipLinks = await pool.query('SELECT count(*) FROM tale_group_tags WHERE tag_id = $1', [vip.id]);
        expect(Number(vipLinks.rows[0].count)).toBe(2);
      });

      it('creates no tag or tag link twice when imported again, and keeps tags added in TaleArt', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const manual: { id: string } = await (await post(`/projects/${project.id}/tags`, { name: 'manual' })).json();
        const summerSale = (
          await pool.query(
            "SELECT target_id FROM import_links WHERE project_id = $1 AND source_type = 'story_group' " +
              "AND source_id = '3001'",
            [project.id],
          )
        ).rows[0].target_id as string;
        const current = (await pool.query('SELECT tag_id FROM tale_group_tags WHERE tale_group_id = $1', [summerSale]))
          .rows.map((r) => r.tag_id as string);
        const res = await fetch(`${base}/tale-groups/${summerSale}/tags`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagIds: [...current, manual.id] }),
        });
        expect(res.status).toBe(200);
        const before = await tagCounts(project.id);
        expect(before).toEqual({ tags: 5, links: 6 });

        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');
        expect((again['report'] as { tags: unknown }).tags).toEqual({ source: 9, imported: 9, skipped: 0 });
        expect(await tagCounts(project.id)).toEqual(before);
        expect((await groupTags(project.id))['Summer sale']).toEqual(['manual', 'summer', 'vip']);
      });

      it('imports odd labels as far as they go and lists each one that cannot become a tag', async () => {
        const project = await createProject();
        startWorker();
        const job = await importApp(project.id, '1005');
        expect(job['status']).toBe('done');
        const report = job['report'] as {
          tags: unknown;
          notes: string[];
          differences: { entity: string; kind: string; reason?: string; record: { name: string | null } }[];
        };
        // Per occurrence: 8 in the list and 14 on the groups; each skipped one is one difference.
        expect(report.tags).toEqual({ source: 22, imported: 11, skipped: 11 });
        expect(await projectTagNames(project.id)).toEqual([
          'From object',
          'json-label',
          'Loyal',
          'No id',
          'Renamed label',
          // Of labels differing only in case, the one first by lower(name), then name, names the tag.
          'summer',
          'vip',
        ]);
        expect(await groupTags(project.id)).toEqual({
          'Case twins': ['summer', 'vip'],
          'Odd labels': ['From object'],
          'JSON labels': ['json-label', 'vip'],
          'Bad segments': [],
          'No labels': [],
        });
        expect(differenceLines(report)).toEqual([
          // The labels list, as it is read.
          'tag 5102 renamed name <- title',
          'tag 5103 wrongType name',
          'tag #5 invalidRecord',
          'tag 5104 tagNotImported name',
          'tag 5105 tagNotImported name',
          'tag #8 tagNotImported name',
          // Each story group's labels, with the group list.
          'tag #1 in Odd labels (3402) tagNotImported segments',
          'tag #2 in Odd labels (3402) tagNotImported segments',
          'tag #3 in Odd labels (3402) tagNotImported segments',
          'tag #4 in Odd labels (3402) tagNotImported segments',
          'tag #5 in Odd labels (3402) tagNotImported segments',
          'tag #7 in Odd labels (3402) tagNotImported segments',
          'tag #8 in Odd labels (3402) tagNotImported segments',
          'taleGroup 3404 in Label wall (2401) wrongType segments',
        ]);
        expect(report.differences.filter((d) => d.kind === 'tagNotImported').map((d) => d.reason)).toEqual([
          'blank',
          'tooLong',
          'blank',
          'blank',
          'blank',
          'tooLong',
          'notText',
          'notText',
          'notText',
          'notText',
        ]);
        // A long label is named, cut to the report's limit; a blank one is not.
        expect(report.differences[4].record.name).toBe('A label far too long to be a TaleArt tag name, sixty chars');
        expect(report.differences[3].record.name).toBeNull();
        expect(report.notes).toEqual([
          'Zone "Label wall": frame type unknown',
          'Tag "summer": labels "Summer", "summer", "SUMMER" became one tag, since tag names ignore case',
          'Tags: whether labels combine with AND or OR is not imported',
        ]);
      });

      for (const [mode, reason] of [
        ['status', 'Storyly answered 500 when listing labels'],
        ['shape', "Storyly's labels response has an unexpected shape: no list of records"],
      ] as const) {
        it(`finishes with the story groups' labels when the labels list fails (${mode})`, async () => {
          const project = await createProject();
          fake.control.failSegments = mode;
          startWorker();
          const job = await importOnce(project.id);
          expect(job['status']).toBe('done');
          const report = job['report'] as { tags: unknown; notes: string[] };
          // "returning" is only in the list.
          expect(report.tags).toEqual({ source: 5, imported: 5, skipped: 0 });
          expect(report.notes).toContain(
            `Tags: the labels list could not be read (${reason}), so tags come from story groups only`,
          );
          expect(await groupTags(project.id)).toEqual(demoShopTags);
        });
      }

      it('finishes the job when a label holds NUL or other control characters, and refuses them in a tag', async () => {
        const project = await createProject();
        const home = fake.control.data.storyGroups['2001'].data;
        home[0] = { ...home[0], segments: ['summer', 'nul\u0000inside', 'bell\u0007'] };
        fake.control.data.segments['1001'].data.push({ id: 5098, name: 'del\u007f' });
        startWorker();
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        const report = job['report'] as { tags: unknown; differences: { kind: string; reason?: string }[] };
        expect(report.tags).toEqual({ source: 11, imported: 8, skipped: 3 });
        expect(report.differences.filter((d) => d.kind === 'tagNotImported').map((d) => d.reason)).toEqual([
          'invalidCharacters',
          'invalidCharacters',
          'invalidCharacters',
        ]);
        const res = await post(`/projects/${project.id}/tags`, { name: 'a\u0000b' });
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      });

      it('finds or creates the same tags from concurrent imports in reversed orders without a deadlock', async () => {
        const project = await createProject();
        const names = Array.from({ length: 60 }, (_, i) => `Tag ${String(i).padStart(2, '0')}`);
        for (let round = 0; round < 5; round++) {
          const ordered = names.map((n) => `${n} r${round}`);
          const reversed = [...ordered].reverse().map((n) => n.toUpperCase());
          const results = await Promise.all([
            ensureTags(pool, project.id, ordered),
            ensureTags(pool, project.id, reversed),
            ensureTags(pool, project.id, ordered),
          ]);
          expect(results.map((r) => r.size)).toEqual([60, 60, 60]);
        }
        expect((await tagCounts(project.id)).tags).toBe(300);
      });

      it('never stores the token in the report, also when a label holds it', async () => {
        const project = await createProject();
        const label = `${FAKE_STORYLY_TOKEN} ${'x'.repeat(40)}`;
        fake.control.data.segments['1001'].data.push({ id: 5099, name: label });
        startWorker();
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        const text = JSON.stringify(job);
        expect(text).not.toContain(FAKE_STORYLY_TOKEN);
        expect(text).toContain(`[token] ${'x'.repeat(40)}`);
      });
    });

    describe('tale media', () => {
      beforeEach(() => {
        fake.control.requests.length = 0;
      });

      it("copies each story's media through the storage port, so every tale shows it after a reload", async () => {
        const project = await createProject();
        const before = storedMediaFiles().length;
        startWorker();
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        expect(job['report']).toMatchObject({
          media: { source: 15, imported: 15, skipped: 0 },
        });
        expect(storedMediaFiles().length - before).toBe(15);

        // A fresh read, as after a reload: each tale serves its JPEG.
        const tales = await projectTales(project.id);
        expect(tales).toHaveLength(15);
        for (const tale of tales) {
          expect(tale.media).toEqual({
            kind: 'image',
            contentType: 'image/jpeg',
            url: `/api/v1/tales/${tale.id}/media`,
          });
          const res = await fetch(`${base}/tales/${tale.id}/media`);
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toBe('image/jpeg');
          expect([...new Uint8Array(await res.arrayBuffer()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        }
        // The importer's own record holds the key and the bytes' hash, never the URL.
        const { rows } = await pool.query('SELECT * FROM import_media WHERE project_id = $1', [project.id]);
        expect(rows).toHaveLength(15);
        expect(JSON.stringify(rows)).not.toContain('/media/story-');
      });

      it('imports a story whose media fails without it, lists the reason, and finishes the job', async () => {
        const project = await createProject();
        const before = storedMediaFiles().length;
        const log = vi.fn();
        workers.push(
          startImportWorker(pool, {
            ...workerMedia(),
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
            log,
          }),
        );
        const job = await importApp(project.id, '1004');
        expect(job['status']).toBe('done');
        const report = job['report'] as {
          tales: unknown;
          media: unknown;
          differences: {
            kind: string;
            record: { name: string; position: number };
            field: string;
            reason: string;
          }[];
        };
        expect(report.tales).toEqual({ source: 14, imported: 14, skipped: 0 });
        expect(report.media).toEqual({ source: 14, imported: 5, skipped: 9 });
        const failures = report.differences
          .filter((d) => d.kind === 'mediaNotImported')
          .map((d) => [d.record.name, d.record.position, d.field, d.reason]);
        expect(failures).toEqual([
          ['Too big', 5, 'media', 'tooLarge'],
          ['Not a picture', 6, 'media', 'unsupportedType'],
          ['Web page', 7, 'media', 'unsupportedType'],
          ['Metadata', 8, 'media', 'blockedAddress'],
          ['Loopback', 9, 'media', 'blockedAddress'],
          ['Loop', 10, 'media', 'tooManyRedirects'],
          ['Gone', 11, 'media', 'httpError'],
          ['File', 12, 'media', 'invalidUrl'],
          ['Too big declared', 14, 'media', 'tooLarge'],
        ]);
        expect(report.differences).toHaveLength(9);
        expect(report.differences[0]).toEqual({
          entity: 'tale',
          record: {
            sourceId: '4305',
            name: 'Too big',
            within: 'Every kind of media',
            withinSourceId: '3301',
            position: 5,
          },
          kind: 'mediaNotImported',
          field: 'media',
          sourceField: null,
          reason: 'tooLarge',
        });

        // Every tale exists; only the five good ones hold media, of their own types.
        const tales = Object.fromEntries(
          (await projectTales(project.id)).map((t) => [t.title, t.media?.contentType ?? null]),
        );
        expect(tales).toEqual({
          Animated: 'image/gif',
          Clip: 'video/mp4',
          'WebP card': 'image/webp',
          Moved: 'image/jpeg',
          'Too big': null,
          'Not a picture': null,
          'Web page': null,
          Metadata: null,
          Loopback: null,
          Loop: null,
          Gone: null,
          File: null,
          'Generic type': 'image/png',
          'Too big declared': null,
        });
        // No file is left behind by a failed download.
        expect(storedMediaFiles().length - before).toBe(5);
        // The loop was cut after 3 redirects: the first request and 3 more.
        expect(mediaRequests().filter((r) => r.path === '/media/redirect-loop.jpg')).toHaveLength(4);

        // No media URL and no token in the report, the job row or the logs.
        const stored = JSON.stringify(
          (await pool.query('SELECT * FROM import_jobs WHERE project_id = $1', [project.id])).rows,
        );
        const logged = JSON.stringify(log.mock.calls);
        for (const text of [JSON.stringify(job), stored, logged]) {
          for (const secret of [
            fake.mediaUrl,
            'media.example',
            '169.254.169.254',
            '/etc/passwd',
            '[::1]',
            FAKE_STORYLY_TOKEN,
          ]) {
            expect(text).not.toContain(secret);
          }
        }
      });

      it('fetches no non-public address by default, not even the fake on localhost', async () => {
        const project = await createProject();
        const before = storedMediaFiles().length;
        workers.push(
          startImportWorker(pool, {
            storage: new LocalDiskStorage(mediaDir),
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
          }),
        );
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        const report = job['report'] as {
          media: unknown;
          differences: { kind: string; reason?: string }[];
        };
        expect(report.media).toEqual({ source: 15, imported: 0, skipped: 15 });
        const reasons = report.differences.filter((d) => d.kind === 'mediaNotImported').map((d) => d.reason);
        expect(reasons).toEqual(Array(15).fill('blockedAddress'));
        expect(mediaRequests()).toEqual([]);
        expect(storedMediaFiles().length).toBe(before);
      });

      it('downloads and stores nothing again when the app is imported again', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const files = storedMediaFiles().length;
        const keys = (
          await pool.query('SELECT id, media_key FROM tales WHERE project_id = $1 ORDER BY id', [project.id])
        ).rows;
        fake.control.requests.length = 0;

        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');
        expect(again['report']).toMatchObject({
          media: { source: 15, imported: 15, skipped: 0 },
        });
        expect(mediaRequests()).toEqual([]);
        expect(storedMediaFiles().length).toBe(files);
        expect(
          (await pool.query('SELECT id, media_key FROM tales WHERE project_id = $1 ORDER BY id', [project.id])).rows,
        ).toEqual(keys);
        const recorded = await pool.query('SELECT count(*)::int AS n FROM import_media WHERE project_id = $1', [
          project.id,
        ]);
        expect(recorded.rows[0].n).toBe(15);
      });

      it('retries a failed download on the next import, and keeps media a person set in TaleArt', async () => {
        const project = await createProject();
        const stories = fake.control.data.stories['3001'].data;
        const [failing, replaced] = [String(stories[0]['title']), String(stories[1]['title'])];
        const media = stories[0]['media'];
        stories[0]['media'] = 'https://media.example/fake/missing.jpg';
        startWorker();
        const first = await importOnce(project.id);
        expect(first['report']).toMatchObject({
          media: { source: 15, imported: 14, skipped: 1 },
        });

        // A person replaces another tale's media in TaleArt.
        const own = (await projectTales(project.id)).find((t) => t.title === replaced);
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        const upload = await fetch(`${base}/tales/${own?.id}/media`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        });
        expect(upload.status).toBe(200);

        stories[0]['media'] = media;
        const second = await importOnce(project.id);
        expect(second['report']).toMatchObject({
          media: { source: 15, imported: 14, skipped: 1 },
        });
        expect((second['report'] as { notes: string[] }).notes).toContain(
          `Tale "${replaced}" in "Summer sale": its media was set in TaleArt, so it was not replaced`,
        );
        const after = Object.fromEntries((await projectTales(project.id)).map((t) => [t.title, t.media?.contentType]));
        expect(after[failing]).toBe('image/jpeg');
        expect(after[replaced]).toBe('image/png');
      });

      it('lists media past the per-import budget as not imported, without requesting it', async () => {
        const project = await createProject();
        workers.push(
          startImportWorker(pool, {
            ...workerMedia(),
            mediaPolicy: { ...workerMedia().mediaPolicy, maxBytesPerJob: 1 },
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
          }),
        );
        const job = await importOnce(project.id);
        expect(job['status']).toBe('done');
        const report = job['report'] as { media: unknown; differences: { kind: string; reason?: string }[] };
        expect(report.media).toEqual({ source: 15, imported: 0, skipped: 15 });
        const reasons = report.differences.filter((d) => d.kind === 'mediaNotImported').map((d) => d.reason);
        expect(reasons).toEqual(Array(15).fill('jobBudgetExceeded'));
        // The first download was refused on its declared length; the rest were not requested.
        expect(mediaRequests()).toHaveLength(1);
      });

      it('never replaces media a person uploads while the import downloads, and deletes only its own copy', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const [tale] = await projectTales(project.id);
        // The tale starts without media, as if its download were still to come.
        await pool.query('UPDATE tales SET media_key = NULL, media_content_type = NULL WHERE id = $1', [tale.id]);
        await pool.query('DELETE FROM import_media WHERE tale_id = $1', [tale.id]);
        const storage = new LocalDiskStorage(mediaDir);
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
        let copyKey = '';
        const outcome = await importTaleMedia(
          pool,
          {
            storage,
            // The upload lands between the importer's check and its update.
            copy: async () => {
              const upload = await fetch(`${base}/tales/${tale.id}/media`, {
                method: 'PUT',
                headers: { 'Content-Type': 'image/png' },
                body: png,
              });
              expect(upload.status).toBe(200);
              copyKey = `${IMPORTED_MEDIA_PREFIX}${randomUUID()}.jpg`;
              await storage.put(copyKey, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
              return { key: copyKey, contentType: 'image/jpeg', sha256: 'x' };
            },
          },
          project.id,
          tale.id,
          { media: 'https://media.example/fake/story-1.jpg' },
        );
        expect(outcome).toEqual({ kind: 'keptOwn', sourceChanged: false });
        const media = (await pool.query('SELECT media_key, media_content_type FROM tales WHERE id = $1', [tale.id]))
          .rows[0];
        expect(media.media_content_type).toBe('image/png');
        expect(await storage.get(media.media_key)).toEqual(png);
        expect(await storage.get(copyKey)).toBeNull();
        expect((await pool.query('SELECT 1 FROM import_media WHERE tale_id = $1', [tale.id])).rowCount).toBe(0);
      });

      it('imports tales as documents of their media; a re-import replaces it only where no person edited it (R16)', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const stories = fake.control.data.stories['3001'].data;
        const titles = [String(stories[0]['title']), String(stories[1]['title']), String(stories[2]['title'])];
        const tales = await projectTales(project.id);
        const byTitle = (title: string) => tales.find((t) => t.title === title) as ListedTale;
        const read = async (taleId: string) =>
          (
            await pool.query(
              `SELECT media_key AS key, document_media_key AS "inStep", draft_document AS draft, document,
                 draft_revision AS revision FROM tales WHERE id = $1`,
              [taleId],
            )
          ).rows[0] as {
            key: string;
            inStep: string;
            draft: { elements: { id: string; type: string; props: Record<string, unknown> }[] };
            document: unknown;
            revision: number;
          };
        // Every imported tale has a draft document of its media, in step; imported tales are stored
        // live (Shown, AD-6 amended), so it is published too, in a group that is Off (draft).
        for (const tale of tales) {
          const stored = await read(tale.id);
          expect(stored.inStep).toBe(stored.key);
          expect(stored.draft.elements).toEqual([
            expect.objectContaining({
              type: 'image',
              props: { mediaKey: stored.key, fit: 'contain', taleMedia: true },
            }),
          ]);
          expect(stored.document).toEqual(stored.draft);
        }

        const [untouched, removed, picked] = titles.map((t) => byTitle(t).id);
        // A person removes the media element of one tale and picks other media for another.
        const removedDraft = await read(removed);
        const text = {
          id: '00000000-0000-4000-8000-0000000000e2',
          type: 'text',
          box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { text: 'Mine' },
        };
        const save = (taleId: string, document: unknown, revision: number) =>
          fetch(`${base}/tales/${taleId}/document`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document, revision }),
          });
        expect((await save(removed, { ...removedDraft.draft, elements: [text] }, removedDraft.revision)).status).toBe(
          200,
        );
        const pickedDraft = await read(picked);
        const otherKey = (await read(untouched)).key;
        const pickedDocument = {
          ...pickedDraft.draft,
          // Tale Studio's replace drops the mark: other media is not the tale's own (R16).
          elements: [{ ...pickedDraft.draft.elements[0], props: { mediaKey: otherKey, fit: 'contain' } }],
        };
        expect((await save(picked, pickedDocument, pickedDraft.revision)).status).toBe(200);

        // The source now points each of the three at other media.
        const urls = stories.slice(0, 3).map((s) => s['media']);
        stories[0]['media'] = urls[1];
        stories[1]['media'] = urls[2];
        stories[2]['media'] = urls[0];
        const again = await importOnce(project.id);
        expect(again['status']).toBe('done');

        const after = await Promise.all([untouched, removed, picked].map(read));
        // Each tale's media was the import's, so it is replaced, and the tale is in step.
        after.forEach((stored, i) => {
          expect(stored.key).not.toBe([otherKey, removedDraft.key, pickedDraft.key][i]);
          expect(stored.inStep).toBe(stored.key);
        });
        // The untouched tale's media element follows; the person's edits stay as they were.
        expect(after[0].draft.elements[0].props['mediaKey']).toBe(after[0].key);
        expect(after[1].draft.elements).toEqual([text]);
        expect(after[2].draft.elements[0].props['mediaKey']).toBe(otherKey);
      });

      it('re-imports a tale out of step in full: never migrated, written by an older instance, or too full (R16)', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const stories = fake.control.data.stories['3001'].data;
        const titles = [0, 1, 2].map((i) => String(stories[i]['title']));
        const tales = await projectTales(project.id);
        const [never, older, crowded] = titles.map((t) => (tales.find((x) => x.title === t) as ListedTale).id);
        const text = (n: number) => ({
          id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          type: 'text',
          box: { x: 0.1, y: 0.2, w: 0.8, h: 0.1, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { text: `T${n}` },
        });
        const doc = (elements: unknown[]) => ({
          version: 1,
          canvas: { background: { type: 'color', color: '#000000' } },
          elements,
        });
        // A tale whose documents never held its media (a studio document from before the migration).
        await pool.query('UPDATE tales SET draft_document = $2::jsonb, document_media_key = NULL WHERE id = $1', [
          never,
          JSON.stringify(doc([text(1)])),
        ]);
        // A tale whose media an older instance replaced without its documents: they show the key before.
        await pool.query(
          `UPDATE tales SET document_media_key = 'tales/before-0a.jpg',
             draft_document = jsonb_set(draft_document, '{elements,0,props,mediaKey}', '"tales/before-0a.jpg"')
           WHERE id = $1`,
          [older],
        );
        // A tale whose document has no room for its media.
        await pool.query('UPDATE tales SET draft_document = $2::jsonb, document_media_key = NULL WHERE id = $1', [
          crowded,
          JSON.stringify(doc(Array.from({ length: 60 }, (_, i) => text(i + 10)))),
        ]);
        const urls = stories.slice(0, 3).map((s) => s['media']);
        stories[0]['media'] = urls[1];
        stories[1]['media'] = urls[2];
        stories[2]['media'] = urls[0];
        expect((await importOnce(project.id))['status']).toBe('done');
        const read = async (taleId: string) =>
          (
            await pool.query(
              `SELECT media_key AS key, document_media_key AS "inStep", draft_document AS draft,
                 document_media_skip_reason AS reason FROM tales WHERE id = $1`,
              [taleId],
            )
          ).rows[0] as {
            key: string;
            inStep: string | null;
            draft: { elements: { type: string; props: Record<string, unknown> }[] };
            reason: string | null;
          };
        const [n, o, c] = await Promise.all([never, older, crowded].map(read));
        // Merged in full: the media goes in at the bottom, or replaces what the older instance left.
        expect(n.inStep).toBe(n.key);
        expect(n.draft.elements.map((e) => e.props['mediaKey'] ?? e.type)).toEqual([n.key, 'text']);
        expect(o.inStep).toBe(o.key);
        expect(o.draft.elements[0].props['mediaKey']).toBe(o.key);
        // No room: left out of step for that reason, its media composed in on delivery.
        expect([c.inStep, c.reason, c.draft.elements.length]).toEqual([null, 'limits', 60]);
      });

      it('sweeps old imported files nothing references, and keeps everything else', async () => {
        const project = await createProject();
        startWorker();
        await importOnce(project.id);
        const storage = new LocalDiskStorage(mediaDir);
        const referenced = (await pool.query('SELECT media_key FROM tales WHERE project_id = $1 LIMIT 1', [project.id]))
          .rows[0].media_key as string;
        const orphan = `${IMPORTED_MEDIA_PREFIX}${randomUUID()}.jpg`;
        const young = `${IMPORTED_MEDIA_PREFIX}${randomUUID()}.jpg`;
        const upload = `tales/${randomUUID()}.jpg`;
        for (const key of [orphan, young, upload]) await storage.put(key, Buffer.from('x'));
        const dir = join(mediaDir, 'tales');
        writeFileSync(join(dir, 'stale.jpg.1234.tmp'), 'x');
        const old = (Date.now() - 2 * MEDIA_SWEEP_MIN_AGE_MS) / 1000;
        for (const name of [
          referenced.slice('tales/'.length),
          orphan.slice('tales/'.length),
          upload.slice('tales/'.length),
          'stale.jpg.1234.tmp',
        ]) {
          utimesSync(join(dir, name), old, old);
        }
        const swept = await sweepImportedMedia(pool, storage);
        expect(swept.temporary).toBeGreaterThanOrEqual(1);
        expect(await storage.get(orphan)).toBeNull();
        expect(existsSync(join(dir, 'stale.jpg.1234.tmp'))).toBe(false);
        expect(await storage.get(referenced)).not.toBeNull();
        expect(await storage.get(young)).not.toBeNull();
        expect(await storage.get(upload)).not.toBeNull();
      });

      it('fails the job, with the generic message, when the storage port fails', async () => {
        const project = await createProject();
        const storage = new LocalDiskStorage(mediaDir);
        vi.spyOn(storage, 'putStream').mockRejectedValue(new Error('disk full'));
        const log = vi.fn();
        workers.push(
          startImportWorker(pool, {
            storage,
            mediaPolicy: workerMedia().mediaPolicy,
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
            log,
          }),
        );
        const job = await importOnce(project.id);
        expect(job['status']).toBe('failed');
        expect(job['error']).toBe('The import stopped on an internal error. Try again.');
        expect(log).toHaveBeenCalledWith(
          'error',
          expect.stringMatching(/failed$/),
          expect.objectContaining({ message: 'disk full' }),
        );
      });
    });

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
      await pool.query('DELETE FROM tale_group_tags WHERE tale_group_id = $1', [groupId]);
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

    it('does not let a stale runner overwrite a job another worker took over', async () => {
      const project = await createProject();
      const id = await runningJob(project.id, 'new-worker', 'now()');
      await runImportJob(
        pool,
        { id, projectId: project.id, sourceAppId: '1001', tokenCiphertext: encryptToken(FAKE_STORYLY_TOKEN, tokenKey), lockedBy: 'stale-worker' },
        { ...workerMedia(), tokenKey, storylyApiUrl: fake.url },
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

    describe('throughput: retries, concurrency and restarts (story 10)', () => {
      // A small Scale shop: one zone, two groups of three stories, small files.
      const small = {
        instances: 1,
        groupsPerInstance: 2,
        storiesPerGroup: 3,
        media: {
          ttfbMs: [0, 0],
          bytesPerSecond: 1_000_000_000,
          videoShare: 0.5,
          imageBytes: [2_000, 4_000],
          videoBytes: [5_000, 8_000],
        },
      };
      const withoutTime = (report: unknown) => {
        const copy = { ...(report as Record<string, unknown>) };
        delete copy['elapsedSeconds'];
        return copy;
      };

      it('tries every 429, 500 and 503 again and imports every tale with its media', async () => {
        const project = await createProject();
        // Every request of the app fails once: Storyly's lists with 429 or 500, the media with 429 or 503.
        fake.control.useScale({
          ...small,
          factor: 0,
          failures: { api429: 0.5, api500: 0.5, media429: 0.5, media503: 0.5, retryAfterSeconds: 0 },
        });
        startWorker();
        const job = await importApp(project.id, '9001');
        expect(job['error']).toBeNull();
        expect(job['status']).toBe('done');
        const report = job['report'] as ImportReport;
        expect(report.tales).toEqual({ source: 6, imported: 6, skipped: 0 });
        expect(report.media).toEqual({ source: 6, imported: 6, skipped: 0 });
        expect(report.differences?.filter((d) => d.kind === 'mediaNotImported')).toEqual([]);
        expect(report.elapsedSeconds).toEqual(expect.any(Number));
        const injected = fake.control.stats.injected;
        expect(injected[429]).toBeGreaterThan(0);
        expect(injected[500]).toBeGreaterThan(0);
        expect(injected[503]).toBeGreaterThan(0);
        // Each request was answered after one failure: every list and file was read twice, no more.
        expect(fake.control.stats.mediaRequests).toBe(12);
      });

      it('stores the same report with copies at once as one at a time, with every guard and reason', async () => {
        const sequential = await createProject();
        workers.push(
          startImportWorker(pool, {
            ...workerMedia(),
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
            concurrency: { media: 1, mediaPerHost: 1, listReadAhead: 0 },
          }),
        );
        const one = await importApp(sequential.id, '1004');
        await Promise.all(workers.map((w) => w.stop()));
        workers = [];
        const concurrent = await createProject();
        startWorker();
        const many = await importApp(concurrent.id, '1004');
        expect(many['status']).toBe('done');
        expect(withoutTime(many['report'])).toEqual(withoutTime(one['report']));
        const reasons = (many['report'] as ImportReport).differences
          ?.filter((d) => d.kind === 'mediaNotImported')
          .map((d) => d.reason);
        expect(reasons).toContain('blockedAddress');
        expect(reasons).toContain('tooManyRedirects');
        // The Demo shop too, with its labels and differences.
        const demoOne = await createProject();
        workers.push(
          startImportWorker(pool, {
            ...workerMedia(),
            tokenKey,
            storylyApiUrl: fake.url,
            pollIntervalMs: 50,
            workerId: 'sequential',
            concurrency: { media: 1, mediaPerHost: 1, listReadAhead: 0 },
          }),
        );
        const demoSequential = await importApp(demoOne.id, '1001');
        await Promise.all(workers.map((w) => w.stop()));
        workers = [];
        const demoMany = await createProject();
        startWorker();
        expect(withoutTime((await importApp(demoMany.id, '1001'))['report'])).toEqual(
          withoutTime(demoSequential['report']),
        );
      });

      it('keeps at most six downloads open against one media host', async () => {
        const project = await createProject();
        fake.control.useScale({
          ...small,
          groupsPerInstance: 4,
          storiesPerGroup: 5,
          factor: 1,
          failures: false,
          api: { latencyMs: [0, 0] },
          media: { ...small.media, ttfbMs: [30, 30] },
        });
        startWorker();
        const job = await importApp(project.id, '9001');
        expect(job['status']).toBe('done');
        expect(fake.control.stats.maxMediaOpen).toBeGreaterThan(1);
        expect(fake.control.stats.maxMediaOpen).toBeLessThanOrEqual(6);
      });

      it('sizes the pool from DATABASE_POOL_MAX, 20 by default', () => {
        expect(databasePoolMax({ DATABASE_POOL_MAX: '7' })).toBe(7);
        expect(databasePoolMax({})).toBe(20);
        expect(databasePoolMax({ DATABASE_POOL_MAX: 'many' })).toBe(20);
      });

      it('keeps answering progress polls while eight copies hold database connections, on a small pool', async () => {
        // A pool of 8 (DATABASE_POOL_MAX=8) shared by the API and the worker, as in main.ts.
        const tight = createPool(testDatabaseUrl, databasePoolMax({ DATABASE_POOL_MAX: '8' }));
        // The worker's database: each copy's first media read holds its connection for 2.5 s (a slow database). Without
        // the limit, eight such reads would hold every connection of the pool and the polls would wait.
        const slow = async (sql: string) => {
          if (/SELECT media_key AS key/.test(sql)) await new Promise((resolve) => setTimeout(resolve, 2500));
        };
        const workerDb = {
          query: async (sql: string, params?: unknown[]) => {
            const client = await tight.connect();
            try {
              await slow(sql);
              return await client.query(sql, params);
            } finally {
              client.release();
            }
          },
          connect: async () => {
            const client = await tight.connect();
            return {
              query: async (sql: string, params?: unknown[]) => {
                await slow(sql);
                return client.query(sql, params);
              },
              release: (err?: Error) => client.release(err),
            };
          },
        } as unknown as Pool;
        const app = createApp(
          tight,
          loadFrameTypeRegistry(frameTypesDir),
          new LocalDiskStorage(mediaDir),
          { verifier: fakeVerifier },
          { publicApiUrl },
          { tokenKey, storylyApiUrl: fake.url, wake: () => undefined },
        ).listen(0);
        await new Promise<void>((resolve) => app.once('listening', () => resolve()));
        const at = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/v1`;
        try {
          const project = await createProject();
          fake.control.useScale({
            ...small,
            groupsPerInstance: 1,
            storiesPerGroup: 8,
            factor: 0,
            failures: false,
            media: { ttfbMs: [0, 0], bytesPerSecond: 1_000_000_000, videoShare: 0, imageBytes: [2_000, 4_000] },
          });
          workers.push(
            startImportWorker(workerDb, {
              ...workerMedia(),
              tokenKey,
              storylyApiUrl: fake.url,
              pollIntervalMs: 50,
              dbConcurrency: 8 - 6,
            }),
          );
          const res = await send(
            'POST',
            `/projects/${project.id}/imports`,
            { token: FAKE_STORYLY_TOKEN, appId: '9001' },
            at,
          );
          const { id } = (await res.json()) as { id: string };
          const took: number[] = [];
          for (const until = Date.now() + 30_000; ; ) {
            const started = Date.now();
            const job = await (await send('GET', `/projects/${project.id}/imports/${id}`, undefined, at)).json();
            took.push(Date.now() - started);
            if (job.status !== 'queued' && job.status !== 'running') {
              expect(job.status).toBe('done');
              break;
            }
            if (Date.now() > until) throw new Error(`Import still ${job.status}`);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          expect(took.length).toBeGreaterThan(3);
          expect(Math.max(...took)).toBeLessThan(2000);
        } finally {
          await Promise.all(workers.map((w) => w.stop()));
          workers = [];
          await new Promise<void>((resolve) => app.close(() => resolve()));
          await tight.end();
        }
      }, 60_000);

      it('resumes a job whose worker stopped mid-run, creating nothing twice and copying no media again', async () => {
        const project = await createProject();
        fake.control.useScale({ ...small, storiesPerGroup: 4, factor: 0, failures: false });
        // The second group's stories are held: the first run stops there, with the first group done.
        let release: () => void = () => undefined;
        fake.control.hold = {
          matches: (url: URL) => url.pathname.endsWith('/story') && url.searchParams.get('story_group_id') === '910001',
          until: new Promise<void>((resolve) => {
            release = resolve;
          }),
        };
        const { rows } = await pool.query(
          `INSERT INTO import_jobs (project_id, source_app_id, token_ciphertext) VALUES ($1, '9001', $2) RETURNING id`,
          [project.id, encryptToken(FAKE_STORYLY_TOKEN, tokenKey)],
        );
        const id = rows[0].id as string;
        const claimed = await claimNextJob(pool, 'first-worker');
        expect(claimed?.id).toBe(id);
        const options = { ...workerMedia(), tokenKey, storylyApiUrl: fake.url, heartbeatMs: 20 };
        const first = runImportJob(pool, claimed as NonNullable<typeof claimed>, options);
        const copied = async () =>
          Number(
            (await pool.query('SELECT count(*) FROM import_media WHERE project_id = $1', [project.id])).rows[0].count,
          );
        for (const until = Date.now() + 10_000; (await copied()) < 4; ) {
          if (Date.now() > until) throw new Error('The first group was not imported');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        // The first worker "dies": another takes the job over, and the first one's heartbeat finds out and stops.
        await pool.query(
          "UPDATE import_jobs SET locked_by = 'gone', heartbeat_at = now() - interval '1 hour' WHERE id = $1",
          [id],
        );
        await first;
        release();
        const halfway = await contentCounts(project.id);
        expect(halfway).toEqual({ groups: 1, placements: 1, tales: 4, links: 6 });
        const copiedBefore = Number(
          (await pool.query('SELECT count(*) FROM import_media WHERE project_id = $1', [project.id])).rows[0].count,
        );

        // The stale job is queued again and the next worker runs it to the end.
        expect(await recoverStaleJobs(pool, 60_000, 3)).toEqual({ requeued: 1, failed: 0 });
        // Counted as they arrive: an answer the first run gave up on still counts on the fake's side later.
        const requestsBefore = fake.control.requests.length;
        startWorker('second-worker');
        const job = await waitForEnd(project.id, id);
        expect(job['status']).toBe('done');
        const report = job['report'] as ImportReport;
        expect(report.tales).toEqual({ source: 8, imported: 8, skipped: 0 });
        expect(report.media).toEqual({ source: 8, imported: 8, skipped: 0 });
        expect(report.changes?.tales.created).toBe(8 - halfway.tales);
        expect(report.changes?.tales.unchanged).toBe(halfway.tales);
        expect(await contentCounts(project.id)).toEqual({ groups: 2, placements: 2, tales: 8, links: 11 });
        // Media the first run copied is not downloaded again.
        const fetched = fake.control.requests.slice(requestsBefore).filter((r) => r.path.startsWith('/media/'));
        expect(fetched).toHaveLength(8 - copiedBefore);
        // The elapsed time covers both runs, from the first claim.
        const { rows: times } = await pool.query(
          'SELECT extract(epoch FROM finished_at - first_started_at) AS seconds FROM import_jobs WHERE id = $1',
          [id],
        );
        expect(report.elapsedSeconds).toBe(Math.round(Number(times[0].seconds)));
      });
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
      await pool.query(
        'TRUNCATE import_records, import_media, import_links, import_jobs, site_keys, zone_keys, invitations, project_members, auth_challenges, sessions, passkeys, users',
      );
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
