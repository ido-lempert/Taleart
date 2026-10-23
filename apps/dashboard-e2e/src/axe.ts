import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import type { Page } from '@playwright/test';

// axe-core is not a workspace dependency. It is read from node_modules when a package brings it;
// otherwise the build pinned by the sample page's scans (apps/sdk-sample/a11y-shared.mjs) is used
// from a local copy under dist/.cache, fetched once and checked against its SHA-384 on every read.
const AXE_VERSION = '4.10.2';
const AXE_URL = `https://cdnjs.cloudflare.com/ajax/libs/axe-core/${AXE_VERSION}/axe.min.js`;
const AXE_SHA384 = '3NYxCdpLKVHfNs2FHPtg3qqaYuhq85m4mMnlHBlN0JzSpKYKct2PMGYfsKGaKIj4';
const AXE_CACHE = join(workspaceRoot, 'dist/.cache/axe-core', `axe-${AXE_VERSION}.min.js`);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

let source: Promise<string> | null = null;

function pinned(bytes: Buffer): boolean {
  return createHash('sha384').update(bytes).digest('base64') === AXE_SHA384;
}

function fromNodeModules(): string | null {
  try {
    return readFileSync(createRequire(join(workspaceRoot, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

function loadAxe(): Promise<string> {
  source ??= (async () => {
    const local = fromNodeModules();
    if (local) return local;
    if (existsSync(AXE_CACHE)) {
      const cached = readFileSync(AXE_CACHE);
      if (pinned(cached)) return cached.toString('utf8');
    }
    const res = await fetch(AXE_URL);
    if (!res.ok) throw new Error(`Could not fetch axe-core: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!pinned(bytes)) throw new Error(`axe-core at ${AXE_URL} does not match its pinned SHA-384`);
    mkdirSync(dirname(AXE_CACHE), { recursive: true });
    writeFileSync(AXE_CACHE, bytes);
    return bytes.toString('utf8');
  })();
  return source;
}

/**
 * The WCAG 2.2 AA violations axe finds on the page, as "rule: targets" lines. axe goes in through
 * the DevTools protocol, so the test page's CSP (scripts from its own origin only) does not stop it.
 */
export async function axeViolations(page: Page): Promise<string[]> {
  const axe = await loadAxe();
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axe);
  const violations = await page.evaluate(async (tags) => {
    type Axe = {
      run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
    };
    const result = await (window as unknown as { axe: Axe }).axe.run(document, {
      runOnly: { type: 'tag', values: tags },
    });
    return result.violations
      .map((v) => ({
        id: v.id,
        // Tale Studio's canvas layers (story 7.15): where they sit and how big they are is the tale's
        // content, and layers overlap by design. 2.5.8's "equivalent" exception covers them: each has
        // its row in the layers grid (a 24 px target or more), which selects it, and its fields.
        nodes: v.id === 'target-size' ? v.nodes.filter((n) => !/^#studio-el-/.test(n.target.join(' '))) : v.nodes,
      }))
      .filter((v) => v.nodes.length > 0)
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, AXE_TAGS);
  return violations;
}
