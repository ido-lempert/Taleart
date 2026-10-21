// The tale document (AD-15). The JSON Schema files in `libs/contract/tale-document/` are the
// source: `v1.schema.json` is the envelope, and `element-types/registry.json` names each element
// type with the schema of its `props`. `contract:generate` turns them into the types below (through
// openapi.yaml) and into a TypeScript copy of the schemas for validators.
import type { components } from '../generated/api';

export { TALE_DOCUMENT_V1_SCHEMA, TALE_ELEMENT_TYPE_REGISTRY } from '../generated/tale-document-schemas';

type Schemas = components['schemas'];

/** A colour as `#RRGGBB` or `#RRGGBBAA`. */
export type TaleColor = Schemas['Color'];
/** The 9:16 stage of a tale. */
export type TaleCanvas = Schemas['Canvas'];
/** Where an element sits: fractions (0 to 1) of the canvas width and height, and a rotation in degrees. */
export type TaleElementBox = Schemas['Box'];
/** What assistive technology is told about an element. */
export type TaleElementA11y = Schemas['A11y'];
/** The props of a `text` element, from `element-types/text.schema.json`. */
export type TextElementProps = Schemas['TextElementProps'];

/** An element of the registered type `T` with props `P`: the fields every element has, keyed by `type`. */
export type TaleElementOf<T extends string, P> = Omit<Schemas['Element'], 'type' | 'props'> & { type: T; props: P };

/** A text element: plain text wrapped inside its box (epic Tale Studio R4). */
export type TextElement = TaleElementOf<'text', TextElementProps>;

/** Every element type of the registry, a discriminated union keyed by `type` (AD-15). */
export type TaleElement = TextElement;

/** The registered element type keys. */
export type TaleElementType = TaleElement['type'];

/** A tale document as the Management API reads and writes it. */
// openapi-typescript keeps the schema file's `$defs` as a property; it is no field of a document.
export type TaleDocument = Omit<Schemas['TaleDocument'], '$defs' | 'elements'> & { elements: TaleElement[] };

/** A tale's published document with its revision: what the Delivery API serves (AD-15). */
export type PublishedTaleDocument = Omit<Schemas['PublishedTaleDocument'], 'document'> & {
  document: TaleDocument | null;
};

/**
 * A tale's draft document with its revision, and its published document with its own, as `GET`
 * and `PUT /tales/{taleId}/document`, publish and discard answer.
 */
export type TaleDocumentRevision = Omit<Schemas['TaleDocumentRevision'], 'document' | 'published'> & {
  document: TaleDocument | null;
  published: PublishedTaleDocument;
};

/** A tale as a status change answers it: `draftNotPublished` when going live could not publish its draft. */
export type TaleStatusResult = Schemas['TaleStatusResult'];

/** The body of publish and discard: the draft and published revisions they are based on. */
export type TaleDocumentRevisionsRequest = Schemas['TaleDocumentRevisionsRequest'];

/** The body of `PUT /tales/{taleId}/document`: the document and the revision it was based on. */
export type SaveTaleDocumentRequest = Omit<Schemas['SaveTaleDocumentRequest'], 'document'> & {
  document: TaleDocument;
};

/** The body of `POST /tales/{taleId}/document/copy`: the document to keep as a new tale in the tale's group. */
export type CopyTaleDocumentRequest = Omit<Schemas['CopyTaleDocumentRequest'], 'document'> & {
  document: TaleDocument;
};

/** A text element as the Delivery API returns it: without the editor-only fields. */
export type DeliveryTextElement = Omit<TextElement, 'hidden' | 'locked'>;

/** The editor-only fields of every element, which the Delivery API removes. */
export const EDITOR_ONLY_ELEMENT_FIELDS = ['hidden', 'locked'] as const;

/** The document version the contract writes (AD-15). */
export const TALE_DOCUMENT_VERSION = 1;

/** The largest document accepted, in bytes of UTF-8 JSON: 128 KB (a starting value, tuned by story 7.14). */
export const MAX_TALE_DOCUMENT_BYTES = 128 * 1024;

/** The most elements one document holds (a starting value, tuned by story 7.14). */
export const MAX_TALE_ELEMENTS = 60;

/** The most characters (code points) one text element holds (a starting value, tuned by story 7.14). */
export const MAX_TEXT_LENGTH = 1000;

/** The canvas's aspect ratio, width to height. */
export const TALE_CANVAS_ASPECT = { width: 9, height: 16 } as const;

/**
 * The canvas's safe areas as fractions of its height (top, bottom) and width (each side): the
 * viewer's progress and close controls sit in the top one, calls to action in the bottom one
 * (AD-15; starting values, tuned by story 7.14).
 */
export const TALE_SAFE_AREA = { top: 0.12, bottom: 0.16, side: 0.04 } as const;

/** The canvas background of a new document. */
export const DEFAULT_CANVAS_COLOR = '#000000';

/**
 * How a text element looks until text styling exists (story 7.4): the same in Tale Studio and the
 * Web SDK. `fontSize` is a fraction of the canvas height (AD-15).
 */
export const TEXT_ELEMENT_STYLE = {
  fontSize: 0.04,
  lineHeight: 1.25,
  fontWeight: 600,
  color: '#ffffff',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
} as const;

/** Where a new text element goes: across the middle of the canvas, inside the safe areas. */
export const NEW_TEXT_BOX: TaleElementBox = { x: 0.1, y: 0.42, w: 0.8, h: 0.16, rotation: 0 };

/** A document with no elements on the default background. */
export function emptyTaleDocument(): TaleDocument {
  return {
    version: TALE_DOCUMENT_VERSION,
    canvas: { background: { type: 'color', color: DEFAULT_CANVAS_COLOR } },
    elements: [],
  };
}

/** The most characters (code points) an element's `a11y.label` holds. */
export const MAX_LABEL_LENGTH = 300;

/** Which characters a piece of document text may hold: a text element's text keeps line feeds, a label does not. */
export interface TextRule {
  lineFeeds: boolean;
}

/** The rule for a text element's text: line feeds start new lines. */
export const ELEMENT_TEXT_RULE: TextRule = { lineFeeds: true };

/** The rule for labels: one line. */
export const LABEL_TEXT_RULE: TextRule = { lineFeeds: false };

// The UTF-16 code units the character at `i` takes when it is allowed, or 0 when it is not:
// C0 controls (a line feed only where the rule keeps it), DEL, C1 controls, a lone surrogate,
// and the bidi embeddings and overrides U+202A to U+202E, which can make text read as other text.
// Marks (U+200E, U+200F), isolates (U+2066 to U+2069), ZWJ and ZWNJ stay: Hebrew, Arabic and
// emoji sequences need them.
function allowedWidth(text: string, i: number, rule: TextRule): number {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    return next >= 0xdc00 && next <= 0xdfff ? 2 : 0;
  }
  if (code >= 0xdc00 && code <= 0xdfff) return 0;
  if (code <= 0x1f) return code === 0x0a && rule.lineFeeds ? 1 : 0;
  if (code >= 0x7f && code <= 0x9f) return 0;
  if (code >= 0x202a && code <= 0x202e) return 0;
  return 1;
}

/** True when the text holds a character the rule does not allow (see {@link cleanText}). */
export function hasDisallowedCharacter(text: string, rule: TextRule): boolean {
  for (let i = 0; i < text.length; ) {
    const width = allowedWidth(text, i, rule);
    if (width === 0) return true;
    i += width;
  }
  return false;
}

/**
 * The text without the characters the rule does not allow: control characters (C0 other than a
 * line feed where the rule keeps it, DEL, C1), lone surrogates, and the bidi embeddings and
 * overrides U+202A to U+202E. The server refuses them on write; editors strip them as people type
 * or paste, and SDKs strip them before rendering.
 */
export function cleanText(text: string, rule: TextRule): string {
  let clean = '';
  for (let i = 0; i < text.length; ) {
    const width = allowedWidth(text, i, rule);
    if (width === 0) i++;
    else {
      clean += text.slice(i, i + width);
      i += width;
    }
  }
  return clean;
}

/**
 * Elements in reading order (AD-15): top to bottom, then left to right, by their box; elements
 * at the same place keep their z-order. Screen readers meet them in this order.
 */
export function readingOrder<T extends { box: { x: number; y: number } }>(elements: readonly T[]): T[] {
  return elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.box.y - b.element.box.y || a.element.box.x - b.element.box.x || a.index - b.index)
    .map(({ element }) => element);
}

/** A rectangle on the canvas as fractions of its width (`x`, `w`) and height (`y`, `h`). */
export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the canvas inside the safe areas ({@link TALE_SAFE_AREA}). */
export function safeAreaBounds(): CanvasRect {
  const { top, bottom, side } = TALE_SAFE_AREA;
  return { x: side, y: top, w: 1 - 2 * side, h: 1 - top - bottom };
}

/**
 * The upright rectangle an element covers on the 9:16 canvas: its box, grown to hold the box's
 * rotation about its centre. It may reach past the canvas edges.
 */
export function elementBounds(box: TaleElementBox): CanvasRect {
  if (box.rotation === 0) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const { width, height } = TALE_CANVAS_ASPECT;
  const angle = (box.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  // Half the box's size in canvas units (9 wide, 16 high), so a rotation keeps its true shape.
  const halfW = (box.w * width) / 2;
  const halfH = (box.h * height) / 2;
  const w = (2 * (cos * halfW + sin * halfH)) / width;
  const h = (2 * (sin * halfW + cos * halfH)) / height;
  return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
}

/**
 * True when the element, rotation included, reaches outside the safe areas, where the viewer's
 * controls (top) and calls to action (bottom) may cover it. Tale Studio warns; saving is allowed.
 * A thousandth of tolerance keeps an element placed on the edge inside.
 */
export function isOutsideSafeArea(box: TaleElementBox): boolean {
  const safe = safeAreaBounds();
  const at = elementBounds(box);
  const e = 0.001;
  return (
    at.x < safe.x - e || at.y < safe.y - e || at.x + at.w > safe.x + safe.w + e || at.y + at.h > safe.y + safe.h + e
  );
}
