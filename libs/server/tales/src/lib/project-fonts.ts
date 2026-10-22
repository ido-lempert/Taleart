// Project fonts (epic Tale Studio R18; AD-4, AD-11, AD-15): the `project_fonts` table the tales
// module owns. A font is a face (family, weight, style) uploaded to one project, with its fallback
// stack, its file's storage key and the uploader's licence confirmation. Documents reference it by
// id. `tale_fonts` records which tale's draft or published document references which font, written
// in the same transaction as the document, so "in use", deletion and the public lookup never scan
// documents: a font in use cannot be deleted, and its file is public only while a delivered tale's
// published document uses it.
import {
  ErrorCodes,
  FONT_CONTENT_TYPE,
  isFontId,
  MAX_PROJECT_FONT_BYTES,
  MAX_PROJECT_FONTS,
  projectFontIds,
  SYSTEM_FONT_STACK_KEYS,
  type ProjectFont,
  type ProjectFontStyle,
  type SystemFontStack,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { deliveredGroup, deliveredTale, inTransaction, type TransactionalDb } from './tales';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for an unknown font, or one of another project (404 `font_not_found`). */
export class FontNotFoundError extends Error {
  readonly code = ErrorCodes.fontNotFound;

  constructor(readonly fontId: string) {
    super('No font of this project has this id');
    this.name = 'FontNotFoundError';
  }
}

/** Thrown when the project already has a face with this family, weight and style (409 `font_exists`). */
export class FontExistsError extends Error {
  readonly code = ErrorCodes.fontExists;

  constructor() {
    super('This project already has a font with this family, weight and style. Delete it first to replace it.');
    this.name = 'FontExistsError';
  }
}

/** Thrown when a font a tale's draft or published document uses is deleted (409 `font_in_use`). */
export class FontInUseError extends Error {
  readonly code = ErrorCodes.fontInUse;

  constructor(readonly taleTitle: string) {
    super(`This font is used by the tale "${taleTitle}". Change that text's font first, then delete the font.`);
    this.name = 'FontInUseError';
  }
}

/** Thrown when the project already holds {@link MAX_PROJECT_FONTS} faces (409 `font_limit_reached`). */
export class FontLimitError extends Error {
  readonly code = ErrorCodes.fontLimitReached;

  constructor() {
    super(`A project holds at most ${MAX_PROJECT_FONTS} fonts. Delete one to upload another.`);
    this.name = 'FontLimitError';
  }
}

/** Thrown when the project's font files would pass {@link MAX_PROJECT_FONT_BYTES} (413 `font_storage_full`). */
export class FontStorageFullError extends Error {
  readonly code = ErrorCodes.fontStorageFull;

  constructor() {
    super(
      `A project's font files take at most ${MAX_PROJECT_FONT_BYTES / (1024 * 1024)} MB together. Delete a font first.`,
    );
    this.name = 'FontStorageFullError';
  }
}

/** A new font face, checked by the caller (the contract's rules, the family normalised). */
export interface NewProjectFont {
  projectId: string;
  family: string;
  weight: number;
  style: ProjectFontStyle;
  fallback: SystemFontStack;
  storageKey: string;
  sizeBytes: number;
  /** The signed-in uploader, who confirmed they may use and distribute the font. */
  uploader: { id: string; name: string };
}

/** A font as the server needs it to serve its file. */
export interface StoredFontFile {
  key: string;
  weight: number;
  style: ProjectFontStyle;
  sizeBytes: number;
}

const FONT_COLUMNS =
  'f.id, f.project_id AS "projectId", f.family, f.weight, f.style, f.fallback, f.size_bytes AS "sizeBytes", ' +
  'f.uploaded_by AS "uploaderId", f.uploaded_by_name AS "uploaderName", f.created_at AS "createdAt"';

interface FontRow {
  id: string;
  projectId: string;
  family: string;
  weight: number;
  style: ProjectFontStyle;
  fallback: SystemFontStack;
  sizeBytes: number;
  uploaderId: string | null;
  uploaderName: string;
  createdAt: Date;
  inUse: boolean;
}

function toFont(row: FontRow): ProjectFont {
  return {
    id: row.id,
    projectId: row.projectId,
    family: row.family,
    weight: row.weight,
    style: row.style,
    fallback: row.fallback,
    sizeBytes: row.sizeBytes,
    licenceConfirmedBy: { id: row.uploaderId, name: row.uploaderName },
    licenceConfirmedAt: row.createdAt.toISOString(),
    inUse: row.inUse,
  };
}

// ---- Public lookup cache ----

/** How long a public font answer is kept in this process. */
export const PUBLIC_FONT_CACHE_TTL_MS = 30_000;
/** The most public font answers kept in this process. */
export const PUBLIC_FONT_CACHE_SIZE = 1000;

// Public font answers by storage key, oldest first (a Map keeps insertion order).
const publicFonts = new Map<string, { at: number; found: boolean }>();
// Bumped by every clear: a lookup that started before a clear (a revoke racing a read) keeps nothing.
let publicFontGeneration = 0;

/**
 * Forgets every public font answer this process keeps. Called on every change that can make a
 * font public or private here (publishing, a status or schedule change, a placement, a delete);
 * another process sees the change within {@link PUBLIC_FONT_CACHE_TTL_MS}.
 */
export function clearPublicFontCache(): void {
  publicFontGeneration++;
  publicFonts.clear();
}

// ---- tale_fonts: which document references which font ----

/** Which of a tale's documents a `tale_fonts` row records. */
export type TaleFontDocument = 'draft' | 'published';

/**
 * Records the project fonts `doc` (the tale's draft or published document, as just written) uses,
 * replacing what was recorded for that document. Run in the transaction that writes the document.
 * A published row is `delivered` when the font is used by a visible element and the document is
 * deliverable (`deliverable`: it passed the document check), the rule the public route serves by.
 * Fonts of another project are never recorded.
 */
export async function recordTaleFonts(
  tx: Db,
  taleId: string,
  which: TaleFontDocument,
  doc: unknown,
  deliverable: boolean,
): Promise<void> {
  await tx.query('DELETE FROM tale_fonts WHERE tale_id = $1 AND document = $2', [taleId, which]);
  const ids = projectFontIds(doc);
  if (ids.length === 0) return;
  const visible = new Set(projectFontIds(doc, { visibleOnly: true }));
  const delivered = ids.map((id) => which === 'published' && deliverable && visible.has(id));
  await tx.query(
    `INSERT INTO tale_fonts (tale_id, font_id, document, project_id, delivered)
     SELECT t.id, f.id, $2, t.project_id, x.delivered
     FROM tales t
     JOIN unnest($3::uuid[], $4::boolean[]) AS x(id, delivered) ON true
     JOIN project_fonts f ON f.id = x.id AND f.project_id = t.project_id
     WHERE t.id = $1`,
    [taleId, which, ids, delivered],
  );
}

// ---- Fonts ----

/** The project's fonts by family, weight and style, each with whether a tale's document uses it. */
export async function listProjectFonts(db: Db, projectId: string): Promise<ProjectFont[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<FontRow>(
    `SELECT ${FONT_COLUMNS}, EXISTS (SELECT 1 FROM tale_fonts tf WHERE tf.font_id = f.id) AS "inUse"
     FROM project_fonts f WHERE f.project_id = $1
     ORDER BY lower(f.family), f.family, f.weight, f.style`,
    [projectId],
  );
  return rows.map(toFont);
}

/**
 * Stores a font face, with the uploader and the time of their licence confirmation, and its file.
 * In one transaction, under a lock on the project's fonts: the project's caps are checked
 * ({@link FontLimitError}, {@link FontStorageFullError}), the row is inserted ({@link FontExistsError}
 * for the same family in any letter case, weight and style), then `put` stores the file. A failed
 * `put` rolls the row back; a commit that fails after it calls `remove`, so neither a row without
 * a file nor (short of a crash, which {@link sweepUnusedFontFiles} clears) a file without a row is left.
 */
export async function createProjectFont(
  db: TransactionalDb,
  font: NewProjectFont,
  file: { put: () => Promise<void>; remove: () => Promise<void> },
): Promise<ProjectFont> {
  let stored = false;
  try {
    return await inTransaction(db, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('project_fonts:' || $1, 0))", [font.projectId]);
      const { rows: totals } = await tx.query<{ count: number; bytes: number }>(
        'SELECT count(*)::int AS count, COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM project_fonts WHERE project_id = $1',
        [font.projectId],
      );
      if (totals[0].count >= MAX_PROJECT_FONTS) throw new FontLimitError();
      if (Number(totals[0].bytes) + font.sizeBytes > MAX_PROJECT_FONT_BYTES) throw new FontStorageFullError();
      let row: FontRow;
      try {
        const { rows } = await tx.query<FontRow>(
          `INSERT INTO project_fonts AS f (project_id, family, weight, style, fallback, storage_key, size_bytes,
             uploaded_by, uploaded_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${FONT_COLUMNS}, false AS "inUse"`,
          [
            font.projectId,
            font.family,
            font.weight,
            font.style,
            font.fallback,
            font.storageKey,
            font.sizeBytes,
            font.uploader.id,
            font.uploader.name,
          ],
        );
        row = rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') throw new FontExistsError();
        throw err;
      }
      await file.put();
      stored = true;
      return toFont(row);
    });
  } catch (err) {
    if (stored) await file.remove().catch(() => undefined);
    throw err;
  }
}

/** The stored file of the project's font, or null when the project has no font with this id. */
export async function getProjectFontFile(db: Db, projectId: string, fontId: string): Promise<StoredFontFile | null> {
  if (!UUID.test(projectId) || !isFontId(fontId)) return null;
  const { rows } = await db.query<StoredFontFile>(
    'SELECT storage_key AS key, weight, style, size_bytes AS "sizeBytes" FROM project_fonts WHERE id = $1 AND project_id = $2',
    [fontId, projectId],
  );
  return rows[0] ?? null;
}

/**
 * Deletes the project's font and returns its storage key, for the caller to delete the file. The
 * font row is locked first, so a document write that references the font (which share locks it
 * and records it in `tale_fonts` in its transaction) either finishes before the check below sees
 * it, or waits and then finds the font gone. Throws {@link FontNotFoundError} and
 * {@link FontInUseError}, naming a tale whose draft or published document uses it.
 */
export async function deleteProjectFont(db: TransactionalDb, projectId: string, fontId: string): Promise<string> {
  if (!UUID.test(projectId) || !isFontId(fontId)) throw new FontNotFoundError(fontId);
  const key = await inTransaction(db, async (tx) => {
    const font = await tx.query<{ key: string }>(
      'SELECT storage_key AS key FROM project_fonts WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [fontId, projectId],
    );
    if (font.rows.length === 0) throw new FontNotFoundError(fontId);
    const user = await tx.query<{ title: string }>(
      `SELECT t.title FROM tale_fonts tf JOIN tales t ON t.id = tf.tale_id
       WHERE tf.font_id = $1 ORDER BY t.created_at LIMIT 1`,
      [fontId],
    );
    if (user.rows.length > 0) throw new FontInUseError(user.rows[0].title);
    await tx.query('DELETE FROM project_fonts WHERE id = $1', [fontId]);
    return font.rows[0].key;
  });
  clearPublicFontCache();
  return key;
}

/**
 * The ids, of those given, that are fonts of the project. With `lock`, each found row is share
 * locked until the caller's transaction ends, so the font cannot be deleted meanwhile.
 */
export async function knownProjectFontIds(
  db: Db,
  projectId: string,
  fontIds: readonly string[],
  lock = false,
): Promise<Set<string>> {
  if (fontIds.length === 0) return new Set();
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM project_fonts WHERE project_id = $1 AND id = ANY($2::uuid[]) ORDER BY id${lock ? ' FOR SHARE' : ''}`,
    [projectId, [...fontIds]],
  );
  return new Set(rows.map((r) => r.id));
}

/** The fonts with these ids that belong to the project, as the Delivery API lists them with a tale. */
export async function deliveryProjectFonts(
  db: Db,
  fonts: readonly { projectId: string; fontId: string }[],
): Promise<Map<string, StoredFontFile & { projectId: string }>> {
  if (fonts.length === 0) return new Map();
  const ids = [...new Set(fonts.map((f) => f.fontId))];
  const { rows } = await db.query<StoredFontFile & { id: string; projectId: string }>(
    `SELECT id, project_id AS "projectId", storage_key AS key, weight, style, size_bytes AS "sizeBytes"
     FROM project_fonts WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map(({ id, ...font }) => [id, font]));
}

/**
 * The font stored under `key` while a published tale uses it (AD-11, R18): a `live` tale in its
 * window, of a group the Delivery API delivers (`live`, in its window, placed in a zone: the
 * delivered-group rule), whose published document is deliverable and has a visible text with this
 * font (a `delivered` row of `tale_fonts`). Null for any other key: an unknown one, a font only
 * drafts or hidden elements use, or one of unpublished content. Answers are kept in this process
 * for {@link PUBLIC_FONT_CACHE_TTL_MS} (at most {@link PUBLIC_FONT_CACHE_SIZE}), and forgotten at
 * once on any change here that could alter them ({@link clearPublicFontCache}).
 */
export async function findPublishedFont(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<{ key: string; contentType: typeof FONT_CONTENT_TYPE } | null> {
  const answer = (found: boolean) =>
    found ? { key, contentType: FONT_CONTENT_TYPE as typeof FONT_CONTENT_TYPE } : null;
  const kept = publicFonts.get(key);
  if (kept && now.getTime() - kept.at < PUBLIC_FONT_CACHE_TTL_MS && now.getTime() >= kept.at) {
    return answer(kept.found);
  }
  const generation = publicFontGeneration;
  const { rows } = await db.query(
    `SELECT 1 FROM project_fonts f
     JOIN tale_fonts tf ON tf.font_id = f.id AND tf.document = 'published' AND tf.delivered
     JOIN tales t ON t.id = tf.tale_id
     JOIN tale_groups g ON g.id = t.tale_group_id
     WHERE f.storage_key = $1 AND ${deliveredTale('t', '$2')} AND ${deliveredGroup('g', '$2')}
     LIMIT 1`,
    [key, now],
  );
  const found = rows.length > 0;
  publicFonts.delete(key);
  // An answer read across a clear may be stale: it is returned but not kept.
  if (generation === publicFontGeneration) {
    publicFonts.set(key, { at: now.getTime(), found });
    if (publicFonts.size > PUBLIC_FONT_CACHE_SIZE) publicFonts.delete(publicFonts.keys().next().value as string);
  }
  return answer(found);
}

/** A storage adapter that lists a folder's keys, such as the local-disk adapter. */
export interface ListableStorage {
  listKeys(folder: string): Promise<{ key: string; modifiedAt: Date }[]>;
  delete(key: string): Promise<void>;
}

/** Font files younger than this are left alone: an upload may be about to commit its row. */
export const FONT_SWEEP_MIN_AGE_MS = 60 * 60_000;

/**
 * Deletes font files (`fonts/…`) older than {@link FONT_SWEEP_MIN_AGE_MS} that no font row names:
 * what an upload left when its process stopped between storing the file and committing the row.
 * Returns how many it removed.
 */
export async function sweepUnusedFontFiles(db: Db, storage: ListableStorage, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const { key, modifiedAt } of await storage.listKeys('fonts')) {
    if (now - modifiedAt.getTime() < FONT_SWEEP_MIN_AGE_MS) continue;
    const { rows } = await db.query('SELECT 1 FROM project_fonts WHERE storage_key = $1', [key]);
    if (rows.length > 0) continue;
    await storage.delete(key);
    removed++;
  }
  return removed;
}

/**
 * The document with every text's project font replaced by its fallback system stack (the text's
 * `fallback`, else sans), for a copy in another project; the same value when it uses none.
 */
export function withoutProjectFonts<T>(doc: T): T {
  if (projectFontIds(doc).length === 0) return doc;
  const elements = (doc as { elements: unknown[] }).elements.map((element) => {
    const e = element as { type?: unknown; props?: { font?: { source?: unknown }; fallback?: unknown } };
    if (e.type !== 'text' || e.props?.font?.source !== 'project') return element;
    const fallback = (SYSTEM_FONT_STACK_KEYS as readonly unknown[]).includes(e.props.fallback)
      ? (e.props.fallback as SystemFontStack)
      : 'sans';
    return { ...e, props: { ...e.props, font: { source: 'system', stack: fallback } } };
  });
  return { ...doc, elements };
}
