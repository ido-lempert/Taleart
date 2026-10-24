// The one rule for what the Delivery API delivers and the public media, cover and font routes
// serve (AD-6, AD-11, AD-15), and why content is not visible (epic UX rework R7). Each reason is
// one SQL clause. Content is delivered exactly when none of its clauses holds (`deliveredTale`,
// `deliveredGroup`, `deliveredPlacement`, `zoneDelivers`); the Management API's indicator lists the
// clauses that hold (`taleReasonsSql`, `groupReasonsSql`, `zoneReasonsSql`). Both are built from
// the clause lists below, so the indicator and the site cannot disagree.
import type { VisibilityReason, VisibilityReasonCode, VisibilitySubject } from '@taleart/contract';
import { zoneInstalledSql } from '@taleart/server-access';
import { zoneHasDisplaySql, zoneProjectIdSql } from '@taleart/server-zones';

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

/** One reason content is not visible, as an SQL clause on the row (or zone id) `t` at the time `param`. */
export interface ReasonClause {
  /** The reason it gives; a clause with `reasons` gives those instead. */
  code?: VisibilityReasonCode;
  subject?: VisibilitySubject;
  /** The condition; the clause holds when it IS TRUE (a null never holds). */
  when(t: string, param: string): string;
  /** The window bound the reason names (`starts-at`, `ended-at`). */
  at?(t: string): string;
  /** The reasons it gives while it holds, as a jsonb array, when they are not one fixed code. */
  reasons?(t: string, param: string): string;
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
 * What a zone needs before the site shows anything in it (R7), on a zone id expression: a display
 * (its frame, AD-17) and an installed key (an active site key of its project; epic UX rework R3).
 */
export const ZONE_SETUP_CLAUSES: readonly ReasonClause[] = [
  { code: 'zone-no-display', subject: 'zone', when: (z) => `NOT ${zoneHasDisplaySql(z)}` },
  { code: 'zone-not-installed', subject: 'zone', when: (z) => `NOT ${zoneInstalledSql(zoneProjectIdSql(z))}` },
];

/**
 * A tale group's own reasons (R7), wherever it is placed: its stored key, its window, whether it
 * is placed in a zone, and whether it has a delivered tale.
 */
export const GROUP_OWN_REASON_CLAUSES: readonly ReasonClause[] = [
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
  // No viewer can match (epic targeting R7): the group is targeted to user lists and none of them
  // holds an ID. Targeting is otherwise not a reason: who sees a delivered group is the Delivery
  // API's per-viewer match, apart from this rule. The tables are the targeting module's (which
  // depends on this module, so it cannot hand this clause in); story 7 adds "and no segment".
  {
    code: 'audience-empty',
    subject: 'group',
    when: (g) =>
      `EXISTS (SELECT 1 FROM tale_group_user_lists ae WHERE ae.tale_group_id = ${g}.id) ` +
      `AND NOT EXISTS (SELECT 1 FROM tale_group_user_lists ae JOIN user_lists al ON al.id = ae.user_list_id ` +
      `WHERE ae.tale_group_id = ${g}.id AND al.id_count > 0)`,
  },
  // The group's user lists were taken away without a person choosing a new audience (the targeting
  // module's hold: its last list deleted, or a copy to another project): hidden until its Audience
  // is saved, so it never turns public by accident.
  {
    code: 'audience-removed',
    subject: 'group',
    when: (g) => `EXISTS (SELECT 1 FROM tale_group_audience_holds ah WHERE ah.tale_group_id = ${g}.id)`,
  },
];

/**
 * A tale group's reasons read for any zone (R7): its own, and, when it is placed but none of its
 * zones is set up, every one of its zones' setup reasons. The public routes serve its media only
 * while none holds.
 */
export const GROUP_REASON_CLAUSES: readonly ReasonClause[] = [
  ...GROUP_OWN_REASON_CLAUSES,
  {
    when: (g) =>
      `EXISTS (SELECT 1 FROM zone_tale_groups dz WHERE dz.tale_group_id = ${g}.id) ` +
      `AND NOT EXISTS (SELECT 1 FROM zone_tale_groups dz WHERE dz.tale_group_id = ${g}.id ` +
      `AND ${zoneSetUp('dz.zone_id')})`,
    reasons: (g, p) =>
      `COALESCE((SELECT jsonb_agg(DISTINCT r) FROM zone_tale_groups dz ` +
      `CROSS JOIN LATERAL jsonb_array_elements(${reasonsSql(ZONE_SETUP_CLAUSES, 'dz.zone_id', p)}) r ` +
      `WHERE dz.tale_group_id = ${g}.id), '[]'::jsonb)`,
  },
];

/**
 * A zone's reasons (R7), on a zone id expression: its setup, and whether a tale group placed in it
 * is delivered there.
 */
export const ZONE_REASON_CLAUSES: readonly ReasonClause[] = [
  ...ZONE_SETUP_CLAUSES,
  {
    code: 'no-tale-groups',
    subject: 'zone',
    when: (z) => `NOT EXISTS (SELECT 1 FROM zone_tale_groups zp WHERE zp.zone_id = ${z})`,
  },
  {
    code: 'no-visible-groups',
    subject: 'zone',
    when: (z, p) =>
      `EXISTS (SELECT 1 FROM zone_tale_groups zp WHERE zp.zone_id = ${z}) ` +
      `AND NOT EXISTS (SELECT 1 FROM zone_tale_groups zp JOIN tale_groups zg ON zg.id = zp.tale_group_id ` +
      `WHERE zp.zone_id = ${z} AND ${noReason(GROUP_OWN_REASON_CLAUSES, 'zg', p)})`,
  },
];

// True when no clause holds: the Delivery filter.
function noReason(clauses: readonly ReasonClause[], t: string, param: string): string {
  return `(${clauses.map((c) => `(${c.when(t, param)}) IS NOT TRUE`).join(' AND ')})`;
}

// The reasons of the clauses that hold, as one jsonb array of `{ code, subject, at? }`: the indicator.
function reasonsSql(clauses: readonly ReasonClause[], t: string, param: string): string {
  const items = clauses.map((c) => {
    const given =
      c.reasons?.(t, param) ??
      `jsonb_build_array(jsonb_build_object(${[
        `'code', '${c.code}'`,
        `'subject', '${c.subject}'`,
        ...(c.at ? [`'at', ${c.at(t)}`] : []),
      ].join(', ')}))`;
    return `CASE WHEN (${c.when(t, param)}) IS TRUE THEN ${given} ELSE '[]'::jsonb END`;
  });
  return `(${items.join(' || ')})`;
}

/** True when the zone (an id expression) is set up: it has a display and is installed (R7). */
export function zoneSetUp(zoneId: string): string {
  return noReason(ZONE_SETUP_CLAUSES, zoneId, 'NULL');
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
 * A group delivered somewhere at $n, for the tale_groups alias `g`: none of
 * {@link GROUP_REASON_CLAUSES} holds, so it is live in its window, with a delivered tale, and placed
 * in a zone that has a display and a key (AD-6, AD-14, R7). The rule the public cover, media and
 * font routes serve by.
 */
export function deliveredGroup(g: string, param: string): string {
  return noReason(GROUP_REASON_CLAUSES, g, param);
}

/**
 * A group the Delivery API delivers in the zone `zoneId` (an id expression) where it is placed:
 * none of its own reasons holds and the zone is set up (R7).
 */
export function deliveredPlacement(g: string, zoneId: string, param: string): string {
  return `${noReason(GROUP_OWN_REASON_CLAUSES, g, param)} AND ${zoneSetUp(zoneId)}`;
}

/** A zone (an id expression) the site shows something in: none of {@link ZONE_REASON_CLAUSES} holds. */
export function zoneDelivers(zoneId: string, param: string): string {
  return noReason(ZONE_REASON_CLAUSES, zoneId, param);
}

/** The reasons of {@link TALE_REASON_CLAUSES} that hold for the tale `t` at `param`, as a jsonb array. */
export function taleReasonsSql(t: string, param: string): string {
  return reasonsSql(TALE_REASON_CLAUSES, t, param);
}

/**
 * The reasons that hold for the group `g` at `param`, as a jsonb array: in the zone `zoneId` (an id
 * expression where it is placed) its own and that zone's setup reasons; without one, for any zone
 * ({@link GROUP_REASON_CLAUSES}).
 */
export function groupReasonsSql(g: string, param: string, zoneId?: string): string {
  if (zoneId === undefined) return reasonsSql(GROUP_REASON_CLAUSES, g, param);
  return `(${reasonsSql(GROUP_OWN_REASON_CLAUSES, g, param)} || ${reasonsSql(ZONE_SETUP_CLAUSES, zoneId, param)})`;
}

/** The reasons of {@link ZONE_REASON_CLAUSES} that hold for the zone (an id expression), as a jsonb array. */
export function zoneReasonsSql(zoneId: string, param: string): string {
  return reasonsSql(ZONE_REASON_CLAUSES, zoneId, param);
}

/** Reasons as pg returns them from the SQL above, with `at` in ISO 8601 UTC. */
export function readReasons(value: unknown): VisibilityReason[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: { code: VisibilityReasonCode; subject: VisibilitySubject; at?: string }) =>
    item.at
      ? { code: item.code, subject: item.subject, at: new Date(item.at).toISOString() }
      : { code: item.code, subject: item.subject },
  );
}
