import type { Db } from '@taleart/server-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What analytics events of a zone may name (analytics, `POST /delivery/v1/events`): which of the
 * given tale groups are placed in the zone, and, for the given tales, the group each one belongs to
 * when that group is placed in the zone. Ids that are not UUIDs match nothing.
 */
export interface ZoneTaleTargets {
  /** The given group ids that are placed in the zone. */
  readonly placedGroupIds: ReadonlySet<string>;
  /** Each given tale that exists and whose group is placed in the zone, mapped to that group. */
  readonly taleGroupIds: ReadonlyMap<string, string>;
}

/** The placements of the given groups and tales in one zone (see {@link ZoneTaleTargets}). */
export async function zoneTaleTargets(
  db: Db,
  zoneId: string,
  groupIds: readonly string[],
  taleIds: readonly string[],
): Promise<ZoneTaleTargets> {
  const groups = [...new Set(groupIds.filter((id) => UUID.test(id)))];
  const tales = [...new Set(taleIds.filter((id) => UUID.test(id)))];
  const none: ZoneTaleTargets = { placedGroupIds: new Set(), taleGroupIds: new Map() };
  if (!UUID.test(zoneId) || (groups.length === 0 && tales.length === 0)) return none;
  // Each given tale with its group (a tale that does not exist is left out).
  const taleRows =
    tales.length === 0
      ? { rows: [] as { id: string; tale_group_id: string }[] }
      : await db.query<{ id: string; tale_group_id: string }>(
          'SELECT id, tale_group_id FROM tales WHERE id = ANY($1::uuid[])',
          [tales],
        );
  const candidates = [...new Set([...groups, ...taleRows.rows.map((row) => row.tale_group_id)])];
  const placed = new Set<string>();
  if (candidates.length > 0) {
    const { rows } = await db.query<{ tale_group_id: string }>(
      'SELECT tale_group_id FROM zone_tale_groups WHERE zone_id = $1 AND tale_group_id = ANY($2::uuid[])',
      [zoneId, candidates],
    );
    for (const row of rows) placed.add(row.tale_group_id);
  }
  const taleGroupIds = new Map<string, string>();
  for (const row of taleRows.rows) {
    if (placed.has(row.tale_group_id)) taleGroupIds.set(row.id, row.tale_group_id);
  }
  return { placedGroupIds: new Set(groups.filter((id) => placed.has(id))), taleGroupIds };
}

/** The titles of the given tales, of one project; ids not in the project are left out. */
export async function taleTitlesById(db: Db, projectId: string, taleIds: readonly string[]): Promise<Map<string, string>> {
  const ids = taleIds.filter((id) => UUID.test(id));
  if (!UUID.test(projectId) || ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; title: string }>(
    'SELECT id, title FROM tales WHERE id = ANY($1::uuid[]) AND project_id = $2',
    [ids, projectId],
  );
  return new Map(rows.map((row) => [row.id, row.title]));
}
