// A stand-in for the Storyly External API, for tests and reviews of the
// importer. Plain Node, no dependencies. It serves hand-made fixtures shaped
// like the documented responses (import-mapping.md and the research digests);
// it holds no Storyly docs text, real tokens or end-user identifiers. Read only.
// It also stands in for the media host: story media URLs in the fixtures
// (https://media.example/fake/...) are served as its own /media/ URLs.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

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
  res.end(
    origin ? text.split(FIXTURE_MEDIA_BASE).join(`${origin}/media/`) : text,
  );
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
  const story = /^story-([A-Za-z0-9]+)\.(jpg|png|gif|webp|mp4|webm)$/.exec(
    name,
  );
  if (story) {
    const [, id, ext] = story;
    const file =
      ext === 'jpg'
        ? `story-${(Number.parseInt(id, 10) || 0) % 4}.jpg`
        : `story.${ext}`;
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
      sendBytes(
        res,
        'image/jpeg',
        Buffer.from('<!doctype html><title>Not an image</title>'),
      );
      return;
    case 'page.html':
      sendBytes(
        res,
        'text/html; charset=utf-8',
        Buffer.from('<!doctype html><title>A page</title>'),
      );
      return;
    case 'redirect-private.jpg':
      res
        .writeHead(302, {
          Location: 'http://169.254.169.254/latest/meta-data/',
        })
        .end();
      return;
    case 'redirect-loopback.jpg':
      res
        .writeHead(302, { Location: `http://[::1]:${port}/media/story-1.jpg` })
        .end();
      return;
    case 'redirect-loop.jpg':
      res
        .writeHead(302, { Location: `${origin}/media/redirect-loop.jpg` })
        .end();
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
 * - `failInstances`, `failStoryGroups`, `failStories`: 'status' answers that
 *   list with a 500, 'shape' with an unexpected shape; null serves it.
 * - `data.storyGroups` (by instance id) and `data.stories` (by story group
 *   id): the served lists, which tests may change; `reset()` restores the
 *   fixtures and clears the failure switches.
 * - `delayMs`: how long each answer waits, so a review can watch an import
 *   run; 0 answers at once. `reset()` sets it back to 0.
 * - `requests`: each request's method and path.
 */
export async function startFakeStoryly({ port = 0, host = '127.0.0.1' } = {}) {
  const apps = readFixture('apps.json');
  const instances = readFixture('instances.json');
  const control = {
    failInstances: null,
    failStoryGroups: null,
    failStories: null,
    delayMs: 0,
    data: {},
    requests: [],
    reset() {
      control.failInstances = null;
      control.failStoryGroups = null;
      control.failStories = null;
      control.delayMs = 0;
      control.data = { storyGroups: readFixture('story-groups.json'), stories: readFixture('stories.json') };
    },
  };
  control.reset();

  // Known once the server listens: media URLs in answers point here.
  let actualPort = 0;
  let origin = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    control.requests.push({ method: req.method, path: url.pathname });
    if (control.delayMs > 0) {
      setTimeout(() => answer(req, res, url), control.delayMs);
      return;
    }
    answer(req, res, url);
  });

  function answer(req, res, url) {
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      answerMedia(
        req,
        res,
        url.pathname.slice('/media/'.length),
        origin,
        actualPort,
      );
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
      send(res, 200, apps);
      return;
    }
    if (path === '/instance') {
      sendList(
        res,
        control.failInstances,
        instances[url.searchParams.get('app_id') ?? ''],
        origin,
      );
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
    if (path === '/story') {
      sendList(
        res,
        control.failStories,
        control.data.stories[url.searchParams.get('story_group_id') ?? ''],
        origin,
      );
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
