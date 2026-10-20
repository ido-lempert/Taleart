import { migrateAccess, migrateZoneKeys } from '@taleart/server-access';
import { migrateTales } from '@taleart/server-tales';
import { migrateTargeting } from '@taleart/server-targeting';
import { migrateZones } from '@taleart/server-zones';
import { Pool } from 'pg';

export const defaultDatabaseUrl =
  'postgres://taleart:taleart@localhost:5432/taleart';

export function createPool(connectionString?: string): Pool {
  return new Pool({
    connectionString: connectionString ?? process.env['DATABASE_URL'] ?? defaultDatabaseUrl,
  });
}

// Each module owns its migrations. They run in dependency order:
// access (projects) first, then zones, which references projects, then
// tales, which references zones, then targeting, whose tag links reference
// tale groups. The access module's zone keys reference zones, so their
// migration is a separate step after zones.
const migrations: ReadonlyArray<{ module: string; run: (pool: Pool) => Promise<void> }> = [
  { module: 'access', run: migrateAccess },
  { module: 'zones', run: migrateZones },
  { module: 'access (zone keys)', run: migrateZoneKeys },
  { module: 'tales', run: migrateTales },
  { module: 'targeting', run: migrateTargeting },
];

// Runs every module's migration. Safe to run on every start.
export async function migrate(pool: Pool): Promise<void> {
  for (const migration of migrations) {
    await migration.run(pool);
  }
}
