import { isZoneSlug, uniqueZoneSlug, zoneSlugFromName } from '@taleart/contract';
import type { Db, DbConnection } from '@taleart/server-access';

/** What the fold needs from other modules: the tales module owns the placements (AD-14). */
export interface FoldOptions {
  /** Gives `toZoneId` a copy of every placement of `fromZoneId`, in the same order. */
  copyPlacements: (db: Db, fromZoneId: string, toZoneId: string) => Promise<void>;
  log?: (msg: string, fields: Record<string, unknown>) => void;
}

/** What one run of the fold did. */
export interface FoldReport {
  /** The zones the fold created. */
  zonesCreated: number;
  /** The zones whose slug it filled. */
  slugsFilled: number;
}

interface ZoneRow {
  id: string;
  projectId: string;
  name: string;
  slug: string | null;
  playbookKey: string | null;
}

interface FrameRow {
  id: string;
  zoneId: string;
  type: string;
  settings: unknown;
}

interface StageRow {
  zoneId: string;
  frameId: string;
  name: string;
  key: string;
}

/** One zone the fold makes from a stage or a frame of `from`. */
interface NewZone {
  from: ZoneRow;
  name: string;
  /** The stage's key when it is a valid slug; null for a frame, or a stage key that is not one. */
  stageKey: string | null;
  /** For a frame no stage showed: its type and its number among the zone's frames of that type. */
  type: string;
  n: number;
  frame: FrameRow;
  /** True when the frame is already shown by another zone of this fold, so this zone gets a copy. */
  copyFrame: boolean;
  slug?: string;
}

// The type's name in a new zone's name: "bar" reads "Bar". The migration has no frame-type registry;
// the shipped registry's labels (Bar, Banner) are their keys capitalised, and a frame type key is
// lowercase ASCII, so this matches them.
const typeName = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1);

// A stage key as a slug, or null when an old row holds one that is not (stage keys were validated
// with the same pattern, but a row written by hand need not be).
const validKey = (key: string): string | null => (isZoneSlug(key) ? key : null);

/**
 * Turns a database from before the UX rework into one where a zone is one spot with at most one
 * display and a slug (epic UX rework R2, AD-17). Forward-only and idempotent: in one transaction,
 * and a second run finds nothing to do. Runs after the tales migration, because new zones get
 * copies of the original zone's placements through `options.copyPlacements` (AD-14).
 *
 * - A zone with stages keeps its id and becomes its oldest stage's zone: the stage's name, its key
 *   as the slug, its frame as the display. Every further stage becomes a new zone the same way.
 *   A frame that two stages show is copied for the later one, so each zone has its own row.
 * - A frame no stage shows, and every frame after the first of a zone without stages, becomes a
 *   new zone named "<zone name> – <Type> <n>", where n counts the zone's frames of that type,
 *   oldest first. A zone without stages keeps its first frame.
 * - New zones keep the original's project, playbook key (a "created from template" note) and
 *   placements, and sort right after it. They get no zone key (owner decision 2026-10-22).
 * - Slugs, made unique in each project with `-2`, `-3`, … , oldest zone first: stage keys are
 *   reserved first, then slugs made from zone names, then those of zones made from frames
 *   ("<name slug>-<type>-<n>", or "<original slug>-<type>-<n>" when the name has no Latin letter or
 *   digit, as a Hebrew name has none). A name with none gives `zone`.
 * - Then `slug` is NOT NULL, a zone has at most one frame, and the `stages` table and the indexes
 *   only it needed are gone.
 *
 * Deploying it is stop-the-world: an instance of the release before reads `stages` and inserts
 * zones without a slug, and both fail once this has run.
 */
export async function foldStagesIntoZones(client: DbConnection, options: FoldOptions): Promise<FoldReport> {
  await client.query('BEGIN');
  try {
    const report = await fold(client, options);
    await client.query('COMMIT');
    if (report.zonesCreated > 0 || report.slugsFilled > 0) {
      (options.log ?? logJson)('zones folded into one display each', { ...report });
    }
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function fold(db: Db, options: FoldOptions): Promise<FoldReport> {
  const hasStages = (await db.query<{ t: string | null }>("SELECT to_regclass('stages')::text AS t")).rows[0].t !== null;
  const stages = hasStages
    ? (
        await db.query<StageRow>(
          `SELECT zone_id AS "zoneId", frame_id AS "frameId", name, key FROM stages ORDER BY created_at, id`,
        )
      ).rows
    : [];
  // The stages are read; their foreign keys would stop frames moving to their new zones.
  if (hasStages) await db.query('DROP TABLE stages');

  const zones = (
    await db.query<ZoneRow>(
      `SELECT id, project_id AS "projectId", name, slug, playbook_key AS "playbookKey"
       FROM zones ORDER BY created_at, id`,
    )
  ).rows;
  const frames = (
    await db.query<FrameRow>(`SELECT id, zone_id AS "zoneId", type, settings FROM frames ORDER BY created_at, id`)
  ).rows;

  const framesOf = group(frames, (f) => f.zoneId);
  const stagesOf = group(stages, (s) => s.zoneId);
  // Each original zone's oldest stage: its name, and its key when that is a slug.
  const kept = new Map<string, { name: string; stageKey: string | null }>();
  const created: NewZone[] = [];

  for (const zone of zones) {
    const zoneFrames = framesOf.get(zone.id) ?? [];
    const byId = new Map(zoneFrames.map((f) => [f.id, f]));
    const shown = new Set<string>();
    let first = true;
    for (const stage of stagesOf.get(zone.id) ?? []) {
      const frame = byId.get(stage.frameId);
      if (!frame) continue;
      const copyFrame = shown.has(frame.id);
      shown.add(frame.id);
      if (first) {
        kept.set(zone.id, { name: stage.name, stageKey: validKey(stage.key) });
        first = false;
      } else {
        created.push({ from: zone, name: stage.name, stageKey: validKey(stage.key), type: frame.type, n: 0, frame, copyFrame });
      }
    }
    // The frames no stage shows; a zone without stages keeps its first one.
    const ordinal = new Map<string, number>();
    for (const frame of zoneFrames) {
      const n = (ordinal.get(frame.type) ?? 0) + 1;
      ordinal.set(frame.type, n);
      if (shown.has(frame.id)) continue;
      if (first) {
        first = false;
        continue;
      }
      created.push({
        from: zone,
        name: `${zone.name} – ${typeName(frame.type)} ${n}`,
        stageKey: null,
        type: frame.type,
        n,
        frame,
        copyFrame: false,
      });
    }
  }

  // Slugs, each project's oldest zone first.
  const taken = new Map<string, Set<string>>();
  const takenIn = (projectId: string): Set<string> => {
    let set = taken.get(projectId);
    if (!set) taken.set(projectId, (set = new Set()));
    return set;
  };
  for (const zone of zones) if (zone.slug !== null) takenIn(zone.projectId).add(zone.slug);
  const pick = (projectId: string, base: string): string => {
    const set = takenIn(projectId);
    const slug = uniqueZoneSlug(base, (s) => set.has(s));
    set.add(slug);
    return slug;
  };
  const createdOf = group(created, (z) => z.from.id);
  // The slug each original zone without one gets.
  const filled = new Map<string, string>();
  // 1. Stage keys, which pages named: they keep their key whenever it is free.
  for (const zone of zones) {
    const stageKey = kept.get(zone.id)?.stageKey;
    if (zone.slug === null && stageKey) filled.set(zone.id, pick(zone.projectId, stageKey));
    for (const next of createdOf.get(zone.id) ?? []) if (next.stageKey) next.slug = pick(zone.projectId, next.stageKey);
  }
  // 2. The original zones' names.
  for (const zone of zones) {
    if (zone.slug === null && !filled.has(zone.id)) {
      filled.set(zone.id, pick(zone.projectId, zoneSlugFromName(kept.get(zone.id)?.name ?? zone.name)));
    }
  }
  // 3. The zones made from frames, and from stages whose key is not a slug.
  for (const zone of zones) {
    const original = zone.slug ?? (filled.get(zone.id) as string);
    const nameSlug = zoneSlugFromName(zone.name);
    for (const next of createdOf.get(zone.id) ?? []) {
      if (next.slug) continue;
      next.slug = pick(
        zone.projectId,
        next.n > 0
          ? `${nameSlug || original}-${next.type}-${next.n}`
          : zoneSlugFromName(next.name) || `${original}-${next.type}`,
      );
    }
  }

  for (const zone of zones) {
    const change = kept.get(zone.id);
    const slug = filled.get(zone.id);
    if (slug !== undefined || change) {
      await db.query('UPDATE zones SET slug = COALESCE($2, slug), name = $3 WHERE id = $1', [
        zone.id,
        slug ?? null,
        change?.name ?? zone.name,
      ]);
    }
    let offset = 0;
    for (const next of createdOf.get(zone.id) ?? []) {
      offset++;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO zones (project_id, name, slug, playbook_key, created_at)
         VALUES ($1, $2, $3, $4, (SELECT created_at FROM zones WHERE id = $5) + $6 * interval '1 microsecond')
         RETURNING id`,
        // Read in SQL: a JS Date would drop the microseconds and sort the new zone before its original.
        [zone.projectId, next.name, next.slug, zone.playbookKey, zone.id, offset],
      );
      const zoneId = rows[0].id;
      if (next.copyFrame) {
        await db.query(
          `INSERT INTO frames (zone_id, project_id, type, settings, created_at)
           SELECT $2, project_id, type, settings, created_at FROM frames WHERE id = $1`,
          [next.frame.id, zoneId],
        );
      } else {
        await db.query('UPDATE frames SET zone_id = $2 WHERE id = $1', [next.frame.id, zoneId]);
      }
      await options.copyPlacements(db, zone.id, zoneId);
    }
  }

  // Every zone has a slug now; the DDL runs only while the column is still nullable.
  const nullable = await db.query<{ nullable: string }>(
    `SELECT is_nullable AS nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'zones' AND column_name = 'slug'`,
  );
  if (nullable.rows[0]?.nullable === 'YES') await db.query('ALTER TABLE zones ALTER COLUMN slug SET NOT NULL');
  // Each zone holds at most one frame now. The unique index on zone_id also serves the lookups
  // that frames_zone_id_idx served, and frames_id_zone_id_key existed only for the stages' foreign key.
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS frames_zone_id_key ON frames (zone_id)');
  await db.query('DROP INDEX IF EXISTS frames_zone_id_idx');
  await db.query('DROP INDEX IF EXISTS frames_id_zone_id_key');
  return { zonesCreated: created.length, slugsFilled: filled.size };
}

function group<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function logJson(msg: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', msg, ...fields }));
}
