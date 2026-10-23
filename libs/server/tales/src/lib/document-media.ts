// Media in tale documents (epic Tale Studio R5, R2, R14; AD-4, AD-11, AD-14, AD-15): the
// `project_media` table (files uploaded to a project's media in Tale Studio) and `tale_media`
// (which tale's draft or published document references which storage key), both owned by the tales
// module. `tale_media` is written in the same transaction as every document write, as `tale_fonts`
// is, so "is this key the project's", "is this file still in use" and "is this key public" never
// scan documents.
import {
  documentMediaKeys,
  ErrorCodes,
  documentMediaRefs,
  isMediaContentType,
  isMediaKey,
  mediaContentTypeOfKey,
  mediaKind,
  projectMediaFileUrl,
  type MediaContentType,
  type ProjectMedia,
} from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import { deliveredGroup, deliveredTale } from './tales';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The advisory lock of one storage key: document writes share it while they check and record the
// key; `isMediaKeyInUse` takes it exclusively before it looks, so it never misses a write in flight.
const KEY_LOCK = "hashtextextended('media:' || $1, 0)";

/**
 * Share locks each key until the caller's transaction ends, in key order, so two writes never wait
 * on each other in a cycle. A file whose key is locked here is not judged unused meanwhile.
 */
export async function lockMediaKeys(tx: Db, keys: readonly string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.query(`SELECT pg_advisory_xact_lock_shared(${KEY_LOCK})`, [key]);
  }
}

/**
 * Takes the key's lock exclusively until the caller's transaction ends: it waits for document writes
 * that checked the key and have not committed, and keeps new ones out until then.
 */
export async function lockMediaKeyForDeletion(tx: Db, key: string): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(${KEY_LOCK})`, [key]);
}

/**
 * The keys, of those given, that are media of the project (AD-4, R14): uploaded to its media, the
 * media of one of its tales, or referenced by one of its tales' documents (a copied group's
 * documents are recorded for the copy's project, AD-14).
 */
export async function projectMediaKeys(db: Db, projectId: string, keys: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(keys)].filter(isMediaKey);
  if (wanted.length === 0 || !UUID.test(projectId)) return new Set();
  const { rows } = await db.query<{ key: string }>(
    `SELECT k.key FROM unnest($2::text[]) AS k(key)
     WHERE EXISTS (SELECT 1 FROM project_media m WHERE m.project_id = $1 AND m.storage_key = k.key)
        OR EXISTS (SELECT 1 FROM tales t WHERE t.project_id = $1 AND t.media_key = k.key)
        OR EXISTS (SELECT 1 FROM tale_media tm WHERE tm.project_id = $1 AND tm.storage_key = k.key)`,
    [projectId, wanted],
  );
  return new Set(rows.map((r) => r.key));
}

/** Which of a tale's documents a `tale_media` row records. */
export type TaleMediaDocument = 'draft' | 'published';

/**
 * Records the media keys `doc` (the tale's draft or published document, as just written) uses,
 * replacing what was recorded for that document, for the tale's project. Run in the transaction
 * that writes the document. A published row is `delivered` when a visible element (or the
 * background) uses the key and the document is deliverable (`deliverable`: it passed the document
 * and publish checks), the rule the public route serves by.
 */
export async function recordTaleMedia(
  tx: Db,
  taleId: string,
  which: TaleMediaDocument,
  doc: unknown,
  deliverable: boolean,
): Promise<void> {
  await tx.query('DELETE FROM tale_media WHERE tale_id = $1 AND document = $2', [taleId, which]);
  const keys = documentMediaKeys(doc).filter((key) => mediaContentTypeOfKey(key) !== null);
  if (keys.length === 0) return;
  const visible = new Set(documentMediaKeys(doc, { visibleOnly: true }));
  await tx.query(
    `INSERT INTO tale_media (tale_id, storage_key, document, project_id, content_type, delivered)
     SELECT t.id, x.key, $2, t.project_id, x.type, x.delivered
     FROM tales t JOIN unnest($3::text[], $4::text[], $5::boolean[]) AS x(key, type, delivered) ON true
     WHERE t.id = $1`,
    [
      taleId,
      which,
      keys,
      keys.map((key) => mediaContentTypeOfKey(key)),
      keys.map((key) => which === 'published' && deliverable && visible.has(key)),
    ],
  );
}

/** True when the document references any media (so its writes take the media steps). */
export function usesMedia(doc: unknown): boolean {
  return documentMediaRefs(doc).length > 0;
}

// ---- The project's media ----

/** A new upload to a project's media, checked by the caller (type from the bytes, size). */
export interface NewProjectMedia {
  projectId: string;
  storageKey: string;
  contentType: MediaContentType;
  sizeBytes: number;
  uploaderId: string;
}

/** How much media one project holds at most (R5); configured by the API (env). */
export interface ProjectMediaLimits {
  /** The most files a project's media holds. */
  maxFiles: number;
  /** The most bytes a project's media files take together. */
  maxBytes: number;
}

/** The starting caps: 500 files and 2 GB per project (PROJECT_MEDIA_MAX_FILES, PROJECT_MEDIA_MAX_BYTES). */
export const DEFAULT_PROJECT_MEDIA_LIMITS: ProjectMediaLimits = { maxFiles: 500, maxBytes: 2 * 1024 * 1024 * 1024 };

/** Thrown when the project's media already holds its most files (409 `media_limit_reached`). */
export class MediaLimitError extends Error {
  readonly code = ErrorCodes.mediaLimitReached;

  constructor(maxFiles: number) {
    super(`A project's media holds at most ${maxFiles} files.`);
    this.name = 'MediaLimitError';
  }
}

/** Thrown when the project's media files would take more than their cap (413 `media_storage_full`). */
export class MediaStorageFullError extends Error {
  readonly code = ErrorCodes.mediaStorageFull;

  constructor(maxBytes: number) {
    super(`A project's media files take at most ${formatBytes(maxBytes)} together.`);
    this.name = 'MediaStorageFullError';
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1 ? `${Math.round(gb * 10) / 10} GB` : `${Math.round(bytes / (1024 * 1024))} MB`;
}

interface UploadRow {
  key: string;
  contentType: string;
  sizeBytes: string | number;
  createdAt: Date;
}

function toUpload(projectId: string, row: UploadRow): ProjectMedia | null {
  if (!isMediaContentType(row.contentType)) return null;
  return {
    key: row.key,
    kind: mediaKind(row.contentType),
    contentType: row.contentType,
    url: projectMediaFileUrl(projectId, row.key),
    source: 'upload',
    sizeBytes: Number(row.sizeBytes),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Refuses an upload of `sizeBytes` the project has no room for ({@link MediaLimitError},
 * {@link MediaStorageFullError}). The API asks before it reads the body; {@link createProjectMedia}
 * asks again under the project's lock.
 */
export async function checkProjectMediaRoom(
  db: Db,
  projectId: string,
  sizeBytes: number,
  limits: ProjectMediaLimits,
): Promise<void> {
  const { rows } = await db.query<{ count: number; bytes: string | number }>(
    'SELECT count(*)::int AS count, COALESCE(sum(size_bytes), 0)::bigint AS bytes FROM project_media WHERE project_id = $1',
    [projectId],
  );
  if (rows[0].count >= limits.maxFiles) throw new MediaLimitError(limits.maxFiles);
  if (Number(rows[0].bytes) + sizeBytes > limits.maxBytes) throw new MediaStorageFullError(limits.maxBytes);
}

/**
 * Records an upload whose file is already stored: in one transaction, under a lock on the
 * project's media, the caps are checked again and the row inserted. The caller stored the file
 * first and deletes it when this throws, so no row ever names a missing file; a file whose row
 * never committed (the process stopped between) is removed by {@link sweepUnusedProjectMediaFiles}.
 */
export async function createProjectMedia(
  db: TransactionalDb,
  media: NewProjectMedia,
  limits: ProjectMediaLimits = DEFAULT_PROJECT_MEDIA_LIMITS,
): Promise<ProjectMedia> {
  return inTransaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('project_media:' || $1, 0))", [media.projectId]);
    await checkProjectMediaRoom(tx, media.projectId, media.sizeBytes, limits);
    const { rows } = await tx.query<UploadRow>(
      `INSERT INTO project_media (project_id, storage_key, content_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING storage_key AS key, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"`,
      [media.projectId, media.storageKey, media.contentType, media.sizeBytes, media.uploaderId],
    );
    return toUpload(media.projectId, rows[0]) as ProjectMedia;
  });
}

/** Upload files younger than this are left alone: an upload may be about to commit its row. */
export const MEDIA_UPLOAD_SWEEP_MIN_AGE_MS = 60 * 60_000;

/**
 * Deletes uploaded media files (`media/…`) older than {@link MEDIA_UPLOAD_SWEEP_MIN_AGE_MS} that no
 * `project_media` row names: what an upload left when its process stopped between storing the
 * file and committing its row. Rows are never deleted, so a file with a row is never touched.
 * Returns how many it removed.
 */
export async function sweepUnusedProjectMediaFiles(
  db: Db,
  storage: {
    listKeys(folder: string): Promise<{ key: string; modifiedAt: Date }[]>;
    delete(key: string): Promise<void>;
  },
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const { key, modifiedAt } of await storage.listKeys('media')) {
    if (now - modifiedAt.getTime() < MEDIA_UPLOAD_SWEEP_MIN_AGE_MS) continue;
    const { rows } = await db.query('SELECT 1 FROM project_media WHERE storage_key = $1', [key]);
    if (rows.length > 0) continue;
    await storage.delete(key);
    removed++;
  }
  return removed;
}

/**
 * The project's media (R5): its uploads, newest first, then its tales' media (with a tale's
 * title), then media only its tales' documents reference, each key once.
 */
export async function listProjectMedia(db: Db, projectId: string): Promise<ProjectMedia[]> {
  if (!UUID.test(projectId)) return [];
  const uploads = await db.query<UploadRow>(
    `SELECT storage_key AS key, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"
     FROM project_media WHERE project_id = $1 ORDER BY created_at DESC, storage_key`,
    [projectId],
  );
  const tales = await db.query<{ key: string; contentType: string; taleTitle: string }>(
    `SELECT DISTINCT ON (media_key) media_key AS key, media_content_type AS "contentType", title AS "taleTitle"
     FROM tales WHERE project_id = $1 AND media_key IS NOT NULL
     ORDER BY media_key, created_at`,
    [projectId],
  );
  const documents = await db.query<{ key: string; contentType: string }>(
    `SELECT DISTINCT storage_key AS key, content_type AS "contentType" FROM tale_media WHERE project_id = $1
     ORDER BY storage_key`,
    [projectId],
  );
  const seen = new Set<string>();
  const list: ProjectMedia[] = [];
  const add = (media: ProjectMedia | null) => {
    if (!media || seen.has(media.key)) return;
    seen.add(media.key);
    list.push(media);
  };
  for (const row of uploads.rows) add(toUpload(projectId, row));
  for (const row of tales.rows) {
    if (!isMediaContentType(row.contentType) || !isMediaKey(row.key)) continue;
    add({
      key: row.key,
      kind: mediaKind(row.contentType),
      contentType: row.contentType,
      url: projectMediaFileUrl(projectId, row.key),
      source: 'tale',
      taleTitle: row.taleTitle,
    });
  }
  for (const row of documents.rows) {
    if (!isMediaContentType(row.contentType)) continue;
    add({
      key: row.key,
      kind: mediaKind(row.contentType),
      contentType: row.contentType,
      url: projectMediaFileUrl(projectId, row.key),
      source: 'document',
    });
  }
  return list;
}

/** The content type of `key` when it is media of the project ({@link projectMediaKeys}), else null. */
export async function projectMediaFile(
  db: Db,
  projectId: string,
  key: string,
): Promise<{ key: string; contentType: MediaContentType } | null> {
  const contentType = mediaContentTypeOfKey(key);
  if (contentType === null) return null;
  const known = await projectMediaKeys(db, projectId, [key]);
  return known.has(key) ? { key, contentType } : null;
}

// ---- Public lookup ----

/** How long a public answer about a document's media is kept in this process. */
export const PUBLIC_MEDIA_CACHE_TTL_MS = 30_000;
/** The most public answers about documents' media kept in this process. */
export const PUBLIC_MEDIA_CACHE_SIZE = 1000;

// Answers by storage key, oldest first (a Map keeps insertion order).
const publicMedia = new Map<string, { at: number; contentType: MediaContentType }>();
// Bumped by every clear: a lookup that started before a clear (a revoke racing a read) keeps nothing.
let publicMediaGeneration = 0;

/**
 * Forgets every public answer about documents' media this process keeps. Called on every change
 * that can make a document's media public or private here (publishing, a status or schedule change,
 * a placement, a copy); another process sees the change within {@link PUBLIC_MEDIA_CACHE_TTL_MS}.
 */
export function clearPublicMediaCache(): void {
  publicMediaGeneration++;
  publicMedia.clear();
}

/**
 * The media stored under `key` while a published tale's document uses it (AD-11, R5): a `live`
 * tale in its window, of a group the Delivery API delivers (the delivered-group rule), whose
 * published document is deliverable and shows the key (a `delivered` row of `tale_media`). Null for
 * any other key. A yes is kept in this process for {@link PUBLIC_MEDIA_CACHE_TTL_MS} (at most
 * {@link PUBLIC_MEDIA_CACHE_SIZE}, least recently used first out), and forgotten at once on any change
 * here that could alter it; a no is never kept.
 */
export async function findPublishedDocumentMedia(
  db: Db,
  key: string,
  now: Date = new Date(),
): Promise<{ key: string; contentType: MediaContentType } | null> {
  const answer = (contentType: MediaContentType | null) => (contentType ? { key, contentType } : null);
  if (!isMediaKey(key)) return null;
  const kept = publicMedia.get(key);
  if (kept && now.getTime() - kept.at < PUBLIC_MEDIA_CACHE_TTL_MS && now.getTime() >= kept.at) {
    // Read again: it moves to the newest end, so the least recently used answer goes first.
    publicMedia.delete(key);
    publicMedia.set(key, kept);
    return answer(kept.contentType);
  }
  const generation = publicMediaGeneration;
  const { rows } = await db.query<{ contentType: string }>(
    `SELECT tm.content_type AS "contentType" FROM tale_media tm
     JOIN tales t ON t.id = tm.tale_id
     JOIN tale_groups g ON g.id = t.tale_group_id
     WHERE tm.storage_key = $1 AND tm.document = 'published' AND tm.delivered
       AND ${deliveredTale('t', '$2')} AND ${deliveredGroup('g', '$2')}
     LIMIT 1`,
    [key, now],
  );
  const contentType = isMediaContentType(rows[0]?.contentType) ? rows[0].contentType : null;
  // Only a yes is kept: a no is asked again each time, so a key that becomes public shows at once
  // elsewhere too, and requests for random keys cannot push the kept answers out.
  publicMedia.delete(key);
  // An answer read across a clear may be stale: it is returned but not kept.
  if (contentType && generation === publicMediaGeneration) {
    publicMedia.set(key, { at: now.getTime(), contentType });
    if (publicMedia.size > PUBLIC_MEDIA_CACHE_SIZE) publicMedia.delete(publicMedia.keys().next().value as string);
  }
  return answer(contentType);
}

/** The keys each tale's published document delivers (its `delivered` rows), for the Delivery API. */
export async function deliveredMediaKeys(db: Db, taleIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const keys = new Map<string, Set<string>>();
  if (taleIds.length === 0) return keys;
  const { rows } = await db.query<{ taleId: string; key: string }>(
    `SELECT tale_id AS "taleId", storage_key AS key FROM tale_media
     WHERE tale_id = ANY($1::uuid[]) AND document = 'published' AND delivered`,
    [[...taleIds]],
  );
  for (const row of rows) {
    const set = keys.get(row.taleId) ?? new Set<string>();
    set.add(row.key);
    keys.set(row.taleId, set);
  }
  return keys;
}
