import { migrateAccess, migrateZoneKeys } from '@taleart/server-access';
import { migrateImporter } from '@taleart/server-importer';
import { migrateTales } from '@taleart/server-tales';
import { migrateTargeting } from '@taleart/server-targeting';
import { migrateZones } from '@taleart/server-zones';
import type { Db } from '@taleart/server-access';
import { Pool } from 'pg';

export const defaultDatabaseUrl =
  'postgres://taleart:taleart@localhost:5432/taleart';

/** The pool's size when DATABASE_POOL_MAX is not set. */
export const DEFAULT_DATABASE_POOL_MAX = 20;

/** How many connections the API's pool holds: DATABASE_POOL_MAX, else {@link DEFAULT_DATABASE_POOL_MAX}. */
export function databasePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['DATABASE_POOL_MAX']);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DATABASE_POOL_MAX;
}

/**
 * Connections the import worker leaves to the API's requests: its media copies
 * use at most the pool's size less these at once, so dashboard reads and
 * progress polls are not starved while an import runs.
 */
export const DATABASE_CONNECTIONS_FOR_REQUESTS = 6;

export function createPool(connectionString?: string, max = databasePoolMax()): Pool {
  return new Pool({
    connectionString: connectionString ?? process.env['DATABASE_URL'] ?? defaultDatabaseUrl,
    max,
  });
}

// Each module owns its migrations. They run in dependency order:
// access (projects) first, then zones, which references projects, then
// tales, which references zones, then targeting, whose tag links reference
// tale groups. The access module's zone keys reference zones, so their
// migration is a separate step after zones. The importer runs last: its jobs
// and links reference projects and the records it imports.
const migrations: ReadonlyArray<{ module: string; run: (db: Db) => Promise<void> }> = [
  { module: 'access', run: migrateAccess },
  { module: 'zones', run: migrateZones },
  { module: 'access (zone keys)', run: migrateZoneKeys },
  { module: 'tales', run: migrateTales },
  { module: 'targeting', run: migrateTargeting },
  { module: 'importer', run: migrateImporter },
];

// Serializes migrations across API processes starting at once: their
// "if not exists" checks would otherwise race (AD-6 status columns, for one).
const MIGRATION_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('taleart:migrations', 0))";
const MIGRATION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended('taleart:migrations', 0))";

// Runs every module's migration, in order, on one connection holding the
// migration lock. Safe to run on every start.
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed: Error | undefined;
  try {
    await client.query(MIGRATION_LOCK_SQL);
    try {
      for (const migration of migrations) {
        await migration.run(client);
      }
    } finally {
      await client.query(MIGRATION_UNLOCK_SQL);
    }
  } catch (err) {
    failed = err as Error;
    throw err;
  } finally {
    // A connection whose unlock may have failed is not returned to the pool.
    client.release(failed);
  }
}
