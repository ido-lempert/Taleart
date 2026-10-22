import { testElementTypesFromEnv } from './element-types-config';

describe('TALE_TEST_ELEMENT_TYPES (epic Tale Studio R8)', () => {
  it('is off unless set to on', () => {
    expect(testElementTypesFromEnv({})).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'off' })).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: ' ' })).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'on' })).toBe(true);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: ' ON ', NODE_ENV: 'development' })).toBe(true);
  });

  it('refuses another value', () => {
    expect(() => testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'yes' })).toThrow(/"on" or "off"/);
  });

  it('is never on in production', () => {
    expect(() => testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'on', NODE_ENV: 'production' })).toThrow(
      /refused with NODE_ENV=production/,
    );
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'off', NODE_ENV: 'production' })).toBe(false);
  });
});
