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
export const ZONE_SCHEMA_JSON = join(ROOT, 'src/generated/zone.schema.json');

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

// What the SDK needs of zone data, which is less than the API always sends: a hand-written zone may leave the rest out
// (the SDK fills a group's `tags`, `tagMatch` and `audience`, and a missing theme takes the page's look).
const REQUIRED = {
  DeliveryZone: ['frame', 'taleGroups'],
  DeliveryFrame: ['type'],
  DeliveryTaleGroup: ['id', 'name', 'tales'],
  DeliveryTale: ['id', 'title'],
  DeliveryTaleDocument: ['elements'],
  DeliveryMedia: ['url'],
  DeliveryCover: ['url'],
  Theme: [],
};

/**
 * The JSON Schema of zone data (the body of `GET /delivery/v1/zone`, schema `DeliveryZone`), for editors and for
 * validating hand-written data (epic Web SDK without a backend). It is cut from the OpenAPI document: the
 * `DeliveryZone` schema and every schema it reaches, kept under `components/schemas` so the `$ref`s still resolve.
 * Only what the SDK needs stays required (see `REQUIRED`), and `format: uri` and `format: uuid` are dropped: a page may use page-relative or `data:` media URLs and any text as ids.
 */
export function zoneSchemaJson(openapi) {
  const all = openapi.components.schemas;
  const keep = {};
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const ref = value.$ref;
    if (typeof ref === 'string') {
      const name = ref.replace('#/components/schemas/', '');
      if (ref.startsWith('#/components/schemas/') && !(name in keep)) {
        keep[name] = all[name];
        visit(all[name]);
      }
    }
    Object.values(value).forEach(visit);
  };
  keep.DeliveryZone = all.DeliveryZone;
  visit(all.DeliveryZone);
  const plain = JSON.parse(JSON.stringify(keep), (key, value) =>
    key === 'format' && (value === 'uri' || value === 'uuid') ? undefined : value,
  );
  for (const [name, required] of Object.entries(REQUIRED)) {
    if (plain[name]) plain[name].required = required;
    if (required.length === 0) delete plain[name].required;
  }
  return (
    JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'TaleArt zone data',
        description:
          'The body of GET /delivery/v1/zone: the data that <taleart-view>.data and Taleart.setZoneData take to show tales with no backend.',
        $ref: '#/components/schemas/DeliveryZone',
        components: { schemas: Object.fromEntries(Object.entries(plain).sort(([a], [b]) => a.localeCompare(b))) },
      },
      null,
      2,
    ) + '\n'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const json = await openapiJson();
  writeFileSync(OPENAPI_JSON, json);
  writeFileSync(ZONE_SCHEMA_JSON, zoneSchemaJson(JSON.parse(json)));
}
