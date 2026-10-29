// Interactive components (epic interactive components; AD-10, AD-13, AD-15): element types a
// visitor answers, whose responses the Delivery API records once per visitor and counts. The shapes
// come from openapi.yaml; the rules here are shared by the server, Tale Studio and the Web SDK.
import type { components } from '../generated/api';

type Schemas = components['schemas'];

/** One choice's count and share of a poll's or quiz's votes. */
export type ChoiceCount = Schemas['ChoiceCount'];
/** A choice component's result: its votes in all and per choice, as the visitor and the studio see them. */
export type ChoiceResult = Schemas['ChoiceResult'];
/** A Rating's result: how many visitors rated it, and their average from 0 to 100. */
export type RatingResult = Schemas['RatingResult'];
/** A Reaction's result: how many visitors tapped it, and each emoji's count, in the order of its emojis. */
export type ReactionResult = Schemas['ReactionResult'];
/** Any interactive component's result, as `POST /delivery/v1/responses` answers it. */
export type ResponseResult = ChoiceResult | RatingResult | ReactionResult;
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
export const ELEMENT_TYPE_LIMITS: Readonly<Record<string, number>> = { poll: 1, rating: 1, quiz: 1, reaction: 1 };

/**
 * The interaction kinds each interactive component records, its first the default. A visitor has
 * one response per component and kind (R9): a poll has one kind; a product pin will have two.
 */
export const INTERACTIONS: Readonly<Record<string, readonly string[]>> = {
  poll: ['vote'],
  rating: ['rate'],
  quiz: ['answer'],
  reaction: ['react'],
};

/** True for an element type a visitor responds to. */
export function isInteractiveElementType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(INTERACTIONS, type);
}

/** The most characters a stored response value holds: a choice id, at most 64. */
export const MAX_RESPONSE_VALUE_LENGTH = 64;

/**
 * The prop that holds each choice component's `{ id, label }` choices, by type: a poll's options and
 * a quiz's answers. A visitor's response to one is a choice id, and it is counted per choice.
 */
export const CHOICE_PROPS: Readonly<Record<string, string>> = { poll: 'options', quiz: 'answers' };

/** True for a choice component's type: one whose responses are the ids of its choices. */
export function isChoiceElementType(type: unknown): type is string {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(CHOICE_PROPS, type);
}

/**
 * The ids of a choice component's choices, in order: a poll's options or a quiz's answers. An empty
 * list for a type that has no choices, or props that hold none.
 */
export function choiceIds(type: string, props: unknown): string[] {
  if (!isChoiceElementType(type)) return [];
  const choices = (props as Record<string, unknown> | null)?.[CHOICE_PROPS[type]];
  if (!Array.isArray(choices)) return [];
  return choices.flatMap((choice: { id?: unknown } | null) => (typeof choice?.id === 'string' ? [choice.id] : []));
}

/** The ids of a poll's options, in order; an empty list for props that are not a poll's. */
export function pollOptionIds(props: unknown): string[] {
  return choiceIds('poll', props);
}

/**
 * A quiz's correct answer id when it names one of its answers; null for a quiz without one (a
 * survey) and for props that are not a quiz's. It is public (C10): the published document holds it.
 */
export function quizCorrectAnswerId(props: unknown): string | null {
  const correct = (props as { correctAnswerId?: unknown } | null)?.correctAnswerId;
  return typeof correct === 'string' && choiceIds('quiz', props).includes(correct) ? correct : null;
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

/** True for a choice component's result (a poll's or a quiz's), as opposed to a Rating's or a Reaction's. */
export function isChoiceResult(result: ResponseResult): result is ChoiceResult {
  return Array.isArray((result as Partial<ChoiceResult>).choices);
}

/** True for a Reaction's result, as opposed to a choice component's or a Rating's. */
export function isReactionResult(result: ResponseResult): result is ReactionResult {
  return Array.isArray((result as Partial<ReactionResult>).reactions);
}

/**
 * The emoji a Reaction offers, in order: its `emojis` prop, or an empty list for props that hold none.
 * Whether each one is an emoji is the server's check (`isEmojiGlyph`), not this list's.
 */
export function reactionEmojis(props: unknown): string[] {
  const emojis = (props as { emojis?: unknown } | null)?.emojis;
  return Array.isArray(emojis) ? emojis.filter((emoji): emoji is string => typeof emoji === 'string') : [];
}

/**
 * A Reaction's result: each offered emoji's count, in the Reaction's order, and the taps in all. Counts
 * of values that are no emoji of the Reaction any more are left out, so they count toward nothing.
 */
export function reactionResult(emojis: readonly string[], counts: ReadonlyMap<string, number>): ReactionResult {
  const reactions = emojis.map((emoji) => {
    const count = counts.get(emoji) ?? 0;
    return { emoji, count: Number.isSafeInteger(count) && count > 0 ? count : 0 };
  });
  return { total: reactions.reduce((sum, r) => sum + r.count, 0), reactions };
}

/** The lowest value of a Rating's scale. */
export const RATING_MIN = 0;
/** The highest value of a Rating's scale. */
export const RATING_MAX = 100;
/** How far one arrow key moves a Rating's slider (epic interactive components R5). */
export const RATING_STEP = 10;

/**
 * A Rating's value as a number, from the decimal string it is sent and stored as: a whole number from
 * {@link RATING_MIN} to {@link RATING_MAX} written plainly (`"0"`, `"80"`, `"100"`; never `"080"`,
 * `"8.0"` or `" 8"`), so one rating has one spelling. Null for anything else.
 */
export function ratingValue(value: unknown): number | null {
  return typeof value === 'string' && /^(?:100|[1-9]?[0-9])$/.test(value) ? Number(value) : null;
}

/**
 * A Rating's result from its stored values' counts: the number of ratings and their mean, rounded
 * half up to a whole number; 0 without a rating. Values that are no rating are left out.
 */
export function ratingResult(counts: ReadonlyMap<string, number>): RatingResult {
  let total = 0;
  let sum = 0;
  for (const [value, count] of counts) {
    const rating = ratingValue(value);
    if (rating === null || !Number.isSafeInteger(count) || count <= 0) continue;
    total += count;
    sum += rating * count;
  }
  return { total, average: total === 0 ? 0 : Math.round(sum / total) };
}
