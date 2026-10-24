// Types of `@taleart/contract/openapi.json` for consumers of the built package (its `exports` entry):
// the OpenAPI document generated from openapi/openapi.yaml by `contract:generate`. Inside the
// workspace, TypeScript reads the JSON itself through the tsconfig path.
declare const openapiDocument: {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string; readonly description?: string };
  readonly paths: { readonly [path: string]: unknown };
  readonly [key: string]: unknown;
};
export default openapiDocument;
