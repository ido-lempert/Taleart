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
import { inTransaction, withClient, type Db, type TransactionalDb } from '@taleart/server-access';
import { lockMediaKeys, recordTaleMedia } from './document-media';
import { checkPublishableDocument, checkTaleDocument } from './tale-document';

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
  /**
   * The media migration's run (R16), which writes the published document a `live` tale with none
   * would have been delivered as. A media write (upload, replace, import) instead leaves a `live`
   * tale with a studio draft and nothing published without a published document: the draft is
   * "not updated yet" until the person publishes it (epic UX rework R6).
   */
  migration?: boolean;
  /**
   * An import's first media for a tale whose draft is still exactly what the import made (epic Tale
   * Studio R17: its button): a `live` tale with nothing published publishes that draft, with the
   * media merged in, so an imported tale is delivered with its media and button together, never
   * as a button alone.
   */
  publishDraft?: boolean;
}

// The tale row as the media steps read it, locked; absent columns read as null.
async function lockedTale(tx: Db, taleId: string): Promise<TaleRowForMedia | null> {
  const { rows } = await tx.query<TaleRowForMedia>(
    `SELECT media_key AS key, media_content_type AS "contentType", document_media_key AS "inStep", status,
       draft_document AS draft, document AS published
     FROM tales WHERE id = $1 FOR UPDATE`,
    [taleId],
  );
  if (rows.length === 0) return null;
  return { ...rows[0], key: rows[0].key ?? null, draft: rows[0].draft ?? null, published: rows[0].published ?? null };
}

/**
 * Brings the tale's documents in step with its media (R16), in the caller's transaction, after
 * locking the tale row (every document write takes the row, then its keys). The draft is merged;
 * with none it is made from the published document, else from the media alone. The published
 * document is merged, or created only for a tale that is `live` now with no studio draft, or any
 * `live` tale in the migration (otherwise going live, or publishing, publishes the draft, 7.3). A tale never in step before gets legacy timing (5 s unless the
 * document sets a duration). Each changed document raises its revision, so an editor who had the
 * old one is asked to reload (409), and its `tale_media` rows are written. A document made from the
 * media alone is marked as the migration's (`document_created_by_migration`), so a rollback can
 * take it away again. The tale is then in step (`document_media_key`), even when nothing changed
 * because a person's edit was kept.
 *
 * Skipped, leaving the tale out of step (the Delivery API then composes its media in), with the
 * reason and time recorded: a media key no document can hold, a merge that would make a passing
 * document fail (such as one with 60 elements already), and a stored document of the wrong shape.
 * Does nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function bringTaleMediaInStep(
  tx: Db,
  taleId: string,
  options: InStepOptions = {},
): Promise<InStepOutcome> {
  if (!enabled) return 'off';
  const row = await lockedTale(tx, taleId);
  if (row === null) return 'gone';
  if (row.key === null) {
    if (row.inStep) await tx.query('UPDATE tales SET document_media_key = NULL WHERE id = $1', [taleId]);
    return 'unchanged';
  }
  const skip = async (reason: SkipReason): Promise<InStepOutcome> => {
    await tx.query(
      `UPDATE tales SET document_media_skip_key = media_key, document_media_skip_reason = $2,
         document_media_skip_at = now() WHERE id = $1`,
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
  // A tale with nothing published gets a media document only while it is `live` and, outside the
  // migration, has no studio draft either (a new tale from media is published at creation).
  const publishDraft = options.publishDraft === true && row.published === null && row.draft !== null;
  const published =
    row.published !== null ||
    (row.status === 'live' && (options.migration === true || row.draft === null || publishDraft))
      ? publishDraft
        ? draft
        : (mergeTaleMedia(row.published, media, merge) as TaleDocument)
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
  // Made from the media alone: the migration's, which a rollback takes away again.
  const created =
    (row.draft === null && row.published === null) || (row.published === null && published !== null && !publishDraft);
  await tx.query(
    `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + $3,
       document = $4::jsonb, document_revision = document_revision + $5, document_media_key = media_key,
       document_created_by_migration = document_created_by_migration OR $6,
       document_media_skip_key = NULL, document_media_skip_reason = NULL, document_media_skip_at = NULL
     WHERE id = $1`,
    [
      taleId,
      JSON.stringify(draft),
      draftChanged ? 1 : 0,
      published === null ? null : JSON.stringify(published),
      publishedChanged ? 1 : 0,
      created,
    ],
  );
  if (draftChanged) await recordTaleMedia(tx, taleId, 'draft', draft, false);
  if (publishedChanged) {
    await recordTaleMedia(tx, taleId, 'published', published, passes(published, checkPublishableDocument));
  }
  return draftChanged || publishedChanged ? 'merged' : 'unchanged';
}

/**
 * After a save or a keep-as-copy from an editor that loaded the tale's media as an element
 * (`sawTaleMedia`, R16): what it saved is the person's choice, so a tale out of step is put in
 * step. Its published document first takes the media exactly as the Delivery API composed it (so
 * visitors see nothing change until the person publishes), then `document_media_key` records the
 * media: a draft the person saved without the element stays without it, after the next start too.
 * When the published document cannot take the media, the tale stays out of step. Run in the save's
 * transaction, after the draft is written. Nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function markTaleMediaSeen(tx: Db, taleId: string): Promise<boolean> {
  if (!enabled) return false;
  const row = await lockedTale(tx, taleId);
  if (row === null || row.key === null || row.inStep === row.key) return false;
  const media = documentTaleMedia(row.key, row.contentType);
  if (media === null || (row.published !== null && !wellFormed(row.published))) return false;
  const published = row.published === null ? null : withOutOfStepMedia(taleId, row.published, media, row.inStep);
  const holds = (doc: TaleDocument | null) =>
    !!doc?.elements.some((e) => isTaleMediaElement(e) && (e.props as { mediaKey?: unknown }).mediaKey === media.key);
  if (published !== null && !holds(published as TaleDocument)) return false;
  const changed = published !== row.published;
  await tx.query(
    `UPDATE tales SET document = $2::jsonb, document_revision = document_revision + $3,
       document_media_key = media_key, document_media_skip_key = NULL, document_media_skip_reason = NULL,
       document_media_skip_at = NULL
     WHERE id = $1`,
    [taleId, published === null ? null : JSON.stringify(published), changed ? 1 : 0],
  );
  if (changed) {
    await recordTaleMedia(tx, taleId, 'published', published, passes(published, checkPublishableDocument));
  }
  return true;
}

/**
 * The document with `taleMedia` (R16) taken off elements that are not the tale's own media (its
 * key and kind): what a save keeps while TALE_MEDIA_MIGRATION is off, when such a mark can be stale
 * (an older instance changed the media). The element stays, as an ordinary image or video.
 */
export function withoutStaleTaleMedia<D extends { elements: readonly unknown[] }>(
  doc: D,
  media: { key: string | null; contentType: string | null },
): D {
  const own = documentTaleMedia(media.key, media.contentType);
  let changed = false;
  const elements = doc.elements.map((element) => {
    if (!isTaleMediaElement(element)) return element;
    const e = element as { type: string; props: Record<string, unknown> };
    if (own && e.props['mediaKey'] === own.key && e.type === own.kind) return element;
    changed = true;
    const props = { ...e.props };
    delete props['taleMedia'];
    return { ...e, props };
  });
  return changed ? ({ ...doc, elements } as D) : doc;
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
  /** Stops a pass between batches (the API's shutdown). */
  signal?: AbortSignal;
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

// The tales still out of step, and those of them not skipped for their current key.
const OUT_OF_STEP = `media_key IS NOT NULL AND document_media_key IS DISTINCT FROM media_key`;
const NOT_SKIPPED = `document_media_skip_key IS DISTINCT FROM media_key`;

// PostgreSQL errors that pass: a deadlock, a serialization failure, a lock or statement timeout or a
// cancel. The row is tried again later, not marked.
const TRANSIENT = new Set(['40P01', '40001', '55P03', '57014']);

/**
 * What a failure while bringing one row in step means (R16): `later` for a PostgreSQL error that
 * passes (a deadlock, a serialization failure, a lock or statement timeout, a cancel), tried again
 * on a later pass and not marked; `malformed` when the row's data has the wrong shape (a script
 * error while merging, or a PostgreSQL data exception, class 22), marked and skipped; `fatal` for
 * anything else, which fails the batch.
 */
export function classifyMigrationError(err: unknown): 'later' | 'malformed' | 'fatal' {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
    if (TRANSIENT.has(code)) return 'later';
    return code.startsWith('22') ? 'malformed' : 'fatal';
  }
  return err instanceof TypeError || err instanceof RangeError || err instanceof SyntaxError ? 'malformed' : 'fatal';
}

type Run = <T>(work: (tx: Db) => Promise<T>) => Promise<T>;

// Brings one row in step inside a savepoint: a shape error rolls it back, marks it `malformed` and
// logs it; a transient error rolls it back and leaves it for later; anything else is rethrown.
async function stepRow(
  tx: Db,
  taleId: string,
  log: TaleMediaMigrationOptions['log'],
): Promise<InStepOutcome | 'later'> {
  await tx.query('SAVEPOINT tale_media_row');
  try {
    const outcome = await bringTaleMediaInStep(tx, taleId, { migration: true });
    await tx.query('RELEASE SAVEPOINT tale_media_row');
    return outcome;
  } catch (err) {
    await tx.query('ROLLBACK TO SAVEPOINT tale_media_row');
    const kind = classifyMigrationError(err);
    if (kind === 'later') return 'later';
    if (kind === 'fatal') throw err;
    await tx.query(
      `UPDATE tales SET document_media_skip_key = media_key, document_media_skip_reason = 'malformed',
         document_media_skip_at = now() WHERE id = $1`,
      [taleId],
    );
    log?.('warn', `Tale ${taleId}: its media could not be put in its documents (${String(err)})`);
    return 'skipped';
  }
}

/**
 * One pass of the R16 migration over the tales out of step and not skipped for their current key,
 * in id order, `batchSize` per transaction. Rows another transaction holds (such as a save in
 * flight) are skipped and left for the next pass. A tale with no document at all, nearly every
 * older tale, is written by one set-based statement per batch: the draft (and, when it is `live`,
 * the published document) of only its media, marked as the migration's, and their `tale_media`
 * rows. A tale with a document goes through {@link bringTaleMediaInStep} in a savepoint (see
 * `stepRow`). Idempotent: a tale in step is never selected again, so an element a person removed
 * never comes back. Stops between batches on `signal`.
 */
async function migrationPass(
  run: Run,
  options: ReturnType<typeof withDefaults>,
  deadline: number,
): Promise<TaleMediaMigration> {
  let after = NO_UUID;
  let merged = 0;
  let skipped = 0;
  for (;;) {
    if (options.signal?.aborted) return { merged, skipped, done: false };
    const batch = await run(async (tx) => {
      const { rows } = await tx.query<CandidateRow>(
        `SELECT id, project_id AS "projectId", media_key AS key, media_content_type AS "contentType", status,
           (document IS NULL AND draft_document IS NULL) AS bare
         FROM tales
         WHERE id > $1 AND ${OUT_OF_STEP} AND ${NOT_SKIPPED}
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [after, options.batchSize],
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
        const outcome = await stepRow(tx, row.id, options.log);
        if (outcome === 'skipped') batchSkipped++;
        else if (outcome === 'merged' || outcome === 'unchanged') batchMerged++;
      }
      if (bare.length > 0) batchMerged += await writeBare(tx, bare);
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

// The set-based write for tales with no document: a document of only the media, the migration's.
async function writeBare(tx: Db, bare: { row: CandidateRow; media: TaleMediaRef }[]): Promise<number> {
  const docs = bare.map(({ media }) => JSON.stringify(taleMediaDocument(media)));
  const updated = await tx.query<{ id: string }>(
    `UPDATE tales t SET draft_document = x.doc, draft_revision = t.draft_revision + 1,
       document = CASE WHEN t.status = 'live' THEN x.doc ELSE t.document END,
       document_revision = t.document_revision + CASE WHEN t.status = 'live' THEN 1 ELSE 0 END,
       document_media_key = t.media_key, document_created_by_migration = true,
       document_media_skip_key = NULL, document_media_skip_reason = NULL, document_media_skip_at = NULL
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
  return written.length;
}

/**
 * Tries again, once per start, at most `limit` tales skipped before for a recorded reason (a person
 * may have edited the document since), the longest-skipped first: one that is skipped again goes
 * to the back (its skip time is renewed), so no tale waits behind others for ever.
 */
async function retrySkipped(run: Run, limit: number, log: TaleMediaMigrationOptions['log']): Promise<number> {
  return run(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM tales WHERE ${OUT_OF_STEP} AND NOT (${NOT_SKIPPED})
       ORDER BY document_media_skip_at NULLS FIRST, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    let merged = 0;
    for (const { id } of rows) {
      const outcome = await stepRow(tx, id, log);
      if (outcome === 'merged' || outcome === 'unchanged') merged++;
    }
    return merged;
  });
}

function withDefaults(options: TaleMediaMigrationOptions) {
  return {
    batchSize: options.batchSize ?? 500,
    budgetMs: options.budgetMs ?? 10_000,
    log: options.log,
    signal: options.signal,
  };
}

/**
 * The R16 migration at API start, on the migration runner's connection (which holds the migration
 * lock): one pass, each batch its own transaction, until `budgetMs` (10 s by default) has passed
 * after a batch, so a large install still starts promptly; {@link continueTaleMediaMigration}
 * finishes it. Then at most `batchSize` tales skipped before are tried once more, oldest skip
 * first. Does nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function migrateTaleMediaDocuments(
  client: Db,
  options: TaleMediaMigrationOptions = {},
): Promise<TaleMediaMigration> {
  if (!enabled) return { merged: 0, skipped: 0, done: false };
  const settings = withDefaults(options);
  const run: Run = async (work) => {
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
  const result = await migrationPass(run, settings, Date.now() + settings.budgetMs);
  result.merged += await retrySkipped(run, settings.batchSize, settings.log);
  return result;
}

/** How the background continuation retries. */
export interface TaleMediaContinuation extends TaleMediaMigrationOptions {
  /** The most passes; between them it waits `baseDelayMs`, doubling up to `maxDelayMs`. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** The pool's size: below 3 the continuation does not start, so requests keep their connections. */
  poolMax?: number;
}

const CONTINUATION_LOCK = "hashtextextended('taleart:tale-media-migration', 0)";

/** The smallest pool the continuation runs in: one connection for its lock, one for a batch, one for requests. */
export const MIN_POOL_FOR_CONTINUATION = 3;

/** The continuation's lock holder lost its session, and the lock with it: the pass stops and is tried again. */
export class MigrationLockLostError extends Error {
  constructor(readonly cause?: unknown) {
    super('the session holding the migration lock ended');
    this.name = 'MigrationLockLostError';
  }
}

// True when the pool was ended under the continuation: the API is stopping, which is no failure.
// Read from the pool's state (pg's Pool sets `ending`, then `ended`), never from an error's text.
function isPoolEnded(pool: TransactionalDb): boolean {
  const state = pool as { ending?: unknown; ended?: unknown };
  return state.ending === true || state.ended === true;
}

/**
 * Finishes the R16 migration after start, beside requests. One process works at a time: each pass
 * takes a session advisory lock on a short-lived connection and gives it back before waiting (a
 * process that finds it taken stops; the holder finishes). Passes repeat while tales remain that
 * were not skipped for a recorded reason (such as rows a save held), with a doubling backoff
 * between them, at most `attempts` times; a pass that fails is retried the same way. `signal` stops
 * it between batches and while it waits, and an ended pool is a clean stop. It does not start with
 * a pool of fewer than {@link MIN_POOL_FOR_CONTINUATION} connections. Progress is logged after each
 * pass. Does nothing while {@link taleMediaDocumentsEnabled} is false.
 */
export async function continueTaleMediaMigration(
  pool: TransactionalDb,
  options: TaleMediaContinuation = {},
): Promise<TaleMediaMigration> {
  const total: TaleMediaMigration = { merged: 0, skipped: 0, done: false };
  if (!enabled) return total;
  if (options.poolMax !== undefined && options.poolMax < MIN_POOL_FOR_CONTINUATION) {
    options.log?.(
      'warn',
      `Tale media in documents: not finished in the background, the database pool holds ${options.poolMax} ` +
        `connection(s) (at least ${MIN_POOL_FOR_CONTINUATION} needed); the next start goes on with it`,
    );
    return total;
  }
  const settings = withDefaults({ ...options, budgetMs: options.budgetMs ?? 60 * 60 * 1000 });
  const run: Run = (work) => inTransaction(pool, work);
  let delay = options.baseDelayMs ?? 1000;
  for (let attempt = 0; attempt < (options.attempts ?? 8) && !options.signal?.aborted; attempt++) {
    try {
      // The lock is the holder's session's: if the database ends that session (a restart, a
      // terminated backend), the lock goes with it. withClient keeps the error rather than letting
      // pg crash the process; the pass stops before its next batch and is tried again, taking the
      // lock again on a new connection. A holder whose pass failed is dropped from the pool.
      const locked = await withClient(
        pool,
        async (holder) => {
          const { rows } = await holder.query<{ locked: boolean }>(
            `SELECT pg_try_advisory_lock(${CONTINUATION_LOCK}) AS locked`,
          );
          if (!rows[0].locked) return false;
          // The pass stops between batches when asked to, or once the holder's session is gone.
          const stopping = settings.signal ? AbortSignal.any([settings.signal, holder.signal]) : holder.signal;
          try {
            const result = await migrationPass(run, { ...settings, signal: stopping }, Date.now() + settings.budgetMs);
            total.merged += result.merged;
          } catch (err) {
            // A pass that failed while its lock went is a lost lock, and is retried as one. Otherwise
            // the holder is dropped from the pool (discardOnError), which frees the lock with it.
            if (holder.lost()) throw new MigrationLockLostError(holder.lost());
            throw err;
          }
          if (holder.lost()) throw new MigrationLockLostError(holder.lost());
          await holder.query(`SELECT pg_advisory_unlock(${CONTINUATION_LOCK})`);
          return true;
        },
        { discardOnError: true },
      );
      if (!locked) {
        options.log?.('info', 'Tale media in documents: another process is finishing the migration');
        return total;
      }
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
    } catch (err) {
      if (options.signal?.aborted || isPoolEnded(pool)) return total;
      options.log?.('warn', `Tale media in documents: a pass failed and is tried again (${String(err)})`);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      options.signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });
    delay = Math.min(delay * 2, options.maxDelayMs ?? 60_000);
  }
  return total;
}
