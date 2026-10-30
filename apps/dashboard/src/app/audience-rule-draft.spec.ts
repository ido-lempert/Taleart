import type { AudienceRule } from '@taleart/contract/core';
import {
  checkRows,
  emptyRow,
  rowReason,
  rowsFromRule,
  rowsToRule,
  tryAudience,
  valueShape,
  type DraftRow,
} from './audience-rule-draft';

const row = (over: Partial<DraftRow> & Pick<DraftRow, 'property' | 'operator'>): DraftRow => ({
  key: 1,
  kind: 'text',
  value: '',
  touched: false,
  ...over,
});

const PLAN_PRO = row({ key: 1, property: 'plan', operator: 'eq', value: 'pro' });
const AGE_30 = row({ key: 2, property: 'age', operator: 'gte', kind: 'number', value: '30' });

describe('audience rule draft (epic viewer properties)', () => {
  it('turns the rows into the rule the API checks, typing each value by its operator', () => {
    const checked = checkRows('all', [PLAN_PRO, AGE_30]);
    expect(checked).toEqual({
      ok: true,
      rule: {
        match: 'all',
        conditions: [
          { property: 'plan', operator: 'eq', value: 'pro' },
          { property: 'age', operator: 'gte', value: 30 },
        ],
      },
    });
  });

  it('types a boolean row as true or false, a list as its trimmed items, and an exists row with no value', () => {
    const rule = rowsToRule('any', [
      row({ property: 'vip', operator: 'eq', kind: 'boolean', value: 'false' }),
      row({ property: 'segment', operator: 'in', value: ' summer , , vip ' }),
      row({ property: 'city', operator: 'exists', value: 'ignored' }),
    ]);
    expect(rule).toEqual({
      match: 'any',
      conditions: [
        { property: 'vip', operator: 'eq', value: false },
        { property: 'segment', operator: 'in', value: ['summer', 'vip'] },
        { property: 'city', operator: 'exists' },
      ],
    });
  });

  it('gives the value shape by operator: none, list, number, or the row kind for eq and neq', () => {
    expect(valueShape({ operator: 'notExists', kind: 'text' })).toBe('none');
    expect(valueShape({ operator: 'notIn', kind: 'text' })).toBe('list');
    expect(valueShape({ operator: 'lt', kind: 'text' })).toBe('number');
    expect(valueShape({ operator: 'contains', kind: 'number' })).toBe('text');
    expect(valueShape({ operator: 'neq', kind: 'boolean' })).toBe('boolean');
    expect(valueShape({ operator: 'eq', kind: 'number' })).toBe('number');
  });

  it('says why a row is not valid, in words for that row, and nothing for a good one', () => {
    const rows = [PLAN_PRO, row({ key: 2, property: '1plan', operator: 'eq', value: 'x' })];
    expect(rowReason('all', rows, 0)).toBeNull();
    expect(rowReason('all', rows, 1)).toMatch(/^property must be 1 to 64 characters/);
    expect(rowReason('all', rows, 1)).not.toContain('Condition 1');
  });

  it('asks for a value, and a number for an order operator, with the reason on that row', () => {
    expect(rowReason('all', [row({ property: 'plan', operator: 'eq' })], 0)).toBe('eq needs a value');
    expect(rowReason('all', [row({ property: 'age', operator: 'gt', kind: 'number', value: 'thirty' })], 0)).toBe(
      'gt needs a number',
    );
    expect(rowReason('all', [row({ property: 'city', operator: 'contains', value: '  ' })], 0)).toBe(
      'contains needs a value',
    );
  });

  it('refuses no rows, and more than ten, with a reason for the whole rule', () => {
    expect(checkRows('all', [])).toEqual({
      ok: false,
      reason: 'Add a condition, or use Clear audience rule to remove the rule.',
      index: null,
    });
    const eleven = Array.from({ length: 11 }, (_, i) => row({ key: i, property: `p${i}`, operator: 'exists' }));
    expect(checkRows('all', eleven)).toEqual({
      ok: false,
      reason: 'An audience rule has at most 10 conditions.',
      index: null,
    });
  });

  it('points at the first row that is not valid', () => {
    const checked = checkRows('all', [PLAN_PRO, row({ key: 2, property: '', operator: 'exists' })]);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.index).toBe(1);
      expect(checked.reason).toMatch(/^property must be/);
    }
  });

  it('opens a saved rule as rows, and turns those rows back into the same rule', () => {
    const saved: AudienceRule = {
      match: 'any',
      conditions: [
        { property: 'plan', operator: 'in', value: ['pro', 'team'] },
        { property: 'age', operator: 'lte', value: 65 },
        { property: 'vip', operator: 'neq', value: true },
        { property: 'city', operator: 'notExists' },
      ],
    };
    const opened = rowsFromRule(saved);
    expect(opened.match).toBe('any');
    expect(opened.rows.map((r) => [r.operator, r.kind, r.value])).toEqual([
      ['in', 'text', 'pro, team'],
      ['lte', 'number', '65'],
      ['neq', 'boolean', 'true'],
      ['notExists', 'text', ''],
    ]);
    expect(checkRows(opened.match, opened.rows)).toEqual({ ok: true, rule: saved });
  });

  it('opens nothing for no rule', () => {
    expect(rowsFromRule(null)).toEqual({ match: 'all', rows: [] });
    expect(emptyRow(3)).toEqual({ key: 3, property: '', operator: 'eq', kind: 'text', value: '', touched: false });
  });

  describe('Try it', () => {
    const rule: AudienceRule = {
      match: 'all',
      conditions: [
        { property: 'plan', operator: 'eq', value: 'pro' },
        { property: 'age', operator: 'gte', value: 30 },
      ],
    };

    it('shows the group when the viewer meets the rule, and hides it when not', () => {
      expect(tryAudience(rule, '{"plan": "Pro", "age": 34}')).toEqual({ kind: 'shown', noProperties: false, noRule: false });
      expect(tryAudience(rule, '{"plan": "free", "age": 34}')).toEqual({ kind: 'hidden' });
      expect(tryAudience(rule, '{"plan": "pro", "age": 12}')).toEqual({ kind: 'hidden' });
    });

    it('shows the group to a viewer with no properties at all: an empty box, or null', () => {
      expect(tryAudience(rule, '')).toEqual({ kind: 'shown', noProperties: true, noRule: false });
      expect(tryAudience(rule, '   ')).toEqual({ kind: 'shown', noProperties: true, noRule: false });
      expect(tryAudience(rule, 'null')).toEqual({ kind: 'shown', noProperties: true, noRule: false });
    });

    it('evaluates an empty object as a viewer with properties, so a rule that needs one fails', () => {
      expect(tryAudience(rule, '{}')).toEqual({ kind: 'hidden' });
    });

    it('shows the group when there is no rule', () => {
      expect(tryAudience(null, '{"plan": "free"}')).toEqual({ kind: 'shown', noProperties: false, noRule: true });
    });

    it('reports text that is not JSON', () => {
      const result = tryAudience(rule, '{"plan": ');
      expect(result.kind).toBe('invalid-json');
    });
  });
});
