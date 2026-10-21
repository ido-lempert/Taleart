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
  withMediaKeyDeletionGuard,
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
 * What one import may still spend on media: bytes left, and the time after
 * which no download starts its transfer. Shared by every download of the
 * import. `spentFrom` is the reading-order place of the first download refused
 * for the bytes (-1 without places): it and every later one are refused, never
 * an earlier one. `spent` says that some download was.
 */
export interface MediaJobBudget {
  bytesLeft: number;
  deadline: number;
  spent?: boolean;
  spentFrom?: number;
}

/** A fresh budget for one import, from the policy's per-job limits. */
export function mediaJobBudget(policy: MediaFetchPolicy = {}, now = Date.now()): MediaJobBudget {
  return {
    bytesLeft: policy.maxBytesPerJob ?? MEDIA_MAX_BYTES_PER_JOB,
    deadline: now + (policy.maxMsPerJob ?? MEDIA_MAX_MS_PER_JOB),
  };
}

/** The most bytes any one accepted media file may have: what an unsettled download may still take. */
const MAX_FILE_BYTES = Math.max(maxMediaBytes('image/jpeg'), maxMediaBytes('video/mp4'));

/**
 * One download's place in its import's reading order, for the job budget. A
 * download decides against the budget (reserves a declared length, or is
 * refused) only once every earlier one has decided, unless the budget is large
 * enough that their order cannot matter; and it is refused for the bytes only
 * once every earlier one has ended (and given back what it did not read). So
 * which media the budget refuses is the same as one download at a time, for
 * files that declare their length.
 */
export interface BudgetTicket {
  /** Its place in reading order, from 0. */
  readonly index: number;
  /** Resolves once every earlier ticket has decided; rejects when `signal` aborts. */
  turn(signal?: AbortSignal): Promise<void>;
  /** Resolves once every earlier ticket has ended; rejects when `signal` aborts. */
  earlierEnded(signal?: AbortSignal): Promise<void>;
  /** How many earlier tickets have not decided yet. */
  earlierOpen(): number;
  /** How many earlier tickets have not ended yet. */
  earlierRunning(): number;
  /** This download decided (reserved, streams without a length, or was refused); idempotent. */
  done(): void;
  /** This download ended, whatever its outcome; implies `done`; idempotent. */
  finish(): void;
}

// Waits for `work` until `signal` aborts.
function abortable(work: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

/** Hands out {@link BudgetTicket}s in the order the import reads its tales. */
export class BudgetTurns {
  private decided: Promise<void> = Promise.resolve();
  private ended: Promise<void> = Promise.resolve();
  private next = 0;
  private readonly open = new Set<number>();
  private readonly running = new Set<number>();

  ticket(): BudgetTicket {
    const index = this.next++;
    this.open.add(index);
    this.running.add(index);
    const beforeDecided = this.decided;
    const beforeEnded = this.ended;
    let decide: () => void = () => undefined;
    let end: () => void = () => undefined;
    const myDecision = new Promise<void>((resolve) => {
      decide = resolve;
    });
    const myEnd = new Promise<void>((resolve) => {
      end = resolve;
    });
    this.decided = Promise.all([beforeDecided, myDecision]).then(() => undefined);
    this.ended = Promise.all([beforeEnded, myEnd]).then(() => undefined);
    const done = () => {
      if (this.open.delete(index)) decide();
    };
    return {
      index,
      turn: (signal) => abortable(beforeDecided, signal),
      earlierEnded: (signal) => abortable(beforeEnded, signal),
      earlierOpen: () => [...this.open].filter((other) => other < index).length,
      earlierRunning: () => [...this.running].filter((other) => other < index).length,
      done,
      finish: () => {
        done();
        if (this.running.delete(index)) end();
      },
    };
  }
}

/** True when an earlier (or this) download was refused for the bytes: this one is refused too. */
const refusedBefore = (budget: MediaJobBudget, ticket: BudgetTicket | undefined): boolean =>
  budget.spentFrom !== undefined && (ticket === undefined || ticket.index >= budget.spentFrom);

// Refused for the bytes: this download's place and every later one's are spent.
class BytesSpent extends MediaFetchError {
  constructor() {
    super('jobBudgetExceeded', 'The import already copied as much media as one import may');
  }
}

// Refused because the import's media time is up: it marks nothing spent, since an earlier download may still run.
const timeUp = () => new MediaFetchError('jobBudgetExceeded', 'The import already spent as long on media as it may');

// Its turn came after the download had opened: open it again, now that its reservation is decided in order.
class TurnTaken extends Error {}

// Types that say nothing about the file: the story's `mime_type` decides instead.
const GENERIC_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);

const unsupported = () => new MediaFetchError('unsupportedType', 'The media is not an accepted image or video');

const stopped = () => new MediaFetchError('timeout', 'The media download took too long');

// The declared type, by the upload's rule: the response's Content-Type, or the
// story's mime_type when the response names none or only a generic one.
function declaredType(header: string | null, mimeType: unknown): MediaContentType | null {
  const fallback = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : null;
  const type = header === null || GENERIC_TYPES.has(header) ? fallback : header;
  return isMediaContentType(type) ? type : null;
}

/**
 * The per-download deadline: it starts when the download takes its host slot
 * (its transfer starts), not while it queues, and starts again when the
 * download opens again after its budget turn.
 */
class TransferClock {
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the running transfer must end (epoch ms); undefined before it starts. */
  until: number | undefined;

  constructor(private readonly timeoutMs: number) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.until = Date.now() + this.timeoutMs;
    const controller = this.controller;
    this.timer = setTimeout(() => controller.abort(), this.timeoutMs);
  }

  restart(): void {
    this.stop();
    this.controller = new AbortController();
    this.until = undefined;
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Downloads one source media file under the fetch policy and streams it into
 * storage under a new key (`tales/imported-<uuid>.<ext>`), with the upload's
 * rules: an accepted type whose leading bytes match it, and no more bytes than
 * its kind allows. The body is never held whole in memory.
 *
 * The per-download deadline (120 s by default) counts from when the download
 * holds its host slot; waiting for a slot or a budget turn is bounded by the
 * job's media deadline and `abort` instead. A reply 429 or 5xx is tried again
 * with backoff (or after its `Retry-After`) when the wait fits in the
 * download's deadline, else it fails at once as `httpError`; every try goes
 * through the guard again.
 *
 * With a job budget, a download that has not started its transfer by the job's
 * media deadline is refused, in its turn; one that has started is never
 * refused by it. A declared length is reserved before the body is read, in
 * the ticket's turn when the budget is close to binding (after the turn, a
 * spent budget is refused without a request), and what is not read is given
 * back. A body without a length is taken from the budget as it arrives
 * (downloads running at once may then be refused in another order than one at
 * a time). A download refused for the bytes gives back what it read and spends
 * the budget from its place on. `abort` stops the download (the job stopped).
 * A source failure is a {@link MediaFetchError} and leaves nothing stored; a
 * storage failure is passed on as it is.
 */
export async function copyMedia(
  storage: MediaStorage,
  url: string,
  mimeType: unknown,
  policy: MediaFetchPolicy = {},
  budget?: MediaJobBudget,
  abort?: AbortSignal,
  ticket?: BudgetTicket,
): Promise<CopiedMedia> {
  const clock = new TransferClock(policy.timeoutMs ?? MEDIA_FETCH_TIMEOUT_MS);
  try {
    if (budget) await startInTurn(budget, ticket, abort);
    // Waiting for a host slot is bounded by the job's media deadline (and the stop), not the transfer's.
    const timeLeft = budget ? budget.deadline - Date.now() : Infinity;
    const jobDeadline = Number.isFinite(timeLeft) ? AbortSignal.timeout(Math.max(1, timeLeft)) : undefined;
    const retry = retryPolicy(policy.retry);
    for (let attempt = 1; ; ) {
      const waiting = AbortSignal.any([clock.signal, ...(abort ? [abort] : []), ...(jobDeadline ? [jobDeadline] : [])]);
      const hostSlots = policy.hostSlots;
      const opened: MediaFetchPolicy = hostSlots
        ? {
            ...policy,
            hostSlots: {
              acquire: async (host: string) => {
                // The transfer has started once a hop holds its slot; until then the job deadline bounds the wait.
                const signal =
                  clock.until === undefined ? waiting : AbortSignal.any([clock.signal, ...(abort ? [abort] : [])]);
                let release: () => void;
                try {
                  release = await hostSlots.acquire(host, signal);
                } catch {
                  throw clock.until === undefined && jobDeadline?.aborted && !abort?.aborted ? timeUp() : stopped();
                }
                clock.start();
                return release;
              },
            },
          }
        : policy;
      if (!hostSlots) clock.start();
      const signal = AbortSignal.any([clock.signal, ...(abort ? [abort] : [])]);
      try {
        return await copyOnce(storage, url, mimeType, opened, budget, signal, ticket, abort);
      } catch (err) {
        if (err instanceof TurnTaken) {
          clock.restart();
          continue;
        }
        const reply = err instanceof MediaFetchError && err.reason === 'httpError' ? err.reply : undefined;
        if (!reply || !isRetryableStatus(reply.status) || attempt >= retry.attempts) throw err;
        const wait = retryDelayMs(attempt - 1, reply.retryAfterMs, retry);
        // A wait that cannot end before the transfer's deadline is not waited: the reply stands.
        if (clock.until !== undefined && Date.now() + wait >= clock.until) throw err;
        try {
          await sleep(wait, signal);
        } catch {
          throw stopped();
        }
        attempt++;
      }
    }
  } catch (err) {
    // Refused for the bytes: the budget is spent from this download's place on, never for an earlier one.
    if (budget && err instanceof BytesSpent) {
      budget.spent = true;
      const place = ticket?.index ?? -1;
      budget.spentFrom = budget.spentFrom === undefined ? place : Math.min(budget.spentFrom, place);
    }
    throw err;
  } finally {
    clock.stop();
    ticket?.finish();
  }
}

/**
 * Before a download starts: refused when an earlier one spent the budget; when
 * the media time is up or no bytes are left, it decides only in its turn (and,
 * for the bytes, once the earlier ones have given back what they did not
 * read), so a later download never decides for an earlier one.
 */
async function startInTurn(
  budget: MediaJobBudget,
  ticket: BudgetTicket | undefined,
  abort: AbortSignal | undefined,
): Promise<void> {
  if (refusedBefore(budget, ticket)) throw new BytesSpent();
  if (Date.now() < budget.deadline && budget.bytesLeft > 0) return;
  try {
    await ticket?.turn(abort);
    if (budget.bytesLeft <= 0 && Date.now() < budget.deadline) await ticket?.earlierEnded(abort);
  } catch {
    throw stopped();
  }
  if (refusedBefore(budget, ticket)) throw new BytesSpent();
  if (Date.now() >= budget.deadline) throw timeUp();
  if (budget.bytesLeft <= 0) throw new BytesSpent();
}

// One try of copyMedia: opens the URL and streams its checked bytes into storage.
async function copyOnce(
  storage: MediaStorage,
  url: string,
  mimeType: unknown,
  policy: MediaFetchPolicy,
  budget: MediaJobBudget | undefined,
  signal: AbortSignal,
  ticket: BudgetTicket | undefined,
  abort: AbortSignal | undefined,
): Promise<CopiedMedia> {
  const res = await openMedia(url, policy, signal);
  const { body } = res;
  // Bytes reserved from the budget for a declared length, and bytes taken as read.
  let reserved = 0;
  let taken = 0;
  let read = 0;
  // Closes this try and waits for `work` (a turn), holding no host slot; then the download opens again.
  const reopenAfter = async (work: (signal?: AbortSignal) => Promise<void>): Promise<never> => {
    body.destroy();
    res.release();
    try {
      await work(abort);
    } catch {
      throw stopped();
    }
    // An earlier download spent the budget meanwhile: refused without a request.
    if (budget && refusedBefore(budget, ticket)) throw new BytesSpent();
    throw new TurnTaken();
  };
  try {
    const contentType = declaredType(res.contentType, mimeType);
    if (contentType === null) throw unsupported();
    const limit = maxMediaBytes(contentType);
    if (res.contentLength !== null && res.contentLength > limit) {
      throw new MediaFetchError('tooLarge', 'The media is larger than its type allows');
    }
    if (budget) {
      if (refusedBefore(budget, ticket)) throw new BytesSpent();
      const length = res.contentLength;
      if (length !== null) {
        // The earlier downloads may still take up to a whole file each: only when that cannot matter does this
        // one reserve out of turn. Otherwise it waits for its turn, and when the bytes left are too few then, for
        // the earlier downloads to end and give back what they did not read.
        const room = budget.bytesLeft - (ticket ? ticket.earlierOpen() * MAX_FILE_BYTES : 0);
        if (ticket && room < length && ticket.earlierOpen() > 0) await reopenAfter(ticket.turn);
        if (ticket && length > budget.bytesLeft && ticket.earlierRunning() > 0) await reopenAfter(ticket.earlierEnded);
        if (length > budget.bytesLeft) throw new BytesSpent();
        budget.bytesLeft -= length;
        reserved = length;
      }
    }
    ticket?.done();
    const hash = createHash('sha256');
    async function* checkedBytes(): AsyncGenerator<Uint8Array> {
      let head: Buffer[] = [];
      let headLength = 0;
      let headChecked = false;
      try {
        for await (const chunk of body as AsyncIterable<Buffer>) {
          read += chunk.length;
          if (read > limit) throw new MediaFetchError('tooLarge', 'The media is larger than its type allows');
          if (budget && read > reserved) {
            // Past what was reserved (no length declared): taken as read, so concurrent downloads share the budget.
            const more = read - reserved - taken;
            budget.bytesLeft -= more;
            taken += more;
            if (budget.bytesLeft < 0) throw new BytesSpent();
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
          (signal.aborted ? stopped() : new MediaFetchError('unreachable', 'The media transfer broke off'))
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
  } catch (err) {
    if (budget && err instanceof BytesSpent) {
      // Refused for the bytes: what it took goes back, so the downloads before it in reading order keep their room.
      budget.bytesLeft += taken;
      taken = 0;
    }
    throw err;
  } finally {
    // A reserved length not read in full goes back; bytes read count as spent, as one at a time.
    if (budget && reserved > 0) budget.bytesLeft += reserved - Math.min(read, reserved);
    body.destroy();
    res.release();
  }
}

/**
 * Copies one source media file into storage; {@link copyMedia} under a policy,
 * or a stand-in in tests. `signal` aborts it when the job stops; `ticket` is
 * its place in reading order for the byte budget.
 */
export type MediaCopier = (
  url: string,
  mimeType: unknown,
  signal?: AbortSignal,
  ticket?: BudgetTicket,
) => Promise<CopiedMedia>;

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
  /**
   * Runs first in the transaction that writes the tale's media: the job's
   * claim guard, which throws when this worker no longer holds the job, so a
   * stopped run writes nothing.
   */
  beforeWrite?: (tx: Db) => Promise<void>;
  /** Runs each phase that uses the database (reads, then the write), such as under a slot limit; directly by default. */
  withDb?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Hands out each tale's place in reading order for the byte budget; the importer takes one per tale. */
  turns?: BudgetTurns;
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
  ticket?: BudgetTicket,
): Promise<TaleMediaOutcome> {
  try {
    return await importTaleMediaWith(db, media, projectId, taleId, story, signal, ticket);
  } finally {
    // No download, or one that ended early: its place in the budget's order passes on.
    ticket?.finish();
  }
}

async function importTaleMediaWith(
  db: TransactionalDb,
  media: TaleMediaImport,
  projectId: string,
  taleId: string,
  story: MediaSourceStory,
  signal: AbortSignal | undefined,
  ticket: BudgetTicket | undefined,
): Promise<TaleMediaOutcome> {
  const withDb = media.withDb ?? (<T>(work: () => Promise<T>) => work());
  const url = story.media;
  if (url === undefined || url === null || (typeof url === 'string' && url.trim() === '')) return { kind: 'none' };
  if (typeof url !== 'string') return { kind: 'failed', reason: 'invalidUrl', keptEarlier: false };
  const digest = sourceMediaDigest(url.trim(), story.mimeType);
  let earlier: ImportedMedia | null;
  try {
    const found = await withDb(async () => {
      const before = await currentOutcome(db, taleId, digest);
      return { before, earlier: before === null ? null : await importedMedia(db, taleId) };
    });
    if (found.before !== null && found.before.kind !== 'imported') return found.before;
    earlier = found.earlier;
    // The import's copy is in place and the source names the same media: nothing to download.
    if (earlier !== null && earlier.digest === digest) return { kind: 'imported', change: 'unchanged' };
  } catch (err) {
    if (err instanceof TaleNotFoundError) return { kind: 'taleGone' };
    throw err;
  }

  let copied: CopiedMedia;
  try {
    copied = await media.copy(url.trim(), story.mimeType, signal, ticket);
  } catch (err) {
    if (err instanceof MediaFetchError) return { kind: 'failed', reason: err.reason, keptEarlier: earlier !== null };
    throw err;
  }

  const removeCopy = () => media.storage.delete(copied.key).catch((err) => media.onCleanupError?.(err));
  let result: { outcome: TaleMediaOutcome; used: boolean };
  try {
    result = await withDb(() =>
      inTransaction(db, async (tx) => {
        // A run that lost its job writes nothing; the guard holds the job row until this commits.
        await media.beforeWrite?.(tx);
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
      }),
    );
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
  db: TransactionalDb,
  storage: SweepableStorage,
  now = Date.now(),
): Promise<{ temporary: number; imported: number }> {
  const temporary = await storage.removeStaleTemporaryFiles('tales', MEDIA_SWEEP_MIN_AGE_MS, now);
  let imported = 0;
  for (const { key, modifiedAt } of await storage.listKeys('tales')) {
    if (!key.startsWith(IMPORTED_MEDIA_PREFIX) || now - modifiedAt.getTime() < MEDIA_SWEEP_MIN_AGE_MS) continue;
    // Decided and deleted under the key's lock, so no document write can start using it meanwhile.
    const removed = await withMediaKeyDeletionGuard(db, key, async (inUse) => {
      if (inUse) return false;
      const { rows } = await db.query('SELECT 1 FROM import_media WHERE media_key = $1 LIMIT 1', [key]);
      if (rows.length > 0) return false;
      await storage.delete(key);
      return true;
    });
    if (removed) imported++;
  }
  return { temporary, imported };
}
