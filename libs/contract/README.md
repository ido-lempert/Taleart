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
   - Add the props schema to `openapi/openapi.yaml` (`<Name>ElementProps`, a `$ref` to the schema
     file), then in `src/lib/tale-document.ts` the props type (`Schemas['<Name>ElementProps']`) and the
     element type through the alias `TaleElementOf<'<key>', <Name>ElementProps>`, added to the
     `TaleElement` union. Add the key to the list in `src/lib/tale-document.spec.ts` ("register
     exactly the element types the TypeScript union holds"), and run `nx run contract:generate`.
   - How the layers list and the server's refusals name an element is `elementName` in
     `tale-document.ts`: a new type falls to "Layer N" until it gets a case there (a label prop, or
     its kind and place, as buttons and shapes have).
   - The generator (`scripts/tale-document-registry.mjs`) refuses an entry without a key, a non-empty
     label or a schema file name in `element-types/`; an unknown field; a key the document schema
     refuses or one registered twice; a props schema that is not a closed object, whose `required`
     names a prop it lacks, or that Ajv does not compile (unknown keywords included).
2. **Server rules** (`libs/server/tales`, `tale-document.ts`). The registry's schema is checked on
   every write with nothing more to do. Rules a schema cannot state (an emoji is one emoji, a label
   holds no control characters, a per-tale limit) go in `PROPS_RULES` under the key.
3. **Studio descriptor** (`apps/dashboard`, `pages/tale-element-types.ts`). Add an entry to
   `STUDIO_TYPE_DESCRIPTORS` under the key: its Add menu entries (id, label, icon, row, and
   `{ kind: 'configured' }` for a type added from its descriptor), its inspector (`{ fields: [...] }`,
   each field a prop of its schema with a control: `text`, `number`, `color` or `select`), how a new
   one is made (`create`: box and props), the text the canvas shows for it (`preview`), and an
   optional `check(props)` for a rule the schema cannot state (the studio's side of the server's
   `PROPS_RULES` entry). The fields inspector checks each value against the schema as it is typed
   (`propValueProblem`), then `check`. A registered type without a descriptor stops the studio, so a
   type cannot be half added. The studio also refuses a fields descriptor its schema does not fit:
   - the props schema may use only `$schema`, `title`, `description`, `type`, `additionalProperties`,
     `required` and `properties`, and each prop only `title`, `description`, `type`, `enum`,
     `minLength`, `maxLength`, `pattern`, `minimum` and `maximum` (what the inspector checks; a type
     needing more keeps its own inspector component, as the built-in types do);
   - `text` and `select` fields edit strings, a select's options are values of the prop's `enum`,
     `number` fields edit integers or numbers, and a `color` field's prop has the pattern
     `^#[0-9a-fA-F]{6}$`.
   A type the studio has no descriptor for (such as a test type with the switch off) shows in its
   layers and canvas and can be moved or deleted; its inspector says it can't be edited here.
4. **SDK renderer** (`libs/web-sdk`, `src/lib/document/`). Write the renderer (DOM through text nodes
   and CSSOM only, each value checked again) and add it to `RENDERERS` in `renderer.ts`; the table
   is typed by the `TaleElement` union, so it does not compile until the type has its renderer.
   Watch the SDK budget (`nx run web-sdk:size`, 50 KB gzipped).

An unknown type is handled differently by the server and the SDK. The server checks a published
document again before delivering it: a document holding a type the server does not take (a test type
with the switch off) fails as a whole, and its tale is delivered as if it had no document. The SDK
skips only the element it has no renderer for and shows the rest of the tale.

Tests: each layer has a registry test that fails when the type is missing from it
(`element-types.spec.ts` in the contract, server-tales, web-sdk and the dashboard).

### Interactive components

A component a visitor answers (epic interactive components; the `poll` first) adds, beyond the four steps above:

- **Contract** (`src/lib/interactive.ts`): its per-tale limit in `ELEMENT_TYPE_LIMITS` (the server refuses a document
  over it; the studio's Add entry takes its `limit` from it) and its interaction kinds in `INTERACTIONS` (the first is
  the default; a visitor has one response per tale, element and kind, the first wins). Choice ids are props of the
  element (`{ id, label }` items), so counts survive an edit to the text.
- **Server** (`libs/server/interactive`, `responses.ts`): how its value is checked and counted (`CHOICES` for a choice
  component). `recordResponse` accepts a response only for an element of a tale the zone delivers now
  (`deliveredTaleElement` in the tales module, the AD-6 rule) and its published document; the Delivery API's
  `POST /responses` needs the site key, the slug and a valid `X-TaleArt-Visitor`, and is rate limited.
- **Studio**: a fixed list of choices is a `choices` field of the fields inspector (labels edited, ids kept); the
  inspector shows the component's counts (`tale-responses.ts`, from `GET /api/v1/tales/{taleId}/responses`).
- **SDK**: the renderer posts through `context.responses` (absent in the Tale Studio preview and on side cards, which
  record nothing), keeps the answer locally (`responses.ts`), marks its root `ta-interactive` (focus inside it pauses
  the tale; Space presses its buttons) and never lets a press step the tale.

### Test-only types

An entry marked `"testOnly": true` (today `test-badge`) is generated into `TALE_TEST_ELEMENT_TYPES`
instead of `TALE_ELEMENT_TYPE_REGISTRY`, and is not in the `TaleElement` union or OpenAPI. It proves
the path end to end and is never offered in production:

- the API accepts it only with `TALE_TEST_ELEMENT_TYPES=on`, which it allows only with `NODE_ENV`
  `development` or `test` (otherwise it refuses to start; see `.env.example`); switching it clears
  the delivery cache;
- Tale Studio offers it only in a development build (`ngDevMode`; production builds drop the code)
  with `localStorage['taleart.testElementTypes'] = 'on'`, or where a test provides
  `STUDIO_TEST_ELEMENT_TYPES`;
- no SDK has its renderer, so the SDK skips it with one warning.
