// The database the dashboard end-to-end tests drop and create again: E2E_DATABASE_URL, guarded.
import { parse as parseConnectionString } from 'pg-connection-string';

const NAME = /^[a-z0-9_]+_e2e_test$/;

// Where a connection string leads, parsed as pg parses it (so `?db=` and socket forms count).
function target(url) {
  const config = parseConnectionString(url);
  return { config, key: `${config.host ?? ''}:${config.port ?? '5432'}/${config.database ?? ''}` };
}

/**
 * Checks `env.E2E_DATABASE_URL` and returns it with its parsed config and database name; throws
 * otherwise. It must be a postgres: or postgresql: URL whose database name ends in `_e2e_test`
 * (lowercase letters, digits and underscores only), with no `db` parameter naming another database,
 * and it must not be the database of TEST_DATABASE_URL or DATABASE_URL, which other runs and the
 * development API use: the e2e run drops it.
 */
export function e2eDatabase(env) {
  const url = env.E2E_DATABASE_URL ?? '';
  let protocol = '';
  try {
    protocol = new URL(url).protocol;
  } catch {
    // Said below.
  }
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('E2E_DATABASE_URL must be a postgres:// URL of a database whose name ends in _e2e_test.');
  }
  const { config, key } = target(url);
  const name = config.database ?? '';
  if (!NAME.test(name) || (config.db !== undefined && config.db !== name)) {
    throw new Error('E2E_DATABASE_URL must name a database ending in _e2e_test (it is dropped and created again).');
  }
  for (const other of ['TEST_DATABASE_URL', 'DATABASE_URL']) {
    if (env[other] && target(env[other]).key === key) {
      throw new Error(`E2E_DATABASE_URL must not be the database of ${other}: the e2e run drops it.`);
    }
  }
  return { url, name, config };
}
