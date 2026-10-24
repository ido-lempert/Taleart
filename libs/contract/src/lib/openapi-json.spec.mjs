// Epic developer experience 10.2: the JSON the API serves at /api/openapi.json and the docs' API
// reference loads is openapi.yaml as generated, and every operation sits in exactly one declared tag.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPENAPI_JSON, OPENAPI_YAML, openapiJson } from '../../scripts/generate-openapi-json.mjs';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const document = JSON.parse(readFileSync(OPENAPI_JSON, 'utf8'));

function operations(doc) {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method]).map((method) => ({ path, method, operation: item[method] })),
  );
}

describe('the generated OpenAPI JSON', () => {
  it('is openapi.yaml as generated (run contract:generate after a change)', async () => {
    expect(readFileSync(OPENAPI_JSON, 'utf8')).toBe(await openapiJson(OPENAPI_YAML));
  });

  it('holds every schema itself: no reference to another file, and every reference resolves', () => {
    const refs = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]*)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => !ref.startsWith('#/'))).toEqual([]);
    const unresolved = [...new Set(refs)].filter((ref) => {
      let node = document;
      for (const part of ref.slice(2).split('/')) {
        const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
        if (node === null || typeof node !== 'object' || !(key in node)) return true;
        node = node[key];
      }
      return false;
    });
    expect(unresolved).toEqual([]);
  });

  it('puts every operation in exactly one declared tag, and uses every declared tag', () => {
    const declared = document.tags.map((tag) => tag.name);
    expect(new Set(declared).size).toBe(declared.length);
    const untagged = operations(document)
      .filter(({ operation }) => operation.tags?.length !== 1 || !declared.includes(operation.tags[0]))
      .map(({ path, method }) => `${method.toUpperCase()} ${path}`);
    expect(untagged).toEqual([]);
    const used = new Set(operations(document).map(({ operation }) => operation.tags[0]));
    expect(declared.filter((name) => !used.has(name))).toEqual([]);
  });

  it('keeps internal references (epics, stories, architecture decisions) out of the public text', () => {
    const internal = /\b(?:[Ee]pic\b|AD-\d+|NFR-\d+|R\d+\b|[Ss]tory \d)/;
    const found = [];
    (function walk(node, at) {
      if (typeof node === 'string') {
        if (internal.test(node)) found.push(`${at}: ${node.match(internal)[0]}`);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, `${at}/${key}`);
      }
    })(document, '#');
    expect(found).toEqual([]);
  });

  it('is an entry point of the package, with its types', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'));
    const entry = pkg.exports['./openapi.json'];
    expect(entry).toEqual({ types: './src/openapi-json.d.ts', default: './src/generated/openapi.json' });
    for (const file of Object.values(entry)) expect(existsSync(join(import.meta.dirname, '../..', file))).toBe(true);
  });

  it('describes its own route, with no credentials', () => {
    const route = document.paths['/openapi.json'];
    expect(route.servers).toEqual([{ url: '/api', description: expect.any(String) }]);
    expect(route.get.security).toEqual([]);
  });
});
