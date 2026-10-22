// "Visible on site" or "Not visible because…" (epic UX rework R7) for zones, placements and
// tales. The reasons come from the clauses the Delivery filter is made of (./delivery-rule) and
// the zone setup the Delivery API checks (`zoneSetups`), combined by the contract's functions.
import {
  taleContentReasons,
  visibilityInZones,
  zoneSetupReasons,
  zoneVisibility,
  type Visibility,
  type VisibilityReason,
  type ZoneSetup,
} from '@taleart/contract';
import { zoneIdsWithActiveKey, type Db } from '@taleart/server-access';
import { zoneIdsWithFrames } from '@taleart/server-zones';
import { deliveredGroup, groupReasonsSql, readReasons, taleReasonsSql } from './delivery-rule';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unique = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => UUID.test(id)))];

/**
 * Each zone's setup reasons (R7): no display (no frame, until stories 5 and 6) and not installed
 * (no active zone key). The Delivery API delivers nothing in a zone with any of them; the
 * Management API adds them to what is placed there.
 */
export async function zoneSetups(db: Db, zoneIds: readonly string[]): Promise<Map<string, VisibilityReason[]>> {
  const setups = await readZoneSetups(db, zoneIds);
  return new Map([...setups].map(([id, setup]) => [id, zoneSetupReasons(setup)]));
}

// Whether each zone has a display and is installed.
async function readZoneSetups(db: Db, zoneIds: readonly string[]): Promise<Map<string, ZoneSetup>> {
  const ids = unique(zoneIds);
  if (ids.length === 0) return new Map();
  const withDisplay = await zoneIdsWithFrames(db, ids);
  const installed = await zoneIdsWithActiveKey(db, ids);
  return new Map(ids.map((id) => [id, { hasDisplay: withDisplay.has(id), installed: installed.has(id) }]));
}

interface GroupReasons {
  reasons: VisibilityReason[];
  zoneIds: string[];
}

// Each group's own reasons now and the zones it is placed in.
async function readGroupReasons(db: Db, groupIds: readonly string[]): Promise<Map<string, GroupReasons>> {
  const ids = unique(groupIds);
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; reasons: unknown; zoneIds: string[] }>(
    `SELECT g.id, ${groupReasonsSql('g', 'now()')} AS reasons,
       ARRAY(SELECT z.zone_id FROM zone_tale_groups z WHERE z.tale_group_id = g.id ORDER BY z.created_at, z.zone_id)
         AS "zoneIds"
     FROM tale_groups g WHERE g.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, { reasons: readReasons(row.reasons), zoneIds: row.zoneIds }]));
}

// The zones whose setup counts for content: the one zone read, or every zone it is placed in.
function zonesOf(group: GroupReasons, zoneId: string | undefined): string[] {
  return zoneId === undefined ? group.zoneIds : [zoneId];
}

/**
 * Each group's visibility now (R7): in the zone `zoneId` when given (a placement), else in any
 * zone it is placed in.
 */
export async function groupVisibilities(
  db: Db,
  groupIds: readonly string[],
  zoneId?: string,
): Promise<Map<string, Visibility>> {
  const groups = await readGroupReasons(db, groupIds);
  const setups = await zoneSetups(db, [...groups.values()].flatMap((g) => zonesOf(g, zoneId)));
  return new Map(
    [...groups].map(([id, group]) => [
      id,
      visibilityInZones(
        group.reasons,
        zonesOf(group, zoneId).map((z) => setups.get(z) ?? []),
      ),
    ]),
  );
}

/**
 * Each tale's visibility now (R7): its own reasons, its group's, and the setup of the zone
 * `zoneId` when given, else of every zone its group is placed in.
 */
export async function taleVisibilities(
  db: Db,
  taleIds: readonly string[],
  zoneId?: string,
): Promise<Map<string, Visibility>> {
  const ids = unique(taleIds);
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; taleGroupId: string; reasons: unknown }>(
    `SELECT t.id, t.tale_group_id AS "taleGroupId", ${taleReasonsSql('t', 'now()')} AS reasons
     FROM tales t WHERE t.id = ANY($1::uuid[])`,
    [ids],
  );
  const groups = await readGroupReasons(
    db,
    rows.map((row) => row.taleGroupId),
  );
  const setups = await zoneSetups(db, [...groups.values()].flatMap((g) => zonesOf(g, zoneId)));
  return new Map(
    rows.map((row) => {
      const group = groups.get(row.taleGroupId) ?? { reasons: [], zoneIds: [] };
      return [
        row.id,
        visibilityInZones(
          taleContentReasons(readReasons(row.reasons), group.reasons),
          zonesOf(group, zoneId).map((z) => setups.get(z) ?? []),
        ),
      ];
    }),
  );
}

/**
 * Each zone's visibility now (R7): its setup reasons, and `no-shown-tales` when no group placed
 * in it is delivered.
 */
export async function zoneVisibilities(db: Db, zoneIds: readonly string[]): Promise<Map<string, Visibility>> {
  const ids = unique(zoneIds);
  if (ids.length === 0) return new Map();
  const setups = await readZoneSetups(db, ids);
  const { rows } = await db.query<{ zoneId: string }>(
    `SELECT DISTINCT z.zone_id AS "zoneId" FROM zone_tale_groups z
     JOIN tale_groups g ON g.id = z.tale_group_id
     WHERE z.zone_id = ANY($1::uuid[]) AND ${deliveredGroup('g', 'now()')}`,
    [ids],
  );
  const delivering = new Set(rows.map((row) => row.zoneId));
  return new Map(
    [...setups].map(([id, setup]) => [id, zoneVisibility(setup, delivering.has(id))]),
  );
}

/** Content with its visibility; a missing one (content removed meanwhile) reads as not in any zone. */
export function withVisibility<T extends { id: string }>(
  items: readonly T[],
  visibilities: ReadonlyMap<string, Visibility>,
): (T & { visibility: Visibility })[] {
  return items.map((item) => ({
    ...item,
    visibility: visibilities.get(item.id) ?? visibilityInZones([], []),
  }));
}
