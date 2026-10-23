// The size check behind `web-sdk:size` (scripts/size-budget.mjs; epic Tale Studio R15, AD-16).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_LIMIT_BYTES, judge, MODULE_REPORT, readChunks, SPLIT_AT_BYTES, splitEstimate } from '../scripts/size-budget.mjs';

const chunk = (name, kb, modules = null) => ({ name, gzipped: Math.round(kb * 1024), modules });

describe('the Web SDK size check', () => {
  it('passes one chunk at or under 40 KB, and reports what the split would move', () => {
    const modules = [
      { id: 'libs/web-sdk/src/lib/viewer.ts', code: 'export const viewer = 1;' },
      { id: 'libs/web-sdk/src/lib/document/renderer.ts', code: 'export const renderer = 1;' },
      { id: 'libs/contract/src/lib/project-fonts.ts', code: 'export const fonts = 1;' },
      { id: 'libs/web-sdk/src/lib/bar.ts', code: 'export const bar = 1;' },
    ];
    const { failures, lines } = judge([chunk('index.js', 40, modules)]);
    expect(failures).toEqual([]);
    expect(lines.join('\n')).toMatch(/index\.js: 40\.00 KB gzipped \(loaded by the page\)/);
    expect(lines.join('\n')).toMatch(/would move the viewer and renderers, at least [\d.]+ KB in 3 modules/);
  });

  it('fails one chunk past 40 KB, asking for the viewer chunk (AD-16)', () => {
    const { failures } = judge([chunk('index.js', 40.01)]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/move the viewer and renderers to a chunk loaded on first open/);
  });

  it('reports both chunks once split, and fails only when the entry passes 40 KB or all pass 50 KB', () => {
    const split = judge([chunk('index.js', 30), chunk('viewer-abc.js', 19)]);
    expect(split.failures).toEqual([]);
    expect(split.lines).toEqual([
      '  index.js: 30.00 KB gzipped (loaded by the page)',
      '  viewer-abc.js: 19.00 KB gzipped (loaded on first open)',
      '  all chunks: 49.00 KB gzipped (budget 50.00 KB)',
    ]);
    expect(judge([chunk('index.js', 41), chunk('viewer-abc.js', 5)]).failures[0]).toMatch(/even with the viewer in its own chunk/);
    expect(judge([chunk('index.js', 30), chunk('viewer-abc.js', 21)]).failures[0]).toMatch(/over the 50\.00 KB budget/);
  });

  it('has the starting limits of the epic', () => {
    expect(BUNDLE_LIMIT_BYTES).toBe(50 * 1024);
    expect(SPLIT_AT_BYTES).toBe(40 * 1024);
  });

  it('splits by module: the viewer, the document renderers and their contract modules move', () => {
    const { viewer, first } = splitEstimate([
      { id: 'libs/web-sdk/src/lib/viewer.ts', code: 'a' },
      { id: 'libs/web-sdk/src/lib/document/text.ts', code: 'b' },
      { id: 'libs/contract/src/lib/tale-document.ts', code: 'c' },
      { id: 'libs/contract/src/lib/text-style.ts', code: 'd' },
      { id: 'libs/web-sdk/src/lib/banner.ts', code: 'e' },
      { id: 'libs/web-sdk/src/lib/taleart-element.ts', code: 'f' },
    ]);
    expect(viewer.modules).toHaveLength(4);
    expect(first.modules).toEqual(['libs/web-sdk/src/lib/banner.ts', 'libs/web-sdk/src/lib/taleart-element.ts']);
  });

  describe('reading a build', () => {
    let root;
    afterEach(() => root && rmSync(root, { recursive: true, force: true }));

    it('reads every ES chunk, the entry first, ignoring the UMD build, with the module report', () => {
      root = mkdtempSync(join(tmpdir(), 'taleart-size-'));
      const dir = join(root, 'web-sdk');
      mkdirSync(dir);
      writeFileSync(join(dir, 'a-viewer.js'), 'x'.repeat(1000));
      writeFileSync(join(dir, 'index.js'), randomBytes(2048).toString('hex'));
      writeFileSync(join(dir, 'index.umd.cjs'), 'umd');
      writeFileSync(join(root, MODULE_REPORT), JSON.stringify({ chunks: { 'index.js': [{ id: 'm', code: '' }] } }));
      const chunks = readChunks(dir);
      expect(chunks.map((c) => c.name)).toEqual(['index.js', 'a-viewer.js']);
      expect(chunks[0].gzipped).toBeGreaterThan(chunks[1].gzipped);
      // Judged on the larger of gzip level 9 and level 6.
      expect(chunks[0].gzipped).toBe(Math.max(chunks[0].level9, chunks[0].level6));
      expect(judge(chunks).lines[0]).toMatch(/level 9 [\d.]+ KB, level 6 [\d.]+ KB/);
      expect(chunks[0].modules).toEqual([{ id: 'm', code: '' }]);
      expect(chunks[1].modules).toBeNull();
    });
  });
});
