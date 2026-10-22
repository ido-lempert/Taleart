// `nx run dashboard-e2e:test`: the guard on the database the e2e run drops.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { e2eDatabase } from './e2e-database.mjs';

const ok = 'postgres://taleart:taleart@localhost:5432/taleart_w1_e2e_test';

test('accepts a postgres URL of a database ending in _e2e_test', () => {
  assert.equal(e2eDatabase({ E2E_DATABASE_URL: ok }).name, 'taleart_w1_e2e_test');
  assert.equal(e2eDatabase({ E2E_DATABASE_URL: ok.replace('postgres:', 'postgresql:') }).name, 'taleart_w1_e2e_test');
});

test('refuses a missing URL, another scheme, or a name without _e2e_test', () => {
  for (const url of [undefined, '', 'not a url', 'mysql://localhost/taleart_e2e_test', 'postgres://localhost/taleart',
    'postgres://localhost/taleart_test', 'postgres://localhost/Taleart_e2e_test', 'postgres://localhost/a-b_e2e_test']) {
    assert.throws(() => e2eDatabase({ E2E_DATABASE_URL: url }), /E2E_DATABASE_URL must/, String(url));
  }
});

test('judges the database pg would reach: a db parameter naming another one is refused', () => {
  assert.throws(() => e2eDatabase({ E2E_DATABASE_URL: `${ok}?db=taleart` }), /_e2e_test/);
});

test('refuses the database of TEST_DATABASE_URL or DATABASE_URL', () => {
  assert.throws(() => e2eDatabase({ E2E_DATABASE_URL: ok, TEST_DATABASE_URL: ok }), /TEST_DATABASE_URL/);
  assert.throws(
    () => e2eDatabase({ E2E_DATABASE_URL: ok, DATABASE_URL: 'postgresql://other:pw@localhost:5432/taleart_w1_e2e_test?sslmode=disable' }),
    /DATABASE_URL/,
  );
  assert.equal(e2eDatabase({ E2E_DATABASE_URL: ok, DATABASE_URL: 'postgres://localhost:5432/taleart' }).name, 'taleart_w1_e2e_test');
});
