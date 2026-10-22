// A tale's own media in its documents (epic Tale Studio R16, AD-15 Migration): the tale's media
// (`tales.media_key`) is an image or video element marked `taleMedia` in its draft and published
// documents. `tales.document_media_key` records the media key the documents were last brought in
// step with, so a tale is out of step exactly when its media key differs from it. The media writes
// bring the documents in step in their own transaction; the start-up migration, continued in the
// background, brings every older tale in step; and the Delivery API composes the media in for a
// tale that is still out of step, so what visitors see never waits on the migration.
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CANVAS_COLOR,
  isMediaContentType,
  isMediaKey,
  isTaleMediaElement,
  LEGACY_TALE_DURATION_MS,
  mediaContentTypeOfKey,
  mediaKind,
  TALE_DOCUMENT_VERSION,
  taleMediaElement,
  type MediaContentType,
  type TaleDocument,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { lockMediaKeys, recordTaleMedia } from './document-media';
import { checkPublishableDocument, checkTaleDocument } from './tale-document';
import { inTransaction, type TransactionalDb } from './tales';

/** The tale's media as a document element shows it: its key and the kind of element. */
export interface TaleMediaRef {
  key: string;
  kind: 'image' | 'video';
}

/** How {@link mergeTaleMedia} brings a document in step. */
export interface TaleMediaMergeOptions {
  /**
   * An import's re-import (AD-7): only `taleMedia` elements still holding this key take the new
   * key, so a person's edit in Tale Studio (other media picked, the element removed) is kept.
   */
  expectedKey?: string;
  /**
   * The first merge into a document from before documents held media: a document without
   * `durationMs` gets the 5 s tale media always showed for, where it would now play 7 s.
   */
  legacyTiming?: boolean;
  /** The new element's id; a fresh UUID by default. */
  id?: string;
}

/** A document of only the tale's media (R16): black canvas, the media full canvas, 5 s. */
export function taleMediaDocument(media: TaleMediaRef, id: string = randomUUID()): TaleDocument {
  return {
    version: TALE_DOCUMENT_VERSION,
    canvas: { background: { type: 'color', color: DEFAULT_CANVAS_COLOR } },
    durationMs: LEGACY_TALE_DURATION_MS,
    elements: [taleMediaElement(id, media.key, media.kind)],
  };
}

/**
 * The document in step with the tale's media (R16), or the same object when nothing changes. No
 * document gets {@link taleMediaDocument}. A document's `taleMedia` element takes the key (and the
 * element type, image or video); with none, the media goes in at the bottom of the z-order, under
 * everything a person composed. With `expectedKey`, only elements still holding it change, and
 * nothing is added.
 */
export function mergeTaleMedia<D extends { elements: readonly unknown[]; durationMs?: number }>(
  doc: D | null,
  media: TaleMediaRef,
  options: TaleMediaMergeOptions = {},
): D | TaleDocument {
  if (doc === null) return taleMediaDocument(media, options.id);
  const own = doc.elements.filter(isTaleMediaElement) as { props: { mediaKey?: unknown } }[];
  let elements: readonly unknown[];
  if (own.length > 0) {
    let changed = false;
    elements = doc.elements.map((element) => {
      if (!isTaleMediaElement(element)) return element;
      const e = element as { type: string; props: { mediaKey?: unknown } };
      if (options.expectedKey !== undefined && e.props.mediaKey !== options.expectedKey) return element;
      if (e.type === media.kind && e.props.mediaKey === media.key) return element;
      changed = true;
      return { ...e, type: media.kind, props: { ...e.props, mediaKey: media.key } };
    });
    if (!changed) return doc;
  } else if (options.expectedKey !== undefined) {
    return doc;
  } else {
    elements = [taleMediaElement(options.id ?? randomUUID(), media.key, media.kind), ...doc.elements];
  }
  const timing = options.legacyTiming && doc.durationMs === undefined ? { durationMs: LEGACY_TALE_DURATION_MS } : {};
  return { ...doc, ...timing, elements } as D;
}

/**
 * The tale's media as a document element can hold it, or null: a key the document schema accepts
 * (`tales/…` or `media/…` with a media extension) whose kind agrees with the stored content type.
 */
export function documentTaleMedia(key: string | null, contentType: string | null): TaleMediaRef | null {
  if (key === null || !isMediaKey(key) || !isMediaContentType(contentType)) return null;
  const type = mediaContentTypeOfKey(key);
  if (type === null || mediaKind(type) !== mediaKind(contentType as MediaContentType)) return null;
  return { key, kind: mediaKind(type) };
}

// True when the document passes the check `check` makes.
function passes(doc: unknown, check: (doc: unknown) => unknown): boolean {
  try {
    check(doc);
    return true;
  } catch {
    return false;
  }
}

/**
 * The document with the tale's media composed in while the tale is out of step (R16), as the
 * migration would (under the tale's id as the element id, so the answer stays the same between
 * reads, and with legacy timing for a tale never in step), for showing it before it is written: the
 * Delivery API and Tale Studio's read. Unchanged when there is no media, the tale is in step, the
 * stored value has the wrong shape, or the merge would make a passing document fail.
 */
export function withOutOfStepMedia<D extends { elements: readonly unknown[]; durationMs?: number }>(
  taleId: string,
  doc: D | null,
  media: TaleMediaRef | null,
  inStep: string | null,
): D | TaleDocument | null {
  if (media === null || (doc !== null && inStep === media.key) || (doc !== null && !wellFormed(doc))) return doc;
  const merged = mergeTaleMedia(doc, media, { id: taleId, legacyTiming: inStep === null });
  if (doc !== null && merged !== doc && passes(doc, checkTaleDocument) && !passes(merged, checkTaleDocument)) {
    return doc;
  }
  return merged;
}

// True when the stored value has the shape a merge needs: an object with an `elements` array.
function wellFormed(doc: unknown): boolean {
  return typeof doc === 'object' && doc !== null && Array.isArray((doc as { elements?: unknown }).elements);
}

// The deployment switch (TALE_MEDIA_MIGRATION, read by the API): while it is off the tales module
// never writes `taleMedia` elements, so instances of the previous release, which refuse them, can
// run beside this one; tales then stay out of step and the Delivery API composes their media in.
let enabled = true;

/** Turns writing the tale's media into its documents (R16) on (the default) or off. */
export function setTaleMediaDocumentsEnabled(on: boolean): void {
  enabled = on;
}

/** True while the tales module writes the tale's media into its documents (R16). */
export function taleMediaDocumentsEnabled(): boolean {
  return enabled;
}

/** What {@link bringTaleMediaInStep} did. */
export type InStepOutcome = 'merged' | 'unchanged' | 'skipped' | 'gone' | 'off';

/** Why a tale was left out of step: its key, the document limits, or a stored document of the wrong shape. */
export type SkipReason = 'key' | 'limits' | 'malformed';

interface TaleRowForMedia {
  key: string | null;
  contentType: string | null;
  inStep: string | null;
  status: string;
  draft: TaleDocument | null;
  published: TaleDocument | null;
}

/** How {@link bringTaleMediaInStep} brings a tale in step. */
export interface InStepOptions {
  /**
   * An import's re-import (AD-7): the import's earlier key. Only when the documents were last in
   * step with it does the re-import mode apply (a `taleMedia` element still showing it takes the new
   * key; a person's edit is kept); a tale out of step is merged in full.
   */
  expectedKey?: string;
}

/**
 * Brings the tale's documents in step with its media (R16), in the caller's transaction, after
 * locking the tale row (every document write takes the row, then its keys). The draft is merged;
 * with none it is made from the published document, else from the media alone. The published
 * document is merged, or created only for a tale that is `live` now (otherwise going live publishes
 * the draft, as for any tale, 7.3). A tale never in step before gets legacy timing (5 s unless the
 * document sets a duration). Each changed document raises its revision, so an editor who had the
 * old one is asked to reload (409), and its `tale_media` rows are written. The tale is then in step
 * (`document_media_key`), even when nothing changed because a person's edit was kept.
 *
 * Skipped, leaving the tale out of step (the Delivery API then composes its media in), with the
 * reason recorded: a media key no document can hold, a merge that would make a passing document
 * fail (such as one with 60 elements already), and a stored document of the wrong shape. Does
 * nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function bringTaleMediaInStep(
  tx: Db,
  taleId: string,
  options: InStepOptions = {},
): Promise<InStepOutcome> {
  if (!enabled) return 'off';
  const { rows } = await tx.query<TaleRowForMedia>(
    `SELECT media_key AS key, media_content_type AS "contentType", document_media_key AS "inStep", status,
       draft_document AS draft, document AS published
     FROM tales WHERE id = $1 FOR UPDATE`,
    [taleId],
  );
  if (rows.length === 0) return 'gone';
  // Absent columns read as null, so a document never merges into `undefined`.
  const row = { ...rows[0], draft: rows[0].draft ?? null, published: rows[0].published ?? null };
  if (row.key === null || row.key === undefined) {
    if (row.inStep) await tx.query('UPDATE tales SET document_media_key = NULL WHERE id = $1', [taleId]);
    return 'unchanged';
  }
  const skip = async (reason: SkipReason): Promise<InStepOutcome> => {
    await tx.query(
      'UPDATE tales SET document_media_skip_key = media_key, document_media_skip_reason = $2 WHERE id = $1',
      [taleId, reason],
    );
    return 'skipped';
  };
  const media = documentTaleMedia(row.key, row.contentType);
  if (media === null) return skip('key');
  if ((row.draft !== null && !wellFormed(row.draft)) || (row.published !== null && !wellFormed(row.published))) {
    return skip('malformed');
  }
  await lockMediaKeys(tx, [media.key]);
  // One id for both documents' new element, so the draft and the published document stay alike.
  const merge: TaleMediaMergeOptions = {
    id: randomUUID(),
    legacyTiming: row.inStep === null,
    // The re-import mode only while the documents were in step with the import's key.
    ...(options.expectedKey !== undefined &&
      row.inStep === options.expectedKey && { expectedKey: options.expectedKey }),
  };
  const draft = mergeTaleMedia(row.draft ?? row.published, media, merge) as TaleDocument;
  const published =
    row.published !== null || row.status === 'live'
      ? (mergeTaleMedia(row.published, media, merge) as TaleDocument)
      : null;
  for (const [before, after] of [
    [row.draft ?? row.published, draft],
    [row.published, published],
  ] as const) {
    if (before !== null && after !== before && passes(before, checkTaleDocument) && !passes(after, checkTaleDocument)) {
      return skip('limits');
    }
  }
  const draftChanged = draft !== row.draft;
  const publishedChanged = published !== row.published;
  await tx.query(
    `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + $3,
       document = $4::jsonb, document_revision = document_revision + $5, document_media_key = media_key,
       document_media_skip_key = NULL, document_media_skip_reason = NULL
     WHERE id = $1`,
    [
      taleId,
      JSON.stringify(draft),
      draftChanged ? 1 : 0,
      published === null ? null : JSON.stringify(published),
      publishedChanged ? 1 : 0,
    ],
  );
  if (draftChanged) await recordTaleMedia(tx, taleId, 'draft', draft, false);
  if (publishedChanged) {
    await recordTaleMedia(tx, taleId, 'published', published, passes(published, checkPublishableDocument));
  }
  return draftChanged || publishedChanged ? 'merged' : 'unchanged';
}

/** How a migration run went. */
export interface TaleMediaMigration {
  /** Tales whose documents got their media. */
  merged: number;
  /** Tales left out of step for a recorded reason (see {@link SkipReason}). */
  skipped: number;
  /** True when no tale is left that a run could still bring in step. */
  done: boolean;
}

/** How the migration runs: rows per transaction, and how long one pass may take before it stops. */
export interface TaleMediaMigrationOptions {
  batchSize?: number;
  budgetMs?: number;
  /** Where progress and skipped rows are reported (the API's structured log). */
  log?: (level: 'info' | 'warn', msg: string) => void;
}

const NO_UUID = '00000000-0000-0000-0000-000000000000';

interface CandidateRow {
  id: string;
  projectId: string;
  key: string;
  contentType: string | null;
  status: string;
  bare: boolean;
}

// The tales still out of step; without `retrySkipped`, not those skipped for their current key.
const OUT_OF_STEP = `media_key IS NOT NULL AND document_media_key IS DISTINCT FROM media_key`;
const NOT_SKIPPED = `document_media_skip_key IS DISTINCT FROM media_key`;

/**
 * One pass of the R16 migration over the tales out of step, in id order, `batchSize` per
 * transaction. Rows another transaction holds (such as a save in flight) are skipped and left for
 * the next pass; rows skipped for a recorded reason are retried only with `retrySkipped` (each
 * start). A tale with no document at all, nearly every older tale, is written by one set-based
 * statement per batch: the draft (and, when it is `live`, the published document) of only its
 * media, and their `tale_media` rows. A tale with a document goes through
 * {@link bringTaleMediaInStep} inside a savepoint, so one that fails unexpectedly is rolled back,
 * logged and marked, and the batch goes on. Idempotent: a tale in step is never selected again, so
 * an element a person removed never comes back.
 */
async function migrationPass(
  run: <T>(work: (tx: Db) => Promise<T>) => Promise<T>,
  options: Required<Omit<TaleMediaMigrationOptions, 'log'>> & Pick<TaleMediaMigrationOptions, 'log'>,
  deadline: number,
  retrySkipped: boolean,
): Promise<TaleMediaMigration> {
  let after = NO_UUID;
  let merged = 0;
  let skipped = 0;
  for (;;) {
    const batch = await run(async (tx) => {
      const { rows } = await tx.query<CandidateRow>(
        `SELECT id, project_id AS "projectId", media_key AS key, media_content_type AS "contentType", status,
           (document IS NULL AND draft_document IS NULL) AS bare
         FROM tales
         WHERE id > $1 AND ${OUT_OF_STEP} AND ($3 OR ${NOT_SKIPPED})
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [after, options.batchSize, retrySkipped],
      );
      if (rows.length === 0) return null;
      const bare: { row: CandidateRow; media: TaleMediaRef }[] = [];
      let batchSkipped = 0;
      let batchMerged = 0;
      for (const row of rows) {
        const media = documentTaleMedia(row.key, row.contentType);
        if (row.bare && media !== null) {
          bare.push({ row, media });
          continue;
        }
        await tx.query('SAVEPOINT tale_media_row');
        let outcome: InStepOutcome;
        try {
          outcome = await bringTaleMediaInStep(tx, row.id);
          await tx.query('RELEASE SAVEPOINT tale_media_row');
        } catch (err) {
          await tx.query('ROLLBACK TO SAVEPOINT tale_media_row');
          await tx.query(
            `UPDATE tales SET document_media_skip_key = media_key, document_media_skip_reason = 'malformed'
             WHERE id = $1`,
            [row.id],
          );
          options.log?.('warn', `Tale ${row.id}: its media could not be put in its documents (${String(err)})`);
          outcome = 'skipped';
        }
        if (outcome === 'skipped') batchSkipped++;
        else if (outcome === 'merged' || outcome === 'unchanged') batchMerged++;
      }
      if (bare.length > 0) {
        const docs = bare.map(({ media }) => JSON.stringify(taleMediaDocument(media)));
        const updated = await tx.query<{ id: string }>(
          `UPDATE tales t SET draft_document = x.doc, draft_revision = t.draft_revision + 1,
             document = CASE WHEN t.status = 'live' THEN x.doc ELSE t.document END,
             document_revision = t.document_revision + CASE WHEN t.status = 'live' THEN 1 ELSE 0 END,
             document_media_key = t.media_key, document_media_skip_key = NULL, document_media_skip_reason = NULL
           FROM unnest($1::uuid[], $2::jsonb[]) AS x(id, doc)
           WHERE t.id = x.id AND t.document IS NULL AND t.draft_document IS NULL
           RETURNING t.id`,
          [bare.map(({ row }) => row.id), docs],
        );
        const done = new Set(updated.rows.map((r) => r.id));
        const written = bare.filter(({ row }) => done.has(row.id));
        // Draft rows for all; published rows, delivered, for the live ones (the document passes every check).
        const refs = written.flatMap(({ row, media }) => [
          { row, key: media.key, which: 'draft', delivered: false },
          ...(row.status === 'live' ? [{ row, key: media.key, which: 'published', delivered: true }] : []),
        ]);
        if (refs.length > 0) {
          await tx.query(
            `INSERT INTO tale_media (tale_id, storage_key, document, project_id, content_type, delivered)
             SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::uuid[], $5::text[], $6::boolean[])
             ON CONFLICT (tale_id, document, storage_key) DO UPDATE SET delivered = EXCLUDED.delivered`,
            [
              refs.map((r) => r.row.id),
              refs.map((r) => r.key),
              refs.map((r) => r.which),
              refs.map((r) => r.row.projectId),
              refs.map((r) => mediaContentTypeOfKey(r.key)),
              refs.map((r) => r.delivered),
            ],
          );
        }
        batchMerged += written.length;
      }
      return { last: rows[rows.length - 1].id, merged: batchMerged, skipped: batchSkipped };
    });
    if (batch === null) return { merged, skipped, done: true };
    after = batch.last;
    merged += batch.merged;
    skipped += batch.skipped;
    // At least one batch per run, so every run makes progress.
    if (Date.now() >= deadline) return { merged, skipped, done: false };
  }
}

function withDefaults(options: TaleMediaMigrationOptions) {
  return { batchSize: options.batchSize ?? 500, budgetMs: options.budgetMs ?? 10_000, log: options.log };
}

/**
 * The R16 migration at API start, on the migration runner's connection (which holds the migration
 * lock): one pass, each batch its own transaction, until `budgetMs` (10 s by default) has passed
 * after a batch, so a large install still starts promptly; {@link continueTaleMediaMigration}
 * finishes it. Rows skipped before for a recorded reason are tried once more here (a person may
 * have edited the document since). Does nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function migrateTaleMediaDocuments(
  client: Db,
  options: TaleMediaMigrationOptions = {},
): Promise<TaleMediaMigration> {
  if (!enabled) return { merged: 0, skipped: 0, done: false };
  const settings = withDefaults(options);
  const run = async <T>(work: (tx: Db) => Promise<T>): Promise<T> => {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  };
  return migrationPass(run, settings, Date.now() + settings.budgetMs, true);
}

/** How the background continuation retries. */
export interface TaleMediaContinuation extends TaleMediaMigrationOptions {
  /** The most passes; between them it waits `baseDelayMs`, doubling up to `maxDelayMs`. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Stops it between batches and waits (the API's shutdown). */
  signal?: AbortSignal;
}

const CONTINUATION_LOCK = "hashtextextended('taleart:tale-media-migration', 0)";

/**
 * Finishes the R16 migration after start, beside requests. One process works at a time (a session
 * advisory lock; another process that finds it taken returns at once). Passes repeat while tales
 * remain that were not skipped for a recorded reason (such as rows a save held), waiting with a
 * doubling backoff between them, at most `attempts` times, and stop early on `signal`. Progress is
 * logged after each pass. Does nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function continueTaleMediaMigration(
  pool: TransactionalDb,
  options: TaleMediaContinuation = {},
): Promise<TaleMediaMigration> {
  const total: TaleMediaMigration = { merged: 0, skipped: 0, done: false };
  if (!enabled) return total;
  const settings = withDefaults({ ...options, budgetMs: options.budgetMs ?? 60 * 60 * 1000 });
  const holder = await pool.connect();
  let failed: Error | undefined;
  try {
    const { rows } = await holder.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(${CONTINUATION_LOCK}) AS locked`,
    );
    if (!rows[0].locked) {
      options.log?.('info', 'Tale media in documents: another process is finishing the migration');
      return total;
    }
    try {
      const run = <T>(work: (tx: Db) => Promise<T>): Promise<T> => inTransaction(pool, work);
      let delay = options.baseDelayMs ?? 1000;
      for (let attempt = 0; attempt < (options.attempts ?? 8) && !options.signal?.aborted; attempt++) {
        const result = await migrationPass(run, settings, Date.now() + settings.budgetMs, false);
        total.merged += result.merged;
        const counts = await pool.query<{ remaining: number; skipped: number }>(
          `SELECT count(*) FILTER (WHERE ${NOT_SKIPPED})::int AS remaining,
             count(*) FILTER (WHERE NOT (${NOT_SKIPPED}))::int AS skipped
           FROM tales WHERE ${OUT_OF_STEP}`,
        );
        total.skipped = counts.rows[0].skipped;
        total.done = counts.rows[0].remaining === 0;
        options.log?.(
          total.done ? 'info' : 'warn',
          `Tale media in documents: ${total.merged} tale(s) merged, ${counts.rows[0].remaining} to go, ${total.skipped} skipped`,
        );
        if (total.done) break;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          options.signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
        });
        delay = Math.min(delay * 2, options.maxDelayMs ?? 60_000);
      }
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(${CONTINUATION_LOCK})`);
    }
    return total;
  } catch (err) {
    failed = err as Error;
    throw err;
  } finally {
    holder.release(failed);
  }
}
