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

describe('audience summary with user lists (epic targeting R7, story 5.4)', () => {
  const lists = (...entries: [string, number][]) => entries.map(([name, idCount], i) => ({ id: `l${i}`, name, idCount }));

  it('names a group targeted to user lists, with their ID counts', () => {
    const one = { tags: [], userLists: lists(['Loyal', 1204]) };
    expect(isTargeted(one)).toBe(true);
    expect(audienceSummary(one)).toBe('user list Loyal (1,204)');
    expect(withAudience(VISIBLE_ON_SITE_TEXT, audienceSummary(one))).toBe('Visible on site · for user list Loyal (1,204)');
    expect(audienceSummary({ userLists: lists(['Loyal', 1204], ['VIP', 30]) })).toBe('user lists Loyal (1,204) or VIP (30)');
    expect(audienceSummary({ userLists: lists(['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 1_000_000]) })).toBe(
      'user lists a (1), b (2), c (3) or 2 more',
    );
  });

  it('puts tags and lists together: the tag rule narrows the lists', () => {
    expect(audienceSummary({ tags: tags('summer', 'vip'), userLists: lists(['Loyal', 1204]) })).toBe(
      'viewers tagged summer or vip in user list Loyal (1,204)',
    );
    expect(audienceDetail({ tags: tags('summer'), userLists: lists(['Loyal', 1]) })).toEqual([
      'Shown to viewers whose external user ID is in the user list Loyal (1 ID).',
      'Of those, to viewers tagged summer.',
      'A page that passes no tags shows it to every viewer in its lists.',
      'A page that sets no external user ID does not show it.',
    ]);
    expect(audienceDetail({ userLists: lists(['Loyal', 1204], ['VIP', 30]) })).toEqual([
      'Shown to viewers whose external user ID is in any of the user lists Loyal (1,204 IDs) or VIP (30 IDs).',
      'A page that sets no external user ID does not show it.',
    ]);
  });

  it('ignores lists with no name', () => {
    expect(isTargeted({ userLists: [{ name: ' ', idCount: 3 }] })).toBe(false);
    expect(audienceSummary({ userLists: null })).toBeNull();
  });
});
