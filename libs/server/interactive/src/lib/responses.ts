import {
  choiceIds,
  choiceResult,
  INTERACTIONS,
  isInteractiveElementType,
  MAX_RESPONSE_VALUE_LENGTH,
  ratingResult,
  ratingValue,
  type ElementResponseCounts,
  type ResponseResult,
  type TaleResponses,
} from '@taleart/contract';
import type { Db } from '@taleart/server-access';
import { deliveredTaleElement } from '@taleart/server-tales';
import { findZone } from '@taleart/server-zones';
import { InvalidResponseValueError, ResponseTargetNotFoundError, VisitorIdRequiredError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A visitor's response, as the Delivery API received it. */
export interface NewResponse {
  /** The zone the site key and slug named (AD-2). */
  zoneId: string;
  taleId: string;
  elementId: string;
  /** The value as sent: checked against the published document, never trusted (R15). */
  value: unknown;
  /** The device's visitor id, a lowercase UUID v4 (epic UX rework 8.23). */
  visitorId: string;
  /** When the visitor responded, by the device's clock; null when not sent. */
  clientAt: Date | null;
}

/** The visitor's stored response and the component's result now. */
export interface RecordedResponse {
  elementId: string;
  /** The stored value: this request's, or the first one on a repeat (C9). */
  value: string;
  /** True when this request stored it. */
  recorded: boolean;
  /** A poll's or a quiz's counts and percentages per choice, or a Rating's count and average. */
  result: ResponseResult;
}

/** How one interactive type's responses are checked and counted, from its published props. */
interface ResponseKind {
  /** True when `value` is a response this component takes. */
  valid(value: string, props: Readonly<Record<string, unknown>>): boolean;
  /** The component's result from its stored values' counts. */
  result(counts: ReadonlyMap<string, number>, props: Readonly<Record<string, unknown>>): ResponseResult;
  /** What a refused value is told, when the default message does not say enough. */
  refused?: string;
}

// A choice component's kind: it takes one of the choice ids its props hold now and counts them per
// choice (a removed choice's responses count toward nothing).
const choiceKind = (type: string, refused?: string): ResponseKind => ({
  valid: (value, props) => choiceIds(type, props).includes(value),
  result: (counts, props) => choiceResult(choiceIds(type, props), counts),
  refused,
});

// Each interactive type's kind: a poll takes one of its option ids and a quiz one of its answer ids,
// each counted per choice (a quiz's correct answer is in its published document, C10, not in the
// result); a Rating takes a whole number from 0 to 100 and answers the count and average.
const RESPONSE_KINDS: Readonly<Record<string, ResponseKind>> = {
  poll: choiceKind('poll'),
  quiz: choiceKind('quiz', "An answer is one of the quiz's answer ids"),
  rating: {
    valid: (value) => ratingValue(value) !== null,
    result: (counts) => ratingResult(counts),
    refused: 'A rating is a whole number from 0 to 100',
  },
};

/**
 * Records a visitor's response to an interactive component (epic interactive components R9) and
 * answers the component's result. The tale must be delivered in the zone now and its published
 * document must show the element, of an interactive type (otherwise
 * {@link ResponseTargetNotFoundError}); the value must be one its kind takes, a poll's option id, a
 * quiz's answer id or a Rating's whole number from 0 to 100 (otherwise
 * {@link InvalidResponseValueError}); the visitor id must be a UUID v4 (otherwise
 * {@link VisitorIdRequiredError}). The first response per visitor, tale, element and interaction kind
 * is kept (C9); a repeat changes nothing and answers the stored one.
 */
export async function recordResponse(db: Db, input: NewResponse, now: Date = new Date()): Promise<RecordedResponse> {
  if (!UUID_V4.test(input.visitorId)) throw new VisitorIdRequiredError();
  const target = await deliveredTaleElement(db, input.zoneId, input.taleId, input.elementId, now);
  const type = target?.element.type;
  if (!target || !isInteractiveElementType(type) || !Object.prototype.hasOwnProperty.call(RESPONSE_KINDS, type)) {
    throw new ResponseTargetNotFoundError();
  }
  const kind = RESPONSE_KINDS[type];
  const props = target.element.props;
  const value = input.value;
  if (typeof value !== 'string' || value.length > MAX_RESPONSE_VALUE_LENGTH || !kind.valid(value, props)) {
    throw new InvalidResponseValueError(kind.refused);
  }
  const interaction = INTERACTIONS[type][0];
  const frameId = (await findZone(db, target.zoneId))?.frame?.id ?? null;
  const key = [target.taleId, target.element.id, interaction, input.visitorId];
  const inserted = await insertOrNotFound(() => db.query<{ value: string }>(
    `INSERT INTO interactive_responses
       (project_id, zone_id, frame_id, tale_group_id, tale_id, element_id, element_type, interaction, value,
        visitor_id, client_at, created_at)
     VALUES ($5, $6, $7, $8, $1, $2, $9, $3, $10, $4, $11, $12)
     ON CONFLICT (tale_id, element_id, interaction, visitor_id) DO NOTHING
     RETURNING value`,
    [...key, target.projectId, target.zoneId, frameId, target.taleGroupId, type, value, input.clientAt, now],
  ));
  let stored = inserted.rows[0]?.value;
  const recorded = stored !== undefined;
  if (!recorded) {
    const first = await db.query<{ value: string }>(
      `SELECT value FROM interactive_responses
       WHERE tale_id = $1 AND element_id = $2 AND interaction = $3 AND visitor_id = $4`,
      key,
    );
    // Gone between the two queries only if the tale was deleted meanwhile.
    if (first.rows.length === 0) throw new ResponseTargetNotFoundError();
    stored = first.rows[0].value;
  }
  return {
    elementId: target.element.id,
    value: stored as string,
    recorded,
    result: kind.result(await currentCounts(db, target.taleId, target.element.id, interaction), props),
  };
}

// The insert, with a tale deleted since the check (its key into `tales` fails, 23503) refused as a
// target that is not shown, never a server error.
async function insertOrNotFound<T>(insert: () => Promise<T>): Promise<T> {
  try {
    return await insert();
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === '23503') throw new ResponseTargetNotFoundError();
    throw err;
  }
}

// The component's stored responses now, counted per value.
async function currentCounts(db: Db, taleId: string, elementId: string, interaction: string): Promise<Map<string, number>> {
  const { rows } = await db.query<{ value: string; count: string }>(
    `SELECT value, count(*) AS count FROM interactive_responses
     WHERE tale_id = $1 AND element_id = $2 AND interaction = $3 GROUP BY value`,
    [taleId, elementId, interaction],
  );
  return new Map(rows.map((row) => [row.value, Number(row.count)]));
}

/**
 * Every interactive component's responses of a tale, per stored value, most first (R11): what Tale
 * Studio's inspector reads. Components without a response are not listed. Ids that are not UUIDs
 * have none.
 */
export async function taleResponseCounts(db: Db, taleId: string): Promise<TaleResponses> {
  if (!UUID.test(taleId)) return { elements: [] };
  const { rows } = await db.query<{ elementId: string; elementType: string; value: string; count: string }>(
    `SELECT element_id AS "elementId", min(element_type) AS "elementType", value, count(*) AS count
     FROM interactive_responses WHERE tale_id = $1
     GROUP BY element_id, value ORDER BY element_id, count(*) DESC, value`,
    [taleId],
  );
  const elements = new Map<string, ElementResponseCounts>();
  for (const row of rows) {
    const count = Number(row.count);
    let element = elements.get(row.elementId);
    if (!element) {
      element = { elementId: row.elementId, elementType: row.elementType, total: 0, values: [] };
      elements.set(row.elementId, element);
    }
    element.total += count;
    element.values.push({ value: row.value, count });
  }
  return { elements: [...elements.values()] };
}
