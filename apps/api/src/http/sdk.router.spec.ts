import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PasskeyVerifier } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  gzipCache,
  installInfo,
  sdkBuilds,
  sdkBuildsFromEnv,
  servedFile,
  testPageCsp,
  toServedFile,
  webSdkFileFromEnv,
} from './sdk.router';

// These routes touch neither the database nor storage: the app gets stand-ins that fail if used.
const unused = new Proxy({}, { get: () => () => Promise.reject(new Error('not used')) });

describe('/sdk/v1: the Web SDK bundle and the test page (epic UX rework R13)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taleart-sdk-'));
  const bundleFile = join(dir, 'index.js');
  const pagesDir = join(import.meta.dirname, '..', 'sdk-pages');
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    writeFileSync(bundleFile, 'export const sdk = "bundle";\n');
    server = createApp(
      unused as Pool,
      unused as FrameTypeRegistry,
      unused as MediaStorage,
      { verifier: unused as PasskeyVerifier },
      { publicApiUrl: 'https://media.example.com/' },
      undefined,
      undefined,
      { rateLimit: null },
      { bundleFile },
    ).listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the bundle as a module script any origin can load, with an ETag', async () => {
    const res = await fetch(`${origin}/sdk/v1/taleart.js`, { headers: { Origin: 'https://shop.example' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.text()).toBe('export const sdk = "bundle";\n');
    const etag = res.headers.get('etag') ?? '';
    expect(etag).toMatch(/^"[\w-]+"$/);
    // node:http, since fetch adds Cache-Control: no-cache to a conditional request.
    const status = await new Promise<number | undefined>((resolve, reject) =>
      get(`${origin}/sdk/v1/taleart.js`, { headers: { 'If-None-Match': etag, 'Accept-Encoding': 'gzip' } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on('error', reject),
    );
    expect(status).toBe(304);
  });

  describe('gzip (epic Tale Studio R15)', () => {
    const BODY = 'export const sdk = "bundle";\n';
    // node:http, since fetch always asks for gzip and decodes it.
    const raw = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
      new Promise<{ status: number | undefined; headers: Record<string, string | string[] | undefined>; body: Buffer }>(
        (resolve, reject) =>
          request(`${origin}/sdk/v1/${path}`, { method, headers }, (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c: Buffer) => chunks.push(c));
            r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
          })
            .on('error', reject)
            .end(),
      );

    it('sends the bundle gzipped to a client that accepts gzip, and as is otherwise, with an ETag per encoding', async () => {
      const zipped = await raw('taleart.js', { 'Accept-Encoding': 'gzip, deflate, br' });
      expect(zipped.headers['content-encoding']).toBe('gzip');
      expect(zipped.headers['vary']).toMatch(/Accept-Encoding/);
      expect(gunzipSync(zipped.body).toString()).toBe(BODY);
      const plain = await raw('taleart.js');
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.headers['vary']).toMatch(/Accept-Encoding/);
      expect(plain.body.toString()).toBe(BODY);
      expect(zipped.headers['etag']).not.toBe(plain.headers['etag']);
      expect((await raw('taleart.js', { 'Accept-Encoding': 'identity' })).headers['content-encoding']).toBeUndefined();
    });

    it('honours gzip;q=0 and *', async () => {
      const refused = await raw('taleart.js', { 'Accept-Encoding': 'gzip;q=0, identity' });
      expect(refused.headers['content-encoding']).toBeUndefined();
      expect(refused.body.toString()).toBe(BODY);
      const any = await raw('taleart.js', { 'Accept-Encoding': '*' });
      expect(any.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(any.body).toString()).toBe(BODY);
    });

    it('answers HEAD with the gzipped length and no body', async () => {
      const get = await raw('taleart.js', { 'Accept-Encoding': 'gzip' });
      const head = await raw('taleart.js', { 'Accept-Encoding': 'gzip' }, 'HEAD');
      expect(head.status).toBe(200);
      expect(head.headers['content-encoding']).toBe('gzip');
      expect(head.headers['content-length']).toBe(String(get.body.length));
      expect(head.body.length).toBe(0);
    });

    it('sends the pinned bundle gzipped too, immutable', async () => {
      const pinned = new URL(installInfo('http://x', await servedFile(bundleFile)()).sdkPinnedUrl ?? '').pathname;
      const res = await raw(pinned.slice('/sdk/v1/'.length), { 'Accept-Encoding': 'gzip' });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(gunzipSync(res.body).toString()).toBe(BODY);
    });

    it('answers 304 without Content-Encoding to its own encoding validator, and 200 to the other one', async () => {
      const zipped = await raw('taleart.js', { 'Accept-Encoding': 'gzip' });
      const plain = await raw('taleart.js');
      const zipEtag = String(zipped.headers['etag']);
      const plainEtag = String(plain.headers['etag']);
      const fresh = await raw('taleart.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': zipEtag });
      expect(fresh.status).toBe(304);
      expect(fresh.headers['content-encoding']).toBeUndefined();
      expect(fresh.body.length).toBe(0);
      expect((await raw('taleart.js', { 'If-None-Match': plainEtag })).status).toBe(304);
      // The other encoding's validator does not match: the full body.
      const crossed = await raw('taleart.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': plainEtag });
      expect(crossed.status).toBe(200);
      expect(gunzipSync(crossed.body).toString()).toBe(BODY);
      const back = await raw('taleart.js', { 'If-None-Match': zipEtag });
      expect(back.status).toBe(200);
      expect(back.body.toString()).toBe(BODY);
    });

    it('leaves the test page and its files uncompressed, with their CSP', async () => {
      for (const path of ['test-page', 'test-page.js', 'test-page.css']) {
        const res = await raw(path, { 'Accept-Encoding': 'gzip' });
        expect(res.status, path).toBe(200);
        expect(res.headers['content-encoding'], path).toBeUndefined();
        expect(res.headers['content-security-policy'], path).toContain("default-src 'none'");
      }
    });

    it('gzips a rebuilt bundle again (size or modification time changed)', async () => {
      const before = await raw('taleart.js', { 'Accept-Encoding': 'gzip' });
      writeFileSync(bundleFile, 'export const sdk = "rebuilt for gzip";\n');
      try {
        const after = await raw('taleart.js', { 'Accept-Encoding': 'gzip' });
        expect(gunzipSync(after.body).toString()).toBe('export const sdk = "rebuilt for gzip";\n');
        expect(after.headers['etag']).not.toBe(before.headers['etag']);
      } finally {
        writeFileSync(bundleFile, BODY);
      }
    });
  });

  it('answers 404 when the bundle was not built', async () => {
    const app = createApp(
      unused as Pool,
      unused as FrameTypeRegistry,
      unused as MediaStorage,
      { verifier: unused as PasskeyVerifier },
      {},
      undefined,
      undefined,
      { rateLimit: null },
      { bundleFile: join(dir, 'missing.js') },
    ).listen(0);
    await new Promise<void>((resolve) => app.once('listening', () => resolve()));
    try {
      const res = await fetch(`http://127.0.0.1:${(app.address() as AddressInfo).port}/sdk/v1/taleart.js`);
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => app.close(() => resolve()));
    }
  });

  it('serves the test page with a strict CSP, noindex and no referrer', async () => {
    const res = await fetch(`${origin}/sdk/v1/test-page?zone=home-top`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self' https://media.example.com; img-src 'self' https://media.example.com data: blob:; " +
        "media-src 'self' https://media.example.com blob:; font-src 'self' https://media.example.com data:; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('<script type="module" src="taleart.js"></script>');
    // No inline script: the CSP allows scripts from this origin only.
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('reflects nothing of the request into the page', async () => {
    const plain = await (await fetch(`${origin}/sdk/v1/test-page`)).text();
    const probe = '"><script>alert(1)</script>';
    const res = await fetch(`${origin}/sdk/v1/test-page?zone=${encodeURIComponent(probe)}&siteKey=${encodeURIComponent(probe)}`);
    expect(await res.text()).toBe(plain);
    expect(plain).toBe(readFileSync(join(pagesDir, 'test-page.html'), 'utf8'));
  });

  it('serves the page script and style with the same headers', async () => {
    for (const [path, type] of [
      ['test-page.js', 'text/javascript; charset=utf-8'],
      ['test-page.css', 'text/css; charset=utf-8'],
    ]) {
      const res = await fetch(`${origin}/sdk/v1/${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    }
  });

  it('answers HEAD with the headers and no body', async () => {
    for (const path of ['taleart.js', 'test-page']) {
      const res = await fetch(`${origin}/sdk/v1/${path}`, { method: 'HEAD' });
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe('');
    }
    const page = await fetch(`${origin}/sdk/v1/test-page`, { method: 'HEAD' });
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('sends /sdk/v1/test-page/ to the page without the slash, keeping the query', async () => {
    const res = await fetch(`${origin}/sdk/v1/test-page/?zone=home-top`, { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('../test-page?zone=home-top');
    expect(new URL(res.headers.get('location') ?? '', `${origin}/sdk/v1/test-page/`).pathname).toBe('/sdk/v1/test-page');
    expect((await fetch(`${origin}/sdk/v1/nope/`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${origin}/sdk/v1/taleart.js/`, { redirect: 'manual' })).status).toBe(404);
  });

  it('serves the bundle pinned to its content for a year, and only the current one', async () => {
    const info = installInfo('http://x', await servedFile(bundleFile)());
    const pinned = new URL(info.sdkPinnedUrl ?? '').pathname;
    expect(pinned).toMatch(/^\/sdk\/v1\/taleart\.[\w-]{16}\.js$/);
    const res = await fetch(`${origin}${pinned}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const body = Buffer.from(await res.arrayBuffer());
    expect(info.sdkIntegrity).toBe(`sha384-${createHash('sha384').update(body).digest('base64')}`);
    expect((await fetch(`${origin}/sdk/v1/taleart.AAAAAAAAAAAAAAAA.js`)).status).toBe(404);
  });

  it('serves a rebuilt bundle at once (size or modification time changed), without a restart', async () => {
    const before = await (await fetch(`${origin}/sdk/v1/taleart.js`)).text();
    writeFileSync(bundleFile, 'export const sdk = "rebuilt, longer";\n');
    const after = await (await fetch(`${origin}/sdk/v1/taleart.js`)).text();
    expect(after).not.toBe(before);
    expect(after).toBe('export const sdk = "rebuilt, longer";\n');
    writeFileSync(bundleFile, before);
  });

  it('serves nothing else under /sdk/v1', async () => {
    for (const path of ['test-page.html', '..%2Fapp.ts', 'index.js', 'constructor', '__proto__', 'hasOwnProperty', 'test-page.d.ts']) {
      const res = await fetch(`${origin}/sdk/v1/${path}`);
      expect(res.status, path).toBe(404);
    }
  });
});

describe('pinned URLs of earlier builds (story 8.21)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taleart-sdk-builds-'));
  const bundleFile = join(dir, 'taleart.js');
  const buildsDir = join(dir, 'builds');
  const servers: Server[] = [];
  const warnings: string[] = [];

  // An API like a restarted one: its own memory, the same bundle file and builds folder.
  async function start(options: { kept?: number; folder?: string | null } = {}): Promise<string> {
    const server = createApp(
      unused as Pool,
      unused as FrameTypeRegistry,
      unused as MediaStorage,
      { verifier: unused as PasskeyVerifier },
      { publicApiUrl: 'https://api.example.com' },
      undefined,
      undefined,
      { rateLimit: null },
      {
        bundleFile,
        buildsDir: options.folder === undefined ? buildsDir : options.folder,
        buildsKept: options.kept ?? 3,
        warn: (msg) => warnings.push(msg),
      },
    ).listen(0);
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  // A new build of the SDK: the bundle file replaced, and what its pinned URL and integrity are.
  const build = (text: string) => {
    const body = Buffer.from(`export const build = ${JSON.stringify(text)};\n`);
    writeFileSync(bundleFile, body);
    return { body, ...toServedFile(body), path: `/sdk/v1/taleart.${toServedFile(body).hash}.js` };
  };
  const status = async (url: string) => (await fetch(url)).status;
  const kept = () => readdirSync(buildsDir).filter((name) => !name.startsWith('.')).sort();
  // node:http, since fetch always asks for gzip and decodes it.
  const raw = (url: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number | undefined; headers: Record<string, string | string[] | undefined>; body: Buffer }>(
      (resolve, reject) =>
        get(url, { headers }, (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
        }).on('error', reject),
    );

  beforeEach(() => {
    rmSync(buildsDir, { recursive: true, force: true });
    warnings.length = 0;
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps serving the build a page pinned after a rebuild, with its own bytes, immutable', async () => {
    const a = build('a');
    const origin = await start();
    expect(await status(`${origin}/sdk/v1/taleart.js`)).toBe(200);
    const b = build('b, longer');
    const stable = await fetch(`${origin}/sdk/v1/taleart.js`);
    expect(await stable.text()).toBe(b.body.toString());

    const res = await fetch(`${origin}${a.path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(a.body)).toBe(true);
    // The integrity the Install tab gave for build a still holds.
    expect(`sha384-${createHash('sha384').update(body).digest('base64')}`).toBe(a.integrity);
    expect(await status(`${origin}${b.path}`)).toBe(200);
    expect(kept()).toEqual([a, b].map((x) => `taleart.${x.hash}.js`).sort());
  });

  it('sends a kept build gzipped, with an ETag per encoding, and 304 to its validator', async () => {
    const a = build('a');
    const origin = await start();
    await fetch(`${origin}/sdk/v1/taleart.js`);
    build('b, longer');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    const zipped = await raw(`${origin}${a.path}`, { 'Accept-Encoding': 'gzip' });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.headers['vary']).toMatch(/Accept-Encoding/);
    expect(gunzipSync(zipped.body).equals(a.body)).toBe(true);
    const plain = await raw(`${origin}${a.path}`);
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body.equals(a.body)).toBe(true);
    expect(plain.headers['etag']).toBe(a.etag);
    expect(zipped.headers['etag']).toBe(`${a.etag.slice(0, -1)}-gz"`);
    const fresh = await raw(`${origin}${a.path}`, { 'Accept-Encoding': 'gzip', 'If-None-Match': String(zipped.headers['etag']) });
    expect(fresh.status).toBe(304);
    expect(fresh.body.length).toBe(0);
  });

  it('keeps it across a restart with a changed SDK', async () => {
    const a = build('a');
    await start();
    // The API reads the bundle at start: build a is kept though no page asked for it.
    await expect.poll(() => (existsSync(buildsDir) ? kept() : [])).toEqual([`taleart.${a.hash}.js`]);
    const b = build('b, longer');
    const restarted = await start();
    const res = await fetch(`${restarted}${a.path}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(a.body)).toBe(true);
    expect(await (await fetch(`${restarted}/sdk/v1/taleart.js`)).text()).toBe(b.body.toString());
    expect(await status(`${restarted}${b.path}`)).toBe(200);
  });

  it('keeps only the last N builds, the current one included; an evicted hash answers 404', async () => {
    const origin = await start({ kept: 3 });
    const builds = [];
    for (const text of ['a', 'bb', 'ccc', 'dddd']) {
      builds.push(build(text));
      await fetch(`${origin}/sdk/v1/taleart.js`);
    }
    const [a, b, c, d] = builds;
    expect(await status(`${origin}${a.path}`)).toBe(404);
    for (const x of [b, c, d]) expect(await status(`${origin}${x.path}`), x.hash).toBe(200);
    expect(kept()).toEqual([b, c, d].map((x) => `taleart.${x.hash}.js`).sort());
  });

  it('counts a build served again as the newest (a redeploy of an older build)', async () => {
    const origin = await start({ kept: 3 });
    const a = build('a');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    const b = build('bb');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    build('a');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    const c = build('ccc');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    const d = build('dddd');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    expect(await status(`${origin}${b.path}`)).toBe(404);
    for (const x of [a, c, d]) expect(await status(`${origin}${x.path}`), x.hash).toBe(200);
  });

  it('answers 404 to a hash it never served, and to a kept file whose bytes are not that build', async () => {
    const a = build('a');
    const origin = await start();
    await fetch(`${origin}/sdk/v1/taleart.js`);
    const b = build('bb');
    await fetch(`${origin}/sdk/v1/taleart.js`);
    expect(await status(`${origin}/sdk/v1/taleart.AAAAAAAAAAAAAAAA.js`)).toBe(404);
    writeFileSync(join(buildsDir, `taleart.${a.hash}.js`), 'export const build = "tampered";\n');
    expect(await status(`${origin}${a.path}`)).toBe(404);
    // A file that is not a build is never served, whatever its name.
    writeFileSync(join(buildsDir, 'notes.js'), 'x');
    expect(await status(`${origin}/sdk/v1/notes.js`)).toBe(404);
    expect(await status(`${origin}${b.path}`)).toBe(200);
  });

  it('keeps only the current build without a folder, and still serves it when the folder cannot be written', async () => {
    const a = build('a');
    const none = await start({ folder: null });
    await fetch(`${none}/sdk/v1/taleart.js`);
    const b = build('bb');
    expect(await status(`${none}${b.path}`)).toBe(200);
    expect(await status(`${none}${a.path}`)).toBe(404);

    // A file where the folder should be: nothing is kept, a warning says so, the SDK is served.
    writeFileSync(join(dir, 'not-a-folder'), '');
    const broken = await start({ folder: join(dir, 'not-a-folder') });
    expect(await status(`${broken}/sdk/v1/taleart.js`)).toBe(200);
    expect(await status(`${broken}${b.path}`)).toBe(200);
    expect(warnings.some((w) => w.includes(`build ${b.hash} was not kept`))).toBe(true);
  });

  it('writes each build whole, so another API sharing the folder never reads half of one', async () => {
    const builds = sdkBuilds(buildsDir, 2);
    const a = toServedFile(Buffer.from('a'.repeat(100_000)));
    const b = toServedFile(Buffer.from('b'.repeat(100_000)));
    await Promise.all([builds.record(a), builds.record(b), builds.record(a)]);
    // No temporary files are left, and the last recorded is the newest.
    expect(readdirSync(buildsDir).sort()).toEqual([`taleart.${a.hash}.js`, `taleart.${b.hash}.js`].sort());
    expect((await builds.read(a.hash))?.body.equals(a.body)).toBe(true);
    expect(await builds.read('../../etc/passwd')).toBeNull();
    expect(await builds.read('AAAAAAAAAAAAAAAA')).toBeNull();
  });
});

describe('sdkBuildsFromEnv', () => {
  it('keeps five builds in .data/sdk-builds by default, or none with off', () => {
    expect(sdkBuildsFromEnv({}, (p) => `/repo/${p}`)).toEqual({ buildsDir: '/repo/.data/sdk-builds', buildsKept: 5 });
    expect(sdkBuildsFromEnv({ SDK_BUILDS_DIR: '/var/sdk', SDK_BUILDS_KEPT: '12' }, (p) => p)).toEqual({
      buildsDir: '/var/sdk',
      buildsKept: 12,
    });
    expect(sdkBuildsFromEnv({ SDK_BUILDS_DIR: 'off' }, (p) => p).buildsDir).toBeNull();
  });

  it('refuses a number of builds that is not a whole number from 1 to 100', () => {
    for (const bad of ['0', '-1', '1.5', 'five', '101', ' 3']) {
      expect(() => sdkBuildsFromEnv({ SDK_BUILDS_KEPT: bad }, (p) => p), bad).toThrow('SDK_BUILDS_KEPT must be a whole number');
    }
    expect(sdkBuildsFromEnv({ SDK_BUILDS_KEPT: '1' }, (p) => p).buildsKept).toBe(1);
    expect(sdkBuildsFromEnv({ SDK_BUILDS_KEPT: '100' }, (p) => p).buildsKept).toBe(100);
  });
});

describe('gzipCache', () => {
  it('compresses a file once, sharing the one in flight, and a rebuilt file again', async () => {
    const zip = gzipCache();
    const file = { body: Buffer.from('a'.repeat(1000)), etag: '"a"', hash: 'a', integrity: 'a' };
    const first = zip(file);
    expect(zip(file)).toBe(first);
    expect(gunzipSync(await first).toString()).toBe('a'.repeat(1000));
    const rebuilt = { ...file, body: Buffer.from('b') };
    expect(zip(rebuilt)).not.toBe(first);
    expect(gunzipSync(await zip(rebuilt)).toString()).toBe('b');
  });
});

describe('the install URLs and the test page CSP', () => {
  it('builds the URLs from the public API URL, without its trailing slash', () => {
    expect(installInfo('https://api.example.com/', null)).toEqual({
      apiUrl: 'https://api.example.com',
      sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
      sdkPinnedUrl: null,
      sdkIntegrity: null,
      testPageUrl: 'https://api.example.com/sdk/v1/test-page',
    });
    const bundle = { body: Buffer.from(''), etag: '"x"', hash: 'abcdefghijklmnop', integrity: 'sha384-x' };
    expect(installInfo('https://api.example.com', bundle)).toMatchObject({
      sdkPinnedUrl: 'https://api.example.com/sdk/v1/taleart.abcdefghijklmnop.js',
      sdkIntegrity: 'sha384-x',
    });
  });

  it('refuses a WEB_SDK_FILE that is not a .js file, and resolves one that is', () => {
    expect(webSdkFileFromEnv(undefined, (p) => p)).toBeUndefined();
    expect(webSdkFileFromEnv('', (p) => p)).toBeUndefined();
    expect(webSdkFileFromEnv('dist/libs/web-sdk/index.js', (p) => `/repo/${p}`)).toBe('/repo/dist/libs/web-sdk/index.js');
    expect(() => webSdkFileFromEnv('/etc/passwd', (p) => p)).toThrow('WEB_SDK_FILE must name a .js file');
    expect(() => webSdkFileFromEnv('index.js.map', (p) => p)).toThrow('WEB_SDK_FILE must name a .js file');
  });

  it("adds only an http(s) public API origin to the CSP's media sources", () => {
    expect(testPageCsp('http://localhost:3333')).toContain("img-src 'self' http://localhost:3333 data: blob:");
    expect(testPageCsp('https://api.example.com/base/path')).toContain("connect-src 'self' https://api.example.com;");
    expect(testPageCsp('not a url')).toContain("connect-src 'self';");
    expect(testPageCsp("javascript:alert('x')")).toContain("connect-src 'self';");
  });
});
