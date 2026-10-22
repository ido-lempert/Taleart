import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTestElementTypesEnabled, testElementTypesEnabled } from '@taleart/server-tales';
import { configureTestElementTypes, testElementTypesFromEnv } from './element-types-config';

describe('TALE_TEST_ELEMENT_TYPES (epic Tale Studio R8)', () => {
  afterEach(() => setTestElementTypesEnabled(false));

  it('is off unless set to on', () => {
    expect(testElementTypesFromEnv({})).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'off', NODE_ENV: 'production' })).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: ' ' })).toBe(false);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'on', NODE_ENV: 'test' })).toBe(true);
    expect(testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: ' ON ', NODE_ENV: 'development' })).toBe(true);
  });

  it('refuses another value', () => {
    expect(() => testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'yes', NODE_ENV: 'test' })).toThrow(/"on" or "off"/);
  });

  it('is on only with NODE_ENV development or test', () => {
    for (const NODE_ENV of ['production', 'staging', 'Development', '']) {
      expect(() => testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'on', NODE_ENV })).toThrow(
        /needs NODE_ENV=development or NODE_ENV=test/,
      );
    }
    expect(() => testElementTypesFromEnv({ TALE_TEST_ELEMENT_TYPES: 'on' })).toThrow(/NODE_ENV is not set/);
  });

  it('sets the tales module switch at start, and warns when on', () => {
    const warn = vi.fn();
    expect(configureTestElementTypes({ TALE_TEST_ELEMENT_TYPES: 'on', NODE_ENV: 'development' }, setTestElementTypesEnabled, warn)).toBe(true);
    expect(testElementTypesEnabled()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    configureTestElementTypes({}, setTestElementTypesEnabled, warn);
    expect(testElementTypesEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stops the start before the switch is set when refused', () => {
    const set = vi.fn();
    expect(() =>
      configureTestElementTypes({ TALE_TEST_ELEMENT_TYPES: 'on', NODE_ENV: 'production' }, set, vi.fn()),
    ).toThrow();
    expect(set).not.toHaveBeenCalled();
  });

  it('is read by the API at start, before the database is touched', () => {
    const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    const configured = main.indexOf('configureTestElementTypes(process.env, setTestElementTypesEnabled');
    expect(configured).toBeGreaterThan(0);
    expect(configured).toBeLessThan(main.indexOf('createPool()'));
    // A refusal reaches start().catch, which logs it and exits with 1.
    expect(main).toMatch(/start\(\)\.catch\(\(err\) => \{\s*log\('error', 'startup failed', err\);\s*process\.exit\(1\);/);
  });
});
