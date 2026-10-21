// Media in tale documents (epic Tale Studio R5, R2, R14; AD-4, AD-11, AD-14, AD-15): the
// `project_media` table (files uploaded to a project's media in Tale Studio) and `tale_media`
// (which tale's draft or published document references which storage key), both owned by the tales
// module. `tale_media` is written in the same transaction as every document write, as `tale_fonts`
// is, so "is this key the project's", "is this file still in use" and "is this key public" never
// scan documents.
import {
  documentMediaKeys,
  documentMediaRefs,
  isMediaContentType,
  isMediaKey,
  mediaContentTypeOfKey,
  mediaKind,
  projectMediaFileUrl,
  type MediaContentType,
  type ProjectMedia,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { deliveredGroup, inTransaction, liveNow, type TransactionalDb } from './tales';

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
 * Waits until no document write holds the key's lock: a write that checked the key and has not
 * committed yet. Run on its own (not in a transaction), the lock is let go at once.
 */
export async function waitForMediaKeyWrites(db: Db, key: string): Promise<void> {
  await db.query(`SELECT pg_advisory_xact_lock(${KEY_LOCK})`, [key]);
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
 * Stores an upload to the project's media and its file, together: in one transaction the row is
 * inserted, then `put` stores the file; a failed `put` rolls the row back, and a commit that fails
 * after it calls `remove`.
 */
export async function createProjectMedia(
  db: TransactionalDb,
  media: NewProjectMedia,
  file: { put: () => Promise<void>; remove: () => Promise<void> },
): Promise<ProjectMedia> {
  let stored = false;
  try {
    return await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<UploadRow>(
        `INSERT INTO project_media (project_id, storage_key, content_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING storage_key AS key, content_type AS "contentType", size_bytes AS "sizeBytes", created_at AS "createdAt"`,
        [media.projectId, media.storageKey, media.contentType, media.sizeBytes, media.uploaderId],
      );
      await file.put();
      stored = true;
      return toUpload(media.projectId, rows[0]) as ProjectMedia;
    });
  } catch (err) {
    if (stored) await file.remove().catch(() => undefined);
    throw err;
  }
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
const publicMedia = new Map<string, { at: number; contentType: MediaContentType | null }>();

/**
 * Forgets every public answer about documents' media this process keeps. Called on every change
 * that can make a document's media public or private here (publishing, a status or schedule change,
 * a placement, a copy); another process sees the change within {@link PUBLIC_MEDIA_CACHE_TTL_MS}.
 */
export function clearPublicMediaCache(): void {
  publicMedia.clear();
}

/**
 * The media stored under `key` while a published tale's document uses it (AD-11, R5): a `live`
 * tale in its window, of a group the Delivery API delivers (the delivered-group rule), whose
 * published document is deliverable and shows the key (a `delivered` row of `tale_media`). Null for
 * any other key. Answers are kept in this process for {@link PUBLIC_MEDIA_CACHE_TTL_MS} (at most
 * {@link PUBLIC_MEDIA_CACHE_SIZE}), and forgotten at once on any change here that could alter them.
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
    return answer(kept.contentType);
  }
  const { rows } = await db.query<{ contentType: string }>(
    `SELECT tm.content_type AS "contentType" FROM tale_media tm
     JOIN tales t ON t.id = tm.tale_id
     JOIN tale_groups g ON g.id = t.tale_group_id
     WHERE tm.storage_key = $1 AND tm.document = 'published' AND tm.delivered
       AND ${liveNow('t', '$2')} AND ${deliveredGroup('g', '$2')}
     LIMIT 1`,
    [key, now],
  );
  const contentType = isMediaContentType(rows[0]?.contentType) ? rows[0].contentType : null;
  publicMedia.delete(key);
  publicMedia.set(key, { at: now.getTime(), contentType });
  if (publicMedia.size > PUBLIC_MEDIA_CACHE_SIZE) publicMedia.delete(publicMedia.keys().next().value as string);
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
