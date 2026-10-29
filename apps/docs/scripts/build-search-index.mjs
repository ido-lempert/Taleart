// Builds the docs' search index, `search-index.json`, before the Angular build (the docs' `build-search-index`
// target, a dependency of `build`). The build copies the file into the site (an asset of the docs' build).
//
// Source: the page templates. The page list (path, title, group, file) is read from DOCS_PAGES in
// app.routes.ts, and each page's inline `template` strings from apps/docs/src/app/pages/<file>.ts. The prerendered
// HTML is not used: the prerender runs inside the build, after this index has to exist, so the index is
// built from the same templates the prerender renders. Angular interpolations ({{ ... }}) and control-flow
// headers (@if (...) {) are dropped, so text bound to a value is not searchable; the headings and prose are.
//
// Sections: each h2 or h3 with an id starts a section (its anchor is the id); the text before the first one is
// the page's intro (anchor ''). Text inside the page's <svg>, <script> and <style> is skipped.
//
// Output (fields shortened to keep the file small; `v` is the format version):
//   { v: 1, pages: [{ p: route path ('' for the home page), t: title, g: group }],
//     s: [{ i: index into pages, a: anchor, h: heading, x: body text }] }
// The body text is the whole section (about 125 KB for the docs, under MAX_BYTES); the search shows a snippet of it.
//
// Usage: node apps/docs/scripts/build-search-index.mjs [output file]  (default dist/apps/docs-search/search-index.json)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, '../src/app');
const MAX_BYTES = 300 * 1024;

const BLOCK_TAGS = new Set([
  'p',
  'li',
  'div',
  'section',
  'aside',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'tr',
  'td',
  'th',
  'dt',
  'dd',
  'dl',
  'ul',
  'ol',
  'table',
  'figure',
  'figcaption',
  'blockquote',
  'details',
  'summary',
  'br',
  'hr',
]);

/** The docs pages in navigation order, from DOCS_PAGES in app.routes.ts. */
export function readPages(routesSource) {
  const start = routesSource.indexOf('export const DOCS_PAGES');
  const end = routesSource.indexOf('\n];', start);
  if (start < 0 || end < 0) throw new Error('DOCS_PAGES not found in app.routes.ts');
  const block = routesSource.slice(start, end);
  const entries = [
    ...block.matchAll(
      /path:\s*'([^']*)',\s*label:\s*'[^']*',\s*title:\s*'([^']*)',\s*group:\s*'([^']*)',\s*file:\s*'([^']*)'/g,
    ),
  ].map((m) => ({ path: m[1], title: m[2], group: m[3], file: m[4] }));
  const declared = (block.match(/\n\s+path:\s*'/g) ?? []).length;
  if (entries.length === 0 || entries.length !== declared) {
    throw new Error(
      `DOCS_PAGES: read ${entries.length} of ${declared} entries; the regex in build-search-index.mjs needs an update`,
    );
  }
  return entries;
}

/** The inline templates of a page file (every `template: \`...\``), with the JavaScript interpolations resolved away. */
export function templatesOf(source) {
  return [...source.matchAll(/template:\s*`([\s\S]*?)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ' '));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–' };

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
}

const clean = (text) => text.replace(/\s+/g, ' ').trim();

/** Splits one page's template markup into sections (the intro first), each with its heading and body text. */
export function sectionsOf(markup) {
  const html = markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/@(?:if|else if|else|for|switch|case|default|empty|defer|placeholder|loading|error)\b[^{]*\{/g, ' ');
  const sections = [{ anchor: '', heading: '', body: '' }];
  let current = sections[0];
  // The text of the open h2/h3 that starts a section (its heading), or null outside a heading.
  let heading = null;
  for (const token of html.matchAll(/<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
    const t = token[0];
    if (!t.startsWith('<')) {
      if (heading) heading.text += decode(t);
      else current.body += decode(t);
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][\w-]*)([^>]*)>$/.exec(t);
    if (!m) continue;
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const isHeading = name === 'h2' || name === 'h3';
    if (BLOCK_TAGS.has(name) || name === 'img') {
      if (heading) heading.text += ' ';
      else current.body += ' ';
    }
    if (isHeading && !closing && /\sid="[^"]+"/.test(m[3])) {
      current = { anchor: /\sid="([^"]+)"/.exec(m[3])[1], heading: '', body: '' };
      sections.push(current);
      heading = { text: '', section: current };
    } else if (isHeading && closing && heading) {
      heading.section.heading = clean(heading.text);
      heading = null;
    }
  }
  return sections.map((s) => ({ ...s, body: clean(s.body) }));
}

/** Builds the index object from the routes' source and the templates, each read by a callback. */
export function buildIndex(routesSource, readPage) {
  const pages = readPages(routesSource);
  const out = { v: 1, pages: [], s: [] };
  for (const page of pages) {
    const i = out.pages.length;
    out.pages.push({ p: page.path, t: page.title, g: page.group });
    const markup = templatesOf(readPage(page.file)).join('\n');
    for (const section of sectionsOf(markup)) {
      const body = section.body;
      // The intro has the page's title as its heading; a section with neither text is dropped.
      const heading = section.heading || (section.anchor === '' ? page.title : '');
      if (!heading && !body) continue;
      out.s.push({ i, a: section.anchor, h: heading, x: body });
    }
  }
  return out;
}

function main() {
  const output = resolve(process.argv[2] ?? 'dist/apps/docs-search/search-index.json');
  const routes = readFileSync(resolve(APP, 'app.routes.ts'), 'utf8');
  const index = buildIndex(routes, (file) => readFileSync(resolve(APP, 'pages', `${file}.ts`), 'utf8'));
  const json = JSON.stringify(index);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    throw new Error(`search-index.json is ${Buffer.byteLength(json)} bytes; the limit is ${MAX_BYTES}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, json);
  console.log(
    `Search index: ${index.pages.length} pages, ${index.s.length} sections, ${Buffer.byteLength(json)} bytes -> ${output}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
