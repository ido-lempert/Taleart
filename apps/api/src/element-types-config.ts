/** The NODE_ENV values under which TALE_TEST_ELEMENT_TYPES may be on. */
export const TEST_ELEMENT_TYPES_ENVIRONMENTS: readonly string[] = ['development', 'test'];

/**
 * TALE_TEST_ELEMENT_TYPES (epic Tale Studio R8): `on` makes the API accept the element-type
 * registry's test-only types (`testOnly` in `libs/contract/tale-document/element-types/registry.json`)
 * in tale documents; `off` or unset (the default) refuses them as unknown types. `on` is allowed
 * only with NODE_ENV `development` or `test`: under any other NODE_ENV, or none, it stops the API
 * with a clear error rather than accept them. Any value but `on` or `off` is an error too.
 */
export function testElementTypesFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env['TALE_TEST_ELEMENT_TYPES'] ?? '').trim().toLowerCase();
  if (value === '' || value === 'off') return false;
  if (value !== 'on') throw new Error('TALE_TEST_ELEMENT_TYPES must be "on" or "off"');
  const nodeEnv = (env['NODE_ENV'] ?? '').trim();
  if (!TEST_ELEMENT_TYPES_ENVIRONMENTS.includes(nodeEnv)) {
    throw new Error(
      `TALE_TEST_ELEMENT_TYPES=on is for tests and development: it needs NODE_ENV=development or NODE_ENV=test (NODE_ENV is ${nodeEnv ? `"${nodeEnv}"` : 'not set'})`,
    );
  }
  return true;
}

/**
 * Reads TALE_TEST_ELEMENT_TYPES and sets the tales module's switch from it, as the API does at
 * start, before it touches the database; says so when test types are on. Throws as
 * {@link testElementTypesFromEnv} does, which stops the API.
 */
export function configureTestElementTypes(
  env: NodeJS.ProcessEnv,
  setEnabled: (on: boolean) => void,
  warn: (msg: string) => void,
): boolean {
  const on = testElementTypesFromEnv(env);
  setEnabled(on);
  if (on) warn('Accepting test-only element types (TALE_TEST_ELEMENT_TYPES=on): for tests and development only');
  return on;
}
