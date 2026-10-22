import { migrateAccess } from '@taleart/server-access';
import { migrateImporter } from '@taleart/server-importer';
import { copyZonePlacements, migrateTales, setTaleMediaDocumentsEnabled } from '@taleart/server-tales';
import { migrateTargeting } from '@taleart/server-targeting';
import { foldStagesIntoZones, migrateZones } from '@taleart/server-zones';
import type { DbConnection } from '@taleart/server-access';
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
// tale groups. The access module also drops the old `zone_keys` table (epic
// UX rework, owner decision 2026-10-22). The zones module's fold of stages
// and extra frames into zones (AD-17) runs after tales, because each new zone
// gets copies of its original zone's placements through the tales module
// (AD-14). The importer runs last: its jobs and links reference projects and
// the records it imports.
const migrations: ReadonlyArray<{ module: string; run: (db: DbConnection) => Promise<void> }> = [
  { module: 'access', run: migrateAccess },
  { module: 'zones', run: migrateZones },
  { module: 'tales', run: migrateTales },
  {
    module: 'zones (stages and frames into zones)',
    run: async (db) => {
      await foldStagesIntoZones(db, { copyPlacements: copyZonePlacements });
    },
  },
  { module: 'targeting', run: migrateTargeting },
  { module: 'importer', run: migrateImporter },
];

// Serializes migrations across API processes starting at once: their
// "if not exists" checks would otherwise race (AD-6 status columns, for one).
const MIGRATION_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended('taleart:migrations', 0))";
const MIGRATION_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended('taleart:migrations', 0))";

/**
 * TALE_MEDIA_MIGRATION (Tale Studio R16): `on` (the default) writes each tale's media into its
 * documents, at start and on every media write; `off` writes none, for a fleet that still runs the
 * previous release, which refuses documents with a `taleMedia` element. Deploy the new release to
 * every instance with `off`, then restart them with `on`.
 */
export function taleMediaMigrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['TALE_MEDIA_MIGRATION'] ?? 'on').trim().toLowerCase() !== 'off';
}

// Runs every module's migration, in order, on one connection holding the
// migration lock. Safe to run on every start.
export async function migrate(pool: Pool): Promise<void> {
  setTaleMediaDocumentsEnabled(taleMediaMigrationEnabled());
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
