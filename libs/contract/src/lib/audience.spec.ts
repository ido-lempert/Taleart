import { audienceDetail, audienceSummary, isTargeted, withAudience } from './audience';
import { VISIBLE_ON_SITE_TEXT } from './visibility';

const tags = (...names: string[]) => names.map((name, i) => ({ id: `t${i}`, name }));

describe('audience summary (epic targeting R7)', () => {
  it('says nothing for a group with no tags: every viewer sees it', () => {
    for (const group of [{ tags: [] }, { tags: null }, {}, { tags: tags(' ') }]) {
      expect(isTargeted(group)).toBe(false);
      expect(audienceSummary(group)).toBeNull();
      expect(audienceDetail(group)).toEqual([]);
      expect(withAudience(VISIBLE_ON_SITE_TEXT, audienceSummary(group))).toBe('Visible on site');
    }
  });

  it('joins the tags with "or" for Any (the default) and "and" for All', () => {
    expect(audienceSummary({ tags: tags('summer', 'vip'), tagMatch: 'any' })).toBe('viewers tagged summer or vip');
    expect(audienceSummary({ tags: tags('summer', 'vip'), tagMatch: 'all' })).toBe('viewers tagged summer and vip');
    expect(audienceSummary({ tags: tags('summer', 'vip') })).toBe('viewers tagged summer or vip');
    expect(audienceSummary({ tags: ['summer', 'vip'], tagMatch: 'bogus' })).toBe('viewers tagged summer or vip');
    expect(audienceSummary({ tags: tags('summer'), tagMatch: 'all' })).toBe('viewers tagged summer');
    expect(audienceSummary({ tags: tags('a', 'b', 'c'), tagMatch: 'all' })).toBe('viewers tagged a, b and c');
    expect(withAudience(VISIBLE_ON_SITE_TEXT, audienceSummary({ tags: tags('summer', 'vip') }))).toBe(
      'Visible on site · for viewers tagged summer or vip',
    );
  });

  it('names at most three tags, then how many more', () => {
    const many = tags('a', 'b', 'c', 'd', 'e');
    expect(audienceSummary({ tags: many })).toBe('viewers tagged a, b, c or 2 more');
    expect(audienceSummary({ tags: many, tagMatch: 'all' })).toBe('viewers tagged a, b, c and 2 more');
    expect(audienceSummary({ tags: many }, 1)).toBe('viewers tagged a or 4 more');
    expect(audienceSummary({ tags: tags('a', 'b', 'c', 'd') })).toBe('viewers tagged a, b, c or 1 more');
  });

  it('names every tag in the detail, and what a page with no tags shows', () => {
    const many = tags('a', 'b', 'c', 'd', 'e');
    expect(audienceDetail({ tags: many, tagMatch: 'all' })).toEqual([
      'Shown to viewers tagged with all of a, b, c, d and e.',
      'A page that passes no tags shows it to every viewer.',
    ]);
    expect(audienceDetail({ tags: tags('summer', 'vip') })[0]).toBe('Shown to viewers tagged with any of summer or vip.');
    expect(audienceDetail({ tags: tags('summer') })[0]).toBe('Shown to viewers tagged summer.');
  });
});
