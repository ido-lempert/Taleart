// Interactive components (epic interactive components; AD-10, AD-13, AD-15): element types a
// visitor answers, whose responses the Delivery API records once per visitor and counts. The shapes
// come from openapi.yaml; the rules here are shared by the server, Tale Studio and the Web SDK.
import type { components } from '../generated/api';

type Schemas = components['schemas'];

/** One choice's count and share of a poll's or quiz's votes. */
export type ChoiceCount = Schemas['ChoiceCount'];
/** A choice component's result: its votes in all and per choice, as the visitor and the studio see them. */
export type ChoiceResult = Schemas['ChoiceResult'];
/** What the Web SDK posts to `POST /delivery/v1/responses`. */
export type InteractiveResponseRequest = Schemas['InteractiveResponseRequest'];
/** What `POST /delivery/v1/responses` answers: the visitor's stored response and the current result. */
export type InteractiveResponse = Schemas['InteractiveResponse'];
/** One component's stored responses, per value, as the Management API reads them for the studio. */
export type ElementResponseCounts = Schemas['ElementResponseCounts'];
/** Every component's responses of one tale (`GET /api/v1/tales/{taleId}/responses`). */
export type TaleResponses = Schemas['TaleResponses'];

/** The Delivery API path a response is posted to, under `/delivery/v1`. */
export const RESPONSES_PATH = '/responses';

/**
 * The most elements of a type one tale holds (C3), for each type that has a limit: one of each
 * interactive component. The server refuses a document over it, and Tale Studio's Add menu says so.
 */
export const ELEMENT_TYPE_LIMITS: Readonly<Record<string, number>> = { poll: 1 };

/**
 * The interaction kinds each interactive component records, its first the default. A visitor has
 * one response per component and kind (R9): a poll has one kind; a product pin will have two.
 */
export const INTERACTIONS: Readonly<Record<string, readonly string[]>> = { poll: ['vote'] };

/** True for an element type a visitor responds to. */
export function isInteractiveElementType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(INTERACTIONS, type);
}

/** The most characters a stored response value holds: a choice id, at most 64. */
export const MAX_RESPONSE_VALUE_LENGTH = 64;

/** The ids of a poll's options, in order; an empty list for props that are not a poll's. */
export function pollOptionIds(props: unknown): string[] {
  const options = (props as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option: { id?: unknown } | null) => (typeof option?.id === 'string' ? [option.id] : []));
}

/**
 * The result of a choice component: each choice's count, in the component's order, and its share as
 * a whole percentage. The shares add up to 100 when there is a vote (largest remainder, ties to the
 * earlier choice); every share is 0 without one. Counts of values that are no choice any more (an
 * option since removed) are left out, so they count toward nothing.
 */
export function choiceResult(choiceIds: readonly string[], counts: ReadonlyMap<string, number>): ChoiceResult {
  const raw = choiceIds.map((id) => {
    const count = counts.get(id) ?? 0;
    return { id, count: Number.isSafeInteger(count) && count > 0 ? count : 0 };
  });
  const total = raw.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return { total, choices: raw.map((c) => ({ ...c, percent: 0 })) };
  const exact = raw.map((c) => (c.count * 100) / total);
  const percents = exact.map(Math.floor);
  let left = 100 - percents.reduce((sum, p) => sum + p, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    percents[i] += 1;
    left -= 1;
  }
  return { total, choices: raw.map((c, i) => ({ ...c, percent: percents[i] })) };
}
