// The tale document (AD-15). The JSON Schema files in `libs/contract/tale-document/` are the
// source: `v1.schema.json` is the envelope, and `element-types/registry.json` names each element
// type with the schema of its `props`. `contract:generate` turns them into the types below (through
// openapi.yaml) and into a TypeScript copy of the schemas for validators.
import type { components } from '../generated/api';
import type { DeliveryCanvas, MediaContentType } from './core';
import type { TextFont } from './text-style';

export { TALE_DOCUMENT_V1_SCHEMA, TALE_ELEMENT_TYPE_REGISTRY } from '../generated/tale-document-schemas';

type Schemas = components['schemas'];

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
/** An element that shows media of the tale's project. */
export type MediaElement = ImageElement | VideoElement;

/** Every element type of the registry, a discriminated union keyed by `type` (AD-15). */
export type TaleElement = TextElement | ImageElement | VideoElement;

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

/** True when the element is an `image` or a `video`. */
export function isMediaElement<T extends { type: string }>(
  element: T,
): element is Extract<T, { type: 'image' | 'video' }> {
  return element.type === 'image' || element.type === 'video';
}

/**
 * The media keys a document of any trust references: each image and video element's `mediaKey`,
 * and the canvas's media background. Values that are not strings are skipped; the schema refuses them.
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
    if ((e?.type !== 'image' && e?.type !== 'video') || typeof e.props?.mediaKey !== 'string') return;
    refs.push({
      key: e.props.mediaKey,
      pointer: `/elements/${i}/props/mediaKey`,
      kind: e.type,
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

/**
 * How Tale Studio, and refusals, name a media element: its alt text, shortened to 40 characters,
 * or its type and its place among the elements of that type from the bottom of the z-order, such
 * as "Image 2".
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
  const type = element?.type === 'video' ? 'video' : 'image';
  const n = elements.slice(0, index + 1).filter((e) => e.type === type).length;
  return `${type === 'video' ? 'Video' : 'Image'} ${n}`;
}

/** True when the element tells assistive technology what it shows, or is marked as showing nothing to tell (R12). */
export function hasAltText(element: { a11y?: { label?: string; decorative?: boolean } }): boolean {
  return element.a11y?.decorative === true || (element.a11y?.label ?? '').trim() !== '';
}

/**
 * The first visible image or video that has neither alt text nor the decorative mark (R12), which
 * keeps a tale from being published; null when there is none. Drafts may hold such elements.
 */
export function missingAltText(doc: {
  elements: readonly { type: string; hidden?: boolean; a11y?: { label?: string; decorative?: boolean } }[];
}): { index: number; name: string; type: 'image' | 'video' } | null {
  const index = doc.elements.findIndex(
    (e) => (e.type === 'image' || e.type === 'video') && e.hidden !== true && !hasAltText(e),
  );
  if (index < 0) return null;
  const type = doc.elements[index].type === 'video' ? 'video' : 'image';
  return { index, name: mediaElementName(doc.elements, index), type };
}

/** What a refusal says about an element {@link missingAltText} found. */
export function missingAltTextMessage(found: { name: string }): string {
  return `"${found.name}" needs alt text, or must be marked decorative, before the tale is published.`;
}

/**
 * The document with its media keys turned into URLs, as the Delivery API returns it (AD-11): each
 * image and video element's `mediaKey` becomes `url`, and a media background's too. `resolve`
 * gives the URL of a key, or null for a key that is not to be delivered: that element is left out,
 * and that background becomes its colour.
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
    if (e.type !== 'image' && e.type !== 'video') return [element];
    const { mediaKey, ...props } = e.props ?? {};
    const url = typeof mediaKey === 'string' ? resolve(mediaKey) : null;
    return url === null ? [] : [{ ...e, props: { ...props, url } }];
  });
  return { ...doc, canvas: { ...(doc.canvas as object), background } as DeliveryCanvas, elements };
}
