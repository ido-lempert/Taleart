/**
 * TALE_TEST_ELEMENT_TYPES (epic Tale Studio R8): `on` makes the API accept the element-type
 * registry's test-only types (`testOnly` in `libs/contract/tale-document/element-types/registry.json`)
 * in tale documents, for tests and development servers; `off` or unset (the default) refuses them
 * as unknown types. It is never on in production: with NODE_ENV=production, `on` stops the API
 * with a clear error rather than accept them. Any other value is an error too.
 */
export function testElementTypesFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env['TALE_TEST_ELEMENT_TYPES'] ?? '').trim().toLowerCase();
  if (value === '' || value === 'off') return false;
  if (value !== 'on') throw new Error('TALE_TEST_ELEMENT_TYPES must be "on" or "off"');
  if (env['NODE_ENV'] === 'production') {
    throw new Error('TALE_TEST_ELEMENT_TYPES=on is for tests and development; it is refused with NODE_ENV=production');
  }
  return true;
}
