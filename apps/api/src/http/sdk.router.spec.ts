import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PasskeyVerifier } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import type { FrameTypeRegistry } from '@taleart/server-zones';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { installInfo, testPageCsp } from './sdk.router';

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
      get(`${origin}/sdk/v1/taleart.js`, { headers: { 'If-None-Match': etag } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on('error', reject),
    );
    expect(status).toBe(304);
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

  it('serves nothing else under /sdk/v1', async () => {
    for (const path of ['test-page.html', '..%2Fapp.ts', 'index.js', 'constructor', '__proto__', 'hasOwnProperty']) {
      const res = await fetch(`${origin}/sdk/v1/${path}`);
      expect(res.status, path).toBe(404);
    }
  });
});

describe('the install URLs and the test page CSP', () => {
  it('builds the URLs from the public API URL, without its trailing slash', () => {
    expect(installInfo('https://api.example.com/')).toEqual({
      apiUrl: 'https://api.example.com',
      sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
      testPageUrl: 'https://api.example.com/sdk/v1/test-page',
    });
  });

  it("adds only an http(s) public API origin to the CSP's media sources", () => {
    expect(testPageCsp('http://localhost:3333')).toContain("img-src 'self' http://localhost:3333 data: blob:");
    expect(testPageCsp('https://api.example.com/base/path')).toContain("connect-src 'self' https://api.example.com;");
    expect(testPageCsp('not a url')).toContain("connect-src 'self';");
    expect(testPageCsp("javascript:alert('x')")).toContain("connect-src 'self';");
  });
});
