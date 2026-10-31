import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHALLENGE_COOKIE, SESSION_COOKIE } from '@taleart/contract';
import { createApiToken, createUser, PasskeyFailedError, type PasskeyVerifier } from '@taleart/server-access';
import { DEMO_GROUPS, DEMO_PROJECT_NAME, DEMO_TEAM, seedDemo, SeedRefusedError } from '@taleart/seed-demo';
import { LocalDiskStorage } from '@taleart/server-storage';
import { loadFrameTypeRegistry } from '@taleart/server-zones';
import { Client, type Pool } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { loopbackClient, seedDemoOnSetup } from './demo-seed';

// The other API tests empty TEST_DATABASE_URL's tables, and may run at the same time: this one uses its own
// database next to it, `<name>_demo_seed_test`, dropped and created again on each run. Never the development database.
const baseDatabaseUrl = process.env['TEST_DATABASE_URL'] ?? 'postgres://taleart:taleart@localhost:5432/taleart_test';
const baseDatabase = parseConnectionString(baseDatabaseUrl).database;
if (!baseDatabase?.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test');
const databaseName = baseDatabase.replace(/_test$/, '_demo_seed_test');
const testDatabaseUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();
const maintenanceUrl = baseDatabaseUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1');

async function withMaintenance(sql: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

// A passkey the fake authenticator makes always passes when it names the challenge.
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
    const r = response as { id: string; challenge: string };
    if (r.challenge !== expectedChallenge) throw new PasskeyFailedError();
    return { credentialId: r.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] };
  },
  async requestOptions() {
    return { challenge: randomUUID(), rpId: 'localhost', userVerification: 'required' };
  },
  async verifyAuthentication() {
    return 0;
  },
};

describe('the demo seed (TALEART_SEED_DEMO=true)', () => {
  let pool: Pool;
  let server: Server;
  let base = '';
  let mediaDir = '';
  let session = '';
  const logs: string[] = [];

  async function freePort(): Promise<number> {
    const probe = createServer().listen(0);
    await new Promise((resolve) => probe.once('listening', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  }

  async function api<T>(path: string): Promise<T> {
    const res = await fetch(`${base}/api/v1${path}`, { headers: { Cookie: session } });
    expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
    return (await res.json()) as T;
  }

  beforeAll(async () => {
    await withMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await withMaintenance(`CREATE DATABASE "${databaseName}"`);
    pool = createPool(testDatabaseUrl, 5);
    await migrate(pool);
    mediaDir = mkdtempSync(join(tmpdir(), 'taleart-seed-media-'));
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const frameTypes = loadFrameTypeRegistry(join(__dirname, '../../../libs/contract/frame-types'));
    const log = (level: string, msg: string, err?: unknown) => logs.push(`${level}: ${msg}${err ? ` ${String(err)}` : ''}`);
    const app = createApp(
      pool,
      frameTypes,
      new LocalDiskStorage(mediaDir),
      { verifier: fakeVerifier, onSetup: seedDemoOnSetup(pool, base, log as Parameters<typeof seedDemoOnSetup>[2]) },
      { publicApiUrl: base },
    );
    server = app.listen(port);
    await new Promise((resolve) => server.once('listening', resolve));

    // Setup of the first admin, as the dashboard does it; the seed starts when it answers.
    const options = await fetch(`${base}/api/v1/auth/setup/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Admin', email: 'ada@example.com' }),
    });
    const { challenge } = (await options.json()) as { challenge: string };
    const challengeCookie = options.headers.getSetCookie().find((c) => c.startsWith(`${CHALLENGE_COOKIE}=`))?.split(';')[0] ?? '';
    const verify = await fetch(`${base}/api/v1/auth/setup/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: challengeCookie },
      body: JSON.stringify({ id: 'cred-1', challenge }),
    });
    expect(verify.status).toBe(201);
    session = verify.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? '';

    // The seed ends by revoking its token; wait for that (or for a logged failure).
    const deadline = Date.now() + 90_000;
    for (;;) {
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM api_tokens WHERE revoked_at IS NOT NULL AND name LIKE 'Demo seed%'");
      if (rows[0].n === 1 || logs.some((l) => l.startsWith('error:')) || Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 120_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await pool?.end();
    await withMaintenance(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
  });

  it('makes the demo project for the first admin, with no error, and leaves no token behind', async () => {
    expect(logs.filter((l) => l.startsWith('error:'))).toEqual([]);
    expect(logs).toContain('info: Demo seed: created');
    const projects = await api<{ id: string; name: string }[]>('/projects');
    expect(projects.map((p) => p.name)).toEqual([DEMO_PROJECT_NAME]);
    const { rows } = await pool.query("SELECT revoked_at IS NOT NULL AS revoked FROM api_tokens WHERE name LIKE 'Demo seed%'");
    expect(rows).toEqual([{ revoked: true }]);
  });

  it('has three zones with different displays and five tale groups with covers and thirteen tales', async () => {
    const [project] = await api<{ id: string }[]>('/projects');
    const zones = await api<{ name: string; frame: { type: string; settings: Record<string, unknown> } | null; visibility: { visible: boolean } }[]>(
      `/zones?projectId=${project.id}`,
    );
    expect(zones.map((z) => z.name).sort()).toEqual(['Collection posters', 'Home stories', 'Sale banner']);
    // A key each, so the zones are installed and their live groups visible.
    expect(zones.every((z) => z.visibility.visible)).toBe(true);
    expect(new Set(zones.map((z) => `${z.frame?.type}:${z.frame?.settings['layout'] ?? z.frame?.settings['variant']}`)).size).toBe(3);
    const groups = await api<{ id: string; name: string; cover: object | null; storedStatus: string; status: string; tags: object[] }[]>(
      `/projects/${project.id}/tale-groups`,
    );
    expect(groups.map((g) => g.name).sort()).toEqual(DEMO_GROUPS.map((g) => g.name).sort());
    expect(groups.every((g) => g.cover !== null && g.storedStatus === 'live' && g.tags.length > 0)).toBe(true);
    expect(groups.find((g) => g.name === 'Meet the makers')?.status).toBe('scheduled');
    const full = await Promise.all(
      groups.map((g) => api<{ tales: { title: string; status: string; storedStatus: string; media: object | null }[] }>(`/tale-groups/${g.id}`)),
    );
    const tales = full.flatMap((g) => g.tales);
    expect(tales).toHaveLength(13);
    expect(tales.every((t) => t.media !== null)).toBe(true);
    expect(tales.filter((t) => t.storedStatus === 'paused').map((t) => t.title)).toEqual(['Keep linen fresh']);
    expect(tales.filter((t) => t.status === 'scheduled').map((t) => t.title)).toEqual(['Your spring code']);
  });

  it('puts the elements on the published documents: a poll, a quiz, a rating, a reaction, a countdown', async () => {
    const [project] = await api<{ id: string }[]>('/projects');
    const groups = await api<{ id: string }[]>(`/projects/${project.id}/tale-groups`);
    const types = new Set<string>();
    for (const g of groups) {
      const full = await api<{ tales: { id: string; storedStatus: string }[] }>(`/tale-groups/${g.id}`);
      for (const t of full.tales) {
        const state = await api<{ document: { elements: { type: string }[] }; published: { document: { elements: unknown[] } | null } }>(
          `/tales/${t.id}/document`,
        );
        expect(state.document.elements[0]).toMatchObject({ type: 'image', props: { taleMedia: true } });
        // The hidden tale's text and buttons are a draft nobody has published: its published document is the picture alone.
        const published = state.published.document?.elements.length ?? 0;
        expect(published <= 1).toBe(t.storedStatus === 'paused');
        for (const e of state.document.elements) types.add(e.type);
      }
    }
    for (const type of ['image', 'text', 'button', 'swipe-up', 'countdown', 'promo-code', 'poll', 'quiz', 'rating', 'reaction']) {
      expect(types, type).toContain(type);
    }
  });

  it('adds the team: a member per role who cannot sign in, one expiring, one expired, and two pending invitations', async () => {
    const [project] = await api<{ id: string }[]>('/projects');
    const members = await api<{ email: string; role: string; expired: boolean; expiresAt: string | null }[]>(`/projects/${project.id}/members`);
    const demo = members.filter((m) => m.email.endsWith('@example.com') && m.email !== 'ada@example.com');
    expect(demo.map((m) => m.role).sort()).toEqual(DEMO_TEAM.members.map((m) => m.role).sort());
    expect(demo.filter((m) => m.expired)).toHaveLength(1);
    expect(demo.filter((m) => m.expiresAt !== null && !m.expired)).toHaveLength(1);
    const invitations = await api<{ role: string; accessExpiresAt: string | null }[]>(`/projects/${project.id}/invitations`);
    expect(invitations.map((i) => i.role).sort()).toEqual(['publisher', 'viewer']);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM users u WHERE u.email LIKE '%@example.com' AND u.email <> 'ada@example.com'
         AND NOT EXISTS (SELECT 1 FROM passkeys p WHERE p.user_id = u.id) AND NOT EXISTS (SELECT 1 FROM user_passwords w WHERE w.user_id = u.id)`,
    );
    expect(rows[0].n).toBe(DEMO_TEAM.members.length);
  });

  it('is a no-op the second time, through a token of the admin', async () => {
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'ada@example.com'");
    const issued = await createApiToken(pool, { userId: rows[0].id, name: 'second run', projectIds: null, readOnly: false, expiresAt: null });
    const result = await seedDemo(loopbackClient(base, issued.token));
    expect(result.status).toBe('exists');
    expect((await api<unknown[]>('/projects')).length).toBe(1);
  });

  it('refuses an install that has other projects, and does not run in the hook when other users exist', async () => {
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'ada@example.com'");
    const issued = await createApiToken(pool, { userId: rows[0].id, name: 'third run', projectIds: null, readOnly: false, expiresAt: null });
    const client = loopbackClient(base, issued.token);
    await client.request('POST', '/projects', { json: { name: 'Our real site' } });
    // The demo project is what a second run looks for: renamed, it is no longer there, and the install is populated.
    await pool.query('UPDATE projects SET name = $2 WHERE name = $1', [DEMO_PROJECT_NAME, 'Renamed']);
    await expect(seedDemo(client)).rejects.toBeInstanceOf(SeedRefusedError);
    expect((await api<{ name: string }[]>('/projects')).map((p) => p.name).sort()).toEqual(['Our real site', 'Renamed']);

    await createUser(pool, { name: 'Other', email: 'other@example.net', role: 'content_manager' });
    const before = logs.length;
    seedDemoOnSetup(pool, base, ((level: string, msg: string) => logs.push(`${level}: ${msg}`)) as Parameters<typeof seedDemoOnSetup>[2])({
      id: rows[0].id,
      name: 'Ada Admin',
      email: 'ada@example.com',
      role: 'admin',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(logs.slice(before)).toEqual(['info: Demo seed skipped: the install has other users']);
  });
});
