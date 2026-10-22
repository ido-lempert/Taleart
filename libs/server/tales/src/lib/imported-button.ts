// The button an import carries into a tale (epic Tale Studio R17, AD-7): a source story's call to
// action becomes a `button` element at the bottom of the safe area. The importer finds it again by
// its element id, which it keeps in its own baseline; this module writes it into the tale's
// documents, compare-and-set, so a re-import changes only what nobody changed in TaleArt.
import {
  DEFAULT_CANVAS_COLOR,
  documentMediaKeys,
  IMPORTED_BUTTON_BOX,
  LEGACY_TALE_DURATION_MS,
  newButtonProps,
  TALE_DOCUMENT_VERSION,
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

/** What {@link setImportedButtonWhen} did. */
export interface ImportedButtonResult {
  /** The button as the draft (else the published document) held it before, or null when neither holds it. */
  before: ImportedButton | null;
  /** `added`, `updated` or `unchanged`; `skipped` when the write would break a document's limits, or a stored document has the wrong shape. */
  outcome: 'added' | 'updated' | 'unchanged' | 'skipped';
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

/**
 * Writes the import's button `id` into the tale's documents when `decide` says so, in the caller's
 * transaction, with the tale row locked (every document write takes the row first, then its keys).
 * `decide` gets the button as the draft holds it (the published document when there is no draft),
 * or null when it holds none, and answers the values to write, or null to leave it. A button not
 * there is added (both values needed) to each document the tale has; a tale with none gets a draft,
 * and a published document too when it is `live` (as a tale's media does, R16), so a Shown imported
 * tale is delivered with it. A button there takes each
 * value in each document that still holds the value `decide` saw. Each changed document raises its
 * revision, so an open editor reloads (409), and its recorded media and fonts are written again. A
 * write that would make a passing document fail (such as one with 60 elements) is skipped. Returns
 * null when the tale does not exist.
 */
export async function setImportedButtonWhen(
  tx: Db,
  taleId: string,
  id: string,
  decide: (current: ImportedButton | null) => ImportedButtonWrite | null,
): Promise<ImportedButtonResult | null> {
  if (!UUID.test(taleId)) return null;
  const { rows } = await tx.query<{ draft: Doc | null; published: Doc | null; status: string }>(
    'SELECT draft_document AS draft, document AS published, status FROM tales WHERE id = $1 FOR UPDATE',
    [taleId],
  );
  if (rows.length === 0) return null;
  const draft = rows[0].draft ?? null;
  const published = rows[0].published ?? null;
  if ((draft !== null && !wellFormed(draft)) || (published !== null && !wellFormed(published))) {
    return { before: null, outcome: 'skipped' };
  }
  const before = findImportedButton(draft ?? published, id);
  const write = decide(before);
  if (write === null) return { before, outcome: 'unchanged' };
  // A tale with neither document gets a draft, and a published document too while it is `live`.
  const neither = draft === null && published === null;
  const nextDraft = draft !== null || neither ? withImportedButton(draft, id, before, write) : null;
  const nextPublished =
    published !== null || (neither && rows[0].status === 'live')
      ? withImportedButton(published, id, before, write)
      : null;
  const draftChanged = nextDraft !== draft;
  const publishedChanged = nextPublished !== published;
  if (!draftChanged && !publishedChanged) return { before, outcome: 'unchanged' };
  for (const [was, now] of [
    [draft, nextDraft],
    [published, nextPublished],
  ] as const) {
    if (was !== now && (was === null || passes(was, checkTaleDocument)) && !passes(now, checkTaleDocument)) {
      return { before, outcome: 'skipped' };
    }
  }
  const changed = [...(draftChanged ? [nextDraft] : []), ...(publishedChanged ? [nextPublished] : [])];
  await lockMediaKeys(tx, changed.flatMap((doc) => documentMediaKeys(doc)));
  await tx.query(
    `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + $3,
       document = $4::jsonb, document_revision = document_revision + $5
     WHERE id = $1`,
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
  return { before, outcome: before === null ? 'added' : 'updated' };
}
