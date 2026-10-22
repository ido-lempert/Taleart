import { uniqueZoneSlug, zoneSlugFromName } from '@taleart/contract';
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
  /** The slug's base: the stage key, or empty to make one from the name. */
  slugBase: string;
  frame: FrameRow;
  /** True when the frame is already shown by another zone of this fold, so this zone gets a copy. */
  copyFrame: boolean;
}

// "bar" reads "Bar": the migration has no registry, and a frame type key is lowercase ASCII.
const typeName = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1);

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
 * - Every zone without a slug gets one, from its stage key or its name, made unique in its project
 *   with `-2`, `-3`, … ; older zones keep the plain slug. Then `slug` is NOT NULL, a zone has at most
 *   one frame, and the `stages` table is gone.
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
    await db.query<FrameRow>(
      `SELECT id, zone_id AS "zoneId", type, settings FROM frames ORDER BY created_at, id`,
    )
  ).rows;

  const framesOf = group(frames, (f) => f.zoneId);
  const stagesOf = group(stages, (s) => s.zoneId);
  // The slug each zone gets from a stage key, before any other slug is made.
  const stageSlugBase = new Map<string, string>();
  // Each original zone's new name and display, when the fold changes them.
  const kept = new Map<string, { name: string; frameId: string | null }>();
  const created: NewZone[] = [];

  for (const zone of zones) {
    const zoneFrames = framesOf.get(zone.id) ?? [];
    const zoneStages = stagesOf.get(zone.id) ?? [];
    const byId = new Map(zoneFrames.map((f) => [f.id, f]));
    const shown = new Set<string>();
    let first = true;
    for (const stage of zoneStages) {
      const frame = byId.get(stage.frameId);
      if (!frame) continue;
      const copyFrame = shown.has(frame.id);
      shown.add(frame.id);
      if (first) {
        kept.set(zone.id, { name: stage.name, frameId: frame.id });
        stageSlugBase.set(zone.id, stage.key);
        first = false;
      } else {
        created.push({ from: zone, name: stage.name, slugBase: stage.key, frame, copyFrame });
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
        slugBase: '',
        frame,
        copyFrame: false,
      });
    }
  }

  // Slugs, oldest zone first in each project: a new zone sorts right after its original.
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

  let slugsFilled = 0;
  const createdOf = group(created, (z) => z.from.id);
  for (const zone of zones) {
    const change = kept.get(zone.id);
    const name = change?.name ?? zone.name;
    if (zone.slug === null) {
      const slug = pick(zone.projectId, stageSlugBase.get(zone.id) ?? zoneSlugFromName(name));
      await db.query('UPDATE zones SET slug = $2, name = $3 WHERE id = $1', [zone.id, slug, name]);
      slugsFilled++;
    } else if (change) {
      await db.query('UPDATE zones SET name = $2 WHERE id = $1', [zone.id, name]);
    }
    let offset = 0;
    for (const next of createdOf.get(zone.id) ?? []) {
      offset++;
      const slug = pick(zone.projectId, next.slugBase || zoneSlugFromName(next.name));
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO zones (project_id, name, slug, playbook_key, created_at)
         VALUES ($1, $2, $3, $4, (SELECT created_at FROM zones WHERE id = $5) + $6 * interval '1 microsecond')
         RETURNING id`,
        // Read in SQL: a JS Date would drop the microseconds and sort the new zone before its original.
        [zone.projectId, next.name, slug, zone.playbookKey, zone.id, offset],
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

  // A frame no stage of a staged zone showed has moved, so each zone holds at most one now.
  await db.query('ALTER TABLE zones ALTER COLUMN slug SET NOT NULL');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS frames_zone_id_key ON frames (zone_id)');
  return { zonesCreated: created.length, slugsFilled };
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
