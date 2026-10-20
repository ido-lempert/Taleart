import type { Db } from '@taleart/server-access';

/** The only source system so far. */
export const SOURCE_SYSTEM = 'storyly';

/** Which source record a link starts from, in a project. */
export interface LinkSource {
  projectId: string;
  sourceType: string;
  sourceId: string;
}

/** The id of the TaleArt record a source record was imported as, or null (AD-7). */
export async function findLinkTarget(db: Db, source: LinkSource): Promise<string | null> {
  const { rows } = await db.query<{ target_id: string }>(
    `SELECT target_id FROM import_links
     WHERE project_id = $1 AND source_system = $2 AND source_type = $3 AND source_id = $4`,
    [source.projectId, SOURCE_SYSTEM, source.sourceType, source.sourceId],
  );
  return rows[0]?.target_id ?? null;
}

/**
 * Serializes work on one source record until the transaction ends, so two
 * imports of the same record cannot both miss its link and both create it.
 */
export async function lockLinkSource(tx: Db, source: LinkSource): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('import_links:' || $1, 0))", [
    [source.projectId, SOURCE_SYSTEM, source.sourceType, source.sourceId].join(':'),
  ]);
}

/** Links a source record to the TaleArt record it became. An existing link is never re-pointed. */
export async function saveLink(
  db: Db,
  link: LinkSource & { targetType: string; targetId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO import_links (project_id, source_system, source_type, source_id, target_type, target_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id, source_system, source_type, source_id) DO NOTHING`,
    [link.projectId, SOURCE_SYSTEM, link.sourceType, link.sourceId, link.targetType, link.targetId],
  );
}
