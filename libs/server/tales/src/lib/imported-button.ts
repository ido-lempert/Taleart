// The button an import carries into a tale (epic Tale Studio R17, AD-7): a source story's call to
// action becomes a `button` element at the bottom of the safe area. The importer finds it again by
// its element id, which it keeps in its own baseline; this module writes it into the tale's
// documents, compare-and-set, so a re-import changes only what nobody changed in TaleArt.
import {
  DEFAULT_CANVAS_COLOR,
  documentMediaKeys,
  hasDisallowedCharacter,
  IMPORTED_BUTTON_BOX,
  isTaleMediaElement,
  LABEL_TEXT_RULE,
  LEGACY_TALE_DURATION_MS,
  linkUrlProblem,
  MAX_LINK_LABEL_LENGTH,
  newButtonProps,
  TALE_DOCUMENT_VERSION,
  taleMediaElement,
  type TaleDocument,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { lockMediaKeys, recordTaleMedia } from './document-media';
import { recordTaleFonts } from './project-fonts';
import { checkPublishableDocument, checkTaleDocument } from './tale-document';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A button's label and destination, the two values an import carries. */
export interface ImportedButton {
  label: string;
  href: string;
}

/** The values to write: both for a new button, either or both for one the import wrote before. */
export type ImportedButtonWrite = Partial<ImportedButton>;

type Doc = { elements: readonly unknown[] } & Record<string, unknown>;

interface ButtonLike {
  id?: unknown;
  type?: unknown;
  props?: { label?: unknown; href?: unknown };
}

/** The new button element: the look of a new button in Tale Studio, at {@link IMPORTED_BUTTON_BOX}, same tab. */
export function importedButtonElement(id: string, values: ImportedButton) {
  return {
    id,
    type: 'button' as const,
    box: { ...IMPORTED_BUTTON_BOX },
    hidden: false,
    locked: false,
    a11y: {},
    props: { ...newButtonProps(), label: values.label, href: values.href },
  };
}

/** The label and destination of the button `id` in the document (`''` for none), or null when it holds no such button. */
export function findImportedButton(doc: Doc | null, id: string): ImportedButton | null {
  const element = doc?.elements.find((e) => (e as ButtonLike).id === id) as ButtonLike | undefined;
  if (element === undefined || element.type !== 'button') return null;
  const label = element.props?.label;
  const href = element.props?.href;
  return { label: typeof label === 'string' ? label : '', href: typeof href === 'string' ? href : '' };
}

/**
 * The document with the import's button written, or the same object when nothing changes. With
 * `before` null the button is added on top of the z-order (a document is made for it when there is
 * none: the default canvas, 5 s as a tale of one media element shows). Otherwise each value of
 * `write` is set only where the document's button still holds the value `before` had, so a value
 * a person changed in this document is kept.
 */
export function withImportedButton<D extends Doc>(
  doc: D | null,
  id: string,
  before: ImportedButton | null,
  write: ImportedButtonWrite,
): D | TaleDocument | null {
  if (before === null) {
    if (write.label === undefined || write.href === undefined) return doc;
    if (doc !== null && doc.elements.some((e) => (e as ButtonLike).id === id)) return doc;
    const element = importedButtonElement(id, { label: write.label, href: write.href });
    if (doc === null) {
      return {
        version: TALE_DOCUMENT_VERSION,
        canvas: { background: { type: 'color', color: DEFAULT_CANVAS_COLOR } },
        durationMs: LEGACY_TALE_DURATION_MS,
        elements: [element],
      } as TaleDocument;
    }
    return { ...doc, elements: [...doc.elements, element] };
  }
  if (doc === null) return doc;
  let changed = false;
  const elements = doc.elements.map((e) => {
    const element = e as ButtonLike & Record<string, unknown>;
    if (element.id !== id || element.type !== 'button') return e;
    const now = findImportedButton({ elements: [element] }, id) as ImportedButton;
    const props = { ...(element.props ?? {}) } as Record<string, unknown>;
    for (const field of ['label', 'href'] as const) {
      const value = write[field];
      if (value === undefined || now[field] !== before[field] || now[field] === value) continue;
      props[field] = value;
      changed = true;
    }
    return { ...element, props };
  });
  return changed ? { ...doc, elements } : doc;
}


/** Why {@link setImportedButtonWhen} wrote nothing although `decide` asked for a write. */
export type ImportedButtonSkip =
  /** The write would make a passing document fail its limits (such as one with 60 elements). */
  | 'limits'
  /** A stored document does not have the shape of one. */
  | 'malformed'
  /** The label or destination is not one a button may hold (the label rule; `linkUrlProblem`). */
  | 'invalid'
  /** The tale already has a button to this destination: no second one is added. */
  | 'exists';

/** What {@link setImportedButtonWhen} did. */
export interface ImportedButtonResult {
  /** The button as the draft (else the published document) held it before, or null when neither holds it. */
  before: ImportedButton | null;
  /** `added`, `updated` or `unchanged`; `skipped` with its reason when nothing could be written. */
  outcome: 'added' | 'updated' | 'unchanged' | 'skipped';
  reason?: ImportedButtonSkip;
  /** The values written, by field. */
  written: ImportedButtonWrite;
  /** Which documents changed. */
  draftWritten: boolean;
  publishedWritten: boolean;
  /** The documents' fingerprints before and after the call ({@link taleDocumentFingerprints}). */
  previous: DocumentFingerprints;
  fingerprints: DocumentFingerprints;
  /** Which documents were, before the call, of only the tale's media ({@link isTaleMediaOnlyDocument}). */
  mediaOnly: { draft: boolean; published: boolean };
}

/** Fingerprints of a tale's stored documents: tell a document as an import left it from one changed since. */
export interface DocumentFingerprints {
  draft: string | null;
  published: string | null;
}

/**
 * The fingerprints of the tale's draft and published documents as stored (an MD5 of their canonical
 * `jsonb` text), or null when the tale does not exist. An importer keeps them to tell whether a
 * document is still exactly what it wrote (AD-7).
 */
export async function taleDocumentFingerprints(db: Db, taleId: string): Promise<DocumentFingerprints | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await db.query<DocumentFingerprints>(
    'SELECT md5(draft_document::text) AS draft, md5(document::text) AS published FROM tales WHERE id = $1',
    [taleId],
  );
  if (rows.length === 0) return null;
  return { draft: rows[0].draft ?? null, published: rows[0].published ?? null };
}

/**
 * True when the document is one of only the tale's own media as a media write or the migration made
 * it (R16): the default canvas and timing, and one full-canvas `taleMedia` element as made. Such a
 * document holds no person's work.
 */
export function isTaleMediaOnlyDocument(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  const d = doc as Doc & { canvas?: unknown; durationMs?: unknown; version?: unknown };
  if (d.version !== TALE_DOCUMENT_VERSION || !Array.isArray(d.elements) || d.elements.length !== 1) return false;
  if (d.durationMs !== undefined && d.durationMs !== LEGACY_TALE_DURATION_MS) return false;
  const canvas = JSON.stringify(d.canvas);
  if (canvas !== JSON.stringify({ background: { type: 'color', color: DEFAULT_CANVAS_COLOR } })) return false;
  const element = d.elements[0] as { id?: string; type?: 'image' | 'video'; props?: { mediaKey?: string } };
  if (!isTaleMediaElement(element) || typeof element.props?.mediaKey !== 'string' || element.type === undefined) {
    return false;
  }
  const made = taleMediaElement(element.id ?? '', element.props.mediaKey, element.type);
  return JSON.stringify(sortKeys(made)) === JSON.stringify(sortKeys(element));
}

// The value with object keys in order, so two values compare by content.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

// True when the document passes the check.
function passes(doc: unknown, check: (doc: unknown) => unknown): boolean {
  try {
    check(doc);
    return true;
  } catch {
    return false;
  }
}

const wellFormed = (doc: unknown): boolean =>
  typeof doc === 'object' && doc !== null && Array.isArray((doc as { elements?: unknown }).elements);

// True when a value is one a button's label may hold: text on one line that shows, at most 80 characters.
function isButtonLabel(value: string): boolean {
  return (
    value.trim() !== '' &&
    !value.includes('\n') &&
    !hasDisallowedCharacter(value, LABEL_TEXT_RULE) &&
    [...value].length <= MAX_LINK_LABEL_LENGTH
  );
}

/** How {@link setImportedButtonWhen} may write. */
export interface ImportedButtonOptions {
  /**
   * True when the published document (with its fingerprint) is still exactly what the import made:
   * only then does the import write into it, so what visitors see changes. Otherwise only the draft
   * takes the change, and the person sees it as not updated yet. Never when absent.
   */
  publishedIsImports?: (fingerprint: string, doc: unknown) => boolean;
}

/**
 * Writes the import's button `id` into the tale's documents when `decide` says so (epic Tale Studio
 * R17, AD-7), in the caller's transaction, with the tale row locked (every document write takes the
 * row first, then its keys). The single gate for what an import writes: a label or destination a
 * button may not hold is refused (`invalid`).
 *
 * `decide` gets the button as the draft holds it (the published document when there is no draft), or
 * null when it holds none, and answers the values to write, or null to leave it. A button not there
 * is added (both values needed), unless the tale already has a button to the same destination
 * (`exists`). A button there takes each value in each document that still holds the value `decide`
 * saw. The draft always takes the write: a tale with no document gets a draft only, which its media
 * step publishes ({@link bringTaleMediaInStep}, `publishDraft`), so a tale is never delivered as a
 * button alone. The published document takes it only when `publishedIsImports` says it is still the
 * import's; otherwise a draft is made from it when there is none.
 *
 * Each changed document raises its revision, so an open editor reloads (409), and its recorded media
 * and fonts are written again. A write that would make a passing document fail is skipped
 * (`limits`), as is a stored document of the wrong shape (`malformed`). Returns null when the tale does
 * not exist. The caller clears the public caches once it commits when the published document changed.
 */
export async function setImportedButtonWhen(
  tx: Db,
  taleId: string,
  id: string,
  decide: (current: ImportedButton | null) => ImportedButtonWrite | null,
  options: ImportedButtonOptions = {},
): Promise<ImportedButtonResult | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await tx.query<{
    draft: Doc | null;
    published: Doc | null;
    draftPrint: string | null;
    publishedPrint: string | null;
  }>(
    `SELECT draft_document AS draft, document AS published, md5(draft_document::text) AS "draftPrint",
       md5(document::text) AS "publishedPrint"
     FROM tales WHERE id = $1 FOR UPDATE`,
    [taleId],
  );
  if (rows.length === 0) return null;
  const draft = rows[0].draft ?? null;
  const published = rows[0].published ?? null;
  const prints: DocumentFingerprints = {
    draft: rows[0].draftPrint ?? null,
    published: rows[0].publishedPrint ?? null,
  };
  const mediaOnly = { draft: isTaleMediaOnlyDocument(draft), published: isTaleMediaOnlyDocument(published) };
  const result = (outcome: ImportedButtonResult['outcome'], reason?: ImportedButtonSkip): ImportedButtonResult => ({
    before,
    outcome,
    ...(reason ? { reason } : {}),
    written: {},
    draftWritten: false,
    publishedWritten: false,
    previous: prints,
    fingerprints: prints,
    mediaOnly,
  });
  let before: ImportedButton | null = null;
  if ((draft !== null && !wellFormed(draft)) || (published !== null && !wellFormed(published))) {
    return result('skipped', 'malformed');
  }
  const working = draft ?? published;
  before = findImportedButton(working, id);
  const write = decide(before);
  if (write === null) return result('unchanged');
  if (
    (write.href !== undefined && linkUrlProblem(write.href) !== null) ||
    (write.label !== undefined && !isButtonLabel(write.label))
  ) {
    return result('skipped', 'invalid');
  }
  if (
    before === null &&
    working?.elements.some(
      (e) => (e as ButtonLike).type === 'button' && (e as ButtonLike).props?.href === write.href,
    )
  ) {
    return result('skipped', 'exists');
  }
  const publishedOk =
    published !== null &&
    prints.published !== null &&
    options.publishedIsImports?.(prints.published, published) === true;
  // The draft: the tale's own, else one made for the change (from the published document a person
  // changed, or new); never a published document made here.
  const draftBase = draft ?? (published === null || !publishedOk ? published : null);
  const nextDraft =
    draft !== null || !publishedOk ? withImportedButton(draftBase, id, before, write) : null;
  const nextPublished = publishedOk ? withImportedButton(published, id, before, write) : published;
  const draftChanged = nextDraft !== draft;
  const publishedChanged = nextPublished !== published;
  if (!draftChanged && !publishedChanged) return result('unchanged');
  for (const [was, now] of [
    [draft ?? published, nextDraft],
    [published, nextPublished],
  ] as const) {
    if (now !== null && was !== now && (was === null || passes(was, checkTaleDocument)) && !passes(now, checkTaleDocument)) {
      return result('skipped', 'limits');
    }
  }
  const changed = [...(draftChanged ? [nextDraft] : []), ...(publishedChanged ? [nextPublished] : [])];
  await lockMediaKeys(tx, changed.flatMap((doc) => documentMediaKeys(doc)));
  const { rows: after } = await tx.query<DocumentFingerprints>(
    `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + $3,
       document = $4::jsonb, document_revision = document_revision + $5
     WHERE id = $1
     RETURNING md5(draft_document::text) AS draft, md5(document::text) AS published`,
    [
      taleId,
      nextDraft === null ? null : JSON.stringify(nextDraft),
      draftChanged ? 1 : 0,
      nextPublished === null ? null : JSON.stringify(nextPublished),
      publishedChanged ? 1 : 0,
    ],
  );
  if (draftChanged) {
    await recordTaleFonts(tx, taleId, 'draft', nextDraft, false);
    await recordTaleMedia(tx, taleId, 'draft', nextDraft, false);
  }
  if (publishedChanged) {
    const deliverable = passes(nextPublished, checkPublishableDocument);
    await recordTaleFonts(tx, taleId, 'published', nextPublished, deliverable);
    await recordTaleMedia(tx, taleId, 'published', nextPublished, deliverable);
  }
  // The values written: each one the working document took.
  const now = findImportedButton(nextDraft ?? nextPublished, id);
  const written: ImportedButtonWrite = {};
  for (const field of ['label', 'href'] as const) {
    if (write[field] !== undefined && now?.[field] === write[field] && before?.[field] !== write[field]) {
      written[field] = write[field];
    }
  }
  return {
    before,
    outcome: before === null ? 'added' : 'updated',
    written,
    draftWritten: draftChanged,
    publishedWritten: publishedChanged,
    previous: prints,
    fingerprints: { draft: after[0]?.draft ?? null, published: after[0]?.published ?? null },
    mediaOnly,
  };
}
