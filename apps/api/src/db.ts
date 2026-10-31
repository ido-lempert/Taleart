import { migrateAccess, migrateZoneKeys, withClient } from '@taleart/server-access';
import { migrateAnalytics } from '@taleart/server-analytics';
import { migrateInteractive } from '@taleart/server-interactive';
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
  const pool = new Pool({
    connectionString: connectionString ?? process.env['DATABASE_URL'] ?? defaultDatabaseUrl,
    max,
  });
  // An idle client whose connection the database ends (a restart, a terminated backend) makes the
  // pool emit `error`; without a listener Node would exit. The pool drops that client by itself.
  pool.on('error', (err) => {
    console.log(
      JSON.stringify({ level: 'error', msg: 'idle database connection failed', error: { name: err.name, message: err.message } }),
    );
  });
  return pool;
}

// Each module owns its migrations. They run in dependency order:
// access (projects) first, then zones, which references projects, then
// tales, which references zones, then targeting, whose tag links reference
// tale groups. The access module's zone keys reference zones, so their
// migration is a separate step after zones. The zones module's fold of stages
// and extra frames into zones (AD-17) runs after tales, because each new zone
// gets copies of its original zone's placements through the tales module
// (AD-14). The interactive module's responses reference tales (and are deleted
// with them). The analytics events reference projects only. The last step drops the tables of the removed
// import feature.
// Forward migration that retires the import feature: drops its four tables (job queue and reports, source-to-record
// links, copied-media keys, last-written record fields) with their indexes. Nothing else referenced them, and
// no column of another table was added by the feature. A fresh database has none, hence IF EXISTS.
async function dropImportTables(db: DbConnection): Promise<void> {
  await db.query('DROP TABLE IF EXISTS import_records, import_media, import_links, import_jobs');
}

const migrations: ReadonlyArray<{ module: string; run: (db: DbConnection) => Promise<void> }> = [
  { module: 'access', run: migrateAccess },
  { module: 'zones', run: migrateZones },
  { module: 'access (zone keys)', run: migrateZoneKeys },
  { module: 'tales', run: migrateTales },
  {
    module: 'zones (stages and frames into zones)',
    run: async (db) => {
      await foldStagesIntoZones(db, { copyPlacements: copyZonePlacements });
    },
  },
  { module: 'targeting', run: migrateTargeting },
  { module: 'interactive', run: migrateInteractive },
  { module: 'analytics', run: migrateAnalytics },
  { module: 'retire import tables', run: dropImportTables },
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
  // withClient: a session the database ends while migrations run (a restart, a terminated backend)
  // fails `migrate` with its error, and the API does not start, rather than pg crashing the process.
  // The migration lock goes with that session. A connection whose work or unlock failed is dropped.
  await withClient(
    pool,
    async (client) => {
      await client.query(MIGRATION_LOCK_SQL);
      try {
        for (const migration of migrations) {
          await migration.run(client);
        }
      } finally {
        if (!client.lost()) await client.query(MIGRATION_UNLOCK_SQL);
      }
    },
    { discardOnError: true },
  );
}
