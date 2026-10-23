import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tagMatchValues } from '../generated/api';
import { DEFAULT_TAG_MATCH, isTagMatch, TAG_MATCHES, tagRulePasses, viewerTagSet } from './targeting';

interface TagRuleCase {
  name: string;
  groupTags: string[];
  tagMatch: string;
  viewerTags: string[] | null;
  passes: boolean;
}

const table = JSON.parse(readFileSync(join(__dirname, '../../targeting/tag-rule.cases.json'), 'utf8')) as {
  cases: TagRuleCase[];
};

describe('the tag rule (epic targeting R2)', () => {
  it.each(table.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(tagRulePasses({ tags: c.groupTags, tagMatch: c.tagMatch }, c.viewerTags)).toBe(c.passes);
    // The same answer from the viewer's tags read once, as the SDK keeps them.
    expect(tagRulePasses({ tags: c.groupTags, tagMatch: c.tagMatch }, viewerTagSet(c.viewerTags))).toBe(c.passes);
  });

  // R2's cases with the answer each must hold, so the table cannot drift to the wrong expectation:
  // a case named here must exist with exactly this result.
  it.each([
    ['no group tags, viewer tags', true],
    ['no group tags with All, viewer tags', true],
    ['Any, no setTags call', true],
    ['All, no setTags call', true],
    ['Any, empty viewer tags', true],
    ['Any, one of two matching', true],
    ['Any, none matching', false],
    ['Any, all matching', true],
    ['All, one missing', false],
    ['All, all present', true],
    ['Any, case differs', true],
    ['Any, surrounding spaces', true],
    ['All, case and spaces differ', true],
    ['non-ASCII: accented letters match ignoring case', true],
    ['non-ASCII: accents are not folded away', false],
    ['non-ASCII: NFD viewer tag matches an NFC group tag', true],
    ['non-ASCII: NFC viewer tag matches an NFD group tag under All', true],
    ['non-ASCII: Turkish dotted capital I is not plain i', false],
    ['non-ASCII: Turkish dotted capital I matches itself in any case', true],
  ] as const)('the table holds "%s" with passes %s', (name, passes) => {
    const found = table.cases.filter((c) => c.name === name);
    expect(found).toHaveLength(1);
    expect(found[0].passes).toBe(passes);
    expect(tagRulePasses({ tags: found[0].groupTags, tagMatch: found[0].tagMatch }, found[0].viewerTags)).toBe(passes);
  });

  it('compares composed and decomposed letters alike, without Turkish or accent rules', () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(composed).not.toBe(decomposed);
    expect(tagRulePasses({ tags: [composed], tagMatch: 'any' }, [decomposed])).toBe(true);
    expect(tagRulePasses({ tags: ['İstanbul'], tagMatch: 'any' }, ['istanbul'])).toBe(false);
    expect(tagRulePasses({ tags: ['café'], tagMatch: 'any' }, ['cafe'])).toBe(false);
  });

  it('shows the sample page matrix: A {summer} Any, B {summer, vip} All, C {vip} Any, D untagged', () => {
    const groups = [
      { id: 'A', tags: ['summer'], tagMatch: 'any' },
      { id: 'B', tags: ['summer', 'vip'], tagMatch: 'all' },
      { id: 'C', tags: ['vip'], tagMatch: 'any' },
      { id: 'D', tags: [], tagMatch: 'any' },
    ];
    const shown = (viewer: string[] | null) => groups.filter((g) => tagRulePasses(g, viewer)).map((g) => g.id);
    expect(shown(null)).toEqual(['A', 'B', 'C', 'D']);
    expect(shown(['summer'])).toEqual(['A', 'D']);
    expect(shown(['SUMMER ', 'vip'])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ignores group tags and viewer tags that are not text', () => {
    expect(tagRulePasses({ tags: ['summer'], tagMatch: 'any' }, [42, null, 'summer'])).toBe(true);
    expect(tagRulePasses({ tags: ['summer'], tagMatch: 'any' }, [42, null])).toBe(true);
    expect(tagRulePasses({ tags: null, tagMatch: 'all' }, ['vip'])).toBe(true);
    expect(tagRulePasses({}, ['vip'])).toBe(true);
  });

  it('names the match modes the OpenAPI document defines, Any first and by default', () => {
    expect([...TAG_MATCHES].sort()).toEqual([...tagMatchValues].sort());
    expect(TAG_MATCHES[0]).toBe(DEFAULT_TAG_MATCH);
    expect(DEFAULT_TAG_MATCH).toBe('any');
    expect(isTagMatch('all')).toBe(true);
    expect(isTagMatch('ALL')).toBe(false);
  });
});
