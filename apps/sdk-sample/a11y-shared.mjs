// Helpers shared by the sample page's accessibility scripts (a11y-scan.mjs, a11y-review.mjs): a free
// port, the sample server, a pinned axe-core build and one axe run over a page.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const AXE_SHA384 = '3NYxCdpLKVHfNs2FHPtg3qqaYuhq85m4mMnlHBlN0JzSpKYKct2PMGYfsKGaKIj4';
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** A free TCP port on this machine. */
export async function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/**
 * axe-core's source. It is not a workspace dependency yet: a pinned build is fetched from cdnjs and
 * checked against its SHA-384 before it is injected.
 */
export async function loadAxe() {
  const res = await fetch(AXE_URL);
  if (!res.ok) throw new Error(`Could not fetch axe-core: ${res.status}`);
  const source = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha384').update(source).digest('base64');
  if (hash !== AXE_SHA384) throw new Error(`axe-core at ${AXE_URL} does not match its pinned SHA-384`);
  return source.toString('utf8');
}

/** Starts the sample server (serve.mjs) on `port`; resolves with its child process once it listens. */
export async function startSample(port) {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'serve.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((done, fail) => {
    child.once('exit', (code) => fail(new Error(`sample server exited with ${code}`)));
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('SDK sample at')) done();
    });
  });
  return child;
}

/** Runs axe over the whole page with the WCAG 2.2 AA tags; logs and returns the violations. */
export async function axeViolations(page, label, axe) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ content: axe });
  const result = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
    AXE_TAGS,
  );
  for (const v of result.violations) {
    console.error(`[${label}] ${v.id} (${v.impact}): ${v.help}`);
    for (const node of v.nodes) console.error(`    ${node.target.join(' ')} — ${node.failureSummary}`);
  }
  console.log(`[${label}] ${result.violations.length} violations, ${result.passes.length} rules passed`);
  return result.violations;
}

/**
 * A tale as the Delivery API sends it since Tale Studio R16: its media (`{ kind, url, … }`) is the
 * `taleMedia` element at the bottom of its document (full canvas, contained, decorative; 5 s unless
 * the document sets a duration), `document` being a studio document over it, if any. `media` stays
 * for SDKs from before documents.
 */
export function mediaTale(id, title, media, document = null) {
  const own = {
    id: `00000000-0000-4000-8000-${Buffer.from(String(id)).toString('hex').padStart(12, '0').slice(-12)}`,
    type: media.kind,
    box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
    a11y: { decorative: true },
    props: { url: media.url, fit: 'contain', taleMedia: true },
  };
  const base = document ?? { version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [] };
  return { id, title, media, document: { durationMs: 5000, ...base, elements: [own, ...base.elements] } };
}
