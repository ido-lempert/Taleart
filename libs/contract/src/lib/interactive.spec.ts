import Ajv2020 from 'ajv/dist/2020';
import {
  CHOICE_PROPS,
  choiceIds,
  choiceResult,
  ELEMENT_TYPE_LIMITS,
  elementName,
  elementTypeEntry,
  INTERACTIONS,
  isChoiceResult,
  isChoiceElementType,
  isInteractiveElementType,
  isReactionResult,
  pollOptionIds,
  quizCorrectAnswerId,
  ratingResult,
  ratingValue,
  reactionEmojis,
  reactionResult,
  TALE_ELEMENT_TYPE_REGISTRY,
} from '../index';

const poll = elementTypeEntry('poll');
const validPoll = {
  title: 'Morning',
  question: 'Tea or coffee?',
  theme: 'light',
  options: [
    { id: 'tea', label: 'Tea' },
    { id: 'coffee', label: 'Coffee' },
  ],
};

describe('poll element type (epic interactive components R1, R2)', () => {
  const validate = new Ajv2020().compile(poll?.schema ?? {});

  it('is registered, interactive and limited to one per tale', () => {
    expect(poll?.label).toBe('Poll');
    expect(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key)).toContain('poll');
    expect(isInteractiveElementType('poll')).toBe(true);
    expect(isInteractiveElementType('button')).toBe(false);
    expect(isInteractiveElementType('constructor')).toBe(false);
    expect(INTERACTIONS['poll']).toEqual(['vote']);
    expect(ELEMENT_TYPE_LIMITS['poll']).toBe(1);
  });

  it('accepts a question, two options with ids and a theme', () => {
    expect(validate(validPoll)).toBe(true);
    const untitled: Record<string, unknown> = { ...validPoll };
    delete untitled['title'];
    expect(validate(untitled)).toBe(true);
  });

  it('refuses one or three options, an option without an id, an unknown theme and extra props', () => {
    expect(validate({ ...validPoll, options: [validPoll.options[0]] })).toBe(false);
    expect(validate({ ...validPoll, options: [...validPoll.options, { id: 'milk', label: 'Milk' }] })).toBe(false);
    expect(validate({ ...validPoll, options: [{ label: 'Tea' }, validPoll.options[1]] })).toBe(false);
    expect(validate({ ...validPoll, options: [{ id: 'a b', label: 'Tea' }, validPoll.options[1]] })).toBe(false);
    expect(validate({ ...validPoll, theme: 'blue' })).toBe(false);
    expect(validate({ ...validPoll, color: '#ffffff' })).toBe(false);
  });

  it('states its text limits and refuses control characters', () => {
    expect(validate({ ...validPoll, question: 'x'.repeat(200) })).toBe(true);
    expect(validate({ ...validPoll, question: 'x'.repeat(201) })).toBe(false);
    expect(validate({ ...validPoll, question: '' })).toBe(false);
    expect(validate({ ...validPoll, question: 'Tea\nor coffee?' })).toBe(false);
    expect(validate({ ...validPoll, title: 'x'.repeat(81) })).toBe(false);
    expect(validate({ ...validPoll, options: [{ id: 'tea', label: 'x'.repeat(61) }, validPoll.options[1]] })).toBe(false);
  });

  it('keeps markup as plain text: the schema does not interpret it', () => {
    expect(validate({ ...validPoll, question: '<img src=x onerror=alert(1)>' })).toBe(true);
  });

  it('is named by its question in the layers list', () => {
    const element = { type: 'poll', a11y: {}, props: validPoll };
    expect(elementName([element], 0)).toBe('Tea or coffee?');
    expect(elementName([{ ...element, props: {} }], 0)).toBe('Poll');
  });

  it('reads its option ids in order', () => {
    expect(pollOptionIds(validPoll)).toEqual(['tea', 'coffee']);
    expect(pollOptionIds(null)).toEqual([]);
    expect(pollOptionIds({ options: [{ id: 1 }, { id: 'b' }] })).toEqual(['b']);
  });
});

describe('choiceResult', () => {
  it('gives 0 everywhere without a vote', () => {
    expect(choiceResult(['a', 'b'], new Map())).toEqual({
      total: 0,
      choices: [
        { id: 'a', count: 0, percent: 0 },
        { id: 'b', count: 0, percent: 0 },
      ],
    });
  });

  it('gives whole percentages that add up to 100', () => {
    expect(choiceResult(['a', 'b'], new Map([['a', 1]])).choices.map((c) => c.percent)).toEqual([100, 0]);
    const thirds = choiceResult(['a', 'b', 'c'], new Map([['a', 1], ['b', 1], ['c', 1]]));
    expect(thirds.choices.map((c) => c.percent)).toEqual([34, 33, 33]);
    const result = choiceResult(['a', 'b'], new Map([['a', 2], ['b', 1]]));
    expect(result).toEqual({
      total: 3,
      choices: [
        { id: 'a', count: 2, percent: 67 },
        { id: 'b', count: 1, percent: 33 },
      ],
    });
  });

  it('leaves out votes for a choice that is gone', () => {
    const result = choiceResult(['a', 'b'], new Map([['a', 1], ['removed', 5]]));
    expect(result.total).toBe(1);
    expect(result.choices.map((c) => c.percent)).toEqual([100, 0]);
  });
});

describe('rating element type (epic interactive components R1, R5)', () => {
  const rating = elementTypeEntry('rating');
  const validate = new Ajv2020().compile(rating?.schema ?? {});
  const valid = { question: 'How was it?', emoji: '❤️', theme: 'dark' };

  it('is registered, interactive, rated once and limited to one per tale', () => {
    expect(rating?.label).toBe('Rating');
    expect(isInteractiveElementType('rating')).toBe(true);
    expect(INTERACTIONS['rating']).toEqual(['rate']);
    expect(ELEMENT_TYPE_LIMITS['rating']).toBe(1);
  });

  it('accepts a question, an emoji and a theme, with an optional title', () => {
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, title: 'Quick one' })).toBe(true);
  });

  it('refuses missing or unknown props, long text and another theme', () => {
    expect(validate({ question: 'Q', theme: 'light' })).toBe(false);
    expect(validate({ ...valid, value: 50 })).toBe(false);
    expect(validate({ ...valid, question: 'x'.repeat(201) })).toBe(false);
    expect(validate({ ...valid, emoji: '' })).toBe(false);
    expect(validate({ ...valid, theme: 'blue' })).toBe(false);
    expect(validate({ ...valid, question: 'a\u0007b' })).toBe(false);
  });

  it('is named by its question in the layers list', () => {
    const element = { id: 'r', type: 'rating', box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 }, a11y: {}, props: valid };
    expect(elementName([element] as never, 0)).toBe('How was it?');
  });
});

describe('ratingValue and ratingResult (epic interactive components R5)', () => {
  it('takes whole numbers from 0 to 100 written plainly', () => {
    expect(['0', '7', '40', '80', '100'].map(ratingValue)).toEqual([0, 7, 40, 80, 100]);
    for (const bad of ['', '-1', '101', '080', '8.0', ' 8', '1e1', 'abc', '00', 80, null]) {
      expect(ratingValue(bad)).toBeNull();
    }
  });

  it('counts the ratings and rounds their average half up', () => {
    expect(ratingResult(new Map())).toEqual({ total: 0, average: 0 });
    expect(ratingResult(new Map([['80', 1], ['40', 1]]))).toEqual({ total: 2, average: 60 });
    expect(ratingResult(new Map([['0', 1], ['1', 1]]))).toEqual({ total: 2, average: 1 });
    expect(ratingResult(new Map([['100', 3], ['0', 1]]))).toEqual({ total: 4, average: 75 });
  });

  it('leaves out values that are no rating', () => {
    expect(ratingResult(new Map([['80', 1], ['tea', 4], ['50', 0]]))).toEqual({ total: 1, average: 80 });
  });

  it('tells a choice result from a rating result', () => {
    expect(isChoiceResult({ total: 0, choices: [] })).toBe(true);
    expect(isChoiceResult({ total: 0, average: 0 })).toBe(false);
  });
});

describe('reaction element type (components, 2026-10-29)', () => {
  const reaction = elementTypeEntry('reaction');
  const validate = new Ajv2020().compile(reaction?.schema ?? {});
  const valid = { question: 'How was it?', emojis: ['❤️', '😂', '😮'], theme: 'dark' };

  it('is registered, interactive, tapped once and limited to one per tale', () => {
    expect(reaction?.label).toBe('Reaction');
    expect(TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key)).toContain('reaction');
    expect(isInteractiveElementType('reaction')).toBe(true);
    expect(INTERACTIONS['reaction']).toEqual(['react']);
    expect(ELEMENT_TYPE_LIMITS['reaction']).toBe(1);
    expect(isChoiceElementType('reaction')).toBe(false);
  });

  it('accepts a question and two to six emoji, with an optional title and theme', () => {
    expect(validate(valid)).toBe(true);
    expect(validate({ question: 'Q', emojis: ['👍', '👎'] })).toBe(true);
    expect(validate({ ...valid, title: 'Quick one' })).toBe(true);
    expect(validate({ ...valid, emojis: ['👍', '👎', '🤔', '🔥', '🎉', '😂'] })).toBe(true);
  });

  it('refuses one emoji and seven, duplicates, empty entries and extra or malformed props', () => {
    expect(validate({ ...valid, emojis: ['❤️'] })).toBe(false);
    expect(validate({ ...valid, emojis: [] })).toBe(false);
    expect(validate({ ...valid, emojis: ['👍', '👎', '🤔', '🔥', '🎉', '😂', '😮'] })).toBe(false);
    expect(validate({ ...valid, emojis: ['❤️', '❤️'] })).toBe(false);
    expect(validate({ ...valid, emojis: ['❤️', ''] })).toBe(false);
    expect(validate({ ...valid, emojis: ['❤️', 42] })).toBe(false);
    expect(validate({ ...valid, emojis: 'hearts' })).toBe(false);
    expect(validate({ question: 'Q' })).toBe(false);
    expect(validate({ ...valid, theme: 'blue' })).toBe(false);
    expect(validate({ ...valid, question: 'a\u0007b' })).toBe(false);
    expect(validate({ ...valid, options: valid.emojis })).toBe(false);
  });

  it('is named by its question in the layers list', () => {
    const element = { type: 'reaction', a11y: {}, props: valid };
    expect(elementName([element], 0)).toBe('How was it?');
    expect(elementName([{ ...element, props: {} }], 0)).toBe('Reaction');
  });

  it('reads its emoji in order, and counts each emoji it offers', () => {
    expect(reactionEmojis(valid)).toEqual(['❤️', '😂', '😮']);
    expect(reactionEmojis({ emojis: ['👍', 3] })).toEqual(['👍']);
    expect(reactionEmojis(null)).toEqual([]);
    expect(reactionResult(['❤️', '😂'], new Map([['😂', 2], ['❤️', 1], ['🔥', 9]]))).toEqual({
      total: 3,
      reactions: [
        { emoji: '❤️', count: 1 },
        { emoji: '😂', count: 2 },
      ],
    });
    expect(reactionResult(['❤️'], new Map())).toEqual({ total: 0, reactions: [{ emoji: '❤️', count: 0 }] });
    expect(isReactionResult(reactionResult(['❤️'], new Map()))).toBe(true);
    expect(isReactionResult({ total: 0, average: 0 })).toBe(false);
    expect(isChoiceResult(reactionResult(['❤️'], new Map()))).toBe(false);
  });
});

describe('quiz element type (epic interactive components R1, R3)', () => {
  const quiz = elementTypeEntry('quiz');
  const validate = new Ajv2020().compile(quiz?.schema ?? {});
  const answers = [
    { id: 'a', label: 'Mercury' },
    { id: 'b', label: 'Venus' },
    { id: 'c', label: 'Earth' },
    { id: 'd', label: 'Mars' },
  ];
  const valid = { question: 'Which planet is hottest?', answers, correctAnswerId: 'b', theme: 'light' };

  it('is registered, interactive, answered once and limited to one per tale', () => {
    expect(quiz?.label).toBe('Quiz');
    expect(isInteractiveElementType('quiz')).toBe(true);
    expect(isChoiceElementType('quiz')).toBe(true);
    expect(isChoiceElementType('rating')).toBe(false);
    expect(isChoiceElementType('toString')).toBe(false);
    expect(CHOICE_PROPS['quiz']).toBe('answers');
    expect(INTERACTIONS['quiz']).toEqual(['answer']);
    expect(ELEMENT_TYPE_LIMITS['quiz']).toBe(1);
  });

  it('accepts two to four answers, with or without a correct answer and a title', () => {
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, answers: answers.slice(0, 2), correctAnswerId: undefined })).toBe(true);
    const survey: Record<string, unknown> = { ...valid, title: 'Space' };
    delete survey['correctAnswerId'];
    expect(validate(survey)).toBe(true);
  });

  it('refuses one or five answers, an answer without an id, a malformed correct id and extra props', () => {
    expect(validate({ ...valid, answers: answers.slice(0, 1) })).toBe(false);
    expect(validate({ ...valid, answers: [...answers, { id: 'e', label: 'Jupiter' }] })).toBe(false);
    expect(validate({ ...valid, answers: [{ label: 'Mercury' }, ...answers.slice(1)] })).toBe(false);
    expect(validate({ ...valid, correctAnswerId: 'b c' })).toBe(false);
    expect(validate({ ...valid, correctAnswerId: '' })).toBe(false);
    expect(validate({ ...valid, options: answers })).toBe(false);
    expect(validate({ ...valid, answers: [{ id: 'a', label: 'x'.repeat(61) }, answers[1]] })).toBe(false);
    expect(validate({ ...valid, question: 'Which\nplanet?' })).toBe(false);
  });

  it('is named by its question in the layers list', () => {
    const element = { type: 'quiz', a11y: {}, props: valid };
    expect(elementName([element], 0)).toBe('Which planet is hottest?');
    expect(elementName([{ ...element, props: {} }], 0)).toBe('Quiz');
  });

  it("reads a choice component's ids in order, and a quiz's correct answer when it is one of them", () => {
    expect(choiceIds('quiz', valid)).toEqual(['a', 'b', 'c', 'd']);
    expect(choiceIds('poll', { options: [{ id: 'tea' }] })).toEqual(['tea']);
    expect(choiceIds('poll', valid)).toEqual([]);
    expect(choiceIds('rating', valid)).toEqual([]);
    expect(choiceIds('quiz', null)).toEqual([]);
    expect(quizCorrectAnswerId(valid)).toBe('b');
    expect(quizCorrectAnswerId({ ...valid, correctAnswerId: 'z' })).toBeNull();
    expect(quizCorrectAnswerId({ ...valid, correctAnswerId: undefined })).toBeNull();
    expect(quizCorrectAnswerId(null)).toBeNull();
  });
});
