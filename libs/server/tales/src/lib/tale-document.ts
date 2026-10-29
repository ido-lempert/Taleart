import {
  EDITOR_ONLY_ELEMENT_FIELDS,
  ELEMENT_TEXT_RULE,
  ErrorCodes,
  hasDisallowedCharacter,
  isEmojiGlyph,
  isFontFamily,
  isLinkElement,
  isMediaContentType,
  isSwipeUpBox,
  LINK_URL_MESSAGES,
  linkUrlProblem,
  MAX_SWIPE_UP_ELEMENTS,
  missingLinkUrl,
  missingLinkUrlMessage,
  isMediaElement,
  isTaleMediaElement,
  mediaKind,
  LABEL_TEXT_RULE,
  MAX_LABEL_LENGTH,
  MAX_TALE_DOCUMENT_BYTES,
  MAX_VIDEO_ELEMENTS,
  missingAltText,
  missingAltTextMessage,
  elementName,
  isUtcInstant,
  documentMediaRefs,
  UNKNOWN_MEDIA_REASON,
  projectFontIds,
  projectFontRefs,
  TALE_DOCUMENT_VERSION,
  TALE_DOCUMENT_V1_SCHEMA,
  elementTypeRegistry,
  ELEMENT_TYPE_LIMITS,
  isInteractiveElementType,
  type DeliveryTaleDocument,
  type TaleCanvas,
  type TaleDocument,
  type TaleDocumentRevision,
} from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from '@taleart/server-access';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import { clearPublicMediaCache, lockMediaKeys, projectMediaKeys, recordTaleMedia, usesMedia } from './document-media';
import { clearPublicFontCache, knownProjectFontIds, recordTaleFonts } from './project-fonts';
import {
  documentTaleMedia,
  markTaleMediaSeen,
  taleMediaDocumentsEnabled,
  withOutOfStepMedia,
  withoutStaleTaleMedia,
} from './tale-media-document';
import { TaleNotFoundError } from './tales';

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

/**
 * Thrown when a draft is published with a visible button, image button or swipe-up link that has
 * no web address (R7); the message names the element as Tale Studio does. Drafts may hold one.
 */
export class LinkUrlRequiredError extends InvalidTaleDocumentError {
  constructor(pointer: string, message: string) {
    super(pointer, message);
    this.message = message;
    this.name = 'LinkUrlRequiredError';
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
    super('This tale has no draft to update.');
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

// A link's destination, when it has one (R7, R14; AD-15): an absolute http or https URL of at most
// 2,048 characters, with a host, and without credentials, spaces or control characters.
function checkHref(props: Record<string, unknown>, pointer: string): void {
  if (props['href'] === undefined) return;
  const problem = linkUrlProblem(props['href']);
  if (problem) throw new InvalidTaleDocumentError(`${pointer}/href`, `is refused: ${LINK_URL_MESSAGES[problem]}`);
}

// A button's or swipe-up link's label: one line of text that shows (R7, R14).
function checkLinkLabel(props: Record<string, unknown>, pointer: string): void {
  const label = props['label'];
  if (typeof label !== 'string') return;
  if (hasDisallowedCharacter(label, LABEL_TEXT_RULE) || label.includes('\n')) {
    throw new InvalidTaleDocumentError(
      `${pointer}/label`,
      'may not hold line feeds, control characters, lone surrogates or bidi overrides',
    );
  }
  if (label.trim() === '') throw new InvalidTaleDocumentError(`${pointer}/label`, 'must hold some text');
}

// A component's one-line text (epic interactive components R1, R15): plain text that shows, without
// line feeds, control characters, lone surrogates or bidi overrides.
function checkLineText(value: unknown, pointer: string): void {
  if (typeof value !== 'string') return;
  if (hasDisallowedCharacter(value, LABEL_TEXT_RULE) || value.includes('\n')) {
    throw new InvalidTaleDocumentError(pointer, 'may not hold line feeds, control characters, lone surrogates or bidi overrides');
  }
  if (value.trim() === '') throw new InvalidTaleDocumentError(pointer, 'must hold some text');
}

// A choice component (a poll, R2; a quiz, R3): its title, question and choice labels are text that
// shows, and the ids of the choices in `prop` differ, since responses are counted by them. Answers
// the ids.
function checkChoices(props: Record<string, unknown>, pointer: string, prop: string, noun: string): Set<unknown> {
  checkLineText(props['title'], `${pointer}/title`);
  checkLineText(props['question'], `${pointer}/question`);
  const choices = Array.isArray(props[prop]) ? (props[prop] as { id?: unknown; label?: unknown }[]) : [];
  const ids = new Set<unknown>();
  choices.forEach((choice, i) => {
    checkLineText(choice.label, `${pointer}/${prop}/${i}/label`);
    if (ids.has(choice.id)) throw new InvalidTaleDocumentError(`${pointer}/${prop}/${i}/id`, `is the id of another ${noun}`);
    ids.add(choice.id);
  });
  return ids;
}

// A poll (epic interactive components R2): two options with distinct ids.
function checkPoll(props: Record<string, unknown>, pointer: string): void {
  checkChoices(props, pointer, 'options', 'option');
}

// A quiz (epic interactive components R3): answers with distinct ids, and a correct answer, when it
// has one, that is one of them.
function checkQuiz(props: Record<string, unknown>, pointer: string): void {
  const ids = checkChoices(props, pointer, 'answers', 'answer');
  const correct = props['correctAnswerId'];
  if (correct !== undefined && !ids.has(correct)) {
    throw new InvalidTaleDocumentError(`${pointer}/correctAnswerId`, 'must be the id of one of its answers');
  }
}

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
  // One RGI emoji, drawn as text (R6, R14): no other text, markup or control characters.
  emoji: (props, pointer) => {
    if (!isEmojiGlyph(props['emoji'])) throw new InvalidTaleDocumentError(`${pointer}/emoji`, 'must be one emoji');
  },
  // Calls to action (R7): a label that shows, and a destination a link may open.
  button: (props, pointer) => {
    checkLinkLabel(props, pointer);
    checkHref(props, pointer);
  },
  'image-button': checkHref,
  'swipe-up': (props, pointer) => {
    checkLinkLabel(props, pointer);
    checkHref(props, pointer);
  },
  poll: checkPoll,
  quiz: checkQuiz,
  // A Rating (epic interactive components R5, R15): text that shows, and one RGI emoji on its slider.
  rating: (props, pointer) => {
    checkLineText(props['title'], `${pointer}/title`);
    checkLineText(props['question'], `${pointer}/question`);
    if (!isEmojiGlyph(props['emoji'])) throw new InvalidTaleDocumentError(`${pointer}/emoji`, 'must be one emoji');
  },
  // A countdown (components, 2026-10-29): text that shows, and an instant that is a real date and time
  // (the schema's pattern alone takes a 30 February).
  countdown: (props, pointer) => {
    checkLineText(props['title'], `${pointer}/title`);
    checkLineText(props['endedText'], `${pointer}/endedText`);
    if (!isUtcInstant(props['endsAt'])) {
      throw new InvalidTaleDocumentError(`${pointer}/endsAt`, 'must be a real date and time in UTC, such as 2026-12-31T21:00:00Z');
    }
  },
  // A promo code (components, 2026-10-29): text that shows; its code is checked by the schema.
  'promo-code': (props, pointer) => {
    checkLineText(props['title'], `${pointer}/title`);
    checkLineText(props['note'], `${pointer}/note`);
  },
};

interface Validators {
  document: ValidateFunction;
  props: Map<string, ValidateFunction>;
}

// One set of compiled schemas without the registry's test-only types and one with them.
const validators = new Map<boolean, Validators>();

// The deployment switch for the registry's test-only element types (epic Tale Studio R8), read by
// the API from TALE_TEST_ELEMENT_TYPES: off unless a test or a development server turns it on.
let testTypes = false;

/**
 * Accepts the element-type registry's test-only types on write (on), or refuses them as unknown
 * types (off, the default). For tests and development servers only; the API never turns it on in
 * production (R8).
 */
export function setTestElementTypesEnabled(on: boolean): void {
  if (testTypes === on) return;
  testTypes = on;
  // Delivered documents were checked under the other setting: a document holding a test type is
  // delivered only while the switch is on (otherwise its tale falls back to no document).
  clearDeliveryCache();
}

/** True while the registry's test-only element types are accepted on write. */
export function testElementTypesEnabled(): boolean {
  return testTypes;
}

// The schemas of every registered type the server takes, compiled once, on first use: the
// registry is the one list of types (AD-15, R8).
function compiled(): Validators {
  const cached = validators.get(testTypes);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: false });
  const props = new Map<string, ValidateFunction>();
  for (const { key, schema } of elementTypeRegistry({ testTypes })) props.set(key, ajv.compile(schema));
  const compiledNow = { document: ajv.compile(TALE_DOCUMENT_V1_SCHEMA), props };
  validators.set(testTypes, compiledNow);
  return compiledNow;
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
  let taleMedia = 0;
  let swipeUps = 0;
  const perType = new Map<string, number>();
  const elements = doc.elements.map((original, i) => {
    const at = `/elements/${i}`;
    const element = normalized(original);
    const validate = props.get(element.type);
    if (!validate)
      throw new InvalidTaleDocumentError(`${at}/type`, `"${element.type}" is not a registered element type`);
    // A link's destination first, so a refusal says why in words rather than as the schema's pattern.
    if (isLinkElement(element)) checkHref(element.props as unknown as Record<string, unknown>, `${at}/props`);
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
    // The tale's own media (R16) is exempt from the video limit, as tale media always was; there is one at most.
    if (isTaleMediaElement(element) && ++taleMedia > 1) {
      throw new InvalidTaleDocumentError(`${at}/props/taleMedia`, 'is set on another element: a tale has one media');
    }
    if (element.type === 'video' && !isTaleMediaElement(element) && ++videos > MAX_VIDEO_ELEMENTS) {
      throw new InvalidTaleDocumentError(`${at}/type`, `is a video: a tale holds at most ${MAX_VIDEO_ELEMENTS}`);
    }
    // At most one of each interactive component per tale, hidden or not (epic interactive components C3).
    const limit = Object.prototype.hasOwnProperty.call(ELEMENT_TYPE_LIMITS, element.type)
      ? ELEMENT_TYPE_LIMITS[element.type]
      : undefined;
    if (limit !== undefined) {
      const count = (perType.get(element.type) ?? 0) + 1;
      perType.set(element.type, count);
      if (count > limit) {
        throw new InvalidTaleDocumentError(`${at}/type`, `is a ${element.type}: a tale holds at most ${limit}`);
      }
    }
    // One swipe-up link per tale, hidden or not, pinned to the bottom safe area (R7).
    if (element.type === 'swipe-up') {
      if (++swipeUps > MAX_SWIPE_UP_ELEMENTS) {
        throw new InvalidTaleDocumentError(
          `${at}/type`,
          `is a swipe-up link: a tale holds at most ${MAX_SWIPE_UP_ELEMENTS}`,
        );
      }
      if (!isSwipeUpBox(element.box)) {
        throw new InvalidTaleDocumentError(`${at}/box`, 'must be the swipe-up box, pinned to the bottom safe area');
      }
    }
    return element;
  });
  return { ...doc, elements };
}

/**
 * Refuses `taleMedia` (R16) on an element that is not the tale's own media: its key must be the
 * tale's media key and its type the kind of the tale's media. The server marks the element; a
 * client keeps the mark only on it. Throws {@link InvalidTaleDocumentError}.
 */
export function checkTaleMediaFlag(doc: TaleDocument, media: { key: string | null; contentType: string | null }): void {
  doc.elements.forEach((element, i) => {
    if (!isTaleMediaElement(element)) return;
    const own =
      media.key !== null &&
      (element.props as { mediaKey?: unknown }).mediaKey === media.key &&
      isMediaContentType(media.contentType) &&
      mediaKind(media.contentType) === element.type;
    if (!own) {
      throw new InvalidTaleDocumentError(
        `/elements/${i}/props/taleMedia`,
        "is set on media that is not the tale's own",
      );
    }
  });
}

/**
 * The document with `taleMedia` (R16) only on the tale's own media: while the tale's media is written
 * into documents, a mark on other media is refused ({@link checkTaleMediaFlag}); while
 * TALE_MEDIA_MIGRATION is off, when a mark may be stale (an older instance changed the media), it is
 * taken off instead, and the element kept as an ordinary image or video.
 */
export function ownTaleMediaOnly(
  doc: TaleDocument,
  media: { key: string | null; contentType: string | null },
): TaleDocument {
  if (!taleMediaDocumentsEnabled()) return withoutStaleTaleMedia(doc, media);
  checkTaleMediaFlag(doc, media);
  return doc;
}

/**
 * The rules a document must also pass to be published (R7, R12): every visible image, video and
 * image sticker has alt text or the decorative mark, and every visible image button alt text;
 * every visible button, image button and swipe-up link has a web address. Throws
 * {@link AltTextRequiredError} or {@link LinkUrlRequiredError} naming the first that does not.
 */
export function checkPublishRules(doc: TaleDocument): void {
  const missing = missingAltText(doc);
  if (missing) throw new AltTextRequiredError(`/elements/${missing.index}/a11y/label`, missingAltTextMessage(missing));
  const unlinked = missingLinkUrl(doc);
  if (unlinked)
    throw new LinkUrlRequiredError(`/elements/${unlinked.index}/props/href`, missingLinkUrlMessage(unlinked));
}

/**
 * Why a draft was not published, in words for the person who set the tale live: no JSON pointers,
 * the element named as Tale Studio names it (R12, AD-15).
 */
export function draftProblem(err: InvalidTaleDocumentError | TaleDocumentTooLargeError, draft: unknown): string {
  if (err instanceof TaleDocumentTooLargeError) return `The draft is larger than ${MAX_TALE_DOCUMENT_BYTES / 1024} KB.`;
  if (err instanceof AltTextRequiredError || err instanceof LinkUrlRequiredError) return err.message;
  if (err.pointer === '/durationMs') return 'Its duration is not between 3 and 15 seconds.';
  if (err.pointer.startsWith('/canvas')) return 'Its background has a setting that is not valid.';
  const index = Number(/^\/elements\/(\d+)/.exec(err.pointer)?.[1] ?? NaN);
  // An element type the registry does not hold here (R8), such as a test-only type with the switch off.
  if (Number.isInteger(index) && err.pointer === `/elements/${index}/type` && /not a registered element type/.test(err.message)) {
    return `Layer ${index + 1} is a type this server doesn't take.`;
  }
  const elements = (draft as { elements?: unknown } | null)?.elements;
  const element = Array.isArray(elements) && Number.isInteger(index) ? (elements[index] as unknown) : undefined;
  if (typeof element !== 'object' || element === null) return 'Something in it is not valid.';
  const e = element as { type?: unknown; props?: { text?: unknown }; a11y?: { label?: string } };
  if (
    typeof e.type === 'string' &&
    (isMediaElement({ type: e.type }) || isLinkElement({ type: e.type }) || e.type === 'shape' || e.type === 'emoji')
  ) {
    return `"${elementName(elements as { type: string }[], index)}" has a setting that is not valid.`;
  }
  if (e.type === 'text' && typeof e.props?.text === 'string') {
    const words = [...e.props.text.trim().replace(/\s+/g, ' ')];
    const name = words.length > 40 ? `${words.slice(0, 40).join('')}…` : words.join('');
    return name
      ? `The text "${name}" has a setting that is not valid.`
      : 'An empty text has a setting that is not valid.';
  }
  return `Layer ${index + 1} has a setting that is not valid.`;
}

/** {@link checkTaleDocument} then {@link checkPublishRules}: what a published document passes. */
export function checkPublishableDocument(value: unknown): TaleDocument {
  const doc = checkTaleDocument(value);
  checkPublishRules(doc);
  return doc;
}

// The element with its label, a text element's text and a link's label in Unicode NFC, so equal
// text is stored equally; a project font's id in lower case, as the database spells a uuid.
// An interactive component's title, question and choice labels (a poll's options, a quiz's answers)
// in Unicode NFC, as text and labels are.
function normalizedComponent<P>(props: P): P {
  const nfc = (value: unknown) => (typeof value === 'string' ? value.normalize('NFC') : value);
  const component = props as Record<string, unknown>;
  const next: Record<string, unknown> = { ...component };
  if (component['title'] !== undefined) next['title'] = nfc(component['title']);
  if (component['question'] !== undefined) next['question'] = nfc(component['question']);
  for (const prop of ['options', 'answers']) {
    const choices = component[prop];
    if (!Array.isArray(choices)) continue;
    next[prop] = choices.map((choice: unknown) =>
      typeof choice === 'object' && choice !== null
        ? { ...choice, label: nfc((choice as { label?: unknown }).label) }
        : choice,
    );
  }
  return next as P;
}

function normalized(element: TaleDocument['elements'][number]): TaleDocument['elements'][number] {
  const label = element.a11y.label;
  const a11y = typeof label === 'string' ? { ...element.a11y, label: label.normalize('NFC') } : element.a11y;
  const text = (element.props as { text?: unknown } | null)?.text;
  let props = typeof text === 'string' ? { ...element.props, text: text.normalize('NFC') } : element.props;
  const linkText = isLinkElement(element) ? (props as { label?: unknown }).label : undefined;
  if (typeof linkText === 'string') props = { ...props, label: linkText.normalize('NFC') } as typeof props;
  if (isInteractiveElementType(element.type)) props = normalizedComponent(props);
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
    if (!known.has(ref.key)) throw new InvalidTaleDocumentError(ref.pointer, UNKNOWN_MEDIA_REASON);
    const isVideo = /\.(mp4|webm)$/.test(ref.key);
    if (isVideo !== (ref.kind === 'video')) {
      throw new InvalidTaleDocumentError(ref.pointer, ref.kind === 'video' ? 'must be a video' : 'must be an image');
    }
  }
}

// The project of the tale, or a 404. With `lock`, the tale row is locked first, as publishing locks
// it before the media keys: every document write takes the tale row, then its fonts and keys.
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
  const { rows } = await db.query<StateRow & { key: string | null; contentType: string | null; inStep: string | null }>(
    `SELECT ${STATE_COLUMNS}, media_key AS key, media_content_type AS "contentType", document_media_key AS "inStep"
     FROM tales WHERE id = $1`,
    [taleId],
  );
  if (rows.length === 0) throw new TaleNotFoundError(taleId);
  const { key, contentType, inStep, ...row } = rows[0];
  // A tale out of step shows its media as visitors see it (R16), so the studio's canvas, preview and
  // contrast checks match; saving it writes it. Not while the documents are not to hold it.
  const media = taleMediaDocumentsEnabled() ? documentTaleMedia(key ?? null, contentType ?? null) : null;
  if (media === null || inStep === key) return toState(row);
  return toState({
    ...row,
    document: withOutOfStepMedia(taleId, row.document, media, inStep ?? null) as TaleDocument | null,
    // Nothing published stays nothing published: going live publishes the draft (7.3).
    publishedDocument:
      row.publishedDocument === null
        ? null
        : (withOutOfStepMedia(taleId, row.publishedDocument, media, inStep ?? null) as TaleDocument),
  });
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
  options: { sawTaleMedia?: boolean } = {},
): Promise<TaleDocumentRevision> {
  if (!UUID.test(taleId)) throw new TaleNotFoundError(taleId);
  let document = checkTaleDocument(value);
  const usesFonts = projectFontIds(document).length > 0;
  const hasMedia = usesMedia(document);
  return inTransaction(db, async (tx) => {
    const projectId = usesFonts || hasMedia ? await projectOfTale(tx, taleId, true) : null;
    if (usesFonts && projectId) await checkDocumentFonts(tx, projectId, document, true);
    if (hasMedia && projectId) await checkDocumentMedia(tx, projectId, document);
    if (document.elements.some(isTaleMediaElement)) {
      const own = await tx.query<{ key: string | null; contentType: string | null }>(
        'SELECT media_key AS key, media_content_type AS "contentType" FROM tales WHERE id = $1',
        [taleId],
      );
      if (own.rows.length > 0) document = ownTaleMediaOnly(document, own.rows[0]);
    }
    const { rows } = await tx.query<StateRow>(
      `UPDATE tales SET draft_document = $2::jsonb, draft_revision = draft_revision + 1
       WHERE id = $1 AND draft_revision = $3
       RETURNING ${STATE_COLUMNS}`,
      [taleId, JSON.stringify(document), basedOn],
    );
    if (rows.length === 0) return refuseStale(tx, taleId);
    await recordTaleFonts(tx, taleId, 'draft', document, false);
    await recordTaleMedia(tx, taleId, 'draft', document, false);
    // An editor that loaded the tale's media: what it saved is the person's choice (R16).
    if (options.sawTaleMedia && (await markTaleMediaSeen(tx, taleId))) {
      const now = await tx.query<StateRow>(`SELECT ${STATE_COLUMNS} FROM tales WHERE id = $1`, [taleId]);
      return { ...toState(now.rows[0]), document };
    }
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
