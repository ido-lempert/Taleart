import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildIndex, readPages, sectionsOf, templatesOf } from '../../scripts/build-search-index.mjs';
import { DOCS_PAGES } from './app.routes';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const APP = join(workspaceRoot(), 'apps/docs/src/app');
const routes = readFileSync(join(APP, 'app.routes.ts'), 'utf8');
const readPage = (file: string) => readFileSync(join(APP, 'pages', `${file}.ts`), 'utf8');

describe('search index: parsing a page', () => {
  it('reads the template strings of a component and drops Angular and JavaScript expressions', () => {
    const source =
      '@Component({ template: `<p>Hello {{ name }}</p>` }) class A {}\n@Component({ template: `<p>${X} world</p>` }) class B {}';
    expect(templatesOf(source).map((t) => t.replace(/\s+/g, ' ').trim())).toEqual([
      '<p>Hello {{ name }}</p>',
      '<p> world</p>',
    ]);
  });

  it('splits the markup into the intro and one section per h2 or h3 with an id', () => {
    const markup = `
      <p class="lede">Intro words.</p>
      <h2 id="first">First <em>part</em></h2>
      <p>Body one.</p>
      <h3>No id, so it stays in the body</h3>
      <p>Body two &amp; more.</p>
      <h3 id="second">Second</h3>
      <ol class="steps"><li><h3 id="step-a">Step &lt;a&gt;</h3> Step text.</li></ol>
      <script>var hidden = 1;</script>
      <svg><text>not text</text></svg>
      <p>{{ bound }} visible</p>`;
    const sections = sectionsOf(markup);
    expect(sections.map((s) => [s.anchor, s.heading])).toEqual([
      ['', ''],
      ['first', 'First part'],
      ['second', 'Second'],
      ['step-a', 'Step <a>'],
    ]);
    expect(sections[0].body).toBe('Intro words.');
    expect(sections[1].body).toBe('Body one. No id, so it stays in the body Body two & more.');
    expect(sections[2].body).toBe('');
    expect(sections[3].body).toBe('Step text. visible');
    expect(JSON.stringify(sections)).not.toContain('hidden');
    expect(JSON.stringify(sections)).not.toContain('not text');
  });
});

describe('search index: the pages', () => {
  const fixtureRoutes = `
export const DOCS_GROUPS = ['Introduction', 'Reference'] as const;
export const DOCS_PAGES: ReadonlyArray<{ path: string; label: string; title: string; group: (typeof DOCS_GROUPS)[number]; file: string }> = [
  {
    path: '',
    label: 'Start',
    title: 'Getting started',
    group: 'Introduction',
    file: 'start',
  },
  {
    path: 'reference/x',
    label: 'X',
    title: 'X reference',
    group: 'Reference',
    file: 'x',
  },
];
export const RETIRED_PAGES = [{ from: 'old', to: 'start' }];`;
  const templates: Record<string, string> = {
    start:
      '@Component({ template: `<h1>Getting started</h1><p>Install TaleArt.</p><h2 id="zones">Zones</h2><p>A zone is a spot.</p>` })',
    x: '@Component({ template: `<p>Intro.</p><h3 id="api">The API</h3><p>Tokens.</p>` })',
  };

  it('reads every page of DOCS_PAGES, in order', () => {
    expect(readPages(fixtureRoutes)).toEqual([
      { path: '', title: 'Getting started', group: 'Introduction', file: 'start' },
      { path: 'reference/x', title: 'X reference', group: 'Reference', file: 'x' },
    ]);
  });

  it('builds the index: pages with their route, title and group; sections with their anchor and heading', () => {
    const index = buildIndex(fixtureRoutes, (file) => templates[file]);
    expect(index.v).toBe(1);
    expect(index.pages).toEqual([
      { p: '', t: 'Getting started', g: 'Introduction' },
      { p: 'reference/x', t: 'X reference', g: 'Reference' },
    ]);
    expect(index.s).toEqual([
      { i: 0, a: '', h: 'Getting started', x: 'Getting started Install TaleArt.' },
      { i: 0, a: 'zones', h: 'Zones', x: 'A zone is a spot.' },
      { i: 1, a: '', h: 'X reference', x: 'Intro.' },
      { i: 1, a: 'api', h: 'The API', x: 'Tokens.' },
    ]);
  });

  it('indexes every docs page of the app, and the real index stays small', () => {
    const index = buildIndex(routes, readPage);
    expect(index.pages.map((page) => page.p)).toEqual(DOCS_PAGES.map((page) => page.path));
    expect(index.pages.map((page) => page.t)).toEqual(DOCS_PAGES.map((page) => page.title));
    expect(index.s.length).toBeGreaterThan(100);
    expect(Buffer.byteLength(JSON.stringify(index))).toBeLessThan(300 * 1024);
    // Every section points at a page of the index, and every page has its own intro.
    expect(index.s.every((section) => section.i >= 0 && section.i < index.pages.length)).toBe(true);
    for (let i = 0; i < index.pages.length; i++) {
      expect(index.s.some((section) => section.i === i && section.a === '')).toBe(true);
    }
  });
});
