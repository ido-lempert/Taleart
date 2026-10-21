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

/**
 * Links a source record to the TaleArt record it became, with the source app
 * it came from when known. An existing link is never re-pointed.
 */
export async function saveLink(
  db: Db,
  link: LinkSource & { targetType: string; targetId: string; appId?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO import_links (project_id, source_system, source_type, source_id, target_type, target_id, source_app_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id, source_system, source_type, source_id) DO NOTHING`,
    [link.projectId, SOURCE_SYSTEM, link.sourceType, link.sourceId, link.targetType, link.targetId, link.appId ?? null],
  );
}

/** A link of an earlier import whose source record this run did not list. */
export interface UnlistedLink {
  sourceType: string;
  sourceId: string;
  targetId: string;
}

/**
 * Records that this run listed these source records of the app: links saved
 * before links knew their app get it now, so a later run can tell when the
 * source drops them. Then answers the app's links of these source types whose
 * source records were not listed, oldest first.
 */
export async function unlistedLinks(
  db: Db,
  projectId: string,
  appId: string,
  listed: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<UnlistedLink[]> {
  const types = [...listed.keys()];
  const pairs = types.flatMap((type) => [...(listed.get(type) ?? [])].map((id) => [type, id] as const));
  await db.query(
    `UPDATE import_links SET source_app_id = $3
     FROM unnest($4::text[], $5::text[]) AS listed(source_type, source_id)
     WHERE import_links.project_id = $1 AND import_links.source_system = $2 AND import_links.source_app_id IS NULL
       AND import_links.source_type = listed.source_type AND import_links.source_id = listed.source_id`,
    [projectId, SOURCE_SYSTEM, appId, pairs.map(([type]) => type), pairs.map(([, id]) => id)],
  );
  const { rows } = await db.query<UnlistedLink>(
    `SELECT source_type AS "sourceType", source_id AS "sourceId", target_id AS "targetId" FROM import_links
     WHERE project_id = $1 AND source_system = $2 AND source_app_id = $3 AND source_type = ANY($4::text[])
       AND NOT EXISTS (
         SELECT 1 FROM unnest($5::text[], $6::text[]) AS listed(source_type, source_id)
         WHERE listed.source_type = import_links.source_type AND listed.source_id = import_links.source_id
       )
     ORDER BY created_at, source_type, source_id`,
    [projectId, SOURCE_SYSTEM, appId, types, pairs.map(([type]) => type), pairs.map(([, id]) => id)],
  );
  return rows;
}
