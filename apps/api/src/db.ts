import { Pool } from 'pg';

export const defaultDatabaseUrl =
  'postgres://taleart:taleart@localhost:5432/taleart';

export function createPool(connectionString?: string): Pool {
  return new Pool({
    connectionString: connectionString ?? process.env['DATABASE_URL'] ?? defaultDatabaseUrl,
  });
}

// Creates the tables the foundation needs. Safe to run on every start.
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS zones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
