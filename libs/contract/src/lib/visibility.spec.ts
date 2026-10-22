import {
  NOT_VISIBLE_TEXT,
  sortReasons,
  taleContentReasons,
  VISIBILITY_REASON_CODES,
  VISIBILITY_REASON_ORDER,
  visibilityOf,
  visibilityReasonText,
  visibilitySummary,
  VISIBLE_ON_SITE_TEXT,
  type VisibilityReason,
} from './visibility';

const groupOff: VisibilityReason = { code: 'group-off', subject: 'group' };
const hidden: VisibilityReason = { code: 'tale-hidden', subject: 'tale' };
const noDisplay: VisibilityReason = { code: 'zone-no-display', subject: 'zone' };

describe('visibility (epic UX rework R7)', () => {
  it('orders every reason code the contract defines, each once', () => {
    expect([...VISIBILITY_REASON_ORDER].sort()).toEqual([...VISIBILITY_REASON_CODES].sort());
    expect(VISIBILITY_REASON_CODES).toHaveLength(15);
  });

  it('is visible exactly when there is no reason', () => {
    expect(visibilityOf([])).toEqual({ visible: true, reasons: [] });
    expect(visibilityOf([hidden])).toEqual({ visible: false, reasons: [hidden] });
  });

  it('sorts reasons most useful first, a group before a tale, each once', () => {
    const archivedTale: VisibilityReason = { code: 'archived', subject: 'tale' };
    const archivedGroup: VisibilityReason = { code: 'archived', subject: 'group' };
    expect(sortReasons([noDisplay, hidden, archivedTale, groupOff, archivedGroup, hidden])).toEqual([
      archivedGroup,
      archivedTale,
      groupOff,
      hidden,
      noDisplay,
    ]);
  });

  it("leaves a group's no-shown-tales out of a tale's reasons", () => {
    expect(taleContentReasons([hidden], [{ code: 'no-shown-tales', subject: 'group' }, groupOff])).toEqual([
      hidden,
      groupOff,
    ]);
  });

  it('words a zone with nothing visible apart from a zone with no tale group', () => {
    expect(visibilityReasonText({ code: 'no-visible-groups', subject: 'zone' }, 'zone')).toBe('no visible tale group');
    expect(visibilityReasonText({ code: 'no-tale-groups', subject: 'zone' }, 'zone')).toBe('no tale groups yet');
    expect(visibilityReasonText({ code: 'no-shown-tales', subject: 'group' }, 'group')).toBe('no shown tales');
  });

  describe('plain words', () => {
    const at = '2026-12-01T09:00:00.000Z';
    const time = (iso: string) => `T(${iso})`;

    it('has words for every code', () => {
      for (const code of VISIBILITY_REASON_CODES) {
        for (const subject of ['zone', 'group', 'tale'] as const) {
          expect(visibilityReasonText({ code, subject, at }, 'tale', time)).toMatch(/^[a-z]/);
        }
      }
    });

    it('names the subject only when it is not the content read', () => {
      expect(visibilityReasonText({ code: 'archived', subject: 'tale' }, 'tale')).toBe('archived');
      expect(visibilityReasonText({ code: 'archived', subject: 'group' }, 'tale')).toBe('group is archived');
      expect(visibilityReasonText({ code: 'starts-at', subject: 'tale', at }, 'tale', time)).toBe(`starts T(${at})`);
      expect(visibilityReasonText({ code: 'ended-at', subject: 'group', at }, 'tale', time)).toBe(
        `group ended T(${at})`,
      );
      expect(visibilityReasonText({ code: 'not-in-any-zone', subject: 'group' }, 'group')).toBe('not in any zone');
      expect(visibilityReasonText({ code: 'not-in-any-zone', subject: 'group' }, 'tale')).toBe(
        'group is not in any zone',
      );
    });

    it('summarises with the first reason', () => {
      expect(visibilitySummary({ visible: true, reasons: [] }, 'zone')).toBe(VISIBLE_ON_SITE_TEXT);
      expect(visibilitySummary(visibilityOf([noDisplay, groupOff]), 'group')).toBe(
        `${NOT_VISIBLE_TEXT}: group is off`,
      );
    });
  });
});
