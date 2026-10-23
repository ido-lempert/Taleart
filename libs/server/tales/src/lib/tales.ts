import {
  canSetStatus,
  EDITOR_ONLY_ELEMENT_FIELDS,
  ErrorCodes,
  isMediaContentType,
  isTaleMediaElement,
  isValidWindow,
  LEGACY_PLACEHOLDER_COLOR,
  LEGACY_TALE_DURATION_MS,
  TALE_DOCUMENT_VERSION,
  MAX_TALES_PER_GROUP,
  MAX_TALE_GROUPS_PER_PROJECT,
  mediaKind,
  projectFontIds,
  readContentStatus,
  readTaleStatus,
  NEW_TALE_STATUS,
  taleGroupCoverUrl,
  taleMediaUrl,
  type ContentStatus,
  type MediaContentType,
  type ProjectTaleGroup,
  type SettableStatus,
  type Tale,
  type TaleGroup,
  type TaleGroupCover,
  type ZoneTaleGroup,
} from '@taleart/contract';
import { randomUUID } from 'node:crypto';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import { zoneProjectId, ZoneNotFoundError } from '@taleart/server-zones';
import {
  deliveredMediaKeys,
  findPublishedDocumentMedia,
  recordTaleMedia,
  usesMedia,
  lockMediaKeyForDeletion,
} from './document-media';
import { deliveryProjectFonts, recordTaleFonts, withoutProjectFonts, type StoredFontFile } from './project-fonts';
import { bringTaleMediaInStep, taleMediaDocumentsEnabled, withOutOfStepMedia } from './tale-media-document';
import {
  checkDocumentFonts,
  checkDocumentMedia,
  checkPublishableDocument,
  checkTaleDocument,
  draftProblem,
  ownTaleMediaOnly,
  deliverableTaleDocument,
  InvalidTaleDocumentError,
  type KeyedDeliveryDocument,
  TaleDocumentTooLargeError,
} from './tale-document';
import { deliveredGroup, deliveredPlacement, deliveredTale } from './delivery-rule';
import { groupsAndTalesVisibility, groupVisibilities, taleVisibilities, withVisibility } from './visibility';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GROUP_COLUMNS =
  'tale_groups.id, tale_groups.project_id AS "projectId", tale_groups.name, tale_groups.status AS "storedStatus", ' +
  'tale_groups.starts_at AS "startsAt", tale_groups.ends_at AS "endsAt", ' +
  'tale_groups.cover_content_type AS "coverContentType", tale_groups.cover_animated AS "coverAnimated"';
// A group as a zone lists it: the group's columns and its placement's position.
const ZONE_GROUP_COLUMNS = `${GROUP_COLUMNS}, zone_tale_groups.position`;
// Qualified, so the media update can join the tale's old row without ambiguity.
// The group's status comes along, since a tale's status as read depends on it (AD-6).
const TALE_COLUMNS =
  'tales.id, tales.tale_group_id AS "taleGroupId", tales.project_id AS "projectId", tales.title, tales.position, ' +
  'tales.media_content_type AS "mediaContentType", tales.status AS "storedStatus", ' +
  'tales.starts_at AS "startsAt", tales.ends_at AS "endsAt", ' +
  '(SELECT owner.status FROM tale_groups owner WHERE owner.id = tales.tale_group_id) AS "groupStatus"';

// The Delivery filter and the visibility reasons, from one list of clauses (epic UX rework R7).
export { deliveredGroup, deliveredTale, hasPublishedDocument, SHOWN_STATUS_STEP } from './delivery-rule';

/**
 * A tale group as this module stores it: everything but its tags, which the
 * targeting module owns. The API composes the tags in (AD-1).
 */
export type StoredTaleGroup = Omit<TaleGroup, 'tags'>;

/** A tale group as a zone lists it, with its position in that zone; tags are composed in by the API. */
export type StoredZoneTaleGroup = Omit<ZoneTaleGroup, 'tags'>;

/** A start and end time to store: ISO 8601 date-times, or null for an open bound. */
export interface StoredWindow {
  startsAt: string | null;
  endsAt: string | null;
}

// The window columns as pg returns them.
interface WindowRow {
  startsAt: Date | null;
  endsAt: Date | null;
}

// The cover columns as GROUP_COLUMNS reads them; the key stays inside the module (AD-11).
interface CoverRow {
  coverContentType: string | null;
  coverAnimated: boolean;
}

// A tale_groups row as GROUP_COLUMNS reads it, with the placement's position when read through a zone.
type GroupRow = Omit<StoredTaleGroup, 'tales' | 'zoneIds' | 'status' | 'startsAt' | 'endsAt' | 'cover' | 'visibility'> &
  WindowRow &
  CoverRow;
type ZoneGroupRow = GroupRow & { position: number };

// The group's fields as the API returns them: the window in ISO 8601 UTC and the status as read (AD-6).
type GroupFields = Omit<StoredTaleGroup, 'tales' | 'zoneIds' | 'visibility'>;

// A tales row as TALE_COLUMNS reads it. The storage key stays inside the module.
type TaleRow = Omit<Tale, 'media' | 'status' | 'startsAt' | 'endsAt' | 'visibility'> &
  WindowRow & { mediaContentType: string | null; groupStatus: ContentStatus };

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

// The API derives the cover URL from the group id; the row holds only the key (AD-11).
function toCover(id: string, { coverContentType, coverAnimated }: CoverRow): TaleGroupCover | null {
  return coverContentType !== null && isMediaContentType(coverContentType)
    ? {
        kind: mediaKind(coverContentType),
        contentType: coverContentType,
        animated: coverAnimated,
        url: taleGroupCoverUrl(id),
      }
    : null;
}

// Computes the status as read from the stored key and the window, now (AD-6), and the cover.
function toGroup<T extends GroupRow>(row: T): Omit<T, keyof WindowRow | keyof CoverRow> & GroupFields {
  const { coverContentType, coverAnimated, ...rest } = row;
  const status = readContentStatus(row.storedStatus, row);
  return {
    ...rest,
    status,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    cover: toCover(row.id, { coverContentType, coverAnimated }),
  } as Omit<T, keyof WindowRow | keyof CoverRow> & GroupFields;
}

// The API derives the media URL from the tale id; the row holds only the key (AD-11).
function toTale({ mediaContentType, groupStatus, ...tale }: TaleRow): Omit<Tale, 'visibility'> {
  const media =
    mediaContentType !== null && isMediaContentType(mediaContentType)
      ? { kind: mediaKind(mediaContentType), contentType: mediaContentType, url: taleMediaUrl(tale.id) }
      : null;
  return {
    ...tale,
    status: readTaleStatus(tale.storedStatus, groupStatus, tale),
    startsAt: iso(tale.startsAt),
    endsAt: iso(tale.endsAt),
    media,
  };
}

/** A tale's stored media: its storage key and content type. */
export interface StoredTaleMedia {
  key: string;
  contentType: MediaContentType;
}

/** Thrown when a tale request names a tale group that does not exist. */
export class TaleGroupNotFoundError extends Error {
  readonly code = ErrorCodes.taleGroupNotFound;

  constructor(readonly taleGroupId: string) {
    super('taleGroupId does not match a tale group');
    this.name = 'TaleGroupNotFoundError';
  }
}

/**
 * Thrown when a zone is asked to place a tale group that does not exist or
 * belongs to another project than the zone's (AD-4). The API answers 400, so
 * a group of a project the caller cannot see is not told apart from none.
 */
export class TaleGroupNotInProjectError extends Error {
  readonly code = ErrorCodes.taleGroupNotFound;

  constructor(
    readonly taleGroupId: string,
    owner = "the zone's project",
  ) {
    super(`taleGroupId does not match a tale group of ${owner}`);
    this.name = 'TaleGroupNotInProjectError';
  }
}

/** Thrown when a request names a tale that does not exist. */
export class TaleNotFoundError extends Error {
  readonly code = ErrorCodes.taleNotFound;

  constructor(readonly taleId: string) {
    super('taleId does not match a tale');
    this.name = 'TaleNotFoundError';
  }
}

/** Thrown when a tale is added to a tale group that already holds the maximum. */
export class TaleGroupFullError extends Error {
  readonly code = ErrorCodes.taleGroupFull;

  constructor(readonly taleGroupId: string) {
    super(`A tale group holds at most ${MAX_TALES_PER_GROUP} tales`);
    this.name = 'TaleGroupFullError';
  }
}

/**
 * Thrown when a tale group would be created in (or copied into, or restored in) a project that
 * already holds {@link MAX_TALE_GROUPS_PER_PROJECT} groups that are not archived (epic UX rework
 * R14). The API answers 409 `tale_group_limit_reached` with this message, which the dashboard shows.
 */
export class TaleGroupLimitError extends Error {
  readonly code = ErrorCodes.taleGroupLimitReached;

  constructor(
    readonly projectId: string,
    reason: 'create' | 'copy' | 'restore' = 'create',
  ) {
    const full = `already has ${MAX_TALE_GROUPS_PER_PROJECT} tale groups that are not archived, the most it can hold.`;
    super(
      reason === 'restore'
        ? `This project ${full} Restoring a tale group needs a free place: archive another tale group first.`
        : reason === 'copy'
          ? `The project of that zone ${full} Archive a tale group there to make room.`
          : `This project ${full} Archive a tale group to make room.`,
    );
    this.name = 'TaleGroupLimitError';
  }
}

/** Thrown when an archived tale group would be placed in a zone; restore it first (epic UX rework R10). */
export class TaleGroupArchivedError extends Error {
  readonly code = ErrorCodes.taleGroupArchived;

  constructor(readonly taleGroupId: string) {
    super('An archived tale group cannot be added to a zone. Restore it first.');
    this.name = 'TaleGroupArchivedError';
  }
}

/**
 * Thrown when a status change is not one of publish, pause, archive or
 * restore from the stored status (AD-6). The API answers 409.
 */
export class InvalidStatusTransitionError extends Error {
  readonly code = ErrorCodes.invalidStatusTransition;

  constructor(
    readonly from: ContentStatus,
    readonly to: SettableStatus,
  ) {
    super(`The status cannot change from ${from} to ${to}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * Thrown when an order request does not list every child of its parent exactly
 * once: an id is missing, repeated, or belongs to another parent.
 */
export class OrderMismatchError extends Error {
  readonly code = ErrorCodes.orderMismatch;

  constructor(message: string) {
    super(message);
    this.name = 'OrderMismatchError';
  }
}

// True when `ids` names every id in `current` exactly once and nothing else.
function isPermutation(ids: readonly string[], current: readonly string[]): boolean {
  if (ids.length !== current.length) return false;
  const known = new Set(current);
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// Rewrites a group's tales to positions 0..n-1 in the order of `ids`.
const REORDER_TALES_SQL = `UPDATE tales SET position = ordered.idx - 1
   FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, idx)
   WHERE tales.id = ordered.id AND tales.tale_group_id = $1`;

// Rewrites a zone's placements to positions 0..n-1 in the order of `ids`; other zones are untouched.
const REORDER_PLACEMENTS_SQL = `UPDATE zone_tale_groups SET position = ordered.idx - 1
   FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, idx)
   WHERE zone_tale_groups.tale_group_id = ordered.id AND zone_tale_groups.zone_id = $1`;

// Serializes every change to one zone's placements (create, place, remove,
// order). The zones table belongs to the zones module, so the zone is locked
// with a transaction-scoped advisory lock keyed on its id, not a row lock.
async function lockZone(tx: Db, zoneId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('tale_groups:' || $1, 0))", [zoneId]);
}

// Serializes every change that adds to a project's count of groups that are not archived (create in
// a zone or in none, copy, the importer's create, restore), so the cap below holds under concurrent
// changes. It is taken first in the transaction, before any other lock: project → zone → source
// group (its row, its tales, its fonts) or import link; on a status change project → the group's row.
async function lockProjectGroups(tx: Db, projectId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('project_tale_groups:' || $1, 0))", [projectId]);
}

// Refuses one more group that is not archived in a project already holding the most. Archived groups
// do not count (owner may revisit): archiving frees a place, and restoring takes one, so a restore is
// checked too. Call it under {@link lockProjectGroups}.
async function checkGroupLimit(
  tx: Db,
  projectId: string,
  reason: 'create' | 'copy' | 'restore' = 'create',
): Promise<void> {
  const { rows } = await tx.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM tale_groups WHERE project_id = $1 AND status <> 'archived'",
    [projectId],
  );
  if ((rows[0]?.count ?? 0) >= MAX_TALE_GROUPS_PER_PROJECT) throw new TaleGroupLimitError(projectId, reason);
}

/** The tale groups placed in the zone, by their position there, each with its tales by position. */
export async function listTaleGroups(db: Db, zoneId: string): Promise<StoredZoneTaleGroup[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  return zoneGroups(db, zoneId);
}

// The zone's placed groups by position, with their tales and zones; the zone is known to exist.
async function zoneGroups(db: Db, zoneId: string): Promise<StoredZoneTaleGroup[]> {
  const groups = await db.query<ZoneGroupRow>(
    `SELECT ${ZONE_GROUP_COLUMNS} FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1
     ORDER BY zone_tale_groups.position, tale_groups.id`,
    [zoneId],
  );
  return withTales(db, groups.rows, zoneId);
}

// One placed group of the zone, or undefined when the group is not placed there.
async function zoneGroup(db: Db, zoneId: string, taleGroupId: string): Promise<StoredZoneTaleGroup | undefined> {
  const { rows } = await db.query<ZoneGroupRow>(
    `SELECT ${ZONE_GROUP_COLUMNS} FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1 AND zone_tale_groups.tale_group_id = $2`,
    [zoneId, taleGroupId],
  );
  const [group] = await withTales(db, rows, zoneId);
  return group;
}

/** One tale group with its tales by position and its zones. Throws {@link TaleGroupNotFoundError}. */
export async function getTaleGroup(db: Db, taleGroupId: string): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const { rows } = await db.query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM tale_groups WHERE id = $1`, [taleGroupId]);
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const [group] = await withTales(db, rows);
  return group;
}

/**
 * Renames a tale group; every zone it is placed in shows the new name (AD-14).
 * Returns the group with its tales and zones. Throws {@link TaleGroupNotFoundError}.
 */
export async function renameTaleGroup(db: Db, taleGroupId: string, name: string): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const { rows } = await db.query<GroupRow>(
    `UPDATE tale_groups SET name = $2 WHERE id = $1 RETURNING ${GROUP_COLUMNS}`,
    [taleGroupId, name],
  );
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const [group] = await withTales(db, rows);
  return group;
}

// Every zone each group is placed in, in the order it was placed, keyed by group id.
async function zoneIdsOf(db: Db, taleGroupIds: string[]): Promise<Map<string, string[]>> {
  const byGroup = new Map<string, string[]>(taleGroupIds.map((id) => [id, []]));
  if (taleGroupIds.length === 0) return byGroup;
  const { rows } = await db.query<{ taleGroupId: string; zoneId: string }>(
    `SELECT tale_group_id AS "taleGroupId", zone_id AS "zoneId" FROM zone_tale_groups
     WHERE tale_group_id = ANY($1::uuid[]) ORDER BY created_at, zone_id`,
    [taleGroupIds],
  );
  for (const row of rows) byGroup.get(row.taleGroupId)?.push(row.zoneId);
  return byGroup;
}

// Adds each group's tales, by position, and the zones it is placed in; computes its status as read
// and the visibility of the group and its tales (R7): in the zone `zoneId` when the zone lists
// them, else in any zone.
async function withTales<T extends GroupRow>(
  db: Db,
  groups: T[],
  zoneId?: string,
  now: Date = new Date(),
): Promise<(Omit<T, keyof GroupRow> & StoredTaleGroup)[]> {
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const tales = await db.query<TaleRow>(
    `SELECT ${TALE_COLUMNS} FROM tales WHERE tale_group_id = ANY($1::uuid[]) ORDER BY position, id`,
    [ids],
  );
  const zoneIds = await zoneIdsOf(db, ids);
  const visible = await groupsAndTalesVisibility(db, ids, now, zoneId);
  return withVisibility(groups, visible.groups).map(({ visibility, ...group }) => ({
    ...toGroup(group as unknown as T),
    visibility,
    zoneIds: zoneIds.get(group.id) ?? [],
    tales: withVisibility(
      tales.rows.filter((tale) => tale.taleGroupId === group.id).map(toTale),
      visible.tales,
    ),
  })) as (Omit<T, keyof GroupRow> & StoredTaleGroup)[];
}

// Tales with their visibility in any zone their group is placed in (R7).
async function visibleTales<T extends { id: string }>(
  db: Db,
  tales: T[],
  now: Date = new Date(),
): Promise<(T & Pick<Tale, 'visibility'>)[]> {
  return withVisibility(
    tales,
    await taleVisibilities(
      db,
      tales.map((tale) => tale.id),
      now,
    ),
  );
}

/** A tale group as the project's list shows it; tags are composed in by the API. */
export type StoredProjectTaleGroup = Omit<ProjectTaleGroup, 'tags'>;

// The tale counts of each group, as the project's list reads them: all tales, and those Shown (`live`).
const COUNT_COLUMNS =
  '(SELECT count(*) FROM tales WHERE tales.tale_group_id = tale_groups.id)::int AS "taleCount", ' +
  `(SELECT count(*) FROM tales WHERE tales.tale_group_id = tale_groups.id AND tales.status = 'live')::int AS "shownTaleCount"`;

type ProjectGroupRow = GroupRow & { taleCount: number; shownTaleCount: number };

// Adds the zones each group is placed in and its visibility in any of them (R7), without its tales.
async function asProjectGroups(db: Db, rows: ProjectGroupRow[]): Promise<StoredProjectTaleGroup[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((g) => g.id);
  const zoneIds = await zoneIdsOf(db, ids);
  const visible = await groupVisibilities(db, ids, new Date());
  return withVisibility(rows, visible).map(({ taleCount, shownTaleCount, visibility, ...row }) => ({
    ...toGroup(row),
    taleCount,
    shownTaleCount,
    zoneIds: zoneIds.get(row.id) ?? [],
    visibility,
  }));
}

/**
 * Every tale group of the project by name, ignoring case, with its cover, its tale counts (all and
 * Shown), the zones it is placed in and its visibility in any of them; a group placed in no zone is
 * listed too (AD-14, epic UX rework R14). Its tales are not read: the zone lists carry them.
 */
export async function listProjectTaleGroups(db: Db, projectId: string): Promise<StoredProjectTaleGroup[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<ProjectGroupRow>(
    `SELECT ${GROUP_COLUMNS}, ${COUNT_COLUMNS} FROM tale_groups WHERE project_id = $1
     ORDER BY lower(name), name, id`,
    [projectId],
  );
  return asProjectGroups(db, rows);
}

/**
 * Creates a tale group in the project, placed in no zone (epic UX rework R14). It starts Off
 * (`draft`, AD-6 amended) with no tales. The caller checks that the project exists. A project at
 * {@link MAX_TALE_GROUPS_PER_PROJECT} groups is refused ({@link TaleGroupLimitError}).
 */
export async function createProjectTaleGroup(
  db: TransactionalDb,
  input: { projectId: string; name: string },
): Promise<StoredProjectTaleGroup> {
  return inTransaction(db, async (tx) => {
    await lockProjectGroups(tx, input.projectId);
    await checkGroupLimit(tx, input.projectId);
    const { rows } = await tx.query<GroupRow>(
      `INSERT INTO tale_groups (project_id, name) VALUES ($1, $2) RETURNING ${GROUP_COLUMNS}`,
      [input.projectId, input.name],
    );
    const [group] = await asProjectGroups(tx, rows.map((row) => ({ ...row, taleCount: 0, shownTaleCount: 0 })));
    return group;
  });
}

/**
 * Creates a tale group in the zone's project and places it at the end of the
 * zone (AD-4, AD-14). Changes to one zone's placements are serialized, so
 * concurrent creates get distinct positions. `withGroup` runs in the same
 * transaction once the group is placed, so a caller can record what it owns
 * about the group (the importer's link, AD-7); if it throws, nothing is created.
 * A project at {@link MAX_TALE_GROUPS_PER_PROJECT} groups not archived is refused ({@link TaleGroupLimitError}).
 */
export async function createTaleGroup(
  db: TransactionalDb,
  input: { zoneId: string; name: string },
  withGroup?: (tx: Db, group: { taleGroupId: string; projectId: string }) => Promise<void>,
): Promise<StoredZoneTaleGroup> {
  // Reads the project through the zones module's public interface (AD-1).
  const projectId = await zoneProjectId(db, input.zoneId);
  if (projectId === null) throw new ZoneNotFoundError(input.zoneId);

  return inTransaction(db, async (tx) => {
    await lockProjectGroups(tx, projectId);
    await lockZone(tx, input.zoneId);
    await checkGroupLimit(tx, projectId);
    const { rows } = await tx.query<GroupRow>(
      `INSERT INTO tale_groups (project_id, name) VALUES ($1, $2) RETURNING ${GROUP_COLUMNS}`,
      [projectId, input.name],
    );
    const group = rows[0];
    const placed = await tx.query<{ position: number }>(
      `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))
       RETURNING position`,
      [input.zoneId, group.id, projectId],
    );
    if (withGroup) await withGroup(tx, { taleGroupId: group.id, projectId });
    const [visibility] = (await groupVisibilities(tx, [group.id], new Date(), input.zoneId)).values();
    return { ...toGroup(group), visibility, position: placed.rows[0].position, zoneIds: [input.zoneId], tales: [] };
  });
}

/**
 * Gives `toZoneId` a copy of every placement of `fromZoneId`, at the same positions, so it lists the
 * same tale groups in the same order (AD-14 amended, AD-17). A group already placed in `toZoneId`
 * keeps its placement. Both zones must be of one project. The zones module's migration calls it
 * when a stage or an extra frame becomes its own zone; run it in that migration's transaction.
 */
export async function copyZonePlacements(db: Db, fromZoneId: string, toZoneId: string): Promise<void> {
  await db.query(
    `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position, created_at)
     SELECT $2, tale_group_id, project_id, position, created_at FROM zone_tale_groups WHERE zone_id = $1
     ON CONFLICT (zone_id, tale_group_id) DO NOTHING`,
    [fromZoneId, toZoneId],
  );
}

/**
 * Places an existing tale group at the end of a zone (AD-14). The group must
 * belong to the zone's project ({@link TaleGroupNotInProjectError} otherwise).
 * A group already placed in the zone stays where it is: `placed` is false.
 * Returns the group with its position in this zone.
 */
export async function placeTaleGroup(
  db: TransactionalDb,
  zoneId: string,
  taleGroupId: string,
): Promise<{ group: StoredZoneTaleGroup; placed: boolean }> {
  const projectId = await zoneProjectId(db, zoneId);
  if (projectId === null) throw new ZoneNotFoundError(zoneId);
  if ((await taleGroupProjectId(db, taleGroupId)) !== projectId) throw new TaleGroupNotInProjectError(taleGroupId);

  return inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    // An archived group is not placed anywhere new; placing it again where it is changes nothing.
    const archived = await tx.query(
      `SELECT 1 FROM tale_groups g
       WHERE g.id = $2 AND g.status = 'archived'
         AND NOT EXISTS (SELECT 1 FROM zone_tale_groups p WHERE p.zone_id = $1 AND p.tale_group_id = g.id)
       FOR SHARE OF g`,
      [zoneId, taleGroupId],
    );
    if (archived.rows.length > 0) throw new TaleGroupArchivedError(taleGroupId);
    // The composite keys refuse a group of another project at the database too (AD-4).
    const inserted = await tx.query(
      `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))
       ON CONFLICT (zone_id, tale_group_id) DO NOTHING`,
      [zoneId, taleGroupId, projectId],
    );
    const group = await zoneGroup(tx, zoneId, taleGroupId);
    // The group was checked above; only a concurrent delete of the group could
    // remove it, and groups are never deleted.
    if (!group) throw new TaleGroupNotInProjectError(taleGroupId);
    return { group, placed: (inserted.rowCount ?? 0) > 0 };
  });
}

/**
 * Copies a tale group into a zone, as a new, independent group of the zone's
 * project, placed after the zone's groups (AD-14). The copy is new content, so
 * it starts `draft` (AD-6); its tales keep their stored statuses. It keeps the name;
 * its tales are new rows with the same titles, positions and media, sharing
 * the media's storage keys (files are not duplicated, AD-11). The caller
 * authorizes both projects. `withCopy` runs in the same transaction once the
 * copy exists, so a caller can add what other modules own, such as tags (AD-1);
 * if it throws, nothing is copied. Throws {@link TaleGroupNotFoundError} for an
 * unknown group, `ZoneNotFoundError` for an unknown zone and {@link TaleGroupLimitError}
 * when the zone's project already holds {@link MAX_TALE_GROUPS_PER_PROJECT} groups not archived.
 */
export async function copyTaleGroup(
  db: TransactionalDb,
  input: { taleGroupId: string; zoneId: string },
  withCopy?: (tx: Db, copy: { sourceTaleGroupId: string; taleGroupId: string; projectId: string }) => Promise<void>,
): Promise<StoredZoneTaleGroup> {
  const { taleGroupId, zoneId } = input;
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const projectId = await zoneProjectId(db, zoneId);
  if (projectId === null) throw new ZoneNotFoundError(zoneId);

  return inTransaction(db, async (tx) => {
    await lockProjectGroups(tx, projectId);
    await lockZone(tx, zoneId);
    // Shares the source group's row lock, so no tale is added to it mid-copy.
    // The row lock also makes a cover replace on the source wait for this copy,
    // so its "still referenced" check sees the copy's cover (AD-11).
    const source = await tx.query<{ name: string; projectId: string } & WindowRow>(
      `SELECT name, project_id AS "projectId", starts_at AS "startsAt", ends_at AS "endsAt"
       FROM tale_groups WHERE id = $1 FOR SHARE`,
      [taleGroupId],
    );
    if (source.rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
    // The copy counts against the target zone's project.
    await checkGroupLimit(tx, projectId, 'copy');
    // The copy keeps the source's start and end time (AD-6) and shares its cover's storage key (AD-14).
    const { rows } = await tx.query<GroupRow>(
      `INSERT INTO tale_groups (project_id, name, starts_at, ends_at, cover_key, cover_content_type, cover_animated)
       SELECT $1, $2, $3, $4, cover_key, cover_content_type, cover_animated FROM tale_groups WHERE id = $5
       RETURNING ${GROUP_COLUMNS}`,
      [projectId, source.rows[0].name, source.rows[0].startsAt, source.rows[0].endsAt, taleGroupId],
    );
    const group = rows[0];
    // Locking the source tales means a media replace on one of them waits for
    // this copy to commit, so its "still referenced" check sees the copy's
    // tales and never deletes a file the copy now uses (AD-11). The same lock
    // keeps the source documents, and so their `tale_media` references, as they
    // are until the copies' references are recorded: a key the copies use stays
    // referenced throughout, so this copy needs no media key locks (R5).
    await tx.query('SELECT 1 FROM tales WHERE tale_group_id = $1 FOR SHARE', [taleGroupId]);
    const sameProject = source.rows[0].projectId === projectId;
    // In the same project the copies reference the source's project fonts: they are share locked
    // before the copies exist, so a font being deleted either went first (and no source still used
    // it) or waits for this copy and then sees the copies' references (R18).
    if (sameProject) {
      await tx.query(
        `SELECT f.id FROM project_fonts f
         WHERE f.id IN (SELECT tf.font_id FROM tale_fonts tf JOIN tales st ON st.id = tf.tale_id
                        WHERE st.tale_group_id = $1)
         ORDER BY f.id FOR SHARE`,
        [taleGroupId],
      );
    }
    // Each copy keeps its tale's published and draft documents (AD-15), starting their own revisions,
    // and its creation time, so a copy of a tale from before the shown-status step is delivered as
    // the source is (`hasPublishedDocument`).
    await tx.query(
      `INSERT INTO tales (tale_group_id, project_id, title, position, media_key, media_content_type, status,
         starts_at, ends_at, document, draft_document, document_media_key, created_at)
       SELECT $2, $3, title, position, media_key, media_content_type, status, starts_at, ends_at, document,
              draft_document, document_media_key, created_at FROM tales
       WHERE tale_group_id = $1 ORDER BY position, id`,
      [taleGroupId, group.id, projectId],
    );
    // Project fonts stay in their project (R18: their licence was confirmed for it), so a copy in
    // another project draws those texts in their fallback stack; in the same project the copies'
    // references are recorded.
    // The copies share the source's media keys (AD-14), recorded for the copy's project too.
    await copyProjectFonts(tx, group.id, sameProject);
    const placed = await tx.query<{ position: number }>(
      `INSERT INTO zone_tale_groups (zone_id, tale_group_id, project_id, position)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM zone_tale_groups WHERE zone_id = $1))
       RETURNING position`,
      [zoneId, group.id, projectId],
    );
    if (withCopy) await withCopy(tx, { sourceTaleGroupId: taleGroupId.toLowerCase(), taleGroupId: group.id, projectId });
    const [copy] = await withTales(tx, [{ ...group, position: placed.rows[0].position }], zoneId);
    return copy;
  });
}

// For the copied group's tales: in the same project, records the project fonts their draft and
// published documents use; in another project, replaces them by their fallback stacks. Either way
// it records the media their documents use for the copy's project (AD-14: copies share storage
// keys, and the copy may be in another project).
async function copyProjectFonts(tx: Db, taleGroupId: string, sameProject: boolean): Promise<void> {
  const { rows } = await tx.query<{ id: string; document: unknown; draft: unknown }>(
    'SELECT id, document, draft_document AS draft FROM tales WHERE tale_group_id = $1',
    [taleGroupId],
  );
  for (const row of rows) {
    if (usesMedia(row.document) || usesMedia(row.draft)) {
      await recordTaleMedia(tx, row.id, 'draft', row.draft, false);
      await recordTaleMedia(tx, row.id, 'published', row.document, isCheckedDocument(row.document));
    }
    if (projectFontIds(row.document).length === 0 && projectFontIds(row.draft).length === 0) continue;
    if (sameProject) {
      await recordTaleFonts(tx, row.id, 'draft', row.draft, false);
      await recordTaleFonts(tx, row.id, 'published', row.document, isCheckedDocument(row.document));
      continue;
    }
    const document = withoutProjectFonts(row.document);
    const draft = withoutProjectFonts(row.draft);
    await tx.query('UPDATE tales SET document = $2::jsonb, draft_document = $3::jsonb WHERE id = $1', [
      row.id,
      document === null ? null : JSON.stringify(document),
      draft === null ? null : JSON.stringify(draft),
    ]);
  }
}

// True when a stored document passes the document and publish checks, as the Delivery API requires.
function isCheckedDocument(doc: unknown): boolean {
  try {
    checkPublishableDocument(doc);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes a tale group from a zone: only that placement goes; the group, its
 * tales and its other placements stay (AD-14). The zone's remaining positions
 * become 0..n-1 again. Throws {@link TaleGroupNotFoundError} when the group is
 * not placed in the zone.
 */
export async function removeTaleGroup(db: TransactionalDb, zoneId: string, taleGroupId: string): Promise<void> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);

  await inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    const removed = await tx.query(
      'DELETE FROM zone_tale_groups WHERE zone_id = $1 AND tale_group_id = $2',
      [zoneId, taleGroupId],
    );
    if ((removed.rowCount ?? 0) === 0) throw new TaleGroupNotFoundError(taleGroupId);
    await tx.query(
      `UPDATE zone_tale_groups SET position = dense.idx - 1
       FROM (
         SELECT tale_group_id, row_number() OVER (ORDER BY position, tale_group_id) AS idx
         FROM zone_tale_groups WHERE zone_id = $1
       ) dense
       WHERE zone_tale_groups.zone_id = $1 AND zone_tale_groups.tale_group_id = dense.tale_group_id
         AND zone_tale_groups.position <> dense.idx - 1`,
      [zoneId],
    );
  });
}

/**
 * Sets the order of the groups placed in a zone. `taleGroupIds` must list
 * every group placed in the zone exactly once ({@link OrderMismatchError}
 * otherwise); positions in this zone become 0..n-1 in that order, and other
 * zones keep theirs (AD-14). Holds the same zone lock as {@link createTaleGroup},
 * {@link placeTaleGroup} and {@link removeTaleGroup}, so they cannot interleave.
 * Returns the zone's groups in the new order.
 */
export async function orderTaleGroups(
  db: TransactionalDb,
  zoneId: string,
  taleGroupIds: readonly string[],
): Promise<StoredZoneTaleGroup[]> {
  if ((await zoneProjectId(db, zoneId)) === null) throw new ZoneNotFoundError(zoneId);

  return inTransaction(db, async (tx) => {
    await lockZone(tx, zoneId);
    const current = await tx.query<{ id: string }>(
      'SELECT tale_group_id AS id FROM zone_tale_groups WHERE zone_id = $1',
      [zoneId],
    );
    const currentIds = current.rows.map((r) => r.id);
    if (!isPermutation(taleGroupIds.map((id) => id.toLowerCase()), currentIds)) {
      throw new OrderMismatchError('taleGroupIds must list every tale group of the zone exactly once');
    }
    if (currentIds.length > 0) await tx.query(REORDER_PLACEMENTS_SQL, [zoneId, taleGroupIds]);
    return zoneGroups(tx, zoneId);
  });
}

/**
 * Sets the order of a tale group's tales. `taleIds` must list every tale of
 * the group exactly once ({@link OrderMismatchError} otherwise); positions
 * become 0..n-1 in that order. Locks the group row, as {@link createTale}
 * does, so an order and an add cannot interleave. Returns the group's tales
 * in the new order.
 */
export async function orderTales(
  db: TransactionalDb,
  taleGroupId: string,
  taleIds: readonly string[],
): Promise<Tale[]> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);

  return inTransaction(db, async (tx) => {
    const group = await tx.query('SELECT 1 FROM tale_groups WHERE id = $1 FOR UPDATE', [taleGroupId]);
    if (group.rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
    const current = await tx.query<{ id: string }>('SELECT id FROM tales WHERE tale_group_id = $1', [taleGroupId]);
    const currentIds = current.rows.map((r) => r.id);
    if (!isPermutation(taleIds.map((id) => id.toLowerCase()), currentIds)) {
      throw new OrderMismatchError('taleIds must list every tale of the tale group exactly once');
    }
    if (currentIds.length > 0) await tx.query(REORDER_TALES_SQL, [taleGroupId, taleIds]);
    const { rows } = await tx.query<TaleRow>(
      `SELECT ${TALE_COLUMNS} FROM tales WHERE tale_group_id = $1 ORDER BY position, id`,
      [taleGroupId],
    );
    return visibleTales(tx, rows.map(toTale));
  });
}

/**
 * Sets the order of a zone's placements when `decide` says so, on the
 * caller's transaction: the zone is locked as {@link orderTaleGroups} locks
 * it, `decide` gets the placed groups' ids by position and answers the new
 * order (every one of them once, {@link OrderMismatchError} otherwise), or null
 * to leave it. Returns the order before and after, or null when the zone does
 * not exist. The importer uses it to keep an order a person changed.
 */
export async function orderTaleGroupsWhen(
  db: Db,
  zoneId: string,
  decide: (current: readonly string[]) => readonly string[] | null,
): Promise<{ before: string[]; after: string[] } | null> {
  if ((await zoneProjectId(db, zoneId)) === null) return null;
  await lockZone(db, zoneId);
  const { rows } = await db.query<{ id: string }>(
    'SELECT tale_group_id AS id FROM zone_tale_groups WHERE zone_id = $1 ORDER BY position, tale_group_id',
    [zoneId],
  );
  const before = rows.map((r) => r.id);
  const next = decide(before);
  if (next === null || sameOrder(next, before)) return { before, after: before };
  const after = next.map((id) => id.toLowerCase());
  if (!isPermutation(after, before)) {
    throw new OrderMismatchError('taleGroupIds must list every tale group of the zone exactly once');
  }
  await db.query(REORDER_PLACEMENTS_SQL, [zoneId, after]);
  return { before, after };
}

/**
 * Sets the order of a tale group's tales when `decide` says so, on the
 * caller's transaction, as {@link orderTaleGroupsWhen} does for a zone: the
 * group row is locked as {@link orderTales} locks it. Returns the order
 * before and after, or null when the group does not exist.
 */
export async function orderTalesWhen(
  db: Db,
  taleGroupId: string,
  decide: (current: readonly string[]) => readonly string[] | null,
): Promise<{ before: string[]; after: string[] } | null> {
  if (!UUID.test(taleGroupId)) return null;
  const group = await db.query('SELECT 1 FROM tale_groups WHERE id = $1 FOR NO KEY UPDATE', [taleGroupId]);
  if (group.rows.length === 0) return null;
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tales WHERE tale_group_id = $1 ORDER BY position, id',
    [taleGroupId],
  );
  const before = rows.map((r) => r.id);
  const next = decide(before);
  if (next === null || sameOrder(next, before)) return { before, after: before };
  const after = next.map((id) => id.toLowerCase());
  if (!isPermutation(after, before)) {
    throw new OrderMismatchError('taleIds must list every tale of the tale group exactly once');
  }
  await db.query(REORDER_TALES_SQL, [taleGroupId, after]);
  return { before, after };
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id.toLowerCase() === b[i]);

/**
 * Renames a tale group when `decide` says so, on the caller's transaction:
 * the group row is locked, `decide` gets its current name and answers the new
 * one, or null to leave it. Returns the name before and after, or null when
 * the group does not exist.
 */
export async function renameTaleGroupWhen(
  db: Db,
  taleGroupId: string,
  decide: (current: string) => string | null,
): Promise<{ before: string; after: string } | null> {
  if (!UUID.test(taleGroupId)) return null;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM tale_groups WHERE id = $1 FOR NO KEY UPDATE', [
    taleGroupId,
  ]);
  if (rows.length === 0) return null;
  const before = rows[0].name;
  const next = decide(before);
  if (next === null || next === before) return { before, after: before };
  await db.query('UPDATE tale_groups SET name = $2 WHERE id = $1', [taleGroupId, next]);
  return { before, after: next };
}

/**
 * Retitles a tale when `decide` says so, as {@link renameTaleGroupWhen} does
 * for a group, with the tale row locked. Returns the title before and after
 * and the tale's group, or null when the tale does not exist.
 */
export async function renameTaleWhen(
  db: Db,
  taleId: string,
  decide: (current: string) => string | null,
): Promise<{ before: string; after: string; taleGroupId: string } | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await db.query<{ title: string; taleGroupId: string }>(
    'SELECT title, tale_group_id AS "taleGroupId" FROM tales WHERE id = $1 FOR NO KEY UPDATE',
    [taleId],
  );
  if (rows.length === 0) return null;
  const { title: before, taleGroupId } = rows[0];
  const next = decide(before);
  if (next === null || next === before) return { before, after: before, taleGroupId };
  await db.query('UPDATE tales SET title = $2 WHERE id = $1', [taleId, next]);
  return { before, after: next, taleGroupId };
}

/**
 * Sets a tale group's stored status (AD-6): publish, pause, archive or
 * restore, as {@link canSetStatus} allows; the current status again changes
 * nothing. The group row is locked, so concurrent changes apply one after the
 * other. Returns the group with its tales, whose status as read follows it.
 * A restore in a project already at {@link MAX_TALE_GROUPS_PER_PROJECT} groups not archived is
 * refused ({@link TaleGroupLimitError}).
 * Throws {@link TaleGroupNotFoundError} and {@link InvalidStatusTransitionError}.
 */
export async function setTaleGroupStatus(
  db: TransactionalDb,
  taleGroupId: string,
  status: SettableStatus,
): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);

  return inTransaction(db, async (tx) => {
    // A restore takes a place under the cap (R14): every change other than to archived takes the
    // project's group lock before the row's, the order creates and copies use. A group's project
    // never changes, so it is read before the lock.
    if (status !== 'archived') {
      const owner = await tx.query<{ projectId: string }>(
        'SELECT project_id AS "projectId" FROM tale_groups WHERE id = $1',
        [taleGroupId],
      );
      if (owner.rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
      await lockProjectGroups(tx, owner.rows[0].projectId);
    }
    const current = await tx.query<{ status: ContentStatus; projectId: string }>(
      'SELECT status, project_id AS "projectId" FROM tale_groups WHERE id = $1 FOR UPDATE',
      [taleGroupId],
    );
    if (current.rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
    const from = current.rows[0].status;
    if (!canSetStatus(from, status)) throw new InvalidStatusTransitionError(from, status);
    if (from === 'archived' && status !== 'archived') await checkGroupLimit(tx, current.rows[0].projectId, 'restore');
    const { rows } =
      from === status
        ? await tx.query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM tale_groups WHERE id = $1`, [taleGroupId])
        : await tx.query<GroupRow>(`UPDATE tale_groups SET status = $2 WHERE id = $1 RETURNING ${GROUP_COLUMNS}`, [
            taleGroupId,
            status,
          ]);
    const [group] = await withTales(tx, rows);
    return group;
  });
}

/**
 * Sets a tale's stored status (AD-6), with the same rules as
 * {@link setTaleGroupStatus}. Setting `live` on a tale that has nothing
 * published yet (no published document, or published revision 0), from any
 * status, also publishes its draft document in the same transaction (AD-15),
 * after checking it again; a tale that already has a published document keeps
 * it. A draft that no longer passes is not published: the status still
 * changes, and the answer carries `draftNotPublished: true`. Returns the tale
 * with its status as read.
 * Throws {@link TaleNotFoundError} and {@link InvalidStatusTransitionError}.
 */
export async function setTaleStatus(
  db: TransactionalDb,
  taleId: string,
  status: SettableStatus,
): Promise<Tale & { draftNotPublished?: true; draftNotPublishedReason?: string }> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);

  return inTransaction(db, async (tx) => {
    const current = await tx.query<{ status: ContentStatus; draft: unknown; unpublished: boolean }>(
      `SELECT status, draft_document AS draft, (document IS NULL OR document_revision = 0) AS unpublished
       FROM tales WHERE id = $1 FOR UPDATE`,
      [taleId],
    );
    if (current.rows.length === 0) throw new TaleNotFoundError(taleId);
    const { status: from, draft, unpublished } = current.rows[0];
    if (!canSetStatus(from, status)) throw new InvalidStatusTransitionError(from, status);
    let draftNotPublished = false;
    let reason = '';
    if (from !== 'live' && status === 'live' && unpublished && draft !== null && draft !== undefined) {
      const problem = await publishDraftGoingLive(tx, taleId, draft);
      if (problem !== null) {
        draftNotPublished = true;
        reason = problem;
      }
    }
    const { rows } =
      from === status
        ? await tx.query<TaleRow>(`SELECT ${TALE_COLUMNS} FROM tales WHERE id = $1`, [taleId])
        : await tx.query<TaleRow>(`UPDATE tales SET status = $2 WHERE id = $1 RETURNING ${TALE_COLUMNS}`, [
            taleId,
            status,
          ]);
    const [tale] = await visibleTales(tx, [toTale(rows[0])]);
    return draftNotPublished ? { ...tale, draftNotPublished: true, draftNotPublishedReason: reason } : tale;
  });
}

/**
 * Publishes the draft of a tale going live with nothing published yet (AD-15), in the caller's
 * transaction, after checking it again; the tale row must be locked. Returns null once published,
 * or why the draft was not (it no longer passes), in which case nothing is written.
 */
export async function publishDraftGoingLive(tx: Db, taleId: string, draft: unknown): Promise<string | null> {
  try {
    checkPublishableDocument(draft);
    if (usesMedia(draft)) {
      const owner = await tx.query<{ projectId: string }>('SELECT project_id AS "projectId" FROM tales WHERE id = $1', [
        taleId,
      ]);
      await checkDocumentMedia(tx, owner.rows[0].projectId, draft);
    }
    await tx.query(
      `UPDATE tales SET document = draft_document, document_revision = document_revision + 1 WHERE id = $1`,
      [taleId],
    );
    await recordTaleFonts(tx, taleId, 'published', draft, true);
    await recordTaleMedia(tx, taleId, 'published', draft, true);
    return null;
  } catch (err) {
    if (!(err instanceof InvalidTaleDocumentError || err instanceof TaleDocumentTooLargeError)) throw err;
    return draftProblem(err, draft);
  }
}

/**
 * Thrown when a start and end time is not acceptable: the end is not later
 * than the start (AD-6). The API answers 400 `validation_failed`.
 */
export class InvalidScheduleError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super('endsAt must be later than startsAt');
    this.name = 'InvalidScheduleError';
  }
}

/**
 * Sets or clears a tale group's start and end time (AD-6). Its status as
 * read follows from the window when it is read; nothing stores `scheduled`
 * or `expired`. Returns the group with its tales.
 * Throws {@link TaleGroupNotFoundError} and {@link InvalidScheduleError}.
 */
export async function setTaleGroupSchedule(
  db: Db,
  taleGroupId: string,
  window: StoredWindow,
): Promise<StoredTaleGroup> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  if (!isValidWindow(window)) throw new InvalidScheduleError();
  const { rows } = await db.query<GroupRow>(
    `UPDATE tale_groups SET starts_at = $2, ends_at = $3 WHERE id = $1 RETURNING ${GROUP_COLUMNS}`,
    [taleGroupId, window.startsAt, window.endsAt],
  );
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const [group] = await withTales(db, rows);
  return group;
}

/**
 * Sets or clears a tale's start and end time (AD-6), as
 * {@link setTaleGroupSchedule} does for a group. Returns the tale with its
 * status as read. Throws {@link TaleNotFoundError} and {@link InvalidScheduleError}.
 */
export async function setTaleSchedule(db: Db, taleId: string, window: StoredWindow): Promise<Tale> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  if (!isValidWindow(window)) throw new InvalidScheduleError();
  const { rows } = await db.query<TaleRow>(
    `UPDATE tales SET starts_at = $2, ends_at = $3 WHERE id = $1 RETURNING ${TALE_COLUMNS}`,
    [taleId, window.startsAt, window.endsAt],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const [tale] = await visibleTales(db, [toTale(rows[0])]);
  return tale;
}

/** The project of a tale group, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleGroupProjectId(db: Db, taleGroupId: string): Promise<string | null> {
  if (!UUID.test(taleGroupId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM tale_groups WHERE id = $1', [
    taleGroupId,
  ]);
  return rows[0]?.project_id ?? null;
}

/** The project of a tale, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleProjectId(db: Db, taleId: string): Promise<string | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await db.query<{ project_id: string }>('SELECT project_id FROM tales WHERE id = $1', [taleId]);
  return rows[0]?.project_id ?? null;
}

/** True when a tale group with this id exists. Ids that are not UUIDs never match. */
export async function taleGroupExists(db: Db, taleGroupId: string): Promise<boolean> {
  if (!UUID.test(taleGroupId)) return false;
  const { rows } = await db.query('SELECT 1 FROM tale_groups WHERE id = $1', [taleGroupId]);
  return rows.length > 0;
}

/**
 * Adds a tale at the end of a tale group. The tale takes its project from the
 * group (AD-4). The group row is locked, so the position and the
 * {@link MAX_TALES_PER_GROUP} check hold under concurrent adds. `withTale`
 * runs in the same transaction once the tale exists, as `withGroup` does for
 * {@link createTaleGroup}; if it throws, the tale is not created. The tale is
 * stored `live` (Shown, AD-6 amended) unless `status` says `paused` (Hidden),
 * as the importer does for a story that is not active at the source.
 */
export async function createTale(
  db: TransactionalDb,
  input: { taleGroupId: string; title: string; status?: 'live' | 'paused' },
  withTale?: (tx: Db, tale: { taleId: string; projectId: string }) => Promise<void>,
): Promise<Tale> {
  if (!UUID.test(input.taleGroupId)) throw new TaleGroupNotFoundError(input.taleGroupId);

  return inTransaction(db, async (tx) => {
    const group = await tx.query<{ project_id: string }>(
      'SELECT project_id FROM tale_groups WHERE id = $1 FOR UPDATE',
      [input.taleGroupId],
    );
    const projectId = group.rows[0]?.project_id;
    if (projectId === undefined) throw new TaleGroupNotFoundError(input.taleGroupId);

    const stats = await tx.query<{ count: number; next: number }>(
      `SELECT count(*)::int AS count, COALESCE(MAX(position), -1) + 1 AS next
       FROM tales WHERE tale_group_id = $1`,
      [input.taleGroupId],
    );
    const { count, next } = stats.rows[0];
    if (count >= MAX_TALES_PER_GROUP) throw new TaleGroupFullError(input.taleGroupId);

    // New tales are Shown (AD-6 amended 2026-10-23): a group turned On shows them, once they
    // have a published document (uploading their media writes it, AD-15).
    const { rows } = await tx.query<TaleRow>(
      `INSERT INTO tales (tale_group_id, project_id, title, position, status) VALUES ($1, $2, $3, $4, $5)
       RETURNING ${TALE_COLUMNS}`,
      [input.taleGroupId, projectId, input.title, next, input.status ?? NEW_TALE_STATUS],
    );
    if (withTale) await withTale(tx, { taleId: rows[0].id, projectId });
    const [tale] = await visibleTales(tx, [toTale(rows[0])]);
    return tale;
  });
}

/**
 * Keeps a document as a new tale in the source tale's group (epic Tale Studio R9): for an editor
 * whose save was refused as stale, so their version is not lost. The document is checked as a
 * save checks it ({@link checkTaleDocument}) before anything is written. In one transaction the
 * group row is locked, so the {@link MAX_TALES_PER_GROUP} check and the position hold under
 * concurrent adds; the new tale is a `draft` at the end of the group, titled after the source
 * with " (copy)", sharing the source's media key (AD-14), holding the document as its draft at
 * revision 1, with nothing published yet: publishing the tale publishes it.
 * Throws {@link TaleNotFoundError}, {@link TaleGroupFullError} and the document's errors.
 */
export async function copyTaleWithDocument(
  db: TransactionalDb,
  taleId: string,
  value: unknown,
  options: { sawTaleMedia?: boolean } = {},
): Promise<Tale> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  let document = checkTaleDocument(value);

  return inTransaction(db, async (tx) => {
    const groupOf = await tx.query<{
      groupId: string;
      projectId: string;
      key: string | null;
      contentType: string | null;
    }>(
      `SELECT tale_group_id AS "groupId", project_id AS "projectId", media_key AS key,
         media_content_type AS "contentType" FROM tales WHERE id = $1`,
      [taleId],
    );
    const groupId = groupOf.rows[0]?.groupId;
    if (groupId === undefined) throw new TaleNotFoundError(taleId);
    await tx.query('SELECT 1 FROM tale_groups WHERE id = $1 FOR UPDATE', [groupId]);
    // The source is read under a share lock, after the group's, as copyTaleGroup does.
    const source = await tx.query('SELECT 1 FROM tales WHERE id = $1 FOR SHARE', [taleId]);
    if (source.rows.length === 0) throw new TaleNotFoundError(taleId);
    // Its project fonts and media must be the project's, and stay until this commits (R14, R18).
    // Locked after the rows, in the order every document write takes them: rows, then fonts and keys.
    await checkDocumentFonts(tx, groupOf.rows[0].projectId, document, true);
    await checkDocumentMedia(tx, groupOf.rows[0].projectId, document);
    // The copy shares the source's media (AD-14), so only that may be its own media (R16).
    document = ownTaleMediaOnly(document, groupOf.rows[0]);
    // In step when the editor loaded the media as an element (what it keeps is the person's choice)
    // or the kept document holds it as its own; else the copy is out of step, its media composed in
    // on delivery and merged by the next migration run (R16).
    const sourceKey = groupOf.rows[0].key;
    const inStep =
      sourceKey !== null &&
      taleMediaDocumentsEnabled() &&
      (options.sawTaleMedia === true ||
        document.elements.some(
          (e) => isTaleMediaElement(e) && (e.props as { mediaKey?: unknown }).mediaKey === sourceKey,
        ));

    const stats = await tx.query<{ count: number; next: number }>(
      `SELECT count(*)::int AS count, COALESCE(MAX(position), -1) + 1 AS next
       FROM tales WHERE tale_group_id = $1`,
      [groupId],
    );
    const { count, next } = stats.rows[0];
    if (count >= MAX_TALES_PER_GROUP) throw new TaleGroupFullError(groupId);

    // The status, schedule and position are the new row's own: a draft, unscheduled, last.
    const { rows } = await tx.query<TaleRow>(
      `INSERT INTO tales (tale_group_id, project_id, title, position, media_key, media_content_type,
                          document_media_key, draft_document, draft_revision)
       SELECT tale_group_id, project_id, title || ' (copy)', $2, media_key, media_content_type,
              CASE WHEN $4 THEN media_key END, $3::jsonb, 1
       FROM tales WHERE id = $1
       RETURNING ${TALE_COLUMNS}`,
      [taleId, next, JSON.stringify(document), inStep],
    );
    if (rows.length === 0) throw new TaleNotFoundError(taleId);
    await recordTaleFonts(tx, rows[0].id, 'draft', document, false);
    await recordTaleMedia(tx, rows[0].id, 'draft', document, false);
    const [tale] = await visibleTales(tx, [toTale(rows[0])]);
    return tale;
  });
}

/** A tale's document, with each element given the new id `ids` holds for it (made on first use). */
function withNewElementIds(doc: unknown, ids: Map<string, string>): unknown {
  if (typeof doc !== 'object' || doc === null || !Array.isArray((doc as { elements?: unknown }).elements)) return doc;
  const elements = (doc as { elements: unknown[] }).elements.map((element) => {
    if (typeof element !== 'object' || element === null) return element;
    const id = (element as { id?: unknown }).id;
    if (typeof id !== 'string') return element;
    let next = ids.get(id);
    if (next === undefined) {
      next = randomUUID();
      ids.set(id, next);
    }
    return { ...element, id: next };
  });
  return { ...doc, elements };
}

/**
 * Duplicates a tale with its documents (epic Tale Studio R11, PRD FR-012) into its own tale group
 * or another group of its project (`taleGroupId`; {@link TaleGroupNotInProjectError} for a group
 * that does not exist or is in another project, AD-4). The copy:
 * - is stored `paused` (Hidden, owner decision 2026-10-22), so it never shows twice on the site;
 * - is placed right after the original in the original's group (the later tales move one on), or
 *   last in another group; the target group's row is locked, so the {@link MAX_TALES_PER_GROUP}
 *   check ({@link TaleGroupFullError}) and the positions hold under concurrent adds and duplicates;
 * - holds the original's published document as its published document and the original's draft
 *   as its draft (AD-15), each at revision 1 (0 when absent), so "Update tale" means the same on
 *   both; every element gets a new id, the same new id in both documents;
 * - shares the original's storage keys, never copying a file (AD-14): its tale media and the media
 *   and project fonts its documents use, recorded in `tale_media` and `tale_fonts` for the copy, so
 *   a file the copy uses is never judged unused while the copy holds it ({@link isMediaKeyInUse});
 * - keeps the title (with " (copy)"), start and end time and R16 media state (an out-of-step
 *   original gives an out-of-step copy, composed on delivery and merged by the media migration);
 * - is a new tale, created now (decision 2026-10-22): it does not inherit the legacy delivery of a
 *   tale from before the shown-status step, so a copy of one with no published document reads
 *   "not updated yet" until someone presses Update tale (`hasPublishedDocument`).
 * Throws {@link TaleNotFoundError}.
 */
export async function duplicateTale(
  db: TransactionalDb,
  taleId: string,
  input: { taleGroupId?: string } = {},
): Promise<Tale> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const wanted = input.taleGroupId;
  if (wanted !== undefined && !UUID.test(wanted)) throw new TaleGroupNotInProjectError(wanted, "the tale's project");

  return inTransaction(db, async (tx) => {
    const of = await tx.query<{ groupId: string; projectId: string }>(
      'SELECT tale_group_id AS "groupId", project_id AS "projectId" FROM tales WHERE id = $1',
      [taleId],
    );
    if (of.rows.length === 0) throw new TaleNotFoundError(taleId);
    const { groupId, projectId } = of.rows[0];
    const targetId = (wanted ?? groupId).toLowerCase();
    // The target group first, then the source row, in the order copyTaleWithDocument takes them.
    const target = await tx.query<{ projectId: string }>(
      'SELECT project_id AS "projectId" FROM tale_groups WHERE id = $1 FOR UPDATE',
      [targetId],
    );
    if (target.rows[0]?.projectId !== projectId) throw new TaleGroupNotInProjectError(targetId, "the tale's project");
    // Share locked: a media replace or a document write on the original waits for this copy to
    // commit, so its "still referenced" check sees the copy, and the documents copied keep their
    // `tale_media` rows until the copy's own are recorded (as copyTaleGroup reasons).
    const source = await tx.query<{ position: number; groupId: string; document: unknown; draft: unknown }>(
      `SELECT position, tale_group_id AS "groupId", document, draft_document AS draft
       FROM tales WHERE id = $1 FOR SHARE`,
      [taleId],
    );
    if (source.rows.length === 0) throw new TaleNotFoundError(taleId);
    // Its project fonts stay until this commits: a font being deleted went first (and the original
    // no longer used it) or waits and then sees the copy's references (R18).
    await tx.query(
      `SELECT f.id FROM project_fonts f
       WHERE f.id IN (SELECT font_id FROM tale_fonts WHERE tale_id = $1)
       ORDER BY f.id FOR SHARE`,
      [taleId],
    );

    const stats = await tx.query<{ count: number; next: number }>(
      `SELECT count(*)::int AS count, COALESCE(MAX(position), -1) + 1 AS next
       FROM tales WHERE tale_group_id = $1`,
      [targetId],
    );
    if (stats.rows[0].count >= MAX_TALES_PER_GROUP) throw new TaleGroupFullError(targetId);
    let position = stats.rows[0].next;
    if (source.rows[0].groupId === targetId) {
      position = source.rows[0].position + 1;
      await tx.query('UPDATE tales SET position = position + 1 WHERE tale_group_id = $1 AND position >= $2', [
        targetId,
        position,
      ]);
    }

    const ids = new Map<string, string>();
    const document = withNewElementIds(source.rows[0].document, ids);
    const draft = withNewElementIds(source.rows[0].draft, ids);
    const { rows } = await tx.query<TaleRow>(
      `INSERT INTO tales (tale_group_id, project_id, title, position, status, starts_at, ends_at, media_key,
         media_content_type, document_media_key, document_created_by_migration, document, document_revision,
         draft_document, draft_revision)
       SELECT $2, project_id, title || ' (copy)', $3, 'paused', starts_at, ends_at, media_key, media_content_type,
              document_media_key, document_created_by_migration, $4::jsonb,
              CASE WHEN $4::jsonb IS NULL THEN 0 ELSE 1 END, $5::jsonb,
              CASE WHEN $5::jsonb IS NULL THEN 0 ELSE 1 END
       FROM tales WHERE id = $1
       RETURNING ${TALE_COLUMNS}`,
      [
        taleId,
        targetId,
        position,
        document === null ? null : JSON.stringify(document),
        draft === null ? null : JSON.stringify(draft),
      ],
    );
    const copyId = rows[0].id;
    const deliverable = isCheckedDocument(document);
    await recordTaleFonts(tx, copyId, 'draft', draft, false);
    await recordTaleFonts(tx, copyId, 'published', document, deliverable);
    await recordTaleMedia(tx, copyId, 'draft', draft, false);
    await recordTaleMedia(tx, copyId, 'published', document, deliverable);
    const [tale] = await visibleTales(tx, [toTale(rows[0])]);
    return tale;
  });
}

/** What {@link deleteTale} removed: the tale's group and project, and the storage keys it referenced. */
export interface DeletedTale {
  taleId: string;
  taleGroupId: string;
  projectId: string;
  /**
   * The storage keys the tale referenced (its media and its documents' media), for the caller to
   * delete each file through {@link withMediaKeyDeletionGuard}, only when nothing references it
   * any more: copies share keys (AD-14) and a project's uploads stay in its media.
   */
  mediaKeys: string[];
}

/**
 * Deletes a tale (epic UX rework R11, story 8.20) in one transaction: the tale row with its
 * documents, its `tale_media` and `tale_fonts` rows (their foreign keys cascade), and the group's
 * remaining tales renumbered 0..n-1. The group row is locked first, then the tale's, the order
 * {@link createTale}, {@link orderTales} and {@link duplicateTale} (the target group, then the
 * source tale) take, so a delete and an add, an order or a duplicate apply one after the other: a
 * duplicate that comes first records the copy's references (its files stay), one that comes after
 * finds no tale. No file is deleted here, and project fonts stay (they are the project's).
 * Throws {@link TaleNotFoundError}.
 */
export async function deleteTale(db: TransactionalDb, taleId: string): Promise<DeletedTale> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);

  return inTransaction(db, async (tx) => {
    const of = await tx.query<{ groupId: string }>('SELECT tale_group_id AS "groupId" FROM tales WHERE id = $1', [
      taleId,
    ]);
    if (of.rows.length === 0) throw new TaleNotFoundError(taleId);
    // A tale never moves to another group, so its group read before the lock is still its group.
    const { groupId } = of.rows[0];
    await tx.query('SELECT 1 FROM tale_groups WHERE id = $1 FOR UPDATE', [groupId]);
    const tale = await tx.query<{ projectId: string; mediaKey: string | null }>(
      'SELECT project_id AS "projectId", media_key AS "mediaKey" FROM tales WHERE id = $1 FOR UPDATE',
      [taleId],
    );
    if (tale.rows.length === 0) throw new TaleNotFoundError(taleId);
    const { projectId, mediaKey } = tale.rows[0];
    // Read under the tale's lock: a document write recording more keys went first, or finds no tale.
    const media = await tx.query<{ key: string }>(
      'SELECT DISTINCT storage_key AS key FROM tale_media WHERE tale_id = $1',
      [taleId],
    );
    await tx.query('DELETE FROM tales WHERE id = $1', [taleId]);
    await tx.query(
      `UPDATE tales SET position = dense.idx - 1
       FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS idx FROM tales WHERE tale_group_id = $1) dense
       WHERE tales.id = dense.id AND tales.position <> dense.idx - 1`,
      [groupId],
    );
    const keys = new Set(media.rows.map((r) => r.key));
    if (mediaKey !== null) keys.add(mediaKey);
    return { taleId: taleId.toLowerCase(), taleGroupId: groupId, projectId, mediaKeys: [...keys].sort() };
  });
}

/** A tale group's name, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleGroupName(db: Db, taleGroupId: string): Promise<string | null> {
  if (!UUID.test(taleGroupId)) return null;
  const { rows } = await db.query<{ name: string }>('SELECT name FROM tale_groups WHERE id = $1', [taleGroupId]);
  return rows[0]?.name ?? null;
}

/** A tale's title, or null when it does not exist. Ids that are not UUIDs never match. */
export async function taleTitle(db: Db, taleId: string): Promise<string | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await db.query<{ title: string }>('SELECT title FROM tales WHERE id = $1', [taleId]);
  return rows[0]?.title ?? null;
}

/**
 * One tale with its status as read and its visibility in any zone its group is placed in (R7), as
 * Tale Studio's status line shows it (story 8.4). Throws {@link TaleNotFoundError}.
 */
export async function getTale(db: Db, taleId: string): Promise<Tale> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rows } = await db.query<TaleRow>(`SELECT ${TALE_COLUMNS} FROM tales WHERE id = $1`, [taleId]);
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const [tale] = await visibleTales(db, [toTale(rows[0])]);
  return tale;
}

/** True when a tale with this id exists. Ids that are not UUIDs never match. */
export async function taleExists(db: Db, taleId: string): Promise<boolean> {
  if (!UUID.test(taleId)) return false;
  const { rows } = await db.query('SELECT 1 FROM tales WHERE id = $1', [taleId]);
  return rows.length > 0;
}

/** The tale's stored media, or null when it has none. Throws {@link TaleNotFoundError}. */
export async function getTaleMedia(db: Db, taleId: string): Promise<StoredTaleMedia | null> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rows } = await db.query<{ key: string | null; contentType: string | null }>(
    'SELECT media_key AS key, media_content_type AS "contentType" FROM tales WHERE id = $1',
    [taleId],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const { key, contentType } = rows[0];
  return key !== null && isMediaContentType(contentType) ? { key, contentType } : null;
}

/**
 * Points the tale at newly stored media, and brings its documents in step (R16): their `taleMedia`
 * element takes the new key, or the media goes in at the bottom of a document that has none; a
 * tale with no draft gets one of only its media (see {@link bringTaleMediaInStep}). One
 * transaction. Returns the updated tale and the key it pointed at before (null when none). A copied
 * tale shares its media's key (AD-14), so the caller deletes that file only through
 * {@link withMediaKeyDeletionGuard}, when nothing references it any more. Throws {@link TaleNotFoundError}.
 */
export async function setTaleMedia(
  db: TransactionalDb,
  taleId: string,
  media: StoredTaleMedia,
): Promise<{ tale: Tale; previousKey: string | null }> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  return inTransaction(db, async (tx) => {
    // The subquery locks the row and reads the old key in the same statement.
    const { rows } = await tx.query<TaleRow & { previousKey: string | null }>(
      `UPDATE tales SET media_key = $2, media_content_type = $3
       FROM (SELECT id AS old_id, media_key AS old_key FROM tales WHERE id = $1 FOR UPDATE) old
       WHERE tales.id = old.old_id
       RETURNING ${TALE_COLUMNS}, old.old_key AS "previousKey"`,
      [taleId, media.key, media.contentType],
    );
    if (rows.length === 0) throw new TaleNotFoundError(taleId);
    await bringTaleMediaInStep(tx, taleId);
    const { previousKey, ...row } = rows[0];
    const [tale] = await visibleTales(tx, [toTale(row)]);
    return { tale, previousKey };
  });
}

/**
 * Points a tale that holds no media at newly stored media, in one conditional
 * update, and brings its documents in step (R16) in the caller's transaction:
 * when the tale already holds media (another writer got there first),
 * nothing changes and the answer is false, so no one's media is ever replaced
 * and no previous key needs deleting. With `publishDraft` (an import's draft
 * still as it made it, Tale Studio R17) a `live` tale with nothing published
 * publishes that draft with the media. Run it in a transaction, as the importer
 * does. Throws {@link TaleNotFoundError}.
 */
export async function setTaleMediaIfNone(
  db: Db,
  taleId: string,
  media: StoredTaleMedia,
  options: { publishDraft?: boolean } = {},
): Promise<boolean> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rowCount } = await db.query(
    'UPDATE tales SET media_key = $2, media_content_type = $3 WHERE id = $1 AND media_key IS NULL',
    [taleId, media.key, media.contentType],
  );
  if ((rowCount ?? 0) > 0) {
    await bringTaleMediaInStep(db, taleId, options);
    return true;
  }
  if (!(await taleExists(db, taleId))) throw new TaleNotFoundError(taleId);
  return false;
}

/**
 * Points a tale at newly stored media only while it still holds `expectedKey`,
 * in one conditional update: when the tale holds other media (a person
 * replaced it) or none, nothing changes and the answer is false. Its documents
 * are brought in step (R16) as a re-import does it: only a `taleMedia` element
 * that still shows `expectedKey` takes the new key, so media a person picked
 * in Tale Studio, or their removal of the element, is kept. The file of
 * `expectedKey` is not deleted here; other tales may reference it (AD-11).
 * Run it in a transaction, as the importer does. Throws {@link TaleNotFoundError}.
 */
export async function replaceTaleMediaIf(
  db: Db,
  taleId: string,
  expectedKey: string,
  media: StoredTaleMedia,
): Promise<boolean> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rowCount } = await db.query(
    'UPDATE tales SET media_key = $3, media_content_type = $4 WHERE id = $1 AND media_key = $2',
    [taleId, expectedKey, media.key, media.contentType],
  );
  if ((rowCount ?? 0) > 0) {
    await bringTaleMediaInStep(db, taleId, { expectedKey });
    return true;
  }
  if (!(await taleExists(db, taleId))) throw new TaleNotFoundError(taleId);
  return false;
}

/** A tale group's stored cover: its storage key, content type and whether it moves. */
export interface StoredCover extends StoredTaleMedia {
  animated: boolean;
}

/** The group's stored cover, or null when it has none. Throws {@link TaleGroupNotFoundError}. */
export async function getTaleGroupCover(db: Db, taleGroupId: string): Promise<StoredCover | null> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  const { rows } = await db.query<{ key: string | null; contentType: string | null; animated: boolean }>(
    'SELECT cover_key AS key, cover_content_type AS "contentType", cover_animated AS animated FROM tale_groups WHERE id = $1',
    [taleGroupId],
  );
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const { key, contentType, animated } = rows[0];
  return key !== null && isMediaContentType(contentType) ? { key, contentType, animated } : null;
}

/**
 * Points the group at a newly stored cover, or at none (`null`), going back to
 * the first tale's media. Returns the group and the key it pointed at before
 * (null when none). Copies share cover keys (AD-14), so the caller deletes that
 * file only through {@link withMediaKeyDeletionGuard}, when nothing references it any more.
 * Throws {@link TaleGroupNotFoundError}.
 */
export async function setTaleGroupCover(
  db: Db,
  taleGroupId: string,
  cover: StoredCover | null,
): Promise<{ group: StoredTaleGroup; previousKey: string | null }> {
  if (!UUID.test(taleGroupId)) throw new TaleGroupNotFoundError(taleGroupId);
  // The subquery locks the row and reads the old key in the same statement.
  const { rows } = await db.query<GroupRow & { previousKey: string | null }>(
    `UPDATE tale_groups SET cover_key = $2, cover_content_type = $3, cover_animated = $4
     FROM (SELECT id AS old_id, cover_key AS old_key FROM tale_groups WHERE id = $1 FOR UPDATE) old
     WHERE tale_groups.id = old.old_id
     RETURNING ${GROUP_COLUMNS}, old.old_key AS "previousKey"`,
    [taleGroupId, cover?.key ?? null, cover?.contentType ?? null, cover?.animated ?? false],
  );
  if (rows.length === 0) throw new TaleGroupNotFoundError(taleGroupId);
  const { previousKey, ...row } = rows[0];
  const [group] = await withTales(db, [row]);
  return { group, previousKey };
}

/** A tale as the Delivery API needs it: its stored media key stays for the API to build the public URL. */
export interface DeliveryStoredTale {
  id: string;
  title: string;
  media: StoredTaleMedia | null;
  /** The tale's document as delivered (AD-15), or null when it has none or it no longer validates. */
  document: KeyedDeliveryDocument | null;
  /** The project fonts the delivered document uses (R18), whose keys the API turns into public URLs. */
  fonts: (Omit<StoredFontFile, 'sizeBytes'> & { id: string })[];
  /**
   * The media keys the delivered document may show (R5): those its published document's `tale_media`
   * rows mark delivered, which the public route serves. The API turns them into public URLs and
   * leaves out any other.
   */
  mediaKeys: ReadonlySet<string>;
}

/** A tale group as the Delivery API needs it, with its tales by position. */
export interface DeliveryStoredTaleGroup {
  id: string;
  name: string;
  /** The group's cover, whose key the API turns into a public URL; null for none. */
  cover: StoredCover | null;
  tales: DeliveryStoredTale[];
}

/**
 * The document a tale is delivered with (R16): its published document, with the tale's media
 * composed in (as the migration would, under the tale's id as the element id, so the answer stays
 * the same between reads) while the tale is out of step, or as the whole document when the
 * published one is missing or no longer passes; a tale with neither shows its title on the legacy
 * placeholder colour for 5 s, as a tale without media always did.
 */
export function deliveredWithTaleMedia(
  taleId: string,
  stored: KeyedDeliveryDocument | null,
  key: string | null,
  contentType: string | null,
  inStep: string | null,
): KeyedDeliveryDocument {
  const media = key !== null && isMediaContentType(contentType) ? { key, kind: mediaKind(contentType) } : null;
  const merged = withOutOfStepMedia(taleId, stored, media, inStep);
  if (merged !== null && merged !== stored) {
    // Delivered without the editor-only fields (AD-15), as every other element.
    const elements = merged.elements.map((element) => {
      const delivered: Record<string, unknown> = { ...(element as object) };
      for (const field of EDITOR_ONLY_ELEMENT_FIELDS) delete delivered[field];
      return delivered;
    });
    return { ...merged, elements } as KeyedDeliveryDocument;
  }
  return stored ?? EMPTY_DELIVERED_DOCUMENT;
}

/** What a tale with neither media nor a document is delivered with (R16): the legacy placeholder for 5 s. */
const EMPTY_DELIVERED_DOCUMENT: KeyedDeliveryDocument = {
  version: TALE_DOCUMENT_VERSION,
  canvas: { background: { type: 'color', color: LEGACY_PLACEHOLDER_COLOR } },
  durationMs: LEGACY_TALE_DURATION_MS,
  // Marked, so viewers paint its colour across the whole stage, as such a tale always showed.
  placeholder: true,
  elements: [],
};

/**
 * The published tale groups placed in the zone, in this zone's order (AD-2,
 * AD-14), each with its published tales by position, for the Delivery API.
 * Published means `live` and inside its start and end time at `now` (AD-6);
 * a group's tales need their own window and the group's. A live group with no
 * published tale is left out, since it has nothing to play. Each tale carries
 * its storage key, which the API turns into a public URL (AD-11) and never
 * returns on its own.
 */
export async function listDeliveryTaleGroups(
  db: Db,
  zoneId: string,
  now: Date = new Date(),
): Promise<DeliveryStoredTaleGroup[]> {
  if (!UUID.test(zoneId)) return [];
  const groups = await db.query<{
    id: string;
    name: string;
    coverKey: string | null;
    coverContentType: string | null;
    coverAnimated: boolean;
  }>(
    `SELECT tale_groups.id, tale_groups.name, tale_groups.cover_key AS "coverKey",
       tale_groups.cover_content_type AS "coverContentType", tale_groups.cover_animated AS "coverAnimated"
     FROM zone_tale_groups
     JOIN tale_groups ON tale_groups.id = zone_tale_groups.tale_group_id
     WHERE zone_tale_groups.zone_id = $1 AND ${deliveredPlacement('tale_groups', 'zone_tale_groups.zone_id', '$2')}
     ORDER BY zone_tale_groups.position, tale_groups.id`,
    [zoneId, now],
  );
  if (groups.rows.length === 0) return [];
  const tales = await db.query<{
    id: string;
    taleGroupId: string;
    title: string;
    key: string | null;
    contentType: string | null;
    projectId: string;
    document: unknown;
    revision: number;
    documentBytes: number | null;
    inStep: string | null;
  }>(
    `SELECT id, tale_group_id AS "taleGroupId", title, media_key AS key, media_content_type AS "contentType",
       project_id AS "projectId", document, document_revision AS revision, document_media_key AS "inStep",
       octet_length(document::text) AS "documentBytes"
     FROM tales WHERE tale_group_id = ANY($1::uuid[]) AND ${deliveredTale('tales', '$2')} ORDER BY position, id`,
    [groups.rows.map((g) => g.id), now],
  );
  // Checked in full once per tale and revision (every save raises it), then kept. Every tale is
  // delivered with a document (R16): its media is composed in while the tale is out of step.
  const composed = new Set<string>();
  const documents = new Map(
    tales.rows.map((tale) => {
      const stored = deliverableTaleDocument(
        tale.document,
        `${tale.id}:${tale.revision}`,
        tale.documentBytes ?? undefined,
      );
      const delivered = deliveredWithTaleMedia(tale.id, stored, tale.key, tale.contentType, tale.inStep);
      if (delivered !== stored && tale.key !== null) composed.add(tale.id);
      return [tale.id, delivered];
    }),
  );
  // The project fonts each delivered document uses (R18), of the tale's own project only (AD-4).
  const fontsUsed = tales.rows.map((tale) => ({ tale, ids: projectFontIds(documents.get(tale.id)) }));
  const fonts = await deliveryProjectFonts(
    db,
    fontsUsed.flatMap(({ tale, ids }) => ids.map((fontId) => ({ projectId: tale.projectId, fontId }))),
  );
  const fontsOf = new Map(
    fontsUsed.map(({ tale, ids }) => [
      tale.id,
      ids.flatMap((id) => {
        const font = fonts.get(id);
        return font && font.projectId === tale.projectId
          ? [{ id, key: font.key, weight: font.weight, style: font.style }]
          : [];
      }),
    ]),
  );
  // The media keys each delivered document may show: exactly what the public route serves (AD-11).
  const media = await deliveredMediaKeys(
    db,
    tales.rows.filter((tale) => usesMedia(documents.get(tale.id))).map((tale) => tale.id),
  );
  // A live group with no live tale has nothing to play, so it is left out.
  return groups.rows
    .map((group) => ({
      id: group.id,
      name: group.name,
      cover:
        group.coverKey !== null && isMediaContentType(group.coverContentType)
          ? { key: group.coverKey, contentType: group.coverContentType, animated: group.coverAnimated }
          : null,
      tales: tales.rows
        .filter((tale) => tale.taleGroupId === group.id)
        .map(({ id, title, key, contentType }) => ({
          id,
          title,
          media: key !== null && isMediaContentType(contentType) ? { key, contentType } : null,
          document: documents.get(id) ?? null,
          fonts: fontsOf.get(id) ?? [],
          // A composed document shows the tale's own media, which the public route serves by its tale (AD-11).
          mediaKeys:
            composed.has(id) && key !== null
              ? new Set([...(media.get(id) ?? []), key])
              : (media.get(id) ?? new Set<string>()),
        })),
    }))
    .filter((group) => group.tales.length > 0);
}

/**
 * The stored media a published tale (a `live` tale of a `live` group, each
 * inside its start and end time at `now`, AD-6) currently references under
 * `key`, or the cover of a delivered group (`live`, in its window, with a
 * published tale, placed in a zone: the rule {@link listDeliveryTaleGroups}
 * uses); null when none
 * does: an unknown key, the key of replaced media or a replaced cover, or
 * media of draft, paused, archived, scheduled or expired content (AD-11).
 * A key copies share is public while any published tale or cover references it (AD-14).
 */
export async function findPublishedMedia(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<StoredTaleMedia | null> {
  const { rows } = await db.query<{ contentType: string | null }>(
    `(SELECT tales.media_content_type AS "contentType" FROM tales
      JOIN tale_groups ON tale_groups.id = tales.tale_group_id
      WHERE tales.media_key = $1 AND ${deliveredTale('tales', '$2')} AND ${deliveredGroup('tale_groups', '$2')}
      LIMIT 1)
     UNION ALL
     (SELECT g.cover_content_type FROM tale_groups g
      WHERE g.cover_key = $1 AND ${deliveredGroup('g', '$2')}
      LIMIT 1)
     LIMIT 1`,
    [key, now],
  );
  const contentType = rows[0]?.contentType;
  if (isMediaContentType(contentType)) return { key, contentType };
  // Media a delivered tale's published document shows (R5), answered from a bounded cache.
  return findPublishedDocumentMedia(db, key, now);
}

/**
 * True when any tale or tale group cover still references the storage key, or
 * a tale's draft or published document (R5), or the project's media holds it.
 * A read only: to delete a file, use {@link withMediaKeyDeletionGuard}, which
 * keeps document writes out until the decision is carried out.
 */
export async function isMediaKeyInUse(db: Db, key: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM tales WHERE media_key = $1
     UNION ALL SELECT 1 FROM tale_groups WHERE cover_key = $1
     UNION ALL SELECT 1 FROM tale_media WHERE storage_key = $1
     UNION ALL SELECT 1 FROM project_media WHERE storage_key = $1
     LIMIT 1`,
    [key],
  );
  return rows.length > 0;
}

/**
 * Decides, and carries out, whether a replaced or removed file may be deleted
 * (AD-11, AD-14, R5): in one transaction on one connection, it takes the key's
 * lock exclusively (document writes share it while they check and record the
 * key), reads whether anything still references the key, and runs `decide`
 * with that answer while still holding the lock, so no document write can
 * check the key and reference it between the read and the delete. A write that
 * comes after finds nothing that makes the key its project's, and is refused.
 * Copied tales and covers share keys, so `decide` deletes only when `inUse`
 * is false.
 */
export async function withMediaKeyDeletionGuard<T>(
  db: TransactionalDb,
  key: string,
  decide: (inUse: boolean) => Promise<T>,
): Promise<T> {
  return inTransaction(db, async (tx) => {
    await lockMediaKeyForDeletion(tx, key);
    return decide(await isMediaKeyInUse(tx, key));
  });
}
