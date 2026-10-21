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
  setTaleMedia,
  TaleNotFoundError,
} from '@taleart/server-tales';
import { lockLinkSource, SOURCE_SYSTEM, type LinkSource } from './links';
import {
  MediaFetchError,
  MEDIA_FETCH_TIMEOUT_MS,
  openMedia,
  type MediaFetchPolicy,
} from './media-fetch';
import { inTransaction } from './transaction';

/** A source media file stored through the storage port. */
export interface CopiedMedia {
  key: string;
  contentType: MediaContentType;
  /** SHA-256 of the bytes, hex. */
  sha256: string;
}

// Types that say nothing about the file: the story's `mime_type` decides instead.
const GENERIC_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);

const unsupported = () =>
  new MediaFetchError(
    'unsupportedType',
    'The media is not an accepted image or video',
  );

// The declared type, by the upload's rule: the response's Content-Type, or the
// story's mime_type when the response names none or only a generic one.
function declaredType(
  header: string | null,
  mimeType: unknown,
): MediaContentType | null {
  const fallback =
    typeof mimeType === 'string'
      ? mimeType.split(';')[0].trim().toLowerCase()
      : null;
  const type = header === null || GENERIC_TYPES.has(header) ? fallback : header;
  return isMediaContentType(type) ? type : null;
}

/**
 * Downloads one source media file under the fetch policy and streams it into
 * storage under a new key (`tales/<uuid>.<ext>`), with the upload's rules: an
 * accepted type whose leading bytes match it, and no more bytes than its kind
 * allows. The body is never held whole in memory. A source failure is a
 * {@link MediaFetchError} and leaves nothing stored; a storage failure is
 * passed on as it is.
 */
export async function copyMedia(
  storage: MediaStorage,
  url: string,
  mimeType: unknown,
  policy: MediaFetchPolicy = {},
): Promise<CopiedMedia> {
  const signal = AbortSignal.timeout(
    policy.timeoutMs ?? MEDIA_FETCH_TIMEOUT_MS,
  );
  const res = await openMedia(url, policy, signal);
  const { body } = res;
  try {
    const contentType = declaredType(res.contentType, mimeType);
    if (contentType === null) throw unsupported();
    const limit = maxMediaBytes(contentType);
    if (res.contentLength !== null && res.contentLength > limit) {
      throw new MediaFetchError(
        'tooLarge',
        'The media is larger than its type allows',
      );
    }
    const hash = createHash('sha256');
    async function* checkedBytes(): AsyncGenerator<Uint8Array> {
      let head: Buffer[] = [];
      let headLength = 0;
      let headChecked = false;
      let total = 0;
      try {
        for await (const chunk of body as AsyncIterable<Buffer>) {
          total += chunk.length;
          if (total > limit)
            throw new MediaFetchError(
              'tooLarge',
              'The media is larger than its type allows',
            );
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
          if (!matchesMagicNumber(contentType as MediaContentType, leading))
            throw unsupported();
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
            : new MediaFetchError(
                'unreachable',
                'The media transfer broke off',
              ))
        );
      }
      if (!headChecked) {
        const leading = Buffer.concat(head);
        if (
          leading.length === 0 ||
          !matchesMagicNumber(contentType as MediaContentType, leading)
        )
          throw unsupported();
        yield leading;
      }
    }
    const key = `tales/${randomUUID()}.${mediaExtension(contentType)}`;
    await storage.putStream(key, checkedBytes());
    return { key, contentType, sha256: hash.digest('hex') };
  } finally {
    body.destroy();
  }
}

/** Copies one source media file into storage; {@link copyMedia} under a policy, or a stand-in in tests. */
export type MediaCopier = (
  url: string,
  mimeType: unknown,
) => Promise<CopiedMedia>;

/** What happened to one tale's media. */
export type TaleMediaOutcome =
  /** The story names no media: nothing to copy, and story 6's check lists it. */
  | { kind: 'none' }
  /** The tale holds the story's media: copied now, or kept from an earlier import. */
  | { kind: 'imported' }
  /** The tale holds media set in TaleArt, which an import does not replace. */
  | { kind: 'keptOwn' }
  /** The tale was deleted while the import ran. */
  | { kind: 'taleGone' }
  /** The media could not be copied; the tale stays without it. */
  | { kind: 'failed'; reason: ImportMediaFailure };

/** What {@link importTaleMedia} needs. */
export interface TaleMediaImport {
  storage: MediaStorage;
  copy: MediaCopier;
  /** Reports a file that could not be cleaned up; it never fails the import. */
  onCleanupError?: (err: unknown) => void;
}

/** The story a tale's media comes from: its id and the source's `media` and `mime_type` values. */
export interface MediaSourceStory {
  id: string;
  media?: unknown;
  mimeType?: unknown;
}

const mediaLinkSource = (projectId: string, storyId: string): LinkSource => ({
  projectId,
  sourceType: 'story_media',
  sourceId: storyId,
});

/** The storage key an earlier import stored for this story's media, or null (importer bookkeeping, AD-7). */
async function importedMediaKey(
  db: Db,
  projectId: string,
  storyId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ media_key: string }>(
    `SELECT media_key FROM import_media WHERE project_id = $1 AND source_system = $2 AND source_id = $3`,
    [projectId, SOURCE_SYSTEM, storyId],
  );
  return rows[0]?.media_key ?? null;
}

async function saveImportedMedia(
  db: Db,
  record: {
    projectId: string;
    storyId: string;
    taleId: string;
    media: CopiedMedia;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO import_media (project_id, source_system, source_id, tale_id, media_key, content_type, content_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id, source_system, source_id) DO UPDATE
       SET tale_id = EXCLUDED.tale_id, media_key = EXCLUDED.media_key, content_type = EXCLUDED.content_type,
           content_sha256 = EXCLUDED.content_sha256, updated_at = now()`,
    [
      record.projectId,
      SOURCE_SYSTEM,
      record.storyId,
      record.taleId,
      record.media.key,
      record.media.contentType,
      record.media.sha256,
    ],
  );
}

// What the tale holds now, against what this story's import stored.
async function currentOutcome(
  db: Db,
  projectId: string,
  taleId: string,
  storyId: string,
): Promise<TaleMediaOutcome | null> {
  const current = await getTaleMedia(db, taleId);
  if (current === null) return null;
  return (await importedMediaKey(db, projectId, storyId)) === current.key
    ? { kind: 'imported' }
    : { kind: 'keptOwn' };
}

/**
 * Gives an imported tale its story's media (AD-11): downloads it through
 * `copy`, then, in one transaction under the story's lock, sets the tale's
 * media key and content type through the tales module and records which key
 * came from which story. A tale that already holds media is left as it is, so
 * a re-run downloads and stores nothing twice; its media counts as imported
 * when an earlier import stored it, else as kept. A source failure leaves the
 * tale without media; database and storage failures are passed on.
 */
export async function importTaleMedia(
  db: TransactionalDb,
  media: TaleMediaImport,
  projectId: string,
  taleId: string,
  story: MediaSourceStory,
): Promise<TaleMediaOutcome> {
  const url = story.media;
  if (
    url === undefined ||
    url === null ||
    (typeof url === 'string' && url.trim() === '')
  )
    return { kind: 'none' };
  if (typeof url !== 'string') return { kind: 'failed', reason: 'invalidUrl' };
  try {
    const before = await currentOutcome(db, projectId, taleId, story.id);
    if (before !== null) return before;
  } catch (err) {
    if (err instanceof TaleNotFoundError) return { kind: 'taleGone' };
    throw err;
  }

  let copied: CopiedMedia;
  try {
    copied = await media.copy(url.trim(), story.mimeType);
  } catch (err) {
    if (err instanceof MediaFetchError)
      return { kind: 'failed', reason: err.reason };
    throw err;
  }

  const removeCopy = () =>
    media.storage
      .delete(copied.key)
      .catch((err) => media.onCleanupError?.(err));
  let outcome: {
    result: TaleMediaOutcome;
    used: boolean;
    previousKey: string | null;
  };
  try {
    outcome = await inTransaction(db, async (tx) => {
      await lockLinkSource(tx, mediaLinkSource(projectId, story.id));
      // Another import, or a person, may have set media while this one downloaded.
      const meanwhile = await currentOutcome(tx, projectId, taleId, story.id);
      if (meanwhile !== null)
        return { result: meanwhile, used: false, previousKey: null };
      const { previousKey } = await setTaleMedia(tx, taleId, {
        key: copied.key,
        contentType: copied.contentType,
      });
      await saveImportedMedia(tx, {
        projectId,
        storyId: story.id,
        taleId,
        media: copied,
      });
      return { result: { kind: 'imported' } as const, used: true, previousKey };
    });
  } catch (err) {
    await removeCopy();
    if (err instanceof TaleNotFoundError) return { kind: 'taleGone' };
    throw err;
  }
  if (!outcome.used) await removeCopy();
  // A key set between the check and the update: deleted only when nothing references it (AD-14).
  const { previousKey } = outcome;
  if (previousKey !== null && previousKey !== copied.key) {
    await isMediaKeyInUse(db, previousKey)
      .then((inUse) => (inUse ? undefined : media.storage.delete(previousKey)))
      .catch((err) => media.onCleanupError?.(err));
  }
  return outcome.result;
}
