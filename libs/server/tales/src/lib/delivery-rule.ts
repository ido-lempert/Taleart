// The one rule for what the Delivery API delivers (AD-6, AD-15) and why content is not visible
// (epic UX rework R7). Each reason is one SQL clause; a tale or group is delivered exactly when
// none of its clauses holds (`deliveredTale`, `deliveredGroup`), and the Management API's
// indicator lists the clauses that hold (`taleReasonsSql`, `groupReasonsSql`). Both are built
// from the same clause lists below, so the indicator and the site cannot disagree.
import type { VisibilityReason, VisibilityReasonCode } from '@taleart/contract';

/** The tales migration step after which new tales start live (AD-6 amended 2026-10-23); see migration.ts. */
export const SHOWN_STATUS_STEP = 'shown-status';

// True for a tale, alias `t`, that has something published to deliver (AD-6 amended, AD-15): a
// published document, or, as before the UX rework:
// - media whose documents are not in step yet, which the Delivery API composes (R16) until the
//   media migration writes the published document; not for a tale with only a studio draft, whose
//   media alone was never what its person saw (media replaced while TALE_MEDIA_MIGRATION is off, or
//   a skipped merge): it waits for the draft to be published, as any tale "not updated yet";
// - created before the shown-status step (with no published document): such a tale showed its media
//   (composed by the Delivery API, also when its documents are in step but only a studio draft
//   exists) or the legacy placeholder, so it keeps showing it. A tale created since then is
//   delivered only once it has a published document, so a new tale with nothing published
//   ("not updated yet") is not.
// Null checks only: no document is read.
export function hasPublishedDocument(t: string): string {
  return (
    `(${t}.document IS NOT NULL ` +
    `OR (${t}.media_key IS NOT NULL AND ${t}.document_media_key IS DISTINCT FROM ${t}.media_key ` +
    `AND (${t}.document IS NOT NULL OR ${t}.draft_document IS NULL)) ` +
    // Until the step has run, every tale is from before it.
    `OR (${t}.created_at < COALESCE((SELECT applied_at FROM tales_migrations WHERE step = '${SHOWN_STATUS_STEP}'), ` +
    `'infinity'::timestamptz)))`
  );
}

/** One reason content is not visible, as an SQL clause on the row `t` at the time `param`. */
export interface ReasonClause {
  code: VisibilityReasonCode;
  subject: 'group' | 'tale';
  /** The condition; the reason holds when it IS TRUE (a null never holds). */
  when(t: string, param: string): string;
  /** The window bound the reason names (`starts-at`, `ended-at`). */
  at?(t: string): string;
}

// The stored keys a person sets with the switch, Archive and Restore; any other key was set by
// a process (AD-6). The status reasons below cover every key but `live`, so a row with none of
// its reasons is `live`.
const PERSON_KEYS = `('live', 'archived', 'draft', 'paused')`;

/** A tale's own reasons (R7): its stored key, its window, and whether it has anything published. */
export const TALE_REASON_CLAUSES: readonly ReasonClause[] = [
  { code: 'archived', subject: 'tale', when: (t) => `${t}.status = 'archived'` },
  { code: 'tale-hidden', subject: 'tale', when: (t) => `${t}.status IN ('draft', 'paused')` },
  { code: 'media-processing', subject: 'tale', when: (t) => `${t}.status = 'processing'` },
  // `invalid-media`, `quota-reached`, and any other key a process sets.
  {
    code: 'media-problem',
    subject: 'tale',
    when: (t) => `${t}.status NOT IN ${PERSON_KEYS} AND ${t}.status <> 'processing'`,
  },
  { code: 'not-updated-yet', subject: 'tale', when: (t) => `${hasPublishedDocument(t)} IS NOT TRUE` },
  { code: 'starts-at', subject: 'tale', when: (t, p) => `${t}.starts_at > ${p}`, at: (t) => `${t}.starts_at` },
  { code: 'ended-at', subject: 'tale', when: (t, p) => `${t}.ends_at <= ${p}`, at: (t) => `${t}.ends_at` },
];

/**
 * A tale group's reasons (R7): its stored key, its window, whether it is placed in a zone, and
 * whether it has a delivered tale. The zone's own setup (display, key) is added by the caller.
 */
export const GROUP_REASON_CLAUSES: readonly ReasonClause[] = [
  { code: 'archived', subject: 'group', when: (g) => `${g}.status = 'archived'` },
  { code: 'group-off', subject: 'group', when: (g) => `${g}.status IN ('draft', 'paused')` },
  // A key a process set, such as `processing` or `quota-reached`.
  { code: 'group-blocked', subject: 'group', when: (g) => `${g}.status NOT IN ${PERSON_KEYS}` },
  { code: 'starts-at', subject: 'group', when: (g, p) => `${g}.starts_at > ${p}`, at: (g) => `${g}.starts_at` },
  { code: 'ended-at', subject: 'group', when: (g, p) => `${g}.ends_at <= ${p}`, at: (g) => `${g}.ends_at` },
  {
    code: 'not-in-any-zone',
    subject: 'group',
    when: (g) => `NOT EXISTS (SELECT 1 FROM zone_tale_groups dz WHERE dz.tale_group_id = ${g}.id)`,
  },
  {
    code: 'no-shown-tales',
    subject: 'group',
    when: (g, p) =>
      `NOT EXISTS (SELECT 1 FROM tales dt WHERE dt.tale_group_id = ${g}.id AND ${deliveredTale('dt', p)})`,
  },
];

// True when no clause holds: the Delivery filter.
function noReason(clauses: readonly ReasonClause[], t: string, param: string): string {
  return `(${clauses.map((c) => `(${c.when(t, param)}) IS NOT TRUE`).join(' AND ')})`;
}

// The clauses that hold, as a jsonb array of `{ code, subject, at? }`: the indicator.
function reasonsSql(clauses: readonly ReasonClause[], t: string, param: string): string {
  const items = clauses.map((c) => {
    const fields = [`'code', '${c.code}'`, `'subject', '${c.subject}'`, ...(c.at ? [`'at', ${c.at(t)}`] : [])];
    return `CASE WHEN (${c.when(t, param)}) IS TRUE THEN jsonb_build_object(${fields.join(', ')}) END`;
  });
  return `to_jsonb(array_remove(ARRAY[${items.join(', ')}]::jsonb[], NULL))`;
}

/**
 * A tale the Delivery API delivers at $n, for the tales alias `t`, given that its group is
 * delivered: none of {@link TALE_REASON_CLAUSES} holds, so it is live in its window, with
 * something published (AD-6, AD-15).
 */
export function deliveredTale(t: string, param: string): string {
  return noReason(TALE_REASON_CLAUSES, t, param);
}

/**
 * A group the Delivery API delivers at $n, for the tale_groups alias `g`: none of
 * {@link GROUP_REASON_CLAUSES} holds, so it is live in its window, with a delivered tale, and
 * placed in a zone (AD-6, AD-14). The one rule for the Delivery list and the public cover, media
 * and font lookups.
 */
export function deliveredGroup(g: string, param: string): string {
  return noReason(GROUP_REASON_CLAUSES, g, param);
}

/** The reasons of {@link TALE_REASON_CLAUSES} that hold for the tale `t` at `param`, as a jsonb array. */
export function taleReasonsSql(t: string, param: string): string {
  return reasonsSql(TALE_REASON_CLAUSES, t, param);
}

/** The reasons of {@link GROUP_REASON_CLAUSES} that hold for the group `g` at `param`, as a jsonb array. */
export function groupReasonsSql(g: string, param: string): string {
  return reasonsSql(GROUP_REASON_CLAUSES, g, param);
}

/** Reasons as pg returns them from {@link taleReasonsSql} or {@link groupReasonsSql}, with `at` in ISO 8601 UTC. */
export function readReasons(value: unknown): VisibilityReason[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: { code: VisibilityReason['code']; subject: VisibilityReason['subject']; at?: string }) =>
    item.at ? { code: item.code, subject: item.subject, at: new Date(item.at).toISOString() } : { code: item.code, subject: item.subject },
  );
}
