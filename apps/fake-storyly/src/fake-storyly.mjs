// A stand-in for the Storyly External API, for tests and reviews of the
// importer. Plain Node, no dependencies. It serves hand-made fixtures shaped
// like the documented responses (import-mapping.md and the research digests);
// it holds no Storyly docs text, real tokens or end-user identifiers. Read only.
// It also stands in for the media host: story media URLs in the fixtures
// (https://media.example/fake/...) are served as its own /media/ URLs.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { hash01, loadScaleProfile, pick, scaleData, sendPaced } from './scale.mjs';

/** The only token the fake accepts, as a bearer token or the `token` query parameter. */
export const FAKE_STORYLY_TOKEN = 'fake-storyly-token';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const readFixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

/** Where the fixtures' media URLs point; each answer points them at the fake's own /media/ path. */
const FIXTURE_MEDIA_BASE = 'https://media.example/fake/';

/** The largest image a tale accepts (10 MB); the too-large files go one byte past it, or past the video limit. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const mediaDir = join(fixturesDir, 'media');
const readMedia = (name) => readFileSync(join(mediaDir, name));

function send(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  const text = JSON.stringify(body);
  res.end(origin ? text.split(FIXTURE_MEDIA_BASE).join(`${origin}/media/`) : text);
}

const MEDIA_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

function sendBytes(res, type, data) {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(data.length),
  });
  res.end(data);
}

// Streams `total` bytes that start like a JPEG, without a Content-Length, so
// only counting the bytes finds that the file is too large.
function sendEndless(req, res, total) {
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  const chunk = Buffer.alloc(64 * 1024);
  readMedia('story-0.jpg').copy(chunk, 0, 0, 16);
  let sent = 0;
  let closed = false;
  req.on('close', () => {
    closed = true;
  });
  const pump = () => {
    while (!closed && sent < total) {
      const part = sent === 0 ? chunk : chunk.subarray(16);
      const piece = part.subarray(0, Math.min(part.length, total - sent));
      sent += piece.length;
      if (!res.write(piece)) {
        res.once('drain', pump);
        return;
      }
    }
    if (!closed) res.end();
  };
  pump();
}

/**
 * Serves the media files the fixtures name (no token needed, like a CDN):
 * - `story-<id>.jpg`: one of four small JPEGs; `story-<id>.png|gif|webp|mp4|webm`:
 *   a small file of that type (the MP4 and WebM are structural and do not play).
 * - `moved.jpg`: a redirect to a JPEG; `octet.png`: a PNG sent as application/octet-stream.
 * - `too-large.jpg`: an image one byte over 10 MB, streamed without a length;
 *   `too-large-declared.mp4`: a length one byte over 100 MB, refused before reading.
 * - `wrong-type.jpg`: HTML bytes declared as JPEG; `page.html`: an HTML page.
 * - `redirect-private.jpg`: a redirect to the cloud metadata address;
 *   `redirect-loopback.jpg`: a redirect to this server over IPv6 loopback;
 *   `redirect-loop.jpg`: a redirect to itself.
 * - anything else: 404.
 */
function answerMedia(req, res, name, origin, port) {
  const story = /^story-([A-Za-z0-9]+)\.(jpg|png|gif|webp|mp4|webm)$/.exec(name);
  if (story) {
    const [, id, ext] = story;
    const file = ext === 'jpg' ? `story-${(Number.parseInt(id, 10) || 0) % 4}.jpg` : `story.${ext}`;
    sendBytes(res, MEDIA_TYPES[ext], readMedia(file));
    return;
  }
  switch (name) {
    case 'moved.jpg':
      res.writeHead(302, { Location: '/media/story-1.jpg' }).end();
      return;
    case 'octet.png':
      sendBytes(res, 'application/octet-stream', readMedia('story.png'));
      return;
    case 'too-large.jpg':
      sendEndless(req, res, MAX_IMAGE_BYTES + 1);
      return;
    case 'too-large-declared.mp4':
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(MAX_VIDEO_BYTES + 1),
      });
      res.write(readMedia('story.mp4'));
      req.on('close', () => res.destroy());
      return;
    case 'wrong-type.jpg':
      sendBytes(res, 'image/jpeg', Buffer.from('<!doctype html><title>Not an image</title>'));
      return;
    case 'page.html':
      sendBytes(res, 'text/html; charset=utf-8', Buffer.from('<!doctype html><title>A page</title>'));
      return;
    case 'redirect-private.jpg':
      res
        .writeHead(302, {
          Location: 'http://169.254.169.254/latest/meta-data/',
        })
        .end();
      return;
    case 'redirect-loopback.jpg':
      res.writeHead(302, { Location: `http://[::1]:${port}/media/story-1.jpg` }).end();
      return;
    case 'redirect-loop.jpg':
      res.writeHead(302, { Location: `${origin}/media/redirect-loop.jpg` }).end();
      return;
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

function tokenOf(req, url) {
  const header = req.headers['authorization'] ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : (url.searchParams.get('token') ?? '');
}

// Answers a list as the fixtures hold it, or fails it as `mode` asks:
// 'status' answers 500, 'shape' answers an unexpected shape.
function sendList(res, mode, body, origin) {
  if (mode === 'status') {
    send(res, 500, { message: 'Internal server error' });
    return;
  }
  if (mode === 'shape') {
    send(res, 200, { unexpected: true });
    return;
  }
  send(res, 200, body ?? { data: [] }, origin);
}

/**
 * Starts the fake on `port` (0 picks a free one). Resolves to its base URL,
 * the base URL of its media (`mediaUrl`), the port, `close()`, and `control`:
 * - `failInstances`, `failStoryGroups`, `failStories`, `failSegments`: 'status'
 *   answers that list with a 500, 'shape' with an unexpected shape; null serves it.
 * - `data.instances` (by app id), `data.storyGroups` (by instance id) and
 *   `data.stories` (by story group id) and `data.segments` (the labels list,
 *   by app id): the served lists,
 *   which tests may change; `reset()` restores the
 *   fixtures and clears the failure switches.
 * - `delayMs`: how long each answer waits, so a review can watch an import
 *   run; 0 answers at once. `reset()` sets it back to 0.
 * - `requests`: each request's method and path.
 * - `useScale(options)`: serves the Scale shop (fixtures/scale-profile.json,
 *   importer story 10) besides the fixtures, with the profile's latency,
 *   bandwidth and occasional 429 and 500 replies (each failing request answers
 *   once, then succeeds). `options` may override the profile's counts and set
 *   `factor` (every delay times it, bandwidth divided by it; 1 by default; 0
 *   answers at once), and `failures`: false for none, or rates overriding the
 *   profile's. `reset()` turns it off.
 * - `hold`: `{ matches(url), until }`: a request whose URL matches waits for
 *   the `until` promise before it is answered, so a test can stop a run at a
 *   known point. `reset()` clears it.
 * - `stats`: Scale shop counters: API and media requests, injected failures by
 *   status, media bytes sent, and the most media requests open at once (from
 *   arrival to the end of the answer).
 */
export async function startFakeStoryly({ port = 0, host = '127.0.0.1' } = {}) {
  const apps = readFixture('apps.json');
  const control = {
    failInstances: null,
    failStoryGroups: null,
    failStories: null,
    failSegments: null,
    delayMs: 0,
    data: {},
    requests: [],
    scale: null,
    hold: null,
    stats: null,
    useScale(options = {}) {
      const { factor = 1, failures = true, ...counts } = options;
      const profile = { ...loadScaleProfile(), ...counts };
      if (!failures) profile.failures = { api429: 0, api500: 0, media429: 0, media503: 0, retryAfterSeconds: 0 };
      else if (typeof failures === 'object') profile.failures = { ...profile.failures, ...failures };
      const data = scaleData(profile);
      const appId = String(profile.app.id);
      control.data.instances[appId] = data.instances[appId];
      control.data.segments[appId] = data.segments[appId];
      Object.assign(control.data.storyGroups, data.storyGroups);
      Object.assign(control.data.stories, data.stories);
      control.scale = { profile, factor, app: data.app, media: data.media, failed: new Set() };
      let mediaBytes = 0;
      for (const file of data.media.values()) mediaBytes += file.bytes;
      return { appId, tales: profile.instances * profile.groupsPerInstance * profile.storiesPerGroup, mediaBytes };
    },
    reset() {
      control.scale = null;
      control.hold = null;
      control.stats = {
        apiRequests: 0,
        mediaRequests: 0,
        injected: {},
        mediaBytes: 0,
        mediaOpen: 0,
        maxMediaOpen: 0,
      };
      control.failInstances = null;
      control.failStoryGroups = null;
      control.failStories = null;
      control.failSegments = null;
      control.delayMs = 0;
      control.data = {
        instances: readFixture('instances.json'),
        storyGroups: readFixture('story-groups.json'),
        stories: readFixture('stories.json'),
        segments: readFixture('segments.json'),
      };
    },
  };
  control.reset();

  // Known once the server listens: media URLs in answers point here.
  let actualPort = 0;
  let origin = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    control.requests.push({ method: req.method, path: url.pathname });
    if (control.scale && isMedia(url)) {
      // Open from its arrival to the end of its answer, its latency included.
      const stats = control.stats;
      stats.mediaOpen++;
      stats.maxMediaOpen = Math.max(stats.maxMediaOpen, stats.mediaOpen);
      res.once('close', () => stats.mediaOpen--);
    }
    const delayMs = control.delayMs + (control.scale ? scaleDelay(url) : 0);
    const reply = () => {
      if (delayMs > 0) setTimeout(() => answer(req, res, url), delayMs);
      else answer(req, res, url);
    };
    // A held request waits until the test lets it go.
    const hold = control.hold;
    if (hold && hold.matches(url)) hold.until.then(reply, reply);
    else reply();
  });

  // The Scale shop's profile: what a request is called for its delay and its failure, without the token.
  const scaleKey = (url) => {
    const params = new URLSearchParams(url.searchParams);
    params.delete('token');
    return `${url.pathname}?${params}`;
  };
  const isMedia = (url) => url.pathname.startsWith('/media/');
  function scaleDelay(url) {
    const { profile, factor } = control.scale;
    const range = isMedia(url) ? profile.media.ttfbMs : profile.api.latencyMs;
    return pick(range, `delay:${scaleKey(url)}`) * factor;
  }

  // A request the profile fails: the status it answers, once per request; null to answer it.
  function scaleFailure(url) {
    const { profile, failed } = control.scale;
    const key = scaleKey(url);
    if (failed.has(key)) return null;
    const draw = hash01(`fail:${key}`);
    const [tooMany, broken] = isMedia(url)
      ? [profile.failures.media429, profile.failures.media503]
      : [profile.failures.api429, profile.failures.api500];
    const status = draw < tooMany ? 429 : draw < tooMany + broken ? (isMedia(url) ? 503 : 500) : null;
    if (status === null) return null;
    failed.add(key);
    control.stats.injected[status] = (control.stats.injected[status] ?? 0) + 1;
    return status;
  }

  // Serves a Scale shop media file, paced by the profile's bandwidth; false when `name` is not one.
  function answerScaleMedia(res, name) {
    const file = control.scale.media.get(name);
    if (!file) return false;
    control.stats.mediaBytes += file.bytes;
    sendPaced(res, file.ext, file.bytes, control.scale.profile.media.bytesPerSecond / control.scale.factor);
    return true;
  }

  function answer(req, res, url) {
    if (control.scale && req.method === 'GET') {
      if (isMedia(url)) control.stats.mediaRequests++;
      else control.stats.apiRequests++;
      const status = scaleFailure(url);
      if (status !== null) {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          ...(status === 429 ? { 'Retry-After': String(control.scale.profile.failures.retryAfterSeconds) } : {}),
        });
        res.end(JSON.stringify({ message: status === 429 ? 'Too many requests' : 'Server error' }));
        return;
      }
      if (isMedia(url) && answerScaleMedia(res, url.pathname.slice('/media/'.length))) return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      answerMedia(req, res, url.pathname.slice('/media/'.length), origin, actualPort);
      return;
    }
    if (req.method !== 'GET') {
      // The importer only reads; anything else is a bug in the caller.
      send(res, 405, { message: 'Method not allowed' });
      return;
    }
    if (tokenOf(req, url) !== FAKE_STORYLY_TOKEN) {
      send(res, 401, { message: 'Unauthorized' });
      return;
    }
    const path = url.pathname.replace(/^\/external/, '').replace(/\/+$/, '');
    if (path === '/app') {
      send(res, 200, control.scale ? { data: [...apps.data, control.scale.app] } : apps);
      return;
    }
    if (path === '/instance') {
      sendList(res, control.failInstances, control.data.instances[url.searchParams.get('app_id') ?? ''], origin);
      return;
    }
    if (path === '/story-group') {
      sendList(
        res,
        control.failStoryGroups,
        control.data.storyGroups[url.searchParams.get('instance_id') ?? ''],
        origin,
      );
      return;
    }
    if (path === '/segment') {
      // The labels list: its path and shape are guesses until the real run (importer story 3).
      sendList(res, control.failSegments, control.data.segments[url.searchParams.get('app_id') ?? ''], origin);
      return;
    }
    if (path === '/story') {
      sendList(res, control.failStories, control.data.stories[url.searchParams.get('story_group_id') ?? ''], origin);
      return;
    }
    send(res, 404, { message: 'Not found' });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  actualPort = server.address().port;
  origin = `http://${host}:${actualPort}`;
  return {
    url: `${origin}/external`,
    mediaUrl: `${origin}/media`,
    port: actualPort,
    control,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
