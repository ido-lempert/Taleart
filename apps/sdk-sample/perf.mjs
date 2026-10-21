// First zone content on a mid-tier mobile profile over Fast 4G (NFR-006, epic web zones R10).
//
// Starts the built API on a test database, seeds a zone through the Management API (a bar and a
// banner frame; tale groups with an animated cover, still covers and one without a cover, each with
// full-size tale images), serves the sample page, and loads it again and again in headless Chromium
// throttled to Fast 4G with a 4x slower CPU. Each load reads the `taleart:first-content` performance
// mark the Web SDK sets once the first frame is on the page with the covers in view loaded. Prints
// every run, p50, p75 and max for cold loads (empty cache) and warm loads (a reload), and the SDK's
// gzipped size. Exits 1 when cold p75 is over the budget, the bundle over 50 KB gzipped, or the page
// (whose tales use no project font) requests a font file (epic Tale Studio R15).
//
// A second zone holds a text tale of 20 elements in a project font (story 7.17): its page must
// request no font until the tale opens; then the first tale frame (all 20 texts on the stage, in
// their fallback) and the font swap are timed from the tap. Exits 1 when the font is requested
// before the tale opens, or p75 first tale frame is over FRAME_BUDGET_MS.
//
// Run through `nx run sdk-sample:perf`, which builds the API and the SDK first.
// Environment: TEST_DATABASE_URL (a database whose name ends in _test; the rows the run adds are
// deleted at the end), PERF_RUNS (default 10), PERF_BUDGET_MS (default 1500).
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '../..');
const API_MAIN = join(ROOT, 'dist/apps/api/main.js');
const SDK_BUNDLE = join(ROOT, 'dist/libs/web-sdk/index.js');
const RUNS = Math.max(1, Number(process.env.PERF_RUNS) || 10);
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS) || 1500;
const BUNDLE_LIMIT_BYTES = 50 * 1024;
const MARK = 'taleart:first-content';
// The first tale frame's budget (epic Tale Studio R15; a starting value, tuned by story 7.14).
const FRAME_BUDGET_MS = Number(process.env.PERF_FRAME_BUDGET_MS) || 1000;
// A WOFF2 font the workspace already has, uploaded as the project font.
const FONT_FILE = join(ROOT, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
// A font file's request: the public font route (`/media/fonts/<uuid>.woff2`) or any WOFF2.
const isFontRequest = (name) => /\/media\/fonts\/|\.woff2(\?|$)/.test(name);

// Chrome DevTools' "Fast 4G" preset (download 9 Mbps, upload 1.5 Mbps, 60 ms RTT, with DevTools'
// own adjustments: 90 % of the throughput, latency x 2.75) and its mid-tier mobile CPU (4x slower).
export const FAST_4G = {
  offline: false,
  latency: 60 * 2.75,
  downloadThroughput: ((9 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((1.5 * 1000 * 1000) / 8) * 0.9,
  connectionType: 'cellular4g',
};
export const CPU_SLOWDOWN = 4;
// A mid-tier phone's screen (Lighthouse's mobile default).
const DEVICE = { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true };

/** The value at or under which `p` percent of `values` fall (nearest rank). */
export function percentile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

// TEST_DATABASE_URL, parsed as pg parses it, so `?db=` and socket forms are judged by the database they reach.
function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL to a database whose name ends in _test');
  const { database, db } = parseConnectionString(url);
  if (!database?.endsWith('_test') || (db !== undefined && !String(db).endsWith('_test'))) {
    throw new Error('TEST_DATABASE_URL must name a database ending in _test');
  }
  return url;
}

async function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

// Spawns a Node process, adds it to `children` at once (so cleanup kills it whatever happens), and
// resolves once its output contains `ready`. A process that does not start in 30 s is killed.
async function start(children, label, args, env, ready) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  let started = false;
  await new Promise((done, fail) => {
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error(`${label} did not start:\n${output}`));
    }, 30_000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`${label} exited with ${code}:\n${output}`));
    });
    const onData = (chunk) => {
      if (started) return;
      output += chunk;
      if (output.includes(ready)) {
        started = true;
        clearTimeout(timer);
        child.removeAllListeners('exit');
        done();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
  return child;
}

// Test media made the way the dashboard makes it (story 14), in the browser: full-size tale photos
// (1080 x 1920 JPEG), still covers (320 px JPEG at 0.85) and an animated cover (160 px WebM clip,
// 15 fps, 400 kbit/s, 3 s, the longest the dashboard records).
async function makeMedia(browser, count) {
  const page = await browser.newPage();
  const media = await page.evaluate(async (count) => {
    const toBase64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    };
    // A photo-like picture: a gradient, soft shapes and grain, so it compresses like a photo.
    const paint = (canvas, seed) => {
      const ctx = canvas.getContext('2d');
      const { width: w, height: h } = canvas;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, `hsl(${(seed * 47) % 360} 70% 55%)`);
      gradient.addColorStop(1, `hsl(${(seed * 47 + 140) % 360} 60% 30%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      let r = seed * 9973 + 1;
      const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `hsl(${rand() * 360} 60% ${30 + rand() * 50}% / 0.35)`;
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, (rand() * w) / 4, 0, Math.PI * 2);
        ctx.fill();
      }
      const image = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < image.data.length; i += 4) {
        const grain = (rand() - 0.5) * 18;
        image.data[i] += grain;
        image.data[i + 1] += grain;
        image.data[i + 2] += grain;
      }
      ctx.putImageData(image, 0, 0);
    };
    const jpeg = async (size, seed, quality) => {
      const canvas = document.createElement('canvas');
      canvas.width = size[0];
      canvas.height = size[1];
      paint(canvas, seed);
      return toBase64(await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality)));
    };
    const tales = [];
    for (let i = 0; i < count; i++) tales.push(await jpeg([1080, 1920], i + 1, 0.85));
    const covers = [];
    for (let i = 0; i < count; i++) covers.push(await jpeg([320, 320], i + 101, 0.85));
    // The animated cover: a moving picture recorded from a canvas, as the dashboard records it.
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(15), {
      mimeType: 'video/webm',
      videoBitsPerSecond: 400_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((done) => (recorder.onstop = done));
    recorder.start();
    const started = performance.now();
    while (performance.now() - started < 3000) {
      const t = (performance.now() - started) / 1000;
      ctx.fillStyle = `hsl(${t * 120} 70% 50%)`;
      ctx.fillRect(0, 0, 160, 160);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `hsl(${(i * 37 + t * 200) % 360} 80% 60%)`;
        ctx.fillRect((i * 23 + t * 80) % 160, (i * 41 + t * 50) % 160, 20, 20);
      }
      await new Promise((done) => setTimeout(done, 1000 / 15));
    }
    recorder.stop();
    await stopped;
    const animated = await toBase64(new Blob(chunks, { type: 'video/webm' }));
    return { tales, covers, animated };
  }, count);
  await page.close();
  const bytes = (b64) => Buffer.from(b64, 'base64');
  return { tales: media.tales.map(bytes), covers: media.covers.map(bytes), animated: bytes(media.animated) };
}

// Signs a new admin in directly in the database, as the API's integration tests do. Records the
// user in `seeded` (for cleanup) and returns the session cookie.
async function signIn(databaseUrl, seeded) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const email = `perf-${randomBytes(6).toString('hex')}@example.com`;
    const { rows } = await client.query(
      'INSERT INTO users (name, email, role, webauthn_user_id) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Perf admin', email, 'admin', randomBytes(32).toString('base64url')],
    );
    seeded.userId = rows[0].id;
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    await client.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [rows[0].id, hash],
    );
    return `taleart_session=${token}`;
  } finally {
    await client.end();
  }
}

// The seeded zone: a bar and a banner frame and eight live tale groups of three live tales each.
// The first group has an animated cover (it counts toward the budget, R12), the third none (its
// bar item shows the first tale's full-size image), the others a still cover.
const GROUPS = ['New in', 'Summer sale', 'Behind the scenes', 'Top picks', 'Outdoor', 'Kids', 'Beauty', 'Gifts'];

// Deletes what the run added: the seeded project with its zone, frames, stages, theme, groups,
// tales, placements and key, then the admin with their session. Media files go with the temp dir.
async function removeSeeded(databaseUrl, { userId, projectId }) {
  if (!userId && !projectId) return;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (projectId) {
      for (const table of [
        'tale_fonts',
        'project_fonts',
        'tale_media',
        'project_media',
        'zone_keys',
        'zone_tale_groups',
        'tale_group_tags',
        'tales',
        'tale_groups',
        'stages',
        'frames',
        'project_themes',
        'zones',
        'tags',
        'invitations',
        'project_members',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
      }
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    // Sessions and passkeys go with the user.
    if (userId) await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

async function seed(apiUrl, cookie, media, seeded) {
  const call = async (method, path, body, contentType = 'application/json') => {
    const res = await fetch(`${apiUrl}/api/v1${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': contentType },
      body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
    });
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const project = await call('POST', '/projects', { name: `Perf ${new Date().toISOString()}` });
  seeded.projectId = project.id;
  const zone = await call('POST', '/zones', { name: 'Home', projectId: project.id });
  await call('POST', `/zones/${zone.id}/frames`, { type: 'bar', settings: {} });
  await call('POST', `/zones/${zone.id}/frames`, { type: 'banner', settings: {} });
  let photo = 0;
  for (const [index, name] of GROUPS.entries()) {
    const group = await call('POST', `/zones/${zone.id}/tale-groups`, { name });
    for (let t = 0; t < 3; t++) {
      const tale = await call('POST', `/tale-groups/${group.id}/tales`, { title: `${name} ${t + 1}` });
      await call('PUT', `/tales/${tale.id}/media`, media.tales[photo++ % media.tales.length], 'image/jpeg');
      await call('PUT', `/tales/${tale.id}/status`, { status: 'live' });
    }
    if (index === 0) await call('PUT', `/tale-groups/${group.id}/cover`, media.animated, 'video/webm');
    else if (index !== 2) await call('PUT', `/tale-groups/${group.id}/cover`, media.covers[index], 'image/jpeg');
    await call('PUT', `/tale-groups/${group.id}/status`, { status: 'live' });
  }
  const key = (await call('POST', `/zones/${zone.id}/key`)).key;

  // A second zone, with one group whose tale is 20 texts, every other one in the project font.
  const font = await call(
    'POST',
    `/projects/${project.id}/fonts?family=Brand%20Sans&weight=400&style=normal&fallback=sans&licence=confirmed`,
    readFileSync(FONT_FILE),
    'application/octet-stream',
  );
  const fontZone = await call('POST', '/zones', { name: 'Fonts', projectId: project.id });
  await call('POST', `/zones/${fontZone.id}/frames`, { type: 'bar', settings: {} });
  const group = await call('POST', `/zones/${fontZone.id}/tale-groups`, { name: 'Brand' });
  const tale = await call('POST', `/tale-groups/${group.id}/tales`, { title: 'Brand story' });
  const elements = Array.from({ length: 20 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    type: 'text',
    box: { x: 0.08, y: 0.12 + i * 0.037, w: 0.84, h: 0.035, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: {
      text: `Line ${i + 1}: new arrivals this week`,
      size: 0.025,
      ...(i % 2 === 0 && { font: { source: 'project', fontId: font.id }, fallback: 'sans' }),
    },
  }));
  const document = { version: 1, canvas: { background: { type: 'color', color: '#1f3a5f' } }, elements };
  await call('PUT', `/tales/${tale.id}/document`, { document, revision: 0 });
  await call('PUT', `/tales/${tale.id}/status`, { status: 'live' });
  await call('PUT', `/tale-groups/${group.id}/status`, { status: 'live' });
  const fontKey = (await call('POST', `/zones/${fontZone.id}/key`)).key;
  return { key, fontKey };
}

// One load of the sample page in a fresh, throttled context: a cold load, then a warm reload.
async function measure(browser, url) {
  const context = await browser.newContext(DEVICE);
  // Cumulative layout shift up to first content, reported beside the time (not part of the pass/fail).
  await context.addInitScript(() => {
    window.__taleartShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__taleartShift += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', FAST_4G);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    const read = async () => {
      await page.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, MARK, {
        timeout: 20_000,
        polling: 50,
      });
      return page.evaluate((mark) => {
        const nav = performance.getEntriesByType('navigation')[0];
        const at = (name) => performance.getEntriesByName(name)[0]?.startTime ?? NaN;
        const resources = performance
          .getEntriesByType('resource')
          .map(
            (r) =>
              `${r.name.replace(/^.*\/\/[^/]+/, '').slice(0, 40)} ${Math.round(r.startTime)}-${Math.round(r.responseEnd)} ${r.transferSize}B`,
          );
        return {
          firstContent: at(mark),
          zone: at('taleart:zone'),
          document: nav.responseEnd,
          shift: window.__taleartShift,
          resources,
        };
      }, MARK);
    };
    await page.goto(url, { waitUntil: 'commit' });
    const cold = await read();
    // Let the page settle (covers, the banner's next slide) before listing what it requested.
    await page.waitForTimeout(1500);
    const fontRequests = (
      await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name))
    ).filter(isFontRequest);
    await page.reload({ waitUntil: 'commit' });
    const warm = await read();
    if (errors.length) throw new Error(`The page logged errors: ${errors.join('; ')}`);
    return { cold, warm, fontRequests };
  } finally {
    await context.close();
  }
}

// The font zone in a fresh, throttled context: no font before the tale opens; then, from the tap on
// its bar item, the first tale frame (20 texts on the stage) and the moment the project font is in use.
async function measureFontTale(browser, url) {
  const context = await browser.newContext(DEVICE);
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', FAST_4G);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    const fontRequests = [];
    page.on('request', (req) => isFontRequest(req.url()) && fontRequests.push(req.url()));
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, MARK, { timeout: 20_000 });
    await page.waitForTimeout(1000);
    const beforeOpen = fontRequests.length;
    await page.evaluate(() => {
      const host = document.querySelector('taleart-view');
      const times = (window.__taleartFont = { start: 0, frame: NaN, font: NaN });
      host.addEventListener('click', () => (times.start = performance.now()), { capture: true, once: true });
      let painting = false;
      const check = () => {
        if (times.start) {
          const texts = host.shadowRoot.querySelectorAll('dialog[open] .ta-text');
          if (!painting && texts.length >= 20) {
            // Painted on the next frame.
            painting = true;
            requestAnimationFrame(() => (times.frame = performance.now() - times.start));
          }
          const loaded = [...document.fonts].some((f) => f.family.includes('taleart-font-') && f.status === 'loaded');
          if (Number.isNaN(times.font) && loaded) times.font = performance.now() - times.start;
        }
        if (Number.isNaN(times.frame) || Number.isNaN(times.font)) requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await page.locator('taleart-view button.item').first().click();
    await page.waitForFunction(
      () => !Number.isNaN(window.__taleartFont.frame) && !Number.isNaN(window.__taleartFont.font),
      null,
      { timeout: 20_000, polling: 50 },
    );
    const { frame, font } = await page.evaluate(() => window.__taleartFont);
    if (errors.length) throw new Error(`The page logged errors: ${errors.join('; ')}`);
    return { beforeOpen, afterOpen: fontRequests.length, frame, font };
  } finally {
    await context.close();
  }
}

function summary(label, values) {
  const f = (v) => `${Math.round(v)} ms`;
  return `${label}: p50 ${f(percentile(values, 50))}, p75 ${f(percentile(values, 75))}, max ${f(Math.max(...values))}`;
}

async function main() {
  for (const file of [API_MAIN, SDK_BUNDLE]) {
    if (!existsSync(file)) throw new Error(`${file} is missing; run through nx run sdk-sample:perf, which builds it`);
  }
  const databaseUrl = testDatabaseUrl();
  const gzipped = gzipSync(readFileSync(SDK_BUNDLE), { level: 9 }).length;
  const [apiPort, samplePort] = [await freePort(), await freePort()];
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  // Everything the run starts or adds, undone by one cleanup: on success, on failure and on SIGINT/SIGTERM.
  const children = [];
  const seeded = { userId: null, projectId: null };
  let browser = null;
  let mediaDir = null;
  let cleaned = null;
  const cleanup = () =>
    (cleaned ??= (async () => {
      await browser?.close().catch(() => undefined);
      for (const child of children) child.kill();
      if (mediaDir) rmSync(mediaDir, { recursive: true, force: true });
      await removeSeeded(databaseUrl, seeded).catch((err) => console.error(`Could not remove the seeded rows: ${err}`));
    })());
  const onSignal = (signal) => {
    console.error(`Stopping on ${signal}`);
    void cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    mediaDir = mkdtempSync(join(tmpdir(), 'taleart-perf-media-'));
    // Playwright's own signal handlers would exit before this script's cleanup; the cleanup closes the browser.
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    await start(
      children,
      'API',
      [API_MAIN],
      {
        DATABASE_URL: databaseUrl,
        PORT: String(apiPort),
        PUBLIC_API_URL: apiUrl,
        MEDIA_DIR: mediaDir,
        IMPORT_TOKEN_KEY: '',
      },
      'Delivery API at',
    );
    await start(
      children,
      'sample server',
      [join(ROOT, 'apps/sdk-sample/serve.mjs')],
      { PORT: String(samplePort) },
      'SDK sample at',
    );
    const media = await makeMedia(browser, GROUPS.length);
    const kb = (b) => `${Math.round(b.length / 1024)} KB`;
    console.log(
      `Seeded media: tale images ${media.tales.map(kb).join(', ')}; still covers ~${kb(media.covers[1])}; animated cover ${kb(media.animated)}`,
    );
    const { key, fontKey } = await seed(apiUrl, await signIn(databaseUrl, seeded), media, seeded);
    const url = `http://127.0.0.1:${samplePort}/?key=${encodeURIComponent(key)}&api=${encodeURIComponent(apiUrl)}`;
    const fontUrl = `http://127.0.0.1:${samplePort}/?key=${encodeURIComponent(fontKey)}&api=${encodeURIComponent(apiUrl)}`;
    console.log(
      `Profile: Fast 4G (${FAST_4G.latency} ms latency, 9 Mbps x 0.9 down), CPU ${CPU_SLOWDOWN}x slower, ${DEVICE.viewport.width} x ${DEVICE.viewport.height}`,
    );
    const cold = [];
    const warm = [];
    const fontRequests = [];
    for (let run = 1; run <= RUNS; run++) {
      const result = await measure(browser, url);
      cold.push(result.cold.firstContent);
      warm.push(result.warm.firstContent);
      fontRequests.push(...result.fontRequests);
      const r = (v) => Math.round(v);
      console.log(
        `run ${run}: cold ${r(result.cold.firstContent)} ms (document ${r(result.cold.document)}, zone ${r(result.cold.zone)}, ` +
          `layout shift ${result.cold.shift.toFixed(3)}); ` +
          `warm ${r(result.warm.firstContent)} ms (zone ${r(result.warm.zone)})`,
      );
      // PERF_DEBUG=1 lists the first cold load's requests: path, start-end (ms) and bytes transferred.
      if (process.env.PERF_DEBUG && run === 1) for (const line of result.cold.resources) console.log(`    ${line}`);
    }
    console.log(summary('First content, cold', cold));
    console.log(summary('First content, warm', warm));
    console.log(`Font files requested by the page whose tales use no project font: ${fontRequests.length}`);

    // The project font tale (story 7.17).
    const frames = [];
    const swaps = [];
    let earlyFonts = 0;
    let fetchedFonts = 0;
    for (let run = 1; run <= RUNS; run++) {
      const result = await measureFontTale(browser, fontUrl);
      frames.push(result.frame);
      swaps.push(result.font);
      earlyFonts += result.beforeOpen;
      fetchedFonts += result.afterOpen - result.beforeOpen;
      const r = (v) => Math.round(v);
      console.log(
        `font tale run ${run}: font requests before opening ${result.beforeOpen}, after ${result.afterOpen}; ` +
          `first tale frame ${r(result.frame)} ms, project font in use ${r(result.font)} ms after the tap`,
      );
    }
    console.log(summary('First tale frame (20 texts, project font)', frames));
    console.log(summary('Project font swapped in', swaps));
    console.log(`Web SDK bundle: ${(gzipped / 1024).toFixed(2)} KB gzipped (budget 50 KB)`);
    const p75 = percentile(cold, 75);
    const frameP75 = percentile(frames, 75);
    const failures = [];
    if (!(p75 <= BUDGET_MS)) failures.push(`cold p75 first content ${Math.round(p75)} ms is over ${BUDGET_MS} ms`);
    if (gzipped > BUNDLE_LIMIT_BYTES) failures.push('the bundle is over 50 KB gzipped');
    if (fontRequests.length > 0) failures.push(`a page whose tales use no project font requested ${fontRequests[0]}`);
    if (earlyFonts > 0) failures.push('the font zone requested its font before the tale opened');
    if (fetchedFonts < RUNS) failures.push('opening the font tale did not request its font');
    if (!(frameP75 <= FRAME_BUDGET_MS)) {
      failures.push(`p75 first tale frame ${Math.round(frameP75)} ms is over ${FRAME_BUDGET_MS} ms`);
    }
    if (failures.length) {
      console.error(`FAIL: ${failures.join('; ')}`);
      process.exitCode = 1;
    } else {
      console.log(
        `PASS: cold p75 first content ${Math.round(p75)} ms <= ${BUDGET_MS} ms; no font request without a project ` +
          `font; p75 first tale frame ${Math.round(frameP75)} ms <= ${FRAME_BUDGET_MS} ms`,
      );
    }
  } finally {
    await cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
