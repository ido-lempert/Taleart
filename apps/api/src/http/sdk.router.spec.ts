import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { PasskeyVerifier } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { gzipCache, installInfo, servedFile, testPageCsp, webSdkFileFromEnv } from './sdk.router';

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
