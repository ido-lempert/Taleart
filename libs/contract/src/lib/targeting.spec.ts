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

  it('covers every case R2 names', () => {
    const names = table.cases.map((c) => c.name);
    for (const part of [
      'no group tags',
      'no setTags call',
      'Any, one of two',
      'Any, none',
      'Any, all',
      'All, one missing',
      'All, all present',
      'case',
      'spaces',
    ]) {
      expect(names.some((name) => name.includes(part))).toBe(true);
    }
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
