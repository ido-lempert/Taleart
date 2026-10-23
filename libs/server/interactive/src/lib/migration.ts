import { MAX_RESPONSE_VALUE_LENGTH } from '@taleart/contract';
import type { Db } from '@taleart/server-access';

/**
 * Forward-only migration for the table the interactive module owns (epic interactive components
 * R9). Runs after the tales migration: a response references its tale, and is deleted with it.
 *
 * One row per visitor, tale, component and interaction kind; the first response wins (C9). Each row
 * carries the AD-10 keys (project, zone, display frame, tale group, tale), the element's id and
 * type, the value, the device's visitor id (epic UX rework 8.23; no user data, AD-13) and the
 * client's and the server's times. Zone, frame and group ids are kept as recorded, without keys
 * into their tables, as events keep them (AD-10).
 */
export async function migrateInteractive(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS interactive_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id),
      zone_id uuid NOT NULL,
      frame_id uuid,
      tale_group_id uuid NOT NULL,
      tale_id uuid NOT NULL REFERENCES tales(id) ON DELETE CASCADE,
      element_id uuid NOT NULL,
      element_type text NOT NULL CHECK (char_length(element_type) BETWEEN 1 AND 64),
      interaction text NOT NULL CHECK (char_length(interaction) BETWEEN 1 AND 32),
      value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND ${MAX_RESPONSE_VALUE_LENGTH}),
      visitor_id uuid NOT NULL,
      client_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // The first response per visitor wins: a repeat finds this key taken.
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS interactive_responses_visitor_key ' +
      'ON interactive_responses (tale_id, element_id, interaction, visitor_id)',
  );
  // Counting a component's responses by value.
  await db.query(
    'CREATE INDEX IF NOT EXISTS interactive_responses_element_idx ON interactive_responses (tale_id, element_id, interaction, value)',
  );
  await db.query('CREATE INDEX IF NOT EXISTS interactive_responses_project_id_idx ON interactive_responses (project_id)');
}
