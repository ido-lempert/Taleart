import { MAX_HITS, prepareIndex, queryTerms, search, SearchIndex, segments, SNIPPET_LENGTH, snippet } from './search';

/** A small index: a title match, a heading match and a text match for "zone", and a page for each case. */
const FIXTURE: SearchIndex = {
  v: 1,
  pages: [
    { p: 'zones', t: 'Zones and displays', g: 'Campaigns' },
    { p: 'concepts', t: 'Concepts', g: 'Introduction' },
    { p: 'install', t: 'Install a zone', g: 'Installation' },
    { p: 'cafe', t: 'Café menu', g: 'Reference' },
  ],
  s: [
    { i: 1, a: '', h: 'Concepts', x: 'The words the dashboard uses. A zone is one spot on a page.' },
    { i: 1, a: 'glossary', h: 'Glossary', x: 'Project, zone, display, template.' },
    { i: 0, a: 'displays', h: 'Displays', x: 'A display is how a zone looks.' },
    { i: 2, a: 'key', h: 'Zone key', x: 'Copy the key from the Install tab.' },
    { i: 2, a: 'script', h: 'Script tag', x: 'Put the script once per page.' },
    { i: 3, a: 'espresso', h: 'Espresso', x: 'Served all day, a crema on top.' },
  ],
};

describe('search: terms and folding', () => {
  it('folds case and accents, and splits words', () => {
    expect(queryTerms('Café, ZONE-key')).toEqual(['cafe', 'zone', 'key']);
    expect(queryTerms('  ')).toEqual([]);
    expect(queryTerms('...')).toEqual([]);
  });

  it('keeps each term once', () => {
    expect(queryTerms('zone zone Zone')).toEqual(['zone']);
  });
});

describe('search: scoring', () => {
  const prepared = prepareIndex(FIXTURE);

  it('ranks a title match above a heading match above a text match', () => {
    const ranked: SearchIndex = {
      v: 1,
      pages: [
        { p: 'a', t: 'Alpha', g: 'G' },
        { p: 'b', t: 'Delta', g: 'G' },
        { p: 'c', t: 'Beta guide', g: 'G' },
      ],
      s: [
        { i: 1, a: '', h: 'Delta', x: 'beta here' },
        { i: 0, a: 'heading', h: 'Beta heading', x: 'nothing' },
        { i: 2, a: '', h: 'Overview', x: 'text' },
        { i: 1, a: 'other', h: 'Other', x: 'beta' },
      ],
    };
    const hits = search(prepareIndex(ranked), 'beta');
    expect(hits.map((hit) => hit.section.h)).toEqual(['Overview', 'Beta heading', 'Delta', 'Other']);
  });

  it('puts every section of a page whose title matches first', () => {
    const hits = search(prepared, 'install');
    expect(hits.map((hit) => hit.page.t)).toEqual(['Install a zone', 'Install a zone']);
  });

  it('requires every term, each in some field of the section', () => {
    expect(search(prepared, 'zone espresso')).toEqual([]);
    expect(search(prepared, 'zone key').map((hit) => hit.section.a)).toEqual(['key']);
  });

  it('matches word starts, and words inside a word only for terms of two letters or more', () => {
    // "disp" starts the heading "Displays" and the word "display" of the glossary's text.
    expect(search(prepared, 'disp').map((hit) => hit.section.a)).toEqual(['displays', 'glossary']);
    // "play" is inside "display" only: the text match.
    expect(search(prepared, 'play').map((hit) => hit.section.a)).toEqual(['displays', 'glossary']);
    // One letter matches word starts only: every hit has a word that starts with it.
    const starts = (hit: (typeof prepared.docs)[number]) =>
      [hit.title, hit.heading, hit.body].some((words) => words.some((word) => word.startsWith('z')));
    const hits = search(prepared, 'z');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(starts(prepared.docs[hit.order])).toBe(true);
  });

  it('ignores case and accents', () => {
    expect(search(prepared, 'CAFE').map((hit) => hit.page.t)).toEqual(['Café menu']);
    expect(search(prepared, 'café').map((hit) => hit.page.t)).toEqual(['Café menu']);
    expect(search(prepared, 'espresso').length).toBe(1);
  });

  it('returns nothing for an empty or punctuation-only query', () => {
    expect(search(prepared, '')).toEqual([]);
    expect(search(prepared, '?!')).toEqual([]);
  });

  it('keeps the index order for equal scores, and stops at the limit', () => {
    const many: SearchIndex = {
      v: 1,
      pages: [{ p: 'a', t: 'A', g: 'G' }],
      s: Array.from({ length: MAX_HITS + 5 }, (_, n) => ({ i: 0, a: `s${n}`, h: 'Heading', x: 'same words' })),
    };
    const hits = search(prepareIndex(many), 'heading');
    expect(hits.length).toBe(MAX_HITS);
    expect(hits.map((hit) => hit.section.a).slice(0, 3)).toEqual(['s0', 's1', 's2']);
  });
});

describe('search: highlighting and snippets', () => {
  it('marks the matching words only, keeping the rest of the text', () => {
    expect(segments('The zone key, then zones.', ['zone'])).toEqual([
      { text: 'The ', mark: false },
      { text: 'zone', mark: true },
      { text: ' key, then ', mark: false },
      { text: 'zones', mark: true },
      { text: '.', mark: false },
    ]);
  });

  it('marks accented matches for an unaccented term', () => {
    expect(segments('Café', ['cafe'])).toEqual([{ text: 'Café', mark: true }]);
  });

  it('never reads the text as markup', () => {
    const parts = segments('<b>zone</b>', ['zone']);
    expect(parts.map((part) => part.text).join('')).toBe('<b>zone</b>');
  });

  it('makes a snippet of about the snippet length, around the first match, with ellipses where cut', () => {
    const body = `${'lorem ipsum dolor sit amet '.repeat(10)}the zone key is shown once ${'consectetur adipiscing elit '.repeat(10)}`;
    const parts = snippet(body, ['zone']);
    const text = parts.map((part) => part.text).join('');
    expect(text.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 4);
    expect(text.length).toBeGreaterThan(SNIPPET_LENGTH / 2);
    expect(text.startsWith('… ')).toBe(true);
    expect(text.endsWith(' …')).toBe(true);
    expect(parts.some((part) => part.mark && part.text === 'zone')).toBe(true);
  });

  it('returns a short text whole', () => {
    expect(snippet('A short text.', ['short'])).toEqual([
      { text: 'A ', mark: false },
      { text: 'short', mark: true },
      { text: ' text.', mark: false },
    ]);
  });
});
