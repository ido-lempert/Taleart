/**
 * The docs' search, without a library: the index (search-index.json, built by scripts/build-search-index.mjs),
 * a scoring function, and the text split for highlighting and for the snippet. Pure functions, so the browser
 * and the unit tests use the same code.
 */

/** A docs page in the index: its route (`p`, '' for the home page), title (`t`) and navigation group (`g`). */
export interface SearchPage {
  p: string;
  t: string;
  g: string;
}

/** A section of a page: from an h2 or h3 with an id (`a`), or the intro (`a` is ''). `h` is its heading, `x` its text. */
export interface SearchSection {
  i: number;
  a: string;
  h: string;
  x: string;
}

/** The index file: format version 1, the pages, and their sections. */
export interface SearchIndex {
  v: 1;
  pages: SearchPage[];
  s: SearchSection[];
}

/** A piece of a text: `mark` is true for a word that matches the query (shown with <mark>). */
export interface Segment {
  text: string;
  mark: boolean;
}

/** The score of a section that matches; `hit.score` orders the results. */
export interface Hit {
  page: SearchPage;
  section: SearchSection;
  /** The section's place in the index, the tie-break that keeps the page order. */
  order: number;
  score: number;
}

/** The searched text, prepared once per index: folded (lower case, no accents) and split into words. */
interface Prepared {
  page: SearchPage;
  section: SearchSection;
  order: number;
  title: string[];
  heading: string[];
  body: string[];
}

export interface PreparedIndex {
  index: SearchIndex;
  docs: Prepared[];
}

/** The most results shown at once. */
export const MAX_HITS = 50;
/** The length of a result's text snippet, in characters. */
export const SNIPPET_LENGTH = 160;

/** The points for a term in each field: a word that starts with the term counts more than one that contains it. */
const POINTS = {
  titleStart: 30,
  titleInside: 15,
  headingStart: 20,
  headingInside: 10,
  bodyStart: 3,
  bodyInside: 1,
} as const;

const WORD = /[\p{L}\p{N}]+/gu;

/** Lower case, without accents, so "Schluessel" and "schlüssel" and "Été" and "ete" match alike. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** The words of a query, folded and without repeats. A query of punctuation only has no terms. */
export function queryTerms(query: string): string[] {
  return [...new Set(fold(query).match(WORD) ?? [])];
}

/** The best points a term earns in one field (its words), or 0 when no word matches it. */
function fieldPoints(words: readonly string[], term: string, start: number, inside: number): number {
  if (words.some((word) => word.startsWith(term))) return start;
  // A term of one letter would match nearly every word, so only longer terms match inside a word.
  if (term.length >= 2 && words.some((word) => word.includes(term))) return inside;
  return 0;
}

/** Prepares the index's pages and sections for searching; done once after the file loads. */
export function prepareIndex(index: SearchIndex): PreparedIndex {
  const words = (text: string) => fold(text).match(WORD) ?? [];
  const docs: Prepared[] = index.s.map((section, order) => {
    const page = index.pages[section.i];
    return {
      page,
      section,
      order,
      title: words(page.t),
      heading: words(section.h),
      body: words(section.x),
    };
  });
  return { index, docs };
}

/**
 * The score of a section for the query's terms, or 0 when a term matches nowhere in it (a result has every
 * term). A term earns the best of its fields: the page title, then the section heading, then the text.
 */
export function scoreSection(doc: Omit<Prepared, 'order' | 'section' | 'page'>, terms: readonly string[]): number {
  let total = 0;
  for (const term of terms) {
    const points = Math.max(
      fieldPoints(doc.title, term, POINTS.titleStart, POINTS.titleInside),
      fieldPoints(doc.heading, term, POINTS.headingStart, POINTS.headingInside),
      fieldPoints(doc.body, term, POINTS.bodyStart, POINTS.bodyInside),
    );
    if (points === 0) return 0;
    total += points;
  }
  return total;
}

/** The sections that match every term, best first (ties keep the index's order), at most `limit`. */
export function search(prepared: PreparedIndex, query: string, limit = MAX_HITS): Hit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: Hit[] = [];
  for (const doc of prepared.docs) {
    const score = scoreSection(doc, terms);
    if (score > 0) hits.push({ page: doc.page, section: doc.section, order: doc.order, score });
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, limit);
}

/** Whether a word of the text (already folded) matches one of the terms: the same rule the scoring uses. */
export function wordMatches(folded: string, terms: readonly string[]): boolean {
  return terms.some((term) => folded.startsWith(term) || (term.length >= 2 && folded.includes(term)));
}

/** The text split into segments, the matching words marked. The text itself is never parsed as markup. */
export function segments(text: string, terms: readonly string[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    if (!wordMatches(fold(match[0]), terms)) continue;
    if (start > last) out.push({ text: text.slice(last, start), mark: false });
    out.push({ text: match[0], mark: true });
    last = start + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}

/**
 * A snippet of about SNIPPET_LENGTH characters of the text, from a few words before the first match (or the
 * start), cut at word boundaries and marked with an ellipsis where it is cut. Its matches are marked.
 */
export function snippet(text: string, terms: readonly string[]): Segment[] {
  if (text.length <= SNIPPET_LENGTH) return segments(text, terms);
  let first = -1;
  for (const match of text.matchAll(WORD)) {
    if (wordMatches(fold(match[0]), terms)) {
      first = match.index ?? 0;
      break;
    }
  }
  let start = first < 0 ? 0 : Math.max(0, first - 50);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space - start < 24) start = space + 1;
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + SNIPPET_LENGTH / 2) end = space;
  }
  const body = text.slice(start, end).trim();
  const lead = start > 0 ? '… ' : '';
  const tail = end < text.length ? ' …' : '';
  return segments(lead + body + tail, terms);
}
