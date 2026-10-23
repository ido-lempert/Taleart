import Ajv2020 from 'ajv/dist/2020';
import {
  choiceResult,
  ELEMENT_TYPE_LIMITS,
  elementName,
  elementTypeEntry,
  INTERACTIONS,
  isInteractiveElementType,
  pollOptionIds,
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
