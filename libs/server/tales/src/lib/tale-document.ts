import {
  EDITOR_ONLY_ELEMENT_FIELDS,
  ELEMENT_TEXT_RULE,
  ErrorCodes,
  hasDisallowedCharacter,
  isFontFamily,
  LABEL_TEXT_RULE,
  MAX_LABEL_LENGTH,
  MAX_TALE_DOCUMENT_BYTES,
  MAX_VIDEO_ELEMENTS,
  missingAltText,
  missingAltTextMessage,
  documentMediaRefs,
  projectFontIds,
  projectFontRefs,
  TALE_DOCUMENT_VERSION,
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_ELEMENT_TYPE_REGISTRY,
  type DeliveryTaleDocument,
  type TaleCanvas,
  type TaleDocument,
  type TaleDocumentRevision,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { clearPublicMediaCache, lockMediaKeys, projectMediaKeys, recordTaleMedia, usesMedia } from './document-media';
import { clearPublicFontCache, knownProjectFontIds, recordTaleFonts } from './project-fonts';
import { inTransaction, TaleNotFoundError, type TransactionalDb } from './tales';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown when a tale document breaks its schema or a rule of AD-15; `pointer` names the field. */
export class InvalidTaleDocumentError extends Error {
  readonly code = ErrorCodes.invalidTaleDocument;

  constructor(
    readonly pointer: string,
    message: string,
  ) {
    super(`${pointer || 'The document'} ${message}`);
    this.name = 'InvalidTaleDocumentError';
  }
}

/**
 * Thrown when a draft is published with a visible image or video that has neither alt text nor the
 * decorative mark (R12); the message names the element as Tale Studio does. Drafts may hold one.
 */
export class AltTextRequiredError extends InvalidTaleDocumentError {
  constructor(pointer: string, message: string) {
    super(pointer, message);
    this.message = message;
    this.name = 'AltTextRequiredError';
  }
}

/** Thrown when a tale document is larger than {@link MAX_TALE_DOCUMENT_BYTES}. */
export class TaleDocumentTooLargeError extends Error {
  readonly code = ErrorCodes.taleDocumentTooLarge;

  constructor() {
    super(`A tale document holds at most ${MAX_TALE_DOCUMENT_BYTES / 1024} KB`);
    this.name = 'TaleDocumentTooLargeError';
  }
}

/** Thrown when a document write was based on a revision other than the tale's current one. */
export class StaleRevisionError extends Error {
  readonly code = ErrorCodes.staleRevision;

  constructor(readonly currentRevision: number) {
    super('The tale was saved by someone else since you opened it. Reload it to see the latest version.');
    this.name = 'StaleRevisionError';
  }
}

/** Thrown when a tale with no draft document is published: publishing never empties the published document. */
export class NothingToPublishError extends Error {
  readonly code = ErrorCodes.nothingToPublish;

  constructor() {
    super('This tale has no draft to publish.');
    this.name = 'NothingToPublishError';
  }
}

/** A key as a JSON pointer segment (RFC 6901): `~` becomes `~0` and `/` becomes `~1`. */
export function pointerSegment(key: string | number): string {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

// What one refusal says about the field at `pointer`. Ajv's instancePath is already a JSON pointer.
function describe(error: ErrorObject, prefix: string): InvalidTaleDocumentError {
  const params = error.params as Record<string, unknown>;
  const at = `${prefix}${error.instancePath}`;
  switch (error.keyword) {
    case 'additionalProperties':
      return new InvalidTaleDocumentError(
        `${at}/${pointerSegment(params['additionalProperty'] as string)}`,
        'is not a known property',
      );
    case 'required':
      return new InvalidTaleDocumentError(
        `${at}/${pointerSegment(params['missingProperty'] as string)}`,
        'is required',
      );
    case 'maxItems':
      return new InvalidTaleDocumentError(at, `holds at most ${params['limit'] as number} items`);
    case 'maxLength':
      return new InvalidTaleDocumentError(at, `holds at most ${params['limit'] as number} characters`);
    case 'const':
      return new InvalidTaleDocumentError(at, `must be ${JSON.stringify(params['allowedValue'])}`);
    default:
      return new InvalidTaleDocumentError(at, error.message ?? 'is invalid');
  }
}

// A rule a registered type adds to its schema, given the element's props and their pointer.
type PropsRule = (props: Record<string, unknown>, pointer: string) => void;

const PROPS_RULES: Readonly<Record<string, PropsRule>> = {
  text: (props, pointer) => {
    if (typeof props['text'] === 'string' && hasDisallowedCharacter(props['text'], ELEMENT_TEXT_RULE)) {
      throw new InvalidTaleDocumentError(
        `${pointer}/text`,
        'may not hold control characters other than a line feed, lone surrogates or bidi overrides',
      );
    }
    // The schema's pattern states the theme's font-list rules; the contract's own check runs too,
    // so a font name reaches CSS only when both agree (R14).
    const font = props['font'] as { source?: unknown; family?: unknown } | undefined;
    if (font?.source === 'name' && !isFontFamily(font.family)) {
      throw new InvalidTaleDocumentError(`${pointer}/font/family`, 'must be a font-family list the theme accepts');
    }
  },
};

interface Validators {
  document: ValidateFunction;
  props: Map<string, ValidateFunction>;
}

let validators: Validators | null = null;

// The schemas are compiled once, on first use.
function compiled(): Validators {
  if (validators) return validators;
  const ajv = new Ajv2020({ allErrors: false });
  const props = new Map<string, ValidateFunction>();
  for (const { key, schema } of TALE_ELEMENT_TYPE_REGISTRY) props.set(key, ajv.compile(schema));
  validators = { document: ajv.compile(TALE_DOCUMENT_V1_SCHEMA), props };
  return validators;
}

// Refuses a number that is not finite anywhere in the value (JSON's 1e999 parses as Infinity).
function checkFinite(value: unknown, pointer: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidTaleDocumentError(pointer, 'must be a finite number');
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => checkFinite(item, `${pointer}/${i}`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      checkFinite(item, `${pointer}/${pointerSegment(key)}`);
    }
  }
}

/**
 * Checks a tale document on write (AD-15) and returns it typed, with its text and labels in
 * Unicode NFC: its size, then the envelope schema (no additional properties), then each
 * element's props against its registered type's schema, then the semantic rules: unique ids,
 * finite numbers, and no control characters (other than a line feed in text), lone surrogates or
 * bidi embeddings and overrides in text or labels. Throws {@link TaleDocumentTooLargeError} or
 * {@link InvalidTaleDocumentError}, which names the JSON pointer it refused.
 */
export function checkTaleDocument(value: unknown): TaleDocument {
  const json = JSON.stringify(value) ?? '';
  if (Buffer.byteLength(json, 'utf8') > MAX_TALE_DOCUMENT_BYTES) throw new TaleDocumentTooLargeError();
  checkFinite(value, '');
  const { document, props } = compiled();
  if (!document(value)) {
    const [error] = document.errors ?? [];
    throw error ? describe(error, '') : new InvalidTaleDocumentError('', 'is invalid');
  }
  const doc = value as TaleDocument;
  const ids = new Set<string>();
  let videos = 0;
  const elements = doc.elements.map((original, i) => {
    const at = `/elements/${i}`;
    const element = normalized(original);
    const validate = props.get(element.type);
    if (!validate)
      throw new InvalidTaleDocumentError(`${at}/type`, `"${element.type}" is not a registered element type`);
    if (!validate(element.props)) {
      const [error] = validate.errors ?? [];
      throw error ? describe(error, `${at}/props`) : new InvalidTaleDocumentError(`${at}/props`, 'is invalid');
    }
    PROPS_RULES[element.type]?.(element.props as unknown as Record<string, unknown>, `${at}/props`);
    const label = element.a11y.label;
    if (label !== undefined && [...label].length > MAX_LABEL_LENGTH) {
      throw new InvalidTaleDocumentError(`${at}/a11y/label`, `holds at most ${MAX_LABEL_LENGTH} characters`);
    }
    if (label !== undefined && hasDisallowedCharacter(label, LABEL_TEXT_RULE)) {
      throw new InvalidTaleDocumentError(
        `${at}/a11y/label`,
        'may not hold control characters, lone surrogates or bidi overrides',
      );
    }
    const id = element.id.toLowerCase();
    if (ids.has(id)) throw new InvalidTaleDocumentError(`${at}/id`, 'is the id of another element');
    ids.add(id);
    if (element.type === 'video' && ++videos > MAX_VIDEO_ELEMENTS) {
      throw new InvalidTaleDocumentError(`${at}/type`, `is a video: a tale holds at most ${MAX_VIDEO_ELEMENTS}`);
    }
    return element;
  });
  return { ...doc, elements };
}

/**
 * The rules a document must also pass to be published (R12): every visible image and video has alt
 * text or the decorative mark. Throws {@link AltTextRequiredError} naming the first that does not.
 */
export function checkPublishRules(doc: TaleDocument): void {
  const missing = missingAltText(doc);
  if (missing) throw new AltTextRequiredError(`/elements/${missing.index}/a11y/label`, missingAltTextMessage(missing));
}

/** {@link checkTaleDocument} then {@link checkPublishRules}: what a published document passes. */
export function checkPublishableDocument(value: unknown): TaleDocument {
  const doc = checkTaleDocument(value);
  checkPublishRules(doc);
  return doc;
}

// The element with its label, and a text element's text, in Unicode NFC, so equal text is stored
// equally; a project font's id in lower case, as the database spells a uuid.
function normalized(element: TaleDocument['elements'][number]): TaleDocument['elements'][number] {
  const label = element.a11y.label;
  const a11y = typeof label === 'string' ? { ...element.a11y, label: label.normalize('NFC') } : element.a11y;
  const text = (element.props as { text?: unknown } | null)?.text;
  let props = typeof text === 'string' ? { ...element.props, text: text.normalize('NFC') } : element.props;
  const font = (props as { font?: { source?: unknown; fontId?: unknown } } | null)?.font;
  if (font?.source === 'project' && typeof font.fontId === 'string') {
    props = { ...props, font: { ...font, fontId: font.fontId.toLowerCase() } } as typeof props;
  }
  return { ...element, a11y, props } as TaleDocument['elements'][number];
}

/**
 * Refuses a document that uses a project font the project does not have (R14, R18): an unknown id
 * or one of another project, naming the JSON pointer of the first such `fontId`. With `lock`, the
 * fonts are share locked until the caller's transaction ends, so none is deleted meanwhile.
 * Throws {@link InvalidTaleDocumentError}.
 */
export async function checkDocumentFonts(db: Db, projectId: string, document: unknown, lock = false): Promise<void> {
  const refs = projectFontRefs(document);
  if (refs.length === 0) return;
  const known = await knownProjectFontIds(db, projectId, [...new Set(refs.map((r) => r.fontId))], lock);
  const missing = refs.find((ref) => !known.has(ref.fontId));
  if (missing) throw new InvalidTaleDocumentError(missing.pointer, "is not a font of this tale's project");
}

/**
 * Refuses a document that uses media the tale's project does not have (R14, AD-4): a key of another
 * project or none, naming the JSON pointer of the first; and a key of the wrong kind (a video for
 * an image element or the background, an image for a video). Each key is share locked first, until
 * the caller's transaction ends, so a file it names is not judged unused and deleted meanwhile.
 * Throws {@link InvalidTaleDocumentError}.
 */
export async function checkDocumentMedia(db: Db, projectId: string, document: unknown): Promise<void> {
  const refs = documentMediaRefs(document);
  if (refs.length === 0) return;
  await lockMediaKeys(
    db,
    refs.map((r) => r.key),
  );
  const known = await projectMediaKeys(
    db,
    projectId,
    refs.map((r) => r.key),
  );
  for (const ref of refs) {
    if (!known.has(ref.key)) throw new InvalidTaleDocumentError(ref.pointer, "is not media of this tale's project");
    const isVideo = /\.(mp4|webm)$/.test(ref.key);
    if (isVideo !== (ref.kind === 'video')) {
      throw new InvalidTaleDocumentError(ref.pointer, ref.kind === 'video' ? 'must be a video' : 'must be an image');
    }
  }
}

// The project of the tale, or a 404. With `lock`, the tale row is locked first, as publishing locks
// it before the media keys, so a save and a publish take their locks in the same order.
async function projectOfTale(db: Db, taleId: string, lock = false): Promise<string> {
  const { rows } = await db.query<{ projectId: string }>(
    `SELECT project_id AS "projectId" FROM tales WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [taleId],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  return rows[0].projectId;
}

/**
 * A document as the Delivery API returns it, before its media keys become public URLs: the API
 * resolves them (`resolveDocumentMedia`), so a key leaves only inside a URL (AD-11).
 */
export type KeyedDeliveryDocument = Omit<DeliveryTaleDocument, 'canvas'> & { canvas: TaleCanvas };

/** The most delivered documents kept checked in memory, by tale and revision. */
export const DELIVERY_CACHE_SIZE = 1000;

// Delivered documents by `<tale id>:<revision>`, oldest first: a Map keeps insertion order.
const deliveryCache = new Map<string, KeyedDeliveryDocument | null>();

/** Forgets the delivered documents kept in memory (for tests). */
export function clearDeliveryCache(): void {
  deliveryCache.clear();
}

/**
 * The document as the Delivery API returns it (AD-15): hidden elements removed, and the
 * editor-only fields of the rest. A stored document that no longer passes
 * {@link checkTaleDocument} (written before a rule changed, or by hand) is not delivered: the
 * tale then shows its media only. Null for none.
 *
 * Documents are checked in full on write. On read, a document with an unknown `version`, or
 * stored text over twice the size limit, is refused at once; the full check runs once per
 * `cacheKey` (the tale's id and revision, which every save raises), and its result is kept in a
 * bounded in-memory LRU of {@link DELIVERY_CACHE_SIZE} entries, so a zone read again (such as a
 * revalidation answered 304) does not check every document again.
 */
export function deliverableTaleDocument(
  stored: unknown,
  cacheKey?: string,
  storedBytes?: number,
): KeyedDeliveryDocument | null {
  if (stored === null || stored === undefined) return null;
  if ((stored as { version?: unknown }).version !== TALE_DOCUMENT_VERSION) return null;
  if (storedBytes !== undefined && storedBytes > 2 * MAX_TALE_DOCUMENT_BYTES) return null;
  if (cacheKey === undefined) return deliver(stored);
  if (deliveryCache.has(cacheKey)) {
    const cached = deliveryCache.get(cacheKey) ?? null;
    deliveryCache.delete(cacheKey);
    deliveryCache.set(cacheKey, cached);
    return cached;
  }
  const delivered = deliver(stored);
  deliveryCache.set(cacheKey, delivered);
  if (deliveryCache.size > DELIVERY_CACHE_SIZE) deliveryCache.delete(deliveryCache.keys().next().value as string);
  return delivered;
}

function deliver(stored: unknown): KeyedDeliveryDocument | null {
  let doc: TaleDocument;
  try {
    doc = checkPublishableDocument(stored);
  } catch {
    return null;
  }
  const { elements, ...rest } = doc;
  return {
    ...rest,
    elements: elements
      .filter((element) => !element.hidden)
      .map((element) => {
        const delivered: Record<string, unknown> = { ...element };
        for (const field of EDITOR_ONLY_ELEMENT_FIELDS) delete delivered[field];
        return delivered as KeyedDeliveryDocument['elements'][number];
      }),
  };
}

// The draft and the published document with their revisions, as a row reads them.
const STATE_COLUMNS =
  'draft_document AS document, draft_revision AS revision, ' +
  'document AS "publishedDocument", document_revision AS "publishedRevision"';

interface StateRow {
  document: TaleDocument | null;
  revision: number;
  publishedDocument: TaleDocument | null;
  publishedRevision: number;
}

function toState(row: StateRow): TaleDocumentRevision {
  return {
    document: row.document,
    revision: row.revision,
    published: { document: row.publishedDocument, revision: row.publishedRevision },
  };
}

/**
 * The tale's draft document (the one Tale Studio edits) and revision, with its published document
 * (the one the Delivery API serves) and its revision; a tale without one reads null at revision 0.
 * Throws {@link TaleNotFoundError}.
 */
export async function getTaleDocument(db: Db, taleId: string): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const { rows } = await db.query<StateRow>(`SELECT ${STATE_COLUMNS} FROM tales WHERE id = $1`, [taleId]);
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  return toState(rows[0]);
}

// Refuses a request based on revisions that are no longer current, or answers 404.
async function refuseStale(db: Db, taleId: string): Promise<never> {
  const current = await db.query<{ revision: number }>('SELECT draft_revision AS revision FROM tales WHERE id = $1', [
    taleId,
  ]);
  if (current.rows.length === 0) throw new TaleNotFoundError(taleId);
  throw new StaleRevisionError(current.rows[0].revision);
}

/**
 * Replaces the tale's draft document when `basedOn` is the draft's current revision, and returns it
 * with the next revision. The published document, and so what visitors see, does not change.
 * Checks the document first ({@link checkTaleDocument}). In one transaction: the project fonts it
 * uses must be the tale's project's (R14), and are share locked, so a font being deleted (which
 * locks its row first) is either gone, and the save refused, or waits for this save and then sees
 * it recorded in `tale_fonts`, which is written here with the draft. Throws
 * {@link StaleRevisionError} when another save came first, so no write is lost silently,
 * {@link InvalidTaleDocumentError} and {@link TaleNotFoundError}.
 */
export async function saveTaleDocument(
  db: TransactionalDb,
  taleId: string,
  value: unknown,
  basedOn: number,
): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const document = checkTaleDocument(value);
  const usesFonts = projectFontIds(document).length > 0;
  const hasMedia = usesMedia(document);
  return inTransaction(db, async (tx) => {
    const projectId = usesFonts || hasMedia ? await projectOfTale(tx, taleId, hasMedia) : null;
    if (usesFonts && projectId) await checkDocumentFonts(tx, projectId, document, true);
    if (hasMedia && projectId) await checkDocumentMedia(tx, projectId, document);
    const { rows } = await tx.query<StateRow>(
      `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + 1
       WHERE id = $1 AND draft_revision = $3
       RETURNING ${STATE_COLUMNS}`,
      [taleId, JSON.stringify(document), basedOn],
    );
    if (rows.length === 0) return refuseStale(tx, taleId);
    await recordTaleFonts(tx, taleId, 'draft', document, false);
    await recordTaleMedia(tx, taleId, 'draft', document, false);
    return { ...toState(rows[0]), document };
  });
}

/**
 * Publishes the tale's draft: copies it to the published document, which the Delivery API serves,
 * raising the published revision. Compare-and-set on both revisions: when `draftRevision` or
 * `publishedRevision` is no longer current nothing changes and it throws
 * {@link StaleRevisionError}. The draft is checked again first, as rules may have changed since
 * it was saved ({@link InvalidTaleDocumentError}). A tale with no draft throws
 * {@link NothingToPublishError}: publishing never empties the published document. The fonts the
 * published document uses are recorded in the same transaction. The tale's status does not change.
 */
export async function publishTaleDocument(
  db: TransactionalDb,
  taleId: string,
  draftRevision: number,
  publishedRevision: number,
): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  const state = await inTransaction(db, async (tx) => {
    const read = await tx.query<StateRow>(`SELECT ${STATE_COLUMNS} FROM tales WHERE id = $1 FOR UPDATE`, [taleId]);
    if (read.rows.length === 0) throw new TaleNotFoundError(taleId);
    const draft = read.rows[0].document;
    if (draft === null) throw new NothingToPublishError();
    checkPublishableDocument(draft);
    if (usesMedia(draft)) await checkDocumentMedia(tx, await projectOfTale(tx, taleId), draft);
    const { rows } = await tx.query<StateRow>(
      `UPDATE tales SET document = draft_document, document_revision = document_revision + 1
       WHERE id = $1 AND draft_revision = $2 AND document_revision = $3 AND draft_document IS NOT NULL
       RETURNING ${STATE_COLUMNS}`,
      [taleId, draftRevision, publishedRevision],
    );
    if (rows.length === 0) return refuseStale(tx, taleId);
    await recordTaleFonts(tx, taleId, 'published', rows[0].publishedDocument, true);
    await recordTaleMedia(tx, taleId, 'published', rows[0].publishedDocument, true);
    return toState(rows[0]);
  });
  clearPublicFontCache();
  clearPublicMediaCache();
  return state;
}

/**
 * Discards the tale's draft: it becomes the published document again (null when nothing is
 * published), raising the draft's revision, and its recorded fonts become the published one's.
 * Compare-and-set on both revisions, as {@link publishTaleDocument}; throws
 * {@link StaleRevisionError} and {@link TaleNotFoundError}.
 */
export async function discardTaleDraft(
  db: TransactionalDb,
  taleId: string,
  draftRevision: number,
  publishedRevision: number,
): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<StateRow>(
      `UPDATE tales SET draft_document = document, draft_revision = draft_revision + 1
       WHERE id = $1 AND draft_revision = $2 AND document_revision = $3
       RETURNING ${STATE_COLUMNS}`,
      [taleId, draftRevision, publishedRevision],
    );
    if (rows.length === 0) return refuseStale(tx, taleId);
    await recordTaleFonts(tx, taleId, 'draft', rows[0].document, false);
    await recordTaleMedia(tx, taleId, 'draft', rows[0].document, false);
    return toState(rows[0]);
  });
}
