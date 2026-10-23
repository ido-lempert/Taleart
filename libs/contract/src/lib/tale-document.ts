// The tale document (AD-15). The JSON Schema files in `libs/contract/tale-document/` are the
// source: `v1.schema.json` is the envelope, and `element-types/registry.json` names each element
// type with the schema of its `props`. `contract:generate` turns them into the types below (through
// openapi.yaml) and into a TypeScript copy of the schemas for validators.
import type { components } from '../generated/api';
import type { DeliveryCanvas, MediaContentType } from './core';
import type { TextFont } from './text-style';

import { TALE_ELEMENT_TYPE_REGISTRY, TALE_TEST_ELEMENT_TYPES } from '../generated/tale-document-schemas';

export {
  TALE_DOCUMENT_V1_SCHEMA,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_TEST_ELEMENT_TYPES,
} from '../generated/tale-document-schemas';

type Schemas = components['schemas'];

// ---- The element-type registry (epic Tale Studio R8; AD-15) ----

/** One registered element type: its key, the name people read, and the JSON Schema of its props. */
export type ElementTypeEntry = (typeof TALE_ELEMENT_TYPE_REGISTRY)[number];

/**
 * The element types a server, editor or test takes, in registry order: every entry of
 * `element-types/registry.json`, and with `testTypes` its `testOnly` entries too. Test types are
 * for tests and development only: a production server or dashboard never asks for them (R8).
 */
export function elementTypeRegistry(options: { testTypes?: boolean } = {}): readonly ElementTypeEntry[] {
  return options.testTypes ? [...TALE_ELEMENT_TYPE_REGISTRY, ...TALE_TEST_ELEMENT_TYPES] : TALE_ELEMENT_TYPE_REGISTRY;
}

/** The registered element type with this key, or null (test types only with `testTypes`). */
export function elementTypeEntry(key: string, options: { testTypes?: boolean } = {}): ElementTypeEntry | null {
  return elementTypeRegistry(options).find((entry) => entry.key === key) ?? null;
}

/** The JSON Schema keywords an editor checks for one prop of a registered type ({@link propValueProblem}). */
export interface PropSchema {
  type?: string;
  enum?: readonly unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  description?: string;
}

/** The schema of the prop `name` in a type's props schema, with whether it is required; null when there is none. */
export function propSchema(
  schema: { readonly [key: string]: unknown },
  name: string,
): { schema: PropSchema; required: boolean } | null {
  const properties = schema['properties'] as Record<string, PropSchema> | undefined;
  if (!properties || !Object.prototype.hasOwnProperty.call(properties, name)) return null;
  const required = Array.isArray(schema['required']) && (schema['required'] as unknown[]).includes(name);
  return { schema: properties[name], required };
}

/**
 * Why `value` breaks the prop's schema, in words for the person editing it, or null when it passes:
 * the keywords type, enum, minLength, maxLength (in code points, as JSON Schema counts them),
 * pattern, minimum and maximum. An editor checks a new type's props with it as they are typed; the
 * server checks the whole schema again on every write (R8, R14). `undefined` is a missing value.
 */
export function propValueProblem(schema: PropSchema, value: unknown, required: boolean): string | null {
  if (value === undefined) return required ? 'This is required.' : null;
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return 'Enter text.';
      if (schema.enum && !schema.enum.includes(value)) return 'Choose one of the options.';
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength) {
        return schema.minLength === 1 ? 'Enter some text.' : `Use at least ${schema.minLength} characters.`;
      }
      if (schema.maxLength !== undefined && length > schema.maxLength) {
        return `Use at most ${schema.maxLength.toLocaleString('en')} characters.`;
      }
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
        return 'This value is not allowed here.';
      }
      return null;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
      if (schema.type === 'integer' && !Number.isInteger(value)) return 'Enter a whole number.';
      const { minimum: min, maximum: max } = schema;
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}.`;
        return min !== undefined ? `Enter ${min} or more.` : `Enter ${max} or less.`;
      }
      if (schema.enum && !schema.enum.includes(value)) return 'Choose one of the options.';
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Choose yes or no.';
    default:
      return schema.enum && !schema.enum.includes(value) ? 'Choose one of the options.' : null;
  }
}

/** A colour as `#RRGGBB` or `#RRGGBBAA`. */
export type TaleColor = Schemas['Color'];
/** The 9:16 stage of a tale. */
export type TaleCanvas = Schemas['Canvas'];
/** A solid canvas background colour. */
export type ColorBackground = Schemas['ColorBackground'];
/** An image of the tale's project filling the canvas, with a band colour (epic Tale Studio R2). */
export type MediaBackground = Schemas['MediaBackground'];
/** Where an element sits: fractions (0 to 1) of the canvas width and height, and a rotation in degrees. */
export type TaleElementBox = Schemas['Box'];
/** What assistive technology is told about an element. */
export type TaleElementA11y = Schemas['A11y'];
/**
 * The props of a `text` element, from `element-types/text.schema.json`: its text and its optional
 * style (story 7.4; see `resolveTextStyle`), with the font as a discriminated union of its sources.
 */
export type TextElementProps = Omit<Schemas['TextElementProps'], 'font'> & { font?: TextFont };

/** An element of the registered type `T` with props `P`: the fields every element has, keyed by `type`. */
export type TaleElementOf<T extends string, P> = Omit<Schemas['Element'], 'type' | 'props'> & { type: T; props: P };

/** A text element: plain text wrapped inside its box (epic Tale Studio R4). */
export type TextElement = TaleElementOf<'text', TextElementProps>;

/** The props of an `image` element, from `element-types/image.schema.json` (epic Tale Studio R5). */
export type ImageElementProps = Schemas['ImageElementProps'];
/** The props of a `video` element, from `element-types/video.schema.json` (epic Tale Studio R5). */
export type VideoElementProps = Schemas['VideoElementProps'];
/** An image (GIF included) of the tale's project, by storage key (epic Tale Studio R5). */
export type ImageElement = TaleElementOf<'image', ImageElementProps>;
/** A video of the tale's project, by storage key; a tale holds at most one (epic Tale Studio R5). */
export type VideoElement = TaleElementOf<'video', VideoElementProps>;
/** The props of a `shape` element, from `element-types/shape.schema.json` (epic Tale Studio R6). */
export type ShapeElementProps = Schemas['ShapeElementProps'];
/** The props of an `emoji` element, from `element-types/emoji.schema.json` (epic Tale Studio R6). */
export type EmojiElementProps = Schemas['EmojiElementProps'];
/** The props of a `sticker` element, from `element-types/sticker.schema.json` (epic Tale Studio R6). */
export type StickerElementProps = Schemas['StickerElementProps'];
/** A rectangle, ellipse or line built from whitelisted values (epic Tale Studio R6). */
export type ShapeElement = TaleElementOf<'shape', ShapeElementProps>;
/** One emoji, drawn as text in the platform's emoji font and named by its label (epic Tale Studio R6). */
export type EmojiElement = TaleElementOf<'emoji', EmojiElementProps>;
/** An image sticker: a PNG, WebP or GIF of the tale's project, by storage key (epic Tale Studio R6). */
export type StickerElement = TaleElementOf<'sticker', StickerElementProps>;
/** The props of a `button` element, from `element-types/button.schema.json` (epic Tale Studio R7). */
export type ButtonElementProps = Schemas['ButtonElementProps'];
/** The props of an `image-button` element, from `element-types/image-button.schema.json` (epic Tale Studio R7). */
export type ImageButtonElementProps = Schemas['ImageButtonElementProps'];
/** The props of a `swipe-up` element, from `element-types/swipe-up.schema.json` (epic Tale Studio R7). */
export type SwipeUpElementProps = Schemas['SwipeUpElementProps'];
/** A button: a labelled link, filled or outlined (epic Tale Studio R7). */
export type ButtonElement = TaleElementOf<'button', ButtonElementProps>;
/** A custom image button: an image of the tale's project that is a link, named by its alt text (R7). */
export type ImageButtonElement = TaleElementOf<'image-button', ImageButtonElementProps>;
/** The swipe-up link: a label pinned to the bottom safe area; a tale holds at most one (R7). */
export type SwipeUpElement = TaleElementOf<'swipe-up', SwipeUpElementProps>;
/** A call to action: an element that is a link to its destination (R7). */
export type LinkElement = ButtonElement | ImageButtonElement | SwipeUpElement;
/** An element that shows media of the tale's project. */
export type MediaElement = ImageElement | VideoElement | StickerElement | ImageButtonElement;

/** Every element type of the registry, a discriminated union keyed by `type` (AD-15). */
export type TaleElement =
  | TextElement
  | ImageElement
  | VideoElement
  | ShapeElement
  | EmojiElement
  | StickerElement
  | ButtonElement
  | ImageButtonElement
  | SwipeUpElement;

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

/** The direction a row of a tale is read in: left to right, or right to left (AD-15). */
export type ReadingDirection = 'ltr' | 'rtl';

// Letters of the scripts written right to left (bidi class R or AL): Hebrew, Arabic, Syriac,
// Thaana, NKo, Samaritan, Mandaic and the Arabic presentation forms, plus Adlam and Hanifi Rohingya.
const RTL_LETTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]|\p{Script=Adlam}|\p{Script=Hanifi_Rohingya}/u;
const LETTER = /\p{L}/u;

/**
 * The direction of a text's first strong character, as `dir="auto"` takes it (a letter: right to
 * left for the scripts written that way, else left to right); null when it has no letter.
 */
export function firstStrongDirection(text: string): ReadingDirection | null {
  for (const char of text) {
    if (LETTER.test(char)) return RTL_LETTER.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * The direction a tale is read in (AD-15, epic Tale Studio R12): the tale's own, never the host
 * page's. Each visible text counts with its direction, set (`rtl` or `ltr`) or, with `auto`, its
 * first strong character, as Tale Studio and the SDK draw it; right to left when more texts read
 * right to left than left to right; on a tie, the first text in the canvas (top, then left) decides;
 * left to right when no text has a direction.
 */
export function taleReadingDirection(
  elements: readonly { type?: string; hidden?: boolean; box: { x: number; y: number }; props?: unknown }[],
): ReadingDirection {
  let rtl = 0;
  let ltr = 0;
  let first: { y: number; x: number; dir: ReadingDirection } | null = null;
  for (const element of elements) {
    if (element.type !== 'text' || element.hidden === true) continue;
    const props = (element.props ?? {}) as { text?: unknown; direction?: unknown };
    const dir =
      props.direction === 'rtl' || props.direction === 'ltr'
        ? props.direction
        : typeof props.text === 'string'
          ? firstStrongDirection(props.text)
          : null;
    if (dir === null) continue;
    if (dir === 'rtl') rtl++;
    else ltr++;
    const { x, y } = element.box;
    if (!first || y < first.y || (y === first.y && x < first.x)) first = { y, x, dir };
  }
  if (rtl !== ltr) return rtl > ltr ? 'rtl' : 'ltr';
  return first?.dir ?? 'ltr';
}

// Where an element shows: the swipe-up link is pinned to its box whatever it stores (R7), and a
// rotated box shows as its upright bounds.
function shownBounds(element: { type?: string; box: { x: number; y: number; w?: number; h?: number; rotation?: number } }) {
  if (element.type === 'swipe-up') return SWIPE_UP_BOX;
  const { x, y, w, h, rotation } = element.box;
  if (typeof rotation === 'number' && rotation !== 0 && typeof w === 'number' && typeof h === 'number') {
    return elementBounds({ x, y, w, h, rotation });
  }
  return { x, y, w: w ?? 0, h: h ?? 0 };
}

/**
 * The tallest element, as a fraction of the canvas height, that takes others into its reading
 * row. A taller one (a backdrop, a full-bleed photo) would hold every element beside it in one row,
 * so it reads as a row of its own, at its top.
 */
export const READING_ROW_MAX_HEIGHT = 0.5;

/**
 * True when `item` reads in the same row as the row's first element, `anchor`: its vertical centre
 * lies within the anchor's top and bottom, or the two overlap vertically by at least half the
 * smaller one's height. Neither may be taller than {@link READING_ROW_MAX_HEIGHT}.
 */
export function sameReadingRow(anchor: { y: number; h: number }, item: { y: number; h: number }): boolean {
  if (anchor.h > READING_ROW_MAX_HEIGHT || item.h > READING_ROW_MAX_HEIGHT) return false;
  const centre = item.y + item.h / 2;
  if (centre >= anchor.y && centre <= anchor.y + anchor.h) return true;
  const overlap = Math.min(anchor.y + anchor.h, item.y + item.h) - Math.max(anchor.y, item.y);
  return overlap > 0 && overlap >= Math.min(anchor.h, item.h) / 2;
}

/**
 * Elements in reading order (AD-15, epic Tale Studio R12), the one rule the SDK follows for screen
 * readers and focus: visual position, top to bottom, then along each row in the tale's direction.
 * Positions are where the elements show (a rotated box by its upright bounds, the swipe-up link in
 * the bottom safe area). Rows: taken from the top, each element joins the latest row whose first
 * element it shares the row with ({@link sameReadingRow}), else starts a row; an element taller
 * than half the canvas is a row of its own. A row reads left to
 * right by left edge, or right to left by right edge when the tale reads right to left
 * ({@link taleReadingDirection}, unless `direction` is given); then by top; ties (the same place)
 * keep the z-order, bottom first.
 */
export function readingOrder<
  T extends { type?: string; hidden?: boolean; box: { x: number; y: number; w?: number; h?: number; rotation?: number }; props?: unknown },
>(elements: readonly T[], direction: ReadingDirection = taleReadingDirection(elements)): T[] {
  const items = elements
    .map((element, index) => ({ element, index, at: shownBounds(element) }))
    .sort((a, b) => a.at.y - b.at.y || a.index - b.index);
  const rows: (typeof items)[] = [];
  for (const item of items) {
    const row = [...rows].reverse().find((r) => sameReadingRow(r[0].at, item.at));
    if (row) row.push(item);
    else rows.push([item]);
  }
  type Item = (typeof items)[number];
  const across =
    direction === 'rtl'
      ? (a: Item, b: Item) => b.at.x + b.at.w - (a.at.x + a.at.w)
      : (a: Item, b: Item) => a.at.x - b.at.x;
  return rows.flatMap((row) =>
    row.sort((a, b) => across(a, b) || a.at.y - b.at.y || a.index - b.index).map(({ element }) => element),
  );
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

/** True when no part of the element, rotation included, lies on the canvas: no one sees it. */
export function isOffCanvas(box: TaleElementBox): boolean {
  const b = elementBounds(box);
  return b.x >= 1 || b.y >= 1 || b.x + b.w <= 0 || b.y + b.h <= 0;
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

// ---- Media (epic Tale Studio R5, R2, R12, R14; AD-11) ----

/** How media fills its box: `cover` crops it to fill, `contain` shows all of it. */
export type MediaFit = ImageElementProps['fit'];

/** Every media fit, in the order the studio offers them. */
export const MEDIA_FITS: readonly MediaFit[] = ['cover', 'contain'];

/** How long a document tale without a video plays when its document sets no `durationMs`: 7 s. */
export const DEFAULT_TALE_DURATION_MS = 7000;

/** The shortest `durationMs` a document holds: 3 s. */
export const MIN_TALE_DURATION_MS = 3000;

/** The longest `durationMs` a document holds: 15 s. */
export const MAX_TALE_DURATION_MS = 15000;

/**
 * The longest a tale with a video plays: its video's length, but never past 15 s, the longest
 * duration (R5). The SDK ends the tale there, and Tale Studio warns about a longer video.
 */
export const MAX_TALE_VIDEO_MS = MAX_TALE_DURATION_MS;

/** The most video elements one document holds (a starting value, tuned by story 7.14). */
export const MAX_VIDEO_ELEMENTS = 1;

/** The largest corner radius of a media element, as a fraction of the canvas height. */
export const MAX_MEDIA_RADIUS = 0.5;

/** Where a new image or video goes: centred, inside the safe areas. */
export const NEW_MEDIA_BOX: TaleElementBox = { x: 0.1, y: 0.3, w: 0.8, h: 0.4, rotation: 0 };

/**
 * How long a tale's own media image showed before documents, and so how long a document made for
 * it plays (epic Tale Studio R16): 5 s, where a new document tale plays {@link DEFAULT_TALE_DURATION_MS}.
 */
export const LEGACY_TALE_DURATION_MS = 5000;

/**
 * The colour a tale with neither media nor a document showed before documents, and so the canvas
 * colour of the empty document such a tale is delivered with (R16).
 */
export const LEGACY_PLACEHOLDER_COLOR = '#1f2937';

/** The box of a tale's own media element: the whole canvas, unrotated (R16). */
export const TALE_MEDIA_BOX: TaleElementBox = { x: 0, y: 0, w: 1, h: 1, rotation: 0 };

/**
 * True for the tale's own media (R16): an image or video element marked `taleMedia`, which the
 * server keeps in step with the tale's media. It does not count toward {@link MAX_VIDEO_ELEMENTS}.
 */
export function isTaleMediaElement(element: unknown): boolean {
  const e = element as { type?: unknown; props?: { taleMedia?: unknown } } | null;
  return (e?.type === 'image' || e?.type === 'video') && e.props?.taleMedia === true;
}

/**
 * True when the element is drawn full-bleed behind the canvas, as tale media always was (R16): the
 * tale's own media, at the bottom of the z-order (`index` 0), with the full-canvas box, unrotated,
 * unrounded and opaque. Viewers keep its legacy rules: a video runs the tale for its whole length,
 * with sound where the browser allows it.
 */
export function isStageTaleMedia(element: unknown, index: number): boolean {
  if (index !== 0 || !isTaleMediaElement(element)) return false;
  const { box, props } = element as { box?: Partial<TaleElementBox>; props: { radius?: unknown; opacity?: unknown } };
  return (
    box?.x === 0 &&
    box.y === 0 &&
    box.w === 1 &&
    box.h === 1 &&
    !box.rotation &&
    (props.radius === undefined || props.radius === 0) &&
    (props.opacity === undefined || props.opacity === 1)
  );
}

/**
 * The document's element drawn full-bleed behind the canvas, as tale media always was (R16), or
 * null: its bottom element when {@link isStageTaleMedia}, on any background. With it, the canvas
 * paints no colour of its own (the stage takes it, behind the media), and a media background is
 * drawn on the canvas over it, with its band colour, exactly as before documents held the media.
 */
export function stageTaleMedia<E>(doc: { elements?: readonly E[] } | null | undefined): E | null {
  const first = Array.isArray(doc?.elements) ? doc.elements[0] : undefined;
  return first !== undefined && isStageTaleMedia(first, 0) ? first : null;
}

/** The video elements that count toward {@link MAX_VIDEO_ELEMENTS}: every video but the tale's own media. */
export function limitedVideoCount(doc: { elements: readonly { type: string }[] } | null | undefined): number {
  return doc?.elements.filter((e) => e.type === 'video' && !isTaleMediaElement(e)).length ?? 0;
}

/**
 * The tale's own media as a document element (R16): full canvas, `contain` (the fit tale media
 * always had), decorative until someone adds alt text, under the id given.
 */
export function taleMediaElement(id: string, key: string, kind: 'image' | 'video'): MediaElement {
  return {
    id,
    type: kind,
    box: { ...TALE_MEDIA_BOX },
    hidden: false,
    locked: false,
    a11y: { decorative: true },
    props: { mediaKey: key, fit: 'contain', taleMedia: true },
  } as MediaElement;
}

/**
 * A document's media key: a storage key the server made for media (`tales/…` or `media/…`, with
 * the extension of its checked type), as the element schemas state it.
 */
export const MEDIA_KEY_PATTERN = /^(tales|media)\/[a-z0-9][a-z0-9-]{0,99}\.(png|jpg|gif|webp|mp4|webm)$/;

/** True when `value` has the shape of a document media key ({@link MEDIA_KEY_PATTERN}). */
export function isMediaKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && MEDIA_KEY_PATTERN.test(value);
}

const KEY_TYPES: Readonly<Record<string, MediaContentType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * The content type of media stored under `key`, from its extension, which the server chose from
 * the file's checked type; null for a key that is not a document media key.
 */
export function mediaContentTypeOfKey(key: string): MediaContentType | null {
  if (!isMediaKey(key)) return null;
  return KEY_TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? null;
}

/** One media reference of a document: its key, where it is, what it must be, and whether it shows. */
export interface DocumentMediaRef {
  key: string;
  /** The JSON pointer of the key, as a refusal names it. */
  pointer: string;
  /** What the key must be: a video for a `video` element, else an image. */
  kind: 'image' | 'video';
  /** False for a hidden element, which is not delivered. */
  visible: boolean;
}

/** The element types that show media of the tale's project by storage key. */
export const MEDIA_ELEMENT_TYPES = ['image', 'video', 'sticker', 'image-button'] as const;

/** True when the element is an `image`, a `video`, an image `sticker` or an `image-button`. */
export function isMediaElement<T extends { type: string }>(
  element: T,
): element is Extract<T, { type: (typeof MEDIA_ELEMENT_TYPES)[number] }> {
  return (MEDIA_ELEMENT_TYPES as readonly string[]).includes(element.type);
}

/**
 * The media keys a document of any trust references: each image, video and image sticker
 * element's `mediaKey`, and the canvas's media background. Values that are not strings are
 * skipped; the schema refuses them.
 */
export function documentMediaRefs(doc: unknown): DocumentMediaRef[] {
  const refs: DocumentMediaRef[] = [];
  if (typeof doc !== 'object' || doc === null) return refs;
  const { canvas, elements } = doc as { canvas?: unknown; elements?: unknown };
  const background = (canvas as { background?: { type?: unknown; mediaKey?: unknown } } | null)?.background;
  if (background?.type === 'media' && typeof background.mediaKey === 'string') {
    refs.push({ key: background.mediaKey, pointer: '/canvas/background/mediaKey', kind: 'image', visible: true });
  }
  if (!Array.isArray(elements)) return refs;
  elements.forEach((element: unknown, i) => {
    const e = element as { type?: unknown; hidden?: unknown; props?: { mediaKey?: unknown } } | null;
    if (typeof e?.type !== 'string' || !isMediaElement({ type: e.type }) || typeof e.props?.mediaKey !== 'string') {
      return;
    }
    refs.push({
      key: e.props.mediaKey,
      pointer: `/elements/${i}/props/mediaKey`,
      kind: e.type === 'video' ? 'video' : 'image',
      visible: e.hidden !== true,
    });
  });
  return refs;
}

/** The distinct media keys a document references; with `visibleOnly`, only those it would deliver. */
export function documentMediaKeys(doc: unknown, options: { visibleOnly?: boolean } = {}): string[] {
  const refs = documentMediaRefs(doc).filter((ref) => !options.visibleOnly || ref.visible);
  return [...new Set(refs.map((ref) => ref.key))];
}

/** True when a document holds a `video` element: the tale then plays for the video's length. */
export function hasVideoElement(doc: { elements: readonly { type: string }[] } | null | undefined): boolean {
  return !!doc?.elements.some((element) => element.type === 'video');
}

const MEDIA_NAMES: Readonly<Record<string, string>> = {
  image: 'Image',
  video: 'Video',
  sticker: 'Sticker',
  'image-button': 'Image button',
};

/**
 * How Tale Studio, and refusals, name a media element: its alt text, shortened to 40 characters,
 * or its type and its place among the elements of that type from the bottom of the z-order, such
 * as "Image 2" or "Sticker 1".
 */
export function mediaElementName(
  elements: readonly { type: string; a11y?: { label?: string } }[],
  index: number,
): string {
  const element = elements[index];
  const label = element?.a11y?.label?.trim().replace(/\s+/g, ' ') ?? '';
  if (label) {
    const characters = [...label];
    return characters.length > 40 ? `${characters.slice(0, 40).join('')}…` : label;
  }
  const type = element && Object.prototype.hasOwnProperty.call(MEDIA_NAMES, element.type) ? element.type : 'image';
  const n = elements.slice(0, index + 1).filter((e) => e.type === type).length;
  return `${MEDIA_NAMES[type]} ${n}`;
}

/**
 * True when the element tells assistive technology what it shows, or is marked as showing nothing
 * to tell (R12). An image button is a link: only alt text names it, the decorative mark does not count.
 */
export function hasAltText(element: { type?: string; a11y?: { label?: string; decorative?: boolean } }): boolean {
  const named = (element.a11y?.label ?? '').trim() !== '';
  return element.type === 'image-button' ? named : named || element.a11y?.decorative === true;
}

/**
 * The first visible image, video or image sticker that has neither alt text nor the decorative
 * mark (R12), which keeps a tale from being published; null when there is none. Drafts may hold
 * such elements.
 */
export function missingAltText(doc: {
  elements: readonly { type: string; hidden?: boolean; a11y?: { label?: string; decorative?: boolean } }[];
}): { index: number; name: string; type: MediaElement['type'] } | null {
  const index = doc.elements.findIndex((e) => isMediaElement({ type: e.type }) && e.hidden !== true && !hasAltText(e));
  if (index < 0) return null;
  const type = doc.elements[index].type as MediaElement['type'];
  return { index, name: mediaElementName(doc.elements, index), type };
}

/** What a refusal says about an element {@link missingAltText} found. */
export function missingAltTextMessage(found: { name: string; type?: string }): string {
  return found.type === 'image-button'
    ? `"${found.name}" needs alt text before the tale can be updated.`
    : `"${found.name}" needs alt text, or must be marked decorative, before the tale can be updated.`;
}

/**
 * The document with its media keys turned into URLs, as the Delivery API returns it (AD-11): each
 * image, video and image sticker element's `mediaKey` becomes `url`, and a media background's
 * too. `resolve` gives the URL of a key, or null for a key that is not to be delivered: that
 * element is left out, and that background becomes its colour.
 */
export function resolveDocumentMedia<D extends { canvas: unknown; elements: readonly unknown[] }>(
  doc: D,
  resolve: (key: string) => string | null,
): Omit<D, 'canvas'> & { canvas: DeliveryCanvas } {
  const canvas = doc.canvas as { background?: { type?: unknown; mediaKey?: unknown; color?: unknown } } | null;
  let background: unknown = canvas?.background;
  if (canvas?.background?.type === 'media') {
    const { mediaKey, ...rest } = canvas.background;
    const url = typeof mediaKey === 'string' ? resolve(mediaKey) : null;
    background = url === null ? { type: 'color', color: rest.color } : { ...rest, url };
  }
  const elements = doc.elements.flatMap((element) => {
    const e = element as { type?: unknown; props?: { mediaKey?: unknown } };
    if (typeof e.type !== 'string' || !isMediaElement({ type: e.type })) return [element];
    const { mediaKey, ...props } = e.props ?? {};
    const url = typeof mediaKey === 'string' ? resolve(mediaKey) : null;
    return url === null ? [] : [{ ...e, props: { ...props, url } }];
  });
  return { ...doc, canvas: { ...(doc.canvas as object), background } as DeliveryCanvas, elements };
}

// ---- Shapes, emoji and image stickers (epic Tale Studio R6, R12, R14; AD-16) ----

/** The shapes a `shape` element draws. */
export type ShapeKind = ShapeElementProps['shape'];

/** Every shape, in the order Tale Studio offers them. */
export const SHAPE_KINDS: readonly ShapeKind[] = ['rectangle', 'ellipse', 'line'];

/** The widest stroke, as a fraction of the canvas height. */
export const MAX_STROKE_WIDTH = 0.05;

/** The largest corner radius of a rectangle, as a fraction of the canvas height. */
export const MAX_SHAPE_RADIUS = 0.5;

const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A shape's look with every value checked again: what Tale Studio and the Web SDK draw. */
export interface ShapeStyle {
  shape: ShapeKind;
  /** The fill colour, or null for none (a line has none). */
  fill: string | null;
  /** The stroke colour, or null for none. */
  stroke: string | null;
  /** The stroke width as a fraction of the canvas height; 0 without a stroke colour. */
  strokeWidth: number;
  /** A rectangle's corner radius as a fraction of the canvas height; 0 for other shapes. */
  radius: number;
  opacity: number;
}

const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
const colorOrNull = (value: unknown): string | null =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value : null;

/**
 * A shape's props of any trust as the values to draw (AD-16): each checked again, and one that
 * fails takes its default (none, 0 or 1). Null when `shape` is not a known shape.
 */
export function resolveShapeStyle(props: unknown): ShapeStyle | null {
  const p = (typeof props === 'object' && props !== null ? props : {}) as Record<string, unknown>;
  const shape = p['shape'];
  if (shape !== 'rectangle' && shape !== 'ellipse' && shape !== 'line') return null;
  const stroke = colorOrNull(p['stroke']);
  return {
    shape,
    fill: shape === 'line' ? null : colorOrNull(p['fill']),
    stroke,
    strokeWidth: stroke === null ? 0 : numberIn(p['strokeWidth'], 0, MAX_STROKE_WIDTH, 0),
    radius: shape === 'rectangle' ? numberIn(p['radius'], 0, MAX_SHAPE_RADIUS, 0) : 0,
    opacity: numberIn(p['opacity'], 0, 1, 1),
  };
}

/** The names people read for each shape. */
export const SHAPE_NAMES: Readonly<Record<ShapeKind, string>> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
};

// The first 40 characters of a text or label on one line, or ''.
function shortName(value: unknown): string {
  const characters = [...(typeof value === 'string' ? value : '').trim().replace(/\s+/g, ' ')];
  return characters.length > 40 ? `${characters.slice(0, 40).join('')}…` : characters.join('');
}

/**
 * How Tale Studio's layers list, and the server's refusals, name the element at `index` of a
 * document's elements of any trust: a text's first 40 characters on one line ("Empty text"); a
 * button's or swipe-up link's label ("Button 1", "Swipe-up link"); an image's, video's, image
 * sticker's or image button's alt text, else its kind and place ("Image 2",
 * {@link mediaElementName}); an emoji with its name ("🎉 party popper"), or alone; a shape's label,
 * else its shape and place among the shapes of that kind ("Rectangle 1"); another type its place
 * ("Layer 3").
 */
export function elementName(
  elements: readonly { type: string; a11y?: { label?: string }; props?: unknown }[],
  index: number,
): string {
  const element = elements[index];
  const props = (element?.props ?? {}) as { text?: unknown; emoji?: unknown; shape?: unknown; label?: unknown };
  switch (element?.type) {
    case 'text':
      return shortName(props.text) || 'Empty text';
    case 'button':
      return (
        shortName(props.label) || `Button ${elements.slice(0, index + 1).filter((e) => e.type === 'button').length}`
      );
    case 'swipe-up':
      return shortName(props.label) || 'Swipe-up link';
    case 'emoji': {
      const emoji = typeof props.emoji === 'string' ? props.emoji : '';
      const label = shortName(element.a11y?.label);
      return label ? `${emoji} ${label}`.trim() : emoji || 'Emoji';
    }
    case 'shape': {
      const label = shortName(element.a11y?.label);
      if (label) return label;
      const shape = props.shape;
      const n = elements
        .slice(0, index + 1)
        .filter((e) => e.type === 'shape' && (e.props as { shape?: unknown } | undefined)?.shape === shape).length;
      const known = typeof shape === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_NAMES, shape);
      return `${known ? SHAPE_NAMES[shape as ShapeKind] : 'Shape'} ${n}`;
    }
    default:
      return element && isMediaElement({ type: element.type })
        ? mediaElementName(elements, index)
        : `Layer ${index + 1}`;
  }
}

/** The props of a new shape: white; a rectangle slightly rounded, a line a thin stroke. */
export function newShapeProps(shape: ShapeKind): ShapeElementProps {
  if (shape === 'line') return { shape, stroke: '#FFFFFF', strokeWidth: 0.006 };
  if (shape === 'ellipse') return { shape, fill: '#FFFFFF' };
  return { shape, fill: '#FFFFFF', radius: 0.02 };
}

/** Where a new rectangle or ellipse goes: centred, inside the safe areas. */
export const NEW_SHAPE_BOX: TaleElementBox = { x: 0.3, y: 0.4, w: 0.4, h: 0.2, rotation: 0 };

/** Where a new line goes: across the middle, its box a little taller than its stroke. */
export const NEW_LINE_BOX: TaleElementBox = { x: 0.2, y: 0.48, w: 0.6, h: 0.04, rotation: 0 };

/** Where a new emoji goes: a square box (on the 9:16 canvas) in the middle. */
export const NEW_EMOJI_BOX: TaleElementBox = { x: 0.375, y: 0.43, w: 0.25, h: 0.140625, rotation: 0 };

/** Where a new image sticker goes: a square box (on the 9:16 canvas) in the middle. */
export const NEW_STICKER_BOX: TaleElementBox = { x: 0.3, y: 0.3875, w: 0.4, h: 0.225, rotation: 0 };

/**
 * The platform's colour emoji fonts, never a downloaded font or an emoji image (R6): an emoji is
 * text, so it is announced and stays sharp.
 */
export const EMOJI_FONT_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';

/** How much of the shorter side of its box an emoji's glyph fills. */
export const EMOJI_BOX_FILL = 0.8;

/**
 * An emoji's font size, as CSS: the glyph fills {@link EMOJI_BOX_FILL} of the shorter side of its
 * box on the 9:16 canvas, in the canvas's height units (`cqh`).
 */
export function emojiFontSize(box: { w: number; h: number }): string {
  const side = Math.min(box.h, (box.w * TALE_CANVAS_ASPECT.width) / TALE_CANVAS_ASPECT.height);
  return `${Math.round(side * EMOJI_BOX_FILL * 100000) / 1000}cqh`;
}

/** The most UTF-16 code units an emoji holds, as the schema states it. */
export const MAX_EMOJI_LENGTH = 64;

let emojiPattern: RegExp | null = null;

/** Thrown where the runtime lacks the RegExp `v` flag, which emoji checks need (Node.js 22 or later). */
export class EmojiCheckUnsupportedError extends Error {
  constructor() {
    super(
      'Checking emoji needs the RegExp v flag (\\p{RGI_Emoji}): run on Node.js 22 or later. ' +
        'Emoji are never checked by a looser rule.',
    );
    this.name = 'EmojiCheckUnsupportedError';
  }
}

// One RGI emoji (Unicode's recommended set: single emoji, keycaps, flags, modifier, tag and ZWJ
// sequences), as the `v` flag's `\p{RGI_Emoji}` states it. Which sequences it holds follows the
// runtime's Unicode (ICU) version. There is no looser fallback: without the flag it throws.
function emojiRegExp(): RegExp {
  if (emojiPattern) return emojiPattern;
  try {
    emojiPattern = new RegExp('^\\p{RGI_Emoji}$', 'v');
  } catch {
    throw new EmojiCheckUnsupportedError();
  }
  return emojiPattern;
}

/**
 * Throws {@link EmojiCheckUnsupportedError} on a runtime that cannot check emoji (no RegExp `v`
 * flag). Servers call it at start-up, so they fail closed rather than check emoji loosely.
 */
export function assertEmojiCheckSupported(): void {
  emojiRegExp();
}

/**
 * True when `value` is exactly one emoji (an RGI emoji; R6, R14): what an `emoji` element holds.
 * A string over {@link MAX_EMOJI_LENGTH} code units is refused before the pattern runs. Throws
 * {@link EmojiCheckUnsupportedError} on a runtime without the RegExp `v` flag.
 */
export function isEmojiGlyph(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EMOJI_LENGTH) return false;
  return emojiRegExp().test(value);
}

// ---- Calls to action: buttons, image buttons and the swipe-up link (epic Tale Studio R7, R14; AD-15, AD-16) ----

/** The element types that are links to a destination (R7). */
export const LINK_ELEMENT_TYPES = ['button', 'image-button', 'swipe-up'] as const;

/** True when the element is a `button`, an `image-button` or the `swipe-up` link. */
export function isLinkElement<T extends { type: string }>(
  element: T,
): element is Extract<T, { type: (typeof LINK_ELEMENT_TYPES)[number] }> {
  return (LINK_ELEMENT_TYPES as readonly string[]).includes(element.type);
}

/** The longest destination URL, in characters. */
export const MAX_LINK_URL_LENGTH = 2048;

/** The most characters (code points) a button's or swipe-up link's label holds. */
export const MAX_LINK_LABEL_LENGTH = 80;

/** The most swipe-up links one document holds (R7). */
export const MAX_SWIPE_UP_ELEMENTS = 1;

/**
 * Why a destination URL is refused (R7, R14; AD-15):
 * - `empty`: no address;
 * - `tooLong`: over {@link MAX_LINK_URL_LENGTH} characters;
 * - `characters`: spaces, control characters, or bidi controls anywhere (browsers drop tabs and
 *   line feeds from URLs, which would let `java\tscript:` through a looser check);
 * - `scheme`: not an absolute `http://` or `https://` URL (`javascript:`, `data:`, `ftp:`, a
 *   relative or protocol-relative URL);
 * - `invalid`: not a URL a browser parses, or one without a host;
 * - `credentials`: a user name or password in the URL, even empty (`https://:@host`), as the
 *   importer's URL policy refuses them.
 */
export type LinkUrlProblem = 'empty' | 'tooLong' | 'characters' | 'scheme' | 'invalid' | 'credentials';

// Any character at or below the space, DEL, C1 controls, the no-break and other Unicode spaces
// (U+00A0, U+1680, U+2000-U+200A, U+202F, U+205F, U+3000), invisible and format characters (soft
// hyphen, zero-width space and joiners, U+FEFF), the line and paragraph separators, and the bidi
// marks, embeddings, overrides and isolates (U+061C, U+200E/F, U+202A-U+202E, U+2066-U+2069):
// none belongs in a link a person reads, and each can make one address look like another.
// eslint-disable-next-line no-control-regex
const LINK_URL_BAD_CHARACTER = /[\u0000-\u0020\u007f-\u00a0\u00ad\u061c\u1680\u2000-\u200f\u2028-\u202f\u205f\u2066-\u2069\u3000\ufeff]/;
const LINK_URL_SCHEME = /^https?:\/\//i;

/**
 * Why `value` is not a destination a link may open, or null when it is one: an absolute `http` or
 * `https` URL of at most 2,048 characters, with a host, without credentials, spaces or control
 * characters (R7, R14). The server refuses a document holding another; Tale Studio checks the
 * same rule as people type, and the Web SDK checks it again before it renders a link (AD-16).
 */
export function linkUrlProblem(value: unknown): LinkUrlProblem | null {
  if (typeof value !== 'string' || value === '') return 'empty';
  if (value.length > MAX_LINK_URL_LENGTH) return 'tooLong';
  if (LINK_URL_BAD_CHARACTER.test(value)) return 'characters';
  if (!LINK_URL_SCHEME.test(value)) return 'scheme';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme';
  if (url.hostname === '') return 'invalid';
  // Credentials, even empty ones (`https://:@host`): any `@` in the authority as typed. A backslash
  // ends the authority as a slash does, as browsers parse it: `https://example.com\@evil.example`
  // is accepted and opens example.com, the host it shows first.
  const authority = value.slice(value.indexOf('//') + 2).split(/[/?#\\]/)[0];
  if (url.username !== '' || url.password !== '' || authority.includes('@')) return 'credentials';
  return null;
}

/** True when `value` is a destination a link may open ({@link linkUrlProblem}). */
export function isLinkUrl(value: unknown): value is string {
  return linkUrlProblem(value) === null;
}

/** What Tale Studio, and server refusals, say about each {@link LinkUrlProblem}. */
export const LINK_URL_MESSAGES: Readonly<Record<LinkUrlProblem, string>> = {
  empty: 'Enter the web address the link opens.',
  tooLong: 'A web address holds at most 2,048 characters.',
  characters: 'A web address may not hold spaces or control characters.',
  scheme: 'Only web addresses starting with http:// or https:// can be linked.',
  invalid: 'This is not a valid web address.',
  credentials: 'A web address may not hold a user name or password.',
};

/**
 * The first visible link of a document without a valid destination, with its name, which keeps
 * the document from being published (R7); null when there is none. A draft may hold a link whose
 * address is still to be entered.
 */
export function missingLinkUrl(doc: {
  elements: readonly { type: string; hidden?: boolean; a11y?: { label?: string }; props?: unknown }[];
}): { index: number; name: string } | null {
  const index = doc.elements.findIndex(
    (e) =>
      isLinkElement({ type: e.type }) &&
      e.hidden !== true &&
      !isLinkUrl((e.props as { href?: unknown } | undefined)?.href),
  );
  return index < 0 ? null : { index, name: elementName(doc.elements, index) };
}

/** What a refusal says about a link {@link missingLinkUrl} found. */
export function missingLinkUrlMessage(found: { name: string }): string {
  return `"${found.name}" needs a web address before the tale can be updated.`;
}

/**
 * The swipe-up link's box (R7): pinned to the bottom safe area, centred. Every swipe-up link has
 * it; the server refuses another, and Tale Studio does not move it.
 */
export const SWIPE_UP_BOX: TaleElementBox = { x: 0.2, y: 0.87, w: 0.6, h: 0.09, rotation: 0 };

/** The swipe-up link's label size, as a fraction of the canvas height. */
export const SWIPE_UP_FONT_SIZE = 0.024;

/** True when a box is {@link SWIPE_UP_BOX}. */
export function isSwipeUpBox(box: TaleElementBox): boolean {
  return (
    box.x === SWIPE_UP_BOX.x &&
    box.y === SWIPE_UP_BOX.y &&
    box.w === SWIPE_UP_BOX.w &&
    box.h === SWIPE_UP_BOX.h &&
    box.rotation === SWIPE_UP_BOX.rotation
  );
}

/** Where a new button goes: centred, above the bottom safe area. */
export const NEW_BUTTON_BOX: TaleElementBox = { x: 0.2, y: 0.74, w: 0.6, h: 0.07, rotation: 0 };

/**
 * Where the importer puts the button of a tale whose source story has a call to action (epic Tale
 * Studio R17): centred, its bottom edge on the bottom safe area ({@link TALE_SAFE_AREA}), the
 * height of {@link NEW_BUTTON_BOX}.
 */
export const IMPORTED_BUTTON_BOX: TaleElementBox = { x: 0.2, y: 0.77, w: 0.6, h: 0.07, rotation: 0 };

/** Where a new image button goes: a square box (on the 9:16 canvas) above the bottom safe area. */
export const NEW_IMAGE_BUTTON_BOX: TaleElementBox = { x: 0.35, y: 0.5, w: 0.3, h: 0.16875, rotation: 0 };

/** The largest corner radius of a button or image button, as a fraction of the canvas height. */
export const MAX_LINK_RADIUS = 0.5;

/** A button's style: `filled` paints it, `outline` draws its edge. */
export type ButtonVariant = ButtonElementProps['variant'];

/** The button styles, in the order Tale Studio offers them. */
export const BUTTON_VARIANTS: readonly ButtonVariant[] = ['filled', 'outline'];

/** The props of a new button: a white, rounded, filled button with dark text, and no destination yet. */
export function newButtonProps(): ButtonElementProps {
  return { label: 'Learn more', variant: 'filled', color: '#111827', fill: '#FFFFFF', radius: 0.035 };
}

/** The props of a new swipe-up link: white text on a translucent dark pill, and no destination yet. */
export function newSwipeUpProps(): SwipeUpElementProps {
  return { label: 'See more', color: '#FFFFFF', background: '#000000B3' };
}

/** A button's look with every value checked again: what Tale Studio and the Web SDK draw. */
export interface ButtonStyle {
  variant: ButtonVariant;
  /** The label colour. */
  color: string;
  /** The fill, or an outline button's edge. */
  fill: string;
  /** The corner radius as a fraction of the canvas height. */
  radius: number;
}

/**
 * A button's props of any trust as the values to draw (AD-16): each checked again, and one that
 * fails takes its default (a filled white button with near-black text and square corners).
 */
export function resolveButtonStyle(props: unknown): ButtonStyle {
  const p = (typeof props === 'object' && props !== null ? props : {}) as Record<string, unknown>;
  return {
    variant: p['variant'] === 'outline' ? 'outline' : 'filled',
    color: colorOrNull(p['color']) ?? '#111827',
    fill: colorOrNull(p['fill']) ?? '#FFFFFF',
    radius: numberIn(p['radius'], 0, MAX_LINK_RADIUS, 0),
  };
}

/** A swipe-up link's look with every value checked again. */
export interface SwipeUpStyle {
  color: string;
  background: string;
}

/** A swipe-up link's props of any trust as the values to draw (AD-16); a value that fails takes its default. */
export function resolveSwipeUpStyle(props: unknown): SwipeUpStyle {
  const p = (typeof props === 'object' && props !== null ? props : {}) as Record<string, unknown>;
  return { color: colorOrNull(p['color']) ?? '#FFFFFF', background: colorOrNull(p['background']) ?? '#000000B3' };
}

/** The width of an outline button's edge, as a fraction of the canvas height. */
export const BUTTON_OUTLINE_WIDTH = 0.004;

/**
 * A button's label size as a fraction of the canvas height: 40% of its box's height, at most 6%
 * of the canvas, so the label sits on one line in a box of any height.
 */
export function buttonFontSize(box: { h: number }): number {
  return Math.round(Math.min(box.h * 0.4, 0.06) * 100000) / 100000;
}

/** A link's label as it is drawn: one line, without the characters a label may not hold, within its limit. */
export function linkLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return [...cleanText(value.replace(/\s+/g, ' '), LABEL_TEXT_RULE)].slice(0, MAX_LINK_LABEL_LENGTH).join('').trim();
}
