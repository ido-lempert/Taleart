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

/** A tale's document with its revision, as `GET` and `PUT /tales/{taleId}/document` answer. */
export type TaleDocumentRevision = Omit<Schemas['TaleDocumentRevision'], 'document'> & {
  document: TaleDocument | null;
};

/** The body of `PUT /tales/{taleId}/document`: the document and the revision it was based on. */
export type SaveTaleDocumentRequest = Omit<Schemas['SaveTaleDocumentRequest'], 'document'> & {
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
