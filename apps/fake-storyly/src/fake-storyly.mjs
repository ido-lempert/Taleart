// A stand-in for the Storyly External API, for tests and reviews of the
// importer. Plain Node, no dependencies. It serves hand-made fixtures shaped
// like the documented responses (import-mapping.md and the research digests);
// it holds no Storyly docs text, real tokens or end-user identifiers. Read only.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

/** The only token the fake accepts, as a bearer token or the `token` query parameter. */
export const FAKE_STORYLY_TOKEN = 'fake-storyly-token';

const fixturesDir = join(import.meta.dirname, 'fixtures');
const readFixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function tokenOf(req, url) {
  const header = req.headers['authorization'] ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : (url.searchParams.get('token') ?? '');
}

// Answers a list as the fixtures hold it, or fails it as `mode` asks:
// 'status' answers 500, 'shape' answers an unexpected shape.
function sendList(res, mode, body) {
  if (mode === 'status') {
    send(res, 500, { message: 'Internal server error' });
    return;
  }
  if (mode === 'shape') {
    send(res, 200, { unexpected: true });
    return;
  }
  send(res, 200, body ?? { data: [] });
}

/**
 * Starts the fake on `port` (0 picks a free one). Resolves to its base URL,
 * the port, `close()`, and `control`:
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
      sendList(res, control.failInstances, instances[url.searchParams.get('app_id') ?? '']);
      return;
    }
    if (path === '/story-group') {
      sendList(res, control.failStoryGroups, control.data.storyGroups[url.searchParams.get('instance_id') ?? '']);
      return;
    }
    if (path === '/story') {
      sendList(res, control.failStories, control.data.stories[url.searchParams.get('story_group_id') ?? '']);
      return;
    }
    send(res, 404, { message: 'Not found' });
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const actualPort = server.address().port;
  return {
    url: `http://${host}:${actualPort}/external`,
    port: actualPort,
    control,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
