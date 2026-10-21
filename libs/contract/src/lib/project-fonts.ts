// Project fonts (epic Tale Studio R4, R18; AD-15, AD-16; user decision 2026-10-21): the rules a
// font uploaded to a project follows, the internal alias it is drawn under, and the one loader the
// Web SDK and Tale Studio share, so both fetch and register a font the same way.
import { isFontFamily } from './theme';
import type { TextWeight } from './text-style';

/** The largest font file accepted, in bytes: 500 KB (a starting value, tuned by story 7.14). */
export const MAX_FONT_BYTES = 500 * 1024;

/** The only font format accepted, and how it is served. */
export const FONT_CONTENT_TYPE = 'font/woff2';

/** The extension of a stored font file's key (`fonts/<uuid>.woff2`). */
export const FONT_FILE_EXTENSION = 'woff2';

/** The weights a face can have: 100 to 900 in steps of 100. */
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** The names people read for each weight. */
export const FONT_WEIGHT_NAMES: Readonly<Record<number, string>> = /* @__PURE__ */ Object.freeze({
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
});

/** A face as people read it, from its weight and style: "Bold italic", "Regular". */
export function fontFaceName(face: { weight: number; style: string }): string {
  const weight = FONT_WEIGHT_NAMES[face.weight] ?? String(face.weight);
  return face.style === 'italic' ? `${weight} italic` : weight;
}

/** A face's style. */
export type ProjectFontStyle = 'normal' | 'italic';

/** The styles a face can have. */
export const FONT_STYLES: readonly ProjectFontStyle[] = ['normal', 'italic'];

/** The value of the upload's `licence` parameter that confirms the uploader may use and distribute the font. */
export const FONT_LICENCE_CONFIRMED = 'confirmed';

/** The longest family name accepted. */
export const MAX_PROJECT_FONT_FAMILY_LENGTH = 100;

// One bare font name: what a family name is (no list, no quotes).
const BARE_FONT_NAME = /^[A-Za-z][A-Za-z0-9 -]*$/;

/**
 * Why a family name is refused, or null when it is valid: one bare name of letters, digits, spaces
 * and hyphens that starts with a letter, at most {@link MAX_PROJECT_FONT_FAMILY_LENGTH} characters
 * with no space at either end, and that passes the theme's font-list rules (`isFontFamily`: no
 * CSS-wide keyword). The name is a label people read; CSS never sees it (see {@link projectFontAlias}).
 */
export function projectFontFamilyError(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'family is required';
  if (value.length > MAX_PROJECT_FONT_FAMILY_LENGTH) {
    return `family must be at most ${MAX_PROJECT_FONT_FAMILY_LENGTH} characters`;
  }
  if (value !== value.trim() || !BARE_FONT_NAME.test(value) || !isFontFamily(value)) {
    return 'family must be one font name of letters, digits, spaces and hyphens, starting with a letter (no commas, quotes or CSS keyword such as inherit)';
  }
  return null;
}

/** True when the value is a valid family name ({@link projectFontFamilyError}). */
export function isProjectFontFamily(value: unknown): value is string {
  return projectFontFamilyError(value) === null;
}

/** True when the value is one of {@link FONT_WEIGHTS}. */
export function isFontWeight(value: unknown): value is number {
  return typeof value === 'number' && (FONT_WEIGHTS as readonly number[]).includes(value);
}

/** True when the value is one of {@link FONT_STYLES}. */
export function isProjectFontStyle(value: unknown): value is ProjectFontStyle {
  return typeof value === 'string' && (FONT_STYLES as readonly string[]).includes(value);
}

/** The size of a WOFF2 file's header, in bytes. */
export const WOFF2_HEADER_BYTES = 48;

/**
 * True when the bytes are a WOFF2 file, judged from the bytes alone (the name and declared type are
 * ignored): the `wOF2` signature, a whole header, and the header's total length equal to the size
 * of the file. A TrueType, OpenType or WOFF 1 file, an SVG or any other text fails.
 */
export function isWoff2(data: Uint8Array): boolean {
  return isWoff2Header(data, data.length);
}

/**
 * {@link isWoff2} from the start of a file (at least its header) and the file's size, so a browser
 * can check a picked file without reading all of it.
 */
export function isWoff2Header(head: Uint8Array, size: number): boolean {
  if (head.length < WOFF2_HEADER_BYTES || size < WOFF2_HEADER_BYTES) return false;
  if (head[0] !== 0x77 || head[1] !== 0x4f || head[2] !== 0x46 || head[3] !== 0x32) return false;
  const length = ((head[8] << 24) | (head[9] << 16) | (head[10] << 8) | head[11]) >>> 0;
  return length === size;
}

const FONT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a font id: a UUID. */
export function isFontId(value: unknown): value is string {
  return typeof value === 'string' && FONT_ID.test(value);
}

/** The start of every alias a project font is registered under. */
export const PROJECT_FONT_ALIAS_PREFIX = 'taleart-font-';

/**
 * The internal family name a project font is registered and drawn under: `taleart-font-<id>`, from
 * its id (lower-case hex and hyphens), never from the family name people typed. Null for a value
 * that is not a font id.
 */
export function projectFontAlias(fontId: unknown): string | null {
  return isFontId(fontId) ? `${PROJECT_FONT_ALIAS_PREFIX}${fontId.toLowerCase()}` : null;
}

/**
 * The text weight closest to a face's weight, which a text takes when it picks the face, so the
 * browser draws the face rather than a synthesised one: up to 400 regular, 500 medium, from 600 bold.
 */
export function textWeightForFont(weight: number): TextWeight {
  if (weight >= 600) return 'bold';
  return weight === 500 ? 'medium' : 'regular';
}

/** A project font reference in a document: the font's id (lower case) and the JSON pointer of its field. */
export interface ProjectFontRef {
  fontId: string;
  pointer: string;
}

/**
 * The project fonts a document's text elements use, in element order, with the JSON pointer of each
 * `fontId`. With `visibleOnly`, hidden elements (which are not delivered) are left out.
 */
export function projectFontRefs(doc: unknown, options: { visibleOnly?: boolean } = {}): ProjectFontRef[] {
  const elements = (doc as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const refs: ProjectFontRef[] = [];
  elements.forEach((element, i) => {
    const e = element as {
      type?: unknown;
      hidden?: unknown;
      props?: { font?: { source?: unknown; fontId?: unknown } };
    };
    if (e?.type !== 'text' || (options.visibleOnly && e.hidden === true)) return;
    const font = e.props?.font;
    if (font?.source === 'project' && isFontId(font.fontId)) {
      refs.push({ fontId: font.fontId.toLowerCase(), pointer: `/elements/${i}/props/font/fontId` });
    }
  });
  return refs;
}

/** The distinct project font ids a document's text elements use ({@link projectFontRefs}). */
export function projectFontIds(doc: unknown, options: { visibleOnly?: boolean } = {}): string[] {
  return [...new Set(projectFontRefs(doc, options).map((ref) => ref.fontId))];
}

/** How long a font may take to fetch and decode before the text keeps its fallback stack (R18). */
export const FONT_LOAD_TIMEOUT_MS = 3000;

/** One face to load: its id (which names its alias), where its bytes are, and its descriptors. */
export interface ProjectFontFace {
  id: string;
  url: string;
  weight: number;
  style: ProjectFontStyle;
}

/** The face object the loader makes: the browser's `FontFace`, or a test's stand-in. */
export interface LoadableFontFace {
  load(): Promise<unknown>;
}

/** What the loader needs from its environment; the browser's globals by default. */
export interface FontLoadEnvironment {
  fetch(
    url: string,
    init: { signal?: AbortSignal; credentials: 'omit' | 'same-origin'; mode: 'cors' | 'same-origin' },
  ): Promise<{
    ok: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
  FontFace: new (
    family: string,
    source: ArrayBuffer,
    descriptors: { weight: string; style: string },
  ) => LoadableFontFace;
  fonts: { add(face: LoadableFontFace): unknown };
}

/** How a face is loaded. */
export interface FontLoadOptions {
  /** `same-origin` sends the dashboard's session (Tale Studio); `omit`, the default, sends nothing (the SDK). */
  credentials?: 'omit' | 'same-origin';
  /** Defaults to {@link FONT_LOAD_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Defaults to the browser's `fetch`, `FontFace` and `document.fonts`. */
  env?: FontLoadEnvironment;
}

// Faces asked for on this page, by alias and URL: each is fetched once. A failed one is forgotten,
// so the next opening of a tale that uses it tries again.
const loads = new Map<string, Promise<boolean>>();

function browserEnvironment(): FontLoadEnvironment | null {
  const g = globalThis as unknown as {
    fetch?: FontLoadEnvironment['fetch'];
    FontFace?: FontLoadEnvironment['FontFace'];
    document?: { fonts?: FontLoadEnvironment['fonts'] };
  };
  if (typeof g.fetch !== 'function' || typeof g.FontFace !== 'function' || !g.document?.fonts) return null;
  return { fetch: g.fetch.bind(globalThis), FontFace: g.FontFace, fonts: g.document.fonts };
}

/**
 * Loads a project font face (R18, AD-16): fetches its bytes, checks they are WOFF2, makes
 * `new FontFace(alias, bytes, { weight, style })` under its internal alias ({@link projectFontAlias})
 * and adds it to `document.fonts`. No CSS text (`@font-face`, `url()`) is ever built. Text drawn as
 * `"<alias>", <fallback stack>` shows its fallback until the face is added, then swaps. A face that
 * fails, or is not ready within {@link FONT_LOAD_TIMEOUT_MS}, is never added, so the fallback stays.
 * Each face is fetched at most once per page while it loads or after it loaded. Resolves true when
 * the face was added; never rejects.
 */
export function loadProjectFont(face: ProjectFontFace, options: FontLoadOptions = {}): Promise<boolean> {
  const alias = projectFontAlias(face.id);
  if (alias === null) return Promise.resolve(false);
  const key = `${alias} ${face.url}`;
  const known = loads.get(key);
  if (known) return known;
  const loading = load(alias, face, options).then((added) => {
    if (!added) loads.delete(key);
    return added;
  });
  loads.set(key, loading);
  return loading;
}

/** Forgets which faces this page loaded (for tests). */
export function clearProjectFontLoads(): void {
  loads.clear();
}

async function load(alias: string, face: ProjectFontFace, options: FontLoadOptions): Promise<boolean> {
  const env = options.env ?? browserEnvironment();
  if (env === null) return false;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((done) => {
    timer = setTimeout(() => {
      controller?.abort();
      done(null);
    }, options.timeoutMs ?? FONT_LOAD_TIMEOUT_MS);
  });
  const fetched = (async (): Promise<LoadableFontFace | null> => {
    const credentials = options.credentials ?? 'omit';
    const res = await env.fetch(face.url, {
      signal: controller?.signal,
      credentials,
      mode: credentials === 'omit' ? 'cors' : 'same-origin',
    });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (!isWoff2(new Uint8Array(bytes))) return null;
    const loaded = new env.FontFace(alias, bytes, { weight: String(face.weight), style: face.style });
    await loaded.load();
    return loaded;
  })().catch(() => null);
  const ready = await Promise.race([fetched, timedOut]);
  clearTimeout(timer);
  if (ready === null) return false;
  env.fonts.add(ready);
  return true;
}
