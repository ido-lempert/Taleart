import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { audienceOperatorValues, audienceRuleMatchValues } from '../generated/api';
import {
  audienceRulePasses,
  AUDIENCE_MATCHES,
  AUDIENCE_OPERATORS,
  MAX_AUDIENCE_CONDITIONS,
  MAX_PROPERTY_LIST_ITEMS,
  MAX_PROPERTY_STRING_LENGTH,
  MAX_VIEWER_PROPERTIES,
  PROPERTY_NAME_PATTERN,
  validateAudienceRule,
  viewerPropertiesFrom,
  type AudienceRule,
} from './audience-rule';

interface AudienceRuleCase {
  name: string;
  rule: AudienceRule | null;
  properties: Record<string, unknown> | null;
  passes: boolean;
}

const table = JSON.parse(readFileSync(join(__dirname, '../../targeting/audience-rule.cases.json'), 'utf8')) as {
  cases: AudienceRuleCase[];
};

const condition = (property: string, operator: string, value?: unknown) => ({
  property,
  operator,
  ...(value !== undefined && { value }),
});

describe('the audience rule test table (epic viewer properties)', () => {
  it('has at least 60 cases with unique names', () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(table.cases.map((c) => c.name)).size).toBe(table.cases.length);
  });

  it.each(table.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(audienceRulePasses(c.rule, c.properties)).toBe(c.passes);
    // The same answer from the properties normalised once, as the SDK keeps them.
    expect(audienceRulePasses(c.rule, viewerPropertiesFrom(c.properties))).toBe(c.passes);
  });
});

describe('audienceRulePasses', () => {
  it('passes with no rule, an empty rule or no properties, and fails a missing eq', () => {
    expect(audienceRulePasses(null, null)).toBe(true);
    expect(audienceRulePasses(undefined, { plan: 'pro' })).toBe(true);
    expect(audienceRulePasses({ match: 'all', conditions: [] }, {})).toBe(true);
    expect(audienceRulePasses({ match: 'all', conditions: [condition('plan', 'eq', 'pro')] } as AudienceRule, undefined)).toBe(true);
    expect(audienceRulePasses({ match: 'all', conditions: [condition('plan', 'eq', 'pro')] } as AudienceRule, {})).toBe(false);
  });

  it('answers the same for any number of conditions up to the limit', () => {
    const conditions = Array.from({ length: MAX_AUDIENCE_CONDITIONS }, (_, i) => condition(`p${i}`, 'exists'));
    const props = Object.fromEntries(conditions.map((c) => [c.property, 1]));
    expect(audienceRulePasses({ match: 'all', conditions } as AudienceRule, props)).toBe(true);
    expect(audienceRulePasses({ match: 'all', conditions } as AudienceRule, { p0: 1 })).toBe(false);
    expect(audienceRulePasses({ match: 'any', conditions } as AudienceRule, { p9: 1 })).toBe(true);
  });

  it('does not read inherited object members as properties', () => {
    expect(audienceRulePasses({ match: 'all', conditions: [condition('toString', 'exists')] } as AudienceRule, {})).toBe(false);
    expect(audienceRulePasses({ match: 'all', conditions: [condition('hasOwnProperty', 'notExists')] } as AudienceRule, {})).toBe(true);
  });

  it('fails closed on an operator this version does not know', () => {
    expect(audienceRulePasses({ match: 'all', conditions: [condition('plan', 'regex', 'p.*')] } as unknown as AudienceRule, { plan: 'pro' })).toBe(false);
  });
});

describe('viewerPropertiesFrom', () => {
  it('gives null for null and undefined, and an empty object for a value that is not an object', () => {
    expect(viewerPropertiesFrom(null)).toBeNull();
    expect(viewerPropertiesFrom(undefined)).toBeNull();
    expect(viewerPropertiesFrom({})).toEqual({});
    expect(viewerPropertiesFrom('pro')).toEqual({});
    expect(viewerPropertiesFrom(['pro'])).toEqual({});
  });

  it('keeps valid entries as given and drops the invalid ones', () => {
    expect(
      viewerPropertiesFrom({
        plan: 'pro',
        age: 30,
        beta: false,
        tags: ['a', 'b'],
        empty: [],
        nothing: null,
        object: { a: 1 },
        '1bad': 'x',
        'has space': 'x',
        score: Number.NaN,
        big: Number.POSITIVE_INFINITY,
        mixed: ['a', 2],
      }),
    ).toEqual({ plan: 'pro', age: 30, beta: false, tags: ['a', 'b'], empty: [] });
  });

  it('keeps names case-sensitive and stored as given', () => {
    expect(viewerPropertiesFrom({ Plan: 'Pro', plan: 'pro' })).toEqual({ Plan: 'Pro', plan: 'pro' });
  });

  it('applies the string and list limits exactly', () => {
    const atLimit = 'a'.repeat(MAX_PROPERTY_STRING_LENGTH);
    expect(viewerPropertiesFrom({ s: atLimit })).toEqual({ s: atLimit });
    expect(viewerPropertiesFrom({ s: `${atLimit}a` })).toEqual({});
    const list = Array.from({ length: MAX_PROPERTY_LIST_ITEMS }, (_, i) => `t${i}`);
    expect(viewerPropertiesFrom({ l: list })).toEqual({ l: list });
    expect(viewerPropertiesFrom({ l: [...list, 'extra'] })).toEqual({});
    expect(viewerPropertiesFrom({ l: [...'a'.repeat(MAX_PROPERTY_STRING_LENGTH + 1)] })).toEqual({});
  });

  it('keeps the first 50 valid properties in the order given', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < MAX_VIEWER_PROPERTIES + 10; i += 1) input[`p${i}`] = i;
    const kept = viewerPropertiesFrom(input) as Record<string, number>;
    expect(Object.keys(kept)).toHaveLength(MAX_VIEWER_PROPERTIES);
    expect(Object.keys(kept)[0]).toBe('p0');
    expect(kept['p49']).toBe(49);
    expect(kept['p50']).toBeUndefined();
  });

  it('does not let an invalid entry count toward the 50', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_VIEWER_PROPERTIES; i += 1) input[`bad ${i}`] = i;
    input['good'] = true;
    expect(viewerPropertiesFrom(input)).toEqual({ good: true });
  });

  it('matches the name pattern the OpenAPI document states', () => {
    expect(PROPERTY_NAME_PATTERN.source).toBe('^[A-Za-z][A-Za-z0-9_.-]{0,63}$');
    expect(PROPERTY_NAME_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(PROPERTY_NAME_PATTERN.test('a'.repeat(65))).toBe(false);
  });
});

describe('validateAudienceRule', () => {
  const valid = { match: 'any', conditions: [condition('plan', 'in', ['pro', 'plus'])] };

  it('accepts a valid rule and returns a clean copy', () => {
    const result = validateAudienceRule(valid);
    expect(result).toEqual({ ok: true, rule: valid });
    if (result.ok) expect(result.rule).not.toBe(valid);
  });

  it('accepts every operator with its value kind', () => {
    const conditions = [
      condition('a', 'eq', 'x'),
      condition('a', 'neq', 1),
      condition('a', 'eq', true),
      condition('a', 'in', ['x']),
      condition('a', 'notIn', ['x', 'y']),
      condition('a', 'gt', 1),
      condition('a', 'gte', 1.5),
      condition('a', 'lt', -2),
      condition('a', 'contains', 'x'),
      condition('a', 'exists'),
    ];
    expect(validateAudienceRule({ match: 'all', conditions })).toEqual({ ok: true, rule: expect.anything() });
    expect(validateAudienceRule({ match: 'all', conditions: [condition('a', 'notExists')] }).ok).toBe(true);
  });

  it('returns a clean rule without the fields it was not given', () => {
    const result = validateAudienceRule({ match: 'all', conditions: [{ property: 'a', operator: 'exists' }] });
    expect(result).toEqual({ ok: true, rule: { match: 'all', conditions: [{ property: 'a', operator: 'exists' }] } });
  });

  it.each([
    ['not an object', 'a', /audience rule is an object/],
    ['an array', [], /audience rule is an object/],
    ['null', null, /audience rule is an object/],
    ['a bad match', { match: 'every', conditions: [condition('a', 'exists')] }, /match must be "all" or "any"/],
    ['no conditions', { match: 'all', conditions: [] }, /1 to 10 conditions/],
    ['no conditions key', { match: 'all' }, /1 to 10 conditions/],
    ['too many conditions', { match: 'all', conditions: Array.from({ length: MAX_AUDIENCE_CONDITIONS + 1 }, () => condition('a', 'exists')) }, /1 to 10 conditions/],
    ['an unknown rule field', { match: 'all', conditions: [condition('a', 'exists')], nested: true }, /unknown field "nested"/],
    ['a nested rule', { match: 'all', conditions: [{ match: 'all', conditions: [] }] }, /Condition 1: unknown field "match"/],
    ['a condition that is not an object', { match: 'all', conditions: ['plan'] }, /Condition 1: a condition is an object/],
    ['an unknown condition field', { match: 'all', conditions: [{ property: 'a', operator: 'exists', extra: 1 }] }, /unknown field "extra"/],
    ['a bad property name', { match: 'all', conditions: [condition('1a', 'exists')] }, /Condition 1: property must be/],
    ['a property name with a space', { match: 'all', conditions: [condition('a b', 'exists')] }, /Condition 1: property must be/],
    ['a missing property name', { match: 'all', conditions: [{ operator: 'exists' }] }, /Condition 1: property must be/],
    ['an unknown operator', { match: 'all', conditions: [condition('a', 'regex', 'x')] }, /Condition 1: operator must be one of eq/],
    ['exists with a value', { match: 'all', conditions: [condition('a', 'exists', 'x')] }, /Condition 1: exists takes no value/],
    ['notExists with a value', { match: 'all', conditions: [condition('a', 'notExists', true)] }, /Condition 1: notExists takes no value/],
    ['eq with no value', { match: 'all', conditions: [condition('a', 'eq')] }, /Condition 1: eq needs a value/],
    ['eq with a list', { match: 'all', conditions: [condition('a', 'eq', ['x'])] }, /Condition 1: eq needs a string, a number or a boolean/],
    ['eq with a NaN number', { match: 'all', conditions: [condition('a', 'eq', Number.NaN)] }, /Condition 1: eq needs a number/],
    ['eq with a long string', { match: 'all', conditions: [condition('a', 'eq', 'x'.repeat(MAX_PROPERTY_STRING_LENGTH + 1))] }, /Condition 1: a string is at most/],
    ['in with a string', { match: 'all', conditions: [condition('a', 'in', 'x')] }, /Condition 1: in needs a list of 1 to 50 strings/],
    ['in with an empty list', { match: 'all', conditions: [condition('a', 'in', [])] }, /Condition 1: in needs a list/],
    ['in with 51 items', { match: 'all', conditions: [condition('a', 'in', Array.from({ length: 51 }, (_, i) => `v${i}`))] }, /Condition 1: in needs a list/],
    ['notIn with a number item', { match: 'all', conditions: [condition('a', 'notIn', ['1', 2])] }, /Condition 1: notIn needs a list/],
    ['gt with a string', { match: 'all', conditions: [condition('a', 'gt', '30')] }, /Condition 1: gt needs a number/],
    ['lte with a boolean', { match: 'all', conditions: [condition('a', 'lte', true)] }, /Condition 1: lte needs a number/],
    ['contains with an empty string', { match: 'all', conditions: [condition('a', 'contains', '  ')] }, /Condition 1: contains needs a non-empty string/],
    ['contains with a number', { match: 'all', conditions: [condition('a', 'contains', 3)] }, /Condition 1: contains needs a non-empty string/],
    ['the second condition is the bad one', { match: 'all', conditions: [condition('a', 'exists'), condition('b', 'gt', 'x')] }, /^Condition 2: gt needs a number$/],
  ])('refuses %s', (_name, input, reason) => {
    const result = validateAudienceRule(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it('accepts exactly 1 and exactly 10 conditions', () => {
    expect(validateAudienceRule({ match: 'all', conditions: [condition('a', 'exists')] }).ok).toBe(true);
    const ten = Array.from({ length: MAX_AUDIENCE_CONDITIONS }, () => condition('a', 'exists'));
    expect(validateAudienceRule({ match: 'all', conditions: ten }).ok).toBe(true);
  });

  it('accepts a string of exactly the limit and a list of exactly the limit', () => {
    expect(validateAudienceRule({ match: 'all', conditions: [condition('a', 'eq', 'x'.repeat(MAX_PROPERTY_STRING_LENGTH))] }).ok).toBe(true);
    const list = Array.from({ length: MAX_PROPERTY_LIST_ITEMS }, (_, i) => `v${i}`);
    expect(validateAudienceRule({ match: 'all', conditions: [condition('a', 'in', list)] }).ok).toBe(true);
  });

  it('does not copy an invalid rule', () => {
    const bad = { match: 'all', conditions: [condition('a', 'exists', 'x')] };
    expect(validateAudienceRule(bad)).toEqual({ ok: false, reason: 'Condition 1: exists takes no value' });
  });
});

describe('the contract constants and the generated enums', () => {
  it('lists the operators and match modes the OpenAPI document generates', () => {
    expect([...AUDIENCE_OPERATORS]).toEqual([...audienceOperatorValues]);
    expect([...AUDIENCE_MATCHES]).toEqual([...audienceRuleMatchValues]);
  });

  it('holds the limits the OpenAPI document states', () => {
    expect(MAX_AUDIENCE_CONDITIONS).toBe(10);
    expect(MAX_PROPERTY_STRING_LENGTH).toBe(256);
    expect(MAX_PROPERTY_LIST_ITEMS).toBe(50);
    expect(MAX_VIEWER_PROPERTIES).toBe(50);
  });
});
