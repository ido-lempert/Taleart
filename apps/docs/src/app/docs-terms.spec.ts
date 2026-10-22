import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { installSnippet, SDK_BUNDLE_PATH } from '@taleart/contract/core';
import { DOCS_SNIPPET } from './docs-content';

// Epic UX rework R17: the docs, the Web SDK README and the dashboard's help text use site key plus
// zone, and never tell anyone to create a stage, apply a playbook or use a zone key (removed in 8.7,
// owner decision 2026-10-22). Text between `docs-check:removed` and `/docs-check:removed` is a section
// that says what was removed, and is the only place the old words may appear.

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const root = workspaceRoot();

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

/** The text a reader sees, without the sections marked as removed. */
function withoutRemovedSections(text: string): string {
  return text.replace(/(?<!\/)docs-check:removed[\s\S]*?\/docs-check:removed/g, '');
}

const README = join(root, 'libs/web-sdk/README.md');
const docsSources = [...files(join(root, 'apps/docs/src'), /\.(ts|html)$/), README];
const dashboardTemplates = files(join(root, 'apps/dashboard/src/app'), /\.html$/);

const RETIRED: ReadonlyArray<[string, RegExp]> = [
  ['creating a stage', /\b(creat\w*|add\w*|new)\s+(an?\s+|the\s+)?stages?\b/i],
  ['the stage attribute', /\bstage="/i],
  ['applying a playbook', /\bappl\w*\s+(an?\s+|the\s+)?playbooks?\b/i],
  ['the Playbook card', /\bplaybook card\b/i],
  ['the zone-key attribute', /zone-key/i],
  ['the zoneKey property', /zoneKey/],
  ['a zone key value', /tak_/],
  ['issuing or using a zone key', /\b(issu|rotat|us|creat|add|copy|copi|past)\w*\s+(an?\s+|the\s+|its\s+|your\s+)?zone keys?\b/i],
];

function offenders(paths: readonly string[], pattern: RegExp): string[] {
  return paths
    .filter((path) => pattern.test(withoutRemovedSections(readFileSync(path, 'utf8'))))
    .map((path) => relative(root, path));
}

describe('docs terms (epic UX rework R17)', () => {
  it('finds the docs pages, the README and the dashboard templates', () => {
    expect(docsSources.map((path) => relative(root, path))).toEqual(
      expect.arrayContaining([
        'apps/docs/src/app/pages/install.ts',
        'apps/docs/src/app/pages/moving.ts',
        'libs/web-sdk/README.md',
      ]),
    );
    expect(dashboardTemplates.map((path) => relative(root, path))).toContain('apps/dashboard/src/app/pages/zone-detail.html');
  });

  it.each(RETIRED)('never mentions %s outside a removed section', (_name, pattern) => {
    expect(offenders([...docsSources, ...dashboardTemplates], pattern)).toEqual([]);
  });

  it('keeps the removed sections where the move is explained', () => {
    const moving = readFileSync(join(root, 'apps/docs/src/app/pages/moving.ts'), 'utf8');
    const readme = readFileSync(README, 'utf8');
    expect(moving).toContain('docs-check:removed');
    expect(withoutRemovedSections(moving)).not.toMatch(/zone-key/);
    expect(moving).toMatch(/zone-key/);
    expect(readme).toMatch(/<!-- docs-check:removed -->[\s\S]*removed[\s\S]*<!-- \/docs-check:removed -->/);
  });

  it('names no other vendor in the docs or the README (AD-12)', () => {
    expect(offenders(docsSources, /another tool/i)).toEqual([]);
  });

  it('a section marker without its end hides nothing', () => {
    expect(withoutRemovedSections('a docs-check:removed zone-key')).toContain('zone-key');
    expect(withoutRemovedSections('a <!-- docs-check:removed --> zone-key <!-- /docs-check:removed --> b')).toBe(
      'a <!--  --> b',
    );
  });
});

describe('the docs snippet', () => {
  const api = 'https://api.example.com';

  it('is what the Install tab builds for the example zone', () => {
    expect(DOCS_SNIPPET).toBe(installSnippet({ apiUrl: api, sdkUrl: api + SDK_BUNDLE_PATH }, 'home-top', null));
    expect(DOCS_SNIPPET).toBe(
      '<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>\n' +
        '<taleart-view api-url="https://api.example.com" site-key="YOUR_SITE_KEY" zone="home-top"></taleart-view>',
    );
  });

  it('appears in the Web SDK README as is', () => {
    expect(readFileSync(README, 'utf8')).toContain(DOCS_SNIPPET);
  });
});
