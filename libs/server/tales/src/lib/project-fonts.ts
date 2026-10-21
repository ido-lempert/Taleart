// Project fonts (epic Tale Studio R18; AD-4, AD-11, AD-15): the `project_fonts` table the tales
// module owns. A font is a face (family, weight, style) uploaded to one project, with its fallback
// stack, its file's storage key and the uploader's licence confirmation. Documents reference it by
// id; a font in use cannot be deleted, and its file is public only while a delivered tale's
// published document uses it.
import {
  ErrorCodes,
  FONT_CONTENT_TYPE,
  isFontId,
  projectFontIds,
  SYSTEM_FONT_STACK_KEYS,
  type ProjectFont,
  type ProjectFontStyle,
  type SystemFontStack,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { deliveredGroup, liveNow, type TransactionalDb } from './tales';

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

/** A new font face, checked by the caller (the contract's rules). */
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
}

// True when the JSONB document `doc` has a text whose project font is `id` (a uuid's text);
// with `visible`, hidden elements (which are not delivered) do not count.
function usesFont(doc: string, id: string, visible = false): string {
  const hidden = visible ? ' && !exists(@.hidden ? (@ == true))' : '';
  return (
    `jsonb_path_exists(${doc}, '$.elements[*] ? (@.type == "text"${hidden} && ` +
    `@.props.font.source == "project" && @.props.font.fontId == $id)', jsonb_build_object('id', ${id}))`
  );
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

// Whether any tale of the font's project uses it, in its draft or its published document.
const IN_USE = `EXISTS (SELECT 1 FROM tales t WHERE t.project_id = f.project_id AND (
  ${usesFont('t.draft_document', 'f.id::text')} OR ${usesFont('t.document', 'f.id::text')})) AS "inUse"`;

/** The project's fonts by family, weight and style, each with whether a tale uses it. */
export async function listProjectFonts(db: Db, projectId: string): Promise<ProjectFont[]> {
  if (!UUID.test(projectId)) return [];
  const { rows } = await db.query<FontRow>(
    `SELECT ${FONT_COLUMNS}, ${IN_USE} FROM project_fonts f WHERE f.project_id = $1
     ORDER BY lower(f.family), f.family, f.weight, f.style`,
    [projectId],
  );
  return rows.map(toFont);
}

/**
 * Stores a font face, with the uploader and the time of their licence confirmation. Throws
 * {@link FontExistsError} when the project has a face with the same family (in any letter case),
 * weight and style.
 */
export async function createProjectFont(db: Db, font: NewProjectFont): Promise<ProjectFont> {
  try {
    const { rows } = await db.query<FontRow>(
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
    return toFont(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new FontExistsError();
    throw err;
  }
}

/** The stored file of the project's font, or null when the project has no font with this id. */
export async function getProjectFontFile(db: Db, projectId: string, fontId: string): Promise<StoredFontFile | null> {
  if (!UUID.test(projectId) || !isFontId(fontId)) return null;
  const { rows } = await db.query<StoredFontFile>(
    'SELECT storage_key AS key, weight, style FROM project_fonts WHERE id = $1 AND project_id = $2',
    [fontId, projectId],
  );
  return rows[0] ?? null;
}

/**
 * Deletes the project's font and returns its storage key, for the caller to delete the file. The
 * font row is locked first, so a document save that references the font (which takes a share lock
 * on it) either finishes before the check below sees it, or waits and then finds the font gone.
 * Throws {@link FontNotFoundError} and {@link FontInUseError}, naming a tale whose draft or
 * published document uses it.
 */
export async function deleteProjectFont(db: TransactionalDb, projectId: string, fontId: string): Promise<string> {
  if (!UUID.test(projectId) || !isFontId(fontId)) throw new FontNotFoundError(fontId);
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const font = await tx.query<{ key: string }>(
      'SELECT storage_key AS key FROM project_fonts WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [fontId, projectId],
    );
    if (font.rows.length === 0) throw new FontNotFoundError(fontId);
    const user = await tx.query<{ title: string }>(
      `SELECT t.title FROM tales t WHERE t.project_id = $2 AND (
         ${usesFont('t.draft_document', '$1::text')} OR ${usesFont('t.document', '$1::text')})
       ORDER BY t.created_at LIMIT 1`,
      [fontId.toLowerCase(), projectId],
    );
    if (user.rows.length > 0) throw new FontInUseError(user.rows[0].title);
    await tx.query('DELETE FROM project_fonts WHERE id = $1', [fontId]);
    await tx.query('COMMIT');
    tx.release();
    return font.rows[0].key;
  } catch (err) {
    try {
      await tx.query('ROLLBACK');
      tx.release();
    } catch (rollbackErr) {
      tx.release(rollbackErr as Error);
    }
    throw err;
  }
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
    `SELECT id FROM project_fonts WHERE project_id = $1 AND id = ANY($2::uuid[])${lock ? ' FOR SHARE' : ''}`,
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
    `SELECT id, project_id AS "projectId", storage_key AS key, weight, style FROM project_fonts
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map(({ id, ...font }) => [id, font]));
}

/**
 * The font stored under `key` while a published tale uses it (AD-11, R18): a `live` tale in its
 * window, of a group the Delivery API delivers (`live`, in its window, placed in a zone: the
 * delivered-group rule), whose published document has a visible text with this font. Null for any
 * other key: an unknown one, a font only drafts use, or one of unpublished content.
 */
export async function findPublishedFont(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<{ key: string; contentType: typeof FONT_CONTENT_TYPE } | null> {
  const { rows } = await db.query(
    `SELECT 1 FROM project_fonts f
     WHERE f.storage_key = $1 AND EXISTS (
       SELECT 1 FROM tales t JOIN tale_groups g ON g.id = t.tale_group_id
       WHERE t.project_id = f.project_id AND ${liveNow('t', '$2')} AND ${deliveredGroup('g', '$2')}
         AND ${usesFont('t.document', 'f.id::text', true)})
     LIMIT 1`,
    [key, now],
  );
  return rows.length > 0 ? { key, contentType: FONT_CONTENT_TYPE } : null;
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
