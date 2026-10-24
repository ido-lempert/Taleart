// Writes the OpenAPI document (openapi/openapi.yaml, the source of truth, AD-3) as one JSON file,
// src/generated/openapi.json, for the API's `GET /api/openapi.json` and the docs' API reference
// (epic developer experience 10.2). Run through `nx run contract:generate`.
//
// The YAML refers to the tale document's JSON Schema files (tale-document/*.json); a browser cannot
// follow those relative files, so they are bundled into `components/schemas` with Redocly's bundler,
// the one openapi-typescript (this target's other step) reads the YAML with, through its own
// dependency. Nothing else changes.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
export const OPENAPI_YAML = join(ROOT, 'openapi/openapi.yaml');
export const OPENAPI_JSON = join(ROOT, 'src/generated/openapi.json');

function redocly() {
  const fromTypescript = createRequire(createRequire(import.meta.url).resolve('openapi-typescript'));
  return fromTypescript('@redocly/openapi-core');
}

/** The document's JSON text, as the generator writes it. */
export async function openapiJson(file = OPENAPI_YAML) {
  const { bundle, createConfig } = redocly();
  const result = await bundle({ ref: file, config: await createConfig({}), dereference: false });
  const problems = result.problems.filter((p) => p.severity === 'error');
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join('\n'));
  return JSON.stringify(result.bundle.parsed, null, 2) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  writeFileSync(OPENAPI_JSON, await openapiJson());
}
