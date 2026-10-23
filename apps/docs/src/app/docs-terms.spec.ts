import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  DEFAULT_SDK_BUILDS_KEPT,
  installSnippet,
  pinnedSdkScriptTag,
  SDK_BUNDLE_PATH,
  SDK_CACHE_SECONDS,
  SDK_PINNED_CACHE_SECONDS,
  sdkScriptTag,
  zoneElement,
} from '@taleart/contract/core';
import {
  DOCS_PINNED_SCRIPT,
  DOCS_SNIPPET,
  DOCS_THEME_SCRIPT,
  DOCS_TWO_ZONES_SNIPPET,
  EXAMPLE_INSTALL,
  FOLD_EXAMPLES,
  SDK_CACHE_TEXT,
  SDK_PINNED_CACHE_TEXT,
} from './docs-content';

// Epic UX rework R17: the docs, the Web SDK README and the dashboard's text use site key plus zone,
// and never tell anyone to create a stage, apply a playbook or use a zone key (removed in 8.7, owner
// decision 2026-10-22). Text between `docs-check:removed` and `/docs-check:removed` says what was
// removed; such sections are allowed only on the docs' "Stages and zone keys" page and in the README.

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
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) && !/\.spec(-d)?\.ts$/.test(name) ? [path] : [];
  });
}

const README = 'libs/web-sdk/README.md';
const MOVING_PAGE = 'apps/docs/src/app/pages/moving.ts';
/** The only files that may hold a section marked as removed. */
const MAY_MARK_REMOVED = [README, MOVING_PAGE];

const docsSources = [...files(join(root, 'apps/docs/src'), /\.(ts|html)$/), join(root, README)].map((p) =>
  relative(root, p),
);
const dashboardSources = files(join(root, 'apps/dashboard/src/app'), /\.(ts|html)$/).map((p) => relative(root, p));

const MARKER = /(?<!\/)docs-check:removed/;

/** What a reader sees: the removed sections cut (only where allowed), markup between words dropped. */
function readable(path: string): string {
  let text = read(path);
  if (MAY_MARK_REMOVED.includes(path)) text = text.replace(/(?<!\/)docs-check:removed[\s\S]*?\/docs-check:removed/g, '');
  return text.replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ');
}

const RETIRED: ReadonlyArray<[string, RegExp]> = [
  ['creating a stage', /\b(creat\w*|add\w*|new)\s+(an?\s+|the\s+)?stages?\b/i],
  ['the stage attribute', /\bstage\s*=/i],
  ['playbooks', /\bplaybooks?\b/i],
  ['the zone-key attribute', /zone-key/i],
  ['the zoneKey property', /zoneKey/],
  ['a zone key value', /tak_/],
  ['issuing or using a zone key', /\b(issu|rotat|us|creat|add|copy|copi|past)\w*\s+(an?\s+|the\s+|its\s+|your\s+)?zone keys?\b/i],
];

const offenders = (paths: readonly string[], pattern: RegExp) => paths.filter((path) => pattern.test(readable(path)));

describe('docs terms (epic UX rework R17)', () => {
  it('finds the docs pages, the README and the dashboard sources', () => {
    expect(docsSources).toEqual(expect.arrayContaining(['apps/docs/src/app/pages/install.ts', MOVING_PAGE, README]));
    expect(dashboardSources).toEqual(
      expect.arrayContaining(['apps/dashboard/src/app/pages/zone-detail.html', 'apps/dashboard/src/app/pages/site-key-card.ts']),
    );
  });

  it.each(RETIRED)('never mentions %s outside a removed section', (_name, pattern) => {
    expect(offenders([...docsSources, ...dashboardSources], pattern)).toEqual([]);
  });

  it('marks removed sections only on the Stages and zone keys page and in the README', () => {
    const marked = [...docsSources, ...dashboardSources].filter((path) => MARKER.test(read(path)));
    expect(marked.sort()).toEqual([...MAY_MARK_REMOVED].sort());
  });

  it('keeps the removed sections where the move is explained', () => {
    expect(read(MOVING_PAGE)).toMatch(/zone-key/);
    expect(readable(MOVING_PAGE)).not.toMatch(/zone-key/);
    expect(read(README)).toMatch(/<!-- docs-check:removed -->[\s\S]*removed[\s\S]*<!-- \/docs-check:removed -->/);
  });

  it('reads past markup between words', () => {
    const probe = 'Create a <em>stage</em> and apply the <strong>playbook</strong>.';
    expect(probe.replace(/<\/?[a-z][^>]*>/gi, '')).toMatch(RETIRED[0][1]);
  });

  it('names no other vendor in the docs or the README (AD-12)', () => {
    expect(offenders(docsSources, /storyly/i)).toEqual([]);
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

  it('places two zones with one script tag', () => {
    expect(DOCS_TWO_ZONES_SNIPPET.split('\n')).toEqual([
      sdkScriptTag(EXAMPLE_INSTALL),
      zoneElement(EXAMPLE_INSTALL, 'home-top', null),
      zoneElement(EXAMPLE_INSTALL, 'home-promo', null),
    ]);
    expect(DOCS_TWO_ZONES_SNIPPET.startsWith(DOCS_SNIPPET)).toBe(true);
  });

  it('imports configureZone from the URL of the script tag', () => {
    const src = /src="([^"]+)"/.exec(DOCS_THEME_SCRIPT)?.[1];
    expect(DOCS_THEME_SCRIPT).toContain(`import { configureZone } from '${src}'`);
  });

  it('appears in the Web SDK README as is', () => {
    expect(read(README)).toContain(DOCS_SNIPPET);
  });
});

describe('the docs facts', () => {
  it('say how long the SDK is cached, from the API constants', () => {
    expect([SDK_CACHE_SECONDS, SDK_CACHE_TEXT]).toEqual([300, 'five minutes']);
    expect([SDK_PINNED_CACHE_SECONDS, SDK_PINNED_CACHE_TEXT]).toEqual([365 * 24 * 3600, 'a year']);
    expect(read(README)).toContain(`cached for ${SDK_CACHE_TEXT}`);
    expect(read(README)).toContain(`cached for ${SDK_PINNED_CACHE_TEXT}`);
  });

  it('say how many builds stay at their pinned URLs, and show the tag the Install tab copies (story 8.21)', () => {
    expect(DEFAULT_SDK_BUILDS_KEPT).toBe(5);
    const readme = read(README).replace(/\s+/g, ' ');
    expect(readme).toContain(`keeps the last ${DEFAULT_SDK_BUILDS_KEPT} builds it served at their pinned URLs`);
    expect(readme).toContain(`through the next ${DEFAULT_SDK_BUILDS_KEPT - 1} releases`);
    expect(readme).toContain(`\`SDK_BUILDS_KEPT\` (default ${DEFAULT_SDK_BUILDS_KEPT}`);
    expect(readme).not.toContain('A pinned URL is gone with the next build');
    const page = read('apps/docs/src/app/pages/install.ts');
    expect(page).toContain('keeps the last {{ buildsKept }} builds it served at their pinned');
    expect(page).toContain('protected readonly buildsKept = DEFAULT_SDK_BUILDS_KEPT;');
    expect(page).not.toContain('is gone with the next build');
    // The docs' example tag is the one the Install tab copies, with a real hash and integrity in place.
    const tag = pinnedSdkScriptTag({
      sdkPinnedUrl: `${EXAMPLE_INSTALL.apiUrl}/sdk/v1/taleart.abcdefghijklmnop.js`,
      sdkIntegrity: 'sha384-…',
    });
    expect(tag).toBe(DOCS_PINNED_SCRIPT.replace('<hash>', 'abcdefghijklmnop'));
  });

  it('give the migration examples the API fold tests expect', () => {
    // apps/api/src/app.spec.ts runs these zones through foldStagesIntoZones (story 8.5).
    const api = read('apps/api/src/app.spec.ts');
    const [home, shop] = FOLD_EXAMPLES;
    expect(api).toContain(`toEqual([${home.after.map((z) => `'${z.slug}'`).join(', ')}])`);
    expect(home.after.map((z) => z.slug)).toEqual(['top', 'hero', 'top-bar-2']);
    for (const zone of shop.after) expect(api).toContain(`['${zone.name}', '${zone.slug}', `);
  });
});
