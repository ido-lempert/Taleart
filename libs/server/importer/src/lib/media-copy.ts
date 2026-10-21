import { createHash, randomUUID } from 'node:crypto';
import {
  isMediaContentType,
  matchesMagicNumber,
  maxMediaBytes,
  MEDIA_MAGIC_BYTES,
  mediaExtension,
  type ImportMediaFailure,
  type MediaContentType,
} from '@taleart/contract';
import type { Db, TransactionalDb } from '@taleart/server-access';
import type { MediaStorage } from '@taleart/server-storage';
import {
  getTaleMedia,
  isMediaKeyInUse,
  replaceTaleMediaIf,
  setTaleMediaIfNone,
  TaleNotFoundError,
} from '@taleart/server-tales';
import {
  MediaFetchError,
  MEDIA_FETCH_TIMEOUT_MS,
  MEDIA_MAX_BYTES_PER_JOB,
  MEDIA_MAX_MS_PER_JOB,
  openMedia,
  type MediaFetchPolicy,
} from './media-fetch';
import { isRetryableStatus, retryDelayMs, retryPolicy, sleep } from './retry';
import { CommitUncertainError, inTransaction } from './transaction';

/** A source media file stored through the storage port. */
export interface CopiedMedia {
  key: string;
  contentType: MediaContentType;
  /** SHA-256 of the bytes, hex. */
  sha256: string;
}

/** Imported media is stored as `tales/imported-<uuid>.<ext>`, so a sweep can tell it from uploads. */
export const IMPORTED_MEDIA_PREFIX = 'tales/imported-';

/**
 * What one import may still spend on media: bytes left, and the time by which
 * copying must stop. Shared by every download of the import.
 */
export interface MediaJobBudget {
  bytesLeft: number;
  deadline: number;
}

/** A fresh budget for one import, from the policy's per-job limits. */
export function mediaJobBudget(policy: MediaFetchPolicy = {}, now = Date.now()): MediaJobBudget {
  return {
    bytesLeft: policy.maxBytesPerJob ?? MEDIA_MAX_BYTES_PER_JOB,
    deadline: now + (policy.maxMsPerJob ?? MEDIA_MAX_MS_PER_JOB),
  };
}

const budgetSpent = () =>
  new MediaFetchError('jobBudgetExceeded', 'The import already copied as much media as one import may');

// Types that say nothing about the file: the story's `mime_type` decides instead.
const GENERIC_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

const unsupported = () => new MediaFetchError('unsupportedType', 'The media is not an accepted image or video');

// The declared type, by the upload's rule: the response's Content-Type, or the
// story's mime_type when the response names none or only a generic one.
function declaredType(header: string | null, mimeType: unknown): MediaContentType | null {
  const fallback = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : null;
  const type = header === null || GENERIC_TYPES.has(header) ? fallback : header;
  return isMediaContentType(type) ? type : null;
}

/**
 * Downloads one source media file under the fetch policy and streams it into
 * storage under a new key (`tales/imported-<uuid>.<ext>`), with the upload's
 * rules: an accepted type whose leading bytes match it, and no more bytes than
 * its kind allows. The body is never held whole in memory. A reply 429 or 5xx
 * is tried again with backoff (or after its `Retry-After`) within the
 * download's deadline; every try goes through the guard again. With a job
 * budget, each chunk read is taken from it as it arrives, so downloads running
 * at once cannot pass it together; a download that would pass its bytes or its
 * deadline stops as `jobBudgetExceeded`. `abort` stops the download (the job
 * stopped). A source failure is a {@link MediaFetchError} and leaves nothing
 * stored; a storage failure is passed on as it is.
 */
export async function copyMedia(
  storage: MediaStorage,
  url: string,
  mimeType: unknown,
  policy: MediaFetchPolicy = {},
  budget?: MediaJobBudget,
  abort?: AbortSignal,
): Promise<CopiedMedia> {
  const left = budget ? budget.deadline - Date.now() : Infinity;
  if (budget && (budget.bytesLeft <= 0 || left <= 0)) throw budgetSpent();
  const perDownload = AbortSignal.timeout(policy.timeoutMs ?? MEDIA_FETCH_TIMEOUT_MS);
  const jobDeadline = Number.isFinite(left) ? AbortSignal.timeout(Math.max(1, left)) : null;
  const signal = AbortSignal.any([perDownload, ...(jobDeadline ? [jobDeadline] : []), ...(abort ? [abort] : [])]);
  // The job deadline turns any failure it causes into jobBudgetExceeded.
  const byBudget = <T>(work: Promise<T>): Promise<T> =>
    work.catch((err: unknown) => {
      throw jobDeadline?.aborted && !perDownload.aborted ? budgetSpent() : err;
    });
  const retry = retryPolicy(policy.retry);
  try {
    return await byBudget(
      (async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await copyOnce(storage, url, mimeType, policy, budget, signal);
          } catch (err) {
            const reply = err instanceof MediaFetchError && err.reason === 'httpError' ? err.reply : undefined;
            if (!reply || !isRetryableStatus(reply.status) || attempt >= retry.attempts) throw err;
            try {
              await sleep(retryDelayMs(attempt - 1, reply.retryAfterMs, retry), signal);
            } catch {
              throw new MediaFetchError('timeout', 'The media download took too long');
            }
          }
        }
      })(),
    );
  } catch (err) {
    // Once a download is refused for the budget, the budget is spent: the rest is not requested.
    if (budget && err instanceof MediaFetchError && err.reason === 'jobBudgetExceeded') {
      budget.bytesLeft = Math.min(budget.bytesLeft, 0);
    }
    throw err;
  }
}

// One try of copyMedia: opens the URL and streams its checked bytes into storage.
async function copyOnce(
  storage: MediaStorage,
  url: string,
  mimeType: unknown,
  policy: MediaFetchPolicy,
  budget: MediaJobBudget | undefined,
  signal: AbortSignal,
): Promise<CopiedMedia> {
  const res = await openMedia(url, policy, signal);
  const { body } = res;
  try {
    const contentType = declaredType(res.contentType, mimeType);
    if (contentType === null) throw unsupported();
    const limit = maxMediaBytes(contentType);
    if (res.contentLength !== null && res.contentLength > limit) {
      throw new MediaFetchError('tooLarge', 'The media is larger than its type allows');
    }
    if (budget && res.contentLength !== null && res.contentLength > budget.bytesLeft) throw budgetSpent();
    const hash = createHash('sha256');
    let read = 0;
    async function* checkedBytes(): AsyncGenerator<Uint8Array> {
      let head: Buffer[] = [];
      let headLength = 0;
      let headChecked = false;
      try {
        for await (const chunk of body as AsyncIterable<Buffer>) {
          read += chunk.length;
          if (read > limit) throw new MediaFetchError('tooLarge', 'The media is larger than its type allows');
          if (budget) {
            // Taken as read: concurrent downloads share the budget.
            budget.bytesLeft -= chunk.length;
            if (budget.bytesLeft < 0) throw budgetSpent();
          }
          hash.update(chunk);
          if (headChecked) {
            yield chunk;
            continue;
          }
          // The leading bytes are held back until the type check can read them.
          head.push(chunk);
          headLength += chunk.length;
          if (headLength < MEDIA_MAGIC_BYTES) continue;
          const leading = Buffer.concat(head);
          if (!matchesMagicNumber(contentType as MediaContentType, leading)) throw unsupported();
          headChecked = true;
          head = [];
          yield leading;
        }
      } catch (err) {
        if (err instanceof MediaFetchError) throw err;
        throw (
          res.failure() ??
          (signal.aborted
            ? new MediaFetchError('timeout', 'The media download took too long')
            : new MediaFetchError('unreachable', 'The media transfer broke off'))
        );
      }
      if (!headChecked) {
        const leading = Buffer.concat(head);
        if (leading.length === 0 || !matchesMagicNumber(contentType as MediaContentType, leading)) {
          throw unsupported();
        }
        yield leading;
      }
    }
    const key = `${IMPORTED_MEDIA_PREFIX}${randomUUID()}.${mediaExtension(contentType)}`;
    await storage.putStream(key, checkedBytes());
    return { key, contentType, sha256: hash.digest('hex') };
  } finally {
    body.destroy();
  }
}

/**
 * Copies one source media file into storage; {@link copyMedia} under a policy,
 * or a stand-in in tests. `signal` aborts it when the job stops.
 */
export type MediaCopier = (url: string, mimeType: unknown, signal?: AbortSignal) => Promise<CopiedMedia>;

/** What happened to one tale's media. */
export type TaleMediaOutcome =
  /** The story names no media: nothing to copy, and story 6's check lists it. */
  | { kind: 'none' }
  /**
   * The tale holds the story's media: copied for the first time (`created`),
   * replaced because the source's media changed (`updated`), or kept from an
   * earlier import (`unchanged`).
   */
  | { kind: 'imported'; change: 'created' | 'updated' | 'unchanged' }
  /**
   * The tale holds media set in TaleArt, which an import does not replace;
   * `sourceChanged` when the source's media changed since the import last copied it.
   */
  | { kind: 'keptOwn'; sourceChanged: boolean }
  /** The tale was deleted while the import ran. */
  | { kind: 'taleGone' }
  /** The media could not be copied; the tale stays without it, or keeps what an earlier import copied. */
  | { kind: 'failed'; reason: ImportMediaFailure; keptEarlier: boolean };

/** What {@link importTaleMedia} needs. */
export interface TaleMediaImport {
  storage: MediaStorage;
  copy: MediaCopier;
  /** Reports a file that could not be cleaned up; it never fails the import. */
  onCleanupError?: (err: unknown) => void;
}

/** The story a tale's media comes from: the source's `media` and `mime_type` values. */
export interface MediaSourceStory {
  media?: unknown;
  mimeType?: unknown;
}

/**
 * What an earlier import copied onto this tale, or null. The row is keyed by
 * the tale: the story it came from is known only through `import_links`
 * (AD-7). `digest` is null for media copied before re-imports kept one.
 */
interface ImportedMedia {
  key: string;
  sha256: string;
  digest: string | null;
}

async function importedMedia(db: Db, taleId: string): Promise<ImportedMedia | null> {
  const { rows } = await db.query<ImportedMedia>(
    'SELECT content_sha256 AS sha256, media_key AS key, source_digest AS digest FROM import_media WHERE tale_id = $1',
    [taleId],
  );
  return rows[0] ?? null;
}

async function saveImportedMedia(
  db: Db,
  projectId: string,
  taleId: string,
  media: CopiedMedia,
  digest: string,
): Promise<void> {
  await db.query(
    `INSERT INTO import_media (tale_id, project_id, media_key, content_type, content_sha256, source_digest)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tale_id) DO UPDATE
       SET media_key = EXCLUDED.media_key, content_type = EXCLUDED.content_type,
           content_sha256 = EXCLUDED.content_sha256, source_digest = EXCLUDED.source_digest, updated_at = now()`,
    [taleId, projectId, media.key, media.contentType, media.sha256, digest],
  );
}

/**
 * A fingerprint of a story's media as the source names it: SHA-256 of its
 * type and URL. The URL itself is never stored (story 5); a changed
 * fingerprint means the source points at other media, or at the same media
 * under another URL, which a download then tells apart.
 */
export function sourceMediaDigest(url: string, mimeType: unknown): string {
  return createHash('sha256')
    .update(`${typeof mimeType === 'string' ? mimeType : ''}\n${url}`)
    .digest('hex');
}

// What the tale holds now, against what an import copied onto it; null when it holds no media.
async function currentOutcome(db: Db, taleId: string, digest: string): Promise<TaleMediaOutcome | null> {
  const current = await getTaleMedia(db, taleId);
  if (current === null) return null;
  const imported = await importedMedia(db, taleId);
  if (imported !== null && imported.key === current.key) return { kind: 'imported', change: 'unchanged' };
  // Media set in TaleArt is kept; it is a kept local edit when the source's media changed since the import copied it.
  const sourceChanged = imported !== null && imported.digest !== null && imported.digest !== digest;
  return { kind: 'keptOwn', sourceChanged };
}

/**
 * Gives an imported tale its story's media (AD-11): downloads it through
 * `copy`, then, in one transaction under the tale's import lock, sets the
 * tale's media through the tales module only if the tale still holds none, and
 * records which key the import stored on it with the source's fingerprint
 * ({@link sourceMediaDigest}). On a re-run, a tale still holding the media an
 * import copied is left alone while the fingerprint is the same (nothing is
 * downloaded); when it changed (or was never recorded) the media is downloaded
 * again and, if its bytes differ, replaces the tale's media only while the tale
 * still holds the import's copy. Media set in TaleArt (before, or by a person
 * while this download ran) is never overwritten: the copy is deleted, and the
 * outcome is `keptOwn`. No other file is deleted here: a replaced copy is left
 * to {@link sweepImportedMedia}, since copies of the tale may share it (AD-14).
 * A source failure leaves the tale as it was; database and storage failures
 * are passed on. When the commit's outcome is unknown, the copy is kept (the
 * tale may point at it); the sweep removes it later if nothing does.
 */
export async function importTaleMedia(
  db: TransactionalDb,
  media: TaleMediaImport,
  projectId: string,
  taleId: string,
  story: MediaSourceStory,
  signal?: AbortSignal,
): Promise<TaleMediaOutcome> {
  const url = story.media;
  if (url === undefined || url === null || (typeof url === 'string' && url.trim() === '')) return { kind: 'none' };
  if (typeof url !== 'string') return { kind: 'failed', reason: 'invalidUrl', keptEarlier: false };
  const digest = sourceMediaDigest(url.trim(), story.mimeType);
  let earlier: ImportedMedia | null;
  try {
    const before = await currentOutcome(db, taleId, digest);
    if (before !== null && before.kind !== 'imported') return before;
    earlier = before === null ? null : await importedMedia(db, taleId);
    // The import's copy is in place and the source names the same media: nothing to download.
    if (earlier !== null && earlier.digest === digest) return { kind: 'imported', change: 'unchanged' };
  } catch (err) {
    if (err instanceof TaleNotFoundError) return { kind: 'taleGone' };
    throw err;
  }

  let copied: CopiedMedia;
  try {
    copied = await media.copy(url.trim(), story.mimeType, signal);
  } catch (err) {
    if (err instanceof MediaFetchError) return { kind: 'failed', reason: err.reason, keptEarlier: earlier !== null };
    throw err;
  }

  const removeCopy = () => media.storage.delete(copied.key).catch((err) => media.onCleanupError?.(err));
  let result: { outcome: TaleMediaOutcome; used: boolean };
  try {
    result = await inTransaction(db, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('import_media:' || $1, 0))", [taleId]);
      const stored = { key: copied.key, contentType: copied.contentType };
      if (earlier === null) {
        // Only a tale that still holds no media takes the copy: a person's upload meanwhile wins.
        if (await setTaleMediaIfNone(tx, taleId, stored)) {
          await saveImportedMedia(tx, projectId, taleId, copied, digest);
          return { outcome: { kind: 'imported', change: 'created' } as const, used: true };
        }
      } else if (earlier.sha256 === copied.sha256) {
        // The same bytes under another URL: the copy in place stays, and the new fingerprint is recorded, but
        // only while the tale still holds it (a person may have set media while the download ran).
        if ((await getTaleMedia(tx, taleId))?.key === earlier.key) {
          await tx.query(
            'UPDATE import_media SET source_digest = $3, updated_at = now() WHERE tale_id = $1 AND media_key = $2',
            [taleId, earlier.key, digest],
          );
          return { outcome: { kind: 'imported', change: 'unchanged' } as const, used: false };
        }
      } else if (await replaceTaleMediaIf(tx, taleId, earlier.key, stored)) {
        // Replaced only while the tale still holds the import's earlier copy: a person's media meanwhile wins.
        await saveImportedMedia(tx, projectId, taleId, copied, digest);
        return { outcome: { kind: 'imported', change: 'updated' } as const, used: true };
      }
      const now = await currentOutcome(tx, taleId, digest);
      return { outcome: now ?? { kind: 'keptOwn', sourceChanged: false }, used: false };
    });
  } catch (err) {
    if (err instanceof CommitUncertainError) throw err;
    await removeCopy();
    if (err instanceof TaleNotFoundError) return { kind: 'taleGone' };
    throw err;
  }
  if (!result.used) await removeCopy();
  return result.outcome;
}

/** A storage adapter that can list its keys and clear temporary files, such as the local-disk adapter. */
export interface SweepableStorage extends MediaStorage {
  listKeys(folder: string): Promise<{ key: string; modifiedAt: Date }[]>;
  removeStaleTemporaryFiles(folder: string, olderThanMs: number, now?: number): Promise<number>;
}

/** True when the storage adapter supports {@link sweepImportedMedia}. */
export function isSweepable(storage: MediaStorage): storage is SweepableStorage {
  const candidate = storage as Partial<SweepableStorage>;
  return typeof candidate.listKeys === 'function' && typeof candidate.removeStaleTemporaryFiles === 'function';
}

/** Files younger than this are left alone: a write or an import may still be about to use them. */
export const MEDIA_SWEEP_MIN_AGE_MS = 60 * 60_000;

/**
 * Clears what interrupted imports left in storage, conservatively: temporary
 * files older than {@link MEDIA_SWEEP_MIN_AGE_MS}, and imported files
 * (`tales/imported-…`) as old that no tale or cover references and no
 * `import_media` row records. Uploaded files are never touched. Returns how
 * many files it removed. The worker runs it when it starts.
 */
export async function sweepImportedMedia(
  db: Db,
  storage: SweepableStorage,
  now = Date.now(),
): Promise<{ temporary: number; imported: number }> {
  const temporary = await storage.removeStaleTemporaryFiles('tales', MEDIA_SWEEP_MIN_AGE_MS, now);
  let imported = 0;
  for (const { key, modifiedAt } of await storage.listKeys('tales')) {
    if (!key.startsWith(IMPORTED_MEDIA_PREFIX) || now - modifiedAt.getTime() < MEDIA_SWEEP_MIN_AGE_MS) continue;
    if (await isMediaKeyInUse(db, key)) continue;
    const { rows } = await db.query('SELECT 1 FROM import_media WHERE media_key = $1 LIMIT 1', [key]);
    if (rows.length > 0) continue;
    await storage.delete(key);
    imported++;
  }
  return { temporary, imported };
}
