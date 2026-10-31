import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addProjectMember,
  createApiToken,
  createSession,
  createUser,
  decryptSecret,
  hashPassword,
  PasskeyFailedError,
  type PasskeyVerifier,
  type TransactionalDb,
} from '@taleart/server-access';
import {
  contactLikeWarning,
  DEFAULT_THEME,
  encodeExternalUserIdHeader,
  EXTERNAL_USER_ID_HEADER,
  MAX_TALE_GROUPS_PER_PROJECT,
  reportContactCounts,
  VISIBILITY_REASON_CODES,
} from '@taleart/contract';
import { createInvitation, createProject, encryptSecret } from '@taleart/server-access';
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import type { RateLimitOptions } from './http/rate-limit';
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
  copyTaleGroup,
  copyZonePlacements,
  migrateTaleMediaDocuments,
  setTestElementTypesEnabled,
  sweepUnusedProjectMediaFiles,
  sweepUnusedTaleMediaFiles,
  taleExists,
  TALE_MEDIA_SWEEP_MIN_AGE_MS,
} from '@taleart/server-tales';
import {
  addUserListIds,
  copyTaleGroupTags,
  copyTaleGroupUserLists,
  createUserList,
  deleteUserList,
  ensureTags,
  setTaleGroupUserLists,
} from '@taleart/server-targeting';
import {
  createZoneFromTemplate,
  foldStagesIntoZones,
  InvalidFrameSettingsError,
  loadFrameTypeRegistry,
  type FrameTypeRegistry,
} from '@taleart/server-zones';
import { purgeAnalyticsEvents, visitorHash } from '@taleart/server-analytics';
import type { Pool, PoolClient } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { createApp, type AppAuth, type ProjectMediaOptions, type UserListOptions } from './app';
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

// The one sign-in method a fresh install offers (sign-in methods epic): the passkey.
const PASSKEY_METHOD = { id: 'passkey', label: 'Passkey', kind: 'passkey' };

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

  // The raw site key these tests last issued for each project, by project id. Zone keys are gone
  // (UX rework story 8.7): a zone is placed only with its project's site key and its slug, so placing
  // a second zone of a project reuses the key, since issuing again would rotate it.
  const issuedSiteKeys = new Map<string, string>();

  // Installs the zone as a host page needs it: a display, then its project's site key (R7). Returns
  // the zone's delivery handle, `<site key>|<slug>`, which deliverZone reads.
  async function installZone(zoneId: string): Promise<string> {
    await withDisplay(zoneId);
    const { rows } = await pool.query<{ projectId: string; slug: string }>(
      'SELECT project_id AS "projectId", slug FROM zones WHERE id = $1',
      [zoneId],
    );
    const { projectId, slug } = rows[0];
    let key = issuedSiteKeys.get(projectId);
    const info = (await (await fetch(`${base}/projects/${projectId}/site-key`)).json()) as { prefix: string } | null;
    if (!key || !info || !key.startsWith(info.prefix)) {
      const res = await post(`/projects/${projectId}/site-key`, {});
      expect(res.status).toBe(201);
      key = (await res.json()).key as string;
      issuedSiteKeys.set(projectId, key);
    }
    return `${key}|${slug}`;
  }

  // Reads a zone from the Delivery API by its handle (see installZone), as the Web SDK does: the
  // site key as a bearer token and the slug as `?zone=`. Without a handle, no key and no slug are sent.
  function deliverZone(handle?: string, headers: Record<string, string> = {}): Promise<Response> {
    const all: Record<string, string> = { ...headers };
    if (handle === undefined) return globalThis.fetch(`${origin}/delivery/v1/zone`, { headers: all });
    const [key, slug = ''] = handle.split('|');
    all['Authorization'] = `Bearer ${key}`;
    return globalThis.fetch(`${origin}/delivery/v1/zone?zone=${encodeURIComponent(slug)}`, { headers: all });
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

  // Ends a session with pg_terminate_backend, as a database restart or failover would (UX rework
  // story 8.24). Only a backend of this test database is ever ended, never the caller's own.
  async function terminateBackend(pid: number): Promise<void> {
    const { rows } = await pool.query<{ ended: boolean }>(
      `SELECT pg_terminate_backend(pid) AS ended FROM pg_stat_activity
       WHERE pid = $1 AND datname = current_database() AND pid <> pg_backend_pid()`,
      [pid],
    );
    expect(rows).toEqual([{ ended: true }]);
  }

  // Waits, up to 4 s (well under the timeouts of the tests that call it), for a backend of this
  // test database that `match` picks from pg_stat_activity (with `blocked_by`, the pids blocking
  // it), and returns its pid.
  async function waitForBackend(match: string, params: unknown[] = []): Promise<number> {
    const until = Date.now() + 4_000;
    for (;;) {
      const { rows } = await pool.query<{ pid: number }>(
        `SELECT pid FROM (SELECT *, pg_blocking_pids(pid) AS blocked_by FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()) a WHERE ${match} LIMIT 1`,
        params,
      );
      if (rows[0]) return rows[0].pid;
      if (Date.now() > until) throw new Error(`No backend where ${match}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  // The pid of the session `client` runs on.
  async function backendPid(client: PoolClient): Promise<number> {
    return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    server = await listen(pool);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE tale_group_audiences, tale_group_audience_holds, tale_group_user_lists, user_list_ids, user_lists, user_list_secrets, interactive_responses, analytics_events, site_keys, tale_group_tag_matches, tale_group_tags, tags, tale_fonts, project_fonts, tale_media, project_media, tales, zone_tale_groups, tale_groups, frames, project_themes, zone_keys, zones, api_token_projects, api_tokens, project_audit_log, invitations, project_members, projects, auth_challenges, sessions, passkeys, user_identities, user_passwords, password_resets, auth_providers, auth_settings, users',
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

  describe('the OpenAPI document (epic developer experience 10.2)', () => {
    const generated = JSON.parse(
      readFileSync(join(__dirname, '../../../libs/contract/src/generated/openapi.json'), 'utf8'),
    ) as { paths: Record<string, unknown>; tags: unknown[] };

    it('serves the generated document at /api/openapi.json without credentials, cacheable', async () => {
      const res = await globalThis.fetch(`${origin}/api/openapi.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
      const body = await res.json();
      expect(body).toEqual(generated);
      // Every path of openapi.yaml, read from the YAML text itself.
      const yaml = readFileSync(join(__dirname, '../../../libs/contract/openapi/openapi.yaml'), 'utf8');
      const yamlPaths = [...yaml.slice(yaml.indexOf('\npaths:\n'), yaml.indexOf('\ncomponents:\n')).matchAll(/^ {2}(\/\S*):$/gm)];
      expect(Object.keys(body.paths).sort()).toEqual(yamlPaths.map((m) => m[1]).sort());
    });

    it('answers the same with any credential, and 304 for its ETag', async () => {
      const plain = await globalThis.fetch(`${origin}/api/openapi.json`);
      const etag = plain.headers.get('etag') as string;
      const withCredentials = await globalThis.fetch(`${origin}/api/openapi.json`, {
        headers: { Authorization: 'Bearer tat_not-a-token', Cookie: 'taleart_session=nope' },
      });
      expect(withCredentials.status).toBe(200);
      expect(withCredentials.headers.get('etag')).toBe(etag);
      expect(await withCredentials.text()).toBe(await plain.text());
      const again = await globalThis.fetch(`${origin}/api/openapi.json`, { headers: { 'If-None-Match': etag } });
      expect(again.status).toBe(304);
      expect(again.headers.get('etag')).toBe(etag);
      expect(again.headers.get('cache-control')).toBe('public, max-age=300');
      const weak = await globalThis.fetch(`${origin}/api/openapi.json`, { headers: { 'If-None-Match': `W/${etag}` } });
      expect(weak.status).toBe(304);
      const stale = await globalThis.fetch(`${origin}/api/openapi.json`, { headers: { 'If-None-Match': '"other"' } });
      expect(stale.status).toBe(200);
    });

    it('serves only GET and HEAD there', async () => {
      const head = await globalThis.fetch(`${origin}/api/openapi.json`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      const posted = await globalThis.fetch(`${origin}/api/openapi.json`, { method: 'POST' });
      expect(posted.status).toBe(404);
    });
  });

  it('creates a project and lists it', async () => {
    const created = await post('/projects', { name: 'Acme' });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project).toEqual({ id: expect.any(String), name: 'Acme', role: 'admin' });

    const list = await (await fetch(`${base}/projects`)).json();
    expect(list).toEqual([{ id: project.id, name: 'Acme', role: 'admin' }]);
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
    expect(projects).toEqual([{ id: project.id, name: 'Acme', role: 'admin' }]);
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
    const barDefaults = {
      layout: 'ring',
      shape: 'circle',
      size: 'medium',
      showTitles: true,
      alignment: 'start',
      gap: 12,
    };
    const bannerDefaults = {
      variant: 'carousel',
      aspectRatio: '16:9',
      autoplay: true,
      intervalSeconds: 5,
      showDots: true,
      loop: true,
    };

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

    it('answers the install URLs to a signed-in user only (epic UX rework R13)', async () => {
      const res = await fetch(`${base}/install`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        apiUrl: publicApiUrl,
        sdkUrl: `${publicApiUrl}/sdk/v1/taleart.js`,
        // These tests run without a built SDK: nothing to pin.
        sdkPinnedUrl: null,
        sdkIntegrity: null,
        sdkBuildsKept: 1,
        testPageUrl: `${publicApiUrl}/sdk/v1/test-page`,
      });
      const anonymous = await fetch(`${base}/install`, { headers: { Cookie: 'none=1' } });
      expect(anonymous.status).toBe(401);
    });

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
        layout: expect.objectContaining({
          title: 'Layout',
          enum: ['ring', 'chip', 'poster', 'stack'],
          default: 'ring',
        }),
        shape: expect.objectContaining({ title: 'Shape', enum: ['circle', 'rounded-square'], default: 'circle' }),
        size: expect.objectContaining({ title: 'Size', enum: ['small', 'medium', 'large'], default: 'medium' }),
        showTitles: expect.objectContaining({ title: 'Show titles', type: 'boolean', default: true }),
        alignment: expect.objectContaining({ title: 'Alignment', enum: ['start', 'center'], default: 'start' }),
        gap: expect.objectContaining({ title: 'Gap', type: 'integer', minimum: 4, maximum: 24, default: 12 }),
      });
      const banner = types.find((t: { key: string }) => t.key === 'banner');
      expect(banner.schema.additionalProperties).toBe(false);
      expect(banner.schema.properties).toEqual({
        variant: expect.objectContaining({
          title: 'Variant',
          enum: ['carousel', 'coverflow', 'peek', 'deck', 'sticky', 'strip'],
          default: 'carousel',
        }),
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

  // Puts the schema back as it was before the rework (for the fold tests): no slug required, several
  // frames per zone, and the stages table as the zones module created it (epic web zones R7). The
  // zones of `projectIds` lose their slugs.
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

  // A frame of a zone in the legacy schema, where a zone could hold several.
  async function legacyFrame(zone: { id: string; projectId: string }, type: string, settings: object = {}): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      'INSERT INTO frames (zone_id, project_id, type, settings) VALUES ($1, $2, $3, $4) RETURNING id',
      [zone.id, zone.projectId, type, JSON.stringify(settings)],
    );
    return rows[0].id;
  }

  // A stage of a zone in the legacy schema, showing one of its frames.
  async function legacyStage(zone: { id: string; projectId: string }, name: string, key: string, frameId: string): Promise<void> {
    await pool.query('INSERT INTO stages (zone_id, project_id, frame_id, name, key) VALUES ($1, $2, $3, $4, $5)', [
      zone.id,
      zone.projectId,
      frameId,
      name,
      key,
    ]);
  }

  describe('stages and frames fold into zones (epic UX rework R2)', () => {
    async function snapshot(): Promise<unknown> {
      const [zones, frames, placements, keys] = await Promise.all([
        pool.query('SELECT id, project_id, name, slug, playbook_key, created_at FROM zones ORDER BY id'),
        pool.query('SELECT id, zone_id, project_id, type, settings, created_at FROM frames ORDER BY id'),
        pool.query('SELECT zone_id, tale_group_id, position FROM zone_tale_groups ORDER BY zone_id, tale_group_id'),
        pool.query('SELECT id, project_id, revoked_at FROM site_keys ORDER BY id'),
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
      const top = await (await post(`/zones/${home.id}/frame`, { type: 'bar', settings: { gap: 20 } })).json();
      // The project's site key, issued before the fold, places every folded zone by its new slug.
      await installZone(home.id);
      const siteKey = (await pool.query('SELECT prefix FROM site_keys WHERE revoked_at IS NULL')).rows[0].prefix;

      try {
        await legacySchema(project.id);
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
          (await deliverZone(key)).json();
        const homeKey = await installZone(home.id);
        expect(homeKey.startsWith(siteKey)).toBe(true);
        const homeBody = await deliver(homeKey);
        expect([homeBody.id, homeBody.slug, homeBody.frame.id, homeBody.frame.settings.gap]).toEqual([home.id, 'top-bar', top.id, 20]);
        expect(homeBody.taleGroups.map((g: { id: string }) => g.id)).toEqual(homeGroups);
        for (const zone of zones.slice(1, 5)) {
          // The same site key, with the new zone's slug.
          const key = await installZone(zone.id);
          expect(key.startsWith(siteKey)).toBe(true);
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
        await legacySchema(project.id);
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
        await legacyFrame(home, 'bar');
        await legacyFrame(home, 'banner');
        const top = await legacyFrame(shop, 'bar');
        const hero = await legacyFrame(shop, 'banner');
        await legacyStage(shop, 'למעלה', 'Bad Key', top);
        await legacyStage(shop, 'גיבור', 'also bad', hero);
        await legacyStage(lone, 'Only stage', 'only-stage', await legacyFrame(lone, 'bar'));

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
        await legacyStage(staged, 'Top', 'home-top', await legacyFrame(staged, 'bar'));
        await legacyStage(other, 'Top', 'home-top', await legacyFrame(other, 'bar'));

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
        await legacyStage(first, 'Top', 'top', await legacyFrame(first, 'bar'));
        await legacyStage(second, 'Top', 'top', await legacyFrame(second, 'bar'));
        await legacyStage(second, 'Hero', 'top-2', await legacyFrame(second, 'banner'));

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
        const top = await legacyFrame(home, 'bar');
        await legacyStage(home, 'Top', 'top', top);
        await legacyStage(home, 'Hero', 'hero', await legacyFrame(home, 'banner'));
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
        await legacyStage(home, 'Top', 'top', await legacyFrame(home, 'bar'));
        await legacyStage(home, 'Hero', 'hero', await legacyFrame(home, 'banner'));
        await legacyFrame(home, 'bar');

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
    const barSettings = {
      layout: 'ring',
      shape: 'circle',
      size: 'medium',
      showTitles: true,
      alignment: 'start',
      gap: 12,
    };
    const bannerSettings = {
      variant: 'carousel',
      aspectRatio: '3:1',
      autoplay: true,
      intervalSeconds: 5,
      showDots: true,
      loop: true,
    };

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
      const key = await installZone(zone.id);
      const delivered = await (
        await deliverZone(key)
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
        tagMatch: 'any',
        userLists: [],
        audience: null,
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

  describe('audience rules (epic viewer properties)', () => {
    const RULE = { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] };
    const unknownId = '00000000-0000-4000-8000-000000000000';

    function putJson(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    async function createGroup(zoneId: string, name: string): Promise<{ id: string; projectId: string }> {
      return (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
    }

    // Each listed group's audience rule, keyed by group name.
    async function groupAudiences(zoneId: string): Promise<Record<string, unknown>> {
      const groups: { name: string; audience: unknown }[] = await (await fetch(`${base}/zones/${zoneId}/tale-groups`)).json();
      return Object.fromEntries(groups.map((g) => [g.name, g.audience]));
    }

    it('sets, replaces and clears the audience rule, keeps it on restart, and lists it with every group', async () => {
      const zone = await createZone();
      const first = await createGroup(zone.id, 'First');
      await createGroup(zone.id, 'Second');
      expect((await (await fetch(`${base}/tale-groups/${first.id}`)).json()).audience).toBeNull();

      const set = await putJson(`/tale-groups/${first.id}/audience`, { audience: RULE });
      expect(set.status).toBe(200);
      expect((await set.json()).audience).toEqual(RULE);
      await restart();
      expect(await groupAudiences(zone.id)).toEqual({ First: RULE, Second: null });
      const project = await (await fetch(`${base}/projects/${zone.projectId}/tale-groups`)).json();
      expect(project.map((g: { audience: unknown }) => g.audience)).toEqual([RULE, null]);

      const replacement = { match: 'any', conditions: [{ property: 'segment', operator: 'in', value: ['a', 'b'] }] };
      expect((await (await putJson(`/tale-groups/${first.id}/audience`, { audience: replacement })).json()).audience).toEqual(
        replacement,
      );
      expect(await groupAudiences(zone.id)).toEqual({ First: replacement, Second: null });

      const cleared = await putJson(`/tale-groups/${first.id}/audience`, { audience: null });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).audience).toBeNull();
      expect(await groupAudiences(zone.id)).toEqual({ First: null, Second: null });
      expect((await pool.query('SELECT 1 FROM tale_group_audiences')).rowCount).toBe(0);
    });

    it('refuses a rule that breaks the contract with 400 validation_failed and its reason, and changes nothing', async () => {
      const zone = await createZone();
      const group = await createGroup(zone.id, 'First');
      const cases: [unknown, RegExp][] = [
        [{ audience: { match: 'every', conditions: [{ property: 'plan', operator: 'exists' }] } }, /match must be "all" or "any"/],
        [{ audience: { match: 'all', conditions: [] } }, /1 to 10 conditions/],
        [{ audience: { match: 'all', conditions: [{ property: 'plan', operator: 'gt', value: '3' }] } }, /gt needs a number/],
        [{ audience: { match: 'all', conditions: [{ property: '1plan', operator: 'exists' }] } }, /property must be/],
        [{ audience: { match: 'all', conditions: [{ property: 'plan', operator: 'matches', value: 'x' }] } }, /operator must be one of/],
        [{ audience: { match: 'all', conditions: [{ match: 'all', conditions: [] }] } }, /unknown field "match"/],
        [{ audience: 'pro' }, /audience rule is an object/],
        [{}, /audience is required/],
      ];
      for (const [body, reason] of cases) {
        const res = await putJson(`/tale-groups/${group.id}/audience`, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        const error = (await res.json()).error;
        expect(error.code).toBe('validation_failed');
        expect(error.message).toMatch(reason);
      }
      expect(await groupAudiences(zone.id)).toEqual({ First: null });
      expect((await pool.query('SELECT 1 FROM tale_group_audiences')).rowCount).toBe(0);
    });

    it('answers 404 tale_group_not_found for an unknown group', async () => {
      const res = await putJson(`/tale-groups/${unknownId}/audience`, { audience: RULE });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('tale_group_not_found');
    });

    it('copies the rule with the group, into another zone too', async () => {
      const zone = await createZone();
      const other = await createZone();
      const group = await createGroup(zone.id, 'First');
      await putJson(`/tale-groups/${group.id}/audience`, { audience: RULE });
      const copy = await post(`/tale-groups/${group.id}/copy`, { zoneId: other.id });
      expect(copy.status).toBe(201);
      const body = await copy.json();
      expect(body.audience).toEqual(RULE);
      expect((await (await fetch(`${base}/tale-groups/${body.id}`)).json()).audience).toEqual(RULE);
    });

    it('ships the rule in the Delivery zone payload for every viewer, and nothing else of the viewer', async () => {
      const zone = await createZone();
      const pro = await createGroup(zone.id, 'Pro');
      const tale = await (await post(`/tale-groups/${pro.id}/tales`, { title: 'Pro tale' })).json();
      await createGroup(zone.id, 'Everyone');
      await putJson(`/tale-groups/${pro.id}/audience`, { audience: RULE });
      await publish('tale-groups', pro.id);
      await publish('tales', tale.id);
      await asLegacy(tale.id);
      const key = await installZone(zone.id);

      const anonymous = await (await deliverZone(key)).json();
      const named = await (await deliverZone(key, { [EXTERNAL_USER_ID_HEADER]: encodeExternalUserIdHeader('viewer-1') as string })).json();
      const audiences = (body: { taleGroups: { name: string; audience: unknown }[] }) =>
        Object.fromEntries(body.taleGroups.map((g) => [g.name, g.audience]));
      expect(audiences(anonymous)).toEqual({ Pro: RULE });
      expect(audiences(named)).toEqual({ Pro: RULE });
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
        tagMatch: 'any',
        userLists: [],
        audience: null,
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

    it('stores how the tags combine, Any by default, and keeps it on reload and restart (epic targeting R1)', async () => {
      const zone = await createZone();
      const summer = await createTag(zone.projectId, 'summer');
      const vip = await createTag(zone.projectId, 'vip');
      const group = await createGroup(zone.id, 'First');
      const tagMatchOf = async () => {
        const read = await (await fetch(`${base}/tale-groups/${group.id}`)).json();
        const listed = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
        const project = await (await fetch(`${base}/projects/${zone.projectId}/tale-groups`)).json();
        return [read.tagMatch, listed[0].tagMatch, project[0].tagMatch];
      };
      expect(await tagMatchOf()).toEqual(['any', 'any', 'any']);

      const res = await put(`/tale-groups/${group.id}/tags`, { tagIds: [summer.id, vip.id], tagMatch: 'all' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tagMatch).toBe('all');
      expect(body.tags.map((t: { name: string }) => t.name)).toEqual(['summer', 'vip']);
      expect(await tagMatchOf()).toEqual(['all', 'all', 'all']);

      // Without tagMatch the group keeps its mode.
      expect((await (await put(`/tale-groups/${group.id}/tags`, { tagIds: [vip.id] })).json()).tagMatch).toBe('all');
      await restart();
      expect(await tagMatchOf()).toEqual(['all', 'all', 'all']);
      expect(await groupTags(zone.id)).toEqual({ First: ['vip'] });

      expect((await (await put(`/tale-groups/${group.id}/tags`, { tagIds: [], tagMatch: 'any' })).json()).tagMatch).toBe(
        'any',
      );
      const stored = await pool.query('SELECT tag_match, project_id FROM tale_group_tag_matches WHERE tale_group_id = $1', [
        group.id,
      ]);
      expect(stored.rows).toEqual([{ tag_match: 'any', project_id: zone.projectId }]);
    });

    it('refuses a tagMatch other than any or all with 400 validation_failed and changes nothing', async () => {
      const zone = await createZone();
      const summer = await createTag(zone.projectId, 'summer');
      const group = await createGroup(zone.id, 'First');
      for (const tagMatch of ['ALL', 'some', 1, null]) {
        const res = await put(`/tale-groups/${group.id}/tags`, { tagIds: [summer.id], tagMatch });
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      expect(await groupTags(zone.id)).toEqual({ First: [] });
      expect((await pool.query('SELECT 1 FROM tale_group_tag_matches')).rowCount).toBe(0);
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

    it('refuses to place an archived group in a new zone with 409 tale_group_archived; placed again where it is, 200', async () => {
      const { z, z2, a } = await setup();
      expect((await send('PUT', `/tale-groups/${a.id}/status`, { status: 'archived' })).status).toBe(200);
      const res = await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`);
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('tale_group_archived');
      expect(await order(z2.id)).toEqual([['C', 0]]);
      expect((await send('PUT', `/zones/${z.id}/tale-groups/${a.id}`)).status).toBe(200);
      // Restored, it can be placed.
      expect((await send('PUT', `/tale-groups/${a.id}/status`, { status: 'paused' })).status).toBe(200);
      expect((await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`)).status).toBe(201);
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
      const key = await installZone(z2.id);
      const delivered = await deliverZone(key);
      // C has no live tale, so only A is delivered.
      expect((await delivered.json()).taleGroups).toEqual([
        {
          id: a.id,
          name: 'A',
          cover: null,
          tags: ['summer'],
          tagMatch: 'any',
          audience: null,
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
        tagMatch: 'any',
        userLists: [],
        audience: null,
        // On, with a tale to show, in two zones neither of which is set up yet: each zone reason once (R7).
        visibility: notVisible(why('zone-no-display', 'zone'), why('zone-not-installed', 'zone')),
      });
      for (const zoneId of [z.id, z2.id]) {
        expect((await listed(zoneId)).find((g) => g.id === a.id)?.name).toBe('Summer sale');
      }
      const key = await installZone(z2.id);
      const delivered = await deliverZone(key);
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
          // Cover, tags and counts (epic UX rework R14), but not the tales: the zone lists carry them.
          cover: null, tags: [], tagMatch: 'any', userLists: [], audience: null, shownTaleCount: 1,
          // In no zone (R7); its one tale has nothing published either.
          visibility: notVisible(why('group-off', 'group'), why('not-in-any-zone', 'group'), why('no-shown-tales', 'group')),
        },
        { id: expect.any(String), projectId: project.id, name: 'apple', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id], cover: null, tags: [], tagMatch: 'any', userLists: [], audience: null, shownTaleCount: 0, visibility: SOME_VISIBILITY },
        { id: expect.any(String), projectId: project.id, name: 'B', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z.id], cover: null, tags: [], tagMatch: 'any', userLists: [], audience: null, shownTaleCount: 0, visibility: SOME_VISIBILITY },
        { id: c.id, projectId: project.id, name: 'C', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null, taleCount: 0, zoneIds: [z2.id], cover: null, tags: [], tagMatch: 'any', userLists: [], audience: null, shownTaleCount: 0, visibility: SOME_VISIBILITY },
      ]);
      // The orphan can be placed again.
      expect((await send('PUT', `/zones/${z2.id}/tale-groups/${a.id}`)).status).toBe(201);

      for (const id of [unknownId, 'nope']) {
        const missing = await fetch(`${base}/projects/${id}/tale-groups`);
        expect(missing.status).toBe(404);
        expect((await missing.json()).error.code).toBe('project_not_found');
      }
    });

    it('creates a tale group in no zone from the project, Off, with tags on the project list (R14)', async () => {
      const { project } = await setup();
      const res = await post(`/projects/${project.id}/tale-groups`, { name: 'Loose' });
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created).toMatchObject({
        projectId: project.id, name: 'Loose', status: 'draft', storedStatus: 'draft', startsAt: null, endsAt: null,
        cover: null, tags: [], taleCount: 0, shownTaleCount: 0, zoneIds: [],
      });
      expect(created).not.toHaveProperty('tales');
      expect(created.visibility.visible).toBe(false);
      expect(created.visibility.reasons.map((r: { code: string }) => r.code)).toContain('not-in-any-zone');

      const tag = await (await post(`/projects/${project.id}/tags`, { name: 'Promo' })).json();
      expect((await send('PUT', `/tale-groups/${created.id}/tags`, { tagIds: [tag.id] })).status).toBe(200);
      const listedGroups: { id: string; tags: { name: string }[] }[] = await (await fetch(`${base}/projects/${project.id}/tale-groups`)).json();
      expect(listedGroups.find((g) => g.id === created.id)?.tags.map((t) => t.name)).toEqual(['Promo']);

      const blank = await post(`/projects/${project.id}/tale-groups`, { name: '  ' });
      expect(blank.status).toBe(400);
      // At most 100 characters (code points), after trimming; the zone's create and rename agree.
      const long = 'é'.repeat(101);
      for (const [method, path] of [
        ['POST', `/projects/${project.id}/tale-groups`],
        ['POST', `/zones/${(await zoneIn(project.id, 'Long names')).id}/tale-groups`],
        ['PATCH', `/tale-groups/${created.id}`],
      ]) {
        const res = await send(method, path, { name: long });
        expect({ path, status: res.status }).toEqual({ path, status: 400 });
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      expect((await post(`/projects/${project.id}/tale-groups`, { name: ` ${'é'.repeat(100)} ` })).status).toBe(201);
      expect((await pool.query('SELECT 1 FROM tale_groups WHERE length(name) > 100')).rowCount).toBe(0);
      for (const id of [unknownId, 'nope']) {
        const missing = await post(`/projects/${id}/tale-groups`, { name: 'X' });
        expect(missing.status).toBe(404);
        expect((await missing.json()).error.code).toBe('project_not_found');
      }
    });

    it('reads one tale group with its tales and tags, placed in no zone or in one (story 8.19)', async () => {
      const { project, z2 } = await setup();
      const loose = await (await post(`/projects/${project.id}/tale-groups`, { name: 'Loose' })).json();
      const first = await (await post(`/tale-groups/${loose.id}/tales`, { title: 'One' })).json();
      const second = await (await post(`/tale-groups/${loose.id}/tales`, { title: 'Two' })).json();
      const tag = await (await post(`/projects/${project.id}/tags`, { name: 'Promo' })).json();
      expect((await send('PUT', `/tale-groups/${loose.id}/tags`, { tagIds: [tag.id] })).status).toBe(200);
      expect(
        (await send('PUT', `/tale-groups/${loose.id}/tales/order`, { taleIds: [second.id, first.id] })).status,
      ).toBe(200);

      const res = await fetch(`${base}/tale-groups/${loose.id}`);
      expect(res.status).toBe(200);
      const read = await res.json();
      expect(read).toMatchObject({
        id: loose.id, projectId: project.id, name: 'Loose', storedStatus: 'draft', zoneIds: [],
        tags: [{ id: tag.id, name: 'Promo' }],
      });
      expect(read.tales.map((t: { id: string; position: number }) => [t.id, t.position])).toEqual([
        [second.id, 0],
        [first.id, 1],
      ]);
      expect(read.visibility.reasons.map((r: { code: string }) => r.code)).toContain('not-in-any-zone');
      expect(read.tales[0].visibility.visible).toBe(false);

      // Placed in a zone, it lists that zone; the zone's list holds the same tales.
      expect((await send('PUT', `/zones/${z2.id}/tale-groups/${loose.id}`)).status).toBe(201);
      const placed = await (await fetch(`${base}/tale-groups/${loose.id}`)).json();
      expect(placed.zoneIds).toEqual([z2.id]);
      expect(placed.tales.map((t: { id: string }) => t.id)).toEqual([second.id, first.id]);

      // Archived, it is still read, as archived, with its tales (the Tale groups page's Archived filter opens it).
      expect((await send('PUT', `/tale-groups/${loose.id}/status`, { status: 'archived' })).status).toBe(200);
      const archived = await fetch(`${base}/tale-groups/${loose.id}`);
      expect(archived.status).toBe(200);
      const archivedBody = await archived.json();
      expect(archivedBody).toMatchObject({ id: loose.id, status: 'archived', storedStatus: 'archived' });
      expect(archivedBody.tales).toHaveLength(2);
      expect(archivedBody.visibility.visible).toBe(false);

      for (const id of [unknownId, 'nope']) {
        const missing = await fetch(`${base}/tale-groups/${id}`);
        expect(missing.status).toBe(404);
        expect((await missing.json()).error.code).toBe('tale_group_not_found');
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
        tagMatch: 'any',
        userLists: [],
        audience: null,
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

    it('keeps the tags and All on a copy, in the same project and in another (epic targeting R1)', async () => {
      const { project, production, g, summer } = await setup();
      const vip = await (await post(`/projects/${project.id}/tags`, { name: 'vip' })).json();
      const set = await send('PUT', `/tale-groups/${g.id}/tags`, { tagIds: [summer.id, vip.id], tagMatch: 'all' });
      expect(set.status).toBe(200);

      const same: Listed & { tagMatch: string } = await (await copy(g.id, production.id)).json();
      expect([same.tags.map((t) => t.name), same.tagMatch]).toEqual([['summer', 'vip'], 'all']);
      const reread = await (await fetch(`${base}/tale-groups/${same.id}`)).json();
      expect([reread.tags.map((t: { name: string }) => t.name), reread.tagMatch]).toEqual([['summer', 'vip'], 'all']);

      const b = await createProject('Beta');
      const bZone = await zoneIn(b.id, 'Beta home');
      const other: Listed & { tagMatch: string } = await (await copy(g.id, bZone.id)).json();
      expect([other.tags.map((t) => t.name), other.tagMatch]).toEqual([['summer', 'vip'], 'all']);
      const stored = await pool.query('SELECT project_id FROM tale_group_tag_matches WHERE tale_group_id = $1', [other.id]);
      expect(stored.rows).toEqual([{ project_id: b.id }]);

      // The copy is independent: switching the source to Any leaves it All.
      await send('PUT', `/tale-groups/${g.id}/tags`, { tagIds: [summer.id], tagMatch: 'any' });
      expect((await (await fetch(`${base}/tale-groups/${same.id}`)).json()).tagMatch).toBe('all');
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
      await installZone(staging.id);
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

  describe('a project holds at most 500 tale groups that are not archived (epic UX rework R14, story 8.22)', () => {
    const FULL = `already has ${MAX_TALE_GROUPS_PER_PROJECT} tale groups that are not archived, the most it can hold.`;
    const messages = {
      create: `This project ${FULL} Archive a tale group to make room.`,
      copy: `The project of that zone ${FULL} Archive a tale group there to make room.`,
      restore: `This project ${FULL} Restoring a tale group needs a free place: archive another tale group first.`,
    };

    // Fills the project with `active` groups that are not archived (half Off, half paused) and
    // `archived` archived ones, straight in the database.
    async function fill(projectId: string, active: number, archived = 0): Promise<void> {
      await pool.query(
        `INSERT INTO tale_groups (project_id, name, status)
         SELECT $1, 'Filler ' || g, CASE WHEN g > $2::int THEN 'archived' WHEN g % 2 = 0 THEN 'paused' ELSE 'draft' END
         FROM generate_series(1, $2::int + $3::int) g`,
        [projectId, active, archived],
      );
    }

    // The project's groups that are not archived, which the cap counts.
    async function groupCount(projectId: string): Promise<number> {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM tale_groups WHERE project_id = $1 AND status <> 'archived'",
        [projectId],
      );
      return rows[0].n;
    }

    async function refused(res: Response, message = messages.create): Promise<void> {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: { code: 'tale_group_limit_reached', message } });
    }

    async function zoneIn(projectId: string, name: string): Promise<{ id: string }> {
      return (await post('/zones', { name, projectId })).json();
    }

    async function groupIn(zoneId: string, name: string): Promise<{ id: string }> {
      return (await post(`/zones/${zoneId}/tale-groups`, { name })).json();
    }

    it('refuses New tale group in a zone and in no zone, and Copy to zone, at the cap, writing nothing', async () => {
      expect(MAX_TALE_GROUPS_PER_PROJECT).toBe(500);
      const project = await createProject('Full');
      const zone = await zoneIn(project.id, 'Home');
      const source = await groupIn(zone.id, 'Source');
      await post(`/tale-groups/${source.id}/tales`, { title: 'One' });
      // 499 more that are not archived, and 20 archived ones that do not count.
      await fill(project.id, MAX_TALE_GROUPS_PER_PROJECT - 1, 20);
      expect(await groupCount(project.id)).toBe(500);
      const totals = async () =>
        (
          await pool.query(
            `SELECT (SELECT count(*) FROM tale_groups)::int AS groups, (SELECT count(*) FROM zone_tale_groups)::int AS placements,
                    (SELECT count(*) FROM tales)::int AS tales`,
          )
        ).rows[0];
      const before = await totals();

      await refused(await post(`/zones/${zone.id}/tale-groups`, { name: 'In a zone' }));
      await refused(await post(`/projects/${project.id}/tale-groups`, { name: 'In no zone' }));
      await refused(await post(`/tale-groups/${source.id}/copy`, { zoneId: zone.id }), messages.copy);

      expect(await totals()).toEqual(before);
    });

    it('does not count archived groups: archiving frees a place, and a restore needs one', async () => {
      const project = await createProject('Nearly');
      const zone = await zoneIn(project.id, 'Home');
      const a = await groupIn(zone.id, 'A');
      // A and 498 more not archived, 30 archived: one place is free.
      await fill(project.id, MAX_TALE_GROUPS_PER_PROJECT - 2, 30);
      expect((await post(`/projects/${project.id}/tale-groups`, { name: 'Last' })).status).toBe(201);
      await refused(await post(`/projects/${project.id}/tale-groups`, { name: 'One too many' }));

      // Archiving A frees its place, and a new group takes it.
      expect((await setStatus('tale-groups', a.id, 'archived')).status).toBe(200);
      expect((await post(`/zones/${zone.id}/tale-groups`, { name: 'In its place' })).status).toBe(201);

      // Restoring A now has no place: refused, and A stays archived.
      await refused(await setStatus('tale-groups', a.id, 'paused'), messages.restore);
      const status = async (id: string) =>
        (await pool.query('SELECT status FROM tale_groups WHERE id = $1', [id])).rows[0].status;
      expect(await status(a.id)).toBe('archived');
      // Archive another group: then A can come back.
      const { rows } = await pool.query("SELECT id FROM tale_groups WHERE project_id = $1 AND name = 'Filler 1'", [
        project.id,
      ]);
      expect((await setStatus('tale-groups', rows[0].id, 'archived')).status).toBe(200);
      expect((await setStatus('tale-groups', a.id, 'paused')).status).toBe(200);
      expect(await status(a.id)).toBe('paused');
      expect(await groupCount(project.id)).toBe(MAX_TALE_GROUPS_PER_PROJECT);
      // Publishing and pausing a group that is not archived are not refused at the cap.
      expect((await setStatus('tale-groups', a.id, 'live')).status).toBe(200);
      expect((await setStatus('tale-groups', a.id, 'paused')).status).toBe(200);
    });

    it('counts a copy against the target project: from a full project into one with room, and the reverse', async () => {
      const full = await createProject('Full');
      const fullZone = await zoneIn(full.id, 'Home');
      const fullGroup = await groupIn(fullZone.id, 'G');
      await fill(full.id, MAX_TALE_GROUPS_PER_PROJECT - 1);
      const roomy = await createProject('Roomy');
      const roomyZone = await zoneIn(roomy.id, 'Home');
      const roomyGroup = await groupIn(roomyZone.id, 'H');

      expect((await post(`/tale-groups/${fullGroup.id}/copy`, { zoneId: roomyZone.id })).status).toBe(201);
      await refused(await post(`/tale-groups/${roomyGroup.id}/copy`, { zoneId: fullZone.id }), messages.copy);
      expect([await groupCount(full.id), await groupCount(roomy.id)]).toEqual([500, 2]);
    });

    it('never goes over the cap under concurrent creates, copies and restores', async () => {
      const project = await createProject('Busy');
      const zoneA = await zoneIn(project.id, 'A');
      const zoneB = await zoneIn(project.id, 'B');
      const source = await groupIn(zoneA.id, 'Source');
      // Another project's group, copied in: it counts against this project.
      const other = await createProject('Other');
      const foreign = await groupIn((await zoneIn(other.id, 'O')).id, 'F');
      // Source and 496 more not archived (3 places), and 3 archived groups to restore.
      await fill(project.id, MAX_TALE_GROUPS_PER_PROJECT - 4, 3);
      const archived = (
        await pool.query("SELECT id FROM tale_groups WHERE project_id = $1 AND status = 'archived'", [project.id])
      ).rows.map((r) => r.id as string);
      const requests = Array.from({ length: 15 }, (_, i) => {
        switch (i % 5) {
          case 0:
            return post(`/zones/${zoneA.id}/tale-groups`, { name: `A${i}` });
          case 1:
            return post(`/zones/${zoneB.id}/tale-groups`, { name: `B${i}` });
          case 2:
            return post(`/projects/${project.id}/tale-groups`, { name: `P${i}` });
          case 3:
            return post(`/tale-groups/${i % 2 ? source.id : foreign.id}/copy`, { zoneId: zoneB.id });
          default:
            return setStatus('tale-groups', archived[(i - 4) / 5], 'paused');
        }
      });
      const statuses = (await Promise.all(requests)).map((r) => r.status);
      expect(statuses.filter((s) => s === 200 || s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(12);
      expect(await groupCount(project.id)).toBe(MAX_TALE_GROUPS_PER_PROJECT);
      expect(await groupCount(other.id)).toBe(1);
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
      await expectRefused(doc([text(1), { ...text(2), type: 'future-widget' }]), '/elements/1/type');
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
        const refused = await keep(tale.id, { document: doc([text(1), { ...text(2), type: 'future-widget' }]) });
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
      const key = await installZone(group.zoneId);
      return { id: group.id, zoneId: group.zoneId, taleId: tale.id, key };
    }

    async function deliveredGroups(key: string): Promise<{ id: string; cover: { url: string } | null }[]> {
      const res = await deliverZone(key);
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
        role: 'editor',
        accessExpiresAt: null,
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
      expect(await res.json()).toEqual({ projectName: 'Acme', expiresAt, role: 'editor', accessExpiresAt: null });

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

      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user, methods: [PASSKEY_METHOD] });
      expect(await (await send('GET', '/projects')).json()).toEqual([{ ...a.project, role: 'editor' }]);
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

    it('lets a content manager read a tale group in no zone of their project, not of another (story 8.19)', async () => {
      const { a, b } = await twoProjects();
      const mine = await (await post(`/projects/${a.project.id}/tale-groups`, { name: 'Loose' })).json();
      const theirs = await (await post(`/projects/${b.project.id}/tale-groups`, { name: 'Loose' })).json();
      await signInAsContentManager([a.project.id]);
      const read = await send('GET', `/tale-groups/${mine.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ id: mine.id, zoneIds: [], tales: [] });
      for (const id of [theirs.id, b.group.id]) {
        const refused = await send('GET', `/tale-groups/${id}`);
        expect(refused.status).toBe(403);
        expect((await refused.json()).error.code).toBe('forbidden');
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
        ['POST', `/projects/${b.project.id}/tale-groups`, { name: 'Mine' }],
        ['GET', `/tale-groups/${b.group.id}`],
        ['PATCH', `/tale-groups/${b.group.id}`, { name: 'Mine' }],
        ['PUT', `/tale-groups/${b.group.id}/status`, { status: 'live' }],
        ['PUT', `/tales/${b.tale.id}/status`, { status: 'paused' }],
        ['GET', `/projects/${b.project.id}/tags`],
        ['POST', `/projects/${b.project.id}/tags`, { name: 'Mine' }],
        ['GET', `/tales/${b.tale.id}/media`],
        ['DELETE', `/tales/${b.tale.id}`],
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
      // Neither the zone's create nor the project's (R14) made a group.
      expect((await pool.query('SELECT 1 FROM tale_groups WHERE name = $1', ['Mine'])).rowCount).toBe(0);
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
      expect((await send('DELETE', `/tales/${a.tale.id}`)).status).toBe(204);

      expect((await send('POST', `/zones/${unknownId}/frame`, { type: 'bar' })).status).toBe(404);
      expect((await send('DELETE', `/tales/${unknownId}`)).status).toBe(404);
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
      [{ colorScheme: 'sepia' }, 'theme.colorScheme must be one of: auto, light, dark'],
      [{ liveColor: 'red' }, 'theme.liveColor must be a colour as #rrggbb, or null for the last ring colour'],
      [{ successColor: null }, 'theme.successColor must be a colour as #rrggbb'],
      [{ errorColor: '#fff' }, 'theme.errorColor must be a colour as #rrggbb'],
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

    it('stores the colour scheme, the live colour and the quiz colours, and answers them resolved', async () => {
      const project = await createProject();
      const settings = { colorScheme: 'dark', liveColor: '#00ff00', successColor: '#0a7d4f', errorColor: '#c00000' };
      const saved = await putTheme(project.id, settings);
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ projectId: project.id, theme: settings, resolved: { ...DEFAULT_THEME, ...settings } });
      // A theme stored before the fields existed reads back with their defaults.
      await pool.query(`UPDATE project_themes SET theme = '{"ringStyle":"solid"}' WHERE project_id = $1`, [project.id]);
      expect(await (await getTheme(project.id)).json()).toEqual({
        projectId: project.id,
        theme: { ringStyle: 'solid' },
        resolved: { ...DEFAULT_THEME, ringStyle: 'solid' },
      });
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

  describe('the Delivery API', () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const bannerDefaults = {
      variant: 'carousel',
      aspectRatio: '16:9',
      autoplay: true,
      intervalSeconds: 5,
      showDots: true,
      loop: true,
    };

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

    // A zone by its delivery handle (`<site key>|<slug>`, see installZone); without one, no key.
    function deliver(key?: string, headers: Record<string, string> = {}): Promise<Response> {
      return deliverZone(key, headers);
    }

    // Installs the zone with its project's site key; `key` is the zone's delivery handle.
    async function issue(zoneId: string): Promise<{ key: string }> {
      return { key: await installZone(zoneId) };
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
      expect(body.error.code).toBe('invalid_site_key');
      return body.error.message;
    }

    // Issues the zone's key as an admin does (FR-003): shown once, in this response.
    async function issueZoneKey(zoneId: string): Promise<{ key: string; prefix: string; createdAt: string }> {
      const res = await send('POST', `/zones/${zoneId}/key`);
      expect(res.status).toBe(201);
      return res.json();
    }

    // A zone's key on the Delivery API: the key alone names the zone, with no slug.
    function deliverWithZoneKey(key: string, query = ''): Promise<Response> {
      return globalThis.fetch(`${origin}/delivery/v1/zone${query}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    }

    it('serves the zone to its zone key alone, and ignores a slug that names another zone', async () => {
      const zone = await createZone();
      const other = await createZone();
      const { key } = await issueZoneKey(zone.id);
      expect(key).toMatch(/^tak_[A-Za-z0-9_-]{43}$/);

      const res = await deliverWithZoneKey(key);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect((await res.json()).id).toBe(zone.id);

      // A slug is not read with a zone key: the key's zone answers, whichever slug is named.
      for (const query of [`?zone=${other.slug}`, '?zone=nope', '?zone=']) {
        const withSlug = await deliverWithZoneKey(key, query);
        expect(withSlug.status).toBe(200);
        expect((await withSlug.json()).id).toBe(zone.id);
      }
      expect((await deliverWithZoneKey(key)).status).toBe(200);
    });

    it('refuses a zone key once it is rotated out or revoked, with the site key body', async () => {
      const zone = await createZone();
      const first = await issueZoneKey(zone.id);
      const second = await issueZoneKey(zone.id);
      expect(second.key).not.toBe(first.key);
      await expectInvalidKey(await deliverWithZoneKey(first.key));
      expect((await deliverWithZoneKey(second.key)).status).toBe(200);

      expect((await send('DELETE', `/zones/${zone.id}/key`)).status).toBe(204);
      await expectInvalidKey(await deliverWithZoneKey(second.key));
      await expectInvalidKey(await deliverWithZoneKey(second.key, `?zone=${zone.slug}`));
      // Revoking again: the zone has no active key any more.
      const again = await send('DELETE', `/zones/${zone.id}/key`);
      expect(again.status).toBe(404);
      expect((await again.json()).error.code).toBe('zone_key_not_found');
    });

    it('shows the key info as prefix and date only, and lets a content manager read it but not issue or revoke', async () => {
      const zone = await createZone();
      const issued = await issueZoneKey(zone.id);
      const info = await send('GET', `/zones/${zone.id}/key`);
      expect(info.status).toBe(200);
      expect(await info.json()).toEqual({ prefix: issued.prefix, createdAt: issued.createdAt });

      await signInAsContentManager(zone.projectId);
      expect((await send('GET', `/zones/${zone.id}/key`)).status).toBe(200);
      for (const method of ['POST', 'DELETE']) {
        const res = await send(method, `/zones/${zone.id}/key`);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      }
      expect((await deliverWithZoneKey(issued.key)).status).toBe(200);
    });

    it('keeps an issued zone key through a restart, and the site key path still works beside it', async () => {
      const zone = await createZone();
      const { key } = await issueZoneKey(zone.id);
      await restart();
      expect((await pool.query("SELECT to_regclass('zone_keys') AS t")).rows[0].t).not.toBeNull();
      expect((await deliverWithZoneKey(key)).status).toBe(200);

      // The site key and the slug read the same zone, the zone key does not change that.
      const siteHandle = await issue(zone.id);
      const bySlug = await deliver(siteHandle.key);
      expect(bySlug.status).toBe(200);
      expect((await bySlug.json()).id).toBe(zone.id);
      expect((await deliverWithZoneKey(key)).status).toBe(200);
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
      expect((await send('DELETE', `/projects/${zone.projectId}/site-key`)).status).toBe(204);
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
          settings: { layout: 'ring', shape: 'circle', size: 'medium', showTitles: true, alignment: 'start', gap: 12 },
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
        settings: {
          layout: 'ring',
          shape: 'rounded-square',
          size: 'medium',
          showTitles: false,
          alignment: 'start',
          gap: 20,
        },
      });
    });

    it('saves and delivers the P4 layout and P5 variant, refuses other values, and fills them for stored settings from before', async () => {
      const zone = await createZone();
      await post(`/zones/${zone.id}/frame`, { type: 'bar' });
      const chip = await patch(`/zones/${zone.id}/frame`, { settings: { layout: 'chip', size: 'small' } });
      expect(chip.status).toBe(200);
      expect((await chip.json()).settings).toEqual({ layout: 'chip', size: 'small' });
      const refused = await patch(`/zones/${zone.id}/frame`, { settings: { layout: 'tile' } });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.message).toContain(
        'settings.layout must be one of: ring, chip, poster, stack',
      );
      // A stored bar from before the layout existed reads back with the ring look.
      await pool.query('UPDATE frames SET settings = \'{"gap": 16}\'::jsonb WHERE zone_id = $1', [zone.id]);
      const { key } = await issue(zone.id);
      expect((await (await deliver(key)).json()).frame.settings).toEqual({
        layout: 'ring',
        shape: 'circle',
        size: 'medium',
        showTitles: true,
        alignment: 'start',
        gap: 16,
      });
      const banner = await patch(`/zones/${zone.id}/frame`, { type: 'banner', settings: { variant: 'sticky' } });
      expect(banner.status).toBe(200);
      expect((await banner.json()).settings).toEqual({ variant: 'sticky' });
      const badVariant = await patch(`/zones/${zone.id}/frame`, { settings: { variant: 'slideshow' } });
      expect(badVariant.status).toBe(400);
      await pool.query('UPDATE frames SET settings = \'{"loop": false}\'::jsonb WHERE zone_id = $1', [zone.id]);
      expect((await (await deliver(key)).json()).frame.settings).toEqual({
        variant: 'carousel',
        aspectRatio: '16:9',
        autoplay: true,
        intervalSeconds: 5,
        showDots: true,
        loop: false,
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
      const defaults = {
        layout: 'ring',
        shape: 'circle',
        size: 'medium',
        showTitles: true,
        alignment: 'start',
        gap: 12,
      };
      const cases: [string, unknown, object][] = [
        [
          'bar',
          { gap: 40, shape: 'star', size: 'large', color: 'red', layout: 'mosaic' },
          { ...defaults, layout: 'ring', size: 'large' },
        ],
        ['bar', ['x'], defaults],
        [
          'banner',
          { stray: 1, intervalSeconds: 40, aspectRatio: '</style>', loop: false, variant: 'slideshow' },
          { ...bannerDefaults, loop: false },
        ],
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

        it('a conditional issue answers 409 site_key_exists and leaves the active key working (story 8.13)', async () => {
          const project = await createProject();
          const first = await post(siteKeyPath(project.id), { ifNone: true });
          expect(first.status).toBe(201);
          const key: Issued = await first.json();

          const again = await post(siteKeyPath(project.id), { ifNone: true });
          expect(again.status).toBe(409);
          expect((await again.json()).error.code).toBe('site_key_exists');
          expect(await (await send('GET', siteKeyPath(project.id))).json()).toEqual({ prefix: key.prefix, createdAt: key.createdAt });

          // Two first issues at once: one key, one refusal, never a rotation.
          const other = await createProject();
          const both = await Promise.all([
            post(siteKeyPath(other.id), { ifNone: true }),
            post(siteKeyPath(other.id), { ifNone: true }),
          ]);
          expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
          const { rows } = await pool.query('SELECT count(*)::int AS n FROM site_keys WHERE project_id = $1', [other.id]);
          expect(rows[0].n).toBe(1);

          // The unconditional form still rotates; a bad ifNone is refused.
          expect((await post(siteKeyPath(project.id), { ifNone: false })).status).toBe(201);
          expect((await post(siteKeyPath(project.id), { ifNone: 'yes' })).status).toBe(400);
        });

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
          expect(text).not.toContain(createHash('sha256').update(issued.key).digest('hex'));

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

        it('limits each address with 429 and Retry-After, when the limit is on', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Limited');
          const { key } = await issueSite(project.id);
          const limited = createApp(
            pool,
            loadFrameTypeRegistry(frameTypesDir),
            new LocalDiskStorage(mediaDir),
            { verifier: fakeVerifier },
            { publicApiUrl },
            undefined,
            { rateLimit: { burst: 3, perSecond: 0.5 } },
          ).listen(0);
          await new Promise<void>((resolve) => limited.once('listening', () => resolve()));
          const at = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/delivery/v1/zone`;
          const get = (bearer: string, query = '') =>
            globalThis.fetch(`${at}${query}`, { headers: { Authorization: `Bearer ${bearer}` } });
          try {
            // A preflight is not counted, and allows the visitor id header (story 8.23).
            const preflight = await globalThis.fetch(at, {
              method: 'OPTIONS',
              headers: {
                Origin: 'https://shop.example',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization, x-taleart-visitor',
              },
            });
            expect(preflight.status).toBe(204);
            expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
            expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase().split(/,\s*/)).toEqual(
              expect.arrayContaining(['authorization', 'x-taleart-visitor']),
            );
            expect((await get(key, `?zone=${zone.slug}`)).status).toBe(200);
            // A refusal counts too, so guessing keys or slugs is limited.
            expect((await get(key)).status).toBe(401);
            expect((await get(key, '?zone=nope')).status).toBe(401);
            for (const res of [await get(key, `?zone=${zone.slug}`), await get(key)]) {
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

        it('limits each visitor id on its own, with a per-address backstop (story 8.23)', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Visitors');
          const { key } = await issueSite(project.id);
          const limited = createApp(
            pool,
            loadFrameTypeRegistry(frameTypesDir),
            new LocalDiskStorage(mediaDir),
            { verifier: fakeVerifier },
            { publicApiUrl },
            undefined,
            // So slow a refill that no run, however slow, gets a token back.
            { rateLimit: { burst: 2, perSecond: 0.0001 } },
          ).listen(0);
          await new Promise<void>((resolve) => limited.once('listening', () => resolve()));
          const at = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/delivery/v1/zone?zone=${zone.slug}`;
          const get = (visitor?: string) =>
            globalThis.fetch(at, {
              headers: { Authorization: `Bearer ${key}`, ...(visitor && { 'X-TaleArt-Visitor': visitor }) },
            });
          const visitor = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
          try {
            // Two devices behind one address each get their own two requests.
            for (const id of [visitor(1), visitor(2)]) {
              expect((await get(id)).status).toBe(200);
              expect((await get(id)).status).toBe(200);
              expect((await get(id)).status).toBe(429);
            }
            // Without an id, or with a malformed one, the address has today's allowance.
            expect((await get()).status).toBe(200);
            expect((await get('not-a-visitor-id')).status).toBe(200);
            expect((await get()).status).toBe(429);
            // Rotating ids reaches the address backstop: ten visitors' worth (20 requests) in all.
            // Six of them went through above; three were refused, which takes nothing.
            const statuses: number[] = [];
            for (let i = 10; i < 30; i++) statuses.push((await get(visitor(i))).status);
            expect(statuses.filter((s) => s === 200)).toHaveLength(14);
            const refused = await get(visitor(99));
            expect(refused.status).toBe(429);
            expect(refused.headers.get('access-control-allow-origin')).toBe('*');
            expect(refused.headers.get('access-control-expose-headers')).toBe('Retry-After');
            expect((await refused.json()).error.code).toBe('rate_limited');
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

        it("serves each zone of the project by its slug with that zone's own display and groups", async () => {
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
        });

        it('refuses an unknown slug exactly like a refused key, and a slug of another project too', async () => {
          const project = await createProject();
          const zone = await placedZone(project.id, 'Home top');
          const otherProject = await createProject('Globex');
          const otherZone = await placedZone(otherProject.id, 'Globex only');
          const { key } = await issueSite(project.id);
          const otherKey = (await issueSite(otherProject.id)).key;

          await expectRefused(await deliverSlug(key, 'nope'));
          await expectRefused(await deliverSlug(key, otherZone.slug));
          await expectRefused(await deliverSlug(key, ''));
          await expectRefused(await deliverSlug(key, [zone.slug, zone.slug]));
          await expectRefused(await deliverSlug(key, 'Home Top'));
          // Text PostgreSQL cannot hold (a NUL byte): the same refusal, never a 500.
          await expectRefused(await deliverSlug(key, `${zone.slug}\u0000`));
          await expectRefused(await deliverSlug(key, '\u0000'));
          // A bracketed parameter reads as an object, which is no slug.
          await expectRefused(await deliverQuery(key, `zone[${zone.slug}]=${zone.slug}`));
          await expectRefused(await deliverQuery(key, `zone[x]=y`));
          await expectRefused(await deliverSlug(undefined, zone.slug));
          await expectRefused(await deliverSlug(`tas_${randomBytes(32).toString('base64url')}`, zone.slug));
          await expectRefused(await deliverSlug(key.toUpperCase(), zone.slug));
          // A zone key nobody issued is refused like any other unknown key.
          await expectRefused(await deliverSlug(`tak_${randomBytes(32).toString('base64url')}`, zone.slug));
          // Each key reads its own project only.
          expect((await deliverSlug(otherKey, otherZone.slug)).status).toBe(200);
          await expectRefused(await deliverSlug(otherKey, zone.slug));

          // Without a slug, the site key is refused with the same body (a zone key needs no slug).
          await expectRefused(await deliverSlug(key, undefined));
          await expectRefused(await deliverSlug(undefined, undefined));
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

          // Only a site key installs a zone (story 8.7): a new one does, and the media is public again.
          await issueSite(project.id);
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
            tags: [],
            tagMatch: 'any',
            audience: null,
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
            tags: [],
            tagMatch: 'any',
            audience: null,
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

      it("sends each group's tag names and match mode, the same for every viewer (epic targeting R2, AD-13)", async () => {
        const zone = await createZone();
        await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
        const tag = async (name: string) => (await (await post(`/projects/${zone.projectId}/tags`, { name })).json()).id;
        const [summer, vip] = [await tag('summer'), await tag('VIP')];
        const setTags = (groupId: string, tagIds: string[], tagMatch?: string) =>
          fetch(`${base}/tale-groups/${groupId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tagIds, tagMatch }),
          });
        const groups = {
          A: await addGroup(zone.id, 'A'),
          B: await addGroup(zone.id, 'B'),
          C: await addGroup(zone.id, 'C'),
          D: await addGroup(zone.id, 'D'),
        };
        for (const group of Object.values(groups)) await addTale(group.id, 'One');
        expect((await setTags(groups.A.id, [summer])).status).toBe(200);
        expect((await setTags(groups.B.id, [vip, summer], 'all')).status).toBe(200);
        expect((await setTags(groups.C.id, [vip], 'any')).status).toBe(200);
        const { key } = await issue(zone.id);

        const body = await (await deliver(key)).json();
        expect(
          body.taleGroups.map((g: { name: string; tags: string[]; tagMatch: string }) => [g.name, g.tags, g.tagMatch]),
        ).toEqual([
          ['A', ['summer'], 'any'],
          ['B', ['summer', 'VIP'], 'all'],
          ['C', ['VIP'], 'any'],
          ['D', [], 'any'],
        ]);
        // Tags only narrow in the SDK: the Delivery API still sends every group, and no tag ids.
        expect(JSON.stringify(body)).not.toContain(summer);
      });

      it("changes the ETag when a group's tags or match mode change, so a browser revalidates (epic targeting R1)", async () => {
        const zone = await createZone();
        await post(`/zones/${zone.id}/frame`, { type: 'bar', settings: {} });
        const summer = (await (await post(`/projects/${zone.projectId}/tags`, { name: 'summer' })).json()).id;
        const vip = (await (await post(`/projects/${zone.projectId}/tags`, { name: 'vip' })).json()).id;
        const group = await addGroup(zone.id, 'A');
        await addTale(group.id, 'One');
        const setTags = async (tagIds: string[], tagMatch?: string) => {
          const res = await fetch(`${base}/tale-groups/${group.id}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tagIds, tagMatch }),
          });
          expect(res.status).toBe(200);
        };
        const { key } = await issue(zone.id);
        const etag = async () => {
          const res = await deliver(key);
          expect(res.status).toBe(200);
          return res.headers.get('etag');
        };

        const untagged = await etag();
        expect(untagged).toBeTruthy();
        expect(await etag()).toBe(untagged);
        await setTags([summer, vip]);
        const tagged = await etag();
        expect(tagged).not.toBe(untagged);
        await setTags([summer, vip], 'all');
        const all = await etag();
        expect(all).not.toBe(tagged);
        // A browser holding the old ETag gets the new body, not a 304. (`max-age=0`, as a browser
        // revalidates: fetch otherwise sends `no-cache`, which Express never answers with 304.)
        const revalidated = await deliver(key, { 'If-None-Match': tagged ?? '', 'Cache-Control': 'max-age=0' });
        expect(revalidated.status).toBe(200);
        expect((await revalidated.json()).taleGroups[0].tagMatch).toBe('all');
        expect((await deliver(key, { 'If-None-Match': all ?? '', 'Cache-Control': 'max-age=0' })).status).toBe(304);
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

        // Media never needs the key, but a zone whose project's site key is revoked is not installed,
        // so nothing shows in it and its media is private until it has a key again (epic UX rework R7).
        expect((await send('DELETE', `/projects/${zone.projectId}/site-key`)).status).toBe(204);
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
          await installZone(target.id);
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
          await installZone(target.id);
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

    it('answers 401 invalid_site_key with one message for a missing, unknown, malformed or session-only caller', async () => {
      const zone = await createZone();
      const key = (await issue(zone.id)).key.split('|')[0];
      const messages = new Set([
        await expectInvalidKey(await deliver()),
        // A site key without a slug is refused: only a zone key names its zone alone.
        await expectInvalidKey(await deliver(undefined, { Authorization: `Bearer ${key}` })),
        await expectInvalidKey(await deliver('tak_unknownkeyunknownkeyunknownkeyunknownkey0')),
        await expectInvalidKey(await deliver(`tak_unknownkeyunknownkeyunknownkeyunknownkey0|${zone.slug}`)),
        await expectInvalidKey(await deliver('not-a-key')),
        await expectInvalidKey(await deliver(undefined, { Authorization: 'Basic abc' })),
        await expectInvalidKey(await deliver(undefined, { Cookie: sessionCookie })),
        // A signed-in session and a valid slug, with no bearer key: a session never reads Delivery (AD-2).
        await expectInvalidKey(
          await globalThis.fetch(`${origin}/delivery/v1/zone?zone=${encodeURIComponent(zone.slug)}`, {
            headers: { Cookie: sessionCookie },
          }),
        ),
      ]);
      expect([...messages]).toEqual(['A valid site key and zone are required']);
    });

    it('does not accept a site key on the Management API', async () => {
      const zone = await createZone();
      const key = (await issue(zone.id)).key.split('|')[0];
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
      const key = await installZone(zone.id);
      return { zone, font, group, tale, key: key as string };
    }

    async function delivered(key: string) {
      const res = await deliverZone(key);
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
      expect(tales[0].fonts).toEqual([{ id: font.id, family: 'Brand Sans', url, weight: 700, style: 'italic' }]);
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

    it('stops serving the media and font of a group targeted only to empty lists, at once, and serves them again when a list fills (story 5.4)', async () => {
      const { zone, group, font, tale } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      await publish('tale-groups', group.id);
      await publish('tales', tale.id);
      // A second tale with uploaded media, in the same group.
      const pictured = (await (await post(`/tale-groups/${group.id}/tales`, { title: 'Picture' })).json()).id as string;
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      expect((await fetch(`${base}/tales/${pictured}/media`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png })).status).toBe(200);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts WHERE id = $1', [font.id])).rows[0].storage_key as string;
      const mediaKey = (await pool.query('SELECT media_key FROM tales WHERE id = $1', [pictured])).rows[0].media_key as string;
      const urls = [`${publicApiUrl}/media/${fontKey}`, `${publicApiUrl}/media/${mediaKey}`];
      // Served, so this process keeps a public answer for each (PUBLIC_*_CACHE_TTL_MS).
      for (const url of urls) expect((await getPublic(url)).status, url).toBe(200);

      const created = await (await post(`/projects/${zone.projectId}/user-lists`, { name: 'Empty' })).json();
      const set = await fetch(`${base}/tale-groups/${group.id}/user-lists`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userListIds: [created.id] }),
      });
      expect(set.status).toBe(200);
      // audience-empty: not delivered, so not public, at once (the change cleared the public caches).
      for (const url of urls) expect((await getPublic(url)).status, url).toBe(404);

      // The list's first ID makes the group delivered again (to its members), and its media public, at once.
      const upload = await fetch(`${base}/projects/${zone.projectId}/user-lists/${created.id}/ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: 'cust-1\n',
      });
      expect(upload.status).toBe(200);
      for (const url of urls) expect((await getPublic(url)).status, url).toBe(200);

      // Deleting the list holds the group hidden (audience-removed): private again at once.
      expect((await fetch(`${base}/projects/${zone.projectId}/user-lists/${created.id}`, { method: 'DELETE' })).status).toBe(204);
      for (const url of urls) expect((await getPublic(url)).status, url).toBe(404);
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

    it("makes a delivered tale's font private when the project's site key is revoked, and public again when one is issued", async () => {
      const { zone, group, tale } = await liveTale((id) => [text(1, { source: 'project', fontId: id })]);
      await publish('tale-groups', group.id);
      await publish('tales', tale.id);
      const fontKey = (await pool.query('SELECT storage_key FROM project_fonts')).rows[0].storage_key as string;
      const url = `${publicApiUrl}/media/${fontKey}`;
      expect((await getPublic(url)).status).toBe(200);
      // The revoke clears this process's font cache (story 8.6): no stale 200.
      const revoked = await fetch(`${base}/projects/${zone.projectId}/site-key`, { method: 'DELETE' });
      expect(revoked.status).toBe(204);
      expect((await getPublic(url)).status).toBe(404);
      const issued = await fetch(`${base}/projects/${zone.projectId}/site-key`, { method: 'POST' });
      expect(issued.status).toBe(201);
      // Issuing clears the cache too: the 404 just kept is not served for its 30 s.
      expect((await getPublic(url)).status).toBe(200);
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
      const key = await installZone(zoneId);
      const res = await deliverZone(key);
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
      await installZone(zone.id);
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
        await installZone(zone.id);
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

    describe('buttons, image buttons and the swipe-up link (epic Tale Studio R7, R14, story 7.7)', () => {
      const SWIPE_BOX = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 };
      function item(n: number, type: string, props: unknown, extra: Record<string, unknown> = {}) {
        return {
          id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          type,
          box: type === 'swipe-up' ? { ...SWIPE_BOX } : { x: 0.2, y: 0.5 + n * 0.05, w: 0.6, h: 0.07, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props,
          ...extra,
        };
      }
      const button = (href?: string) => ({
        label: 'Shop now',
        variant: 'filled',
        color: '#111827',
        fill: '#ffffff',
        ...(href === undefined ? {} : { href }),
      });
      const swipeUp = (href?: string) => ({
        label: 'See more',
        color: '#ffffff',
        background: '#000000b3',
        ...(href === undefined ? {} : { href }),
      });

      it('refuses a javascript:, data: or ftp: destination, a relative one, credentials and one over 2,048 characters', async () => {
        const { tale } = await setup();
        const refused = async (value: unknown, pointer: string) => {
          const res = await save(tale.id, value, 0);
          expect(res.status).toBe(400);
          expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer });
        };
        for (const href of [
          'javascript:alert(1)',
          'data:text/html,<script>alert(1)</script>',
          'ftp://example.com/file',
          '/relative',
          'https://user:pass@example.com',
          `https://example.com/${'a'.repeat(2029)}`,
          `java${String.fromCharCode(9)}script:alert(1)`,
        ]) {
          await refused(doc([item(1, 'button', button(href))]), '/elements/0/props/href');
          await refused(doc([item(1, 'swipe-up', swipeUp(href))]), '/elements/0/props/href');
        }
        await refused(doc([item(1, 'swipe-up', swipeUp()), item(2, 'swipe-up', swipeUp())]), '/elements/1/type');
        await refused(doc([item(1, 'swipe-up', swipeUp(), { box: { ...SWIPE_BOX, y: 0.3 } })]), '/elements/0/box');
        expect((await state(tale.id)).revision).toBe(0);
      });

      it('refuses to publish a link without a destination, then delivers each link with its href and image URL', async () => {
        const { zone, group, tale } = await setup();
        await installZone(zone.id);
        const image = await uploaded(zone.projectId);
        const elements = [
          item(1, 'button', button('https://example.com/shop')),
          item(2, 'image-button', { mediaKey: image, href: 'https://example.com/look', newTab: true }, {
            a11y: { label: 'Shop the look' },
          }),
          item(3, 'swipe-up', swipeUp()),
        ];
        expect((await save(tale.id, doc(elements), 0)).status).toBe(200);
        const refused = await publishDraft(tale.id);
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toEqual({
          code: 'invalid_tale_document',
          message: '"See more" needs a web address before the tale can be updated.',
          pointer: '/elements/2/props/href',
        });
        elements[2] = item(3, 'swipe-up', swipeUp('https://example.com/more'));
        expect((await save(tale.id, doc(elements), 1)).status).toBe(200);
        expect((await publishDraft(tale.id)).status).toBe(200);
        await publish('tale-groups', group.id);
        await publish('tales', tale.id);
        expect((await getPublic(image)).status).toBe(200);
        const [deliveredGroup] = await delivered(zone.id);
        const document = deliveredGroup.tales[0].document as { elements: { type: string; props: unknown }[] };
        expect(document.elements.map((e) => e.type)).toEqual(['button', 'image-button', 'swipe-up']);
        expect(document.elements[0].props).toMatchObject({ href: 'https://example.com/shop' });
        expect(document.elements[1].props).toEqual({
          url: `${publicApiUrl}/media/${image}`,
          href: 'https://example.com/look',
          newTab: true,
        });
        expect(JSON.stringify(document)).not.toContain('mediaKey');
      });
    });

    describe('an element type registered by configuration (epic Tale Studio R8, story 7.8)', () => {
      const badge = (props: Record<string, unknown> = {}) => ({
        id: '00000000-0000-4000-8000-0000000000b1',
        type: 'test-badge',
        box: { x: 0.1, y: 0.2, w: 0.4, h: 0.08, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: { label: 'New in' },
        props: { label: 'New', color: '#ff0055', tone: 'solid', count: 3, ...props },
      });
      const words = (n: number) => ({
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        type: 'text',
        box: { x: 0.1, y: 0.5, w: 0.8, h: 0.1, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: 'Still here' },
      });
      afterEach(() => setTestElementTypesEnabled(false));

      it('refuses the test-only type unless the server is configured to take it', async () => {
        const { tale } = await setup();
        const res = await save(tale.id, doc([badge()]), 0);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer: '/elements/0/type' });
      });

      it('saves, validates and delivers it once configured, with no document version change', async () => {
        setTestElementTypesEnabled(true);
        const { zone, group, tale } = await setup();
        await installZone(zone.id);
        const refused = async (props: Record<string, unknown>, pointer: string) => {
          const res = await save(tale.id, doc([badge(props)]), 0);
          expect(res.status).toBe(400);
          expect((await res.json()).error).toMatchObject({ code: 'invalid_tale_document', pointer });
        };
        await refused({ label: 'a'.repeat(41) }, '/elements/0/props/label');
        await refused({ color: 'red' }, '/elements/0/props/color');
        await refused({ tone: 'glow' }, '/elements/0/props/tone');
        await refused({ count: 100 }, '/elements/0/props/count');
        await refused({ html: '<b>x</b>' }, '/elements/0/props/html');
        expect((await state(tale.id)).revision).toBe(0);

        const value = doc([words(1), badge()]);
        const saved = await save(tale.id, value, 0);
        expect(saved.status).toBe(200);
        expect((await saved.json()).document).toEqual(value);
        expect((await publishDraft(tale.id)).status).toBe(200);
        await publish('tale-groups', group.id);
        await publish('tales', tale.id);
        const [deliveredGroup] = await delivered(zone.id);
        const document = deliveredGroup.tales[0].document as {
          version: number;
          elements: { type: string; props: unknown }[];
        };
        expect(document.version).toBe(1);
        expect(document.elements.map((e) => e.type)).toEqual(['text', 'test-badge']);
        expect(document.elements[1].props).toEqual({ label: 'New', color: '#ff0055', tone: 'solid', count: 3 });
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
      const key = await installZone(zoneId);
      const res = await deliverZone(key);
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
        const res = await deliverZone(key);
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
      for (const z of [zone, second]) keys.push((await installZone(z.id)));
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
      const key = await installZone(zone.id);
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
      const key = await installZone(zone.id);
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
      const key = await installZone(zone.id);
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
      const key = await installZone(zone.id);
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
      const key = await installZone(zone.id);
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
      const key = await installZone(zone.id);
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      await publish('tale-groups', group.id);
      const taleId = await taleFromMedia(group.id, 'Target');
      const otherId = await taleFromMedia(group.id, 'Other');
      return { projectId: zone.projectId, zoneId: zone.id, key, groupId: group.id, taleId, otherId };
    }

    // What the site shows for the zone: the groups and tales its key delivers; nothing without a key.
    async function delivered(key: string | null): Promise<{ groups: string[]; tales: string[] }> {
      if (key === null) return { groups: [], tales: [] };
      const res = await deliverZone(key);
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
          expect((await send('DELETE', `/projects/${f.projectId}/site-key`)).status).toBe(204);
          // The revoked site key is refused: the site shows nothing.
          const res = await deliverZone(f.key as string);
          expect(res.status).toBe(401);
          f.key = null;
        },
        fix: async (f) => {
          f.key = (await installZone(f.zoneId));
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
      {
        // Epic targeting R7, story 5.4: targeted only to user lists that hold no ID, nobody can match.
        name: 'audience empty',
        on: 'placement',
        reason: () => why('audience-empty', 'group'),
        omits: 'group',
        breakIt: async (f) => {
          const list = await (await post(`/projects/${f.projectId}/user-lists`, { name: 'Empty' })).json();
          expect((await send('PUT', `/tale-groups/${f.groupId}/user-lists`, { userListIds: [list.id] })).status).toBe(200);
        },
        fix: async (f) =>
          expect((await send('PUT', `/tale-groups/${f.groupId}/user-lists`, { userListIds: [] })).status).toBe(200),
      },
      {
        // Story 5.4 review: its only list was deleted, so it is held hidden until its Audience is saved.
        name: 'audience removed',
        on: 'placement',
        reason: () => why('audience-removed', 'group'),
        omits: 'group',
        breakIt: async (f) => {
          const list = await (await post(`/projects/${f.projectId}/user-lists`, { name: 'Gone' })).json();
          const upload = await fetch(`${base}/projects/${f.projectId}/user-lists/${list.id}/ids`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/csv' },
            body: 'cust-1\n',
          });
          expect(upload.status).toBe(200);
          expect((await send('PUT', `/tale-groups/${f.groupId}/user-lists`, { userListIds: [list.id] })).status).toBe(200);
          expect((await send('DELETE', `/projects/${f.projectId}/user-lists/${list.id}`)).status).toBe(204);
        },
        // Saving the group's lists is a person choosing its audience again.
        fix: async (f) =>
          expect((await send('PUT', `/tale-groups/${f.groupId}/user-lists`, { userListIds: [] })).status).toBe(200),
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
      // In the bare zone the placement is not visible, for the bare zone's reason (it is installed by
      // its project's site key, the only key since story 8.7)...
      const there = (await listed(bare.id)).find((g) => g.id === f.groupId);
      expect(there?.visibility).toEqual(notVisible(why('zone-no-display', 'zone')));
      expect(there?.tales[0].visibility.visible).toBe(false);
      // ...while the group and its tale, read for every zone, are visible through the set-up one.
      expect((await projectGroup(f)).visibility).toEqual(VISIBLE);
      expect((await (await setStatus('tales', f.taleId, 'live')).json()).visibility).toEqual(VISIBLE);
    });

    it('words a zone with no tale group apart from one whose groups are not visible', async () => {
      const f = await fixture();
      const empty = await (await post('/zones', { name: 'Empty', projectId: f.projectId })).json();
      await installZone(empty.id);
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
      // Placed only in a zone without a display: nothing of it is public.
      const bare = await (await post('/zones', { name: 'Bare', projectId: f.projectId })).json();
      expect((await send('PUT', `/zones/${bare.id}/tale-groups/${f.groupId}`)).status).toBe(201);
      expect((await send('DELETE', `/zones/${f.zoneId}/tale-groups/${f.groupId}`)).status).toBe(204);
      expect([await status(coverKey), await status(mediaKey)]).toEqual([404, 404]);
      expect((await projectGroup(f)).visibility).toEqual(notVisible(why('zone-no-display', 'zone')));
      // Its zone gets a display: public again, through the project's site key.
      await installZone(bare.id);
      expect([await status(coverKey), await status(mediaKey)]).toEqual([200, 200]);
      expect((await projectGroup(f)).visibility).toEqual(VISIBLE);
      // Without the project's site key: private again, and the zone says it is not installed.
      expect((await send('DELETE', `/projects/${f.projectId}/site-key`)).status).toBe(204);
      expect([await status(coverKey), await status(mediaKey)]).toEqual([404, 404]);
      expect((await projectGroup(f)).visibility).toEqual(notVisible(why('zone-not-installed', 'zone')));
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
        // Installed: since story 8.7 only an active site key of the zone's project counts.
        `AND EXISTS (SELECT 1 FROM site_keys ok JOIN zones oz2 ON oz2.project_id = ok.project_id ` +
        `WHERE oz2.id = ${zone} AND ok.revoked_at IS NULL)`;
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
        await installZone(ready.id);
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
        // keyless, ready and bare). With one site key per project, "keyless" is installed too; the
        // comparison without the site key below covers zones that are not.
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
          // Without the project's site key no zone is installed (story 8.7: a site key is the only key).
          await client.query('BEGIN');
          await client.query('UPDATE site_keys SET revoked_at = now() WHERE project_id = $1', [project.id]);
          await compare(client, now);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      }, 30_000);

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
      const key = await installZone(zone.id);
      const deliver = async () => {
        clearDeliveryCache();
        const res = await deliverZone(key);
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
    }, 20_000);

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
      const key = await installZone(zone.id);
      clearDeliveryCache();
      const res = await deliverZone(key);
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
      await installZone(zone.id);
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

    describe('delete a tale (epic UX rework R11, story 8.20)', () => {
      function remove(taleId: string): Promise<Response> {
        return fetch(`${base}/tales/${taleId}`, { method: 'DELETE' });
      }

      // A minimal WOFF2 face the font route accepts.
      function woff2(): Buffer {
        const data = Buffer.alloc(2048, 7);
        data.fill(0, 0, 50);
        data.write('wOF2', 0, 'latin1');
        data.writeUInt32BE(0x00010000, 4);
        data.writeUInt32BE(2048, 8);
        data.writeUInt16BE(1, 12);
        data.writeUInt32BE(1024, 16);
        data.writeUInt32BE(2048 - 50, 20);
        data[49] = 0x10;
        return data;
      }

      const rowsOf = async (table: 'tale_media' | 'tale_fonts', taleId: string) =>
        (await pool.query(`SELECT 1 FROM ${table} WHERE tale_id = $1`, [taleId])).rowCount;

      // The zone's delivered tales of a group, with each tale's media URLs.
      async function delivered(handle: string, groupId: string) {
        clearDeliveryCache();
        const res = await deliverZone(handle);
        expect(res.status).toBe(200);
        const group = (await res.json()).taleGroups.find((g: { id: string }) => g.id === groupId);
        return ((group?.tales ?? []) as { id: string; document: { elements: { props: { url?: string } }[] } }[]).map(
          (tale) => ({
            id: tale.id,
            urls: tale.document.elements.map((e) => e.props.url).filter((u): u is string => typeof u === 'string'),
          }),
        );
      }
      const served = async (url: string) => (await globalThis.fetch(`${origin}${new URL(url).pathname}`)).status;

      it('deletes the tale with its documents and media rows, renumbers the group and removes a file nothing else uses', async () => {
        const { first, beach, mediaKey, taleMediaKey } = await setup();
        expect(await rowsOf('tale_media', beach.id)).toBeGreaterThan(0);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);

        const res = await remove(beach.id);
        expect(res.status).toBe(204);
        expect(await res.text()).toBe('');
        // Positions are 0..n-1 again (titles checks it).
        expect(await titles(first.id)).toEqual(['Arrival', 'Cliffs']);
        expect((await pool.query('SELECT 1 FROM tales WHERE id = $1', [beach.id])).rowCount).toBe(0);
        expect(await rowsOf('tale_media', beach.id)).toBe(0);
        // The tale's own media file went with it; the project's uploaded image stays in its media.
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(false);
        expect(existsSync(join(mediaDir, mediaKey))).toBe(true);
                expect((await fetch(`${base}/tales/${beach.id}`)).status).toBe(404);
        // The group reads without it.
        const group = await (await fetch(`${base}/tale-groups/${first.id}`)).json();
        expect(group.tales.map((t: { title: string; position: number }) => [t.title, t.position])).toEqual([
          ['Arrival', 0],
          ['Cliffs', 1],
        ]);

        for (const id of [beach.id, randomUUID(), 'nope']) {
          const again = await remove(id);
          expect([again.status, (await again.json()).error.code]).toEqual([404, 'tale_not_found']);
        }
      });

      it("keeps a file the duplicate still uses and still serves it; deleting the last tale using it removes it", async () => {
        const { zone, first, beach, taleMediaKey } = await setup();
        const copy = await (await duplicate(beach.id)).json();
        await publish('tales', beach.id, copy.id);
        await update(beach.id);
        await update(copy.id);
        const handle = await installZone(zone.id);
        const before = await delivered(handle, first.id);
        const originalUrls = before.find((t) => t.id === beach.id)?.urls ?? [];
        const ownUrl = originalUrls.find((u) => u.includes(taleMediaKey)) as string;
        expect(ownUrl).toBeDefined();
        expect(await served(ownUrl)).toBe(200);

        expect((await remove(beach.id)).status).toBe(204);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);
        const after = await delivered(handle, first.id);
        expect(after.map((t) => t.id)).not.toContain(beach.id);
        const copyUrls = after.find((t) => t.id === copy.id)?.urls ?? [];
        expect(copyUrls.some((u) => u.includes(taleMediaKey))).toBe(true);
        for (const url of copyUrls) expect(await served(url)).toBe(200);
        expect(await titles(first.id)).toEqual(['Arrival', 'Beach (copy)', 'Cliffs']);

        // The copy was the last tale using the file: it goes, and its public URL answers 404.
        expect((await remove(copy.id)).status).toBe(204);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(false);
        expect(await served(ownUrl)).toBe(404);
        expect((await delivered(handle, first.id)).map((t) => t.id)).not.toContain(copy.id);
      });

      it("keeps a file a copied group's tale uses (copy to zone)", async () => {
        const { zone, first, beach, taleMediaKey } = await setup();
        // Copy to zone shares the tales' keys (AD-14).
        const copied = await post(`/tale-groups/${first.id}/copy`, { zoneId: zone.id });
        expect(copied.status).toBe(201);
        expect((await remove(beach.id)).status).toBe(204);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);
        expect(await isMediaKeyInUse(pool, taleMediaKey)).toBe(true);
      });

      it('deletes its font rows and keeps the project font, which can then be deleted', async () => {
        const { zone, beach, mediaKey } = await setup();
        const query = new URLSearchParams({ family: 'Brand Sans', weight: '700', style: 'normal', fallback: 'serif', licence: 'confirmed' });
        const uploaded = await fetch(`${base}/projects/${zone.projectId}/fonts?${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'font/woff2' },
          body: woff2(),
        });
        expect(uploaded.status).toBe(201);
        const font = await uploaded.json();
        const doc = styled('Brand', mediaKey);
        const text = doc.elements.find((e) => e.type === 'text') as { props: Record<string, unknown> };
        text.props = { ...text.props, font: { source: 'project', fontId: font.id }, fallback: 'serif' };
        await save(beach.id, doc);
        await update(beach.id);
        expect(await rowsOf('tale_fonts', beach.id)).toBe(2);
        const inUse = await fetch(`${base}/projects/${zone.projectId}/fonts/${font.id}`, { method: 'DELETE' });
        expect(inUse.status).toBe(409);

        expect((await remove(beach.id)).status).toBe(204);
        expect(await rowsOf('tale_fonts', beach.id)).toBe(0);
        const fonts = await (await fetch(`${base}/projects/${zone.projectId}/fonts`)).json();
        expect(fonts.map((f: { id: string }) => f.id)).toContain(font.id);
        const freed = await fetch(`${base}/projects/${zone.projectId}/fonts/${font.id}`, { method: 'DELETE' });
        expect(freed.status).toBe(204);
      });

      it('deletes a tale left Hidden without media, as a failed upload leaves it (story 8.13)', async () => {
        const { first } = await setup();
        const left = await (await post(`/tale-groups/${first.id}/tales`, { title: 'Upload failed' })).json();
        expect((await setStatus('tales', left.id, 'paused')).status).toBe(200);
        expect((await remove(left.id)).status).toBe(204);
        expect(await titles(first.id)).toEqual(['Arrival', 'Beach', 'Cliffs']);
      });

      it('lets a content manager delete in their project, and refuses another project with 403', async () => {
        const { zone, beach, c } = await setup();
        const other = await createZone();
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        await addProjectMember(pool, zone.projectId, user.id);
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        expect((await remove(beach.id)).status).toBe(204);

        await pool.query('DELETE FROM project_members WHERE user_id = $1', [user.id]);
        await addProjectMember(pool, other.projectId, user.id);
        const refused = await remove(c.id);
        expect([refused.status, (await refused.json()).error.code]).toEqual([403, 'forbidden']);
        expect((await pool.query('SELECT 1 FROM tales WHERE id = $1', [c.id])).rowCount).toBe(1);
      });

      it('answers 204 when deleting its file fails, logs it, and the start-up sweep removes the file later', async () => {
        const { a, beach, taleMediaKey } = await setup();
        await putTaleMedia(a.id, 'image/png', png);
        const { rows } = await pool.query<{ key: string }>('SELECT media_key AS key FROM tales WHERE id = $1', [a.id]);
        const kept = rows[0].key;
        const failing = vi.spyOn(LocalDiskStorage.prototype, 'delete').mockRejectedValueOnce(new Error('disk unavailable'));
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
          expect((await remove(beach.id)).status).toBe(204);
          expect(failing).toHaveBeenCalledWith(taleMediaKey);
          expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('could not delete the media of a deleted tale');
        } finally {
          failing.mockRestore();
          log.mockRestore();
        }
        expect((await pool.query('SELECT 1 FROM tales WHERE id = $1', [beach.id])).rowCount).toBe(0);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);

        const storage = new LocalDiskStorage(mediaDir);
        // Young files wait: an upload may be about to point its tale at one.
        await sweepUnusedTaleMediaFiles(pool, storage);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(true);
        // Earlier tests' unreferenced files in the shared folder go too.
        const later = Date.now() + TALE_MEDIA_SWEEP_MIN_AGE_MS + 60_000;
        expect(await sweepUnusedTaleMediaFiles(pool, storage, later)).toBeGreaterThanOrEqual(1);
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(false);
        // A file a tale still uses stays.
        expect(existsSync(join(mediaDir, kept))).toBe(true);
        expect(await sweepUnusedTaleMediaFiles(pool, storage, later)).toBe(0);
      });

      it('deletes an archived tale and a tale of an archived group', async () => {
        const { first, second, beach } = await setup();
        expect((await setStatus('tales', beach.id, 'archived')).status).toBe(200);
        expect((await remove(beach.id)).status).toBe(204);
        const snow = await (await post(`/tale-groups/${second.id}/tales`, { title: 'Snow' })).json();
        expect((await setStatus('tale-groups', second.id, 'archived')).status).toBe(200);
        expect((await remove(snow.id)).status).toBe(204);
        expect(await titles(first.id)).toEqual(['Arrival', 'Cliffs']);
        expect(await titles(second.id)).toEqual([]);
      });

      it('applies deletes racing duplicates, reorders, adds, saves and status changes one after the other, without a deadlock', async () => {
        const { zone, first, second, a, beach, c, mediaKey, taleMediaKey } = await setup();
        const { revision } = await state(beach.id);
        const results = await Promise.all([
          duplicate(beach.id),
          remove(beach.id),
          duplicate(beach.id, { taleGroupId: second.id }),
          fetch(`${base}/tale-groups/${first.id}/tales/order`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taleIds: [c.id, beach.id, a.id] }),
          }),
          post(`/tale-groups/${first.id}/tales`, { title: 'Added' }),
          fetch(`${base}/tales/${beach.id}/document`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document: styled('Racing', mediaKey), revision }),
          }),
          setStatus('tales', beach.id, 'paused'),
          remove(c.id),
          post(`/tale-groups/${first.id}/copy`, { zoneId: zone.id }),
        ]);
        const statuses = results.map((r) => r.status);
        // Nothing fails for another reason than the tale being gone, or an order built on a list
        // that changed meanwhile.
        expect(statuses.filter((s) => s >= 500)).toEqual([]);
        expect([statuses[1], statuses[7]]).toEqual([204, 204]);
        for (const i of [0, 2]) expect([201, 404]).toContain(statuses[i]);
        expect([200, 404, 409]).toContain(statuses[3]);
        expect(statuses[4]).toBe(201);
        for (const i of [5, 6]) expect([200, 404]).toContain(statuses[i]);
        expect(statuses[8]).toBe(201);
        // Each group's positions are 0..n-1 (titles checks it); the deleted tales are gone.
        const order = await titles(first.id);
        expect(order).not.toContain('Beach');
        expect(order).not.toContain('Cliffs');
        await titles(second.id);
        // A file any tale still references is on disk; one nothing references is gone.
        expect(existsSync(join(mediaDir, taleMediaKey))).toBe(await isMediaKeyInUse(pool, taleMediaKey));
        expect(existsSync(join(mediaDir, mediaKey))).toBe(true);
      }, 20_000);
    });
  });

  describe('user lists from a CSV, stored only as keyed hashes (epic targeting story 5.3)', () => {
    // The verify line's file: 10 rows (8 IDs, one of them twice, and a 300-character value) and an
    // empty row. Line 7 is the duplicate, line 9 the empty row, line 10 the long value.
    const ids = ['cust-1001', 'cust-1002', 'Cust-1002', 'cust-1003', 'cust-1004', 'cust-1005'];
    const long = 'L'.repeat(300);
    const verifyCsv = [...ids, 'cust-1001', 'cust-1006', '', long, '"cust-1007"'].join('\r\n') + '\r\n';
    const emails = ['ana@example.com', 'bo@example.org', 'cy@example.net', 'dee@example.com', 'u-77'];

    // Every external user ID these tests upload, to look for in clear.
    const uploaded = [...ids, 'cust-1006', 'cust-1007', long, ...emails];

    // Everything the API printed during a test, to look for IDs in.
    let printed: string[] = [];
    beforeEach(() => {
      printed = [];
      for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    const listsUrl = (projectId: string) => `${base}/projects/${projectId}/user-lists`;

    async function createList(projectId: string, name: string): Promise<{ id: string; idCount: number }> {
      const res = await post(`/projects/${projectId}/user-lists`, { name });
      expect(res.status).toBe(201);
      return res.json();
    }

    function upload(
      url: string,
      body: string | Uint8Array,
      headers: Record<string, string> = {},
      query = '',
    ): Promise<Response> {
      return fetch(`${url}/ids${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...headers },
        body,
      });
    }

    // Every row of every table, as text, with each bytea column also as text when it is UTF-8, so an
    // ID stored in clear anywhere, in any column type, is found.
    async function dump(): Promise<string> {
      const { rows: tables } = await pool.query<{ name: string }>(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      const parts: string[] = [];
      for (const { name } of tables) {
        const { rows } = await pool.query<{ row: string }>(`SELECT t::text AS row FROM "${name}" t`);
        for (const { row } of rows) parts.push(row);
      }
      const { rows: hashes } = await pool.query<{ h: Buffer }>('SELECT id_hash AS h FROM user_list_ids');
      for (const { h } of hashes) parts.push(h.toString('latin1'));
      return parts.join('\n');
    }

    function expectNoIdIn(text: string, where: string): void {
      for (const id of uploaded) {
        expect(text.includes(id), `${where} holds an uploaded ID`).toBe(false);
        expect(text.includes(Buffer.from(id).toString('hex')), `${where} holds an uploaded ID in hex`).toBe(false);
      }
    }

    it('takes the verify CSV: 8 IDs, the duplicate already present, the long value refused by line', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Loyal customers');
      expect(list).toEqual({
        id: expect.any(String),
        projectId: project.id,
        name: 'Loyal customers',
        idCount: 0,
        taleGroups: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      const res = await upload(`${listsUrl(project.id)}/${list.id}`, verifyCsv);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({
        added: 8,
        alreadyPresent: 1,
        refused: 1,
        refusedRows: [{ line: 10, reason: 'too-long' }],
        emptyRows: 1,
        emailLike: 0,
        phoneLike: 0,
        idCount: 8,
      });
      expectNoIdIn(text, 'the report');
      const lists = await fetch(listsUrl(project.id));
      const listed = await lists.text();
      expect(JSON.parse(listed)).toEqual([expect.objectContaining({ id: list.id, idCount: 8 })]);
      expectNoIdIn(listed, 'the list');
      // Matching is exact: Cust-1002 and cust-1002 are two IDs. Each is stored as HMAC-SHA-256 under
      // the project's secret, and nothing else.
      const { rows: secrets } = await pool.query<{ secret: Buffer }>(
        'SELECT secret FROM user_list_secrets WHERE project_id = $1',
        [project.id],
      );
      expect(secrets).toHaveLength(1);
      const { rows: stored } = await pool.query<{ h: Buffer }>('SELECT id_hash AS h FROM user_list_ids WHERE user_list_id = $1', [list.id]);
      const expected = [...ids, 'cust-1006', 'cust-1007'].map((id) =>
        createHmac('sha256', secrets[0].secret).update(id, 'utf8').digest('hex'),
      );
      expect(stored.map((r) => r.h.toString('hex')).sort()).toEqual(expected.sort());

      // Again: every row already present, nothing changes but the report.
      const again = await (await upload(`${listsUrl(project.id)}/${list.id}`, verifyCsv)).json();
      expect(again).toMatchObject({ added: 0, alreadyPresent: 9, refused: 1, idCount: 8 });
      expectNoIdIn(await dump(), 'the database');
      expectNoIdIn(printed.join('\n'), 'the API log');
    });

    it('takes a CSV of emails, counts them for the warning, and creates the list', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Newsletter');
      const res = await upload(`${listsUrl(project.id)}/${list.id}`, `email\n${emails.join('\n')}`, {}, '?header=true');
      expect(res.status).toBe(200);
      const report = await res.json();
      expect(report).toMatchObject({ added: 5, emailLike: 4, phoneLike: 0, idCount: 5, refused: 0 });
      expect(contactLikeWarning(reportContactCounts(report))).toBe('email');
      expect((await (await fetch(listsUrl(project.id))).json())[0]).toMatchObject({ name: 'Newsletter', idCount: 5 });
      expectNoIdIn(await dump(), 'the database');
      expectNoIdIn(printed.join('\n'), 'the API log');
    });

    it('deletes a list and every hash of it in one go; the secret goes with the last list', async () => {
      const project = await createProject();
      const kept = await createList(project.id, 'Kept');
      const gone = await createList(project.id, 'Gone');
      await upload(`${listsUrl(project.id)}/${kept.id}`, 'k-1\nk-2\n');
      await upload(`${listsUrl(project.id)}/${gone.id}`, verifyCsv);
      const del = await fetch(`${listsUrl(project.id)}/${gone.id}`, { method: 'DELETE' });
      expect(del.status).toBe(204);
      const count = async (sql: string, value: string) => (await pool.query(sql, [value])).rowCount;
      expect(await count('SELECT 1 FROM user_lists WHERE id = $1', gone.id)).toBe(0);
      expect(await count('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', gone.id)).toBe(0);
      expect(await count('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', kept.id)).toBe(2);
      expect(await count('SELECT 1 FROM user_list_secrets WHERE project_id = $1', project.id)).toBe(1);
      expect((await fetch(`${listsUrl(project.id)}/${gone.id}`, { method: 'DELETE' })).status).toBe(404);

      // The last list: the project's secret goes too, and its next list gets a new one.
      const { rows: before } = await pool.query<{ secret: Buffer }>('SELECT secret FROM user_list_secrets WHERE project_id = $1', [
        project.id,
      ]);
      expect((await fetch(`${listsUrl(project.id)}/${kept.id}`, { method: 'DELETE' })).status).toBe(204);
      expect(await count('SELECT 1 FROM user_list_secrets WHERE project_id = $1', project.id)).toBe(0);
      expect(await count('SELECT 1 FROM user_list_ids WHERE project_id = $1', project.id)).toBe(0);
      await createList(project.id, 'Fresh');
      const { rows: after } = await pool.query<{ secret: Buffer }>('SELECT secret FROM user_list_secrets WHERE project_id = $1', [
        project.id,
      ]);
      expect(after[0].secret.equals(before[0].secret)).toBe(false);
    });

    it('deletes a project with its lists, their hashes and its secret', async () => {
      const project = await createProject('Test project');
      const other = await createProject('Other');
      const list = await createList(project.id, 'Loyal');
      await upload(`${listsUrl(project.id)}/${list.id}`, verifyCsv);
      const otherList = await createList(other.id, 'Loyal');
      await upload(`${listsUrl(other.id)}/${otherList.id}`, 'o-1\n');
      // No project-delete operation exists yet: the database deletes a project's lists with it.
      await pool.query('DELETE FROM projects WHERE id = $1', [project.id]);
      for (const table of ['user_lists', 'user_list_ids', 'user_list_secrets']) {
        expect((await pool.query(`SELECT 1 FROM ${table} WHERE project_id = $1`, [project.id])).rowCount, table).toBe(0);
        expect((await pool.query(`SELECT 1 FROM ${table} WHERE project_id = $1`, [other.id])).rowCount, table).toBe(1);
      }
    });

    it('creates, renames and lists by name, refusing taken and bad names and the 101st list', async () => {
      const project = await createProject();
      const b = await createList(project.id, ' beta ');
      await createList(project.id, 'Alpha');
      const taken = await post(`/projects/${project.id}/user-lists`, { name: 'ALPHA' });
      expect(taken.status).toBe(409);
      expect((await taken.json()).error.code).toBe('user_list_exists');
      for (const name of ['', '   ', 'x'.repeat(101), 'a\u0007b']) {
        const res = await post(`/projects/${project.id}/user-lists`, { name });
        expect(res.status, JSON.stringify(name)).toBe(400);
        expect((await res.json()).error.code).toBe('validation_failed');
      }
      const renamed = await fetch(`${listsUrl(project.id)}/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Gamma' }),
      });
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).name).toBe('Gamma');
      const clash = await fetch(`${listsUrl(project.id)}/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'alpha' }),
      });
      expect(clash.status).toBe(409);
      expect((await (await fetch(listsUrl(project.id))).json()).map((l: { name: string }) => l.name)).toEqual(['Alpha', 'Gamma']);

      await pool.query(
        `INSERT INTO user_lists (project_id, name) SELECT $1, 'List ' || n FROM generate_series(3, 100) AS n`,
        [project.id],
      );
      const full = await post(`/projects/${project.id}/user-lists`, { name: 'One more' });
      expect(full.status).toBe(409);
      expect((await full.json()).error.code).toBe('user_list_limit_reached');
    });

    it('answers 404 for a list of another project and 403 for a project the caller cannot reach', async () => {
      const mine = await createProject('Mine');
      const theirs = await createProject('Theirs');
      const theirList = await createList(theirs.id, 'Theirs');
      const foreign = await upload(`${listsUrl(mine.id)}/${theirList.id}`, 'a\n');
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).error.code).toBe('user_list_not_found');
      expect((await fetch(`${listsUrl(mine.id)}/${theirList.id}`, { method: 'DELETE' })).status).toBe(404);
      expect((await upload(`${listsUrl(mine.id)}/nope`, 'a\n')).status).toBe(404);
      expect((await fetch(listsUrl('00000000-0000-4000-8000-000000000000'))).status).toBe(404);

      const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
      await addProjectMember(pool, mine.id, user.id);
      sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
      const own = await createList(mine.id, 'Mine');
      expect((await upload(`${listsUrl(mine.id)}/${own.id}`, 'a\n')).status).toBe(200);
      expect((await fetch(listsUrl(theirs.id))).status).toBe(403);
      expect((await upload(`${listsUrl(theirs.id)}/${theirList.id}`, 'a\n')).status).toBe(403);
      expect((await pool.query('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', [theirList.id])).rowCount).toBe(0);
    });

    it('refuses another type, a compressed, empty or too large file, and text that is not UTF-8, adding nothing', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Checked');
      const url = `${listsUrl(project.id)}/${list.id}`;
      const refuse = async (res: Response, status: number, code: string) => {
        expect(res.status).toBe(status);
        expect((await res.json()).error.code).toBe(code);
      };
      const early = await upload(url, 'a\n', { 'Content-Type': 'application/json' });
      expect(early.headers.get('connection')).toBe('close');
      await refuse(early, 415, 'unsupported_media_type');
      await refuse(await upload(url, 'a\n', { 'Content-Encoding': 'gzip' }), 415, 'unsupported_media_type');
      await refuse(await upload(url, ''), 400, 'validation_failed');
      await refuse(await upload(url, new Uint8Array(50 * 1024 * 1024 + 1)), 413, 'user_list_file_too_large');
      const notUtf8 = await upload(url, new Uint8Array([...Buffer.from('cust-1001\n'), 0xc3, 0x28, 0x0a]));
      expect(notUtf8.status).toBe(400);
      const body = await notUtf8.text();
      expect(body).toMatch(/UTF-8/);
      expectNoIdIn(body, 'the refusal');
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', [list.id])).rowCount).toBe(0);
      expectNoIdIn(printed.join('\n'), 'the API log');
    });

    // An API with its own user list options, for the caps tests cannot reach with real sizes.
    async function withLists<T>(options: UserListOptions, run: (base: string) => Promise<T>): Promise<T> {
      const app = createApp(
        pool,
        loadFrameTypeRegistry(frameTypesDir),
        new LocalDiskStorage(mediaDir),
        { verifier: fakeVerifier },
        { publicApiUrl },
        undefined,
        { rateLimit: null },
        undefined,
        options,
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

    it('refuses a file over the row cap whole, and an upload while too many run', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Capped');
      await withLists({ maxRows: 3 }, async (b) => {
        const url = `${b}/projects/${project.id}/user-lists/${list.id}`;
        const over = await upload(url, 'a\n\nb\nc\nd\n');
        expect(over.status).toBe(413);
        expect((await over.json()).error.code).toBe('user_list_file_too_large');
        expect((await (await upload(url, 'h\na\n\nb\nc\n', {}, '?header=true')).json()).added).toBe(3);
      });
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(3);
      await withLists({ maxConcurrentUploads: 0 }, async (b) => {
        const busy = await upload(`${b}/projects/${project.id}/user-lists/${list.id}`, 'z\n');
        expect(busy.status).toBe(429);
        expect((await busy.json()).error.code).toBe('upload_busy');
      });
    });

    it('takes IDs from another module through the public interface', async () => {
      const project = await createProject();
      const list = await createUserList(pool, { projectId: project.id, name: 'Imported' });
      const report = await addUserListIds(pool, { projectId: project.id, userListId: list.id }, ['i-1', ' i-2 ', 'i-1', '', 'x'.repeat(257)]);
      expect(report).toMatchObject({ added: 2, alreadyPresent: 1, refused: 1, emptyRows: 1, idCount: 2 });
      expect((await (await fetch(listsUrl(project.id))).json())[0]).toMatchObject({ name: 'Imported', idCount: 2 });
    });

    // A raw upload, for what fetch cannot send: a body that stalls, or one sent slowly. Resolves with
    // the answer, or with `closed` when the server ended the connection without one.
    function rawCsv(
      target: string,
      length: number,
    ): { req: ReturnType<typeof httpRequest>; answer: Promise<{ status: number; body: string } | 'closed'> } {
      const url = new URL(target);
      let req!: ReturnType<typeof httpRequest>;
      const answer = new Promise<{ status: number; body: string } | 'closed'>((resolve) => {
        req = httpRequest(
          {
            method: 'POST',
            host: url.hostname,
            port: url.port,
            path: url.pathname,
            headers: { Cookie: sessionCookie, 'Content-Type': 'text/csv', 'Content-Length': String(length) },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            res.on('error', () => resolve('closed'));
          },
        );
        req.on('error', () => resolve('closed'));
      });
      return { req, answer };
    }
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    it('ends a stalled upload, adds nothing, frees the list and keeps running (security review F1)', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Stalled');
      await withLists({ idleMs: 300 }, async (b) => {
        const url = `${b}/projects/${project.id}/user-lists/${list.id}/ids`;
        const stalled = rawCsv(url, 1000);
        stalled.req.write('cust-1001\ncust-1002\n');
        await pause(900);
        const answer = await stalled.answer;
        if (answer !== 'closed') expect(answer.status).toBe(408);
        stalled.req.destroy();
        // The process is up, nothing was added, and the list's locks are free.
        expect((await fetch(`${b}/health`)).status).toBe(200);
        expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM user_list_ids WHERE user_list_id = $1', [list.id])).rowCount).toBe(0);
        expect((await fetch(`${url.replace(/\/ids$/, '')}`, { method: 'DELETE' })).status).toBe(204);
      });
      expectNoIdIn(printed.join('\n'), 'the API log');
    });

    it('ends an upload past its deadline even while bytes keep coming', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Slowpoke');
      await withLists({ idleMs: 1000, deadlineMs: 400 }, async (b) => {
        const slow = rawCsv(`${b}/projects/${project.id}/user-lists/${list.id}/ids`, 10_000);
        for (let i = 0; i < 8; i++) {
          if (!slow.req.destroyed) slow.req.write(`slow-${i}\n`);
          await pause(100);
        }
        const answer = await slow.answer;
        if (answer !== 'closed') expect(answer.status).toBe(408);
        slow.req.destroy();
        expect((await fetch(`${b}/health`)).status).toBe(200);
      });
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
    });

    it('survives the database ending a stalled upload transaction (the backstop), adding nothing', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Backstop');
      await withLists({ idleMs: 60_000, deadlineMs: 60_000, databaseIdleTimeout: '300ms' }, async (b) => {
        const body = 'cust-1001\ncust-1002\n';
        const stalled = rawCsv(`${b}/projects/${project.id}/user-lists/${list.id}/ids`, body.length);
        stalled.req.write(body.slice(0, 10));
        // PostgreSQL ends the session (FATAL 25P03) while the API waits for bytes: pg emits `error`
        // on the checked-out client, which must not take the process down.
        await pause(1200);
        stalled.req.end(body.slice(10));
        const answer = await stalled.answer;
        expect(answer).not.toBe('closed');
        if (answer !== 'closed') {
          expect(answer.status).toBe(500);
          expectNoIdIn(answer.body, 'the answer');
        }
        expect((await fetch(`${b}/health`)).status).toBe(200);
        // The pool still serves requests.
        expect((await fetch(listsUrl(project.id).replace(base, b))).status).toBe(200);
      });
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
      expectNoIdIn(printed.join('\n'), 'the API log');
    });

    it('survives the database ending an upload session mid-file, adding nothing (UX rework story 8.24)', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Terminated');
      await withLists({ idleMs: 60_000, deadlineMs: 60_000 }, async (b) => {
        const body = 'cust-1001\ncust-1002\n';
        const stalled = rawCsv(`${b}/projects/${project.id}/user-lists/${list.id}/ids`, body.length);
        stalled.req.write(body.slice(0, 10));
        // The upload's transaction waits for bytes, its client checked out: a restart or failover
        // ends that session (pg_terminate_backend here), and the process must stay up.
        const pid = await waitForBackend(
          "state = 'idle in transaction' AND pid IN (SELECT pid FROM pg_locks WHERE relation = 'user_lists'::regclass)",
        );
        await terminateBackend(pid);
        stalled.req.end(body.slice(10));
        const answer = await stalled.answer;
        expect(answer).not.toBe('closed');
        if (answer !== 'closed') {
          expect(answer.status).toBe(500);
          expectNoIdIn(answer.body, 'the answer');
        }
        expect((await fetch(`${b}/health`)).status).toBe(200);
        expect((await fetch(listsUrl(project.id).replace(base, b))).status).toBe(200);
      });
      // Nothing was added, and the list takes the same file now.
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
      const res = await upload(`${listsUrl(project.id)}/${list.id}`, 'cust-1001\ncust-1002\n');
      expect((await res.json()).idCount).toBe(2);
      expectNoIdIn(printed.join('\n'), 'the API log');
    }, 20_000);

    it('takes a slow but steady upload under the limits', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Steady');
      await withLists({ idleMs: 400, deadlineMs: 10_000 }, async (b) => {
        const rows = Array.from({ length: 8 }, (_, i) => `steady-${i}\n`);
        const steady = rawCsv(`${b}/projects/${project.id}/user-lists/${list.id}/ids`, rows.join('').length);
        for (const row of rows) {
          steady.req.write(row);
          await pause(150);
        }
        steady.req.end();
        const answer = await steady.answer;
        expect(answer).not.toBe('closed');
        if (answer !== 'closed') {
          expect(answer.status).toBe(200);
          expect(JSON.parse(answer.body)).toMatchObject({ added: 8, idCount: 8 });
        }
      });
    });

    it('logs no ID when an upload fails with an internal error', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Broken');
      // Every insert into user_list_ids fails from now on, as a database fault would.
      await pool.query('ALTER TABLE user_list_ids ADD CONSTRAINT t53_forced_failure CHECK (false) NOT VALID');
      try {
        const res = await upload(`${listsUrl(project.id)}/${list.id}`, verifyCsv);
        expect(res.status).toBe(500);
        const body = await res.text();
        expect(JSON.parse(body).error.code).toBe('internal_error');
        expectNoIdIn(body, 'the answer');
      } finally {
        await pool.query('ALTER TABLE user_list_ids DROP CONSTRAINT IF EXISTS t53_forced_failure');
      }
      const log = printed.join('\n');
      expect(log).toMatch(/unhandled error/);
      expectNoIdIn(log, 'the API log');
      expect((await (await fetch(listsUrl(project.id))).json())[0].idCount).toBe(0);
    });

    it('takes IDs outside ASCII since story 5.4 defined the header encoding, exactly as written', async () => {
      const project = await createProject();
      const list = await createList(project.id, 'Unicode');
      const res = await upload(`${listsUrl(project.id)}/${list.id}`, 'cust-1001\nmüller-7\nzo\u00eb\nzoe\u0308\n用户-1\n');
      const report = await res.json();
      // The composed and the decomposed ë are two IDs: no Unicode normalization.
      expect(report).toMatchObject({ added: 5, refused: 0, refusedRows: [], idCount: 5 });
    });
  });

  describe("a group targeted to user lists; the viewer's external user ID picks them (epic targeting story 5.4)", () => {
    const member = 'cust-A1';
    const unicodeMember = 'müller-7';
    const outsider = 'cust-Z9';
    // Every ID these tests send or upload, and each one's header value, to look for in logs and dumps.
    const sent = [member, unicodeMember, outsider, 'cust-B1'];
    const traces = [...sent, ...sent.map((id) => encodeExternalUserIdHeader(id) as string)];

    let printed: string[] = [];
    beforeEach(() => {
      printed = [];
      for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    function put(path: string, body: unknown): Promise<Response> {
      return fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    async function listWith(projectId: string, name: string, csv: string): Promise<{ id: string }> {
      const created = await post(`/projects/${projectId}/user-lists`, { name });
      expect(created.status).toBe(201);
      const list = await created.json();
      if (csv) {
        const res = await fetch(`${base}/projects/${projectId}/user-lists/${list.id}/ids`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: csv,
        });
        expect(res.status).toBe(200);
      }
      return list;
    }

    // A set-up zone with group A targeted to list A (two members) and group Open with no audience.
    async function matrix() {
      const zone = await createZone();
      const handle = await installZone(zone.id);
      const groups: Record<'a' | 'open', string> = { a: '', open: '' };
      for (const key of ['a', 'open'] as const) {
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: key === 'a' ? 'Loyal only' : 'Open' })).json();
        await publish('tale-groups', group.id);
        const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: `${key} tale` })).json();
        await asLegacy(tale.id);
        groups[key] = group.id;
      }
      const listA = await listWith(zone.projectId, 'Loyal', `${member}\n${unicodeMember}\n`);
      const set = await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [listA.id] });
      expect(set.status).toBe(200);
      return { zone, handle, groups, listA };
    }

    // The Delivery API's answer for a viewer: with their ID in the header, or with no header.
    async function asViewer(handle: string, id: string | null, extra: Record<string, string> = {}) {
      const headers: Record<string, string> = { ...extra };
      if (id !== null) headers[EXTERNAL_USER_ID_HEADER] = encodeExternalUserIdHeader(id) as string;
      const res = await deliverZone(handle, headers);
      expect(res.status).toBe(200);
      const text = await res.text();
      const body: { taleGroups: { id: string; userListMatched?: boolean }[] } = JSON.parse(text);
      return { res, text, ids: body.taleGroups.map((g) => g.id), groups: body.taleGroups };
    }

    function expectNoTrace(text: string, where: string): void {
      for (const trace of traces) expect(text.includes(trace), `${where} holds ${trace}`).toBe(false);
    }

    it('shows the group to a viewer in its list, and leaves it out for one not in it and one with no ID', async () => {
      const { handle, groups } = await matrix();
      const inA = await asViewer(handle, member);
      expect(inA.ids).toEqual([groups.a, groups.open]);
      expect(inA.groups[0].userListMatched).toBe(true);
      // An untargeted group is never marked.
      expect('userListMatched' in inA.groups[1]).toBe(false);
      // An ID outside ASCII travels base64url-encoded and matches exactly.
      expect((await asViewer(handle, unicodeMember)).ids).toEqual([groups.a, groups.open]);
      expect((await asViewer(handle, 'MÜLLER-7')).ids).toEqual([groups.open]);
      expect((await asViewer(handle, 'müller-7')).ids).toEqual([groups.open]);
      for (const viewer of [outsider, null]) {
        const read = await asViewer(handle, viewer);
        expect(read.ids).toEqual([groups.open]);
        // Not in the response at all: not its id, its name or its tale.
        expect(read.text).not.toContain(groups.a);
        expect(read.text).not.toContain('Loyal only');
        expect(read.text).not.toContain('a tale');
      }
      expectNoTrace(printed.join('\n'), 'the API log');
    });

    it('reads a header that is not canonical base64url of a valid ID as no ID', async () => {
      const { handle, groups } = await matrix();
      const plain = await deliverZone(handle, { [EXTERNAL_USER_ID_HEADER]: member });
      // `cust-A1` is not base64url of itself: it reads as some other byte string, not the ID.
      expect((await plain.json()).taleGroups.map((g: { id: string }) => g.id)).toEqual([groups.open]);
      for (const value of [`${encodeExternalUserIdHeader(member)}==`, '!!!!', 'A'.repeat(2000), Buffer.from([0xff]).toString('base64url')]) {
        const res = await deliverZone(handle, { [EXTERNAL_USER_ID_HEADER]: value });
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect((await res.json()).taleGroups.map((g: { id: string }) => g.id)).toEqual([groups.open]);
      }
    });

    it('answers a request with the header private, no-store, without an ETag or a 304; without it as before', async () => {
      const { handle } = await matrix();
      const anonymous = await asViewer(handle, null);
      expect(anonymous.res.headers.get('cache-control')).toBe('private, no-cache');
      expect(anonymous.res.headers.get('vary')).toBe(`Authorization, ${EXTERNAL_USER_ID_HEADER}`);
      const etag = anonymous.res.headers.get('etag');
      expect(etag).toBeTruthy();
      // As a browser revalidates (fetch would add `Cache-Control: no-cache` to its own If-None-Match).
      const revalidate = { 'If-None-Match': etag as string, 'Cache-Control': 'max-age=0' };
      expect((await deliverZone(handle, revalidate)).status).toBe(304);

      const listed = await asViewer(handle, member);
      expect(listed.res.headers.get('cache-control')).toBe('private, no-store');
      expect(listed.res.headers.get('vary')).toBe(`Authorization, ${EXTERNAL_USER_ID_HEADER}`);
      expect(listed.res.headers.get('etag')).toBeNull();
      expect(listed.res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      // A validator from another viewer's answer, or from the anonymous one, never gets a 304.
      const replay = await asViewer(handle, outsider, revalidate);
      expect(replay.res.status).toBe(200);
      expect(replay.res.headers.get('etag')).toBeNull();
      // The outsider sees the same groups as the anonymous viewer, and still gets the whole answer.
      expect(replay.ids).toEqual(anonymous.ids);
      // Even a header that reads as no ID keeps the answer out of every cache.
      const empty = await deliverZone(handle, { [EXTERNAL_USER_ID_HEADER]: '' });
      expect(empty.headers.get('cache-control')).toBe('private, no-store');
    });

    it('lets a browser send the header across origins, and needs no change to the URL', async () => {
      const { handle } = await matrix();
      const preflight = await globalThis.fetch(`${origin}/delivery/v1/zone?zone=x`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://shop.example',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': `authorization, x-taleart-visitor, ${EXTERNAL_USER_ID_HEADER.toLowerCase()}`,
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-headers')).toContain(EXTERNAL_USER_ID_HEADER);
      expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
      expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
      // The ID in the query string is not read: only the header picks lists.
      const [key, slug] = handle.split('|');
      const res = await globalThis.fetch(
        `${origin}/delivery/v1/zone?zone=${slug}&externalUserId=${member}&${EXTERNAL_USER_ID_HEADER}=${encodeExternalUserIdHeader(member)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      expect((await res.json()).taleGroups).toHaveLength(1);
    });

    it('never links the ID to the visitor id: the rate limit, the answer and the database see neither together', async () => {
      const { handle, groups } = await matrix();
      const visitor = randomUUID();
      const first = await asViewer(handle, member, { 'X-TaleArt-Visitor': visitor });
      const second = await asViewer(handle, outsider, { 'X-TaleArt-Visitor': visitor });
      expect(first.ids).toEqual([groups.a, groups.open]);
      expect(second.ids).toEqual([groups.open]);
      for (const read of [first, second]) expect(read.text).not.toContain(visitor);
      const { rows: tables } = await pool.query<{ name: string }>(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      );
      for (const { name } of tables) {
        const { rows } = await pool.query<{ row: string }>(`SELECT t::text AS row FROM "${name}" t`);
        const text = rows.map((r) => r.row).join('\n');
        expect(text.includes(visitor), `${name} holds the visitor id`).toBe(false);
        expectNoTrace(text, name);
      }
      expectNoTrace(printed.join('\n'), 'the API log');
    });

    it('targets only lists of the group\'s own project, replaces them, and counts repeats once', async () => {
      const { zone, groups, listA } = await matrix();
      const other = await createProject('Other');
      const foreign = await listWith(other.id, 'Theirs', 'x-1\n');
      const refused = await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [listA.id, foreign.id] });
      expect(refused.status).toBe(404);
      expect((await refused.json()).error.code).toBe('user_list_not_found');
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: ['nope'] })).status).toBe(404);
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: 'nope' })).status).toBe(400);
      expect((await put(`/tale-groups/00000000-0000-4000-8000-000000000000/user-lists`, { userListIds: [] })).status).toBe(404);
      // A refusal changes nothing.
      const zoneGroups: { id: string; userLists: unknown[] }[] = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
      expect(zoneGroups.find((g) => g.id === groups.a)?.userLists).toEqual([{ id: listA.id, name: 'Loyal', idCount: 2 }]);
      expect(zoneGroups.find((g) => g.id === groups.open)?.userLists).toEqual([]);

      const vip = await listWith(zone.projectId, 'Vip', 'cust-B1\n');
      const both = await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [vip.id, listA.id, vip.id.toUpperCase()] });
      expect(both.status).toBe(200);
      expect((await both.json()).userLists).toEqual([
        { id: listA.id, name: 'Loyal', idCount: 2 },
        { id: vip.id, name: 'Vip', idCount: 1 },
      ]);
      const project: { id: string; userLists: unknown[] }[] = await (await fetch(`${base}/projects/${zone.projectId}/tale-groups`)).json();
      expect(project.find((g) => g.id === groups.a)?.userLists).toHaveLength(2);
      // Each list names the groups it targets; never an ID.
      const lists: { name: string; taleGroups: unknown[] }[] = await (await fetch(`${base}/projects/${zone.projectId}/user-lists`)).json();
      expect(lists.map((l) => [l.name, l.taleGroups])).toEqual([
        ['Loyal', [{ id: groups.a, name: 'Loyal only' }]],
        ['Vip', [{ id: groups.a, name: 'Loyal only' }]],
      ]);
      // In either list is enough.
      expect((await asViewer((await installZone(zone.id)), 'cust-B1')).ids).toEqual([groups.a, groups.open]);
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [] })).status).toBe(200);
      expect((await asViewer(await installZone(zone.id), null)).ids).toEqual([groups.a, groups.open]);
    });

    it('combines with the tag rule: the SDK still decides tags, the server only lists', async () => {
      const { handle, groups, zone } = await matrix();
      const tag = await (await post(`/projects/${zone.projectId}/tags`, { name: 'summer' })).json();
      expect((await put(`/tale-groups/${groups.a}/tags`, { tagIds: [tag.id] })).status).toBe(200);
      const read = await asViewer(handle, member);
      expect(read.groups[0]).toMatchObject({ id: groups.a, tags: ['summer'], tagMatch: 'any', userListMatched: true });
    });

    it('a group targeted only to empty lists is not visible, and nobody gets it; an upload makes it visible to its members', async () => {
      const { zone, handle, groups } = await matrix();
      const empty = await listWith(zone.projectId, 'Empty', '');
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [empty.id] })).status).toBe(200);
      const listed: { id: string; visibility: unknown }[] = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
      expect(listed.find((g) => g.id === groups.a)?.visibility).toEqual(notVisible(why('audience-empty', 'group')));
      for (const viewer of [member, outsider, null]) expect((await asViewer(handle, viewer)).ids).toEqual([groups.open]);
      // The group's own row, read for any zone, says it too.
      const project: { id: string; visibility: unknown }[] = await (await fetch(`${base}/projects/${zone.projectId}/tale-groups`)).json();
      expect(project.find((g) => g.id === groups.a)?.visibility).toEqual(notVisible(why('audience-empty', 'group')));

      await fetch(`${base}/projects/${zone.projectId}/user-lists/${empty.id}/ids`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: `${outsider}\n`,
      });
      const after: { id: string; visibility: unknown }[] = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
      expect(after.find((g) => g.id === groups.a)?.visibility).toEqual(VISIBLE);
      expect((await asViewer(handle, outsider)).ids).toEqual([groups.a, groups.open]);
      expect((await asViewer(handle, member)).ids).toEqual([groups.open]);
    });

    it('deleting a list never makes a group public: one left with no list is held hidden until its Audience is saved', async () => {
      const { zone, handle, groups, listA } = await matrix();
      // A second group with list A and another list: it keeps the other one and is not held.
      const both = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Two lists' })).json();
      await publish('tale-groups', both.id);
      await asLegacy((await (await post(`/tale-groups/${both.id}/tales`, { title: 'both tale' })).json()).id);
      const vip = await listWith(zone.projectId, 'Vip', 'cust-B1\n');
      expect((await put(`/tale-groups/${both.id}/user-lists`, { userListIds: [listA.id, vip.id] })).status).toBe(200);
      const lists: { name: string; taleGroups: { name: string }[] }[] = await (
        await fetch(`${base}/projects/${zone.projectId}/user-lists`)
      ).json();
      expect(lists.find((l) => l.name === 'Loyal')?.taleGroups.map((g) => g.name)).toEqual(['Loyal only', 'Two lists']);

      expect((await fetch(`${base}/projects/${zone.projectId}/user-lists/${listA.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await pool.query('SELECT 1 FROM tale_group_user_lists WHERE user_list_id = $1', [listA.id])).rowCount).toBe(0);
      const listed: { id: string; visibility: unknown; userLists: unknown[] }[] = await (
        await fetch(`${base}/zones/${zone.id}/tale-groups`)
      ).json();
      const row = (id: string) => listed.find((g) => g.id === id);
      expect(row(groups.a)?.userLists).toEqual([]);
      expect(row(groups.a)?.visibility).toEqual(notVisible(why('audience-removed', 'group')));
      expect(row(both.id)?.visibility).toEqual(VISIBLE);
      // Nobody gets it: not a former member, not anyone else, not a page with no ID.
      for (const viewer of [member, outsider, null]) expect((await asViewer(handle, viewer)).ids).not.toContain(groups.a);
      expect((await asViewer(handle, 'cust-B1')).ids).toContain(both.id);
      expect((await asViewer(handle, member)).ids).not.toContain(both.id);

      // Saving the same tags again is not a choice of audience: it stays held.
      expect((await put(`/tale-groups/${groups.a}/tags`, { tagIds: [] })).status).toBe(200);
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [groups.a])).rowCount).toBe(1);
      expect((await asViewer(handle, null)).ids).not.toContain(groups.a);
      // Changing its tags is: now it shows to viewers with the tag (and on pages that pass none).
      const summer = await (await post(`/projects/${zone.projectId}/tags`, { name: 'summer' })).json();
      expect((await put(`/tale-groups/${groups.a}/tags`, { tagIds: [summer.id] })).status).toBe(200);
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [groups.a])).rowCount).toBe(0);
      expect((await asViewer(handle, null)).ids).toContain(groups.a);
      // So does a change of match mode alone, on another held group (the copy's hold, below).
    });

    it('saving the group\'s lists ends the hold too, and a held group\'s copy is held as well', async () => {
      const { zone, handle, groups, listA } = await matrix();
      expect((await fetch(`${base}/projects/${zone.projectId}/user-lists/${listA.id}`, { method: 'DELETE' })).status).toBe(204);
      const second = await (await post('/zones', { name: 'Second', projectId: zone.projectId })).json();
      const copy = await (await post(`/tale-groups/${groups.a}/copy`, { zoneId: second.id })).json();
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [copy.id])).rowCount).toBe(1);
      const vip = await listWith(zone.projectId, 'Vip', 'cust-B1\n');
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [vip.id] })).status).toBe(200);
      expect((await asViewer(handle, 'cust-B1')).ids).toContain(groups.a);
      expect((await asViewer(handle, null)).ids).not.toContain(groups.a);
    });

    it('copies keep their lists in the same project; a copy to another project has none and is held hidden', async () => {
      const { zone, groups, listA } = await matrix();
      const same = await (await post('/zones', { name: 'Second', projectId: zone.projectId })).json();
      const copied = await post(`/tale-groups/${groups.a}/copy`, { zoneId: same.id });
      expect(copied.status).toBe(201);
      const kept = await copied.json();
      expect(kept.userLists).toEqual([{ id: listA.id, name: 'Loyal', idCount: 2 }]);
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [kept.id])).rowCount).toBe(0);

      const elsewhere = await createZone();
      const otherHandle = await installZone(elsewhere.id);
      const away = await post(`/tale-groups/${groups.a}/copy`, { zoneId: elsewhere.id });
      expect(away.status).toBe(201);
      const moved = await away.json();
      expect(moved.userLists).toEqual([]);
      // On, it still shows to nobody, and says why, until its Audience is saved.
      await publish('tale-groups', moved.id);
      const there: { id: string; visibility: { reasons: { code: string }[] } }[] = await (
        await fetch(`${base}/zones/${elsewhere.id}/tale-groups`)
      ).json();
      expect(there.find((g) => g.id === moved.id)?.visibility.reasons.map((r) => r.code)).toContain('audience-removed');
      for (const viewer of [member, null]) expect((await asViewer(otherHandle, viewer)).ids).not.toContain(moved.id);
      // Saving the same tags keeps it held; a new match mode is a change, and ends the hold.
      expect((await put(`/tale-groups/${moved.id}/tags`, { tagIds: [] })).status).toBe(200);
      expect((await asViewer(otherHandle, null)).ids).not.toContain(moved.id);
      expect((await put(`/tale-groups/${moved.id}/tags`, { tagIds: [], tagMatch: 'all' })).status).toBe(200);
      expect((await asViewer(otherHandle, null)).ids).toContain(moved.id);
      // An untargeted group's copy to another project is never held.
      const plain = await (await post(`/tale-groups/${groups.open}/copy`, { zoneId: elsewhere.id })).json();
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [plain.id])).rowCount).toBe(0);
    });

    // Two connections (story 5.4 second review): a change of a group's lists, or a copy, waits at its
    // COMMIT while a delete of a list starts; the delete must then read the links as the change left
    // them, so the group ends hidden (held, or with its other list), never public.
    function gatedDb(): { db: TransactionalDb; atCommit: Promise<void>; commit: () => void } {
      let commit: () => void = () => undefined;
      const gate = new Promise<void>((done) => (commit = done));
      let reached: () => void = () => undefined;
      const atCommit = new Promise<void>((done) => (reached = done));
      const db = {
        query: (...args: unknown[]) => (pool.query as (...a: unknown[]) => unknown)(...args),
        connect: async () => {
          const client = await pool.connect();
          return {
            query: async (...args: unknown[]) => {
              if (args[0] === 'COMMIT') {
                reached();
                await gate;
              }
              return (client.query as (...a: unknown[]) => unknown)(...args);
            },
            release: (err?: Error | boolean) => client.release(err),
          };
        },
      } as unknown as TransactionalDb;
      return { db, atCommit, commit };
    }

    // Waits until another session waits on a row lock (the delete behind the gated change), or 1.5 s.
    async function someoneWaitsOnALock(): Promise<boolean> {
      for (let i = 0; i < 30; i++) {
        const { rows } = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        );
        if (rows[0].n > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    // Runs `change` gated at its COMMIT, starts deleting `listId` meanwhile, then lets the change commit.
    async function race(change: (db: TransactionalDb) => Promise<unknown>, projectId: string, listId: string) {
      const gated = gatedDb();
      const changing = change(gated.db);
      await gated.atCommit;
      const deleting = deleteUserList(pool, { projectId, userListId: listId });
      const waited = await someoneWaitsOnALock();
      gated.commit();
      const [changed, deleted] = await Promise.allSettled([changing, deleting]);
      return { waited, changed: changed.status, deleted: deleted.status };
    }

    const held = async (groupId: string) =>
      (await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE tale_group_id = $1', [groupId])).rowCount === 1;
    const listsOf = async (groupId: string) =>
      (await pool.query<{ id: string }>('SELECT user_list_id AS id FROM tale_group_user_lists WHERE tale_group_id = $1', [groupId])).rows.map(
        (r) => r.id,
      );

    it('race A: [L1, L2] set to [L1] while L1 is deleted: the group ends held and hidden', async () => {
      const { zone, handle, groups, listA } = await matrix();
      const l2 = await listWith(zone.projectId, 'L2', 'cust-B1\n');
      expect((await put(`/tale-groups/${groups.a}/user-lists`, { userListIds: [listA.id, l2.id] })).status).toBe(200);
      const run = await race((db) => setTaleGroupUserLists(db, groups.a, [listA.id]), zone.projectId, listA.id);
      expect(run).toMatchObject({ waited: true, changed: 'fulfilled', deleted: 'fulfilled' });
      expect(await listsOf(groups.a)).toEqual([]);
      expect(await held(groups.a)).toBe(true);
      for (const viewer of [member, 'cust-B1', null]) expect((await asViewer(handle, viewer)).ids).not.toContain(groups.a);
    });

    it('race B: [L1] set to [L2] while L2 is deleted: the group ends held and hidden', async () => {
      const { zone, handle, groups, listA } = await matrix();
      const l2 = await listWith(zone.projectId, 'L2', 'cust-B1\n');
      const run = await race((db) => setTaleGroupUserLists(db, groups.a, [l2.id]), zone.projectId, l2.id);
      expect(run).toMatchObject({ waited: true, changed: 'fulfilled', deleted: 'fulfilled' });
      expect(await listsOf(groups.a)).toEqual([]);
      expect(await held(groups.a)).toBe(true);
      for (const viewer of [member, 'cust-B1', null]) expect((await asViewer(handle, viewer)).ids).not.toContain(groups.a);
      expect(listA.id).not.toBe(l2.id);
    });

    it('race C: a same-project copy while the only list is deleted: the source and the copy end held and hidden', async () => {
      const { zone, handle, groups, listA } = await matrix();
      const run = await race(
        (db) =>
          copyTaleGroup(db, { taleGroupId: groups.a, zoneId: zone.id }, async (tx, ids) => {
            await copyTaleGroupTags(tx, ids);
            await copyTaleGroupUserLists(tx, ids);
          }),
        zone.projectId,
        listA.id,
      );
      expect(run).toMatchObject({ waited: true, changed: 'fulfilled', deleted: 'fulfilled' });
      const copies = (await pool.query<{ id: string }>("SELECT id FROM tale_groups WHERE name = 'Loyal only' AND id <> $1", [groups.a])).rows;
      expect(copies).toHaveLength(1);
      for (const id of [groups.a, copies[0].id]) {
        expect(await listsOf(id)).toEqual([]);
        expect(await held(id)).toBe(true);
      }
      await publish('tale-groups', copies[0].id);
      for (const viewer of [member, null]) {
        const ids = (await asViewer(handle, viewer)).ids;
        expect(ids).not.toContain(groups.a);
        expect(ids).not.toContain(copies[0].id);
      }
    });

    it('race D: [L1] set to [L2] while L1 is deleted: the group keeps L2, no stale hold, and says visible', async () => {
      const { zone, handle, groups, listA } = await matrix();
      const l2 = await listWith(zone.projectId, 'L2', 'cust-B1\n');
      const run = await race((db) => setTaleGroupUserLists(db, groups.a, [l2.id]), zone.projectId, listA.id);
      expect(run).toMatchObject({ waited: true, changed: 'fulfilled', deleted: 'fulfilled' });
      expect(await listsOf(groups.a)).toEqual([l2.id]);
      expect(await held(groups.a)).toBe(false);
      const listed: { id: string; visibility: unknown }[] = await (await fetch(`${base}/zones/${zone.id}/tale-groups`)).json();
      expect(listed.find((g) => g.id === groups.a)?.visibility).toEqual(VISIBLE);
      expect((await asViewer(handle, 'cust-B1')).ids).toContain(groups.a);
      expect((await asViewer(handle, member)).ids).not.toContain(groups.a);
    });

    it('a held group can be deleted: its hold goes with it', async () => {
      const { zone } = await matrix();
      // A group in no zone, with no tale: the database deletes it (no API route deletes a group yet).
      const group = await (await post(`/projects/${zone.projectId}/tale-groups`, { name: 'Lonely' })).json();
      const list = await listWith(zone.projectId, 'Only', 'x-1\n');
      expect((await put(`/tale-groups/${group.id}/user-lists`, { userListIds: [list.id] })).status).toBe(200);
      expect((await fetch(`${base}/projects/${zone.projectId}/user-lists/${list.id}`, { method: 'DELETE' })).status).toBe(204);
      expect(await held(group.id)).toBe(true);
      await pool.query('DELETE FROM tale_groups WHERE id = $1', [group.id]);
      expect(await held(group.id)).toBe(false);
      expect((await pool.query('SELECT 1 FROM tale_group_audience_holds WHERE project_id = $1', [zone.projectId])).rowCount).toBe(0);
    });

    it('logs no ID when the list match fails with a database error, and answers a plain 500', async () => {
      const { handle } = await matrix();
      await pool.query('ALTER TABLE user_list_ids RENAME TO user_list_ids_t54_forced');
      try {
        const res = await deliverZone(handle, { [EXTERNAL_USER_ID_HEADER]: encodeExternalUserIdHeader(member) as string });
        expect(res.status).toBe(500);
        const body = await res.text();
        expect(JSON.parse(body).error.code).toBe('internal_error');
        expectNoTrace(body, 'the answer');
      } finally {
        await pool.query('ALTER TABLE user_list_ids_t54_forced RENAME TO user_list_ids');
      }
      const log = printed.join('\n');
      expect(log).toMatch(/unhandled error/);
      expectNoTrace(log, 'the API log');
    });

    it('cannot link a group to another project\'s list, even in the database', async () => {
      const { groups } = await matrix();
      const other = await createProject('Other');
      const foreign = await listWith(other.id, 'Theirs', 'x-1\n');
      await expect(
        pool.query('INSERT INTO tale_group_user_lists (tale_group_id, user_list_id, project_id) VALUES ($1, $2, $3)', [
          groups.a,
          foreign.id,
          other.id,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });

  describe('polls and their responses (epic interactive components, story 4.1)', () => {
    const pollId = '00000000-0000-4000-8000-0000000000aa';
    const textId = '00000000-0000-4000-8000-0000000000bb';
    const visitorA = '11111111-1111-4111-8111-111111111111';
    const visitorB = '22222222-2222-4222-8222-222222222222';

    function pollElement(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
      return {
        id: pollId,
        type: 'poll',
        box: { x: 0.1, y: 0.4, w: 0.8, h: 0.25, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: {
          question: 'Tea or coffee?',
          theme: 'light',
          options: [
            { id: 'tea', label: 'Tea' },
            { id: 'coffee', label: 'Coffee' },
          ],
          ...props,
        },
        ...extra,
      };
    }

    function textElement() {
      return {
        id: textId,
        type: 'text',
        box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1, rotation: 0 },
        hidden: false,
        locked: false,
        a11y: {},
        props: { text: 'Morning' },
      };
    }

    function pollDoc(elements: unknown[] = [textElement(), pollElement()]) {
      return { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements };
    }

    function saveDoc(taleId: string, document: unknown, revision: number): Promise<Response> {
      return fetch(`${base}/tales/${taleId}/document`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document, revision }),
      });
    }

    // A zone installed with its project's site key, holding a live group with one shown tale whose
    // published document holds `elements`.
    async function livePoll(elements?: unknown[]) {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      expect((await saveDoc(tale.id, pollDoc(elements), 0)).status).toBe(200);
      expect((await post(`/tales/${tale.id}/document/publish`, { revision: 1, publishedRevision: 0 })).status).toBe(200);
      await publish('tale-groups', group.id);
      const handle = await installZone(zone.id);
      return { zone, group, tale, handle };
    }

    // Posts a response as the Web SDK does: site key, slug, visitor id and a JSON body.
    function respond(handle: string, body: unknown, visitor: string | null = visitorA, headers: Record<string, string> = {}) {
      const [key, slug = ''] = handle.split('|');
      return globalThis.fetch(`${origin}/delivery/v1/responses?zone=${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(visitor !== null && { 'X-TaleArt-Visitor': visitor }),
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    }

    function vote(handle: string, taleId: string, value: unknown, visitor: string | null = visitorA) {
      return respond(handle, { taleId, elementId: pollId, value }, visitor);
    }

    async function rows() {
      return (
        await pool.query(
          `SELECT project_id AS "projectId", zone_id AS "zoneId", frame_id AS "frameId", tale_group_id AS "taleGroupId",
             tale_id AS "taleId", element_id AS "elementId", element_type AS "elementType", interaction, value,
             visitor_id AS "visitorId", client_at AS "clientAt", created_at AS "createdAt"
           FROM interactive_responses ORDER BY created_at, visitor_id`,
        )
      ).rows;
    }

    describe('the poll element type', () => {
      async function newTale() {
        const zone = await createZone();
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
        return (await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json()) as { id: string };
      }

      async function refusedAt(document: unknown): Promise<string> {
        const tale = await newTale();
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('invalid_tale_document');
        return body.error.pointer;
      }

      it('saves a poll and reads it back', async () => {
        const tale = await newTale();
        const document = pollDoc([pollElement({}, { title: 'Morning' })]);
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document).toEqual(document);
      });

      it('refuses a second poll in one tale, hidden or not', async () => {
        const second = { ...pollElement({ hidden: true }), id: '00000000-0000-4000-8000-0000000000cc' };
        expect(await refusedAt(pollDoc([pollElement(), second]))).toBe('/elements/1/type');
      });

      it('refuses options with the same id, blank text, a line feed, three options and unknown props', async () => {
        const same = [
          { id: 'tea', label: 'Tea' },
          { id: 'tea', label: 'Coffee' },
        ];
        expect(await refusedAt(pollDoc([pollElement({}, { options: same })]))).toBe('/elements/0/props/options/1/id');
        expect(await refusedAt(pollDoc([pollElement({}, { question: '   ' })]))).toBe('/elements/0/props/question');
        expect(await refusedAt(pollDoc([pollElement({}, { question: 'Tea\nor coffee?' })]))).toBe(
          '/elements/0/props/question',
        );
        const three = [...same.slice(0, 1), { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
        expect(await refusedAt(pollDoc([pollElement({}, { options: three })]))).toBe('/elements/0/props/options');
        expect(await refusedAt(pollDoc([pollElement({}, { html: '<b>' })]))).toBe('/elements/0/props/html');
      });

      it('keeps markup in a question as plain text', async () => {
        const tale = await newTale();
        const document = pollDoc([pollElement({}, { question: '<img src=x onerror=alert(1)>' })]);
        expect((await saveDoc(tale.id, document, 0)).status).toBe(200);
      });
    });

    describe('POST /delivery/v1/responses', () => {
      it('records a vote with the AD-10 keys and answers the counts and percentages', async () => {
        const { zone, group, tale, handle } = await livePoll();
        const res = await respond(handle, {
          taleId: tale.id,
          elementId: pollId,
          value: 'tea',
          clientAt: '2026-10-23T10:00:00.000Z',
        });
        expect(res.status).toBe(201);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
        expect(await res.json()).toEqual({
          elementId: pollId,
          value: 'tea',
          recorded: true,
          result: {
            total: 1,
            choices: [
              { id: 'tea', count: 1, percent: 100 },
              { id: 'coffee', count: 0, percent: 0 },
            ],
          },
        });
        const frameId = (await pool.query('SELECT id FROM frames WHERE zone_id = $1', [zone.id])).rows[0].id;
        expect(await rows()).toEqual([
          {
            projectId: zone.projectId,
            zoneId: zone.id,
            frameId,
            taleGroupId: group.id,
            taleId: tale.id,
            elementId: pollId,
            elementType: 'poll',
            interaction: 'vote',
            value: 'tea',
            visitorId: visitorA,
            clientAt: new Date('2026-10-23T10:00:00.000Z'),
            createdAt: expect.any(Date),
          },
        ]);
      });

      it('keeps the first vote: a repeat answers 200 with the stored one (C9)', async () => {
        const { tale, handle } = await livePoll();
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);
        const repeat = await vote(handle, tale.id, 'coffee');
        expect(repeat.status).toBe(200);
        expect(await repeat.json()).toMatchObject({ value: 'tea', recorded: false, result: { total: 1 } });
        // The same id in uppercase is the same visitor.
        expect((await vote(handle, tale.id, 'coffee', visitorA.toUpperCase())).status).toBe(200);
        const other = await vote(handle, tale.id, 'coffee', visitorB);
        expect(other.status).toBe(201);
        expect((await other.json()).result).toEqual({
          total: 2,
          choices: [
            { id: 'tea', count: 1, percent: 50 },
            { id: 'coffee', count: 1, percent: 50 },
          ],
        });
        expect((await rows()).map((r) => [r.visitorId, r.value])).toEqual([
          [visitorA, 'tea'],
          [visitorB, 'coffee'],
        ]);
      });

      it('refuses a missing or invalid visitor id with 400 visitor_id_required', async () => {
        const { tale, handle } = await livePoll();
        for (const visitor of [null, 'not-a-uuid', '11111111-1111-1111-8111-111111111111', 'Aa111111-1111-4111-8111-111111111111']) {
          const res = await vote(handle, tale.id, 'tea', visitor);
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe('visitor_id_required');
        }
        expect(await rows()).toEqual([]);
      });

      it('refuses an unknown element, an element that is no poll and an option id the poll lacks', async () => {
        const { tale, handle } = await livePoll();
        const unknown = await respond(handle, { taleId: tale.id, elementId: '00000000-0000-4000-8000-0000000000ff', value: 'tea' });
        expect(unknown.status).toBe(404);
        expect((await unknown.json()).error.code).toBe('response_target_not_found');
        const notPoll = await respond(handle, { taleId: tale.id, elementId: textId, value: 'tea' });
        expect(notPoll.status).toBe(404);
        for (const value of ['milk', 'Tea', '', 7, null]) {
          const res = await vote(handle, tale.id, value);
          expect(res.status).toBe(422);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
        expect(await rows()).toEqual([]);
      });

      it('refuses a malformed body with 400', async () => {
        const { tale, handle } = await livePoll();
        for (const body of [
          '{not json',
          [],
          { elementId: pollId, value: 'tea' },
          { taleId: tale.id, elementId: pollId },
          { taleId: tale.id, elementId: pollId, value: 'tea', extra: 1 },
          { taleId: tale.id, elementId: pollId, value: 'tea', clientAt: 'yesterday' },
        ]) {
          const res = await respond(handle, body);
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
      });

      it('refuses a hidden tale, a group turned off, and a poll only in the draft', async () => {
        const { group, tale, handle } = await livePoll();
        expect((await setStatus('tales', tale.id, 'paused')).status).toBe(200);
        const hidden = await vote(handle, tale.id, 'tea');
        expect(hidden.status).toBe(404);
        expect((await hidden.json()).error.code).toBe('response_target_not_found');
        await publish('tales', tale.id);
        expect((await setStatus('tale-groups', group.id, 'paused')).status).toBe(200);
        expect((await vote(handle, tale.id, 'tea')).status).toBe(404);
        await publish('tale-groups', group.id);
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);

        // A poll added to the draft is not on the site until the tale is updated.
        const draftOnly = await livePoll([textElement()]);
        expect((await saveDoc(draftOnly.tale.id, pollDoc(), 1)).status).toBe(200);
        expect((await vote(draftOnly.handle, draftOnly.tale.id, 'tea')).status).toBe(404);
        // A poll the published document hides is not shown either.
        const hiddenPoll = await livePoll([pollElement({ hidden: true })]);
        expect((await vote(hiddenPoll.handle, hiddenPoll.tale.id, 'tea')).status).toBe(404);
      });

      it("refuses another project's site key, and a tale of another project", async () => {
        const first = await livePoll();
        const second = await livePoll();
        const [firstKey] = first.handle.split('|');
        const [secondKey] = second.handle.split('|');
        // Both zones were made with the same slug; the first one's becomes its own.
        await pool.query("UPDATE zones SET slug = 'first-bar' WHERE id = $1", [first.zone.id]);
        const firstSlug = 'first-bar';
        // The second project's key with the first's zone: the slug is not one of its zones.
        const wrongKey = await vote(`${secondKey}|${firstSlug}`, first.tale.id, 'tea');
        expect(wrongKey.status).toBe(401);
        expect((await wrongKey.json()).error.code).toBe('invalid_site_key');
        // The first project's key and zone, naming the second project's tale.
        const otherTale = await vote(`${firstKey}|${firstSlug}`, second.tale.id, 'tea');
        expect(otherTale.status).toBe(404);
        expect(await rows()).toEqual([]);
      });

      it('allows the POST and the visitor header in a preflight', async () => {
        const { handle } = await livePoll();
        const slug = handle.split('|')[1];
        const res = await globalThis.fetch(`${origin}/delivery/v1/responses?zone=${slug}`, {
          method: 'OPTIONS',
          headers: { Origin: 'https://shop.example', 'Access-Control-Request-Method': 'POST' },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
        expect(res.headers.get('access-control-allow-headers')).toContain('X-TaleArt-Visitor');
      });

      it("deletes a tale's responses with the tale", async () => {
        const { tale, handle } = await livePoll();
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);
        expect((await fetch(`${base}/tales/${tale.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(await rows()).toEqual([]);
      });

      it('keeps one row when the same visitor votes twice at once, and answers both alike', async () => {
        const { tale, handle } = await livePoll();
        const [first, second] = await Promise.all([vote(handle, tale.id, 'tea'), vote(handle, tale.id, 'coffee')]);
        expect([first.status, second.status].sort()).toEqual([200, 201]);
        const [a, b] = [await first.json(), await second.json()];
        expect(a.value).toBe(b.value);
        expect(a.result).toEqual(b.result);
        expect(a.result.total).toBe(1);
        expect((await rows()).map((r) => r.value)).toEqual([a.value]);
      });

      it('refuses a tale outside its window, an archived tale and a group not placed in the named zone', async () => {
        const ended = await livePoll();
        // Times from this process's clock, which the API compares with (the database's may differ).
        const hour = 60 * 60 * 1000;
        await pool.query('UPDATE tales SET ends_at = $2 WHERE id = $1', [ended.tale.id, new Date(Date.now() - hour)]);
        const late = await vote(ended.handle, ended.tale.id, 'tea');
        expect(late.status).toBe(404);
        expect((await late.json()).error.code).toBe('response_target_not_found');
        await pool.query('UPDATE tales SET ends_at = NULL, starts_at = $2 WHERE id = $1', [
          ended.tale.id,
          new Date(Date.now() + hour),
        ]);
        expect((await vote(ended.handle, ended.tale.id, 'tea')).status).toBe(404);

        const archived = await livePoll();
        expect((await setStatus('tales', archived.tale.id, 'archived')).status).toBe(200);
        expect((await vote(archived.handle, archived.tale.id, 'tea')).status).toBe(404);

        // Another zone of the same project, installed, where the poll's group is not placed.
        const placed = await livePoll();
        const other = await (await post('/zones', { name: 'Footer', projectId: placed.zone.projectId })).json();
        const otherHandle = await installZone(other.id);
        expect(otherHandle.split('|')[0]).toBe(placed.handle.split('|')[0]);
        const elsewhere = await vote(otherHandle, placed.tale.id, 'tea');
        expect(elsewhere.status).toBe(404);
        expect((await elsewhere.json()).error.code).toBe('response_target_not_found');
        expect((await vote(placed.handle, placed.tale.id, 'tea')).status).toBe(201);
        expect(await rows()).toHaveLength(1);
      });

      it('refuses a body over 4 KB and a malformed one before the key check, with the Delivery CORS headers', async () => {
        const { tale, handle } = await livePoll();
        const big = await respond(handle, { taleId: tale.id, elementId: pollId, value: 'tea', clientAt: 'x'.repeat(5000) });
        expect(big.status).toBe(413);
        expect(big.headers.get('access-control-allow-origin')).toBe('*');
        expect((await big.json()).error.code).toBe('validation_failed');
        // Even with no key: the body is refused before the key lookups.
        const keyless = await respond(`nope|${handle.split('|')[1]}`, 'x'.repeat(5000));
        expect(keyless.status).toBe(413);
        const garbled = await respond(handle, '{not json');
        expect(garbled.status).toBe(400);
        expect(garbled.headers.get('access-control-allow-origin')).toBe('*');
        expect((await garbled.json()).error.code).toBe('validation_failed');
        // Just under the limit is read, and refused only for what it says.
        const fits = await respond(handle, { taleId: tale.id, elementId: pollId, value: 'tea', clientAt: 'x'.repeat(3500) });
        expect(fits.status).toBe(400);
        expect(await rows()).toEqual([]);
      });

      it('limits writes per visitor more strictly than reads', async () => {
        const limited = createApp(
          pool,
          loadFrameTypeRegistry(frameTypesDir),
          new LocalDiskStorage(mediaDir),
          { verifier: fakeVerifier },
          { publicApiUrl },
          undefined,
          { rateLimit: { burst: 100, perSecond: 1 }, responseRateLimit: { burst: 2, perSecond: 0.01 } },
        ).listen(0);
        await new Promise<void>((resolve) => limited.once('listening', () => resolve()));
        try {
          const { tale, handle } = await livePoll();
          const [key, slug] = handle.split('|');
          const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/delivery/v1/responses?zone=${slug}`;
          const send = (visitor: string) =>
            globalThis.fetch(url, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-TaleArt-Visitor': visitor },
              body: JSON.stringify({ taleId: tale.id, elementId: pollId, value: 'tea' }),
            });
          expect((await send(visitorA)).status).toBe(201);
          expect((await send(visitorA)).status).toBe(200);
          const third = await send(visitorA);
          expect(third.status).toBe(429);
          expect((await third.json()).error.code).toBe('rate_limited');
          expect(third.headers.get('retry-after')).toMatch(/^\d+$/);
          // Another visitor has its own allowance; reading the zone is not limited by votes.
          expect((await send(visitorB)).status).toBe(201);
          const zone = await globalThis.fetch(url.replace('/responses', '/zone'), {
            headers: { Authorization: `Bearer ${key}`, 'X-TaleArt-Visitor': visitorA },
          });
          expect(zone.status).toBe(200);
        } finally {
          await new Promise<void>((resolve) => limited.close(() => resolve()));
        }
      });
    });

    describe('GET /api/v1/tales/{taleId}/responses', () => {
      it('counts the responses per poll and option for the studio', async () => {
        const { tale, handle } = await livePoll();
        let res = await fetch(`${base}/tales/${tale.id}/responses`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ elements: [] });
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);
        res = await fetch(`${base}/tales/${tale.id}/responses`);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({
          elements: [{ elementId: pollId, elementType: 'poll', total: 1, values: [{ value: 'tea', count: 1 }] }],
        });
      });

      it('keeps an option count when its label is edited', async () => {
        const { tale, handle } = await livePoll();
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);
        const renamed = pollDoc([textElement(), pollElement({}, { options: [{ id: 'tea', label: 'Green tea' }, { id: 'coffee', label: 'Coffee' }] })]);
        expect((await saveDoc(tale.id, renamed, 1)).status).toBe(200);
        expect((await post(`/tales/${tale.id}/document/publish`, { revision: 2, publishedRevision: 1 })).status).toBe(200);
        const res = await vote(handle, tale.id, 'tea', visitorB);
        expect((await res.json()).result.choices[0]).toEqual({ id: 'tea', count: 2, percent: 100 });
      });

      it('answers 404 for an unknown tale and 403 for a tale of a project the caller cannot access', async () => {
        const { tale } = await livePoll();
        expect((await fetch(`${base}/tales/00000000-0000-4000-8000-000000000000/responses`)).status).toBe(404);
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        const res = await fetch(`${base}/tales/${tale.id}/responses`);
        expect(res.status).toBe(403);
        expect((await res.json()).error.code).toBe('forbidden');
      });
    });

    describe('Ratings (epic interactive components, story 4.2)', () => {
      const ratingId = '00000000-0000-4000-8000-0000000000dd';

      function ratingElement(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
        return {
          id: ratingId,
          type: 'rating',
          box: { x: 0.1, y: 0.7, w: 0.8, h: 0.2, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { question: 'How was the beach?', emoji: '❤️', theme: 'dark', ...props },
          ...extra,
        };
      }

      function rate(handle: string, taleId: string, value: unknown, visitor: string | null = visitorA) {
        return respond(handle, { taleId, elementId: ratingId, value }, visitor);
      }

      async function newTale() {
        const zone = await createZone();
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
        return (await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json()) as { id: string };
      }

      async function refusedAt(document: unknown): Promise<string> {
        const tale = await newTale();
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('invalid_tale_document');
        return body.error.pointer;
      }

      it('saves a Rating beside a poll and reads it back', async () => {
        const tale = await newTale();
        const document = pollDoc([pollElement(), ratingElement({}, { title: 'Quick one' })]);
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document).toEqual(document);
      });

      it("refuses an emoji that is not one emoji (such as 'ab'), a second Rating, a line feed and an unknown prop", async () => {
        expect(await refusedAt(pollDoc([ratingElement({}, { emoji: 'ab' })]))).toBe('/elements/0/props/emoji');
        expect(await refusedAt(pollDoc([ratingElement({}, { emoji: '❤️❤️' })]))).toBe('/elements/0/props/emoji');
        const second = { ...ratingElement({ hidden: true }), id: '00000000-0000-4000-8000-0000000000ee' };
        expect(await refusedAt(pollDoc([ratingElement(), second]))).toBe('/elements/1/type');
        expect(await refusedAt(pollDoc([ratingElement({}, { question: 'How\nwas it?' })]))).toBe('/elements/0/props/question');
        expect(await refusedAt(pollDoc([ratingElement({}, { value: 50 })]))).toBe('/elements/0/props/value');
      });

      it('records ratings once per visitor and answers the count and average', async () => {
        const { tale, handle } = await livePoll([textElement(), ratingElement()]);
        const first = await rate(handle, tale.id, '80');
        expect(first.status).toBe(201);
        expect(await first.json()).toEqual({ elementId: ratingId, value: '80', recorded: true, result: { total: 1, average: 80 } });
        const second = await rate(handle, tale.id, '40', visitorB);
        expect(second.status).toBe(201);
        expect((await second.json()).result).toEqual({ total: 2, average: 60 });
        // The first rating wins (C9).
        const repeat = await rate(handle, tale.id, '0');
        expect(repeat.status).toBe(200);
        expect(await repeat.json()).toEqual({ elementId: ratingId, value: '80', recorded: false, result: { total: 2, average: 60 } });
        expect((await rows()).map((r) => [r.elementType, r.interaction, r.value])).toEqual([
          ['rating', 'rate', '80'],
          ['rating', 'rate', '40'],
        ]);
        const counts = await (await fetch(`${base}/tales/${tale.id}/responses`)).json();
        expect(counts.elements).toEqual([
          { elementId: ratingId, elementType: 'rating', total: 2, values: [{ value: '40', count: 1 }, { value: '80', count: 1 }] },
        ]);
      });

      it('refuses a value that is no whole number from 0 to 100', async () => {
        const { tale, handle } = await livePoll([ratingElement()]);
        for (const value of ['101', '-10', '080', '8.5', ' 80', '80 ', '1e2', '0x50', 'tea', '', 80, null]) {
          const res = await rate(handle, tale.id, value);
          expect(res.status).toBe(422);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
        expect(await rows()).toEqual([]);
      });

      it("checks each value against its own component: a poll's option id is no rating, a rating no option", async () => {
        const { tale, handle } = await livePoll([pollElement(), ratingElement()]);
        const optionToRating = await rate(handle, tale.id, 'tea');
        expect(optionToRating.status).toBe(422);
        expect((await optionToRating.json()).error.code).toBe('validation_failed');
        const ratingToPoll = await vote(handle, tale.id, '80');
        expect(ratingToPoll.status).toBe(422);
        expect(await rows()).toEqual([]);
        // Each takes its own kind of value, and counts apart.
        expect((await vote(handle, tale.id, 'tea')).status).toBe(201);
        const rated = await rate(handle, tale.id, '80');
        expect(rated.status).toBe(201);
        expect((await rated.json()).result).toEqual({ total: 1, average: 80 });
      });
    });

    describe('Reactions (components, 2026-10-29)', () => {
      const reactionId = '00000000-0000-4000-8000-0000000000ff';
      const visitorC = '33333333-3333-4333-8333-333333333333';

      function reactionElement(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
        return {
          id: reactionId,
          type: 'reaction',
          box: { x: 0.1, y: 0.7, w: 0.8, h: 0.2, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { question: 'How was the beach?', emojis: ['❤️', '😂', '😮'], theme: 'dark', ...props },
          ...extra,
        };
      }

      function tap(handle: string, taleId: string, value: unknown, visitor: string | null = visitorA) {
        return respond(handle, { taleId, elementId: reactionId, value }, visitor);
      }

      async function newTale() {
        const zone = await createZone();
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
        return (await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json()) as { id: string };
      }

      async function refusedAt(document: unknown): Promise<string> {
        const tale = await newTale();
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('invalid_tale_document');
        return body.error.pointer;
      }

      it('saves a Reaction beside a poll and reads it back', async () => {
        const tale = await newTale();
        const document = pollDoc([pollElement(), reactionElement({}, { title: 'Your mood' })]);
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document).toEqual(document);
      });

      it('refuses one emoji, seven, a duplicate, a non-emoji entry and a second Reaction', async () => {
        expect(await refusedAt(pollDoc([reactionElement({}, { emojis: ['❤️'] })]))).toBe('/elements/0/props/emojis');
        expect(
          await refusedAt(pollDoc([reactionElement({}, { emojis: ['👍', '👎', '🤔', '🔥', '🎉', '👏', '😮'] })])),
        ).toBe('/elements/0/props/emojis');
        expect(await refusedAt(pollDoc([reactionElement({}, { emojis: ['❤️', '❤️'] })]))).toBe('/elements/0/props/emojis');
        expect(await refusedAt(pollDoc([reactionElement({}, { emojis: ['❤️', 'love'] })]))).toBe('/elements/0/props/emojis/1');
        const second = { ...reactionElement({ hidden: true }), id: '00000000-0000-4000-8000-0000000000fe' };
        expect(await refusedAt(pollDoc([reactionElement(), second]))).toBe('/elements/1/type');
      });

      it('records one tap per visitor, counts each emoji and refuses an emoji the reaction does not offer', async () => {
        const { tale, handle } = await livePoll([textElement(), reactionElement()]);
        const first = await tap(handle, tale.id, '😂');
        expect(first.status).toBe(201);
        expect(await first.json()).toEqual({
          elementId: reactionId,
          value: '😂',
          recorded: true,
          result: { total: 1, reactions: [{ emoji: '❤️', count: 0 }, { emoji: '😂', count: 1 }, { emoji: '😮', count: 0 }] },
        });
        const second = await tap(handle, tale.id, '❤️', visitorB);
        expect((await second.json()).result.total).toBe(2);
        // The first tap wins (C9).
        const repeat = await tap(handle, tale.id, '😮');
        expect(repeat.status).toBe(200);
        expect(await repeat.json()).toMatchObject({ value: '😂', recorded: false });
        for (const value of ['🔥', 'tea', '', '❤', 1, null]) {
          expect((await tap(handle, tale.id, value, visitorC)).status).toBe(422);
        }
        expect((await rows()).map((r) => [r.elementType, r.interaction, r.value])).toEqual([
          ['reaction', 'react', '😂'],
          ['reaction', 'react', '❤️'],
        ]);
        const counts = await (await fetch(`${base}/tales/${tale.id}/responses`)).json();
        expect(counts.elements).toEqual([
          { elementId: reactionId, elementType: 'reaction', total: 2, values: [{ value: '❤️', count: 1 }, { value: '😂', count: 1 }] },
        ]);
      });
    });

    describe('quizzes (epic interactive components, story 4.3)', () => {
      const quizId = '00000000-0000-4000-8000-0000000000cc';
      const answers = [
        { id: 'a', label: 'Mercury' },
        { id: 'b', label: 'Venus' },
        { id: 'c', label: 'Earth' },
        { id: 'd', label: 'Mars' },
      ];

      function quizElement(extra: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
        return {
          id: quizId,
          type: 'quiz',
          box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { question: 'Which planet is hottest?', answers, correctAnswerId: 'b', theme: 'light', ...props },
          ...extra,
        };
      }

      function answer(handle: string, taleId: string, value: unknown, visitor: string | null = visitorA) {
        return respond(handle, { taleId, elementId: quizId, value }, visitor);
      }

      async function newTale() {
        const zone = await createZone();
        const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
        return (await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json()) as { id: string };
      }

      async function refusedAt(document: unknown): Promise<string> {
        const tale = await newTale();
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe('invalid_tale_document');
        return body.error.pointer;
      }

      it('saves a four-answer quiz with a correct answer beside a poll and a Rating, and a quiz without one', async () => {
        const tale = await newTale();
        const rating = {
          id: '00000000-0000-4000-8000-0000000000dd',
          type: 'rating',
          box: { x: 0.1, y: 0.8, w: 0.8, h: 0.15, rotation: 0 },
          hidden: false,
          locked: false,
          a11y: {},
          props: { question: 'How was it?', emoji: '❤️', theme: 'dark' },
        };
        const document = pollDoc([pollElement(), rating, quizElement({}, { title: 'Space' })]);
        const res = await saveDoc(tale.id, document, 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document).toEqual(document);
        const survey = quizElement({}, { answers: answers.slice(0, 2) });
        delete (survey.props as Record<string, unknown>)['correctAnswerId'];
        const other = await newTale();
        expect((await saveDoc(other.id, pollDoc([survey]), 0)).status).toBe(200);
      });

      it('keeps answer text in Unicode NFC, ids as they are', async () => {
        const tale = await newTale();
        const decomposed = [{ id: 'a', label: 'Café' }, answers[1]];
        const res = await saveDoc(tale.id, pollDoc([quizElement({}, { answers: decomposed, correctAnswerId: 'a' })]), 0);
        expect(res.status).toBe(200);
        expect((await res.json()).document.elements[0].props.answers).toEqual([{ id: 'a', label: 'Café' }, answers[1]]);
      });

      it('refuses five answers, a correct id that is not an answer, repeated ids, a second quiz and a line feed', async () => {
        const five = [...answers, { id: 'e', label: 'Jupiter' }];
        expect(await refusedAt(pollDoc([quizElement({}, { answers: five })]))).toBe('/elements/0/props/answers');
        expect(await refusedAt(pollDoc([quizElement({}, { answers: answers.slice(0, 1), correctAnswerId: 'a' })]))).toBe(
          '/elements/0/props/answers',
        );
        expect(await refusedAt(pollDoc([quizElement({}, { correctAnswerId: 'e' })]))).toBe('/elements/0/props/correctAnswerId');
        const repeated = [answers[0], { ...answers[1], id: 'a' }];
        expect(await refusedAt(pollDoc([quizElement({}, { answers: repeated, correctAnswerId: 'a' })]))).toBe(
          '/elements/0/props/answers/1/id',
        );
        const second = { ...quizElement({ hidden: true }), id: '00000000-0000-4000-8000-0000000000ee' };
        expect(await refusedAt(pollDoc([quizElement(), second]))).toBe('/elements/1/type');
        const lineFeed = [answers[0], { id: 'b', label: 'Ve\nnus' }];
        expect(await refusedAt(pollDoc([quizElement({}, { answers: lineFeed })]))).toBe('/elements/0/props/answers/1/label');
        expect(await refusedAt(pollDoc([quizElement({}, { correct: 'b' })]))).toBe('/elements/0/props/correct');
      });

      it('records answers once per visitor and answers the counts per answer, without saying which is right', async () => {
        const { tale, handle } = await livePoll([textElement(), quizElement()]);
        const first = await answer(handle, tale.id, 'c');
        expect(first.status).toBe(201);
        const body = await first.json();
        expect(body).toEqual({
          elementId: quizId,
          value: 'c',
          recorded: true,
          result: {
            total: 1,
            choices: [
              { id: 'a', count: 0, percent: 0 },
              { id: 'b', count: 0, percent: 0 },
              { id: 'c', count: 1, percent: 100 },
              { id: 'd', count: 0, percent: 0 },
            ],
          },
        });
        expect(JSON.stringify(body)).not.toContain('correct');
        expect((await answer(handle, tale.id, 'b', visitorB)).status).toBe(201);
        // The first answer wins (C9).
        const repeat = await answer(handle, tale.id, 'b');
        expect(repeat.status).toBe(200);
        const again = await repeat.json();
        expect(again.value).toBe('c');
        expect(again.recorded).toBe(false);
        expect(again.result.choices.map((c: { percent: number }) => c.percent)).toEqual([0, 50, 50, 0]);
        expect((await rows()).map((r) => [r.elementType, r.interaction, r.value])).toEqual([
          ['quiz', 'answer', 'c'],
          ['quiz', 'answer', 'b'],
        ]);
      });

      it("refuses a value that is none of the published quiz's answer ids", async () => {
        const { tale, handle } = await livePoll([pollElement(), quizElement()]);
        for (const value of ['e', 'tea', 'Venus', 'B', '80', '', 2, null]) {
          const res = await answer(handle, tale.id, value);
          expect(res.status).toBe(422);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
        expect(await rows()).toEqual([]);
      });

      it("refuses a real option id of the tale's poll posted to its quiz, and records it for neither", async () => {
        const { tale, handle } = await livePoll([pollElement(), quizElement()]);
        const res = await answer(handle, tale.id, 'coffee');
        expect(res.status).toBe(422);
        expect((await res.json()).error.code).toBe('validation_failed');
        expect(await rows()).toEqual([]);
        // The same id is a vote on the poll itself.
        expect((await vote(handle, tale.id, 'coffee')).status).toBe(201);
      });

      it('checks answers against the published quiz: a removed answer is refused and its count left out', async () => {
        const { tale, handle } = await livePoll([quizElement()]);
        expect((await answer(handle, tale.id, 'd')).status).toBe(201);
        expect((await answer(handle, tale.id, 'b', visitorB)).status).toBe(201);
        // Answer D is removed and B's text edited, then the tale is updated again.
        const edited = [answers[0], { id: 'b', label: 'Venus, second' }, answers[2]];
        expect((await saveDoc(tale.id, pollDoc([quizElement({}, { answers: edited })]), 1)).status).toBe(200);
        expect((await post(`/tales/${tale.id}/document/publish`, { revision: 2, publishedRevision: 1 })).status).toBe(200);
        const visitorC = '33333333-3333-4333-8333-333333333333';
        expect((await answer(handle, tale.id, 'd', visitorC)).status).toBe(422);
        const res = await answer(handle, tale.id, 'b', visitorC);
        expect(res.status).toBe(201);
        expect((await res.json()).result).toEqual({
          total: 2,
          choices: [
            { id: 'a', count: 0, percent: 0 },
            { id: 'b', count: 2, percent: 100 },
            { id: 'c', count: 0, percent: 0 },
          ],
        });
        // The studio reads every stored value; its panel lists only the answers the draft holds now.
        const counts = await (await fetch(`${base}/tales/${tale.id}/responses`)).json();
        expect(counts.elements).toEqual([
          { elementId: quizId, elementType: 'quiz', total: 3, values: [{ value: 'b', count: 2 }, { value: 'd', count: 1 }] },
        ]);
      });
    });
  });

  describe('a lost database connection never crashes the API (epic UX rework story 8.24)', () => {
    const health = async () => (await fetch(`${base}/health`)).status;
    // Every connection the pool hands out works: a broken client returned to it would fail one.
    async function poolServes(): Promise<void> {
      const results = await Promise.all(
        Array.from({ length: databasePoolMax() + 5 }, () => pool.query<{ one: number }>('SELECT 1 AS one')),
      );
      expect(results.every((r) => r.rows[0].one === 1)).toBe(true);
    }

    beforeEach(() => {
      // The API logs the failed requests; these tests are about them.
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => vi.restoreAllMocks());

    it('fails a request whose transaction loses its session, keeps serving and recovers the pool', async () => {
      const zone = await createZone();
      const blocker = await pool.connect();
      try {
        // Creating a tale group takes the zone's lock inside the shared inTransaction: held here, the
        // request waits on it with its client checked out, and its session is ended there.
        await blocker.query('BEGIN');
        await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_groups:' || $1, 0))", [zone.id]);
        const pending = post(`/zones/${zone.id}/tale-groups`, { name: 'Lost' });
        await terminateBackend(await waitForBackend('$1 = ANY(blocked_by)', [await backendPid(blocker)]));
        const res = await pending;
        expect(res.status).toBe(500);
        expect((await res.json()).error.code).toBe('internal_error');
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        blocker.release(true);
      }
      expect(await health()).toBe(200);
      await poolServes();
      // Nothing of the failed request was stored, and the same request now succeeds.
      expect((await pool.query('SELECT 1 FROM tale_groups')).rowCount).toBe(0);
      expect((await post(`/zones/${zone.id}/tale-groups`, { name: 'Found' })).status).toBe(201);
    }, 20_000);

    it(
      'fails the migrations cleanly, with the cause, when the session holding the migration lock ends, and runs them again',
      async () => {
        const starting = createPool(testDatabaseUrl, 3);
        const blocker = await pool.connect();
        let migrating: Promise<unknown> = Promise.resolve(null);
        try {
          // The migrations take the migration lock, then wait on the tales table, held here.
          await blocker.query('BEGIN');
          await blocker.query('LOCK TABLE tales IN ACCESS EXCLUSIVE MODE');
          migrating = migrate(starting).then(
            () => null,
            (err: unknown) => err,
          );
          const pid = await waitForBackend(
            `$1 = ANY(blocked_by) AND pid IN (SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted
               AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('taleart:migrations', 0))`,
            [await backendPid(blocker)],
          );
          await terminateBackend(pid);
          // The cause is the database's, not the follow-up "Connection terminated" of a later query.
          const failure = await migrating;
          expect(failure).toBeInstanceOf(Error);
          expect(failure).toMatchObject({
            code: '57P01',
            message: expect.stringMatching(/terminating connection due to administrator command/),
          });
          await blocker.query('COMMIT');
          // The lock went with the session: the next start takes it and runs every migration.
          await migrate(starting);
          expect((await starting.query<{ one: number }>('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
        } finally {
          await blocker.query('ROLLBACK').catch(() => undefined);
          blocker.release(true);
          await migrating;
          await starting.end();
        }
        expect(await health()).toBe(200);
        await poolServes();
      },
      20_000,
    );

    // 1200 tales from before documents, out of step, for the background migration.
    async function legacyTales(many: number): Promise<void> {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Summer' })).json();
      await pool.query(
        `INSERT INTO tales (tale_group_id, project_id, title, position, status, media_key, media_content_type)
         SELECT $1, project_id, 'T' || n, n, 'live', 'tales/' || gen_random_uuid() || '.png', 'image/png'
         FROM tale_groups, generate_series(1, $2) AS n WHERE tale_groups.id = $1`,
        [group.id, many],
      );
    }

    async function expectMigrationFinished(): Promise<void> {
      const { rows } = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM tales WHERE media_key IS NOT NULL AND document_media_key IS DISTINCT FROM media_key',
      );
      expect(rows[0].n).toBe(0);
      // No session holds the lock any more.
      const free = await pool.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('taleart:tale-media-migration', 0)) AS locked,
           pg_advisory_unlock(hashtextextended('taleart:tale-media-migration', 0)) AS unlocked`,
      );
      expect(free.rows[0].locked).toBe(true);
      expect(await health()).toBe(200);
      await poolServes();
    }

    // Runs the background migration with its first batch held on the tales table, ends the lock
    // holder's session with `end` while it idles with the lock, then lets the batch go on.
    async function continueWithHolderLost(
      db: Parameters<typeof continueTaleMediaMigration>[0],
      end: () => Promise<void>,
      log: ReturnType<typeof vi.fn>,
    ): Promise<Awaited<ReturnType<typeof continueTaleMediaMigration>>> {
      const blocker = await pool.connect();
      let running: Promise<Awaited<ReturnType<typeof continueTaleMediaMigration>>> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE tales IN EXCLUSIVE MODE');
        running = continueTaleMediaMigration(db, { batchSize: 500, attempts: 3, baseDelayMs: 200, log });
        await waitForBackend('$1 = ANY(blocked_by)', [await backendPid(blocker)]);
        await end();
        await blocker.query('COMMIT');
        return await running;
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        blocker.release(true);
        await running?.catch(() => undefined);
      }
    }

    const holderPid = () =>
      waitForBackend(
        `pid IN (SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted
           AND ((classid::bigint << 32) | objid::bigint) = hashtextextended('taleart:tale-media-migration', 0))`,
      );

    it(
      "takes the background tale-media migration's lock again when the session holding it ends",
      async () => {
        await legacyTales(1200);
        const log = vi.fn();
        const result = await continueWithHolderLost(pool, async () => terminateBackend(await holderPid()), log);
        // The pass stopped after its batch in flight, failed, and the next one took the lock again.
        expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('the session holding the migration lock ended'));
        expect(result).toEqual({ merged: 1200, skipped: 0, done: true });
        await expectMigrationFinished();
      },
      20_000,
    );

    it(
      "takes the lock again when the holder's connection closes without a FATAL, not taking it for an ended pool",
      async () => {
        await legacyTales(1200);
        // The first client the migration checks out is its lock holder.
        const clients: PoolClient[] = [];
        const watched = {
          query: pool.query.bind(pool),
          connect: async () => {
            const client = await pool.connect();
            clients.push(client);
            return client;
          },
        } as unknown as Pool;
        const log = vi.fn();
        const result = await continueWithHolderLost(
          watched,
          async () => {
            await holderPid();
            // The socket closes under the client, as a dropped network link does: pg errors with
            // "Connection terminated unexpectedly" and no SQLSTATE.
            (clients[0] as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy();
          },
          log,
        );
        expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('the session holding the migration lock ended'));
        expect(result).toEqual({ merged: 1200, skipped: 0, done: true });
        await expectMigrationFinished();
      },
      20_000,
    );
  });

  describe('analytics (epic analytics): events and the zone analytics', () => {
    const VISITOR_A = '11111111-1111-4111-8111-111111111111';
    const VISITOR_B = '22222222-2222-4222-8222-222222222222';
    const VISITOR_C = '33333333-3333-4333-8333-333333333333';
    const VISITOR_D = '44444444-4444-4444-8444-444444444444';
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    const UNAUTHORIZED_BODY = { error: { code: 'invalid_site_key', message: 'A valid site key and zone are required' } };

    // A zone with a tale group placed in it and a tale in that group, and the zone's key.
    async function zoneWithTale(name = 'Summer') {
      const zone = await createZone();
      const group = await (await post(`/zones/${zone.id}/tale-groups`, { name })).json();
      const tale = await (await post(`/tale-groups/${group.id}/tales`, { title: 'Beach' })).json();
      const key = (await (await post(`/zones/${zone.id}/key`, {})).json()).key as string;
      return { zone, group, tale, key };
    }

    // Posts a request to the Delivery API's events, with the zone key as the bearer, the visitor
    // header and a JSON body (or a beacon's text body when `headers` says so).
    function sendEvents(key: string | null, body: unknown, visitor: string | null = VISITOR_A, headers: Record<string, string> = {}) {
      const all: Record<string, string> = { 'Content-Type': 'application/json', ...headers };
      if (key !== null) all['Authorization'] = `Bearer ${key}`;
      if (visitor !== null) all['X-TaleArt-Visitor'] = visitor;
      return globalThis.fetch(`${origin}/delivery/v1/events`, {
        method: 'POST',
        headers: all,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    }

    // Midnight UTC of today plus `days` and `hour` hours.
    function utcAt(days: number, hour = 10): string {
      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      return new Date(today + days * DAY + hour * HOUR).toISOString();
    }

    // Stores events straight in the table, for the metrics: the visitor's hash of the project, as the API stores it.
    async function seed(
      projectId: string,
      zoneId: string,
      events: { type: string; groupId: string; taleId?: string; visitor: string; at: string }[],
    ): Promise<void> {
      for (const event of events) {
        await pool.query(
          `INSERT INTO analytics_events (project_id, zone_id, group_id, tale_id, type, visitor_hash, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [projectId, zoneId, event.groupId, event.taleId ?? null, event.type, visitorHash(projectId, event.visitor), event.at],
        );
      }
    }

    function analytics(zoneId: string, period?: string): Promise<Response> {
      return fetch(`${base}/zones/${zoneId}/analytics${period === undefined ? '' : `?period=${period}`}`);
    }

    describe('POST /delivery/v1/events: ingest', () => {
      it('keeps the valid events of a request and drops the others, answering 202 with both counts', async () => {
        const { group, tale, key } = await zoneWithTale();
        const minutesAgo = new Date(Date.now() - 60_000).toISOString();
        const res = await sendEvents(key, {
          events: [
            { type: 'impression', groupId: group.id, at: minutesAgo },
            { type: 'open', groupId: group.id, at: minutesAgo },
            { type: 'view', groupId: group.id, taleId: tale.id, at: minutesAgo },
            { type: 'click', groupId: group.id, taleId: tale.id, at: minutesAgo },
            // Dropped: an answer is not an event, too old, too far ahead, a view without a tale, a tale on an
            // impression, a time with an offset instead of Z, and a field the spec does not name.
            { type: 'answer', groupId: group.id, at: minutesAgo },
            { type: 'impression', groupId: group.id, at: new Date(Date.now() - 8 * DAY).toISOString() },
            { type: 'impression', groupId: group.id, at: new Date(Date.now() + 2 * HOUR).toISOString() },
            { type: 'view', groupId: group.id, at: minutesAgo },
            { type: 'impression', groupId: group.id, taleId: tale.id, at: minutesAgo },
            { type: 'impression', groupId: group.id, at: '2026-10-29T10:00:00+02:00' },
            { type: 'impression', groupId: group.id, at: minutesAgo, ip: '203.0.113.7' },
          ],
        });
        expect(res.status).toBe(202);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.json()).toEqual({ accepted: 4, dropped: 7 });
        const stored = await pool.query<{ type: string }>('SELECT type FROM analytics_events ORDER BY id');
        expect(stored.rows.map((row) => row.type)).toEqual(['impression', 'open', 'view', 'click']);
      });

      it('accepts up to 50 events a request and refuses more with 400', async () => {
        const { group, key } = await zoneWithTale();
        const at = new Date(Date.now() - 1000).toISOString();
        const event = { type: 'impression', groupId: group.id, at };
        expect((await (await sendEvents(key, { events: Array(50).fill(event) })).json()).accepted).toBe(50);
        const tooMany = await sendEvents(key, { events: Array(51).fill(event) });
        expect(tooMany.status).toBe(400);
        expect((await tooMany.json()).error.code).toBe('validation_failed');
      });

      it('refuses a body that is not an object with an events list, or has a field the spec does not name', async () => {
        const { key } = await zoneWithTale();
        for (const body of [[], {}, { events: 'impression' }, { events: [], extra: 1 }]) {
          const res = await sendEvents(key, body);
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe('validation_failed');
        }
      });

      it('answers 400 visitor_id_required without a valid visitor id', async () => {
        const { group, key } = await zoneWithTale();
        const body = { events: [{ type: 'impression', groupId: group.id, at: utcAt(0, 0) }] };
        for (const visitor of [null, 'not-a-uuid', '11111111-1111-4111-8111-11111111111G']) {
          const res = await sendEvents(key, body, visitor);
          expect(res.status).toBe(400);
          expect((await res.json()).error.code).toBe('visitor_id_required');
        }
      });

      it('drops events naming a group or tale the key\'s zone does not hold, and keeps the others', async () => {
        const { zone, group, key } = await zoneWithTale();
        // Another zone of the same project, with its own group and tale.
        const second = await (await post('/zones', { name: 'Second', projectId: zone.projectId })).json();
        const otherGroup = await (await post(`/zones/${second.id}/tale-groups`, { name: 'Other' })).json();
        const otherTale = await (await post(`/tale-groups/${otherGroup.id}/tales`, { title: 'Elsewhere' })).json();
        // A group and tale of another project.
        const foreign = await zoneWithTale('Foreign');
        const at = new Date(Date.now() - 1000).toISOString();
        const res = await sendEvents(key, {
          events: [
            { type: 'impression', groupId: otherGroup.id, at },
            { type: 'view', groupId: otherGroup.id, taleId: otherTale.id, at },
            { type: 'view', groupId: group.id, taleId: otherTale.id, at },
            { type: 'impression', groupId: foreign.group.id, at },
            { type: 'click', groupId: foreign.group.id, taleId: foreign.tale.id, at },
            { type: 'impression', groupId: group.id, at },
          ],
        });
        expect(await res.json()).toEqual({ accepted: 1, dropped: 5 });
      });

      it('accepts the zone key in the body for a beacon, with the visitor id in the body, as text', async () => {
        const { group, key } = await zoneWithTale();
        const body = JSON.stringify({ key, visitor: VISITOR_A, events: [{ type: 'impression', groupId: group.id, at: utcAt(0, 0) }] });
        const res = await sendEvents(null, body, null, { 'Content-Type': 'text/plain;charset=UTF-8' });
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: 1, dropped: 0 });
        expect((await pool.query('SELECT count(*)::int AS n FROM analytics_events')).rows[0].n).toBe(1);
      });

      it('refuses a site key on this endpoint, in the header or the body, with the same 401 as every refusal', async () => {
        const { zone, group } = await zoneWithTale();
        const siteKey = (await (await post(`/projects/${zone.projectId}/site-key`, {})).json()).key as string;
        const event = { type: 'impression', groupId: group.id, at: utcAt(0, 0) };
        const header = await sendEvents(siteKey, { events: [event] });
        expect(header.status).toBe(401);
        expect(await header.json()).toEqual(UNAUTHORIZED_BODY);
        const beacon = await sendEvents(null, { key: siteKey, visitor: VISITOR_A, events: [event] }, null, { 'Content-Type': 'text/plain' });
        expect(beacon.status).toBe(401);
        expect(await beacon.json()).toEqual(UNAUTHORIZED_BODY);
      });

      it('answers a revoked, unknown or missing key with the same 401 body, never kept, and never echoing the key', async () => {
        const { zone, group, key } = await zoneWithTale();
        const event = { type: 'impression', groupId: group.id, at: utcAt(0, 0) };
        const unknown = await sendEvents('tak_not-a-key-at-all', { events: [event] });
        const missing = await sendEvents(null, { events: [event] });
        expect(missing.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(unknown.headers.get('www-authenticate')).toBe('Bearer');
        expect(unknown.headers.get('cache-control')).toBe('no-store');
        expect(await unknown.json()).toEqual(UNAUTHORIZED_BODY);
        expect(await missing.json()).toEqual(UNAUTHORIZED_BODY);
        expect((await fetch(`${base}/zones/${zone.id}/key`, { method: 'DELETE' })).status).toBe(204);
        const revoked = await sendEvents(key, { events: [event] });
        expect(revoked.status).toBe(401);
        const text = await revoked.text();
        expect(JSON.parse(text)).toEqual(UNAUTHORIZED_BODY);
        expect(text).not.toContain(key);
        expect((await pool.query('SELECT count(*)::int AS n FROM analytics_events')).rows[0].n).toBe(0);
      });

      it('stores the visitor as the hash of the project, and the raw id nowhere', async () => {
        const { zone, group, key } = await zoneWithTale();
        const res = await sendEvents(key, { events: [{ type: 'impression', groupId: group.id, at: utcAt(0, 0) }] }, VISITOR_A);
        expect(res.status).toBe(202);
        const { rows } = await pool.query('SELECT * FROM analytics_events');
        expect(rows).toHaveLength(1);
        expect(rows[0].visitor_hash).toBe(createHash('sha256').update(`${zone.projectId}:${VISITOR_A}`).digest('hex'));
        expect(JSON.stringify(rows)).not.toContain(VISITOR_A);
        const columns = (
          await pool.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events' ORDER BY column_name`,
          )
        ).rows.map((row) => row.column_name);
        expect(columns).toEqual(['at', 'group_id', 'id', 'project_id', 'received_at', 'tale_id', 'type', 'visitor_hash', 'zone_id']);
      });

      it('limits events per visitor more strictly than reads, and gives each visitor its own allowance', async () => {
        const limited = createApp(
          pool,
          loadFrameTypeRegistry(frameTypesDir),
          new LocalDiskStorage(mediaDir),
          { verifier: fakeVerifier },
          { publicApiUrl },
          undefined,
          { rateLimit: { burst: 100, perSecond: 1 }, eventRateLimit: { burst: 2, perSecond: 0.01 } },
        ).listen(0);
        await new Promise<void>((resolve) => limited.once('listening', () => resolve()));
        try {
          const { group, key } = await zoneWithTale();
          const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
          const event = { type: 'impression', groupId: group.id, at: utcAt(0, 0) };
          const send = (visitor: string) =>
            globalThis.fetch(`${url}/delivery/v1/events`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-TaleArt-Visitor': visitor },
              body: JSON.stringify({ events: [event] }),
            });
          expect((await send(VISITOR_A)).status).toBe(202);
          expect((await send(VISITOR_A)).status).toBe(202);
          const third = await send(VISITOR_A);
          expect(third.status).toBe(429);
          expect((await third.json()).error.code).toBe('rate_limited');
          expect(third.headers.get('retry-after')).toMatch(/^\d+$/);
          expect((await send(VISITOR_B)).status).toBe(202);
          const zone = await globalThis.fetch(`${url}/delivery/v1/zone`, {
            headers: { Authorization: `Bearer ${key}`, 'X-TaleArt-Visitor': VISITOR_A },
          });
          expect(zone.status).toBe(200);
        } finally {
          await new Promise<void>((resolve) => limited.close(() => resolve()));
        }
      });

      it('answers the Delivery preflight with POST and the visitor header', async () => {
        const res = await globalThis.fetch(`${origin}/delivery/v1/events`, {
          method: 'OPTIONS',
          headers: { Origin: 'https://shop.example', 'Access-Control-Request-Method': 'POST' },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
        expect(res.headers.get('access-control-allow-headers')).toContain('X-TaleArt-Visitor');
      });
    });

    describe('GET /api/v1/zones/{zoneId}/analytics', () => {
      // Seeds the metrics dataset: two groups (Summer, Winter) placed in one zone, with a tale each.
      async function seeded() {
        const { zone, group: summer, tale: beach } = await zoneWithTale('Summer');
        const winter = await (await post(`/zones/${zone.id}/tale-groups`, { name: 'Winter' })).json();
        const snow = await (await post(`/tale-groups/${winter.id}/tales`, { title: 'Snow' })).json();
        await seed(zone.projectId, zone.id, [
          { type: 'impression', groupId: summer.id, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'impression', groupId: summer.id, visitor: VISITOR_B, at: utcAt(-1, 9) },
          { type: 'open', groupId: summer.id, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'view', groupId: summer.id, taleId: beach.id, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'view', groupId: summer.id, taleId: beach.id, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'click', groupId: summer.id, taleId: beach.id, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'impression', groupId: winter.id, visitor: VISITOR_A, at: utcAt(0, 0) },
          { type: 'impression', groupId: winter.id, visitor: VISITOR_C, at: utcAt(0, 0) },
          { type: 'open', groupId: winter.id, visitor: VISITOR_C, at: utcAt(0, 0) },
          { type: 'view', groupId: winter.id, taleId: snow.id, visitor: VISITOR_B, at: utcAt(0, 0) },
        ]);
        return { zone, summer, winter, beach, snow };
      }

      it('computes the totals, reach distinct per row, the rates and the rows of the published definitions', async () => {
        const { zone, summer, winter, beach, snow } = await seeded();
        const body = await (await analytics(zone.id, '7d')).json();
        expect(body.period).toBe('7d');
        expect(body.totals).toEqual({
          impressions: 4,
          // Visitors A, B and C.
          reach: 3,
          opens: 2,
          taleViews: 3,
          clicks: 1,
          // Visitors A and C had an impression and an open (2 of 3 reached): 66.7 percent. One click of 3 views: 33.3 percent.
          engagementRate: 66.7,
          ctr: 33.3,
        });
        // The two groups tie on impressions and the query breaks the tie by group id (random): compare by name.
        expect([...body.groups].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))).toEqual([
          {
            groupId: summer.id,
            name: 'Summer',
            impressions: 2,
            reach: 2,
            opens: 1,
            taleViews: 2,
            clicks: 1,
            engagementRate: 50,
            ctr: 50,
          },
          {
            groupId: winter.id,
            name: 'Winter',
            impressions: 2,
            reach: 2,
            opens: 1,
            taleViews: 1,
            clicks: 0,
            engagementRate: 50,
            ctr: 0,
          },
        ]);
        // Reach is not summed: the two groups reach 2 each (4), the zone 3 distinct visitors.
        expect(body.groups.reduce((sum: number, row: { reach: number }) => sum + row.reach, 0)).toBe(4);
        expect(body.tales).toEqual([
          {
            taleId: beach.id,
            name: 'Beach',
            groupId: summer.id,
            impressions: null,
            reach: null,
            opens: null,
            taleViews: 2,
            clicks: 1,
            engagementRate: null,
            ctr: 50,
          },
          {
            taleId: snow.id,
            name: 'Snow',
            groupId: winter.id,
            impressions: null,
            reach: null,
            opens: null,
            taleViews: 1,
            clicks: 0,
            engagementRate: null,
            ctr: 0,
          },
        ]);
        expect(body.daily).toHaveLength(7);
        expect(body.daily[5]).toEqual({ date: utcAt(-1).slice(0, 10), impressions: 2, clicks: 1, opens: 1, taleViews: 2 });
        expect(body.daily[6]).toEqual({ date: utcAt(0).slice(0, 10), impressions: 2, clicks: 0, opens: 1, taleViews: 1 });
        expect(body.daily[0]).toEqual({ date: body.daily[0].date, impressions: 0, clicks: 0, opens: 0, taleViews: 0 });
        expect((await analytics(zone.id, '7d')).headers.get('cache-control')).toBe('no-store');
      });

      it('counts only the period: 7 days leaves out an older event, 30 days takes it, 90 days leaves out the oldest', async () => {
        const { zone, summer } = await seeded();
        await seed(zone.projectId, zone.id, [
          { type: 'impression', groupId: summer.id, visitor: VISITOR_D, at: utcAt(-10, 9) },
          { type: 'impression', groupId: summer.id, visitor: VISITOR_D, at: utcAt(-95, 9) },
        ]);
        expect((await (await analytics(zone.id, '7d')).json()).totals.impressions).toBe(4);
        const thirty = await (await analytics(zone.id, '30d')).json();
        expect(thirty.totals.impressions).toBe(5);
        expect(thirty.totals.reach).toBe(4);
        expect(thirty.daily).toHaveLength(30);
        const ninety = await (await analytics(zone.id, '90d')).json();
        expect(ninety.totals.impressions).toBe(5);
        expect(ninety.daily).toHaveLength(90);
      });

      it('answers 0 for a zero denominator: no reach, no views, and no events at all', async () => {
        const opensOnly = await createZone();
        await seed(opensOnly.projectId, opensOnly.id, [
          { type: 'open', groupId: '00000000-0000-4000-8000-0000000000c1', visitor: VISITOR_A, at: utcAt(0, 0) },
        ]);
        const opened = await (await analytics(opensOnly.id)).json();
        expect(opened.totals).toEqual({ impressions: 0, reach: 0, opens: 1, taleViews: 0, clicks: 0, engagementRate: 0, ctr: 0 });
        // No period named: the 30-day default.
        expect(opened.period).toBe('30d');
        const fresh = await createZone();
        const none = await (await analytics(fresh.id, '7d')).json();
        expect(none.totals).toEqual({ impressions: 0, reach: 0, opens: 0, taleViews: 0, clicks: 0, engagementRate: 0, ctr: 0 });
        expect(none.groups).toEqual([]);
        expect(none.tales).toEqual([]);
      });

      it('counts an engaged visitor only with an impression and an open, so the rate never passes 100', async () => {
        const group = '00000000-0000-4000-8000-0000000000d1';
        const reached = await createZone();
        await seed(reached.projectId, reached.id, [
          { type: 'impression', groupId: group, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'open', groupId: group, visitor: VISITOR_A, at: utcAt(-1, 9) },
          // Opened without an impression in the period: an open, but not engaged.
          { type: 'open', groupId: group, visitor: VISITOR_B, at: utcAt(0, 9) },
          { type: 'open', groupId: group, visitor: VISITOR_C, at: utcAt(0, 9) },
        ]);
        const body = await (await analytics(reached.id, '7d')).json();
        expect(body.totals.reach).toBe(1);
        expect(body.totals.opens).toBe(3);
        expect(body.totals.engagementRate).toBe(100);
        expect(body.totals.engagementRate).toBeLessThanOrEqual(100);
        expect(body.groups[0]).toMatchObject({ reach: 1, engagementRate: 100 });

        // Reached but never opened in the period: 0, whatever opened on other visitors' days.
        const idle = await createZone();
        await seed(idle.projectId, idle.id, [
          { type: 'impression', groupId: group, visitor: VISITOR_A, at: utcAt(-1, 9) },
          { type: 'open', groupId: group, visitor: VISITOR_B, at: utcAt(0, 9) },
        ]);
        const quiet = await (await analytics(idle.id, '7d')).json();
        expect(quiet.totals).toMatchObject({ reach: 1, opens: 1, engagementRate: 0 });
      });

      it('answers 400 for another period, 404 for an unknown zone and for a zone of a project the caller cannot access', async () => {
        const { zone } = await seeded();
        const badPeriod = await analytics(zone.id, '365d');
        expect(badPeriod.status).toBe(400);
        expect((await badPeriod.json()).error.code).toBe('validation_failed');
        expect((await analytics('00000000-0000-4000-8000-000000000000')).status).toBe(404);
        const user = await createUser(pool, { name: 'Cy Content', email: 'cy@example.com', role: 'content_manager' });
        const other = sessionCookie;
        sessionCookie = `taleart_session=${(await createSession(pool, user.id)).token}`;
        const res = await analytics(zone.id);
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('zone_not_found');
        sessionCookie = other;
      });

      it('needs a session', async () => {
        const { zone } = await seeded();
        const res = await globalThis.fetch(`${base}/zones/${zone.id}/analytics`);
        expect(res.status).toBe(401);
      });

      it('deletes raw events older than 400 days, and keeps newer ones', async () => {
        const { zone, summer } = await seeded();
        await seed(zone.projectId, zone.id, [
          { type: 'impression', groupId: summer.id, visitor: VISITOR_D, at: new Date(Date.now() - 401 * DAY).toISOString() },
          { type: 'impression', groupId: summer.id, visitor: VISITOR_D, at: new Date(Date.now() - 399 * DAY).toISOString() },
        ]);
        expect(await purgeAnalyticsEvents(pool)).toBe(1);
        expect((await pool.query('SELECT count(*)::int AS n FROM analytics_events')).rows[0].n).toBe(11);
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
        'TRUNCATE analytics_events, site_keys, zone_keys, api_token_projects, api_tokens, project_audit_log, invitations, project_members, auth_challenges, sessions, passkeys, user_identities, user_passwords, password_resets, auth_providers, auth_settings, users',
      );
    });

    it('reports that setup is required on an empty install', async () => {
      const res = await send('GET', '/auth/state');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ setupRequired: true, user: null, methods: [PASSKEY_METHOD] });
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

      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user, methods: [PASSKEY_METHOD] });
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
      expect(await (await send('GET', '/auth/state')).json()).toEqual({ setupRequired: false, user: null, methods: [PASSKEY_METHOD] });
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

describe('Management API v1: API tokens for scripts (epic developer experience 10.1)', () => {
  let pool: Pool;
  let server: Server;
  let origin: string;
  let base: string;
  // The admin's session cookie, sent by `session()`; token requests never carry it unless a test says so.
  let adminCookie = '';
  let adminId = '';

  async function start(p: Pool, tokenGuessLimit?: { burst: number; perSecond: number } | null): Promise<Server> {
    const s = createApp(
      p,
      loadFrameTypeRegistry(frameTypesDir),
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier, tokenGuessLimit },
      { publicApiUrl },
      undefined,
      { rateLimit: null },
    ).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    return s;
  }

  // A request with the admin's session cookie.
  function session(method: string, path: string, body?: unknown, cookie = adminCookie): Promise<Response> {
    const headers: Record<string, string> = { Cookie: cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return globalThis.fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  // A request with `Authorization: Bearer <token>` and no cookie.
  function bearer(method: string, path: string, token: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return globalThis.fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  async function createToken(
    body: Record<string, unknown>,
    cookie = adminCookie,
  ): Promise<{ id: string; token: string; prefix: string; projectIds: string[] | null; readOnly: boolean }> {
    const res = await session('POST', '/api-tokens', { name: 'Script', readOnly: true, projectIds: null, ...body }, cookie);
    expect(res.status, await res.clone().text()).toBe(201);
    return res.json();
  }

  async function project(name: string): Promise<string> {
    const res = await session('POST', '/projects', { name });
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  async function zone(projectId: string, name = 'Home top'): Promise<string> {
    const res = await session('POST', '/zones', { name, projectId });
    expect(res.status).toBe(201);
    return (await res.json()).id;
  }

  async function contentManager(email: string, projectIds: string[]): Promise<{ id: string; cookie: string }> {
    const user = await createUser(pool, { name: 'Casey Content', email, role: 'content_manager' });
    for (const projectId of projectIds) await addProjectMember(pool, projectId, user.id);
    const { token } = await createSession(pool, user.id);
    return { id: user.id, cookie: `taleart_session=${token}` };
  }

  async function lastUsedAt(tokenId: string): Promise<Date | null> {
    const { rows } = await pool.query<{ lastUsedAt: Date | null }>(
      'SELECT last_used_at AS "lastUsedAt" FROM api_tokens WHERE id = $1',
      [tokenId],
    );
    return rows[0]?.lastUsedAt ?? null;
  }

  // Waits for the best-effort `last_used_at` write the middleware does after letting a request
  // through, until it is later than `after`; the last value read.
  async function lastUsedAfter(tokenId: string, after: number): Promise<Date | null> {
    let value: Date | null = null;
    for (let i = 0; i < 50; i++) {
      value = await lastUsedAt(tokenId);
      if (value && value.getTime() > after) return value;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return value;
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    // A generous guess limit here; its own test starts an app with a small one.
    server = await start(pool, { burst: 1000, perSecond: 1000 });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    base = `${origin}/api/v1`;
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE user_list_ids, user_lists, user_list_secrets, api_token_projects, api_tokens, users, projects CASCADE');
    const admin = await createUser(pool, { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' });
    adminId = admin.id;
    adminCookie = `taleart_session=${(await createSession(pool, admin.id)).token}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it('a read-only token for one project reads its zones, cannot write, cannot reach another project, and stops at revoke', async () => {
    const a = await project('Acme');
    const b = await project('Beta');
    const zoneA = await zone(a);
    const zoneB = await zone(b);

    const res = await session('POST', '/api-tokens', { name: 'CI reader', projectIds: [a], readOnly: true });
    expect(res.status).toBe(201);
    // The token is in this body only: no cache keeps it.
    expect(res.headers.get('cache-control')).toBe('no-store');
    const issued = await res.json();
    expect(issued).toEqual({
      id: expect.any(String),
      name: 'CI reader',
      prefix: issued.token.slice(0, 10),
      projectIds: [a],
      readOnly: true,
      createdAt: expect.any(String),
      expiresAt: null,
      lastUsedAt: null,
      token: expect.stringMatching(/^tat_[A-Za-z0-9_-]{43}$/),
    });

    // GET of that project's zones works, and lists only that project's.
    const zones = await bearer('GET', '/zones', issued.token);
    expect(zones.status).toBe(200);
    expect((await zones.json()).map((z: { id: string }) => z.id)).toEqual([zoneA]);
    expect((await bearer('GET', `/zones/${zoneA}/tale-groups`, issued.token)).status).toBe(200);
    expect((await (await bearer('GET', '/projects', issued.token)).json()).map((p: { id: string }) => p.id)).toEqual([a]);

    // A write is refused 403.
    const write = await bearer('POST', '/zones', issued.token, { name: 'Another', projectId: a });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: { code: 'forbidden', message: 'This API token is read-only' } });
    expect((await bearer('PATCH', `/zones/${zoneA}`, issued.token, { name: 'Renamed' })).status).toBe(403);
    expect((await bearer('PATCH', `/zones/${zoneA}/frame`, issued.token, { settings: {} })).status).toBe(403);

    // Another project answers as for a session that cannot access it: 403 on its zone, 404 on what does not exist.
    const other = await bearer('GET', `/zones/${zoneB}/tale-groups`, issued.token);
    expect(other.status).toBe(403);
    expect((await other.json()).error.code).toBe('forbidden');
    expect((await bearer('GET', `/projects/${b}/site-key`, issued.token)).status).toBe(403);
    expect((await bearer('GET', '/zones/00000000-0000-4000-8000-000000000000/tale-groups', issued.token)).status).toBe(404);

    // The database holds only the token's hash.
    const { rows } = await pool.query('SELECT * FROM api_tokens');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(createHash('sha256').update(issued.token).digest('hex'));
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(JSON.stringify(rows)).not.toContain(issued.token.slice(10));

    // The list never shows it again.
    await lastUsedAfter(issued.id, 0);
    const listed = await (await session('GET', '/api-tokens')).text();
    expect(listed).not.toContain(issued.token);
    const shown = { ...issued, lastUsedAt: expect.any(String) };
    delete shown.token;
    expect(JSON.parse(listed)).toEqual([shown]);

    // Revoke it: the next call is 401, like no session.
    expect((await session('DELETE', `/api-tokens/${issued.id}`)).status).toBe(204);
    const after = await bearer('GET', '/zones', issued.token);
    expect(after.status).toBe(401);
    expect(after.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(after.headers.get('cache-control')).toBe('no-store');
    expect((await after.json()).error.code).toBe('unauthenticated');
    expect(await (await session('GET', '/api-tokens')).json()).toEqual([]);
    // The row stays, revoked; a second revoke finds nothing.
    expect((await pool.query('SELECT 1 FROM api_tokens WHERE revoked_at IS NOT NULL')).rowCount).toBe(1);
    expect((await session('DELETE', `/api-tokens/${issued.id}`)).status).toBe(404);
  });

  it('a read-write token writes within its projects only', async () => {
    const a = await project('Acme');
    const b = await project('Beta');
    const { token } = await createToken({ projectIds: [a], readOnly: false });

    const created = await bearer('POST', '/zones', token, { name: 'From a script', projectId: a });
    expect(created.status).toBe(201);
    const inB = await bearer('POST', '/zones', token, { name: 'Elsewhere', projectId: b });
    expect(inB.status).toBe(403);
    // An admin's token keeps admin rights within its projects: the site key of A, not of B.
    expect((await bearer('POST', `/projects/${a}/site-key`, token, { ifNone: true })).status).toBe(201);
    expect((await bearer('POST', `/projects/${b}/site-key`, token, { ifNone: true })).status).toBe(403);
    // A token limited to some projects cannot create one.
    const newProject = await bearer('POST', '/projects', token, { name: 'Gamma' });
    expect(newProject.status).toBe(403);
    expect((await newProject.json()).error.message).toMatch(/limited to some projects/);
  });

  it('an admin token for all projects, read-write, may create a project; invitations need a passkey session', async () => {
    const a = await project('Acme');
    const { token } = await createToken({ projectIds: null, readOnly: false });
    const created = await bearer('POST', '/projects', token, { name: 'Made by a script' });
    expect(created.status).toBe(201);
    const made = (await created.json()).id;
    // A project made after the token was: an all-projects token reaches it.
    expect((await bearer('GET', `/projects/${made}/site-key`, token)).status).toBe(200);

    const invite = await bearer('POST', `/projects/${a}/invitations`, token);
    expect(invite.status).toBe(403);
    expect((await invite.json()).error.code).toBe('forbidden');
    expect((await pool.query('SELECT 1 FROM invitations')).rowCount).toBe(0);
    expect((await session('POST', `/projects/${a}/invitations`)).status).toBe(201);
  });

  it('acts as its user: admin-only routes stay admin-only, and losing a project cuts the token at once', async () => {
    const a = await project('Acme');
    const b = await project('Beta');
    const zoneA = await zone(a);
    const casey = await contentManager('casey@example.com', [a]);
    // A content manager may limit a token only to projects they can access.
    const refused = await session('POST', '/api-tokens', { name: 'x', readOnly: false, projectIds: [b] }, casey.cookie);
    expect(refused.status).toBe(403);
    const { token } = await createToken({ projectIds: null, readOnly: false }, casey.cookie);

    expect((await bearer('GET', `/zones/${zoneA}/tale-groups`, token)).status).toBe(200);
    expect((await (await bearer('GET', '/projects', token)).json()).map((p: { id: string }) => p.id)).toEqual([a]);
    // Admin-only, as for the user's session.
    expect((await bearer('POST', `/projects/${a}/site-key`, token, {})).status).toBe(403);
    expect((await bearer('POST', '/projects', token, { name: 'No' })).status).toBe(403);

    // The user loses the project: so does the token, on the next request.
    await pool.query('DELETE FROM project_members WHERE user_id = $1', [casey.id]);
    expect((await bearer('GET', `/zones/${zoneA}/tale-groups`, token)).status).toBe(403);
    expect(await (await bearer('GET', '/zones', token)).json()).toEqual([]);

    // A user who becomes admin is admin through the token too, and back.
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [casey.id]);
    expect((await bearer('GET', `/zones/${zoneA}/tale-groups`, token)).status).toBe(200);
    await pool.query("UPDATE users SET role = 'content_manager' WHERE id = $1", [casey.id]);
    expect((await bearer('GET', `/zones/${zoneA}/tale-groups`, token)).status).toBe(403);
  });

  it('GET /api-tokens/current answers the token and its user, to a token only (story 10.3)', async () => {
    const a = await project('Acme');
    const scoped = await createToken({ name: 'CI reader', projectIds: [a], readOnly: true });
    const res = await bearer('GET', '/api-tokens/current', scoped.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      id: scoped.id,
      name: 'CI reader',
      prefix: scoped.prefix,
      readOnly: true,
      allProjects: false,
      projectIds: [a],
      expiresAt: null,
      user: { id: adminId, name: 'Ada Admin', email: 'ada@example.com', role: 'admin' },
    });
    expect(JSON.stringify(body)).not.toContain(scoped.token);

    const all = await createToken({ name: 'Writer', projectIds: null, readOnly: false });
    expect(await (await bearer('GET', '/api-tokens/current', all.token)).json()).toMatchObject({
      id: all.id,
      allProjects: true,
      projectIds: null,
      readOnly: false,
    });

    // A session has no token.
    const fromSession = await session('GET', '/api-tokens/current');
    expect(fromSession.status).toBe(403);
    expect((await fromSession.json()).error).toMatchObject({ code: 'forbidden', message: expect.stringContaining('Only an API token') });
    // A revoked token is refused like any other request.
    expect((await session('DELETE', `/api-tokens/${all.id}`)).status).toBe(204);
    expect((await bearer('GET', '/api-tokens/current', all.token)).status).toBe(401);
  });

  it('a token can never create, list or revoke tokens, or use the auth routes', async () => {
    const { id, token } = await createToken({ projectIds: null, readOnly: false });
    for (const [method, path] of [
      ['GET', '/api-tokens'],
      ['POST', '/api-tokens'],
      ['DELETE', `/api-tokens/${id}`],
    ] as const) {
      const res = await bearer(method, path, token, method === 'POST' ? { name: 'Child', projectIds: null, readOnly: false } : undefined);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    }
    expect((await pool.query('SELECT 1 FROM api_tokens')).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM api_tokens WHERE revoked_at IS NOT NULL')).rowCount).toBe(0);

    // Sign-in, sign-out, setup and invitations: any Authorization header is refused, cookie or not.
    for (const path of ['/auth/state', '/auth/sign-in/options', '/auth/sign-out', '/auth/setup/options']) {
      const res = await globalThis.fetch(`${base}${path}`, {
        method: path === '/auth/state' ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, Cookie: adminCookie },
      });
      expect(res.status, path).toBe(403);
    }
    // The session the sign-out carried is untouched.
    expect((await session('GET', '/projects')).status).toBe(200);
  });

  it('judges a request carrying a cookie and a token by its token alone', async () => {
    const a = await project('Acme');
    const { token } = await createToken({ projectIds: [a], readOnly: true });
    const both = (method: string, path: string, auth: string, body?: unknown) =>
      globalThis.fetch(`${base}${path}`, {
        method,
        headers: { Authorization: auth, Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    // The admin's cookie does not lift the token's read-only limit.
    expect((await both('POST', '/zones', `Bearer ${token}`, { name: 'x', projectId: a })).status).toBe(403);
    // A refused header never falls back to the cookie.
    for (const auth of ['Bearer tat_unknown', 'Bearer', 'Basic YWRhOnNlY3JldA==', '']) {
      const res = await both('GET', '/projects', auth);
      expect(res.status, JSON.stringify(auth)).toBe(401);
      expect((await res.json()).error.code).toBe('unauthenticated');
    }
    // Without the header, the cookie works as before.
    expect((await session('GET', '/projects')).status).toBe(200);
  });

  it('refuses a site key on the Management API and a token on the Delivery API', async () => {
    const a = await project('Acme');
    const zoneA = await zone(a, 'Home');
    expect((await session('POST', `/zones/${zoneA}/frame`, { type: 'bar', settings: {} })).status).toBe(201);
    const siteKey = (await (await session('POST', `/projects/${a}/site-key`, {})).json()).key as string;
    const { token } = await createToken({ projectIds: [a], readOnly: true });

    const management = await bearer('GET', '/zones', siteKey);
    expect(management.status).toBe(401);
    expect(await management.json()).toEqual({
      error: { code: 'unauthenticated', message: expect.stringMatching(/site key works only on the Delivery API/) },
    });

    const delivery = (key: string) =>
      globalThis.fetch(`${origin}/delivery/v1/zone?zone=home`, { headers: { Authorization: `Bearer ${key}` } });
    expect((await delivery(siteKey)).status).toBe(200);
    const refused = await delivery(token);
    expect(refused.status).toBe(401);
    expect((await refused.json()).error.code).toBe('invalid_site_key');
  });

  it('an expired token answers 401, and an expiry must be in the future', async () => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const issued = await createToken({ expiresAt });
    expect(issued).toMatchObject({ expiresAt });
    expect((await bearer('GET', '/projects', issued.token)).status).toBe(200);
    await pool.query("UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = $1", [issued.id]);
    const res = await bearer('GET', '/projects', issued.token);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
    // Still listed (with its expiry) until revoked.
    expect((await (await session('GET', '/api-tokens')).json()).map((t: { id: string }) => t.id)).toEqual([issued.id]);

    const past = await session('POST', '/api-tokens', { name: 'Old', projectIds: null, readOnly: true, expiresAt: '2020-01-01T00:00:00Z' });
    expect(past.status).toBe(400);
    expect((await past.json()).error.code).toBe('validation_failed');
  });

  it('validates a new token and its projects', async () => {
    const a = await project('Acme');
    const cases: [unknown, number, string][] = [
      [{ projectIds: null, readOnly: true }, 400, 'validation_failed'],
      [{ name: '  ', projectIds: null, readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x'.repeat(81), projectIds: null, readOnly: true }, 400, 'validation_failed'],
      [{ name: 'tab\there', projectIds: null, readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: null }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: null, readOnly: 'yes' }, 400, 'validation_failed'],
      [{ name: 'x', readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: [], readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: [a, a], readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: ['nope'], readOnly: true }, 400, 'validation_failed'],
      [{ name: 'x', projectIds: ['00000000-0000-4000-8000-000000000000'], readOnly: true }, 400, 'project_not_found'],
      [{ name: 'x', projectIds: null, readOnly: true, expiresAt: 'tomorrow' }, 400, 'validation_failed'],
      [[], 400, 'validation_failed'],
    ];
    for (const [body, status, code] of cases) {
      const res = await session('POST', '/api-tokens', body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect((await res.json()).error.code, JSON.stringify(body)).toBe(code);
    }
    expect((await pool.query('SELECT 1 FROM api_tokens')).rowCount).toBe(0);
    // Unauthenticated: 401.
    expect((await globalThis.fetch(`${base}/api-tokens`)).status).toBe(401);
  });

  it('each user sees and revokes only their own tokens; at most 50 active each', async () => {
    const a = await project('Acme');
    const casey = await contentManager('casey@example.com', [a]);
    const mine = await createToken({ name: 'Admin script' });
    const theirs = await createToken({ name: 'Casey script' }, casey.cookie);
    expect((await (await session('GET', '/api-tokens', undefined, casey.cookie)).json()).map((t: { id: string }) => t.id)).toEqual([
      theirs.id,
    ]);
    const res = await session('DELETE', `/api-tokens/${mine.id}`, undefined, casey.cookie);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('api_token_not_found');
    expect((await bearer('GET', '/projects', mine.token)).status).toBe(200);
    expect((await session('DELETE', '/api-tokens/not-a-uuid')).status).toBe(404);

    for (let i = 1; i < 50; i++) await createToken({ name: `Script ${i}` });
    const over = await session('POST', '/api-tokens', { name: 'One too many', projectIds: null, readOnly: true });
    expect(over.status).toBe(409);
    expect((await over.json()).error.code).toBe('api_token_limit_reached');
    // Revoking one frees a place.
    expect((await session('DELETE', `/api-tokens/${mine.id}`)).status).toBe(204);
    expect((await session('POST', '/api-tokens', { name: 'Now it fits', projectIds: null, readOnly: true })).status).toBe(201);
  });

  // The pool with a count of the `last_used_at` writes the app starts through it.
  function countingPool(): { pool: Pool; writes: () => number } {
    let writes = 0;
    const counted = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop === 'query') {
          return (...args: Parameters<Pool['query']>) => {
            if (String(args[0]).includes('SET last_used_at')) writes++;
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return { pool: counted, writes: () => writes };
  }

  it('records when a token was last used, starting at most one write per minute per token', async () => {
    const issued = await createToken({});
    expect(await lastUsedAt(issued.id)).toBeNull();
    const counting = countingPool();
    const app = await start(counting.pool, { burst: 1000, perSecond: 1000 });
    try {
      const api = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/v1`;
      const use = () => globalThis.fetch(`${api}/projects`, { headers: { Authorization: `Bearer ${issued.token}` } });
      // Twenty requests at once start one write.
      const all = await Promise.all(Array.from({ length: 20 }, use));
      expect(all.map((r) => r.status)).toEqual(Array(20).fill(200));
      expect(await lastUsedAfter(issued.id, 0)).not.toBeNull();
      // Used again within the minute, even after the stored value is made old: this process wrote it
      // a moment ago, so nothing is written.
      await pool.query("UPDATE api_tokens SET last_used_at = now() - interval '2 minutes' WHERE id = $1", [issued.id]);
      expect((await use()).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(counting.writes()).toBe(1);
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }

    // Another process (here: another app) that never wrote it writes again once the stored value is over a minute old.
    const old = (await lastUsedAt(issued.id)) as Date;
    expect((await bearer('GET', '/projects', issued.token)).status).toBe(200);
    expect(((await lastUsedAfter(issued.id, old.getTime())) as Date).getTime()).toBeGreaterThan(old.getTime());
  });

  it('does not record a use the token was refused for', async () => {
    const a = await project('Acme');
    const issued = await createToken({ projectIds: [a], readOnly: true });
    const counting = countingPool();
    const app = await start(counting.pool, { burst: 1000, perSecond: 1000 });
    try {
      const api = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/v1`;
      const res = await globalThis.fetch(`${api}/zones`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${issued.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', projectId: a }),
      });
      expect(res.status).toBe(403);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(counting.writes()).toBe(0);
      expect(await lastUsedAt(issued.id)).toBeNull();
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });

  it('answers 429 to failed guesses past the limit, while valid tokens and sessions keep working', async () => {
    const issued = await createToken({});
    const strict = await start(pool, { burst: 3, perSecond: 0.001 });
    try {
      const api = `http://127.0.0.1:${(strict.address() as AddressInfo).port}/api/v1`;
      const guess = (token: string) => globalThis.fetch(`${api}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      for (let i = 0; i < 3; i++) expect((await guess(`tat_guess${i}`)).status).toBe(401);
      const locked = await guess('tat_guess4');
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await locked.json()).error.code).toBe('rate_limited');
      // A valid token is still looked up and let through: a flood cannot lock it out.
      for (let i = 0; i < 3; i++) expect((await guess(issued.token)).status).toBe(200);
      expect((await guess('tat_guess5')).status).toBe(429);
      // The cookie path is not limited by it.
      expect((await globalThis.fetch(`${api}/projects`, { headers: { Cookie: adminCookie } })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => strict.close(() => resolve()));
    }
  });

  it('never lets concurrent failures past the burst', async () => {
    const issued = await createToken({});
    const strict = await start(pool, { burst: 3, perSecond: 0.001 });
    try {
      const api = `http://127.0.0.1:${(strict.address() as AddressInfo).port}/api/v1`;
      const call = (token: string) => globalThis.fetch(`${api}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      // Twelve wrong tokens and four valid ones, all at once.
      const tokens = [...Array.from({ length: 12 }, (_, i) => `tat_wrong${i}`), ...Array(4).fill(issued.token)];
      const statuses = (await Promise.all(tokens.map(call))).map((r) => r.status);
      const wrong = statuses.slice(0, 12);
      expect(wrong.filter((s) => s === 401)).toHaveLength(3);
      expect(wrong.filter((s) => s === 429)).toHaveLength(9);
      expect(statuses.slice(12)).toEqual([200, 200, 200, 200]);
    } finally {
      await new Promise<void>((resolve) => strict.close(() => resolve()));
    }
  });

  it("does not count expired tokens toward the limit of 50", async () => {
    for (let i = 0; i < 50; i++) await createToken({ name: `Script ${i}` });
    expect((await session('POST', '/api-tokens', { name: 'Over', projectIds: null, readOnly: true })).status).toBe(409);
    await pool.query(
      "UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM api_tokens ORDER BY created_at LIMIT 1)",
    );
    expect((await session('POST', '/api-tokens', { name: 'Now it fits', projectIds: null, readOnly: true })).status).toBe(201);
  });

  it('an admin revokes every token of a user; nobody else can', async () => {
    const a = await project('Acme');
    const casey = await contentManager('casey@example.com', [a]);
    const one = await createToken({ name: 'One' }, casey.cookie);
    const two = await createToken({ name: 'Two' }, casey.cookie);
    const admins = await createToken({ name: 'Admin', readOnly: false });

    // A content manager, and any token, are refused.
    expect((await session('DELETE', `/users/${casey.id}/api-tokens`, undefined, casey.cookie)).status).toBe(403);
    expect((await bearer('DELETE', `/users/${casey.id}/api-tokens`, admins.token)).status).toBe(403);
    expect((await bearer('GET', '/projects', one.token)).status).toBe(200);

    const res = await session('DELETE', `/users/${casey.id}/api-tokens`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: 2 });
    expect((await bearer('GET', '/projects', one.token)).status).toBe(401);
    expect((await bearer('GET', '/projects', two.token)).status).toBe(401);
    // Only that user's tokens.
    expect((await bearer('GET', '/projects', admins.token)).status).toBe(200);
    expect(await (await session('DELETE', `/users/${casey.id}/api-tokens`)).json()).toEqual({ revoked: 0 });
    const unknown = await session('DELETE', '/users/00000000-0000-4000-8000-000000000000/api-tokens');
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('not_found');
    expect((await session('DELETE', '/users/nope/api-tokens')).status).toBe(404);
  });

  it('keeps a project-scoped token to its project on tales, tale groups, media, fonts and user lists', async () => {
    const a = await project('Acme');
    const b = await project('Beta');
    const groupIn = async (projectId: string) => {
      const res = await session('POST', `/projects/${projectId}/tale-groups`, { name: 'Summer' });
      expect(res.status).toBe(201);
      return (await res.json()).id as string;
    };
    const taleIn = async (groupId: string) => {
      const res = await session('POST', `/tale-groups/${groupId}/tales`, { title: 'Beach' });
      expect(res.status).toBe(201);
      return (await res.json()).id as string;
    };
    const listIn = async (projectId: string) => {
      const res = await session('POST', `/projects/${projectId}/user-lists`, { name: 'VIP' });
      expect(res.status).toBe(201);
      return (await res.json()).id as string;
    };
    const groupA = await groupIn(a);
    const groupB = await groupIn(b);
    const taleA = await taleIn(groupA);
    const taleB = await taleIn(groupB);
    const listA = await listIn(a);
    const listB = await listIn(b);
    const reader = await createToken({ projectIds: [a], readOnly: true });
    const writer = await createToken({ projectIds: [a], readOnly: false });

    // Inside its project: answered as for the admin's session.
    const inside: [string, number][] = [
      [`/tale-groups/${groupA}`, 200],
      [`/tales/${taleA}`, 200],
      [`/projects/${a}/media`, 200],
      [`/projects/${a}/fonts`, 200],
      [`/projects/${a}/user-lists`, 200],
    ];
    for (const [path, status] of inside) expect((await bearer('GET', path, reader.token)).status, path).toBe(status);

    // Another project: 403, as for a session without access.
    for (const path of [
      `/tale-groups/${groupB}`,
      `/tales/${taleB}`,
      `/tales/${taleB}/document`,
      `/projects/${b}/media`,
      `/projects/${b}/fonts`,
      `/projects/${b}/user-lists`,
    ]) {
      const res = await bearer('GET', path, writer.token);
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code, path).toBe('forbidden');
    }
    expect((await bearer('PATCH', `/tale-groups/${groupB}`, writer.token, { name: 'Taken' })).status).toBe(403);
    expect((await bearer('DELETE', `/tales/${taleB}`, writer.token)).status).toBe(403);
    expect((await bearer('DELETE', `/projects/${b}/user-lists/${listB}`, writer.token)).status).toBe(403);
    // A list id of another project under this project's path is not found.
    expect([403, 404]).toContain((await bearer('DELETE', `/projects/${a}/user-lists/${listB}`, writer.token)).status);

    // Uploads with a read-only token are refused before the body is read.
    const upload = (path: string, method: string, contentType: string, body: string) =>
      globalThis.fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${reader.token}`, 'Content-Type': contentType },
        body,
      });
    for (const [path, method, type] of [
      [`/projects/${a}/user-lists/${listA}/ids`, 'POST', 'text/csv'],
      [`/projects/${a}/media`, 'POST', 'image/png'],
      [`/projects/${a}/fonts`, 'POST', 'font/woff2'],
      [`/tales/${taleA}/media`, 'PUT', 'image/png'],
    ] as const) {
      const res = await upload(path, method, type, 'user-1\nuser-2\n');
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error: { code: 'forbidden', message: 'This API token is read-only' } });
    }
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM user_list_ids');
    expect(rows[0].n).toBe(0);
  });

  it('lets other origins send Authorization, never with credentials', async () => {
    const preflight = await globalThis.fetch(`${base}/zones`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://docs.example.com', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it("cascades a user's tokens when the user goes", async () => {
    await createToken({});
    await pool.query('DELETE FROM users WHERE id = $1', [adminId]);
    expect((await pool.query('SELECT 1 FROM api_tokens')).rowCount).toBe(0);
  });
});

describe('Management API v1: sign-in methods (password sign-in, method settings, providers, reset links, account)', () => {
  let pool: Pool;
  let base = '';
  const servers: Server[] = [];
  // Everything the process printed during a test: a secret must never be among it.
  let printed: string[] = [];
  let adminId = '';
  let adminCookie = '';
  let managerId = '';
  let managerCookie = '';

  const SECRET_KEY = randomBytes(32);
  const PASSWORD = 'ada-passphrase-2026';
  const CLIENT_SECRET = 'gcp-client-secret-do-not-leak-7731';
  const APPLE_KEY = '-----BEGIN PRIVATE KEY-----\nAPPLE-P8-BODY-do-not-leak\n-----END PRIVATE KEY-----';

  // Starts an API with these auth options and makes it the one `send` calls.
  async function useApp(auth: Partial<AppAuth> = {}): Promise<void> {
    const s = createApp(
      pool,
      loadFrameTypeRegistry(frameTypesDir),
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier, secretKey: SECRET_KEY, passwordAddressLimit: null, ...auth },
      { publicApiUrl },
      undefined,
      { rateLimit: null },
    ).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    servers.push(s);
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1`;
  }

  // A request. The admin's session unless `cookie` says otherwise ('' sends none).
  function send(
    method: string,
    path: string,
    opts: { cookie?: string; body?: unknown; authorization?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const cookie = opts.cookie ?? adminCookie;
    if (cookie) headers['Cookie'] = cookie;
    if (opts.authorization) headers['Authorization'] = opts.authorization;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return globalThis.fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  }

  // The `taleart_session=<token>` a response set, to send back as a Cookie header.
  function sessionCookieOf(res: Response): string {
    const line = res.headers.getSetCookie().find((l) => l.startsWith('taleart_session='));
    if (!line) throw new Error('the response set no session cookie');
    return line.split(';')[0];
  }

  async function cookieFor(userId: string): Promise<string> {
    return `taleart_session=${(await createSession(pool, userId)).token}`;
  }

  async function addPasskey(userId: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports)
       VALUES ($1, $2, $3, 0, '{internal}') RETURNING id`,
      [userId, `cred-${randomUUID()}`, Buffer.from([1, 2, 3])],
    );
    return rows[0].id;
  }

  async function setSettings(passkeyEnabled: boolean, passwordEnabled: boolean): Promise<Response> {
    return send('PUT', '/auth/settings', { body: { passkeyEnabled, passwordEnabled } });
  }

  // Turns the password method on (with the passkey, as it is by default) for the signing-in tests.
  async function turnPasswordOn(): Promise<void> {
    expect((await setSettings(true, true)).status).toBe(200);
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
  });

  beforeEach(async () => {
    printed = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void printed.push(args.map(String).join(' ')));
    await pool.query(
      'TRUNCATE users, projects, auth_settings, auth_providers, password_resets, user_passwords, user_identities, invitations, sessions, passkeys, auth_challenges CASCADE',
    );
    await pool.query('INSERT INTO auth_settings (id) VALUES (1)');
    // An admin with a passkey (as every admin of a real install has one), and a content manager.
    const admin = await createUser(pool, { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' });
    adminId = admin.id;
    await addPasskey(admin.id);
    adminCookie = await cookieFor(admin.id);
    const manager = await createUser(pool, { name: 'Casey Content', email: 'casey@example.com', role: 'content_manager' });
    managerId = manager.id;
    managerCookie = await cookieFor(manager.id);
    await useApp();
  });

  afterEach(async () => {
    // No secret, password or key reaches a log line, whatever the test did.
    const output = printed.join('\n');
    expect(output).not.toContain(CLIENT_SECRET);
    expect(output).not.toContain('APPLE-P8-BODY');
    expect(output).not.toContain(PASSWORD);
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  afterAll(async () => {
    await pool.query('TRUNCATE auth_providers, auth_settings, password_resets, user_passwords, user_identities CASCADE');
    await pool.end();
  });

  it('lists only the passkey on a fresh install, and answers the settings to an admin', async () => {
    const state = await (await send('GET', '/auth/state', { cookie: '' })).json();
    expect(state).toEqual({ setupRequired: false, user: null, methods: [{ id: 'passkey', label: 'Passkey', kind: 'passkey' }] });

    const settings = await send('GET', '/auth/settings');
    expect(settings.status).toBe(200);
    expect(await settings.json()).toEqual({ passkeyEnabled: true, passwordEnabled: false, secretKeyConfigured: true });
  });

  it('keeps the settings, providers and reset links from content managers, strangers and API tokens', async () => {
    const admin = await send('GET', '/auth/settings', { cookie: managerCookie });
    expect(admin.status).toBe(403);
    expect((await admin.json()).error.code).toBe('forbidden');
    expect((await send('PUT', '/auth/settings', { cookie: managerCookie, body: { passkeyEnabled: true, passwordEnabled: true } })).status).toBe(403);
    expect((await send('GET', '/auth/providers', { cookie: managerCookie })).status).toBe(403);
    expect((await send('POST', `/auth/users/${managerId}/password-reset`, { cookie: managerCookie })).status).toBe(403);

    expect((await send('GET', '/auth/settings', { cookie: '' })).status).toBe(401);

    // Every new route answers 403 to a request with an Authorization header, session or not.
    const routes: [string, string, unknown?][] = [
      ['GET', '/auth/settings'],
      ['PUT', '/auth/settings', { passkeyEnabled: true, passwordEnabled: true }],
      ['GET', '/auth/providers'],
      ['PUT', '/auth/providers/google', { displayName: 'Google', enabled: false, config: { clientId: 'x' } }],
      ['DELETE', '/auth/providers/google'],
      ['POST', `/auth/users/${managerId}/password-reset`],
      ['GET', '/auth/account/methods'],
      ['PUT', '/auth/account/password', { password: PASSWORD }],
      ['DELETE', '/auth/account/password'],
      ['DELETE', `/auth/account/passkeys/${randomUUID()}`],
      ['DELETE', `/auth/account/identities/${randomUUID()}`],
      ['POST', '/auth/password/sign-in', { username: 'ada', password: PASSWORD }],
      ['POST', '/auth/setup/password', { name: 'A', email: 'a@example.com', username: 'ada', password: PASSWORD }],
      ['POST', '/auth/invitations/abc/password', { name: 'A', email: 'a@example.com', username: 'ada', password: PASSWORD }],
      ['GET', '/auth/password-resets/abc'],
      ['POST', '/auth/password-resets/abc/redeem', { password: PASSWORD }],
    ];
    for (const [method, path, body] of routes) {
      const res = await send(method, path, { cookie: adminCookie, body, authorization: 'Bearer tat_not-a-real-token' });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await res.json()).error.code, `${method} ${path}`).toBe('forbidden');
    }
    // The admin's settings are as they were.
    expect(await (await send('GET', '/auth/settings')).json()).toMatchObject({ passkeyEnabled: true, passwordEnabled: false });
  });

  it('signs in with a username and password once the method is on, and refuses every wrong attempt the same way', async () => {
    expect((await send('PUT', '/auth/account/password', { body: { username: 'Ada.Admin', password: PASSWORD } })).status).toBe(204);
    await turnPasswordOn();
    const state = await (await send('GET', '/auth/state', { cookie: '' })).json();
    expect(state.methods).toEqual([
      { id: 'passkey', label: 'Passkey', kind: 'passkey' },
      { id: 'password', label: 'Username and password', kind: 'password' },
    ]);

    const ok = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ADA.admin', password: PASSWORD } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ user: { id: adminId, name: 'Ada Admin', email: 'ada@example.com', role: 'admin' } });
    const cookie = sessionCookieOf(ok);
    expect(await (await send('GET', '/auth/state', { cookie })).json()).toMatchObject({ user: { id: adminId } });

    const wrong = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: 'not-the-passphrase' } });
    const unknown = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'nobody-here', password: PASSWORD } });
    // The method switched off: a correct password is refused like the others.
    expect((await setSettings(true, false)).status).toBe(200);
    const disabled = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: PASSWORD } });
    for (const res of [wrong, unknown, disabled]) {
      expect(res.status).toBe(401);
    }
    const bodies = await Promise.all([wrong, unknown, disabled].map((res) => res.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual({ error: { code: 'sign_in_failed', message: 'The username or password is not correct' } });
  });

  it('throttles a username after five failures with a growing wait, whether the username exists or not', async () => {
    expect((await send('PUT', '/auth/account/password', { body: { username: 'ada.admin', password: PASSWORD } })).status).toBe(204);
    await turnPasswordOn();
    for (let i = 0; i < 5; i++) {
      expect((await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: 'wrong-guess-here' } })).status).toBe(401);
    }
    const waiting = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: PASSWORD } });
    expect(waiting.status).toBe(429);
    expect((await waiting.json()).error.code).toBe('rate_limited');
    const retryAfter = Number(waiting.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(25);
    expect(retryAfter).toBeLessThanOrEqual(30);
    // An unknown username counts the same way: it is refused the same 429 after five failures.
    for (let i = 0; i < 5; i++) {
      await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'nobody-here', password: 'wrong-guess-here' } });
    }
    expect((await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'nobody-here', password: 'x' } })).status).toBe(429);
  });

  it('limits password sign-in per address: a burst of ten, then refused until the bucket refills', async () => {
    await useApp({ passwordAddressLimit: undefined });
    await turnPasswordOn();
    for (let i = 0; i < 10; i++) {
      const res = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: `nobody-${i}`, password: 'wrong-guess-here' } });
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    const refused = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'nobody-x', password: 'wrong-guess-here' } });
    expect(refused.status).toBe(429);
    expect((await refused.json()).error.code).toBe('rate_limited');
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('sets and changes the signed-in password under the policy, and keeps usernames unique', async () => {
    const empty = await send('PUT', '/auth/account/password', { body: { password: PASSWORD } });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe('validation_failed');

    const badName = await send('PUT', '/auth/account/password', { body: { username: 'a b', password: PASSWORD } });
    expect(badName.status).toBe(400);
    expect((await badName.json()).error.code).toBe('validation_failed');

    // The policy: length, the username, the email's name part, a common password.
    // (The email's name part is covered by the unit tests: this admin's email is too short to be a password.)
    for (const [username, password] of [
      ['ada.admin', 'short-pass1'],
      ['ada.admin.long', 'ADA.ADMIN.LONG'],
      ['ada.admin', 'Password12345'],
      ['ada.admin', 'x'.repeat(129)],
    ] as const) {
      const res = await send('PUT', '/auth/account/password', { body: { username, password } });
      expect(res.status, password).toBe(400);
      expect((await res.json()).error.code, password).toBe('password_rejected');
    }
    expect((await send('PUT', '/auth/account/password', { body: { username: 'ada.admin', password: 'x'.repeat(128) } })).status).toBe(204);

    // The username is taken once: another user cannot claim it.
    const taken = await send('PUT', '/auth/account/password', { cookie: managerCookie, body: { username: 'ADA.admin', password: PASSWORD } });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe('username_taken');

    // A change needs the current password, and does not rename the user.
    const missing = await send('PUT', '/auth/account/password', { body: { password: PASSWORD } });
    expect(missing.status).toBe(400);
    const wrong = await send('PUT', '/auth/account/password', { body: { currentPassword: 'not-the-current-one', password: PASSWORD } });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error.code).toBe('password_incorrect');
    const renamed = await send('PUT', '/auth/account/password', { body: { username: 'other.name', currentPassword: 'x'.repeat(128), password: PASSWORD } });
    expect(renamed.status).toBe(400);
    const changed = await send('PUT', '/auth/account/password', { body: { currentPassword: 'x'.repeat(128), password: PASSWORD } });
    expect(changed.status).toBe(204);

    expect(await (await send('GET', '/auth/account/methods')).json()).toMatchObject({
      password: { username: 'ada.admin' },
      identities: [],
    });
  });

  it('ends the other sessions of a user when the password changes, and keeps the one that changed it', async () => {
    await send('PUT', '/auth/account/password', { body: { username: 'ada.admin', password: PASSWORD } });
    await turnPasswordOn();
    const first = sessionCookieOf(await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: PASSWORD } }));
    const second = sessionCookieOf(await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ada.admin', password: PASSWORD } }));

    const changed = await send('PUT', '/auth/account/password', {
      cookie: first,
      body: { currentPassword: PASSWORD, password: 'a-new-passphrase-2026' },
    });
    expect(changed.status).toBe(204);
    expect((await send('GET', '/auth/state', { cookie: first })).status).toBe(200);
    expect(await (await send('GET', '/auth/state', { cookie: first })).json()).toMatchObject({ user: { id: adminId } });
    expect(await (await send('GET', '/auth/state', { cookie: second })).json()).toMatchObject({ user: null });
    expect(await (await send('GET', '/projects', { cookie: second })).status).toBe(401);
    // Only the session that changed the password is left: the admin's session from the test set-up ended too.
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [adminId])).rowCount).toBe(1);
    expect(await (await send('GET', '/auth/state', { cookie: adminCookie })).json()).toMatchObject({ user: null });
  });

  it('issues a one-time reset link, stores only its hash, and sets the password once', async () => {
    await turnPasswordOn();
    const issued = await send('POST', `/auth/users/${managerId}/password-reset`);
    expect(issued.status).toBe(201);
    expect(issued.headers.get('Cache-Control')).toBe('no-store');
    const link = (await issued.json()) as { id: string; userId: string; url: string; expiresAt: string };
    expect(link.userId).toBe(managerId);
    const token = link.url.slice(link.url.indexOf('/password-reset/') + '/password-reset/'.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the hash is kept.
    expect((await pool.query('SELECT 1 FROM password_resets WHERE token_hash = $1', [createHash('sha256').update(token).digest('hex')])).rowCount).toBe(1);
    expect((await pool.query('SELECT 1 FROM password_resets WHERE token_hash = $1', [token])).rowCount).toBe(0);
    const expiresIn = new Date(link.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const preview = await send('GET', `/auth/password-resets/${token}`, { cookie: '' });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ name: 'Casey Content', usernameRequired: true });

    // A weak password is refused and the link keeps working.
    const weak = await send('POST', `/auth/password-resets/${token}/redeem`, { cookie: '', body: { username: 'casey', password: 'short-pass1' } });
    expect(weak.status).toBe(400);
    expect((await weak.json()).error.code).toBe('password_rejected');
    expect((await send('GET', `/auth/password-resets/${token}`, { cookie: '' })).status).toBe(200);

    // A session the manager already had ends with the reset; the redemption signs them in.
    const oldSession = await cookieFor(managerId);
    const redeemed = await send('POST', `/auth/password-resets/${token}/redeem`, {
      cookie: '',
      body: { username: 'casey', password: 'casey-new-passphrase-2026' },
    });
    expect(redeemed.status).toBe(200);
    expect(await redeemed.json()).toMatchObject({ user: { id: managerId, role: 'content_manager' } });
    expect(await (await send('GET', '/auth/state', { cookie: oldSession })).json()).toMatchObject({ user: null });
    expect(await (await send('GET', '/auth/state', { cookie: sessionCookieOf(redeemed) })).json()).toMatchObject({ user: { id: managerId } });

    // Used once: neither redeeming nor previewing it again works.
    expect((await send('POST', `/auth/password-resets/${token}/redeem`, { cookie: '', body: { password: 'another-passphrase-2026' } })).status).toBe(410);
    const gone = await send('GET', `/auth/password-resets/${token}`, { cookie: '' });
    expect(gone.status).toBe(410);
    expect((await gone.json()).error.code).toBe('password_reset_invalid');
    expect(
      (await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'casey', password: 'casey-new-passphrase-2026' } })).status,
    ).toBe(200);
  });

  it('refuses a reset link that is replaced, expired or used while the password method is off', async () => {
    await turnPasswordOn();
    const tokenOf = async (userId: string) => {
      const res = await send('POST', `/auth/users/${userId}/password-reset`);
      expect(res.status).toBe(201);
      return ((await res.json()) as { url: string }).url.split('/password-reset/')[1];
    };

    // Issuing a new link replaces the unused one.
    const first = await tokenOf(managerId);
    const second = await tokenOf(managerId);
    expect((await send('GET', `/auth/password-resets/${first}`, { cookie: '' })).status).toBe(410);
    expect((await send('GET', `/auth/password-resets/${second}`, { cookie: '' })).status).toBe(200);

    // Expired after 24 hours.
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE user_id = $1", [managerId]);
    expect((await send('GET', `/auth/password-resets/${second}`, { cookie: '' })).status).toBe(410);

    // While the password method is off a link cannot set a password.
    const live = await tokenOf(managerId);
    expect((await setSettings(true, false)).status).toBe(200);
    const off = await send('POST', `/auth/password-resets/${live}/redeem`, { cookie: '', body: { username: 'casey', password: PASSWORD } });
    expect(off.status).toBe(410);
    expect((await off.json()).error.code).toBe('password_reset_invalid');

    // An unknown token is the same refusal.
    expect((await send('GET', '/auth/password-resets/nope', { cookie: '' })).status).toBe(410);
  });

  it('answers the reset issue with 404 for an unknown user, and refuses a bad user id the same way', async () => {
    const unknown = await send('POST', `/auth/users/${randomUUID()}/password-reset`);
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe('not_found');
    expect((await send('POST', '/auth/users/not-a-uuid/password-reset')).status).toBe(404);
  });

  it('sets up the first admin with a password only with TALEART_SETUP_PASSWORD=true, which turns the method on', async () => {
    await pool.query('TRUNCATE users, projects, auth_settings, password_resets, user_passwords, user_identities, invitations, sessions, passkeys CASCADE');
    await pool.query('INSERT INTO auth_settings (id) VALUES (1)');
    const body = { name: 'Ada Admin', email: 'ada@example.com', username: 'ada.admin', password: PASSWORD };

    // Flag off (the default): the password is not offered on the empty install, and setup is refused.
    expect(await (await send('GET', '/auth/state', { cookie: '' })).json()).toMatchObject({ setupRequired: true, methods: [PASSKEY_METHOD] });
    // Refused like a disabled method, even if the password switch were on.
    await pool.query('UPDATE auth_settings SET password_enabled = true WHERE id = 1');
    const off = await send('POST', '/auth/setup/password', { cookie: '', body });
    expect(off.status).toBe(403);
    expect((await off.json()).error.code).toBe('sign_in_method_disabled');
    await pool.query('UPDATE auth_settings SET password_enabled = false WHERE id = 1');

    // Flag on: the password is offered on the empty install, and setup creates the admin.
    await useApp({ setupPassword: true });
    expect(await (await send('GET', '/auth/state', { cookie: '' })).json()).toMatchObject({
      setupRequired: true,
      methods: [PASSKEY_METHOD, { id: 'password', label: 'Username and password', kind: 'password' }],
    });
    const created = await send('POST', '/auth/setup/password', { cookie: '', body });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ user: { name: 'Ada Admin', role: 'admin' } });
    // The password method is now on, in the same step as the admin.
    expect(await (await send('GET', '/auth/settings', { cookie: sessionCookieOf(created) })).json()).toMatchObject({ passwordEnabled: true });
    expect(await (await send('GET', '/auth/state', { cookie: '' })).json()).toMatchObject({ setupRequired: false, methods: [PASSKEY_METHOD, { id: 'password' }] });

    // The new admin signs in with the password.
    const signedIn = await send('POST', '/auth/password/sign-in', { cookie: '', body: { username: 'ADA.admin', password: PASSWORD } });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ user: { email: 'ada@example.com', role: 'admin' } });

    // Setup is closed once a user exists: a second setup is refused, flag or not.
    const again = await send('POST', '/auth/setup/password', { cookie: '', body: { ...body, email: 'other@example.com', username: 'other.name' } });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('setup_closed');
    expect(await (await send('GET', '/auth/state', { cookie: '' })).json()).toMatchObject({ setupRequired: false, methods: [PASSKEY_METHOD, { id: 'password' }] });
  });

  it('joins through an invitation with a password only while the password method is on', async () => {
    const project = await (await send('POST', '/projects', { body: { name: 'Acme' } })).json();
    const invitation = await (await send('POST', `/projects/${project.id}/invitations`)).json();
    const token = (invitation as { url: string }).url.split('/invite/')[1];
    const body = { name: 'Dee Member', email: 'dee@example.com', username: 'dee.member', password: PASSWORD };

    const off = await send('POST', `/auth/invitations/${token}/password`, { cookie: '', body });
    expect(off.status).toBe(403);
    expect((await off.json()).error.code).toBe('sign_in_method_disabled');
    expect((await send('GET', `/auth/invitations/${token}`, { cookie: '' })).status).toBe(200);

    await turnPasswordOn();
    const joined = await send('POST', `/auth/invitations/${token}/password`, { cookie: '', body });
    expect(joined.status).toBe(201);
    expect(await joined.json()).toMatchObject({ user: { email: 'dee@example.com', role: 'content_manager' } });
    expect((await pool.query('SELECT 1 FROM project_members WHERE project_id = $1', [project.id])).rowCount).toBe(1);

    // The link is used: a second join is refused.
    const again = await send('POST', `/auth/invitations/${token}/password`, { cookie: '', body: { ...body, email: 'eve@example.com', username: 'eve.member' } });
    expect(again.status).toBe(410);
    expect((await again.json()).error.code).toBe('invitation_invalid');
  });

  it('refuses a settings change that would lock every admin out, and turning every method off', async () => {
    // Enabling the password method is fine while the passkey still works for every admin.
    expect((await setSettings(true, true)).status).toBe(200);
    // Without the passkey, the password is the only method, and this admin has none: a lock-out.
    const lockout = await setSettings(false, true);
    expect(lockout.status).toBe(409);
    expect((await lockout.json()).error.code).toBe('sign_in_lockout');
    expect(await (await send('GET', '/auth/settings')).json()).toMatchObject({ passkeyEnabled: true, passwordEnabled: true });

    // With the admin's own password in place, the change goes through.
    await send('PUT', '/auth/account/password', { body: { username: 'ada.admin', password: PASSWORD } });
    expect((await setSettings(false, true)).status).toBe(200);

    // At least one method stays on.
    const none = await setSettings(false, false);
    expect(none.status).toBe(409);
    expect((await none.json()).error.code).toBe('last_sign_in_method');

    // A second admin with only a passkey: the password can no longer keep every admin in.
    const second = await createUser(pool, { name: 'Bo Admin', email: 'bo@example.com', role: 'admin' });
    await addPasskey(second.id);
    expect((await setSettings(true, true)).status).toBe(200);
    expect((await setSettings(true, false)).status).toBe(200);
    expect((await setSettings(false, true)).status).toBe(409);
  });

  it('refuses to remove a user\'s last usable method, and keeps the rest working', async () => {
    await send('PUT', '/auth/account/password', { cookie: managerCookie, body: { username: 'casey', password: PASSWORD } });
    const passkeyId = await addPasskey(managerId);
    await turnPasswordOn();
    const { rows: [identity] } = await pool.query<{ id: string }>(
      `INSERT INTO user_identities (user_id, provider, subject, email) VALUES ($1, 'google', 'sub-1', 'casey@example.com') RETURNING id`,
      [managerId],
    );

    // A passkey goes while the password and the identity remain.
    expect((await send('DELETE', `/auth/account/passkeys/${passkeyId}`, { cookie: managerCookie })).status).toBe(204);
    // The identity goes while the password remains.
    expect((await send('DELETE', `/auth/account/identities/${identity.id}`, { cookie: managerCookie })).status).toBe(204);
    // The last one cannot.
    const last = await send('DELETE', '/auth/account/password', { cookie: managerCookie });
    expect(last.status).toBe(409);
    expect((await last.json()).error.code).toBe('last_sign_in_method');

    // A password that is off is not a method the user keeps: the passkey goes only with another usable one.
    const passkey = await addPasskey(managerId);
    expect((await setSettings(true, false)).status).toBe(200);
    const off = await send('DELETE', `/auth/account/passkeys/${passkey}`, { cookie: managerCookie });
    expect(off.status).toBe(409);
    expect((await off.json()).error.code).toBe('last_sign_in_method');

    // Another user's passkey is not found, and neither is a bad id.
    const adminPasskey = (await pool.query<{ id: string }>('SELECT id FROM passkeys WHERE user_id = $1', [adminId])).rows[0].id;
    expect((await send('DELETE', `/auth/account/passkeys/${adminPasskey}`, { cookie: managerCookie })).status).toBe(404);
    expect((await send('DELETE', '/auth/account/passkeys/not-an-id', { cookie: managerCookie })).status).toBe(404);
    const methods = await (await send('GET', '/auth/account/methods', { cookie: managerCookie })).json();
    expect(methods.identities).toEqual([]);
    expect(methods.passkeys).toHaveLength(1);
  });

  it('saves a provider with an encrypted secret, never returns it, and offers it only when usable', async () => {
    const saved = await send('PUT', '/auth/providers/google', {
      body: { displayName: 'Google', enabled: false, config: { clientId: '123-abc.apps.googleusercontent.com' }, secret: CLIENT_SECRET },
    });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toEqual({
      slug: 'google',
      kind: 'google',
      id: 'google',
      displayName: 'Google',
      enabled: false,
      usable: false,
      config: { clientId: '123-abc.apps.googleusercontent.com' },
      hasSecret: true,
      redirectUri: 'https://api.example.com/api/v1/auth/callback/google',
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(CLIENT_SECRET);

    // Stored encrypted: the plain secret is not in the row, and the key reads it back.
    const { rows } = await pool.query<{ secret: Buffer }>('SELECT secret_enc AS secret FROM auth_providers WHERE slug = $1', ['google']);
    expect(rows[0].secret.includes(Buffer.from(CLIENT_SECRET))).toBe(false);
    expect(decryptSecret(rows[0].secret, SECRET_KEY)).toBe(CLIENT_SECRET);

    // A save without a secret keeps the stored one; null removes it.
    const kept = await send('PUT', '/auth/providers/google', { body: { displayName: 'Google', enabled: true, config: { clientId: '123-abc.apps.googleusercontent.com' } } });
    expect(await kept.json()).toMatchObject({ hasSecret: true, usable: true });
    expect((await (await send('GET', '/auth/state', { cookie: '' })).json()).methods).toContainEqual({ id: 'google', label: 'Google', kind: 'google' });
    const cleared = await send('PUT', '/auth/providers/google', { body: { displayName: 'Google', enabled: true, config: { clientId: '123-abc.apps.googleusercontent.com' }, secret: null } });
    expect(await cleared.json()).toMatchObject({ hasSecret: false, usable: false });
    expect((await (await send('GET', '/auth/state', { cookie: '' })).json()).methods).toEqual([{ id: 'passkey', label: 'Passkey', kind: 'passkey' }]);

    const list = await send('GET', '/auth/providers');
    expect(await list.json()).toEqual([expect.objectContaining({ slug: 'google', hasSecret: false })]);
    expect((await send('GET', '/auth/providers', { cookie: managerCookie })).status).toBe(403);
  });

  it('refuses a provider secret without a valid key, with a clear error and no echo of the secret', async () => {
    await useApp({ secretKey: null });
    const refused = await send('PUT', '/auth/providers/google', {
      body: { displayName: 'Google', enabled: false, config: { clientId: 'abc' }, secret: CLIENT_SECRET },
    });
    expect(refused.status).toBe(503);
    const error = await refused.json();
    expect(error.error.code).toBe('secret_key_missing');
    expect(JSON.stringify(error)).toContain('TALEART_SECRET_KEY');
    expect(JSON.stringify(error)).not.toContain(CLIENT_SECRET);
    expect((await pool.query('SELECT 1 FROM auth_providers')).rowCount).toBe(0);

    // Without a secret the provider saves, and is not usable.
    const plain = await send('PUT', '/auth/providers/google', { body: { displayName: 'Google', enabled: true, config: { clientId: 'abc' } } });
    expect(plain.status).toBe(200);
    expect(await plain.json()).toMatchObject({ hasSecret: false, usable: false });
    expect(await (await send('GET', '/auth/settings')).json()).toMatchObject({ secretKeyConfigured: false });
  });

  it('validates each provider kind\'s settings and secret, and never echoes the secret in a refusal', async () => {
    const put = (slug: string, body: unknown) => send('PUT', `/auth/providers/${slug}`, { body });
    const expectRefused = async (res: Response) => {
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('validation_failed');
    };

    // Unknown settings for the kind, and a bad slug.
    await expectRefused(await put('google', { displayName: 'Google', enabled: false, config: { clientId: 'a', issuer: 'https://x.example' } }));
    await expectRefused(await put('Bad Slug', { displayName: 'X', enabled: false, config: { clientId: 'a' } }));
    // OpenID Connect: an https issuer, or http on localhost outside production only.
    await expectRefused(await put('corp', { displayName: 'Corp', enabled: false, config: { issuer: 'http://idp.example.com', clientId: 'a' }, secret: 's' }));
    await expectRefused(await put('corp', { displayName: 'Corp', enabled: false, config: { issuer: 'https://user:pw@idp.example.com', clientId: 'a' }, secret: 's' }));
    // Apple: the team and key ids, and the .p8 key as PEM, never echoed.
    await expectRefused(await put('apple', { displayName: 'Apple', enabled: false, config: { clientId: 'com.example.web', teamId: 'short', keyId: 'KEY1234567' }, secret: APPLE_KEY }));
    const badKey = await put('apple', { displayName: 'Apple', enabled: false, config: { clientId: 'com.example.web', teamId: 'ABCDE12345', keyId: 'KEY1234567' }, secret: 'not a key at all' });
    // The body is read once, here: it is the refusal's, and it must not echo the secret.
    const badKeyText = await badKey.text();
    expect(badKey.status).toBe(400);
    expect(JSON.parse(badKeyText).error.code).toBe('validation_failed');
    expect(badKeyText).not.toContain('not a key at all');
    // A secret over 8 KB, and scopes without openid.
    await expectRefused(await put('corp', { displayName: 'Corp', enabled: false, config: { issuer: 'https://idp.example.com', clientId: 'a' }, secret: 'x'.repeat(8193) }));
    await expectRefused(await put('corp', { displayName: 'Corp', enabled: false, config: { issuer: 'https://idp.example.com', clientId: 'a', scopes: 'email profile' }, secret: 's' }));

    // Valid ones save, and the OpenID Connect method is named by its slug.
    const oidc = await put('corp', { displayName: 'Corp', enabled: false, config: { issuer: 'https://idp.example.com/', clientId: 'a' }, secret: 'corp-secret-value' });
    expect(oidc.status).toBe(200);
    expect(await oidc.json()).toMatchObject({ kind: 'oidc', id: 'oidc:corp', redirectUri: 'https://api.example.com/api/v1/auth/callback/corp' });
    const apple = await put('apple', { displayName: 'Apple', enabled: false, config: { clientId: 'com.example.web', teamId: 'ABCDE12345', keyId: 'KEY1234567' }, secret: APPLE_KEY });
    expect(apple.status).toBe(200);
    expect(await apple.json()).toMatchObject({ kind: 'apple', id: 'apple', hasSecret: true });

    // Deleting: an unknown slug is 404, a known one goes.
    expect((await send('DELETE', '/auth/providers/nothing-here')).status).toBe(404);
    expect((await (await send('DELETE', '/auth/providers/nothing-here')).json()).error.code).toBe('provider_not_found');
    expect((await send('DELETE', '/auth/providers/corp')).status).toBe(204);
    expect((await send('GET', '/auth/providers')).status).toBe(200);
    expect(await (await send('GET', '/auth/providers')).json()).toHaveLength(1);
  });

  it('refuses to delete the provider that is the last method on, and lets an admin keep the last one usable', async () => {
    await useApp({ secretKey: SECRET_KEY });
    await send('PUT', '/auth/account/password', { body: { username: 'ada.admin', password: PASSWORD } });
    // Google is on, usable (a secret and the key) and the admin signs in with it, so the passkey can go.
    expect((await send('PUT', '/auth/providers/google', { body: { displayName: 'Google', enabled: true, config: { clientId: 'abc' }, secret: CLIENT_SECRET } })).status).toBe(200);
    await pool.query("INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', 'admin-sub')", [adminId]);
    expect((await setSettings(false, false)).status).toBe(200);
    // Removing the provider leaves no method on at all.
    const gone = await send('DELETE', '/auth/providers/google');
    expect(gone.status).toBe(409);
    expect((await gone.json()).error.code).toBe('last_sign_in_method');
    expect((await send('GET', '/auth/providers')).status).toBe(200);
  });
});

// Provider sign-in (sign-in methods, part 2): a fake OpenID Connect provider runs in this process and
// signs real ID tokens; the API talks to it over localhost (http is allowed for localhost issuers).
describe('Provider sign-in: OpenID Connect, Google and Apple', () => {
  const clientId = 'taleart-client';
  const clientSecret = 'provider-client-secret-value';
  const dashboard = 'http://localhost:4200';
  const appleTeam = 'ABCDE12345';
  const appleKeyId = 'KEYID12345';
  const sessionKey = randomBytes(32);
  type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
  let rsa: KeyPair;
  let ec: KeyPair;
  let wrong: KeyPair;
  let applePem: string;
  let applePublic: KeyPair['publicKey'];

  // What the fake provider does for the next authorization: the claims and signature it gives.
  interface Mode {
    nonce?: string;
    omitNonce?: boolean;
    aud?: string;
    iss?: string;
    expiresIn?: number;
    sub?: string;
    email?: string | null;
    emailVerified?: unknown;
    signer?: 'rsa' | 'ec';
    alg?: 'signed' | 'bad-signature' | 'none' | 'HS256';
    issuerInDiscovery?: string;
    redirectDiscovery?: string;
    paddedDiscovery?: boolean;
  }

  interface Fake {
    base: string;
    mode: Mode;
    secretCheck: 'plain' | 'apple';
    close(): Promise<void>;
  }

  let fake: Fake;
  let pool: Pool;
  let server: Server | null;
  let origin: string;
  let adminSession: string;

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let text = '';
      req.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      req.on('end', () => resolve(text));
    });
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  // The claims of an ID token for the request that asked for it.
  async function idTokenFor(base: string, params: URLSearchParams, mode: Mode): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: mode.iss ?? base,
      aud: mode.aud ?? clientId,
      sub: mode.sub ?? 'provider-subject-1',
      iat: now,
      exp: now + (mode.expiresIn ?? 300),
      nonce: mode.nonce ?? params.get('nonce') ?? undefined,
      name: 'Provider Person',
    };
    if (mode.omitNonce) delete claims['nonce'];
    if (mode.email !== null) {
      claims['email'] = mode.email ?? 'person@example.com';
      claims['email_verified'] = mode.emailVerified === undefined ? true : mode.emailVerified;
    }
    if (mode.alg === 'none') {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    }
    if (mode.alg === 'HS256') {
      return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('s'.repeat(32)));
    }
    if (mode.signer === 'ec') {
      return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'ec-1' }).sign(ec.privateKey);
    }
    const key = mode.alg === 'bad-signature' ? wrong.privateKey : rsa.privateKey;
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'rsa-1' }).sign(key);
  }

  async function startFake(): Promise<Fake> {
    const codes = new Map<string, { idToken: string; codeChallenge: string | null }>();
    const fakeState = {
      base: '',
      mode: {} as Mode,
      secretCheck: 'plain' as Fake['secretCheck'],
    };
    const http = createHttpServer(async (req, res) => {
      const url = new URL(req.url ?? '/', fakeState.base);
      if (url.pathname === '/.well-known/openid-configuration') {
        if (fakeState.mode.redirectDiscovery) {
          res.writeHead(302, { location: fakeState.mode.redirectDiscovery }).end();
          return;
        }
        if (fakeState.mode.paddedDiscovery) {
          sendJson(res, 200, { issuer: fakeState.base, padding: 'x'.repeat(300 * 1024) });
          return;
        }
        sendJson(res, 200, {
          issuer: fakeState.mode.issuerInDiscovery ?? fakeState.base,
          authorization_endpoint: `${fakeState.base}/authorize`,
          token_endpoint: `${fakeState.base}/token`,
          jwks_uri: `${fakeState.base}/jwks`,
        });
        return;
      }
      if (url.pathname === '/jwks') {
        sendJson(res, 200, {
          keys: [
            { ...(await exportJWK(rsa.publicKey)), kid: 'rsa-1', alg: 'RS256', use: 'sig' },
            { ...(await exportJWK(ec.publicKey)), kid: 'ec-1', alg: 'ES256', use: 'sig' },
          ],
        });
        return;
      }
      if (url.pathname === '/authorize') {
        const code = randomUUID();
        const idToken = await idTokenFor(fakeState.base, url.searchParams, fakeState.mode);
        codes.set(code, { idToken, codeChallenge: url.searchParams.get('code_challenge') });
        const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', code);
        redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
        res.writeHead(302, { location: redirect.toString() }).end();
        return;
      }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(await readBody(req));
        const entry = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const pkce = createHash('sha256').update(verifier).digest('base64url');
        if (!entry || entry.codeChallenge !== pkce || form.get('client_id') !== clientId) {
          sendJson(res, 400, { error: 'invalid_grant' });
          return;
        }
        const secret = form.get('client_secret') ?? '';
        try {
          if (fakeState.secretCheck === 'apple') {
            await jwtVerify(secret, applePublic, { issuer: appleTeam, audience: 'https://appleid.apple.com', subject: clientId, algorithms: ['ES256'] });
          } else if (secret !== clientSecret) {
            throw new Error('wrong secret');
          }
        } catch {
          sendJson(res, 401, { error: 'invalid_client' });
          return;
        }
        sendJson(res, 200, { id_token: entry.idToken, token_type: 'Bearer' });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
    const port = (http.address() as AddressInfo).port;
    fakeState.base = `http://127.0.0.1:${port}`;
    return {
      get base() {
        return fakeState.base;
      },
      get mode() {
        return fakeState.mode;
      },
      set mode(value: Mode) {
        fakeState.mode = value;
      },
      get secretCheck() {
        return fakeState.secretCheck;
      },
      set secretCheck(value: Fake['secretCheck']) {
        fakeState.secretCheck = value;
      },
      close: () => new Promise<void>((resolve) => http.close(() => resolve())),
    } as Fake;
  }

  // The API, with the fake as the Google and Apple issuers, and a flow limit that does not refuse tests.
  function boot(extra: { allowHttpIssuer?: boolean; flowLimit?: RateLimitOptions | null } = {}): Promise<Server> {
    const app = createApp(
      pool,
      loadFrameTypeRegistry(frameTypesDir),
      new LocalDiskStorage(mediaDir),
      {
        verifier: fakeVerifier,
        secretKey: sessionKey,
        dashboardOrigin: dashboard,
        allowHttpIssuer: extra.allowHttpIssuer ?? true,
        presetIssuers: { google: fake.base, apple: fake.base },
        providerFlowLimit: extra.flowLimit === undefined ? null : extra.flowLimit,
      },
      { publicApiUrl },
      undefined,
      { rateLimit: null },
    );
    return new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
  }

  async function addProvider(slug: string, kind: 'oidc' | 'google' | 'apple', config: Record<string, string>, secret: string | null, enabled = true) {
    const enc = secret === null ? null : encryptSecret(secret, sessionKey);
    await pool.query(
      'INSERT INTO auth_providers (slug, kind, display_name, enabled, config, secret_enc) VALUES ($1, $2, $3, $4, $5, $6)',
      [slug, kind, slug, enabled, JSON.stringify(config), enc],
    );
  }

  async function addIdentity(userId: string, provider: string, subject = 'provider-subject-1') {
    await pool.query('INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, $2, $3)', [userId, provider, subject]);
  }

  // The two halves of a flow: the start (the browser goes to the provider) and the callback (back).
  async function start(slug: string, query: string, cookie?: string): Promise<Response> {
    return globalThis.fetch(`${origin}/api/v1/auth/providers/${slug}/start?${query}`, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
    });
  }

  // The provider's own step: it signs the user in and redirects back with the code and state.
  async function providerRedirect(startResponse: Response): Promise<{ code: string; state: string }> {
    const toProvider = startResponse.headers.get('location');
    if (!toProvider) throw new Error('start did not redirect to the provider');
    const back = await globalThis.fetch(toProvider, { redirect: 'manual' });
    const location = new URL(back.headers.get('location') ?? '');
    return { code: location.searchParams.get('code') ?? '', state: location.searchParams.get('state') ?? '' };
  }

  function oauthCookie(res: Response): string {
    for (const line of res.headers.getSetCookie()) {
      const match = /^taleart_oauth=([^;]*)/.exec(line);
      if (match) return `taleart_oauth=${match[1]}`;
    }
    return '';
  }

  // The cookies a browser would send: none at all when empty.
  const cookieHeader = (cookies: string[]): Record<string, string> => {
    const joined = cookies.filter(Boolean).join('; ');
    return joined ? { cookie: joined } : {};
  };

  async function callback(slug: string, params: Record<string, string>, cookies: string[]): Promise<Response> {
    const query = new URLSearchParams(params).toString();
    return globalThis.fetch(`${origin}/api/v1/auth/callback/${slug}?${query}`, {
      redirect: 'manual',
      headers: cookieHeader(cookies),
    });
  }

  async function callbackPost(slug: string, body: string, cookies: string[], contentType = 'application/x-www-form-urlencoded'): Promise<Response> {
    return globalThis.fetch(`${origin}/api/v1/auth/callback/${slug}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': contentType, ...cookieHeader(cookies) },
      body,
    });
  }

  const authError = (res: Response) => new URL(res.headers.get('location') ?? '', dashboard).searchParams.get('auth_error');
  const signedIn = (res: Response) => res.headers.getSetCookie().some((line) => line.startsWith('taleart_session='));

  // A full sign-in as a browser runs it: the start (with the session cookie, for a link), the provider,
  // then the callback with only the Lax oauth cookie. Apple's form POST carries no cookie: it stores the
  // code and the GET that resumes the flow is what completes the login. Returns the completing response.
  async function signInFlow(slug: string, query: string, opts: { session?: string; apple?: boolean } = {}): Promise<Response> {
    const startRes = await start(slug, query, opts.session);
    const cookie = oauthCookie(startRes);
    const { code, state } = await providerRedirect(startRes);
    if (opts.apple) {
      const posted = await callbackPost(slug, new URLSearchParams({ code, state }).toString(), []);
      const resume = new URL(posted.headers.get('location') ?? '', origin);
      return callback(slug, { state: resume.searchParams.get('state') ?? '', resume: '1' }, [cookie]);
    }
    return callback(slug, { code, state }, [cookie]);
  }

  beforeAll(async () => {
    rsa = await generateKeyPair('RS256');
    ec = await generateKeyPair('ES256');
    wrong = await generateKeyPair('RS256');
    const apple = await generateKeyPair('ES256', { extractable: true });
    applePem = await exportPKCS8(apple.privateKey);
    applePublic = apple.publicKey;
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
    fake = await startFake();
  });

  afterAll(async () => {
    await fake.close();
    await pool.end();
  });

  beforeEach(async () => {
    fake.mode = {};
    fake.secretCheck = 'plain';
    await pool.query(
      'TRUNCATE users, projects, auth_providers, auth_settings, auth_challenges CASCADE',
    );
    const admin = await createUser(pool, { name: 'Admin', email: 'admin@example.com', role: 'admin' });
    adminSession = `taleart_session=${(await createSession(pool, admin.id)).token}`;
    server = await boot();
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  it('signs in a linked identity of a generic OpenID Connect provider and sets the session', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const user = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    await addIdentity(user.id, 'oidc:corp');

    const startRes = await start('corp', 'purpose=sign-in');
    expect(startRes.status).toBe(302);
    const authorization = new URL(startRes.headers.get('location') ?? '');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('scope')).toBe('openid email profile');
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${publicApiUrl}/api/v1/auth/callback/corp`);
    const { code, state } = await providerRedirect(startRes);
    const done = await callback('corp', { code, state }, [oauthCookie(startRes)]);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe(`${dashboard}/`);
    expect(signedIn(done)).toBe(true);
    // The client secret never leaves the server.
    expect(JSON.stringify([...done.headers.entries()])).not.toContain(clientSecret);
  });

  it('refuses a sign-in whose identity is not linked, with the generic code', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const done = await signInFlow('corp', 'purpose=sign-in');
    expect(authError(done)).toBe('sign_in_failed');
    expect(signedIn(done)).toBe(false);
  });

  it('creates the first admin with a verified provider email when setup is open (Google preset)', async () => {
    await pool.query('DELETE FROM users');
    await addProvider('google', 'google', { clientId }, clientSecret);
    const done = await signInFlow('google', 'purpose=setup');
    expect(signedIn(done)).toBe(true);
    const { rows } = await pool.query<{ role: string; email: string }>('SELECT role, email FROM users');
    expect(rows).toEqual([{ role: 'admin', email: 'person@example.com' }]);
    const { rows: ids } = await pool.query<{ provider: string }>('SELECT provider FROM user_identities');
    expect(ids).toEqual([{ provider: 'google' }]);
  });

  it('accepts an Apple email_verified given as the string "true" for setup', async () => {
    await pool.query('DELETE FROM users');
    fake.mode = { signer: 'ec', emailVerified: 'true' };
    fake.secretCheck = 'apple';
    await addProvider('apple', 'apple', { clientId, teamId: appleTeam, keyId: appleKeyId }, applePem);
    const done = await signInFlow('apple', 'purpose=setup', { apple: true });
    expect(signedIn(done)).toBe(true);
    expect(authError(done)).toBeNull();
  });

  it('refuses setup once a user exists', async () => {
    await addProvider('google', 'google', { clientId }, clientSecret);
    const json = await start('google', 'purpose=setup&format=json');
    expect(json.status).toBe(409);
    expect((await json.json()).error.code).toBe('setup_closed');
    const refused = await start('google', 'purpose=setup');
    expect(authError(refused)).toBe('setup_closed');
    expect(signedIn(refused)).toBe(false);
  });

  it('refuses setup with an unverified provider email', async () => {
    await pool.query('DELETE FROM users');
    fake.mode = { emailVerified: false };
    await addProvider('google', 'google', { clientId }, clientSecret);
    const done = await signInFlow('google', 'purpose=setup');
    expect(authError(done)).toBe('email_not_verified');
  });

  it('joins through an invitation when the verified email is the invitation email (Google preset)', async () => {
    const project = await createProject(pool, { name: 'Site' });
    const admin = await createUser(pool, { name: 'Boss', email: 'boss@example.com', role: 'admin' });
    const invitation = await createInvitation(pool, { projectId: project.id, createdBy: { id: admin.id, name: 'Admin' } });
    await addProvider('google', 'google', { clientId }, clientSecret);
    const query = `purpose=invitation&token=${invitation.token}&email=Person@Example.com`;
    const done = await signInFlow('google', query);
    expect(signedIn(done)).toBe(true);
    const { rows } = await pool.query<{ role: string; email: string }>(
      "SELECT role, email FROM users WHERE email = 'person@example.com'",
    );
    expect(rows).toEqual([{ role: 'content_manager', email: 'person@example.com' }]);
    const { rows: members } = await pool.query('SELECT 1 FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE u.email = $1', ['person@example.com']);
    expect(members).toHaveLength(1);
    const { rows: used } = await pool.query('SELECT used_at FROM invitations WHERE id = $1', [invitation.id]);
    expect(used[0].used_at).not.toBeNull();
  });

  it('refuses an invitation when the verified email is not the invitation email', async () => {
    const project = await createProject(pool, { name: 'Site' });
    const admin = await createUser(pool, { name: 'Boss', email: 'boss@example.com', role: 'admin' });
    const invitation = await createInvitation(pool, { projectId: project.id, createdBy: { id: admin.id, name: 'Admin' } });
    await addProvider('google', 'google', { clientId }, clientSecret);
    const done = await signInFlow('google', `purpose=invitation&token=${invitation.token}&email=someone.else@example.com`);
    expect(authError(done)).toBe('email_mismatch');
    expect(signedIn(done)).toBe(false);
  });

  it('refuses an invitation with an unverified provider email', async () => {
    const project = await createProject(pool, { name: 'Site' });
    const admin = await createUser(pool, { name: 'Boss', email: 'boss@example.com', role: 'admin' });
    const invitation = await createInvitation(pool, { projectId: project.id, createdBy: { id: admin.id, name: 'Admin' } });
    fake.mode = { emailVerified: 'false' };
    await addProvider('google', 'google', { clientId }, clientSecret);
    const done = await signInFlow('google', `purpose=invitation&token=${invitation.token}&email=person@example.com`);
    expect(authError(done)).toBe('email_not_verified');
  });

  it('refuses an invitation link that is no longer valid', async () => {
    await addProvider('google', 'google', { clientId }, clientSecret);
    const json = await start('google', 'purpose=invitation&token=not-a-real-token&email=person@example.com&format=json');
    expect(json.status).toBe(410);
    expect((await json.json()).error.code).toBe('invitation_invalid');
  });

  it('attaches the provider to the signed-in user when linking, and refuses a link already attached to someone', async () => {
    const member = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    const session = `taleart_session=${(await createSession(pool, member.id)).token}`;
    await addProvider('google', 'google', { clientId }, clientSecret);
    const linked = await signInFlow('google', 'purpose=link', { session });
    expect(authError(linked)).toBeNull();
    expect(signedIn(linked)).toBe(false);
    const { rows } = await pool.query<{ user_id: string }>("SELECT user_id FROM user_identities WHERE provider = 'google'");
    expect(rows).toEqual([{ user_id: member.id }]);

    const other = await createUser(pool, { name: 'Other', email: 'other@example.com', role: 'content_manager' });
    const otherSession = `taleart_session=${(await createSession(pool, other.id)).token}`;
    const refused = await signInFlow('google', 'purpose=link', { session: otherSession });
    expect(authError(refused)).toBe('identity_in_use');
  });

  it('refuses a link without a session at the start, and after its session is revoked before the callback', async () => {
    const member = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    const session = `taleart_session=${(await createSession(pool, member.id)).token}`;
    await addProvider('google', 'google', { clientId }, clientSecret);
    const noSession = await start('google', 'purpose=link');
    expect(noSession.status).toBe(302);
    expect(authError(noSession)).toBe('session_required');

    const startRes = await start('google', 'purpose=link', session);
    const { code, state } = await providerRedirect(startRes);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [member.id]);
    const done = await callback('google', { code, state }, [oauthCookie(startRes)]);
    expect(authError(done)).toBe('session_required');
    const { rows } = await pool.query('SELECT 1 FROM user_identities WHERE user_id = $1', [member.id]);
    expect(rows).toEqual([]);
  });

  it('signs in with Apple: client secret JWT, a cookieless form POST, then the resumed GET with the oauth cookie', async () => {
    fake.mode = { signer: 'ec' };
    fake.secretCheck = 'apple';
    await addProvider('apple', 'apple', { clientId, teamId: appleTeam, keyId: appleKeyId }, applePem);
    const user = await createUser(pool, { name: 'Apple User', email: 'relay@privaterelay.example', role: 'content_manager' });
    await addIdentity(user.id, 'apple');
    const startRes = await start('apple', 'purpose=sign-in');
    expect(new URL(startRes.headers.get('location') ?? '').searchParams.get('response_mode')).toBe('form_post');
    expect(new URL(startRes.headers.get('location') ?? '').searchParams.get('scope')).toBe('name email');
    const { code, state } = await providerRedirect(startRes);
    const posted = await callbackPost('apple', new URLSearchParams({ code, state }).toString(), []);
    expect(posted.status).toBe(303);
    expect(posted.headers.getSetCookie()).toEqual([]);
    const resume = new URL(posted.headers.get('location') ?? '', origin);
    expect(resume.pathname).toBe('/api/v1/auth/callback/apple');
    expect(resume.searchParams.get('resume')).toBe('1');
    expect(resume.searchParams.get('code')).toBeNull();
    const done = await callback('apple', { state, resume: '1' }, [oauthCookie(startRes)]);
    expect(done.status).toBe(302);
    expect(signedIn(done)).toBe(true);
    expect(done.headers.get('location')).toBe(`${dashboard}/`);
  });

  it('resumes a form POST only with the oauth cookie, ignores a code in the resume query, and uses the stored code once', async () => {
    fake.mode = { signer: 'ec' };
    fake.secretCheck = 'apple';
    await addProvider('apple', 'apple', { clientId, teamId: appleTeam, keyId: appleKeyId }, applePem);
    const user = await createUser(pool, { name: 'Apple User', email: 'relay@privaterelay.example', role: 'content_manager' });
    await addIdentity(user.id, 'apple');
    const startRes = await start('apple', 'purpose=sign-in');
    const cookie = oauthCookie(startRes);
    const { code, state } = await providerRedirect(startRes);
    const posted = await callbackPost('apple', new URLSearchParams({ code, state }).toString(), []);
    expect(posted.status).toBe(303);
    // The resume without the oauth cookie is refused, and the challenge is left for the browser that has it.
    const noCookie = await callback('apple', { state, resume: '1' }, []);
    expect(authError(noCookie)).toBe('sign_in_failed');
    expect(signedIn(noCookie)).toBe(false);
    // A code in the resume query is never read: the stored code completes the login.
    const resumed = await callback('apple', { state, resume: '1', code: 'forged-code' }, [cookie]);
    expect(signedIn(resumed)).toBe(true);
    // The challenge and its stored code are gone: a second resume is refused.
    const { rows } = await pool.query('SELECT 1 FROM auth_challenges WHERE challenge = $1', [state]);
    expect(rows).toEqual([]);
    expect(authError(await callback('apple', { state, resume: '1' }, [cookie]))).toBe('sign_in_failed');
  });

  it('stores a form POST code once per open state, and refuses an unknown state', async () => {
    await addProvider('apple', 'apple', { clientId, teamId: appleTeam, keyId: appleKeyId }, applePem);
    const startRes = await start('apple', 'purpose=sign-in');
    const { code, state } = await providerRedirect(startRes);
    const form = new URLSearchParams({ code, state }).toString();
    const first = await callbackPost('apple', form, []);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toContain('resume=1');
    const again = await callbackPost('apple', form, []);
    expect(authError(again)).toBe('sign_in_failed');
    const unknown = await callbackPost('apple', new URLSearchParams({ code, state: 'no-such-state' }).toString(), []);
    expect(authError(unknown)).toBe('sign_in_failed');
  });

  it('refuses a form callback of another content type or an oversized body', async () => {
    await addProvider('apple', 'apple', { clientId, teamId: appleTeam, keyId: appleKeyId }, applePem);
    const startRes = await start('apple', 'purpose=sign-in');
    const { code, state } = await providerRedirect(startRes);
    const wrongType = await callbackPost('apple', JSON.stringify({ code, state }), [], 'application/json');
    expect(authError(wrongType)).toBe('sign_in_failed');
    const big = await callbackPost('apple', `code=${'a'.repeat(20 * 1024)}&state=${state}`, []);
    expect(authError(big)).toBe('sign_in_failed');
  });

  it('refuses a wrong state, a reused state, a missing or mismatched cookie, and an expired challenge', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const user = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    await addIdentity(user.id, 'oidc:corp');

    const wrongState = await start('corp', 'purpose=sign-in');
    const a = await providerRedirect(wrongState);
    expect(authError(await callback('corp', { code: a.code, state: 'tampered' }, [oauthCookie(wrongState)]))).toBe('sign_in_failed');

    const reused = await start('corp', 'purpose=sign-in');
    const b = await providerRedirect(reused);
    expect(signedIn(await callback('corp', { code: b.code, state: b.state }, [oauthCookie(reused)]))).toBe(true);
    expect(authError(await callback('corp', { code: b.code, state: b.state }, [oauthCookie(reused)]))).toBe('sign_in_failed');

    const noCookie = await start('corp', 'purpose=sign-in');
    const c = await providerRedirect(noCookie);
    expect(authError(await callback('corp', { code: c.code, state: c.state }, []))).toBe('sign_in_failed');

    const other = await start('corp', 'purpose=sign-in');
    const otherCookie = oauthCookie(other);
    const mismatched = await start('corp', 'purpose=sign-in');
    const d = await providerRedirect(mismatched);
    expect(authError(await callback('corp', { code: d.code, state: d.state }, [otherCookie]))).toBe('sign_in_failed');

    const expired = await start('corp', 'purpose=sign-in');
    const e = await providerRedirect(expired);
    await pool.query("UPDATE auth_challenges SET expires_at = now() - interval '1 second' WHERE kind = 'oauth'");
    expect(authError(await callback('corp', { code: e.code, state: e.state }, [oauthCookie(expired)]))).toBe('sign_in_failed');
  });

  it('refuses a token whose nonce, audience, issuer, expiry, signature or algorithm is wrong', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const user = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    await addIdentity(user.id, 'oidc:corp');
    const cases: Mode[] = [
      { nonce: 'not-the-nonce' },
      { omitNonce: true },
      { aud: 'another-client' },
      { iss: 'https://evil.example' },
      { expiresIn: -600 },
      { alg: 'bad-signature' },
      { alg: 'none' },
      { alg: 'HS256' },
    ];
    for (const mode of cases) {
      fake.mode = mode;
      const done = await signInFlow('corp', 'purpose=sign-in');
      expect(authError(done), JSON.stringify(mode)).toBe('sign_in_failed');
      expect(signedIn(done), JSON.stringify(mode)).toBe(false);
    }
  });

  it('refuses a discovery whose issuer differs from the configured one', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    fake.mode = { issuerInDiscovery: `${fake.base}/elsewhere` };
    const json = await start('corp', 'purpose=sign-in&format=json');
    expect(json.status).toBe(503);
    expect((await json.json()).error.code).toBe('discovery_failed');
    const test = await adminPost('/api/v1/auth/providers/corp/test');
    expect(await test.json()).toEqual({ ok: false, code: 'discovery_failed' });
  });

  it('refuses a discovery that redirects to another host, or is larger than 256 KB', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    fake.mode = { redirectDiscovery: 'https://example.com/.well-known/openid-configuration' };
    expect(await (await adminPost('/api/v1/auth/providers/corp/test')).json()).toEqual({ ok: false, code: 'discovery_failed' });
    fake.mode = { paddedDiscovery: true };
    expect(await (await adminPost('/api/v1/auth/providers/corp/test')).json()).toEqual({ ok: false, code: 'discovery_failed' });
  });

  it('refuses an http issuer when http issuers are not allowed, and accepts the localhost one when they are', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = await boot({ allowHttpIssuer: false });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await adminPost('/api/v1/auth/providers/corp/test')).json()).toEqual({ ok: false, code: 'discovery_failed' });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = await boot({ allowHttpIssuer: true });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ok = await (await adminPost('/api/v1/auth/providers/corp/test')).json();
    expect(ok.ok).toBe(true);
    expect(ok.issuer).toBe(fake.base);
    expect(ok.endpoints.token).toBe(`${fake.base}/token`);
  });

  it('refuses sign-in with a disabled provider, or one with no stored secret, with the same generic code', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, null, true);
    const noSecret = await start('corp', 'purpose=sign-in&format=json');
    expect(noSecret.status).toBe(401);
    expect((await noSecret.json()).error.code).toBe('sign_in_failed');
    await pool.query("UPDATE auth_providers SET secret_enc = $1 WHERE slug = 'corp'", [encryptSecret(clientSecret, sessionKey)]);
    await pool.query("UPDATE auth_providers SET enabled = false WHERE slug = 'corp'");
    const off = await start('corp', 'purpose=sign-in&format=json');
    expect(off.status).toBe(401);
    expect((await off.json()).error.code).toBe('sign_in_failed');
  });

  it('never lets an API token reach the provider routes', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const headers = { authorization: 'Bearer taleart_pat_not_a_session' };
    const start1 = await globalThis.fetch(`${origin}/api/v1/auth/providers/corp/start?purpose=sign-in`, { redirect: 'manual', headers });
    expect(start1.status).toBe(403);
    const cb = await globalThis.fetch(`${origin}/api/v1/auth/callback/corp?code=x&state=y`, { redirect: 'manual', headers });
    expect(cb.status).toBe(403);
    const test = await globalThis.fetch(`${origin}/api/v1/auth/providers/corp/test`, { method: 'POST', headers });
    expect(test.status).toBe(403);
  });

  it('answers the admin Test button for admins only', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const member = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    const memberSession = `taleart_session=${(await createSession(pool, member.id)).token}`;
    const denied = await globalThis.fetch(`${origin}/api/v1/auth/providers/corp/test`, { method: 'POST', headers: { cookie: memberSession } });
    expect(denied.status).toBe(403);
    const ok = await adminPost('/api/v1/auth/providers/corp/test');
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it('applies the per-address limit to starts and callbacks', async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = await boot({ flowLimit: { burst: 2, perSecond: 0.001 } });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    expect((await start('corp', 'purpose=sign-in')).status).toBe(302);
    expect((await start('corp', 'purpose=sign-in')).status).toBe(302);
    const limited = await start('corp', 'purpose=sign-in&format=json');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });

  it('keeps the state, nonce, PKCE verifier and every secret out of the responses', async () => {
    await addProvider('corp', 'oidc', { issuer: fake.base, clientId }, clientSecret);
    const user = await createUser(pool, { name: 'Member', email: 'member@example.com', role: 'content_manager' });
    await addIdentity(user.id, 'oidc:corp');
    const json = await start('corp', 'purpose=sign-in&format=json');
    const body = await json.json();
    expect(typeof body.authorizationUrl).toBe('string');
    const nav = await start('corp', 'purpose=sign-in');
    const { code, state } = await providerRedirect(nav);
    const done = await callback('corp', { code, state }, [oauthCookie(nav)]);
    expect(signedIn(done)).toBe(true);
    const everything = JSON.stringify(body) + JSON.stringify([...done.headers.entries()]) + (await done.text());
    expect(everything).not.toContain(clientSecret);
    expect(everything).not.toContain('id_token');
    const list = await globalThis.fetch(`${origin}/api/v1/auth/providers`, { headers: { cookie: adminSession } });
    const providers = await list.json();
    expect(JSON.stringify(providers)).not.toContain(clientSecret);
    expect(providers[0].hasSecret).toBe(true);
  });

  // An admin's request with the admin session cookie.
  function adminPost(path: string): Promise<Response> {
    return globalThis.fetch(`${origin}${path}`, { method: 'POST', headers: { cookie: adminSession } });
  }
});

// The Users page's list (GET /users): admins only, with the session cookie alone, and only the sign-in
// methods each user holds (never a hash, a secret or a username).
describe('Management API v1: the users list for the Users page (admins only)', () => {
  let pool: Pool;
  let base = '';
  const servers: Server[] = [];
  let adminId = '';
  let adminCookie = '';
  let managerId = '';
  let managerCookie = '';
  let memberId = '';
  const MANAGER_LOGIN = 'casey-login-7731';

  async function useApp(): Promise<void> {
    const s = createApp(
      pool,
      loadFrameTypeRegistry(frameTypesDir),
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier, secretKey: randomBytes(32), passwordAddressLimit: null },
      { publicApiUrl },
      undefined,
      { rateLimit: null },
    ).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    servers.push(s);
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1`;
  }

  // A request. The admin's session unless `cookie` says otherwise ('' sends none).
  function send(opts: { cookie?: string; authorization?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    const cookie = opts.cookie ?? adminCookie;
    if (cookie) headers['Cookie'] = cookie;
    if (opts.authorization) headers['Authorization'] = opts.authorization;
    return globalThis.fetch(`${base}/users`, { method: 'GET', headers });
  }

  async function cookieFor(userId: string): Promise<string> {
    return `taleart_session=${(await createSession(pool, userId)).token}`;
  }

  async function setCreatedAt(userId: string, createdAt: string): Promise<void> {
    await pool.query('UPDATE users SET created_at = $2 WHERE id = $1', [userId, createdAt]);
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
  });

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await pool.query('TRUNCATE users, projects CASCADE');
    // The admin signs in with a passkey; the manager has a password only; the member holds both,
    // links two providers (one of them an OpenID Connect provider) and belongs to one project.
    const admin = await createUser(pool, { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' });
    adminId = admin.id;
    await pool.query(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports)
       VALUES ($1, $2, $3, 0, '{internal}')`,
      [adminId, `cred-${randomUUID()}`, Buffer.from([1, 2, 3])],
    );
    adminCookie = await cookieFor(adminId);
    const manager = await createUser(pool, { name: 'Casey Content', email: 'casey@example.com', role: 'content_manager' });
    managerId = manager.id;
    managerCookie = await cookieFor(managerId);
    await pool.query('INSERT INTO user_passwords (user_id, username, password_hash) VALUES ($1, $2, $3)', [
      managerId,
      MANAGER_LOGIN,
      await hashPassword('a-long-passphrase-2026'),
    ]);
    const member = await createUser(pool, { name: 'Morgan Member', email: 'morgan@example.com', role: 'content_manager' });
    memberId = member.id;
    await pool.query('INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports) VALUES ($1, $2, $3, 0, \'{internal}\')', [
      memberId,
      `cred-${randomUUID()}`,
      Buffer.from([4, 5, 6]),
    ]);
    await pool.query('INSERT INTO user_passwords (user_id, username, password_hash) VALUES ($1, $2, $3)', [
      memberId,
      'morgan-login',
      await hashPassword('another-long-passphrase-2026'),
    ]);
    await pool.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', 'g-1'), ($1, 'google', 'g-2'), ($1, 'oidc:acme', 'o-1')`,
      [memberId],
    );
    const projectA = await createProject(pool, { name: 'Acme' });
    await addProjectMember(pool, projectA.id, memberId);
    await useApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  afterAll(async () => {
    await pool.query('TRUNCATE users, projects CASCADE');
    await pool.end();
  });

  it('lists every user with the sign-in methods each holds, in creation order', async () => {
    await setCreatedAt(managerId, '2026-01-01T00:00:00Z');
    await setCreatedAt(adminId, '2026-01-02T00:00:00Z');
    await setCreatedAt(memberId, '2026-01-03T00:00:00Z');

    const res = await send();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      users: [
        {
          id: managerId,
          name: 'Casey Content',
          email: 'casey@example.com',
          role: 'content_manager',
          createdAt: '2026-01-01T00:00:00.000Z',
          methods: { passkey: false, password: true, identities: [] },
          projects: 0,
          projectRoles: [],
        },
        {
          id: adminId,
          name: 'Ada Admin',
          email: 'ada@example.com',
          role: 'admin',
          createdAt: '2026-01-02T00:00:00.000Z',
          methods: { passkey: true, password: false, identities: [] },
          projects: 0,
          projectRoles: [],
        },
        {
          id: memberId,
          name: 'Morgan Member',
          email: 'morgan@example.com',
          role: 'content_manager',
          createdAt: '2026-01-03T00:00:00.000Z',
          methods: { passkey: true, password: true, identities: ['google', 'oidc:acme'] },
          projects: 1,
          projectRoles: [
            { projectId: expect.any(String), projectName: 'Acme', role: 'publisher', expiresAt: null, expired: false },
          ],
        },
      ],
      truncated: false,
    });
  });

  it('never returns a password hash, a username or a secret', async () => {
    const text = await (await send()).text();
    expect(text).not.toContain('scrypt');
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain(MANAGER_LOGIN);
    expect(text).not.toContain('morgan-login');
    expect(text).not.toContain('username');
    expect(text).not.toContain('secret');
  });

  it('keeps one order when creation times tie: by id, the same on every call', async () => {
    await pool.query("UPDATE users SET created_at = '2026-02-01T00:00:00Z'");
    const first = (await (await send()).json()).users.map((u: { id: string }) => u.id);
    const second = (await (await send()).json()).users.map((u: { id: string }) => u.id);
    expect(second).toEqual(first);
    expect(first).toEqual([adminId, managerId, memberId].sort());
  });

  it('answers 403 to a content manager, 401 to a stranger, and refuses API tokens and any Authorization header', async () => {
    const manager = await send({ cookie: managerCookie });
    expect(manager.status).toBe(403);
    expect((await manager.json()).error.code).toBe('forbidden');

    const stranger = await send({ cookie: '' });
    expect(stranger.status).toBe(401);
    expect((await stranger.json()).error.code).toBe('unauthenticated');

    // A valid token of the admin, a bogus one, and a valid session with a header: all refused.
    const issued = await createApiToken(pool, { userId: adminId, name: 'laptop', projectIds: null, readOnly: false, expiresAt: null });
    for (const authorization of [`Bearer ${issued.token}`, 'Bearer tat_not-a-real-token', 'Basic abc']) {
      const refused = await send({ authorization });
      expect(refused.status, authorization.slice(0, 12)).toBe(403);
      expect((await refused.json()).error.code).toBe('forbidden');
    }
    const sessionWithHeader = await send({ authorization: `Bearer ${issued.token}` });
    expect(sessionWithHeader.status).toBe(403);
  });

  it('caps the list at 500 users and says when it was cut short', async () => {
    await pool.query(
      `INSERT INTO users (name, email, role, webauthn_user_id, created_at)
       SELECT 'Extra ' || n, 'extra' || n || '@example.com', 'content_manager', 'wa-extra-' || n, now() + (n || ' seconds')::interval
         FROM generate_series(1, 500) AS n`,
    );
    const body = await (await send()).json();
    expect(body.users).toHaveLength(500);
    expect(body.truncated).toBe(true);
  });
});

describe('Management API v1: project roles', () => {
  let pool: Pool;
  let base = '';
  const servers: Server[] = [];
  let adminId = '';
  let adminCookie = '';
  let projectId = '';
  let otherProjectId = '';
  let zoneId = '';
  let groupId = '';
  let taleId = '';
  const people: Record<'viewer' | 'editor' | 'publisher' | 'admin', { id: string; cookie: string; email: string }> =
    {} as never;

  async function cookieFor(userId: string): Promise<string> {
    return `taleart_session=${(await createSession(pool, userId)).token}`;
  }

  async function useApp(): Promise<void> {
    const s = createApp(
      pool,
      loadFrameTypeRegistry(frameTypesDir),
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier, secretKey: randomBytes(32), passwordAddressLimit: null },
      { publicApiUrl },
      undefined,
      { rateLimit: null },
    ).listen(0);
    await new Promise<void>((resolve) => s.once('listening', () => resolve()));
    servers.push(s);
    base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1`;
  }

  // A request as a session cookie ('' sends none) or an API token.
  function api(method: string, path: string, who: string | { token: string }, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (typeof who === 'string') {
      if (who) headers['Cookie'] = who;
    } else {
      headers['Authorization'] = `Bearer ${who.token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return globalThis.fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function status(method: string, path: string, who: string | { token: string }, body?: unknown): Promise<number> {
    return (await api(method, path, who, body)).status;
  }

  async function errorCode(res: Response): Promise<string> {
    return (await res.json()).error.code;
  }

  async function person(role: 'viewer' | 'editor' | 'publisher' | 'admin'): Promise<void> {
    const user = await createUser(pool, { name: `${role} person`, email: `${role}@example.com`, role: 'content_manager' });
    await addProjectMember(pool, projectId, user.id, { role });
    people[role] = { id: user.id, cookie: await cookieFor(user.id), email: user.email };
  }

  beforeAll(async () => {
    pool = createPool(testDatabaseUrl);
    await migrate(pool);
  });

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await pool.query('TRUNCATE users, projects CASCADE');
    adminId = (await createUser(pool, { name: 'Ada Admin', email: 'ada@example.com', role: 'admin' })).id;
    adminCookie = await cookieFor(adminId);
    projectId = (await createProject(pool, { name: 'Acme' })).id;
    otherProjectId = (await createProject(pool, { name: 'Other' })).id;
    for (const role of ['viewer', 'editor', 'publisher', 'admin'] as const) await person(role);
    await useApp();
    zoneId = (await (await api('POST', '/zones', adminCookie, { name: 'Bar', projectId })).json()).id;
    groupId = (await (await api('POST', `/zones/${zoneId}/tale-groups`, adminCookie, { name: 'Summer' })).json()).id;
    taleId = (await (await api('POST', `/tale-groups/${groupId}/tales`, adminCookie, { title: 'Beach' })).json()).id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  afterAll(async () => {
    await pool.query('TRUNCATE users, projects CASCADE');
    await pool.end();
  });

  it('serves the role matrix to any signed-in caller', async () => {
    const res = await api('GET', '/roles', people.viewer.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roles.map((r: { role: string }) => r.role)).toEqual(['viewer', 'editor', 'publisher', 'admin']);
    expect(body.roles[0].permissions).toEqual(['project.view', 'analytics.view']);
    expect(body.permissions).toContain('members.manage');
    expect(await status('GET', '/roles', '')).toBe(401);
  });

  it('shows each project with the caller\'s effective role; a global admin is admin everywhere', async () => {
    for (const role of ['viewer', 'editor', 'publisher', 'admin'] as const) {
      expect(await (await api('GET', '/projects', people[role].cookie)).json()).toEqual([
        { id: projectId, name: 'Acme', role },
      ]);
    }
    const all = await (await api('GET', '/projects', adminCookie)).json();
    expect(all).toHaveLength(2);
    expect(all.every((p: { role: string }) => p.role === 'admin')).toBe(true);
  });

  describe('viewer', () => {
    it('reads content, analytics and the member list, and changes nothing', async () => {
      const v = people.viewer.cookie;
      for (const path of [
        `/zones/${zoneId}/tale-groups`,
        `/tale-groups/${groupId}`,
        `/tales/${taleId}`,
        `/tales/${taleId}/document`,
        `/tales/${taleId}/responses`,
        `/zones/${zoneId}/analytics`,
        `/projects/${projectId}/tags`,
        `/projects/${projectId}/theme`,
        `/projects/${projectId}/members`,
        `/projects/${projectId}/site-key`,
        `/zones/${zoneId}/key`,
      ]) {
        expect(await status('GET', path, v), path).toBe(200);
      }
      const refused: [string, string, unknown?][] = [
        ['PUT', `/tales/${taleId}/document`, { revision: 1, document: {} }],
        ['DELETE', `/tales/${taleId}`],
        ['POST', `/tale-groups/${groupId}/tales`, { title: 'X' }],
        ['PUT', `/projects/${projectId}/theme`, { theme: {} }],
        ['POST', `/projects/${projectId}/tags`, { name: 'x' }],
        ['PUT', `/tales/${taleId}/status`, { status: 'live' }],
        ['PATCH', `/zones/${zoneId}`, { name: 'Z' }],
        ['POST', `/projects/${projectId}/site-key`],
        ['GET', `/projects/${projectId}/audit-log`],
        ['GET', `/projects/${projectId}/invitations`],
      ];
      for (const [method, path, body] of refused) {
        const res = await api(method, path, v, body);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(await res.json()).toEqual({
          error: { code: 'forbidden', message: 'Your role in this project does not allow this' },
        });
      }
    });

    it('is refused in a project it is not a member of, with the same body', async () => {
      const res = await api('GET', `/projects/${otherProjectId}/tags`, people.viewer.cookie);
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toBe('Your role in this project does not allow this');
    });
  });

  describe('editor', () => {
    it('edits content but cannot make it live, manage zones, keys or members', async () => {
      const e = people.editor.cookie;
      expect(await status('POST', `/tale-groups/${groupId}/tales`, e, { title: 'Second' })).toBe(201);
      expect(await status('POST', `/projects/${projectId}/tags`, e, { name: 'summer' })).toBe(201);
      expect(await status('POST', `/projects/${projectId}/tale-groups`, e, { name: 'Loose' })).toBe(201);
      expect(await status('GET', `/zones/${zoneId}/analytics`, e)).toBe(200);
      // A stale revision proves the draft save got past the permission check.
      expect(await status('PUT', `/tales/${taleId}/document`, e, { revision: 999, document: {} })).not.toBe(403);
      for (const [method, path, body] of [
        ['PUT', `/tales/${taleId}/status`, { status: 'live' }],
        ['PUT', `/tales/${taleId}/schedule`, { startsAt: null, endsAt: null }],
        ['POST', `/tales/${taleId}/document/publish`, { revision: 1, publishedRevision: 1 }],
        ['PUT', `/tale-groups/${groupId}/status`, { status: 'live' }],
        ['PUT', `/tale-groups/${groupId}/schedule`, { startsAt: null, endsAt: null }],
        ['POST', '/zones', { name: 'New', projectId }],
        ['POST', `/zones/${zoneId}/frame`, { type: 'bar' }],
        ['POST', `/zones/${zoneId}/key`, undefined],
        ['POST', `/projects/${projectId}/members`, { email: 'x@example.com', role: 'viewer' }],
      ] as [string, string, unknown][]) {
        expect(await status(method, path, e, body), `${method} ${path}`).toBe(403);
      }
      // Discarding a draft is the editor's own undo.
      expect(await status('POST', `/tales/${taleId}/document/discard`, e, { revision: 1, publishedRevision: 1 })).not.toBe(403);
    });
  });

  describe('publisher', () => {
    it('makes content live and manages zones, but not keys or members', async () => {
      const p = people.publisher.cookie;
      expect(await status('PUT', `/tales/${taleId}/schedule`, p, { startsAt: null, endsAt: null })).toBe(200);
      expect(await status('PUT', `/tale-groups/${groupId}/schedule`, p, { startsAt: null, endsAt: null })).toBe(200);
      expect(await status('PUT', `/tales/${taleId}/status`, p, { status: 'live' })).not.toBe(403);
      expect(await status('POST', `/tales/${taleId}/document/publish`, p, { revision: 1, publishedRevision: 1 })).not.toBe(403);
      const zone = await api('POST', '/zones', p, { name: 'Banner', projectId });
      expect(zone.status).toBe(201);
      expect(await status('PATCH', `/zones/${zoneId}`, p, { name: 'Renamed' })).toBe(200);
      // A zone cannot be created in a project the publisher is not a member of.
      expect(await status('POST', '/zones', p, { name: 'Nope', projectId: otherProjectId })).toBe(403);
      for (const [method, path, body] of [
        ['POST', `/zones/${zoneId}/key`, undefined],
        ['DELETE', `/zones/${zoneId}/key`, undefined],
        ['POST', `/projects/${projectId}/site-key`, undefined],
        ['DELETE', `/projects/${projectId}/site-key`, undefined],
        ['POST', `/projects/${projectId}/invitations`, undefined],
        ['POST', `/projects/${projectId}/members`, { email: 'x@example.com', role: 'viewer' }],
        ['GET', `/projects/${projectId}/audit-log`, undefined],
      ] as [string, string, unknown][]) {
        expect(await status(method, path, p, body), `${method} ${path}`).toBe(403);
      }
    });
  });

  describe('admin', () => {
    it('manages keys and members of its project only', async () => {
      const a = people.admin.cookie;
      expect(await status('POST', `/zones/${zoneId}/key`, a)).toBe(201);
      expect(await status('POST', `/projects/${projectId}/site-key`, a)).toBe(201);
      expect(await status('GET', `/projects/${projectId}/audit-log`, a)).toBe(200);
      expect(await status('GET', `/projects/${projectId}/invitations`, a)).toBe(200);
      expect(await status('POST', `/projects/${otherProjectId}/site-key`, a)).toBe(403);
      expect(await status('GET', `/projects/${otherProjectId}/members`, a)).toBe(403);
      // Still admin-only: project creation and the Users list.
      expect(await status('POST', '/projects', a, { name: 'Mine' })).toBe(403);
    });

    it('is implied for a global admin who is no member', async () => {
      expect(await status('POST', `/projects/${otherProjectId}/site-key`, adminCookie)).toBe(201);
      expect(await status('GET', `/projects/${otherProjectId}/members`, adminCookie)).toBe(200);
      expect(await status('GET', `/projects/${otherProjectId}/audit-log`, adminCookie)).toBe(200);
    });

    it('answers 404 project_not_found to a global admin and 403 to anyone else for an unknown project', async () => {
      const unknown = randomUUID();
      const res = await api('GET', `/projects/${unknown}/members`, adminCookie);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe('project_not_found');
      expect(await status('GET', `/projects/${unknown}/members`, people.admin.cookie)).toBe(403);
    });
  });

  describe('expiry', () => {
    it('counts an expired membership as no membership anywhere', async () => {
      await pool.query(`UPDATE project_members SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [
        people.publisher.id,
      ]);
      const p = people.publisher.cookie;
      expect(await (await api('GET', '/projects', p)).json()).toEqual([]);
      expect(await (await api('GET', '/zones', p)).json()).toEqual([]);
      expect(await status('GET', `/zones/${zoneId}/tale-groups`, p)).toBe(403);
      expect(await status('PUT', `/tales/${taleId}/schedule`, p, { startsAt: null, endsAt: null })).toBe(403);
      expect(await status('GET', `/zones/${zoneId}/analytics`, p)).toBe(404);
      // The managers still see the row, marked expired.
      const members = await (await api('GET', `/projects/${projectId}/members`, adminCookie)).json();
      const row = members.find((m: { userId: string }) => m.userId === people.publisher.id);
      expect(row).toMatchObject({ role: 'publisher', expired: true, you: false });
      // A membership that ends in the future still works.
      await pool.query(`UPDATE project_members SET expires_at = now() + interval '1 hour' WHERE user_id = $1`, [
        people.publisher.id,
      ]);
      expect(await status('GET', `/zones/${zoneId}/tale-groups`, p)).toBe(200);
    });

    it('does not let an expired admin manage members, nor count as the last admin', async () => {
      await pool.query(`UPDATE project_members SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [
        people.admin.id,
      ]);
      expect(await status('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).toBe(403);
    });
  });

  describe('API tokens', () => {
    async function tokenFor(userId: string, projectIds: string[] | null, readOnly = false) {
      return createApiToken(pool, { userId, name: 'script', projectIds, readOnly, expiresAt: null });
    }

    it('acts with its user\'s role, never more, and only in its projects', async () => {
      const viewerToken = await tokenFor(people.viewer.id, null);
      expect(await status('GET', `/tales/${taleId}`, viewerToken)).toBe(200);
      expect(await status('DELETE', `/tales/${taleId}`, viewerToken)).toBe(403);
      const editorToken = await tokenFor(people.editor.id, null);
      expect(await status('PUT', `/tales/${taleId}/status`, editorToken, { status: 'live' })).toBe(403);
      expect(await status('POST', `/tale-groups/${groupId}/tales`, editorToken, { title: 'T' })).toBe(201);
      const publisherToken = await tokenFor(people.publisher.id, null);
      expect(await status('PUT', `/tales/${taleId}/schedule`, publisherToken, { startsAt: null, endsAt: null })).toBe(200);
      expect(await status('POST', `/zones/${zoneId}/key`, publisherToken)).toBe(403);
      // A project the token does not list is out of reach even for its admin user.
      const narrow = await tokenFor(people.admin.id, [otherProjectId]);
      expect(await status('GET', `/projects/${projectId}/members`, narrow)).toBe(403);
    });

    it('never mints or elevates access, whatever its user\'s role', async () => {
      const adminToken = await tokenFor(people.admin.id, null);
      expect(await status('GET', `/projects/${projectId}/members`, adminToken)).toBe(200);
      expect(await status('GET', `/projects/${projectId}/audit-log`, adminToken)).toBe(200);
      expect(await status('POST', `/projects/${projectId}/members`, adminToken, { email: 'viewer@example.com', role: 'admin' })).toBe(403);
      expect(await status('POST', `/projects/${projectId}/invitations`, adminToken)).toBe(403);
      expect(await status('PATCH', `/projects/${projectId}/members/${people.viewer.id}`, adminToken, { role: 'admin' })).toBe(403);
      expect(await status('DELETE', `/projects/${projectId}/members/${people.viewer.id}`, adminToken)).toBe(403);
    });
  });

  describe('invitations with a role', () => {
    // Runs the invitee's side in a fresh browser: options, then verify with the challenge cookie.
    async function redeem(token: string, email: string): Promise<Response> {
      const options = await api('POST', `/auth/invitations/${token}/options`, '', { name: 'Newcomer', email });
      const { challenge } = await options.json();
      const line = options.headers.getSetCookie().find((l) => l.startsWith('taleart_challenge=')) ?? '';
      return api('POST', `/auth/invitations/${token}/verify`, line.split(';')[0], { id: `cred-${email}`, challenge });
    }

    it('creates, lists and previews an invitation with its role, and applies it when the invitee joins', async () => {
      const until = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const created = await api('POST', `/projects/${projectId}/invitations`, people.admin.cookie, {
        role: 'viewer',
        accessExpiresAt: until,
      });
      expect(created.status).toBe(201);
      const invitation = await created.json();
      expect(invitation).toMatchObject({ projectId, role: 'viewer', accessExpiresAt: until });
      const token = decodeURIComponent(invitation.url.split('/').pop());

      const pending = await (await api('GET', `/projects/${projectId}/invitations`, people.admin.cookie)).json();
      expect(pending).toEqual([
        {
          id: invitation.id,
          projectId,
          role: 'viewer',
          accessExpiresAt: until,
          createdBy: { id: people.admin.id, name: 'admin person' },
          createdAt: expect.any(String),
          expiresAt: invitation.expiresAt,
        },
      ]);
      expect(JSON.stringify(pending)).not.toContain(token);

      const preview = await (await api('GET', `/auth/invitations/${token}`, '')).json();
      expect(preview).toEqual({ projectName: 'Acme', expiresAt: invitation.expiresAt, role: 'viewer', accessExpiresAt: until });

      const joined = await redeem(token, 'newcomer@example.com');
      expect(joined.status).toBe(201);
      const session = `taleart_session=${decodeURIComponent((joined.headers.getSetCookie().find((l) => l.startsWith('taleart_session=')) ?? '').split(';')[0].slice(16))}`;
      expect(await (await api('GET', '/projects', session)).json()).toEqual([{ id: projectId, name: 'Acme', role: 'viewer' }]);
      expect(await status('DELETE', `/tales/${taleId}`, session)).toBe(403);
      const { rows } = await pool.query('SELECT role, expires_at FROM project_members WHERE user_id <> ALL($1::uuid[])', [
        [adminId, ...Object.values(people).map((x) => x.id)],
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('viewer');
      expect(rows[0].expires_at.toISOString()).toBe(until);

      // A used invitation is no longer pending.
      expect(await (await api('GET', `/projects/${projectId}/invitations`, people.admin.cookie)).json()).toEqual([]);
      const log = await (await api('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).json();
      expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['joined', 'invited']);
      expect(log.entries[0]).toMatchObject({ actorName: 'Newcomer', targetEmail: 'newcomer@example.com', detail: { role: 'viewer' } });
    });

    it('defaults to editor, and refuses an unknown role or an expiry in the past', async () => {
      const res = await api('POST', `/projects/${projectId}/invitations`, people.admin.cookie);
      expect((await res.json()).role).toBe('editor');
      for (const body of [
        { role: 'owner' },
        { accessExpiresAt: new Date(Date.now() - 1000).toISOString() },
        { accessExpiresAt: 'tomorrow' },
        { extra: 1 },
      ]) {
        const bad = await api('POST', `/projects/${projectId}/invitations`, people.admin.cookie, body);
        expect(bad.status, JSON.stringify(body)).toBe(400);
        expect(await errorCode(bad)).toBe('validation_failed');
      }
    });

    it('revokes a pending invitation: the link dies, the log remembers, a repeat is 404', async () => {
      const invitation = await (await api('POST', `/projects/${projectId}/invitations`, people.admin.cookie)).json();
      const token = decodeURIComponent(invitation.url.split('/').pop());
      const url = `/projects/${projectId}/invitations/${invitation.id}`;
      expect(await status('DELETE', url, people.publisher.cookie)).toBe(403);
      expect(await status('DELETE', url, people.admin.cookie)).toBe(204);
      expect(await status('GET', `/auth/invitations/${token}`, '')).toBe(410);
      expect(await (await api('GET', `/projects/${projectId}/invitations`, people.admin.cookie)).json()).toEqual([]);
      const again = await api('DELETE', url, people.admin.cookie);
      expect(again.status).toBe(404);
      expect(await errorCode(again)).toBe('invitation_not_found');
      // Another project's admin cannot revoke it either.
      const other = await api('DELETE', `/projects/${otherProjectId}/invitations/${invitation.id}`, adminCookie);
      expect(other.status).toBe(404);
      const log = await (await api('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).json();
      expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['invitation_revoked', 'invited']);
    });
  });

  describe('members', () => {
    let guestId = '';
    beforeEach(async () => {
      guestId = (await createUser(pool, { name: 'Guest', email: 'guest@example.com', role: 'content_manager' })).id;
    });

    it('lists the explicit members with their roles, marking the caller', async () => {
      const members = await (await api('GET', `/projects/${projectId}/members`, people.editor.cookie)).json();
      expect(members.map((m: { role: string }) => m.role).sort()).toEqual(['admin', 'editor', 'publisher', 'viewer']);
      expect(members.find((m: { you: boolean }) => m.you)).toMatchObject({
        userId: people.editor.id,
        name: 'editor person',
        email: 'editor@example.com',
        role: 'editor',
        globalRole: 'content_manager',
        expiresAt: null,
        expired: false,
        joinedAt: expect.any(String),
      });
      expect(members.filter((m: { you: boolean }) => m.you)).toHaveLength(1);
    });

    it('adds an existing user by email with a role, one role per project', async () => {
      const until = new Date(Date.now() + 3600_000).toISOString();
      const res = await api('POST', `/projects/${projectId}/members`, people.admin.cookie, {
        email: 'GUEST@example.com',
        role: 'viewer',
        expiresAt: until,
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ userId: guestId, role: 'viewer', expiresAt: until, expired: false, you: false });
      // A different role in another project.
      expect(
        await status('POST', `/projects/${otherProjectId}/members`, adminCookie, { email: 'guest@example.com', role: 'publisher' }),
      ).toBe(201);
      const guest = await cookieFor(guestId);
      const projects = await (await api('GET', '/projects', guest)).json();
      expect(projects.map((p: { name: string; role: string }) => [p.name, p.role]).sort()).toEqual([
        ['Acme', 'viewer'],
        ['Other', 'publisher'],
      ]);
      const log = await (await api('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).json();
      expect(log.entries[0]).toMatchObject({
        action: 'member_added',
        actorId: people.admin.id,
        actorName: 'admin person',
        targetUserId: guestId,
        targetEmail: 'guest@example.com',
        detail: { role: 'viewer', expiresAt: until },
      });
    });

    it('refuses an unknown email, a member already there, a bad role and a past expiry', async () => {
      const add = (body: unknown) => api('POST', `/projects/${projectId}/members`, people.admin.cookie, body);
      const unknown = await add({ email: 'nobody@example.com', role: 'viewer' });
      expect(unknown.status).toBe(404);
      expect(await errorCode(unknown)).toBe('user_not_found');
      const twice = await add({ email: 'viewer@example.com', role: 'admin' });
      expect(twice.status).toBe(409);
      expect(await errorCode(twice)).toBe('member_exists');
      for (const body of [
        { email: 'guest@example.com' },
        { email: 'guest@example.com', role: 'god' },
        { role: 'viewer' },
        { email: 'guest@example.com', role: 'viewer', expiresAt: new Date(Date.now() - 1000).toISOString() },
      ]) {
        const bad = await add(body);
        expect(bad.status, JSON.stringify(body)).toBe(400);
        expect(await errorCode(bad)).toBe('validation_failed');
      }
    });

    it('changes a role and an expiry, and writes each change to the audit log', async () => {
      const url = `/projects/${projectId}/members/${people.viewer.id}`;
      const until = new Date(Date.now() + 3600_000).toISOString();
      const changed = await api('PATCH', url, people.admin.cookie, { role: 'editor', expiresAt: until });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({ role: 'editor', expiresAt: until });
      // The new power applies at once.
      expect(await status('POST', `/tale-groups/${groupId}/tales`, people.viewer.cookie, { title: 'Now' })).toBe(201);
      expect(await (await api('PATCH', url, people.admin.cookie, { expiresAt: null })).json()).toMatchObject({ expiresAt: null });
      // Nothing changed: no entry.
      await api('PATCH', url, people.admin.cookie, { role: 'editor' });
      const log = await (await api('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).json();
      expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['expiry_changed', 'expiry_changed', 'role_changed']);
      expect(log.entries[2].detail).toEqual({ from: 'viewer', to: 'editor' });
      expect(log.entries[1].detail).toEqual({ from: null, to: until });
      for (const body of [{}, { role: 'x' }, { expiresAt: new Date(Date.now() - 5).toISOString() }, { name: 'x' }]) {
        expect((await api('PATCH', url, people.admin.cookie, body)).status, JSON.stringify(body)).toBe(400);
      }
      const missing = await api('PATCH', `/projects/${projectId}/members/${guestId}`, people.admin.cookie, { role: 'viewer' });
      expect(missing.status).toBe(404);
      expect(await errorCode(missing)).toBe('member_not_found');
      expect(await status('PATCH', url, people.publisher.cookie, { role: 'admin' })).toBe(403);
    });

    it('removes a member, who then has no access, and logs it', async () => {
      const url = `/projects/${projectId}/members/${people.editor.id}`;
      expect(await status('DELETE', url, people.publisher.cookie)).toBe(403);
      expect(await status('DELETE', url, people.admin.cookie)).toBe(204);
      expect(await status('GET', `/tales/${taleId}`, people.editor.cookie)).toBe(403);
      const again = await api('DELETE', url, people.admin.cookie);
      expect(again.status).toBe(404);
      expect(await errorCode(again)).toBe('member_not_found');
      const log = await (await api('GET', `/projects/${projectId}/audit-log`, people.admin.cookie)).json();
      expect(log.entries[0]).toMatchObject({ action: 'removed', targetEmail: 'editor@example.com', detail: { role: 'editor' } });
    });

    it('keeps the last active admin: a project admin cannot demote or remove it, a global admin can', async () => {
      const self = `/projects/${projectId}/members/${people.admin.id}`;
      const demote = await api('PATCH', self, people.admin.cookie, { role: 'editor' });
      expect(demote.status).toBe(409);
      expect(await errorCode(demote)).toBe('last_project_admin');
      expect((await api('PATCH', self, people.admin.cookie, { expiresAt: new Date(Date.now() + 1000).toISOString() })).status).toBe(200);
      await api('PATCH', self, people.admin.cookie, { expiresAt: null });
      expect(await errorCode(await api('DELETE', self, people.admin.cookie))).toBe('last_project_admin');
      // Another active admin lifts the guard.
      expect(await status('PATCH', `/projects/${projectId}/members/${people.publisher.id}`, people.admin.cookie, { role: 'admin' })).toBe(200);
      expect(await status('PATCH', self, people.admin.cookie, { role: 'editor' })).toBe(200);
      // The new admin is now the last one.
      const last = `/projects/${projectId}/members/${people.publisher.id}`;
      expect(await status('DELETE', last, people.publisher.cookie)).toBe(409);
      // A global admin may always.
      expect(await status('DELETE', last, adminCookie)).toBe(204);
    });

    it('does not count an expired admin as another admin', async () => {
      await pool.query(`UPDATE project_members SET role = 'admin', expires_at = now() - interval '1 minute' WHERE user_id = $1`, [
        people.publisher.id,
      ]);
      const res = await api('DELETE', `/projects/${projectId}/members/${people.admin.id}`, people.admin.cookie);
      expect(res.status).toBe(409);
    });
  });

  describe('audit log', () => {
    it('pages newest first with limit and before, for members.manage only', async () => {
      for (let i = 0; i < 5; i++) {
        await api('POST', `/projects/${projectId}/invitations`, people.admin.cookie, { role: 'viewer' });
      }
      const url = `/projects/${projectId}/audit-log`;
      const first = await (await api('GET', `${url}?limit=2`, people.admin.cookie)).json();
      expect(first.entries).toHaveLength(2);
      expect(first.nextBefore).toBe(first.entries[1].id);
      const second = await (await api('GET', `${url}?limit=2&before=${first.nextBefore}`, people.admin.cookie)).json();
      const third = await (await api('GET', `${url}?limit=2&before=${second.nextBefore}`, people.admin.cookie)).json();
      expect(third.entries).toHaveLength(1);
      expect(third.nextBefore).toBeNull();
      const ids = [...first.entries, ...second.entries, ...third.entries].map((e: { id: string }) => e.id);
      expect(new Set(ids).size).toBe(5);
      const all = await (await api('GET', url, people.admin.cookie)).json();
      expect(all.entries.map((e: { id: string }) => e.id)).toEqual(ids);
      expect(all.entries[0]).toMatchObject({ action: 'invited', actorId: people.admin.id, targetUserId: null, targetEmail: null });
      expect((await api('GET', `${url}?limit=0`, people.admin.cookie)).status).toBe(400);
      expect((await api('GET', `${url}?limit=201`, people.admin.cookie)).status).toBe(400);
      expect((await (await api('GET', `${url}?before=${randomUUID()}`, people.admin.cookie)).json()).entries).toEqual([]);
      expect(await status('GET', url, people.publisher.cookie)).toBe(403);
      // Kept when the actor's account goes, with the name.
      await pool.query('DELETE FROM users WHERE id = $1', [people.admin.id]);
      const kept = await (await api('GET', url, adminCookie)).json();
      expect(kept.entries[0]).toMatchObject({ actorId: null, actorName: 'admin person' });
    });
  });

  describe('migration of memberships made before roles', () => {
    it('turns them into publishers and keeps old pending invitations as powerful as they were', async () => {
      // The schema as it was: no role, no expiry, no audit log.
      await pool.query('ALTER TABLE project_members DROP COLUMN role, DROP COLUMN expires_at');
      await pool.query('ALTER TABLE invitations DROP COLUMN role, DROP COLUMN access_expires_at');
      await pool.query('DROP TABLE project_audit_log');
      const old = await createUser(pool, { name: 'Old', email: 'old@example.com', role: 'content_manager' });
      await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)', [otherProjectId, old.id]);
      await pool.query(
        `INSERT INTO invitations (project_id, token_hash, created_by, expires_at) VALUES ($1, 'oldhash', $2, now() + interval '1 day')`,
        [otherProjectId, adminId],
      );
      await migrate(pool);
      await migrate(pool);
      const member = await pool.query('SELECT role, expires_at FROM project_members WHERE user_id = $1', [old.id]);
      expect(member.rows).toEqual([{ role: 'publisher', expires_at: null }]);
      const invitation = await pool.query(`SELECT role, access_expires_at FROM invitations WHERE token_hash = 'oldhash'`);
      expect(invitation.rows).toEqual([{ role: 'publisher', access_expires_at: null }]);
      // New invitations default to editor and the role column rejects nonsense.
      const fresh = await pool.query(
        `INSERT INTO invitations (project_id, token_hash, expires_at) VALUES ($1, 'newhash', now() + interval '1 day') RETURNING role`,
        [otherProjectId],
      );
      expect(fresh.rows[0].role).toBe('editor');
      await expect(pool.query(`UPDATE project_members SET role = 'owner'`)).rejects.toThrow();
      const cookie = await cookieFor(old.id);
      expect(await (await api('GET', '/projects', cookie)).json()).toEqual([{ id: otherProjectId, name: 'Other', role: 'publisher' }]);
      expect(await status('GET', `/projects/${otherProjectId}/audit-log`, adminCookie)).toBe(200);
    });
  });
});
