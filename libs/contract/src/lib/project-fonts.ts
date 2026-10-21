// Project fonts (epic Tale Studio R4, R18; AD-15, AD-16; user decision 2026-10-21): the rules a
// font uploaded to a project follows, the internal alias it is drawn under, and the one loader the
// Web SDK and Tale Studio share, so both fetch and register a font the same way.
import { isFontFamily, RESERVED_FONT_PREFIX } from './theme';
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

/** The most font faces one project holds (a starting value, tuned by story 7.14). */
export const MAX_PROJECT_FONTS = 50;
/** The most bytes of font files one project holds: 10 MB (a starting value, tuned by story 7.14). */
export const MAX_PROJECT_FONT_BYTES = 10 * 1024 * 1024;

/**
 * A family name as it is stored and compared: without spaces at either end, and each run of
 * spaces inside it one space, so `Brand  Sans` and `Brand Sans` are the same family.
 */
export function normalizeFontFamily(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

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

/** The most tables a WOFF2 file may declare (real fonts have a few dozen). */
export const MAX_WOFF2_TABLES = 256;
/** The largest decoded font a WOFF2 file may declare (`totalSfntSize`): 30 MB. */
export const MAX_WOFF2_SFNT_BYTES = 30 * 1024 * 1024;

// The flavours a WOFF2 file may wrap: TrueType (0x00010000), CFF ('OTTO') and a collection ('ttcf').
const WOFF2_FLAVORS = [0x00010000, 0x4f54544f, 0x74746366];
const TTCF = 0x74746366;
// The known-tag indices of `glyf` and `loca`, whose transform versions read the other way round.
const GLYF = 10;
const LOCA = 11;

// Reads the WOFF2 header and directories (no decompression, no table data) and answers why they
// are not sound, or null. Every length and offset is checked against the file, so nothing points
// outside it.
function woff2StructureError(d: Uint8Array): string | null {
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (at: number) => view.getUint32(at);
  const u16 = (at: number) => view.getUint16(at);
  if (!WOFF2_FLAVORS.includes(u32(4))) return 'unknown flavour';
  const numTables = u16(12);
  if (numTables === 0 || numTables > MAX_WOFF2_TABLES) return 'table count out of range';
  if (u16(14) !== 0) return 'reserved field is not 0';
  const totalSfntSize = u32(16);
  if (totalSfntSize > MAX_WOFF2_SFNT_BYTES) return 'decoded size too large';
  const totalCompressedSize = u32(20);
  for (const [offset, length] of [
    [u32(28), u32(32)],
    [u32(40), u32(44)],
  ]) {
    if ((offset === 0) !== (length === 0) || offset + length > d.length) return 'metadata outside the file';
  }

  let at = WOFF2_HEADER_BYTES;
  const byte = () => {
    if (at >= d.length) throw new RangeError();
    return d[at++];
  };
  // UIntBase128: at most 5 bytes, no leading zero byte, at most 2^32 - 1.
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = byte();
      if (i === 0 && b === 0x80) throw new RangeError();
      if (value > 0x1ffffff) throw new RangeError();
      value = value * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    throw new RangeError();
  };
  // 255UInt16, for the collection directory.
  const uint255 = (): number => {
    const code = byte();
    if (code === 253) return (byte() << 8) | byte();
    if (code === 255) return byte() + 253;
    if (code === 254) return byte() + 506;
    return code;
  };
  try {
    let transformedSum = 0;
    for (let i = 0; i < numTables; i++) {
      const flags = byte();
      const tag = flags & 0x3f;
      if (tag === 0x3f) at += 4;
      const version = (flags >> 6) & 0x03;
      const origLength = base128();
      if (origLength > MAX_WOFF2_SFNT_BYTES) return 'table too large';
      // glyf and loca are transformed unless their version is 3; other tables only when it is not 0.
      const glyfOrLoca = tag === GLYF || tag === LOCA;
      const transformed = glyfOrLoca ? version !== 3 : version !== 0;
      // The defined transforms: glyf and loca version 0 (3 is none), hmtx (index 3) version 1.
      if (glyfOrLoca ? version === 1 || version === 2 : version !== 0 && !(tag === 3 && version === 1)) {
        return 'unknown table transform';
      }
      const length = transformed ? base128() : origLength;
      if (transformed && tag === LOCA && length !== 0) return 'loca transform length is not 0';
      transformedSum += length;
      if (transformedSum > MAX_WOFF2_SFNT_BYTES) return 'tables too large';
    }
    if (u32(4) === TTCF) {
      at += 4; // collection version
      const numFonts = uint255();
      if (numFonts === 0) return 'empty collection';
      for (let f = 0; f < numFonts; f++) {
        const tables = uint255();
        at += 4; // flavour
        for (let t = 0; t < tables; t++) if (uint255() >= numTables) return 'collection index out of range';
      }
    }
  } catch {
    return 'directory runs past the end of the file';
  }
  if (at + totalCompressedSize > d.length) return 'compressed data runs past the end of the file';
  return null;
}

/**
 * True when the bytes are a WOFF2 file, judged from the bytes alone (the name and declared type are
 * ignored): the `wOF2` signature, a whole header whose total length is the size of the file, a known
 * flavour (TrueType, CFF or a collection), a reserved field of 0, 1 to {@link MAX_WOFF2_TABLES}
 * tables, a declared decoded size of at most {@link MAX_WOFF2_SFNT_BYTES}, and a table directory
 * (and collection directory), metadata, private data and compressed data that all lie inside the
 * file. Nothing is decompressed or transcoded. A TrueType, OpenType or WOFF 1 file, an SVG or any
 * other text fails.
 */
export function isWoff2(data: Uint8Array): boolean {
  return isWoff2Header(data, data.length) && woff2StructureError(data) === null;
}

/**
 * The first checks of {@link isWoff2} (signature, whole header, total length equal to the file
 * size) from the start of a file and its size, so a browser can check a picked file without
 * reading all of it. The server checks the rest.
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
export const PROJECT_FONT_ALIAS_PREFIX = RESERVED_FONT_PREFIX;

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
  /** Tries a face that failed again at once, rather than after {@link FONT_RETRY_AFTER_MS}: an explicit retry. */
  retry?: boolean;
}

/** How long a face that failed is not fetched again on this page, unless a retry is asked for. */
export const FONT_RETRY_AFTER_MS = 60_000;

// Faces asked for on this page, by alias and URL: each is fetched once while it loads or after it
// loaded. A failed one is remembered with the time it failed, so the many renders of an editor do
// not fetch it again; it is tried again after FONT_RETRY_AFTER_MS, or at once on an explicit retry.
const loads = new Map<string, Promise<boolean>>();
const failures = new Map<string, number>();

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
 * Each face is fetched at most once per page while it loads or after it loaded; one that failed is
 * not fetched again for {@link FONT_RETRY_AFTER_MS} unless `retry` is set. Resolves true when the
 * face was added; never rejects.
 */
export function loadProjectFont(face: ProjectFontFace, options: FontLoadOptions = {}): Promise<boolean> {
  const alias = projectFontAlias(face.id);
  // Without a browser (server rendering, tests) nothing is loaded, and nothing is remembered as failed.
  const env = options.env ?? browserEnvironment();
  if (alias === null || env === null) return Promise.resolve(false);
  const key = `${alias} ${face.url}`;
  const known = loads.get(key);
  if (known) return known;
  const failedAt = failures.get(key);
  if (failedAt !== undefined && !options.retry && Date.now() - failedAt < FONT_RETRY_AFTER_MS) {
    return Promise.resolve(false);
  }
  failures.delete(key);
  const loading = load(alias, face, env, options).then((added) => {
    if (!added) {
      loads.delete(key);
      failures.set(key, Date.now());
    }
    return added;
  });
  loads.set(key, loading);
  return loading;
}

/** Forgets which faces this page loaded or failed to load (for tests). */
export function clearProjectFontLoads(): void {
  loads.clear();
  failures.clear();
}

async function load(
  alias: string,
  face: ProjectFontFace,
  env: FontLoadEnvironment,
  options: FontLoadOptions,
): Promise<boolean> {
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
