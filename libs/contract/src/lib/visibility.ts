// "Visible on site" or "Not visible because…" (epic UX rework R7): the shapes, the order of the
// reasons and their plain words. The server computes every reason from the SQL clauses its
// Delivery filter is made of (`libs/server/tales`), so the indicator and the site cannot disagree.
import type { components } from '../generated/api';
import { visibilityReasonCodeValues, visibilityReasonSubjectValues } from '../generated/api';

type Schemas = components['schemas'];

export type Visibility = Schemas['Visibility'];
export type VisibilityReason = Schemas['VisibilityReason'];
export type VisibilityReasonCode = Schemas['VisibilityReasonCode'];
export type VisibilitySubject = VisibilityReason['subject'];

/** Every reason code, in the order a list of reasons shows them: the most useful to fix first. */
export const VISIBILITY_REASON_ORDER: readonly VisibilityReasonCode[] = [
  'archived',
  'group-blocked',
  'group-off',
  'not-in-any-zone',
  'tale-hidden',
  'media-processing',
  'media-problem',
  'not-updated-yet',
  'starts-at',
  'ended-at',
  'zone-no-display',
  'zone-not-installed',
  'no-tale-groups',
  'no-shown-tales',
  'audience-empty',
  'audience-removed',
  'no-visible-groups',
];

/** Every reason code, as the contract lists them. */
export const VISIBILITY_REASON_CODES: readonly VisibilityReasonCode[] = visibilityReasonCodeValues;

/** Every subject a reason can be about. */
export const VISIBILITY_SUBJECTS: readonly VisibilitySubject[] = visibilityReasonSubjectValues;

const SUBJECT_ORDER: Readonly<Record<VisibilitySubject, number>> = { zone: 0, group: 1, tale: 2 };

function reasonKey(reason: VisibilityReason): string {
  return `${reason.code}|${reason.subject}|${reason.at ?? ''}`;
}

/**
 * The reasons in {@link VISIBILITY_REASON_ORDER}, a group's before a tale's for the same code,
 * each once.
 */
export function sortReasons(reasons: readonly VisibilityReason[]): VisibilityReason[] {
  const unique = new Map<string, VisibilityReason>();
  for (const reason of reasons) if (!unique.has(reasonKey(reason))) unique.set(reasonKey(reason), reason);
  return [...unique.values()].sort(
    (a, b) =>
      VISIBILITY_REASON_ORDER.indexOf(a.code) - VISIBILITY_REASON_ORDER.indexOf(b.code) ||
      SUBJECT_ORDER[a.subject] - SUBJECT_ORDER[b.subject] ||
      (a.at ?? '').localeCompare(b.at ?? ''),
  );
}

/** Visible exactly when there is no reason; the reasons sorted, each once. */
export function visibilityOf(reasons: readonly VisibilityReason[]): Visibility {
  const sorted = sortReasons(reasons);
  return { visible: sorted.length === 0, reasons: sorted };
}

/**
 * A tale's own reasons with its group's (R7). A group's `no-shown-tales` is left out: it follows
 * from its tales' own reasons, so a tale with none of its own makes it false.
 */
export function taleContentReasons(
  taleReasons: readonly VisibilityReason[],
  groupReasons: readonly VisibilityReason[],
): VisibilityReason[] {
  return [...taleReasons, ...groupReasons.filter((reason) => reason.code !== 'no-shown-tales')];
}

/** What the indicator says when content is visible. */
export const VISIBLE_ON_SITE_TEXT = 'Visible on site';

/** What the indicator says before the first reason when content is not visible. */
export const NOT_VISIBLE_TEXT = 'Not visible';

/**
 * A reason in plain words (R7), such as "group is off" or "starts 1 Dec 2026, 09:00", as read on
 * content of kind `viewing`: a reason about the content itself does not name it ("archived"),
 * one about its group or zone does ("group is archived"). `formatTime` writes a window bound.
 */
export function visibilityReasonText(
  reason: VisibilityReason,
  viewing: VisibilitySubject,
  formatTime: (iso: string) => string = (iso) => iso,
): string {
  const own = reason.subject === viewing;
  const named = own ? '' : `${reason.subject} `;
  switch (reason.code) {
    case 'group-off':
      return 'group is off';
    case 'tale-hidden':
      return 'tale is hidden';
    case 'group-blocked':
      return 'group is blocked';
    case 'archived':
      return own ? 'archived' : `${reason.subject} is archived`;
    case 'no-shown-tales':
      return 'no shown tales';
    case 'no-visible-groups':
      return 'no visible tale group';
    case 'no-tale-groups':
      return 'no tale groups yet';
    case 'not-in-any-zone':
      return own ? 'not in any zone' : 'group is not in any zone';
    case 'starts-at':
      return `${named}starts ${reason.at ? formatTime(reason.at) : 'later'}`;
    case 'ended-at':
      return `${named}ended ${reason.at ? formatTime(reason.at) : ''}`.trimEnd();
    case 'zone-no-display':
      return 'zone has no display';
    case 'zone-not-installed':
      return 'zone not installed';
    case 'media-processing':
      return 'media still processing';
    case 'media-problem':
      return 'media problem';
    case 'not-updated-yet':
      return 'not updated yet';
    case 'audience-empty':
      return own ? 'its user lists are empty' : "group's user lists are empty";
    case 'audience-removed':
      return own ? 'its user lists were removed' : "group's user lists were removed";
  }
}

/**
 * The indicator's line (R7): "Visible on site", or "Not visible: " and the first reason in plain
 * words, such as "Not visible: group is off".
 */
export function visibilitySummary(
  visibility: Visibility,
  viewing: VisibilitySubject,
  formatTime?: (iso: string) => string,
): string {
  const [first] = visibility.reasons;
  if (visibility.visible || !first) return VISIBLE_ON_SITE_TEXT;
  return `${NOT_VISIBLE_TEXT}: ${visibilityReasonText(first, viewing, formatTime)}`;
}
