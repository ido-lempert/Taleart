import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';

// axe-core is not a workspace dependency: the build pinned by the sample page's scans
// (apps/sdk-sample/a11y-shared.mjs) is fetched and checked against its SHA-384.
const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const AXE_SHA384 = '3NYxCdpLKVHfNs2FHPtg3qqaYuhq85m4mMnlHBlN0JzSpKYKct2PMGYfsKGaKIj4';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

let source: Promise<string> | null = null;

function loadAxe(): Promise<string> {
  source ??= (async () => {
    const res = await fetch(AXE_URL);
    if (!res.ok) throw new Error(`Could not fetch axe-core: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (createHash('sha384').update(bytes).digest('base64') !== AXE_SHA384) {
      throw new Error(`axe-core at ${AXE_URL} does not match its pinned SHA-384`);
    }
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
    type Axe = { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
    const result = await (window as unknown as { axe: Axe }).axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, AXE_TAGS);
  return violations;
}
