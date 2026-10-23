// The Web SDK's size budget (NFR-006; epic Tale Studio R15, AD-16), shared by `web-sdk:size`
// (check-size.mjs) and `sdk-sample:perf`.
//
// - The SDK's ES chunks together stay at or under 50 KB gzipped.
// - The chunk a host page loads first (`index.js`) stays at or under 40 KB gzipped. Once the SDK
//   passes 40 KB, the viewer and the document renderers move to a chunk loaded on the viewer's first
//   open (AD-16); until then everything is in `index.js`, and the check reports what that split
//   would move, from the module report the build writes (`dist/libs/web-sdk-modules.json`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const BUNDLE_LIMIT_BYTES = 50 * 1024;
export const SPLIT_AT_BYTES = 40 * 1024;
export const ENTRY_CHUNK = 'index.js';
/** The build's module report, next to the package folder (see vite.config.mts). */
export const MODULE_REPORT = 'web-sdk-modules.json';

// The modules that move to the viewer chunk: the viewer, the document renderers, and the contract
// modules only they use (the document rules, the project font loader, text styles).
export const VIEWER_MODULES = [
  /(^|\/)libs\/web-sdk\/src\/lib\/viewer\.ts$/,
  /(^|\/)libs\/web-sdk\/src\/lib\/document\//,
  /(^|\/)libs\/contract\/src\/lib\/(tale-document|project-fonts|text-style)\.ts$/,
];

export const gzipped = (data) => gzipSync(data, { level: 9 }).length;
export const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

/**
 * The SDK's ES chunks in `dir` (every `.js` file; the UMD build is `.cjs`), the entry first, each
 * with its gzipped size and, when the build wrote its module report, its modules.
 */
export function readChunks(dir) {
  const reportFile = join(dirname(dir), MODULE_REPORT);
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')).chunks : {};
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => (a === ENTRY_CHUNK ? -1 : b === ENTRY_CHUNK ? 1 : a.localeCompare(b)));
  return files.map((name) => {
    const code = readFileSync(join(dir, name), 'utf8');
    return { name, gzipped: gzipped(code), modules: report[name] ?? null };
  });
}

/** What the AD-16 split would move out of a chunk's `modules` ({ id, code }[]): each side, gzipped on its own. */
export function splitEstimate(modules) {
  const viewer = modules.filter((m) => VIEWER_MODULES.some((p) => p.test(m.id)));
  const rest = modules.filter((m) => !viewer.includes(m));
  const size = (list) => gzipped(list.map((m) => m.code).join('\n'));
  return {
    viewer: { modules: viewer.map((m) => m.id), gzipped: size(viewer) },
    first: { modules: rest.map((m) => m.id), gzipped: size(rest) },
  };
}

/**
 * Judges `chunks` (from `readChunks`) against the budget: the lines to print, the failures and the
 * total gzipped size. One chunk is the unsplit SDK: over 40 KB it fails, asking for the split.
 * Several chunks are the split SDK: the entry must stay at or under 40 KB. Either way, all the
 * chunks together at most 50 KB.
 */
export function judge(chunks) {
  const lines = [];
  const failures = [];
  const entry = chunks.find((c) => c.name === ENTRY_CHUNK);
  if (!entry) return { lines, failures: [`no ${ENTRY_CHUNK} among the chunks`], total: 0 };
  const total = chunks.reduce((sum, c) => sum + c.gzipped, 0);
  for (const c of chunks) {
    lines.push(`  ${c.name}: ${kb(c.gzipped)} gzipped (${c === entry ? 'loaded by the page' : 'loaded on first open'})`);
  }
  lines.push(`  all chunks: ${kb(total)} gzipped (budget ${kb(BUNDLE_LIMIT_BYTES)})`);
  if (chunks.length === 1) {
    if (entry.modules) {
      const split = splitEstimate(entry.modules);
      lines.push(
        `  one chunk (splits past ${kb(SPLIT_AT_BYTES)}): the split would move the viewer and renderers, ` +
          `~${kb(split.viewer.gzipped)} in ${split.viewer.modules.length} modules, to a chunk loaded on first open, ` +
          `leaving ~${kb(split.first.gzipped)} in ${ENTRY_CHUNK}`,
      );
    } else {
      lines.push(`  one chunk (splits past ${kb(SPLIT_AT_BYTES)}); no module report, so no split estimate`);
    }
  }
  if (total > BUNDLE_LIMIT_BYTES) failures.push(`the SDK is ${kb(total)} gzipped, over the ${kb(BUNDLE_LIMIT_BYTES)} budget`);
  if (entry.gzipped > SPLIT_AT_BYTES) {
    failures.push(
      chunks.length === 1
        ? `the SDK is ${kb(entry.gzipped)} gzipped, past ${kb(SPLIT_AT_BYTES)}: move the viewer and renderers to a chunk loaded on first open (AD-16)`
        : `${ENTRY_CHUNK} is ${kb(entry.gzipped)} gzipped, over ${kb(SPLIT_AT_BYTES)} even with the viewer in its own chunk`,
    );
  }
  return { lines, failures, total };
}
