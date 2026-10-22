# @taleart/contract

The TaleArt contract (AD-3): the Management and Delivery API types (`openapi/openapi.yaml`), the
tale document (AD-15), the frame-type registry, the theme, and the helpers the API, the server
libraries, the dashboard and the SDKs share. `nx run contract:generate` turns the YAML and JSON
sources into `src/generated/`.

## Element types (epic Tale Studio R8)

A tale document is a list of elements, each keyed by `type`. Element types are data, built from one
registration per layer. The registry, `tale-document/element-types/registry.json`, is the one list:
the server's validation, Tale Studio's Add menu and inspector, and the SDK's renderer lookup all
come from it. A new type (each component of epic-interactive-components: poll, quiz, emoji reaction,
countdown, product pins, promo code, Rating) needs no document version change and no migration:
documents of version 1 already accept any registered key, and an SDK that does not know a type skips
it, with one console warning per type per page, and shows the rest of the tale.

### Adding a type

1. **Schema and registry entry** (`libs/contract`).
   - Write `tale-document/element-types/<key>.schema.json`: a JSON Schema (2020-12) of the element's
     `props`, `"type": "object"`, `"additionalProperties": false`, with every limit stated (string
     lengths, patterns, enums, number ranges). Hold no HTML, CSS or script (R14, AD-16); URLs only as
     the link types hold them (`linkUrlProblem`).
   - Add `{ "key": "<key>", "label": "<Name people read>", "schema": "<key>.schema.json" }` to
     `registry.json`. The key matches `^[a-z][a-z0-9-]{0,63}$`.
   - Add the props schema to `openapi/openapi.yaml` (`<Name>ElementProps`), the element type to the
     `TaleElement` union in `src/lib/tale-document.ts`, and run `nx run contract:generate`.
   - The generator refuses a duplicate key, a key the document schema refuses, or an open props schema.
2. **Server rules** (`libs/server/tales`, `tale-document.ts`). The registry's schema is checked on
   every write with nothing more to do. Rules a schema cannot state (an emoji is one emoji, a label
   holds no control characters, a per-tale limit) go in `PROPS_RULES` under the key.
3. **Studio descriptor** (`apps/dashboard`, `pages/tale-element-types.ts`). Add an entry to
   `STUDIO_TYPE_DESCRIPTORS` under the key: its Add menu entries (id, label, icon, row, and
   `{ kind: 'configured' }` for a type added from its descriptor), its inspector (`{ fields: [...] }`,
   each field a prop of its schema with a control: `text`, `number`, `color` or `select`), how a new
   one is made (`create`: box and props), and the text the canvas shows for it (`preview`). The
   fields inspector checks each value against the schema as it is typed (`propValueProblem`). A
   registered type without a descriptor stops the studio, so a type cannot be half added.
4. **SDK renderer** (`libs/web-sdk`, `src/lib/document/`). Write the renderer (DOM through text nodes
   and CSSOM only, each value checked again) and add it to `RENDERERS` in `renderer.ts`; the table
   is typed by the `TaleElement` union, so it does not compile until the type has its renderer.
   Watch the SDK budget (`nx run web-sdk:size`, 50 KB gzipped).

Tests: each layer has a registry test that fails when the type is missing from it
(`element-types.spec.ts` in the contract, server-tales, web-sdk and the dashboard).

### Test-only types

An entry marked `"testOnly": true` (today `test-badge`) is generated into `TALE_TEST_ELEMENT_TYPES`
instead of `TALE_ELEMENT_TYPE_REGISTRY`, and is not in the `TaleElement` union or OpenAPI. It proves
the path end to end and is never offered in production:

- the API accepts it only with `TALE_TEST_ELEMENT_TYPES=on`, which it refuses to start with under
  `NODE_ENV=production`;
- Tale Studio offers it only in a development build (`ngDevMode`; production builds drop the code)
  with `localStorage['taleart.testElementTypes'] = 'on'`, or where a test provides
  `STUDIO_TEST_ELEMENT_TYPES`;
- no SDK has its renderer, so the SDK skips it with one warning.
