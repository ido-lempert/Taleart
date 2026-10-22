// "Visible on site" or "Not visible because…" (epic UX rework R7) for zones, placements and
// tales, read from the clauses the Delivery filter is made of (./delivery-rule), all at one time
// `now` bound as a parameter.
import { taleContentReasons, visibilityOf, type Visibility, type VisibilityReason } from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { groupReasonsSql, readReasons, taleReasonsSql, zoneReasonsSql } from './delivery-rule';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unique = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => UUID.test(id)))];

/**
 * Each group's reasons at `now`: in the zone `zoneId` when given (a placement: its own and that
 * zone's setup), else for any zone it is placed in.
 */
export async function groupReasons(
  db: Db,
  groupIds: readonly string[],
  now: Date,
  zoneId?: string,
): Promise<Map<string, VisibilityReason[]>> {
  const ids = unique(groupIds);
  if (ids.length === 0) return new Map();
  const zone = zoneId !== undefined && UUID.test(zoneId) ? zoneId : undefined;
  const { rows } = await db.query<{ id: string; reasons: unknown }>(
    `SELECT g.id, ${groupReasonsSql('g', '$2::timestamptz', zone === undefined ? undefined : '$3::uuid')} AS reasons
     FROM tale_groups g WHERE g.id = ANY($1::uuid[])`,
    zone === undefined ? [ids, now] : [ids, now, zone],
  );
  return new Map(rows.map((row) => [row.id, readReasons(row.reasons)]));
}

// Each tale's own reasons at `now` and its group, for the tales `taleIds` or every tale of `groupIds`.
async function taleOwnReasons(
  db: Db,
  of: { taleIds: readonly string[] } | { groupIds: readonly string[] },
  now: Date,
): Promise<{ id: string; taleGroupId: string; reasons: VisibilityReason[] }[]> {
  const ids = unique('taleIds' in of ? of.taleIds : of.groupIds);
  if (ids.length === 0) return [];
  const column = 'taleIds' in of ? 't.id' : 't.tale_group_id';
  const { rows } = await db.query<{ id: string; taleGroupId: string; reasons: unknown }>(
    `SELECT t.id, t.tale_group_id AS "taleGroupId", ${taleReasonsSql('t', '$2::timestamptz')} AS reasons
     FROM tales t WHERE ${column} = ANY($1::uuid[])`,
    [ids, now],
  );
  return rows.map((row) => ({ ...row, reasons: readReasons(row.reasons) }));
}

/** Each group's visibility at `now`: in the zone `zoneId` when given (a placement), else in any zone. */
export async function groupVisibilities(
  db: Db,
  groupIds: readonly string[],
  now: Date,
  zoneId?: string,
): Promise<Map<string, Visibility>> {
  const reasons = await groupReasons(db, groupIds, now, zoneId);
  return new Map([...reasons].map(([id, r]) => [id, visibilityOf(r)]));
}

/**
 * The visibility of groups and all their tales at `now`, from two reads (R7): in the zone `zoneId`
 * when given, else in any zone.
 */
export async function groupsAndTalesVisibility(
  db: Db,
  groupIds: readonly string[],
  now: Date,
  zoneId?: string,
): Promise<{ groups: Map<string, Visibility>; tales: Map<string, Visibility> }> {
  const groups = await groupReasons(db, groupIds, now, zoneId);
  const tales = await taleOwnReasons(db, { groupIds }, now);
  return {
    groups: new Map([...groups].map(([id, r]) => [id, visibilityOf(r)])),
    tales: new Map(
      tales.map((t) => [t.id, visibilityOf(taleContentReasons(t.reasons, groups.get(t.taleGroupId) ?? []))]),
    ),
  };
}

/** Each tale's visibility at `now`: its own reasons and its group's, in any zone its group is placed in. */
export async function taleVisibilities(db: Db, taleIds: readonly string[], now: Date): Promise<Map<string, Visibility>> {
  const tales = await taleOwnReasons(db, { taleIds }, now);
  const groups = await groupReasons(
    db,
    tales.map((t) => t.taleGroupId),
    now,
  );
  return new Map(
    tales.map((t) => [t.id, visibilityOf(taleContentReasons(t.reasons, groups.get(t.taleGroupId) ?? []))]),
  );
}

/**
 * Each zone's visibility at `now` (R7): its setup, and whether a group placed in it is delivered
 * there (`no-tale-groups`, `no-visible-groups`).
 */
export async function zoneVisibilities(db: Db, zoneIds: readonly string[], now: Date = new Date()): Promise<Map<string, Visibility>> {
  const ids = unique(zoneIds);
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; reasons: unknown }>(
    `SELECT z.id, ${zoneReasonsSql('z.id', '$2::timestamptz')} AS reasons FROM unnest($1::uuid[]) AS z(id)`,
    [ids, now],
  );
  return new Map(rows.map((row) => [row.id, visibilityOf(readReasons(row.reasons))]));
}

/** Content with its visibility; a missing one (content removed meanwhile) reads as not in any zone. */
export function withVisibility<T extends { id: string }>(
  items: readonly T[],
  visibilities: ReadonlyMap<string, Visibility>,
): (T & { visibility: Visibility })[] {
  return items.map((item) => ({
    ...item,
    visibility: visibilities.get(item.id) ?? visibilityOf([{ code: 'not-in-any-zone', subject: 'group' }]),
  }));
}
